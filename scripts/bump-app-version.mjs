import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const appVerPath = path.join(root, 'app-version.json');
let appConfig = {
  version: '2.0.0',
  short: '2.0',
  build: 280,
  name: 'GenYoga Mobile',
};

if (fs.existsSync(appVerPath)) {
  appConfig = JSON.parse(fs.readFileSync(appVerPath, 'utf8'));
}

const currentFull = appConfig.version || '2.0.0';
const currentBuild = appConfig.build || 280;
const parts = currentFull.split('.').map(Number);

let nextMajor = parts[0] || 2;
let nextMinor = (parts[1] !== undefined ? parts[1] + 1 : 1);
let nextPatch = 0;

const targetArg = process.argv[2];
const buildArg = process.argv[3];

let targetShort = `${nextMajor}.${nextMinor}`;
let targetFull = `${nextMajor}.${nextMinor}.${nextPatch}`;

if (targetArg && targetArg.trim() !== '') {
  let cleaned = targetArg.trim().startsWith('v') ? targetArg.trim().slice(1) : targetArg.trim();
  const tParts = cleaned.split('.');
  if (tParts.length === 2) {
    targetShort = cleaned;
    targetFull = `${cleaned}.0`;
  } else if (tParts.length === 3) {
    targetFull = cleaned;
    targetShort = `${tParts[0]}.${tParts[1]}`;
  }
}

const explicitBuild = buildArg && buildArg.trim() !== '' ? parseInt(buildArg, 10) : null;
const nextBuild = explicitBuild || currentBuild + 1;

console.log(`\n======================================================`);
console.log(`📱 Actualizando versión de APPS NATIVAS: v${appConfig.version} (b${currentBuild}) -> v${targetFull} (b${nextBuild})`);
console.log(`======================================================`);

// 1. app-version.json
appConfig.version = targetFull;
appConfig.short = targetShort;
appConfig.build = nextBuild;
appConfig.updatedAt = new Date().toISOString().slice(0, 10);
if (appConfig.platforms) {
  if (appConfig.platforms.android) {
    appConfig.platforms.android.versionName = targetShort;
    appConfig.platforms.android.versionCode = nextBuild;
  }
  if (appConfig.platforms.ios) {
    appConfig.platforms.ios.marketingVersion = targetShort;
    appConfig.platforms.ios.currentProjectVersion = nextBuild;
  }
}
fs.writeFileSync(appVerPath, JSON.stringify(appConfig, null, 2) + '\n', 'utf8');
console.log(`✅ Actualizado app-version.json (${targetFull}, build ${nextBuild})`);

// 2. Android & iOS package.json
for (const sub of ['app android', 'app ios']) {
  const subPkgPath = path.join(root, sub, 'package.json');
  if (fs.existsSync(subPkgPath)) {
    const subPkg = JSON.parse(fs.readFileSync(subPkgPath, 'utf8'));
    subPkg.version = targetFull;
    fs.writeFileSync(subPkgPath, JSON.stringify(subPkg, null, 2) + '\n', 'utf8');
    console.log(`✅ Actualizado ${sub}/package.json (${targetFull})`);
  }
}

// 3. Android build.gradle
const androidGradlePaths = [
  path.join(root, 'app android', 'android', 'app', 'build.gradle'),
  path.join(root, 'ultima version', 'app android', 'android', 'app', 'build.gradle'),
];

for (const gp of androidGradlePaths) {
  if (fs.existsSync(gp)) {
    let gradle = fs.readFileSync(gp, 'utf8');
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${nextBuild}`);
    gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${targetShort}"`);
    fs.writeFileSync(gp, gradle, 'utf8');
    console.log(`✅ Actualizado Android (${path.relative(root, gp)}): versionName "${targetShort}", versionCode ${nextBuild}`);
  }
}

// 4. iOS project.pbxproj
const iosPbxPaths = [
  path.join(root, 'app ios', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
  path.join(root, 'ultima version', 'app ios', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
];

for (const p of iosPbxPaths) {
  if (fs.existsSync(p)) {
    let pbx = fs.readFileSync(p, 'utf8');
    pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${targetShort};`);
    pbx = pbx.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${nextBuild};`);
    fs.writeFileSync(p, pbx, 'utf8');
    console.log(`✅ Actualizado iOS (${path.relative(root, p)}): MARKETING_VERSION = ${targetShort}, CURRENT_PROJECT_VERSION = ${nextBuild}`);
  }
}

console.log(`\n🎉 Apps nativas actualizadas a v${targetShort} (Build #${nextBuild}).`);
console.log(`ℹ️ Recuerda documentar este cambio en CAMBIOS-APPS.md.`);
