import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const read = (rel) => readFile(path.join(root, rel), 'utf8');

function fail(message) {
  errors.push(message);
  console.error(`  ❌ ${message}`);
}
function pass(message) {
  console.log(`  ✅ ${message}`);
}
function check(desc, condition, hint = '') {
  if (condition) pass(desc);
  else fail(hint ? `${desc} — ${hint}` : desc);
}

const pkg = JSON.parse(await read('package.json'));
const short = pkg.version.split('.').slice(0, 2).join('.');
const profile = await read('profile.html');
const report = await read('marketing-report.js');

console.log('\n--- 1. Botones del dashboard ---');
check(
  'botón Excel cableado',
  profile.includes('id="btn-informe-excel"') && profile.includes(`onclick="descargarInformeMarketing('xlsx')"`),
);
check(
  'botón PDF cableado',
  profile.includes('id="btn-informe-pdf"') && profile.includes(`onclick="descargarInformeMarketing('pdf')"`),
);
check(
  'botones dentro de view-dashboard (solo admin)',
  profile.indexOf('id="btn-informe-excel"') > profile.indexOf('id="view-dashboard"'),
);
check(
  `script marketing-report.js?v=${short}`,
  profile.includes(`src="marketing-report.js?v=${short}"`),
  'pin de versión',
);
check(
  'SheetJS por CDN con versión exacta',
  /cdn\.jsdelivr\.net\/npm\/xlsx@\d+\.\d+\.\d+\/dist\/xlsx\.full\.min\.js/.test(profile),
  'sin @latest ni rangos',
);

console.log('\n--- 2. marketing-report.js válido y seguro ---');
try {
  new Script(report, { filename: 'marketing-report.js' });
  pass('marketing-report.js: sintaxis válida');
} catch (e) {
  fail(`marketing-report.js: sintaxis inválida (${e.message})`);
}
check('sin import/export (script clásico WebView)', !/^\s*(import|export)\b/m.test(report));
check('expone descargarInformeMarketing', report.includes('window.descargarInformeMarketing = descargarInformeMarketing'));
// Solo lectura: ninguna mutación Supabase ni DDL.
const mutations = ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(', 'create policy', 'drop policy', 'alter table'];
const foundMut = mutations.filter((m) => report.toLowerCase().includes(m));
check('solo lectura (sin insert/update/upsert/delete/rpc/DDL)', foundMut.length === 0, `vistos: ${foundMut.join(', ')}`);
check('lee con .select(', report.includes('.select('));
// Ocupación desde reservas reales: la columna plazas_reservadas no se mantiene.
const reportCode = report.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('ocupación desde reservas (no de plazas_reservadas)', !reportCode.includes('plazas_reservadas'), 'esa columna sale 0 con reservas reales');
check('paginado .range() (sin tope 1000 filas)', report.includes('.range('), 'clases tiene 3000+ filas');
// Sin PII: en profiles no se seleccionan email/teléfono/nombres.
const profilesSelects = [...report.matchAll(/\.from\('profiles'\)\.select\('([^']+)'\)/g)].map((m) => m[1]);
const pii = ['email', 'telefono', 'nombre', 'apellidos', 'fecha_nacimiento'];
const piiLeak = profilesSelects.filter((s) => pii.some((p) => s.includes(p)));
check('sin datos personales en profiles', piiLeak.length === 0, `vistos: ${piiLeak.join(' | ')}`);
check('fuentes restringidas a allowlist', report.includes('ALLOWED_SOURCES'));
// Fallbacks: CSV sin SheetJS y PDF por impresión.
check('fallback CSV si SheetJS falla', report.includes('text/csv') && report.includes('writeFile'));
check('PDF por window.print (sin popups)', report.includes('window.print()') && !report.includes('window.open('));

console.log('\n--- 3. Migración RLS de lecturas staff ---');
const migDir = path.join(root, 'supabase', 'migrations');
const migs = (await readdir(migDir)).filter((f) => f.includes('marketing_report_admin_reads'));
check('fichero de migración presente', migs.length > 0);
if (migs.length > 0) {
  const sql = await read(`supabase/migrations/${migs[0]}`);
  for (const t of ['stripe_purchases', 'class_credit_packs', 'unlimited_membership_periods', 'stripe_customers']) {
    check(`policy staff SELECT en ${t}`, sql.includes(t) && sql.includes('es_staff_o_admin'), 'usa el helper existente');
  }
  check('sin escrituras en la migración', !/for\s+(insert|update|delete)/i.test(sql));
}

console.log('\n--- 4. Sincronizado con apps ---');
for (const target of ['app android/www', 'app ios/www']) {
  try {
    const bundled = await readFile(path.join(root, target, 'marketing-report.js'), 'utf8');
    check(`${target}: marketing-report.js sincronizado`, bundled === report, 'ejecuta sync_apps.py');
  } catch {
    fail(`${target}: falta marketing-report.js (ejecuta sync_apps.py)`);
  }
}

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-marketing-report: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-marketing-report: informe marketing cableado, solo-lectura y sin PII.');
