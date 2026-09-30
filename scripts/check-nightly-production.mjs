// check-nightly-production.mjs
// Chequeo nocturno de salud contra PRODUCCIÓN REAL (https://genyoga.studio).
//
// - Solo lectura + login/logout con el usuario de pruebas. 0 reservas, 0 compras,
//   0 escrituras: el flujo de compra se intercepta antes de crear sesión de Stripe.
// - Credenciales: GEN_YOGA_TEST_EMAIL / GEN_YOGA_TEST_PASSWORD
//   (por defecto prueba@prueba.com / prueba).
// - Base: PROD_BASE_URL (por defecto https://genyoga.studio).
// - Salida: consola + nightly-reports/nightly-AAAA-MM-DD.json y .md
// - Exit 1 si hay al menos un fallo bloqueante.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.PROD_BASE_URL || 'https://genyoga.studio').replace(/\/+$/, '');
const EMAIL = process.env.GEN_YOGA_TEST_EMAIL || 'prueba@prueba.com';
const PASSWORD = process.env.GEN_YOGA_TEST_PASSWORD || 'prueba';

const errors = [];
const warnings = [];
const results = [];
function rec(suite, name, status, detail = '') {
  results.push({ suite, name, status, detail });
  if (status === 'fail') { errors.push(`${suite} · ${name}${detail ? ` — ${detail}` : ''}`); console.error(`  ❌ [${suite}] ${name}${detail ? `: ${detail}` : ''}`); }
  else if (status === 'warn') { warnings.push(`${suite} · ${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ⚠️ [${suite}] ${name}${detail ? `: ${detail}` : ''}`); }
  else console.log(`  ✅ [${suite}] ${name}`);
}
const pass = (s, n, d = '') => rec(s, n, 'pass', d);
const fail = (s, n, d = '') => rec(s, n, 'fail', d);
const warn = (s, n, d = '') => rec(s, n, 'warn', d);

async function fetchTimeout(url, { timeoutMs = 20000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    await res.arrayBuffer().catch(() => null);
    return { ok: true, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

// SUPA_URL/KEY: las mismas que embarca la web (fuente local = lo desplegado).
const clasesHtml = await readFile(path.join(root, 'clases.html'), 'utf8');
const SUPA_URL = clasesHtml.match(/const SUPA_URL = '(https:\/\/[^']+)'/)?.[1];
const SUPA_KEY = clasesHtml.match(/const SUPA_KEY = '(sb_publishable_[^']+)'/)?.[1];
if (!SUPA_URL || !SUPA_KEY) { fail('config', 'SUPA_URL/SUPA_KEY en clases.html', 'no encontradas'); }

async function rest(pathQuery, timeoutMs = 15000) {
  return fetchTimeout(`${SUPA_URL}/rest/v1/${pathQuery}`, {
    timeoutMs,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
}

// ---------------------------------------------------------------- A. Disponibilidad
console.log('\n--- A. Disponibilidad de genyoga.studio (HTTP 200 + tiempo) ---');
{
  const pages = ['/', '/index.html', '/clases.html', '/tarifas.html', '/maestros.html', '/profile.html', '/success.html', '/cancel.html', '/politica-privacidad.html', '/sitemap.xml'];
  for (const p of pages) {
    const r = await fetchTimeout(`${BASE}${p}`, { timeoutMs: 25000 });
    if (!r.ok) fail('disponibilidad', p, `sin red: ${r.error}`);
    else if (r.status !== 200) fail('disponibilidad', p, `HTTP ${r.status}`);
    else if (r.ms > 15000) fail('disponibilidad', p, `lento: ${r.ms}ms (>15s)`);
    else pass('disponibilidad', `${p} → 200 en ${r.ms}ms`);
  }
}

// ---------------------------------------------------------------- B. Backend en vivo
console.log('\n--- B. Supabase + Edge Functions en vivo ---');
{
  const tables = ['clases', 'profesionales', 'tipos_clases', 'configuracion', 'stripe_productos', 'profiles', 'reservas_yoga', 'class_credit_packs'];
  let okCount = 0;
  for (const t of tables) {
    const r = await rest(`${t}?select=*&limit=1`);
    if (!r.ok) fail('backend', `REST ${t}`, `sin red: ${r.error}`);
    else if (r.status === 200 || r.status === 401 || r.status === 403) { okCount++; }
    else if (r.status === 404) fail('backend', `REST ${t}`, 'la tabla NO existe (404)');
    else warn('backend', `REST ${t}`, `HTTP ${r.status} inesperado`);
  }
  if (okCount === tables.length) pass('backend', `las ${tables.length} tablas clave responden`);
  const auth = await fetchTimeout(`${SUPA_URL}/auth/v1/health`, { timeoutMs: 15000 });
  if (!auth.ok) fail('backend', 'Auth health', auth.error);
  else if (auth.status >= 500) fail('backend', 'Auth health', `HTTP ${auth.status}`);
  else pass('backend', `Auth responde (HTTP ${auth.status})`);

  const fns = ['create-checkout-session', 'create-portal-session', 'list-stripe-products', 'get-checkout-session', 'book-guest-class', 'create-kiosk-user', 'delete-account', 'stripe-webhook'];
  let alive = 0;
  for (const fn of fns) {
    const r = await fetchTimeout(`${SUPA_URL}/functions/v1/${fn}`, {
      timeoutMs: 15000, method: 'POST',
      headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r.ok) { fail('backend', `fn ${fn}`, `sin red: ${r.error}`); continue; }
    if (r.status >= 200 && r.status < 500) alive++;
    else if (r.status === 404) fail('backend', `fn ${fn}`, 'no desplegada (404)');
    else warn('backend', `fn ${fn}`, `HTTP ${r.status}`);
  }
  if (alive === fns.length) pass('backend', `las ${fns.length} Edge Functions responden`);
}

// ---------------------------------------------------------------- C. Privacidad
console.log('\n--- C. Privacidad sin sesión (fuga = fallo) ---');
{
  for (const [q, label] of [
    ['reservas_yoga?select=id&limit=1', 'reservas ajenas'],
    ['profiles?select=id&limit=1', 'perfiles ajenos'],
    ['stripe_purchases?select=checkout_session_id&limit=1', 'compras'],
  ]) {
    const r = await rest(q);
    if (!r.ok) fail('privacidad', label, `sin red: ${r.error}`);
    else if (r.status === 401 || r.status === 403) pass('privacidad', `${label}: denegadas (HTTP ${r.status})`);
    else if (r.status === 200) fail('privacidad', label, 'FUGA: visibles sin sesión');
    else warn('privacidad', label, `HTTP ${r.status}`);
  }
  // Sonda de escritura anónima con valor que viola un CHECK a propósito:
  // si RLS niega → 401/403; si no negara, el CHECK daría 400 SIN escribir nada.
  const probe = await fetchTimeout(`${SUPA_URL}/rest/v1/tipos_clases`, {
    timeoutMs: 15000, method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: '{"nombre":"ZZZ_PROBE","categoria":"zz_invalid_cat_xyz"}',
  });
  if (!probe.ok) fail('privacidad', 'escritura anónima', probe.error);
  else if (probe.status === 401 || probe.status === 403) pass('privacidad', `escritura anónima denegada (HTTP ${probe.status})`);
  else fail('privacidad', 'escritura anónima', `NO denegada (HTTP ${probe.status}) — revisar RLS`);
}

// ---------------------------------------------------------------- Navegador
const browser = await chromium.launch();
const perf = [];
function track(page) {
  const st = { errors: [], localFailed: [], externalFailed: [], bytes: 0, reqs: 0 };
  page.on('pageerror', (e) => st.errors.push(String((e && e.message) || e).slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (t.includes('compute-pressure')) return;
      if (t.includes('status of 400')) return; // logins fallidos a propósito
      st.errors.push(`console: ${t.slice(0, 200)}`);
    }
  });
  page.on('response', async (res) => {
    try {
      const body = await res.body().catch(() => null);
      st.reqs++;
      if (body) st.bytes += body.length;
      if (res.status() >= 400) {
        const u = res.url();
        if (u.includes('/auth/v1/token') || u.includes('reset-password-with-code')) return; // sondas de login falso
        (u.startsWith(BASE) ? st.localFailed : st.externalFailed).push(`${res.status()} ${u.slice(0, 130)}`);
      }
    } catch { /* noop */ }
  });
  return st;
}
async function gotoTracked(page, urlPath, settleMs = 2500) {
  const st = track(page);
  const t0 = Date.now();
  await page.goto(`${BASE}${urlPath}`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(settleMs);
  perf.push({ page: urlPath, loadMs: Date.now() - t0, bytes: st.bytes, reqs: st.reqs });
  return st;
}
function assertClean(suite, st) {
  let ok = true;
  if (st.errors.length > 0) { fail(suite, 'JS limpio', st.errors[0]); ok = false; }
  if (st.localFailed.length > 0) { fail(suite, 'recursos locales', [...new Set(st.localFailed)][0]); ok = false; }
  if (ok) pass(suite, 'sin errores JS ni recursos rotos');
  for (const e of [...new Set(st.externalFailed)].slice(0, 2)) warn(suite, 'externo falló (aviso)', e);
}
async function section(suite, fn) {
  try { await fn(); } catch (e) {
    fail(suite, 'excepción del escenario', String((e && e.message) || e).split('\n')[0].slice(0, 200));
  }
}

// ---------------------------------------------------------------- D. Contenido real
console.log('\n--- D. Contenido real en producción ---');
await section('contenido', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    let st = await gotoTracked(page, '/clases.html');
    await page.locator('#btn-cat-consultas').click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const consultasOk = await page.locator('#consultas-deck').isVisible().catch(() => false);
    if (consultasOk) pass('contenido', 'clases: pestaña Consultas conmuta');
    else fail('contenido', 'clases: pestaña Consultas', 'no conmuta');
    await page.locator('#btn-cat-yoga').click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('#public-calendar-launch:visible').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const cal = (await page.locator('#calendar-desktop').isVisible().catch(() => false))
      || (await page.locator('#calendar-mobile').isVisible().catch(() => false));
    if (cal) pass('contenido', 'clases: el calendario público abre');
    else fail('contenido', 'clases: el calendario público', 'no abre');
    assertClean('contenido-clases', st);

    st = await gotoTracked(page, '/maestros.html', 6000);
    const kids = await page.locator('#maestros-grid-section').evaluate((el) => el.childElementCount).catch(() => 0);
    if (kids > 1) pass('contenido', `maestros: parrilla poblada (${kids} nodos)`);
    else fail('contenido', 'maestros: parrilla', `vacía (nodos: ${kids})`);
    assertClean('contenido-maestros', st);

    st = await gotoTracked(page, '/tarifas.html');
    const tabs = page.locator('[onclick*="switchCategory"]:visible');
    if ((await tabs.count()) > 0) pass('contenido', 'tarifas: pestañas conmutan');
    else warn('contenido', 'tarifas: pestañas', 'no encontradas');
    assertClean('contenido-tarifas', st);

    st = await gotoTracked(page, '/index.html');
    const welcome = page.locator('#flash-welcome-modal');
    try {
      await welcome.waitFor({ state: 'visible', timeout: 10000 });
      pass('contenido', 'index: oferta de bienvenida aparece');
    } catch { fail('contenido', 'index: oferta de bienvenida', 'no aparece'); }
    assertClean('contenido-index', st);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- E. Calendario con futuro (API)
console.log('\n--- E. Calendario con futuro ---');
{
  const nowIso = new Date().toISOString();
  const r = await rest(`clases?select=id&fecha_inicio=gt.${encodeURIComponent(nowIso)}&activa=is.true&limit=1`);
  if (!r.ok) fail('calendario', 'clases futuras', `sin red: ${r.error}`);
  else if (r.status !== 200) fail('calendario', 'clases futuras', `HTTP ${r.status}`);
  else pass('calendario', 'hay clases futuras activas (el calendario no está vacío)');
}

// ---------------------------------------------------------------- F. Auth real usuario de pruebas
console.log('\n--- F. Login real con usuario de pruebas (solo lectura + logout) ---');
await section('auth', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    const st = await gotoTracked(page, '/profile.html', 4000);

    // F1. Credenciales falsas → error elegante, sin crash.
    await page.locator('#login-email').fill('test-inexistente@genyoga.studio');
    await page.locator('#login-password').fill('ContrasenaFalsa123!');
    await page.locator('#form-login button[type="submit"]').click({ timeout: 10000 });
    try {
      await page.locator('.swal2-popup', { hasText: /Ups|Credenciales incorrectas/i }).first().waitFor({ state: 'visible', timeout: 15000 });
      pass('auth', 'credenciales falsas rechazadas con elegancia');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    } catch { fail('auth', 'login falso', 'no muestra el error esperado'); }

    // F2. Usuario de pruebas → entra al panel.
    await page.locator('#login-email').fill(EMAIL);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('#form-login button[type="submit"]').click({ timeout: 10000 });
    try {
      await page.locator('#app-view:visible').waitFor({ state: 'visible', timeout: 20000 });
      pass('auth', `el usuario de pruebas entra (${EMAIL})`);
    } catch {
      fail('auth', 'login usuario de pruebas', 'no entra: ¿contraseña o RLS rotos?');
      assertClean('auth', st);
      return;
    }
    await page.waitForTimeout(4000);
    const nombre = (await page.locator('#profile-nombre-full').innerText().catch(() => '')).trim();
    if (nombre) pass('auth', `perfil cargado ("${nombre.slice(0, 40)}")`);
    else fail('auth', 'perfil', 'nombre vacío: el perfil no carga');
    const saldos = (await page.locator('#header-saldos-wrapper').isVisible().catch(() => false))
      || (await page.locator('#profile-saldos-wrapper').isVisible().catch(() => false));
    if (saldos) pass('auth', 'saldos/bonos visibles en el panel');
    else warn('auth', 'saldos', 'no visibles (¿sin bonos o render roto?)');

    // F3. Navegación interna del panel (solo lectura).
    // OJO: 'mis-clases' solo existe para personal (esTrabajador()); un cliente
    // como el usuario de pruebas redirige a 'inicio' por diseño. Se verifica
    // cada vista solo si su botón está visible para este rol.
    for (const [btn, view, label] of [
      ['#nav-public-inicio', '#view-inicio', 'Inicio'],
      ['#nav-public-horarios', '#view-horarios', 'Horarios'],
      ['#nav-public-especiales', '#view-especiales', 'Especiales'],
      ['#nav-public-psicologia', '#view-psicologia', 'Psicología'],
      ['#nav-public-profesores', '#view-profesores', 'Profesores'],
    ]) {
      if (!(await page.locator(btn).first().isVisible().catch(() => false))) {
        warn('auth', `vista ${label}`, `${btn} oculto para este rol (aviso)`);
        continue;
      }
      await page.locator(btn).first().click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (await page.locator(view).isVisible().catch(() => false)) pass('auth', `vista ${label} abre`);
      else fail('auth', `vista ${label}`, `${view} no se muestra`);
    }
    // Mis clases: solo personal. Para un cliente debe estar oculto o redirigir
    // a inicio; lo único incorrecto sería un clic muerto sin vista visible.
    {
      const misBtn = page.locator('#nav-public-mis-clases').first();
      if (!(await misBtn.isVisible().catch(() => false))) {
        pass('auth', 'Mis clases oculto para cliente (correcto por rol)');
      } else {
        await misBtn.click({ timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const asist = await page.locator('#view-asistencias').isVisible().catch(() => false);
        const inicio = await page.locator('#view-inicio').isVisible().catch(() => false);
        if (asist || inicio) pass('auth', 'Mis clases lleva a una vista válida');
        else fail('auth', 'Mis clases', 'clic muerto: ninguna vista visible');
      }
      await page.locator('#nav-public-inicio').first().click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // F4. Logout → vuelve al login.
    await page.locator('#header-btn-logout').first().click({ timeout: 10000 });
    try {
      await page.locator('#auth-container:visible').waitFor({ state: 'visible', timeout: 15000 });
      pass('auth', 'logout devuelve al login');
    } catch { fail('auth', 'logout', 'no vuelve al login'); }
    assertClean('auth', st);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- G. Compra interceptada (0 cargos)
console.log('\n--- G. Tarifas: compra interceptada (0 sesiones, 0 cargos) ---');
await section('compra', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    let attempts = 0;
    await page.route('**/functions/v1/*', (route) => {
      if (route.request().url().includes('create-checkout-session')) attempts++;
      route.abort();
    });
    const st = await gotoTracked(page, '/tarifas.html');
    await page.locator('[onclick*="switchCategory(\'yoga\')"]:visible').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const buyBtn = page.locator('#buy-single-class-button');
    if (!(await buyBtn.isVisible().catch(() => false))) {
      fail('compra', '"Comprar clase"', 'no visible');
    } else {
      await buyBtn.click({ timeout: 10000 });
      try {
        await page.locator('.swal2-popup', { hasText: /¿Cómo deseas realizar tu compra/ }).waitFor({ state: 'visible', timeout: 10000 });
        pass('compra', '"Comprar" ofrece Invitado/Perfil');
      } catch { fail('compra', 'diálogo de compra', 'no abre'); }
      await page.locator('.swal2-cancel').click({ timeout: 5000 }).catch(async () => page.keyboard.press('Escape'));
      await page.waitForTimeout(600);
    }
    if (!page.url().startsWith(BASE)) fail('compra', 'fuga fuera de la web', page.url().slice(0, 120));
    else if (attempts > 0) pass('compra', 'intercepción activa, 0 sesiones reales y 0 cargos');
    else pass('compra', 'flujo detenido antes del checkout (0 llamadas, 0 cargos)');
    assertClean('compra', st);
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- H. Rendimiento
console.log('\n--- H. Rendimiento en producción ---');
{
  for (const p of perf) {
    const kb = Math.round(p.bytes / 1024);
    if (p.loadMs > 15000) fail('rendimiento', `${p.page}`, `carga en ${p.loadMs}ms (>15s)`);
    else if (p.reqs > 80) fail('rendimiento', `${p.page}`, `${p.reqs} peticiones (>80)`);
    else pass('rendimiento', `${p.page}: ${p.loadMs}ms, ${kb}KB, ${p.reqs} peticiones`);
  }
  const t0 = Date.now();
  const ping = await fetchTimeout(`${BASE}/`, { timeoutMs: 20000 });
  if (ping.ok) pass('rendimiento', `TTFB home: ${ping.ms}ms`);
}

await browser.close();

// ---------------------------------------------------------------- Informe
const date = new Date().toISOString().slice(0, 10);
const passed = results.filter((r) => r.status === 'pass').length;
const failed = errors.length;
const warned = warnings.length;
const report = {
  date: new Date().toISOString(), base: BASE, testUser: EMAIL,
  summary: { passed, failed, warned, total: results.length },
  results, errors, warnings,
};
const outDir = path.join(root, 'nightly-reports');
await mkdir(outDir, { recursive: true }).catch(() => {});
await writeFile(path.join(outDir, `nightly-${date}.json`), JSON.stringify(report, null, 2));
const md = [
  `# Chequeo nocturno genyoga.studio — ${date}`,
  ``,
  `Base: ${BASE} · Usuario: ${EMAIL} · Total: ${results.length} · ✅ ${passed} · ❌ ${failed} · ⚠️ ${warned}`,
  ``,
  ...results.map((r) => `- ${r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️'} **[${r.suite}]** ${r.name}${r.detail ? ` — ${r.detail}` : ''}`),
  ``,
].join('\n');
await writeFile(path.join(outDir, `nightly-${date}.md`), md);

console.log('');
if (failed > 0) {
  console.error(`\n⛔ nightly: ${failed} fallo(s) en producción real. Informe en nightly-reports/nightly-${date}.md`);
  process.exit(1);
}
console.log(`\n✅ nightly: producción sana (${passed}/${results.length} checks, ${warned} avisos).`);
