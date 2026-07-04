(async function () {
  const tbody = document.getElementById("recipe-rows");
  const search = document.getElementById("search");
  const categoryFilter = document.getElementById("category-filter");
  const ttbFilter = document.getElementById("ttb-filter");
  const countEl = document.getElementById("result-count");
  const banner = document.getElementById("demo-banner");
  const exportAllBtn = document.getElementById("export-all");

  if (window.API.demoMode) {
    banner.style.display = "block";
  }

  let recipes = [];
  try {
    recipes = await window.API.getAllRecipes();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6">Could not load recipes: ${err.message}</td></tr>`;
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

    const filtered = recipes.filter(r => {
      if (cat && r.category !== cat) return false;
      if (q && !(String(r.name).toLowerCase().includes(q) || String(r.notes || "").toLowerCase().includes(q))) return false;
      if (ttb === "has_formula" && !r.ttb_formula_number) return false;
      if (ttb === "no_formula" && r.ttb_formula_number) return false;
      if (ttb === "has_label" && !r.ttb_label_cola_id) return false;
      if (ttb === "detailed" && r.has_detailed_recipe !== "yes") return false;
      return true;
    });

    countEl.textContent = `${filtered.length} of ${recipes.length} recipes`;

    tbody.innerHTML = filtered.map(r => {
      const abv = (r.abv_percent !== "" && r.abv_percent !== undefined && r.abv_percent !== null && !isNaN(r.abv_percent))
        ? `<span class="abv-badge">${Number(r.abv_percent).toFixed(1)}%</span>` : "";
      return `<tr>
        <td><a class="recipe-link" href="recipe.html?id=${encodeURIComponent(r.recipe_id)}">${escapeHTML(r.name)}</a>
            ${r.has_detailed_recipe === "yes" ? "" : '<div class="muted">no ingredient detail yet</div>'}</td>
        <td><span class="category-pill">${escapeHTML(r.category || "")}</span></td>
        <td>${abv}</td>
        <td>${escapeHTML(r.ttb_formula_number || "")} <span class="ttb-status ${ttbStatusClass(r.ttb_formula_status)}">${escapeHTML(r.ttb_formula_status || "")}</span></td>
        <td>${escapeHTML(r.ttb_label_cola_id || "")} <span class="ttb-status ${ttbStatusClass(r.ttb_label_status)}">${escapeHTML(r.ttb_label_status || "")}</span></td>
        <td>${escapeHTML(r.ttb_label_date || r.ttb_formula_approved || "")}</td>
      </tr>`;
    }).join("");
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  search.addEventListener("input", render);
  categoryFilter.addEventListener("change", render);
  ttbFilter.addEventListener("change", render);
  exportAllBtn.addEventListener("click", () => window.EXPORT.exportAllCSV(recipes));

  render();
})();
