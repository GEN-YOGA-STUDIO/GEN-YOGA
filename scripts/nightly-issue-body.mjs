// nightly-issue-body.mjs
// Convierte nightly-reports/nightly-action.json en el cuerpo del issue
// "agent-ready": cada fallo trae evidencia + sospechosos + repro y un bloque
// "Prompt para OpenCode" pegable en `opencode run`.
// Uso: node scripts/nightly-issue-body.mjs [action.json] > issue-body.md
// Con CERT_MODE=1 el título y el prompt apuntan al entorno de certificación
// (el fix va al repo principal; cert se republica solo con push).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const isCert = process.env.CERT_MODE === '1';
const actionName = isCert ? 'cert-action.json' : 'nightly-action.json';

const root = process.cwd();
const reports = path.join(root, 'nightly-reports');
function latestAction() {
  try {
    const files = readdirSync(reports).filter((f) => /^nightly-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) return null;
    const full = JSON.parse(readFileSync(path.join(reports, files[files.length - 1]), 'utf8'));
    return {
      date: full.date, base: full.base || 'https://genyoga.studio',
      testUser: full.testUser || 'prueba@prueba.com', commit: full.commit || '',
      summary: { failed: full.errors.length, high: 0 },
      failures: full.errors.map((e, i) => ({
        id: `F${String(i + 1).padStart(2, '0')}`, suite: 'desconocido',
        check: String(e).split('·')[1]?.split('—')[0]?.trim() || String(e),
        detail: String(e), url: '', severity: 'medium',
        suspectedFiles: [], repro: [], evidence: { console: [], screenshot: null },
      })),
    };
  } catch { return null; }
}

let action = null;
const arg = process.argv[2];
try {
  action = JSON.parse(readFileSync(arg ? path.resolve(arg) : path.join(reports, actionName), 'utf8'));
} catch { action = latestAction(); }

if (!action) {
  console.log([
    '<!-- opencode-autofix -->',
    '# 🌙 Chequeo nocturno: sin informe',
    '',
    'El workflow falló antes de generar `nightly-action.json` (p. ej. fallo de infra en CI).',
    'Revisar el log de la ejecución y el artefacto `nightly-report`.',
  ].join('\n'));
  process.exit(0);
}

const L = [];
L.push('<!-- opencode-autofix -->');
L.push(isCert
  ? `# 🧪 Validación de cert: ${action.summary.failed} fallo(s) antes de producción`
  : `# 🌙 Chequeo nocturno: ${action.summary.failed} fallo(s) en producción`);
L.push('');
L.push(`- Fecha: ${action.date}`);
L.push(`- Base: ${action.base} · Usuario de pruebas: ${action.testUser}`);
L.push(`- Commit verificado: ${action.commit || '(desconocido)'}`);
if (action.cert?.version) L.push(`- Versión bajo prueba: ${action.cert.version} (construido ${(action.cert.construido || '').slice(0, 16)}, supabase ${action.cert.supabase || '?'})`);
L.push(`- Severidad alta: ${action.summary.high} · Total: ${action.summary.failed}`);
L.push(`- Artefacto: \`nightly-report\` (JSON + capturas en \`img/\`)`);
L.push('');
for (const f of action.failures) {
  L.push(`## ${f.id} [${f.severity}] ${f.suite} · ${f.check}`);
  L.push('');
  L.push(`- Detalle: ${f.detail}`);
  if (f.url) L.push(`- URL: ${f.url}`);
  if (f.suspectedFiles?.length) L.push(`- Archivos sospechosos: ${f.suspectedFiles.map((x) => `\`${x}\``).join(', ')}`);
  if (f.repro?.length) { L.push(`- Repro:`); for (const s of f.repro) L.push(`  1. ${s}`); }
  if (f.evidence?.console?.length) {
    L.push(`- Evidencia (consola):`);
    L.push('  ```');
    for (const c of f.evidence.console.slice(0, 4)) L.push(`  ${String(c).slice(0, 300)}`);
    L.push('  ```');
  }
  if (f.evidence?.screenshot) L.push(`- Captura: \`${f.evidence.screenshot}\` (artefacto)`);
  L.push('');
}
L.push('## Prompt para OpenCode');
L.push('');
L.push('Pegar en `opencode run` (o dejar que el workflow `nightly-autofix` lo ejecute solo):');
L.push('');
L.push('```');
L.push(isCert
  ? 'Valida la versión del entorno de CERTIFICACIÓN antes de que pase a producción.'
  : 'Corrige los fallos del chequeo nocturno de GEN Yoga contra https://genyoga.studio.');
L.push('Contexto: repo GEN-YOGA, rama main. Fuente de despliegue web: carpeta `ultima version/`');
L.push('(el workflow de Pages la usa si existe); las apps se sincronizan con Capacitor en build.');
if (isCert) {
  L.push('CERT: reproduce contra la base del issue (un espejo, jamás producción). Corrige en main;');
  L.push('cert se republica solo con push. NO toques el repo espejo de cert ni sus secretos.');
}
L.push('REGLAS:');
L.push('- Reproduce cada fallo con el usuario de pruebas (mismo flujo que scripts/check-nightly-production.mjs).');
L.push('- Cambios mínimos y solo-lectura en el panel salvo que el fix lo exija; 0 reservas/compras reales.');
L.push('- Si tocas .html/.js/.css de la web, replica el cambio en `ultima version/` (y en `app android/www`, `app ios/www` si existen).');
L.push('- No escribas secretos ni credenciales en el código.');
L.push(isCert
  ? '- Verifica con `npm run check:cert` (acepta PROD_BASE_URL local para iterar).'
  : '- Verifica con `npm run check:nightly` (acepta PROD_BASE_URL local para iterar).');
L.push('FALLOS:');
for (const f of action.failures) {
  L.push(`- ${f.id} [${f.suite}] ${f.check}: ${String(f.detail).slice(0, 220)}`);
  if (f.suspectedFiles?.length) L.push(`  sospechosos: ${f.suspectedFiles.join(', ')}`);
  if (f.url) L.push(`  url: ${f.url}`);
}
L.push('```');
console.log(L.join('\n'));
