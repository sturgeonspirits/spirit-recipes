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

  // Compute ABV of a recipe from its ingredient list + declared batch size.
  // Falls back to summing convertible ingredient volumes if batch_size/unit is missing.
  function computeABV(recipe) {
    const ingredients = recipe.ingredients || [];
    let totalML = toML(recipe.batch_size, recipe.batch_unit);
    if (totalML === null || !totalML) {
      totalML = 0;
      ingredients.forEach(ing => {
        const v = toML(ing.amount, ing.unit);
        if (v !== null) totalML += v;
      });
    }
    if (!totalML) return null;

    let alcoholML = 0;
    ingredients.forEach(ing => {
      if (!ing.is_alcohol) return;
      const v = toML(ing.amount, ing.unit);
      const pct = Number(ing.abv_percent) || 0;
      if (v !== null) alcoholML += v * (pct / 100);
    });

    return (alcoholML / totalML) * 100;
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

  function round4(n) { return Math.round(n * 10000) / 10000; }

  return { ML_PER_UNIT, isVolumeUnit, toML, fromML, computeABV, scaleByFactor, scaleToBatchSize, solveForTargetABV };
})();
