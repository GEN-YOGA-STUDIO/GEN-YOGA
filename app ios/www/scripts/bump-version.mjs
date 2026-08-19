import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const currentFullVersion = pkg.version;
const parts = currentFullVersion.split('.').map(Number);

let nextMajor = parts[0];
let nextMinor = parts[1] + 1;
let nextPatch = 0;

const targetArg = process.argv[2];
let targetShort = `${nextMajor}.${nextMinor}`;
let targetFull = `${nextMajor}.${nextMinor}.${nextPatch}`;

if (targetArg) {
  let cleaned = targetArg.startsWith('v') ? targetArg.slice(1) : targetArg;
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
console.log(`Bumping version: ${currentShort} (${currentFullVersion}) -> ${targetShort} (${targetFull})`);

pkg.version = targetFull;
pkg.description = pkg.description.replace(new RegExp(`versión\\s+${currentShort.replace('.', '\\.')}`, 'g'), `versión ${targetShort}`);
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

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

  content = content.replace(new RegExp(`\\?v=${currentShort.replace('.', '\\.')}`, 'g'), `?v=${targetShort}`);
  content = content.replace(new RegExp(`content="${currentShort.replace('.', '\\.')}"`, 'g'), `content="${targetShort}"`);
  content = content.replace(new RegExp(`v${currentShort.replace('.', '\\.')}`, 'g'), `v${targetShort}`);
  content = content.replace(new RegExp(`const APP_VERSION = '${currentShort.replace('.', '\\.')}'`, 'g'), `const APP_VERSION = '${targetShort}'`);
  content = content.replace(new RegExp(`const APP_RELEASE = '${currentShort.replace('.', '\\.')}'`, 'g'), `const APP_RELEASE = '${targetShort}'`);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${rel}`);
}

console.log(`Successfully bumped to version ${targetShort} (${targetFull})!`);
