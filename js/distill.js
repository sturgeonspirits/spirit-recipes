// v1.5.0 (2026-07-07): readingSpan now also summarizes pH (phRange/first/last).
// v1.4.0 (2026-07-06): + readingSpan/sortedReadings for the fermentation log.
// v1.3.0: distilling math — gravity/ABV, attenuation, proof gallons / LAA, and
// distillation yield. Dependency-free (reuses window.ABV for volume unit
// conversion when available). Full history: CHANGELOG.md
window.DISTILL = (function () {
  const ML_PER_GALLON = 3785.41;   // US gallon
  const ML_PER_LITER = 1000;

  function num(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  // Convert a volume+unit to mL. Reuse ABV's converter if loaded, else handle
  // the common distilling units directly.
  function toML(amount, unit) {
    const a = num(amount);
    if (a === null) return null;
    if (window.ABV && typeof window.ABV.toML === "function") {
      const v = window.ABV.toML(a, unit);
      if (v !== null) return v;
    }
    const key = String(unit || "").trim().toLowerCase();
    const table = { ml: 1, l: 1000, liter: 1000, liters: 1000, gal: ML_PER_GALLON, gallon: ML_PER_GALLON, gallons: ML_PER_GALLON };
    return table[key] !== undefined ? a * table[key] : null;
  }

  // ABV% estimate from original & final gravity (standard homebrew/distilling
  // formula). ABV ≈ (OG - FG) × 131.25
  function abvFromGravity(og, fg) {
    const o = num(og), f = num(fg);
    if (o === null || f === null || o <= f) return null;
    return (o - f) * 131.25;
  }

  // Apparent attenuation % — how much of the sugar the yeast consumed.
  function attenuation(og, fg) {
    const o = num(og), f = num(fg);
    if (o === null || f === null || o <= 1) return null;
    return ((o - f) / (o - 1)) * 100;
  }

  // Proof (US) = ABV × 2.
  function proof(abv) {
    const a = num(abv);
    return a === null ? null : a * 2;
  }

  // US proof gallons = wine gallons × (proof / 100). Wine gallons = actual
  // volume; proof gallons is the excise-tax / TTB production unit.
  function proofGallons(volume, unit, abv) {
    const ml = toML(volume, unit);
    const a = num(abv);
    if (ml === null || a === null) return null;
    const wineGallons = ml / ML_PER_GALLON;
    return wineGallons * (a * 2) / 100;
  }

  // Liters of absolute (pure) alcohol — the metric equivalent used on many
  // spirit-run logs.
  function laaLiters(volume, unit, abv) {
    const ml = toML(volume, unit);
    const a = num(abv);
    if (ml === null || a === null) return null;
    return (ml / ML_PER_LITER) * (a / 100);
  }

  // Pure-alcohol volume in mL for any volume+abv (used for efficiency math).
  function alcoholML(volume, unit, abv) {
    const ml = toML(volume, unit);
    const a = num(abv);
    if (ml === null || a === null) return null;
    return ml * (a / 100);
  }

  // Distillation recovery: hearts pure-alcohol ÷ wash pure-alcohol, as a %.
  // Answers "what fraction of the alcohol in the wash ended up in my hearts?"
  function heartsRecovery(run) {
    const heartsAlc = alcoholML(run.hearts_volume, run.volume_unit, run.hearts_abv);
    const washAlc = alcoholML(run.wash_volume, run.volume_unit, run.wash_abv);
    if (heartsAlc === null || washAlc === null || washAlc === 0) return null;
    return (heartsAlc / washAlc) * 100;
  }

  // Total pure-alcohol recovery across all named cuts vs the wash (a sanity
  // check — should be reasonably high if measurements are good).
  function totalRecovery(run) {
    const washAlc = alcoholML(run.wash_volume, run.volume_unit, run.wash_abv);
    if (washAlc === null || washAlc === 0) return null;
    let out = 0;
    ["heads", "hearts", "tails"].forEach(cut => {
      const a = alcoholML(run[cut + "_volume"], run.volume_unit, run[cut + "_abv"]);
      if (a !== null) out += a;
    });
    return (out / washAlc) * 100;
  }

  // Convenience: derive the run's effective wash ABV. Use the measured value
  // if present, otherwise estimate it from OG/FG.
  function washABV(run) {
    const measured = num(run.wash_abv);
    if (measured !== null) return measured;
    return abvFromGravity(run.ferment_og, run.ferment_fg);
  }

  // ---- Fermentation gravity log helpers (v1.4.0) ----
  function toDate(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // Readings sorted chronologically, with numeric gravity attached. Non-numeric
  // gravities are dropped.
  function sortedReadings(readings) {
    return (readings || [])
      .map(r => ({ ref: r, g: num(r.gravity), d: toDate(r.reading_date) }))
      .filter(r => r.g !== null)
      .sort((a, b) => (a.d && b.d) ? a.d - b.d : 0);
  }

  // Summary of a fermentation log: derived OG (first reading), FG (last),
  // elapsed days, reading count, the ordered gravity series, and the aligned
  // temperature series (null where a reading has no temp).
  function readingSpan(readings) {
    const s = sortedReadings(readings);
    if (!s.length) return null;
    const og = s[0].g, fg = s[s.length - 1].g;
    let days = null;
    const d0 = s[0].d, d1 = s[s.length - 1].d;
    if (d0 && d1) days = Math.round((d1 - d0) / 86400000);
    const temps = s.map(r => num(r.ref.temp));
    const tvals = temps.filter(t => t !== null);
    const tempRange = tvals.length ? { min: Math.min.apply(null, tvals), max: Math.max.apply(null, tvals) } : null;
    const phs = s.map(r => num(r.ref.ph));
    const pvals = phs.filter(p => p !== null);
    const phRange = pvals.length ? { min: Math.min.apply(null, pvals), max: Math.max.apply(null, pvals) } : null;
    return {
      og, fg, days, count: s.length,
      gravities: s.map(r => r.g),
      temps, tempRange,
      hasTemp: tvals.length >= 2,
      phs, phRange,
      phFirst: pvals.length ? pvals[0] : null,
      phLast: pvals.length ? pvals[pvals.length - 1] : null,
      hasPh: pvals.length >= 1
    };
  }

  // Round to n decimals, returning null passthrough.
  function round(n, dp) {
    if (n === null || n === undefined || isNaN(n)) return null;
    const f = Math.pow(10, dp === undefined ? 2 : dp);
    return Math.round(n * f) / f;
  }

  return {
    num, toML, abvFromGravity, attenuation, proof, proofGallons, laaLiters,
    alcoholML, heartsRecovery, totalRecovery, washABV, round,
    toDate, sortedReadings, readingSpan,
    ML_PER_GALLON, ML_PER_LITER
  };
})();
