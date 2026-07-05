// Thin wrapper around the Apps Script API (Google Sheet backend).
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

  return { demoMode, getAllRecipes, getRecipe, updateRecipeField, replaceIngredients, addRecipe, deleteRecipe };
})();
