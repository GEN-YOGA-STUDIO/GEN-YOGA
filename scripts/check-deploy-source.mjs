import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function fail(message) {
  errors.push(message);
  console.error(`  ❌ ${message}`);
}

function pass(message) {
  console.log(`  ✅ ${message}`);
}

function check(desc, condition, hint = '') {
  if (condition) pass(desc);
  else fail(hint ? `${desc} — ${hint}` : desc);
}

const exists = async (abs) => {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
};

const expectedPages = [
  'cancel.html', 'clases.html', 'index.html', 'maestros.html',
  'politica-privacidad.html', 'profile.html', 'success.html', 'tarifas.html',
];

async function countWoff2(dir) {
  let count = 0;
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return -1;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) count += await countWoff2(abs);
    else if (entry.name.endsWith('.woff2')) count++;
  }
  return count;
}

async function checkSource(label, base) {
  console.log(`\n--- Fuente de deploy: ${label} ---`);
  const abs = path.join(root, base);
  const html = (await readdir(abs)).filter((n) => n.toLowerCase().endsWith('.html')).sort();
  const missingPages = expectedPages.filter((p) => !html.includes(p));
  check(`${label}: 8 páginas HTML`, missingPages.length === 0, `faltan: ${missingPages.join(', ')}`);
  const js = (await readdir(abs)).filter((n) => n.toLowerCase().endsWith('.js'));
  check(`${label}: JS presente (bridge/i18n)`, js.includes('capacitor-bridge.js') && js.includes('i18n.js'), `vistos: ${js.join(', ') || 'ninguno'}`);
  const css = (await readdir(abs)).filter((n) => n.toLowerCase().endsWith('.css'));
  check(`${label}: CSS compilado presente`, css.includes('tailwind-compiled.css'), `vistos: ${css.join(', ') || 'ninguno'}`);
  check(`${label}: CNAME presente`, await exists(path.join(abs, 'CNAME')));
  const imgCount = (await readdir(path.join(abs, 'img')).catch(() => [])).length;
  check(`${label}: img/ con contenido`, imgCount > 10, `vistos: ${imgCount}`);
  const fontCount = await countWoff2(path.join(abs, 'fonts'));
  check(`${label}: fonts/ con woff2`, fontCount >= 7, `vistos: ${fontCount}`);
  check(`${label}: .well-known/assetlinks.json`, await exists(path.join(abs, '.well-known', 'assetlinks.json')));
  check(`${label}: .well-known/apple-app-site-association`, await exists(path.join(abs, '.well-known', 'apple-app-site-association')));
}

await checkSource('ultima version (Pages)', 'ultima version');
await checkSource('raíz (fallback Pages)', '.');

const rootCname = (await readFile(path.join(root, 'CNAME'), 'utf8')).trim();
const ultimaCname = (await readFile(path.join(root, 'ultima version', 'CNAME'), 'utf8')).trim();
check(`CNAME idéntico (raíz y ultima: ${rootCname})`, rootCname === ultimaCname && rootCname.length > 0, `raíz='${rootCname}' ultima='${ultimaCname}'`);

const workflow = await readFile(path.join(root, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');
check('workflow despliega .well-known', workflow.includes('.well-known'));

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-deploy-source: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-deploy-source: fuente de deploy verificada.');
