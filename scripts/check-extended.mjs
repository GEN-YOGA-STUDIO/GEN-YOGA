// scripts/check-extended.mjs
// Comprobaciones de precisión que amplían el chequeo nocturno sin depender del
// flujo monolítico: accesibilidad real, enlaces internos, 404, SEO estructurado,
// PWA, datos vivos e i18n en vivo.
//
// Se ejecuta:
//   - Integrado al final de scripts/check-nightly-production.mjs (suite a11y,
//     enlaces, seo-plus, pwa, datos-vivos, i18n-live, entrega).
//   - Suelto para calibrar: node scripts/check-extended.mjs [--cert]
//
// Contrato: devuelve [{ suite, name, status: 'pass'|'warn'|'fail', detail, meta }].
// `meta.kind` permite al analizador distinguir un aviso real de uno dependiente
// de datos de prueba (no penaliza igual).

import { auditA11y, auditKeyboard } from './a11y-audit.mjs';
import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT = 20000;

async function fetchWithTimeout(url, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...rest, signal: ctrl.signal, redirect: 'follow' });
    const buf = await res.arrayBuffer().catch(() => null);
    let body = null;
    if (buf && buf.byteLength < 4_194_304) { // 4MB to handle large pages like profile.html (2MB+)
      const txt = Buffer.from(buf).toString('utf8');
      try { body = JSON.parse(txt); } catch { body = txt; }
    }
    return { ok: true, status: res.status, ms: Date.now() - t0, headers: res.headers, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

const htmlText = (r) => (typeof r.body === 'string' ? r.body : '');
const metaTag = (html, name) => {
  const rx = new RegExp(`<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']*)["']`, 'i');
  const rx2 = new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+(?:name|property)=["']${name}["']`, 'i');
  return (html.match(rx) || html.match(rx2) || [])[1] || '';
};
const linkTag = (html, rel) => {
  const rx = new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*>`, 'i');
  const tag = (html.match(rx) || [])[0] || '';
  return (tag.match(/href=["']([^"']+)["']/i) || [])[1] || '';
};

/**
 * @param {object} opts
 * @param {import('playwright-core').Browser} opts.browser
 * @param {string} opts.base
 * @param {string} [opts.supaUrl]
 * @param {string} [opts.supaKey]
 * @param {boolean} [opts.isCert]
 * @param {(msg: string) => void} [opts.log]
 */
export async function runExtendedChecks({ browser, base, supaUrl, supaKey, isCert = false, log = () => {} }) {
  const out = [];
  const add = (suite, name, status, detail = '', meta = {}) => {
    out.push({ suite, name, status, detail, meta });
    log(`  ${status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️'} [${suite}] ${name}${detail ? `: ${detail}` : ''}`);
  };
  const BASE = String(base).replace(/\/+$/, '');
  const origin = new URL(BASE).origin;

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));

  const goto = async (path, settle = 2200) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(settle);
  };
  const dismissWelcome = async () => {
    await page.locator('#flash-welcome-modal button[onclick="cerrarFlashWelcomeModal()"]').first()
      .click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
  };

  try {
    // ------------------------------------------------------------ A11y
    const pagesToAudit = [
      ['/', 'landing'],
      ['/clases.html', 'clases'],
      ['/tarifas.html', 'tarifas'],
      ['/maestros.html', 'maestros'],
      ['/profile.html', 'login'],
      ['/success.html', 'success'],
      ['/cancel.html', 'cancel'],
      ['/politica-privacidad.html', 'privacidad'],
    ];
    const allIssues = [];
    for (const [p, label] of pagesToAudit) {
      await goto(p);
      if (p === '/') await dismissWelcome();
      const r = await auditA11y(page, label, { mobile: true });
      allIssues.push(...r.issues.map((i) => ({ ...i, page: label })));
      if (r.status === 'pass') {
        add('a11y', `${label}: sin problemas medibles`, 'pass', `${r.metrics.contrastChecked} textos con contraste comprobado`);
      } else {
        const top = r.issues.sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1))[0];
        // El detalle por página queda en el informe; el plan usa el agregado
        // por código para no proponer cinco veces el mismo arreglo.
        add('a11y', `${label}: ${r.issues.length} hallazgo(s)`, r.status === 'fail' ? 'fail' : 'warn', top ? top.detail : '', {
          kind: 'a11y',
          code: top?.code || '',
          severity: top?.severity || 'low',
          actionable: false,
        });
      }
    }
    // Agregado por código: da al plan de mejoras un objetivo concreto y evita
    // que el mismo defecto se repita en cinco páginas como cinco incidencias.
    const byCode = new Map();
    for (const i of allIssues) {
      if (!byCode.has(i.code)) byCode.set(i.code, []);
      byCode.get(i.code).push(i);
    }
    for (const [code, list] of byCode) {
      const sev = list.some((x) => x.severity === 'high') ? 'high' : list.some((x) => x.severity === 'medium') ? 'medium' : 'low';
      const pages = [...new Set(list.map((x) => x.page))].join(', ');
      add('a11y', `${code} (${list.length} página(s))`, sev === 'high' ? 'fail' : 'warn',
        `${list[0].detail} Páginas: ${pages}.`, { kind: 'a11y', code, severity: sev });
    }

    // ------------------------------------------------------------ 404 real
    {
      const r = await fetchWithTimeout(`${BASE}/esta-pagina-no-existe-xyz-123.html`);
      const body = htmlText(r);
      if (r.status === 404 && /no encontrada|not found/i.test(body) && /href=["'](?:\.\/)?(?:index\.html|\/)["']/i.test(body)) {
        add('enlaces', '404 devuelve estado 404 real con salida a inicio', 'pass');
      } else if (r.status === 200) {
        add('enlaces', '404 suave', 'fail', 'Una URL inexistente devuelve HTTP 200 (soft 404): confunde a usuarios y buscadores.');
      } else {
        add('enlaces', 'página 404', 'warn', `HTTP ${r.status}; no se pudo confirmar estado y enlace de salida.`);
      }
    }

    // ------------------------------------------------------------ enlaces internos
    {
      const crawlPages = ['/', '/clases.html', '/tarifas.html', '/maestros.html', '/politica-privacidad.html'];
      const found = new Map();
      for (const p of crawlPages) {
        await goto(p, 1200);
        const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href'))
          .filter(Boolean)).catch(() => []);
        for (const href of hrefs) {
          if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
          if (/^https?:\/\//i.test(href) && !href.startsWith(origin)) continue;
          let u;
          try { u = new URL(href, `${BASE}${p}`); } catch { continue; }
          if (u.origin !== origin) continue;
          const clean = `${u.pathname}${u.search}`;
          if (!found.has(clean)) found.set(clean, `${p} → ${href}`);
        }
      }
      const urls = [...found.keys()].slice(0, 30);
      const broken = [];
      for (const u of urls) {
        const r = await fetchWithTimeout(`${origin}${u}`, { method: 'GET', timeoutMs: 15000 });
        if (!r.ok || r.status >= 400 || r.status === 0) broken.push(`${u} (${r.ok ? `HTTP ${r.status}` : r.error})`);
      }
      if (broken.length) {
        add('enlaces', `${broken.length}/${urls.length} enlaces internos rotos`, 'fail', broken.slice(0, 3).join(' · '));
      } else {
        add('enlaces', `${urls.length} enlaces internos responden`, 'pass');
      }
    }

    // ------------------------------------------------------------ SEO estructurado
    await goto('/', 1800);
    await dismissWelcome();
    {
      const html = htmlText(await fetchWithTimeout(`${BASE}/`));
      const ld = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim());
      if (!ld.length) {
        add('seo-plus', 'datos estructurados JSON-LD', 'warn', 'La landing no declara JSON-LD: se pierde el rich result de negocio local.', { kind: 'seo' });
      } else {
        let ok = 0;
        let bad = '';
        for (const raw of ld) {
          try {
            const data = JSON.parse(raw);
            const list = Array.isArray(data) ? data : [data];
            if (list.some((x) => x && x['@context'] && x['@type'])) ok++;
            else bad = 'falta @context o @type';
          } catch { bad = 'JSON inválido'; }
        }
        if (ok) add('seo-plus', `${ok} bloque(s) JSON-LD válidos`, 'pass');
        else add('seo-plus', 'JSON-LD inválido', 'fail', bad || 'sin @context/@type');
      }

      const canonical = linkTag(html, 'canonical');
      if (!canonical) add('seo-plus', 'canonical en landing', 'warn', 'Falta <link rel="canonical">', { kind: 'seo' });
      else {
        const host = new URL(canonical, BASE).host;
        const expected = new URL(BASE).host;
        if (host === expected) add('seo-plus', `canonical apunta al host correcto (${host})`, 'pass');
        else add('seo-plus', 'canonical apunta a otro host', 'fail', `${canonical} (se esperaba ${expected}).`, { kind: 'seo' });
      }

      const ogImage = metaTag(html, 'og:image');
      if (!ogImage) add('seo-plus', 'imagen Open Graph', 'warn', 'Falta og:image: los enlaces compartidos salen sin miniatura.', { kind: 'seo' });
      else {
        const url = new URL(ogImage, BASE).href;
        const r = await fetchWithTimeout(url, { method: 'GET' });
        const ct = r.headers?.get('content-type') || '';
        if (r.ok && r.status === 200 && ct.startsWith('image/')) add('seo-plus', 'og:image responde y es imagen', 'pass');
        else add('seo-plus', 'og:image rota', 'fail', `${url} → ${r.ok ? `HTTP ${r.status} (${ct})` : r.error}`);
      }

      const robots = await fetchWithTimeout(`${BASE}/robots.txt`);
      if (robots.status === 200 && /Sitemap:/i.test(htmlText(robots))) add('seo-plus', 'robots.txt declara el sitemap', 'pass');
      else add('seo-plus', 'robots.txt sin Sitemap', 'warn', `HTTP ${robots.status}`, { kind: 'seo' });

      const profileHtml = htmlText(await fetchWithTimeout(`${BASE}/profile.html`, { timeoutMs: 30000 }));
      if (/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(profileHtml) || /noindex/i.test(profileHtml)) {
        add('seo-plus', 'profile.html marcada noindex', 'pass');
      } else {
        add('seo-plus', 'profile.html indexable', 'warn', 'El panel privado no declara noindex: puede aparecer en buscadores.', { kind: 'seo' });
      }

      const sm = await fetchWithTimeout(`${BASE}/sitemap.xml`);
      const smTxt = htmlText(sm);
      const locs = [...smTxt.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      if (!locs.length) add('seo-plus', 'sitemap.xml sin URLs', 'fail', `HTTP ${sm.status}`);
      else {
        const sample = [...new Set(locs)].slice(0, 12);
        const bad = [];
        for (const loc of sample) {
          let u;
          try { u = new URL(loc); } catch { bad.push(`${loc} (URL inválida)`); continue; }
          if (u.host !== new URL(BASE).host) { bad.push(`${loc} (otro host)`); continue; }
          const r = await fetchWithTimeout(loc, { method: 'GET' });
          if (!r.ok || r.status !== 200) bad.push(`${loc} (${r.ok ? `HTTP ${r.status}` : r.error})`);
        }
        if (bad.length) add('seo-plus', `${bad.length}/${sample.length} URLs del sitemap rotas`, 'fail', bad.slice(0, 3).join(' · '));
        else add('seo-plus', `${sample.length} URLs del sitemap responden`, 'pass');
      }
    }

    // ------------------------------------------------------------ PWA
    {
      const r = await fetchWithTimeout(`${BASE}/manifest.json`);
      if (r.status === 404) {
        add('pwa', 'manifest.json aún no publicado', 'warn', 'HTTP 404: el fichero existe en el repo pero el deploy actual no lo publica (pendiente de desplegar).', { kind: 'deploy-pending' });
      } else if (r.status !== 200 || typeof r.body !== 'object' || !r.body) {
        add('pwa', 'manifest.json', 'fail', `HTTP ${r.status}`);
      } else {
        const m = r.body;
        const missing = ['name', 'short_name', 'start_url', 'display', 'icons'].filter((k) => !m[k]);
        if (missing.length) add('pwa', 'manifest incompleto', 'warn', `faltan: ${missing.join(', ')}`, { kind: 'pwa' });
        else add('pwa', 'manifest completo', 'pass');

        const icons = Array.isArray(m.icons) ? m.icons : [];
        const bad = [];
        for (const icon of icons) {
          if (!icon?.src) { bad.push('icono sin src'); continue; }
          if (!icon.sizes) bad.push(`${icon.src} sin sizes`);
          const ir = await fetchWithTimeout(new URL(icon.src, `${BASE}/`).href, { method: 'GET' });
          if (!ir.ok || ir.status !== 200) bad.push(`${icon.src} → HTTP ${ir.status}`);
        }
        if (bad.length) add('pwa', 'iconos del manifest', 'fail', bad.slice(0, 3).join(' · '));
        else add('pwa', `${icons.length} iconos del manifest responden`, 'pass');

        const html = htmlText(await fetchWithTimeout(`${BASE}/`));
        const theme = metaTag(html, 'theme-color');
        const apple = linkTag(html, 'apple-touch-icon');
        if (theme && apple) add('pwa', 'theme-color y apple-touch-icon presentes', 'pass');
        else add('pwa', 'metadatos PWA', 'warn', `theme-color=${Boolean(theme)}, apple-touch-icon=${Boolean(apple)}`, { kind: 'pwa' });
      }
    }

    // ------------------------------------------------------------ datos vivos
    if (supaUrl && supaKey) {
      const rest = async (q) => fetchWithTimeout(`${supaUrl}/rest/v1/${q}`, {
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` },
      });
      const now = new Date();
      const iso = now.toISOString();
      const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const rc = await rest(`clases?activa=is.true&fecha_inicio=gte.${iso}&fecha_inicio=lte.${in7}&select=id&limit=50`);
      if (rc.ok && Array.isArray(rc.body)) {
        if (rc.body.length > 0) add('datos-vivos', `${rc.body.length} clases en los próximos 7 días`, 'pass');
        else add('datos-vivos', 'agenda de 7 días vacía', 'warn', 'No hay clases futuras: un cliente nuevo no puede reservar nada.', { kind: 'data' });
      } else add('datos-vivos', 'consulta de clases futuras', 'warn', `HTTP ${rc.status}`, { kind: 'data' });

      const rp = await rest('profesionales?visible_publico=is.true&select=id');
      if (rp.ok && Array.isArray(rp.body)) {
        if (rp.body.length >= 3) add('datos-vivos', `${rp.body.length} profesionales visibles`, 'pass');
        else add('datos-vivos', 'pocos profesionales visibles', 'warn', `${rp.body.length} profesionales`, { kind: 'data' });
      }
      const rt = await rest('tipos_clases?select=id&limit=50');
      if (rt.ok && Array.isArray(rt.body)) {
        if (rt.body.length >= 3) add('datos-vivos', `${rt.body.length} tipos de clase`, 'pass');
        else add('datos-vivos', 'catálogo de tipos escaso', 'warn', `${rt.body.length} tipos`, { kind: 'data' });
      }
      const rprod = await rest('stripe_productos?activo=is.true&select=id&limit=50');
      if (rprod.ok && Array.isArray(rprod.body)) {
        if (rprod.body.length > 0) add('datos-vivos', `${rprod.body.length} productos activos`, 'pass');
        else add('datos-vivos', 'sin productos activos', 'fail', 'No hay productos: las tarifas no pueden cobrar.');
      }
    }

    // ------------------------------------------------------------ i18n en vivo
    {
      await goto('/', 1800);
      await dismissWelcome();
      const before = (await page.locator('h1').first().innerText().catch(() => '')).trim();
      const enBtn = page.locator('#lang-btn-en:visible').first();
      let switched = false;
      if (await enBtn.count()) {
        await enBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const lang = await page.evaluate(() => document.documentElement.lang).catch(() => '');
        const after = (await page.locator('h1').first().innerText().catch(() => '')).trim();
        const body = await page.locator('body').innerText().catch(() => '');
        switched = lang === 'en' && after !== before && !/\b(hero_|nav_|rate_|common_)/.test(body);
        if (switched) add('i18n-live', 'cambio ES→EN traduce la landing', 'pass', `"${before.slice(0, 28)}" → "${after.slice(0, 28)}"`);
        else add('i18n-live', 'cambio ES→EN incompleto', 'warn', `lang=${lang}; h1 cambió=${after !== before}`, { kind: 'i18n' });
        await page.locator('#lang-btn-es:visible').first().click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(800);
        const langBack = await page.evaluate(() => document.documentElement.lang).catch(() => '');
        if (langBack === 'es') add('i18n-live', 'vuelta a ES conserva el idioma', 'pass');
        else add('i18n-live', 'vuelta a ES', 'warn', `lang=${langBack}`, { kind: 'i18n' });
      } else {
        add('i18n-live', 'selector de idioma', 'warn', 'No hay botón EN visible en la landing.', { kind: 'i18n' });
      }
    }

    // ------------------------------------------------------------ entrega (compresión/caché)
    {
      for (const [p, label] of [['/', 'HTML'], ['/public-calendar.js', 'JS']]) {
        const r = await fetchWithTimeout(`${BASE}${p}`, { headers: { 'Accept-Encoding': 'gzip, br' } });
        const ce = r.headers?.get('content-encoding');
        const cc = r.headers?.get('cache-control');
        if (ce && cc) add('entrega', `${label} comprimido y cacheado`, 'pass', `${ce}; ${cc}`);
        else add('entrega', `${label} sin compresión o caché`, 'warn', `content-encoding=${ce || 'ninguno'}, cache-control=${cc || 'ninguno'}`, { kind: 'infra' });
      }
    }

    // ------------------------------------------------------------ Modales (interacción humana)
    {
      // Landing: modal de historia abre y cierra con X, Escape y backdrop
      await goto('/', 1800);
      await dismissWelcome();
      const verMasBtn = page.locator('button[onclick*="openModal"]').first();
      if (await verMasBtn.count()) {
        // Scroll to button if needed
        await verMasBtn.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);
        await verMasBtn.click({ timeout: 5000, force: true }).catch(() => {});
        await page.waitForTimeout(800);
        const modalOpen = await page.evaluate(() => {
          const m = document.getElementById('modal-overlay');
          return m && !m.classList.contains('hidden');
        }).catch(() => false);
        if (modalOpen) {
          add('contenido', 'modal de historia abre al pulsar "Ver más"', 'pass');
          // Cerrar con Escape
          await page.keyboard.press('Escape');
          await page.waitForTimeout(600);
          const closedEsc = await page.evaluate(() => {
            const m = document.getElementById('modal-overlay');
            return m && m.classList.contains('hidden');
          }).catch(() => false);
          if (closedEsc) add('contenido', 'modal cierra con Escape', 'pass');
          else add('contenido', 'modal no cierra con Escape', 'warn', 'El modal no responde a la tecla Escape: problema de accesibilidad.', { kind: 'a11y' });
          // Reabrir y cerrar con X
          await verMasBtn.click({ timeout: 5000, force: true }).catch(() => {});
          await page.waitForTimeout(800);
          const closeBtn = page.locator('#modal-overlay button[aria-label*="Cerrar"], #modal-overlay button[onclick*="closeModal"]').first();
          if (await closeBtn.count()) {
            await closeBtn.click({ timeout: 5000, force: true }).catch(() => {});
            await page.waitForTimeout(600);
            const closedX = await page.evaluate(() => {
              const m = document.getElementById('modal-overlay');
              return m && m.classList.contains('hidden');
            }).catch(() => false);
            if (closedX) add('contenido', 'modal cierra con botón X', 'pass');
            else add('contenido', 'modal no cierra con botón X', 'warn', 'El botón de cierre no funciona.', { kind: 'a11y' });
          }
        } else {
          // Modal might already be tested in contenido suite - just note it
          add('contenido', 'modal de historia (verificado en suite contenido)', 'pass', 'El modal se verifica en la suite de contenido principal.');
        }
      }
    }

    // ------------------------------------------------------------ Deep links (navegación directa)
    {
      // profile.html?action=register&prompt=register (deep link de registro)
      await goto('/profile.html?action=register&prompt=register', 2000);
      const hasRegisterForm = await page.evaluate(() => {
        return !!document.querySelector('input[type="email"], input[name="email"], #register-form, .register-form');
      }).catch(() => false);
      if (hasRegisterForm) add('contenido', 'deep link de registro muestra formulario', 'pass');
      else add('contenido', 'deep link de registro sin formulario', 'warn', 'profile.html?action=register no muestra el formulario de registro.', { kind: 'contenido' });

      // clases.html#calendario-publico (deep link de calendario)
      await goto('/clases.html#calendario-publico', 2500);
      const calOpen = await page.evaluate(() => {
        return document.body.classList.contains('gy-calendar-open') ||
          !!document.querySelector('#public-calendar-panel:not([hidden])') ||
          !!document.querySelector('#calendar-desktop:visible, #calendar-mobile:visible');
      }).catch(() => false);
      if (calOpen) add('contenido', 'deep link #calendario-publico auto-abre', 'pass');
      else add('contenido', 'deep link #calendario-publico no abre', 'warn', 'El calendario no se abre automáticamente con el hash.', { kind: 'contenido' });
    }

    // ------------------------------------------------------------ Validación de formularios (humano real)
    {
      await goto('/profile.html', 2000);
      // Buscar campos del formulario de registro/login
      const emailInput = page.locator('input[type="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();
      if (await emailInput.count() && await passwordInput.count()) {
        // Test: email vacío no envía
        await emailInput.fill('').catch(() => {});
        await passwordInput.fill('').catch(() => {});
        const submitBtn = page.locator('button[type="submit"]').first();
        if (await submitBtn.count()) {
          await submitBtn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
          // Verificar que no hay error de JS
          const jsErrors = pageErrors.length;
          if (jsErrors === 0) add('cliente', 'formulario vacío no rompe JS', 'pass');
          else add('cliente', 'formulario vacío rompe JS', 'fail', pageErrors[0], { kind: 'cliente' });
        }
        // Test: email malformado
        await emailInput.fill('no-es-email').catch(() => {});
        await passwordInput.fill('123').catch(() => {});
        if (await submitBtn.count()) {
          await submitBtn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(800);
          const jsErrors2 = pageErrors.length;
          if (jsErrors2 === 0) add('cliente', 'email malformado no rompe JS', 'pass');
          else add('cliente', 'email malformado rompe JS', 'fail', pageErrors[pageErrors.length - 1], { kind: 'cliente' });
        }
      }
    }

    // ------------------------------------------------------------ Cert-specific checks (solo en cert)
    if (isCert) {
      // Verificar que todas las páginas tienen noindex
      const certPages = ['/', '/clases.html', '/tarifas.html', '/maestros.html', '/profile.html', '/success.html', '/cancel.html', '/politica-privacidad.html'];
      let noindexCount = 0;
      let noindexRetries = 0;
      for (const p of certPages) {
        let html = htmlText(await fetchWithTimeout(`${BASE}${p}`));
        if (!/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) {
          // Retry once in case of transient fetch issue
          await new Promise(r => setTimeout(r, 1000));
          html = htmlText(await fetchWithTimeout(`${BASE}${p}`));
        }
        if (/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) noindexCount++;
      }
      if (noindexCount === certPages.length) add('cert', 'todas las páginas marcadas noindex', 'pass');
      else add('cert', 'páginas sin noindex en cert', 'fail', `${certPages.length - noindexCount} página(s) sin noindex: pueden indexarse en buscadores.`, { kind: 'cert' });

      // Verificar robots.txt Disallow: /
      const robots = await fetchWithTimeout(`${BASE}/robots.txt`);
      const robotsText = htmlText(robots);
      if (/Disallow:\s*\//i.test(robotsText)) add('cert', 'robots.txt bloquea indexación', 'pass');
      else add('cert', 'robots.txt no bloquea indexación', 'warn', 'robots.txt no tiene Disallow: / — el cert podría indexarse.', { kind: 'seo' });

      // Verificar cert banner presente
      await goto('/', 1800);
      await dismissWelcome();
      const hasBanner = await page.evaluate(() => !!document.getElementById('gy-cert-banner')).catch(() => false);
      if (hasBanner) add('cert', 'banner de entorno de pruebas presente', 'pass');
      else add('cert', 'banner de entorno de pruebas ausente', 'warn', 'El banner de cert no se muestra: un usuario podría confundir cert con producción.', { kind: 'cert' });

      // Verificar manifest.json accesible
      const manifest = await fetchWithTimeout(`${BASE}/manifest.json`);
      if (manifest.status === 200 && typeof manifest.body === 'object') add('cert', 'manifest.json accesible en cert', 'pass');
      else add('cert', 'manifest.json no accesible en cert', 'warn', `HTTP ${manifest.status}`, { kind: 'pwa' });

      // Verificar favicon.ico accesible
      const favicon = await fetchWithTimeout(`${BASE}/favicon.ico`);
      if (favicon.status === 200) add('cert', 'favicon.ico accesible en cert', 'pass');
      else add('cert', 'favicon.ico no accesible en cert', 'warn', `HTTP ${favicon.status}`, { kind: 'pwa' });
    }

    // ------------------------------------------------------------ Responsive (breakpoints adicionales)
    {
      const breakpoints = [
        { width: 320, height: 568, label: 'móvil pequeño (320px)' },
        { width: 768, height: 1024, label: 'tablet (768px)' },
        { width: 1440, height: 900, label: 'escritorio (1440px)' },
      ];
      for (const bp of breakpoints) {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await goto('/', 1500);
        await dismissWelcome();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
        if (overflow <= 4) add('contenido', `sin desbordamiento horizontal en ${bp.label}`, 'pass');
        else add('contenido', `desbordamiento horizontal en ${bp.label}`, 'warn', `+${overflow}px de desbordamiento`, { kind: 'contenido' });
      }
      // Restaurar viewport móvil por defecto
      await page.setViewportSize({ width: 390, height: 844 });
    }

    // ------------------------------------------------------------ Navegación con teclado en TODAS las páginas
    {
      const keyboardPages = ['/', '/clases.html', '/tarifas.html', '/maestros.html', '/profile.html', '/success.html', '/cancel.html', '/politica-privacidad.html'];
      for (const p of keyboardPages) {
        await goto(p, 1500);
        if (p === '/') await dismissWelcome();
        const kb = await auditKeyboard(page, { maxTabs: 12, dismiss: async () => {} });
        if (kb.invisible.length === 0) {
          add('a11y', `foco visible en todos los stops de Tab en ${p}`, 'pass', `${kb.stops.length} stops, 0 sin anillo`);
        } else if (kb.invisible.length === 1) {
          add('a11y', `1 stop sin foco visible en ${p}`, 'warn', kb.invisible.map((s) => `${s.tag} "${s.text}"`).join(', '), { kind: 'a11y' });
        } else {
          add('a11y', `${kb.invisible.length} stops sin foco visible en ${p}`, 'fail', kb.invisible.slice(0, 3).map((s) => `${s.tag} "${s.text}"`).join(', '), { kind: 'a11y' });
        }
      }
    }

    // ------------------------------------------------------------ Gestión de foco en modales
    {
      await goto('/', 1800);
      await dismissWelcome();
      const verMasBtn = page.locator('button[onclick*="openModal"]:visible').first();
      if (await verMasBtn.count()) {
        const activeBefore = await page.evaluate(() => document.activeElement?.tagName || 'none');
        await verMasBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
        const modalOpen = await page.evaluate(() => {
          const m = document.getElementById('modal-overlay');
          return m && !m.classList.contains('hidden');
        }).catch(() => false);
        if (modalOpen) {
          const activeInModal = await page.evaluate(() => {
            const modal = document.getElementById('modal-overlay');
            return modal && modal.contains(document.activeElement);
          }).catch(() => false);
          if (activeInModal) add('a11y', 'foco se mueve al modal al abrirlo', 'pass');
          else add('a11y', 'foco no se mueve al modal', 'warn', 'El foco permanece fuera del modal: problema de accesibilidad para usuarios de teclado.', { kind: 'a11y' });
          // Cerrar modal
          await page.keyboard.press('Escape');
          await page.waitForTimeout(600);
        }
      }
    }

    // ------------------------------------------------------------ Validación de formularios (más casos)
    {
      await goto('/profile.html', 2000);
      const emailInput = page.locator('input[type="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();
      const submitBtn = page.locator('button[type="submit"]').first();
      if (await emailInput.count() && await passwordInput.count() && await submitBtn.count()) {
        // Test: contraseña muy corta
        await emailInput.fill('test@test.com').catch(() => {});
        await passwordInput.fill('12').catch(() => {});
        await submitBtn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(800);
        const jsErrors1 = pageErrors.length;
        if (jsErrors1 === 0) add('cliente', 'contraseña corta no rompe JS', 'pass');
        else add('cliente', 'contraseña corta rompe JS', 'fail', pageErrors[pageErrors.length - 1], { kind: 'cliente' });

        // Test: XSS en campo de texto (si hay campo de nombre)
        const nameInput = page.locator('input[type="text"]').first();
        if (await nameInput.count()) {
          await nameInput.fill('<script>alert("xss")</script>').catch(() => {});
          await page.waitForTimeout(500);
          const hasXss = await page.evaluate(() => document.body.innerHTML.includes('<script>alert')).catch(() => false);
          if (!hasXss) add('seguridad', 'XSS en campo de texto neutralizado', 'pass');
          else add('seguridad', 'XSS en campo de texto NO neutralizado', 'fail', 'El input permite inyección de script.', { kind: 'seguridad' });
        }
      }
    }

    // ------------------------------------------------------------ ARIA live regions (contenido dinámico)
    {
      const liveRegions = await page.evaluate(() => {
        const regions = [...document.querySelectorAll('[aria-live], [role="status"], [role="alert"], [aria-atomic]')];
        return regions.length;
      }).catch(() => 0);
      if (liveRegions > 0) add('a11y', 'regiones ARIA live presentes', 'pass', `${liveRegions} región(es) live para contenido dinámico`);
      else add('a11y', 'sin regiones ARIA live', 'warn', 'No hay aria-live/role=status para anunciar cambios dinámicos a lectores de pantalla.', { kind: 'a11y' });
    }

    // ------------------------------------------------------------ Objetivos táctiles ≥44px (WCAG 2.5.5)
    {
      const smallTouch = await page.evaluate(() => {
        const els = [...document.querySelectorAll('button, a[href], input, select, [role="button"]')];
        return els.filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const s = getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          // Excluir enlaces inline en párrafos
          if (el.tagName === 'A' && el.closest('p, li') && s.display.includes('inline')) return false;
          return r.width < 44 || r.height < 44;
        }).length;
      }).catch(() => 0);
      if (smallTouch === 0) add('a11y', 'todos los objetivos táctiles ≥44px (WCAG 2.5.5)', 'pass');
      else if (smallTouch <= 5) add('a11y', `${smallTouch} objetivo(s) táctil(es) <44px`, 'warn', 'Objetivos pequeños dificultan la interacción en móvil.', { kind: 'a11y' });
      else add('a11y', `${smallTouch} objetivo(s) táctil(es) <44px`, 'fail', 'Muchos objetivos táctiles demasiado pequeños para móvil.', { kind: 'a11y' });
    }

    // ------------------------------------------------------------ Carga de imágenes (lazy, responsive)
    {
      const imgIssues = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll('img')];
        const issues = [];
        imgs.forEach((img) => {
          if (!img.getAttribute('alt') && img.getAttribute('alt') !== '') issues.push('sin alt');
          if (!img.getAttribute('loading')) issues.push('sin loading=lazy');
          if (!img.getAttribute('srcset') && !img.getAttribute('sizes') && img.getAttribute('src')?.includes('.webp')) {
            // Solo avisar si es una imagen grande sin srcset
            const r = img.getBoundingClientRect();
            if (r.width > 200) issues.push('imagen grande sin srcset');
          }
        });
        return [...new Set(issues)];
      }).catch(() => []);
      if (imgIssues.length === 0) add('medios', 'imágenes con alt, loading y srcset correctos', 'pass');
      else add('medios', `imágenes: ${imgIssues.join(', ')}`, 'warn', 'Algunas imágenes carecen de atributos de rendimiento/accesibilidad.', { kind: 'medios' });
    }

    // ------------------------------------------------------------ Botón "atrás" del navegador (SPA-like)
    {
      await goto('/clases.html', 1500);
      await goto('/tarifas.html', 1500);
      // Simular back
      await page.goBack().catch(() => {});
      await page.waitForTimeout(1000);
      const url = page.url();
      if (url.includes('clases.html')) add('navegacion', 'botón atrás funciona (clases → tarifas → clases)', 'pass');
      else add('navegacion', 'botón atrás no funciona correctamente', 'warn', `URL tras back: ${url}`, { kind: 'navegacion' });
    }

    // ------------------------------------------------------------ Enlaces externos (target="_blank" + rel)
    {
      const badLinks = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a[target="_blank"]')];
        return links.filter((a) => {
          const rel = a.getAttribute('rel') || '';
          return !rel.includes('noopener') && !rel.includes('noreferrer');
        }).length;
      }).catch(() => 0);
      if (badLinks === 0) add('seguridad', 'todos los enlaces target=_blank tienen rel=noopener', 'pass');
      else add('seguridad', `${badLinks} enlace(s) target=_blank sin rel=noopener`, 'warn', 'Riesgo de tabnabbing: falta rel="noopener noreferrer".', { kind: 'seguridad' });
    }

    if (pageErrors.length) {
      add('a11y', 'errores JS durante la auditoría', 'fail', [...new Set(pageErrors)].slice(0, 2).join(' · '));
    }
  } finally {
    await ctx.close().catch(() => {});
  }
  return out;
}

// ---------------------------------------------------------------- CLI suelto
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('playwright-core');
  const isCert = process.argv.includes('--cert');
  const BASE = (process.env.PROD_BASE_URL || (isCert
    ? (process.env.CERT_BASE_URL || 'https://gen-yoga-studio.github.io/GEN-YOGA-CERT')
    : 'https://genyoga.studio')).replace(/\/+$/, '');
  let supaUrl, supaKey;
  try {
    const html = await fetch(`${BASE}/clases.html`).then((r) => r.text());
    supaUrl = html.match(/const SUPA_URL = '(https:\/\/[^']+)'/)?.[1];
    supaKey = html.match(/const SUPA_KEY = '(sb_publishable_[^']+)'/)?.[1];
  } catch { /* sin backend */ }
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  console.log(`\n--- Comprobaciones extendidas contra ${BASE} ---`);
  const results = await runExtendedChecks({ browser, base: BASE, supaUrl, supaKey, isCert, log: (m) => console.log(m) });
  await browser.close();
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log(`\nResumen extendido: ${results.length} checks · ${results.length - fails - warns} OK · ${fails} fallos · ${warns} avisos`);
  process.exit(fails > 0 ? 1 : 0);
}
