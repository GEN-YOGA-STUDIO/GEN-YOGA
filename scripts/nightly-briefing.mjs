// nightly-briefing.mjs
// Prepara docs/FALLOS_PARA_IA.md: el archivo que la IA debe analizar LO PRIMERO.
// Fusiona nightly-action.json + cert-action.json en tarjetas accionables
// (qué falla, dónde, repro, evidencia, pista de fix y comando de verificación).
// En verde escribe "sin pendientes" para no perseguir fantasmas.
// Uso: node scripts/nightly-briefing.mjs  (también lo invoca check:nightly al final)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const reports = path.join(root, 'nightly-reports');
const OUT = path.join(root, 'docs', 'FALLOS_PARA_IA.md');

function load(name) {
  try {
    return JSON.parse(readFileSync(path.join(reports, name), 'utf8'));
  } catch { return null; }
}

function pista(f) {
  const d = `${f.suite} ${f.check} ${f.detail}`;
  if (/no desplegada \(404\)/.test(d) && /fn /.test(d)) {
    const fn = (f.check.match(/fn (\S+)/) || [])[1] || '?';
    return `Desplegar la function: \`supabase functions deploy ${fn}\` (requiere acceso Supabase; no tocar código web). El frontal tiene fallback, impacto bajo pero deriva real.`;
  }
  if (/sitemap\.xml/.test(d)) {
    return `El build debe copiar \`sitemap.xml\` al artefacto (build-cert-web ya lo hace; el legacy no). Nada que tocar en código si el espejo nuevo lo incluye.`;
  }
  if (/is not defined/.test(d)) {
    return `Variable indefinida en un render: abrir el primer fichero:línea de sospechosos y revisar la rama que la usa (suele ser un renombro a medias). Replicar el fix en \`ultima version/\` y \`app */www\`.`;
  }
  if (/calendario/i.test(d)) {
    return `Semana actual vacía es NORMAL en talleres (usar SEMANA SIGUIENTE). Si el panel se atasca tras ver otros modos, mirar estado mode/teacher en \`public-calendar.js\` (applyOpenOptions/close). Captura en el artefacto.`;
  }
  if (/precio|catálogo| ≠ |cobrado/.test(d)) {
    return `Dinero real: comparar lo impreso en la tarjeta con \`stripe_productos\` (el detalle trae ambos valores). Corregir el lado incorrecto y re-verificar.`;
  }
  if (/no abre|no conmuta|no se muestra|vacía|incompleta/.test(d)) {
    return `Reproducir el clic con los pasos de abajo; revisar consola + captura del artefacto. Suele ser cableado (onclick), timing o contenido dinámico vacío.`;
  }
  if (/privacidad|FUGA|RLS/i.test(d)) {
    return `Posible fuga o policy RLS: revisar migración/policies de la tabla en \`supabase/migrations/\`. NO relajar policies para callar el test.`;
  }
  return `Reproducir con los pasos; la captura está en \`nightly-reports/img/\` del artefacto. Cambios mínimos y verificar.`;
}

function verifica(f) {
  const cmd = f.env === 'certificacion' || /cert/i.test(f.base || '') ? 'npm run check:cert' : 'npm run check:nightly';
  return `\`${cmd}\` (acepta PROD_BASE_URL local para iterar)`;
}

export function buildBriefing(prodAction, certAction) {
  const actions = [prodAction, certAction].filter(Boolean);
  const fails = actions.flatMap((a) => (a.failures || []).map((f) => ({ ...f, env: a.env || '?', base: a.base || '' })));
  const L = [];
  L.push('# Fallos pendientes para la IA (autogenerado)');
  L.push('');
  L.push(`Generado: ${new Date().toISOString()}. Lo regenera cada \`check:nightly\` / \`check:cert\`.`);
  L.push('');
  if (!fails.length) {
    L.push('## 🟢 Sin fallos pendientes');
    L.push('');
    L.push('Producción y cert en verde en la última pasada. Nada que arreglar.');
    L.push('');
    return L.join('\n');
  }
  const highs = fails.filter((f) => f.severity === 'high').length;
  L.push(`## 🔴 ${fails.length} fallo(s) pendientes (${highs} alta severidad)`);
  L.push('');
  L.push('Orden: alta severidad primero. Reglas: cambios mínimos; si tocas .html/.js/.css replica en `ultima version/` (+ `app */www`); no toques el espejo de cert; no escribas secretos; verifica cada fix antes de darlo por cerrado.');
  L.push('');
  const order = { high: 0, medium: 1 };
  fails.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));
  // IDs únicos por entorno + marca de posible misma causa raíz.
  const seen = new Map();
  fails.forEach((f, i) => {
    f.uid = `${f.env === 'certificacion' ? 'CERT' : 'PROD'}-${String(i + 1).padStart(2, '0')}`;
    const sig = `${f.suite}|${String(f.detail).slice(0, 80)}`;
    seen.set(sig, (seen.get(sig) || 0) + 1);
    f.sig = sig;
  });
  for (const f of fails) {
    L.push(`### ${f.uid} [${f.severity}] [${f.env}] ${f.suite} · ${f.check}`);
    L.push('');
    if (seen.get(f.sig) > 1) L.push(`> ⚠️ Posible misma causa raíz que otro item (mismo síntoma en otro suite/entorno).`);
    L.push(`- Detalle: ${String(f.detail).slice(0, 300)}`);
    if (f.url) L.push(`- Dónde: ${f.url}`);
    if (f.suspectedFiles?.length) L.push(`- Mirar: ${f.suspectedFiles.map((x) => `\`${x}\``).join(', ')}`);
    if (f.repro?.length) { L.push(`- Repro:`); f.repro.slice(0, 4).forEach((s, i) => L.push(`  ${i + 1}. ${s}`)); }
    if (f.evidence?.console?.length) L.push(`- Evidencia: \`${String(f.evidence.console[0]).slice(0, 220)}\``);
    if (f.evidence?.screenshot) L.push(`- Captura: \`${f.evidence.screenshot}\` (artefacto CI)`);
    L.push(`- Pista: ${pista(f)}`);
    L.push(`- Verificar: ${verifica(f)}`);
    L.push('');
  }
  return L.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const md = buildBriefing(load('nightly-action.json'), load('cert-action.json'));
  writeFileSync(OUT, md);
  console.log(`briefing: ${OUT}`);
}
