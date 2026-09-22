// GEN Yoga — Capacitor native bridge (iOS + Android).
// - Enlaces externos (maps, wa.me, instagram, stripe, supabase auth...) se abren
//   en el navegador del sistema via @capacitor/browser cuando existe,
//   con fallback seguro a window.open. Evita que el WebView se quede
//   atrapado en una pagina externa sin boton atras ("la app se cuelga").
// - Boton atras de Android: si hay modales abiertos los cierra, si no
//   navega atras o minimiza en la pagina principal en vez de cerrar de golpe.
// - Banner offline no bloqueante cuando no hay red.
// - Oculta la splash en cuanto la web esta lista (con timeout de seguridad).
// Todo con guards: en web movil/escritorio no hace nada y nunca lanza.
(function () {
  'use strict';

  var EXTERNAL_HOSTS = [
    'google.com', 'maps.google.com', 'wa.me', 'api.whatsapp.com',
    'instagram.com', 'facebook.com',
    'checkout.stripe.com', 'billing.stripe.com',
    'youtube.com', 'youtube-nocookie.com', 'youtu.be',
    'cdn.jsdelivr.net'
  ];

  function isNative() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
        return window.Capacitor.getPlatform() !== 'web';
      }
      return window.location.protocol === 'capacitor:' || window.location.protocol === 'ionic:';
    } catch (e) {
      return false;
    }
  }

  function isExternalUrl(raw) {
    var url;
    try {
      url = new URL(raw, window.location.href);
    } catch (e) {
      return false;
    }
    if (url.protocol === 'mailto:' || url.protocol === 'tel:' || url.protocol === 'sms:') return true;
    if (url.origin === window.location.origin) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    var host = (url.hostname || '').toLowerCase();
    // Supabase auth / functions y el propio dominio van dentro del WebView.
    if (host.indexOf('supabase.co') !== -1) return false;
    if (host === 'genyoga.studio' || host.endsWith('.genyoga.studio')) return false;
    if (host === 'localhost' || host === '127.0.0.1') return false;
    return true;
  }

  function openExternal(url) {
    try {
      var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
      if (Browser && typeof Browser.open === 'function') {
        Browser.open({ url: url, presentationStyle: 'popover' }).catch(function () {
          window.open(url, '_system') || window.open(url, '_blank', 'noopener');
        });
        return;
      }
    } catch (e) { /* fallback abajo */ }
    try {
      var w = window.open(url, '_system');
      if (!w) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      window.location.href = url;
    }
  }

  function closeAnyModal() {
    try {
      if (typeof window.cerrarFlashWelcomeModal === 'function') {
        var flash = document.getElementById('flash-welcome-modal');
        if (flash && !flash.classList.contains('pointer-events-none')) {
          window.cerrarFlashWelcomeModal();
          return true;
        }
      }
      if (typeof window.closeModal === 'function') {
        var overlay = document.getElementById('modal-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
          window.closeModal();
          return true;
        }
      }
      var openDialog = document.querySelector('[role="dialog"]:not(.hidden)');
      if (openDialog && openDialog.id !== 'flash-welcome-modal') {
        if (typeof window.closeModal === 'function') { window.closeModal(); return true; }
      }
    } catch (e) { /* ignorar */ }
    return false;
  }

  function ensureOfflineBanner() {
    try {
      if (document.getElementById('gy-offline-banner')) return;
      var bar = document.createElement('div');
      bar.id = 'gy-offline-banner';
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);' +
        'z-index:12000;display:none;text-align:center;font-size:13px;font-weight:600;' +
        'background:#3c2a21;color:#faf7f2;padding:10px 14px;border-radius:12px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.35);';
      bar.textContent = 'Sin conexión. Revisa tu red para reservar o ver horarios.';
      document.addEventListener('DOMContentLoaded', function () {
        if (document.body) document.body.appendChild(bar);
      });
      if (document.body) document.body.appendChild(bar);
      window.__gyOfflineBanner = bar;
    } catch (e) { /* ignorar */ }
  }

  function setOffline(offline) {
    try {
      var bar = document.getElementById('gy-offline-banner') || window.__gyOfflineBanner;
      if (!bar) return;
      if (!offline) {
        bar.style.display = 'none';
        return;
      }
      // Evitar tapar la píldora de idioma cuando vive abajo (profile.html):
      // subir el banner por encima de ella en vez de solaparse.
      var lift = 12;
      try {
        var lang = document.getElementById('floating-lang-selector');
        if (lang) {
          var cs = window.getComputedStyle(lang);
          var r = lang.getBoundingClientRect();
          if (cs && cs.bottom !== 'auto' && cs.display !== 'none' &&
              r.bottom > window.innerHeight - 120 && r.width > 0) {
            lift = 64;
          }
        }
      } catch (e) { /* mantener 12 */ }
      bar.style.bottom = 'calc(env(safe-area-inset-bottom,0px) + ' + lift + 'px)';
      bar.style.display = 'block';
    } catch (e) { /* ignorar */ }
  }

  function watchConnectivity(native) {
    ensureOfflineBanner();
    var update = function () {
      try { setOffline(navigator.onLine === false); } catch (e) { /* ignorar */ }
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    try {
      var Network = native && window.Capacitor.Plugins && window.Capacitor.Plugins.Network;
      if (Network && typeof Network.getStatus === 'function') {
        Network.getStatus().then(function (s) { setOffline(s && s.connected === false); }).catch(function () {});
        if (typeof Network.addListener === 'function') {
          Network.addListener('networkStatusChange', function (s) { setOffline(s && s.connected === false); });
        }
      }
    } catch (e) { /* fallback a online/offline ya registrado */ }
  }

  function hideSplash(native) {
    var done = false;
    var hide = function () {
      if (done) return;
      done = true;
      try {
        var Splash = native && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen;
        if (Splash && typeof Splash.hide === 'function') Splash.hide().catch(function () {});
      } catch (e) { /* ignorar */ }
    };
    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide);
    setTimeout(hide, 3500); // seguridad: nunca dejar la splash colgada
  }

  // Retorno a la app tras el pago (Stripe redirige a genyoga.studio/success.html
  // o cancel.html). Sin esto, el deep link reabre la app en index.html y se
  // pierde el contexto del pago ("pagué pero no me sale nada").
  function hookAppUrlOpen(native) {
    if (!native) return;
    try {
      var App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!App || typeof App.addListener !== 'function') return;
      App.addListener('appUrlOpen', function (event) {
        try {
          var raw = event && event.url;
          if (!raw) return;
          var url = new URL(raw);
          var isOurs = url.protocol === 'com.genyoga.app:' || url.protocol === 'gen.yoga.app:' ||
            url.hostname === 'genyoga.studio' || url.hostname.endsWith('.genyoga.studio');
          if (!isOurs) return;
          var path = url.pathname || '/index.html';
          // Solo navegar a paginas de la propia app, con query intacta
          // (session_id de Stripe, flags de invitado...).
          if (!/^\/[A-Za-z0-9_-]+\.html$/.test(path) && path !== '/') return;
          var target = path + url.search + url.hash;
          var current = window.location.pathname + window.location.search + window.location.hash;
          if (target !== current) window.location.href = target;
        } catch (e) { /* ignorar deep links malformados */ }
      });
    } catch (e) { /* ignorar */ }
  }

  function hookBackButton(native) {
    try {
      var App = native && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (!App || typeof App.addListener !== 'function') return;
      App.addListener('backButton', function () {
        if (closeAnyModal()) return;
        try {
          if (window.history && window.history.length > 1) window.history.back();
          else if (typeof App.minimizeApp === 'function') App.minimizeApp().catch(function () {});
        } catch (e) { /* ignorar */ }
      });
    } catch (e) { /* ignorar */ }
  }

  function hookExternalLinks() {
    document.addEventListener('click', function (ev) {
      try {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a) return;
        var href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#' || href.startsWith('javascript:')) return;
        if (a.target === '_blank' || isExternalUrl(href)) {
          // Solo interceptar en app nativa; en web se respeta el comportamiento normal.
          if (!isNative()) return;
          ev.preventDefault();
          openExternal(a.href);
        }
      } catch (e) { /* dejar navegar por defecto */ }
    }, true);
  }

  // Stripe / Supabase a veces devuelven con window.location.assign a checkout:
  // envolver para abrir checkout/portal fuera del WebView en nativo.
  function hookStripeRedirects(native) {
    if (!native) return;
    try {
      var origAssign = window.location.assign.bind(window.location);
      window.location.assign = function (url) {
        try {
          var s = String(url);
          if (s.indexOf('checkout.stripe.com') !== -1 || s.indexOf('billing.stripe.com') !== -1) {
            openExternal(s);
            return;
          }
        } catch (e) { /* seguir flujo normal */ }
        return origAssign(url);
      };
    } catch (e) { /* ignorar */ }
  }

  try {
    var native = isNative();
    hookExternalLinks();
    watchConnectivity(native);
    if (native) {
      hookBackButton(native);
      hookAppUrlOpen(native);
      hookStripeRedirects(native);
      hideSplash(native);
    }
  } catch (e) { /* este bridge nunca debe tumbar la app */ }
})();
