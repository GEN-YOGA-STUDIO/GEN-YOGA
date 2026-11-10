#!/usr/bin/env node
/**
 * scripts/build-cert-web.mjs — Artefacto web de certificación.
 *
 * Certificación puede funcionar en dos modos:
 *   1) AISLADO: con su propio proyecto Supabase de pruebas.
 *        CERT_SUPABASE_URL             https://XXXX.supabase.co (distinto del de producción)
 *        CERT_SUPABASE_PUBLISHABLE_KEY sb_publishable_… (distinto del de producción)
 *   2) MISMA BD (decisión de GEN Yoga): la web de cert apunta a la MISMA base de
 *      datos que producción — los cambios a validar son solo de web/apps.
 *        CERT_ALLOW_PRODUCTION_DB=1    (sin CERT_SUPABASE_*)
 *      En este modo las páginas llevan banner visible de entorno de pruebas y
 *      la pasarela de pago queda activa para pruebas.
 *
 * En ambos modos: noindex y sin CNAME (para no reclamar genyoga.studio).
 *
 * Uso:  node scripts/build-cert-web.mjs [_cert]
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRODUCCION_PROYECTO = 'jkjifmrrlyncuwpjhxvk';
const PRODUCCION_URL = `https://${PRODUCCION_PROYECTO}.supabase.co`;
const PRODUCCION_CLAVE = 'sb_publishable_xnIELom1ouXaBDJNYaWDAQ_VJNjlnIK';

const destino = path.resolve(root, process.argv[2] || '_cert');
// Host base del entorno de cert (se sobreescribe el dominio de producción en
// canonical/sitemap/og-image para que el artefacto de cert sea coherente).
const BASE_CERT = process.env.CERT_BASE_URL
  || 'https://gen-yoga-studio.github.io/GEN-YOGA-CERT';

function exigir(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`\n❌ Falta ${name}.`);
    console.error('   Modo aislado: define CERT_SUPABASE_URL y CERT_SUPABASE_PUBLISHABLE_KEY.');
    console.error('   Modo misma-BD: usa CERT_ALLOW_PRODUCTION_DB=1 (sin las anteriores).');
    console.error('   Guía: docs/CERTIFICATION_SETUP.md');
    process.exit(1);
  }
  return v;
}

// Modo misma-BD: solo si se pide explícitamente (variable de entorno/CI) y no
// hay credenciales de cert dedicadas.
const MODO_MISMA_BD = process.env.CERT_ALLOW_PRODUCTION_DB === '1'
  && !process.env.CERT_SUPABASE_URL?.trim()
  && !process.env.CERT_SUPABASE_PUBLISHABLE_KEY?.trim();
let mismoProyecto = MODO_MISMA_BD;
let urlCert;
let claveCert;
// Seguridad: en certificación los pagos LIVE quedan bloqueados salvo permiso
// explícito. El cert comparte la BD de producción, así que un clic accidental
// en "comprar" cobraría de verdad. Para pruebas de pago con Stripe TEST debe
// existir un backend de cert aislado; no se habilita por defecto.
const pagosLive = process.env.CERT_ALLOW_LIVE_PAYMENTS === '1';

if (MODO_MISMA_BD) {
  urlCert = PRODUCCION_URL;
  claveCert = PRODUCCION_CLAVE;
} else {
  urlCert = exigir('CERT_SUPABASE_URL');
  claveCert = exigir('CERT_SUPABASE_PUBLISHABLE_KEY');
}

if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(urlCert)) {
  console.error(`❌ CERT_SUPABASE_URL no es la URL raíz https://<proyecto>.supabase.co → ${urlCert}`);
  process.exit(1);
}
if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(claveCert)) {
  console.error('❌ CERT_SUPABASE_PUBLISHABLE_KEY no tiene formato de clave pública de Supabase.');
  process.exit(1);
}
if (!mismoProyecto) {
  // Modo aislado: jamás el proyecto/clave de producción.
  if (urlCert.includes(PRODUCCION_PROYECTO)) {
    console.error('❌ CERT_SUPABASE_URL apunta al proyecto de PRODUCCIÓN: usa CERT_ALLOW_PRODUCTION_DB=1 para el modo misma-BD.');
    process.exit(1);
  }
  if (claveCert === PRODUCCION_CLAVE) {
    console.error('❌ CERT_SUPABASE_PUBLISHABLE_KEY es la clave de PRODUCCIÓN.');
    process.exit(1);
  }
}

const fuente = path.join(root, 'ultima version');
const usarUltima = await readdir(fuente).then(() => true).catch(() => false);
const origen = usarUltima ? fuente : root;
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

const PAGINAS_ESPERADAS = [
  '404.html',
  'aviso-legal.html',
  'cancel.html',
  'clases.html',
  'clases_yoga.html',
  'consultas.html',
  'eventos.html',
  'index.html',
  'maestros.html',
  'ofertas.html',
  'politica-privacidad.html',
  'profile.html',
  'success.html',
  'tarifas.html',
];

const entradas = await readdir(origen, { withFileTypes: true });
const htmls = entradas.filter((e) => e.isFile() && e.name.endsWith('.html')).map((e) => e.name).sort();
const jsCssXml = entradas
  .filter((e) => e.isFile() && /\.(js|css|xml)$/.test(e.name))
  .map((e) => e.name);
const dirs = entradas.filter((e) => e.isDirectory() && ['img', 'fonts', '.well-known'].includes(e.name)).map((e) => e.name);

const faltan = PAGINAS_ESPERADAS.filter((name) => !htmls.includes(name));
const sobran = htmls.filter((name) => !PAGINAS_ESPERADAS.includes(name));
if (faltan.length || sobran.length) {
  console.error(`❌ El artefacto de cert debe tener exactamente ${PAGINAS_ESPERADAS.length} páginas HTML en ${origen}.`);
  if (faltan.length) console.error(`   Faltan: ${faltan.join(', ')}`);
  if (sobran.length) console.error(`   Sobran: ${sobran.join(', ')}`);
  process.exit(1);
}

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });

const robotsMeta = '<meta name="robots" content="noindex,nofollow">';
let marcadas = 0;

for (const file of htmls) {
  const src = await readFile(path.join(origen, file), 'utf8');
  let out = src
    .replaceAll(PRODUCCION_URL, urlCert)
    .replaceAll(PRODUCCION_CLAVE, claveCert)
    .replaceAll('https://genyoga.studio', BASE_CERT);

  if (/<meta\s+name=["']robots["'][^>]*>/i.test(out)) {
    out = out.replace(/<meta\s+name=["']robots["'][^>]*>/i, robotsMeta);
  } else {
    out = out.replace(/(<\/head>)/i, `  ${robotsMeta}\n  $1`);
  }
  if (!out.includes(robotsMeta)) throw new Error(`${file}: no se pudo marcar como no indexable.`);
  marcadas++;

  if (mismoProyecto) {
    // Modo misma-BD: la coherencia es la inversa — las páginas DEBEN llevar la
    // configuración de producción (es la única base de datos que existe).
    const urls = [...out.matchAll(/https:\/\/[a-z0-9.-]+\.supabase\.co/gi)].map((m) => m[0].toLowerCase());
    if (urls.some((u) => u !== urlCert.toLowerCase())) {
      throw new Error(`${file}: contiene un proyecto Supabase distinto del autorizado (misma-BD).`);
    }
    const claves = [...out.matchAll(/sb_publishable_[A-Za-z0-9_-]{20,}/g)].map((m) => m[0]);
    if (claves.some((k) => k !== claveCert)) {
      throw new Error(`${file}: contiene una clave pública distinta de la autorizada (misma-BD).`);
    }
  } else {
    if (out.includes(PRODUCCION_URL) || out.includes(PRODUCCION_CLAVE)) {
      throw new Error(`${file}: conserva configuración de producción.`);
    }
    const urls = [...out.matchAll(/https:\/\/[a-z0-9.-]+\.supabase\.co/gi)].map((m) => m[0].toLowerCase());
    if (urls.some((u) => u !== urlCert.toLowerCase())) {
      throw new Error(`${file}: contiene un proyecto Supabase distinto del de certificación.`);
    }
    const claves = [...out.matchAll(/sb_publishable_[A-Za-z0-9_-]{20,}/g)].map((m) => m[0]);
    if (claves.some((k) => k !== claveCert)) {
      throw new Error(`${file}: contiene una clave pública distinta de la de certificación.`);
    }
  }

  // Ajustes de compatibilidad de certificación para el flujo de pago y verificación
  if (file === 'success.html') {
    out = out.replaceAll(
      "(!stripeSessionId.startsWith('cs_live_') && !stripeSessionId.startsWith('cs_cert_'))",
      "(!stripeSessionId.startsWith('cs_live_') && !stripeSessionId.startsWith('cs_cert_') && !stripeSessionId.startsWith('cs_test_'))"
    );
  }
  if (file === 'profile.html') {
    out = out.replaceAll(
      "paymentSessionId.startsWith('cs_live_')",
      "(paymentSessionId.startsWith('cs_live_') || paymentSessionId.startsWith('cs_cert_') || paymentSessionId.startsWith('cs_test_'))"
    );
  }
  out = out.replaceAll(
    "if (parsed.hostname !== 'checkout.stripe.com') throw new Error('Dominio no permitido.');",
    "if (parsed.hostname !== 'checkout.stripe.com' && !parsed.hostname.includes('github.io') && parsed.hostname !== window.location.hostname) throw new Error('Dominio no permitido.');"
  );
  out = out.replaceAll(
    "if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com') {",
    "if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || (parsed.hostname !== 'checkout.stripe.com' && !parsed.hostname.includes('github.io') && parsed.hostname !== window.location.hostname)) {"
  );

  // Banner visible de entorno de pruebas. Es fijo para permanecer visible,
  // pero el body reserva su altura (34 px escritorio / 48 px móvil) para no
  // tapar el marquee, el botón INICIO ni los títulos. En móvil el texto puede
  // ocupar dos líneas; el padding se dimensiona para ambas.
  const textoBanner = pagosLive
    ? 'CERT · ENTORNO DE PRUEBAS · PAGOS LIVE HABILITADOS · MISMA BD QUE PRODUCCIÓN'
    : 'CERT · ENTORNO DE PRUEBAS · SIMULACIÓN DE PAGOS ACTIVA (SIN CARGO REAL) · MISMA BD QUE PRODUCCIÓN';
  const banner = `<style id="gy-cert-banner-style">
  #gy-cert-banner { position:fixed; top:0; left:0; right:0; z-index:9997; background:rgba(38,22,12,.96); color:#f8f6f2; font:600 12px/1.35 system-ui,-apple-system,sans-serif; text-align:center; letter-spacing:.03em; padding:5px 12px; }
  #gy-cert-banner * { pointer-events:auto; }
  #gy-cert-reset-btn { position:fixed; right:12px; bottom:12px; z-index:9998; background:rgba(38,22,12,.92); border:1px solid rgba(255,255,255,0.32); color:#fff; border-radius:999px; padding:0 16px; font-size:12px; font-weight:700; cursor:pointer; transition:background .15s; display:inline-flex; align-items:center; justify-content:center; min-height:44px; box-shadow:0 6px 18px rgba(0,0,0,.25); }
  #gy-cert-reset-btn:hover { background:rgba(38,22,12,1); }
  body { padding-top:34px !important; }
  @media (max-width:640px) { body { padding-top:48px !important; } }
  html { scroll-padding-top:44px; }
</style>
<div id="gy-cert-banner" role="note">
  <span>${textoBanner}</span>
  ${!pagosLive ? '<button id="gy-cert-reset-btn" type="button" title="Restablecer bonos y compras simuladas en este navegador">🧹 Limpiar compras simuladas</button>' : ''}
</div>`;
  if (!out.includes('gy-cert-banner')) {
    out = out.replace(/(<body[^>]*>)/i, `$1\n  ${banner}`);
  }

  // Simulador de pagos de certificación: permite probar el flujo completo con
  // tarjeta simulada, retorno a success.html y confirmación de la compra sin
  // conectar a Stripe en producción ni requerir tarjeta real.
  // IMPORTANTE: En CERT, consolida y carga en los perfiles exactamente lo comprado
  // (Bono Mensual, Bono Inicial, Bono Ilimitado, Packs y Consultas).
  if (!pagosLive) {
    const simulator = `<script id="gy-cert-payment-simulator">
(function () {
  window.__GY_CERT_PAYMENTS_SIMULATOR__ = true;
  var originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;

  var CATALOG_MAP = {
    'bono_mensual_65': { title: 'Bono Mensual (8 clases/mes)', price: '65,00 €', type: 'bono_mensual', credits: 8, maxPerWeek: 2, planType: 'bono_mensual' },
    'bono_mensual': { title: 'Bono Mensual (8 clases/mes)', price: '65,00 €', type: 'bono_mensual', credits: 8, maxPerWeek: 2, planType: 'bono_mensual' },
    'bono_inicial_40': { title: 'Bono Inicial (4 clases/mes)', price: '40,00 €', type: 'bono_inicial', credits: 4, maxPerWeek: 1, planType: 'bono_inicial' },
    'bono_inicial': { title: 'Bono Inicial (4 clases/mes)', price: '40,00 €', type: 'bono_inicial', credits: 4, maxPerWeek: 1, planType: 'bono_inicial' },
    'bono_ilimitado': { title: 'Bono Ilimitado', price: '90,00 €', type: 'bono_ilimitado', isUnlimited: true },
    'pack_4': { title: 'Pack de 4 Clases', price: '50,00 €', type: 'pack_4', credits: 4 },
    'pack_6': { title: 'Pack de 6 Clases', price: '65,00 €', type: 'pack_6', credits: 6 },
    'pack_10': { title: 'Pack de 10 Clases', price: '95,00 €', type: 'pack_10', credits: 10 },
    'clase_suelta': { title: '1 Clase Suelta de Yoga', price: '15,00 €', type: 'clase_suelta', credits: 1 },
    'clase_especial': { title: 'Clase Especial: Flow & Meditación', price: '20,00 €', type: 'clase_especial', credits: 1, isSpecial: true },
    'taller_intro_power_vinyasa': { title: 'Taller: Intro Power Vinyasa', price: '25,00 €', type: 'taller_intro_power_vinyasa', isWorkshop: true },
    'taller_25': { title: 'Taller GEN Yoga (25 €)', price: '25,00 €', type: 'taller_25', isWorkshop: true },
    'taller_35': { title: 'Taller GEN Yoga (35 €)', price: '35,00 €', type: 'taller_35', isWorkshop: true },
    'taller': { title: 'Taller GEN Yoga', price: '25,00 €', type: 'taller', isWorkshop: true },
    'miriam_psico_individual_1a': { title: 'Acompañamiento psicoterapéutico (1ª sesión)', price: '75,00 €', type: 'miriam_psico_individual_1a', isConsultation: true, consultationType: 'psicologia' },
    'miriam_psico_individual_sig': { title: 'Acompañamiento psicoterapéutico (siguientes)', price: '65,00 €', type: 'miriam_psico_individual_sig', isConsultation: true, consultationType: 'psicologia' },
    'miriam_psico_pareja_1a': { title: 'Terapia de pareja (1ª sesión)', price: '120,00 €', type: 'miriam_psico_pareja_1a', isConsultation: true, consultationType: 'psicologia' },
    'miriam_psico_pareja_sig': { title: 'Terapia de pareja (siguientes)', price: '100,00 €', type: 'miriam_psico_pareja_sig', isConsultation: true, consultationType: 'psicologia' },
    'miriam_grupo_autoayuda': { title: 'Grupo de Autoayuda con Miriam', price: '30,00 €', type: 'miriam_grupo_autoayuda', isGroup: true },
    'miriam_grupo_terapeutico': { title: 'Grupo Terapéutico con Miriam', price: '30,00 €', type: 'miriam_grupo_terapeutico', isGroup: true },
    'prod_VDmmlmsGGhMebt': { title: 'Sesión Grupal con Miriam', price: '30,00 €', type: 'prod_VDmmlmsGGhMebt', isGroup: true },
    'silvia_ayurveda_1a': { title: 'Consulta de Ayurveda (1ª sesión)', price: '80,00 €', type: 'silvia_ayurveda_1a', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    'silvia_ayurveda_sig': { title: 'Consulta de Ayurveda (seguimiento)', price: '60,00 €', type: 'silvia_ayurveda_sig', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    'silvia_ayurveda_bono3': { title: 'Bono Ayurveda 3 sesiones', price: '170,00 €', type: 'silvia_ayurveda_bono3', isConsultation: true, consultationType: 'nutricion', quantity: 3 },
    'silvia_ayurveda_bono6': { title: 'Bono Ayurveda 6 sesiones', price: '280,00 €', type: 'silvia_ayurveda_bono6', isConsultation: true, consultationType: 'nutricion', quantity: 6 },
    'isabel_pni_1a': { title: 'Consulta de PNI (1ª sesión)', price: '80,00 €', type: 'isabel_pni_1a', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    'isabel_pni_sig': { title: 'Consulta de PNI (seguimiento)', price: '60,00 €', type: 'isabel_pni_sig', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    // Alias por product_id de Stripe: el flujo real puede enviar el ID en lugar
    // del lookup_key (p. ej. clases con stripe_product_id asignado). Mantener
    // aquí el mismo importe que valida el backend evita importes '-- €'.
    'prod_V5uBKuweMRE6ig': { title: 'Clase Especial', price: '20,00 €', type: 'clase_especial', credits: 1, isSpecial: true },
    'prod_V5uCPKKKH5K74P': { title: 'Taller GEN Yoga (35 €)', price: '35,00 €', type: 'taller_35', isWorkshop: true },
    'prod_VDY8mI9bZ3SQeb': { title: 'Taller GEN Yoga (25 €)', price: '25,00 €', type: 'taller_25', isWorkshop: true },
    'prod_VDmmlmsGGhMebt': { title: 'Sesión Grupal Miriam', price: '30,00 €', type: 'prod_VDmmlmsGGhMebt', isGroup: true },
    'prod_V0ITB6mD71fwnD': { title: 'Pack de 4 Clases', price: '50,00 €', type: 'pack_4', credits: 4 },
    'prod_V0IUpyuvd7uX00': { title: 'Pack de 6 Clases', price: '65,00 €', type: 'pack_6', credits: 6 },
    'prod_V0IUYoGJJbX7FW': { title: 'Pack de 10 Clases', price: '95,00 €', type: 'pack_10', credits: 10 },
    'prod_VVkU2penYA08Qe': { title: 'Bono Inicial (4 clases/mes)', price: '40,00 €', type: 'bono_inicial', credits: 4, maxPerWeek: 1, planType: 'bono_inicial' },
    'prod_VVkT3C71EAUJmt': { title: 'Bono Mensual (8 clases/mes)', price: '65,00 €', type: 'bono_mensual', credits: 8, maxPerWeek: 2, planType: 'bono_mensual' },
    'prod_V9eGZTzwCNJ55q': { title: '1ª Clase con 50% Dto.', price: '7,50 €', type: 'promo_50_clase', credits: 1 },
    'prod_V1pKHgtMwPkCpC': { title: 'Acompañamiento psicoterapéutico (1ª sesión)', price: '75,00 €', type: 'miriam_psico_individual_1a', isConsultation: true, consultationType: 'psicologia' },
    'prod_V1pLmzpCRU8ZpL': { title: 'Acompañamiento psicoterapéutico (siguientes)', price: '65,00 €', type: 'miriam_psico_individual_sig', isConsultation: true, consultationType: 'psicologia' },
    'prod_V1pLCY3t5sprlK': { title: 'Terapia de pareja (1ª sesión)', price: '120,00 €', type: 'miriam_psico_pareja_1a', isConsultation: true, consultationType: 'psicologia' },
    'prod_V1pLWNLzr9Vb3g': { title: 'Terapia de pareja (siguientes)', price: '100,00 €', type: 'miriam_psico_pareja_sig', isConsultation: true, consultationType: 'psicologia' },
    'prod_V1pwyAFdIdxWG5': { title: 'Consulta de Ayurveda (1ª sesión)', price: '80,00 €', type: 'silvia_ayurveda_1a', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    'prod_V1pxtuahf6l09m': { title: 'Consulta de Ayurveda (seguimiento)', price: '60,00 €', type: 'silvia_ayurveda_sig', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    'prod_V1psYkVdT3ZgxH': { title: 'Bono Ayurveda 3 sesiones', price: '170,00 €', type: 'silvia_ayurveda_bono3', isConsultation: true, consultationType: 'nutricion', quantity: 3 },
    'prod_V1psDxhdrLmncY': { title: 'Bono Ayurveda 6 sesiones', price: '280,00 €', type: 'silvia_ayurveda_bono6', isConsultation: true, consultationType: 'nutricion', quantity: 6 },
    'prod_V1ppAeiDF9dlkZ': { title: 'Consulta de PNI (1ª sesión)', price: '80,00 €', type: 'isabel_pni_1a', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    'prod_V1pqPF6rtJf0SW': { title: 'Consulta de PNI (seguimiento)', price: '60,00 €', type: 'isabel_pni_sig', isConsultation: true, consultationType: 'nutricion', quantity: 1 },
    'prod_UqBwGSWJNVAK0j': { title: '1 Clase Suelta de Yoga', price: '15,00 €', type: 'clase_suelta', credits: 1 },
    'prod_UqBxkWuX2OeIz8': { title: 'Bono Ilimitado', price: '90,00 €', type: 'bono_ilimitado', isUnlimited: true }
  };

  function getProductInfo(lookupKey, membershipMonth) {
    var raw = String(lookupKey || '').toLowerCase();
    var found = CATALOG_MAP[raw];
    if (!found) {
      if (raw.indexOf('mensual') !== -1) found = CATALOG_MAP['bono_mensual'];
      else if (raw.indexOf('inicial') !== -1) found = CATALOG_MAP['bono_inicial'];
      else if (raw.indexOf('ilimitado') !== -1) found = CATALOG_MAP['bono_ilimitado'];
      else if (raw.indexOf('pack_4') !== -1) found = CATALOG_MAP['pack_4'];
      else if (raw.indexOf('pack_6') !== -1) found = CATALOG_MAP['pack_6'];
      else if (raw.indexOf('pack_10') !== -1) found = CATALOG_MAP['pack_10'];
      else if (raw.indexOf('suelta') !== -1) found = CATALOG_MAP['clase_suelta'];
    }
    if (!found) {
      found = { title: lookupKey || 'Producto GEN Yoga', price: '-- €', type: lookupKey || 'clase_suelta', credits: 1 };
    }
    var title = found.title;
    if (found.type === 'bono_ilimitado' && membershipMonth) {
      title += ' (' + membershipMonth + ')';
    }
    return {
      title: title,
      price: found.price,
      type: found.type,
      credits: found.credits,
      maxPerWeek: found.maxPerWeek,
      planType: found.planType,
      isUnlimited: found.isUnlimited,
      isSpecial: found.isSpecial,
      isWorkshop: found.isWorkshop,
      isConsultation: found.isConsultation,
      isGroup: found.isGroup,
      consultationType: found.consultationType,
      quantity: found.quantity
    };
  }

  function getMonthBounds(monthStr) {
    var now = new Date();
    var parts = String(monthStr || '').split('-');
    var year = (parts.length === 2 && !isNaN(parseInt(parts[0], 10))) ? parseInt(parts[0], 10) : now.getFullYear();
    var month = (parts.length === 2 && !isNaN(parseInt(parts[1], 10))) ? parseInt(parts[1], 10) - 1 : now.getMonth();
    var start = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    var end = new Date(Date.UTC(month === 11 ? year + 1 : year, (month + 1) % 12, 1, 0, 0, 0));
    var mStr = year + '-' + String(month + 1).padStart(2, '0');
    return {
      monthStr: mStr,
      monthDate: mStr + '-01',
      startsAt: start.toISOString(),
      endsAt: end.toISOString()
    };
  }

  function getActiveCertUserId(preferredUserId) {
    if (preferredUserId && preferredUserId !== 'guest') return preferredUserId;
    try {
      var cached = localStorage.getItem('gen_cached_user_id');
      if (cached) return cached;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') !== -1) {
          var raw = localStorage.getItem(k);
          if (raw) {
            var parsed = JSON.parse(raw);
            var uid = parsed && parsed.user && parsed.user.id;
            if (uid) return uid;
          }
        }
      }
    } catch (_) {}
    return preferredUserId || 'guest';
  }

  function getCertPurchases() {
    try {
      return JSON.parse(localStorage.getItem('gy_cert_purchases_v1') || '[]');
    } catch (_) {
      return [];
    }
  }

  function saveCertPurchase(item) {
    try {
      var list = getCertPurchases();
      list.unshift(item);
      localStorage.setItem('gy_cert_purchases_v1', JSON.stringify(list));
    } catch (e) {
      console.warn('[cert-simulator] Error guardando compra simulada:', e);
    }
  }

  function augmentCertQueryResult(table, result) {
    if (!result) return result;
    var currentUserId = getActiveCertUserId();
    var allPurchases = getCertPurchases();
    var purchases = allPurchases.filter(function (p) {
      return p.userId === currentUserId || (currentUserId !== 'guest' && p.userId === 'guest');
    });
    if (purchases.length === 0) return result;

    var data = result.data;

    // 1. Bono Mensual y Bono Inicial (monthly_membership_periods)
    if (table === 'monthly_membership_periods') {
      var monthlyList = purchases.filter(function (p) {
        return p.purchaseType === 'bono_mensual' || p.purchaseType === 'bono_inicial';
      });
      if (monthlyList.length > 0) {
        var cList = Array.isArray(data) ? data.slice() : [];
        monthlyList.forEach(function (sim) {
          var exists = cList.some(function (row) {
            var rMonth = String(row.membership_month || '').slice(0, 7);
            var sMonth = String(sim.membershipMonth || '').slice(0, 7);
            return rMonth === sMonth && (row.plan_type === sim.planType);
          });
          if (!exists) {
            cList.unshift({
              id: sim.id,
              user_id: currentUserId,
              membership_month: sim.membershipMonth + '-01',
              starts_at: sim.startsAt,
              ends_at: sim.endsAt,
              purchased_at: sim.purchasedAt,
              max_classes_per_week: sim.maxClassesPerWeek,
              plan_type: sim.planType
            });
          }
        });
        return { data: cList, error: null };
      }
    }

    // 2. Bono Ilimitado (unlimited_membership_periods)
    if (table === 'unlimited_membership_periods') {
      var uList = purchases.filter(function (p) {
        return p.purchaseType === 'bono_ilimitado';
      });
      if (uList.length > 0) {
        var curU = Array.isArray(data) ? data.slice() : [];
        uList.forEach(function (sim) {
          var existsU = curU.some(function (row) {
            return String(row.membership_month || '').slice(0, 7) === String(sim.membershipMonth || '').slice(0, 7);
          });
          if (!existsU) {
            curU.unshift({
              id: sim.id,
              user_id: currentUserId,
              membership_month: sim.membershipMonth + '-01',
              starts_at: sim.startsAt,
              ends_at: sim.endsAt,
              purchased_at: sim.purchasedAt
            });
          }
        });
        return { data: curU, error: null };
      }
    }

    // 3. Packs de clases (class_credit_packs)
    if (table === 'class_credit_packs') {
      var packList = purchases.filter(function (p) {
        return p.purchaseType === 'pack_4' || p.purchaseType === 'pack_6' || p.purchaseType === 'pack_10' || p.purchaseType === 'clase_suelta';
      });
      if (packList.length > 0) {
        var curP = Array.isArray(data) ? data.slice() : [];
        packList.forEach(function (sim) {
          var existsP = curP.some(function (row) {
            return row.checkout_session_id === sim.sessionId || row.id === sim.id;
          });
          if (!existsP) {
            curP.unshift({
              id: sim.id,
              user_id: currentUserId,
              checkout_session_id: sim.sessionId,
              pack_type: sim.purchaseType,
              credits_total: sim.creditsTotal,
              credits_remaining: sim.creditsRemaining,
              purchased_at: sim.purchasedAt,
              expires_at: sim.expiresAt
            });
          }
        });
        return { data: curP, error: null };
      }
    }

    // 4. Clases especiales (bonos_clases_especiales)
    if (table === 'bonos_clases_especiales') {
      var specialList = purchases.filter(function (p) {
        return p.purchaseType === 'bono_ilimitado' || p.purchaseType === 'clase_especial';
      });
      if (specialList.length > 0) {
        var curS = Array.isArray(data) ? data.slice() : [];
        specialList.forEach(function (sim) {
          var existsS = curS.some(function (row) {
            return row.checkout_session_id === sim.sessionId || row.id === sim.id;
          });
          if (!existsS) {
            curS.push({
              id: sim.id,
              user_id: currentUserId,
              mes: sim.membershipMonth + '-01',
              saldo: 1,
              origen: (sim.purchaseType === 'bono_ilimitado' ? 'bono_ilimitado' : 'compra_stripe'),
              checkout_session_id: sim.sessionId,
              created_at: sim.purchasedAt
            });
          }
        });
        return { data: curS, error: null };
      }
    }

    // 5. Perfil de usuario (profiles)
    if (table === 'profiles') {
      if (data && typeof data === 'object') {
        var isArr = Array.isArray(data);
        var targetProfiles = isArr ? data : [data];
        targetProfiles.forEach(function (prof) {
          if (!prof || (prof.id !== currentUserId && currentUserId !== 'guest')) return;
          var activePacks = purchases.filter(function (p) {
            return (p.purchaseType === 'pack_4' || p.purchaseType === 'pack_6' || p.purchaseType === 'pack_10' || p.purchaseType === 'clase_suelta')
              && Date.parse(p.expiresAt) > Date.now();
          });
          var packCreds = activePacks.reduce(function (sum, p) { return sum + (p.creditsRemaining || 0); }, 0);
          if (packCreds > 0) {
            prof.bonos = (Number(prof.bonos) || 0) + packCreds;
          }

          var activeUnlimited = purchases.find(function (p) {
            var now = Date.now();
            return p.purchaseType === 'bono_ilimitado' && Date.parse(p.startsAt) <= now && Date.parse(p.endsAt) > now;
          });
          if (activeUnlimited) {
            prof.bono_mensual_activo = true;
            prof.bono_mensual_inicio = activeUnlimited.startsAt;
            prof.bono_mensual_fin = activeUnlimited.endsAt;
          }

          // Consultas
          var psicoCount = purchases.filter(function (p) { return p.purchaseType.indexOf('psico') !== -1; }).length;
          if (psicoCount > 0) prof.saldo_psicologia = (Number(prof.saldo_psicologia) || 0) + psicoCount;

          var nutriCount = purchases.reduce(function (sum, p) {
            if (p.purchaseType.indexOf('ayurveda') !== -1 || p.purchaseType.indexOf('pni') !== -1) {
              return sum + (p.purchaseType.indexOf('bono3') !== -1 ? 3 : (p.purchaseType.indexOf('bono6') !== -1 ? 6 : 1));
            }
            return sum;
          }, 0);
          if (nutriCount > 0) prof.saldo_nutricion = (Number(prof.saldo_nutricion) || 0) + nutriCount;

          var grupoCount = purchases.filter(function (p) { return p.purchaseType.indexOf('grupo') !== -1; }).length;
          if (grupoCount > 0) prof.saldo_grupal = (Number(prof.saldo_grupal) || 0) + grupoCount;
        });
        return { data: isArr ? targetProfiles : targetProfiles[0], error: null };
      }
    }

    return result;
  }

  function getSimBonoForReservation() {
    var currentUserId = getActiveCertUserId();
    var all = getCertPurchases();
    var purchases = all.filter(function (p) {
      return p.userId === currentUserId || (currentUserId !== 'guest' && p.userId === 'guest');
    });
    var now = Date.now();

    // 1. Bono Ilimitado
    var u = purchases.find(function (p) {
      return p.purchaseType === 'bono_ilimitado' && Date.parse(p.startsAt) <= now && Date.parse(p.endsAt) > now;
    });
    if (u) return { bono: u, kind: 'ilimitado' };

    // 2. Bono Mensual o Inicial
    var m = purchases.find(function (p) {
      return (p.purchaseType === 'bono_mensual' || p.purchaseType === 'bono_inicial')
        && Date.parse(p.startsAt) <= now && Date.parse(p.endsAt) > now
        && (p.creditsRemaining > 0);
    });
    if (m) return { bono: m, kind: 'mensual' };

    // 3. Packs
    var pk = purchases.find(function (p) {
      return (p.purchaseType === 'pack_4' || p.purchaseType === 'pack_6' || p.purchaseType === 'pack_10' || p.purchaseType === 'clase_suelta')
        && Date.parse(p.expiresAt) > now
        && (p.creditsRemaining > 0);
    });
    if (pk) return { bono: pk, kind: 'pack' };

    return null;
  }

  function recordSimReservation(claseId, match) {
    try {
      if (match && match.bono) {
        var all = getCertPurchases();
        all.forEach(function (p) {
          if (p.id === match.bono.id && p.creditsRemaining > 0) {
            p.creditsRemaining -= 1;
          }
        });
        localStorage.setItem('gy_cert_purchases_v1', JSON.stringify(all));
      }
    } catch (e) {
      console.warn('[cert-simulator] Error deduciendo bono en reserva simulada:', e);
    }
  }

  function wrapSupabaseForCert(c) {
    if (!c || c.__gy_cert_wrapped) return c;
    c.__gy_cert_wrapped = true;

    var origFrom = c.from;
    c.from = function (table) {
      var query = origFrom.apply(this, arguments);
      if (table === 'monthly_membership_periods' ||
          table === 'unlimited_membership_periods' ||
          table === 'class_credit_packs' ||
          table === 'profiles' ||
          table === 'bonos_clases_especiales') {
        var origThen = query.then;
        query.then = function (onFulfilled, onRejected) {
          return origThen.call(query, function (res) {
            try {
              var augmented = augmentCertQueryResult(table, res);
              return onFulfilled ? onFulfilled(augmented) : augmented;
            } catch (err) {
              console.warn('[cert-simulator] Error en interceptor de ' + table + ':', err);
              return onFulfilled ? onFulfilled(res) : res;
            }
          }, onRejected);
        };
      }
      return query;
    };

    var origRpc = c.rpc;
    c.rpc = function (fn, args) {
      var rpcPromise = origRpc.apply(this, arguments);
      if (fn === 'reservar_con_bono') {
        return rpcPromise.then(function (res) {
          if (!res || !res.error) return res;
          var simMatch = getSimBonoForReservation();
          if (simMatch) {
            console.log('[cert-simulator] Aceptando reserva con bono simulado de CERT:', simMatch);
            recordSimReservation(args && args.p_clase_id, simMatch);
            return { data: null, error: null };
          }
          return res;
        });
      }
      return rpcPromise;
    };

    return c;
  }

  if (window.supabase && typeof window.supabase.createClient === 'function') {
    var origCreateClient = window.supabase.createClient;
    window.supabase.createClient = function () {
      var inst = origCreateClient.apply(this, arguments);
      return wrapSupabaseForCert(inst);
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (window.client) wrapSupabaseForCert(window.client);
    if (window.supabaseClient) wrapSupabaseForCert(window.supabaseClient);

    var resetBtn = document.getElementById('gy-cert-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var doReset = function () {
          localStorage.removeItem('gy_cert_purchases_v1');
          localStorage.removeItem('gy_cert_reservas_v1');
          localStorage.removeItem('gy_cert_last_session');
          window.location.reload();
        };
        if (window.Swal && typeof window.Swal.fire === 'function') {
          window.Swal.fire({
            title: '¿Limpiar compras simuladas?',
            text: 'Se restablecerán los bonos y compras de prueba creados en CERT para este navegador.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#956857',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Sí, limpiar',
            cancelButtonText: 'Cancelar'
          }).then(function (r) {
            if (r.isConfirmed) doReset();
          });
        } else if (confirm('¿Deseas restablecer las compras simuladas en CERT?')) {
          doReset();
        }
      });
    }
  });

  function injectModalStyles() {
    if (document.getElementById('gy-cert-sim-styles')) return;
    var style = document.createElement('style');
    style.id = 'gy-cert-sim-styles';
    style.textContent = [
      '#gy-cert-modal-overlay { position:fixed; inset:0; z-index:999999; background:rgba(38,22,12,0.82); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; padding:16px; font-family:"Outfit",system-ui,sans-serif; color:#26160c; animation:gyFadeIn .2s ease-out; }',
      '@keyframes gyFadeIn { from{opacity:0;transform:scale(.96)} to{opacity:1;transform:scale(1)} }',
      '.gy-sim-card { background:#fff; border-radius:24px; max-width:440px; width:100%; box-shadow:0 25px 50px -12px rgba(0,0,0,.45); border:1px solid #ebdccb; overflow:hidden; }',
      '.gy-sim-header { background:linear-gradient(135deg,#26160c 0%,#4a2818 100%); color:#f8f6f2; padding:18px 22px; position:relative; }',
      '.gy-sim-badge { display:inline-flex; align-items:center; gap:5px; background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.25); color:#fbd38d; font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; padding:3px 9px; border-radius:999px; margin-bottom:6px; }',
      '.gy-sim-title { font-family:"Playfair Display",Georgia,serif; font-size:19px; font-weight:700; margin:0; color:#f8f6f2; }',
      '.gy-sim-subtitle { font-size:11px; color:rgba(248,246,242,.75); margin-top:2px; }',
      '.gy-sim-body { padding:20px 22px; display:flex; flex-direction:column; gap:14px; }',
      '.gy-sim-item { background:#faf6f0; border:1px solid #ebdccb; border-radius:14px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; }',
      '.gy-sim-item-name { font-size:13px; font-weight:700; color:#26160c; }',
      '.gy-sim-item-user { font-size:11px; color:rgba(38,22,12,.6); margin-top:2px; }',
      '.gy-sim-item-price { font-size:19px; font-weight:900; color:#956857; font-family:"Playfair Display",Georgia,serif; }',
      '.gy-sim-card-box { background:#fcfbf9; border:1.5px solid #dcd3c7; border-radius:14px; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }',
      '.gy-sim-card-header { display:flex; justify-content:space-between; align-items:center; font-size:10px; font-weight:700; color:rgba(38,22,12,.55); text-transform:uppercase; letter-spacing:.05em; }',
      '.gy-sim-card-num { font-family:monospace; font-size:14px; font-weight:600; color:#26160c; letter-spacing:.08em; }',
      '.gy-sim-card-row { display:flex; justify-content:space-between; font-size:11px; color:rgba(38,22,12,.7); font-family:monospace; }',
      '.gy-sim-info { background:#eef7ee; border:1px solid #c3e6cb; border-radius:12px; padding:9px 12px; font-size:11px; color:#1e6331; line-height:1.4; display:flex; gap:8px; align-items:center; }',
      '.gy-sim-actions { display:flex; flex-direction:column; gap:8px; margin-top:4px; }',
      '.gy-sim-btn-pay { background:#956857; color:#fff; border:none; border-radius:12px; padding:13px 18px; font-size:13px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; cursor:pointer; box-shadow:0 4px 12px rgba(149,104,87,.35); transition:all .15s; display:flex; align-items:center; justify-content:center; gap:8px; }',
      '.gy-sim-btn-pay:hover { background:#26160c; }',
      '.gy-sim-btn-pay:disabled { opacity:.65; cursor:not-allowed; }',
      '.gy-sim-btn-cancel { background:transparent; border:1px solid #dcd3c7; border-radius:10px; padding:9px 14px; font-size:11px; font-weight:700; color:rgba(38,22,12,.7); text-transform:uppercase; cursor:pointer; }',
      '.gy-sim-btn-cancel:hover { background:#faf6f0; color:#26160c; }',
      '.gy-sim-spinner { width:14px; height:14px; border:2px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:gySpin .6s linear infinite; display:inline-block; }',
      '@keyframes gySpin { to{transform:rotate(360deg)} }'
    ].join('\\n');
    document.head.appendChild(style);
  }

  function mostrarModalSimulacionPago(checkoutPayload) {
    injectModalStyles();
    if (window.Swal && typeof window.Swal.close === 'function') {
      window.Swal.close();
    }

    var lookupKey = checkoutPayload.lookup_key || '';
    var userId = checkoutPayload.user_id || 'guest';
    var membershipMonth = checkoutPayload.membership_month || '';
    var targetClassId = checkoutPayload.target_class_id || null;
    var guestName = checkoutPayload.guest_name || '';
    var fromOrigin = checkoutPayload.from || 'tarifas';
    var info = getProductInfo(lookupKey, membershipMonth);

    var existingOverlay = document.getElementById('gy-cert-modal-overlay');
    if (existingOverlay) existingOverlay.remove();

    var overlay = document.createElement('div');
    overlay.id = 'gy-cert-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var userDesc = (userId === 'guest')
      ? ('Invitado' + (guestName ? (': ' + guestName) : ''))
      : 'Usuario registrado';

    overlay.innerHTML = [
      '<div class="gy-sim-card">',
      '  <div class="gy-sim-header">',
      '    <div class="gy-sim-badge">🧪 Certificación · Pasarela Simulada</div>',
      '    <h2 class="gy-sim-title">Comprobación de Pago</h2>',
      '    <div class="gy-sim-subtitle">Prueba del flujo de compra sin cobro real ni conexión a Stripe LIVE</div>',
      '  </div>',
      '  <div class="gy-sim-body">',
      '    <div class="gy-sim-item">',
      '      <div>',
      '        <div class="gy-sim-item-name">' + info.title + '</div>',
      '        <div class="gy-sim-item-user">' + userDesc + '</div>',
      '      </div>',
      '      <div class="gy-sim-item-price">' + info.price + '</div>',
      '    </div>',
      '    <div class="gy-sim-card-box">',
      '      <div class="gy-sim-card-header">',
      '        <span>Tarjeta de prueba</span>',
      '        <span>VISA / MC TEST</span>',
      '      </div>',
      '      <div class="gy-sim-card-num">•••• •••• •••• 4242</div>',
      '      <div class="gy-sim-card-row">',
      '        <span>Caduca: 12/28</span>',
      '        <span>CVC: 123</span>',
      '        <span>Titular: ' + (guestName || 'Usuario CERT') + '</span>',
      '      </div>',
      '    </div>',
      '    <div class="gy-sim-info">',
      '      <span>✓</span>',
      '      <span>Al confirmar, se simulará el pago bancario y se verificará el retorno y consolidación en <strong>success.html</strong>.</span>',
      '    </div>',
      '    <div class="gy-sim-actions">',
      '      <button id="gy-sim-btn-submit" type="button" class="gy-sim-btn-pay">',
      '        💳 Pagar ' + info.price + ' (Simular Éxito)',
      '      </button>',
      '      <button id="gy-sim-btn-abandon" type="button" class="gy-sim-btn-cancel">',
      '        ✕ Simular Abandono (Ir a Cancelación)',
      '      </button>',
      '      <button id="gy-sim-btn-close" type="button" style="background:transparent;border:none;font-size:11px;color:rgba(38,22,12,.4);cursor:pointer;padding:4px;">',
      '        Cerrar modal',
      '      </button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\\n');

    document.body.appendChild(overlay);

    var submitBtn = document.getElementById('gy-sim-btn-submit');
    var abandonBtn = document.getElementById('gy-sim-btn-abandon');
    var closeBtn = document.getElementById('gy-sim-btn-close');

    submitBtn.addEventListener('click', function () {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="gy-sim-spinner"></span> Autorizando pago simulado...';
      abandonBtn.disabled = true;

      var simSessionId = 'cs_cert_sim_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
      var effUserId = getActiveCertUserId(userId);
      var bounds = getMonthBounds(membershipMonth);
      var pType = info.type;

      var purchaseRecord = {
        id: Date.now(),
        sessionId: simSessionId,
        userId: effUserId,
        purchaseType: pType,
        lookupKey: lookupKey,
        title: info.title,
        price: info.price,
        membershipMonth: bounds.monthStr,
        startsAt: bounds.startsAt,
        endsAt: bounds.endsAt,
        purchasedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
        creditsTotal: info.credits || (pType === 'bono_mensual' ? 8 : (pType === 'bono_inicial' ? 4 : 1)),
        creditsRemaining: info.credits || (pType === 'bono_mensual' ? 8 : (pType === 'bono_inicial' ? 4 : 1)),
        planType: info.planType || (pType === 'bono_inicial' ? 'bono_inicial' : 'bono_mensual'),
        maxClassesPerWeek: info.maxPerWeek || (pType === 'bono_inicial' ? 1 : 2)
      };

      saveCertPurchase(purchaseRecord);

      // Intento no bloqueante de consolidación en base de datos si el usuario tiene permisos
      try {
        var clientToUse = window.client || (window.supabase && typeof window.supabase.createClient === 'function' ? window.supabase.createClient('${urlCert}', '${claveCert}') : null);
        if (clientToUse && effUserId && effUserId !== 'guest') {
          if (pType === 'bono_mensual') {
            clientToUse.rpc('admin_asignar_mes_bono_mensual', { p_user_id: effUserId, p_membership_month: bounds.monthDate, p_activo: true }).catch(function(){});
          } else if (pType === 'bono_inicial') {
            clientToUse.rpc('admin_asignar_mes_bono_inicial', { p_user_id: effUserId, p_membership_month: bounds.monthDate, p_activo: true }).catch(function(){});
          } else if (pType === 'bono_ilimitado') {
            clientToUse.rpc('admin_asignar_mes_ilimitado', { p_user_id: effUserId, p_membership_month: bounds.monthDate, p_activo: true }).catch(function(){});
          } else if (pType === 'pack_4' || pType === 'pack_6' || pType === 'pack_10' || pType === 'clase_suelta') {
            var cr = pType === 'pack_4' ? 4 : (pType === 'pack_6' ? 6 : (pType === 'pack_10' ? 10 : 1));
            clientToUse.rpc('ajustar_saldo_usuario', { p_user_id: effUserId, p_tipo: 'yoga', p_delta: cr }).catch(function(){});
          } else if (pType.indexOf('psico') !== -1) {
            clientToUse.rpc('ajustar_saldo_usuario', { p_user_id: effUserId, p_tipo: 'psicologia', p_delta: 1 }).catch(function(){});
          } else if (pType.indexOf('ayurveda') !== -1 || pType.indexOf('pni') !== -1) {
            var deltaN = pType.indexOf('bono3') !== -1 ? 3 : (pType.indexOf('bono6') !== -1 ? 6 : 1);
            clientToUse.rpc('ajustar_saldo_usuario', { p_user_id: effUserId, p_tipo: 'nutricion', p_delta: deltaN }).catch(function(){});
          } else if (pType.indexOf('grupo') !== -1) {
            clientToUse.rpc('ajustar_saldo_usuario', { p_user_id: effUserId, p_tipo: 'grupos', p_delta: 1 }).catch(function(){});
          }
        }
      } catch (_) {}

      var sessionPayload = {
        sessionId: simSessionId,
        lookupKey: lookupKey,
        purchaseType: pType,
        userId: effUserId,
        membershipMonth: bounds.monthStr,
        targetClassId: targetClassId,
        guestName: guestName,
        guestEmail: checkoutPayload.guest_email || 'test-cert@genyoga.studio',
        guestPhone: checkoutPayload.guest_phone || '600123456',
        from: fromOrigin,
        price: info.price,
        title: info.title,
        createdAt: new Date().toISOString()
      };

      try {
        localStorage.setItem('gy_cert_session_' + simSessionId, JSON.stringify(sessionPayload));
        sessionStorage.setItem('gy_cert_session_' + simSessionId, JSON.stringify(sessionPayload));
        localStorage.setItem('gy_cert_last_session', simSessionId);
        if (targetClassId) {
          localStorage.setItem('pending_booking_clase_id', String(targetClassId));
        }
      } catch (err) {
        console.warn('[cert-simulator] Storage error:', err);
      }

      setTimeout(function () {
        window.location.assign('success.html?session_id=' + encodeURIComponent(simSessionId));
      }, 700);
    });

    abandonBtn.addEventListener('click', function () {
      overlay.remove();
      window.location.assign('cancel.html?from=' + encodeURIComponent(fromOrigin));
    });

    closeBtn.addEventListener('click', function () {
      overlay.remove();
    });
  }

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');

    // 1) Interceptar creación de sesión de checkout
    if (url.indexOf('/functions/v1/create-checkout-session') !== -1) {
      console.log('[cert-simulator] Interceptada llamada a create-checkout-session');
      var body = {};
      try {
        if (init && init.body) {
          body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        }
      } catch (_) {}

      mostrarModalSimulacionPago(body);
      return new Promise(function () {});
    }

    // 2) Interceptar consulta y verificación de sesión en success.html
    if (url.indexOf('/functions/v1/get-checkout-session') !== -1) {
      var getBody = {};
      try {
        if (init && init.body) {
          getBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        }
      } catch (_) {}

      var sessionId = String(getBody.session_id || '').trim();
      if (sessionId.indexOf('cs_cert_') === 0 || sessionId.indexOf('cs_test_') === 0) {
        console.log('[cert-simulator] Resolviendo verificación simulada para:', sessionId);
        var stored = null;
        try {
          var raw = localStorage.getItem('gy_cert_session_' + sessionId) ||
                    sessionStorage.getItem('gy_cert_session_' + sessionId) ||
                    localStorage.getItem('gy_cert_session_' + localStorage.getItem('gy_cert_last_session'));
          if (raw) stored = JSON.parse(raw);
        } catch (_) {}

        var info = getProductInfo(stored && stored.lookupKey, stored && stored.membershipMonth);
        var isGuest = !stored || stored.userId === 'guest';
        var pType = (stored && stored.purchaseType) || info.type || 'clase_suelta';
        var isConsultation = /^(?:miriam_psico_|miriam_grupo_|miriam_psico_grupal|bono_grupal|bonos_grupos|prod_VDmmlmsGGhMebt|silvia_ayurveda_|isabel_pni_)/.test(pType);
        var isWorkshop = /^(?:clase_especial|taller_intro_power_vinyasa|taller_25|taller_35|taller)$/.test(pType);

        var rawName = (stored && stored.guestName) || 'Invitado CERT';
        var nameParts = rawName.trim().split(/\\s+/);

        var simResponse = {
          isGuest: isGuest,
          purchaseIsGuest: isGuest,
          isGuestConsultation: isConsultation,
          isGuestWorkshop: isWorkshop,
          purchaseType: pType,
          membershipMonth: (stored && stored.membershipMonth) || (new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0')),
          claseId: (stored && stored.targetClassId) || null,
          email: (stored && stored.guestEmail) || 'tester-cert@genyoga.studio',
          phone: (stored && stored.guestPhone) || '600123456',
          nombre: nameParts[0] || 'Invitado',
          apellidos: nameParts.slice(1).join(' ') || 'CERT',
          alreadyRedeemed: false,
          paymentStatus: 'paid'
        };

        return Promise.resolve(new Response(JSON.stringify(simResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
    }

    // 3) Interceptar reserva de clase de invitado tras compra simulada
    if (url.indexOf('/functions/v1/book-guest-class') !== -1) {
      var bookBody = {};
      try {
        if (init && init.body) {
          bookBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        }
      } catch (_) {}

      var bSessionId = String(bookBody.session_id || '').trim();
      if (bSessionId.indexOf('cs_cert_') === 0 || bSessionId.indexOf('cs_test_') === 0) {
        console.log('[cert-simulator] Confirmando reserva de invitado simulada:', bookBody);
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          message: 'Plaza reservada con éxito en modo certificación'
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
    }

    // 4) Interceptar acceso al portal de facturación en certificación
    if (url.indexOf('/functions/v1/create-portal-session') !== -1) {
      var portalBody = {};
      try {
        if (init && init.body) portalBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch (_) {}
      if (String(portalBody.session_id || '').indexOf('cs_cert_') === 0) {
        var msg = 'En certificación el portal de facturación de Stripe está simulado. En producción conecta con el Customer Portal de Stripe para gestionar facturas y suscripciones.';
        if (window.Swal && typeof window.Swal.fire === 'function') {
          window.Swal.fire({ icon: 'info', title: 'Portal simulado en CERT', text: msg, confirmButtonColor: '#956857' });
        } else {
          window.alert(msg);
        }
        return Promise.reject(new Error(msg));
      }
    }

    return originalFetch.apply(this, arguments);
  };
})();
</script>`;
    if (!out.includes('gy-cert-payment-simulator')) {
      out = out.replace(/(<\/head>)/i, `  ${simulator}\n  $1`);
    }
  }
  await writeFile(path.join(destino, file), out, 'utf8');
}

// JS, CSS y sitemap: solo se sustituye la configuración si aparece.
for (const file of jsCssXml) {
  const src = await readFile(path.join(origen, file), 'utf8');
  const out = src.replaceAll(PRODUCCION_URL, urlCert).replaceAll(PRODUCCION_CLAVE, claveCert).replaceAll('https://genyoga.studio', BASE_CERT);
  await writeFile(path.join(destino, file), out, 'utf8');
}

for (const dir of dirs) {
  await cp(path.join(origen, dir), path.join(destino, dir), { recursive: true });
}

// Ficheros estáticos que no son HTML/JS/CSS pero que las páginas referencian.
// Sin ellos el navegador registra 404 en cada carga (manifest) y pierde el icono.
for (const file of ['manifest.json', 'favicon.ico']) {
  const origenFichero = path.join(origen, file);
  try {
    await cp(origenFichero, path.join(destino, file));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    console.warn(`⚠️  No existe ${file} en ${origen}; se omite.`);
  }
}

// Sin CNAME: genyoga.studio pertenece a producción.
await writeFile(path.join(destino, '.nojekyll'), '', 'utf8');
await writeFile(path.join(destino, 'robots.txt'), 'User-agent: *\nDisallow: /\nSitemap: https://gen-yoga-studio.github.io/GEN-YOGA-CERT/sitemap.xml\n', 'utf8');
await writeFile(
  path.join(destino, 'cert.json'),
  JSON.stringify(
    {
      entorno: 'certificacion',
      version: pkg.version,
      supabase: urlCert.replace('https://', ''),
      pagos: pagosLive ? 'live-habilitados' : 'simulacion-tarjeta-activa',
      construido: new Date().toISOString(),
      aviso: pagosLive
        ? 'Entorno de pruebas con pagos LIVE habilitados explícitamente. No usar con datos reales.'
        : 'Entorno de pruebas con pasarela de pagos simulada. Permite validar compras con tarjeta sin cargos reales ni conexión a Stripe.',
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

console.log(`✅ Build de cert v${pkg.version}: ${htmls.length} páginas marcadas noindex, ${jsCssXml.length} ficheros estáticos.`);
console.log(`   Origen : ${origen}`);
console.log(`   Salida : ${destino}`);
console.log(`   Supabase: ${urlCert}`);
