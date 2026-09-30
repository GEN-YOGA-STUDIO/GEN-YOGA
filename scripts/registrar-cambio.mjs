#!/usr/bin/env node
/**
 * scripts/registrar-cambio.mjs — Flujo único y obligatorio de cambios en la web.
 *
 * Uso:
 *   npm run cambio -- <desarrollo|incidencia> "<descripción>" [--scope <módulo>]
 *   npm run cambio --                      (pregunta el tipo por teclado)
 *
 * Sinónimos aceptados: mayor|feat|feature = desarrollo · menor|fix|bug = incidencia.
 *
 * Opciones:
 *   --scope/-s <módulo>   ámbito del commit convencional (fix(consultas): …)
 *   --message/-m <txt>    descripción (alternativa a los argumentos posicionales)
 *   --dry-run             muestra el plan sin ejecutar nada
 *   --yes/-y              no pide confirmación
 *   --no-push             no sube a origin/main (y por tanto no despliega)
 *   --no-apps             desarrollo sin disparar deploy-ios / deploy-android
 *
 * Qué hace, en orden:
 *   1. Clasifica el cambio: MAYOR (desarrollo) → minor+1 (17.1.0 → 17.2.0)
 *                           MENOR (incidencia) → patch+1 (17.1.0 → 17.1.1)
 *   2. bump-version (8 HTML, package.json raíz+apps, Gradle, Xcode, Edge Function)
 *   3. Tailwind + sync_apps.py (raíz → 'ultima version' → bundles de las apps)
 *   4. cap sync (solo desarrollo; si falla, aviso — lo decide luego check:links)
 *   5. Validación: desarrollo → npm test completo (22 checks)
 *                  incidencia → release + regression + web + twins + sync + deploy + cambios
 *   6. Entrada en CAMBIOS.md (fecha, versión, tipo, descripción, tag)
 *   7. Commit convencional (feat/fix) + regeneración de docs/HISTORIAL_VERSIONES.html
 *   8. Tag anotado (v17.2 en minor .0 · v17.1.1 en patch)
 *   9. push a origin/main (despliega la web vía deploy-pages) + push del tag
 *  10. Desarrollo: dispara deploy-ios y deploy-android en CI (salvo --no-apps)
 *
 * Si la validación falla y el árbol estaba limpio al empezar, se revierte solo.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const ALIAS = {
  desarrollo: 'desarrollo', mayor: 'desarrollo', feat: 'desarrollo', feature: 'desarrollo',
  incidencia: 'incidencia', menor: 'incidencia', fix: 'incidencia', bug: 'incidencia',
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const hoy = () => {
  const d = new Date();
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
};

/* ------------------------------------------------------------- 1. argumentos */
const argv = process.argv.slice(2);
const flags = new Set();
const opts = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--scope' || a === '-s') opts.scope = argv[++i];
  else if (a === '--message' || a === '-m') opts.message = argv[++i];
  else if (a.startsWith('--') || a === '-y') flags.add(a === '-y' ? '--yes' : a);
  else pos.push(a);
}

let tipo = null;
let desc = '';
if (pos.length && ALIAS[pos[0].toLowerCase()]) {
  tipo = ALIAS[pos[0].toLowerCase()];
  desc = pos.slice(1).join(' ');
} else {
  desc = pos.join(' ');
}
if (opts.message) desc = (desc ? desc + ' ' : '') + opts.message;
desc = desc.trim();

const dryRun = flags.has('--dry-run');
const yes = flags.has('--yes');
const noPush = flags.has('--no-push');
const noApps = flags.has('--no-apps');
const interactivo = Boolean(process.stdin.isTTY);

/* -------------------------------------------------- 2. versión actual y meta */
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const patch = pat || 0;

let objetivo = null;
if (tipo === 'desarrollo') objetivo = `${maj}.${min + 1}.0`;
if (tipo === 'incidencia') objetivo = `${maj}.${min}.${patch + 1}`;

const etiquetaDe = (v) => {
  const [a, b, c] = v.split('.').map(Number);
  return c ? `v${a}.${b}.${c}` : `v${a}.${b}`;
};

const run = (cmd, extraEnv = {}, label = null) => {
  if (label) console.log(`\n▶ ${label}`);
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
};
const runOk = (cmd, extraEnv = {}, opts2 = {}) => {
  try {
    execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...extraEnv }, ...opts2 });
    return true;
  } catch {
    return false;
  }
};

const CHECKS = {
  desarrollo: ['npm test'],
  incidencia: [
    'npm run check:release',
    'npm run check:regression',
    'npm run check:web',
    'npm run check:twins',
    'npm run check:sync',
    'npm run check:deploy',
    'npm run check:cambios',
  ],
};

/* ------------------------------------------------- 3. preguntas interactivas */
const rl = interactivo ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;

if (!tipo && rl) {
  console.log('\n¿Qué tipo de cambio es?');
  console.log('  1) MAYOR  (desarrollo)  → funcionalidad nueva, rediseño, política/precio nuevo');
  console.log('  2) MENOR  (incidencia)  → bug, error en producción, arreglo puntual');
  const r = (await rl.question('\nResponde 1/2, "desarrollo"/"incidencia" o "mayor"/"menor": ')).trim().toLowerCase();
  tipo = ALIAS[r] || (r === '1' ? 'desarrollo' : r === '2' ? 'incidencia' : null);
  if (tipo === 'desarrollo') objetivo = `${maj}.${min + 1}.0`;
  if (tipo === 'incidencia') objetivo = `${maj}.${min}.${patch + 1}`;
}
if (!tipo) {
  console.error('\n❌ Falta el tipo de cambio. Uso: npm run cambio -- <desarrollo|incidencia> "<descripción>" [--scope módulo]');
  console.error('   (sin argumentos, el comando pregunta por teclado)');
  if (rl) rl.close();
  process.exit(1);
}
if (!desc && rl) desc = (await rl.question(`\nDescripción del cambio (${tipo}): `)).trim();
if (!desc) {
  console.error('\n❌ Falta la descripción del cambio.');
  if (rl) rl.close();
  process.exit(1);
}

const tag = etiquetaDe(objetivo);
const scope = opts.scope ? `(${opts.scope})` : '';
const prefijo = tipo === 'desarrollo' ? 'feat' : 'fix';
const mensajeCommit = `${prefijo}${scope}: ${desc} (${tipo} ${tag})`;

/* --------------------------------------------------------------- 4. el plan */
console.log('\n======================================================');
console.log(`  CAMBIO ${tipo.toUpperCase()}  ·  v${pkg.version} → v${objetivo}  ·  tag ${tag}`);
console.log('======================================================');
console.log(`  Descripción : ${desc}`);
console.log(`  Commit      : ${mensajeCommit}`);
console.log(`  Validación  : ${CHECKS[tipo].join(' · ')}`);
console.log(`  Deploy      : ${tipo === 'desarrollo' ? (noApps ? 'web (apps omitidas con --no-apps)' : 'web + apps (deploy-ios y deploy-android)') : 'solo web (Pages, automático en push a main)'}`);
console.log(`  Push        : ${noPush ? 'no (--no-push)' : 'sí, a origin/main + tag'}`);

const sucios = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
const limpioAlEmpezar = sucios === '';
if (sucios) {
  console.log('\n  ⚠️ Ya hay cambios sin commitear que entrarán en este commit:');
  console.log(sucios.split('\n').map((l) => `     ${l}`).join('\n'));
}

if (dryRun) {
  console.log('\n(--dry-run: no se ejecuta nada)');
  if (rl) rl.close();
  process.exit(0);
}

if (rl && !yes) {
  const r = (await rl.question('\n¿Ejecutar? (s/N): ')).trim().toLowerCase();
  if (r !== 's' && r !== 'si' && r !== 'sí') {
    console.log('Cancelado.');
    rl.close();
    process.exit(0);
  }
  rl.close();
} else if (rl) {
  rl.close();
}

/* ----------------------------------------------------------- 5. ejecución */
try {
  run(`node scripts/bump-version.mjs ${objetivo}`, {}, '1/8 Versión');
  run('npm run build:css', {}, '2/8 CSS');
  const py = process.platform === 'win32' ? 'python' : 'python3';
  run(`${py} scripts/sync_apps.py`, {}, '3/8 Sync web → ultima version → apps');

  if (tipo === 'desarrollo') {
    console.log('\n4/8 Capacitor sync (aviso si falla: check:links lo decide)');
    runOk('npx cap sync android', {}, cwdAndroid());
    runOk('npx cap sync ios', {}, cwdIos());
  }

  // check:cambios exige la entrada y el tag de la versión nueva: la entrada se
  // escribe justo antes y el tag se pospone con REGISTRO_EN_CURSO=1.
  escribirEntrada();
  const envCheck = { REGISTRO_EN_CURSO: '1' };
  console.log(`\n5/8 Validación (${tipo})`);
  for (const c of CHECKS[tipo]) run(c, envCheck);

  console.log('\n6/8 Commit y tag');
  run('git add -A');
  run(`git commit -m "${mensajeCommit.replace(/"/g, "'")}"`);

  // El historial se regenera después del commit y se añade con --amend,
  // para que la release incluya su propio registro.
  run('node scripts/generar-historial-versiones.mjs docs/HISTORIAL_VERSIONES.html');
  run('git add docs/HISTORIAL_VERSIONES.html');
  run('git commit --amend --no-edit');
  run(`git tag -a ${tag} -m "${tag} · ${tipo === 'desarrollo' ? 'Desarrollo' : 'Incidencia'} · ${hoy()} — ${desc.replace(/"/g, "'")}"`);

  let empujado = noPush;
  if (noPush) {
    console.log('\n7/8 Push omitido (--no-push). Recuerda subirlo: git push origin main --follow-tags');
  } else {
    console.log('\n7/8 Push a origin/main (deploy-pages se dispara solo)');
    run('git push origin main');
    run(`git push origin ${tag}`);
    empujado = true;
  }

  if (tipo === 'desarrollo' && empujado && !noApps) {
    console.log('\n8/8 Deploy de apps en CI');
    runOk(`gh workflow run deploy-ios.yml --ref main -f notes="${(desc + ' (' + tag + ')').replace(/"/g, "'")}"`);
    runOk('gh workflow run deploy-android.yml --ref main -f track=internal');
  }

  // Verificación final sin el desvío de la release en curso.
  run('npm run check:cambios', {}, 'Verificación final de registro y tag');

  console.log('\n======================================================');
  console.log(`✅ ${tipo === 'desarrollo' ? 'DESARROLLO' : 'INCIDENCIA'} v${objetivo} registrada, commiteada y etiquetada (${tag}).`);
  console.log(`   Registro  : CAMBIOS.md`);
  console.log(`   Historial : docs/HISTORIAL_VERSIONES.html`);
  console.log('======================================================\n');
} catch (e) {
  console.error(`\n❌ El paso anterior ha fallado (${e.message}).`);
  if (limpioAlEmpezar) {
    console.error('   El árbol estaba limpio al empezar: se revierten los cambios de esta ejecución.');
    try {
      execSync('git restore .', { stdio: 'inherit' });
    } catch { /* nada más que hacer */ }
    console.error('   Nada se ha commiteado, etiquetado ni subido.');
  } else {
    console.error('   Había cambios sin commitear al empezar, así que NO se revierte nada automáticamente.');
    console.error('   Revisa con `git status` y descarta con `git restore .` si procede.');
  }
  process.exit(1);
}

/* ------------------------------------------------------------- utilidades */
function cwdAndroid() { return { cwd: path.join(root, 'app android') }; }
function cwdIos() { return { cwd: path.join(root, 'app ios') }; }

function escribirEntrada() {
  const mdPath = path.join(root, 'CAMBIOS.md');
  let md = fs.readFileSync(mdPath, 'utf8');
  const ancla = '<!-- entradas-nuevas';
  const i = md.indexOf(ancla);
  if (i === -1) throw new Error('CAMBIOS.md: falta el ancla <!-- entradas-nuevas … -->');
  const finLinea = md.indexOf('\n', i);
  const bloque =
    `\n## v${objetivo} — ${hoy()} · ${tipo === 'desarrollo' ? 'Desarrollo' : 'Incidencia'}` +
    `\n\n- **Descripción:** ${desc}${opts.scope ? ` (ámbito: ${opts.scope})` : ''}` +
    `\n- **Validación:** ${CHECKS[tipo].join(' · ')}` +
    `\n- **Tag:** \`${tag}\`\n`;
  md = md.slice(0, finLinea + 1) + bloque + md.slice(finLinea + 1);
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log(`\n4/8 Entrada añadida en CAMBIOS.md (v${objetivo})`);
}
