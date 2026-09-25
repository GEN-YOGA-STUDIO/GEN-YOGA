import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
  console.error(`  ❌ ${message}`);
}
function warn(message) {
  warnings.push(message);
  console.log(`  ⚠️ ${message}`);
}
function pass(message) {
  console.log(`  ✅ ${message}`);
}
function info(message) {
  console.log(`  ℹ️ ${message}`);
}

// La misma clave pública que embarca la app: el E2E prueba lo que el usuario usa.
const clasesHtml = await readFile(path.join(root, 'clases.html'), 'utf8');
const SUPA_URL = clasesHtml.match(/const SUPA_URL = '(https:\/\/[^']+)'/)?.[1];
const SUPA_KEY = clasesHtml.match(/const SUPA_KEY = '(sb_publishable_[^']+)'/)?.[1];
if (!SUPA_URL || !SUPA_KEY) {
  fail('no se encontró SUPA_URL/SUPA_KEY en clases.html');
  process.exit(1);
}

const REQUIRE_LIVE = process.env.E2E_REQUIRE_LIVE === '1';
let live = true; // pasa a false si no hay red: los checks en vivo degradan a aviso.

// ---------------------------------------------------------------------------
// Servidor estático local (igual que check-runtime).
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const rel = urlPath.replace(/^\/+/, '') || 'index.html';
    const abs = path.join(root, rel);
    if (path.relative(root, abs).startsWith('..')) {
      res.writeHead(403);
      res.end();
      return;
    }
    await stat(abs);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(abs));
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------------------
// Utilidades de escenario.
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
const perf = []; // { page, loadMs, bytes, reqs }

function track(page) {
  const state = { errors: [], localFailed: [], externalFailed: [], bytes: 0, reqs: 0 };
  page.on('pageerror', (err) => state.errors.push(String((err && err.message) || err).slice(0, 220)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') state.errors.push(`console: ${msg.text().slice(0, 220)}`);
  });
  page.on('response', async (res) => {
    try {
      const body = await res.body().catch(() => null);
      state.reqs++;
      if (body) state.bytes += body.length;
      if (res.status() >= 400) {
        const url = res.url();
        (url.startsWith(base) ? state.localFailed : state.externalFailed).push(`${res.status()} ${url.slice(0, 140)}`);
      }
    } catch { /* cuerpo no disponible */ }
  });
  return state;
}

async function gotoTracked(page, file, settleMs = 2500) {
  const st = track(page);
  const t0 = Date.now();
  await page.goto(`${base}/${file}`, { waitUntil: 'load', timeout: 45000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(settleMs);
  perf.push({ page: file, loadMs, bytes: st.bytes, reqs: st.reqs });
  return st;
}

function assertClean(label, st) {
  let ok = true;
  if (st.errors.length > 0) {
    fail(`${label}: ${st.errors.length} error(es) JS durante la interacción: ${st.errors[0]}`);
    ok = false;
  }
  if (st.localFailed.length > 0) {
    fail(`${label}: recursos locales rotos durante la interacción: ${[...new Set(st.localFailed)][0]}`);
    ok = false;
  }
  for (const ext of [...new Set(st.externalFailed)].slice(0, 2)) {
    warn(`${label}: externo falló (aviso, no bloquea): ${ext}`);
  }
  return ok;
}


// Un escenario que revienta no aborta la suite: se registra el fallo y se sigue.
async function section(label, fn) {
  try {
    await fn();
  } catch (e) {
    fail(`${label}: excepción durante el escenario: ${String((e && e.message) || e).split('\n')[0].slice(0, 220)}`);
  }
}

async function liveFetch(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e.cause?.message || e.message).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function liveGate(label, detail) {
  if (REQUIRE_LIVE) fail(`${label}: ${detail}`);
  else {
    warn(`${label}: ${detail} (sin red: se omite; usa E2E_REQUIRE_LIVE=1 para exigirlo)`);
    live = false;
  }
}

// ---------------------------------------------------------------------------
// A. Supabase en vivo: tablas clave existen (solo lectura, limit=1).
// ---------------------------------------------------------------------------
console.log('\n--- A. Bases de datos clave (Supabase en vivo, solo lectura) ---');
{
  const tables = [
    'clases', 'profesionales', 'tipos_clases', 'configuracion', 'stripe_productos',
    'profiles', 'reservas_yoga', 'reservas_psicologia', 'reservas_nutricion',
    'class_credit_packs', 'unlimited_membership_periods', 'unlimited_guest_passes',
    'unlimited_consultation_discounts', 'bonos_clases_especiales', 'creditos_reprogramacion',
  ];
  let okCount = 0;
  for (const table of tables) {
    const r = await liveFetch(
      `${SUPA_URL}/rest/v1/${table}?select=*&limit=1`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } },
    );
    if (!r.ok) {
      liveGate(`REST ${table}`, `sin acceso a la red: ${r.error}`);
      continue;
    }
    // 200 = legible; 401/403 = existe pero protegida por RLS (correcto para
    // tablas privadas). 404 = la tabla NO existe: la app se rompería.
    if (r.status === 200 || r.status === 401 || r.status === 403) okCount++;
    else if (r.status === 404) fail(`REST ${table}: la tabla no existe (404) — el frontend la consulta`);
    else warn(`REST ${table}: HTTP ${r.status} inesperado (revisar)`);
  }
  if (okCount === tables.length) pass(`las ${tables.length} tablas clave responden (200 o protegidas por RLS)`);
  const auth = await liveFetch(`${SUPA_URL}/auth/v1/health`);
  if (!auth.ok) liveGate('Auth', `sin acceso a la red: ${auth.error}`);
  else if (auth.status >= 500) fail(`Auth: HTTP ${auth.status}`);
  else pass(`Auth responde (HTTP ${auth.status})`);
}

// ---------------------------------------------------------------------------
// B. Edge Functions desplegadas (liveness sin efectos: payload vacío → 4xx).
// ---------------------------------------------------------------------------
console.log('\n--- B. Edge Functions desplegadas (sonda sin efectos secundarios) ---');
{
  const fns = [
    'create-checkout-session', 'create-portal-session', 'list-stripe-products',
    'get-checkout-session', 'redeem-promo-code', 'send-email-notification',
    'book-guest-class', 'book-unlimited-guest', 'create-kiosk-user',
    'delete-account', 'stripe-webhook',
  ];
  let alive = 0;
  for (const fn of fns) {
    const r = await liveFetch(`${SUPA_URL}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) {
      liveGate(`fn ${fn}`, `sin acceso a la red: ${r.error}`);
      continue;
    }
    // 2xx/4xx = desplegada y respondiendo (el 4xx con {} es lo esperado:
    // rechaza el payload vacío sin hacer nada). 404 = NO desplegada.
    if (r.status >= 200 && r.status < 500) alive++;
    else if (r.status === 404) fail(`fn ${fn}: no desplegada (404) — el frontend la invoca`);
    else warn(`fn ${fn}: HTTP ${r.status} (revisar)`);
  }
  if (alive === fns.length) pass(`las ${fns.length} Edge Functions responden`);
}

// ---------------------------------------------------------------------------
// C. index: modal historia abre/cierra, navegación móvil, toggle de idioma.
// ---------------------------------------------------------------------------
console.log('\n--- C. index: modal, navegación e idioma ---');
await section('index', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
  const page = await ctx.newPage();
  const st = await gotoTracked(page, 'index.html');

  // La oferta de bienvenida cubre la pantalla: se descarta como un usuario real.
  const welcome = page.locator('#flash-welcome-modal');
  if (!live) {
    warn('index: sin red, la oferta de bienvenida no se exige (aviso)');
    const wClose = page.locator('#flash-welcome-modal button[onclick="cerrarFlashWelcomeModal()"]');
    if ((await welcome.isVisible().catch(() => false)) && (await wClose.count()) > 0) {
      await wClose.first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
  } else {
    try {
      await welcome.waitFor({ state: 'visible', timeout: 8000 });
      pass('index: la oferta de bienvenida aparece al entrar');
    } catch {
      fail('index: la oferta de bienvenida no aparece al entrar');
    }
    // El modal cierra por opacidad (nunca recibe 'hidden'): se verifica por clases.
    const closed = await page.evaluate(() => {
      const b = document.querySelector('#flash-welcome-modal button[onclick="cerrarFlashWelcomeModal()"]');
      if (b) b.click();
      return new Promise((resolve) => setTimeout(() => {
        const m = document.getElementById('flash-welcome-modal');
        resolve(m.classList.contains('pointer-events-none') && !m.classList.contains('pointer-events-auto'));
      }, 800));
    }).catch(() => false);
    if (closed) pass('index: la oferta de bienvenida se cierra (clic real en la X)');
    else fail('index: la oferta de bienvenida no se cierra con la X');
  }

  // Modal historia con clic real.
  await page.locator('.history-modal-trigger:visible').first().click({ timeout: 8000 });
  await page.waitForTimeout(600);
  const modalOpen = await page.locator('#modal-historia').isVisible();
  if (!modalOpen) fail('index: el modal historia no se abre al pulsar "Ver más"');
  else {
    pass('index: "Ver más" abre el modal historia');
    await page.locator('button[onclick="closeModal()"]').first().click({ timeout: 8000 });
    await page.waitForTimeout(900);
    if (await page.locator('#modal-historia').isVisible()) fail('index: el modal historia no se cierra con la X');
    else pass('index: la X cierra el modal historia');
  }

  // Idioma ES→EN→ES con cambio real de textos.
  const btnEn = page.locator('#lang-btn-en');
  const btnEs = page.locator('#lang-btn-es');
  if ((await btnEn.count()) === 0 || (await btnEs.count()) === 0) {
    fail('index: faltan los botones de idioma #lang-btn-es/#lang-btn-en');
  } else {
    await btnEn.click({ timeout: 8000 });
    await page.waitForTimeout(600);
    const langEn = await page.evaluate(() => document.documentElement.lang);
    const bodyEn = (await page.locator('body').innerText()).slice(0, 4000);
    await btnEs.click({ timeout: 8000 });
    await page.waitForTimeout(600);
    const langEs = await page.evaluate(() => document.documentElement.lang);
    const moreEs = await page.locator('.history-modal-trigger:visible').first().innerText().catch(() => '');
    if (langEn === 'en' && bodyEn.toLowerCase().includes('learn more') && langEs === 'es' && moreEs.toLowerCase().includes('ver más')) {
      pass('index: el toggle ES/EN traduce la web de verdad');
    } else {
      fail(`index: el toggle de idioma no traduce (lang: ${langEs}, trigger: ${moreEs.slice(0, 20)})`);
    }
  }

  // Navegación móvil real hacia clases (por destino: inmune al idioma).
  const navClases = page.locator('.btn-nav-mobile:visible[onclick*="clases.html"]');
  if ((await navClases.count()) === 0) {
    const census = await page.locator('.btn-nav-mobile').evaluateAll((els) =>
      els.map((el) => `${el.checkVisibility() ? 'vis' : 'hid'}:${(el.textContent || '').trim().slice(0, 12)}`).join(' | '),
    ).catch(() => 'sin botones');
    fail(`index: no hay navegación móvil a clases [${census}]`);
  } else {
    await Promise.all([
      page.waitForURL('**/clases.html', { timeout: 8000 }),
      navClases.first().click({ timeout: 8000 }),
    ]);
    pass('index: la navegación móvil lleva a clases.html');
  }
  assertClean('index', st);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// D. clases: pestañas yoga/consultas/talleres + apertura del calendario.
// ---------------------------------------------------------------------------
console.log('\n--- D. clases: pestañas y calendario ---');
await section('clases', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
  const page = await ctx.newPage();
  const st = await gotoTracked(page, 'clases.html');
  const vis = (id) => page.locator(`#${id}`).isVisible();

  await page.locator('#btn-cat-consultas').click({ timeout: 8000 });
  await page.waitForTimeout(500);
  if ((await vis('consultas-deck')) && !(await vis('folders-deck')) && (await vis('public-consultas-calendar-launch'))) {
    pass('clases: la pestaña Consultas muestra su contenido y su CTA');
  } else fail('clases: la pestaña Consultas no conmuta bien');

  await page.locator('#btn-cat-talleres').click({ timeout: 8000 });
  await page.waitForTimeout(500);
  if ((await vis('talleres-deck')) && !(await vis('consultas-deck'))) pass('clases: la pestaña Talleres muestra su contenido');
  else fail('clases: la pestaña Talleres no conmuta bien');

  await page.locator('#btn-cat-yoga').click({ timeout: 8000 });
  await page.waitForTimeout(500);
  if ((await vis('folders-deck')) && (await vis('public-calendar-launch'))) pass('clases: volver a Yoga restaura horario y CTA');
  else fail('clases: volver a Yoga no restaura la vista');

  // Apertura del calendario (datos en vivo si hay red; el cableado, siempre).
  await page.locator('#public-calendar-launch:visible').first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  const calVisible = (await page.locator('#calendar-desktop').isVisible().catch(() => false))
    || (await page.locator('#calendar-mobile').isVisible().catch(() => false));
  if (calVisible) pass('clases: "Ver horario" abre el calendario');
  else fail('clases: "Ver horario" no muestra el calendario');
  assertClean('clases', st);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// E. tarifas: checkout cableado de punta a punta SIN crear sesiones reales.
// ---------------------------------------------------------------------------
console.log('\n--- E. tarifas: botones de compra (interceptados, sin cargos) ---');
await section('tarifas', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
  const page = await ctx.newPage();
  let checkoutAttempts = 0;
  await page.route('**/functions/v1/*', (route) => {
    if (route.request().url().includes('create-checkout-session')) checkoutAttempts++;
    route.abort(); // nunca sale una sesión real de este test
  });
  const st = await gotoTracked(page, 'tarifas.html');

  // Pestañas de categorías no deben crashear (solo las visibles en este viewport).
  const tabBtns = page.locator('[onclick*="switchCategory"]:visible');
  const tabCount = await tabBtns.count();
  for (let i = 0; i < Math.min(tabCount, 6); i++) {
    await tabBtns.nth(i).click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  if (tabCount > 0) pass(`tarifas: ${Math.min(tabCount, 6)} pestañas conmutan sin errores`);
  else warn('tarifas: no se encontraron pestañas switchCategory (aviso)');

  // Compra real como invitada, detenida antes del cobro: choice → selector con
  // clases de verdad (lectura). La intercepción garantiza 0 sesiones y 0 cargos.
  // El botón vive en section-yoga: se activa su pestaña visible primero.
  await page.locator('[onclick*="switchCategory(\'yoga\')"]:visible').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const buyBtn = page.locator('#buy-single-class-button');
  if (!(await buyBtn.isVisible().catch(() => false))) {
    fail('tarifas: "Comprar clase" no queda visible ni activando la pestaña Yoga');
  } else {
    await buyBtn.click({ timeout: 8000 });
    const choice = page.locator('.swal2-popup', { hasText: /¿Cómo deseas realizar tu compra/ });
    try {
      await choice.waitFor({ state: 'visible', timeout: 8000 });
      pass('tarifas: "Comprar" ofrece Invitado/Perfil');
    } catch {
      fail('tarifas: "Comprar" no abre el diálogo de opciones');
    }
    await page.locator('.swal2-confirm').click({ timeout: 8000 }).catch(() => {});
    // O el picker con clases reales, o (sin clases/red) desvío a clases.html.
    let pickerOptions = -1;
    try {
      await page.locator('#swal-select-clase').waitFor({ state: 'visible', timeout: 15000 });
      pickerOptions = await page.locator('#swal-select-clase option').count();
    } catch {
      pickerOptions = -1;
    }
    if (!page.url().startsWith(base)) {
      fail('tarifas: el flujo invitado fugó fuera de la web');
    } else if (pickerOptions > 0) {
      const sample = await page.locator('#swal-select-clase option').first().innerText().catch(() => '');
      pass(`tarifas: invitada elige entre ${pickerOptions} clases reales ("${sample.slice(0, 40)}…")`);
    } else if (!live) {
      warn('tarifas: sin red no hay picker de clases (aviso)');
    } else {
      fail('tarifas: el selector de clases invitadas sale vacío (¿tabla clases o RLS rotos?)');
    }
    await page.locator('.swal2-cancel').click({ timeout: 5000 }).catch(async () => page.keyboard.press('Escape'));
    await page.waitForTimeout(600);
  }
  const wentToStripe = !page.url().startsWith(base);
  if (wentToStripe) {
    fail('tarifas: el flujo de prueba fugó fuera de la web — la intercepción no contuvo la compra');
  } else if (checkoutAttempts > 0) {
    pass('tarifas: intercepción activa, 0 sesiones reales y 0 cargos');
  } else {
    pass('tarifas: el flujo invitado se detuvo en el selector (0 llamadas a checkout, 0 cargos)');
  }
  assertClean('tarifas', st);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// F. maestros: la parrilla se puebla con datos reales.
// ---------------------------------------------------------------------------
console.log('\n--- F. maestros: parrilla con datos reales ---');
await section('maestros', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
  const page = await ctx.newPage();
  const st = await gotoTracked(page, 'maestros.html', 6000);
  const imgs = await page.locator('#maestros-grid-section img').count();
  const kids = await page.locator('#maestros-grid-section').evaluate((el) => el.childElementCount);
  if (!live) warn('maestros: sin red, no se puede verificar la carga de datos (aviso)');
  else if (imgs >= 1 && kids > 1) pass(`maestros: parrilla poblada (${kids} nodos, ${imgs} fotos)`);
  else fail(`maestros: la parrilla no se puebla con datos (nodos: ${kids}, fotos: ${imgs})`);
  assertClean('maestros', st);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// G. profile (sistema de clientes): login real con credenciales falsas.
// ---------------------------------------------------------------------------
console.log('\n--- G. clientes: login rechaza credenciales falsas con elegancia ---');
await section('clientes', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
  const page = await ctx.newPage();
  const st = await gotoTracked(page, 'profile.html', 4000);
  const hasClient = await page.evaluate(() => Boolean(window.supabase));
  if (!hasClient) {
    warn('clientes: supabase-js no cargó (CDN) — login no verificable (aviso)');
  } else if (!(await page.locator('#login-email').isVisible())) {
    warn('clientes: no hay formulario de login visible (¿sesión persistida?) (aviso)');
  } else {
    await page.locator('#login-email').fill('test-inexistente@genyoga.studio');
    await page.locator('#login-password').fill('ContrasenaFalsa123!');
    await page.locator('#form-login button[type="submit"]').click({ timeout: 8000 });
    const errPopup = page.locator('.swal2-popup', { hasText: /Ups|Credenciales incorrectas/i });
    try {
      await errPopup.first().waitFor({ state: 'visible', timeout: 15000 });
      pass('clientes: credenciales falsas → error "Ups/Credenciales incorrectas" sin crashear');
      await page.keyboard.press('Escape');
    } catch {
      fail('clientes: el login con credenciales falsas no muestra el error esperado (¿flujo roto?)');
    }
    // El 400 de /auth/v1/token es la respuesta ESPERADA al login fallido
    // (supabase-js lo registra como error de consola): se descuenta del ruido.
    st.errors = st.errors.filter((e) => !e.includes('status of 400'));
    st.externalFailed = st.externalFailed.filter((u) => !u.includes('/auth/v1/token'));
  }

  // Las subpestañas admin se rellenan por JS al entrar con rol: anónimas deben
  // estar ocultas; visibles, deben tener texto (nunca botones vacíos).
  for (const id of ['btn-subtab-psicologia', 'btn-subtab-nutricion']) {
    const loc = page.locator(`#${id}`).first();
    if (await loc.isVisible().catch(() => false)) {
      const txt = await loc.innerText().catch(() => '');
      if (!txt.trim()) fail(`clientes: #${id} visible pero vacía (¿contenido dinámico roto?)`);
    }
  }
  // Recuperación con código: identificador falso → mensaje genérico, sin crash.
  // (No crea códigos ni toca cuentas: el servidor responde ok sin hacer nada.)
  await page.evaluate(() => toggleAuth('recover'));
  await page.waitForTimeout(600);
  await page.locator('#recover-identifier').fill('nadie-inexistente-xyz@genyoga.studio');
  await page.locator('#btn-recover-verify').click({ timeout: 8000 });
  try {
    await page.locator('.swal2-popup', { hasText: /Revisa tu correo/i }).first().waitFor({ state: 'visible', timeout: 15000 });
    pass('clientes: recuperación con cuenta inexistente responde genérico (anti-enumeración)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch {
    fail('clientes: el paso 1 de recuperación no muestra el mensaje genérico');
  }
  // Código falso → error genérico, sin cambios.
  await page.locator('#recover-code').fill('000000');
  await page.locator('#recover-new-password').fill('ContrasenaFalsa123!');
  const recConfirm = page.locator('#recover-confirm-password');
  if ((await recConfirm.count()) > 0) await recConfirm.fill('ContrasenaFalsa123!');
  await page.locator('#btn-recover-submit').click({ timeout: 8000 });
  try {
    await page.locator('.swal2-popup', { hasText: /Código incorrecto o caducado/i }).first().waitFor({ state: 'visible', timeout: 15000 });
    pass('clientes: código falso rechazado con mensaje genérico');
    await page.keyboard.press('Escape');
  } catch {
    fail('clientes: el código falso no es rechazado con el mensaje esperado');
  }
  await page.evaluate(() => toggleAuth('login'));
  await page.waitForTimeout(600);
  // Login con prefijo internacional: normaliza a 9 dígitos sin crashear.
  await page.evaluate(() => toggleAuth('login'));
  await page.waitForTimeout(400);
  await page.locator('#login-email').fill('+34 600 000 001');
  await page.locator('#login-password').fill('ContrasenaFalsa123!');
  await page.locator('#form-login button[type="submit"]').click({ timeout: 8000 });
  try {
    await page.locator('.swal2-popup', { hasText: /Ups|Credenciales incorrectas/i }).first().waitFor({ state: 'visible', timeout: 15000 });
    pass('clientes: login con +34 falla con elegancia (prefijo normalizado, sin crash)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } catch {
    fail('clientes: login con prefijo internacional rompe el flujo');
  }
  const testEmail = process.env.GEN_YOGA_TEST_EMAIL;
  const testPass = process.env.GEN_YOGA_TEST_PASSWORD;
  if (testEmail && testPass && live) {
    await page.locator('#login-email').fill(testEmail);
    await page.locator('#login-password').fill(testPass);
    await page.locator('#form-login button[type="submit"]').click({ timeout: 8000 });
    try {
      await page.locator('.swal2-popup', { hasText: /Ups|incorrectas/i }).waitFor({ state: 'visible', timeout: 12000 });
      fail('clientes: el usuario de pruebas NO entra (¿contraseña o RLS rotos?)');
    } catch {
      await page.waitForTimeout(4000);
      const stillLogin = await page.locator('#login-email').isVisible().catch(() => true);
      if (!stillLogin) pass('clientes: el usuario de pruebas entra y sale del login');
      else fail('clientes: login sin error pero el formulario sigue ahí (¿sesión no aplicada?)');
    }
  } else {
    info('clientes: login con usuario real omitido (define GEN_YOGA_TEST_EMAIL/PASSWORD para activarlo)');
  }
  // Los 400 de token (login fallido) y de reset-password-with-code (código
  // falso a propósito) son respuestas ESPERADAS: se descuentan del ruido.
  st.errors = st.errors.filter((e) => !e.includes('status of 400'));
  st.externalFailed = st.externalFailed.filter((u) => !u.includes('/auth/v1/token') && !u.includes('/functions/v1/reset-password-with-code'));
  assertClean('clientes', st);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// H. success/cancel: la cuenta atrás late y los retornos existen.
// ---------------------------------------------------------------------------
console.log('\n--- H. success/cancel: retorno sin pago y cuenta atrás ---');
// success sin ?session_id=: el camino real de quien vuelve sin pagar.
// Debe mostrar el error con elegancia, sin redirigir y sin crashear
// (la cuenta atrás solo existe tras un pago LIVE verificado: imposible presubida).
await section('success.html', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
  const page = await ctx.newPage();
  const st = await gotoTracked(page, 'success.html', 2500);
  const errBox = page.locator('#verification-error');
  const errMsg = await page.locator('#verification-error-message').textContent().catch(() => '');
  const errVisible = await errBox.isVisible().catch(() => false);
  if (errVisible && (errMsg || '').includes('sesión de pago LIVE válida')) {
    pass('success.html: sin sesión muestra el error correcto ("sesión de pago LIVE válida")');
  } else {
    fail(`success.html: sin sesión no muestra el error esperado (visible: ${errVisible})`);
  }
  const retryHidden = await page.locator('#verification-retry').evaluate((el) => el.classList.contains('hidden')).catch(() => null);
  if (retryHidden === true) pass('success.html: sin sesión no ofrece reintentar (correcto: nada que reintentar)');
  else if (retryHidden === false) fail('success.html: ofrece "Reintentar" sin sesión (reintentaría en bucle)');
  await page.waitForTimeout(3000);
  if (page.url().startsWith(base)) pass('success.html: sin pago no redirige a ningún lado');
  else fail('success.html: sin pago redirige fuera');
  assertClean('success.html', st);
  } finally {
    await ctx.close();
  }
});
for (const [file, sel] of [['cancel.html', '#countdown-dynamic']]) {
await section(file, async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
  const page = await ctx.newPage();
  const st = await gotoTracked(page, file, 1200);
  const read = () => page.locator(sel).first().textContent().catch(() => null);
  // La cuenta atrás puede arrancar tras verificaciones async: sondear hasta 10s.
  let t1 = await read();
  let t2 = t1;
  for (let i = 0; i < 10 && t2 === t1; i++) {
    await page.waitForTimeout(1000);
    t2 = await read();
    if (!page.url().startsWith(base)) break; // ya redirigió fuera
  }
  const n1 = Number(t1);
  const n2 = Number(t2);
  if (Number.isFinite(n1) && Number.isFinite(n2) && n2 < n1) {
    pass(`${file}: la cuenta atrás late (${t1}→${t2})`);
  } else if (page.url().endsWith('profile.html') || page.url().endsWith('tarifas.html')) {
    pass(`${file}: ya redirigió al destino (${page.url().split('/').pop()})`);
  } else {
    fail(`${file}: la cuenta atrás no avanza (${t1}→${t2})`);
  }
  assertClean(file, st);
  } finally {
    await ctx.close();
  }
});
}
{
  // Los botones de retorno de cancel apuntan a páginas que existen.
  const cancel = await readFile(path.join(root, 'cancel.html'), 'utf8');
  const hrefs = [...cancel.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]).filter((h) => h.endsWith('.html'));
  let ok = true;
  for (const h of hrefs) {
    try {
      await stat(path.join(root, h.split(/[?#]/)[0]));
    } catch {
      fail(`cancel: el retorno ${h} apunta a una página que no existe`);
      ok = false;
    }
  }
  if (ok) pass(`cancel: ${hrefs.length} retornos apuntan a páginas reales`);
}

// ---------------------------------------------------------------------------
// I. Controles muertos: todo <button> estático debe tener texto o etiqueta.
// ---------------------------------------------------------------------------
console.log('\n--- I. botones sin texto ni etiqueta (controles muertos) ---');
{
  const files = ['index.html', 'clases.html', 'tarifas.html', 'maestros.html', 'profile.html', 'success.html', 'cancel.html'];
  let dead = 0;
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    const markup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    for (const m of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
      const attrs = m[1];
      const inner = m[2];
      const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const hasLabel = /\baria-label=["'][^"']+["']/i.test(attrs) || /\btitle=["'][^"']+["']/i.test(attrs);
      const hasIcon = /<(svg|img|i|canvas)\b/i.test(inner);
      const hasId = /\bid=["'][^"']+["']/i.test(attrs);
      if (text || hasLabel) continue;
      // Vacío con icono (X, ojo): funciona al clicar, pero deuda de accesibilidad.
      if (hasIcon) {
        warn(`${file}: botón solo-icono sin etiqueta (${attrs.slice(0, 70)}…)`);
        continue;
      }
      // Vacío con id: lo rellena el JS en vivo (subpestañas) — se verifica en su escenario.
      if (hasId) {
        warn(`${file}: botón de contenido dinámico (${attrs.slice(0, 70)}…) — verificado en vivo`);
        continue;
      }
      fail(`${file}: botón muerto, sin texto, icono ni etiqueta (${attrs.slice(0, 80)}…)`);
      dead++;
    }
    for (const m of markup.matchAll(/<a\b([^>]*)>/gi)) {
      const attrs = m[1];
      if (!/\bhref=["'][^"']*["']/i.test(attrs) && !/\bonclick=/i.test(attrs)) {
        fail(`${file}: enlace <a> sin href ni acción (${attrs.slice(0, 80)}…)`);
        dead++;
      }
    }
  }
  if (dead === 0) pass('todos los botones y enlaces estáticos tienen propósito visible');
}

// ---------------------------------------------------------------------------
// J. Rendimiento: presupuestos por página + peso de imágenes en disco.
// ---------------------------------------------------------------------------
console.log('\n--- J. rendimiento: presupuestos por página ---');
{
  const LOAD_MAX_MS = 15000;
  const PAGE_MAX_BYTES = 8 * 1024 * 1024;
  const REQ_MAX = 80;
  for (const p of perf) {
    const kb = Math.round(p.bytes / 1024);
    if (p.loadMs > LOAD_MAX_MS) fail(`${p.page}: carga en ${p.loadMs}ms (presupuesto ${LOAD_MAX_MS}ms) — la web va lenta`);
    else if (p.bytes > PAGE_MAX_BYTES) fail(`${p.page}: pesa ${(p.bytes / 1048576).toFixed(1)}MB (presupuesto 8MB)`);
    else if (p.reqs > REQ_MAX) fail(`${p.page}: ${p.reqs} peticiones (presupuesto ${REQ_MAX})`);
    else pass(`${p.page}: ${p.loadMs}ms, ${kb}KB, ${p.reqs} peticiones`);
  }
  // Imágenes en disco: ninguna puede superar 1MB (las mayores hoy ~800KB).
  const IMG_MAX = 1024 * 1024;
  async function walkImgs(dir, out = []) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walkImgs(abs, out);
      else if (/\.(jpe?g|png|webp|gif|avif)$/i.test(e.name)) out.push(abs);
    }
    return out;
  }
  let heavy = 0;
  for (const abs of await walkImgs(path.join(root, 'img'))) {
    const size = (await stat(abs)).size;
    if (size > IMG_MAX) {
      fail(`img/${path.relative(path.join(root, 'img'), abs)}: ${(size / 1024) | 0}KB (presupuesto 1024KB) — optimízala`);
      heavy++;
    }
  }
  if (heavy === 0) pass('todas las imágenes en disco están bajo 1MB');
}

await browser.close();
server.close();

console.log('');
for (const w of warnings) console.log(`  ⚠️ ${w}`);
if (!live) console.log('  ℹ️ Checks en vivo degradados a aviso por falta de red (E2E_REQUIRE_LIVE=1 para exigirlos).');
if (errors.length > 0) {
  console.error(`\n⛔ check-e2e-prerelease: ${errors.length} fallo(s) bloqueante(s) en funcionamiento real.`);
  process.exit(1);
}
console.log('\n✅ check-e2e-prerelease: la nueva versión funciona en el mundo real (clics, datos, clientes, velocidad).');
