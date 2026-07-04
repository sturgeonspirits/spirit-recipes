(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const banner = document.getElementById("demo-banner");
  if (window.API.demoMode) banner.style.display = "block";

  if (!id) {
    document.getElementById("recipe-title").textContent = "No recipe id given";
    return;
  }

  let recipe;
  try {
    recipe = await window.API.getRecipe(id);
  } catch (err) {
    document.getElementById("recipe-title").textContent = "Failed to load: " + err.message;
    return;
  }
  if (!recipe || recipe.error) {
    document.getElementById("recipe-title").textContent = "Recipe not found";
    return;
  }
  recipe.ingredients = (recipe.ingredients || []).map(i => ({
    ...i,
    is_alcohol: i.is_alcohol === true || i.is_alcohol === "yes" || i.is_alcohol === "TRUE"
  }));

  document.getElementById("recipe-title").textContent = recipe.name;
  document.getElementById("f-category").textContent = recipe.category || "";
  document.getElementById("f-batch-size").value = recipe.batch_size || "";
  document.getElementById("f-batch-unit").value = recipe.batch_unit || "";
  document.getElementById("f-notes").value = recipe.notes || "";
  document.getElementById("f-formula-num").value = recipe.ttb_formula_number || "";
  document.getElementById("f-formula-status").value = recipe.ttb_formula_status || "";
  document.getElementById("f-formula-submitted").value = recipe.ttb_formula_submitted || "";
  document.getElementById("f-formula-approved").value = recipe.ttb_formula_approved || "";
  document.getElementById("f-label-id").value = recipe.ttb_label_cola_id || "";
  document.getElementById("f-label-status").value = recipe.ttb_label_status || "";
  document.getElementById("f-label-date").value = recipe.ttb_label_date || "";

  const tbody = document.getElementById("ingredients-body");

  function renderIngredients() {
    tbody.innerHTML = "";
    recipe.ingredients.forEach((ing, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="text" data-f="name" style="width:100%"></td>
        <td><input type="number" step="any" data-f="amount" style="width:90px"></td>
        <td><input type="text" data-f="unit" style="width:70px"></td>
        <td style="text-align:center"><input type="checkbox" data-f="is_alcohol"></td>
        <td><input type="number" step="any" data-f="abv_percent" style="width:70px"></td>
        <td class="row-actions"><button data-action="remove">✕</button></td>
      `;
      tr.querySelector('[data-f="name"]').value = ing.name || "";
      tr.querySelector('[data-f="amount"]').value = ing.amount ?? "";
      tr.querySelector('[data-f="unit"]').value = ing.unit || "";
      tr.querySelector('[data-f="is_alcohol"]').checked = !!ing.is_alcohol;
      tr.querySelector('[data-f="abv_percent"]').value = ing.abv_percent || "";

      tr.querySelectorAll("input").forEach(input => {
        input.addEventListener("input", () => {
          const f = input.dataset.f;
          let v = input.value;
          if (f === "amount" || f === "abv_percent") v = v === "" ? "" : Number(v);
          if (f === "is_alcohol") v = input.checked;
          recipe.ingredients[idx][f] = v;
          updateABV();
        });
      });
      tr.querySelector('[data-action="remove"]').addEventListener("click", () => {
        recipe.ingredients.splice(idx, 1);
        renderIngredients();
        updateABV();
      });
      tbody.appendChild(tr);
    });
  }

  function updateABV() {
    recipe.batch_size = Number(document.getElementById("f-batch-size").value) || recipe.batch_size;
    recipe.batch_unit = document.getElementById("f-batch-unit").value || recipe.batch_unit;
    const abv = window.ABV.computeABV(recipe);
    const el = document.getElementById("abv-live");
    el.textContent = (abv === null || isNaN(abv)) ? "—" : abv.toFixed(2) + "%";
    document.getElementById("abv-warning").textContent = recipe._targetAbvWarning || "";
  }

  document.getElementById("f-batch-size").addEventListener("input", updateABV);
  document.getElementById("f-batch-unit").addEventListener("input", updateABV);

  document.getElementById("add-ingredient").addEventListener("click", () => {
    recipe.ingredients.push({ name: "", amount: "", unit: "", is_alcohol: false, abv_percent: "" });
    renderIngredients();
  });

  document.getElementById("scale-apply").addEventListener("click", () => {
    const size = Number(document.getElementById("scale-size").value);
    const unit = document.getElementById("scale-unit").value || recipe.batch_unit;
    if (!size) { alert("Enter a new batch size first."); return; }
    try {
      const scaled = window.ABV.scaleToBatchSize(recipe, size, unit);
      recipe.batch_size = scaled.batch_size;
      recipe.batch_unit = scaled.batch_unit;
      recipe.ingredients = scaled.ingredients;
      document.getElementById("f-batch-size").value = recipe.batch_size;
      document.getElementById("f-batch-unit").value = recipe.batch_unit;
      renderIngredients();
      updateABV();
    } catch (err) { alert(err.message); }
  });

  document.getElementById("target-apply").addEventListener("click", () => {
    const target = Number(document.getElementById("target-abv").value);
    if (!target) { alert("Enter a target ABV first."); return; }
    try {
      const solved = window.ABV.solveForTargetABV(recipe, target);
      recipe.ingredients = solved.ingredients;
      recipe._targetAbvWarning = solved._targetAbvWarning || "";
      renderIngredients();
      updateABV();
    } catch (err) { alert(err.message); }
  });

  document.getElementById("save-btn").addEventListener("click", async () => {
    const fields = {
      notes: document.getElementById("f-notes").value,
      batch_size: document.getElementById("f-batch-size").value,
      batch_unit: document.getElementById("f-batch-unit").value,
      ttb_formula_number: document.getElementById("f-formula-num").value,
      ttb_formula_status: document.getElementById("f-formula-status").value,
      ttb_formula_submitted: document.getElementById("f-formula-submitted").value,
      ttb_formula_approved: document.getElementById("f-formula-approved").value,
      ttb_label_cola_id: document.getElementById("f-label-id").value,
      ttb_label_status: document.getElementById("f-label-status").value,
      ttb_label_date: document.getElementById("f-label-date").value,
    };
    try {
      for (const [field, value] of Object.entries(fields)) {
        await window.API.updateRecipeField(recipe.recipe_id, field, value);
      }
      await window.API.replaceIngredients(recipe.recipe_id, recipe.ingredients);
      showToast("Saved.");
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById("export-pdf").addEventListener("click", () => window.EXPORT.printPDF());
  document.getElementById("export-word").addEventListener("click", () => window.EXPORT.exportWord(recipe, window.ABV.computeABV(recipe)));
  document.getElementById("export-csv").addEventListener("click", () => window.EXPORT.exportRecipeCSV(recipe));

  function showToast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  renderIngredients();
  updateABV();
})();
