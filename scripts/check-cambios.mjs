import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// check-cambios: todo cambio reportado.
//
// 1) La versión vigente de package.json tiene su entrada en CAMBIOS.md, con
//    tipo (Desarrollo / Incidencia) y ordenado de más nueva a más antigua.
// 2) Existe el tag anotado de la release (v17.2 si es .0, v17.1.1 si es patch).
//    Durante `npm run cambio` la regla 2 se pospone (REGISTRO_EN_CURSO=1) y en
//    CI se degrada a aviso, porque Actions no fetchea tags con fetch-depth 1.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { errors.push(m); console.error(`  ❌ ${m}`); };
const warn = (m) => { warnings.push(m); console.log(`  ⚠️ ${m}`); };

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const full = pkg.version;
const [maj, min, pat] = full.split('.').map(Number);
const patch = pat || 0;
const short = `${maj}.${min}`;
const expectedTag = patch === 0 ? `v${short}` : `v${full}`;

console.log(`\n--- 1. Entrada en CAMBIOS.md para la versión ${full} ---`);
let changelog = null;
try {
  changelog = await readFile(path.join(root, 'CAMBIOS.md'), 'utf8');
} catch {
  fail('CAMBIOS.md no existe: el registro de cambios es obligatorio');
}

if (changelog) {
  const headings = [...changelog.matchAll(/^## (v\d+\.\d+(?:\.\d+)?)(.*)$/gm)]
    .map((m) => ({ ver: m[1].slice(1), text: m[0].trim() }));
  const matches = (h) => h.ver === full || (patch === 0 && h.ver === short);
  const entry = headings.find(matches);

  if (!entry) {
    fail(`sin entrada para ${full} en CAMBIOS.md — añade «## v${full} — <fecha> · Desarrollo|Incidencia» o ejecuta npm run cambio`);
  } else if (!/·\s*(Desarrollo|Incidencia)\b/.test(entry.text)) {
    fail(`la entrada ${entry.text} no indica el tipo (· Desarrollo / · Incidencia)`);
  } else {
    pass(`entrada: ${entry.text}`);
  }

  if (headings.length && !matches(headings[0])) {
    warn(`la primera entrada es ${headings[0].ver} y la vigente es ${full} — las entradas van de más nueva a más antigua`);
  }
}

console.log('\n--- 2. Tag anotado de la release ---');
let tags = [];
try {
  tags = execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);
} catch {
  // sin git disponible: se degrada a aviso en el resumen
}

if (process.env.REGISTRO_EN_CURSO) {
  pass(`release en curso: el tag ${expectedTag} se creará al final de npm run cambio`);
} else if (!tags.length) {
  warn(`aún no hay tags en el repo: el próximo npm run cambio creará ${expectedTag}`);
} else if (process.env.CI) {
  warn(`CI no fetchea tags: ${expectedTag} se verifica en local`);
} else if (tags.includes(expectedTag)) {
  pass(`tag ${expectedTag} presente`);
} else {
  fail(`falta el tag anotado ${expectedTag} para la versión ${full} (tags vistos: ${tags.join(', ')})`);
}

console.log('');
if (errors.length) {
  console.error(`❌ check-cambios: ${errors.length} fallo(s), ${warnings.length} aviso(s).`);
  process.exit(1);
}
console.log(`✅ check-cambios: cambios reportados${warnings.length ? ` (${warnings.length} aviso(s))` : ''}.`);
