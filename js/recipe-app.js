// v1.22.2 (2026-08-23): Scale calculator — a missing batch size no longer
// reads as a unit problem, a recipe with no batch unit can be given one, and
// the preview has the same As written/Auto/Metric/US toggle as Make mode.
// v1.22.0 (2026-08-23): Category is an editable field, and saving keeps
// has_detailed_recipe in step with whether the recipe has ingredients.
// v1.20.0 (2026-08-09): Make mode scales to a target batch size. Full history: CHANGELOG.md
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
  recipe.ingredients = (recipe.ingredients || []).map(i => {
    const name = i.name || i.ingredient_name || "";
    return {
      ...i,
      name,
      is_alcohol: i.is_alcohol === true || i.is_alcohol === "yes" || i.is_alcohol === "TRUE",
      // Volume model: type defaults from the name; blank contribution = use type default.
      ing_type: i.ing_type && window.ABV.ING_TYPES[i.ing_type] ? i.ing_type : window.ABV.guessIngredientType(name),
      volume_contribution: i.volume_contribution === 0 || i.volume_contribution ? i.volume_contribution : ""
    };
  });

  document.getElementById("recipe-title").textContent = recipe.name;
  document.title = recipe.name + " — Sturgeon Spirits";
  const nameField = document.getElementById("f-name");
  nameField.value = recipe.name || "";
  nameField.addEventListener("input", () => {
    const v = nameField.value.trim() || "Recipe";
    document.getElementById("recipe-title").textContent = v;
    document.title = v + " — Sturgeon Spirits";
  });
  const categoryField = document.getElementById("f-category");
  categoryField.value = recipe.category || "";
  // Keep the in-memory recipe in step — the PDF/Word export reads it, not the DOM.
  categoryField.addEventListener("input", () => { recipe.category = categoryField.value.trim(); });

  // The category suggestions are the categories already in use, fetched the
  // first time the field is touched. Most visits to this page never edit the
  // category, and there's no reason to make them all pay for a second read.
  let categoriesLoaded = false;
  categoryField.addEventListener("focus", async () => {
    if (categoriesLoaded) return;
    categoriesLoaded = true;
    try {
      const all = await window.API.getAllRecipes();
      const list = document.getElementById("f-category-options");
      Array.from(new Set(all.map(r => r.category).filter(Boolean))).sort().forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        list.appendChild(opt);
      });
    } catch (err) {
      // Suggestions are a convenience; typing the category still works without them.
      categoriesLoaded = false;
    }
  });
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
  document.getElementById("f-ttb-abv").value = recipe.ttb_abv || "";
  document.getElementById("f-ttb-abv-source").value = recipe.ttb_abv_source || "";
  document.getElementById("f-tested-abv").value = recipe.tested_abv || "";
  document.getElementById("f-tested-date").value = recipe.tested_date || "";

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
    const typeOptions = Object.entries(window.ABV.ING_TYPES)
      .map(([key, t]) => `<option value="${key}">${t.label}</option>`).join("");
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
        <div class="mini ing-type-field"><label>Type</label>
          <select data-f="ing_type">${typeOptions}</select></div>
        <div class="mini ing-vol-field"><label>Vol. %</label>
          <input type="number" step="any" inputmode="decimal" min="0" max="100" data-f="volume_contribution"></div>
        <div class="mini ing-abv-field"><label>ABV %</label>
          <input type="number" step="any" inputmode="decimal" data-f="abv_percent"></div>
        <label class="alc-toggle"><input type="checkbox" data-f="is_alcohol"><span class="dot"></span>Alcohol</label>
      `;
      card.querySelector('[data-f="name"]').value = ing.name || "";
      card.querySelector('[data-f="amount"]').value = ing.amount ?? "";
      card.querySelector('[data-f="unit"]').value = ing.unit || "";
      card.querySelector('[data-f="is_alcohol"]').checked = !!ing.is_alcohol;
      card.querySelector('[data-f="abv_percent"]').value = ing.abv_percent || "";
      card.querySelector('[data-f="ing_type"]').value = ing.ing_type || "liquid";
      card.querySelector('[data-f="volume_contribution"]').value = ing.volume_contribution ?? "";

      const abvField = card.querySelector(".ing-abv-field");
      function syncAbvField() {
        abvField.classList.toggle("disabled", !recipe.ingredients[idx].is_alcohol);
      }
      syncAbvField();

      // Blank Vol.% = "use the type's default" — surface that default as placeholder.
      const volInput = card.querySelector('[data-f="volume_contribution"]');
      function syncVolPlaceholder() {
        const t = window.ABV.ING_TYPES[recipe.ingredients[idx].ing_type] || window.ABV.ING_TYPES.liquid;
        volInput.placeholder = "auto " + Math.round(t.factor * 100);
      }
      syncVolPlaceholder();

      card.querySelectorAll("input, select").forEach(input => {
        const evt = (input.type === "checkbox" || input.tagName === "SELECT") ? "change" : "input";
        input.addEventListener(evt, () => {
          const f = input.dataset.f;
          let v = input.value;
          if (f === "amount" || f === "abv_percent" || f === "volume_contribution") v = v === "" ? "" : Number(v);
          if (f === "is_alcohol") v = input.checked;
          recipe.ingredients[idx][f] = v;
          if (f === "is_alcohol") syncAbvField();
          if (f === "ing_type") { recipe.ingredients[idx]._typeTouched = true; syncVolPlaceholder(); }
          // Until the user picks a type by hand, keep it in sync with the name
          // (typing "Cherries" flips the type to Fruit automatically).
          if (f === "name" && !recipe.ingredients[idx]._typeTouched) {
            const guessed = window.ABV.guessIngredientType(v);
            recipe.ingredients[idx].ing_type = guessed;
            card.querySelector('[data-f="ing_type"]').value = guessed;
            syncVolPlaceholder();
          }
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

    // Ingredient-model readout: modeled final volume + the ABV it implies.
    // When a batch size is entered the hero uses it, so a big gap between the
    // two numbers means the declared batch size is off (or the model needs tuning).
    const hintEl = document.getElementById("abv-model-hint");
    const estML = window.ABV.estimateFinalVolumeML(recipe);
    const modeled = window.ABV.computeModeledABV(recipe);
    if (estML && modeled !== null && !isNaN(modeled)) {
      const declaredML = window.ABV.toML(recipe.batch_size, recipe.batch_unit);
      let txt = `Ingredient model: ~${modeled.toFixed(1)}% ABV · est. final volume ${Math.round(estML)} mL`;
      if (declaredML && Math.abs(declaredML - estML) / estML > 0.10) {
        txt += ` — differs from your batch size (${Math.round(declaredML)} mL); the big number uses the batch size.`;
      }
      hintEl.textContent = txt;
      hintEl.hidden = false;
    } else {
      hintEl.hidden = true;
    }
    renderReconcile();     // calculated vs label vs tested
    renderScalePreview();  // keep the scale-calculator preview in sync with edits
    renderTargetPreview(); // re-solve the target-ABV preview against the edited recipe
  }

  // ===== Calculated vs label vs tested =====
  // Three different numbers that all get called "the ABV":
  //   calculated — what the ingredients imply
  //   label      — what the approved COLA declares
  //   tested     — what the batch actually gauged at
  // Only the tested-vs-label gap is a compliance question; a calculated figure
  // that disagrees is a recipe-accuracy signal, not a violation.
  function renderReconcile() {
    const el = document.getElementById("abv-reconcile");
    const ttbABV = document.getElementById("f-ttb-abv").value;
    const source = document.getElementById("f-ttb-abv-source").value;
    const testedABV = document.getElementById("f-tested-abv").value;
    const calc = window.ABV.computeABV(recipe);

    if (ttbABV === "" && testedABV === "") { el.hidden = true; return; }

    // What the approved figure is called depends on where it was declared.
    const SOURCE_NAME = { formula: "approved formula", label: "label", both: "approved formula and label" };
    const what = SOURCE_NAME[source] || "TTB-approved figure";
    // The ±0.3 tolerance is a *labeling* rule; for a formula-only product the
    // same threshold is used to flag drift, but it isn't cited as 5.37(b).
    const isLabel = source === "label" || source === "both";
    const tolNote = isLabel
      ? `the ±${window.ABV.ABV_TOLERANCE} point tolerance of 27 CFR 5.37(b)`
      : `±${window.ABV.ABV_TOLERANCE} points of the approved formula`;

    const parts = [];
    if (ttbABV !== "") {
      const srcTag = source ? ` <span class="rec-src">${source === "both" ? "formula + label" : source}</span>` : "";
      parts.push(`<span class="rec-item">TTB <b>${Number(ttbABV).toFixed(1)}%</b>${srcTag}</span>`);
    }
    if (testedABV !== "") parts.push(`<span class="rec-item">Tested <b>${Number(testedABV).toFixed(1)}%</b></span>`);
    if (calc !== null && !isNaN(calc)) parts.push(`<span class="rec-item">Calculated <b>${calc.toFixed(1)}%</b></span>`);

    let verdict = "", cls = "";
    const testedCmp = window.ABV.abvCompliance(testedABV, ttbABV);
    if (testedCmp) {
      const off = Math.abs(testedCmp.delta).toFixed(2);
      if (testedCmp.within) {
        cls = "ok";
        verdict = `Tested is within ${tolNote} (${testedCmp.low.toFixed(1)}–${testedCmp.high.toFixed(1)}%).`;
      } else {
        cls = "bad";
        verdict = `Tested is ${off} points ${testedCmp.delta > 0 ? "above" : "below"} the ${what} — outside ${tolNote}, which allows ${testedCmp.low.toFixed(1)}–${testedCmp.high.toFixed(1)}%.`;
      }
    } else if (ttbABV !== "" && calc !== null && !isNaN(calc)) {
      // No gauged result yet — compare the recipe against the approved figure.
      // Drift here means the recipe no longer makes what TTB signed off on,
      // which matters for a formula just as much as for a label.
      const calcCmp = window.ABV.abvCompliance(calc, ttbABV);
      if (calcCmp && !calcCmp.within) {
        cls = "warn";
        verdict = `The recipe calculates to ${Math.abs(calcCmp.delta).toFixed(1)} points ${calcCmp.delta > 0 ? "above" : "below"} the ${what}. Gauge a batch to confirm, or use Target ABV to bring the recipe onto ${Number(ttbABV).toFixed(1)}%.`;
      }
    }

    el.className = "abv-reconcile" + (cls ? " " + cls : "");
    el.innerHTML = `<div class="rec-row">${parts.join("")}</div>` +
      (verdict ? `<div class="rec-verdict">${verdict}</div>` : "");
    el.hidden = false;
  }

  ["f-ttb-abv", "f-ttb-abv-source", "f-tested-abv"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      renderReconcile();
      syncUseLabelBtn();
    });
  });

  document.getElementById("f-batch-size").addEventListener("input", updateABV);
  document.getElementById("f-batch-unit").addEventListener("input", updateABV);

  document.getElementById("add-ingredient").addEventListener("click", () => {
    recipe.ingredients.push({ name: "", amount: "", unit: "", is_alcohol: false, abv_percent: "", ing_type: "liquid", volume_contribution: "" });
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
    unitBtns: document.getElementById("scale-unit-btns"),
    unitsHint: document.getElementById("scale-units-hint"),
  };
  // Display units for the preview list only. Never written back — "Overwrite
  // recipe" copies the recipe's own units, same rule as Make mode.
  let scaleUnitMode = "as-written";
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
      const typedUnit = String(scaleUI.unit.value || "").trim();
      const recipeUnit = String(recipe.batch_unit || "").trim();
      const unit = typedUnit || recipeUnit;
      const curSize = Number(recipe.batch_size);

      // No batch size means there is no ratio to take — nothing about units can
      // rescue that. The old message blamed units here, which sent you looking
      // in the wrong place: 8 of the recipes with ingredients have no batch size.
      if (!curSize) {
        return { error: "This recipe has no batch size to scale from — set one at the top, or scale by an ingredient below." };
      }

      // Both sides are real volumes: convert properly. Handles cups → mL, L →
      // gal and so on.
      const cur = window.ABV.toML(curSize, recipeUnit);
      const tgt = window.ABV.toML(size, unit);
      if (cur && tgt) return { factor: tgt / cur, size, unit };

      // The recipe carries no unit of its own (141 recipes don't). Typing one
      // used to fail outright; read it as naming the unit the recipe was always
      // in, take the plain ratio, and say so rather than assuming silently.
      if (!recipeUnit) {
        return {
          factor: size / curSize, size, unit,
          note: typedUnit ? `Taking the recipe's ${fmtAmt(curSize)} as ${typedUnit}.` : ""
        };
      }

      // Same unit on both sides, including one that isn't a volume ("each",
      // "parts") — a plain ratio is still right.
      if (!typedUnit || recipeUnit.toLowerCase() === typedUnit.toLowerCase()) {
        return { factor: size / curSize, size, unit };
      }

      return { error: `Can't convert ${typedUnit} to the recipe's ${recipeUnit}. Use the same unit, or a volume unit on both sides (mL, L, cups, fl oz, qt, gal).` };
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
      `×${fmtAmt(res.factor)} — batch: ${batchStr}` + (res.note ? ` · ${res.note}` : "");

    scaleUI.output.innerHTML = "";
    scaled.ingredients.forEach(ing => {
      const row = document.createElement("div");
      row.className = "scaled-row";
      const name = document.createElement("span");
      name.textContent = ing.name || "—";
      const amt = document.createElement("span");
      amt.className = "amt";
      amt.textContent = scaledAmountText(ing.amount, ing.unit);
      row.append(name, amt);
      scaleUI.output.appendChild(row);
    });
    scaleUI.unitsHint.hidden = scaleUnitMode === "as-written";
    scaleUI.writeBack.disabled = false;
    scaleUI.result.hidden = false;
  }

  // One scaled amount as text, in whichever display units are selected. A
  // weight (g, lb) or a countable ("each") isn't a volume, so UNITS leaves it
  // alone and it shows as written — the toggle only moves what can move.
  function scaledAmountText(amount, unit) {
    const asWritten = `${fmtAmt(amount)}${unit ? " " + unit : ""}`;
    if (scaleUnitMode === "as-written" || !window.UNITS || !window.UNITS.isConvertible(unit)) {
      return asWritten;
    }
    const r = window.UNITS.convert(amount, unit, scaleUnitMode);
    if (!r || r.text === "") return asWritten;
    return r.unit ? `${r.text} ${r.unit}` : r.text;
  }

  scaleUI.unitBtns.addEventListener("click", e => {
    const btn = e.target.closest("button[data-unit-mode]");
    if (!btn) return;
    scaleUnitMode = btn.dataset.unitMode;
    Array.from(scaleUI.unitBtns.querySelectorAll("button")).forEach(b =>
      b.classList.toggle("active", b.dataset.unitMode === scaleUnitMode));
    renderScalePreview();
  });

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
  // Two modes:
  //  "fixed" — batch size stays fixed; the alcohol ingredient is set to hit the
  //            target and an ingredient named "Water" absorbs the difference.
  //  "add"   — for recipes built as a fixed base mix (cider + juice + sugar…)
  //            that alcohol gets poured into afterward. Batch size isn't fixed;
  //            this solves how much of the alcohol ingredient to add so the
  //            base + alcohol together land on the target ABV.
  const targetUI = {
    mode: document.getElementById("target-mode"),
    modeHint: document.getElementById("target-mode-hint"),
    input: document.getElementById("target-abv"),
    result: document.getElementById("target-result"),
    label: document.getElementById("target-factor-label"),
    warning: document.getElementById("target-warning"),
    output: document.getElementById("target-output"),
    clear: document.getElementById("target-clear"),
    writeBack: document.getElementById("target-write-back"),
    diluentField: document.getElementById("target-diluent-field"),
    diluent: document.getElementById("target-diluent"),
    useLabel: document.getElementById("target-use-label"),
  };
  const TARGET_MODE_HINTS = {
    fixed: 'Preview the alcohol and "Water" amounts needed to hit a target ABV, keeping batch size fixed. The recipe isn\'t changed unless you choose to overwrite it below.',
    add: 'For a recipe that\'s a fixed base mix (cider + juice + sugar…) with alcohol added afterward. Preview how much of the alcohol ingredient to pour in to hit the target ABV — batch size grows to fit. The recipe isn\'t changed unless you choose to overwrite it below.',
    dilute: 'For a mix that\'s come out too strong. Pick the liquid to add — water, juice, cider — and preview how much it takes to bring the batch down to the target ABV. Batch size grows to fit. The recipe isn\'t changed unless you choose to overwrite it below.',
  };
  let lastSolved = null;
  let targetActive = false; // preview only shows after an explicit Solve

  function syncTargetModeHint() {
    targetUI.modeHint.textContent = TARGET_MODE_HINTS[targetUI.mode.value] || TARGET_MODE_HINTS.fixed;
    targetUI.diluentField.hidden = targetUI.mode.value !== "dilute";
    if (targetUI.mode.value === "dilute") populateDiluents();
  }

  // Only non-alcoholic ingredients in a convertible volume unit can act as a
  // diluent — you can't dilute with 4 lb of cherries.
  function populateDiluents() {
    const prev = targetUI.diluent.value;
    targetUI.diluent.innerHTML = "";
    let any = false;
    recipe.ingredients.forEach((ing, idx) => {
      if (ing.is_alcohol || !window.ABV.isVolumeUnit(ing.unit)) return;
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = ing.name || `Ingredient ${idx + 1}`;
      targetUI.diluent.appendChild(opt);
      any = true;
    });
    if (!any) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— no liquid ingredient to add —";
      targetUI.diluent.appendChild(opt);
    }
    if (prev !== "" && recipe.ingredients[Number(prev)]) targetUI.diluent.value = prev;
  }

  syncTargetModeHint();
  targetUI.mode.addEventListener("change", () => {
    syncTargetModeHint();
    renderTargetPreview();
  });
  targetUI.diluent.addEventListener("change", renderTargetPreview);

  // "Match label ABV" — only offered when a label figure exists to match.
  function syncUseLabelBtn() {
    const v = document.getElementById("f-ttb-abv").value;
    targetUI.useLabel.hidden = v === "";
    targetUI.useLabel.textContent = v === "" ? "Match TTB ABV" : `Match TTB ABV (${Number(v).toFixed(1)}%)`;
  }
  targetUI.useLabel.addEventListener("click", () => {
    const v = document.getElementById("f-ttb-abv").value;
    if (v === "") return;
    targetUI.input.value = v;
    // Pick the direction that actually applies: below the label, add alcohol;
    // above it, dilute.
    const calc = window.ABV.computeABV(recipe);
    if (calc !== null && !isNaN(calc)) {
      targetUI.mode.value = calc > Number(v) ? "dilute" : "add";
      syncTargetModeHint();
    }
    targetActive = true;
    renderTargetPreview();
    const res = document.getElementById("target-result");
    if (res.scrollIntoView) res.scrollIntoView({ block: "nearest" });
  });

  function clearTargetPreview() {
    targetActive = false;
    lastSolved = null;
    targetUI.result.hidden = true;
  }

  function renderTargetPreview() {
    if (!targetActive) { targetUI.result.hidden = true; return; }
    const target = Number(targetUI.input.value);
    if (!target) { clearTargetPreview(); return; }
    const mode = targetUI.mode.value;
    let solved;
    try {
      solved = mode === "add" ? window.ABV.solveAddAlcohol(recipe, target)
        : mode === "dilute" ? window.ABV.solveAddDiluent(recipe, target, targetUI.diluent.value)
        : window.ABV.solveForTargetABV(recipe, target);
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
    let label = `Solved: ${solved._solvedABV == null || isNaN(solved._solvedABV) ? "—" : solved._solvedABV.toFixed(2) + "%"} ABV`;
    const finalML = solved._addAlcoholFinalML || solved._addDiluentFinalML;
    if (finalML) {
      const unit = recipe.batch_unit || "mL";
      const finalInUnit = window.ABV.fromML(finalML, unit);
      label += finalInUnit !== null
        ? ` — final volume ≈ ${fmtAmt(finalInUnit)} ${unit}`
        : ` — final volume ≈ ${Math.round(finalML)} mL`;
    }
    if (mode === "dilute" && solved._addedAmount) {
      label += ` · add ${fmtAmt(solved._addedAmount)} ${solved._addedUnit}`;
    }
    targetUI.label.textContent = label;
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
    // "add" and "dilute" both grow the batch — carry the new total into
    // batch_size so the Live ABV hero and saved recipe agree with the solve.
    const grownML = lastSolved._addAlcoholFinalML || lastSolved._addDiluentFinalML;
    if (grownML) {
      const unit = recipe.batch_unit || "mL";
      const finalInUnit = window.ABV.fromML(grownML, unit);
      recipe.batch_size = finalInUnit !== null
        ? Math.round(finalInUnit * 1000) / 1000
        : Math.round(grownML);
      if (finalInUnit === null) recipe.batch_unit = "mL";
      document.getElementById("f-batch-size").value = recipe.batch_size;
      document.getElementById("f-batch-unit").value = recipe.batch_unit;
    }
    clearTargetPreview();
    renderIngredients();
    updateABV();
    showToast("Recipe overwritten with solved amounts — press Save to keep it.");
  });

  const saveBtn = document.getElementById("save-btn");
  saveBtn.addEventListener("click", async () => {
    const fields = {
      name: document.getElementById("f-name").value,
      category: document.getElementById("f-category").value.trim(),
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
      ttb_abv: document.getElementById("f-ttb-abv").value,
      ttb_abv_source: document.getElementById("f-ttb-abv-source").value,
      tested_abv: document.getElementById("f-tested-abv").value,
      tested_date: document.getElementById("f-tested-date").value,
      // Nothing else keeps this column honest: replace_ingredients writes the
      // ingredient rows without touching the recipe row, so a recipe that had
      // ingredients added went on reporting "no ingredients yet" in the list
      // and hid from the "With ingredients" filter. Derive it on every save.
      has_detailed_recipe: recipe.ingredients.length ? "yes" : "no",
    };
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      // One request for all the fields, one for the ingredients, in parallel —
      // they write to different tabs. This used to be 14 sequential round-trips.
      await Promise.all([
        window.API.updateRecipeFields(recipe.recipe_id, fields),
        window.API.replaceIngredients(recipe.recipe_id, recipe.ingredients),
      ]);
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
    const unitBtns = document.getElementById("make-unit-btns");
    const unitsHint = document.getElementById("make-units-hint");
    const targetRow = document.getElementById("make-target-row");
    const targetSize = document.getElementById("make-target-size");
    const targetUnit = document.getElementById("make-target-unit");
    const targetHint = document.getElementById("make-target-hint");

    let factor = 1;
    let unitMode = "as-written"; // display only; never written back to the recipe
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
        const d = displayAmount(size * factor, recipe.batch_unit);
        batchEl.innerHTML = d.orig
          ? `${d.text}<span class="make-orig">${d.orig}</span>` : d.text;
      } else {
        batchEl.textContent = "—";
      }
    }

    // Single place the unit mode is applied. Falls back to the recipe's own
    // units whenever the unit isn't convertible ("parts", "each", blank).
    function displayAmount(amount, unit) {
      const blank = { num: "", unit: "", text: "", orig: "" };
      if (amount === "" || amount == null || isNaN(Number(amount))) return blank;
      const asWritten = fmtNum(amount) + (unit ? " " + unit : "");
      if (unitMode === "as-written" || !window.UNITS || !window.UNITS.isConvertible(unit)) {
        return { num: fmtNum(amount), unit: unit || "", text: asWritten, orig: "" };
      }
      const r = window.UNITS.convert(amount, unit, unitMode);
      return {
        num: r.text,
        unit: r.unit || "",
        text: r.unit ? `${r.text} ${r.unit}` : r.text,
        // Keep the recipe's own figure visible so an operator can cross-check
        // a converted number against the written recipe.
        orig: r.converted ? asWritten : "",
      };
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
        const d = ing.amount === "" || ing.amount == null
          ? { num: "", unit: "", orig: "" }
          : displayAmount(Number(ing.amount) * factor, ing.unit);
        const unit = d.unit ? `<span class="make-unit">${d.unit}</span>` : "";
        const orig = d.orig ? `<span class="make-orig">${d.orig}</span>` : "";
        const alcTag = ing.is_alcohol
          ? `<span class="make-alc-tag">${ing.abv_percent ? ing.abv_percent + "%" : "alc"}</span>` : "";
        li.innerHTML = `
          <span class="make-check">✓</span>
          <span class="make-amount">${d.num}${unit}${orig}</span>
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

    // ---- scale to a specific finished amount ("make 1 gallon") ----
    // Everything here is arithmetic on top of `factor`, exactly like the
    // multiplier buttons: the saved recipe is never touched.
    //
    // An amount is reduced to a comparable base (mL or g) so a target can be
    // given in any unit of the same family as the recipe's batch. Units the
    // converter doesn't know ("parts", "each", blank) still work, but only
    // against themselves — hence the synthetic "raw:" family.
    function baseOf(amount, unit) {
      const n = Number(amount);
      if (!isFinite(n) || n <= 0) return null;
      const u = window.UNITS && window.UNITS.lookup(unit);
      if (u) return { value: n * u.factor, family: u.family };
      return { value: n, family: "raw:" + String(unit || "").trim().toLowerCase() };
    }
    function recipeBase() { return baseOf(recipe.batch_size, recipe.batch_unit); }

    // The unit the target is expressed in — blank means "same as the recipe".
    function targetUnitName() {
      return targetUnit.value.trim() || recipe.batch_unit || "";
    }

    // factor implied by a target amount, or null when the units can't be compared.
    function factorForTarget(size, unit) {
      const want = baseOf(size, unit);
      const have = recipeBase();
      if (!want || !have || want.family !== have.family) return null;
      return want.value / have.value;
    }

    // Inverse: what the current factor works out to in the chosen target unit.
    function targetValueFor(f, unit) {
      const have = recipeBase();
      if (!have) return null;
      const u = window.UNITS && window.UNITS.lookup(unit);
      const step = u
        ? (u.family === have.family ? u.factor : null)
        : (have.family === "raw:" + String(unit || "").trim().toLowerCase() ? 1 : null);
      return step == null ? null : (have.value * f) / step;
    }

    function renderTargetHint() {
      const have = recipeBase();
      if (!have) {
        targetHint.textContent = "Add a batch size to the recipe to make a set amount.";
        return;
      }
      if (targetSize.value.trim() !== "" && targetValueFor(1, targetUnitName()) == null) {
        targetHint.textContent =
          `Can't measure ${targetUnitName() || "that"} against a batch in ${recipe.batch_unit || "no unit"}.`;
        return;
      }
      const pct = Math.round(factor * 1000) / 1000;
      targetHint.textContent =
        `${pct}× the recipe — base formula unchanged (${fmtNum(recipe.batch_size)} ${recipe.batch_unit || ""}).`.replace(/\s+\)/, ")");
    }

    // source: "preset" | "mult" | "target" — whichever control the user touched
    // keeps its own text, the others are re-synced from the new factor.
    function setFactor(f, source) {
      factor = f > 0 ? f : 1;
      // reflect active state on preset buttons
      scalerBtns.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", Number(b.dataset.mult) === factor);
      });
      if (source !== "mult") multInput.value = "";
      if (source !== "target") {
        const v = targetValueFor(factor, targetUnitName());
        targetSize.value = v == null ? "" : fmtNum(v);
      }
      renderHero();
      renderList();
      renderTargetHint();
    }

    scalerBtns.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      setFactor(Number(btn.dataset.mult), "preset");
    });
    multInput.addEventListener("input", () => {
      const v = Number(multInput.value);
      if (v > 0) setFactor(v, "mult");
    });

    targetSize.addEventListener("input", () => {
      if (targetSize.value.trim() === "") { renderTargetHint(); return; }
      const f = factorForTarget(targetSize.value, targetUnitName());
      if (f && f > 0) setFactor(f, "target");
      else renderTargetHint();
    });
    targetUnit.addEventListener("input", () => {
      // Changing only the unit re-reads the amount already typed, so switching
      // "L" to "gal" means "make a gallon" rather than silently rescaling.
      const f = factorForTarget(targetSize.value, targetUnitName());
      if (f && f > 0) setFactor(f, "target");
      else renderTargetHint();
    });

    function setUnitMode(mode) {
      unitMode = mode;
      unitBtns.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", b.dataset.unitMode === mode);
      });
      unitsHint.hidden = mode === "as-written";
      try { localStorage.setItem("makeUnitMode", mode); } catch (_) { /* private mode — fine */ }
      renderHero();
      renderList();
    }

    unitBtns.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) setUnitMode(btn.dataset.unitMode);
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
      const hasBatch = !!recipeBase();
      targetUnit.value = recipe.batch_unit || "";
      targetSize.disabled = !hasBatch;
      targetUnit.disabled = !hasBatch;
      targetRow.classList.toggle("disabled", !hasBatch);
      setFactor(1, "open");
      // Unit preference is sticky between sessions; the scale multiplier isn't.
      let saved = "as-written";
      try { saved = localStorage.getItem("makeUnitMode") || "as-written"; } catch (_) {}
      setUnitMode(window.UNITS && window.UNITS.MODES.some(m => m.id === saved) ? saved : "as-written");
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
  syncUseLabelBtn();
  updateABV();
})();
