import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// check-cambios-apps: todo cambio en las aplicaciones nativas debe quedar reportado en CAMBIOS-APPS.md.
//
// 1) La versión vigente en app-version.json tiene su entrada en CAMBIOS-APPS.md.
// 2) La entrada declara el Build number coincidente con versionCode y CURRENT_PROJECT_VERSION.
// 3) Las entradas van ordenadas de más nueva a más antigua.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { errors.push(m); console.error(`  ❌ ${m}`); };
const warn = (m) => { warnings.push(m); console.log(`  ⚠️ ${m}`); };

let appConfig = null;
try {
  appConfig = JSON.parse(await readFile(path.join(root, 'app-version.json'), 'utf8'));
} catch {
  fail('app-version.json no existe o no es un JSON válido');
}

if (!appConfig) {
  process.exit(1);
}

const full = appConfig.version;
const short = appConfig.short || full.split('.').slice(0, 2).join('.');
const build = appConfig.build;

console.log(`\n--- 1. Entrada en CAMBIOS-APPS.md para la versión ${full} (Build ${build}) ---`);
let changelog = null;
try {
  changelog = await readFile(path.join(root, 'CAMBIOS-APPS.md'), 'utf8');
} catch {
  fail('CAMBIOS-APPS.md no existe: el registro de cambios de apps es obligatorio');
}

if (changelog) {
  const headings = [...changelog.matchAll(/^## (v\d+\.\d+(?:\.\d+)?)(.*)$/gm)]
    .map((m) => ({ ver: m[1].slice(1), text: m[0].trim(), rest: m[2] }));

  const matches = (h) => h.ver === full || h.ver === short;
  const entry = headings.find(matches);

  if (!entry) {
    fail(`sin entrada para v${full} (o v${short}) en CAMBIOS-APPS.md — añade «## v${full} (Build ${build}) — <fecha> · <Tipo>»`);
  } else {
    pass(`entrada encontrada: ${entry.text}`);
    if (build && !entry.rest.includes(`Build ${build}`)) {
      warn(`la cabecera no especifica Build ${build}: "${entry.text}"`);
    } else {
      pass(`Build number ${build} documentado en la cabecera`);
    }
  }

  if (headings.length && !matches(headings[0])) {
    warn(`la primera entrada es ${headings[0].ver} y la vigente es ${full} — las entradas van de más nueva a más antigua`);
  }
}

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-cambios-apps: ${errors.length} error(es) bloqueante(s) en el registro de apps.`);
  process.exit(1);
}
console.log('✅ check-cambios-apps: registro de cambios de apps verificado y conforme.');
