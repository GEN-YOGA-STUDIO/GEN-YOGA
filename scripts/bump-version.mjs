import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentFullVersion = pkg.version || '6.42.0';
const parts = currentFullVersion.split('.').map(Number);

let nextMajor = parts[0] || 6;
let nextMinor = (parts[1] !== undefined ? parts[1] + 1 : 43);
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

const currentShort = `${parts[0]}.${parts[1]}`;
console.log(`\n======================================================`);
console.log(`📌 Actualizando versión: v${currentShort} -> v${targetShort} (${targetFull})`);
console.log(`======================================================`);

// 1. Root package.json
pkg.version = targetFull;
if (pkg.description) {
  pkg.description = pkg.description.replace(new RegExp(`versión\\s+\\d+\\.\\d+`, 'g'), `versión ${targetShort}`);
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`✅ Actualizado package.json (${targetFull})`);

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

// 3. Web HTML files & Edge Functions
const files = [
  'index.html',
  'clases.html',
  'tarifas.html',
  'maestros.html',
  'profile.html',
  'politica-privacidad.html',
  'success.html',
  'cancel.html',
  'supabase/functions/create-checkout-session/index.ts'
];

for (const rel of files) {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');

  content = content.replace(/\?v=\d+\.\d+/g, `?v=${targetShort}`);
  content = content.replace(/content="\d+\.\d+"/g, `content="${targetShort}"`);
  content = content.replace(/\bv\d+\.\d+\b/g, `v${targetShort}`);
  content = content.replace(/const APP_VERSION = '\d+\.\d+'/g, `const APP_VERSION = '${targetShort}'`);
  content = content.replace(/const APP_RELEASE = '\d+\.\d+'/g, `const APP_RELEASE = '${targetShort}'`);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Actualizado ${rel}`);
}

// 4. Android build.gradle (tanto en 'app android' como en 'ultima version/app android')
const androidGradlePaths = [
  path.join(root, 'app android', 'android', 'app', 'build.gradle'),
  path.join(root, 'ultima version', 'app android', 'android', 'app', 'build.gradle')
];

let currentAndroidBuild = 60;
for (const gp of androidGradlePaths) {
  if (fs.existsSync(gp)) {
    const m = fs.readFileSync(gp, 'utf8').match(/versionCode\s+(\d+)/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > currentAndroidBuild) currentAndroidBuild = v;
    }
  }
}
const nextAndroidBuild = buildArg && buildArg.trim() !== '' && parseInt(buildArg, 10) < 200 ? parseInt(buildArg, 10) : currentAndroidBuild + 1;

for (const gp of androidGradlePaths) {
  if (fs.existsSync(gp)) {
    let gradle = fs.readFileSync(gp, 'utf8');
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${nextAndroidBuild}`);
    gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${targetShort}"`);
    fs.writeFileSync(gp, gradle, 'utf8');
    console.log(`✅ Actualizado Android (${path.relative(root, gp)}): versionName "${targetShort}", versionCode ${nextAndroidBuild}`);
  }
}

// 5. iOS project.pbxproj (tanto en 'app ios' como en 'ultima version/app ios')
const iosPbxPaths = [
  path.join(root, 'app ios', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
  path.join(root, 'ultima version', 'app ios', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj')
];

let currentIosBuild = 242; // Base mínima conocida en App Store Connect (Build 242 ya fue subida)
for (const p of iosPbxPaths) {
  if (fs.existsSync(p)) {
    const matches = fs.readFileSync(p, 'utf8').match(/CURRENT_PROJECT_VERSION = (\d+);/g);
    if (matches) {
      for (const m of matches) {
        const val = parseInt(m.replace(/\D/g, ''), 10);
        if (val > currentIosBuild) currentIosBuild = val;
      }
    }
  }
}

const nextIosBuild = buildArg && parseInt(buildArg, 10) >= 200 ? parseInt(buildArg, 10) : currentIosBuild + 1;

for (const p of iosPbxPaths) {
  if (fs.existsSync(p)) {
    let pbx = fs.readFileSync(p, 'utf8');
    pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${targetShort};`);
    pbx = pbx.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${nextIosBuild};`);
    fs.writeFileSync(p, pbx, 'utf8');
    console.log(`✅ Actualizado iOS (${path.relative(root, p)}): MARKETING_VERSION = ${targetShort}, CURRENT_PROJECT_VERSION = ${nextIosBuild}`);
  }
}

console.log(`\n🎉 ¡Versión v${targetShort} (Android Build #${nextAndroidBuild} | iOS Build #${nextIosBuild}) actualizada en todas las plataformas!\n`);
