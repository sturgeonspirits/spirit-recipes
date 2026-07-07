// v1.9.0 (2026-07-07): client-side auth gate. Holds the session token, redirects
// to login.html when signed out, and injects a "Sign out" control into the page
// header. The token is sent with every API call (see api.js); the Apps Script
// backend is what actually enforces access. Full history: CHANGELOG.md
window.AUTH = (function () {
  const KEY = "ss_auth";

  function readStored() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "null"); }
    catch (_) { return null; }
  }
  function writeStored(obj, remember) {
    const s = JSON.stringify(obj);
    sessionStorage.setItem(KEY, s);
    if (remember) localStorage.setItem(KEY, s); else localStorage.removeItem(KEY);
  }
  function wipeStored() {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  }

  let sess = readStored();
  const onLoginPage = /login\.html$/i.test(location.pathname);
  // In demo mode (no backend configured) there's nothing to protect.
  const demoMode = !(window.CONFIG && window.CONFIG.API_URL);

  const AUTH = {
    get token() { return sess && sess.token; },
    get user() { return (sess && sess.display_name) || ""; },
    isAuthed() { return !!(sess && sess.token); },
    demoMode: demoMode,

    set(obj, remember) { sess = obj; writeStored(obj, remember); },
    clearSession() { sess = null; wipeStored(); },

    // Send the user to the login page, remembering where they were headed.
    toLogin() {
      const here = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      location.replace("login.html?next=" + here);
    },

    // Redirect to login if this page needs auth and we don't have a session.
    guard() {
      if (demoMode || onLoginPage) return;
      if (!this.isAuthed()) this.toLogin();
    },

    async logout() {
      try { if (window.API && window.API.logout) await window.API.logout(); } catch (_) { /* best effort */ }
      this.clearSession();
      location.replace("login.html");
    }
  };

  // Gate the page as early as possible.
  AUTH.guard();

  // Once the DOM is ready, drop a small sign-out control into the header.
  if (!demoMode && !onLoginPage) {
    document.addEventListener("DOMContentLoaded", function () {
      if (!AUTH.isAuthed()) return;
      const header = document.querySelector("header.top");
      if (!header || header.querySelector(".auth-control")) return;
      const wrap = document.createElement("div");
      wrap.className = "auth-control";
      wrap.innerHTML =
        (AUTH.user ? `<span class="auth-user">${String(AUTH.user).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))}</span>` : "") +
        `<button type="button" class="auth-signout">Sign out</button>`;
      wrap.querySelector(".auth-signout").addEventListener("click", () => AUTH.logout());
      header.appendChild(wrap);
    });
  }

  return AUTH;
})();
