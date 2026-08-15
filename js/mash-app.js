// v1.21.1 (2026-08-14): the gravity log drives OG/FG — saving no longer writes
// derived values back into the row, redundant stored ones are cleared on open,
// and run cards overlay the linked ferment's current figures.
// v1.21.0 (2026-08-13): fermentation split out of distillation. A ferment is
// its own record with its own editor — gravity log, curve, Tilt link, tweaks
// and notes all live there. The run editor is still work only: it points at the
// ferment it distilled and copies that ferment's OG/FG/wash ABV into its own
// columns, which is what the recovery and cut math reads. One ferment can feed
// several runs (strip + spirit). Compare is now two tables — ferments by
// OG→FG/attenuation/pH/days/tweaks, runs by yield and recovery.
// v1.15.0 (2026-08-02): batched save; mash editor writes fields in one request. Full history: CHANGELOG.md
// auto-calcs; backend datetime strings shown as MM/DD/YYYY & hh:mm in the run
// editor, cards and compare table.
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
  mash.ferments = mash.ferments || [];   // v1.21.0

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


  // ==========================================================================
  // Shared display helpers
  // ==========================================================================
  function runStat(label, value) {
    return `<div class="run-stat"><span class="run-stat-label">${label}</span><span class="run-stat-val">${value}</span></div>`;
  }
  // pH summary for a fermentation span: start→end if it moved, else a single
  // value. Returns "—" when no pH was logged.
  function phValue(span) {
    if (!span || !span.hasPh) return "—";
    const a = D.round(span.phFirst, 2), b = D.round(span.phLast, 2);
    return a === b ? String(a) : a + "→" + b;
  }
  function phText(span) {
    return (!span || !span.hasPh) ? "" : " · pH " + phValue(span);
  }
  // Compact chips row of additions/tweaks (item + amount/unit).
  function additionsSummary(additions, label) {
    const list = (additions || []).filter(a => a.item && String(a.item).trim() !== "");
    if (!list.length) return "";
    const chips = list.map(a => {
      const amt = (a.amount !== "" && a.amount != null) ? " " + escapeHTML(String(a.amount)) + (a.unit ? " " + escapeHTML(a.unit) : "") : "";
      return `<span class="add-chip">${escapeHTML(a.item)}${amt}</span>`;
    }).join("");
    return `<div class="run-additions"><span class="run-additions-label">${label || "Tweaks"}</span>${chips}</div>`;
  }

  // Display normalizers for values coming back from the backend, which stores
  // dates/times as spreadsheet cells and returns them as full datetime strings
  // (dates as ISO like "2026-07-09T05:00:00.000Z", times as 1899-epoch strings).
  function normDate(v) {
    const s = String(v ?? "").trim();
    if (!s || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const pad = n => String(n).padStart(2, "0");
    return pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + "/" + d.getFullYear();
  }
  function normTime(v) {
    const s = String(v ?? "").trim();
    if (!s || /^\d{1,2}:\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const pad = n => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // Build an inline SVG chart of a data series scaled to its own min/max, laid
  // out across the full width. Values that are null are skipped (the line
  // bridges the gap). Returns null if fewer than 2 numeric points.
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

  // ==========================================================================
  // Ferments (v1.21.0)
  //
  // A wash is its own record now. Everything below is about what happened in
  // the fermenter; nothing here knows about the still.
  // ==========================================================================
  const fermentsBody = $("ferments-body");
  const STATUS_LABELS = { fermenting: "Fermenting", finished: "Finished", distilled: "Distilled", dumped: "Dumped" };

  function fermentById(id) {
    if (!id) return null;
    return mash.ferments.find(f => String(f.ferment_id) === String(id)) || null;
  }
  // What to call a ferment in a list or a dropdown: its name if it has one,
  // otherwise its start date, otherwise a last resort.
  function fermentLabel(f) {
    if (!f) return "";
    const name = String(f.name || "").trim();
    if (name) return name;
    const d = normDate(f.start_date);
    return d || "(unnamed ferment)";
  }
  // Runs distilled from this ferment.
  function runsForFerment(fermentId) {
    if (!fermentId) return [];
    return mash.runs.filter(r => String(r.ferment_id) === String(fermentId));
  }

  function renderFerments() {
    $("ferments-count").textContent = mash.ferments.length ? `(${mash.ferments.length})` : "";
    if (!mash.ferments.length) {
      fermentsBody.innerHTML = `<div class="muted" style="padding:8px 0">No ferments logged yet. Tap “Start a ferment” when you pitch your next wash.</div>`;
      renderFermentCompare();
      return;
    }
    const sorted = mash.ferments.slice().sort((a, b) =>
      String(normDate(b.start_date)).localeCompare(String(normDate(a.start_date))));

    fermentsBody.innerHTML = sorted.map(f => {
      const g = D.fermentGravities(f);
      const span = g.span;
      const abv = D.fermentABV(f);
      const atten = D.attenuation(g.og, g.fg);
      const status = D.fermentStatus(f);
      const days = span && span.days != null ? span.days : null;
      const chart = span ? `<div class="run-ferment">
          <span class="spark-wrap">${fermChart(span.gravities, span.temps, 120, 34, { showTemp: span.hasTemp, showDots: false })}</span>
          <span class="run-ferment-txt">${span.count} readings${days != null ? " · " + days + "d" : ""}${span.hasTemp ? " · temp " + D.round(span.tempRange.min, 0) + "–" + D.round(span.tempRange.max, 0) + "°" : ""}${phText(span)}</span>
        </div>` : "";
      const linked = runsForFerment(f.ferment_id);
      const linkedLine = linked.length
        ? `<div class="ferment-runs">Distilled in ${linked.length} run${linked.length === 1 ? "" : "s"}: ${linked.map(r => escapeHTML(normDate(r.run_date) || "(no date)")).join(", ")}</div>`
        : "";
      // A synthetic ferment is one the backend built on the fly from a run that
      // hasn't been migrated yet — it has no row of its own, so it can't be
      // edited or linked until SETUP_migrateRunsToFerments() has been run.
      const actions = f.synthetic
        ? `<span class="muted ferment-legacy">from an un-migrated run</span>`
        : `<button class="ghost ferment-edit" data-ferment="${escapeHTML(f.ferment_id)}">Edit</button>
           <button class="ghost ferment-del" data-ferment="${escapeHTML(f.ferment_id)}">Delete</button>`;

      return `<div class="run-item ferment-item" data-ferment="${escapeHTML(f.ferment_id)}">
        <div class="run-item-head">
          <div class="run-date">${escapeHTML(fermentLabel(f))}
            <span class="ferment-status status-${escapeHTML(status)}">${escapeHTML(STATUS_LABELS[status] || status)}</span>
            ${f.name && normDate(f.start_date) ? `<span class="muted"> · ${escapeHTML(normDate(f.start_date))}</span>` : ""}
          </div>
          <div class="run-actions">${actions}</div>
        </div>
        <div class="run-stats">
          ${runStat("OG → FG", (g.og != null || g.fg != null) ? `${g.og != null ? D.round(g.og, 3) : "—"} → ${g.fg != null ? D.round(g.fg, 3) : "—"}` : "—")}
          ${runStat("Wash ABV", abv === null ? "—" : fmt(abv) + "%")}
          ${runStat("Attenuation", atten === null ? "—" : fmt(atten, 0) + "%")}
          ${runStat("Batch", f.batch_volume ? fmt(f.batch_volume) + " " + escapeHTML(f.volume_unit || "") : "—")}
          ${runStat("Days", days == null ? "—" : days + "d")}
        </div>
        ${chart}
        ${additionsSummary(f.additions)}
        ${linkedLine}
        ${f.notes ? `<div class="run-note">${escapeHTML(f.notes)}</div>` : ""}
      </div>`;
    }).join("");

    fermentsBody.querySelectorAll(".ferment-edit").forEach(b =>
      b.addEventListener("click", () => openFermentModal(b.dataset.ferment)));
    fermentsBody.querySelectorAll(".ferment-del").forEach(b =>
      b.addEventListener("click", () => deleteFerment(b.dataset.ferment)));
    renderFermentCompare();
  }

  // ---------- Compare ferments ----------
  let fermentCompareFilter = "";
  function additionItems(list) {
    return (list || [])
      .filter(a => a.item && String(a.item).trim() !== "")
      .map(a => String(a.item).trim());
  }
  function renderFermentCompare() {
    const wrap = $("ferments-compare");
    const section = $("ferment-compare-section");
    const countEl = $("ferment-compare-count");
    if (!mash.ferments.length) {
      if (section) section.style.display = "none";
      return;
    }
    if (section) section.style.display = "";
    countEl.textContent = `(${mash.ferments.length})`;

    const sorted = mash.ferments.slice().sort((a, b) =>
      String(normDate(b.start_date)).localeCompare(String(normDate(a.start_date))));

    // Populate the tweak-highlight dropdown with the distinct items used.
    const items = Array.from(new Set(
      mash.ferments.flatMap(f => additionItems(f.additions))
    )).sort((a, b) => a.localeCompare(b));
    const sel = $("ferment-compare-filter");
    const keep = sel.value;
    sel.innerHTML = `<option value="">— show all ferments —</option>` +
      items.map(it => `<option value="${escapeHTML(it.toLowerCase())}">${escapeHTML(it)}</option>`).join("");
    sel.value = items.some(it => it.toLowerCase() === keep) ? keep : "";
    fermentCompareFilter = sel.value;

    const rows = sorted.map(f => {
      const g = D.fermentGravities(f);
      const span = g.span;
      const abv = D.fermentABV(f);
      const atten = D.attenuation(g.og, g.fg);
      const ogfg = (g.og != null || g.fg != null)
        ? `${g.og != null ? D.round(g.og, 3) : "—"} → ${g.fg != null ? D.round(g.fg, 3) : "—"}` : "—";
      const days = span && span.days != null ? span.days : null;
      const tweaks = additionItems(f.additions);
      const tweakChips = tweaks.length
        ? (f.additions || []).filter(a => a.item && String(a.item).trim() !== "").map(a => {
            const amt = (a.amount !== "" && a.amount != null) ? " " + escapeHTML(String(a.amount)) + (a.unit ? " " + escapeHTML(a.unit) : "") : "";
            return `<span class="add-chip">${escapeHTML(a.item)}${amt}</span>`;
          }).join(" ")
        : `<span class="muted">—</span>`;
      return `<tr data-items="${escapeHTML(tweaks.map(i => i.toLowerCase()).join("|"))}">
        <td class="c-date">${escapeHTML(fermentLabel(f))}</td>
        <td>${escapeHTML(ogfg)}</td>
        <td>${abv === null ? "—" : fmt(abv) + "%"}</td>
        <td>${atten === null ? "—" : fmt(atten, 0) + "%"}</td>
        <td>${escapeHTML(phValue(span))}</td>
        <td>${days == null ? "—" : days + "d"}</td>
        <td>${f.batch_volume ? fmt(f.batch_volume) + " " + escapeHTML(f.volume_unit || "") : "—"}</td>
        <td class="c-tweaks">${tweakChips}</td>
      </tr>`;
    }).join("");

    wrap.innerHTML = `<table class="compare-table">
      <thead><tr>
        <th>Ferment</th><th>OG → FG</th><th>Wash ABV</th><th>Atten.</th>
        <th>pH</th><th>Days</th><th>Batch</th><th>Tweaks</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    applyFermentHighlight();
  }
  function applyFermentHighlight() {
    $("ferments-compare").querySelectorAll("tbody tr").forEach(tr => {
      tr.classList.remove("row-match", "row-dim");
      if (!fermentCompareFilter) return;
      const items = (tr.dataset.items || "").split("|");
      if (items.includes(fermentCompareFilter)) tr.classList.add("row-match");
      else tr.classList.add("row-dim");
    });
  }
  $("ferment-compare-filter").addEventListener("change", () => {
    fermentCompareFilter = $("ferment-compare-filter").value;
    applyFermentHighlight();
  });

  // ---------- Ferment editor ----------
  const fermentModal = $("ferment-modal");
  const FERMENT_MAP = {
    "fm-name": "name", "fm-status": "status",
    "fm-start-date": "start_date", "fm-end-date": "end_date",
    "fm-batch-volume": "batch_volume", "fm-volume-unit": "volume_unit",
    "fm-og": "og", "fm-fg": "fg", "fm-wash-abv": "wash_abv",
    "fm-ferment-temp": "ferment_temp", "fm-yeast-strain": "yeast_strain",
    "fm-pitch-rate": "pitch_rate", "fm-tilt-url": "tilt_sheet_url", "fm-notes": "notes"
  };
  let editingFermentId = null;
  let currentReadings = [];   // gravity log for the ferment being edited
  let currentAdditions = [];  // additions/tweaks for the ferment being edited

  // ----- Additions / tweaks editor -----
  const additionsEl = $("additions-body");
  function renderAdditions() {
    additionsEl.innerHTML = "";
    if (!currentAdditions.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "padding:4px 0 8px";
      empty.textContent = "No tweaks logged for this ferment — add nutrients, yeast, acid, or anything you changed from the recipe.";
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

  // ----- Gravity log editor -----
  const readingsEl = $("readings-body");
  function renderReadings() {
    readingsEl.innerHTML = "";
    if (!currentReadings.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.cssText = "padding:4px 0 8px";
      empty.textContent = "No readings yet — add one by hand, or pull the whole curve from a Tilt file or Google Sheet below.";
      readingsEl.appendChild(empty);
    }
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
          updateFermentCalc();
        });
      });
      row.querySelector('[data-action="remove"]').addEventListener("click", () => {
        currentReadings.splice(idx, 1);
        renderReadings();
        updateFermentCalc();
      });
      readingsEl.appendChild(row);
    });
  }

  // The ferment being edited, as a plain object built from the form + the log.
  // OG/FG left blank in the form fall back to the ends of the gravity log, so
  // the fields act as an override rather than something the import overwrites.
  function readFermentForm() {
    const f = { mash_id: mash.mash_id, ferment_id: editingFermentId };
    Object.entries(FERMENT_MAP).forEach(([dom, key]) => { f[key] = $(dom).value; });
    f.readings = currentReadings;
    f.additions = currentAdditions;
    return f;
  }

  // Live stats for the ferment editor, plus the curve.
  function updateFermentCalc() {
    const f = readFermentForm();
    const g = D.fermentGravities(f);
    const span = g.span;
    const chart = $("gravity-chart");
    if (span) {
      const svg = fermChart(span.gravities, span.temps, 280, 64, { showTemp: span.hasTemp, showDots: true });
      const tempCap = span.tempRange ? ` · temp ${D.round(span.tempRange.min, 0)}–${D.round(span.tempRange.max, 0)}°` : "";
      const legend = span.hasTemp
        ? `<div class="chart-legend"><span class="lg lg-sg">SG</span><span class="lg lg-temp">Temp</span></div>` : "";
      chart.innerHTML = svg
        ? `${legend}${svg}<div class="chart-caption">log ${span.og} → ${span.fg}${span.days != null ? " · " + span.days + " day" + (span.days === 1 ? "" : "s") : ""} · ${span.count} readings${tempCap}${phText(span)}</div>`
        : `<div class="chart-caption">log ${span.og}${span.count > 1 ? " → " + span.fg : ""} · ${span.count} reading${span.count === 1 ? "" : "s"}${phText(span)}</div>`;
      chart.hidden = false;
    } else {
      chart.hidden = true;
      chart.innerHTML = "";
    }

    const abv = D.fermentABV(f);
    const atten = D.attenuation(g.og, g.fg);
    const measured = D.num(f.wash_abv);
    const gravAbv = D.abvFromGravity(g.og, g.fg);
    $("fm-wash-abv").placeholder = gravAbv === null
      ? "auto from OG–FG if blank"
      : "auto ≈ " + fmt(gravAbv, 1) + "% from OG–FG";
    // Once there's a log it decides OG/FG, so say so — and if a typed value
    // disagrees with the log, show both rather than quietly using one.
    const note = $("fm-gravity-note");
    if (span && (g.ogDiffers || g.fgDiffers)) {
      const parts = [];
      if (g.ogDiffers) parts.push(`OG typed as ${D.round(g.ogTyped, 3)}, log starts at ${D.round(span.og, 3)}`);
      if (g.fgDiffers) parts.push(`FG typed as ${D.round(g.fgTyped, 3)}, log ends at ${D.round(span.fg, 3)}`);
      note.hidden = false;
      note.innerHTML = `<strong>Using the log.</strong> ${escapeHTML(parts.join("; "))}. Clear the field above to drop the typed value, or add the measurement as a reading.`;
    } else if (span) {
      note.hidden = false;
      note.innerHTML = `<strong>OG and FG follow the gravity log</strong> — ${span.count} reading${span.count === 1 ? "" : "s"}, currently ${D.round(span.og, 3)} → ${D.round(span.fg, 3)}. They update as you add readings.`;
    } else {
      note.hidden = true;
      note.innerHTML = "";
    }
    // Until there's a final gravity, show what the wash is heading for.
    let predicted = null;
    if (g.og !== null && g.fg === null) {
      const target = D.num(mash.target_fg);
      predicted = D.potentialABV(g.og, (target !== null && target < g.og) ? target : 1.000);
    }
    $("ferment-calc").innerHTML = `
      ${runStat("OG", g.og == null ? "—" : String(D.round(g.og, 3)))}
      ${runStat("FG", g.fg == null ? "—" : String(D.round(g.fg, 3)))}
      ${runStat(measured !== null && measured > 0 ? "Wash ABV (measured)" : "Wash ABV (OG–FG)", abv === null ? "—" : fmt(abv) + "%")}
      ${runStat("Attenuation", atten === null ? "—" : fmt(atten, 0) + "%")}
      ${runStat("Readings", span ? String(span.count) : "0")}
      ${predicted === null ? "" : runStat("Predicted ABV", "~" + predicted.toFixed(1) + "%")}
    `;
  }
  Object.keys(FERMENT_MAP).forEach(dom => {
    const el = $(dom);
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", updateFermentCalc);
  });

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

  // ----- Tilt import (file) -----
  const tiltFile = $("tilt-file");
  const tiltStatus = $("tilt-status");
  function setTiltStatus(msg, kind) {
    tiltStatus.textContent = msg;
    tiltStatus.className = "tilt-status" + (kind ? " " + kind : "");
    tiltStatus.hidden = !msg;
  }
  function applyImportedReadings(readings, sourceLabel) {
    const replace = !currentReadings.length ||
      confirm(`Found ${readings.length} readings.\n\nOK = replace the current log with them.\nCancel = append them to the existing log.`);
    currentReadings = replace ? readings : currentReadings.concat(readings);
    renderReadings();
    updateFermentCalc();
    setTiltStatus(`Imported ${readings.length} readings from ${sourceLabel}.`, "ok");
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
      applyImportedReadings(readings, file.name);
    } catch (err) {
      setTiltStatus(err.message || String(err), "err");
    } finally {
      tiltFile.value = "";  // allow re-importing the same file
    }
  });

  // ----- Tilt sync (Google Sheet, read server-side by the Apps Script) -----
  // Honors a #gid=... tab in the link, so a workbook with one tab per batch
  // works — paste the link while viewing that batch's tab.
  async function syncFromSheet(sheetName) {
    const link = $("fm-tilt-url").value.trim();
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

  // ----- Open / close / save -----
  function openFermentModal(fermentId) {
    editingFermentId = fermentId || null;
    const f = fermentId ? fermentById(fermentId) || {} : {};
    $("ferment-modal-title").textContent = fermentId ? "Edit ferment" : "Start a ferment";
    Object.entries(FERMENT_MAP).forEach(([dom, key]) => { $(dom).value = f[key] != null ? f[key] : ""; });
    ["fm-start-date", "fm-end-date"].forEach(dom => { $(dom).value = normDate($(dom).value); });
    // A stored wash ABV of 0 means "not measured" — leave blank so OG–FG auto-calcs.
    if (D.num($("fm-wash-abv").value) === 0) $("fm-wash-abv").value = "";
    // Blank out a stored og/fg that just duplicates the log. The migration
    // stamps both onto every row, and the first release backfilled them on
    // save; keeping them would leave the fields looking like deliberate manual
    // overrides and make the editor warn about a disagreement the moment the
    // log moved past them. A value that genuinely differs from the log is kept
    // — that one really was typed.
    (function () {
      const span = D.readingSpan(f.readings);
      if (!span) return;
      if (D.num($("fm-og").value) === span.og) $("fm-og").value = "";
      if (D.num($("fm-fg").value) === span.fg) $("fm-fg").value = "";
    })();
    if (!$("fm-status").value) $("fm-status").value = "fermenting";

    // Deep-copy the log and the tweaks so edits can be cancelled cleanly.
    currentReadings = (f.readings || []).map(r => ({
      reading_date: normDate(r.reading_date), reading_time: normTime(r.reading_time),
      gravity: r.gravity ?? "", temp: r.temp ?? "", ph: r.ph ?? "", notes: r.notes || ""
    }));
    currentAdditions = (f.additions || []).map(a => ({
      item: a.item || "", category: a.category || "nutrient", amount: a.amount ?? "",
      unit: a.unit || "", timing: a.timing || "", notes: a.notes || ""
    }));

    if (!fermentId) {
      // Seed a new ferment from the recipe so the common case is one tap.
      $("fm-start-date").value = new Date().toLocaleDateString("en-US");
      $("fm-volume-unit").value = mash.volume_unit || "L";
      $("fm-batch-volume").value = mash.batch_volume || "";
      $("fm-yeast-strain").value = mash.yeast_strain || "";
      $("fm-pitch-rate").value = mash.pitch_rate || "";
      $("fm-ferment-temp").value = mash.ferment_temp || "";
      $("fm-status").value = "fermenting";
    }
    renderReadings();
    renderAdditions();
    setTiltStatus("");
    updateFermentCalc();
    fermentModal.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeFermentModal() {
    fermentModal.hidden = true;
    document.body.style.overflow = "";
  }
  $("add-ferment").addEventListener("click", () => {
    if (window.API.demoMode) { alert("Demo mode — configure the API URL to log ferments."); return; }
    openFermentModal(null);
  });
  $("ferment-close").addEventListener("click", closeFermentModal);
  $("ferment-cancel").addEventListener("click", closeFermentModal);
  fermentModal.addEventListener("click", e => { if (e.target === fermentModal) closeFermentModal(); });

  $("ferment-save").addEventListener("click", async () => {
    const f = readFermentForm();
    // Keep readings that carry at least a gravity or a pH value (a pH-only spot
    // check is worth logging even with no hydrometer reading).
    const readings = currentReadings.filter(r =>
      (r.gravity !== "" && r.gravity != null) || (r.ph !== "" && r.ph != null));
    const additions = currentAdditions.filter(a => a.item && String(a.item).trim() !== "");

    // og/fg are saved exactly as typed — usually blank. Backfilling them with
    // values derived from the log was what froze the summary: once the row had
    // an fg, every later reading was ignored. The log is the running record;
    // these fields are only the override for a wash with no log.
    const row = {
      ferment_id: editingFermentId, mash_id: mash.mash_id,
      name: f.name, start_date: f.start_date, end_date: f.end_date,
      status: f.status || "fermenting",
      batch_volume: f.batch_volume, volume_unit: f.volume_unit,
      og: f.og, fg: f.fg,
      wash_abv: f.wash_abv, yeast_strain: f.yeast_strain, pitch_rate: f.pitch_rate,
      ferment_temp: f.ferment_temp, tilt_sheet_url: f.tilt_sheet_url, notes: f.notes
    };

    const btn = $("ferment-save");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      if (editingFermentId) {
        await window.API.updateFerment(row);
      } else {
        row.ferment_id = "ferm_" + mash.mash_id + "_" + Date.now().toString(36);
        editingFermentId = row.ferment_id;
        await window.API.addFerment(row);
      }
      await window.API.replaceReadings(row.ferment_id, mash.mash_id, readings);
      await window.API.replaceAdditions(row.ferment_id, mash.mash_id, additions);
      row.readings = readings;
      row.additions = additions;
      const i = mash.ferments.findIndex(x => String(x.ferment_id) === String(row.ferment_id));
      if (i !== -1) mash.ferments[i] = row; else mash.ferments.push(row);
      renderFerments();
      populateFermentPicker();
      renderRuns();
      closeFermentModal();
      showToast("Ferment saved ✓");
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false; btn.textContent = "Save ferment";
    }
  });

  async function deleteFerment(fermentId) {
    const linked = runsForFerment(fermentId);
    const warn = linked.length
      ? `\n\n${linked.length} distillation run${linked.length === 1 ? "" : "s"} point at this ferment. The run${linked.length === 1 ? "" : "s"} will be kept, but unlinked.`
      : "";
    if (!confirm("Delete this ferment, its gravity log and its tweaks permanently?" + warn)) return;
    try {
      await window.API.deleteFerment(fermentId, mash.mash_id);
      mash.ferments = mash.ferments.filter(f => String(f.ferment_id) !== String(fermentId));
      mash.runs.forEach(r => { if (String(r.ferment_id) === String(fermentId)) r.ferment_id = ""; });
      renderFerments();
      populateFermentPicker();
      renderRuns();
      showToast("Ferment deleted");
    } catch (err) { showToast(err.message); }
  }

  renderFerments();

  // ==========================================================================
  // Distillation runs
  //
  // Still work only. A run points at the ferment it distilled and copies that
  // ferment's OG/FG/wash ABV into its own columns, which is what the recovery
  // and cut math reads.
  // ==========================================================================
  const runsBody = $("runs-body");

  // A run's ferment_og/ferment_fg/wash_abv are a copy taken when it was saved.
  // For display, overlay the linked ferment's current figures so adding a
  // reading to a wash updates the runs that came off it, without anyone having
  // to re-open and re-save each run. The copy is still what's stored, and it's
  // what an un-linked run falls back to.
  function runLive(run) {
    const f = fermentById(run.ferment_id);
    if (!f) return run;
    const g = D.fermentGravities(f);
    const measured = D.num(f.wash_abv);
    return Object.assign({}, run, {
      ferment_og: g.og != null ? g.og : "",
      ferment_fg: g.fg != null ? g.fg : "",
      wash_abv: (measured !== null && measured > 0) ? measured : ""
    });
  }

  function renderRuns() {
    $("runs-count").textContent = mash.runs.length ? `(${mash.runs.length})` : "";
    if (!mash.runs.length) {
      runsBody.innerHTML = `<div class="muted" style="padding:8px 0">No runs logged yet. Tap “Log a run” after your next distillation.</div>`;
      renderRunCompare();
      return;
    }
    const sorted = mash.runs.slice().sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)));
    runsBody.innerHTML = sorted.map(r0 => {
      const run = runLive(r0);
      const washAbv = D.washABV(run);
      const pg = D.proofGallons(run.hearts_volume, run.volume_unit, run.hearts_abv);
      const laa = D.laaLiters(run.hearts_volume, run.volume_unit, run.hearts_abv);
      const rec = D.heartsRecovery(run);
      const hearts = run.hearts_volume ? `${fmt(run.hearts_volume)} ${escapeHTML(run.volume_unit || "")} @ ${fmt(run.hearts_abv)}%` : "—";
      const barrel = run.barrel_id ? `<span class="run-barrel">→ barrel ${escapeHTML(run.barrel_id)}${run.entry_proof ? " @ " + escapeHTML(String(run.entry_proof)) + " proof" : ""}</span>` : "";
      const f = fermentById(run.ferment_id);
      const from = f
        ? `<div class="run-from-ferment">From ferment <strong>${escapeHTML(fermentLabel(f))}</strong>${run.wash_volume ? ` · ${fmt(run.wash_volume)} ${escapeHTML(run.volume_unit || "")} charged` : ""}</div>`
        : `<div class="run-from-ferment muted">No ferment linked</div>`;
      return `<div class="run-item" data-run="${escapeHTML(run.run_id)}">
        <div class="run-item-head">
          <div class="run-date">${escapeHTML(normDate(run.run_date) || "(no date)")}${run.still_used ? ` · <span class="muted">${escapeHTML(run.still_used)}</span>` : ""}</div>
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
        ${from}
        ${barrel}
        ${run.notes ? `<div class="run-note">${escapeHTML(run.notes)}</div>` : ""}
      </div>`;
    }).join("");

    runsBody.querySelectorAll(".run-edit").forEach(b => b.addEventListener("click", () => openRunModal(b.dataset.run)));
    runsBody.querySelectorAll(".run-del").forEach(b => b.addEventListener("click", () => deleteRun(b.dataset.run)));
    renderRunCompare();
  }

  // ---------- Compare runs (still outcomes only) ----------
  function renderRunCompare() {
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
    const rows = sorted.map(r0 => {
      const run = runLive(r0);
      const f = fermentById(run.ferment_id);
      const abv = D.washABV(run);
      const hearts = run.hearts_volume
        ? `${fmt(run.hearts_volume)} ${escapeHTML(run.volume_unit || "")} @ ${fmt(run.hearts_abv)}%` : "—";
      const pg = D.proofGallons(run.hearts_volume, run.volume_unit, run.hearts_abv);
      const rec = D.heartsRecovery(run);
      const tot = D.totalRecovery(run);
      return `<tr>
        <td class="c-date">${escapeHTML(normDate(run.run_date) || "—")}</td>
        <td>${escapeHTML(run.still_used || "—")}</td>
        <td>${f ? escapeHTML(fermentLabel(f)) : `<span class="muted">—</span>`}</td>
        <td>${abv === null ? "—" : fmt(abv) + "%"}</td>
        <td>${hearts}</td>
        <td>${pg === null ? "—" : fmt(pg)}</td>
        <td>${rec === null ? "—" : fmt(rec, 0) + "%"}</td>
        <td>${tot === null ? "—" : fmt(tot, 0) + "%"}</td>
      </tr>`;
    }).join("");

    wrap.innerHTML = `<table class="compare-table">
      <thead><tr>
        <th>Date</th><th>Still</th><th>Wash</th><th>Wash ABV</th>
        <th>Hearts</th><th>Proof gal</th><th>Hearts rec.</th><th>Total rec.</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ---------- Run editor ----------
  const modal = $("run-modal");
  const RUN_MAP = {
    "r-run-date": "run_date", "r-operator": "operator", "r-still": "still_used", "r-volume-unit": "volume_unit",
    "r-ferment": "ferment_id", "r-wash-volume": "wash_volume",
    "r-foreshots": "foreshots_volume", "r-heads-vol": "heads_volume", "r-heads-abv": "heads_abv",
    "r-hearts-vol": "hearts_volume", "r-hearts-abv": "hearts_abv", "r-tails-vol": "tails_volume", "r-tails-abv": "tails_abv",
    "r-cut-heads": "cut_temp_heads", "r-cut-tails": "cut_temp_tails", "r-duration": "run_duration",
    "r-barrel-id": "barrel_id", "r-barrel-date": "barrel_fill_date", "r-entry-proof": "entry_proof",
    "r-char": "char_level", "r-notes": "notes"
  };
  let editingRunId = null;

  // Fill the "From ferment" dropdown. Synthetic ferments (built on the fly from
  // an un-migrated run) have no id and can't be linked, so they're left out.
  function populateFermentPicker() {
    const sel = $("r-ferment");
    const keep = sel.value;
    const list = mash.ferments
      .filter(f => f.ferment_id && !f.synthetic)
      .sort((a, b) => String(normDate(b.start_date)).localeCompare(String(normDate(a.start_date))));
    sel.innerHTML = `<option value="">— no ferment linked —</option>` +
      list.map(f => {
        const g = D.fermentGravities(f);
        const tail = g.og != null ? ` (OG ${D.round(g.og, 3)})` : "";
        return `<option value="${escapeHTML(f.ferment_id)}">${escapeHTML(fermentLabel(f))}${escapeHTML(tail)}</option>`;
      }).join("");
    sel.value = list.some(f => String(f.ferment_id) === String(keep)) ? keep : "";
  }
  populateFermentPicker();

  // A run object built from the form, with the linked ferment's figures copied
  // in. Those copies are what heartsRecovery / suggestCuts / washABV read.
  function readRunForm() {
    const run = { mash_id: mash.mash_id, run_id: editingRunId };
    Object.entries(RUN_MAP).forEach(([dom, key]) => { run[key] = $(dom).value; });
    const f = fermentById(run.ferment_id);
    if (f) {
      const g = D.fermentGravities(f);
      run.ferment_og = g.og != null ? g.og : "";
      run.ferment_fg = g.fg != null ? g.fg : "";
      const measured = D.num(f.wash_abv);
      run.wash_abv = (measured !== null && measured > 0) ? measured : "";
      run.tilt_sheet_url = f.tilt_sheet_url || "";
      if (run.wash_volume === "" && f.batch_volume) run.wash_volume = f.batch_volume;
    } else {
      run.ferment_og = ""; run.ferment_fg = ""; run.wash_abv = ""; run.tilt_sheet_url = "";
    }
    return run;
  }

  // What the linked ferment contributes to this run, shown read-only.
  function updateFermentSummary(run) {
    const el = $("r-ferment-summary");
    const f = fermentById(run.ferment_id);
    if (!f) { el.hidden = true; el.innerHTML = ""; return; }
    const g = D.fermentGravities(f);
    const abv = D.fermentABV(f);
    const span = g.span;
    const bits = [
      `OG ${g.og != null ? D.round(g.og, 3) : "—"} → FG ${g.fg != null ? D.round(g.fg, 3) : "—"}`,
      abv === null ? null : `wash ${fmt(abv)}%`,
      f.batch_volume ? `batch ${fmt(f.batch_volume)} ${f.volume_unit || ""}`.trim() : null,
      span && span.days != null ? `${span.days} day${span.days === 1 ? "" : "s"}` : null,
      span ? `${span.count} readings` : null
    ].filter(Boolean);
    el.hidden = false;
    el.innerHTML = `<strong>${escapeHTML(fermentLabel(f))}</strong> — ${escapeHTML(bits.join(" · "))}`;
  }

  // Predicted ABV from OG, shown until a real final gravity is known. Uses the
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
    el.innerHTML = `<strong>Predicted ABV ~${pred.toFixed(1)}%</strong> — from OG ${escapeHTML(String(run.ferment_og))}, ${basis}. The ferment needs a final gravity for the measured value.`;
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
    updateFermentSummary(run);
    updatePredictedABV(run);
    updateCutSuggest(run);
    const washAbv = D.washABV(run);
    const gravAbv = D.abvFromGravity(run.ferment_og, run.ferment_fg);
    const measuredVal = D.num(run.wash_abv);
    const measured = measuredVal !== null && measuredVal > 0;
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
  Object.keys(RUN_MAP).forEach(dom => {
    const el = $(dom);
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", updateRunCalc);
  });

  function openRunModal(runId) {
    editingRunId = runId || null;
    const run = runId ? mash.runs.find(r => String(r.run_id) === String(runId)) || {} : {};
    $("run-modal-title").textContent = runId ? "Edit run" : "Log a run";
    populateFermentPicker();
    Object.entries(RUN_MAP).forEach(([dom, key]) => { $(dom).value = run[key] != null ? run[key] : ""; });
    // Backend date cells come back as raw datetime strings — show them cleanly.
    ["r-run-date", "r-barrel-date"].forEach(dom => { $(dom).value = normDate($(dom).value); });
    if (!runId) {
      if (!$("r-run-date").value) $("r-run-date").value = new Date().toLocaleDateString("en-US");
      if (!$("r-volume-unit").value) $("r-volume-unit").value = mash.volume_unit || "L";
      // Default to the most recent ferment that hasn't been distilled yet —
      // usually exactly the one you just finished.
      const ready = mash.ferments
        .filter(f => f.ferment_id && !f.synthetic && D.fermentStatus(f) !== "dumped")
        .sort((a, b) => String(normDate(b.start_date)).localeCompare(String(normDate(a.start_date))));
      const pick = ready.find(f => !runsForFerment(f.ferment_id).length) || ready[0];
      if (pick) $("r-ferment").value = pick.ferment_id;
    }
    updateRunCalc();
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

  // One Escape handler for whichever modal is open.
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!fermentModal.hidden) closeFermentModal();
    else if (!modal.hidden) closeRunModal();
  });

  $("run-save").addEventListener("click", async () => {
    const run = readRunForm();
    const saveBtn = $("run-save");
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      if (editingRunId) {
        await window.API.updateRun(run);
      } else {
        run.run_id = "run_" + mash.mash_id + "_" + Date.now().toString(36);
        await window.API.addRun(run);
      }
      const i = mash.runs.findIndex(r => String(r.run_id) === String(run.run_id));
      if (i !== -1) mash.runs[i] = run; else mash.runs.push(run);
      // A wash that's been through the still is no longer "fermenting".
      const f = fermentById(run.ferment_id);
      if (f && D.fermentStatus(f) !== "distilled" && D.fermentStatus(f) !== "dumped") {
        f.status = "distilled";
        try { await window.API.updateFerment(Object.assign({}, f, { readings: undefined, additions: undefined })); }
        catch (_) { /* status is cosmetic — don't fail the save over it */ }
      }
      renderRuns();
      renderFerments();
      closeRunModal();
      showToast("Run saved ✓");
    } catch (err) {
      showToast(err.message);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = "Save run";
    }
  });

  async function deleteRun(runId) {
    if (!confirm("Delete this run permanently? The ferment it came from is kept.")) return;
    try {
      await window.API.deleteRun(runId, mash.mash_id);
      mash.runs = mash.runs.filter(r => String(r.run_id) !== String(runId));
      renderRuns();
      renderFerments();
      showToast("Run deleted");
    } catch (err) { showToast(err.message); }
  }

  renderRuns();

  // ==========================================================================
  // Save / delete the mash recipe
  // ==========================================================================
  const saveBtn = $("save-btn");
  saveBtn.addEventListener("click", async () => {
    if (window.API.demoMode) { showToast("Demo mode — not saved."); return; }
    const fields = {};
    Object.entries(FIELD_MAP).forEach(([dom, key]) => { fields[key] = $(dom).value; });
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";
    try {
      // One request for the fields, one for the components, in parallel —
      // different tabs. This used to be one round-trip per field.
      await Promise.all([
        window.API.updateMashFields(mash.mash_id, fields),
        window.API.replaceMashComponents(mash.mash_id, mash.components),
      ]);
      showToast("Saved ✓");
    } catch (err) {
      showToast(err.message);
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = "Save changes";
    }
  });

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
