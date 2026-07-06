// v1.2.0 (2026-07-06): added Make mode (read-only production view w/ scaler + check-off). Full history: CHANGELOG.md
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
  const nameField = document.getElementById("f-name");
  nameField.value = recipe.name || "";
  nameField.addEventListener("input", () => {
    const v = nameField.value.trim() || "Recipe";
    document.getElementById("recipe-title").textContent = v;
    document.title = v + " — Sturgeon Spirits";
  });
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
  document.getElementById("f-last-production-date").value = recipe.last_production_date || "";
  document.getElementById("f-volume-produced").value = recipe.volume_produced || "";

  function syncVolumeUnitHint() {
    const unit = document.getElementById("f-batch-unit").value || recipe.batch_unit || "";
    document.getElementById("volume-unit-hint").textContent = unit ? `(${unit})` : "";
  }
  syncVolumeUnitHint();
  document.getElementById("f-batch-unit").addEventListener("input", syncVolumeUnitHint);

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
      name: document.getElementById("f-name").value,
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
      last_production_date: document.getElementById("f-last-production-date").value,
      volume_produced: document.getElementById("f-volume-produced").value,
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

  // Delete recipe — requires a secondary confirmation before firing.
  const deleteBtn = document.getElementById("delete-recipe");
  const deleteConfirm = document.getElementById("delete-confirm");
  const deleteCancel = document.getElementById("delete-cancel");
  const deleteYes = document.getElementById("delete-confirm-yes");
  document.getElementById("delete-recipe-name").textContent = recipe.name || "this recipe";

  deleteBtn.addEventListener("click", () => {
    deleteBtn.style.display = "none";
    deleteConfirm.style.display = "block";
  });
  deleteCancel.addEventListener("click", () => {
    deleteConfirm.style.display = "none";
    deleteBtn.style.display = "";
  });
  deleteYes.addEventListener("click", async () => {
    deleteYes.disabled = true;
    deleteCancel.disabled = true;
    deleteYes.textContent = "Deleting…";
    try {
      const res = await window.API.deleteRecipe(recipe.recipe_id);
      if (res && res.error) throw new Error(res.error);
      showToast("Recipe deleted");
      setTimeout(() => { location.href = "index.html"; }, 700);
    } catch (err) {
      showToast(err.message);
      deleteYes.disabled = false;
      deleteCancel.disabled = false;
      deleteYes.textContent = "Yes, delete permanently";
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

  // ===== Make mode: read-only production view with scaler + check-off =====
  (function setupMakeMode() {
    const makeEl = document.getElementById("make-mode");
    if (!makeEl) return;
    const openBtn = document.getElementById("make-mode-btn");
    const doneBtn = document.getElementById("make-done");
    const listEl = document.getElementById("make-ingredients");
    const progressText = document.getElementById("make-progress-text");
    const resetBtn = document.getElementById("make-reset");
    const scalerBtns = document.getElementById("make-scaler-btns");
    const multInput = document.getElementById("make-mult-input");

    let factor = 1;
    const checked = new Set();       // indices of added ingredients
    let wakeLock = null;

    function fmtNum(n) {
      if (n === "" || n == null || isNaN(n)) return "";
      const r = Math.round(Number(n) * 1000) / 1000;
      return String(r);
    }

    function renderHero() {
      const abv = window.ABV.computeABV(recipe);
      document.getElementById("make-abv-value").textContent =
        (abv === null || isNaN(abv)) ? "—" : abv.toFixed(1) + "%";
      const size = Number(recipe.batch_size);
      const batchEl = document.getElementById("make-batch-value");
      if (size) {
        batchEl.textContent = fmtNum(size * factor) + (recipe.batch_unit ? " " + recipe.batch_unit : "");
      } else {
        batchEl.textContent = "—";
      }
    }

    function renderProgress() {
      const total = recipe.ingredients.length;
      progressText.textContent = `${checked.size} / ${total} added`;
    }

    function renderList() {
      listEl.innerHTML = "";
      if (!recipe.ingredients.length) {
        const li = document.createElement("li");
        li.style.cursor = "default";
        li.innerHTML = `<span class="make-ing-name">No ingredients in this recipe.</span>`;
        listEl.appendChild(li);
        renderProgress();
        return;
      }
      recipe.ingredients.forEach((ing, idx) => {
        const li = document.createElement("li");
        if (checked.has(idx)) li.classList.add("done");
        const amt = ing.amount === "" || ing.amount == null ? "" : fmtNum(Number(ing.amount) * factor);
        const unit = ing.unit ? `<span class="make-unit">${ing.unit}</span>` : "";
        const alcTag = ing.is_alcohol
          ? `<span class="make-alc-tag">${ing.abv_percent ? ing.abv_percent + "%" : "alc"}</span>` : "";
        li.innerHTML = `
          <span class="make-check">✓</span>
          <span class="make-amount">${amt}${unit}</span>
          <span class="make-ing-name">${(ing.name || "—")}${alcTag}</span>
        `;
        li.addEventListener("click", () => {
          if (checked.has(idx)) checked.delete(idx); else checked.add(idx);
          li.classList.toggle("done");
          renderProgress();
        });
        listEl.appendChild(li);
      });
      renderProgress();
    }

    function renderNotes() {
      const wrap = document.getElementById("make-notes-wrap");
      const txt = (recipe.notes || "").trim();
      if (txt) {
        document.getElementById("make-notes-text").textContent = txt;
        wrap.hidden = false;
      } else {
        wrap.hidden = true;
      }
    }

    function setFactor(f) {
      factor = f > 0 ? f : 1;
      // reflect active state on preset buttons
      scalerBtns.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", Number(b.dataset.mult) === factor);
      });
      renderHero();
      renderList();
    }

    scalerBtns.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      multInput.value = "";
      setFactor(Number(btn.dataset.mult));
    });
    multInput.addEventListener("input", () => {
      const v = Number(multInput.value);
      if (v > 0) {
        scalerBtns.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        factor = v;
        renderHero();
        renderList();
      }
    });

    resetBtn.addEventListener("click", () => {
      checked.clear();
      renderList();
    });

    async function requestWakeLock() {
      try {
        if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
      } catch (_) { /* not supported / denied — non-fatal */ }
    }
    function releaseWakeLock() {
      if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    }
    // Re-acquire if the tab is re-shown while make mode is open.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !makeEl.hidden) requestWakeLock();
    });

    function openMake() {
      document.getElementById("make-title").textContent =
        document.getElementById("f-name").value.trim() || recipe.name || "Recipe";
      // Build fresh from whatever's currently on screen (edits/scaling included).
      setFactor(1);
      multInput.value = "";
      renderNotes();
      makeEl.hidden = false;
      document.body.style.overflow = "hidden";
      requestWakeLock();
    }
    function closeMake() {
      makeEl.hidden = true;
      document.body.style.overflow = "";
      releaseWakeLock();
    }

    openBtn.addEventListener("click", openMake);
    doneBtn.addEventListener("click", closeMake);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !makeEl.hidden) closeMake();
    });
  })();

  renderIngredients();
  updateABV();
})();
