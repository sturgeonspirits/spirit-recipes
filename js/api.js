// Thin wrapper around the Apps Script API (Google Sheet backend).
// v1.15.0 (2026-08-02): batched updateRecipeFields/updateMashFields (with a
// fallback to the per-field path if the backend hasn't been redeployed), and
// getAllRecipes uses the lightweight ?list=1 read.
// v1.9.0 (2026-07-07): sends the session token with every request, handles
// expired-session responses, and adds login/logout. v1.6.0: added
// replaceAdditions. v1.4.0: added replaceReadings. v1.3.0: distilling methods.
// Full history: CHANGELOG.md
window.API = (function () {
  const url = window.CONFIG.API_URL;
  const demoMode = !url; // true only if no API_URL is configured

  function requireUrl() {
    if (!url) throw new Error("No API_URL configured in js/config.js — set the Apps Script /exec URL to load data.");
  }

  // Append the current session token to a GET url.
  function withAuth(u) {
    const t = window.AUTH && window.AUTH.token;
    if (!t) return u;
    return u + (u.indexOf("?") === -1 ? "?" : "&") + "token=" + encodeURIComponent(t);
  }

  // If the backend says our session is gone, drop it and bounce to login.
  function guardAuth(data) {
    if (data && data.error === "auth") {
      if (window.AUTH) {
        window.AUTH.clearSession();
        if (!/login\.html$/i.test(location.pathname)) window.AUTH.toLogin();
      }
      throw new Error(data.message || "Please sign in.");
    }
    return data;
  }

  async function getJSON(u) {
    requireUrl();
    const res = await fetch(withAuth(u));
    return guardAuth(await res.json());
  }

  async function post(payload) {
    requireUrl();
    if (window.AUTH && window.AUTH.token) payload = Object.assign({ token: window.AUTH.token }, payload);
    // text/plain avoids a CORS preflight against Apps Script
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    return guardAuth(await res.json());
  }

  // ----- Auth -----
  async function login(username, password, remember) {
    requireUrl();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "login", username: username, password: password })
    });
    const data = await res.json();
    if (data && data.ok && data.token && window.AUTH) {
      window.AUTH.set({ token: data.token, display_name: data.display_name }, !!remember);
    }
    return data;
  }
  async function logout() {
    if (!url || !(window.AUTH && window.AUTH.token)) return { ok: true };
    return post({ action: "logout" });
  }

  // A backend older than v1.15.0 answers unknown actions with an error rather
  // than failing loudly, so batched writes fall back to the one-at-a-time path
  // instead of breaking if the Apps Script deployment hasn't been updated yet.
  function isUnknownAction(res) {
    return !!(res && res.error && /unknown action/i.test(String(res.error)));
  }

  async function getAllRecipes(withIngredients) {
    // ?list=1 skips the nested ingredient rows — the recipe list doesn't read
    // them, and they dominate the payload.
    const data = await getJSON(withIngredients ? url : url + "?list=1");
    return data.recipes || [];
  }

  async function getRecipe(id) {
    return getJSON(url + "?recipe=" + encodeURIComponent(id));
  }

  async function updateRecipeField(recipeId, field, value) {
    return post({ action: "update_recipe_field", recipe_id: recipeId, field, value });
  }

  // Write every changed field in one request instead of one request per field.
  async function updateRecipeFields(recipeId, fields) {
    const res = await post({ action: "update_recipe_fields", recipe_id: recipeId, fields });
    if (!isUnknownAction(res)) return res;
    for (const [field, value] of Object.entries(fields)) {
      await updateRecipeField(recipeId, field, value);
    }
    return { ok: true, fallback: true };
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
    const data = await getJSON(url + "?mashes=1");
    return data.mashes || [];
  }
  async function getMash(mashId) {
    return getJSON(url + "?mash=" + encodeURIComponent(mashId));
  }
  async function addMash(mash) {
    return post({ action: "add_mash", mash });
  }
  async function updateMashField(mashId, field, value) {
    return post({ action: "update_mash_field", mash_id: mashId, field, value });
  }
  async function updateMashFields(mashId, fields) {
    const res = await post({ action: "update_mash_fields", mash_id: mashId, fields });
    if (!isUnknownAction(res)) return res;
    for (const [field, value] of Object.entries(fields)) {
      await updateMashField(mashId, field, value);
    }
    return { ok: true, fallback: true };
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
  async function replaceAdditions(runId, mashId, additions) {
    return post({ action: "replace_additions", run_id: runId, mash_id: mashId, additions });
  }
  async function getTiltSheet(urlOrId) {
    return getJSON(url + "?tilt=" + encodeURIComponent(urlOrId));
  }

  return {
    demoMode, login, logout,
    getAllRecipes, getRecipe, updateRecipeField, updateRecipeFields, replaceIngredients, addRecipe, deleteRecipe,
    getAllMashes, getMash, addMash, updateMashField, updateMashFields, replaceMashComponents, deleteMash,
    addRun, updateRun, deleteRun, replaceReadings, replaceAdditions, getTiltSheet
  };
})();
