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
  'cancel.html',
  'clases.html',
  'index.html',
  'maestros.html',
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

  // Banner visible de entorno de pruebas. Es fijo para permanecer visible,
  // pero el body reserva su altura (34 px escritorio / 48 px móvil) para no
  // tapar el marquee, el botón INICIO ni los títulos. En móvil el texto puede
  // ocupar dos líneas; el padding se dimensiona para ambas.
  const textoBanner = pagosLive
    ? 'CERT · ENTORNO DE PRUEBAS · PAGOS LIVE HABILITADOS · MISMA BD QUE PRODUCCIÓN'
    : 'CERT · ENTORNO DE PRUEBAS · PAGOS DESACTIVADOS · MISMA BD QUE PRODUCCIÓN';
  const banner = `<style id="gy-cert-banner-style">
  #gy-cert-banner { position:fixed; top:0; left:0; right:0; z-index:9997; background:rgba(38,22,12,.96); color:#f8f6f2; font:600 12px/1.35 system-ui,-apple-system,sans-serif; text-align:center; letter-spacing:.03em; padding:5px 12px; pointer-events:none; }
  body { padding-top:34px !important; }
  @media (max-width:640px) { body { padding-top:48px !important; } }
  html { scroll-padding-top:44px; }
</style>
<div id="gy-cert-banner" role="note">${textoBanner}</div>`;
  if (!out.includes('gy-cert-banner')) {
    out = out.replace(/(<body[^>]*>)/i, `$1\n  ${banner}`);
  }

  // Guard de pagos: el cert comparte la BD de producción. Sin un backend de
  // Stripe TEST aislado, cualquier checkout acabaría en un cargo real. Se
  // intercepta la llamada a la Edge Function antes de que salga del navegador.
  if (!pagosLive) {
    const guard = `<script id="gy-cert-payment-guard">
(function () {
  window.__GY_CERT_PAYMENTS_DISABLED__ = true;
  var originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    if (url.indexOf('/functions/v1/create-checkout-session') !== -1) {
      var message = 'Entorno de certificación: los pagos están desactivados. No se ha realizado ningún cargo.';
      console.warn('[cert] Checkout bloqueado:', url);
      if (window.Swal && typeof window.Swal.fire === 'function') {
        window.Swal.fire({ icon: 'info', title: 'Pagos desactivados en certificación', text: message, confirmButtonColor: '#956857' });
      } else {
        window.alert(message);
      }
      return Promise.reject(new Error(message));
    }
    return originalFetch.apply(this, arguments);
  };
})();
</script>`;
    if (!out.includes('gy-cert-payment-guard')) {
      out = out.replace(/(<\/head>)/i, `  ${guard}\n  $1`);
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
await writeFile(path.join(destino, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');
await writeFile(
  path.join(destino, 'cert.json'),
  JSON.stringify(
    {
      entorno: 'certificacion',
      version: pkg.version,
      supabase: urlCert.replace('https://', ''),
      pagos: pagosLive ? 'live-habilitados' : 'desactivados',
      construido: new Date().toISOString(),
      aviso: pagosLive
        ? 'Entorno de pruebas con pagos LIVE habilitados explícitamente. No usar con datos reales.'
        : 'Entorno de pruebas. Pagos desactivados en el navegador y datos compartidos con producción.',
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
