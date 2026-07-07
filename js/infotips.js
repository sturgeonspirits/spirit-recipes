// v1.10.0 (2026-07-07): click-through field definitions. Any element with
// class "info-btn" and a data-tip attribute toggles a small popover showing the
// tip — tap to open, tap again / tap away / Escape to close. Keeps the form
// uncluttered while the definitions stay one tap away. Full history: CHANGELOG.md
(function () {
  let pop = null, currentBtn = null;

  function close() {
    if (pop) { pop.remove(); pop = null; }
    if (currentBtn) { currentBtn.setAttribute("aria-expanded", "false"); currentBtn = null; }
  }

  function position(btn) {
    if (!pop) return;
    const margin = 8;
    pop.style.maxWidth = Math.min(300, window.innerWidth - margin * 2) + "px";
    const r = btn.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.left + r.width / 2 - pr.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - margin) top = r.top - pr.height - 6;
    pop.style.left = left + "px";
    pop.style.top = Math.max(margin, top) + "px";
  }

  function open(btn) {
    close();
    const tip = btn.getAttribute("data-tip");
    if (!tip) return;
    pop = document.createElement("div");
    pop.className = "info-pop";
    pop.setAttribute("role", "tooltip");
    pop.textContent = tip;
    document.body.appendChild(pop);
    currentBtn = btn;
    btn.setAttribute("aria-expanded", "true");
    position(btn);
  }

  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".info-btn");
    if (btn) {
      // Don't let the click focus an input or toggle a <details>/<label>.
      e.preventDefault();
      e.stopPropagation();
      if (currentBtn === btn) close(); else open(btn);
      return;
    }
    if (pop && !e.target.closest(".info-pop")) close();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, true);
})();
