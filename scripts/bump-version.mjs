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

const syncApps = process.argv.includes('--apps') || process.argv.includes('--include-apps');

// 2. Android & iOS package.json (solo si se pide sincronizar explícitamente)
if (syncApps) {
  for (const sub of ['app android', 'app ios']) {
    const subPkgPath = path.join(root, sub, 'package.json');
    if (fs.existsSync(subPkgPath)) {
      const subPkg = JSON.parse(fs.readFileSync(subPkgPath, 'utf8'));
      subPkg.version = targetFull;
      fs.writeFileSync(subPkgPath, JSON.stringify(subPkg, null, 2) + '\n', 'utf8');
      console.log(`✅ Actualizado ${sub}/package.json (${targetFull})`);
    }
  }
} else {
  console.log(`ℹ️ Las apps móviles tienen su propia versión independiente (app-version.json). Usa bump-app-version.mjs para incrementarlas.`);
}

// 3. Web HTML files & Edge Functions
const files = [
  '404.html',
  'index.html',
  'clases.html',
  'clases_yoga.html',
  'consultas.html',
  'eventos.html',
  'ofertas.html',
  'tarifas.html',
  'maestros.html',
  'profile.html',
  'politica-privacidad.html',
  'aviso-legal.html',
  'success.html',
  'cancel.html',
  'supabase/functions/create-checkout-session/index.ts'
];

for (const rel of files) {
  const filePath = path.join(root, rel);
  if (!fs.existsSync(filePath)) continue;
  let content = fs.readFileSync(filePath, 'utf8');

  content = content.replace(/\?v=\d+\.\d+(\.\d+)?/g, `?v=${targetShort}`);
  content = content.replace(/content="\d+\.\d+(\.\d+)?"/g, `content="${targetShort}"`);
  content = content.replace(/\bv\d+\.\d+(\.\d+)?\b/g, `v${targetShort}`);
  content = content.replace(/const APP_VERSION = '\d+\.\d+(\.\d+)?'/g, `const APP_VERSION = '${targetShort}'`);
  content = content.replace(/const APP_RELEASE = '\d+\.\d+(\.\d+)?'/g, `const APP_RELEASE = '${targetShort}'`);
  content = content.replace(/(id="app-version-label(?:-mobile)?"[^>]*>)v\d+\.\d+(\.\d+)?/g, `$1v${targetFull}`);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Actualizado ${rel}`);
}

// version.json: fuente única de la versión visible en el pie de la web
const versionPayload = JSON.stringify({ version: targetFull, short: targetShort, updatedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n';
const versionPaths = [
  path.join(root, 'version.json'),
  path.join(root, 'ultima version', 'version.json'),
  path.join(root, 'app android', 'www', 'version.json'),
  path.join(root, 'app ios', 'www', 'version.json'),
  path.join(root, 'ultima version', 'app android', 'www', 'version.json'),
  path.join(root, 'ultima version', 'app ios', 'www', 'version.json')
];
for (const vp of versionPaths) {
  if (fs.existsSync(path.dirname(vp))) {
    fs.writeFileSync(vp, versionPayload, 'utf8');
    console.log(`✅ Actualizado ${path.relative(root, vp)} (${targetFull})`);
  }
}

if (syncApps) {
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
  const explicitBuild = buildArg && buildArg.trim() !== '' ? parseInt(buildArg, 10) : null;
  const nextAndroidBuild = explicitBuild || currentAndroidBuild + 1;

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

  const nextIosBuild = explicitBuild || currentIosBuild + 1;

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
} else {
  console.log(`\n🎉 Versión web v${targetShort} actualizada. Versión de apps desacoplada y preservada.\n`);
}
