import { createHash } from 'node:crypto';
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

const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const exists = async (abs) => {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
};

// Ficheros web que deben ser idénticos entre la raíz y cada bundle móvil.
const tracked = [
  'index.html', 'clases.html', 'tarifas.html', 'maestros.html',
  'profile.html', 'politica-privacidad.html', 'success.html', 'cancel.html',
  'capacitor-bridge.js', 'i18n.js', 'public-calendar.js', 'public-calendar.css',
  'teacher-profiles.js', 'facilities-carousel.js', 'tailwind-compiled.css',
];

const targets = [
  'app android/www',
  'app ios/www',
  'app android/android/app/src/main/assets/public',
  'app ios/ios/App/App/public',
];

console.log('\n--- 1. Bundles móviles al día con la raíz ---');
const hashes = {};
for (const file of tracked) {
  hashes[file] = sha256(await readFile(path.join(root, file), 'utf8'));
}

for (const target of targets) {
  const stale = [];
  const missing = [];
  for (const file of tracked) {
    const abs = path.join(root, target, file);
    if (!(await exists(abs))) {
      missing.push(file);
      continue;
    }
    const digest = sha256(await readFile(abs, 'utf8'));
    if (digest !== hashes[file]) stale.push(file);
  }
  if (missing.length === 0 && stale.length === 0) {
    pass(`${target}: sincronizado (${tracked.length} ficheros)`);
  } else {
    if (missing.length > 0) fail(`${target}: faltan ${missing.length} fichero(s): ${missing.join(', ')}`);
    if (stale.length > 0) fail(`${target}: ${stale.length} fichero(s) obsoletos (ejecuta sync + cap sync): ${stale.join(', ')}`);
  }
}

console.log('\n--- 2. Sin lastre en los bundles ---');
const bannedTopLevel = [/\.md$/i, /^package.*\.json$/i, /^deno\.lock$/i, /^CNAME$/i, /^tailwind\.config\.js$/i, /^tailwind-input\.css$/i, /^opencode\.jsonc?$/i, /mac mini/i, /^\.gitignore$/i, /^\.Rhistory$/i];
for (const target of targets) {
  const entries = await readdir(path.join(root, target));
  const banned = entries.filter((name) => bannedTopLevel.some((re) => re.test(name)));
  if (banned.length === 0) pass(`${target}: sin ficheros excluidos`);
  else fail(`${target}: lastre presente: ${banned.join(', ')}`);
  if (await exists(path.join(root, target, 'scripts'))) {
    fail(`${target}: contiene scripts/ (código de tooling en la app)`);
  } else {
    pass(`${target}: sin scripts/`);
  }
  for (const dead of ['supabase', 'vibe_images']) {
    if (await exists(path.join(root, target, dead))) {
      fail(`${target}: contiene ${dead}/ (no forma parte de la app)`);
    } else {
      pass(`${target}: sin ${dead}/`);
    }
  }
}

console.log('\n--- 3. Sin vídeos huérfanos pesados ---');
for (const target of targets) {
  const video = path.join(root, target, 'img', 'video1.mp4');
  if (await exists(video)) fail(`${target}: img/video1.mp4 sin referencias (ocupa ~1 MB en la app)`);
  else pass(`${target}: sin vídeos huérfanos`);
}

console.log('\n--- 4. img/ y fonts/ espejo de la raíz (sin huérfanos) ---');
async function mirrorCheck(subdir) {
  const expected = new Map();
  for (const entry of await readdir(path.join(root, subdir), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const content = await readFile(path.join(root, subdir, entry.name));
    expected.set(entry.name, sha256(content));
  }
  for (const target of targets) {
    const dir = path.join(root, target, subdir);
    if (!(await exists(dir))) {
      fail(`${target}: falta el directorio ${subdir}/`);
      continue;
    }
    const orphans = [];
    const drifted = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!expected.has(entry.name)) orphans.push(entry.name);
      else if (sha256(await readFile(path.join(dir, entry.name))) !== expected.get(entry.name)) drifted.push(entry.name);
    }
    const actual = await readdirNames(dir);
    const missing = [...expected.keys()].filter((name) => !actual.has(name));
    if (orphans.length === 0 && drifted.length === 0 && missing.length === 0) pass(`${target}/${subdir}: espejo exacto (${expected.size} ficheros)`);
    else {
      if (orphans.length > 0) fail(`${target}/${subdir}: huérfanos (no están en la raíz): ${orphans.join(', ')}`);
      if (drifted.length > 0) fail(`${target}/${subdir}: contenido distinto a la raíz: ${drifted.join(', ')}`);
      if (missing.length > 0) fail(`${target}/${subdir}: faltan: ${missing.join(', ')}`);
    }
  }
}

const dirCache = new Map();
async function readdirNames(dir) {
  if (!dirCache.has(dir)) {
    dirCache.set(dir, new Set((await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)));
  }
  return dirCache.get(dir);
}

await mirrorCheck('img');
await mirrorCheck('fonts');

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-app-sync: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-app-sync: bundles móviles sincronizados y limpios.');
