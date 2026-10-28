// scripts/nightly-step-summary.mjs
// Genera un resumen en Markdown estructurado para $GITHUB_STEP_SUMMARY.
// Funciona tanto para el chequeo de producción como para la validación de cert.
// Uso: node scripts/nightly-step-summary.mjs [archivo-report.json o action.json]
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reportsDir = path.join(root, 'nightly-reports');

function findLatest(pattern) {
  try {
    const files = readdirSync(reportsDir).filter((f) => pattern.test(f)).sort();
    if (!files.length) return null;
    return path.join(reportsDir, files[files.length - 1]);
  } catch {
    return null;
  }
}

const targetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : (findLatest(/^(nightly|cert)-\d{4}-\d{2}-\d{2}\.json$/) || path.join(reportsDir, 'nightly-action.json'));

let data = null;
try {
  data = JSON.parse(readFileSync(targetPath, 'utf8'));
} catch (err) {
  console.log(`### ⚠️ Resumen nocturno no disponible\nNo se pudo leer el archivo de informe: \`${err.message}\``);
  process.exit(0);
}

// Cargar también action.json si leímos el reporte completo, o viceversa
let actionData = null;
let fullReport = null;

if (data.failures && Array.isArray(data.failures)) {
  actionData = data;
  const envPrefix = data.env === 'certificacion' ? 'cert' : 'nightly';
  const latestFull = findLatest(new RegExp(`^${envPrefix}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
  if (latestFull) {
    try { fullReport = JSON.parse(readFileSync(latestFull, 'utf8')); } catch {}
  }
} else if (data.results && Array.isArray(data.results)) {
  fullReport = data;
  const envPrefix = data.env === 'certificacion' ? 'cert' : 'nightly';
  const actionFile = path.join(reportsDir, `${envPrefix}-action.json`);
  try { actionData = JSON.parse(readFileSync(actionFile, 'utf8')); } catch {}
}

const isCert = (fullReport?.env || actionData?.env) === 'certificacion' || /cert/i.test(targetPath);
const base = fullReport?.base || actionData?.base || 'https://genyoga.studio';
const date = (fullReport?.date || actionData?.date || new Date().toISOString()).slice(0, 19).replace('T', ' ');
const testUser = fullReport?.testUser || actionData?.testUser || 'prueba@prueba.com';
const commit = fullReport?.commit || actionData?.commit || process.env.GITHUB_SHA?.slice(0, 7) || '';
const certInfo = fullReport?.cert || actionData?.cert;

const planFile = path.join(reportsDir, isCert ? 'plan-mejoras-cert.json' : 'plan-mejoras.json');
let plan = null;
try { plan = JSON.parse(readFileSync(planFile, 'utf8')); } catch { /* aún no generado */ }

const passed = fullReport?.summary?.passed ?? (fullReport?.results?.filter((r) => r.status === 'pass').length ?? 0);
const failed = fullReport?.summary?.failed ?? (actionData?.summary?.failed ?? actionData?.failures?.length ?? 0);
const warned = fullReport?.summary?.warned ?? (fullReport?.warnings?.length ?? 0);
const total = fullReport?.summary?.total ?? (passed + failed + warned);
const highFails = actionData?.summary?.high ?? (actionData?.failures?.filter((f) => f.severity === 'high').length ?? 0);

const lines = [];

// 1. Título principal con badge
if (failed === 0) {
  lines.push(`## 🟢 ${isCert ? 'Certificación' : 'Producción'}: Estado Saludable (0 fallos)`);
} else {
  lines.push(`## 🔴 ${isCert ? 'Certificación' : 'Producción'}: ${failed} Fallo(s) Detectado(s)${highFails > 0 ? ` (${highFails} de alta severidad)` : ''}`);
}
lines.push('');

// 2. Tabla de métricas generales
lines.push('### 📊 Resumen de la Ejecución');
lines.push('');
lines.push('| Métrica | Detalle |');
lines.push('| :--- | :--- |');
lines.push(`| **Entorno** | \`${isCert ? 'Certificación (Pre-producción)' : 'Producción Real'}\` |`);
lines.push(`| **Base URL** | [${base}](${base}) |`);
if (commit) lines.push(`| **Commit** | \`${commit}\` |`);
lines.push(`| **Fecha / Hora** | ${date} UTC |`);
lines.push(`| **Usuario de pruebas** | \`${testUser}\` |`);
if (certInfo?.version) {
  lines.push(`| **Versión en Cert** | \`v${certInfo.version}\` (Supabase: \`${certInfo.supabase || '?'}\`) |`);
}
lines.push(`| **Resultado Global** | ${failed === 0 ? '✅ **TODO CORRECTO**' : '❌ **FALLOS PENDIENTES**'} |`);
lines.push(`| **Comprobaciones** | Total: **${total}** \| ✅ Pasadas: **${passed}** \| ❌ Falladas: **${failed}** \| ⚠️ Avisos: **${warned}** |`);
if (plan?.health) {
  const h = plan.health;
  const badge = h.grade === 'EXCELENTE' ? '🟢' : h.grade === 'BUENO' ? '🔵' : h.grade === 'ATENCIÓN' ? '🟠' : '🔴';
  lines.push(`| **Salud** | ${badge} **${h.score}/100 (${h.grade})** \| Funcional **${h.functionalScore}** · Experiencia **${h.experienceScore}** |`);
}
if (plan?.health?.coverage) {
  const c = plan.health.coverage;
  lines.push(`| **Cobertura** | ${c.ratio >= 1 ? '✅' : '⚠️'} **${c.present}/${c.expected}** suites${c.missing?.length ? ` (faltan: ${c.missing.join(', ')})` : ''} |`);
}
if (plan?.health?.personas || actionData?.personas) {
  const p = plan?.health?.personas || actionData.personas;
  lines.push(`| **Personas** | 🧑‍🤝‍🧑 ${p.passed}/${p.total} limpias \| fricción **${p.friction}/100** \| ${p.deadEnds} bloqueo(s) \| ${p.findings} hallazgo(s) |`);
}
lines.push('');

// 3. Desglose por suites si tenemos el reporte completo
if (fullReport?.results?.length) {
  const suites = new Map();
  for (const r of fullReport.results) {
    if (!suites.has(r.suite)) {
      suites.set(r.suite, { total: 0, pass: 0, fail: 0, warn: 0 });
    }
    const s = suites.get(r.suite);
    s.total++;
    if (r.status === 'pass') s.pass++;
    else if (r.status === 'fail') s.fail++;
    else if (r.status === 'warn') s.warn++;
  }

  lines.push('### 🧩 Desglose por Categoría / Suite');
  lines.push('');
  lines.push('| Categoría | Total | ✅ Pasadas | ❌ Falladas | ⚠️ Avisos | Estado |');
  lines.push('| :--- | :---: | :---: | :---: | :---: | :---: |');
  for (const [name, stats] of suites.entries()) {
    const statusIcon = stats.fail > 0 ? '🔴' : stats.warn > 0 ? '🟡' : '🟢';
    lines.push(`| **${name}** | ${stats.total} | ${stats.pass} | ${stats.fail} | ${stats.warn} | ${statusIcon} |`);
  }
  lines.push('');
}

// 3.5. Plan de mejoras accionable
if (plan?.items?.length) {
  const auto = plan.items.filter((i) => i.autoApplicable);
  lines.push('### 🧭 Plan de mejoras');
  lines.push('');
  lines.push(`**${plan.summary.total} propuesta(s)**: ${plan.summary.p1} P1 · ${plan.summary.p2} P2 · ${plan.summary.p3} P3 · ${plan.summary.auto} auto-aplicables · ${plan.summary.manual} manuales.`);
  lines.push('');
  lines.push('| ID | Prioridad | Categoría | Propuesta | Aplicación |');
  lines.push('| :---: | :---: | :--- | :--- | :---: |');
  for (const it of plan.items.slice(0, 8)) {
    lines.push(`| **${it.id}** | ${it.priority} | ${it.category} | ${String(it.title).replace(/\|/g, '\\|').slice(0, 90)} | ${it.autoApplicable ? '🤖 auto' : '🙋 manual'} |`);
  }
  if (plan.items.length > 8) lines.push(`| … | | | ${plan.items.length - 8} propuesta(s) más | |`);
  lines.push('');
  if (auto.length) {
    lines.push(`> 🤖 **Aplicar con IA**: etiqueta \`aplicar-mejoras\` en el issue del plan, o \`npm run mejoras:aplicar -- --solo ${auto[0].id}\` en local.`);
    lines.push('');
  }
}

// 4. Detalle de fallos (action items + bloqueos de personas, que no duplican
//    propuestas en el plan pero sí deben verse en el resumen)
const failures = [...(actionData?.failures || []), ...(actionData?.personaFailures || [])];
if (failures.length > 0) {
  lines.push('### 🚨 Detalle de Fallos');
  lines.push('');
  lines.push('| ID | Severidad | Suite | Comprobación | Detalle | Sospechosos |');
  lines.push('| :---: | :---: | :--- | :--- | :--- | :--- |');
  for (const f of failures) {
    const sevBadge = f.severity === 'high' ? '🔴 ALTA' : f.severity === 'low' ? '🟡 BAJA' : '🟠 MEDIA';
    const detail = (f.detail || '').replace(/\|/g, '\\|').slice(0, 150);
    const files = (f.suspectedFiles || []).map((s) => `\`${s}\``).slice(0, 2).join(', ') || '-';
    lines.push(`| **${f.id}** | ${sevBadge} | \`${f.suite}\` | ${f.check} | ${detail} | ${files} |`);
  }
  lines.push('');

  lines.push('> 💡 **Prompt para corrección automática**: Revisa el issue creado o el artefacto `nightly-report` / `cert-report` para ver el bloque completo listo para el agente.');
  lines.push('');
}

// 5. Avisos (si hay)
if (fullReport?.warnings?.length) {
  lines.push('<details>');
  lines.push(`<summary>⚠️ <b>Ver ${fullReport.warnings.length} aviso(s) no bloqueante(s)</b></summary>`);
  lines.push('');
  for (const w of fullReport.warnings) {
    lines.push(`- ${w}`);
  }
  lines.push('</details>');
  lines.push('');
}

console.log(lines.join('\n'));
