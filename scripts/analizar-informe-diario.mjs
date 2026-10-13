// scripts/analizar-informe-diario.mjs
// Sistema de análisis inteligente diario para los informes del chequeo nocturno.
//
// Compara la pasada de hoy con el histórico de días anteriores:
//   - Tendencia de éxito (Pass Rate) y nuevos fallos
//   - Evolución de latencia (TTFB y tiempos de carga)
//   - Deriva de avisos (avisos nuevos vs recurrentes crónicos)
//   - Semáforo de caducidad del certificado SSL/TLS
//   - Puntuación sintética de salud (Health Score 0-100)
//
// Salida:
//   - Consola (formateado)
//   - Archivo nightly-reports/analisis-diario.md
//   - Opcional: --append-summary (vuelca a $GITHUB_STEP_SUMMARY)
//
// Uso: node scripts/analizar-informe-diario.mjs [--cert] [--append-summary]
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const isCert = process.argv.includes('--cert') || process.env.CERT_MODE === '1';
const appendSummary = process.argv.includes('--append-summary');
const root = process.cwd();

// Buscar informes en nightly-reports o en 'ultima version/nightly-reports' como fallback
function getReportsDir() {
  const p1 = path.join(root, 'nightly-reports');
  const p2 = path.join(root, 'ultima version', 'nightly-reports');
  if (existsSync(p1) && readdirSync(p1).some((f) => f.endsWith('.json'))) return p1;
  if (existsSync(p2) && readdirSync(p2).some((f) => f.endsWith('.json'))) return p2;
  return p1;
}

const reportsDir = getReportsDir();
const prefix = isCert ? 'cert' : 'nightly';
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
const previousDays = history.slice(0, -1);

// 1. Métricas de hoy
const totalToday = today.summary?.total || today.results?.length || 0;
const passedToday = today.summary?.passed || today.results?.filter((r) => r.status === 'pass').length || 0;
const failedToday = today.summary?.failed || today.errors?.length || 0;
const warnedToday = today.summary?.warned || today.warnings?.length || 0;
const passRateToday = totalToday > 0 ? ((passedToday / totalToday) * 100).toFixed(1) : '100.0';

// 2. Métricas de ayer / histórico
const totalYest = yesterday ? (yesterday.summary?.total || yesterday.results?.length || 0) : totalToday;
const passedYest = yesterday ? (yesterday.summary?.passed || yesterday.results?.filter((r) => r.status === 'pass').length || 0) : passedToday;
const failedYest = yesterday ? (yesterday.summary?.failed || yesterday.errors?.length || 0) : 0;
const warnedYest = yesterday ? (yesterday.summary?.warned || yesterday.warnings?.length || 0) : warnedToday;
const passRateYest = totalYest > 0 ? ((passedYest / totalYest) * 100).toFixed(1) : '100.0';

// 3. Extracción de latencias de rendimiento
function getPerfMetrics(report) {
  const perf = {};
  if (!report?.results) return perf;
  for (const r of report.results) {
    if (r.suite === 'disponibilidad' && r.name.includes('→ 200 en')) {
      const page = r.name.split('→')[0].trim();
      const ms = Number((r.name.match(/en\s+(\d+)ms/) || [])[1]) || 0;
      perf[page] = ms;
    }
    if (r.suite === 'rendimiento' && r.name.includes('TTFB home:')) {
      perf['TTFB'] = Number((r.name.match(/TTFB home:\s*(\d+)ms/) || [])[1]) || 0;
    }
  }
  return perf;
}

const perfToday = getPerfMetrics(today);
const perfYest = getPerfMetrics(yesterday);

// 4. Extracción de SSL y días restantes
function getSslDays(report) {
  if (!report?.results) return null;
  const ssl = report.results.find((r) => r.suite === 'disponibilidad' && r.name.includes('SSL/TLS'));
  if (!ssl) return null;
  const m = ssl.name.match(/(\d+)\s*días restantes/);
  return m ? Number(m[1]) : null;
}

const sslDays = getSslDays(today);

// 5. Análisis de avisos: Nuevos vs Recurrentes
const warningsToday = today.warnings || [];
const warningsYest = yesterday?.warnings || [];
const newWarnings = warningsToday.filter((w) => !warningsYest.some((yw) => yw.split('—')[0].trim() === w.split('—')[0].trim()));
const recurringWarnings = warningsToday.filter((w) => warningsYest.some((yw) => yw.split('—')[0].trim() === w.split('—')[0].trim()));

// 6. Cálculo del Health Score (0 - 100)
let healthScore = 100;
// Penalización por fallos (-30 si hay fallos)
healthScore -= Math.min(60, failedToday * 30);
// Penalización por avisos crónicos (-3 por cada uno)
healthScore -= Math.min(20, recurringWarnings.length * 3);
// Penalización por avisos nuevos (-2 por cada uno)
healthScore -= Math.min(10, newWarnings.length * 2);
// Penalización si TTFB > 700ms
if (perfToday['TTFB'] && perfToday['TTFB'] > 700) healthScore -= 10;
// Penalización si SSL <= 14 días
if (sslDays !== null && sslDays <= 14) healthScore -= 15;
healthScore = Math.max(0, healthScore);

const healthBadge = healthScore >= 95 ? '🟢 EXCELENTE' : healthScore >= 75 ? '🟡 ATENCIÓN' : '🔴 CRÍTICO';

// 7. Redacción del análisis diario
const lines = [];
lines.push(`## 🧠 Análisis Inteligente Diario del Chequeo Nocturno [${isCert ? 'Certificación' : 'Producción'}]`);
lines.push('');
lines.push(`> **Diagnóstico del Día (${today.fileDate})**: Salud General **${healthBadge}** (**${healthScore}/100 pts**)`);
lines.push('');

// Tabla de comparación con el histórico
lines.push('### 📈 Comparativa Evolutiva (Hoy vs Pasada Anterior)');
lines.push('');
lines.push('| Métrica | Hoy | Pasada Anterior | Tendencia |');
lines.push('| :--- | :---: | :---: | :---: |');
const deltaPass = (Number(passRateToday) - Number(passRateYest)).toFixed(1);
lines.push(`| **Tasa de Aprobación** | **${passRateToday}%** | ${passRateYest}% | ${deltaPass >= 0 ? `🟢 +${deltaPass}%` : `🔴 ${deltaPass}%`} |`);
lines.push(`| **Total Comprobaciones** | **${totalToday}** | ${totalYest} | ${totalToday >= totalYest ? `🟢 +${totalToday - totalYest} checks` : `⚠️ ${totalToday - totalYest}`} |`);
lines.push(`| **Fallos Bloqueantes** | **${failedToday}** | ${failedYest} | ${failedToday === 0 ? '🟢 0 fallos' : `🔴 ${failedToday} fallo(s)`} |`);
lines.push(`| **Avisos Totales** | **${warnedToday}** | ${warnedYest} | ${warnedToday <= warnedYest ? '🟢 Estable/Baja' : `🟡 +${warnedToday - warnedYest} avisos`} |`);

if (perfToday['TTFB'] !== undefined) {
  const yTtfb = perfYest['TTFB'] || perfToday['TTFB'];
  const diffTtfb = perfToday['TTFB'] - yTtfb;
  lines.push(`| **Latencia TTFB** | **${perfToday['TTFB']}ms** | ${yTtfb}ms | ${diffTtfb <= 0 ? `🟢 ${diffTtfb}ms` : diffTtfb > 150 ? `🟡 +${diffTtfb}ms` : `🟢 +${diffTtfb}ms`} |`);
}

if (sslDays !== null) {
  lines.push(`| **Certificado SSL/TLS** | **${sslDays} días** | ${sslDays + 1} días | ${sslDays > 30 ? '🟢 Válido' : sslDays > 14 ? '🟡 Renovar pronto' : '🔴 RENOVAR URGENTE'} |`);
}
lines.push('');

// Sección de rendimiento de páginas
if (Object.keys(perfToday).length > 0) {
  lines.push('### ⚡ Tiempos de Respuesta de Páginas Clave');
  lines.push('');
  lines.push('| Página | Tiempo Hoy | Tiempo Anterior | Estado |');
  lines.push('| :--- | :---: | :---: | :---: |');
  for (const [page, ms] of Object.entries(perfToday)) {
    if (page === 'TTFB') continue;
    const prev = perfYest[page] || ms;
    const diff = ms - prev;
    const status = ms < 400 ? '🟢 Rápido' : ms < 1000 ? '🟡 Normal' : '🔴 Lento';
    lines.push(`| \`${page}\` | **${ms}ms** | ${prev}ms | ${status} (${diff >= 0 ? `+${diff}` : diff}ms) |`);
  }
  lines.push('');
}

// Detección de avisos nuevos vs recurrentes
lines.push('### 🔍 Diagnóstico de Avisos y Derivas');
lines.push('');
if (newWarnings.length > 0) {
  lines.push(`#### ⚠️ Avisos Nuevos Detectados Hoy (${newWarnings.length}):`);
  for (const nw of newWarnings) {
    lines.push(`- 🆕 ${nw}`);
  }
  lines.push('');
} else {
  lines.push('- ✅ **Cero avisos nuevos**: Ninguna anomalía imprevista introducida en la última pasada.');
  lines.push('');
}

if (recurringWarnings.length > 0) {
  lines.push(`<details>`);
  lines.push(`<summary>📌 <b>Ver ${recurringWarnings.length} aviso(s) recurrente(s) de fondo</b></summary>`);
  lines.push('');
  for (const rw of recurringWarnings) {
    lines.push(`- 🔄 ${rw}`);
  }
  lines.push('</details>');
  lines.push('');
}

// Conclusión y Recomendación
lines.push('### 📋 Recomendaciones Accionables');
lines.push('');
if (failedToday > 0) {
  lines.push('1. 🚨 **Acción Inmediata**: Hay fallos bloqueantes en producción. Revisar el issue creado o ejecutar `npm run check:nightly` localmente para reproducir.');
} else if (healthScore < 85) {
  lines.push('1. 🟡 **Atención**: Producción está libre de fallos, pero se observan avisos recurrentes o variaciones de latencia.');
} else {
  lines.push('1. ✅ **Todo en orden**: El sistema opera dentro de los umbrales nominales de disponibilidad, privacidad y rendimiento.');
}

if (sslDays !== null && sslDays <= 20) {
  lines.push(`2. 🔐 **Renovación SSL**: El certificado TLS vence en ${sslDays} días. Verificar la renovación automática.`);
}
if (newWarnings.length > 0) {
  lines.push(`3. 🔎 **Inspeccionar nuevos avisos**: Comprobar si los ${newWarnings.length} avisos nuevos corresponden a cambios recientes en la web.`);
}
lines.push('');

const reportMd = lines.join('\n');

// Guardar el informe analítico
const outAnalisis = path.join(reportsDir, `${prefix}-analisis-diario.md`);
try {
  writeFileSync(outAnalisis, reportMd);
  console.log(`\n✅ Informe analítico diario generado en: ${outAnalisis}`);
} catch (e) {
  console.error(`Error guardando análisis diario: ${e.message}`);
}

// Si se pide append a GitHub Step Summary
if (appendSummary && process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + reportMd + '\n');
    console.log('✅ Análisis incorporado a $GITHUB_STEP_SUMMARY.');
  } catch (err) {
    console.warn(`No se pudo escribir en GITHUB_STEP_SUMMARY: ${err.message}`);
  }
}

// Imprimir en consola
console.log('\n' + reportMd);
