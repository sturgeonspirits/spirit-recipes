// v1.9.0 (2026-07-07): sign-in form handler. On success it stores the session
// token (via auth.js) and returns to wherever the user was headed. Full history:
// CHANGELOG.md
(function () {
  const form = document.getElementById("login-form");
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  // Demo mode: no backend, so there's nothing to protect — send them straight in.
  if (window.API.demoMode) {
    document.getElementById("login-demo").style.display = "block";
    form.querySelectorAll("input, button").forEach(el => { el.disabled = true; });
    return;
  }

  // Already signed in? Skip the form.
  if (window.AUTH && window.AUTH.isAuthed()) {
    location.replace(nextTarget());
    return;
  }

  function nextTarget() {
    const p = new URLSearchParams(location.search).get("next");
    // Only allow same-site relative targets (no protocol, no host).
    if (p && /^[a-z0-9._~%\-\/?=&]+$/i.test(p) && !/^\/\//.test(p) && !/:/.test(p)) return p;
    return "index.html";
  }
  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errEl.hidden = true;
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const remember = document.getElementById("remember").checked;
    if (!username || !password) { showError("Enter your username and password."); return; }

    btn.disabled = true; const orig = btn.textContent; btn.textContent = "Signing in…";
    try {
      const res = await window.API.login(username, password, remember);
      if (res && res.ok && res.token) {
        location.replace(nextTarget());
      } else {
        showError((res && res.error) || "Sign-in failed. Please try again.");
        btn.disabled = false; btn.textContent = orig;
      }
    } catch (err) {
      showError(err.message || "Couldn't reach the server. Check your connection and try again.");
      btn.disabled = false; btn.textContent = orig;
    }
  });
})();
