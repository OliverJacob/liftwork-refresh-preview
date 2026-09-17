/* ============================================================
   LIFTWORK — cookie consent
   Drop-in: <link rel="stylesheet" href="/consent.css">
            <script src="/consent.js" defer></script>

   Nothing non-essential runs until the visitor chooses. Read state with
   window.liftworkConsent.get() -> {analytics:bool, advertising:bool, ...}
   React to changes with window.addEventListener('lw-consent', fn).

   WIRING GOOGLE ANALYTICS LATER — gate it, do not load it unconditionally:

     window.liftworkConsent.onGrant('analytics', function(){
       var s = document.createElement('script');
       s.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX';
       s.async = true; document.head.appendChild(s);
       window.dataLayer = window.dataLayer || [];
       function gtag(){dataLayer.push(arguments);} window.gtag = gtag;
       gtag('js', new Date());
       gtag('consent', 'default', {ad_storage:'denied', analytics_storage:'denied'});
       gtag('config', 'G-XXXXXXX');
       gtag('consent', 'update', {analytics_storage:'granted'});
     });
     window.liftworkConsent.onGrant('advertising', function(){
       if (window.gtag) gtag('consent', 'update', {ad_storage:'granted', ad_user_data:'granted', ad_personalization:'granted'});
     });
   ============================================================ */
(function () {
  "use strict";

  var COOKIE = "lw_consent";
  var VERSION = 1;                 // bump to re-ask after a material policy change
  var MAX_AGE = 60 * 60 * 24 * 365; // 12 months, then ask again
  var CATEGORIES = ["analytics", "advertising"];

  /* ---------- storage ---------- */
  function readCookie() {
    var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]*)"));
    if (!m) return null;
    try {
      var v = JSON.parse(decodeURIComponent(m[1]));
      return v && v.v === VERSION ? v : null;   // stale version = ask again
    } catch (e) { return null; }
  }
  function writeCookie(state) {
    var secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = COOKIE + "=" + encodeURIComponent(JSON.stringify(state)) +
      "; Max-Age=" + MAX_AGE + "; Path=/; SameSite=Lax" + secure;
  }

  /* ---------- consent state ---------- */
  var state = readCookie();
  var granted = {};   // categories already announced, so callbacks fire once

  function gpcOn() {
    return navigator.globalPrivacyControl === true ||
           window.doNotTrack === "1" || navigator.doNotTrack === "1";
  }

  function commit(next, method) {
    state = {
      v: VERSION,
      ts: new Date().toISOString(),
      method: method,
      analytics: !!next.analytics,
      advertising: !!next.advertising
    };
    writeCookie(state);
    announce();
    window.dispatchEvent(new CustomEvent("lw-consent", { detail: copy() }));
  }

  function copy() {
    return state ? {
      analytics: state.analytics, advertising: state.advertising,
      ts: state.ts, method: state.method, version: state.v
    } : { analytics: false, advertising: false, ts: null, method: null, version: VERSION };
  }

  var pending = { analytics: [], advertising: [] };
  function announce() {
    CATEGORIES.forEach(function (c) {
      if (state && state[c] && !granted[c]) {
        granted[c] = true;
        pending[c].splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
      }
    });
  }

  /* ---------- public API ---------- */
  window.liftworkConsent = {
    get: copy,
    has: function (c) { return !!(state && state[c]); },
    onGrant: function (c, fn) {
      if (state && state[c]) { granted[c] = true; try { fn(); } catch (e) { console.error(e); } }
      else if (pending[c]) pending[c].push(fn);
    },
    open: function () { openPrefs(); },
    reset: function () {                     // for testing the first-visit flow
      document.cookie = COOKIE + "=; Max-Age=0; Path=/";
      state = null; granted = {};
      location.reload();
    }
  };

  /* ---------- UI ---------- */
  var banner, dialog;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildBanner() {
    banner = el("section", "lw-consent");
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Cookie consent");
    banner.innerHTML =
      '<div class="lw-consent__inner">' +
        '<div>' +
          '<p class="lw-consent__title">Cookies</p>' +
          '<p class="lw-consent__text">Liftwork uses cookies that are necessary for the site to work. ' +
          'With your permission we would also use analytics cookies to understand how the site is used, ' +
          'and advertising cookies to show you Liftwork advertising elsewhere. You can change your choice ' +
          'at any time. See our <a href="/privacy/">Privacy Policy</a>.</p>' +
          (gpcOn() ? '<p class="lw-gpc">Your browser is sending a Do Not Sell or Share signal. ' +
                     'Liftwork honors it — analytics and advertising cookies are off unless you turn them on here.</p>' : '') +
        '</div>' +
        '<div class="lw-consent__actions">' +
          '<button type="button" class="lw-btn" data-act="reject">Reject non-essential</button>' +
          '<button type="button" class="lw-btn" data-act="prefs">Manage preferences</button>' +
          '<button type="button" class="lw-btn lw-btn--primary" data-act="accept">Accept all</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    requestAnimationFrame(function () { banner.setAttribute("data-open", "true"); });

    banner.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var a = b.getAttribute("data-act");
      if (a === "accept") { commit({ analytics: true, advertising: true }, "banner-accept"); hideBanner(); }
      else if (a === "reject") { commit({ analytics: false, advertising: false }, "banner-reject"); hideBanner(); }
      else openPrefs();
    });
  }

  function hideBanner() {
    if (!banner) return;
    banner.removeAttribute("data-open");
    setTimeout(function () { if (banner) { banner.remove(); banner = null; } }, 340);
  }

  function buildPrefs() {
    dialog = el("dialog", "lw-prefs");
    dialog.setAttribute("aria-labelledby", "lw-prefs-title");
    var cur = state || { analytics: false, advertising: false };
    dialog.innerHTML =
      '<div class="lw-prefs__head">' +
        '<h2 id="lw-prefs-title">Your privacy choices</h2>' +
        '<p>Choose which cookies Liftwork may use. Necessary cookies cannot be turned off because the ' +
        'site does not work without them. Your choice is saved for 12 months and you can change it any time.</p>' +
        (gpcOn() ? '<p class="lw-gpc">Your browser is sending a Do Not Sell or Share signal, so ' +
                   'analytics and advertising start switched off.</p>' : '') +
      '</div>' +
      '<div class="lw-prefs__body">' +
        cat("necessary", "Strictly necessary", "Required for the site to function — remembering your cookie choice, security, and load balancing. These are always on.", true, true) +
        cat("analytics", "Analytics", "Google Analytics, used to understand how visitors find and use liftwork.com so we can improve it. Collects pages viewed, time on page, approximate location from a truncated IP address, and device type.", cur.analytics, false) +
        cat("advertising", "Advertising", "Advertising features that let Liftwork show you our advertising on other sites and measure whether it worked. Under California law this counts as sharing personal information for cross-context behavioral advertising.", cur.advertising, false) +
      '</div>' +
      '<div class="lw-prefs__foot">' +
        '<button type="button" class="lw-btn" data-act="reject-all">Reject non-essential</button>' +
        '<button type="button" class="lw-btn" data-act="accept-all">Accept all</button>' +
        '<button type="button" class="lw-btn lw-btn--primary" data-act="save">Save choices</button>' +
      '</div>';
    document.body.appendChild(dialog);

    dialog.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var a = b.getAttribute("data-act");
      if (a === "accept-all") setToggles(true);
      if (a === "reject-all") setToggles(false);
      if (a === "save" || a === "accept-all" || a === "reject-all") {
        commit({
          analytics: dialog.querySelector("#lw-c-analytics").checked,
          advertising: dialog.querySelector("#lw-c-advertising").checked
        }, "preferences");
        dialog.close(); hideBanner();
      }
    });
    dialog.addEventListener("close", function () { dialog.remove(); dialog = null; });
  }

  function cat(id, title, desc, on, locked) {
    return '<div class="lw-cat">' +
      '<h3>' + title + '</h3>' +
      (locked
        ? '<span class="lw-cat__locked">Always on</span>'
        : '<label class="lw-switch">' +
            '<input type="checkbox" id="lw-c-' + id + '"' + (on ? " checked" : "") +
            ' aria-describedby="lw-d-' + id + '">' +
            '<span class="lw-switch__track"></span><span class="lw-switch__thumb"></span>' +
            '<span class="lw-sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">' + title + '</span>' +
          '</label>') +
      '<p id="lw-d-' + id + '">' + desc + '</p></div>';
  }

  function setToggles(v) {
    CATEGORIES.forEach(function (c) {
      var n = dialog.querySelector("#lw-c-" + c); if (n) n.checked = v;
    });
  }

  function openPrefs() { if (!dialog) buildPrefs(); dialog.showModal(); }

  /* ---------- boot ---------- */
  function start() {
    if (state) { announce(); return; }          // already chosen
    buildBanner();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  /* any element with data-lw-consent-open reopens preferences */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-lw-consent-open]");
    if (t) { e.preventDefault(); openPrefs(); }
  });
})();
