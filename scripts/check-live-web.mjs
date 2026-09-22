import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
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

const clasesHtml = await readFile(path.join(root, 'clases.html'), 'utf8');
const SUPA_URL = clasesHtml.match(/const SUPA_URL = '(https:\/\/[^']+)'/)?.[1];
const SUPA_KEY = clasesHtml.match(/const SUPA_KEY = '(sb_publishable_[^']+)'/)?.[1];
if (!SUPA_URL || !SUPA_KEY) {
  fail('no se encontró SUPA_URL/SUPA_KEY en clases.html');
  process.exit(1);
}

const REQUIRE_LIVE = process.env.E2E_REQUIRE_LIVE === '1';
let skipped = false;

async function rest(pathQuery) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/${pathQuery}`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    return { ok: true, status: res.status, body };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function needLive(label) {
  skipped = true;
  if (REQUIRE_LIVE) fail(`${label}: sin red y E2E_REQUIRE_LIVE=1 lo exige`);
  else warn(`${label}: sin red — se omite (E2E_REQUIRE_LIVE=1 para exigirlo)`);
  return false;
}

// ---------------------------------------------------------------------------
// L0. Conectividad (misma clave pública que usan los navegadores).
// ---------------------------------------------------------------------------
console.log('\n--- L0. Supabase accesible como un navegador ---');
let online = true;
{
  const r = await rest('configuracion?select=clave&limit=1');
  if (!r.ok) {
    online = needLive('L0 conectividad');
  } else if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) {
    pass('Supabase responde con la clave pública de la web');
  } else {
    fail(`Supabase responde raro a configuracion (HTTP ${r.status})`);
    online = false;
  }
}

// ---------------------------------------------------------------------------
// L1. Precios yoga: lo impreso en tarifas.html == stripe_productos.
// ---------------------------------------------------------------------------
console.log('\n--- L1. Precios yoga (web vs Stripe) ---');
if (online) {
  const tarifas = await readFile(path.join(root, 'tarifas.html'), 'utf8');
  const r = await rest('stripe_productos?select=nombre,unit_amount,activo&activo=is.true&limit=100');
  if (!r.ok) needLive('L1 productos');
  else {
    const byName = new Map(r.body.map((p) => [p.nombre, p.unit_amount]));
    const expected = [
      ['Clase suelta', 1500, '15'],
      ['Bono 4 clases', 5000, '50'],
      ['Bono 6 clases', 6500, '65'],
      ['Bono 10 clases', 9500, '95'],
      ['Bono mensual', 9000, '90'],
    ];
    for (const [name, cents, euros] of expected) {
      if (!byName.has(name)) {
        fail(`producto '${name}' desaparecido de stripe_productos (la web lo vende)`);
        continue;
      }
      const real = `${Math.round(byName.get(name) / 100)}`;
      const shown = new RegExp(`${euros}\\s*€`).test(tarifas);
      if (real !== euros) fail(`'${name}': Stripe cobra ${real} € pero la web imprime ${euros} €`);
      else if (!shown) fail(`'${name}': precio ${euros} € no aparece en tarifas.html`);
      else pass(`'${name}': web ${euros} € = Stripe ${real} €`);
    }
  }
}

// ---------------------------------------------------------------------------
// L2. Precios consultas: i18n (lo que lee la clienta) == stripe_productos.
// ---------------------------------------------------------------------------
console.log('\n--- L2. Precios consultas (i18n vs Stripe) ---');
if (online) {
  const i18n = await readFile(path.join(root, 'i18n.js'), 'utf8');
  const r = await rest('stripe_productos?select=nombre,unit_amount&activo=is.true&limit=100');
  if (!r.ok) needLive('L2 productos');
  else {
    const rows = r.body;
    const amountOf = (frag) => rows.find((p) => p.nombre.includes(frag))?.unit_amount;
    const shownIn = (euros) => new RegExp(`\\b${euros}\\s*€|€${euros}\\b`).test(i18n);
    const pairs = [
      ['psicoterapéutico inicial', 75, 'Miriam 1ª sesión'],
      ['psicoterapéutico sucesivo', 65, 'Miriam sucesiva'],
      ['pareja inicial', 120, 'pareja 1ª'],
      ['pareja sucesiva', 100, 'pareja sucesiva'],
      ['Clínica inicial', 80, 'Isabel 1ª'],
      ['Clínica sucesiva', 60, 'Isabel sucesiva'],
      ['Ayurveda inicial', 80, 'Silvia 1ª'],
      ['Ayurveda sucesiva', 60, 'Silvia sucesiva'],
    ];
    for (const [frag, euros, label] of pairs) {
      const cents = amountOf(frag);
      if (cents == null) {
        fail(`producto con '${frag}' no existe en Stripe (la web lo vende)`);
      } else if (Math.round(cents / 100) !== euros) {
        fail(`${label}: Stripe cobra ${Math.round(cents / 100)} € pero la web dice ${euros} €`);
      } else if (!shownIn(euros)) {
        fail(`${label}: ${euros} € no aparece en i18n (texto de compra huérfano)`);
      } else {
        pass(`${label}: web ${euros} € = Stripe ${euros} €`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// L3. Maestras visibles en BD == maestras que muestra la web (render real).
// ---------------------------------------------------------------------------
console.log('\n--- L3. Maestras visibles (BD vs render) ---');
if (online) {
  const r = await rest('profesionales?select=nombre,apellidos,visible_publico&limit=50');
  if (!r.ok) needLive('L3 profesionales');
  else {
    const visibles = r.body.filter((p) => p.visible_publico !== false);
    if (visibles.length === 0) fail('ninguna profesional visible (maestros.html saldría vacía)');
    else {
      // Servidor local + Chromium: lo que VERÍA una clienta de verdad.
      const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
      const server = http.createServer(async (req, res) => {
        try {
          const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
          const abs = path.join(root, rel);
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
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        await page.goto(`${base}/maestros.html`, { waitUntil: 'load', timeout: 45000 });
        // La parrilla carga perezosa y los nombres se renderizan en mayúsculas:
        // se baja hasta ella y se espera a cada nombre (insensible a caja).
        await page.locator('#maestros-grid-section').scrollIntoViewIfNeeded().catch(() => {});
        for (const p of visibles) {
          try {
            await page.locator('#maestros-grid-section', { hasText: new RegExp(p.nombre, 'i') }).first().waitFor({ state: 'visible', timeout: 20000 });
            pass(`maestras: '${`${p.nombre} ${p.apellidos || ''}`.trim()}' visible en la web`);
          } catch {
            fail(`maestras: '${p.nombre}' es visible en BD pero NO aparece en maestros.html`);
          }
        }
        await ctx.close();
      } finally {
        await browser.close();
        server.close();
      }
    }
  }
}

// ---------------------------------------------------------------------------
// L4. El calendario público no está vacío (hay clases futuras activas).
// ---------------------------------------------------------------------------
console.log('\n--- L4. Calendario con futuro ---');
if (online) {
  const nowIso = new Date().toISOString();
  const r = await rest(`clases?select=id&fecha_inicio=gt.${encodeURIComponent(nowIso)}&activa=is.true&limit=1`);
  if (!r.ok) needLive('L4 clases futuras');
  else if (Array.isArray(r.body) && r.body.length > 0) pass('hay clases futuras activas (el calendario no está vacío)');
  else fail('cero clases futuras activas: la web vende un calendario vacío');
}

// ---------------------------------------------------------------------------
// L5. Integridad referencial de la muestra (lo que la web pinta existe).
// ---------------------------------------------------------------------------
console.log('\n--- L5. Integridad referencial (200 clases recientes) ---');
if (online) {
  const [clases, profes] = await Promise.all([
    rest('clases?select=id,nombre,fecha_inicio,capacidad_max,profesor_id,tipo_clase,activa&order=fecha_inicio.desc&limit=200'),
    rest('profesionales?select=id&limit=50'),
  ]);
  if (!clases.ok || !profes.ok) needLive('L5 muestra');
  else {
    const ids = new Set(profes.body.map((p) => p.id));
    let orphans = 0;
    let badCap = 0;
    let badDate = 0;
    for (const c of clases.body) {
      if (c.profesor_id != null && !ids.has(c.profesor_id)) orphans++;
      if (!(Number(c.capacidad_max) > 0)) badCap++;
      if (Number.isNaN(new Date(c.fecha_inicio).getTime())) badDate++;
    }
    if (orphans > 0) fail(`${orphans} clase(s) con profesor_id inexistente (la web pintaría 'Instructor')`);
    else pass(`las ${clases.body.length} clases apuntan a profesoras reales`);
    if (badCap > 0) fail(`${badCap} clase(s) sin capacidad válida`);
    else pass('capacidades válidas en la muestra');
    if (badDate > 0) fail(`${badDate} clase(s) con fecha ilegible`);
    else pass('fechas legibles en la muestra');
  }
}

// ---------------------------------------------------------------------------
// L6. Arranque de la app (configuración y tipos legibles).
// ---------------------------------------------------------------------------
console.log('\n--- L6. Arranque (config + tipos) ---');
if (online) {
  const [cfg, tipos] = await Promise.all([
    rest('configuracion?select=clave&limit=10'),
    rest('tipos_clases?select=id,nombre,activo&limit=50'),
  ]);
  if (!cfg.ok || !tipos.ok) needLive('L6 arranque');
  else {
    if (Array.isArray(cfg.body) && cfg.body.length > 0) pass(`configuracion legible (${cfg.body.length} claves)`);
    else fail('configuracion vacía: clases.html no puede arrancar');
    if (Array.isArray(tipos.body) && tipos.body.length > 0) pass(`tipos_clases legibles (${tipos.body.length})`);
    else fail('tipos_clases vacíos');
  }
}

// ---------------------------------------------------------------------------
// L7. Privacidad: lo privado NO debe verse sin sesión (fuga = fallo).
// ---------------------------------------------------------------------------
console.log('\n--- L7. Privacidad (sin sesión no se ve nada privado) ---');
if (online) {
  for (const [table, label] of [
    ['reservas_yoga?select=id&limit=1', 'reservas ajenas'],
    ['profiles?select=id&limit=1', 'perfiles ajenos'],
    ['stripe_purchases?select=checkout_session_id&limit=1', 'compras'],
  ]) {
    const r = await rest(table);
    if (!r.ok) {
      needLive(`L7 ${label}`);
    } else if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) {
      fail(`FUGA DE DATOS: ${label} visibles sin sesión`);
    } else if (r.status === 200 || r.status === 401 || r.status === 403) {
      pass(`${label}: protegidos sin sesión (HTTP ${r.status})`);
    } else {
      warn(`${label}: HTTP ${r.status} inesperado (revisar)`);
    }
  }
}

console.log('');
if (skipped && !REQUIRE_LIVE) console.log('  ℹ️ Parte verificada con red; sin red degrada a aviso (E2E_REQUIRE_LIVE=1 para exigirlo).');
if (errors.length > 0) {
  console.error(`\n⛔ check-live-web: ${errors.length} incoherencia(s) entre la web y Supabase.`);
  process.exit(1);
}
console.log('\n✅ check-live-web: lo que pone la web coincide con Supabase (precios, maestras, calendario, integridad, privacidad).');
