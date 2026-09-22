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

const androidCfg = JSON.parse(await read('app android/capacitor.config.json'));
const appId = androidCfg.appId;
const manifest = await read('app android/android/app/src/main/AndroidManifest.xml');
const pbxproj = await read('app ios/ios/App/App.xcodeproj/project.pbxproj');
const teams = [...new Set([...pbxproj.matchAll(/DEVELOPMENT_TEAM = ([^;]+);/g)].map((m) => m[1].trim()))];
const team = teams[0];

console.log('\n--- 1. Android App Links ---');
const assetlinks = JSON.parse(await read('.well-known/assetlinks.json'));
const target = assetlinks?.[0]?.target;
check('assetlinks.json apunta al package de la app', target?.package_name === appId, `visto: ${target?.package_name}`);
const prints = target?.sha256_cert_fingerprints || [];
check(
  'assetlinks.json con huella(s) SHA-256 válida(s)',
  prints.length > 0 && prints.every((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)),
  `visto: ${prints.join(', ') || 'ninguna'}`,
);
check('assetlinks.json delega handle_all_urls', JSON.stringify(assetlinks?.[0]?.relation || []).includes('handle_all_urls'));
check('Manifest declara intent-filter autoVerify', manifest.includes('android:autoVerify="true"'));
const manifestHosts = [...manifest.matchAll(/<data android:scheme="https" android:host="([^"]+)" \/>/g)].map((m) => m[1]);
check('Manifest verifica genyoga.studio', manifestHosts.includes('genyoga.studio'), `hosts: ${manifestHosts.join(', ') || 'ninguno'}`);
check('Manifest tiene windowSoftInputMode=adjustResize (teclado)', manifest.includes('android:windowSoftInputMode="adjustResize"'));

console.log('\n--- 2. iOS Universal Links ---');
const aasa = JSON.parse(await read('.well-known/apple-app-site-association'));
const applinks = aasa?.applinks?.details?.[0];
check('TEAM único en el proyecto iOS', teams.length === 1 && /^[A-Z0-9]{10}$/.test(team), `visto: ${teams.join(', ')}`);
const expectedAppId = `${team}.${appId}`;
check(`AASA applinks incluye ${expectedAppId}`, (applinks?.appIDs || []).includes(expectedAppId), `visto: ${(applinks?.appIDs || []).join(', ')}`);
check('AASA cubre success/cancel (retorno de Stripe)', (applinks?.paths || []).some((p) => p.includes('success.html')) && (applinks?.paths || []).some((p) => p.includes('cancel.html')), `paths: ${(applinks?.paths || []).join(', ')}`);
check('AASA webcredentials incluye la app', (aasa?.webcredentials?.apps || []).includes(expectedAppId));

const entMatches = [...pbxproj.matchAll(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/g)].map((m) => m[1].trim());
check('Entitlements registrado en Debug y Release', entMatches.length >= 2 && new Set(entMatches).size === 1, `visto: ${[...new Set(entMatches)].join(', ')}`);
const entitlements = await read(`app ios/ios/App/${entMatches[0]}`);
const aasaHosts = ['genyoga.studio'];
for (const host of aasaHosts) {
  check(`Entitlements declara applinks:${host}`, entitlements.includes(`<string>applinks:${host}</string>`));
}
const infoPlist = await read('app ios/ios/App/App/Info.plist');
check('Info.plist sin NSAllowsArbitraryLoads global', !infoPlist.includes('<key>NSAllowsArbitraryLoads</key>'));

console.log('\n--- 3. Plugins nativos sincronizados (cap sync) ---');
for (const [sub, registryRel, kind] of [
  ['app android', 'android/app/src/main/assets/capacitor.plugins.json', 'classpath'],
  ['app ios', 'ios/App/CapApp-SPM/Package.swift', 'spm'],
]) {
  const subPkg = JSON.parse(await read(`${sub}/package.json`));
  const expected = Object.keys(subPkg.dependencies || {}).filter((d) => d.startsWith('@capacitor/') && !['@capacitor/cli', '@capacitor/core', '@capacitor/android', '@capacitor/ios'].includes(d));
  const registry = await read(`${sub}/${registryRel}`);
  const missing = expected.filter((dep) => {
    if (kind === 'classpath') return !registry.includes(`"${dep}"`);
    const suffix = dep.replace('@capacitor/', '').split('-').map((s) => s[0].toUpperCase() + s.slice(1)).join('');
    return !registry.includes(`Capacitor${suffix}`);
  });
  check(`${sub}: ${expected.length} plugins registrados en nativo`, missing.length === 0, `faltan: ${missing.join(', ')}`);
}

console.log('\n--- 4. Bridge de retorno de pago ---');
const bridge = await read('capacitor-bridge.js');
check('bridge gestiona appUrlOpen (deep link)', bridge.includes("App.addListener('appUrlOpen'"));
check('bridge abre Stripe fuera del WebView', bridge.includes('checkout.stripe.com') && bridge.includes('billing.stripe.com'));

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-native-links: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-native-links: cadena de deep links verificada.');
