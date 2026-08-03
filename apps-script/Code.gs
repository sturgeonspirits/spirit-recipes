/**
 * Sturgeon Spirits Production Recipe Book - Apps Script backend.
 *
 * This script targets a fixed spreadsheet by ID (SPREADSHEET_ID below), so it
 * always uses the right sheet no matter where the script is deployed from.
 * That spreadsheet must have three tabs:
 *   Recipes      - one row per product (see recipes_seed.csv for columns)
 *   Ingredients  - one row per ingredient line (see ingredients_seed.csv for columns)
 *   changelog    - created automatically the first time something is edited
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment
 *         > type "Web app" > Execute as "Me" > Who has access "Anyone with the link"
 *         Copy the resulting /exec URL into webapp/js/config.js
 *
 * v1.1.0 (2026-07-05): no logic change here (columns are resolved by header
 * name), but the Recipes tab now expects two more optional columns:
 * last_production_date, volume_produced. See CHANGELOG.md.
 *
 * v1.3.0 (2026-07-06): added the Distilling module. Three more tabs are now
 * expected (created automatically the first time they're written to if the
 * headers below match): MashRecipes, MashComponents, DistillationRuns. See
 * README.md > "Distilling module" and CHANGELOG.md.
 *
 * v1.4.0 (2026-07-06): fermentation gravity log + Tilt import. Adds a fourth
 * auto-created tab, GravityReadings; a new `tilt_sheet_url` column on
 * DistillationRuns; the `replace_readings` POST action; and a `?tilt=<url|id>`
 * GET that reads a Tilt Google Sheet server-side (honors a #gid= tab). See
 * CHANGELOG.md.
 *
 * v1.5.0 (2026-07-07): pH tracking in the fermentation log. Adds a `ph` column
 * to the GravityReadings tab (persisted by replace_readings). Existing sheets
 * pick it up automatically — add a `ph` header cell, or let a fresh tab be
 * auto-created with it. See CHANGELOG.md.
 *
 * v1.6.0 (2026-07-07): per-run additions/tweaks. Adds a fifth auto-created tab,
 * RunAdditions (addition_id, run_id, mash_id, item, category, amount, unit,
 * timing, notes); nests additions under each run on `?mash=`/`?mashes=1`; adds
 * the `replace_additions` POST action; and cascade-deletes additions with their
 * run or mash. See CHANGELOG.md.
 *
 * v1.9.0 (2026-07-07): access control. Every read and write now requires a valid
 * session token (AUTH_REQUIRED). Accounts live in a new Users tab (passwords are
 * salted SHA-256 hashes only); `login` returns a token, `logout` revokes it, and
 * tokens live in Script Properties with a 14-day expiry. Bootstrap the first
 * account with SETUP_createUser() from the editor, then redeploy. See README.md.
 *
 * v1.12.0 (2026-07-15): per-ingredient volume model. `replace_ingredients` used
 * to append a hardcoded 6-column row, which silently dropped any extra column;
 * it now builds each row by header name, so the two new optional Ingredients
 * columns — ing_type and volume_contribution — persist. Add those two headers
 * to an existing Ingredients tab and redeploy; without them the app still works,
 * the fields just don't save. See CHANGELOG.md.
 *
 * v1.15.0 (2026-08-02): performance. Saving a recipe was 14 HTTP requests and
 * ~80 Sheets service calls; it's now 2 and ~11. New batched `update_recipe_fields`
 * and `update_mash_fields` actions write a whole row at once and log only the
 * fields that actually changed. Every wholesale replace (ingredients, mash
 * components, gravity readings, run additions) rewrites its tab in three calls
 * instead of one deleteRow/appendRow per row. Spreadsheet and sheet handles are
 * memoized per execution, and `?list=1` returns recipes without their nested
 * ingredients for the home page. Older clients still work — the per-field
 * actions remain. See CHANGELOG.md.
 *
 * v1.16.0 (2026-08-02): ABV provenance. The Recipes tab gains four optional
 * columns — ttb_abv, ttb_abv_source, tested_abv, tested_date — separating the
 * ABV TTB approved (and whether that was on the formula, the label, or both)
 * from the ABV a batch actually gauged at, and from the figure calculated off
 * the ingredients. Add them to the header row; without them the app still
 * works, those fields just don't save. The legacy abv_percent column is no
 * longer read — SETUP_migrateAbvPercent() moves its values into ttb_abv.
 * Reads now also return a computed abv_calc per recipe so the summary cards
 * and the recipe page can't show different numbers. Also adds
 * SETUP_auditBatchSizes(), which compares every stored batch_size against the
 * volume its ingredients model out to (see bottom of this file).
 * See CHANGELOG.md.
 *
 * v1.18.0 (2026-08-02): the volume model gains a "powder" ingredient type at
 * 25% (cocoa, malt, matcha). Mirrors js/abv.js — test/verify_model_parity.js
 * checks the two stay identical. See CHANGELOG.md.
 *
 * v1.19.0 (2026-08-02): ingredients measured by weight (g/kg/lb) now count
 * toward the modelled volume via a per-type mL-per-gram figure — they used to
 * contribute nothing, understating volume and overstating ABV on 17 recipes.
 * Strained solids give up only their juice on that path. "Dried milk" reads as
 * a powder rather than a liquid, and concentrates read as liquids rather than
 * strained fruit. Mirrors js/abv.js. See CHANGELOG.md.
 */

// The one and only database for this webapp. Bind explicitly by ID so the
// backend always reads/writes THIS spreadsheet, regardless of which sheet the
// Apps Script project happens to be container-bound to. This is what keeps the
// project locked to the right sheet.
// https://docs.google.com/spreadsheets/d/1-lAWU_yPq-0wnhYNGZ4jzGXr153KXVcu1TMjpj-W-wA/edit
const SPREADSHEET_ID = "1-lAWU_yPq-0wnhYNGZ4jzGXr153KXVcu1TMjpj-W-wA";

const RECIPES_SHEET = "Recipes";
const INGREDIENTS_SHEET = "Ingredients";
const CHANGELOG_SHEET = "changelog";

// ----- Access control (v1.9.0) -----
// When true, every read and write requires a valid session token obtained via
// the `login` action. Bootstrap the first account by running SETUP_createUser()
// from the Apps Script editor (see bottom of this file), then redeploy.
const AUTH_REQUIRED = true;
const USERS_SHEET = "Users";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // sessions last 14 days

// ----- Distilling module tabs (v1.3.0) -----
const MASH_RECIPES_SHEET = "MashRecipes";
const MASH_COMPONENTS_SHEET = "MashComponents";
const DISTILLATION_RUNS_SHEET = "DistillationRuns";
const GRAVITY_READINGS_SHEET = "GravityReadings"; // v1.4.0
const RUN_ADDITIONS_SHEET = "RunAdditions";       // v1.6.0

// Header rows used when a distilling tab has to be auto-created. Keep in sync
// with data/*_seed.csv. Columns are resolved by name everywhere else, so the
// order here only matters for a freshly auto-created (empty) tab.
const DISTILL_HEADERS = {};
DISTILL_HEADERS[MASH_RECIPES_SHEET] = ["mash_id","name","spirit_type","linked_recipe_id","batch_volume","volume_unit","mash_water_volume","water_unit","strike_temp","mash_ph","target_og","target_fg","yeast_strain","pitch_rate","ferment_temp","ferment_days","target_yield","yield_unit","notes","created_date"];
DISTILL_HEADERS[MASH_COMPONENTS_SHEET] = ["mash_id","component","category","amount","unit","timing","notes"];
DISTILL_HEADERS[DISTILLATION_RUNS_SHEET] = ["run_id","mash_id","run_date","still_used","operator","volume_unit","ferment_og","ferment_fg","wash_abv","wash_volume","foreshots_volume","heads_volume","heads_abv","hearts_volume","hearts_abv","tails_volume","tails_abv","cut_temp_heads","cut_temp_tails","run_duration","barrel_id","barrel_fill_date","entry_proof","char_level","tilt_sheet_url","notes"];
DISTILL_HEADERS[GRAVITY_READINGS_SHEET] = ["reading_id","run_id","mash_id","reading_date","reading_time","gravity","temp","ph","notes"];
DISTILL_HEADERS[RUN_ADDITIONS_SHEET] = ["addition_id","run_id","mash_id","item","category","amount","unit","timing","notes"];
DISTILL_HEADERS[USERS_SHEET] = ["username","salt","password_hash","display_name","active"];

// Handles are memoized for the life of one execution (v1.15.0). Every
// getSheet_ call used to re-open the spreadsheet by id; a single ?mash= read
// touches five tabs, so that was five redundant openById round-trips.
var SS_CACHE_ = null;
var SHEET_CACHE_ = {};

function getSpreadsheet_() {
  if (!SS_CACHE_) SS_CACHE_ = SpreadsheetApp.openById(SPREADSHEET_ID);
  return SS_CACHE_;
}

function getSheet_(name) {
  if (SHEET_CACHE_[name]) return SHEET_CACHE_[name];
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  // Tolerate tab-name casing differences (e.g. "changelog" vs "ChangeLog").
  if (!sheet) {
    sheet = ss.getSheets().find(function (s) {
      return s.getName().toLowerCase() === String(name).toLowerCase();
    }) || null;
  }
  if (!sheet && name === CHANGELOG_SHEET) {
    sheet = ss.insertSheet(CHANGELOG_SHEET);
    sheet.appendRow(["timestamp", "recipe_id", "field", "old_value", "new_value", "source"]);
  }
  // Auto-create the distilling tabs with their header row on first use.
  if (!sheet && DISTILL_HEADERS[name]) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(DISTILL_HEADERS[name]);
  }
  if (sheet) SHEET_CACHE_[name] = sheet;
  return sheet;
}

// Generic: find a row by an id column's value. Mirrors findRowByRecipeId_ but
// takes the id column name explicitly, for the distilling tabs.
function findRowById_(sheet, idValue, idColName) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const col = headers.indexOf(idColName);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][col]) === String(idValue)) return { rowIndex: i + 1, headers: headers, row: values[i] };
  }
  return null;
}

// Generic: append an object as a row, aligning to the sheet's header order.
function appendObject_(sheet, obj) {
  const headers = sheet.getDataRange().getValues()[0];
  sheet.appendRow(headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : ""));
}

// Set many fields on one already-located row in a single write (v1.15.0).
// `found` comes from findRowById_/findRowByRecipeId_. Unchanged values are
// skipped so the changelog stays a record of real edits; if nothing changed,
// no write happens at all.
function applyFields_(sheet, found, idValue, fields, source) {
  const row = found.row.slice();
  const logs = [];
  const unknown = [];
  Object.keys(fields || {}).forEach(function (f) {
    const idx = found.headers.indexOf(f);
    if (idx === -1) { unknown.push(f); return; }
    const oldValue = row[idx];
    const newValue = fields[f];
    if (String(oldValue) === String(newValue)) return; // no-op
    row[idx] = newValue;
    logs.push([new Date(), idValue, f, oldValue, newValue, source]);
  });
  if (logs.length) {
    sheet.getRange(found.rowIndex, 1, 1, row.length).setValues([row]);
    logChanges_(logs);
  }
  return { changed: logs.length, unknown: unknown };
}

// Generic: set a single field on the row identified by idValue/idCol.
function updateField_(sheet, idValue, idCol, field, value) {
  const found = findRowById_(sheet, idValue, idCol);
  if (!found) return { error: "row not found" };
  const colIdx = found.headers.indexOf(field);
  if (colIdx === -1) return { error: "unknown field " + field };
  const oldValue = found.row[colIdx];
  sheet.getRange(found.rowIndex, colIdx + 1).setValue(value);
  return { ok: true, oldValue: oldValue };
}

// Pull a Google Sheets file id out of a full URL, or accept a bare id.
// Handles .../spreadsheets/d/<ID>/edit and a raw id; rejects the /d/e/ publish
// form (which isn't valid for openById).
function extractSheetId_(input) {
  var s = String(input || "").trim();
  var m = s.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s; // looks like a bare id
  return null;
}

// A specific tab's gid from a URL (#gid=123 or &gid=123), or null.
function extractGid_(input) {
  var m = String(input || "").match(/[#&?]gid=(\d+)/);
  return m ? m[1] : null;
}

// Gravity readings for one run, sorted chronologically (date then time).
function nestReadings_(allReadings, runId) {
  return allReadings
    .filter(r => String(r.run_id) === String(runId))
    .sort(function (a, b) {
      const ak = String(a.reading_date) + " " + String(a.reading_time || "");
      const bk = String(b.reading_date) + " " + String(b.reading_time || "");
      return ak.localeCompare(bk);
    });
}

// Run additions/tweaks for one run, in sheet order (the order they were added).
function nestAdditions_(allAdditions, runId) {
  return allAdditions.filter(a => String(a.run_id) === String(runId));
}

// Pad/trim a row to the sheet's header width so setValues never rejects it.
function fitRow_(row, width) {
  const out = row.slice(0, width);
  while (out.length < width) out.push("");
  return out;
}

// Rewrite a whole tab in one shot: drop every row whose idCol matches idValue,
// then append newRows. Three Sheets calls (read, clear, write) regardless of how
// many rows move (v1.15.0).
//
// This replaces the old per-row deleteRow/appendRow loops. Row-at-a-time calls
// are the classic Apps Script bottleneck — each one forces a flush, so a recipe
// with a dozen ingredients cost two dozen round-trips to the Sheets service.
// Rows keep their relative order; replaced rows land at the bottom, exactly as
// the append-based version left them.
function replaceRowsById_(sheet, idValue, idCol, newRows) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { error: "empty sheet" };
  const headers = values[0];
  const width = headers.length;
  const col = headers.indexOf(idCol);
  if (col === -1) return { error: "missing column " + idCol };

  const kept = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(function (c) { return c === "" || c === null; })) continue; // drop blanks
    if (String(row[col]) !== String(idValue)) kept.push(fitRow_(row, width));
  }
  const out = kept.concat((newRows || []).map(function (r) { return fitRow_(r, width); }));

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, width).clearContent();
  if (out.length) sheet.getRange(2, 1, out.length, width).setValues(out);
  return { ok: true, headers: headers, written: out.length };
}

// Generic: delete every row whose idCol matches idValue. Same single-rewrite
// strategy as replaceRowsById_ — no per-row deleteRow.
function deleteRowsById_(sheet, idValue, idCol) {
  return replaceRowsById_(sheet, idValue, idCol, []);
}

// Object-shaped wrapper for replaceRowsById_ (v1.15.0). Reads the header row
// once and aligns every object to it, instead of calling appendObject_ per row
// — which re-read the whole sheet and appended one row at a time, two Sheets
// calls for every reading or component being saved.
function replaceObjectsById_(sheet, idValue, idCol, objs) {
  const headers = sheet.getDataRange().getValues()[0] || [];
  const rows = (objs || []).map(function (obj) {
    return headers.map(function (h) {
      return obj[h] !== undefined && obj[h] !== null ? obj[h] : "";
    });
  });
  return replaceRowsById_(sheet, idValue, idCol, rows);
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 1) return [];
  const headers = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(c => c === "" || c === null)) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = row[idx]; });
    obj._row = i + 1; // 1-based sheet row number, useful for updates
    out.push(obj);
  }
  return out;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ================= Access control (v1.9.0) =================
// Passwords are stored only as salted SHA-256 hashes in the Users tab. Sessions
// are opaque tokens kept in Script Properties with an expiry — nothing sensitive
// leaves the server except the token itself.

function sha256Hex_(s) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return raw.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}
function hashPassword_(salt, pw) { return sha256Hex_(String(salt) + ":" + String(pw)); }

function findUser_(username) {
  const users = sheetToObjects_(getSheet_(USERS_SHEET));
  const uname = String(username || "").trim().toLowerCase();
  return users.find(u => String(u.username).trim().toLowerCase() === uname) || null;
}
function userActive_(user) {
  const a = String(user.active == null ? "yes" : user.active).trim().toLowerCase();
  return a !== "no" && a !== "false" && a !== "0" && a !== "";
}

function createSession_(user) {
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperty(
    "sess_" + token,
    JSON.stringify({ u: user.username, n: user.display_name || user.username, exp: Date.now() + SESSION_TTL_MS })
  );
  return token;
}
function readSession_(token) {
  if (!token) return null;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("sess_" + token);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch (_) { return null; }
  if (!s.exp || Date.now() > s.exp) { props.deleteProperty("sess_" + token); return null; }
  return s;
}
function destroySession_(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty("sess_" + token);
}
function authOK_(data) {
  if (!AUTH_REQUIRED) return true;
  return !!readSession_(data && data.token);
}
function authError_() {
  return jsonOut_({ error: "auth", message: "Your session has expired — please sign in again." });
}

function doGet(e) {
  const params = e.parameter || {};
  try {
    if (!authOK_(params)) return authError_();
    // ----- Tilt hydrometer: read a Tilt Google Sheet by id/URL (v1.4.0) -----
    // The script runs as its owner, so it can open any sheet that owner can see
    // (e.g. the user's own Tilt log) — no sharing or CORS needed on the client.
    if (params.tilt) {
      var tiltId = extractSheetId_(params.tilt);
      if (!tiltId) return jsonOut_({ error: "Couldn't read a spreadsheet id from that link." });
      var tiltSs;
      try {
        tiltSs = SpreadsheetApp.openById(tiltId);
      } catch (openErr) {
        return jsonOut_({ error: "Couldn't open that sheet. Make sure it's the normal Google Sheets link and the same Google account owns it. (" + openErr + ")" });
      }
      // Which tab? If the link points at a specific tab (#gid=...) or names one
      // (&sheet=Name), use that — this is how a workbook with one tab per batch
      // works. Otherwise prefer the Tilt template's "Data" tab, then "Report",
      // then the first tab.
      var tiltSheet = null;
      var gid = extractGid_(params.tilt);
      if (params.sheet) tiltSheet = tiltSs.getSheetByName(params.sheet);
      if (!tiltSheet && gid !== null) {
        tiltSheet = tiltSs.getSheets().filter(function (s) { return String(s.getSheetId()) === String(gid); })[0] || null;
      }
      if (!tiltSheet) tiltSheet = tiltSs.getSheetByName("Data") || tiltSs.getSheetByName("Report") || tiltSs.getSheets()[0];
      var vals = tiltSheet.getDataRange().getValues();
      if (vals.length > 6000) vals = vals.slice(0, 6000); // safety cap
      // Also list the tabs so the client can offer a picker if needed.
      var tabNames = tiltSs.getSheets().map(function (s) { return s.getName(); });
      return jsonOut_({ rows: vals, sheet: tiltSheet.getName(), tabs: tabNames });
    }

    // ----- Distilling reads -----
    if (params.mash) {
      const mashes = sheetToObjects_(getSheet_(MASH_RECIPES_SHEET));
      const mash = mashes.find(m => String(m.mash_id) === String(params.mash));
      if (!mash) return jsonOut_({ error: "mash recipe not found" });
      const components = sheetToObjects_(getSheet_(MASH_COMPONENTS_SHEET));
      const runs = sheetToObjects_(getSheet_(DISTILLATION_RUNS_SHEET));
      const readings = sheetToObjects_(getSheet_(GRAVITY_READINGS_SHEET));
      const additions = sheetToObjects_(getSheet_(RUN_ADDITIONS_SHEET));
      mash.components = components.filter(c => String(c.mash_id) === String(params.mash));
      mash.runs = runs
        .filter(r => String(r.mash_id) === String(params.mash))
        .sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)));
      mash.runs.forEach(r => {
        r.readings = nestReadings_(readings, r.run_id);
        r.additions = nestAdditions_(additions, r.run_id);
      });
      return jsonOut_(mash);
    }
    if (params.mashes) {
      const mashes = sheetToObjects_(getSheet_(MASH_RECIPES_SHEET));
      const components = sheetToObjects_(getSheet_(MASH_COMPONENTS_SHEET));
      const runs = sheetToObjects_(getSheet_(DISTILLATION_RUNS_SHEET));
      const readings = sheetToObjects_(getSheet_(GRAVITY_READINGS_SHEET));
      const additions = sheetToObjects_(getSheet_(RUN_ADDITIONS_SHEET));
      const byId = {};
      mashes.forEach(m => { byId[m.mash_id] = m; m.components = []; m.runs = []; });
      components.forEach(c => { if (byId[c.mash_id]) byId[c.mash_id].components.push(c); });
      runs.forEach(r => {
        if (byId[r.mash_id]) {
          r.readings = nestReadings_(readings, r.run_id);
          r.additions = nestAdditions_(additions, r.run_id);
          byId[r.mash_id].runs.push(r);
        }
      });
      return jsonOut_({ mashes: Object.values(byId) });
    }

    if (params.recipe) {
      const recipes = sheetToObjects_(getSheet_(RECIPES_SHEET));
      const ingredients = sheetToObjects_(getSheet_(INGREDIENTS_SHEET));
      const recipe = recipes.find(r => String(r.recipe_id) === String(params.recipe));
      if (!recipe) return jsonOut_({ error: "recipe not found" });
      recipe.ingredients = ingredients.filter(i => String(i.recipe_id) === String(params.recipe));
      return jsonOut_(recipe);
    }
    // Recipe list without ingredients (v1.15.0). The home page renders from
    // recipe fields only (it uses has_detailed_recipe, never the ingredient
    // rows), so the default read was shipping every ingredient in the book —
    // thousands of rows — to draw a list of cards.
    if (params.list) {
      const rows = sheetToObjects_(getSheet_(RECIPES_SHEET));
      const ings = sheetToObjects_(getSheet_(INGREDIENTS_SHEET));
      attachCalcABV_(rows, ings);
      rows.forEach(r => { r.ingredients = []; });
      return jsonOut_({ recipes: rows });
    }

    // default: everything, nested
    const recipes = sheetToObjects_(getSheet_(RECIPES_SHEET));
    const ingredients = sheetToObjects_(getSheet_(INGREDIENTS_SHEET));
    const byId = {};
    recipes.forEach(r => { byId[r.recipe_id] = r; r.ingredients = []; });
    ingredients.forEach(i => {
      if (byId[i.recipe_id]) byId[i.recipe_id].ingredients.push(i);
    });
    return jsonOut_({ recipes: Object.values(byId) });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

function logChange_(recipeId, field, oldValue, newValue, source) {
  logChanges_([[new Date(), recipeId, field, oldValue, newValue, source || "webapp"]]);
}

// Append many changelog rows in a single write (v1.15.0). A batched save used to
// append one row per field, 13 separate calls for one press of Save.
function logChanges_(rows) {
  if (!rows || !rows.length) return;
  const sheet = getSheet_(CHANGELOG_SHEET);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function findRowByRecipeId_(sheet, recipeId, idColName) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const col = headers.indexOf(idColName);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][col]) === String(recipeId)) return { rowIndex: i + 1, headers: headers, row: values[i] };
  }
  return null;
}

/**
 * POST body (text/plain containing JSON, to dodge CORS preflight) shapes:
 *
 * { action: "update_recipe_field", recipe_id, field, value }
 * { action: "update_ingredient", recipe_id, ingredient_name, field, value }
 * { action: "replace_ingredients", recipe_id, ingredients: [{name, amount, unit, is_alcohol, abv_percent, ing_type, volume_contribution}, ...] }
 * { action: "add_recipe", recipe: {...} }
 * { action: "delete_recipe", recipe_id }
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    // ---- Auth actions (no token needed to log in) ----
    if (action === "login") {
      const user = findUser_(body.username);
      if (!user || !userActive_(user) || hashPassword_(user.salt, body.password) !== String(user.password_hash)) {
        return jsonOut_({ error: "Invalid username or password." });
      }
      const token = createSession_(user);
      return jsonOut_({ ok: true, token: token, display_name: user.display_name || user.username });
    }

    // Everything past here requires a valid session.
    if (!authOK_(body)) return authError_();

    if (action === "logout") {
      destroySession_(body.token);
      return jsonOut_({ ok: true });
    }

    if (action === "update_recipe_field") {
      const sheet = getSheet_(RECIPES_SHEET);
      const found = findRowByRecipeId_(sheet, body.recipe_id, "recipe_id");
      if (!found) return jsonOut_({ error: "recipe not found" });
      const colIdx = found.headers.indexOf(body.field);
      if (colIdx === -1) return jsonOut_({ error: "unknown field " + body.field });
      const oldValue = found.row[colIdx];
      sheet.getRange(found.rowIndex, colIdx + 1).setValue(body.value);
      logChange_(body.recipe_id, body.field, oldValue, body.value, "update_recipe_field");
      return jsonOut_({ ok: true });
    }

    // Batched sibling of update_recipe_field (v1.15.0). The webapp's Save button
    // sets 13 fields; one request per field meant 13 sheet reads, 13 single-cell
    // writes and 13 changelog appends. This does one read, one row write and one
    // changelog write, and skips fields whose value hasn't actually changed —
    // so the changelog records edits instead of every press of Save.
    if (action === "update_recipe_fields") {
      const sheet = getSheet_(RECIPES_SHEET);
      const found = findRowByRecipeId_(sheet, body.recipe_id, "recipe_id");
      if (!found) return jsonOut_({ error: "recipe not found" });
      const res = applyFields_(sheet, found, body.recipe_id, body.fields, "update_recipe_fields");
      return jsonOut_({ ok: true, updated: res.changed, unknown_fields: res.unknown });
    }

    if (action === "replace_ingredients") {
      const sheet = getSheet_(INGREDIENTS_SHEET);
      const headers = sheet.getDataRange().getValues()[0];
      // Rows are built by header name so optional columns (ing_type,
      // volume_contribution) persist when the sheet has them.
      const colValue = {
        recipe_id: function () { return body.recipe_id; },
        ingredient_name: function (ing) { return ing.name; },
        name: function (ing) { return ing.name; },
        amount: function (ing) { return ing.amount; },
        unit: function (ing) { return ing.unit; },
        is_alcohol: function (ing) { return ing.is_alcohol ? "yes" : "no"; },
        abv_percent: function (ing) { return ing.abv_percent || ""; },
        ing_type: function (ing) { return ing.ing_type || ""; },
        volume_contribution: function (ing) {
          return (ing.volume_contribution === 0 || ing.volume_contribution) ? ing.volume_contribution : "";
        }
      };
      const rows = (body.ingredients || []).map(ing =>
        headers.map(h => colValue[h] ? colValue[h](ing) : ""));
      const res = replaceRowsById_(sheet, body.recipe_id, "recipe_id", rows);
      if (res.error) return jsonOut_({ error: res.error });
      logChange_(body.recipe_id, "ingredients", "", JSON.stringify(body.ingredients), "replace_ingredients");
      return jsonOut_({ ok: true });
    }

    if (action === "add_recipe") {
      const sheet = getSheet_(RECIPES_SHEET);
      const headers = sheet.getDataRange().getValues()[0];
      const row = headers.map(h => body.recipe[h] !== undefined ? body.recipe[h] : "");
      sheet.appendRow(row);
      logChange_(body.recipe.recipe_id, "*new recipe*", "", JSON.stringify(body.recipe), "add_recipe");
      return jsonOut_({ ok: true });
    }

    if (action === "delete_recipe") {
      const recipesSheet = getSheet_(RECIPES_SHEET);
      const found = findRowByRecipeId_(recipesSheet, body.recipe_id, "recipe_id");
      if (!found) return jsonOut_({ error: "recipe not found" });
      // capture the recipe row for the changelog before deleting
      const oldRecipe = {};
      found.headers.forEach((h, idx) => { oldRecipe[h] = found.row[idx]; });
      // remove the recipe's ingredient rows first (bottom-up)
      const ingSheet = getSheet_(INGREDIENTS_SHEET);
      const ingValues = ingSheet.getDataRange().getValues();
      const ingIdCol = ingValues[0].indexOf("recipe_id");
      for (let i = ingValues.length - 1; i >= 1; i--) {
        if (String(ingValues[i][ingIdCol]) === String(body.recipe_id)) {
          ingSheet.deleteRow(i + 1);
        }
      }
      // remove the recipe row itself
      recipesSheet.deleteRow(found.rowIndex);
      logChange_(body.recipe_id, "*delete recipe*", JSON.stringify(oldRecipe), "", "delete_recipe");
      return jsonOut_({ ok: true });
    }

    // ============ Distilling module actions (v1.3.0) ============

    if (action === "add_mash") {
      const sheet = getSheet_(MASH_RECIPES_SHEET);
      appendObject_(sheet, body.mash);
      logChange_(body.mash.mash_id, "*new mash*", "", JSON.stringify(body.mash), "add_mash");
      return jsonOut_({ ok: true });
    }

    if (action === "update_mash_field") {
      const sheet = getSheet_(MASH_RECIPES_SHEET);
      const res = updateField_(sheet, body.mash_id, "mash_id", body.field, body.value);
      if (res.error) return jsonOut_({ error: res.error });
      logChange_(body.mash_id, body.field, res.oldValue, body.value, "update_mash_field");
      return jsonOut_({ ok: true });
    }

    // Batched sibling of update_mash_field (v1.15.0) — see update_recipe_fields.
    if (action === "update_mash_fields") {
      const sheet = getSheet_(MASH_RECIPES_SHEET);
      const found = findRowById_(sheet, body.mash_id, "mash_id");
      if (!found) return jsonOut_({ error: "mash recipe not found" });
      const res = applyFields_(sheet, found, body.mash_id, body.fields, "update_mash_fields");
      return jsonOut_({ ok: true, updated: res.changed, unknown_fields: res.unknown });
    }

    if (action === "replace_mash_components") {
      const sheet = getSheet_(MASH_COMPONENTS_SHEET);
      replaceObjectsById_(sheet, body.mash_id, "mash_id", (body.components || []).map(c => ({
        mash_id: body.mash_id, component: c.component, category: c.category,
        amount: c.amount, unit: c.unit, timing: c.timing, notes: c.notes
      })));
      logChange_(body.mash_id, "components", "", JSON.stringify(body.components), "replace_mash_components");
      return jsonOut_({ ok: true });
    }

    if (action === "delete_mash") {
      const sheet = getSheet_(MASH_RECIPES_SHEET);
      const found = findRowById_(sheet, body.mash_id, "mash_id");
      if (!found) return jsonOut_({ error: "mash recipe not found" });
      const old = {};
      found.headers.forEach((h, idx) => { old[h] = found.row[idx]; });
      deleteRowsById_(getSheet_(MASH_COMPONENTS_SHEET), body.mash_id, "mash_id");
      deleteRowsById_(getSheet_(DISTILLATION_RUNS_SHEET), body.mash_id, "mash_id");
      deleteRowsById_(getSheet_(GRAVITY_READINGS_SHEET), body.mash_id, "mash_id");
      deleteRowsById_(getSheet_(RUN_ADDITIONS_SHEET), body.mash_id, "mash_id");
      sheet.deleteRow(found.rowIndex);
      logChange_(body.mash_id, "*delete mash*", JSON.stringify(old), "", "delete_mash");
      return jsonOut_({ ok: true });
    }

    if (action === "add_run") {
      const sheet = getSheet_(DISTILLATION_RUNS_SHEET);
      appendObject_(sheet, body.run);
      logChange_(body.run.mash_id, "*new run* " + body.run.run_id, "", JSON.stringify(body.run), "add_run");
      return jsonOut_({ ok: true });
    }

    if (action === "update_run") {
      // Replace an entire run row by run_id (simplest given many fields).
      const sheet = getSheet_(DISTILLATION_RUNS_SHEET);
      const found = findRowById_(sheet, body.run.run_id, "run_id");
      if (!found) return jsonOut_({ error: "run not found" });
      const newRow = found.headers.map(h => body.run[h] !== undefined && body.run[h] !== null ? body.run[h] : "");
      sheet.getRange(found.rowIndex, 1, 1, newRow.length).setValues([newRow]);
      logChange_(body.run.mash_id, "*update run* " + body.run.run_id, "", JSON.stringify(body.run), "update_run");
      return jsonOut_({ ok: true });
    }

    if (action === "delete_run") {
      const sheet = getSheet_(DISTILLATION_RUNS_SHEET);
      deleteRowsById_(sheet, body.run_id, "run_id");
      deleteRowsById_(getSheet_(GRAVITY_READINGS_SHEET), body.run_id, "run_id");
      deleteRowsById_(getSheet_(RUN_ADDITIONS_SHEET), body.run_id, "run_id");
      logChange_(body.mash_id || "", "*delete run* " + body.run_id, "", "", "delete_run");
      return jsonOut_({ ok: true });
    }

    if (action === "replace_readings") {
      // Wholesale replace a run's fermentation gravity log (like ingredients).
      const sheet = getSheet_(GRAVITY_READINGS_SHEET);
      replaceObjectsById_(sheet, body.run_id, "run_id", (body.readings || []).map(function (rd, i) {
        return {
          reading_id: rd.reading_id || (body.run_id + "_r" + (i + 1)),
          run_id: body.run_id, mash_id: body.mash_id,
          reading_date: rd.reading_date, reading_time: rd.reading_time,
          gravity: rd.gravity, temp: rd.temp, ph: rd.ph, notes: rd.notes
        };
      }));
      logChange_(body.mash_id || "", "readings " + body.run_id, "", JSON.stringify(body.readings), "replace_readings");
      return jsonOut_({ ok: true });
    }

    if (action === "replace_additions") {
      // Wholesale replace a run's additions/tweaks list (like readings).
      const sheet = getSheet_(RUN_ADDITIONS_SHEET);
      replaceObjectsById_(sheet, body.run_id, "run_id", (body.additions || []).map(function (ad, i) {
        return {
          addition_id: ad.addition_id || (body.run_id + "_a" + (i + 1)),
          run_id: body.run_id, mash_id: body.mash_id,
          item: ad.item, category: ad.category, amount: ad.amount,
          unit: ad.unit, timing: ad.timing, notes: ad.notes
        };
      }));
      logChange_(body.mash_id || "", "additions " + body.run_id, "", JSON.stringify(body.additions), "replace_additions");
      return jsonOut_({ ok: true });
    }

    return jsonOut_({ error: "unknown action " + action });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}

// Diagnostic: dump exactly what the cleanup sees, so a "would clear 0" result
// can be traced to the data rather than guessed at. Logs the Recipes header row
// and every distinct batch_size / batch_unit combination with its JS type —
// text-formatted numbers, unit spellings other than "mL", and a missing
// has_detailed_recipe flag all show up here.
function SETUP_diagnoseBatchSizes() {
  const sheet = getSheet_(RECIPES_SHEET);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const cSize = headers.indexOf("batch_size");
  const cUnit = headers.indexOf("batch_unit");
  const cDetail = headers.indexOf("has_detailed_recipe");
  const out = ["Recipes headers: " + headers.join(" | "),
    "rows: " + (values.length - 1),
    "batch_size col: " + cSize + "   batch_unit col: " + cUnit + "   has_detailed_recipe col: " + cDetail];

  const combos = {}, units = {}, detail = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const size = cSize === -1 ? "" : row[cSize];
    const unit = cUnit === -1 ? "" : row[cUnit];
    const det = cDetail === -1 ? "(no column)" : row[cDetail];
    const key = JSON.stringify(size) + " [" + (typeof size) + "]  +  " + JSON.stringify(unit);
    combos[key] = (combos[key] || 0) + 1;
    units[JSON.stringify(unit)] = (units[JSON.stringify(unit)] || 0) + 1;
    detail[JSON.stringify(det)] = (detail[JSON.stringify(det)] || 0) + 1;
  }
  out.push("\n-- distinct batch_unit values --");
  Object.keys(units).forEach(k => out.push("   " + k + "  x" + units[k]));
  out.push("\n-- distinct has_detailed_recipe values --");
  Object.keys(detail).forEach(k => out.push("   " + k + "  x" + detail[k]));
  out.push("\n-- distinct batch_size + unit combinations --");
  Object.keys(combos).sort(function (a, b) { return combos[b] - combos[a]; })
    .slice(0, 40).forEach(k => out.push("   " + k + "  x" + combos[k]));
  out.push("\n-- batch sizes that disagree with their ingredients --");
  out.push("   flagged: " + auditBatchSizes_(true).length +
    " (run SETUP_auditBatchSizes for the detail)");
  Logger.log(out.join("\n"));
  return out.join("\n");
}

// ============ One-time migration: abv_percent -> ttb_abv ============
// The legacy `abv_percent` column holds the ABV TTB approved for the product —
// transcribed from an approved formula or an approved label, which is why the
// values are clean declared figures (40.0, 35.0, 12.5) and why six of them read
// "abt 20", straight off the label. It's authoritative data, so it's migrated
// rather than discarded.
//
// The source is inferred from which approval the recipe actually has: a COLA id
// means label, a formula number alone means formula, both means both. Anything
// ambiguous is left blank for you to set by hand.
//
// SETUP_reportAbvMigration() — preview, changes nothing
// SETUP_migrateAbvPercent()  — writes ttb_abv / ttb_abv_source, logs each one
function SETUP_reportAbvMigration() { return migrateAbvPercent_(true); }
function SETUP_migrateAbvPercent() { return migrateAbvPercent_(false); }

function migrateAbvPercent_(dryRun) {
  const sheet = getSheet_(RECIPES_SHEET);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const width = headers.length;
  const cId = headers.indexOf("recipe_id");
  const cName = headers.indexOf("name");
  const cOld = headers.indexOf("abv_percent");
  const cNew = headers.indexOf("ttb_abv");
  const cSrc = headers.indexOf("ttb_abv_source");
  const cCola = headers.indexOf("ttb_label_cola_id");
  const cFormula = headers.indexOf("ttb_formula_number");
  if (cOld === -1) throw new Error("No abv_percent column found — nothing to migrate.");
  if (cNew === -1 || cSrc === -1) {
    throw new Error("Add the ttb_abv and ttb_abv_source columns to the Recipes header row first.");
  }

  const report = [], logs = [], rows = [], skipped = [];
  for (let i = 1; i < values.length; i++) {
    const row = fitRow_(values[i], width);
    rows.push(row);
    const raw = String(row[cOld] == null ? "" : row[cOld]).trim();
    if (!raw) continue;
    if (String(row[cNew]).trim() !== "") continue; // already migrated — never overwrite

    // "abt 20", "abt 20%", "20% ALC/VOL" -> 20
    const m = raw.match(/(\d+(?:\.\d+)?)/);
    if (!m) { skipped.push((cName === -1 ? row[cId] : row[cName]) + " — couldn't read a number from " + JSON.stringify(raw)); continue; }
    const val = Number(m[1]);

    const hasCola = cCola !== -1 && String(row[cCola]).trim() !== "";
    const hasFormula = cFormula !== -1 && String(row[cFormula]).trim() !== "";
    const src = hasCola && hasFormula ? "both" : hasCola ? "label" : hasFormula ? "formula" : "";

    report.push((cName === -1 ? row[cId] : row[cName]) + "  |  " + raw + " -> " + val +
      "  |  source: " + (src || "(unknown — set by hand)"));
    if (!dryRun) {
      logs.push([new Date(), row[cId], "ttb_abv", "", val, "migrate_abv_percent"]);
      row[cNew] = val;
      row[cSrc] = src;
    }
  }
  if (!dryRun && logs.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    logChanges_(logs);
  }
  Logger.log((dryRun ? "DRY RUN — would migrate " : "Migrated ") + report.length +
    " values into ttb_abv:\n" + report.join("\n") +
    (skipped.length ? "\n\nSKIPPED (unreadable):\n" + skipped.join("\n") : ""));
  return report;
}

// ---- Volume model, kept in step with js/abv.js ----
// Deliberate duplication: the browser needs it to draw Live ABV and the backend
// needs it to audit stored batch sizes. If you change a factor or a regex here,
// change it in js/abv.js too — test/verify_model_parity.js checks the two agree
// across 3000 generated recipes and fails the moment they drift.
var ML_PER_UNIT_ = {
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  l: 1000, liter: 1000, liters: 1000,
  cup: 236.588, cups: 236.588,
  tbsp: 14.7868, tbs: 14.7868, tablespoon: 14.7868, tablespoons: 14.7868,
  tsp: 4.92892, teaspoon: 4.92892, teaspoons: 4.92892,
  oz: 29.5735, "fl oz": 29.5735,
  gal: 3785.41, gallon: 3785.41, gallons: 3785.41,
  qt: 946.353, quart: 946.353, quarts: 946.353,
  pt: 473.176, pint: 473.176, pints: 473.176,
  parts: 1
};
var ING_FACTORS_ = { liquid: 1, sugar: 0.53, fruit: 0.55, powder: 0.25, botanical: 0.05 };
// g/cm3 of the solid itself, for ingredients measured by weight rather than
// volume. Mass / density is the volume displaced — no bulk-density guesswork.
var ING_ML_PER_G_ = { liquid: 1.00, sugar: 0.63, fruit: 0.60, powder: 0.71, botanical: 0.02 };
var G_PER_UNIT_ = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  "oz wt": 28.3495, ozwt: 28.3495, "wt oz": 28.3495,
  lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592
};
var LIQUID_RE_ = /juice|concentrate|pur[eé]e|nectar|syrup|water|milk|cream|wine|beer|cider|vodka|rum\b|whisk|bourbon|brandy|\bgin\b|tequila|liqueur|spirit|alcohol|extract|glycerin/i;
var BOTANICAL_RE_ = /zest|peel|spice|cinnamon|clove|vanilla|anise|ginger|pepper|herb|\btea\b|coffee|nib|juniper|coriander|cardamom|nutmeg|allspice|bark|root|seed|leaf|leaves|flower|hibiscus|lavender|chamomile|wormwood|hops?\b/i;
var SUGAR_RE_ = /sugar|sweetener/i;
var POWDER_RE_ = /cocoa|cacao|chocolate|powder|malt\b|matcha|\bcorn ?starch|caseinate|citrate/i;
var DRY_FORM_RE_ = /\b(dried|dry|powdered|instant|non-?fat|nonfat|no-?fat|skim(med)?)\b[^,]*\b(milk|cream|buttermilk|whey)\b|\b(milk|cream|buttermilk|whey)\b[^,]*\bpowder\b/i;
var FRUIT_RE_ = /cherr|berr|fruit|orange|lemon|lime|grape|apple|peach|plum|apricot|mango|pineapple|banana|melon|pear|\bfig|date|raisin|currant|rhubarb/i;

function toGrams_(amount, unit) {
  const f = G_PER_UNIT_[String(unit || "").trim().toLowerCase()];
  if (f === undefined) return null;
  const n = Number(String(amount).replace(/,/g, "").trim());
  return isNaN(n) ? null : n * f;
}
// Volume this ingredient contributes, whether it was measured by volume or
// weighed. Mirrors contributionML in js/abv.js.
function contributionML_(ing) {
  const v = toML_(ing.amount, ing.unit);
  if (v !== null) return v * contributionOf_(ing);
  const g = toGrams_(ing.amount, ing.unit);
  if (g === null) return null;
  const t = ing.ing_type && ING_ML_PER_G_[ing.ing_type] !== undefined
    ? ing.ing_type : guessType_(ing.ingredient_name || ing.name);
  return g * (ING_ML_PER_G_[t] != null ? ING_ML_PER_G_[t] : 1);
}

function toML_(amount, unit) {
  const f = ML_PER_UNIT_[String(unit || "").trim().toLowerCase()];
  if (f === undefined) return null;
  const n = Number(String(amount).replace(/,/g, "").trim());
  return isNaN(n) ? null : n * f;
}
function guessType_(name) {
  const n = String(name || "");
  if (!n) return "liquid";
  if (DRY_FORM_RE_.test(n)) return "powder";
  if (LIQUID_RE_.test(n)) return "liquid";
  if (BOTANICAL_RE_.test(n)) return "botanical";
  if (POWDER_RE_.test(n)) return "powder";
  if (SUGAR_RE_.test(n)) return "sugar";
  if (FRUIT_RE_.test(n)) return "fruit";
  return "liquid";
}
function contributionOf_(ing) {
  const explicit = ing.volume_contribution;
  if (explicit !== "" && explicit != null && !isNaN(Number(explicit))) {
    return Math.max(0, Number(explicit)) / 100;
  }
  const t = ing.ing_type && ING_FACTORS_[ing.ing_type] !== undefined
    ? ing.ing_type : guessType_(ing.ingredient_name || ing.name);
  return ING_FACTORS_[t];
}
function isAlcohol_(ing) {
  const v = String(ing.is_alcohol).trim().toLowerCase();
  return v === "yes" || v === "true" || v === "y" || v === "1";
}
// Stamp a computed ABV onto each recipe so the summary cards show the same
// number the recipe page does (v1.17.0). The list read strips nested ingredients
// for speed, so the card can't work this out client-side — and the legacy
// hand-typed `abv_percent` column it used to read was frozen at whatever someone
// entered, drifting from the recipe underneath it.
//
// Same precedence as computeABV in js/abv.js: a declared batch size wins,
// otherwise the modeled finished volume is used.
function attachCalcABV_(recipes, ingredientRows) {
  const byRecipe = {};
  (ingredientRows || []).forEach(function (i) {
    (byRecipe[i.recipe_id] = byRecipe[i.recipe_id] || []).push(i);
  });
  recipes.forEach(function (r) {
    const m = byRecipe[r.recipe_id] ? modelRecipe_(byRecipe[r.recipe_id]) : null;
    if (!m || !m.volML) { r.abv_calc = ""; return; }
    const declaredML = toML_(r.batch_size, r.batch_unit);
    const totalML = declaredML || m.volML;
    r.abv_calc = Math.round((m.alcML / totalML) * 1000) / 10;
  });
}

// Modeled finished volume and pure-ethanol volume for one recipe's ingredients.
function modelRecipe_(rows) {
  let volML = 0, alcML = 0, any = false;
  rows.forEach(function (ing) {
    const v = contributionML_(ing);
    if (v === null) return;
    any = true;
    volML += v;
    if (isAlcohol_(ing)) alcML += v * ((Number(ing.abv_percent) || 0) / 100);
  });
  return any ? { volML: volML, alcML: alcML } : null;
}

// ---- Audit stored batch sizes against the ingredient model ----
// The real defect isn't a particular number, it's a batch_size that doesn't
// describe the finished batch — most often because it holds the volume of the
// base spirit, which makes Live ABV divide the alcohol by itself and report the
// spirit's own ABV. This compares every declared batch size to the modeled
// finished volume and lists the ones that disagree.
//
// SETUP_auditBatchSizes()      — report only, changes nothing
// SETUP_clearBadBatchSizes()   — clear the ones flagged, logged to changelog
var BATCH_TOLERANCE_ = 0.10; // 10% — wider than rounding, narrower than a real error

function SETUP_auditBatchSizes() { return auditBatchSizes_(true); }
function SETUP_clearBadBatchSizes() { return auditBatchSizes_(false); }

function auditBatchSizes_(dryRun) {
  const sheet = getSheet_(RECIPES_SHEET);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const width = headers.length;
  const cId = headers.indexOf("recipe_id");
  const cName = headers.indexOf("name");
  const cSize = headers.indexOf("batch_size");
  const cUnit = headers.indexOf("batch_unit");

  // Group ingredients by recipe in one pass.
  const ingRows = sheetToObjects_(getSheet_(INGREDIENTS_SHEET));
  const byRecipe = {};
  ingRows.forEach(function (i) {
    (byRecipe[i.recipe_id] = byRecipe[i.recipe_id] || []).push(i);
  });

  const report = [], logs = [], rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = fitRow_(values[i], width);
    rows.push(row);
    const id = row[cId];
    const declaredML = toML_(row[cSize], row[cUnit]);
    const m = byRecipe[id] ? modelRecipe_(byRecipe[id]) : null;
    if (!declaredML || !m || !m.volML) continue; // nothing to compare

    const off = Math.abs(declaredML - m.volML) / m.volML;
    if (off <= BATCH_TOLERANCE_) continue;

    const liveABV = (m.alcML / declaredML) * 100;
    const modelABV = (m.alcML / m.volML) * 100;
    report.push([
      (cName === -1 ? id : row[cName]),
      "declared " + Math.round(declaredML) + " mL",
      "modeled " + Math.round(m.volML) + " mL",
      "off " + (off * 100).toFixed(0) + "%",
      "live " + liveABV.toFixed(1) + "% vs model " + modelABV.toFixed(1) + "%"
    ].join("  |  "));
    if (!dryRun) {
      logs.push([new Date(), id, "batch_size", row[cSize], "", "clear_bad_batch_size"]);
      row[cSize] = "";
    }
  }
  if (!dryRun && logs.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    logChanges_(logs);
  }
  Logger.log((dryRun ? "AUDIT — " : "CLEARED — ") + report.length +
    " recipes whose batch size disagrees with their ingredients by more than " +
    (BATCH_TOLERANCE_ * 100) + "%:\n" + report.join("\n"));
  return report;
}

// ================= Account setup (run from the editor) =================
// The web app can't create the first account (login requires an existing user),
// so bootstrap accounts here. YOU TYPE THE PASSWORD IN THIS FUNCTION — never in
// the Users sheet. The sheet only ever stores a salted hash.
//
// HOW TO USE:
//   1. Edit the values in the createUserAccount_(username, password, name) line
//      below. Password goes in the MIDDLE quotes.
//   2. In the editor toolbar, set the function dropdown to SETUP_createUser and
//      click Run (authorize the first time).
//   3. Check the Users tab — a row with salt + password_hash should appear.
//   4. Delete the password you typed (put a placeholder back) and Save, so no
//      plaintext is left in the code.
//
// ADDING MORE PEOPLE — two options:
//   A) Change the one line to the next person and Run again (repeat per person).
//   B) Add a line per person and Run once, e.g.:
//         createUserAccount_("karl", "KarlsPass1!", "Karl");
//         createUserAccount_("sam",  "SamsPass2!",  "Sam");
//         createUserAccount_("jo",   "JosPass3!",   "Jo");
//
// Running with a username that already exists RESETS that person's password
// (no duplicate row) — so this is also how you change a password.
// To disable someone instead, set their `active` cell to "no" in the Users tab.
function SETUP_createUser() {
  createUserAccount_("karl", "CHANGE-ME-NOW", "Karl");
  // Add more createUserAccount_(...) lines here if you want to create several at once.
}

// Add or reset a user. Passwords are never stored — only a salted SHA-256 hash.
function createUserAccount_(username, password, displayName) {
  if (!username || !password) throw new Error("username and password are required");
  const sheet = getSheet_(USERS_SHEET);
  const salt = Utilities.getUuid().replace(/-/g, "");
  const hash = hashPassword_(salt, password);
  const existing = findUser_(username);
  if (existing) {
    updateField_(sheet, existing.username, "username", "salt", salt);
    updateField_(sheet, existing.username, "username", "password_hash", hash);
    if (displayName) updateField_(sheet, existing.username, "username", "display_name", displayName);
    updateField_(sheet, existing.username, "username", "active", "yes");
  } else {
    appendObject_(sheet, {
      username: String(username).trim(), salt: salt, password_hash: hash,
      display_name: displayName || username, active: "yes"
    });
  }
  return "ok: " + username;
}

// Revoke everyone's sessions (e.g. after removing a user). Forces re-login.
function SETUP_clearAllSessions() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) { if (k.indexOf("sess_") === 0) props.deleteProperty(k); });
  return "cleared";
}
