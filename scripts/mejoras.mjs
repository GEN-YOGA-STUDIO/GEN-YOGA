// scripts/mejoras.mjs
// Aplica el plan de mejoras del bucle nocturno con OpenCode, SOLO cuando el
// usuario lo activa explícitamente.
//
// Uso:
//   npm run mejoras                          # revisar el plan (no toca código)
//   npm run mejoras -- estado                # último plan + último intento
//   npm run mejoras:aplicar -- --solo M01,M02
//   npm run mejoras:aplicar -- --max 3
//   npm run mejoras:aplicar -- --dry-run --solo M01
//   npm run mejoras:aplicar -- --desde-plan nightly-reports/plan-mejoras.json
//
// Seguridad:
//   - `aplicar` exige --activar (el script de npm ya lo incluye).
//   - Nunca hace commit, push ni PR salvo --pr con árbol limpio.
//   - Nunca revierte cambios del usuario (prohibido checkout/reset/stash/clean).
//   - Solo propuestas autoApplicable; las manuales se listan y se omiten.
//   - Verifica con la suite completa al terminar (salvo --sin-verificar).

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPlan,
  loadLatestAction,
  loadLatestFull,
  loadLatestPersonas,
  loadPreviousAction,
  renderPlanMarkdown,
} from './nightly-intelligence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(root, 'nightly-reports');
const args = process.argv.slice(2);
const KNOWN = ['plan', 'aplicar', 'estado', 'diff'];
const cmd = args.find((a) => KNOWN.includes(a)) || 'plan';
const flag = (name) => args.includes(name);
const value = (name, fallback = '') => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('-') ? args[i + 1] : fallback;
};
const date = new Date().toISOString().slice(0, 10);

function log(msg) { console.log(msg); }
function die(msg, code = 1) { console.error(`\n⛔ ${msg}`); process.exit(code); }

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function loadPlan() {
  const explicit = value('--desde-plan');
  if (explicit) {
    const file = path.resolve(root, explicit);
    const plan = readJson(file);
    if (!plan) die(`No se pudo leer el plan: ${file}`);
    return plan;
  }
  const full = loadLatestFull(root);
  if (!full) die(`No hay informes en ${reportsDir}. Ejecuta antes: npm run check:nightly`);
  const plan = buildPlan({
    action: loadLatestAction(root),
    fullReport: full,
    personaReport: loadLatestPersonas(root),
    previousAction: loadPreviousAction(root),
    skipPersonas: Boolean(full.personasSkipped),
  });
  return plan;
}

function savePlan(plan) {
  writeFileSync(path.join(reportsDir, 'plan-mejoras.json'), JSON.stringify(plan, null, 2));
  writeFileSync(path.join(reportsDir, 'plan-mejoras.md'), renderPlanMarkdown(plan));
}

function printPlan(plan) {
  const s = plan.summary;
  const h = plan.health;
  log(`\n🧭 Plan ${plan.env} · ${String(plan.date).slice(0, 10)}`);
  log(`   Salud ${h.score}/100 (${h.grade}) · funcional ${h.functionalScore} · experiencia ${h.experienceScore}`);
  log(`   ${s.total} propuesta(s): ${s.p1} P1 · ${s.p2} P2 · ${s.p3} P3 · ${s.auto} auto · ${s.manual} manual`);
  if (h.coverage.ratio < 1) log(`   ⚠️ Cobertura ${h.coverage.present}/${h.coverage.expected}: faltan ${h.coverage.missing.join(', ')}`);
  if (h.personas) log(`   🧑 Personas: ${h.personas.passed}/${h.personas.total} limpias · fricción ${h.personas.friction}/100 · ${h.personas.deadEnds} bloqueo(s)`);
  log('');
  for (const it of plan.items) {
    log(`   ${it.id} [${it.priority}] ${it.autoApplicable ? 'auto ' : 'manual'} · ${it.category} · ${it.title}`);
  }
  if (!plan.items.length) log('   (sin propuestas: no hay nada que aplicar)');
  log('');
}

function gitStatus() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  } catch { return ''; }
}

function dirtyFiles() {
  return gitStatus().split('\n').map((l) => l.slice(3).trim()).filter(Boolean)
    .filter((f) => !f.startsWith('nightly-reports/'))
    // Logs que el propio workflow crea antes de lanzar el script.
    .filter((f) => !/^(apply|autofix)-log\.txt$/.test(f));
}

function buildPrompt(plan, selected) {
  const L = [];
  L.push('Eres un agente de mejora de GEN Yoga (web estática + Supabase + apps Capacitor).');
  L.push('El usuario ha ACTIVADO explícitamente este trabajo desde el plan nocturno. Aun así, aplica solo las tareas listadas.');
  L.push('');
  L.push(`Entorno: ${plan.env} · Base: ${plan.base}`);
  L.push(`Objetivo: aplicar ${selected.length} propuesta(s) del plan, con cambios mínimos y verificables.`);
  L.push('');
  L.push('REGLAS DURAS (si dudas, no hagas el cambio y explícalo):');
  L.push('- NO ejecutes git checkout/reset/stash/clean/revert. El árbol tiene cambios sin commit del usuario: no los pises.');
  L.push('- NO hagas commit, push ni PR. Deja los cambios en el working tree.');
  L.push('- NO toques archivos ajenos a la tarea. No reformatees ni reorganices código.');
  L.push('- NO escribas secretos, claves ni credenciales.');
  L.push('- NO ejecutes flujos que escriban en producción: 0 reservas, 0 compras, 0 cargos. Los diálogos se cancelan.');
  L.push('- Si cambias .html/.js/.css de la web, replica el cambio en `ultima version/` (fuente del deploy) y en `app android/www` + `app ios/www` si el archivo existe allí.');
  L.push('- Mantén el estilo, los nombres y los patrones existentes.');
  L.push('');
  L.push('TAREAS:');
  for (const it of selected) {
    L.push('');
    L.push(`## ${it.id} · ${it.priority} · ${it.title}`);
    L.push(`Categoría: ${it.category} · Riesgo: ${it.risk}`);
    L.push(`Por qué: ${String(it.why).replace(/\n/g, ' ').slice(0, 500)}`);
    if (it.files?.length) L.push(`Archivos de partida: ${it.files.join(', ')}`);
    if (it.evidence?.url) L.push(`Evidencia: ${it.evidence.url}`);
    if (it.evidence?.screenshot) L.push(`Captura: nightly-reports/${it.evidence.screenshot}`);
    L.push(`Acción esperada: ${it.action}`);
    L.push(`Verificación: ${it.verify}`);
  }
  L.push('');
  L.push('Al terminar: resume en 5 líneas qué archivos tocaste, qué cambiaste y qué no pudiste hacer.');
  return L.join('\n');
}

function runProcess(command, cmdArgs, { timeoutMs = 0, logFile = null, env = {}, shell = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, cmdArgs, {
      cwd: root,
      shell,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    const chunks = [];
    let timer = null;
    const onData = (buf) => {
      const s = buf.toString();
      chunks.push(s);
      if (logFile) writeFileSync(logFile, s, { flag: 'a' });
      process.stdout.write(s);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => {
      const msg = `No se pudo ejecutar ${command}: ${e.message}`;
      if (logFile) writeFileSync(logFile, msg + '\n', { flag: 'a' });
      resolve({ code: -1, error: msg });
    });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
      }, timeoutMs);
    }
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, output: chunks.join('') });
    });
  });
}

function verifyCommand(plan) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return plan.env === 'certificacion'
    ? { command, args: ['run', 'check:cert'], shell: process.platform === 'win32' }
    : { command, args: ['run', 'check:nightly'], shell: process.platform === 'win32' };
}

// En Windows los shims .cmd necesitan shell, pero el prompt multilínea se
// rompería. Se resuelve el .exe real que hay detrás del shim de npm.
function resolveOpencode() {
  if (process.platform !== 'win32') return { command: 'opencode', shell: false };
  const candidates = [];
  try {
    for (const line of execFileSync('where.exe', ['opencode'], { encoding: 'utf8' }).split(/\r?\n/)) {
      if (/\.exe$/i.test(line.trim())) candidates.push(line.trim());
    }
  } catch { /* sin shim en PATH */ }
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  const exe = candidates.find((p) => existsSync(p));
  if (exe) return { command: exe, shell: false };
  return { command: 'opencode.cmd', shell: true };
}

function createPr(plan, selected) {
  // El sufijo de run/tiempo evita colisiones si se reintenta el mismo día.
  const suffix = process.env.GITHUB_RUN_ID || Date.now().toString(36);
  const branch = `mejoras/${date}-${selected.map((i) => i.id).join('-').toLowerCase()}-${suffix}`;
  const title = `🤖 Mejoras nocturnas ${selected.map((i) => i.id).join(', ')}`;
  const body = [
    `Aplicado por \`npm run mejoras:aplicar\` sobre el plan \`${plan.signature}\`.`,
    '',
    ...selected.map((i) => `- **${i.id}** ${i.title}`),
    '',
    'Verificación: suite nocturna completa en verde.',
  ].join('\n');
  try {
    execFileSync('git', ['switch', '-c', branch], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['-c', 'user.name=genyoga-mejoras', '-c', 'user.email=mejoras@genyoga.studio', 'commit', '-m', title], { cwd: root, stdio: 'inherit' });
    execFileSync('git', ['push', '-u', 'origin', branch], { cwd: root, stdio: 'inherit' });
    const url = String(execFileSync('gh', ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', branch], { cwd: root, encoding: 'utf8' })).trim();
    log(`✅ PR creado: ${url}`);
    return url;
  } catch (e) {
    log(`⚠️ No se pudo crear el PR: ${(e && e.message) || e}`);
    log(`   Los cambios y la rama ${branch} siguen en local.`);
    return '';
  }
}

async function cmdPlan() {
  const plan = loadPlan();
  savePlan(plan);
  printPlan(plan);
  log(`📄 ${path.join(reportsDir, 'plan-mejoras.md')}`);
  log('   Para aplicar (explícito): npm run mejoras:aplicar -- --solo M01,M02');
}

async function cmdApply() {
  const activated = flag('--activar') || process.env.MEJORAS_ACTIVADAS === '1';
  const dryRun = flag('--dry-run');
  if (!activated && !dryRun) {
    die('Este comando modifica código y exige activación explícita.\n   Usa: npm run mejoras:aplicar -- --solo M01,M02\n   O para ver qué haría: npm run mejoras:aplicar -- --dry-run --solo M01');
  }

  const plan = loadPlan();
  savePlan(plan);
  const wanted = value('--solo').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const max = Math.max(1, Number(value('--max', '3')) || 3);
  let selected = plan.items.filter((i) => (wanted.length ? wanted.includes(i.id) : i.autoApplicable));
  const skippedManual = selected.filter((i) => !i.autoApplicable);
  selected = selected.filter((i) => i.autoApplicable).slice(0, wanted.length ? undefined : max);

  printPlan(plan);
  if (skippedManual.length) {
    log(`🙋 Omitidas por requerir intervención manual: ${skippedManual.map((i) => i.id).join(', ')}`);
  }
  if (!selected.length) {
    log('✅ No hay propuestas auto-aplicables que ejecutar.');
    return;
  }
  if (wanted.length && selected.length < wanted.length) {
    const found = new Set(plan.items.map((i) => i.id));
    const missing = wanted.filter((id) => !found.has(id));
    if (missing.length) log(`⚠️ IDs no encontrados en el plan: ${missing.join(', ')}`);
  }

  const prompt = buildPrompt(plan, selected);
  if (dryRun) {
    log('\n--- DRY RUN: prompt que se enviaría a OpenCode ---\n');
    log(prompt);
    return;
  }

  if (flag('--pr') && dirtyFiles().length) {
    die('--pr exige un árbol de trabajo limpio (ahora hay cambios sin commit).\n   Haz commit/stash de tu trabajo y vuelve a intentarlo, o aplica sin --pr y revisa el diff a mano.');
  }

  const model = value('--model', process.env.MEJORAS_MODEL || '');
  const planFile = path.join(reportsDir, 'plan-mejoras.md');
  const logFile = path.join(reportsDir, `mejoras-${date}.log`);
  writeFileSync(logFile, `# mejoras ${new Date().toISOString()} · ${selected.map((i) => i.id).join(', ')}\n`);

  const before = gitStatus();
  const oc = resolveOpencode();
  const openArgs = ['run', prompt, '--dir', root];
  if (model) openArgs.push('--model', model);
  // En CI no hay terminal para aprobar permisos: `--auto` deja que el agente
  // edite y ejecute la verificación. En local se mantiene el modo interactivo
  // salvo que el usuario pase --auto explícitamente.
  if (flag('--auto') || process.env.MEJORAS_AUTO === '1') openArgs.push('--auto');
  if (existsSync(planFile)) openArgs.push('--file', planFile);

  log(`\n🤖 OpenCode en marcha · ${selected.map((i) => i.id).join(', ')}`);
  log(`   Log: ${logFile}`);
  const timeoutMin = Math.max(1, Number(process.env.MEJORAS_TIMEOUT_MIN || 25));
  const run = await runProcess(oc.command, openArgs, { timeoutMs: timeoutMin * 60 * 1000, logFile, shell: oc.shell });
  if (run.error) die(run.error);
  if (run.code !== 0) log(`⚠️ OpenCode terminó con código ${run.code} (revisa el log).`);

  const after = gitStatus();
  const changed = after !== before;
  const files = dirtyFiles();
  log(changed
    ? `\n📝 Cambios en el árbol (${files.length} archivo(s) con diferencias).`
    : '\nℹ️ No se detectaron cambios nuevos en el árbol.');

  const result = {
    date: new Date().toISOString(),
    planSignature: plan.signature,
    ids: selected.map((i) => i.id),
    opencodeExit: run.code,
    changed,
    log: path.relative(root, logFile),
    verified: false,
    verifyExit: null,
  };

  if (changed && !flag('--sin-verificar')) {
    const verify = verifyCommand(plan);
    log(`\n🔎 Verificando con ${verify.args.join(' ')} (puede tardar varios minutos)...`);
    const verifyFile = path.join(reportsDir, `mejoras-${date}-verify.log`);
    const v = await runProcess(verify.command, verify.args, {
      timeoutMs: Math.max(1, Number(process.env.MEJORAS_VERIFY_TIMEOUT_MIN || 30)) * 60 * 1000,
      logFile: verifyFile,
      shell: verify.shell,
    });
    result.verified = true;
    result.verifyExit = v.code;
    if (v.code === 0) {
      log('✅ Verificación en verde.');
    } else {
      log(`\n⚠️ La verificación no pasó (código ${v.code}). Los cambios siguen en el working tree para revisión.`);
      log(`   Log: ${verifyFile}`);
    }
  } else if (changed) {
    log('ℹ️ Verificación omitida (--sin-verificar).');
  }

  let prUrl = '';
  if (changed && flag('--pr') && result.verifyExit === 0) {
    prUrl = createPr(plan, selected);
  } else if (flag('--pr') && result.verifyExit !== 0) {
    log('ℹ️ No se crea PR: la verificación no está en verde.');
  }
  result.prUrl = prUrl;
  result.prCreated = Boolean(prUrl);

  writeFileSync(path.join(reportsDir, 'mejoras-ultima.json'), JSON.stringify(result, null, 2));

  if (result.verifyExit && result.verifyExit !== 0) process.exitCode = 1;
}

async function cmdEstado() {
  const plan = readJson(path.join(reportsDir, 'plan-mejoras.json'));
  const last = readJson(path.join(reportsDir, 'mejoras-ultima.json'));
  if (!plan) {
    log('No hay plan guardado. Ejecuta: npm run mejoras');
  } else {
    printPlan(plan);
    log(`📄 Plan: ${path.join(reportsDir, 'plan-mejoras.md')}`);
  }
  if (last) {
    log('Último intento de aplicación:');
    log(`   ${last.date} · ${last.ids?.join(', ') || '-'} · cambios: ${last.changed ? 'sí' : 'no'} · verificado: ${last.verified ? (last.verifyExit === 0 ? 'verde' : `rojo (${last.verifyExit})`) : 'no'}`);
    if (last.log) log(`   Log: ${last.log}`);
  }
  const files = dirtyFiles();
  log(`\nÁrbol de trabajo: ${files.length ? `${files.length} archivo(s) con cambios` : 'limpio'}.`);
}

function cmdDiff() {
  const plan = loadPlan();
  printPlan(plan);
  log('Archivos que el plan propone tocar:');
  for (const it of plan.items) {
    if (!it.autoApplicable) continue;
    log(`   ${it.id}: ${(it.files || []).join(', ') || '(sin archivos concretos)'}`);
  }
}

async function main() {
  if (cmd === 'plan') return cmdPlan();
  if (cmd === 'aplicar') return cmdApply();
  if (cmd === 'estado') return cmdEstado();
  if (cmd === 'diff') return cmdDiff();
  die(`Comando desconocido: ${cmd}\n   Usa: plan | aplicar | estado | diff`);
}

main().catch((e) => {
  console.error(`\n⛔ Error: ${(e && e.message) || e}`);
  process.exit(1);
});
