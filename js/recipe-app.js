// v1.11.1 (2026-07-15): Target ABV solve is now a non-destructive preview (like the scale calculator). Full history: CHANGELOG.md
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
    populateScaleIngredients();
  }

  function updateABV() {
    recipe.batch_size = Number(document.getElementById("f-batch-size").value) || recipe.batch_size;
    recipe.batch_unit = document.getElementById("f-batch-unit").value || recipe.batch_unit;
    const abv = window.ABV.computeABV(recipe);
    const el = document.getElementById("abv-live");
    el.textContent = (abv === null || isNaN(abv)) ? "—" : abv.toFixed(2) + "%";
    document.getElementById("abv-warning").textContent = recipe._targetAbvWarning || "";
    renderScalePreview();  // keep the scale-calculator preview in sync with edits
    renderTargetPreview(); // re-solve the target-ABV preview against the edited recipe
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

  // ===== Scale calculator: non-destructive preview (by batch size or by ingredient) =====
  const scaleUI = {
    size: document.getElementById("scale-size"),
    unit: document.getElementById("scale-unit"),
    ingSel: document.getElementById("scale-ing"),
    ingAmt: document.getElementById("scale-ing-amount"),
    ingUnit: document.getElementById("scale-ing-unit"),
    result: document.getElementById("scale-result"),
    factorLabel: document.getElementById("scale-factor-label"),
    output: document.getElementById("scale-output"),
    clear: document.getElementById("scale-clear"),
    writeBack: document.getElementById("scale-write-back"),
  };
  let scaleMode = null;        // "size" | "ingredient" | null
  let lastScaled = null;       // last previewed result, for optional write-back

  function fmtAmt(n) {
    if (n === "" || n == null || isNaN(n)) return "";
    return String(Math.round(Number(n) * 1000) / 1000);
  }

  function populateScaleIngredients() {
    const prev = scaleUI.ingSel.value;
    scaleUI.ingSel.innerHTML = '<option value="">— choose —</option>';
    recipe.ingredients.forEach((ing, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = ing.name || `Ingredient ${idx + 1}`;
      scaleUI.ingSel.appendChild(opt);
    });
    if (prev !== "" && recipe.ingredients[Number(prev)]) scaleUI.ingSel.value = prev;
    syncScaleIngUnit();
  }

  function syncScaleIngUnit() {
    const ing = recipe.ingredients[Number(scaleUI.ingSel.value)];
    scaleUI.ingUnit.textContent = ing && ing.unit ? `(${ing.unit})` : "";
  }

  function computeScaleFactor() {
    if (scaleMode === "size") {
      const size = Number(scaleUI.size.value);
      if (!size || size <= 0) return null;
      const unit = scaleUI.unit.value.trim() || recipe.batch_unit || "";
      const cur = window.ABV.toML(recipe.batch_size, recipe.batch_unit);
      const tgt = window.ABV.toML(size, unit);
      if (cur && tgt) return { factor: tgt / cur, size, unit };
      if (Number(recipe.batch_size) &&
          String(unit).trim().toLowerCase() === String(recipe.batch_unit || "").trim().toLowerCase()) {
        return { factor: size / Number(recipe.batch_size), size, unit };
      }
      return { error: "Units must match the recipe's batch unit or both be convertible volumes (mL, oz, gal…)." };
    }
    if (scaleMode === "ingredient") {
      const ing = recipe.ingredients[Number(scaleUI.ingSel.value)];
      const amt = Number(scaleUI.ingAmt.value);
      if (!ing || !amt || amt <= 0) return null;
      if (!Number(ing.amount)) return { error: "That ingredient has no current amount to scale from." };
      return { factor: amt / Number(ing.amount) };
    }
    return null;
  }

  function renderScalePreview() {
    const res = computeScaleFactor();
    if (!res) { scaleUI.result.hidden = true; lastScaled = null; return; }
    if (res.error) {
      scaleUI.factorLabel.textContent = res.error;
      scaleUI.output.innerHTML = "";
      scaleUI.writeBack.disabled = true;
      scaleUI.result.hidden = false;
      lastScaled = null;
      return;
    }
    const scaled = window.ABV.scaleByFactor(recipe, res.factor);
    if (res.size) { scaled.batch_size = res.size; scaled.batch_unit = res.unit; }
    lastScaled = scaled;

    const batchStr = scaled.batch_size
      ? `${fmtAmt(scaled.batch_size)}${scaled.batch_unit ? " " + scaled.batch_unit : ""}` : "—";
    scaleUI.factorLabel.textContent =
      `×${fmtAmt(res.factor)} — batch: ${batchStr}`;

    scaleUI.output.innerHTML = "";
    scaled.ingredients.forEach(ing => {
      const row = document.createElement("div");
      row.className = "scaled-row";
      const name = document.createElement("span");
      name.textContent = ing.name || "—";
      const amt = document.createElement("span");
      amt.className = "amt";
      amt.textContent = `${fmtAmt(ing.amount)}${ing.unit ? " " + ing.unit : ""}`;
      row.append(name, amt);
      scaleUI.output.appendChild(row);
    });
    scaleUI.writeBack.disabled = false;
    scaleUI.result.hidden = false;
  }

  function clearScaleCalc() {
    scaleMode = null;
    lastScaled = null;
    scaleUI.size.value = "";
    scaleUI.unit.value = "";
    scaleUI.ingSel.value = "";
    scaleUI.ingAmt.value = "";
    syncScaleIngUnit();
    scaleUI.result.hidden = true;
  }

  [scaleUI.size, scaleUI.unit].forEach(el => el.addEventListener("input", () => {
    scaleMode = "size";
    scaleUI.ingSel.value = "";
    scaleUI.ingAmt.value = "";
    syncScaleIngUnit();
    renderScalePreview();
  }));
  scaleUI.ingSel.addEventListener("change", () => {
    scaleMode = "ingredient";
    scaleUI.size.value = "";
    scaleUI.unit.value = "";
    syncScaleIngUnit();
    renderScalePreview();
  });
  scaleUI.ingAmt.addEventListener("input", () => {
    scaleMode = "ingredient";
    scaleUI.size.value = "";
    scaleUI.unit.value = "";
    renderScalePreview();
  });
  scaleUI.clear.addEventListener("click", clearScaleCalc);

  // Explicit opt-in: copy the previewed amounts into the recipe (still needs Save).
  scaleUI.writeBack.addEventListener("click", () => {
    if (!lastScaled) return;
    recipe.batch_size = lastScaled.batch_size;
    recipe.batch_unit = lastScaled.batch_unit;
    recipe.ingredients = lastScaled.ingredients;
    document.getElementById("f-batch-size").value = recipe.batch_size;
    document.getElementById("f-batch-unit").value = recipe.batch_unit;
    clearScaleCalc();
    renderIngredients();
    updateABV();
    showToast("Recipe overwritten with scaled amounts — press Save to keep it.");
  });

  // ===== Target ABV: non-destructive solve preview =====
  const targetUI = {
    input: document.getElementById("target-abv"),
    result: document.getElementById("target-result"),
    label: document.getElementById("target-factor-label"),
    warning: document.getElementById("target-warning"),
    output: document.getElementById("target-output"),
    clear: document.getElementById("target-clear"),
    writeBack: document.getElementById("target-write-back"),
  };
  let lastSolved = null;
  let targetActive = false; // preview only shows after an explicit Solve

  function clearTargetPreview() {
    targetActive = false;
    lastSolved = null;
    targetUI.result.hidden = true;
  }

  function renderTargetPreview() {
    if (!targetActive) { targetUI.result.hidden = true; return; }
    const target = Number(targetUI.input.value);
    if (!target) { clearTargetPreview(); return; }
    let solved;
    try {
      solved = window.ABV.solveForTargetABV(recipe, target);
    } catch (err) {
      lastSolved = null;
      targetUI.label.textContent = err.message;
      targetUI.warning.hidden = true;
      targetUI.output.innerHTML = "";
      targetUI.writeBack.disabled = true;
      targetUI.result.hidden = false;
      return;
    }
    lastSolved = solved;
    targetUI.label.textContent =
      `Solved: ${solved._solvedABV == null || isNaN(solved._solvedABV) ? "—" : solved._solvedABV.toFixed(2) + "%"} ABV`;
    targetUI.warning.textContent = solved._targetAbvWarning || "";
    targetUI.warning.hidden = !solved._targetAbvWarning;

    targetUI.output.innerHTML = "";
    solved.ingredients.forEach((ing, idx) => {
      const row = document.createElement("div");
      row.className = "scaled-row";
      const name = document.createElement("span");
      name.textContent = ing.name || "—";
      const amt = document.createElement("span");
      amt.className = "amt";
      amt.textContent = `${fmtAmt(ing.amount)}${ing.unit ? " " + ing.unit : ""}`;
      const before = recipe.ingredients[idx];
      if (before && Number(before.amount) !== Number(ing.amount)) {
        const was = document.createElement("span");
        was.className = "was";
        was.textContent = ` (was ${fmtAmt(before.amount)})`;
        amt.appendChild(was);
      }
      row.append(name, amt);
      targetUI.output.appendChild(row);
    });
    targetUI.writeBack.disabled = false;
    targetUI.result.hidden = false;
  }

  document.getElementById("target-apply").addEventListener("click", () => {
    if (!Number(targetUI.input.value)) { alert("Enter a target ABV first."); return; }
    targetActive = true;
    renderTargetPreview();
  });
  targetUI.clear.addEventListener("click", clearTargetPreview);

  // Explicit opt-in: copy the solved amounts into the recipe (still needs Save).
  targetUI.writeBack.addEventListener("click", () => {
    if (!lastSolved) return;
    recipe.ingredients = lastSolved.ingredients;
    recipe._targetAbvWarning = lastSolved._targetAbvWarning || "";
    clearTargetPreview();
    renderIngredients();
    updateABV();
    showToast("Recipe overwritten with solved amounts — press Save to keep it.");
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
