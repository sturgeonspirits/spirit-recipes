// v1.1.0 (2026-07-05): show last-produced date/volume on recipe cards. Full history: CHANGELOG.md
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
  });

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
      const abv = (r.abv_percent !== "" && r.abv_percent !== undefined && r.abv_percent !== null && !isNaN(r.abv_percent))
        ? `<span class="abv-badge">${Number(r.abv_percent).toFixed(1)}%</span>` : "";
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
