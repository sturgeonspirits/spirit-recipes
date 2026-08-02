// v1.16.0 (2026-08-02): + solveAddDiluent and the 27 CFR 5.37(b) label
// tolerance check. Full history: CHANGELOG.md
//
// Shared unit-conversion + ABV math. Kept dependency-free so it can be reused
// (or unit tested) outside the browser too.
window.ABV = (function () {
  // mL per 1 unit, for volume units only
  const ML_PER_UNIT = {
    ml: 1, mL: 1, milliliter: 1, milliliters: 1,
    l: 1000, liter: 1000, liters: 1000,
    cup: 236.588, cups: 236.588,
    tbsp: 14.7868, tbs: 14.7868, tablespoon: 14.7868, tablespoons: 14.7868,
    tsp: 4.92892, teaspoon: 4.92892, teaspoons: 4.92892,
    oz: 29.5735, "fl oz": 29.5735,
    gal: 3785.41, gallon: 3785.41, gallons: 3785.41,
    qt: 946.353, quart: 946.353, quarts: 946.353,
    pt: 473.176, pint: 473.176, pints: 473.176,
    parts: 1 // treated as relative "parts" -- only meaningful within one recipe, arbitrary scale
  };

  function isVolumeUnit(unit) {
    if (!unit) return false;
    return Object.prototype.hasOwnProperty.call(ML_PER_UNIT, String(unit).trim().toLowerCase());
  }

  function toML(amount, unit) {
    const key = String(unit || "").trim().toLowerCase();
    const factor = ML_PER_UNIT[key];
    if (factor === undefined) return null; // not a volume unit -- can't convert
    return Number(amount) * factor;
  }

  function fromML(ml, unit) {
    const key = String(unit || "").trim().toLowerCase();
    const factor = ML_PER_UNIT[key];
    if (factor === undefined) return null;
    return ml / factor;
  }

  // ---------- Ingredient volume-contribution model ----------
  // Solids don't contribute their measured volume to the finished liquid:
  // dry sugar dissolves into ~53% of its dry bulk volume (198 g/cup ≈ 125 mL
  // added), strained fresh fruit contributes roughly its water content (~55%
  // of its measured volume; solids removed), herbs/spices/zest ~nothing.
  const ING_TYPES = {
    liquid:    { label: "Liquid",              factor: 1 },
    sugar:     { label: "Sugar (dry)",         factor: 0.53 },
    fruit:     { label: "Fruit (strained)",    factor: 0.55 },
    botanical: { label: "Herb / spice / zest", factor: 0.05 },
  };

  const LIQUID_RE = /juice|syrup|water|milk|cream|wine|beer|cider|vodka|rum\b|whisk|bourbon|brandy|\bgin\b|tequila|liqueur|spirit|alcohol|extract|glycerin/i;
  const BOTANICAL_RE = /zest|peel|spice|cinnamon|clove|vanilla|anise|ginger|pepper|herb|\btea\b|coffee|cacao|nib|juniper|coriander|cardamom|nutmeg|allspice|bark|root|seed|leaf|leaves|flower|hibiscus|lavender|chamomile|wormwood|hops?\b/i;
  const SUGAR_RE = /sugar|sweetener/i;
  const FRUIT_RE = /cherr|berr|fruit|orange|lemon|lime|grape|apple|peach|plum|apricot|mango|pineapple|banana|melon|pear|\bfig|date|raisin|currant|rhubarb/i;

  // Best-guess type from the ingredient's name (order matters: "orange juice"
  // is a liquid and "orange peel" a botanical before "orange" reads as fruit).
  function guessIngredientType(name) {
    const n = String(name || "");
    if (!n) return "liquid";
    if (LIQUID_RE.test(n)) return "liquid";
    if (BOTANICAL_RE.test(n)) return "botanical";
    if (SUGAR_RE.test(n)) return "sugar";
    if (FRUIT_RE.test(n)) return "fruit";
    return "liquid";
  }

  // Fraction (0–1) of the ingredient's measured volume that reaches the final
  // liquid. An explicit volume_contribution (percent) overrides the type default.
  function contributionOf(ing) {
    const explicit = ing.volume_contribution;
    if (explicit !== "" && explicit != null && !isNaN(Number(explicit))) {
      return Math.max(0, Number(explicit)) / 100;
    }
    const type = ing.ing_type && ING_TYPES[ing.ing_type] ? ing.ing_type : guessIngredientType(ing.name);
    return ING_TYPES[type].factor;
  }

  // Modeled final volume: every convertible ingredient's effective contribution.
  function estimateFinalVolumeML(recipe) {
    let total = 0, any = false;
    (recipe.ingredients || []).forEach(ing => {
      const v = toML(ing.amount, ing.unit);
      if (v !== null) { total += v * contributionOf(ing); any = true; }
    });
    return any ? total : null;
  }

  // Pure ethanol in the recipe. Full measured volume counts: liquid soaked up
  // by strained solids removes ethanol and water in proportion, so it lowers
  // yield but not ABV.
  function totalAlcoholML_(recipe) {
    let alcoholML = 0;
    (recipe.ingredients || []).forEach(ing => {
      if (!ing.is_alcohol) return;
      const v = toML(ing.amount, ing.unit);
      const pct = Number(ing.abv_percent) || 0;
      if (v !== null) alcoholML += v * (pct / 100);
    });
    return alcoholML;
  }

  // Compute ABV of a recipe. A declared (measured) batch size wins; otherwise
  // the total is modeled from ingredient volume contributions.
  function computeABV(recipe) {
    let totalML = toML(recipe.batch_size, recipe.batch_unit);
    if (totalML === null || !totalML) totalML = estimateFinalVolumeML(recipe);
    if (!totalML) return null;
    return (totalAlcoholML_(recipe) / totalML) * 100;
  }

  // ABV strictly from the ingredient model, ignoring any declared batch size —
  // shown alongside so a stale/optimistic batch size is easy to spot.
  function computeModeledABV(recipe) {
    const totalML = estimateFinalVolumeML(recipe);
    if (!totalML) return null;
    return (totalAlcoholML_(recipe) / totalML) * 100;
  }

  // Proportional scale: every ingredient amount (and the batch size) is multiplied
  // by the same factor. Units are left as-is.
  function scaleByFactor(recipe, factor) {
    const scaled = JSON.parse(JSON.stringify(recipe));
    scaled.batch_size = Number(recipe.batch_size || 0) * factor;
    scaled.ingredients = (recipe.ingredients || []).map(ing => ({
      ...ing,
      amount: Number(ing.amount || 0) * factor
    }));
    return scaled;
  }

  function scaleToBatchSize(recipe, newSize, newUnit) {
    const currentML = toML(recipe.batch_size, recipe.batch_unit);
    const targetML = toML(newSize, newUnit || recipe.batch_unit);
    if (!currentML || !targetML) {
      throw new Error("Both the current and target batch size need to be in a convertible volume unit (mL, cups, oz, gal, etc).");
    }
    const factor = targetML / currentML;
    const scaled = scaleByFactor(recipe, factor);
    scaled.batch_size = newSize;
    scaled.batch_unit = newUnit || recipe.batch_unit;
    return scaled;
  }

  // Solve for the primary-alcohol volume needed to hit targetABV, holding total
  // batch volume fixed, and adjust the ingredient named "Water" (case-insensitive)
  // to absorb the difference. Mirrors the manual RTD math.
  function solveForTargetABV(recipe, targetABVPercent) {
    const totalML = toML(recipe.batch_size, recipe.batch_unit);
    if (!totalML) throw new Error("Recipe needs a batch size in a convertible volume unit to solve for target ABV.");

    const ingredients = (recipe.ingredients || []).map(i => ({ ...i }));
    const alcoholIdx = ingredients.findIndex(i => i.is_alcohol);
    if (alcoholIdx === -1) throw new Error("No alcohol ingredient found in this recipe to adjust.");
    const waterIdx = ingredients.findIndex(i => /^water$/i.test(String(i.name).trim()));

    const spiritABV = Number(ingredients[alcoholIdx].abv_percent) || 0;
    if (!spiritABV) throw new Error("The alcohol ingredient needs an ABV% set before solving.");

    const currentSpiritML = toML(ingredients[alcoholIdx].amount, ingredients[alcoholIdx].unit);
    const targetSpiritML = (targetABVPercent / 100) * totalML / (spiritABV / 100);
    const deltaML = targetSpiritML - currentSpiritML;

    // write back the new spirit amount, in its original unit
    const newSpiritAmount = fromML(targetSpiritML, ingredients[alcoholIdx].unit);
    ingredients[alcoholIdx].amount = round4(newSpiritAmount);

    let warning = "";
    if (waterIdx !== -1) {
      const currentWaterML = toML(ingredients[waterIdx].amount, ingredients[waterIdx].unit);
      const newWaterML = currentWaterML - deltaML;
      if (newWaterML < 0) throw new Error("Not enough water in this recipe to absorb that much extra spirit -- try a lower target ABV.");
      ingredients[waterIdx].amount = round4(fromML(newWaterML, ingredients[waterIdx].unit));
    } else {
      // no water to compensate with -- total volume will drift by deltaML
      warning = "No ingredient named “Water” was found, so total batch volume will shift slightly instead of staying fixed.";
    }

    // Pure: never touches the passed-in recipe; warning rides on the returned copy.
    const updated = { ...recipe, ingredients, _targetAbvWarning: warning };
    updated._solvedABV = computeABV(updated);
    return updated;
  }

  // Solve for how much of the alcohol ingredient to ADD to an already-fixed
  // base mix (cider + juice + sugar, etc.) to hit a target ABV. Unlike
  // solveForTargetABV, batch size is NOT held fixed and no "Water" ingredient
  // is required -- final volume is simply base + alcohol added, mirroring the
  // real production step of pouring spirit into a finished non-alcoholic mix.
  function solveAddAlcohol(recipe, targetABVPercent) {
    const ingredients = (recipe.ingredients || []).map(i => ({ ...i }));
    const alcoholIdx = ingredients.findIndex(i => i.is_alcohol);
    if (alcoholIdx === -1) throw new Error("No alcohol ingredient found in this recipe to solve for -- add one and check its Alcohol toggle.");
    const spirit = ingredients[alcoholIdx];
    const spiritABV = Number(spirit.abv_percent) || 0;
    if (!spiritABV) throw new Error("The alcohol ingredient needs an ABV% set before solving.");
    const target = Number(targetABVPercent);
    if (!target) throw new Error("Enter a target ABV.");
    if (target >= spiritABV) throw new Error("Target ABV must be lower than the added alcohol's ABV%.");

    // Effective volume + ethanol already contributed by every OTHER ingredient
    // (the base mix) -- reuses the same type/Vol.% contribution model as the
    // ABV estimator, so dry sugar and strained fruit are handled consistently.
    let baseML = 0, baseAlcoholML = 0;
    ingredients.forEach((ing, idx) => {
      if (idx === alcoholIdx) return;
      const v = toML(ing.amount, ing.unit);
      if (v === null) return;
      baseML += v * contributionOf(ing);
      if (ing.is_alcohol) baseAlcoholML += v * ((Number(ing.abv_percent) || 0) / 100);
    });
    if (!baseML) throw new Error("Add the base-mix ingredients (cider, juice, sugar, etc.) with amounts first.");

    // target% * (base + spirit) = baseAlcoholML + spirit * spiritABV%
    const spiritFrac = spiritABV / 100, targetFrac = target / 100;
    const spiritML = (targetFrac * baseML - baseAlcoholML) / (spiritFrac - targetFrac);
    if (spiritML < 0) throw new Error("Base mix is already at or above the target ABV -- lower the target or check ingredient ABVs.");

    const newSpiritAmount = fromML(spiritML, spirit.unit);
    if (newSpiritAmount === null) throw new Error("The alcohol ingredient's unit needs to be a convertible volume (mL, oz, gal, etc).");
    ingredients[alcoholIdx].amount = round4(newSpiritAmount);

    const finalML = baseML + spiritML;
    const updated = { ...recipe, ingredients };
    updated._addAlcoholFinalML = finalML;
    updated._solvedABV = ((baseAlcoholML + spiritML * spiritFrac) / finalML) * 100;
    return updated;
  }

  // Mirror image of solveAddAlcohol: solve how much of a chosen NON-alcoholic
  // ingredient to add to bring a too-strong mix down to a target ABV. Batch size
  // grows to fit, nothing else is touched. `diluentIdx` picks the ingredient that
  // absorbs the change, so a recipe can be brought down with juice or cider
  // rather than assuming water.
  function solveAddDiluent(recipe, targetABVPercent, diluentIdx) {
    const ingredients = (recipe.ingredients || []).map(i => ({ ...i }));
    const idx = Number(diluentIdx);
    const diluent = ingredients[idx];
    if (!diluent) throw new Error("Choose which ingredient to add.");
    if (diluent.is_alcohol) throw new Error("Pick a non-alcoholic ingredient to dilute with.");
    if (!isVolumeUnit(diluent.unit)) {
      throw new Error("The ingredient you're adding needs a convertible volume unit (mL, oz, cups, gal…).");
    }
    const target = Number(targetABVPercent);
    if (!target) throw new Error("Enter a target ABV.");

    // Everything except the diluent is fixed; the diluent's CURRENT amount is
    // part of that base too — we're solving for how much MORE to add.
    let baseML = 0, baseAlcoholML = 0;
    ingredients.forEach(ing => {
      const v = toML(ing.amount, ing.unit);
      if (v === null) return;
      baseML += v * contributionOf(ing);
      if (ing.is_alcohol) baseAlcoholML += v * ((Number(ing.abv_percent) || 0) / 100);
    });
    if (!baseML) throw new Error("Add the recipe's ingredients with amounts first.");
    if (!baseAlcoholML) throw new Error("This recipe has no alcohol to dilute.");

    const currentABV = (baseAlcoholML / baseML) * 100;
    if (target >= currentABV) {
      throw new Error("Target must be lower than the current " + currentABV.toFixed(2) +
        "% ABV — to raise it, use “add alcohol” instead.");
    }

    // target% * (base + added) = baseAlcohol  ->  added = baseAlcohol/target% - base
    const addedEffectiveML = (baseAlcoholML / (target / 100)) - baseML;
    // The solve is in EFFECTIVE volume; convert back through the ingredient's
    // contribution factor so a diluent that isn't pure liquid still lands right.
    const factor = contributionOf(diluent);
    if (!factor) throw new Error("That ingredient contributes no volume, so it can't dilute the mix.");
    const addedMeasuredML = addedEffectiveML / factor;

    const currentML = toML(diluent.amount, diluent.unit) || 0;
    const newAmount = fromML(currentML + addedMeasuredML, diluent.unit);
    ingredients[idx].amount = round4(newAmount);

    const finalML = baseML + addedEffectiveML;
    const updated = { ...recipe, ingredients };
    updated._addDiluentFinalML = finalML;
    updated._addedAmount = round4(fromML(addedMeasuredML, diluent.unit));
    updated._addedUnit = diluent.unit;
    updated._solvedABV = (baseAlcoholML / finalML) * 100;
    return updated;
  }

  // TTB labeling tolerance for distilled spirits: the actual alcohol content may
  // sit within ±0.3 percentage points of what the label declares (27 CFR
  // 5.37(b)). Note this is the labeling tolerance only — it never excuses a
  // product falling outside the standard of identity for its class or type, and
  // a product also has to keep matching the formula TTB approved.
  const ABV_TOLERANCE = 0.3;

  // Compare a measured or calculated ABV against the TTB-declared figure —
  // whether that came from an approved formula or an approved label. Returns
  // null when either number is missing.
  function abvCompliance(actualABV, declaredABV) {
    const a = Number(actualABV), d = Number(declaredABV);
    if (!isFinite(a) || !isFinite(d) || actualABV === "" || declaredABV === "" ||
        actualABV == null || declaredABV == null) return null;
    const delta = a - d;
    return {
      delta: delta,
      within: Math.abs(delta) <= ABV_TOLERANCE + 1e-9,
      low: d - ABV_TOLERANCE,
      high: d + ABV_TOLERANCE,
    };
  }

  function round4(n) { return Math.round(n * 10000) / 10000; }

  return {
    ML_PER_UNIT, isVolumeUnit, toML, fromML,
    ING_TYPES, guessIngredientType, contributionOf, estimateFinalVolumeML,
    computeABV, computeModeledABV, scaleByFactor, scaleToBatchSize,
    solveForTargetABV, solveAddAlcohol, solveAddDiluent,
    ABV_TOLERANCE, abvCompliance
  };
})();
