// Thin wrapper around the Apps Script API, with a read-only local-demo fallback.
window.API = (function () {
  const url = window.CONFIG.API_URL;
  const demoMode = !url;

  let demoCache = null;
  async function loadDemo() {
    if (demoCache) return demoCache;
    const res = await fetch("./data/seed.json");
    demoCache = await res.json();
    return demoCache;
  }

  async function getAllRecipes() {
    if (demoMode) {
      const recipes = await loadDemo();
      return recipes;
    }
    const res = await fetch(url);
    const data = await res.json();
    return data.recipes || [];
  }

  async function getRecipe(id) {
    if (demoMode) {
      const recipes = await loadDemo();
      return recipes.find(r => String(r.recipe_id) === String(id));
    }
    const res = await fetch(url + "?recipe=" + encodeURIComponent(id));
    return res.json();
  }

  async function post(payload) {
    if (demoMode) {
      throw new Error("Demo mode: connect an Apps Script URL in js/config.js to enable saving.");
    }
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

  return { demoMode, getAllRecipes, getRecipe, updateRecipeField, replaceIngredients, addRecipe };
})();
