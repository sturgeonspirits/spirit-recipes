// Thin wrapper around the Apps Script API (Google Sheet backend).
// v1.4.0 (2026-07-06): added replaceReadings (gravity log). v1.3.0: distilling methods. Full history: CHANGELOG.md
window.API = (function () {
  const url = window.CONFIG.API_URL;
  const demoMode = !url; // true only if no API_URL is configured

  function requireUrl() {
    if (!url) throw new Error("No API_URL configured in js/config.js — set the Apps Script /exec URL to load data.");
  }

  async function getAllRecipes() {
    requireUrl();
    const res = await fetch(url);
    const data = await res.json();
    return data.recipes || [];
  }

  async function getRecipe(id) {
    requireUrl();
    const res = await fetch(url + "?recipe=" + encodeURIComponent(id));
    return res.json();
  }

  async function post(payload) {
    requireUrl();
    // text/plain avoids a CORS preflight against Apps Script
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    return res.json();
  }

  async function updateRecipeField(recipeId, field, value) {
    return post({ action: "update_recipe_field", recipe_id: recipeId, field, value });
  }

  async function replaceIngredients(recipeId, ingredients) {
    return post({ action: "replace_ingredients", recipe_id: recipeId, ingredients });
  }

  async function addRecipe(recipe) {
    return post({ action: "add_recipe", recipe });
  }

  async function deleteRecipe(recipeId) {
    return post({ action: "delete_recipe", recipe_id: recipeId });
  }

  // ----- Distilling module (v1.3.0) -----
  async function getAllMashes() {
    requireUrl();
    const res = await fetch(url + "?mashes=1");
    const data = await res.json();
    return data.mashes || [];
  }
  async function getMash(mashId) {
    requireUrl();
    const res = await fetch(url + "?mash=" + encodeURIComponent(mashId));
    return res.json();
  }
  async function addMash(mash) {
    return post({ action: "add_mash", mash });
  }
  async function updateMashField(mashId, field, value) {
    return post({ action: "update_mash_field", mash_id: mashId, field, value });
  }
  async function replaceMashComponents(mashId, components) {
    return post({ action: "replace_mash_components", mash_id: mashId, components });
  }
  async function deleteMash(mashId) {
    return post({ action: "delete_mash", mash_id: mashId });
  }
  async function addRun(run) {
    return post({ action: "add_run", run });
  }
  async function updateRun(run) {
    return post({ action: "update_run", run });
  }
  async function deleteRun(runId, mashId) {
    return post({ action: "delete_run", run_id: runId, mash_id: mashId });
  }
  async function replaceReadings(runId, mashId, readings) {
    return post({ action: "replace_readings", run_id: runId, mash_id: mashId, readings });
  }
  async function getTiltSheet(urlOrId) {
    requireUrl();
    const res = await fetch(url + "?tilt=" + encodeURIComponent(urlOrId));
    return res.json();
  }

  return {
    demoMode, getAllRecipes, getRecipe, updateRecipeField, replaceIngredients, addRecipe, deleteRecipe,
    getAllMashes, getMash, addMash, updateMashField, replaceMashComponents, deleteMash,
    addRun, updateRun, deleteRun, replaceReadings
  };
})();
