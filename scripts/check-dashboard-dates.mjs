import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script, createContext } from 'node:vm';

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

// ---------------------------------------------------------------------------
// 1. Patrones prohibidos: recortar ISO en crudo muestra hora UTC (inventar
// horarios) y clasifica días/frames mal. Todo pasa por helpers Europe/Madrid.
// ---------------------------------------------------------------------------
console.log('\n--- 1. Sin fechas UTC en crudo ---');
const profile = await read('profile.html');
const jsFiles = ['marketing-report.js', 'public-calendar.js', 'teacher-profiles.js', 'facilities-carousel.js', 'capacitor-bridge.js', 'i18n.js'];
const forbidden = [
  [/\.fecha_(inicio|fin)\.substring\(/, 'fecha_*.substring (hora UTC en crudo)'],
  [/\.created_at\.substring\(/, 'created_at.substring (fecha UTC en crudo)'],
  [/new Date\(c\.fecha_inicio\)\.get(Day|Hours)\(\)/, 'getDay/getHours sobre ISO UTC (día/franja erróneos)'],
];
const TZ_OPTIONS = /new Date\(c\.fecha_inicio\)\.toLocale(?:Date|Time)String\('es-ES', \{([^}]*)\}\)/g;
let patternFails = 0;
for (const [file, source] of [['profile.html', profile], ...await Promise.all(jsFiles.map(async (f) => [f, await read(f).catch(() => '')]))]) {
  for (const [re, label] of forbidden) {
    const hits = [...source.matchAll(new RegExp(re.source, 'g'))];
    if (hits.length > 0) {
      fail(`${file}: ${hits.length}× ${label}`);
      patternFails++;
    }
  }
}
if (patternFails === 0) pass('ningún recorte UTC en crudo en profile.html ni JS raíz');
// toLocale sobre fechas de clase: obligado timeZone explícito Europe/Madrid.
for (const [file, source] of [['profile.html', profile], ...await Promise.all(jsFiles.map(async (f) => [f, await read(f).catch(() => '')]))]) {
  for (const m of source.matchAll(TZ_OPTIONS)) {
    if (!m[1].includes('timeZone')) {
      fail(`${file}: toLocale sobre fecha de clase sin timeZone explícito`);
      patternFails++;
    }
  }
}
if (patternFails === 0) pass('todo toLocale de clase lleva timeZone Europe/Madrid');

// ---------------------------------------------------------------------------
// 2. Test funcional de los helpers Madrid con casos trampa (verano/invierno,
// cambio de día por huso, madrugada del cambio de hora DST 2026-03-29).
// ---------------------------------------------------------------------------
console.log('\n--- 2. Helpers Europe/Madrid correctos ---');

function balancedBlock(source, openIndex) {
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') inStr = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}

function extractFn(source, name) {
  const m = source.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`));
  if (!m) return null;
  const block = balancedBlock(source, m.index + m[0].length - 1);
  if (!block) return null;
  return m[0].slice(0, -1) + block;
}

// Referencia independiente (Intl directo, sin pasar por los helpers).
const WD_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
function refParts(iso) {
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const jsDay = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Madrid' })).getDay();
  const wdIdx = jsDay === 0 ? 6 : jsDay - 1;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    hour: Number(parts.hour),
    weekdayIdx: wdIdx,
    weekdayEs: WD_ES[wdIdx],
    month: `${parts.year}-${parts.month}`,
  };
}

const VECTORS = [
  '2026-09-22T05:00:00+00:00', // caso reportado: 05:00 UTC = 07:00 Madrid
  '2026-09-22T22:30:00+00:00', // cruza de día: 00:30 del 23 en Madrid
  '2026-01-15T08:00:00+00:00', // invierno (+1): 09:00
  '2026-03-29T00:30:00+00:00', // madrugada cambio DST: 01:30
  '2026-03-29T01:30:00+00:00', // tras el salto DST: 03:30
  '2026-09-22T21:00:00+00:00', // noche: 23:00 mismo día
];

// Helpers de profile.html.
{
  const names = ['safeParseDate', 'formatDateLocal', 'madridShifted', 'madridDateKey', 'madridTime', 'madridWeekdayIdx', 'madridHour'];
  const missing = names.filter((n) => !extractFn(profile, n));
  if (missing.length > 0) {
    fail(`profile.html: faltan helpers Madrid (${missing.join(', ')})`);
  } else {
    const code = names.map((n) => extractFn(profile, n)).join('\n');
    const ctx = createContext({});
    new Script(`${code}; this.__h = { madridDateKey, madridTime, madridWeekdayIdx, madridHour };`).runInContext(ctx);
    const h = ctx.__h;
    let ok = 0;
    for (const iso of VECTORS) {
      const ref = refParts(iso);
      const checks = [
        [h.madridTime(iso), ref.time, 'hora'],
        [h.madridDateKey(iso), ref.date, 'fecha'],
        [h.madridWeekdayIdx(iso), ref.weekdayIdx, 'día semana'],
        [h.madridHour(iso), ref.hour, 'franja'],
      ];
      for (const [got, want, label] of checks) {
        if (got !== want) fail(`profile ${iso}: ${label} = ${got}, esperado ${want} (Madrid)`);
        else ok++;
      }
    }
    if (!errors.some((e) => e.startsWith('profile 20'))) pass(`helpers profile.html: ${ok} aserciones Madrid correctas`);
  }
}

// Helpers de marketing-report.js (vía _handlers expuestos para test).
{
  const code = await read('marketing-report.js');
  const sandbox = { window: {} };
  createContext(sandbox);
  try {
    new Script(code, { filename: 'marketing-report.js' }).runInContext(sandbox);
  } catch (e) {
    fail(`marketing-report.js no carga en sandbox (${e.message})`);
  }
  const helpers = sandbox.window.GENMarketingReport && sandbox.window.GENMarketingReport._helpers;
  if (!helpers) {
    fail('marketing-report.js: no expone GENMarketingReport._helpers');
  } else {
    let ok = 0;
    for (const iso of VECTORS) {
      const ref = refParts(iso);
      const checks = [
        [helpers.fmtTime(iso), ref.time, 'hora'],
        [helpers.monthKey(iso), ref.month, 'mes'],
        [helpers.slotEs(iso), ref.hour < 13 ? 'Mañana' : ref.hour < 19 ? 'Tarde' : 'Noche', 'franja'],
      ];
      const wdGot = helpers.weekdayEs(iso);
      const wdWant = ref.weekdayEs.charAt(0).toUpperCase() + ref.weekdayEs.slice(1);
      checks.push([wdGot, wdWant, 'día semana']);
      for (const [got, want, label] of checks) {
        if (got !== want) fail(`report ${iso}: ${label} = ${got}, esperado ${want} (Madrid)`);
        else ok++;
      }
      const dGot = helpers.fmtDate(iso);
      const [yyyy, mm, dd] = ref.date.split('-');
      if (dGot !== `${dd}/${mm}/${yyyy}`) fail(`report ${iso}: fecha = ${dGot}, esperado ${dd}/${mm}/${yyyy}`);
      else ok++;
    }
    if (!errors.some((e) => e.startsWith('report 20'))) pass(`helpers marketing-report.js: ${ok} aserciones Madrid correctas`);
  }
}

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-dashboard-dates: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-dashboard-dates: horarios Madrid verificados (nada inventado).');
