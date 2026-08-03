// Guards the deliberate duplication of the volume model between js/abv.js (used
// by the browser to draw Live ABV) and apps-script/Code.gs (used by the batch
// size audit). If the two ever disagree the audit would flag healthy recipes,
// or miss broken ones. Run: node test/verify_model_parity.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..");

global.window = {};
require(path.join(root, "js/abv.js"));
const ABV = global.window.ABV;

// Load Code.gs's helpers without its Apps Script dependencies.
const ctx = { console, Date, JSON, String, Number, Object, Array, Math, isNaN, Error,
  SpreadsheetApp: {}, ContentService: {}, Utilities: {}, PropertiesService: {}, Logger: { log() {} } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "apps-script/Code.gs"), "utf8"), ctx);

const NAMES = ["Vodka","Fresh Orange Juice","Brown Sugar","Cinnamon Sticks","Cherries","Orange Peel",
  "Apple Cider","Everclear","Honey Syrup","Lemon Zest","Raspberries","Water","Coffee Beans",
  "Vanilla Bean","Heavy Cream","Cocoa Powder","Chocolate Syrup","Malt Powder","Blue Curacao","Mango Puree","Sweetener","Rhubarb","Neutral Spirit"];
const UNITS = ["mL","L","cups","tbsp","tsp","oz","gal","qt","pt","parts","g","kg","lb","oz wt","each"];
const TYPES = ["", "liquid", "sugar", "fruit", "powder", "botanical"];

// Deterministic pseudo-random so a failure is reproducible.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];

let checked = 0, bad = 0;
for (let t = 0; t < 3000; t++) {
  const n = 1 + Math.floor(rnd() * 6);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const alc = rnd() < 0.3;
    rows.push({
      ingredient_name: pick(NAMES), name: undefined,
      amount: Math.round(rnd() * 5000) / 10,
      unit: pick(UNITS),
      is_alcohol: alc ? "yes" : "no",
      abv_percent: alc ? Math.round(rnd() * 95) : "",
      ing_type: pick(TYPES),
      volume_contribution: rnd() < 0.15 ? Math.round(rnd() * 100) : ""
    });
  }
  // abv.js reads .name; Code.gs reads .ingredient_name || .name
  const jsRecipe = { ingredients: rows.map(r => ({ ...r, name: r.ingredient_name })) };
  const a = { vol: ABV.estimateFinalVolumeML(jsRecipe), abv: ABV.computeModeledABV(jsRecipe) };
  const g = ctx.modelRecipe_(rows);
  checked++;

  const gVol = g ? g.volML : null;
  const gAbv = g && g.volML ? (g.alcML / g.volML) * 100 : null;
  const near = (x, y) => (x === null && y === null) ||
    (x !== null && y !== null && Math.abs(x - y) <= Math.max(1e-9, Math.abs(x) * 1e-12));
  if (!near(a.vol, gVol) || !near(a.abv, gAbv)) {
    bad++;
    if (bad <= 3) {
      console.error("MISMATCH on", JSON.stringify(rows));
      console.error("  abv.js  vol=" + a.vol + " abv=" + a.abv);
      console.error("  Code.gs vol=" + gVol + " abv=" + gAbv);
    }
  }
}
console.log(`checked ${checked} random recipes — ${bad} mismatches`);
if (bad) { console.error("FAIL: the two volume models have drifted apart."); process.exit(1); }
console.log("PASS: js/abv.js and apps-script/Code.gs model recipes identically.");
