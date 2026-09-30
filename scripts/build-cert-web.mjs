#!/usr/bin/env node
/**
 * scripts/build-cert-web.mjs — Artefacto web de certificación.
 *
 * Genera una copia de la web apuntando al proyecto Supabase DE CERTIFICACIÓN,
 * marcada como no indexable y sin CNAME (para no reclamar genyoga.studio).
 *
 * Requisitos (si faltan, falla con un mensaje claro):
 *   CERT_SUPABASE_URL              https://XXXX.supabase.co (distinto del de producción)
 *   CERT_SUPABASE_PUBLISHABLE_KEY  sb_publishable_… (distinto del de producción)
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
    console.error('   Certificación necesita su propio proyecto Supabase con datos de prueba.');
    console.error('   Guía: docs/CERTIFICATION_SETUP.md · guárdalo como secreto en el repo.');
    process.exit(1);
  }
  return v;
}

const urlCert = exigir('CERT_SUPABASE_URL');
const claveCert = exigir('CERT_SUPABASE_PUBLISHABLE_KEY');

if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(urlCert)) {
  console.error(`❌ CERT_SUPABASE_URL no es la URL raíz https://<proyecto>.supabase.co → ${urlCert}`);
  process.exit(1);
}
if (urlCert.includes(PRODUCCION_PROYECTO)) {
  console.error('❌ CERT_SUPABASE_URL apunta al proyecto de PRODUCCIÓN: certificación no puede usarlo.');
  process.exit(1);
}
if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(claveCert)) {
  console.error('❌ CERT_SUPABASE_PUBLISHABLE_KEY no tiene formato de clave pública de Supabase.');
  process.exit(1);
}
if (claveCert === PRODUCCION_CLAVE) {
  console.error('❌ CERT_SUPABASE_PUBLISHABLE_KEY es la clave de PRODUCCIÓN.');
  process.exit(1);
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
