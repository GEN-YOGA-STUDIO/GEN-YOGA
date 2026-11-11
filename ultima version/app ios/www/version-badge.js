/*
 * Muestra la versión exacta desplegada (p. ej. v18.4.6) en el pie de todas las páginas.
 * La fuente es version.json, que scripts/bump-version.mjs reescribe en cada
 * `npm run cambio`; así la versión visible siempre acompaña a la release.
 */
(function () {
    function pintarVersion(version) {
        if (!version) return;
        document.querySelectorAll('#app-version-label, #app-version-label-mobile').forEach(function (el) {
            el.textContent = el.textContent.replace(/v\d+(?:\.\d+){0,2}/, 'v' + version);
        });
    }

    function cargarVersion() {
        fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) { if (data && data.version) pintarVersion(data.version); })
            .catch(function () { });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cargarVersion);
    } else {
        cargarVersion();
    }
})();
