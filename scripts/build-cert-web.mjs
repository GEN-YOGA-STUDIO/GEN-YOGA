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

const entradas = await readdir(origen, { withFileTypes: true });
const htmls = entradas.filter((e) => e.isFile() && e.name.endsWith('.html')).map((e) => e.name);
const jsCssXml = entradas
  .filter((e) => e.isFile() && /\.(js|css|xml)$/.test(e.name))
  .map((e) => e.name);
const dirs = entradas.filter((e) => e.isDirectory() && ['img', 'fonts', '.well-known'].includes(e.name)).map((e) => e.name);

if (htmls.length !== 8) {
  console.error(`❌ Se esperaban 8 páginas HTML en ${origen} y hay ${htmls.length}: aborto.`);
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
    .replaceAll(PRODUCCION_CLAVE, claveCert);

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

  // Banner visible de entorno de pruebas (no bloquea clics: pointer-events none).
  const banner = mismoProyecto
    ? '<div id="gy-cert-banner" aria-hidden="true" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(38,22,12,.92);color:#f8f6f2;font:600 11px/22px system-ui,-apple-system,sans-serif;text-align:center;letter-spacing:.04em;pointer-events:none">ENTORNO DE PRUEBAS (cert) · misma base de datos que producción · pagos habilitados para pruebas</div>'
    : '<div id="gy-cert-banner" aria-hidden="true" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:rgba(38,22,12,.92);color:#f8f6f2;font:600 11px/22px system-ui,-apple-system,sans-serif;text-align:center;letter-spacing:.04em;pointer-events:none">ENTORNO DE PRUEBAS (cert) · pagos habilitados para pruebas</div>';
  if (!out.includes('gy-cert-banner')) {
    out = out.replace(/(<body[^>]*>)/i, `$1\n  ${banner}`);
  }
  await writeFile(path.join(destino, file), out, 'utf8');
}

// JS, CSS y sitemap: solo se sustituye la configuración si aparece.
for (const file of jsCssXml) {
  const src = await readFile(path.join(origen, file), 'utf8');
  const out = src.replaceAll(PRODUCCION_URL, urlCert).replaceAll(PRODUCCION_CLAVE, claveCert);
  await writeFile(path.join(destino, file), out, 'utf8');
}

for (const dir of dirs) {
  await cp(path.join(origen, dir), path.join(destino, dir), { recursive: true });
}

// Sin CNAME: genyoga.studio pertenece a producción.
await writeFile(path.join(destino, '.nojekyll'), '', 'utf8');
await writeFile(
  path.join(destino, 'cert.json'),
  JSON.stringify(
    {
      entorno: 'certificacion',
      version: pkg.version,
      supabase: urlCert.replace('https://', ''),
      construido: new Date().toISOString(),
      aviso: 'Entorno de pruebas. No usar con datos ni pagos reales.',
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
