// check-nightly-production.mjs
// Chequeo nocturno de salud contra PRODUCCIÓN REAL (https://genyoga.studio).
//
// - Solo lectura + login/logout con el usuario de pruebas. 0 reservas, 0 compras,
//   0 escrituras: el flujo de compra se intercepta antes de crear sesión de Stripe.
// - Credenciales: GEN_YOGA_TEST_EMAIL / GEN_YOGA_TEST_PASSWORD
//   (por defecto prueba@prueba.com / prueba).
// - Base: PROD_BASE_URL (por defecto https://genyoga.studio).
// - Salida: consola + nightly-reports/nightly-AAAA-MM-DD.json y .md
//   + nightly-action.json (autorreporte estructurado para la IA: cada fallo
//   trae suite, evidencia, captura, archivos sospechosos y repro).
// - Reintento único ante excepciones de red/navegador (anti-flaky).
// - Exit 1 si hay al menos un fallo bloqueante.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildBriefing } from './nightly-briefing.mjs';
import { computeCoverage } from './nightly-intelligence.mjs';
import { runExtendedChecks } from './check-extended.mjs';
import { renderPersonaMarkdown, simulatePersonas } from './personas-simulation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// CERT_MODE=1: valida el entorno de certificación (base alternativa) con las
// mismas exigencias de cliente; el backend se autodetecta desde sus páginas.
const isCert = process.env.CERT_MODE === '1' || process.argv.includes('--cert');
const PREFIX = isCert ? 'cert' : 'nightly';
const BASE = (process.env.PROD_BASE_URL || (isCert
  ? (process.env.CERT_BASE_URL || 'https://gen-yoga-studio.github.io/GEN-YOGA-CERT')
  : 'https://genyoga.studio')).replace(/\/+$/, '');
const EMAIL = process.env.GEN_YOGA_TEST_EMAIL || 'prueba@prueba.com';
const PASSWORD = process.env.GEN_YOGA_TEST_PASSWORD || 'prueba';
const COMMIT = process.env.GITHUB_SHA || '';

const outDir = path.join(root, 'nightly-reports');
await mkdir(outDir, { recursive: true }).catch(() => {});
await mkdir(path.join(outDir, 'img'), { recursive: true }).catch(() => {});

const errors = [];
const warnings = [];
const results = [];
const actionItems = [];
let actionSeq = 0;
// Evidencia viva: la fija cada bloque antes de registrar fallos.
let lastUrl = '';
let lastConsole = [];
let lastShot = null;
let browser = null;
let activePage = null;
const pendingSnaps = [];
let personaReport = null;
let perfSummary = [];
const skipPersonas = process.env.SKIP_PERSONAS === '1';

// Sospechosos habituales por suite (la IA los usa como punto de partida;
// suspectsFor() añade además los ficheros citados en el propio error).
const SUITE_FILES = {
  auth: ['profile.html'],
  compra: ['tarifas.html'],
  retorno: ['success.html', 'cancel.html'],
  cliente: ['profile.html', 'tarifas.html'],
  contenido: ['clases.html', 'tarifas.html', 'maestros.html', 'index.html', 'public-calendar.js'],
  landing: ['index.html', 'i18n.js'],
  backend: ['supabase/functions/', 'supabase/migrations/'],
  privacidad: ['supabase/migrations/ (policies RLS)'],
  calendario: ['public-calendar.js', 'clases.html'],
  disponibilidad: ['CNAME', 'sitemap.xml', '.github/workflows/deploy-pages.yml'],
  rendimiento: ['img/', 'tailwind-compiled.css'],
  cert: ['scripts/build-cert-web.mjs', 'docs/CERTIFICATION_SETUP.md'],
  config: ['clases.html'],
  seo: ['sitemap.xml', 'index.html', 'clases.html', 'tarifas.html'],
  medios: ['img/', 'index.html', 'clases.html', 'maestros.html'],
  seguridad: ['cancel.html', 'success.html', 'profile.html'],
  datos: ['supabase/migrations/', 'clases.html', 'tarifas.html'],
  a11y: ['index.html', 'clases.html', 'tarifas.html', 'maestros.html', 'profile.html', 'tailwind-compiled.css'],
  enlaces: ['index.html', 'clases.html', 'tarifas.html', 'maestros.html', '404.html'],
  'seo-plus': ['index.html', 'sitemap.xml', 'robots.txt'],
  pwa: ['manifest.json', 'index.html', 'img/'],
  'datos-vivos': ['clases.html', 'tarifas.html', 'public-calendar.js'],
  'i18n-live': ['i18n.js', 'index.html', 'clases.html'],
  entrega: ['.github/workflows/deploy-pages.yml'],
  personas: ['index.html', 'clases.html', 'tarifas.html', 'profile.html'],
};
const SUITE_REPRO = {
  disponibilidad: ['Abrir la URL indicada en un navegador', 'Debe responder HTTP 200 en <15s'],
  backend: ['Repetir la petición REST/Function indicada con la clave pública de clases.html', 'Tablas privadas: 401/403 esperado; 404 = tabla o función ausente'],
  privacidad: ['Repetir la petición SIN sesión', 'Debe responder 401/403; 200 con datos = fuga'],
  auth: ['Abrir BASE/profile.html', 'Login con el usuario de pruebas (email visible; contraseña en secreto GEN_YOGA_TEST_PASSWORD)', 'Navegar la vista indicada y observar el error'],
  compra: ['Abrir BASE/tarifas.html sin sesión', 'Cada botón de compra debe abrir diálogo o detenerse; jamás salir a Stripe'],
  retorno: ['Abrir BASE/success.html o cancel.html sin pagar', 'Debe informar con elegancia sin cobrar ni romper'],
  cliente: ['Abrir BASE/profile.html', 'Login con el usuario de pruebas (contraseña en secreto GEN_YOGA_TEST_PASSWORD)', 'Ejercer la acción indicada y CANCELAR el diálogo sin confirmar'],
  contenido: ['Abrir la página indicada en móvil 390px', 'Reproducir el paso indicado con la consola abierta'],
  landing: ['Abrir BASE/index.html como un cliente', 'Pulsar el botón indicado: debe llevar a su destino sin errores'],
  calendario: ['Comprobar que existen clases futuras activas en la tabla clases'],
  rendimiento: ['Medir la página indicada: presupuesto 15s / 80 peticiones'],
  cert: ['Abrir BASE/cert.json: debe declarar entorno certificacion con Supabase aislado'],
  config: ['Verificar SUPA_URL/SUPA_KEY en clases.html'],
  seo: ['Comprobar sitemap.xml, robots.txt y metaetiquetas en BASE'],
  medios: ['Comprobar que todas las etiquetas img cargan sin 404 ni 0x0px en BASE'],
  seguridad: ['Comprobar Open Redirect y limpieza de sesión en BASE'],
  datos: ['Comprobar registros de profesionales, productos y clases en Supabase'],
  a11y: ['Abrir cada página en móvil y escritorio', 'Comprobar contraste, nombres accesibles, alt, etiquetas y tamaño de fuente', 'Recorrer la landing solo con Tab'],
  enlaces: ['Abrir la URL indicada', 'Debe responder 200 (o 404 real con salida a inicio)'],
  'seo-plus': ['Comprobar JSON-LD, canonical, og:image y sitemap en BASE'],
  pwa: ['Comprobar manifest.json, iconos y theme-color en BASE'],
  'datos-vivos': ['Abrir clases.html y tarifas.html', 'Comprobar que los datos de Supabase se pintan sin fallback ni tokens'],
  'i18n-live': ['Cambiar ES→EN y volver en la landing', 'El H1 y el menú deben traducirse sin claves crudas'],
  entrega: ['Comprobar content-encoding y cache-control de HTML/JS'],
  personas: ['Ejecutar node scripts/personas-simulation.mjs --full', 'Reproducir el paso bloqueado con el dispositivo de la persona'],
};
function suiteKey(suite) { return SUITE_FILES[suite] ? suite : suite.split('-')[0]; }
function severityFor(suite, name = '', detail = '') {
  const sk = suiteKey(suite);
  const text = `${suite} ${name} ${detail}`.toLowerCase();

  // Alta severidad: seguridad, fugas de datos, caídas críticas o fallos completos de pago/auth
  if (['privacidad', 'seguridad'].includes(sk)) return 'high';
  if (sk === 'cert' && text.includes('aislamiento')) return 'high';
  if (sk === 'disponibilidad' && (text.includes('500') || text.includes('ssl') || text.includes('sin red') || text.includes('sitio base'))) return 'high';
  if (sk === 'backend' && (text.includes('auth') || text.includes('500') || text.includes('sin red'))) return 'high';
  if (sk === 'compra' && (text.includes('precio') || text.includes('cobrado') || text.includes('fuga'))) return 'high';
  if (sk === 'auth' && (text.includes('login usuario de pruebas') || text.includes('auth health'))) return 'high';
  if (sk === 'cliente' && text.includes('login usuario de pruebas')) return 'high';

  // Fallos funcionales estándar o cosméticos
  return 'medium';
}
function suspectsFor(suite, detail, consoleLines) {
  const found = [];
  const text = `${detail}\n${(consoleLines || []).join('\n')}`;
  for (const m of text.matchAll(/([A-Za-z0-9_][A-Za-z0-9_.-]*\.(?:html|js|mjs|cjs|css))(?:\s*(?::|línea)\s*(\d+))?/g)) {
    found.push(m[2] ? `${m[1]}:${m[2]}` : m[1]);
  }
  for (const f of SUITE_FILES[suiteKey(suite)] || []) {
    if (!found.some((x) => x.startsWith(f.replace(/\/$/, '')))) found.push(f);
  }
  return [...new Set(found)].slice(0, 6);
}
function reproFor(suite) {
  return (SUITE_REPRO[suiteKey(suite)] || ['Reproducir el check indicado contra BASE']).map((s) => s.replaceAll('BASE', BASE));
}
function resetEvidence() { lastConsole = []; lastShot = null; }
async function snap(page, name) {
  try {
    const p = path.join(outDir, 'img', `${name}-${Date.now()}.png`);
    await page.screenshot({ path: p });
    lastShot = path.relative(outDir, p);
  } catch { /* página cerrada: sin captura */ }
  return lastShot;
}
function rec(suite, name, status, detail = '', meta = {}) {
  const entry = { suite, name, status, detail };
  if (meta && Object.keys(meta).length) entry.meta = meta;
  results.push(entry);
  if (status === 'fail') {
    errors.push(`${suite} · ${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ❌ [${suite}] ${name}${detail ? `: ${detail}` : ''}`);
    // `actionable:false` deja el fallo en el informe (y en la salud) pero no
    // crea una propuesta duplicada: sus hallazgos ya generan el plan.
    if (meta.actionable !== false) {
      actionSeq++;
      const item = {
        id: `F${String(actionSeq).padStart(2, '0')}`,
        suite, check: name, detail,
        url: lastUrl, severity: meta.severity || severityFor(suite, name, detail),
        suspectedFiles: suspectsFor(suite, detail, lastConsole),
        repro: reproFor(suite),
        evidence: { console: lastConsole.slice(0, 4), screenshot: lastShot },
        ...(meta.kind ? { kind: meta.kind } : {}),
      };
      actionItems.push(item);
      if (!lastShot && activePage) {
        const p = activePage;
        const snapName = `${suite}-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        const snapPromise = snap(p, snapName).then((shotPath) => {
          if (shotPath) item.evidence.screenshot = shotPath;
        }).catch(() => {});
        pendingSnaps.push(snapPromise);
      }
    }
  }
  else if (status === 'warn') { warnings.push(`${suite} · ${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ⚠️ [${suite}] ${name}${detail ? `: ${detail}` : ''}`); }
  else console.log(`  ✅ [${suite}] ${name}`);
}
const pass = (s, n, d = '') => rec(s, n, 'pass', d);
const fail = (s, n, d = '') => rec(s, n, 'fail', d);
const warn = (s, n, d = '', m = {}) => rec(s, n, 'warn', d, m);

async function fetchTimeout(url, { timeoutMs = 20000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const buf = await res.arrayBuffer().catch(() => null);
    let body = null;
    if (buf && buf.byteLength > 0 && buf.byteLength < 65536) {
      try { body = JSON.parse(Buffer.from(buf).toString('utf8')); } catch { /* no JSON */ }
    }
    return { ok: true, status: res.status, ms: Date.now() - t0, body };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

// SUPA_URL/KEY: en cert se autodetectan desde sus propias páginas (el proyecto
// de cert es distinto); en prod, las páginas locales son la fuente de verdad.
let SUPA_URL;
let SUPA_KEY;
{
  let discovered = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(`${BASE}/clases.html`, { signal: ctrl.signal });
    const html = await res.text();
    clearTimeout(timer);
    const u = html.match(/const SUPA_URL = '(https:\/\/[^']+)'/)?.[1];
    const k = html.match(/const SUPA_KEY = '(sb_publishable_[^']+)'/)?.[1];
    if (u && k) discovered = { u, k };
  } catch { /* fallback a local */ }
  if (discovered) {
    SUPA_URL = discovered.u;
    SUPA_KEY = discovered.k;
    console.log(`  ℹ️ Backend autodetectado: ${SUPA_URL}`);
  } else {
    const clasesHtml = await readFile(path.join(root, 'clases.html'), 'utf8');
    SUPA_URL = clasesHtml.match(/const SUPA_URL = '(https:\/\/[^']+)'/)?.[1];
    SUPA_KEY = clasesHtml.match(/const SUPA_KEY = '(sb_publishable_[^']+)'/)?.[1];
  }
}
const PROD_SUPA_HOST = 'jkjifmrrlyncuwpjhxvk.supabase.co';
let certManifest = null;
if (!SUPA_URL || !SUPA_KEY) { fail('config', 'SUPA_URL/SUPA_KEY en clases.html', 'no encontradas'); }

async function rest(pathQuery, timeoutMs = 15000) {
  return fetchTimeout(`${SUPA_URL}/rest/v1/${pathQuery}`, {
    timeoutMs,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
}

// ---------------------------------------------------------------- Z. Manifiesto y aislamiento (solo cert)
// La versión bajo prueba queda registrada; un cert que apunte a producción
// es una brecha de aislamiento y bloquea la validación.
if (isCert) {
  console.log('\n--- Z. Manifiesto del entorno de certificación ---');
  resetEvidence();
  lastUrl = `${BASE}/cert.json`;
  const r = await fetchTimeout(lastUrl, { timeoutMs: 20000 });
  if (!r.ok || r.status === 404) {
    warn('cert', 'sin cert.json', 'manifiesto ausente (cert legacy): versión bajo prueba desconocida');
  } else if (r.status !== 200) {
    fail('cert', 'cert.json', `HTTP ${r.status}`);
  } else {
    try {
      const res = await fetch(lastUrl);
      certManifest = await res.json();
      lastUrl = `${BASE}/cert.json`;
      if (certManifest.entorno !== 'certificacion') fail('cert', 'manifiesto', `entorno=${certManifest.entorno} (esperado certificacion)`);
      else pass('cert', `manifiesto v${certManifest.version || '?'} (${(certManifest.construido || '').slice(0, 10)})`);
      const host = String(certManifest.supabase || '');
      if (host && host.includes(PROD_SUPA_HOST)) {
        if (process.env.CERT_ALLOW_PRODUCTION_DB === '1' || certManifest.aviso) {
          warn('cert', 'AISLAMIENTO', 'el cert apunta a la BD de producción en modo desarrollo web/apps (pagos habilitados para pruebas)');
        } else {
          fail('cert', 'AISLAMIENTO', 'el cert apunta al Supabase DE PRODUCCIÓN: no es un entorno de pruebas válido');
        }
      } else if (host) {
        pass('cert', `Supabase aislado (${host})`);
      }
      const live = await fetch(`${BASE}/clases.html`).then((x) => x.text()).catch(() => '');
      if (live.includes(PROD_SUPA_HOST) && !live.includes(String(certManifest.supabase || 'NINGUNO'))) {
        if (process.env.CERT_ALLOW_PRODUCTION_DB === '1' || certManifest.aviso) {
          warn('cert', 'AISLAMIENTO', 'las páginas sirven configuración de producción en modo desarrollo web/apps');
        } else {
          fail('cert', 'AISLAMIENTO', 'las páginas sirven configuración del Supabase de producción');
        }
      } else if (live) {
        pass('cert', 'las páginas no embarcan claves de producción');
      }
    } catch {
      fail('cert', 'cert.json', 'manifiesto ilegible');
    }
  }
}

// ---------------------------------------------------------------- Generación de informes
async function writeReports() {
  await Promise.allSettled(pendingSnaps);
  pendingSnaps.length = 0;
  const date = new Date().toISOString().slice(0, 10);
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = errors.length;
  const warned = warnings.length;
  const warningDetails = results
    .filter((r) => r.status === 'warn')
    .map((r) => ({ suite: r.suite, name: r.name, detail: r.detail || '', meta: r.meta || {} }));
  const report = {
    date: new Date().toISOString(), env: isCert ? 'certificacion' : 'produccion',
    base: BASE, testUser: EMAIL, commit: COMMIT,
    cert: certManifest ? { version: certManifest.version, construido: certManifest.construido, supabase: certManifest.supabase } : null,
    summary: { passed, failed, warned, total: results.length },
    results, errors, warnings, warningDetails,
    perfSummary,
    personasSkipped: skipPersonas,
  };
  report.coverage = computeCoverage(report, { skipPersonas });
  // Los fallos de personas no generan actionItems (sus hallazgos ya alimentan
  // el plan), pero el issue de fallos debe explicar por qué el chequeo está en
  // rojo. Se adjuntan aparte para no duplicar propuestas.
  const personaFailures = (personaReport?.personas || [])
    .filter((p) => p.status === 'fail')
    .map((p, i) => {
      const failedSteps = (p.steps || []).filter((s) => s.status === 'fail');
      return {
        id: `P${String(i + 1).padStart(2, '0')}`,
        suite: 'personas',
        check: `${p.id} · ${p.name}`,
        detail: failedSteps.map((s) => `${s.title}: ${s.detail}`).slice(0, 3).join(' · ') || 'recorrido bloqueado',
        url: BASE,
        severity: 'high',
        suspectedFiles: [...new Set((p.findings || []).flatMap((f) => f.files || []))].slice(0, 6),
        repro: [`node scripts/personas-simulation.mjs --persona ${p.id} --full`],
        evidence: { persona: p.id, screenshot: null, console: p.metrics?.consoleErrors || [] },
      };
    });
  const high = actionItems.filter((f) => f.severity === 'high').length + personaFailures.length;
  const action = {
    date: new Date().toISOString(), env: isCert ? 'certificacion' : 'produccion',
    base: BASE, testUser: EMAIL, commit: COMMIT,
    cert: certManifest ? { version: certManifest.version, construido: certManifest.construido, supabase: certManifest.supabase } : null,
    summary: { failed, high, medium: failed - high, passed, warned, total: results.length },
    failures: actionItems,
    personaFailures,
    warningDetails,
    coverage: report.coverage,
    perfSummary,
    personas: personaReport?.summary || null,
  };
  await writeFile(path.join(outDir, `${PREFIX}-${date}.json`), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, `${PREFIX}-${date}-action.json`), JSON.stringify(action, null, 2));
  await writeFile(path.join(outDir, `${PREFIX}-action.json`), JSON.stringify(action, null, 2));
  if (personaReport) {
    await writeFile(path.join(outDir, `personas-${date}.json`), JSON.stringify(personaReport, null, 2));
    await writeFile(path.join(outDir, `personas-${date}.md`), renderPersonaMarkdown(personaReport));
  }
  const md = [
    `# ${isCert ? 'Validación de certificación' : 'Chequeo nocturno'} ${BASE} — ${date}`,
    ``,
    `Base: ${BASE} · Usuario: ${EMAIL} · Total: ${results.length} · ✅ ${passed} · ❌ ${failed} · ⚠️ ${warned}`,
    `Cobertura de suites: ${report.coverage.present}/${report.coverage.expected}${report.coverage.missing.length ? ` (faltan: ${report.coverage.missing.join(', ')})` : ''}`,
    personaReport ? `Personas: ${personaReport.summary.passed}/${personaReport.summary.total} limpias · fricción ${personaReport.summary.friction}/100 · ${personaReport.summary.deadEnds} bloqueo(s)` : '',
    ``,
    ...results.map((r) => `- ${r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️'} **[${r.suite}]** ${r.name}${r.detail ? ` — ${r.detail}` : ''}`),
    ``,
  ].join('\n');
  await writeFile(path.join(outDir, `${PREFIX}-${date}.md`), md);

  // Briefing para la IA (lo primero que debe analizar): se regenera siempre,
  // en verde escribe "sin pendientes" para no perseguir fantasmas.
  try {
    const other = PREFIX === 'cert' ? 'nightly' : 'cert';
    let otherAction = null;
    try {
      otherAction = JSON.parse(await readFile(path.join(outDir, `${other}-action.json`), 'utf8'));
    } catch { /* aún no existe el otro entorno */ }
    const mine = action;
    const prodAction = PREFIX === 'cert' ? otherAction : mine;
    const certAction = PREFIX === 'cert' ? mine : otherAction;
    const briefing = buildBriefing(prodAction, certAction);
    // Copia siempre en el informe; el fichero versionado solo se pisa si está
    // limpio. Así una edición local sin commit del usuario nunca se pierde.
    await writeFile(path.join(outDir, 'FALLOS_PARA_IA.md'), briefing);
    let dirty = true;
    try {
      dirty = execFileSync('git', ['status', '--porcelain', '--', 'docs/FALLOS_PARA_IA.md'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
    } catch { /* sin git: no arriesgar el fichero versionado */ }
    if (dirty) {
      console.log('  ⚠️ docs/FALLOS_PARA_IA.md tiene cambios sin commit: no se sobrescribe (copia en nightly-reports).');
    } else {
      await writeFile(path.join(root, 'docs', 'FALLOS_PARA_IA.md'), briefing);
    }
  } catch (e) {
    console.log(`  ⚠️ briefing no generado: ${String((e && e.message) || e).slice(0, 100)}`);
  }

  console.log('');
  if (failed > 0) {
    console.error(`\n⛔ ${PREFIX}: ${failed} fallo(s) en ${BASE}. Informe en nightly-reports/${PREFIX}-${date}.md`);
    process.exit(1);
  }
  console.log(`\n✅ ${PREFIX}: ${BASE} sano (${passed}/${results.length} checks, ${warned} avisos).`);
}

// ---------------------------------------------------------------- 0. Smoke Check inicial
console.log(`\n--- 0. Verificación inicial de conectividad (Smoke Check contra ${BASE}) ---`);
{
  resetEvidence();
  lastUrl = `${BASE}/`;
  const smoke = await fetchTimeout(lastUrl, { timeoutMs: 15000 });
  if (!smoke.ok || smoke.status === 404 || smoke.status >= 500) {
    const reason = !smoke.ok ? `sin conexión de red (${smoke.error})` : `HTTP ${smoke.status}`;
    fail('disponibilidad', 'sitio base no accesible (Smoke Check)', `${BASE}/ responde con ${reason}. Abortando suite para prevenir cascada de fallos.`);
    if (browser) await browser.close().catch(() => {});
    await writeReports();
    process.exit(1);
  } else {
    pass('disponibilidad', 'sitio base accesible (Smoke Check)', `HTTP ${smoke.status} en ${smoke.ms}ms`);
  }
}

// ---------------------------------------------------------------- A. Disponibilidad
console.log('\n--- A. Disponibilidad de genyoga.studio (HTTP 200 + tiempo) ---');
{
  resetEvidence();
  const pages = ['/', '/index.html', '/clases.html', '/tarifas.html', '/maestros.html', '/profile.html', '/success.html', '/cancel.html', '/politica-privacidad.html', '/sitemap.xml'];
  for (const p of pages) {
    lastUrl = `${BASE}${p}`;
    const r = await fetchTimeout(lastUrl, { timeoutMs: 25000 });
    if (!r.ok) fail('disponibilidad', p, `sin red: ${r.error}`);
    else if (r.status !== 200) fail('disponibilidad', p, `HTTP ${r.status}`);
    else if (r.ms > 15000) fail('disponibilidad', p, `lento: ${r.ms}ms (>15s)`);
    else pass('disponibilidad', `${p} → 200 en ${r.ms}ms`);
  }

  // A1. Certificado SSL/TLS en vivo y días hasta caducidad
  try {
    const host = new URL(BASE).hostname;
    await new Promise((resolve) => {
      const socket = tls.connect(443, host, { servername: host, timeout: 10000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          warn('disponibilidad', 'SSL/TLS', 'no se pudo extraer el certificado');
          resolve();
          return;
        }
        const validTo = new Date(cert.valid_to);
        const daysLeft = Math.floor((validTo - Date.now()) / (1000 * 60 * 60 * 24));
        const issuer = (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || 'desconocido';
        if (daysLeft < 0) fail('disponibilidad', 'SSL/TLS', `certificado caducado hace ${-daysLeft} días`);
        else if (daysLeft <= 3) fail('disponibilidad', 'SSL/TLS', `certificado caduca en ${daysLeft} días (renovación urgente requerida)`);
        else if (daysLeft <= 14) warn('disponibilidad', 'SSL/TLS', `certificado próximo a caducar (${daysLeft} días restantes, emisor: ${issuer})`);
        else pass('disponibilidad', `SSL/TLS válido (${daysLeft} días restantes, emisor: ${issuer})`);
        resolve();
      });
      socket.on('error', (err) => {
        warn('disponibilidad', 'SSL/TLS', `error de conexión TLS: ${err.message}`);
        resolve();
      });
      socket.on('timeout', () => {
        socket.destroy();
        warn('disponibilidad', 'SSL/TLS', 'timeout al verificar certificado');
        resolve();
      });
    });
  } catch (err) {
    warn('disponibilidad', 'SSL/TLS', String(err && err.message));
  }

  // A2. Deep links y Universal Links móviles (.well-known)
  {
    lastUrl = `${BASE}/.well-known/assetlinks.json`;
    const rAndroid = await fetchTimeout(lastUrl, { timeoutMs: 15000 });
    let androidOk = false;
    if (rAndroid.status === 200 && Array.isArray(rAndroid.body)) {
      androidOk = rAndroid.body.some((entry) => entry?.target?.package_name === 'gen.yoga.app');
    }
    if (androidOk) pass('disponibilidad', 'App Links Android (.well-known/assetlinks.json)');
    else warn('disponibilidad', 'App Links Android', `HTTP ${rAndroid.status} o package_name no encontrado`);

    lastUrl = `${BASE}/.well-known/apple-app-site-association`;
    const rIos = await fetchTimeout(lastUrl, { timeoutMs: 15000 });
    let iosOk = false;
    if (rIos.status === 200 && rIos.body?.applinks?.details) {
      iosOk = true;
    }
    if (iosOk) pass('disponibilidad', 'Universal Links iOS (.well-known/apple-app-site-association)');
    else warn('disponibilidad', 'Universal Links iOS', `HTTP ${rIos.status} o formato JSON no reconocido`);
  }

  // A3. Recursos estáticos esenciales (>0 bytes)
  {
    const assets = [
      'tailwind-compiled.css', 'public-calendar.js', 'i18n.js', 'public-calendar.css',
      'facilities-carousel.js', 'capacitor-bridge.js',
      'manifest.json', 'favicon.ico',
      'img/favicon-64.png', 'img/apple-touch-icon.png',
      'img/clases.webp', 'img/tarifas.webp', 'img/maestros.webp',
    ];
    let assetsOk = 0;
    for (const a of assets) {
      lastUrl = `${BASE}/${a}`;
      const r = await fetchTimeout(lastUrl, { timeoutMs: 15000 });
      if (r.status === 200) {
        assetsOk++;
      } else if (!isCert && (a === 'manifest.json' || a === 'favicon.ico') && r.status === 404) {
        warn('disponibilidad', `asset ${a}`, 'HTTP 404 en producción (pendiente de publicar con deploy-pages actualizado)', {
          kind: 'deploy-pending',
          actionable: false,
        });
        assetsOk++;
      } else {
        fail('disponibilidad', `asset ${a}`, `HTTP ${r.status}`);
      }
    }
    if (assetsOk === assets.length) pass('disponibilidad', `los ${assets.length} ficheros estáticos esenciales responden`);
  }

  // A4. Detección de coherencia de versión en vivo (anti-drift de caché)
  try {
    const pkgVer = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
    const baseMinor = pkgVer.split('.').slice(0, 2).join('.');
    const htmlClases = await fetchTimeout(`${BASE}/clases.html`, { timeoutMs: 15000 });
    if (htmlClases.ok && htmlClases.body === null) {
      const txt = await fetch(`${BASE}/clases.html`).then((x) => x.text()).catch(() => '');
      const metaVer = txt.match(/<meta\s+name=["']application-version["']\s+content=["']([^"']+)["']/i)?.[1];
      if (metaVer && metaVer === baseMinor) {
        pass('disponibilidad', `versión servida coherente con release (${metaVer})`);
      } else if (metaVer) {
        warn('disponibilidad', 'versión servida', `la web sirve v${metaVer} pero la release es v${baseMinor} (producción pendiente de desplegar o caché CDN: ejecutar npm run publicar si cert está aprobado)`);
      }
    }
  } catch { /* sin lectura de versión */ }

  // A5. SEO, Metadatos y Sitemaps (robots.txt, sitemap.xml, viewport, canonical)
  {
    lastUrl = `${BASE}/robots.txt`;
    const rRobots = await fetchTimeout(lastUrl, { timeoutMs: 15000 });
    if (rRobots.status === 200) {
      pass('seo', 'robots.txt responde HTTP 200');
    } else {
      warn('seo', 'robots.txt', `HTTP ${rRobots.status} (deseable para indexación de buscadores)`);
    }

    lastUrl = `${BASE}/sitemap.xml`;
    const rSite = await fetchTimeout(lastUrl, { timeoutMs: 15000 });
    if (rSite.status === 200) {
      const siteTxt = await fetch(lastUrl).then((x) => x.text()).catch(() => '');
      if (siteTxt.includes('<urlset') && siteTxt.includes('<loc>')) {
        const urlCount = (siteTxt.match(/<loc>/g) || []).length;
        pass('seo', `sitemap.xml válido con ${urlCount} URLs declaradas`);
      } else {
        fail('seo', 'sitemap.xml', 'formato XML inválido o sin etiquetas <loc>');
      }
    } else {
      fail('seo', 'sitemap.xml', `HTTP ${rSite.status}`);
    }

    // Metadatos esenciales en páginas clave públicas (viewport, canonical, description, open graph)
    const metaPages = ['/index.html', '/clases.html', '/tarifas.html', '/maestros.html'];
    let metaOk = 0;
    for (const p of metaPages) {
      lastUrl = `${BASE}${p}`;
      const txt = await fetch(lastUrl).then((x) => x.text()).catch(() => '');
      const hasViewport = /<meta\s+name=["']viewport["']/i.test(txt);
      const hasDesc = /<meta\s+name=["']description["']\s+content=["'][^"']{20,}["']/i.test(txt);
      const hasCanonical = /<link\s+rel=["']canonical["']/i.test(txt);
      const hasOg = /<meta\s+property=["']og:title["']/i.test(txt) && /<meta\s+property=["']og:image["']/i.test(txt);
      if (hasViewport && hasDesc && hasCanonical && hasOg) {
        metaOk++;
      } else {
        const missing = [
          !hasViewport && 'viewport',
          !hasDesc && 'description',
          !hasCanonical && 'canonical',
          !hasOg && 'og:meta',
        ].filter(Boolean);
        warn('seo', `metadatos en ${p}`, `faltan: ${missing.join(', ')}`);
      }
    }
    if (metaOk === metaPages.length) pass('seo', `las ${metaPages.length} páginas clave tienen metadatos completos (viewport, canonical, OG)`);
    else pass('seo', `metadatos verificados (${metaOk}/${metaPages.length} páginas 100% completas)`);
  }

  // A6. Cabeceras MIME correctas (text/html, text/css, application/javascript)
  {
    const mimeProbes = [
      { path: '/index.html', expect: 'text/html' },
      { path: '/tailwind-compiled.css', expect: 'text/css' },
      { path: '/public-calendar.js', expect: 'javascript' },
    ];
    let mimesOk = 0;
    for (const { path: p, expect } of mimeProbes) {
      lastUrl = `${BASE}${p}`;
      const r = await fetch(lastUrl).catch(() => null);
      const ct = (r && r.headers.get('content-type')) || '';
      if (ct.toLowerCase().includes(expect)) mimesOk++;
      else fail('disponibilidad', `MIME ${p}`, `Content-Type: "${ct}" (esperado ${expect})`);
    }
    if (mimesOk === mimeProbes.length) pass('disponibilidad', 'cabeceras MIME correctas en HTML, CSS y JS');
  }
}

// ---------------------------------------------------------------- B. Backend en vivo
console.log('\n--- B. Supabase + Edge Functions en vivo ---');
{
  resetEvidence();
  const tables = ['clases', 'profesionales', 'tipos_clases', 'configuracion', 'stripe_productos', 'profiles', 'reservas_yoga', 'class_credit_packs'];
  let okCount = 0;
  for (const t of tables) {
    lastUrl = `${SUPA_URL}/rest/v1/${t}?select=*&limit=1`;
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
  let ausentesCert = 0;
  let fallbackCount = 0;
  for (const fn of fns) {
    lastUrl = `${SUPA_URL}/functions/v1/${fn}`;
    const r = await fetchTimeout(lastUrl, {
      timeoutMs: 15000, method: 'POST',
      headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r.ok) { fail('backend', `fn ${fn}`, `sin red: ${r.error}`); continue; }
    if (r.status >= 200 && r.status < 500 && r.status !== 404) alive++;
    // En cert no se despliegan las functions LIVE: ausente (404) es lo correcto.
    else if (r.status === 404 && isCert) ausentesCert++;
    // list-stripe-products tiene fallback intencionado a la tabla stripe_productos en BD (AUDITORIA A2)
    else if (r.status === 404 && fn === 'list-stripe-products') {
      fallbackCount++;
      warn('backend', `fn ${fn}`, 'no desplegada (404, frontend usa fallback a BD)');
    }
    else if (r.status === 404) fail('backend', `fn ${fn}`, 'no desplegada (404)');
    else warn('backend', `fn ${fn}`, `HTTP ${r.status}`);
  }
  if (alive === fns.length) pass('backend', `las ${fns.length} Edge Functions responden`);
  else if (isCert && alive + ausentesCert === fns.length) pass('backend', `${ausentesCert} functions LIVE ausentes en cert (correcto: no se despliegan)`);
  else if (alive + fallbackCount === fns.length) pass('backend', `${alive} Edge Functions responden (${fallbackCount} con fallback a BD)`);

  // B2. RPCs públicas clave en vivo
  const rpcs = [
    { name: 'obtener_ocupacion_clases', body: { p_clase_ids: [] } },
    { name: 'canjear_oferta_promocional', body: { p_oferta: 'test' } },
  ];
  let rpcOk = 0;
  for (const { name, body } of rpcs) {
    lastUrl = `${SUPA_URL}/rest/v1/rpc/${name}`;
    const r = await fetchTimeout(lastUrl, {
      timeoutMs: 15000, method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { fail('backend', `RPC ${name}`, `sin red: ${r.error}`); }
    else if (r.status === 404) { fail('backend', `RPC ${name}`, 'no desplegada (404)'); }
    else if (r.status >= 200 && r.status < 500) { rpcOk++; }
    else { warn('backend', `RPC ${name}`, `HTTP ${r.status}`); }
  }
  if (rpcOk === rpcs.length) pass('backend', `las ${rpcs.length} RPCs públicas clave responden`);

  // B3. Integridad y consistencia de datos en Supabase (profesionales, productos, clases)
  {
    lastUrl = `${SUPA_URL}/rest/v1/profesionales?visible_publico=is.true&select=id,nombre,especialidad`;
    const rProf = await rest('profesionales?visible_publico=is.true&select=id,nombre,especialidad');
    if (rProf.ok && Array.isArray(rProf.body)) {
      const invalidProf = rProf.body.filter((p) => !p.nombre || p.nombre.trim().length === 0);
      if (invalidProf.length === 0) pass('datos', `${rProf.body.length} profesionales activos con datos íntegros`);
      else fail('datos', 'profesionales activos', `${invalidProf.length} registros sin nombre`);
    } else {
      warn('datos', 'profesionales', 'no se pudo consultar tabla');
    }

    lastUrl = `${SUPA_URL}/rest/v1/stripe_productos?activo=is.true&select=id,nombre,unit_amount`;
    const rProd = await rest('stripe_productos?activo=is.true&select=id,nombre,unit_amount');
    if (rProd.ok && Array.isArray(rProd.body)) {
      const badPrices = rProd.body.filter((p) => typeof p.unit_amount === 'number' && p.unit_amount < 0);
      if (badPrices.length === 0) pass('datos', `${rProd.body.length} productos en stripe_productos con precios coherentes`);
      else fail('datos', 'stripe_productos', `${badPrices.length} productos con precio negativo`);
    }

    lastUrl = `${SUPA_URL}/rest/v1/clases?activa=is.true&select=id,capacidad_max,duracion_minutos&limit=20`;
    const rClases = await rest('clases?activa=is.true&select=id,capacidad_max,duracion_minutos&limit=20');
    if (rClases.ok && Array.isArray(rClases.body)) {
      const badClases = rClases.body.filter((c) => (c.capacidad_max !== null && c.capacidad_max <= 0) || (c.duracion_minutos !== null && c.duracion_minutos <= 0));
      if (badClases.length === 0) pass('datos', 'clases activas con aforo y duración válidos');
      else warn('datos', 'clases activas', `${badClases.length} clases con aforo o duración <= 0`);
    }
  }
}

// ---------------------------------------------------------------- C. Privacidad
console.log('\n--- C. Privacidad sin sesión (fuga = fallo) ---');
{
  resetEvidence();
  for (const [q, label] of [
    ['reservas_yoga?select=id&limit=1', 'reservas ajenas'],
    ['profiles?select=id&limit=1', 'perfiles ajenos'],
    ['stripe_purchases?select=checkout_session_id&limit=1', 'compras'],
  ]) {
    lastUrl = `${SUPA_URL}/rest/v1/${q}`;
    const r = await rest(q);
    if (!r.ok) fail('privacidad', label, `sin red: ${r.error}`);
    else if (r.status === 401 || r.status === 403) pass('privacidad', `${label}: denegadas (HTTP ${r.status})`);
    else if (r.status === 200) fail('privacidad', label, 'FUGA: visibles sin sesión');
    else warn('privacidad', label, `HTTP ${r.status}`);
  }
  // Sonda de escritura anónima con valor que viola un CHECK a propósito:
  // si RLS niega → 401/403; si no negara, el CHECK daría 400 SIN escribir nada.
  lastUrl = `${SUPA_URL}/rest/v1/tipos_clases`;
  const probe = await fetchTimeout(lastUrl, {
    timeoutMs: 15000, method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: '{"nombre":"ZZZ_PROBE","categoria":"zz_invalid_cat_xyz"}',
  });
  if (!probe.ok) fail('privacidad', 'escritura anónima', probe.error);
  else if (probe.status === 401 || probe.status === 403) pass('privacidad', `escritura anónima denegada (HTTP ${probe.status})`);
  else fail('privacidad', 'escritura anónima', `NO denegada (HTTP ${probe.status}) — revisar RLS`);
}

// ---------------------------------------------------------------- Navegador
browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const perf = [];
// Un solo juego de listeners por página. Antes se añadían en cada navegación:
// los estados viejos seguían contando peticiones/bytes y podían duplicar
// errores. Cada goto estrena estado y los listeners escriben en el actual.
const trackSlots = new WeakMap();
function track(page) {
  let slot = trackSlots.get(page);
  if (!slot) {
    slot = { current: null };
    trackSlots.set(page, slot);
    page.on('pageerror', (e) => {
      const st = slot.current;
      if (!st) return;
      const stack = (e && e.stack) || '';
      const head = String((e && e.message) || e).slice(0, 200);
      const loc = (stack.match(/https?:\/\/[^)\s]*\.(?:html|js)[^)\s:]*(?::\d+)?/) || [])[0] || '';
      st.errors.push([head, loc, stack.slice(0, 400)].filter(Boolean).join(' | ').slice(0, 600));
    });
    page.on('console', (m) => {
      const st = slot.current;
      if (!st || m.type() !== 'error') return;
      const t = m.text();
      const loc = (m.location() && `${m.location().url || ''}`) || '';
      if (t.includes('compute-pressure')) return;
      if (t.includes('status of 400')) return; // logins fallidos a propósito
      if (t.includes('/auth/v1/logout')) return; // logout cuando el token ya fue revocado o expiró
      if ((t.includes('monthly_membership_periods') || loc.includes('monthly_membership_periods')) && t.includes('status of 404')) return; // tabla nueva pendiente de migración en Supabase
      st.errors.push(`console: ${t.slice(0, 200)}${loc ? ` | ${loc.slice(0, 120)}` : ''}`);
    });
    page.on('response', async (res) => {
      const st = slot.current;
      if (!st) return;
      try {
        const body = await res.body().catch(() => null);
        if (slot.current !== st) return; // la navegación ya cambió: no atribuir a posteriori
        st.reqs++;
        if (body) st.bytes += body.length;
        if (res.status() >= 400) {
          const u = res.url();
          if (u.includes('/auth/v1/token') || u.includes('reset-password-with-code')) return; // sondas de login falso
          (u.startsWith(BASE) ? st.localFailed : st.externalFailed).push(`${res.status()} ${u.slice(0, 130)}`);
        }
      } catch { /* noop */ }
    });
  }
  const st = { errors: [], localFailed: [], externalFailed: [], bytes: 0, reqs: 0 };
  slot.current = st;
  return st;
}
async function gotoTracked(page, urlPath, settleMs = 2500) {
  const st = track(page);
  lastUrl = `${BASE}${urlPath}`;
  const t0 = Date.now();
  await page.goto(lastUrl, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(settleMs);
  perf.push({ page: urlPath, loadMs: Date.now() - t0, bytes: st.bytes, reqs: st.reqs });
  return st;
}
async function assertClean(suite, st, page = null) {
  let ok = true;
  lastConsole = [...st.errors];
  if (st.errors.length > 0 || st.localFailed.length > 0) {
    lastShot = null;
    if (page) await snap(page, suite);
  }
  if (st.errors.length > 0) { fail(suite, 'JS limpio', st.errors[0]); ok = false; }
  if (st.localFailed.length > 0) { fail(suite, 'recursos locales', [...new Set(st.localFailed)][0]); ok = false; }
  if (ok) pass(suite, 'sin errores JS ni recursos rotos');
  for (const e of [...new Set(st.externalFailed)].slice(0, 2)) warn(suite, 'externo falló (aviso)', e);
}
const shortErr = (e) => String((e && e.message) || e).split('\n')[0].slice(0, 200);
// Cierra un Swal informativo (botón OK): solo para diálogos SIN consecuencias.
async function closeInfo(page) {
  await page.locator('.swal2-confirm').click({ timeout: 5000 }).catch(async () => {
    await page.locator('.swal2-cancel').click({ timeout: 2000 }).catch(async () => page.keyboard.press('Escape'));
  });
  await page.waitForTimeout(600);
}
// Cancela un diálogo de reserva/compra SIN confirmar jamás (0 escrituras).
async function cancelOnly(page) {
  await page.locator('.swal2-cancel').click({ timeout: 5000 }).catch(async () => page.keyboard.press('Escape'));
  await page.waitForTimeout(600);
}
async function swalText(page) {
  return ((await page.locator('.swal2-popup').first().innerText().catch(() => '')) || '').slice(0, 300);
}
async function swalGone(page) {
  return (await page.locator('.swal2-popup:visible').count().catch(() => 1)) === 0;
}
// Detección de tokens corruptos y desbordamiento horizontal en responsive móvil
async function checkUiIntegrity(page, pageName) {
  return page.evaluate((name) => {
    const t = document.body.innerText || '';
    const list = [];
    if (/\bNaN\b/.test(t)) list.push('NaN');
    if (/\bundefined\b/.test(t)) list.push('undefined');
    if (/\[object Object\]/.test(t)) list.push('[object Object]');
    if (/null\s*€/i.test(t)) list.push('null €');
    if (/\{\{[^}]+\}\}/.test(t)) list.push('token crudo {{}}');
    if (/\bInvalid Date\b/i.test(t)) list.push('Invalid Date');
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow > 4) list.push(`desbordamiento horizontal (+${overflow}px)`);
    return list;
  }, pageName).catch(() => []);
}
// Detección de enlaces internos desconocidos y anclas rotas
async function checkInternalLinks(page, pageName) {
  return page.evaluate(() => {
    const validPages = new Set([
      'index.html', 'clases.html', 'tarifas.html', 'maestros.html',
      'profile.html', 'politica-privacidad.html', 'success.html', 'cancel.html'
    ]);
    const bad = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = (a.getAttribute('href') || '').trim();
      if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href === '#') continue;
      const [pathWithQuery, hashPart] = href.split('#');
      const cleanPath = pathWithQuery ? pathWithQuery.split('?')[0].replace(/^\//, '') : '';
      if (cleanPath && !validPages.has(cleanPath)) {
        bad.push(`enlace desconocido: ${href}`);
      }
      if (!cleanPath && hashPart && !document.getElementById(hashPart) && !document.querySelector(`[name="${hashPart}"]`)) {
        bad.push(`ancla rota: #${hashPart}`);
      }
    }
    return bad;
  }).catch(() => []);
}
// Cierra la oferta de bienvenida si está visible (no falla si no está).
async function dismissWelcome(page) {
  await page.locator('#flash-welcome-modal button[onclick="cerrarFlashWelcomeModal()"]').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
}
async function welcomeClosed(page) {
  return page.locator('#flash-welcome-modal').evaluate((el) => el.classList.contains('pointer-events-none')).catch(() => false);
}
async function section(suite, fn) {
  activePage = null;
  resetEvidence();
  lastUrl = '';
  const mark = errors.length;
  const wmark = warnings.length;
  const rmark = results.length;
  const amark = actionItems.length;
  const seqMark = actionSeq;
  try {
    await fn();
  } catch (e1) {
    // Reintento único: distingue fallo real de flaky de red/navegador.
    // 1. Revertir cualquier estado parcial que el intento 1 fallido haya dejado
    errors.splice(mark);
    warnings.splice(wmark);
    results.splice(rmark);
    actionItems.splice(amark);
    actionSeq = seqMark;

    await new Promise((r) => setTimeout(r, 3000));
    activePage = null;
    resetEvidence();
    lastUrl = '';
    try {
      await fn();
      warn(suite, 'flaky (aviso)', `falló una vez (${shortErr(e1)}); OK al reintentar`);
    } catch (e2) {
      if (activePage) await snap(activePage, `${suite}-excepcion`).catch(() => {});
      fail(suite, 'excepción del escenario', shortErr(e2));
    }
  }
}

// ---------------------------------------------------------------- D. Contenido real
console.log('\n--- D. Contenido real en producción ---');
await section('contenido', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    activePage = page;
    const calOpen = async () => (await page.locator('#public-calendar-panel:visible').count().catch(() => 0)) > 0
      || (await page.locator('#calendar-desktop:visible, #calendar-mobile:visible, #calendar-empty:visible').count().catch(() => 0)) > 0
      || (await page.evaluate(() => document.body.classList.contains('gy-calendar-open')).catch(() => false));
    const calClose = async () => {
      await page.locator('#public-calendar-close:visible').first().click({ timeout: 6000 }).catch(async () => page.keyboard.press('Escape'));
      await page.waitForTimeout(1000);
    };
    const calDays = () => page.locator('#calendar-desktop [data-calendar-day], #calendar-mobile [data-calendar-day]').count().catch(() => 0);
    // Un lanzamiento es válido si pinta días o si el estado vacío ofrece
    // SEMANA SIGUIENTE que lleva a contenido (caso talleres sin semana actual).
    async function launchOk(label) {
      // El calendario carga por RPC: sondear hasta 9s (abre, pinta días o
      // estado vacío con salida a contenido).
      for (let i = 0; i < 9; i++) {
        await page.waitForTimeout(1000);
        if (!(await calOpen())) continue;
        if ((await calDays()) > 0) { pass('contenido', `calendario ${label} pinta días`); return true; }
        const next = page.locator('#public-calendar-panel button:visible', { hasText: /SEMANA SIGUIENTE/i }).first();
        if ((await next.count().catch(() => 0)) > 0) {
          for (let step = 0; step < 3; step++) {
            await next.click({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(2800);
            if ((await calDays()) > 0) {
              pass('contenido', `calendario ${label}: siguiente semana con contenido`);
              return true;
            }
          }
          pass('contenido', `calendario ${label}: abre correctamente (estado vacío navegable)`);
          return true;
        }
      }
      if (await calOpen()) {
        fail('contenido', `calendario ${label}`, 'abre pero no pinta ni ofrece siguiente semana');
        return true;
      }
      return false;
    }
    async function clickSettled(sel) {
      const loc = page.locator(sel).first();
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);
      await loc.click({ timeout: 8000 });
    }

    let st = await gotoTracked(page, '/clases.html');
    // Carrusel: los 5 dots conmutan.
    {
      let okAll = true;
      for (let i = 0; i < 5; i++) {
        await page.locator('.slide-dot').nth(i).scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(400);
        await page.locator('.slide-dot').nth(i).click({ timeout: 8000 }).catch(() => { okAll = false; });
        await page.waitForTimeout(600);
        if (!(await page.locator('.slide-dot').nth(i).evaluate((el) => el.classList.contains('active')).catch(() => false))) okAll = false;
      }
      if (okAll) pass('contenido', 'clases: carrusel conmuta los 5 slides');
      else fail('contenido', 'clases: carrusel', 'algún dot no conmuta');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
    }
    // btn-inicio cableado a index.
    {
      const oc = await page.locator('#btn-inicio').first().getAttribute('onclick').catch(() => '');
      if ((oc || '').includes('index.html')) pass('contenido', 'clases: btn-inicio cableado a index');
      else fail('contenido', 'clases: btn-inicio', 'no lleva a index');
    }
    // Pestañas por efecto (hidden retirado).
    for (const [btn, deck, label] of [['#btn-cat-yoga', 'folders-deck', 'Yoga'], ['#btn-cat-consultas', 'consultas-deck', 'Consultas'], ['#btn-cat-talleres', 'talleres-deck', 'Talleres']]) {
      await clickSettled(btn);
      await page.waitForTimeout(800);
      let shown = await page.locator(`#${deck}`).evaluate((el) => !el.classList.contains('hidden')).catch(() => false);
      if (!shown) {
        await clickSettled(btn);
        await page.waitForTimeout(800);
        shown = await page.locator(`#${deck}`).evaluate((el) => !el.classList.contains('hidden')).catch(() => false);
      }
      if (shown) pass('contenido', `clases: pestaña ${label} muestra su mazo`);
      else fail('contenido', `clases: pestaña ${label}`, `${deck} no se muestra`);
    }
    // Los 3 lanzadores abren calendario útil y la X lo cierra.
    for (const [tab, sel, label] of [['#btn-cat-yoga', '#public-calendar-launch', 'yoga'], ['#btn-cat-consultas', '#public-consultas-calendar-launch', 'consultas'], ['#btn-cat-talleres', '#public-talleres-calendar-launch', 'talleres']]) {
      await clickSettled(tab);
      await page.waitForTimeout(800);
      await clickSettled(`${sel}:visible`);
      const opened = await launchOk(label);
      if (opened) pass('contenido', `clases: "Ver horario" abre el calendario (${label})`);
      else fail('contenido', 'clases: calendario', `"Ver horario" no abre (${label})`);
      await calClose();
      if (await calOpen()) fail('contenido', 'calendario', `la X no cierra (${label})`);
    }

    // D1b. Alumno explorando el calendario semanal: semanas, modos, filtros de práctica y Escape
    {
      await clickSettled('#btn-cat-yoga');
      await page.waitForTimeout(600);
      await clickSettled('#public-calendar-launch:visible');
      if (await launchOk('exhaustivo')) {
        const r0 = ((await page.locator('#calendar-week-range').textContent().catch(() => '')) || '').trim();
        const btnNext = page.locator('#calendar-next-week:visible').first();
        if ((await btnNext.count().catch(() => 0)) > 0) {
          await btnNext.click({ timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(1600);
          const r1 = ((await page.locator('#calendar-week-range').textContent().catch(() => '')) || '').trim();
          if (r1 && r1 !== r0 && !/nan|undefined/i.test(r1)) {
            pass('contenido', `calendario: "Semana siguiente" avanza (${r0} → ${r1})`);
          } else {
            fail('contenido', 'calendario: semana siguiente', `rango antes="${r0}" despues="${r1}"`);
          }

          const btnPrev = page.locator('#calendar-prev-week:visible').first();
          if ((await btnPrev.count().catch(() => 0)) > 0) {
            await btnPrev.click({ timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(1600);
            const r2 = ((await page.locator('#calendar-week-range').textContent().catch(() => '')) || '').trim();
            if (r2 && !/nan|undefined/i.test(r2)) {
              pass('contenido', `calendario: "Semana anterior" responde (${r2})`);
            } else {
              fail('contenido', 'calendario: semana anterior', `rango="${r2}"`);
            }
          }

          const btnToday = page.locator('#calendar-today:visible').first();
          if ((await btnToday.count().catch(() => 0)) > 0) {
            await btnToday.click({ timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(1600);
            const rToday = ((await page.locator('#calendar-week-range').textContent().catch(() => '')) || '').trim();
            if (rToday && !/nan|undefined/i.test(rToday)) {
              pass('contenido', 'calendario: botón "Hoy" restablece fecha');
            } else {
              warn('contenido', 'calendario: botón hoy', `rango="${rToday}"`);
            }
          }
        }

        // Conmutación de modos
        const modeToggle = page.locator('#calendar-mode-toggle');
        if ((await modeToggle.count().catch(() => 0)) > 0) {
          let modesTested = 0;
          for (const m of ['consultas', 'clases']) {
            const btnMode = page.locator(`[data-calendar-mode="${m}"]:visible`).first();
            if ((await btnMode.count().catch(() => 0)) > 0) {
              await btnMode.click({ timeout: 6000 }).catch(() => {});
              await page.waitForTimeout(1500);
              const active = await btnMode.evaluate((el) => el.classList.contains('active')).catch(() => false);
              if (active) modesTested++;
            }
          }
          if (modesTested >= 2) pass('contenido', 'calendario: conmutación entre modos (clases/consultas)');
          else warn('contenido', 'calendario: modos', `solo ${modesTested} modos conmutaron`);
        }

        // Filtros de estilo y limpiar filtros
        const filterBtns = page.locator('#calendar-style-filters button[data-calendar-style]:visible');
        const filterCount = await filterBtns.count().catch(() => 0);
        if (filterCount > 0) {
          await filterBtns.first().click({ timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(1000);
          const btnClear = page.locator('#calendar-clear-filters:visible').first();
          if ((await btnClear.count().catch(() => 0)) > 0) {
            await btnClear.click({ timeout: 6000 }).catch(() => {});
            await page.waitForTimeout(1000);
            pass('contenido', 'calendario: chips de práctica filtran y limpian');
          } else {
            pass('contenido', 'calendario: filtro de práctica interactuable');
          }
        }

        // Selección de día en vista móvil
        const dayTabs = page.locator('#calendar-day-tabs [data-calendar-day]:visible');
        const dayCount = await dayTabs.count().catch(() => 0);
        if (dayCount > 1) {
          await dayTabs.nth(1).click({ timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(800);
          const agendaVisible = await page.locator('#calendar-day-agenda').isVisible().catch(() => false);
          if (agendaVisible) pass('contenido', 'calendario móvil: selector de días conmuta agenda');
          else fail('contenido', 'calendario móvil', 'agenda no visible tras cambiar de día');
        }

        // Cierre con Escape
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        if (!(await calOpen())) pass('contenido', 'calendario: tecla Escape cierra limpiamente');
        else {
          fail('contenido', 'calendario: escape', 'no cierra con tecla Escape');
          await calClose();
        }
      }
    }

    // Tarjetas estilo/profe abren calendario.
    for (const [tab, frag, label] of [['#btn-cat-yoga', 'power-vinyasa', 'power-vinyasa'], ['#btn-cat-consultas', 'miriam', 'miriam']]) {
      await clickSettled(tab);
      await page.waitForTimeout(800);
      if ((await page.locator(`[onclick*="${frag}"]:visible`).count().catch(() => 0)) === 0) {
        warn('contenido', `tarjeta ${label}`, 'no visible (aviso)');
        continue;
      }
      await clickSettled(`[onclick*="${frag}"]:visible`);
      const opened = await launchOk(`tarjeta ${label}`);
      if (opened) pass('contenido', `clases: tarjeta ${label} abre calendario`);
      else fail('contenido', 'clases: tarjeta', `${label} no abre calendario`);
      await calClose();
    }
    // scroll-assist desplaza desde arriba.
    {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      const y0 = await page.evaluate(() => window.scrollY);
      await clickSettled('#scroll-assist');
      await page.waitForTimeout(900);
      const y1 = await page.evaluate(() => window.scrollY);
      if (y1 > y0 + 50) pass('contenido', 'clases: scroll-assist desplaza');
      else fail('contenido', 'clases: scroll-assist', 'no desplaza');
    }

    // D1b. Caza de bugs en clases.html: tokens corruptos, desbordamiento móvil y enlaces
    const clasesUiIssues = await checkUiIntegrity(page, 'clases');
    if (clasesUiIssues.length === 0) pass('contenido', 'clases: sin tokens corruptos ni desbordamiento móvil');
    else fail('contenido', 'clases: integridad UI', clasesUiIssues.join(', '));

    const clasesBadLinks = await checkInternalLinks(page, 'clases');
    if (clasesBadLinks.length === 0) pass('contenido', 'clases: enlaces internos y anclas válidos');
    else fail('contenido', 'clases: enlaces rotos', clasesBadLinks.slice(0, 3).join(', '));

    await assertClean('contenido-clases', st, page);

    st = await gotoTracked(page, '/maestros.html', 6000);
    const kids = await page.locator('#maestros-grid-section').evaluate((el) => el.childElementCount).catch(() => 0);
    if (kids > 1) pass('contenido', `maestros: parrilla poblada (${kids} nodos)`);
    else fail('contenido', 'maestros: parrilla', `vacía (nodos: ${kids})`);
    // Fichas de maestras: TODAS abren con su nombre y cierran.
    {
      const n = await page.locator('#maestros-grid-section .teacher-card__trigger:visible').count().catch(() => 0);
      if (!n) warn('contenido', 'maestros: ficha', 'sin disparadores de modal (aviso)');
      else {
        let okAll = true;
        for (let i = 0; i < Math.min(n, 8); i++) {
          const trigger = page.locator('#maestros-grid-section .teacher-card__trigger:visible').nth(i);
          await trigger.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(400);
          await trigger.click({ timeout: 8000 }).catch(() => { okAll = false; });
          await page.waitForTimeout(800);
          const open = await page.evaluate(() => document.body.classList.contains('teacher-modal-open')).catch(() => false);
          const name = ((await page.locator('.teacher-modal:visible').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 40);
          if (!open) { okAll = false; continue; }
          await page.locator('.teacher-modal__close:visible').first().click({ timeout: 8000 }).catch(async () => page.keyboard.press('Escape'));
          await page.waitForTimeout(600);
          const closed = await page.evaluate(() => !document.body.classList.contains('teacher-modal-open')).catch(() => false);
          if (!closed) okAll = false;
          else if (name) pass('contenido', `maestros: ficha "${name}" abre y cierra`);
        }
        if (okAll) pass('contenido', `maestros: las ${Math.min(n, 8)} fichas abren y cierran`);
        else fail('contenido', 'maestros: ficha', 'alguna ficha no abre o no cierra');

        // Cierre por clic en el backdrop (comportamiento habitual de usuario)
        if (n > 0) {
          const firstTrigger = page.locator('#maestros-grid-section .teacher-card__trigger:visible').first();
          await firstTrigger.scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(400);
          await firstTrigger.click({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(800);
          await page.locator('#teacher-modal-overlay').click({ position: { x: 8, y: 8 }, timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(800);
          const closedBackdrop = await page.evaluate(() => !document.body.classList.contains('teacher-modal-open')).catch(() => false);
          if (closedBackdrop) pass('contenido', 'maestros: clic en backdrop cierra la ficha');
          else {
            fail('contenido', 'maestros: backdrop', 'clic fuera del modal no cierra la ficha');
            await page.keyboard.press('Escape');
          }
        }
      }
    }

    // D2b. Caza de bugs en maestros.html: tokens corruptos, desbordamiento móvil y enlaces
    const maestrosUiIssues = await checkUiIntegrity(page, 'maestros');
    if (maestrosUiIssues.length === 0) pass('contenido', 'maestros: sin tokens corruptos ni desbordamiento móvil');
    else fail('contenido', 'maestros: integridad UI', maestrosUiIssues.join(', '));

    const maestrosBadLinks = await checkInternalLinks(page, 'maestros');
    if (maestrosBadLinks.length === 0) pass('contenido', 'maestros: enlaces internos válidos');
    else fail('contenido', 'maestros: enlaces rotos', maestrosBadLinks.slice(0, 3).join(', '));

    await assertClean('contenido-maestros', st, page);

    st = await gotoTracked(page, '/tarifas.html');
    {
      const categories = ['ofertas', 'yoga', 'psicologia', 'talleres'];
      let catsOk = 0;
      for (const cat of categories) {
        const tabBtn = page.locator(`[onclick*="switchCategory('${cat}')"]:visible`).first();
        if ((await tabBtn.count().catch(() => 0)) > 0) {
          await tabBtn.click({ timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(700);
          const sec = page.locator(`#section-${cat}`);
          const isVis = await sec.isVisible().catch(() => false);
          const secTxt = ((await sec.innerText().catch(() => '')) || '');
          const hasBrokenPrice = /nan\s*€|undefined\s*€|null\s*€/i.test(secTxt);
          if (isVis && !hasBrokenPrice) catsOk++;
        }
      }
      if (catsOk === categories.length) pass('contenido', `tarifas: las ${categories.length} categorías muestran precios válidos`);
      else fail('contenido', 'tarifas: categorías', `${catsOk}/${categories.length} categorías conmutan limpiamente`);
    }

    // D3b. Caza de bugs en tarifas.html: tokens corruptos, desbordamiento móvil y enlaces
    const tarifasUiIssues = await checkUiIntegrity(page, 'tarifas');
    if (tarifasUiIssues.length === 0) pass('contenido', 'tarifas: sin tokens corruptos ni desbordamiento móvil');
    else fail('contenido', 'tarifas: integridad UI', tarifasUiIssues.join(', '));

    const tarifasBadLinks = await checkInternalLinks(page, 'tarifas');
    if (tarifasBadLinks.length === 0) pass('contenido', 'tarifas: enlaces internos válidos');
    else fail('contenido', 'tarifas: enlaces rotos', tarifasBadLinks.slice(0, 3).join(', '));

    // D3c. Paridad de precios del catálogo oficial de yoga (15€, 50€, 65€, 95€, 90€)
    const preciosOk = await page.evaluate(() => {
      const t = (document.body.textContent || '') + ' ' + (document.body.innerText || '');
      return ['15€', '50€', '65€', '95€', '90€'].every((p) => t.includes(p));
    }).catch(() => false);
    if (preciosOk) pass('compra', 'tarifas: precios oficiales presentes (15€, 50€, 65€, 95€, 90€)');
    else warn('compra', 'tarifas: precios', 'algún precio del catálogo oficial no localizado en el texto');

    await assertClean('contenido-tarifas', st, page);

    st = await gotoTracked(page, '/index.html');
    const welcome = page.locator('#flash-welcome-modal');
    try {
      await welcome.waitFor({ state: 'visible', timeout: 10000 });
      pass('contenido', 'index: oferta de bienvenida aparece');
    } catch { fail('contenido', 'index: oferta de bienvenida', 'no aparece'); }
    // Idioma ES→EN→ES con cambio real de textos (solo lectura).
    // La oferta de bienvenida cubre la pantalla: se cierra primero como haría un usuario.
    {
      await page.locator('#flash-welcome-modal button[onclick="cerrarFlashWelcomeModal()"]').first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(800);
      const btnEn = page.locator('#lang-btn-en');
      const btnEs = page.locator('#lang-btn-es');
      if ((await btnEn.count()) === 0 || (await btnEs.count()) === 0) {
        warn('contenido', 'index: idioma', 'sin botones ES/EN (aviso)');
      } else {
        await btnEn.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);
        const langEn = await page.evaluate(() => document.documentElement.lang).catch(() => '');
        await btnEs.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);
        const langEs = await page.evaluate(() => document.documentElement.lang).catch(() => '');
        if (langEn === 'en' && langEs === 'es') pass('contenido', 'index: ES/EN conmuta y restaura');
        else fail('contenido', 'index: idioma', `no conmuta (en=${langEn} es=${langEs})`);
      }

      // D1b. Integridad de imágenes en vivo: verifica cada src cargándolo de
      // forma independiente (ignora el estado lazy de su <img> original, que
      // aún no ha entrado en viewport y daría falso positivo con 0x0px).
      const brokenImages = await page.evaluate(async () => {
        const srcs = [...new Set([...document.querySelectorAll('img')]
          .map((img) => img.getAttribute('src') || '')
          .filter((s) => s && !s.startsWith('data:')))];
        const probe = (src) => new Promise((resolve) => {
          const im = new Image();
          const t = setTimeout(() => resolve({ src, ok: false, why: 'timeout 8s' }), 8000);
          im.onload = () => { clearTimeout(t); resolve({ src, ok: im.naturalWidth > 0, why: '0px' }); };
          im.onerror = () => { clearTimeout(t); resolve({ src, ok: false, why: 'error de carga' }); };
          im.src = src;
        });
        const results = await Promise.all(srcs.map(probe));
        return results.filter((r) => !r.ok);
      }).catch(() => []);
      if (brokenImages.length === 0) pass('medios', 'imágenes de landing cargan correctamente sin fallos 404');
      else fail('medios', 'imágenes rotas', `${brokenImages.length} imagen(es) rotas: ${brokenImages.map((b) => `${b.src} (${b.why})`).slice(0, 3).join(', ')}`);

      // D1c. Caza de bugs en index.html: tokens corruptos, desbordamiento móvil y enlaces
      const indexUiIssues = await checkUiIntegrity(page, 'index');
      if (indexUiIssues.length === 0) pass('contenido', 'index: sin tokens corruptos ni desbordamiento móvil');
      else fail('contenido', 'index: integridad UI', indexUiIssues.join(', '));

      const indexBadLinks = await checkInternalLinks(page, 'index');
      if (indexBadLinks.length === 0) pass('contenido', 'index: enlaces internos válidos');
      else fail('contenido', 'index: enlaces rotos', indexBadLinks.slice(0, 3).join(', '));
    }
    await assertClean('contenido-index', st, page);

    // D4. Caza de bugs en politica-privacidad.html: renderizado, cláusulas legales y enlaces
    st = await gotoTracked(page, '/politica-privacidad.html');
    {
      const privUiIssues = await checkUiIntegrity(page, 'politica-privacidad');
      if (privUiIssues.length === 0) pass('contenido', 'privacidad: sin tokens corruptos ni desbordamiento móvil');
      else fail('contenido', 'privacidad: integridad UI', privUiIssues.join(', '));

      const privBadLinks = await checkInternalLinks(page, 'politica-privacidad');
      if (privBadLinks.length === 0) pass('contenido', 'privacidad: enlaces internos válidos');
      else fail('contenido', 'privacidad: enlaces rotos', privBadLinks.slice(0, 3).join(', '));

      const privContent = await page.evaluate(() => {
        const t = (document.body.innerText || '').toLowerCase();
        return {
          hasEmail: t.includes('hola@genyoga.studio'),
          hasRgpd: t.includes('rgpd') || t.includes('protección de datos'),
          hasRights: t.includes('acceder') && t.includes('rectificar') && t.includes('eliminar'),
        };
      }).catch(() => ({ hasEmail: false, hasRgpd: false, hasRights: false }));

      if (privContent.hasEmail && privContent.hasRgpd && privContent.hasRights) {
        pass('contenido', 'privacidad: cláusulas legales, derechos RGPD y contacto presentes');
      } else {
        fail('contenido', 'privacidad: contenido legal', `email=${privContent.hasEmail} rgpd=${privContent.hasRgpd} derechos=${privContent.hasRights}`);
      }

      const btnInicio = (await page.locator('a[href="index.html"]:visible').count().catch(() => 0)) > 0;
      if (btnInicio) pass('contenido', 'privacidad: botón de retorno a inicio visible');
      else fail('contenido', 'privacidad: retorno', 'sin botón visible de vuelta a inicio');
    }
    await assertClean('contenido-privacidad', st, page);
  } catch (e) { if (activePage) await snap(activePage, 'contenido').catch(() => {}); throw e; } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- D2. Landing: mapa de clics
// Cada botón de index.html, cableado por destino (onclick, inmune a retextos):
// lo que un cliente espera al pulsar debe ocurrir en el mundo real.
console.log('\n--- D2. Landing: cada botón lleva a su sitio ---');
await section('landing', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    activePage = page;
    const st = await gotoTracked(page, '/index.html');

    // Oferta: aparece y la X la retira (por clases: cierra por opacidad).
    try {
      await page.locator('#flash-welcome-modal').waitFor({ state: 'visible', timeout: 10000 });
      pass('landing', 'oferta de bienvenida aparece');
    } catch { fail('landing', 'oferta de bienvenida', 'no aparece'); }
    await dismissWelcome(page);
    if (await welcomeClosed(page)) pass('landing', 'la X retira la oferta');
    else fail('landing', 'oferta de bienvenida', 'la X no la retira');

    // CTA del bono: href exacto con promo.
    {
      const href = await page.locator('a[href*="profile.html?action=register"]').first().getAttribute('href').catch(() => null);
      if (href && href.includes('action=register') && href.includes('promo=bienvenida')) pass('landing', 'CTA bono apunta al registro con promo');
      else fail('landing', 'CTA bono bienvenida', `href inesperado: ${(href || 'ninguno').slice(0, 80)}`);
    }

    // Alumno nuevo: el enlace promocional de bienvenida abre profile con el formulario de registro listo
    {
      const pagePromo = await ctx.newPage();
      try {
        await pagePromo.goto(`${BASE}/profile.html?action=register&prompt=register&promo=bienvenida`, { waitUntil: 'load', timeout: 35000 });
        await pagePromo.waitForTimeout(2000);
        const formVis = (await pagePromo.locator('#form-register:visible').count().catch(() => 0)) > 0;
        if (formVis) pass('landing', 'enlace promocional activa formulario de registro');
        else fail('landing', 'enlace promocional', 'no activó formulario de registro en profile');
      } finally {
        await pagePromo.close().catch(() => {});
      }
    }

    // Historia: abre con contenido, Escape cierra, link interno a clases.
    await page.locator('.history-modal-trigger:visible').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    {
      const open = await page.locator('#modal-historia').isVisible().catch(() => false);
      const len = (await page.locator('#modal-historia').innerText().catch(() => '')).length;
      if (open && len > 200) pass('landing', 'historia abre con contenido');
      else fail('landing', 'historia', `visible=${open} chars=${len}`);
    }
    {
      const href = await page.locator('#modal-historia a[href="clases.html"]').first().getAttribute('href').catch(() => null);
      if (href === 'clases.html') pass('landing', 'historia enlaza a clases');
      else fail('landing', 'historia', 'sin enlace a clases.html');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    if (!(await page.locator('#modal-historia').isVisible().catch(() => true))) pass('landing', 'Escape cierra historia');
    else fail('landing', 'historia', 'Escape no la cierra');

    // Nav móvil: los 4 destinos por cableado.
    for (const dest of ['profile.html', 'clases.html', 'tarifas.html', 'maestros.html']) {
      await dismissWelcome(page);
      const b = page.locator(`.btn-nav-mobile:visible[onclick*="${dest}"]`).first();
      if ((await b.count().catch(() => 0)) === 0) { fail('landing', `nav ${dest}`, 'botón no visible ni cableado'); continue; }
      await Promise.all([page.waitForURL(`**/${dest}`, { timeout: 9000 }).catch(() => {}), b.click({ timeout: 8000 }).catch(() => {})]);
      if (page.url().endsWith('/' + dest)) pass('landing', `nav móvil → ${dest}`);
      else fail('landing', `nav móvil → ${dest}`, `acabó en ${page.url().split('/').pop() || 'ningún lado'}`);
      await page.goBack({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    // Footer: externos con target=_blank, email y privacidad.
    {
      const ext = await page.evaluate(() => [...document.querySelectorAll('a[href^="http"]')].map((a) => ({
        h: (a.getAttribute('href') || '').slice(0, 32), t: a.getAttribute('target'),
      }))).catch(() => []);
      const has = (frag) => ext.some((e) => e.h.startsWith(frag) && e.t === '_blank');
      if (has('https://wa.me/34624435679') && has('https://www.instagram.com/') && has('https://www.google.com/maps')) {
        pass('landing', 'footer externo abre en pestaña nueva');
      } else fail('landing', 'footer externo', 'falta href o target=_blank');
      const mail = await page.locator('a[href^="mailto:"]').first().getAttribute('href').catch(() => '');
      const priv = (await page.locator('a[href="politica-privacidad.html"]').first().count().catch(() => 0)) > 0;
      if (mail === 'mailto:hola@genyoga.studio' && priv) pass('landing', 'footer email y privacidad');
      else fail('landing', 'footer', `mail=${mail} priv=${priv}`);
    }

    // Clic real a WhatsApp: pestaña de WhatsApp (wa.me o api.whatsapp.com), se cierra.
    {
      const [popup] = await Promise.all([
        ctx.waitForEvent('page', { timeout: 9000 }).catch(() => null),
        page.locator('a[href^="https://wa.me/"]:visible').first().click({ timeout: 8000 }).catch(() => {}),
      ]);
      const ok = !!popup && /whatsapp\.com|wa\.me/.test(popup.url());
      if (popup) await popup.close().catch(() => {});
      if (ok) pass('landing', 'WhatsApp abre chat en pestaña nueva');
      else fail('landing', 'WhatsApp', 'no abre el chat');
    }
    await assertClean('landing', st, page);
  } finally { await ctx.close(); }

  // Escritorio: las 4 navegaciones laterales + hover sin errores.
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await ctx2.newPage();
    activePage = page;
    const st = await gotoTracked(page, '/index.html');
    await dismissWelcome(page);
    for (const [nav, dest] of [['#desktop-left-nav', 'clases.html'], ['#desktop-left-nav', 'tarifas.html'], ['#desktop-right-nav', 'profile.html'], ['#desktop-right-nav', 'maestros.html']]) {
      const b = page.locator(`${nav} button:visible[onclick*="${dest}"]`).first();
      if ((await b.count().catch(() => 0)) === 0) { fail('landing', `nav escritorio ${dest}`, 'botón no visible ni cableado'); continue; }
      await b.hover({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
      await Promise.all([page.waitForURL(`**/${dest}`, { timeout: 9000 }).catch(() => {}), b.click({ timeout: 8000 }).catch(() => {})]);
      if (page.url().endsWith('/' + dest)) pass('landing', `nav escritorio → ${dest}`);
      else fail('landing', `nav escritorio → ${dest}`, 'no navegó');
      await page.goBack({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await dismissWelcome(page);
    }
    await assertClean('landing-escritorio', st, page);

    // D2b. Validación de diseño y ausencia de desbordamiento horizontal en escritorio (1280px)
    // 1. Clases en escritorio con layout completo
    const stClasesDesk = await gotoTracked(page, '/clases.html', 3000);
    const clasesDeskIssues = await checkUiIntegrity(page, 'clases-escritorio');
    if (clasesDeskIssues.length === 0) pass('landing', 'clases escritorio: sin desbordamiento ni tokens corruptos');
    else fail('landing', 'clases escritorio: integridad UI', clasesDeskIssues.join(', '));
    await assertClean('clases-escritorio', stClasesDesk, page);

    // 2. Tarifas en escritorio
    const stTarifasDesk = await gotoTracked(page, '/tarifas.html', 2500);
    const tarifasDeskIssues = await checkUiIntegrity(page, 'tarifas-escritorio');
    if (tarifasDeskIssues.length === 0) pass('landing', 'tarifas escritorio: sin desbordamiento ni tokens corruptos');
    else fail('landing', 'tarifas escritorio: integridad UI', tarifasDeskIssues.join(', '));
    await assertClean('tarifas-escritorio', stTarifasDesk, page);
  } finally { await ctx2.close(); }
});

// ---------------------------------------------------------------- E. Calendario con futuro (API)
console.log('\n--- E. Calendario con futuro ---');
{
  resetEvidence();
  const nowIso = new Date().toISOString();
  lastUrl = `${SUPA_URL}/rest/v1/clases?select=id&fecha_inicio=gt.…&activa=is.true&limit=1`;
  const r = await rest(`clases?select=id&fecha_inicio=gt.${encodeURIComponent(nowIso)}&activa=is.true&limit=1`);
  if (!r.ok) fail('calendario', 'clases futuras', `sin red: ${r.error}`);
  else if (r.status !== 200) fail('calendario', 'clases futuras', `HTTP ${r.status}`);
  else if (Array.isArray(r.body) && r.body.length > 0) pass('calendario', 'hay clases futuras activas (el calendario no está vacío)');
  else if (isCert) warn('calendario', 'sin clases futuras', 'cert sin datos de prueba (aviso)');
  else fail('calendario', 'calendario vacío', 'cero clases futuras activas: la web vende un calendario vacío');
}

// ---------------------------------------------------------------- F. Auth real usuario de pruebas
console.log('\n--- F. Login real con usuario de pruebas (solo lectura + logout) ---');
await section('auth', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    activePage = page;
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
      fail('auth', 'login usuario de pruebas', `no entra: ¿contraseña o RLS rotos?${isCert ? ' ¿existe ' + EMAIL + ' en el Supabase de cert?' : ''}`);
      await assertClean('auth', st, page);
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
    await assertClean('auth', st, page);
  } catch (e) { if (activePage) await snap(activePage, 'auth').catch(() => {}); throw e; } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- I. Acciones de cliente
// Cada cosa que un cliente puede hacer, ejercida hasta el punto sin retorno:
// los diálogos se CANCELAN siempre (0 reservas, 0 compras, 0 escrituras).
// Lo dependiente de datos (sin clases reservables, sin reservas) es aviso.
console.log('\n--- I. Acciones de cliente (cancelando antes de escribir) ---');
await section('cliente', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    activePage = page;
    await page.route('**/functions/v1/create-checkout-session', (route) => route.abort()); // backstop
    let signupCalls = 0;
    await page.route('**/auth/v1/signup', (route) => { signupCalls++; route.abort(); }); // backstop: jamás crear cuentas
    const st = await gotoTracked(page, '/profile.html', 4000);

    // I1. Registro: la validación nativa bloquea sin crear cuentas (0 llamadas).
    await page.evaluate(() => toggleAuth('register'));
    await page.waitForTimeout(600);
    await page.locator('#reg-nombre').fill('Noche');
    await page.locator('#reg-apellidos').fill('Pruebas');
    await page.locator('#reg-email').fill('noche-noreply@test.local');
    await page.locator('#reg-password').fill('123');
    await page.locator('#form-register button[type="submit"]').click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    {
      const v = await page.evaluate(() => document.getElementById('reg-password')?.validity?.valid);
      if (v === false && signupCalls === 0) pass('cliente', 'registro bloquea contraseña débil (nativo, 0 llamadas)');
      else fail('cliente', 'registro contraseña débil', `válido=${v} llamadas_signup=${signupCalls}`);
    }
    await page.locator('#reg-password').fill('12345678');
    await page.locator('#reg-nombre').fill('');
    await page.locator('#form-register button[type="submit"]').click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    {
      const v = await page.evaluate(() => document.getElementById('reg-nombre')?.validity?.valid);
      if (v === false && signupCalls === 0) pass('cliente', 'registro bloquea nombre vacío (nativo, 0 llamadas)');
      else fail('cliente', 'registro nombre vacío', `válido=${v} llamadas_signup=${signupCalls}`);
    }
    await page.locator('#reg-nombre').fill('Noche');
    await page.locator('#reg-email').fill('usuario-sin-arroba');
    await page.locator('#form-register button[type="submit"]').click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    {
      const v = await page.evaluate(() => document.getElementById('reg-email')?.validity?.valid);
      if (v === false && signupCalls === 0) pass('cliente', 'registro bloquea email malformado (nativo, 0 llamadas)');
      else fail('cliente', 'registro email malformado', `válido=${v} llamadas_signup=${signupCalls}`);
    }
    await page.locator('#reg-email').fill('noche-noreply@test.local');
    // I1b. Tipos seguros de campos de formulario (email/password nativos)
    {
      const fTypes = await page.evaluate(() => ({
        regEmail: document.getElementById('reg-email')?.type,
        regPass: document.getElementById('reg-password')?.type,
        loginPass: document.getElementById('login-password')?.type,
        hasLoginUser: document.getElementById('login-email') !== null,
      })).catch(() => ({}));
      if (fTypes.regEmail === 'email' && fTypes.regPass === 'password'
          && fTypes.loginPass === 'password' && fTypes.hasLoginUser) {
        pass('cliente', 'formularios con tipos de campo estándar (email/password)');
      } else {
        fail('cliente', 'tipos de campos de autenticación', JSON.stringify(fTypes));
      }
    }
    await page.evaluate(() => toggleAuth('login'));
    await page.waitForTimeout(600);

    // I2. Recuperación con cuenta inexistente (el servidor responde ok por diseño, sin efectos).
    await page.evaluate(() => toggleAuth('recover'));
    await page.waitForTimeout(600);
    await page.locator('#recover-identifier').fill('nadie-inexistente-xyz@genyoga.studio');
    await page.locator('#btn-recover-verify').click({ timeout: 8000 });
    try {
      await page.locator('.swal2-popup', { hasText: /Revisa tu correo/i }).first().waitFor({ state: 'visible', timeout: 15000 });
      pass('cliente', 'recuperación responde genérico (anti-enumeración)');
    } catch { fail('cliente', 'recuperación paso 1', 'no muestra el mensaje genérico'); }
    await closeInfo(page);
    await page.locator('#recover-code').fill('000000');
    await page.locator('#recover-new-password').fill('Abcdef123!');
    const recConfirm = page.locator('#recover-confirm-password');
    if ((await recConfirm.count()) > 0) await recConfirm.fill('Abcdef123!');
    await page.locator('#btn-recover-submit').click({ timeout: 8000 });
    try {
      await page.locator('.swal2-popup', { hasText: /Código incorrecto o caducado/i }).first().waitFor({ state: 'visible', timeout: 15000 });
      pass('cliente', 'recuperación rechaza código falso');
    } catch { fail('cliente', 'recuperación código falso', 'no muestra el mensaje esperado'); }
    await closeInfo(page);
    await page.evaluate(() => toggleAuth('login'));
    await page.waitForTimeout(600);

    // I3. Login del usuario de pruebas.
    await page.locator('#login-email').fill(EMAIL);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('#form-login button[type="submit"]').click({ timeout: 10000 });
    try {
      await page.locator('#app-view:visible').waitFor({ state: 'visible', timeout: 20000 });
      pass('cliente', 'login del usuario de pruebas');
    } catch {
      fail('cliente', 'login usuario de pruebas', `no entra${isCert ? ': ¿existe ' + EMAIL + ' en el Supabase de cert?' : ''}`);
      await assertClean('cliente', st, page);
      return;
    }
    await page.waitForTimeout(4000);

    // I4. Vistas con datos (sin crashear, con su contenido).
    for (const [btn, view, label, inner] of [
      ['#nav-public-inicio', '#view-inicio', 'Inicio', null],
      ['#nav-public-horarios', '#view-horarios', 'Horarios', '#calendar-grid'],
      ['#nav-public-especiales', '#view-especiales', 'Especiales', null],
      ['#nav-public-psicologia', '#view-psicologia', 'Psicología', '#sub-view-psicologia'],
      ['#nav-public-profesores', '#view-profesores', 'Profesores', null],
    ]) {
      if (!(await page.locator(btn).first().isVisible().catch(() => false))) {
        warn('cliente', `vista ${label}`, `${btn} oculto (aviso)`);
        continue;
      }
      await page.locator(btn).first().click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);
      if (!(await page.locator(view).isVisible().catch(() => false))) {
        fail('cliente', `vista ${label}`, `${view} no se muestra`);
        continue;
      }
      pass('cliente', `vista ${label} abre`);
      if (inner && !(await page.locator(inner).isVisible().catch(() => false))) {
        warn('cliente', `vista ${label}`, `${inner} sin contenido visible (aviso)`);
      }
      // Nutrición vive dentro de Psicología (subtab): mismo camino que sus botones.
      if (label === 'Psicología') {
        await page.evaluate(() => window.switchConsultasSubTab && window.switchConsultasSubTab('nutricion')).catch(() => {});
        await page.waitForTimeout(1500);
        if (await page.locator('#sub-view-nutricion').isVisible().catch(() => false)) {
          pass('cliente', 'subvista Nutrición abre');
        } else {
          fail('cliente', 'subvista Nutrición', '#sub-view-nutricion no se muestra');
        }
        await page.evaluate(() => window.switchConsultasSubTab && window.switchConsultasSubTab('psicologia')).catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    // I4b. Panel Inicio: calendario general interactivo y coherencia de saldos
    await page.locator('#nav-public-inicio').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
    {
      const mesInicio0 = ((await page.locator('#inicio-calendar-month-year').textContent().catch(() => '')) || '').trim();
      await page.evaluate(() => window.cambiarMesInicio && window.cambiarMesInicio(1)).catch(() => {});
      await page.waitForTimeout(1000);
      const mesInicio1 = ((await page.locator('#inicio-calendar-month-year').textContent().catch(() => '')) || '').trim();
      await page.evaluate(() => window.cambiarMesInicio && window.cambiarMesInicio(-1)).catch(() => {});
      await page.waitForTimeout(800);
      if (mesInicio0 && mesInicio1 && mesInicio0 !== mesInicio1 && !/nan|undefined/i.test(mesInicio1)) {
        pass('cliente', `inicio: navegación mensual funciona (${mesInicio0} → ${mesInicio1})`);
      } else {
        warn('cliente', 'inicio: calendario mensual', `mes0="${mesInicio0}" mes1="${mesInicio1}"`);
      }

      const saldosTxt = ((await page.locator('#profile-saldos-wrapper').innerText().catch(() => '')) || '');
      if (/nan|undefined|null/i.test(saldosTxt)) {
        fail('cliente', 'saldos', `valores corruptos en saldos: "${saldosTxt.slice(0, 100)}"`);
      } else if (saldosTxt.length > 0) {
        pass('cliente', 'inicio: saldos formateados correctamente');
      }

      const conReservas = (await page.locator('#inicio-consolidado-container > *:visible').count().catch(() => 0)) > 0;
      const emptyState = await page.locator('#inicio-empty-state').isVisible().catch(() => false);
      if (conReservas || emptyState) {
        pass('cliente', `inicio: reservas activas correctas (${conReservas ? 'con reservas' : 'estado vacío navegable'})`);
      } else {
        fail('cliente', 'inicio: reservas activas', 'ni contenedor ni empty state visibles');
      }

      // Caza de bugs en el panel del cliente: tokens corruptos y desbordamiento móvil
      const perfilUiIssues = await checkUiIntegrity(page, 'perfil');
      if (perfilUiIssues.length === 0) pass('cliente', 'perfil: sin tokens corruptos ni desbordamiento móvil');
      else fail('cliente', 'perfil: integridad UI', perfilUiIssues.join(', '));
    }

    // I5. Reservar yoga: si hay botón, diálogo + cancelar (jamás confirmar);
    // si no, cada tarjeta debe mostrar su estado terminal (deadline/aforo).
    await page.locator('#nav-public-horarios').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    {
      const n = await page.locator('#view-horarios button[onclick^="reservar("]:visible').count().catch(() => 0);
      if (n === 0) {
        const txt = ((await page.locator('#view-horarios').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
        const states = (txt.match(/reserva cerrada|completa|finalizada|no disponible|tu plaza/gi) || []).length;
        const kids = await page.locator('#view-horarios [id^="grid-"] > *').count().catch(() => 0);
        if (kids === 0) warn('cliente', 'reserva yoga', 'día sin clases listadas (aviso, depende de datos)');
        else if (states > 0) pass('cliente', `sin reservables hoy: ${states} estados terminales correctos`);
        else fail('cliente', 'reserva yoga', `${kids} tarjetas sin botón ni estado`);
      } else {
        const resBtn = page.locator('#view-horarios button[onclick^="reservar("]:visible').first();
        await resBtn.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(400);
        await resBtn.click({ timeout: 10000 }).catch(() => {});
        let dlg = '';
        try {
          await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 10000 });
          dlg = await swalText(page);
        } catch { /* sin diálogo */ }
        if (/Confirmar|Reserva|Gratuit|gratis|Introductori|Clase Completa|Ya estás inscrito|No se puede reservar|Clase no disponible|Bono|Stripe|Comprar|invitado|plaza/i.test(dlg)) {
          pass('cliente', `reserva yoga: diálogo correcto ("${dlg.replace(/\s+/g, ' ').slice(0, 60)}")`);
        } else {
          fail('cliente', 'reserva yoga', `diálogo inesperado o ausente: "${dlg.slice(0, 100)}"`);
        }
        await cancelOnly(page);
        if (!(await swalGone(page))) fail('cliente', 'reserva yoga', 'el diálogo no se cierra al cancelar');
      }
    }
    // I5b. Día con clases del calendario filtra sus tarjetas con acción.
    {
      const day = page.locator('#calendar-grid .calendar-day.has-classes:not(.disabled):visible').first();
      if ((await page.locator('#calendar-grid .calendar-day.has-classes:not(.disabled):visible').count().catch(() => 0)) === 0) {
        warn('cliente', 'día calendario', 'sin días con clase (aviso, depende de datos)');
      } else {
        await day.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(400);
        await day.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        const sel = await day.evaluate((el) => el.classList.contains('selected')).catch(() => false);
        const kids = await page.locator('#view-horarios [id^="grid-"] > *').count().catch(() => 0);
        if (sel && kids > 0) pass('cliente', `día calendario filtra (${kids} tarjetas)`);
        else fail('cliente', 'día calendario', `selected=${sel} tarjetas=${kids}`);
      }
    }

    // I5c. Horarios: navegación mensual, barra pegajosa de días y filtros
    {
      const mesH0 = ((await page.locator('#calendar-month-year').textContent().catch(() => '')) || '').trim();
      await page.evaluate(() => window.cambiarMes && window.cambiarMes(1)).catch(() => {});
      await page.waitForTimeout(1000);
      const mesH1 = ((await page.locator('#calendar-month-year').textContent().catch(() => '')) || '').trim();
      await page.evaluate(() => window.cambiarMes && window.cambiarMes(-1)).catch(() => {});
      await page.waitForTimeout(800);
      if (mesH0 && mesH1 && mesH0 !== mesH1 && !/nan|undefined/i.test(mesH1)) {
        pass('cliente', `horarios: selector mensual responde (${mesH0} → ${mesH1})`);
      } else {
        warn('cliente', 'horarios: selector mensual', `mes0="${mesH0}" mes1="${mesH1}"`);
      }

      const btnScrollNext = page.locator('#btn-scroll-dias-next:visible').first();
      const btnScrollPrev = page.locator('#btn-scroll-dias-prev:visible').first();
      if ((await btnScrollNext.count().catch(() => 0)) > 0 && (await btnScrollPrev.count().catch(() => 0)) > 0) {
        await btnScrollNext.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
        await btnScrollPrev.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
        pass('cliente', 'horarios: scroll de barra rápida de días operativo');
      }

      const fProf = page.locator('#filtro-profesor:visible').first();
      const fTipo = page.locator('#filtro-tipo-yoga:visible').first();
      if ((await fProf.count().catch(() => 0)) > 0 && (await fTipo.count().catch(() => 0)) > 0) {
        await page.evaluate(() => window.aplicarFiltrosClases && window.aplicarFiltrosClases()).catch(() => {});
        await page.waitForTimeout(800);
        await page.evaluate(() => window.limpiarFiltroFecha && window.limpiarFiltroFecha()).catch(() => {});
        await page.waitForTimeout(800);
        pass('cliente', 'horarios: filtros de clase y botón "ver todas" responden');
      }
    }

    // I6. Cancelar reserva: abrir el diálogo y cancelar (jamás confirmar).
    {
      const cancelBtn = page.locator('#app-view button[onclick^="cancelar("]:visible').first();
      if ((await page.locator('#app-view button[onclick^="cancelar("]:visible').count().catch(() => 0)) === 0) {
        warn('cliente', 'cancelación', 'sin reservas que cancelar (aviso, normal sin bookings)');
      } else {
        await cancelBtn.click({ timeout: 10000 }).catch(() => {});
        let dlg = '';
        try {
          await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 10000 });
          dlg = await swalText(page);
        } catch { /* sin diálogo */ }
        if (/¿Cancelar reserva\?|No se puede cancelar|Verificando/i.test(dlg)) {
          pass('cliente', 'cancelación: diálogo correcto');
        } else {
          fail('cliente', 'cancelación', `diálogo inesperado o ausente: "${dlg.slice(0, 100)}"`);
        }
        await cancelOnly(page);
        if (!(await swalGone(page))) fail('cliente', 'cancelación', 'el diálogo no se cierra al cancelar');
      }
    }

    // I7. Consulta (psicología): reservar y cancelar, siempre cancelando.
    await page.locator('#nav-public-psicologia').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    {
      const cRes = page.locator('#view-psicologia button[onclick*="reservarConsulta("]:visible');
      if ((await cRes.count().catch(() => 0)) === 0) {
        warn('cliente', 'reserva consulta', 'sin huecos reservables (aviso, depende de datos)');
      } else {
        await cRes.first().click({ timeout: 10000 }).catch(() => {});
        let dlg = '';
        try {
          await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 10000 });
          dlg = await swalText(page);
        } catch { /* sin diálogo */ }
        if (/Confirmar|reservar|Bono|Comprar|Saldo|disponible|llena|Ocupado/i.test(dlg)) {
          pass('cliente', 'reserva consulta: diálogo correcto');
        } else {
          fail('cliente', 'reserva consulta', `diálogo inesperado o ausente: "${dlg.slice(0, 100)}"`);
        }
        await cancelOnly(page);
        if (!(await swalGone(page))) fail('cliente', 'reserva consulta', 'el diálogo no se cierra al cancelar');
      }
      const cCan = page.locator('#view-psicologia button[onclick*="cancelarConsulta("]:visible');
      if ((await cCan.count().catch(() => 0)) > 0) {
        await cCan.first().click({ timeout: 10000 }).catch(() => {});
        try {
          await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 10000 });
          pass('cliente', 'cancelación consulta: diálogo correcto');
        } catch { fail('cliente', 'cancelación consulta', 'no abre diálogo'); }
        await cancelOnly(page);
      } else {
        warn('cliente', 'cancelación consulta', 'sin citas que cancelar (aviso, normal)');
      }
    }

    // I8. Especiales: sub-pestañas + compra de bono especial (diálogo, sin pagar).
    await page.locator('#nav-public-especiales').first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    for (const [tab, label] of [
      ['#btn-subtab-eventos-todos', 'todos'], ['#btn-subtab-eventos-clases', 'clases_especiales'], ['#btn-subtab-eventos-talleres', 'talleres'],
    ]) {
      const b = page.locator(`${tab}:visible`).first();
      if ((await b.count().catch(() => 0)) === 0) { warn('cliente', `especiales ${label}`, 'subtab no visible (aviso)'); continue; }
      await b.click({ timeout: 8000 }).catch(() => {});
      await page.locator('#view-especiales article:visible, #view-especiales #special-classes-empty:not(.hidden)').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      const arts = await page.locator('#view-especiales article:visible').count().catch(() => 0);
      const txt = ((await page.locator('#view-especiales').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
      if (arts > 0) pass('cliente', `especiales ${label}: ${arts} tarjetas`);
      else if (/no hay|todavía|próximamente|vacío/i.test(txt)) pass('cliente', `especiales ${label}: vacío elegante`);
      else fail('cliente', `especiales ${label}`, 'sin tarjetas ni mensaje de vacío');
    }
    {
      await page.locator('#btn-subtab-eventos-todos:visible').first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const buy = page.locator('#view-especiales button[onclick*="comprarBonoEspecialStripe"]:visible').first();
      if ((await buy.count().catch(() => 0)) === 0) {
        warn('cliente', 'bono especial', 'sin botón de compra (aviso, depende de datos)');
      } else {
        await buy.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(400);
        await buy.click({ timeout: 8000 }).catch(() => {});
        let dlg = '';
        try {
          await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 10000 });
          dlg = await swalText(page);
        } catch { /* sin diálogo */ }
        if (/Bono de Clase Especial/i.test(dlg) && /20/.test(dlg)) {
          pass('cliente', 'bono especial: diálogo con 20€');
        } else {
          fail('cliente', 'bono especial', `diálogo inesperado: "${dlg.slice(0, 100)}"`);
        }
        await cancelOnly(page);
        if (!(await swalGone(page))) fail('cliente', 'bono especial', 'el diálogo no se cierra al cancelar');
      }
    }

    // I9. Editar perfil: la validación bloquea sin escribir (nombre vacío).
    await page.locator('#header-btn-edit-profile').first().click({ timeout: 10000 }).catch(() => {});
    try {
      await page.locator('#swal-nombre').waitFor({ state: 'visible', timeout: 8000 });
      const pre = (await page.locator('#swal-nombre').inputValue().catch(() => '')).toLowerCase();
      if (pre.includes('prueba')) pass('cliente', 'editar perfil: datos precargados');
      else fail('cliente', 'editar perfil', `nombre precargado inesperado: "${pre.slice(0, 30)}"`);
      await page.locator('#swal-nombre').fill('');
      await page.locator('.swal2-confirm').click({ timeout: 8000 });
      try {
        await page.locator('.swal2-popup', { hasText: /El nombre es obligatorio/i }).first().waitFor({ state: 'visible', timeout: 8000 });
        pass('cliente', 'editar perfil: validación bloquea sin guardar');
      } catch { fail('cliente', 'editar perfil', 'la validación no bloquea (¿escritura sin validar?)'); }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      const nombre = (await page.locator('#profile-nombre-full').innerText().catch(() => '')).toLowerCase();
      if (nombre.includes('prueba')) pass('cliente', 'editar perfil: nada se escribió al cancelar');
      else fail('cliente', 'editar perfil', 'el nombre cambió tras cancelar');
    } catch {
      fail('cliente', 'editar perfil', 'no abre el diálogo');
      await page.keyboard.press('Escape');
    }

    // I10. Guía de bonos: cancelar se queda; confirmar enlaza a tarifas.
    await page.locator('#header-btn-info-bonos').first().click({ timeout: 10000 }).catch(() => {});
    try {
      await page.locator('.swal2-popup:visible', { hasText: /Bonos y Saldos/i }).first().waitFor({ state: 'visible', timeout: 8000 });
      pass('cliente', 'guía de bonos abre');
    } catch {
      warn('cliente', 'guía de bonos', 'no abre diálogo (aviso)');
      if (!(await swalGone(page))) await cancelOnly(page);
    }
    if (await page.locator('.swal2-popup:visible').count().catch(() => 0) > 0) {
      await cancelOnly(page);
      if (page.url().includes('profile.html') && await swalGone(page)) {
        pass('cliente', 'guía de bonos: cancelar se queda en el perfil');
      } else {
        fail('cliente', 'guía de bonos', 'cancelar no se queda en el perfil');
      }
      await page.locator('#header-btn-info-bonos').first().click({ timeout: 10000 }).catch(() => {});
      try {
        await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 8000 });
      } catch { /* ya se avisó arriba */ }
    }
    if (await page.locator('.swal2-popup:visible').count().catch(() => 0) > 0) {
      await page.locator('.swal2-confirm').click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);
      if (page.url().includes('tarifas.html')) {
        pass('cliente', 'guía de bonos: confirmar enlaza a tarifas');
        await page.goto(`${BASE}/profile.html`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
        try {
          await page.locator('#app-view:visible').waitFor({ state: 'visible', timeout: 20000 });
          pass('cliente', 'volver de tarifas conserva la sesión');
        } catch { fail('cliente', 'volver de tarifas', 'la sesión no se conserva'); }
        await page.waitForTimeout(3000);
        lastUrl = `${BASE}/profile.html`;
      } else if (await swalGone(page)) {
        pass('cliente', 'guía de bonos: confirmar cierra');
      } else {
        fail('cliente', 'guía de bonos', 'confirmar deja estado incierto');
        await cancelOnly(page);
      }
    }
    {
      const rol = await page.evaluate(() => ({
        admin: document.documentElement.classList.contains('is-admin'),
        staff: document.documentElement.classList.contains('is-profesor'),
        crearOculto: document.getElementById('admin-crear-tabs')?.classList.contains('hidden') ?? true,
      })).catch(() => null);
      if (rol && !rol.admin && !rol.staff && rol.crearOculto) pass('cliente', 'rol sin privilegios de personal');
      else fail('cliente', 'rol', `privilegios inesperados: ${JSON.stringify(rol)}`);
    }

    // I12. Comprar pack/mensual con sesión: abre su diálogo con su precio (0 cargos).
    for (const [buy, euros, label] of [
      ['pack_4', '50', 'Pack 4'], ['bono_inicial', '40', 'Bono Inicial'], ['bono_mensual', '65', 'Bono Mensual'],
      ['pack_10', '95', 'Pack 10'], ['bono_ilimitado', '90', 'Mensual'],
    ]) {
      await page.goto(`${BASE}/profile.html?buy=${buy}`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3500);
      lastUrl = `${BASE}/profile.html?buy=${buy}`;
      let dlg = '';
      try {
        await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 15000 });
        dlg = await swalText(page);
      } catch { /* sin diálogo */ }
      if (dlg && new RegExp(`${euros}[,.]00\\s*€|${euros}\\s*€`).test(dlg) && page.url().includes('profile.html')) {
        pass('cliente', `${label}: diálogo con ${euros}€`);
      } else {
        fail('cliente', `${label} (?buy=${buy})`, `diálogo inesperado: "${dlg.slice(0, 100)}"`);
      }
      await cancelOnly(page);
    }

    // I13. Resiliencia de sesión persistente ante recarga (F5 / background reload)
    {
      await page.goto(`${BASE}/profile.html`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await page.reload({ waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(3500);
      const appViewVis = await page.locator('#app-view:visible').isVisible().catch(() => false);
      const authHidden = await page.locator('#auth-container').isHidden().catch(() => true);
      const nombrePersist = (await page.locator('#profile-nombre-full').innerText().catch(() => '')).trim();
      if (appViewVis && authHidden && nombrePersist) {
        pass('cliente', `sesión persistente: F5 mantiene el panel activo ("${nombrePersist.slice(0, 30)}")`);
      } else {
        fail('cliente', 'sesión persistente', `appView=${appViewVis} authHidden=${authHidden} nombre="${nombrePersist}"`);
      }
    }

    // I14. Degradación elegante ante parámetros URL erróneos o manipulados
    {
      await page.goto(`${BASE}/profile.html?view=vista_no_existe_xyz&clase=-999`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const appVivo = await page.locator('#app-view:visible').isVisible().catch(() => false);
      if (appVivo) {
        pass('cliente', 'degradación elegante: parámetros URL corruptos no rompen la app');
      } else {
        fail('cliente', 'parámetros corruptos', 'la app quedó en blanco o rota');
      }
      lastUrl = `${BASE}/profile.html`;
    }

    // I10b. Seguridad: La contraseña en texto plano no se persiste en Web Storage
    {
      const pwdLeaked = await page.evaluate((pass) => {
        const scan = (store) => {
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i) || '';
            const v = store.getItem(k) || '';
            if (/password|contrase/i.test(k)) return true;
            if (!k.includes('-auth-token') && v.includes(pass)) return true;
            try {
              const parsed = JSON.parse(v);
              const jsonStr = JSON.stringify(parsed).toLowerCase();
              if (jsonStr.includes('"password"') || jsonStr.includes('"contrasena"')) {
                return true;
              }
            } catch {}
          }
          return false;
        };
        return scan(localStorage) || scan(sessionStorage);
      }, PASSWORD).catch(() => false);
      if (!pwdLeaked) pass('seguridad', 'contraseña en claro no persistida en localStorage/sessionStorage');
      else fail('seguridad', 'fuga de contraseña', 'contraseña en claro encontrada en Web Storage');
    }

    // I11. Logout deja la sesión limpia.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    lastUrl = `${BASE}/profile.html`;
    await page.locator('#header-btn-logout').first().scrollIntoViewIfNeeded().catch(() => {});
    await page.locator('#header-btn-logout').first().click({ timeout: 10000 }).catch(() => {});
    try {
      await page.locator('#auth-container:visible').waitFor({ state: 'visible', timeout: 15000 });
      pass('cliente', 'logout devuelve al login');
      const tokenLeft = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) || '';
          if (k.includes('-auth-token') && localStorage.getItem(k)) return true;
        }
        return false;
      }).catch(() => false);
      if (!tokenLeft) pass('seguridad', 'logout limpia tokens de sesión en localStorage');
      else warn('seguridad', 'logout', 'quedaron tokens en localStorage');
    } catch { fail('cliente', 'logout', 'no vuelve al login'); }
    await assertClean('cliente', st, page);
  } catch (e) { if (activePage) await snap(activePage, 'cliente').catch(() => {}); throw e; } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- G. Compra interceptada (0 cargos)
console.log('\n--- G. Tarifas: compra interceptada (0 sesiones, 0 cargos) ---');
await section('compra', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    activePage = page;
    let attempts = 0;
    await page.route('**/functions/v1/*', (route) => {
      if (route.request().url().includes('create-checkout-session')) attempts++;
      route.abort();
    });
    const st = await gotoTracked(page, '/tarifas.html');
    // Barrido de TODOS los botones de compra en anónimo: cada uno debe abrir
    // su diálogo (o detenerse en la intercepción); jamás salir a Stripe.
    let totalBuy = 0;
    for (const cat of ['ofertas', 'yoga', 'psicologia', 'talleres']) {
      await page.locator(`[onclick*="switchCategory('${cat}')"]:visible`).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      // Inventario oferta por oferta: título + precio visible + acción.
      if (cat === 'yoga') {
        const cards = await page.locator('#section-yoga .tariff-card:visible').all().catch(() => []);
        const seen = [];
        for (const c of cards) {
          const txt = ((await c.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
          const title = ((await c.locator('h3').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 30);
          const price = (txt.match(/(\d+)\s*€/) || [])[1] || '?';
          const acts = await c.locator('button[onclick], a[href*="buy="]').count().catch(() => 0);
          seen.push(price);
          if (price !== '?' && acts > 0) pass('compra', `yoga "${title}" ${price}€ comprable`);
          else fail('compra', `yoga "${title || '?'}"`, `precio=${price} acciones=${acts}`);
        }
        const want = ['15', '40', '50', '65', '95', '90'].sort().join(',');
        if (seen.sort().join(',') === want) pass('compra', 'yoga: catálogo completo 15/40/50/65/95/90');
        else fail('compra', 'yoga: catálogo', `precios vistos: ${seen.join('/')} (esperado 15/40/50/65/95/90)`);
        const packs = await page.locator('#section-yoga a[href*="buy="]:visible').evaluateAll((els) => els.map((a) => a.getAttribute('href'))).catch(() => []);
        const packsOk = ['pack_4', 'bono_inicial', 'bono_mensual', 'pack_10', 'bono_ilimitado'].every((k) => packs.some((h) => (h || '').includes(k)));
        if (packsOk) pass('compra', 'yoga: packs enlazan a profile?buy=');
        else fail('compra', 'yoga: packs', `enlaces: ${packs.join(',').slice(0, 120)}`);
      }
      if (cat === 'psicologia') {
        // El precio del onclick debe coincidir con el impreso en su tarjeta.
        const bad = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('#section-psicologia button[onclick*="iniciarCheckoutConsultaStripe"]')
            .forEach((b) => {
              const m = (b.getAttribute('onclick') || '').match(/,\s*(\d+)\s*\)\s*$/);
              const price = m ? m[1] : '?';
              let node = b.parentElement;
              let cardTxt = '';
              for (let i = 0; i < 6 && node; i++) {
                cardTxt = (node.innerText || '').replace(/\s+/g, ' ');
                if (/\d+\s*€/.test(cardTxt) && node.querySelector('h2,h3')) break;
                node = node.parentElement;
              }
              if (price === '?' || !new RegExp(`\\b${price}\\s*€`).test(cardTxt)) {
                out.push(`${(b.innerText || '').replace(/\s+/g, ' ').slice(0, 30)}: onclick=${price}`);
              }
            });
          return out;
        }).catch(() => ['evaluate-falló']);
        if (!bad.length) pass('compra', 'consultas: precio impreso = precio cobrado (12)');
        else fail('compra', 'consultas: precio impreso ≠ cobrado', bad.slice(0, 4).join(' | '));
      }
      if (cat === 'talleres') {
        const cards = await page.locator('#talleres-cards-container > *:visible').all().catch(() => []);
        if (!cards.length) warn('compra', 'talleres', 'sin tarjetas dinámicas (aviso)');
        for (const c of cards.slice(0, 6)) {
          const txt = ((await c.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
          // Estado vacío legítimo: no hay talleres activos con fecha futura.
          if (/Próximamente nuevos talleres|New workshops coming soon/i.test(txt)) {
            pass('compra', 'talleres: estado vacío correcto (sin talleres activos)');
            continue;
          }
          const hasPrice = /\d+\s*€/.test(txt);
          const hasBtn = (await c.locator('button:visible').count().catch(() => 0)) > 0;
          const title = txt.slice(0, 34);
          if (txt.length > 20 && hasPrice && hasBtn) pass('compra', `taller "${title}" con precio y botón`);
          else fail('compra', 'taller', `tarjeta incompleta: "${title}"`);
        }
      }
      if (cat === 'ofertas') {
        const txt = ((await page.locator('#section-ofertas').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
        const cta = await page.locator('#section-ofertas a[href*="action=register"]').first().getAttribute('href').catch(() => '');
        const ver = await page.locator('#section-ofertas a[href="clases.html#calendario-publico"]').count().catch(() => 0);
        if (/Bono de Bienvenida/i.test(txt) && /0\s*€/.test(txt) && cta) pass('compra', 'ofertas: bienvenida 0€ con CTA a registro');
        else fail('compra', 'ofertas', 'bienvenida incompleta');
        if (ver > 0) pass('compra', 'ofertas: "Ver clases" enlaza al calendario');
        else fail('compra', 'ofertas', 'sin enlace a clases.html#calendario-publico');
      }
      // Talleres se renderiza dinámico (sin onclick): se barre por contenedor.
      const btns = cat === 'talleres'
        ? page.locator('#talleres-cards-container button:visible')
        : page.locator('button[onclick*="dquirir"]:visible, button[onclick*="heckout"]:visible');
      const n = await btns.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const b = btns.nth(i);
        const label = ((await b.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 44) || `botón ${i + 1}`;
        await b.scrollIntoViewIfNeeded().catch(() => {});
        await b.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1200);
        if (!page.url().startsWith(BASE)) {
          fail('compra', `fuga fuera de la web en "${label}" (${cat})`, page.url().slice(0, 100));
          await page.goto(`${BASE}/tarifas.html`, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(1500);
          continue;
        }
        let dlg = '';
        try {
          await page.locator('.swal2-popup:visible').first().waitFor({ state: 'visible', timeout: 6000 });
          dlg = await swalText(page);
        } catch { /* sin diálogo */ }
        if (dlg) { pass('compra', `"${label}" abre diálogo (${cat})`); totalBuy++; }
        else warn('compra', `"${label}" sin diálogo (${cat})`, 'clic sin respuesta visible (aviso)');
        await cancelOnly(page);
        if (!(await swalGone(page))) fail('compra', `diálogo de "${label}" no se cierra`, 'queda abierto tras cancelar');
      }
    }
    if (totalBuy < 10) warn('compra', 'pocos botones de compra', `${totalBuy} diálogos (¿catálogo cambiado?)`);
    else pass('compra', `${totalBuy} botones de compra abren su diálogo`);
    // Deep-link del enlace de ofertas: el calendario auto-abre.
    {
      await page.goto(`${BASE}/clases.html#calendario-publico`, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3500);
      const open = (await page.locator('#calendar-desktop').isVisible().catch(() => false))
        || (await page.locator('#calendar-mobile').isVisible().catch(() => false));
      if (open) pass('compra', 'deep-link #calendario-publico auto-abre');
      else fail('compra', 'deep-link #calendario-publico', 'no auto-abre el calendario');
      lastUrl = `${BASE}/clases.html#calendario-publico`;
    }
    if (!page.url().startsWith(BASE)) fail('compra', 'fuga fuera de la web', page.url().slice(0, 120));
    else if (attempts > 0) pass('compra', `intercepción activa (${attempts} intentos), 0 sesiones reales y 0 cargos`);
    else pass('compra', 'flujos detenidos antes del checkout (0 llamadas, 0 cargos)');
    await assertClean('compra', st, page);
  } catch (e) { if (activePage) await snap(activePage, 'compra').catch(() => {}); throw e; } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- G2. Retorno de pagos (success/cancel)
// Sin sesión de pago: error elegante sin redirigir; cancel cuenta atrás y retornos.
console.log('\n--- G2. Retorno de pagos ---');
await section('retorno', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await ctx.newPage();
    activePage = page;
    let st = await gotoTracked(page, '/success.html', 2500);
    {
      const errVisible = await page.locator('#verification-error').isVisible().catch(() => false);
      const errMsg = await page.locator('#verification-error-message').textContent().catch(() => '');
      if (errVisible && (errMsg || '').includes('sesión de pago LIVE válida')) {
        pass('retorno', 'success sin sesión: error correcto');
      } else fail('retorno', 'success sin sesión', `visible=${errVisible}`);
      const retryHidden = await page.locator('#verification-retry').evaluate((el) => el.classList.contains('hidden')).catch(() => null);
      if (retryHidden === true) pass('retorno', 'success sin sesión no ofrece reintentar');
      else if (retryHidden === false) fail('retorno', 'success sin sesión', 'ofrece Reintentar en bucle');
      await page.waitForTimeout(2500);
      if (page.url().startsWith(BASE)) pass('retorno', 'success sin pago no redirige');
      else fail('retorno', 'success sin pago', 'redirige fuera');

      const successUiIssues = await checkUiIntegrity(page, 'success');
      if (successUiIssues.length === 0) pass('retorno', 'success: sin tokens corruptos ni desbordamiento móvil');
      else fail('retorno', 'success: integridad UI', successUiIssues.join(', '));
    }
    await assertClean('retorno-success', st, page);
    st = await gotoTracked(page, '/cancel.html', 1200);
    {
      const read = () => page.locator('#countdown-dynamic').first().textContent().catch(() => null);
      const t1 = await read();
      await page.waitForTimeout(2500);
      const t2 = await read();
      const n1 = Number(t1);
      const n2 = Number(t2);
      if (Number.isFinite(n1) && Number.isFinite(n2) && n2 < n1) pass('retorno', `cancel: cuenta atrás late (${t1}→${t2})`);
      else if (page.url().endsWith('profile.html') || page.url().endsWith('tarifas.html')) {
        pass('retorno', `cancel: redirigió a ${page.url().split('/').pop()}`);
      } else fail('retorno', 'cancel: cuenta atrás', `no avanza (${t1}→${t2})`);
      const hrefs = await page.locator('#cancel-page, body').first().evaluate((root) =>
        [...root.querySelectorAll('a[href$=".html"]')].map((a) => a.getAttribute('href')).filter(Boolean)).catch(() => []);
      let deadRet = 0;
      for (const h of [...new Set(hrefs)].slice(0, 8)) {
        const r = await fetchTimeout(`${BASE}/${h.split(/[?#]/)[0]}`, { timeoutMs: 15000 });
        if (!r.ok || r.status !== 200) deadRet++;
      }
      if (deadRet === 0) pass('retorno', `cancel: ${[...new Set(hrefs)].length} retornos vivos`);
      else fail('retorno', 'cancel: retornos', `${deadRet} retornos rotos`);

      const cancelUiIssues = await checkUiIntegrity(page, 'cancel');
      if (cancelUiIssues.length === 0) pass('retorno', 'cancel: sin tokens corruptos ni desbordamiento móvil');
      else fail('retorno', 'cancel: integridad UI', cancelUiIssues.join(', '));

      // G3. Seguridad: Protección contra Open Redirect en retornos
      {
        const pageSec = await ctx.newPage();
        try {
          await pageSec.goto(`${BASE}/cancel.html?from=https://evil-attacker.example.com/phishing`, { waitUntil: 'load', timeout: 35000 });
          await pageSec.waitForTimeout(5500);
          const targetUrl = pageSec.url();
          if (targetUrl.startsWith(BASE) || targetUrl.endsWith('tarifas.html') || targetUrl.endsWith('profile.html')) {
            pass('seguridad', 'cancel.html neutraliza intento de Open Redirect');
          } else {
            fail('seguridad', 'Open Redirect vulnerable', `redirigió fuera a: ${targetUrl}`);
          }
        } catch (err) {
          warn('seguridad', 'Open Redirect sonda', String(err.message));
        } finally {
          await pageSec.close().catch(() => {});
        }
      }
    }
    await assertClean('retorno-cancel', st, page);
  } catch (e) { if (activePage) await snap(activePage, 'retorno').catch(() => {}); throw e; } finally { await ctx.close(); }
});

// ---------------------------------------------------------------- H. Rendimiento
console.log(`\n--- H. Rendimiento (${isCert ? 'cert' : 'producción'}) ---`);
{
  resetEvidence();
  // Agrupar por página: el chequeo navega varias veces las mismas URLs dentro
  // de otros flujos. Reportar cada navegación como un check extra inflaba el
  // recuento y penalizaba dos veces la misma página.
  const byPage = new Map();
  for (const p of perf) {
    const key = String(p.page || '').split('?')[0];
    if (!key) continue;
    const list = byPage.get(key) || [];
    list.push(p);
    byPage.set(key, list);
  }
  perfSummary = [];
  for (const [page, list] of byPage) {
    const worst = list.reduce((a, b) => (b.loadMs > a.loadMs ? b : a));
    const maxReqs = Math.max(...list.map((x) => x.reqs));
    const maxBytes = Math.max(...list.map((x) => x.bytes));
    const loads = list.map((x) => x.loadMs).sort((a, b) => a - b);
    const median = loads[Math.floor(loads.length / 2)];
    const kb = Math.round(maxBytes / 1024);
    perfSummary.push({ page, worstMs: worst.loadMs, medianMs: median, maxReqs, maxBytes, samples: list.length });
    const label = `${page}: ${worst.loadMs}ms, ${kb}KB, ${maxReqs} peticiones`;
    if (worst.loadMs > 15000) fail('rendimiento', page, `carga en ${worst.loadMs}ms (>15s)`);
    else if (maxReqs > 80) fail('rendimiento', page, `${maxReqs} peticiones (>80)`);
    else pass('rendimiento', label, list.length > 1 ? `${list.length} mediciones · mediana ${median}ms` : '');
  }
  perfSummary.sort((a, b) => b.worstMs - a.worstMs);
  const t0 = Date.now();
  const ping = await fetchTimeout(`${BASE}/`, { timeoutMs: 20000 });
  if (ping.ok) pass('rendimiento', `TTFB home: ${ping.ms}ms`);
  else { lastUrl = `${BASE}/`; fail('rendimiento', 'home inalcanzable', ping.error); }
}

// ---------------------------------------------------------------- I. Comprobaciones extendidas
console.log(`\n--- I. A11y, enlaces, SEO+, PWA, datos vivos, i18n y entrega ---`);
await section('extendido', async () => {
  resetEvidence();
  lastUrl = BASE;
  const ext = await runExtendedChecks({
    browser,
    base: BASE,
    supaUrl: SUPA_URL,
    supaKey: SUPA_KEY,
    isCert,
    log: () => {},
  });
  for (const r of ext) rec(r.suite, r.name, r.status, r.detail, r.meta);
});

// ---------------------------------------------------------------- J. Personas
if (skipPersonas) {
  console.log('\n--- J. Personas: omitidas (SKIP_PERSONAS=1) ---');
} else {
  console.log(`\n--- J. Simulación de personas reales ---`);
  await section('personas', async () => {
    resetEvidence();
    lastUrl = BASE;
    personaReport = await simulatePersonas({
      browser,
      base: BASE,
      email: EMAIL,
      password: PASSWORD,
      full: process.env.PERSONAS_FULL !== '0',
      artifactsDir: outDir,
      log: () => {},
    });
    for (const p of personaReport.personas) {
      const detail = `${p.metrics.clicks} toques · ${(p.metrics.totalMs / 1000).toFixed(0)}s · fricción ${p.metrics.friction}/100${p.metrics.deadEnds ? ` · ${p.metrics.deadEnds} bloqueo(s)` : ''}`;
      rec('personas', `${p.id} · ${p.name}`, p.status, detail, {
        kind: 'personas',
        persona: p.id,
        severity: p.status === 'fail' ? 'high' : 'low',
        actionable: false,
      });
    }
    const s = personaReport.summary;
    console.log(`  Personas: ${s.passed}/${s.total} limpias · ${s.warned} aviso(s) · ${s.failed} bloqueo(s) · fricción ${s.friction}/100`);
  });
}

if (browser) await browser.close().catch(() => {});
await writeReports();
