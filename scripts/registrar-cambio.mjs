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
 *   --importe/-i <n>      importe para contabilidad B (si no se da, se pregunta)
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
 *   5. Entrada en CAMBIOS.md (fecha, versión, tipo, descripción, tag)
 *   6. Validación: desarrollo → npm test completo (22 checks)
 *                  incidencia → release + regression + web + twins + sync + deploy + cambios
 *   7. Contabilidad B (solo desarrollo con importe): copia previa + línea + verificación
 *   8. Commit convencional (feat/fix) + docs/HISTORIAL_VERSIONES.html (amend)
 *   9. Tag anotado (v17.2 en minor .0 · v17.1.1 en patch)
 *  10. Informe del cambio en docs/informes/v<versión>.md (commits, diff, checks,
 *      control económico y checklist cert → pro) + su commit
 *  11. push a origin/main (cert se despliega solo; pro espera a npm run publicar)
 *  12. Desarrollo: dispara deploy-ios y deploy-android en CI (salvo --no-apps)
 *
 * Si la validación falla y el árbol estaba limpio al empezar, se revierte solo.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { anadir as anadirContabilidad } from './contabilidad.mjs';

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
  else if (a === '--importe' || a === '-i') opts.importe = argv[++i];
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
const versionAnterior = pkg.version;
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
const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }).trim();
  } catch {
    return '';
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
const preguntar = async (q) => (rl ? (await rl.question(q)).trim() : null);

if (!tipo && rl) {
  console.log('\n¿Qué tipo de cambio es?');
  console.log('  1) MAYOR  (desarrollo)  → funcionalidad nueva, rediseño, política/precio nuevo');
  console.log('  2) MENOR  (incidencia)  → bug, error en producción, arreglo puntual');
  const r = (await preguntar('\nResponde 1/2, "desarrollo"/"incidencia" o "mayor"/"menor": ')).toLowerCase();
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
if (!desc && rl) desc = (await preguntar(`\nDescripción del cambio (${tipo}): `));
if (!desc) {
  console.error('\n❌ Falta la descripción del cambio.');
  if (rl) rl.close();
  process.exit(1);
}

/* Importe del control económico: solo los cambios mayores abren línea propia. */
let importeContabilidad = 0;
let importePreguntado = false;
if (tipo === 'desarrollo') {
  if (opts.importe !== undefined) {
    importeContabilidad = Number(opts.importe);
    importePreguntado = true;
  } else if (rl) {
    const r = await preguntar('\nImporte a anotar en contabilidad B, en EUR (0 = omitir): ');
    importePreguntado = true;
    importeContabilidad = r === '' ? 0 : Number(r.replace(',', '.'));
  }
  if (importePreguntado && (!Number.isFinite(importeContabilidad) || importeContabilidad < 0)) {
    console.error(`\n❌ Importe inválido: ${opts.importe ?? '(respuesta)'}`);
    if (rl) rl.close();
    process.exit(1);
  }
}

const tag = etiquetaDe(objetivo);
const tagAnterior = etiquetaDe(versionAnterior);
const scope = opts.scope ? `(${opts.scope})` : '';
const prefijo = tipo === 'desarrollo' ? 'feat' : 'fix';
const mensajeCommit = `${prefijo}${scope}: ${desc} (${tipo} ${tag})`;
const etiquetaTipo = tipo === 'desarrollo' ? 'Desarrollo' : 'Incidencia';

/* --------------------------------------------------------------- 4. el plan */
console.log('\n======================================================');
console.log(`  CAMBIO ${tipo.toUpperCase()}  ·  v${versionAnterior} → v${objetivo}  ·  tag ${tag}`);
console.log('======================================================');
console.log(`  Descripción : ${desc}`);
console.log(`  Commit      : ${mensajeCommit}`);
console.log(`  Validación  : ${CHECKS[tipo].join(' · ')}`);
if (tipo === 'desarrollo') {
  console.log(`  Contabilidad: ${importeContabilidad > 0 ? `sí, línea «Pendiente ${importeContabilidad}» en contabilidad B` : 'sin línea propia (0 = omitir)'}`);
} else {
  console.log('  Contabilidad: sin línea propia (las incidencias van en el mantenimiento mensual)');
}
console.log(`  Despliegue  : cert (automático) → pro: manual con npm run publicar${tipo === 'desarrollo' && !noApps ? ' + apps' : ''}`);
console.log(`  Informe     : docs/informes/v${objetivo}.md`);
console.log(`  Push        : ${noPush ? 'no (--no-push)' : 'sí, a origin/main + tag'}`);

const sucios = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
const limpioAlEmpezar = sucios === '';
if (sucios) {
  console.log('\n  ⚠️ Ya hay cambios sin commitear que entrarán en este commit:');
  console.log(sucios.split('\n').map((l) => `     ${l}`).join('\n'));
}

if (dryRun) {
  if (tipo === 'desarrollo' && importeContabilidad > 0) {
    console.log(`\n[dry-run] Contabilidad: se añadiría «actualización ${objetivo} -> ${desc} -> Pendiente ${importeContabilidad}»`);
  }
  console.log('\n(--dry-run: no se ejecuta nada)');
  if (rl) rl.close();
  process.exit(0);
}

if (rl && !yes) {
  const r = (await preguntar('\n¿Ejecutar? (s/N): ')).toLowerCase();
  if (r !== 's' && r !== 'si' && r !== 'sí') {
    console.log('Cancelado.');
    rl.close();
    process.exit(0);
  }
} else if (rl) {
  rl.close();
}

/* ----------------------------------------------------------- 5. ejecución */
try {
  run(`node scripts/bump-version.mjs ${objetivo}`, {}, '1/10 Versión');
  run('npm run build:css', {}, '2/10 CSS');
  const py = process.platform === 'win32' ? 'python' : 'python3';
  run(`${py} scripts/sync_apps.py`, {}, '3/10 Sync web → ultima version → apps');

  if (tipo === 'desarrollo') {
    console.log('\n4/10 Capacitor sync (aviso si falla: check:links lo decide)');
    runOk('npx cap sync android', {}, cwdAndroid());
    runOk('npx cap sync ios', {}, cwdIos());
  }

  // check:cambios exige la entrada y el tag de la versión nueva: la entrada se
  // escribe justo antes y el tag se pospone con REGISTRO_EN_CURSO=1.
  escribirEntrada();
  const envCheck = { REGISTRO_EN_CURSO: '1' };
  console.log(`\n5/10 Validación (${tipo})`);
  for (const c of CHECKS[tipo]) run(c, envCheck);

  // El control económico solo se toca cuando la validación ya ha pasado.
  let contabilidad = null;
  if (tipo === 'desarrollo' && importeContabilidad > 0) {
    console.log('\n6/10 Control económico (contabilidad B)');
    contabilidad = anadirContabilidad(objetivo, importeContabilidad, desc);
  } else {
    console.log('\n6/10 Control económico: sin línea nueva');
  }

  console.log('\n7/10 Commit');
  run('git add -A');
  run(`git commit -m "${mensajeCommit.replace(/"/g, "'")}"`);

  // El historial se regenera después del commit y se añade con --amend,
  // para que la release incluya su propio registro.
  console.log('\n8/10 Historial, informe y tag');
  run('node scripts/generar-historial-versiones.mjs docs/HISTORIAL_VERSIONES.html');
  run('git add docs/HISTORIAL_VERSIONES.html');
  run('git commit --amend --no-edit');
  run(`git tag -a ${tag} -m "${tag} · ${etiquetaTipo} · ${hoy()} — ${desc.replace(/"/g, "'")}"`);

  // El informe se genera ya con el tag creado (commits y diff son estables).
  const informe = generarInforme({ contabilidad });
  run(`git add "${informe}"`);
  run(`git commit -m "docs(informe): informe del cambio a v${objetivo}"`);

  let empujado = false;
  if (noPush) {
    console.log('\n9/10 Push omitido (--no-push). Recuerda subirlo: git push origin main --follow-tags');
  } else {
    console.log('\n9/10 Push a origin/main (cert se despliega solo; pro espera a npm run publicar)');
    run('git push origin main');
    run(`git push origin ${tag}`);
    empujado = true;
  }

  if (tipo === 'desarrollo' && empujado && !noApps) {
    console.log('\n10/10 Deploy de apps en CI');
    runOk(`gh workflow run deploy-ios.yml --ref main -f notes="${(desc + ' (' + tag + ')').replace(/"/g, "'")}"`);
    runOk('gh workflow run deploy-android.yml --ref main -f track=internal');
  }

  // Verificación final sin el desvío de la release en curso.
  run('npm run check:cambios', {}, 'Verificación final de registro y tag');

  console.log('\n======================================================');
  console.log(`✅ ${etiquetaTipo.toUpperCase()} v${objetivo} registrada, commiteada y etiquetada (${tag}).`);
  console.log(`   Registro   : CAMBIOS.md`);
  console.log(`   Informe    : docs/informes/v${objetivo}.md`);
  console.log(`   Historial  : docs/HISTORIAL_VERSIONES.html`);
  console.log(`   Contabilidad: ${contabilidad ? 'línea añadida con copia previa' : 'sin línea'}`);
  console.log(`   Siguiente  : valida en cert y después sube a pro con npm run publicar`);
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
    `\n## v${objetivo} — ${hoy()} · ${etiquetaTipo}` +
    `\n\n- **Descripción:** ${desc}${opts.scope ? ` (ámbito: ${opts.scope})` : ''}` +
    `\n- **Validación:** ${CHECKS[tipo].join(' · ')}` +
    `\n- **Tag:** \`${tag}\`` +
    (tipo === 'desarrollo'
      ? `\n- **Contabilidad B:** ${importeContabilidad > 0 ? `línea «Pendiente ${importeContabilidad}» añadida` : 'sin importe (0)'}`
      : `\n- **Contabilidad B:** sin línea propia (mantenimiento mensual)`) +
    `\n- **Informe:** \`docs/informes/v${objetivo}.md\`\n`;
  md = md.slice(0, finLinea + 1) + bloque + md.slice(finLinea + 1);
  fs.writeFileSync(mdPath, md, 'utf8');
  console.log(`\n4/10 Entrada añadida en CAMBIOS.md (v${objetivo})`);
}

/**
 * Informe del cambio: el "formulario" que queda por cada versión.
 * Se genera después de crear el tag para que commits y diff sean estables.
 */
function generarInforme({ contabilidad }) {
  const dir = path.join(root, 'docs', 'informes');
  fs.mkdirSync(dir, { recursive: true });
  const ruta = path.join(dir, `v${objetivo}.md`);

  const rango = sh(`git log --oneline ${tagAnterior}..${tag}`);
  const commits = rango
    ? rango.split('\n').map((l) => {
        const i = l.indexOf(' ');
        return `- \`${l.slice(0, i)}\` ${l.slice(i + 1)}`;
      }).join('\n')
    : `- (sin rango ${tagAnterior}..${tag})`;
  const diff = sh(`git diff --stat ${tagAnterior}..${tag}`).split('\n').slice(0, 40).join('\n');
  const archivos = sh(`git diff --name-only ${tagAnterior}..${tag}`).split('\n').filter(Boolean);

  const informe = `# Informe de cambio — v${objetivo}

Documento generado automáticamente por \`npm run cambio\`. Describe lo que
entró en la release, cómo se validó, qué se desplegó y qué queda pendiente.

| Campo | Valor |
|---|---|
| Fecha | ${hoy()} |
| Tipo | **${etiquetaTipo}** (${tipo === 'desarrollo' ? 'cambio mayor → minor' : 'cambio menor → patch'}) |
| Versión | v${versionAnterior} → **v${objetivo}** |
| Tag | \`${tag}\` (anterior: \`${tagAnterior}\`) |
| Descripción | ${desc}${opts.scope ? ` (ámbito: ${opts.scope})` : ''} |
| Commit | \`${sh('git rev-parse --short HEAD')}\` |
| Validación | ${CHECKS[tipo].join(' · ')} |

## 1. Qué cambia

${archivos.length ? archivos.slice(0, 60).map((f) => `- \`${f}\``).join('\n') : '- (sin ficheros)'}
${archivos.length > 60 ? `\n_…y ${archivos.length - 60} ficheros más._` : ''}

## 2. Commits incluidos

${commits}

## 3. Dif estadística

\`\`\`
${diff || '(sin datos)'}
\`\`\`

## 4. Validación ejecutada

${CHECKS[tipo].map((c) => `- [x] \`${c}\` → ✅`).join('\n')}

## 5. Despliegue (cert → pro)

| Entorno | Estado | Cómo |
|---|---|---|
| **cert** | se despliega solo al hacer push a main | https://gen-yoga-studio.github.io/GEN-YOGA-CERT/ |
| **pro** | ⏳ **pendiente de tu visto bueno** | \`npm run publicar\` |
${tipo === 'desarrollo' && !noApps ? '| apps | ⏳ disparadas en CI | `deploy-ios` / `deploy-android` |\n' : '| apps | no toca | — |\n'}
### Checklist de validación en cert

- [ ] la web abre en la URL de cert sin errores de consola
- [ ] navegación entre las 8 páginas e idioma ES/EN
- [ ] login / registro con datos de prueba (Supabase de cert)
- [ ] el flujo de compra no toca Stripe LIVE
- [ ] \`npm test\` en verde en local
- [ ] **pro**: \`npm run publicar\` solo después de los puntos anteriores

## 6. Control económico (contabilidad B)

${tipo !== 'desarrollo'
    ? '- Sin línea propia: las incidencias se agrupan en el mantenimiento mensual del documento.'
    : contabilidad
      ? `- Línea añadida: \`${contabilidad.linea}\`\n- Copia de seguridad previa: \`${contabilidad.backup}\`\n- Fichero privado: \`docs/contabilidad b.md\` (fuera del repositorio, en \`.gitignore\`)`
      : '- Sin importe (0): no se añadió línea. Si procede, añádela con `node scripts/contabilidad.mjs anadir <versión> <importe> "<descripción>"`.'}

## 7. Registro

- Entrada en \`CAMBIOS.md\`: \`## v${objetivo} — ${hoy()} · ${etiquetaTipo}\`
- Historial regenerado: \`docs/HISTORIAL_VERSIONES.html\`
- Tag: \`${tag}\`
`;

  fs.writeFileSync(ruta, informe, 'utf8');
  console.log(`   Informe: docs/informes/v${objetivo}.md`);
  return ruta;
}
