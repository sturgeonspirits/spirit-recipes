// v1.3.0 (2026-07-06): Distilling list page — mash recipes with run counts +
// latest-run yield. Full history: CHANGELOG.md
(async function () {
  const listEl = document.getElementById("mash-rows");
  const search = document.getElementById("search");
  const typeFilter = document.getElementById("type-filter");
  const countEl = document.getElementById("result-count");
  const banner = document.getElementById("demo-banner");
  const newBtn = document.getElementById("new-mash");

  if (window.API.demoMode) banner.style.display = "block";

  let mashes = [];
  try {
    mashes = await window.API.getAllMashes();
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state">Could not load mash recipes: ${escapeHTML(err.message)}</div>`;
    return;
  }

  const types = Array.from(new Set(mashes.map(m => m.spirit_type).filter(Boolean))).sort();
  types.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    typeFilter.appendChild(opt);
  });

  function latestRun(m) {
    const runs = (m.runs || []).slice().sort((a, b) => String(b.run_date).localeCompare(String(a.run_date)));
    return runs[0] || null;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const type = typeFilter.value;

    const filtered = mashes.filter(m => {
      if (type && m.spirit_type !== type) return false;
      if (q && !(String(m.name).toLowerCase().includes(q) || String(m.notes || "").toLowerCase().includes(q))) return false;
      return true;
    });

    countEl.textContent = `${filtered.length} of ${mashes.length} mash recipes`;

    if (!mashes.length) {
      listEl.innerHTML = `<div class="empty-state">No mash recipes yet. Tap “+ New mash recipe” to add your first.</div>`;
      return;
    }
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-state">No mash recipes match. Try clearing the search or filter.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(m => {
      const abv = window.DISTILL.abvFromGravity(m.target_og, m.target_fg);
      const abvBadge = abv !== null ? `<span class="abv-badge">~${abv.toFixed(1)}%</span>` : "";
      const runCount = (m.runs || []).length;
      const last = latestRun(m);
      const runInfo = runCount
        ? `<span>${runCount} run${runCount === 1 ? "" : "s"}${last ? " · last " + escapeHTML(last.run_date) : ""}</span>`
        : `<span class="tag-empty">no runs logged</span>`;
      const gravity = (m.target_og || m.target_fg)
        ? `<span>OG ${escapeHTML(m.target_og || "—")} → FG ${escapeHTML(m.target_fg || "—")}</span>` : "";
      const vol = m.batch_volume ? `<span>${escapeHTML(String(m.batch_volume))} ${escapeHTML(m.volume_unit || "")}</span>` : "";

      return `<a class="recipe-card" href="mash.html?id=${encodeURIComponent(m.mash_id)}">
        <div class="name"><span>${escapeHTML(m.name)}</span>${abvBadge}</div>
        <div class="meta-row">
          ${m.spirit_type ? `<span class="category-pill">${escapeHTML(m.spirit_type)}</span>` : ""}
          ${vol}
        </div>
        <div class="ttb-row">${gravity}${runInfo}</div>
      </a>`;
    }).join("");
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  newBtn.addEventListener("click", async () => {
    if (window.API.demoMode) { alert("Demo mode — configure the API URL to add recipes."); return; }
    const name = prompt("Name for the new mash recipe:");
    if (!name || !name.trim()) return;
    const slug = "mash_" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") + "_" + Date.now().toString(36);
    newBtn.disabled = true;
    try {
      const today = new Date().toLocaleDateString("en-US");
      await window.API.addMash({ mash_id: slug, name: name.trim(), created_date: today });
      location.href = "mash.html?id=" + encodeURIComponent(slug);
    } catch (err) {
      alert("Could not create: " + err.message);
      newBtn.disabled = false;
    }
  });

  search.addEventListener("input", render);
  typeFilter.addEventListener("change", render);
  render();
})();
