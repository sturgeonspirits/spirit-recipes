// Smoke test for the v1.21.0 fermentation/distillation split.
//
// Serves the app statically, stubs the Apps Script backend, drives mash.html in
// a real browser and asserts that:
//   - the Ferments card renders, the gravity log/chart/Tilt link live in the
//     ferment editor, and the run editor no longer carries any of them
//   - saving a ferment posts replace_readings/replace_additions keyed on
//     ferment_id
//   - a run copies the linked ferment's OG/FG into its own columns
//   - nothing throws (any console error or page error fails the run)
//
// Needs Playwright, which the repo deliberately doesn't declare as a dependency
// — there's no package.json, and adding one would change what Netlify does at
// build time. Install it ad hoc when you want to run this:
//
//   npm i -D playwright && node test/smoke_ferment_split.js
//
// Set CHROMIUM to a browser binary if the default path doesn't exist.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const MASH = {
  mash_id: 'mash_1', name: 'Agave Wash', spirit_type: 'Agave spirit',
  batch_volume: 200, volume_unit: 'L', target_og: 1.071, target_fg: 1.0,
  yeast_strain: 'DADY', pitch_rate: '1 g/L', ferment_temp: 82,
  components: [{ mash_id: 'mash_1', component: 'Agave syrup', category: 'sugar/adjunct', amount: 51, unit: 'kg', timing: 'mash', notes: '' }],
  runs: [{
    run_id: 'run_1', mash_id: 'mash_1', ferment_id: 'ferm_1', run_date: '07/20/2026',
    still_used: 'Pot', volume_unit: 'L', ferment_og: 1.071, ferment_fg: 1.002,
    wash_abv: '', wash_volume: 190, hearts_volume: 20, hearts_abv: 70, notes: 'Clean run'
  }],
  ferments: [{
    ferment_id: 'ferm_1', mash_id: 'mash_1', name: 'Agave #7', start_date: '07/01/2026',
    end_date: '07/09/2026', status: 'distilled', batch_volume: 200, volume_unit: 'L',
    og: 1.071, fg: 1.002, wash_abv: '', yeast_strain: 'DADY', pitch_rate: '1 g/L',
    ferment_temp: 82, tilt_sheet_url: '', notes: 'Took off fast, no stall.',
    readings: [
      { reading_id: 'r1', ferment_id: 'ferm_1', reading_date: '07/01/2026', reading_time: '08:00', gravity: 1.071, temp: 78, ph: 5.2, notes: 'OG' },
      { reading_id: 'r2', ferment_id: 'ferm_1', reading_date: '07/04/2026', reading_time: '08:00', gravity: 1.030, temp: 84, ph: 4.4, notes: '' },
      { reading_id: 'r3', ferment_id: 'ferm_1', reading_date: '07/09/2026', reading_time: '08:00', gravity: 1.002, temp: 80, ph: 4.1, notes: 'FG' }
    ],
    additions: [{ addition_id: 'a1', ferment_id: 'ferm_1', item: 'SuperFerm', category: 'nutrient', amount: 200, unit: 'g', timing: 'fermentation', notes: 'trial' }]
  }]
};

// What the backend synthesizes for a sheet that hasn't been migrated yet: the
// run has no ferment_id, so ?mash= returns a read-only stand-in ferment built
// from the run's own columns (see fermentsForMash_ in Code.gs).
const LEGACY = {
  mash_id: 'mash_legacy', name: 'Old Rum Wash', volume_unit: 'L', target_fg: 1.0,
  components: [],
  runs: [{
    run_id: 'run_old', mash_id: 'mash_legacy', ferment_id: '', run_date: '05/02/2026',
    still_used: 'Pot', volume_unit: 'L', ferment_og: 1.06, ferment_fg: 1.005,
    wash_volume: 100, hearts_volume: 8, hearts_abv: 65, notes: ''
  }],
  ferments: [{
    ferment_id: '', mash_id: 'mash_legacy', name: '', synthetic: true, legacy_run_id: 'run_old',
    start_date: '05/02/2026', end_date: '', status: 'distilled',
    batch_volume: 100, volume_unit: 'L', og: 1.06, fg: 1.005, wash_abv: '',
    tilt_sheet_url: '', notes: '',
    readings: [
      { reading_id: 'o1', run_id: 'run_old', reading_date: '04/25/2026', gravity: 1.06, temp: 76, ph: '', notes: '' },
      { reading_id: 'o2', run_id: 'run_old', reading_date: '05/01/2026', gravity: 1.005, temp: 79, ph: '', notes: '' }
    ],
    additions: []
  }]
};

// Karl's real row on 2026-08-14: a wash still fermenting, with 19 typed into
// wash_abv. 1.093 -> 1.0573 is 4.7%; fermentation cannot produce 19%.
const SUSPECT = {
  mash_id: 'mash_sus', name: 'Revised Agave Wash', volume_unit: 'gal', target_fg: 1.0,
  components: [], runs: [],
  ferments: [{
    ferment_id: 'ferm_sus', mash_id: 'mash_sus', name: 'Revised Agave Wash',
    start_date: '08/10/2026', end_date: '', status: 'fermenting',
    batch_volume: 40, volume_unit: 'gal', og: '', fg: '', wash_abv: 19,
    yeast_strain: 'DADY', pitch_rate: '1.5', tilt_sheet_url: '', notes: '',
    readings: [
      { reading_id: 's4', ferment_id: 'ferm_sus', reading_date: '08/10/2026', gravity: 1.093, temp: 80, ph: 3.8, notes: '' },
      { reading_id: 's3', ferment_id: 'ferm_sus', reading_date: '08/13/2026', gravity: 1.0868, temp: 81, ph: 3.8, notes: 'superferm + calcium carbonate' },
      { reading_id: 's1', ferment_id: 'ferm_sus', reading_date: '08/14/2026', reading_time: '12:30', gravity: 1.0737, temp: 82.2, ph: 4.5, notes: '' },
      { reading_id: 's2', ferment_id: 'ferm_sus', reading_date: '08/15/2026', gravity: 1.0573, temp: 83.8, ph: 4.3, notes: 'added 75 g calcium carbonate' }
    ],
    additions: []
  }]
};

const posts = [];

function serve() {
  return new Promise(resolve => {
    var srv;
    srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/api') {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', c => { body += c; });
          req.on('end', () => {
            try { posts.push(JSON.parse(body)); } catch (_) { posts.push({ raw: body }); }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ ok: true }));
          });
          return;
        }
        let out = {};
        const mid = u.searchParams.get('mash');
        if (mid === 'mash_legacy') out = LEGACY;
        else if (mid === 'mash_sus') out = SUSPECT;
        else if (mid) out = MASH;
        else if (u.searchParams.get('list')) out = { recipes: [] };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(out));
        return;
      }
      // js/config.js hardcodes the real Apps Script URL — swap in the stub.
      if (u.pathname === '/js/config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end(`window.CONFIG = { API_URL: "http://127.0.0.1:${srv.address().port}/api" };`);
        return;
      }
      const p = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      res.end(fs.readFileSync(p));
    });
    srv.listen(0, () => resolve(srv));
  });
}

const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('  ok   ' + name);
  else { console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); failures.push(name); }
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // Icons and the manifest aren't staged for this test — ignore their 404s.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return;
    errors.push('console: ' + t);
  });

  // Point the app at our stub and pre-seed a session so the auth gate passes.
  await page.addInitScript(() => {
    sessionStorage.setItem('ss_auth', JSON.stringify({ token: 't', display_name: 'Test' }));
  });

  console.log('\n— mash page —');
  await page.goto(base + '/mash.html?id=mash_1', { waitUntil: 'networkidle' });

  check('ferments card lists the wash', (await page.textContent('#ferments-body')).includes('Agave #7'));
  check('ferment count shown', (await page.textContent('#ferments-count')).trim() === '(1)');
  check('status chip rendered', await page.locator('#ferments-body .ferment-status').count() === 1);
  check('gravity sparkline on the ferment card', await page.locator('#ferments-body svg.spark').count() === 1);
  check('tweak chip on the ferment card', (await page.textContent('#ferments-body')).includes('SuperFerm'));
  check('run card names its wash', (await page.textContent('#runs-body')).includes('From ferment'));
  check('run card no longer draws the ferment curve', await page.locator('#runs-body svg.spark').count() === 0);
  check('compare ferments table built', (await page.textContent('#ferments-compare')).includes('Atten'));
  check('compare runs table built', (await page.textContent('#runs-compare')).includes('Total rec.'));

  console.log('\n— ferment editor —');
  await page.click('#ferments-body .ferment-edit');
  await page.waitForSelector('#ferment-modal:not([hidden])');
  check('name loaded', await page.inputValue('#fm-name') === 'Agave #7');
  check('notes loaded', (await page.inputValue('#fm-notes')).includes('no stall'));
  check('three readings loaded', await page.locator('#readings-body .reading-card').count() === 3);
  check('chart drawn in the editor', await page.locator('#gravity-chart svg.spark').count() === 1);
  check('tilt link field present', await page.locator('#fm-tilt-url').count() === 1);
  check('sync button present', await page.locator('#import-gsheet').count() === 1);
  check('tweak row loaded', await page.inputValue('#additions-body .add-card [data-f="item"]') === 'SuperFerm');
  const fcalc = await page.textContent('#ferment-calc');
  check('live attenuation computed', /Attenuation/.test(fcalc) && /97%|96%/.test(fcalc), fcalc);

  // Add a reading, then save, and inspect what got posted.
  await page.click('#add-reading');
  await page.locator('#readings-body .reading-card').last().locator('[data-f="gravity"]').fill('1.001');
  await page.click('#ferment-save');
  await page.waitForSelector('#ferment-modal', { state: 'hidden' });

  const readingsPost = posts.find(p => p.action === 'replace_readings');
  const addsPost = posts.find(p => p.action === 'replace_additions');
  const fermPost = posts.find(p => p.action === 'update_ferment');
  check('ferment row updated', !!fermPost && fermPost.ferment.ferment_id === 'ferm_1');
  check('readings keyed on ferment_id', !!readingsPost && readingsPost.ferment_id === 'ferm_1');
  check('readings no longer carry a run_id', !!readingsPost && readingsPost.run_id === undefined);
  check('the new reading was saved', !!readingsPost && readingsPost.readings.length === 4);
  check('additions keyed on ferment_id', !!addsPost && addsPost.ferment_id === 'ferm_1');

  console.log('\n— run editor —');
  await page.click('#runs-body .run-edit');
  await page.waitForSelector('#run-modal:not([hidden])');
  check('no gravity log in the run editor', await page.locator('#run-modal #readings-body').count() === 0);
  check('no tilt controls in the run editor', await page.locator('#run-modal #import-gsheet').count() === 0);
  check('no tweaks list in the run editor', await page.locator('#run-modal #additions-body').count() === 0);
  check('ferment picker present', await page.locator('#r-ferment').count() === 1);
  check('picker preselects the linked wash', await page.inputValue('#r-ferment') === 'ferm_1');
  const summary = await page.textContent('#r-ferment-summary');
  check('summary shows the ferment gravities', summary.includes('OG 1.071') && summary.includes('FG 1.002'), summary);
  const rcalc = await page.textContent('#run-calc');
  check('wash ABV derived from the ferment', /9\.06%/.test(rcalc), rcalc);
  check('cut guidance still rendered', (await page.textContent('#cut-suggest')).includes('Foreshots'));

  posts.length = 0;
  await page.click('#run-save');
  await page.waitForSelector('#run-modal', { state: 'hidden' });
  const runPost = posts.find(p => p.action === 'update_run');
  check('run stores its ferment_id', !!runPost && runPost.run.ferment_id === 'ferm_1');
  check('run copies OG from the ferment', !!runPost && Number(runPost.run.ferment_og) === 1.071);
  check('run copies FG from the ferment', !!runPost && Number(runPost.run.ferment_fg) === 1.002);
  check('run no longer posts readings', !posts.some(p => p.action === 'replace_readings'));

  console.log('\n— new ferment —');
  await page.click('#add-ferment');
  await page.waitForSelector('#ferment-modal:not([hidden])');
  check('seeded from the recipe', await page.inputValue('#fm-yeast-strain') === 'DADY');
  check('status defaults to fermenting', await page.inputValue('#fm-status') === 'fermenting');
  check('log starts empty', await page.locator('#readings-body .reading-card').count() === 0);
  await page.click('#ferment-cancel');

  console.log('\n— a new reading moves every summary (regression: frozen og/fg) —');
  await page.goto(base + '/mash.html?id=mash_1', { waitUntil: 'networkidle' });
  const beforeCard = await page.textContent('#ferments-body');
  check('card starts at the stored FG', beforeCard.includes('1.002'), beforeCard);
  await page.click('#ferments-body .ferment-edit');
  await page.waitForSelector('#ferment-modal:not([hidden])');
  check('editor says the log decides', (await page.textContent('#fm-gravity-note')).includes('follow the gravity log'));
  check('redundant stored OG blanked on open', await page.inputValue('#fm-og') === '');
  check('redundant stored FG blanked on open', await page.inputValue('#fm-fg') === '');
  // Log today's reading: the wash has dropped further.
  await page.click('#add-reading');
  const last = page.locator('#readings-body .reading-card').last();
  await last.locator('[data-f="reading_date"]').fill('08/14/2026');
  await last.locator('[data-f="gravity"]').fill('0.998');
  const calcAfter = await page.textContent('#ferment-calc');
  check('editor FG follows the new reading', /0\.998/.test(calcAfter), calcAfter);
  await page.click('#ferment-save');
  await page.waitForSelector('#ferment-modal', { state: 'hidden' });

  const afterCard = await page.textContent('#ferments-body');
  check('card FG follows the new reading', afterCard.includes('0.998'), afterCard);
  check('card ABV recalculated', afterCard.includes('9.58%'), afterCard);
  const afterCompare = await page.textContent('#ferments-compare');
  check('compare ferments follows too', afterCompare.includes('0.998'));
  check('run card picks up the live ferment', (await page.textContent('#runs-body')).includes('9.58%'), await page.textContent('#runs-body'));

  const savedFerment = posts.filter(p => p.action === 'update_ferment').pop();
  check('og/fg are not written back from the log', !!savedFerment && savedFerment.ferment.fg === '' && savedFerment.ferment.og === '',
    savedFerment && JSON.stringify(savedFerment.ferment));

  console.log('\n— un-migrated sheet (synthetic ferment) —');
  await page.goto(base + '/mash.html?id=mash_legacy', { waitUntil: 'networkidle' });
  const legacyBody = await page.textContent('#ferments-body');
  check('legacy wash still shows up', legacyBody.includes('05/02/2026'));
  check('legacy wash is flagged, not editable', legacyBody.includes('un-migrated'));
  check('no edit button on a synthetic ferment', await page.locator('#ferments-body .ferment-edit').count() === 0);
  check('legacy curve still drawn', await page.locator('#ferments-body svg.spark').count() === 1);
  await page.click('#runs-body .run-edit');
  await page.waitForSelector('#run-modal:not([hidden])');
  check('synthetic ferment is not offered in the picker', await page.locator('#r-ferment option').count() === 1);
  await page.click('#run-cancel');

  console.log('\n— an impossible wash ABV is flagged, not shown as fact —');
  await page.goto(base + '/mash.html?id=mash_sus', { waitUntil: 'networkidle' });
  const susCard = await page.textContent('#ferments-body');
  check('card shows the gravity figure (4.69%)', susCard.includes('4.69%'), susCard);
  check('card does not present 19% as the ABV', !/ABV so far19%|Wash ABV19%/.test(susCard.replace(/\s+/g, '')), susCard);
  check('card explains what it ignored', susCard.includes('Ignoring the entered wash ABV of 19%'), susCard);
  check('in-progress wash is labelled "ABV so far"', susCard.includes('ABV so far'));
  check('readings out of date order still sort', susCard.includes('1.093 → 1.057'), susCard);
  const susCompare = await page.textContent('#ferments-compare');
  check('compare table uses the gravity figure too', susCompare.includes('4.69%'));
  await page.click('#ferments-body .ferment-edit');
  await page.waitForSelector('#ferment-modal:not([hidden])');
  const abvNote = await page.textContent('#fm-abv-note');
  check('editor names the rejected value', abvNote.includes('Not using the wash ABV of 19%'), abvNote);
  check('editor gives the gravity figure', abvNote.includes('4.7%'), abvNote);
  check('the typed value is left in the field to correct', await page.inputValue('#fm-wash-abv') === '19');
  await page.click('#ferment-cancel');

  check('no page or console errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  srv.close();

  console.log('\n' + (failures.length ? `FAILED (${failures.length}): ` + failures.join(', ') : 'PASS — all checks green'));
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
