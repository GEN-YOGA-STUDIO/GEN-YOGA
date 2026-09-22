import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const read = (rel) => readFile(path.join(root, rel), 'utf8');

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

const pkg = JSON.parse(await read('package.json'));
const full = pkg.version;
const short = full.split('.').slice(0, 2).join('.');

console.log(`\n--- 1. Versión raíz: ${full} ---`);
check('package.json raíz tiene versión semver', /^\d+\.\d+\.\d+$/.test(full), `visto: ${full}`);

const pages = [
  'index.html', 'clases.html', 'tarifas.html', 'maestros.html',
  'profile.html', 'politica-privacidad.html', 'success.html', 'cancel.html',
];

console.log('\n--- 2. Versión visual coherente en las 8 páginas ---');
for (const page of pages) {
  const source = await read(page);
  const pinned = [...source.matchAll(/\?v=(\d+\.\d+)/g)].map((m) => m[1]);
  const unique = [...new Set(pinned)];
  check(`${page}: ?v= apunta a ${short}`, pinned.length > 0 && unique.length === 1 && unique[0] === short, `visto: ${unique.join(', ') || 'nada'}`);
  const meta = source.match(/<meta\s+name=["']application-version["']\s+content=["']([^"']+)["']/i)?.[1];
  check(`${page}: meta application-version = ${short}`, meta === short, `visto: ${meta}`);
  check(`${page}: incluye capacitor-bridge.js?v=${short}`, source.includes(`capacitor-bridge.js?v=${short}`));
}

console.log('\n--- 3. package.json de apps ---');
for (const sub of ['app android', 'app ios']) {
  const subPkg = JSON.parse(await read(`${sub}/package.json`));
  check(`${sub}/package.json = ${full}`, subPkg.version === full, `visto: ${subPkg.version}`);
}

console.log('\n--- 4. Versión en Edge Functions ---');
const checkoutFn = await read('supabase/functions/create-checkout-session/index.ts');
const appRelease = checkoutFn.match(/const APP_RELEASE = '([^']+)'/)?.[1];
const appVersion = checkoutFn.match(/const APP_VERSION = '([^']+)'/)?.[1];
check(`APP_RELEASE = ${short}`, appRelease === short, `visto: ${appRelease}`);
if (appVersion !== undefined) check(`APP_VERSION = ${short}`, appVersion === short, `visto: ${appVersion}`);

console.log('\n--- 5. Build numbers nativos ---');
const gradle = await read('app android/android/app/build.gradle');
const versionName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
check(`Android versionName = ${short}`, versionName === short, `visto: ${versionName}`);
check('Android versionCode numérico', Number.isInteger(versionCode) && versionCode > 0, `visto: ${versionCode}`);

const pbxproj = await read('app ios/ios/App/App.xcodeproj/project.pbxproj');
const marketing = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim());
const builds = [...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
check(`iOS MARKETING_VERSION = ${short} (Debug y Release)`, marketing.length >= 2 && new Set(marketing).size === 1 && marketing[0] === short, `visto: ${[...new Set(marketing)].join(', ')}`);
check('iOS CURRENT_PROJECT_VERSION único', builds.length >= 2 && new Set(builds).size === 1, `visto: ${[...new Set(builds)].join(', ')}`);
check(`Build Android (${versionCode}) = build iOS (${builds[0]})`, versionCode === builds[0], 'los stores deben publicar el mismo build');

console.log('\n--- 6. Identidad de app por plataforma (gemelas salvo package) ---');
// Android conserva gen.yoga.app por el historial de Play Store; iOS usa
// com.genyoga.app. Gemelas en todo lo visible; distinto solo el identificador.
const ANDROID_APP_ID = 'gen.yoga.app';
const IOS_APP_ID = 'com.genyoga.app';
const capacitorPaths = [
  ['app android/capacitor.config.json', ANDROID_APP_ID],
  ['app ios/capacitor.config.json', IOS_APP_ID],
  ['app android/android/app/src/main/assets/capacitor.config.json', ANDROID_APP_ID],
  ['app ios/ios/App/App/capacitor.config.json', IOS_APP_ID],
];
for (const [p, expected] of capacitorPaths) {
  let cfg;
  try {
    cfg = JSON.parse(await read(p));
  } catch {
    fail(`${p}: ilegible o ausente — ejecuta 'npx cap sync' en su plataforma y repite`);
    continue;
  }
  check(`${p}: appId = ${expected}`, cfg.appId === expected, `visto: ${cfg.appId}`);
}
check('appIds con formato reverse-DNS', [ANDROID_APP_ID, IOS_APP_ID].every((id) => /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(id)));
check('Android namespace = appId Android', gradle.includes(`namespace = "${ANDROID_APP_ID}"`));
check('Android applicationId = appId Android', gradle.includes(`applicationId "${ANDROID_APP_ID}"`));
const mainActivity = await read('app android/android/app/src/main/java/gen/yoga/app/MainActivity.java').catch(() => '');
check('MainActivity en paquete Android', mainActivity.includes(`package ${ANDROID_APP_ID};`));
const stringsXml = await read('app android/android/app/src/main/res/values/strings.xml');
check('strings.xml package_name = appId Android', stringsXml.includes(`<string name="package_name">${ANDROID_APP_ID}</string>`));
const manifest = await read('app android/android/app/src/main/AndroidManifest.xml');
check('Manifest deep-link scheme = appId Android', manifest.includes(`<data android:scheme="${ANDROID_APP_ID}"`));
const infoPlist = await read('app ios/ios/App/App/Info.plist');
check('Info.plist CFBundleURLSchemes incluye appId iOS', infoPlist.includes('<key>CFBundleURLSchemes</key>') && infoPlist.includes(`<string>${IOS_APP_ID}</string>`));
const bundleIds = [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1].trim());
check('iOS PRODUCT_BUNDLE_IDENTIFIER = appId iOS', bundleIds.length >= 2 && new Set(bundleIds).size === 1 && bundleIds[0] === IOS_APP_ID, `visto: ${[...new Set(bundleIds)].join(', ')}`);

console.log('\n--- 7. Proyecto Supabase coherente ---');
const configToml = await read('supabase/config.toml');
const projectId = configToml.match(/project_id\s*=\s*"([^"]+)"/)?.[1];
check('config.toml tiene project_id', Boolean(projectId));
if (projectId) {
  const refs = new Set();
  for (const page of pages) {
    const source = await read(page);
    for (const m of source.matchAll(/https:\/\/([a-z0-9]{10,})\.supabase\.co/g)) refs.add(m[1]);
  }
  check(`frontend usa el proyecto ${projectId}`, refs.size === 1 && refs.has(projectId), `visto: ${[...refs].join(', ') || 'nada'}`);
}

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-release-consistency: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-release-consistency: coherencia de release verificada.');
