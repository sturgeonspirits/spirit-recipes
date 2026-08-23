// v1.22.0 (2026-08-23): "+ New recipe" — name + category, then into the editor.
// v1.16.0 (2026-08-02): card ABV badge reads ttb_abv + backend-computed abv_calc. Full history: CHANGELOG.md
(async function () {
  const listEl = document.getElementById("recipe-rows");
  const search = document.getElementById("search");
  const categoryFilter = document.getElementById("category-filter");
  const ttbFilter = document.getElementById("ttb-filter");
  const countEl = document.getElementById("result-count");
  const banner = document.getElementById("demo-banner");
  const exportAllBtn = document.getElementById("export-all");
  const ingredientsToggle = document.getElementById("ingredients-toggle");
  const noIngredientsToggle = document.getElementById("no-ingredients-toggle");
  const newBtn = document.getElementById("new-recipe");
  const newModal = document.getElementById("new-recipe-modal");
  const newName = document.getElementById("new-recipe-name");
  const newCategory = document.getElementById("new-recipe-category");
  const newError = document.getElementById("new-recipe-error");
  const newCreate = document.getElementById("new-recipe-create");
  const categoryOptions = document.getElementById("category-options");

  if (window.API.demoMode) {
    banner.style.display = "block";
  }

  let recipes = [];
  try {
    recipes = await window.API.getAllRecipes();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load recipes: ${escapeHTML(err.message)}</div>`;
    return;
  }

  const categories = Array.from(new Set(recipes.map(r => r.category).filter(Boolean))).sort();
  categories.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c;
    categoryFilter.appendChild(opt);
    const dOpt = document.createElement("option");
    dOpt.value = c;
    categoryOptions.appendChild(dOpt);
  });

  function num(v) {
    if (v === "" || v === undefined || v === null || isNaN(v)) return null;
    return Number(v);
  }

  // Shows both numbers when they disagree, one when they don't (or when only
  // one exists). The TTB-approved figure is the headline — it's what the product
  // is approved to be — with the calculated figure alongside it so a recipe that
  // has drifted away from its approval is visible from the list without opening
  // it. `abv_calc` is computed by the backend, because the list read drops the
  // nested ingredients the browser would need to work it out.
  function abvBadge(r) {
    const label = num(r.ttb_abv);
    const calc = num(r.abv_calc);
    if (label === null && calc === null) return "";
    if (label === null) return `<span class="abv-badge calc-only">${calc.toFixed(1)}%<span class="abv-tag">calc</span></span>`;
    if (calc === null) return `<span class="abv-badge">${label.toFixed(1)}%</span>`;
    // Agreeing within the labeling tolerance isn't worth two numbers.
    if (Math.abs(label - calc) <= 0.3) return `<span class="abv-badge">${label.toFixed(1)}%</span>`;
    return `<span class="abv-badge split">${label.toFixed(1)}%<span class="abv-tag">calc ${calc.toFixed(1)}%</span></span>`;
  }

  function ttbStatusClass(status) {
    if (!status) return "";
    const s = String(status).toLowerCase();
    if (s.includes("approved")) return "approved";
    if (s.includes("reject")) return "rejected";
    if (s.includes("correction")) return "needs-correction";
    return "";
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const cat = categoryFilter.value;
    const ttb = ttbFilter.value;
    const onlyWithIngredients = ingredientsToggle.checked;
    const onlyWithoutIngredients = noIngredientsToggle.checked;

    const filtered = recipes.filter(r => {
      if (onlyWithIngredients && r.has_detailed_recipe !== "yes") return false;
      if (onlyWithoutIngredients && r.has_detailed_recipe === "yes") return false;
      if (cat && r.category !== cat) return false;
      if (q && !(String(r.name).toLowerCase().includes(q) || String(r.notes || "").toLowerCase().includes(q))) return false;
      if (ttb === "has_formula" && !r.ttb_formula_number) return false;
      if (ttb === "no_formula" && r.ttb_formula_number) return false;
      if (ttb === "has_label" && !r.ttb_label_cola_id) return false;
      if (ttb === "detailed" && r.has_detailed_recipe !== "yes") return false;
      return true;
    });

    countEl.textContent = `${filtered.length} of ${recipes.length} recipes`;

    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-state">No recipes match. Try clearing the search or filters.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(r => {
      const abv = abvBadge(r);
      const formula = r.ttb_formula_number
        ? `<span>Formula ${escapeHTML(r.ttb_formula_number)} <span class="ttb-status ${ttbStatusClass(r.ttb_formula_status)}">${escapeHTML(r.ttb_formula_status || "")}</span></span>` : "";
      const label = r.ttb_label_cola_id
        ? `<span>Label ${escapeHTML(r.ttb_label_cola_id)} <span class="ttb-status ${ttbStatusClass(r.ttb_label_status)}">${escapeHTML(r.ttb_label_status || "")}</span></span>` : "";
      const date = (r.ttb_label_date || r.ttb_formula_approved)
        ? `<span>Approved ${escapeHTML(r.ttb_label_date || r.ttb_formula_approved)}</span>` : "";
      const noDetail = r.has_detailed_recipe === "yes" ? "" : `<span class="tag-empty">no ingredients yet</span>`;
      const production = r.last_production_date
        ? `<span>Last produced ${escapeHTML(r.last_production_date)}${r.volume_produced ? " · " + escapeHTML(String(r.volume_produced)) + (r.batch_unit ? " " + escapeHTML(r.batch_unit) : "") : ""}</span>` : "";
      const ttbRow = (formula || label || date || production)
        ? `<div class="ttb-row">${formula}${label}${date}${production}</div>` : "";

      return `<a class="recipe-card" href="recipe.html?id=${encodeURIComponent(r.recipe_id)}">
        <div class="name"><span>${escapeHTML(r.name)}</span>${abv}</div>
        <div class="meta-row">
          ${r.category ? `<span class="category-pill">${escapeHTML(r.category)}</span>` : ""}
          ${noDetail}
        </div>
        ${ttbRow}
      </a>`;
    }).join("");
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ----- New recipe -----
  // recipe_id follows the convention already in the sheet: category slug,
  // then name slug, no timestamp — bitters_lemon, cans_fat_golfer. Readable
  // ids are worth the collision check, which the loaded list can do for free.
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function makeRecipeId(name, category) {
    const base = [slugify(category), slugify(name)].filter(Boolean).join("_") || "recipe";
    const taken = new Set(recipes.map(r => String(r.recipe_id)));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(base + "_" + n)) n++;
    return base + "_" + n;
  }

  function openNewModal() {
    if (window.API.demoMode) { alert("Demo mode — configure the API URL to add recipes."); return; }
    newName.value = "";
    newCategory.value = categoryFilter.value || "";  // carry the active filter through
    newError.hidden = true;
    newModal.hidden = false;
    newName.focus();
  }

  function closeNewModal() {
    newModal.hidden = true;
  }

  async function createRecipe() {
    const name = newName.value.trim();
    const category = newCategory.value.trim();
    if (!name) {
      newError.textContent = "Give the recipe a name first.";
      newError.hidden = false;
      newName.focus();
      return;
    }
    // A duplicate name isn't fatal — the id is made unique either way — but it
    // is nearly always a second copy of something that already exists.
    const clash = recipes.find(r => String(r.name).trim().toLowerCase() === name.toLowerCase());
    if (clash && !confirm('"' + clash.name + '" already exists. Create a second recipe with that name?')) return;

    newCreate.disabled = true;
    newCreate.textContent = "Creating…";
    try {
      const recipeId = makeRecipeId(name, category);
      const res = await window.API.addRecipe({
        recipe_id: recipeId,
        name: name,
        category: category,
        has_detailed_recipe: "no"
      });
      if (res && res.error) throw new Error(res.error);
      location.href = "recipe.html?id=" + encodeURIComponent(recipeId);
    } catch (err) {
      newError.textContent = "Could not create: " + err.message;
      newError.hidden = false;
      newCreate.disabled = false;
      newCreate.textContent = "Create recipe";
    }
  }

  newBtn.addEventListener("click", openNewModal);
  document.getElementById("new-recipe-close").addEventListener("click", closeNewModal);
  document.getElementById("new-recipe-cancel").addEventListener("click", closeNewModal);
  newCreate.addEventListener("click", createRecipe);
  // Tapping the dimmed backdrop closes it; tapping inside the card must not.
  newModal.addEventListener("click", e => { if (e.target === newModal) closeNewModal(); });
  newModal.addEventListener("keydown", e => {
    if (e.key === "Escape") closeNewModal();
    if (e.key === "Enter" && !newCreate.disabled) { e.preventDefault(); createRecipe(); }
  });

  search.addEventListener("input", render);
  categoryFilter.addEventListener("change", render);
  ttbFilter.addEventListener("change", render);
  ingredientsToggle.addEventListener("change", () => {
    if (ingredientsToggle.checked) noIngredientsToggle.checked = false;
    render();
  });
  noIngredientsToggle.addEventListener("change", () => {
    if (noIngredientsToggle.checked) ingredientsToggle.checked = false;
    render();
  });
  exportAllBtn.addEventListener("click", () => window.EXPORT.exportAllCSV(recipes));

  render();
})();
