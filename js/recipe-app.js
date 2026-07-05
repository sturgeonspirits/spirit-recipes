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
    name: i.name || i.ingredient_name || "",
    is_alcohol: i.is_alcohol === true || i.is_alcohol === "yes" || i.is_alcohol === "TRUE"
  }));

  document.getElementById("recipe-title").textContent = recipe.name;
  document.title = recipe.name + " — Sturgeon Spirits";
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

  const listEl = document.getElementById("ingredients-body");

  function renderIngredients() {
    listEl.innerHTML = "";
    if (!recipe.ingredients.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.textAlign = "center";
      empty.style.padding = "10px 0";
      empty.textContent = "No ingredients yet — add the first one below.";
      listEl.appendChild(empty);
    }
    recipe.ingredients.forEach((ing, idx) => {
      const card = document.createElement("div");
      card.className = "ing-card";
      card.innerHTML = `
        <div class="ing-name">
          <input type="text" data-f="name" placeholder="Ingredient name" aria-label="Ingredient name">
          <button class="btn-remove" data-action="remove" aria-label="Remove ingredient">✕</button>
        </div>
        <div class="mini"><label>Amount</label>
          <input type="number" step="any" inputmode="decimal" data-f="amount"></div>
        <div class="mini"><label>Unit</label>
          <input type="text" data-f="unit" placeholder="mL, oz…"></div>
        <div class="mini ing-abv-field"><label>ABV %</label>
          <input type="number" step="any" inputmode="decimal" data-f="abv_percent"></div>
        <label class="alc-toggle"><input type="checkbox" data-f="is_alcohol"><span class="dot"></span>Alcohol</label>
      `;
      card.querySelector('[data-f="name"]').value = ing.name || "";
      card.querySelector('[data-f="amount"]').value = ing.amount ?? "";
      card.querySelector('[data-f="unit"]').value = ing.unit || "";
      card.querySelector('[data-f="is_alcohol"]').checked = !!ing.is_alcohol;
      card.querySelector('[data-f="abv_percent"]').value = ing.abv_percent || "";

      const abvField = card.querySelector(".ing-abv-field");
      function syncAbvField() {
        abvField.classList.toggle("disabled", !recipe.ingredients[idx].is_alcohol);
      }
      syncAbvField();

      card.querySelectorAll("input").forEach(input => {
        const evt = input.type === "checkbox" ? "change" : "input";
        input.addEventListener(evt, () => {
          const f = input.dataset.f;
          let v = input.value;
          if (f === "amount" || f === "abv_percent") v = v === "" ? "" : Number(v);
          if (f === "is_alcohol") v = input.checked;
          recipe.ingredients[idx][f] = v;
          if (f === "is_alcohol") syncAbvField();
          updateABV();
        });
      });
      card.querySelector('[data-action="remove"]').addEventListener("click", () => {
        recipe.ingredients.splice(idx, 1);
        renderIngredients();
        updateABV();
      });
      listEl.appendChild(card);
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
    // focus the new ingredient's name field
    const inputs = listEl.querySelectorAll('[data-f="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
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
      showToast("Batch scaled — press Save to keep it.");
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
      showToast("Solved — press Save to keep it.");
    } catch (err) { alert(err.message); }
  });

  const saveBtn = document.getElementById("save-btn");
  saveBtn.addEventListener("click", async () => {
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
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      for (const [field, value] of Object.entries(fields)) {
        await window.API.updateRecipeField(recipe.recipe_id, field, value);
      }
      await window.API.replaceIngredients(recipe.recipe_id, recipe.ingredients);
      showToast("Saved ✓");
    } catch (err) {
      showToast(err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save changes";
    }
  });

  const exportMenu = document.getElementById("export-menu");
  function closeMenu() { exportMenu.removeAttribute("open"); }
  document.getElementById("export-pdf").addEventListener("click", () => { closeMenu(); window.EXPORT.printPDF(); });
  document.getElementById("export-word").addEventListener("click", () => { closeMenu(); window.EXPORT.exportWord(recipe, window.ABV.computeABV(recipe)); });
  document.getElementById("export-csv").addEventListener("click", () => { closeMenu(); window.EXPORT.exportRecipeCSV(recipe); });
  document.addEventListener("click", (e) => {
    if (exportMenu.hasAttribute("open") && !exportMenu.contains(e.target)) closeMenu();
  });

  function showToast(msg) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  renderIngredients();
  updateABV();
})();
