// Repro: a ferment card that won't move when you add a new reading.
//
// The ferment row carries og/fg (written by the migration, or backfilled the
// first time it was saved). fermentGravities() prefers those stored values over
// the gravity log, so once og/fg are populated every later reading is ignored by
// the card, the compare table and the run's copied figures. Only "Days" and the
// curve keep moving, which is exactly what "the summary is wrong" looks like.
'use strict';
global.window = {};
require('../js/distill.js');
const D = global.window.DISTILL;

// A migrated wash: og/fg stamped from the old run, plus its gravity log.
const ferment = {
  ferment_id: 'ferm_agave', name: 'Revised Agave Wash',
  og: 1.071, fg: 1.030,            // what the row holds
  readings: [
    { reading_date: '08/09/2026', reading_time: '08:00', gravity: 1.071 },
    { reading_date: '08/11/2026', reading_time: '08:00', gravity: 1.030 }
  ]
};

console.log('before adding today\'s reading:');
let g = D.fermentGravities(ferment);
console.log('  card shows OG', g.og, '→ FG', g.fg, '| ABV', D.round(D.fermentABV(ferment), 2));

// Karl logs today's reading — the wash has dropped to 1.004.
ferment.readings.push({ reading_date: '08/14/2026', reading_time: '08:00', gravity: 1.004 });

g = D.fermentGravities(ferment);
const abv = D.fermentABV(ferment);
console.log('after adding today\'s reading (SG 1.004):');
console.log('  card shows OG', g.og, '→ FG', g.fg, '| ABV', D.round(abv, 2));
console.log('  log actually ends at', g.span.fg, 'over', g.span.count, 'readings');

const stale = g.fg !== 1.004;
console.log('\n' + (stale
  ? 'REPRO CONFIRMED — the card still reports FG ' + g.fg + ' and ignores the new reading.'
  : 'no repro — the log is being used.'));
process.exit(stale ? 1 : 0);
