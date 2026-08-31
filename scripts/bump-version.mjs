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

// 4. Android build.gradle
const gradlePath = path.join(root, 'app android', 'android', 'app', 'build.gradle');
let nextBuild = 61;
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  const vcMatch = gradle.match(/versionCode\s+(\d+)/);
  const currentBuild = vcMatch ? parseInt(vcMatch[1], 10) : 60;
  nextBuild = buildArg && buildArg.trim() !== '' ? parseInt(buildArg, 10) : currentBuild + 1;

  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${nextBuild}`);
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${targetShort}"`);
  fs.writeFileSync(gradlePath, gradle, 'utf8');
  console.log(`✅ Actualizado Android build.gradle (versionName "${targetShort}", versionCode ${nextBuild})`);
}

// 5. iOS project.pbxproj
const pbxPath = path.join(root, 'app ios', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
if (fs.existsSync(pbxPath)) {
  let pbx = fs.readFileSync(pbxPath, 'utf8');
  pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${targetShort};`);
  pbx = pbx.replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${nextBuild};`);
  fs.writeFileSync(pbxPath, pbx, 'utf8');
  console.log(`✅ Actualizado iOS project.pbxproj (MARKETING_VERSION = ${targetShort}, CURRENT_PROJECT_VERSION = ${nextBuild})`);
}

console.log(`\n🎉 ¡Versión v${targetShort} (Build #${nextBuild}) actualizada en todas las plataformas!\n`);
