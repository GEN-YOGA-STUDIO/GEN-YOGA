// scripts/plan-issue.mjs
// Convierte nightly-reports/plan-mejoras.json en el cuerpo del issue que el
// equipo revisa por la mañana. El issue es también el botón de activación:
// la etiqueta `aplicar-mejoras` dispara `.github/workflows/apply-improvements.yml`.
//
// Uso:
//   node scripts/plan-issue.mjs                     # cuerpo Markdown
//   node scripts/plan-issue.mjs --cert              # plan de certificación
//   node scripts/plan-issue.mjs --auto-ids          # "M01,M02,..." auto-aplicables
//   node scripts/plan-issue.mjs --title             # título del issue
//
// El cuerpo lleva un bloque oculto `<!-- plan-data: base64 -->` con el plan
// compacto: el workflow lo lee del propio issue, sin depender del artefacto
// de otra ejecución.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const isCert = args.includes('--cert') || process.env.CERT_MODE === '1';
const root = process.cwd();
const env = isCert ? 'certificacion' : 'produccion';
const file = path.join(root, 'nightly-reports', isCert ? 'plan-mejoras-cert.json' : 'plan-mejoras.json');

let plan;
try {
  plan = JSON.parse(readFileSync(file, 'utf8'));
} catch {
  console.error(`No se pudo leer el plan: ${file}. Ejecuta antes el chequeo nocturno.`);
  process.exit(1);
}

const title = isCert
  ? '🧭 Plan de mejoras · certificación'
  : '🧭 Plan de mejoras · producción';
const MARK = isCert ? '<!-- plan-mejoras-cert -->' : '<!-- plan-mejoras -->';

if (args.includes('--title')) {
  console.log(title);
  process.exit(0);
}

const auto = plan.items.filter((i) => i.autoApplicable);
if (args.includes('--auto-ids')) {
  console.log(auto.map((i) => i.id).join(','));
  process.exit(0);
}

const compact = {
  date: plan.date,
  env: plan.env,
  base: plan.base,
  signature: plan.signature,
  summary: plan.summary,
  health: {
    score: plan.health?.score,
    grade: plan.health?.grade,
    functionalScore: plan.health?.functionalScore,
    experienceScore: plan.health?.experienceScore,
  },
  items: plan.items,
};
const payload = Buffer.from(JSON.stringify(compact), 'utf8').toString('base64');

const h = plan.health || {};
const s = plan.summary || { total: 0, p1: 0, p2: 0, p3: 0, auto: 0, manual: 0 };
const badge = h.grade === 'EXCELENTE' ? '🟢' : h.grade === 'BUENO' ? '🔵' : h.grade === 'ATENCIÓN' ? '🟠' : '🔴';
const L = [];

L.push(MARK);
L.push(`<!-- plan-signature: ${plan.signature || ''} -->`);
L.push(`<!-- plan-data: ${payload} -->`);
L.push(`# ${title} · ${String(plan.date).slice(0, 10)}`);
L.push('');
L.push(`> ${badge} Salud **${h.score ?? '?'}/100 (${h.grade || '?'})** · funcional **${h.functionalScore ?? '?'}** · experiencia **${h.experienceScore ?? '?'}**`);
L.push(`> **${s.total} propuesta(s)**: ${s.p1} P1 · ${s.p2} P2 · ${s.p3} P3 · ${s.auto} auto-aplicables · ${s.manual} manuales.`);
L.push('');
L.push(`Base: ${plan.base} · Entorno: ${env}`);
L.push('');

if (!plan.items.length) {
  L.push('## 🟢 No hay mejoras pendientes');
  L.push('');
  L.push('El chequeo no detectó defectos ni oportunidades accionables. No hay nada que aplicar.');
  L.push('');
  L.push('Este issue se actualizará en la próxima pasada nocturna.');
  console.log(L.join('\n'));
  process.exit(0);
}

L.push('## Cómo aplicar');
L.push('');
if (auto.length) {
  L.push(`- **Aplicar todo lo automático**: añade la etiqueta \`aplicar-mejoras\` a este issue. Se ejecutará OpenCode, verificará la suite completa y abrirá un PR.`);
  L.push(`- **Aplicar una selección**: lanza \`apply-improvements\` manualmente con \`ids\` = \`${auto.map((i) => i.id).join(',')}\` (o un subconjunto).`);
  L.push(`- **En local**: \`npm run mejoras:aplicar -- --solo ${auto[0].id}\` (o \`--max 3\`).`);
} else {
  L.push('- No hay propuestas auto-aplicables: las pendientes requieren intervención manual.');
}
L.push('- **Solo revisar**: `npm run mejoras` regenera el plan sin tocar código.');
L.push('- La etiqueta se retira al empezar y se repone solo si quieres reintentar. Un intento no se repite automáticamente.');
L.push('- Las propuestas `manual` requieren Supabase/Stripe, un despliegue o datos de prueba: la IA no las aplica.');
L.push('');

L.push('## Propuestas auto-aplicables');
L.push('');
if (!auto.length) {
  L.push('_Ninguna._');
  L.push('');
} else {
  L.push('| ID | Prioridad | Categoría | Propuesta | Riesgo | Archivos |');
  L.push('| :---: | :---: | :--- | :--- | :---: | :--- |');
  for (const it of auto) {
    const files = (it.files || []).slice(0, 3).map((f) => `\`${f}\``).join(', ') || '—';
    L.push(`| **${it.id}** | ${it.priority} | ${it.category} | ${String(it.title).replace(/\|/g, '\\|')} | ${it.risk} | ${files} |`);
  }
  L.push('');
  L.push('<details>');
  L.push('<summary>📋 Detalle y verificación de cada propuesta</summary>');
  L.push('');
  for (const it of auto) {
    L.push(`### ${it.id} · ${it.priority} · ${it.title}`);
    L.push('');
    L.push(`- **Por qué:** ${String(it.why).replace(/\n/g, ' ').slice(0, 500)}`);
    if (it.files?.length) L.push(`- **Archivos:** ${it.files.map((f) => `\`${f}\``).join(', ')}`);
    if (it.evidence?.url) L.push(`- **Evidencia:** ${it.evidence.url}`);
    L.push(`- **Acción:** ${it.action}`);
    L.push(`- **Verificar:** \`${it.verify}\``);
    L.push('');
  }
  L.push('</details>');
  L.push('');
}

const manual = plan.items.filter((i) => !i.autoApplicable);
if (manual.length) {
  L.push('## Requieren intervención manual');
  L.push('');
  for (const it of manual) {
    L.push(`- **${it.id}** · ${it.priority} · ${it.title}`);
    if (it.requires) L.push(`  - ${it.requires}`);
  }
  L.push('');
}

if (h.coverage && h.coverage.ratio < 1) {
  L.push('## Cobertura del chequeo');
  L.push('');
  L.push(`Faltan ${h.coverage.expected - h.coverage.present} suite(s): ${h.coverage.missing.join(', ')}. Un verde con cobertura incompleta no es un verde.`);
  L.push('');
}
if (h.personas) {
  L.push('## Personas');
  L.push('');
  L.push(`${h.personas.passed}/${h.personas.total} recorridos limpios · fricción media **${h.personas.friction}/100** · ${h.personas.deadEnds} bloqueo(s) · ${h.personas.findings} hallazgo(s).`);
  L.push('');
}

L.push('---');
L.push('*Generado por el bucle nocturno. Un plan no es una predicción: la verificación completa decide si el PR es publicable.*');

console.log(L.join('\n'));
