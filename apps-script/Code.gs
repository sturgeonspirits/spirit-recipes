/**
 * Sturgeon Spirits Recipe Book - Apps Script backend.
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
  return sheet;
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

    return jsonOut_({ error: "unknown action " + action });
  } catch (err) {
    return jsonOut_({ error: String(err) });
  }
}
