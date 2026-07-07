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

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getSheet_(name) {
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

// Generic: delete every row whose idCol matches idValue (bottom-up).
function deleteRowsById_(sheet, idValue, idCol) {
  const values = sheet.getDataRange().getValues();
  const col = values[0].indexOf(idCol);
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][col]) === String(idValue)) sheet.deleteRow(i + 1);
  }
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

function doGet(e) {
  const params = e.parameter || {};
  try {
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
  const sheet = getSheet_(CHANGELOG_SHEET);
  sheet.appendRow([new Date(), recipeId, field, oldValue, newValue, source || "webapp"]);
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
 * { action: "replace_ingredients", recipe_id, ingredients: [{name, amount, unit, is_alcohol, abv_percent}, ...] }
 * { action: "add_recipe", recipe: {...} }
 * { action: "delete_recipe", recipe_id }
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

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

    if (action === "replace_ingredients") {
      const sheet = getSheet_(INGREDIENTS_SHEET);
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      const idCol = headers.indexOf("recipe_id");
      // remove existing rows for this recipe (bottom-up so row numbers stay valid)
      for (let i = values.length - 1; i >= 1; i--) {
        if (String(values[i][idCol]) === String(body.recipe_id)) {
          sheet.deleteRow(i + 1);
        }
      }
      // append fresh rows
      (body.ingredients || []).forEach(ing => {
        sheet.appendRow([
          body.recipe_id, ing.name, ing.amount, ing.unit,
          ing.is_alcohol ? "yes" : "no", ing.abv_percent || ""
        ]);
      });
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

    if (action === "replace_mash_components") {
      const sheet = getSheet_(MASH_COMPONENTS_SHEET);
      deleteRowsById_(sheet, body.mash_id, "mash_id");
      (body.components || []).forEach(c => {
        appendObject_(sheet, {
          mash_id: body.mash_id, component: c.component, category: c.category,
          amount: c.amount, unit: c.unit, timing: c.timing, notes: c.notes
        });
      });
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
      deleteRowsById_(sheet, body.run_id, "run_id");
      (body.readings || []).forEach(function (rd, i) {
        appendObject_(sheet, {
          reading_id: rd.reading_id || (body.run_id + "_r" + (i + 1)),
          run_id: body.run_id, mash_id: body.mash_id,
          reading_date: rd.reading_date, reading_time: rd.reading_time,
          gravity: rd.gravity, temp: rd.temp, ph: rd.ph, notes: rd.notes
        });
      });
      logChange_(body.mash_id || "", "readings " + body.run_id, "", JSON.stringify(body.readings), "replace_readings");
      return jsonOut_({ ok: true });
    }

    if (action === "replace_additions") {
      // Wholesale replace a run's additions/tweaks list (like readings).
      const sheet = getSheet_(RUN_ADDITIONS_SHEET);
      deleteRowsById_(sheet, body.run_id, "run_id");
      (body.additions || []).forEach(function (ad, i) {
        appendObject_(sheet, {
          addition_id: ad.addition_id || (body.run_id + "_a" + (i + 1)),
          run_id: body.run_id, mash_id: body.mash_id,
          item: ad.item, category: ad.category, amount: ad.amount,
          unit: ad.unit, timing: ad.timing, notes: ad.notes
        });
      });
      logChange_(body.mash_id || "", "additions " + body.run_id, "", JSON.stringify(body.additions), "replace_additions");
      return jsonOut_({ ok: true });
    }

    return jsonOut_({ error: "unknown action " + action });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}
