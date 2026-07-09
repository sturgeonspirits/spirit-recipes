// v1.10.1 (2026-07-09): run editor no longer clobbers a manually-entered OG/FG
// with older gravity-log values on open; Wash ABV stat shows its source
// (measured vs OG–FG) and the field's placeholder shows the live auto value.
// v1.10.0: additions/tweaks AND gravity-reading editors rebuilt as
// labeled cards so they're readable on a phone (were cramped grids). v1.8.0: + suggested-cuts panel (best-practice foreshots/heads/
// hearts/tails guidance with foreshots mL + expected pure alcohol) on the run
// form. v1.7.0: + Compare runs table with tweak highlighter, and a live
// predicted-ABV readout from OG on the run form. v1.6.0: +
// per-run additions/tweaks list. v1.5.0: + pH tracking in the fermentation log.
// v1.4.0: + fermentation gravity log, live curve, Tilt import. v1.3.0: mash
// detail — components, live calcs, run log. Full history: CHANGELOG.md
(async function () {
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const banner = document.getElementById("demo-banner");
  if (window.API.demoMode) banner.style.display = "block";

  if (!id) {
    document.getElementById("mash-title").textContent = "No mash id given";
    return;
  }

  const COMPONENT_CATEGORIES = ["grain", "sugar/adjunct", "enzyme", "nutrient", "acid/pH", "yeast", "water", "other"];
  const D = window.DISTILL;

  let mash;
  try {
    mash = await window.API.getMash(id);
  } catch (err) {
    document.getElementById("mash-title").textContent = "Failed to load: " + err.message;
    return;
  }
  if (!mash || mash.error) {
    document.getElementById("mash-title").textContent = "Mash recipe not found";
    return;
  }
  mash.components = mash.components || [];
  mash.runs = mash.runs || [];

  const $ = id => document.getElementById(id);
  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmt(n, dp) { const r = D.round(n, dp); return r === null ? "—" : String(r); }

  // ---------- Header + field population ----------
  document.getElementById("mash-title").textContent = mash.name || "Mash Recipe";
  document.title = (mash.name || "Mash Recipe") + " — Distilling";

  const FIELD_MAP = {
    "f-name": "name", "f-spirit-type": "spirit_type", "f-linked-recipe": "linked_recipe_id",
    "f-batch-volume": "batch_volume", "f-volume-unit": "volume_unit",
    "f-mash-water": "mash_water_volume", "f-water-unit": "water_unit",
    "f-strike-temp": "strike_temp", "f-mash-ph": "mash_ph",
    "f-target-og": "target_og", "f-target-fg": "target_fg",
    "f-yeast-strain": "yeast_strain", "f-pitch-rate": "pitch_rate",
    "f-ferment-temp": "ferment_temp", "f-ferment-days": "ferment_days",
    "f-target-yield": "target_yield", "f-yield-unit": "yield_unit", "f-notes": "notes"
  };
  Object.entries(FIELD_MAP).forEach(([dom, key]) => {
    const el = $(dom);
    if (el) el.value = mash[key] != null ? mash[key] : "";
  });

  $("f-name").addEventListener("input", () => {
    const v = $("f-name").value.trim() || "Mash Recipe";
    document.getElementById("mash-title").textContent = v;
    document.title = v + " — Distilling";
  });

  // Populate linked-product dropdown from the product catalog (best-effort).
  try {
    const recipes = await window.API.getAllRecipes();
    const sel = $("f-linked-recipe");
    recipes.sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.recipe_id; opt.textContent = r.name;
      sel.appendChild(opt);
    });
    sel.value = mash.linked_recipe_id || "";
  } catch (_) { /* offline / demo — leave dropdown with just "none" */ }

  // ---------- Live summary calcs ----------
  function updateSummary() {
    const og = $("f-target-og").value, fg = $("f-target-fg").value;
    const abv = D.abvFromGravity(og, fg);
    const atten = D.attenuation(og, fg);
    $("calc-abv").textContent = abv === null ? "—" : "~" + abv.toFixed(1) + "%";
    $("calc-atten").textContent = atten === null ? "—" : atten.toFixed(0) + "%";
    const bv = $("f-batch-volume").value;
    $("calc-batch").textContent = bv ? fmt(bv) + " " + ($("f-volume-unit").value || "") : "—";
  }
  ["f-target-og", "f-target-fg", "f-batch-volume", "f-volume-unit"].forEach(d => $(d).addEventListener("input", updateSummary));
  updateSummary();

  // ---------- Components (mash bill + additions) ----------
  const compEl = $("components-body");
  function renderComponents() {
    compEl.innerHTML = "";
    if (!mash.components.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "text-align:center;padding:10px 0";
      empty.textContent = "No components yet — add grains, sugars, enzymes, nutrients, yeast…";
      compEl.appendChild(empty);
    }
    mash.components.forEach((c, idx) => {
      const card = document.createElement("div");
      card.className = "ing-card comp-card";
      const opts = COMPONENT_CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join("");
      card.innerHTML = `
        <div class="ing-name">
          <input type="text" data-f="component" placeholder="Component name" aria-label="Component name">
          <button class="btn-remove" data-action="remove" aria-label="Remove component">✕</button>
        </div>
        <div class="mini"><label>Category</label>
          <select data-f="category">${opts}</select></div>
        <div class="mini"><label>Amount</label>
          <input type="number" step="any" inputmode="decimal" data-f="amount"></div>
        <div class="mini"><label>Unit</label>
          <input type="text" data-f="unit" placeholder="kg, g, mL…"></div>
        <div class="mini"><label>Timing</label>
          <input type="text" data-f="timing" placeholder="mash, fermentation…"></div>
        <div class="mini comp-notes"><label>Notes</label>
          <input type="text" data-f="notes" placeholder="optional"></div>
      `;
      card.querySelector('[data-f="component"]').value = c.component || "";
      card.querySelector('[data-f="category"]').value = COMPONENT_CATEGORIES.includes(c.category) ? c.category : "other";
      card.querySelector('[data-f="amount"]').value = c.amount ?? "";
      card.querySelector('[data-f="unit"]').value = c.unit || "";
      card.querySelector('[data-f="timing"]').value = c.timing || "";
      card.querySelector('[data-f="notes"]').value = c.notes || "";

      card.querySelectorAll("input, select").forEach(input => {
        const evt = input.tagName === "SELECT" ? "change" : "input";
        input.addEventListener(evt, () => {
          let v = input.value;
          if (input.dataset.f === "amount") v = v === "" ? "" : Number(v);
          mash.components[idx][input.dataset.f] = v;
        });
      });
      card.querySelector('[data-action="remove"]').addEventListener("click", () => {
        mash.components.splice(idx, 1);
        renderComponents();
      });
      compEl.appendChild(card);
    });
  }
  $("add-component").addEventListener("click", () => {
    mash.components.push({ component: "", category: "grain", amount: "", unit: "", timing: "mash", notes: "" });
    renderComponents();
    const names = compEl.querySelectorAll('[data-f="component"]');
    if (names.length) names[names.length - 1].focus();
  });
  renderComponents();

  // ---------- Distillation runs ----------
  const runsBody = $("runs-body");
  function runStat(label, value) {
    return `<div class="run-stat"><span class="run-stat-label">${label}</span><span class="run-stat-val">${value}</span></div>`;
  }
  // pH summary for a fermentation span: start→end if it moved, else a single
  // value. Returns "" when no pH was logged. Leading " · " so it appends inline.
  function phValue(span) {
    if (!span || !span.hasPh) return "—";
    const a = D.round(span.phFirst, 2), b = D.round(span.phLast, 2);
    return a === b ? String(a) : a + "→" + b;
  }
  function phText(span) {
    return (!span || !span.hasPh) ? "" : " · pH " + phValue(span);
  }
  // Compact chips row of a run's additions/tweaks (item + amount/unit).
  function additionsSummary(additions) {
    const list = (additions || []).filter(a => a.item && String(a.item).trim() !== "");
    if (!list.length) return "";
    const chips = list.map(a => {
      const amt = (a.amount !== "" && a.amount != null) ? " " + escapeHTML(String(a.amount)) + (a.unit ? " " + escapeHTML(a.unit) : "") : "";
      return `<span class="add-chip">${escapeHTML(a.item)}${amt}</span>`;
    }).join("");
    return `<div class="run-additions"><span class="run-additions-label">Tweaks</span>${chips}</div>`;
  }
  function renderRuns() {
    $("runs-count").textContent = mash.runs.length ? `(${mash.runs.length})` : "";
    if (!mash.runs.length) {
      runsBody.innerHTML = `<div class="muted" style="padding:8px 0">No runs logged yet. Tap “Log a run” after your next distillation.</div>`;
      return;
    }
    const sorted = mash.runs.slice().sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)));
    runsBody.innerHTML = sorted.map(run => {
      const washAbv = D.washABV(run);
      const pg = D.proofGallons(run.hearts_volume, run.volume_unit, run.hearts_abv);
      const laa = D.laaLiters(run.hearts_volume, run.volume_unit, run.hearts_abv);
      const rec = D.heartsRecovery(run);
      const hearts = run.hearts_volume ? `${fmt(run.hearts_volume)} ${escapeHTML(run.volume_unit || "")} @ ${fmt(run.hearts_abv)}%` : "—";
      const barrel = run.barrel_id ? `<span class="run-barrel">→ barrel ${escapeHTML(run.barrel_id)}${run.entry_proof ? " @ " + escapeHTML(String(run.entry_proof)) + " proof" : ""}</span>` : "";
      const span = D.readingSpan(run.readings);
      const ferment = span ? `<div class="run-ferment">
          <span class="spark-wrap">${fermChart(span.gravities, span.temps, 120, 34, { showTemp: span.hasTemp, showDots: false })}</span>
          <span class="run-ferment-txt">Ferment OG ${span.og} → FG ${span.fg}${span.days != null ? " · " + span.days + "d" : ""} · ${span.count} readings${span.hasTemp ? " · temp " + D.round(span.tempRange.min, 0) + "–" + D.round(span.tempRange.max, 0) + "°" : ""}${phText(span)}</span>
        </div>` : "";
      return `<div class="run-item" data-run="${escapeHTML(run.run_id)}">
        <div class="run-item-head">
          <div class="run-date">${escapeHTML(run.run_date || "(no date)")}${run.still_used ? ` · <span class="muted">${escapeHTML(run.still_used)}</span>` : ""}</div>
          <div class="run-actions">
            <button class="ghost run-edit" data-run="${escapeHTML(run.run_id)}">Edit</button>
            <button class="ghost run-del" data-run="${escapeHTML(run.run_id)}">Delete</button>
          </div>
        </div>
        <div class="run-stats">
          ${runStat("Wash ABV", washAbv === null ? "—" : fmt(washAbv) + "%")}
          ${runStat("Hearts", hearts)}
          ${runStat("Proof gal", pg === null ? "—" : fmt(pg))}
          ${runStat("LAA (L)", laa === null ? "—" : fmt(laa))}
          ${runStat("Recovery", rec === null ? "—" : fmt(rec, 0) + "%")}
        </div>
        ${ferment}
        ${additionsSummary(run.additions)}
        ${barrel}
        ${run.notes ? `<div class="run-note">${escapeHTML(run.notes)}</div>` : ""}
      </div>`;
    }).join("");

    runsBody.querySelectorAll(".run-edit").forEach(b => b.addEventListener("click", () => openRunModal(b.dataset.run)));
    runsBody.querySelectorAll(".run-del").forEach(b => b.addEventListener("click", () => deleteRun(b.dataset.run)));
    renderCompare();
  }

  // ---------- Compare runs (all runs of this recipe, side by side) ----------
  let compareFilter = "";  // lowercased tweak item to highlight, or "" for none
  function runAdditionItems(run) {
    return (run.additions || [])
      .filter(a => a.item && String(a.item).trim() !== "")
      .map(a => String(a.item).trim());
  }
  function renderCompare() {
    const wrap = $("runs-compare");
    const section = $("compare-section");
    const countEl = $("compare-count");
    if (!mash.runs.length) {
      if (section) section.style.display = "none";
      return;
    }
    if (section) section.style.display = "";
    countEl.textContent = `(${mash.runs.length})`;

    const sorted = mash.runs.slice().sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)));

    // Populate the tweak-highlight dropdown with the distinct items used.
    const items = Array.from(new Set(
      mash.runs.flatMap(runAdditionItems).map(s => s)
    )).sort((a, b) => a.localeCompare(b));
    const sel = $("compare-filter");
    const keep = sel.value;
    sel.innerHTML = `<option value="">— show all runs —</option>` +
      items.map(it => `<option value="${escapeHTML(it.toLowerCase())}">${escapeHTML(it)}</option>`).join("");
    sel.value = items.some(it => it.toLowerCase() === keep) ? keep : "";
    compareFilter = sel.value;

    const rows = sorted.map(run => {
      const span = D.readingSpan(run.readings);
      const og = span ? span.og : (run.ferment_og || "");
      const fg = span ? span.fg : (run.ferment_fg || "");
      const ogfg = (og || fg) ? `${og || "—"} → ${fg || "—"}` : "—";
      const abv = D.washABV(run);
      const days = span && span.days != null ? span.days : "—";
      const hearts = run.hearts_volume
        ? `${fmt(run.hearts_volume)} ${escapeHTML(run.volume_unit || "")} @ ${fmt(run.hearts_abv)}%` : "—";
      const pg = D.proofGallons(run.hearts_volume, run.volume_unit, run.hearts_abv);
      const rec = D.heartsRecovery(run);
      const tweakItems = runAdditionItems(run);
      const tweakChips = tweakItems.length
        ? (run.additions || []).filter(a => a.item && String(a.item).trim() !== "").map(a => {
            const amt = (a.amount !== "" && a.amount != null) ? " " + escapeHTML(String(a.amount)) + (a.unit ? " " + escapeHTML(a.unit) : "") : "";
            return `<span class="add-chip">${escapeHTML(a.item)}${amt}</span>`;
          }).join(" ")
        : `<span class="muted">—</span>`;
      const dataItems = tweakItems.map(i => i.toLowerCase()).join("|");
      return `<tr data-items="${escapeHTML(dataItems)}">
        <td class="c-date">${escapeHTML(run.run_date || "—")}</td>
        <td>${escapeHTML(ogfg)}</td>
        <td>${abv === null ? "—" : fmt(abv) + "%"}</td>
        <td>${escapeHTML(phValue(span))}</td>
        <td>${days === "—" ? "—" : days + "d"}</td>
        <td>${hearts}</td>
        <td>${pg === null ? "—" : fmt(pg)}</td>
        <td>${rec === null ? "—" : fmt(rec, 0) + "%"}</td>
        <td class="c-tweaks">${tweakChips}</td>
      </tr>`;
    }).join("");

    wrap.innerHTML = `<table class="compare-table">
      <thead><tr>
        <th>Date</th><th>OG → FG</th><th>Wash ABV</th><th>pH</th><th>Days</th>
        <th>Hearts</th><th>Proof gal</th><th>Recovery</th><th>Tweaks</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    applyCompareHighlight();
  }
  function applyCompareHighlight() {
    const wrap = $("runs-compare");
    wrap.querySelectorAll("tbody tr").forEach(tr => {
      tr.classList.remove("row-match", "row-dim");
      if (!compareFilter) return;
      const items = (tr.dataset.items || "").split("|");
      if (items.includes(compareFilter)) tr.classList.add("row-match");
      else tr.classList.add("row-dim");
    });
  }
  $("compare-filter").addEventListener("change", () => {
    compareFilter = $("compare-filter").value;
    applyCompareHighlight();
  });
  renderRuns();

  // ---------- Run modal ----------
  const modal = $("run-modal");
  const RUN_MAP = {
    "r-run-date": "run_date", "r-operator": "operator", "r-still": "still_used", "r-volume-unit": "volume_unit",
    "r-og": "ferment_og", "r-fg": "ferment_fg", "r-wash-abv": "wash_abv", "r-wash-volume": "wash_volume",
    "r-foreshots": "foreshots_volume", "r-heads-vol": "heads_volume", "r-heads-abv": "heads_abv",
    "r-hearts-vol": "hearts_volume", "r-hearts-abv": "hearts_abv", "r-tails-vol": "tails_volume", "r-tails-abv": "tails_abv",
    "r-cut-heads": "cut_temp_heads", "r-cut-tails": "cut_temp_tails", "r-duration": "run_duration",
    "r-barrel-id": "barrel_id", "r-barrel-date": "barrel_fill_date", "r-entry-proof": "entry_proof",
    "r-char": "char_level", "r-tilt-url": "tilt_sheet_url", "r-notes": "notes"
  };
  let editingRunId = null;
  let currentReadings = [];   // gravity log for the run being edited
  let currentAdditions = [];  // additions/tweaks for the run being edited

  // Build an inline SVG chart of a data series scaled to its own min/max, laid
  // out across the full width. Values that are null are skipped (the line
  // bridges the gap). Returns "" if fewer than 2 numeric points.
  function seriesPath(values, w, h, pad) {
    const nums = values.map(v => (v === "" || v == null || isNaN(v)) ? null : Number(v));
    const present = nums.filter(v => v !== null);
    if (present.length < 2) return null;
    const min = Math.min.apply(null, present);
    const max = Math.max.apply(null, present);
    const range = (max - min) || (Math.abs(min) || 1) * 0.01;
    const stepX = (w - pad * 2) / (nums.length - 1);
    const pts = [];
    nums.forEach((v, i) => {
      if (v === null) return;
      const x = pad + i * stepX;
      const y = pad + (h - pad * 2) * (1 - (v - min) / range); // higher value = higher line
      pts.push([x, y]);
    });
    return pts;
  }

  // Dual-line fermentation chart: gravity (accent) + temperature (warm), each on
  // its own scale. opts: { showTemp, showDots }.
  function fermChart(gravities, temps, w, h, opts) {
    opts = opts || {};
    const pad = 5;
    const gPts = seriesPath(gravities, w, h, pad);
    if (!gPts) return "";
    function toPath(pts) { return pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" "); }
    let svg = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="spark" preserveAspectRatio="none">`;
    // temperature first, so it sits behind gravity
    if (opts.showTemp && temps) {
      const tPts = seriesPath(temps, w, h, pad);
      if (tPts) {
        svg += `<path d="${toPath(tPts)}" fill="none" stroke="var(--temp)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"${opts.showDots ? "" : ' stroke-dasharray="3 2"'}/>`;
        if (opts.showDots) svg += `<g fill="var(--temp)">` + tPts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2"/>`).join("") + `</g>`;
      }
    }
    svg += `<path d="${toPath(gPts)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (opts.showDots) svg += `<g fill="var(--accent)">` + gPts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5"/>`).join("") + `</g>`;
    svg += `</svg>`;
    return svg;
  }

  // ---------- Run additions / tweaks ----------
  const additionsEl = $("additions-body");
  function renderAdditions() {
    additionsEl.innerHTML = "";
    if (!currentAdditions.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "padding:4px 0 8px";
      empty.textContent = "No tweaks logged for this run — add nutrients, yeast, acid, or anything you changed from the recipe.";
      additionsEl.appendChild(empty);
    }
    const opts = COMPONENT_CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join("");
    currentAdditions.forEach((ad, idx) => {
      const row = document.createElement("div");
      row.className = "ing-card comp-card add-card";
      row.innerHTML = `
        <div class="ing-name">
          <input type="text" data-f="item" placeholder="Item (e.g. SuperFerm)" aria-label="Addition item">
          <button type="button" class="btn-remove" data-action="remove" aria-label="Remove addition">✕</button>
        </div>
        <div class="mini"><label>Category</label>
          <select data-f="category">${opts}</select></div>
        <div class="mini"><label>Amount</label>
          <input type="number" step="any" inputmode="decimal" data-f="amount"></div>
        <div class="mini"><label>Unit</label>
          <input type="text" data-f="unit" placeholder="g, mL, cup…"></div>
        <div class="mini"><label>Timing</label>
          <input type="text" data-f="timing" placeholder="fermentation…"></div>
        <div class="mini comp-notes"><label>Why / result</label>
          <input type="text" data-f="notes" placeholder="e.g. testing vs usual nutrient"></div>
      `;
      row.querySelector('[data-f="item"]').value = ad.item || "";
      row.querySelector('[data-f="category"]').value = COMPONENT_CATEGORIES.includes(ad.category) ? ad.category : "nutrient";
      row.querySelector('[data-f="amount"]').value = ad.amount ?? "";
      row.querySelector('[data-f="unit"]').value = ad.unit || "";
      row.querySelector('[data-f="timing"]').value = ad.timing || "";
      row.querySelector('[data-f="notes"]').value = ad.notes || "";
      row.querySelectorAll("input, select").forEach(input => {
        const evt = input.tagName === "SELECT" ? "change" : "input";
        input.addEventListener(evt, () => {
          let v = input.value;
          if (input.dataset.f === "amount") v = v === "" ? "" : Number(v);
          currentAdditions[idx][input.dataset.f] = v;
        });
      });
      row.querySelector('[data-action="remove"]').addEventListener("click", () => {
        currentAdditions.splice(idx, 1);
        renderAdditions();
      });
      additionsEl.appendChild(row);
    });
  }
  $("add-addition").addEventListener("click", () => {
    currentAdditions.push({ item: "", category: "nutrient", amount: "", unit: "", timing: "fermentation", notes: "" });
    renderAdditions();
    const items = additionsEl.querySelectorAll('[data-f="item"]');
    if (items.length) items[items.length - 1].focus();
  });

  const readingsEl = $("readings-body");
  function renderReadings() {
    readingsEl.innerHTML = "";
    currentReadings.forEach((rd, idx) => {
      const row = document.createElement("div");
      row.className = "ing-card comp-card reading-card";
      row.innerHTML = `
        <div class="ing-name reading-when">
          <div class="mini"><label>Date</label>
            <input type="text" data-f="reading_date" placeholder="MM/DD/YYYY" aria-label="Reading date"></div>
          <div class="mini"><label>Time</label>
            <input type="text" data-f="reading_time" placeholder="hh:mm" aria-label="Reading time"></div>
          <button type="button" class="btn-remove" data-action="remove" aria-label="Remove reading">✕</button>
        </div>
        <div class="mini"><label>Gravity</label>
          <input type="number" step="any" inputmode="decimal" data-f="gravity" placeholder="SG" aria-label="Gravity"></div>
        <div class="mini"><label>Temp</label>
          <input type="number" step="any" inputmode="decimal" data-f="temp" placeholder="°" aria-label="Temp"></div>
        <div class="mini"><label>pH</label>
          <input type="number" step="any" inputmode="decimal" data-f="ph" placeholder="pH" aria-label="pH"></div>
        <div class="mini comp-notes"><label>Notes</label>
          <input type="text" data-f="notes" placeholder="e.g. OG, pitched yeast…" aria-label="Reading notes"></div>
      `;
      row.querySelector('[data-f="reading_date"]').value = rd.reading_date || "";
      row.querySelector('[data-f="reading_time"]').value = rd.reading_time || "";
      row.querySelector('[data-f="gravity"]').value = rd.gravity ?? "";
      row.querySelector('[data-f="temp"]').value = rd.temp ?? "";
      row.querySelector('[data-f="ph"]').value = rd.ph ?? "";
      row.querySelector('[data-f="notes"]').value = rd.notes || "";
      row.querySelectorAll("input").forEach(input => {
        input.addEventListener("input", () => {
          let v = input.value;
          if (input.dataset.f === "gravity" || input.dataset.f === "temp" || input.dataset.f === "ph") v = v === "" ? "" : Number(v);
          currentReadings[idx][input.dataset.f] = v;
          updateReadingDerived();
        });
      });
      row.querySelector('[data-action="remove"]').addEventListener("click", () => {
        currentReadings.splice(idx, 1);
        renderReadings();
        updateReadingDerived();
      });
      readingsEl.appendChild(row);
    });
  }

  // Auto-fill OG/FG from the log's first/last reading and draw the curve.
  // opts.fillBlanksOnly: only fill OG/FG when the field is empty — used on
  // modal open so a manually-entered (latest) OG/FG isn't clobbered by an
  // older gravity log. Reading edits/imports still overwrite both.
  function updateReadingDerived(opts) {
    const fillBlanksOnly = !!(opts && opts.fillBlanksOnly);
    const span = D.readingSpan(currentReadings);
    const chart = $("gravity-chart");
    if (span) {
      if (!fillBlanksOnly || $("r-og").value === "") $("r-og").value = span.og;
      if (!fillBlanksOnly || $("r-fg").value === "") $("r-fg").value = span.fg;
      const svg = fermChart(span.gravities, span.temps, 280, 64, { showTemp: span.hasTemp, showDots: true });
      const tempCap = span.tempRange ? ` · temp ${D.round(span.tempRange.min, 0)}–${D.round(span.tempRange.max, 0)}°` : "";
      const phCap = phText(span);
      const legend = span.hasTemp
        ? `<div class="chart-legend"><span class="lg lg-sg">SG</span><span class="lg lg-temp">Temp</span></div>` : "";
      chart.innerHTML = svg
        ? `${legend}${svg}<div class="chart-caption">OG ${span.og} → FG ${span.fg}${span.days != null ? " · " + span.days + " day" + (span.days === 1 ? "" : "s") : ""} · ${span.count} readings${tempCap}${phCap}</div>`
        : `<div class="chart-caption">OG ${span.og}${span.count > 1 ? " → FG " + span.fg : ""} · ${span.count} reading${span.count === 1 ? "" : "s"}${phCap}</div>`;
      chart.hidden = false;
    } else {
      chart.hidden = true;
      chart.innerHTML = "";
    }
    updateRunCalc();
  }

  $("add-reading").addEventListener("click", () => {
    const last = currentReadings[currentReadings.length - 1];
    currentReadings.push({
      reading_date: (last && last.reading_date) || new Date().toLocaleDateString("en-US"),
      reading_time: "", gravity: "", temp: "", ph: "", notes: ""
    });
    renderReadings();
    const gravs = readingsEl.querySelectorAll('[data-f="gravity"]');
    if (gravs.length) gravs[gravs.length - 1].focus();
  });

  // Import a Tilt hydrometer export (.xlsx / .csv) into the gravity log.
  const tiltFile = $("tilt-file");
  const tiltStatus = $("tilt-status");
  function setTiltStatus(msg, kind) {
    tiltStatus.textContent = msg;
    tiltStatus.className = "tilt-status" + (kind ? " " + kind : "");
    tiltStatus.hidden = !msg;
  }
  $("import-tilt").addEventListener("click", () => tiltFile.click());
  tiltFile.addEventListener("change", async () => {
    const file = tiltFile.files && tiltFile.files[0];
    if (!file) return;
    setTiltStatus("Reading " + file.name + "…", "");
    try {
      const readings = await window.TILT.parseFile(file, 80);
      if (!readings.length) {
        setTiltStatus("No SG readings found in that file. Make sure it's a Tilt export with a Data or Report sheet.", "err");
        return;
      }
      const replace = !currentReadings.length ||
        confirm(`Found ${readings.length} readings.\n\nOK = replace the current log with them.\nCancel = append them to the existing log.`);
      currentReadings = replace ? readings : currentReadings.concat(readings);
      renderReadings();
      updateReadingDerived();
      setTiltStatus(`Imported ${readings.length} readings from ${file.name}.`, "ok");
    } catch (err) {
      setTiltStatus(err.message || String(err), "err");
    } finally {
      tiltFile.value = "";  // allow re-importing the same file
    }
  });

  // Sync gravity log directly from a Tilt Google Sheet (read server-side by the
  // Apps Script). Honors a #gid=... tab in the link, so a workbook with one tab
  // per batch works — paste the link while viewing that batch's tab.
  function applyImportedReadings(readings, sourceLabel) {
    const replace = !currentReadings.length ||
      confirm(`Found ${readings.length} readings.\n\nOK = replace the current log with them.\nCancel = append them to the existing log.`);
    currentReadings = replace ? readings : currentReadings.concat(readings);
    renderReadings();
    updateReadingDerived();
    setTiltStatus(`Imported ${readings.length} readings from ${sourceLabel}.`, "ok");
  }

  async function syncFromSheet(sheetName) {
    const link = $("r-tilt-url").value.trim();
    if (!link) { setTiltStatus("Paste your Tilt Google Sheet link first.", "err"); return; }
    if (window.API.demoMode) { setTiltStatus("Demo mode — configure the API URL to sync.", "err"); return; }
    const btn = $("import-gsheet");
    btn.disabled = true; const orig = btn.textContent; btn.textContent = "Syncing…";
    setTiltStatus("Reading the Google Sheet…", "");
    try {
      let target = link;
      if (sheetName) target += (link.indexOf("?") === -1 ? "?" : "&") + "sheet=" + encodeURIComponent(sheetName);
      const res = await window.API.getTiltSheet(target);
      if (res && res.error) { setTiltStatus(res.error, "err"); return; }
      const readings = window.TILT.parseMatrix(res.rows || [], 80);
      if (!readings.length) {
        // No readings on the chosen tab — offer a picker if the workbook has tabs.
        const tabs = (res.tabs || []).filter(t => !/^(help)$/i.test(t));
        if (tabs.length > 1 && !sheetName) {
          const pick = prompt(
            "No readings found on the “" + (res.sheet || "?") + "” tab.\n\n" +
            "This workbook has these tabs — type the one for this batch:\n" + tabs.join(", "),
            tabs.find(t => !/^(data|report)$/i.test(t)) || tabs[0]
          );
          if (pick) { btn.disabled = false; btn.textContent = orig; return syncFromSheet(pick.trim()); }
        }
        setTiltStatus("No SG readings found on that tab. Open the batch's tab in Google Sheets and copy the link from the address bar (it includes #gid=…).", "err");
        return;
      }
      applyImportedReadings(readings, "Google Sheet" + (res.sheet ? " · " + res.sheet : ""));
    } catch (err) {
      setTiltStatus(err.message || String(err), "err");
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }
  $("import-gsheet").addEventListener("click", () => syncFromSheet());

  function readRunForm() {
    const run = { mash_id: mash.mash_id, run_id: editingRunId };
    Object.entries(RUN_MAP).forEach(([dom, key]) => { run[key] = $(dom).value; });
    return run;
  }
  // Predicted ABV from OG, shown until a real final gravity is entered. Uses the
  // recipe's target FG as the fermentation assumption, falling back to dry.
  function updatePredictedABV(run) {
    const el = $("r-predicted-abv");
    const o = D.num(run.ferment_og);
    const f = D.num(run.ferment_fg);
    // Once an actual FG is in, the measured Wash ABV covers it — step aside.
    if (o === null || f !== null) { el.hidden = true; el.textContent = ""; return; }
    let fg = D.num(mash.target_fg), basis;
    if (fg !== null && fg < o) basis = "assuming target FG " + D.round(fg, 3);
    else { fg = 1.000; basis = "assuming it ferments dry (FG 1.000)"; }
    const pred = D.potentialABV(o, fg);
    if (pred === null) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.innerHTML = `<strong>Predicted ABV ~${pred.toFixed(1)}%</strong> — from OG ${escapeHTML(String(run.ferment_og))}, ${basis}. Enter a final gravity for the measured value.`;
  }
  // Best-practice cut guidance for the run, with foreshots volume and expected
  // pure-alcohol filled in from the wash figures when available.
  function updateCutSuggest(run) {
    const el = $("cut-suggest");
    const fallback = D.potentialABV(run.ferment_og, mash.target_fg);
    const s = D.suggestCuts(run, fallback);
    const fs = s.foreshotsML != null
      ? `~${s.foreshotsML} mL <span class="muted">(≈${s.foreshotsMlPerGal} mL/gal × ${D.round(s.washGal, 1)} gal wash)</span>`
      : `~${s.foreshotsMlPerGal} mL per gallon of wash`;
    const laaLine = s.laaL != null
      ? `<div class="cut-suggest-laa">This wash holds ~${D.round(s.laaL, 2)} L pure alcohol${s.proofGal != null ? ` (~${D.round(s.proofGal, 2)} proof gal)` : ""} to split across the cuts.</div>`
      : "";
    el.innerHTML = `
      <div class="cut-suggest-head">Suggested cuts · pot-still best practice</div>
      <ul class="cut-suggest-list">
        <li><strong>Foreshots — discard:</strong> ${fs}. Identify by smell, never taste.</li>
        <li><strong>Heads:</strong> ~${s.headsPct[0]}–${s.headsPct[1]}% of what you collect — set aside and redistill.</li>
        <li><strong>Hearts — keep:</strong> ~${s.heartsPct[0]}–${s.heartsPct[1]}%. Make the hearts→tails cut around ${s.heartsCutAbv[0]}–${s.heartsCutAbv[1]}% ABV (start checking by ~${s.watchAbv}%).</li>
        <li><strong>Tails:</strong> ~${s.tailsPct[0]}–${s.tailsPct[1]}% — below ~${s.tailsAbv}% ABV; save for the next stripping run.</li>
      </ul>
      ${laaLine}
      <div class="cut-suggest-note">Rules of thumb — always confirm heads by aroma and hearts by taste.</div>`;
  }
  function updateRunCalc() {
    const run = readRunForm();
    updatePredictedABV(run);
    updateCutSuggest(run);
    const washAbv = D.washABV(run);
    const gravAbv = D.abvFromGravity(run.ferment_og, run.ferment_fg);
    // Show the live auto value in the Wash ABV field's placeholder, and label
    // the stat with its source so a typed (measured) value overriding the
    // OG–FG calc is obvious.
    const measured = D.num(run.wash_abv) !== null;
    $("r-wash-abv").placeholder = gravAbv === null
      ? "auto from OG–FG if blank"
      : "auto ≈ " + fmt(gravAbv, 1) + "% from OG–FG";
    const washLabel = washAbv === null ? "Wash ABV" : (measured ? "Wash ABV (measured)" : "Wash ABV (OG–FG)");
    const washNote = (measured && gravAbv !== null && Math.abs(gravAbv - washAbv) >= 0.1)
      ? ` <span class="muted">(OG–FG ⇒ ${fmt(gravAbv, 1)}%)</span>` : "";
    const pg = D.proofGallons(run.hearts_volume, run.volume_unit, run.hearts_abv);
    const laa = D.laaLiters(run.hearts_volume, run.volume_unit, run.hearts_abv);
    const rec = D.heartsRecovery(run);
    const tot = D.totalRecovery(run);
    $("run-calc").innerHTML = `
      ${runStat(washLabel, washAbv === null ? "—" : fmt(washAbv) + "%" + washNote)}
      ${runStat("Proof gal (hearts)", pg === null ? "—" : fmt(pg))}
      ${runStat("LAA L (hearts)", laa === null ? "—" : fmt(laa))}
      ${runStat("Hearts recovery", rec === null ? "—" : fmt(rec, 0) + "%")}
      ${runStat("Total recovery", tot === null ? "—" : fmt(tot, 0) + "%")}
    `;
  }
  Object.keys(RUN_MAP).forEach(dom => $(dom).addEventListener("input", updateRunCalc));

  function openRunModal(runId) {
    editingRunId = runId || null;
    const run = runId ? mash.runs.find(r => String(r.run_id) === String(runId)) || {} : {};
    $("run-modal-title").textContent = runId ? "Edit run" : "Log a run";
    Object.entries(RUN_MAP).forEach(([dom, key]) => { $(dom).value = run[key] != null ? run[key] : ""; });
    // Deep-copy this run's gravity log so edits can be cancelled cleanly.
    currentReadings = (run.readings || []).map(r => ({
      reading_date: r.reading_date || "", reading_time: r.reading_time || "",
      gravity: r.gravity ?? "", temp: r.temp ?? "", ph: r.ph ?? "", notes: r.notes || ""
    }));
    currentAdditions = (run.additions || []).map(a => ({
      item: a.item || "", category: a.category || "nutrient", amount: a.amount ?? "",
      unit: a.unit || "", timing: a.timing || "", notes: a.notes || ""
    }));
    renderReadings();
    renderAdditions();
    if (!runId) {
      if (!$("r-run-date").value) $("r-run-date").value = new Date().toLocaleDateString("en-US");
      if (!$("r-volume-unit").value) $("r-volume-unit").value = mash.volume_unit || "L";
      if (!$("r-og").value) $("r-og").value = mash.target_og || "";
      if (!$("r-fg").value) $("r-fg").value = mash.target_fg || "";
    }
    // Fill blanks only: keep the run's saved OG/FG (they may be newer than the
    // gravity log, e.g. a hand-measured final gravity typed in directly).
    updateReadingDerived({ fillBlanksOnly: true });
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeRunModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }
  $("add-run").addEventListener("click", () => {
    if (window.API.demoMode) { alert("Demo mode — configure the API URL to log runs."); return; }
    openRunModal(null);
  });
  $("run-close").addEventListener("click", closeRunModal);
  $("run-cancel").addEventListener("click", closeRunModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeRunModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeRunModal(); });

  $("run-save").addEventListener("click", async () => {
    const run = readRunForm();
    // Keep readings that carry at least a gravity or a pH value (a pH-only spot
    // check is worth logging even with no hydrometer reading).
    const readings = currentReadings.filter(r =>
      (r.gravity !== "" && r.gravity != null) || (r.ph !== "" && r.ph != null));
    // Keep additions that at least name an item.
    const additions = currentAdditions.filter(a => a.item && String(a.item).trim() !== "");
    const saveBtn = $("run-save");
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      if (editingRunId) {
        await window.API.updateRun(run);
      } else {
        run.run_id = "run_" + mash.mash_id + "_" + Date.now().toString(36);
        await window.API.addRun(run);
      }
      await window.API.replaceReadings(run.run_id, mash.mash_id, readings);
      await window.API.replaceAdditions(run.run_id, mash.mash_id, additions);
      run.readings = readings;
      run.additions = additions;
      const i = mash.runs.findIndex(r => String(r.run_id) === String(run.run_id));
      if (i !== -1) mash.runs[i] = run; else mash.runs.push(run);
      renderRuns();
      closeRunModal();
      showToast("Run saved ✓");
    } catch (err) {
      showToast(err.message);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = "Save run";
    }
  });

  async function deleteRun(runId) {
    if (!confirm("Delete this run permanently?")) return;
    try {
      await window.API.deleteRun(runId, mash.mash_id);
      mash.runs = mash.runs.filter(r => String(r.run_id) !== String(runId));
      renderRuns();
      showToast("Run deleted");
    } catch (err) { showToast(err.message); }
  }

  // ---------- Save mash ----------
  const saveBtn = $("save-btn");
  saveBtn.addEventListener("click", async () => {
    if (window.API.demoMode) { showToast("Demo mode — not saved."); return; }
    const fields = {};
    Object.entries(FIELD_MAP).forEach(([dom, key]) => { fields[key] = $(dom).value; });
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      for (const [field, value] of Object.entries(fields)) {
        await window.API.updateMashField(mash.mash_id, field, value);
      }
      await window.API.replaceMashComponents(mash.mash_id, mash.components);
      showToast("Saved ✓");
    } catch (err) {
      showToast(err.message);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = "Save changes";
    }
  });

  // ---------- Delete mash ----------
  const deleteBtn = $("delete-mash");
  const deleteConfirm = $("delete-confirm");
  $("delete-mash-name").textContent = mash.name || "this mash recipe";
  deleteBtn.addEventListener("click", () => { deleteBtn.style.display = "none"; deleteConfirm.style.display = "block"; });
  $("delete-cancel").addEventListener("click", () => { deleteConfirm.style.display = "none"; deleteBtn.style.display = ""; });
  $("delete-confirm-yes").addEventListener("click", async () => {
    const yes = $("delete-confirm-yes"), cancel = $("delete-cancel");
    yes.disabled = cancel.disabled = true; yes.textContent = "Deleting…";
    try {
      const res = await window.API.deleteMash(mash.mash_id);
      if (res && res.error) throw new Error(res.error);
      showToast("Mash recipe deleted");
      setTimeout(() => { location.href = "distilling.html"; }, 700);
    } catch (err) {
      showToast(err.message);
      yes.disabled = cancel.disabled = false; yes.textContent = "Yes, delete permanently";
    }
  });

  function showToast(msg) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
})();
