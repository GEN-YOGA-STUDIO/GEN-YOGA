import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Gemelidad bilateral iOS ↔ Android: las apps deben ser idénticas en todo
// lo que ve el usuario (versión, contenido web, navegación permitida, plugins).
// Lo nativo irreducible (Xcode vs Gradle) queda fuera por diseño.
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

const read = (rel) => readFile(path.join(root, rel), 'utf8');
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

console.log('\n--- 1. Versión y build gemelos ---');
const gradle = await read('app android/android/app/build.gradle');
const pbxproj = await read('app ios/ios/App/App.xcodeproj/project.pbxproj');
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
const versionCode = gradle.match(/versionCode\s+(\d+)/)?.[1];
const marketing = [...new Set([...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim()))];
const builds = [...new Set([...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1])))];
check(`versionName (${versionName}) = MARKETING_VERSION (${marketing.join(',')})`, marketing.length === 1 && marketing[0] === versionName);
check(`versionCode (${versionCode}) = CURRENT_PROJECT_VERSION (${builds.join(',')})`, builds.length === 1 && String(builds[0]) === versionCode);

console.log('\n--- 2. Config Capacitor simétrica ---');
const androidCfg = JSON.parse(await read('app android/capacitor.config.json'));
const iosCfg = JSON.parse(await read('app ios/capacitor.config.json'));
check('appId Android = gen.yoga.app (historial Play)', androidCfg.appId === 'gen.yoga.app', `visto: ${androidCfg.appId}`);
check('appId iOS = com.genyoga.app', iosCfg.appId === 'com.genyoga.app', `visto: ${iosCfg.appId}`);
check('mismo appName', androidCfg.appName === iosCfg.appName);
const navA = [...new Set(androidCfg.server?.allowNavigation || [])].sort();
const navI = [...new Set(iosCfg.server?.allowNavigation || [])].sort();
check(
  'mismo allowNavigation',
  JSON.stringify(navA) === JSON.stringify(navI),
  `solo Android: ${navA.filter((h) => !navI.includes(h)).join(',')} | solo iOS: ${navI.filter((h) => !navA.includes(h)).join(',')}`,
);
const plugA = Object.keys(androidCfg.plugins || {}).sort();
const plugI = Object.keys(iosCfg.plugins || {}).sort();
check('mismos plugins', JSON.stringify(plugA) === JSON.stringify(plugI), `${plugA.join(',')} vs ${plugI.join(',')}`);

console.log('\n--- 3. Contenido web idéntico byte a byte ---');
const pairs = [
  ['app android/www', 'app ios/www'],
  ['app android/android/app/src/main/assets/public', 'app ios/ios/App/App/public'],
];
const collect = async (dir) => {
  const out = new Map();
  const walk = async (abs, rel) => {
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      const a = path.join(abs, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (['img', 'fonts'].includes(r)) {
          for (const f of await readdir(a, { withFileTypes: true })) {
            if (f.isFile()) out.set(`${r}/${f.name}`, sha256(await readFile(path.join(a, f.name))));
          }
        } else await walk(a, r);
      } else if (entry.isFile()) out.set(r, sha256(await readFile(a)));
    }
  };
  await walk(path.join(root, dir), '');
  return out;
};
for (const [left, right] of pairs) {
  const a = await collect(left);
  const b = await collect(right);
  // Excluye artefactos generados propios de cada plataforma.
  const skip = /^(cordova\.js|cordova_plugins\.js|capacitor\.config\.json|app\.js|profile\.js|profile\.css|styles\.css|package.*\.json)$/;
  const keys = new Set([...a.keys(), ...b.keys()].filter((k) => !skip.test(k.split('/').pop())));
  const diff = [...keys].filter((k) => a.get(k) !== b.get(k));
  const onlySide = [...keys].filter((k) => !a.has(k) || !b.has(k));
  if (diff.length === 0) pass(`${left.split('/')[0]} ↔ ${right.split('/')[0]}: idénticos (${keys.size} ficheros)`);
  else fail(`diferencias iOS↔Android: ${diff.slice(0, 10).join(', ')}${diff.length > 10 ? `… (+${diff.length - 10})` : ''}${onlySide.length ? ` | solo en un lado: ${onlySide.slice(0, 5).join(', ')}` : ''}`);
}

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-app-twins: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-app-twins: iOS y Android gemelas.');
