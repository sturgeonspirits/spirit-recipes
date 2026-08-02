// v1.14.0 (2026-08-02): Display-only unit conversion for Make mode. Full history: CHANGELOG.md
//
// Converts an amount for DISPLAY only — nothing here ever writes back to a
// recipe. The point is bench convenience: a recipe stored in mL can be read off
// in cups or gallons without touching the saved numbers (or the ABV math, which
// stays on window.ABV's mL model).
//
// Sizing is per ingredient, not per recipe: 10 tsp should never be shown as
// gallons, and 5 gallons should never be shown as teaspoons. Each amount picks
// the unit that makes it easiest to measure at its own magnitude.
window.UNITS = (function () {
  // Ladders are ordered small -> large. Factor is in the family's base unit
  // (mL for volume, g for weight).
  const VOLUME = {
    metric: [
      { unit: "mL", factor: 1 },
      { unit: "L",  factor: 1000 },
    ],
    us: [
      { unit: "tsp",   factor: 4.92892 },
      { unit: "tbsp",  factor: 14.7868 },
      { unit: "fl oz", factor: 29.5735 },
      { unit: "cup",   factor: 236.588, plural: "cups" },
      { unit: "pt",    factor: 473.176 },
      { unit: "qt",    factor: 946.353 },
      { unit: "gal",   factor: 3785.41 },
    ],
  };
  const WEIGHT = {
    metric: [
      { unit: "g",  factor: 1 },
      { unit: "kg", factor: 1000 },
    ],
    us: [
      { unit: "oz wt", factor: 28.3495 },
      { unit: "lb",    factor: 453.592 },
    ],
  };

  // Aliases -> { family, system, factor }. Note "oz" alone stays FLUID ounces,
  // matching how the rest of the app (and window.ABV) has always read it;
  // weight ounces have to be written "oz wt" so an existing recipe can't be
  // silently reinterpreted.
  const ALIASES = {};
  function alias(names, family, system, factor) {
    names.forEach(n => { ALIASES[n.toLowerCase()] = { family, system, factor }; });
  }
  alias(["ml", "milliliter", "milliliters", "millilitre", "millilitres"], "volume", "metric", 1);
  alias(["l", "liter", "liters", "litre", "litres"], "volume", "metric", 1000);
  alias(["tsp", "teaspoon", "teaspoons"], "volume", "us", 4.92892);
  alias(["tbsp", "tbs", "tablespoon", "tablespoons"], "volume", "us", 14.7868);
  alias(["oz", "fl oz", "floz", "fluid ounce", "fluid ounces"], "volume", "us", 29.5735);
  alias(["cup", "cups"], "volume", "us", 236.588);
  alias(["pt", "pint", "pints"], "volume", "us", 473.176);
  alias(["qt", "quart", "quarts"], "volume", "us", 946.353);
  alias(["gal", "gallon", "gallons"], "volume", "us", 3785.41);
  alias(["g", "gram", "grams"], "weight", "metric", 1);
  alias(["kg", "kilogram", "kilograms"], "weight", "metric", 1000);
  alias(["oz wt", "ozwt", "wt oz", "ounce", "ounces"], "weight", "us", 28.3495);
  alias(["lb", "lbs", "pound", "pounds"], "weight", "us", 453.592);

  function lookup(unit) {
    return ALIASES[String(unit || "").trim().toLowerCase()] || null;
  }
  function isConvertible(unit) { return lookup(unit) !== null; }

  function ladderFor(family, system) {
    return (family === "weight" ? WEIGHT : VOLUME)[system] || [];
  }

  // ---------- formatting ----------
  const FRACTIONS = [
    [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"],
    [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"],
    [7 / 8, "⅞"],
  ];
  const FRACTION_TOL = 0.005; // only show a fraction if it's within 0.5% of true

  // Decimal fallback: enough places that the displayed number is always within
  // ~0.5% of the real amount, without a wall of digits.
  function decimalStr(v) {
    const a = Math.abs(v);
    const dp = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
    return String(Number(v.toFixed(dp)));
  }

  // "1 2/3" style, but only when it's honest to the half-percent.
  function numberStr(v, useFractions) {
    if (!isFinite(v)) return "";
    if (!useFractions) return decimalStr(v);
    const whole = Math.floor(v);
    const rem = v - whole;
    if (rem < FRACTION_TOL * Math.max(v, 1)) return String(whole || Number(v.toFixed(3)));
    for (const [val, glyph] of FRACTIONS) {
      if (Math.abs(rem - val) <= FRACTION_TOL * Math.max(v, 1)) {
        return whole ? whole + glyph : glyph;
      }
    }
    return decimalStr(v);
  }

  function labelFor(step, v) {
    return (step.plural && Math.abs(v) !== 1) ? step.plural : step.unit;
  }

  // ---------- best fit ----------
  // Score every rung of the ladder and take the friendliest. Lower is better.
  //   - closeness to a clean measurable number dominates
  //   - values under 1 are penalised (nobody measures "0.79 qt")
  //   - values over ~100 are penalised (nobody counts 152 tsp)
  //   - a mild bonus for bigger units breaks ties upward
  function cleanErr(v, useFractions) {
    if (v >= 20) {
      const t = Math.round(v);
      return t ? Math.abs(v - t) / v : 1;
    }
    let best = Math.abs(v - Math.round(v)) / v;
    if (useFractions) {
      const whole = Math.floor(v);
      const rem = v - whole;
      FRACTIONS.forEach(([val]) => {
        best = Math.min(best, Math.abs(rem - val) / v);
      });
    } else {
      const step = v >= 10 ? 1 : v >= 1 ? 0.1 : 0.01;
      best = Math.min(best, Math.abs(v - Math.round(v / step) * step) / v);
    }
    return best;
  }

  function bestStep(base, family, system) {
    const ladder = ladderFor(family, system);
    const useFractions = system === "us";
    let winner = null, winnerScore = Infinity;
    ladder.forEach((step, i) => {
      const v = base / step.factor;
      if (v < 0.25 || v > 1000) return;           // absurd in this unit
      let score = cleanErr(v, useFractions) * 10;
      if (v < 1) score += 1.5;
      if (v > 100) score += 1.0;
      score -= i * 0.1;                            // prefer the larger unit on ties
      if (score < winnerScore) { winnerScore = score; winner = step; }
    });
    if (winner) return winner;
    // Out of range in every rung: clamp to the smallest unit for tiny amounts,
    // the largest for huge ones, rather than refusing to convert.
    const v0 = base / ladder[0].factor;
    return v0 < 1 ? ladder[0] : ladder[ladder.length - 1];
  }

  // ---------- public conversion ----------
  // mode: "as-written" | "auto" | "metric" | "us"
  //   auto   — best fit inside the amount's own measurement system
  //   metric — force mL/L (or g/kg), best fit within it
  //   us     — force tsp…gal (or oz wt/lb), best fit within it
  // Anything non-convertible ("parts", "each", blank) comes back untouched.
  function convert(amount, unit, mode) {
    const num = Number(amount);
    const src = lookup(unit);
    const raw = { amount: amount, unit: unit || "", text: "", converted: false, exact: null };
    if (!mode || mode === "as-written" || !src || amount === "" || amount == null || isNaN(num)) {
      raw.text = (amount === "" || amount == null || isNaN(num))
        ? "" : decimalStr(num);
      raw.exact = isNaN(num) ? null : num;
      return raw;
    }
    const system = mode === "auto" ? src.system : mode;
    const base = num * src.factor;                 // mL or g
    const step = bestStep(base, src.family, system);
    const v = base / step.factor;
    const useFractions = system === "us";
    return {
      amount: v,
      unit: labelFor(step, v),
      text: numberStr(v, useFractions),
      exact: v,
      converted: !(step.factor === src.factor && system === src.system),
    };
  }

  // Same conversion, returned as one display string ("1⅔ fl oz").
  function format(amount, unit, mode) {
    const r = convert(amount, unit, mode);
    if (r.text === "") return "";
    return r.unit ? `${r.text} ${r.unit}` : r.text;
  }

  const MODES = [
    { id: "as-written", label: "As written" },
    { id: "auto",       label: "Auto" },
    { id: "metric",     label: "Metric" },
    { id: "us",         label: "US" },
  ];

  return { MODES, convert, format, isConvertible, lookup, numberStr, decimalStr, bestStep };
})();
