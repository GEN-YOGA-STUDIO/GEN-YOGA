// scripts/analizar-informe-diario.mjs
// Análisis diario del chequeo nocturno + plan de mejoras accionable.
//
// Ya no calcula un "health score" opaco: usa nightly-intelligence.mjs para
// separar salud funcional (rompe el negocio) de salud de experiencia (fricción,
// a11y, SEO, PWA) y explica cada punto perdido.
//
// Salidas:
//   - nightly-reports/<prefix>-analisis-diario.md
//   - nightly-reports/plan-mejoras.json  (producción)
//   - nightly-reports/plan-mejoras.md
//   - nightly-reports/plan-mejoras-cert.json/.md (certificación)
//   - Opcional: --append-summary (vuelca a $GITHUB_STEP_SUMMARY)
//
// Uso: node scripts/analizar-informe-diario.mjs [--cert] [--append-summary] [--no-plan]
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPlan,
  loadLatestAction,
  loadLatestPersonas,
  loadPreviousAction,
  renderPlanMarkdown,
} from './nightly-intelligence.mjs';

const isCert = process.argv.includes('--cert') || process.env.CERT_MODE === '1';
const appendSummary = process.argv.includes('--append-summary');
const writePlan = !process.argv.includes('--no-plan');
const root = process.cwd();
const env = isCert ? 'certificacion' : 'produccion';
const prefix = isCert ? 'cert' : 'nightly';

function getReportsDir() {
  const p1 = path.join(root, 'nightly-reports');
  const p2 = path.join(root, 'ultima version', 'nightly-reports');
  if (existsSync(p1) && readdirSync(p1).some((f) => f.endsWith('.json'))) return p1;
  if (existsSync(p2) && readdirSync(p2).some((f) => f.endsWith('.json'))) return p2;
  return p1;
}

const reportsDir = getReportsDir();
const fileRegex = new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.json$`);

function loadAllReports() {
  try {
    const files = readdirSync(reportsDir).filter((f) => fileRegex.test(f)).sort();
    return files.map((f) => {
      try {
        const raw = JSON.parse(readFileSync(path.join(reportsDir, f), 'utf8'));
        const fileDate = f.replace(`${prefix}-`, '').replace('.json', '');
        return { file: f, fileDate, ...raw };
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

const history = loadAllReports();
if (!history.length) {
  console.log(`⚠️ No se encontraron informes históricos para el prefijo "${prefix}" en ${reportsDir}`);
  process.exit(0);
}

const today = history[history.length - 1];
const yesterday = history.length > 1 ? history[history.length - 2] : null;

const action = loadLatestAction(root, env);
const previousAction = loadPreviousAction(root, env);
const personaLoaded = loadLatestPersonas(root);
const personaReport = personaLoaded && String(personaLoaded.date || '').slice(0, 10) === today.fileDate ? personaLoaded : null;

const plan = buildPlan({
  action,
  fullReport: today,
  personaReport,
  previousAction,
  skipPersonas: Boolean(today.personasSkipped),
});
const health = plan.health;

// ---------------------------------------------------------------- comparativa
const totalToday = today.summary?.total || today.results?.length || 0;
const passedToday = today.summary?.passed || today.results?.filter((r) => r.status === 'pass').length || 0;
const failedToday = today.summary?.failed || today.errors?.length || 0;
const warnedToday = today.summary?.warned || today.warnings?.length || 0;
const passRateToday = totalToday > 0 ? ((passedToday / totalToday) * 100).toFixed(1) : '100.0';

const totalYest = yesterday ? (yesterday.summary?.total || yesterday.results?.length || 0) : totalToday;
const passedYest = yesterday ? (yesterday.summary?.passed || yesterday.results?.filter((r) => r.status === 'pass').length || 0) : passedToday;
const failedYest = yesterday ? (yesterday.summary?.failed || yesterday.errors?.length || 0) : 0;
const warnedYest = yesterday ? (yesterday.summary?.warned || yesterday.warnings?.length || 0) : warnedToday;
const passRateYest = totalYest > 0 ? ((passedYest / totalYest) * 100).toFixed(1) : '100.0';

function warningText(w) {
  if (typeof w === 'string') return w;
  return `${w.suite || '?'} · ${w.name || '?'}${w.detail ? ` — ${w.detail}` : ''}`;
}
function warningKey(w) {
  if (typeof w === 'string') return w.split('—')[0].trim();
  return `${w.suite || '?'}::${w.name || '?'}`;
}
const warningsToday = (today.warningDetails?.length ? today.warningDetails : today.warnings) || [];
const warningsYest = (yesterday?.warningDetails?.length ? yesterday.warningDetails : yesterday?.warnings) || [];
const yKeys = new Set(warningsYest.map(warningKey));
const newWarnings = warningsToday.filter((w) => !yKeys.has(warningKey(w)));
const recurringWarnings = warningsToday.filter((w) => yKeys.has(warningKey(w)));

// ---------------------------------------------------------------- rendimiento
function getPerf(report) {
  const out = {};
  if (Array.isArray(report?.perfSummary)) {
    for (const p of report.perfSummary) if (p.page) out[p.page] = p.worstMs ?? p.ms ?? 0;
  } else if (report?.results) {
    for (const r of report.results) {
      if (r.suite !== 'rendimiento') continue;
      const m = String(r.name || '').match(/^([^:]+):\s*(\d+)ms/);
      if (!m || m[1] === 'TTFB home') continue;
      const page = m[1].split('?')[0];
      out[page] = Math.max(out[page] || 0, Number(m[2]));
    }
  }
  for (const r of report?.results || []) {
    if (r.suite === 'rendimiento') {
      const ttfb = String(r.name || '').match(/TTFB home:\s*(\d+)ms/);
      if (ttfb) out.TTFB = Number(ttfb[1]);
    }
  }
  return out;
}
const perfToday = getPerf(today);
const perfYest = getPerf(yesterday);
const sslDays = health.sslDays;

// ---------------------------------------------------------------- redacción
const badge = health.grade === 'EXCELENTE' ? '🟢 EXCELENTE'
  : health.grade === 'BUENO' ? '🔵 BUENO'
    : health.grade === 'ATENCIÓN' ? '🟠 ATENCIÓN' : '🔴 CRÍTICO';

const lines = [];
lines.push(`## 🧠 Análisis Inteligente Diario del Chequeo Nocturno [${isCert ? 'Certificación' : 'Producción'}]`);
lines.push('');
lines.push(`> **Diagnóstico del Día (${today.fileDate})**: Salud General **${badge}** (**${health.score}/100 pts**)`);
lines.push(`> Funcional **${health.functionalScore}/100** · Experiencia **${health.experienceScore}/100** · Cobertura **${health.coverage.present}/${health.coverage.expected}** suites`);
lines.push('');

lines.push('### 🩺 Salud explicable');
lines.push('');
lines.push('| Dimensión | Puntuación | Qué mide |');
lines.push('| :--- | :---: | :--- |');
lines.push(`| **Funcional** | **${health.functionalScore}/100** | Caídas, pagos, auth, backend, SSL, cobertura y rendimiento. |`);
lines.push(`| **Experiencia** | **${health.experienceScore}/100** | A11y, SEO, PWA, i18n, entrega y fricción de personas. |`);
lines.push(`| **Global** | **${health.score}/100** | 75% funcional + 25% experiencia. |`);
lines.push('');
if (health.penalties.length) {
  lines.push('**Puntos perdidos:**');
  for (const p of health.penalties) lines.push(`- ${p.side === 'functional' ? '⚙️' : '🎨'} **${p.label}** (−${p.points})`);
  lines.push('');
} else {
  lines.push('**Sin penalizaciones:** no hay fallos, deuda pendiente ni fricción medible.');
  lines.push('');
}
if (health.coverage.missing.length) {
  lines.push(`> ⚠️ **Cobertura incompleta:** faltan ${health.coverage.missing.join(', ')}. Un verde parcial no es un verde.`);
  lines.push('');
}
if (health.personas) {
  const p = health.personas;
  lines.push(`> 🧑‍🤝‍🧑 **Personas:** ${p.passed}/${p.total} recorridos limpios · fricción media ${p.friction}/100 · ${p.deadEnds} bloqueo(s) · ${p.findings} hallazgo(s).`);
  lines.push('');
}
lines.push(`> 🔁 **Fallos:** ${health.newFailures} nuevo(s) · ${health.recurringFailures} recurrente(s) · ${health.resolvedFailures} resuelto(s) respecto a la pasada anterior.`);
lines.push('');

lines.push('### 📈 Comparativa Evolutiva (Hoy vs Pasada Anterior)');
lines.push('');
lines.push('| Métrica | Hoy | Pasada Anterior | Tendencia |');
lines.push('| :--- | :---: | :---: | :---: |');
const deltaPass = (Number(passRateToday) - Number(passRateYest)).toFixed(1);
lines.push(`| **Tasa de Aprobación** | **${passRateToday}%** | ${passRateYest}% | ${deltaPass >= 0 ? `🟢 +${deltaPass}%` : `🔴 ${deltaPass}%`} |`);
lines.push(`| **Total Comprobaciones** | **${totalToday}** | ${totalYest} | ${totalToday >= totalYest ? `🟢 +${totalToday - totalYest} checks` : `⚠️ ${totalToday - totalYest}`} |`);
lines.push(`| **Fallos Bloqueantes** | **${failedToday}** | ${failedYest} | ${failedToday === 0 ? '🟢 0 fallos' : `🔴 ${failedToday} fallo(s)`} |`);
lines.push(`| **Avisos Totales** | **${warnedToday}** | ${warnedYest} | ${warnedToday <= warnedYest ? '🟢 Estable/Baja' : `🟡 +${warnedToday - warnedYest} avisos`} |`);

if (perfToday.TTFB !== undefined) {
  const yTtfb = perfYest.TTFB || perfToday.TTFB;
  const diffTtfb = perfToday.TTFB - yTtfb;
  lines.push(`| **Latencia TTFB** | **${perfToday.TTFB}ms** | ${yTtfb}ms | ${diffTtfb <= 0 ? `🟢 ${diffTtfb}ms` : diffTtfb > 150 ? `🟡 +${diffTtfb}ms` : `🟢 +${diffTtfb}ms`} |`);
}
if (sslDays !== null) {
  lines.push(`| **Certificado SSL/TLS** | **${sslDays} días** | — | ${sslDays > 30 ? '🟢 Válido' : sslDays > 14 ? '🟡 Renovar pronto' : '🔴 RENOVAR URGENTE'} |`);
}
lines.push('');

const perfPages = Object.entries(perfToday).filter(([page]) => page !== 'TTFB');
if (perfPages.length) {
  lines.push('### ⚡ Tiempos de Respuesta de Páginas Clave');
  lines.push('');
  lines.push('| Página | Peor Hoy | Mediana | Pasada Anterior | Estado |');
  lines.push('| :--- | :---: | :---: | :---: | :---: |');
  const summaryByPage = new Map((today.perfSummary || []).map((p) => [p.page, p]));
  for (const [page, ms] of perfPages) {
    const prev = perfYest[page] || ms;
    const diff = ms - prev;
    const median = summaryByPage.get(page)?.medianMs;
    const status = ms < 1000 ? '🟢 Rápido' : ms < 3000 ? '🟡 Normal' : '🔴 Lento';
    lines.push(`| \`${page}\` | **${ms}ms** | ${median ?? '—'}ms | ${prev}ms | ${status} (${diff >= 0 ? `+${diff}` : diff}ms) |`);
  }
  lines.push('');
}

lines.push('### 🔍 Diagnóstico de Avisos y Derivas');
lines.push('');
if (newWarnings.length) {
  lines.push(`#### ⚠️ Avisos Nuevos Detectados Hoy (${newWarnings.length}):`);
  for (const w of newWarnings) lines.push(`- 🆕 ${warningText(w)}`);
  lines.push('');
} else {
  lines.push('- ✅ **Cero avisos nuevos**: ninguna anomalía imprevista en la última pasada.');
  lines.push('');
}
if (recurringWarnings.length) {
  lines.push('<details>');
  lines.push(`<summary>📌 <b>Ver ${recurringWarnings.length} aviso(s) recurrente(s) de fondo</b></summary>`);
  lines.push('');
  for (const w of recurringWarnings) lines.push(`- 🔄 ${warningText(w)}`);
  lines.push('</details>');
  lines.push('');
}

lines.push('### 📋 Recomendaciones Accionables');
lines.push('');
if (health.severity.high > 0) {
  lines.push('1. 🚨 **Acción inmediata**: hay fallos de alta severidad. Revisa el issue creado o ejecuta `npm run check:nightly` para reproducir.');
} else if (failedToday > 0) {
  lines.push('1. 🟠 **Corregir fallos**: producción tiene fallos no críticos; revisa el detalle y el plan de mejoras.');
} else if (plan.summary.total > 0) {
  const first = plan.items[0];
  lines.push(`1. 🔧 **Sin fallos, con mejoras pendientes**: ${plan.summary.total} propuesta(s), ${plan.summary.auto} auto-aplicables. Empieza por \`${first.id}\` con \`npm run mejoras:aplicar -- --solo ${first.id}\`.`);
} else {
  lines.push('1. ✅ **Todo en orden**: sin fallos ni deuda pendiente medible.');
}
if (plan.summary.manual > 0) {
  lines.push(`2. 🙋 **${plan.summary.manual} propuesta(s) requieren intervención manual** (Supabase/Stripe, despliegue o datos de prueba): están marcadas como \`manual\` en el plan.`);
}
if (sslDays !== null && sslDays <= 20) {
  lines.push(`3. 🔐 **Renovación SSL**: el certificado vence en ${sslDays} días. Verifica la renovación automática.`);
}
if (health.personas?.deadEnds) {
  lines.push(`4. 🧑‍🤝‍🧑 **Recorridos bloqueados**: ${health.personas.deadEnds} persona(s) no completaron su objetivo; revisa la simulación antes de mirar métricas finas.`);
}
lines.push('');

lines.push('---');
lines.push('');
lines.push(renderPlanMarkdown(plan));

const reportMd = lines.join('\n');

// ---------------------------------------------------------------- guardado
const outAnalisis = path.join(reportsDir, `${prefix}-analisis-diario.md`);
try {
  writeFileSync(outAnalisis, reportMd);
  console.log(`\n✅ Informe analítico diario generado en: ${outAnalisis}`);
} catch (e) {
  console.error(`Error guardando análisis diario: ${e.message}`);
}

if (writePlan) {
  const planBase = isCert ? 'plan-mejoras-cert' : 'plan-mejoras';
  try {
    writeFileSync(path.join(reportsDir, `${planBase}.json`), JSON.stringify(plan, null, 2));
    writeFileSync(path.join(reportsDir, `${planBase}.md`), renderPlanMarkdown(plan));
    console.log(`🧭 Plan de mejoras: ${path.join(reportsDir, `${planBase}.md`)} (${plan.summary.total} propuestas, ${plan.summary.auto} auto-aplicables)`);
  } catch (e) {
    console.error(`Error guardando plan de mejoras: ${e.message}`);
  }
}

if (appendSummary && process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + reportMd + '\n');
    console.log('✅ Análisis incorporado a $GITHUB_STEP_SUMMARY.');
  } catch (err) {
    console.warn(`No se pudo escribir en GITHUB_STEP_SUMMARY: ${err.message}`);
  }
}

console.log('\n' + reportMd);
