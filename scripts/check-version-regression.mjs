import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
  console.error(`  ❌ ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`  ⚠️ ${message}`);
}

function pass(message) {
  console.log(`  ✅ ${message}`);
}

// Reglas que se pueden degradar a aviso con REGRESSION_ALLOW=id1,id2
// (p. ej. REGRESSION_ALLOW=appid-changed npm test cuando el cambio es intencionado).
const allowed = new Set(
  (process.env.REGRESSION_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean),
);
function gate(ruleId, message, hint = '') {
  const full = hint ? `${message} — ${hint}` : message;
  if (allowed.has(ruleId)) warn(`[${ruleId}] ${full} (permitido por REGRESSION_ALLOW)`);
  else {
    errors.push(`[${ruleId}] ${full}`);
    console.error(`  ❌ [${ruleId}] ${full}`);
  }
}

// ---------------------------------------------------------------------------
// Resolución de la línea base ("versión anterior").
//
// - Árbol sucio (caso presubida: hay cambios sin commitear): BASE = worktree,
//   REF = HEAD (lo último subido = la versión anterior).
// - Árbol limpio (caso CI tras el push): BASE = HEAD, REF = HEAD~1.
// - Sin git o sin HEAD: fallback a 'ultima version/' como versión anterior
//   desplegada (solo tiene sentido antes del sync; tras el sync es espejo y el
//   diff sale vacío, sin falsos positivos).
// ---------------------------------------------------------------------------
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

let mode = 'git-dirty';
let refRev = 'HEAD';
let baseRev = null; // null = worktree
try {
  git(['rev-parse', '--is-inside-work-tree']);
  git(['rev-parse', '--verify', 'HEAD']);
  const porcelain = git(['status', '--porcelain']);
  if (!porcelain) {
    try {
      git(['rev-parse', '--verify', 'HEAD~1']);
      mode = 'git-clean';
      refRev = 'HEAD~1';
      baseRev = 'HEAD';
    } catch {
      console.log('  ℹ️ Solo existe un commit: no hay versión anterior con la que comparar.');
      console.log('\n✅ check-version-regression: sin línea base, nada que regresar.');
      process.exit(0);
    }
  }
} catch {
  mode = 'ultima-version';
}

function gitShow(rev, rel) {
  try {
    return execFileSync('git', ['show', `${rev}:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

async function fsRead(rel) {
  try {
    return await readFile(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

async function baseContent(rel) {
  if (mode === 'ultima-version') return fsRead(rel);
  if (baseRev === null) return fsRead(rel);
  return gitShow(baseRev, rel);
}

async function refContent(rel) {
  if (mode === 'ultima-version') return fsRead(path.join('ultima version', rel));
  return gitShow(refRev, rel);
}

const refLabel = mode === 'ultima-version' ? "'ultima version/'" : refRev;
const baseLabel = mode === 'git-clean' ? baseRev : 'worktree';
console.log(`\nComparando ${baseLabel} (nueva) contra ${refLabel} (anterior) [modo: ${mode}]`);

// Ficheros borrados entre REF y BASE (solo modo git; en fallback se calcula por listado).
function deletedFiles() {
  if (mode === 'ultima-version') return [];
  try {
    const range = baseRev === null ? ['HEAD'] : [`${refRev}`, `${baseRev}`];
    const out = git(['diff', '--name-status', ...range]);
    return out.split('\n').filter((l) => l.startsWith('D\t')).map((l) => l.slice(2));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Extractores de "contrato" a partir del contenido de un fichero.
// ---------------------------------------------------------------------------
const stripExec = (s) =>
  s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

function domIds(html) {
  const ids = new Set();
  for (const m of stripExec(html).matchAll(/\bid=["']([^"']+)["']/gi)) ids.add(m[1]);
  return ids;
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
}

function jsReferencedIds(js) {
  const ids = new Set();
  for (const m of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)) ids.add(m[1]);
  for (const m of js.matchAll(/querySelector(All)?\(\s*['"]#([A-Za-z_][\w$-]*)/g)) ids.add(m[2]);
  return ids;
}

function htmlHandlerCalls(html) {
  const calls = new Set();
  for (const a of stripExec(html).matchAll(/\bon(?:click|change|submit|input|keydown)=["']([^"']*)["']/gi)) {
    for (const c of a[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(c[1]);
  }
  return calls;
}

function jsDefinedFunctions(js) {
  const defs = new Set();
  for (const m of js.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defs.add(m[1]);
  for (const m of js.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) defs.add(m[1]);
  for (const m of js.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) defs.add(m[1]);
  return defs;
}

function i18nKeysUsed(source) {
  // static: data-i18n="..." (siempre literal exacto en el HTML).
  // dynamic: t('...') (puede ser prefijo compuesto: t('month_' + n)).
  const usedStatic = new Set();
  const usedDynamic = new Set();
  for (const m of source.matchAll(/data-i18n="([^"]+)"/g)) usedStatic.add(m[1]);
  for (const m of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
    if (/^[A-Za-z][\w.-]*$/.test(m[1])) usedDynamic.add(m[1]);
  }
  return { usedStatic, usedDynamic };
}

// Bloque {...} balanceado desde el índice de su '{'.
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

function i18nDict(source) {
  const out = {};
  const start = source.indexOf('const translations');
  if (start < 0) return out;
  const block = balancedBlock(source, source.indexOf('{', start));
  if (!block) return out;
  for (const m of block.matchAll(/(^|[,{]\s*)([A-Za-z_][\w-]*)\s*:\s*\{/g)) {
    const lang = m[2];
    if (out[lang]) continue;
    const langBlock = balancedBlock(block, m.index + m[0].lastIndexOf('{'));
    if (!langBlock) continue;
    out[lang] = new Set([...langBlock.matchAll(/"([^"]+)"\s*:/g)].map((k) => k[1]));
  }
  return out;
}

function edgeInvocations(source) {
  const fns = new Set();
  for (const m of source.matchAll(/\.functions\.invoke\(\s*['"]([^'"]+)['"]/g)) fns.add(m[1]);
  return fns;
}

function localRefs(html) {
  // Referencias locales (sin query/hash) que deben seguir existiendo.
  const refs = new Set();
  for (const t of html.matchAll(/<(?:script|img|link|a|source|video|audio)\b[^>]*\b(?:src|href)=["']([^"']*)["'][^>]*/gi)) {
    const raw = t[1].trim();
    if (!raw || /^(?:#|data:|mailto:|tel:|javascript:)/i.test(raw)) continue;
    if (/^(?:https?:)?\/\//i.test(raw) || /[${}]/.test(raw)) continue;
    const clean = raw.split(/[?#]/, 1)[0];
    if (!clean || path.isAbsolute(clean)) continue;
    refs.add(decodeURIComponent(clean));
  }
  return refs;
}

// Selectores de "funcionamiento clave" (los mismos que check-runtime verifica en vivo).
const runtimeSelectors = [
  ['index.html', '#logo-img'], ['index.html', '.btn-nav-mobile'],
  ['clases.html', '#btn-inicio'], ['clases.html', '#sticky-header'],
  ['tarifas.html', 'a#btn-inicio'],
  ['maestros.html', '#maestros-grid-section'],
  ['profile.html', '#login-email'],
  ['politica-privacidad.html', '#privacy-main-title'],
  ['success.html', '#countdown'],
  ['cancel.html', '#countdown-dynamic'],
];

const pages = [
  'index.html', 'clases.html', 'tarifas.html', 'maestros.html',
  'profile.html', 'politica-privacidad.html', 'success.html', 'cancel.html',
];
const browserJs = [
  'capacitor-bridge.js', 'i18n.js', 'public-calendar.js',
  'teacher-profiles.js', 'facilities-carousel.js', 'marketing-report.js',
];
const JS_IGNORED_CALLS = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'alert', 'confirm', 'prompt', 't']);

const exists = async (abs) => {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// 1. Páginas: ninguna puede desaparecer.
// ---------------------------------------------------------------------------
console.log('\n--- 1. Páginas de la versión anterior ---');
for (const page of pages) {
  const ref = await refContent(page);
  const base = await baseContent(page);
  if (ref !== null && base === null) {
    gate('page-removed', `${page}: existía en la versión anterior y ha desaparecido`);
  } else if (base !== null) {
    pass(`${page}: presente`);
  }
}

// ---------------------------------------------------------------------------
// 2. IDs DOM: lo que el JS pide debe seguir existiendo en el HTML.
// ---------------------------------------------------------------------------
console.log('\n--- 2. IDs DOM usados por el JS ---');
const refIds = new Map();
const baseIds = new Map();
for (const page of pages) {
  const ref = await refContent(page);
  const base = await baseContent(page);
  if (ref !== null) refIds.set(page, domIds(ref));
  if (base !== null) baseIds.set(page, domIds(base));
}
let jsAll = '';
for (const f of browserJs) {
  const c = await baseContent(f);
  if (c !== null) jsAll += `\n${c}`;
}
for (const page of pages) {
  const c = await baseContent(page);
  if (c !== null) jsAll += `\n${inlineScripts(c)}`;
}
const neededIds = jsReferencedIds(jsAll);
// Anclas href="#id" también exigen que el id exista.
for (const page of pages) {
  const c = await baseContent(page);
  if (c === null) continue;
  for (const m of stripExec(c).matchAll(/\bhref="#([^"'\s>]+)"/gi)) neededIds.add(m[1]);
}
const allBaseIds = new Set([...baseIds.values()].flatMap((s) => [...s]));
// Diferencial estricto: solo falla lo que la versión anterior definía en HTML,
// la nueva sigue necesitando y ya no existe. Los ids que nunca estuvieron en
// el HTML estático (modales `swal-*` y demás nodos creados por el JS en
// runtime) no son regresiones: en vivo los verifica check-runtime.
let idErrors = 0;
let dynamicIds = 0;
for (const id of [...neededIds].sort()) {
  if (allBaseIds.has(id)) continue;
  if ([...refIds.values()].some((s) => s.has(id))) {
    gate('dom-id-removed', `id "${id}": existía en la versión anterior, el JS lo sigue pidiendo y ya no está en el HTML`);
    idErrors++;
  } else {
    dynamicIds++;
  }
}
if (idErrors === 0) pass(`sin ids rotos (${dynamicIds} ids dinámicos de runtime, verificados en vivo por check-runtime)`);

// ---------------------------------------------------------------------------
// 3. Handlers inline: toda llamada onclick="f()" debe resolver a una función.
// ---------------------------------------------------------------------------
console.log('\n--- 3. Handlers inline resueltos ---');
const defined = jsDefinedFunctions(jsAll);
let handlerErrors = 0;
for (const page of pages) {
  const c = await baseContent(page);
  if (c === null) continue;
  for (const fn of htmlHandlerCalls(c)) {
    if (!JS_IGNORED_CALLS.has(fn) && !defined.has(fn)) {
      gate('handler-removed', `${page}: llama a ${fn}(), que ya no está definida`, 'la página quedaría muerta');
      handlerErrors++;
    }
  }
}
if (handlerErrors === 0) pass('todos los handlers inline resuelven a funciones existentes');

// ---------------------------------------------------------------------------
// 4. i18n: ni idiomas ni claves en uso pueden desaparecer.
// ---------------------------------------------------------------------------
console.log('\n--- 4. Claves i18n en uso ---');
{
  const refI18n = await refContent('i18n.js');
  const baseI18n = await baseContent('i18n.js');
  const refDict = refI18n !== null ? i18nDict(refI18n) : {};
  const baseDict = baseI18n !== null ? i18nDict(baseI18n) : {};
  for (const lang of Object.keys(refDict)) {
    if (!baseDict[lang]) {
      gate('lang-removed', `i18n.js: el idioma '${lang}' existía y ha desaparecido`);
    }
  }
  let usedStatic = new Set();
  let usedDynamic = new Set();
  for (const page of pages) {
    const c = await baseContent(page);
    if (c === null) continue;
    const u = i18nKeysUsed(c);
    usedStatic = new Set([...usedStatic, ...u.usedStatic]);
    usedDynamic = new Set([...usedDynamic, ...u.usedDynamic]);
  }
  {
    const u = i18nKeysUsed(jsAll);
    usedStatic = new Set([...usedStatic, ...u.usedStatic]);
    usedDynamic = new Set([...usedDynamic, ...u.usedDynamic]);
  }
  // Diferencial estricto: la clave se usaba, existía antes y ya no existe.
  // - data-i18n exige coincidencia exacta (siempre es un literal estático).
  // - t() admite prefijo de claves existentes (composición dinámica 'month_'+n).
  // Las claves usadas que nunca existieron son competencia de
  // check-i18n-coverage, no regresiones.
  let missing = 0;
  const checkKey = (lang, key, allowPrefix) => {
    const baseKeys = baseDict[lang];
    if (baseKeys.has(key)) return;
    if (allowPrefix && [...baseKeys].some((k) => k.startsWith(key))) return; // prefijo dinámico
    if (refDict[lang] && refDict[lang].has(key)) {
      gate('i18n-key-removed', `i18n '${lang}': la clave "${key}" se usa, existía en la versión anterior y ha desaparecido`);
      missing++;
    }
  };
  for (const lang of Object.keys(baseDict)) {
    for (const key of [...usedStatic].sort()) checkKey(lang, key, false);
    for (const key of [...usedDynamic].sort()) checkKey(lang, key, true);
  }
  if (missing === 0) pass(`ninguna clave en uso ha desaparecido de ${Object.keys(baseDict).join('/')}`);
}

// ---------------------------------------------------------------------------
// 5. Edge Functions invocadas por el frontend anterior deben seguir existiendo.
// ---------------------------------------------------------------------------
console.log('\n--- 5. Edge Functions invocadas ---');
{
  let refInvoked = new Set();
  for (const page of pages) {
    const c = await refContent(page);
    if (c !== null) refInvoked = new Set([...refInvoked, ...edgeInvocations(c)]);
  }
  const refJs = await refContent('capacitor-bridge.js');
  if (refJs !== null) refInvoked = new Set([...refInvoked, ...edgeInvocations(refJs)]);
  let gone = 0;
  for (const fn of [...refInvoked].sort()) {
    let dirExists;
    if (baseRev === null && mode !== 'ultima-version') {
      dirExists = await exists(path.join(root, 'supabase', 'functions', fn, 'index.ts'));
    } else if (mode === 'ultima-version') {
      dirExists = await exists(path.join(root, 'supabase', 'functions', fn, 'index.ts'));
    } else {
      dirExists = gitShow(baseRev, `supabase/functions/${fn}/index.ts`) !== null;
    }
    if (!dirExists) {
      gate('edgefn-removed', `Edge Function '${fn}': la versión anterior la invocaba y ya no existe`);
      gone++;
    }
  }
  if (gone === 0) pass(refInvoked.size > 0 ? `las ${refInvoked.size} Edge Functions invocadas siguen existiendo` : 'la versión anterior no invocaba Edge Functions');
}

// ---------------------------------------------------------------------------
// 6. Assets referenciados por la versión anterior deben seguir existiendo.
// ---------------------------------------------------------------------------
console.log('\n--- 6. Assets referenciados ---');
{
  const refRefs = new Set();
  for (const page of pages) {
    const c = await refContent(page);
    if (c !== null) {
      for (const r of localRefs(c)) {
        if (/^(img|fonts)\//.test(r)) refRefs.add(r);
      }
    }
  }
  let gone = 0;
  for (const r of [...refRefs].sort()) {
    let ok;
    if (baseRev === null || mode === 'ultima-version') ok = await exists(path.join(root, r));
    else ok = gitShow(baseRev, r) !== null;
    if (!ok) {
      gate('asset-removed', `asset '${r}': referenciado por la versión anterior y eliminado`);
      gone++;
    }
  }
  if (gone === 0) pass(refRefs.size > 0 ? `los ${refRefs.size} assets referenciados siguen existiendo` : 'sin assets referenciados en la versión anterior');
}

// ---------------------------------------------------------------------------
// 7. Ficheros borrados que siguen referenciados + migraciones (append-only).
// ---------------------------------------------------------------------------
console.log('\n--- 7. Ficheros borrados y migraciones ---');
{
  const deleted = deletedFiles();
  const migDeleted = deleted.filter((f) => f.startsWith('supabase/migrations/'));
  for (const f of migDeleted) {
    gate('migration-deleted', `migración '${f}' eliminada`, 'las migraciones son append-only: lo ya aplicado no se puede borrar');
  }
  const rest = deleted.filter((f) => !f.startsWith('supabase/migrations/'));
  // Corpus actual para buscar referencias (worktree o HEAD).
  let corpus = '';
  const corpusFiles = [...pages, ...browserJs, 'public-calendar.css', 'tailwind-compiled.css'];
  for (const f of corpusFiles) {
    const c = await baseContent(f);
    if (c !== null) corpus += `\n${c}`;
  }
  let flagged = 0;
  for (const f of rest) {
    const name = f.split('/').pop();
    if (!name || name.length < 3) continue;
    // Ignorar artefactos que nunca se referencian por nombre en el código web.
    if (/\.(md|bat|sh|ps1|cmd|log|p8|keystore|jks|aab|apk|zip|rar)$/i.test(name)) continue;
    if (corpus.includes(name)) {
      gate('file-deleted-referenced', `'${f}' eliminado pero '${name}' sigue referenciado en el código actual`);
      flagged++;
    }
  }
  if (migDeleted.length === 0 && flagged === 0) {
    pass(deleted.length === 0 ? 'ningún fichero borrado respecto a la versión anterior' : `${deleted.length} fichero(s) borrados, ninguno referenciado`);
  }
}

// ---------------------------------------------------------------------------
// 8. Selectores críticos de runtime presentes en la nueva versión.
// ---------------------------------------------------------------------------
console.log('\n--- 8. Selectores críticos de runtime ---');
{
  let gone = 0;
  for (const [page, selector] of runtimeSelectors) {
    const c = await baseContent(page);
    if (c === null) continue;
    const markup = stripExec(c);
    let found;
    if (selector.startsWith('#')) {
      found = new RegExp(`\\bid=["']${selector.slice(1)}["']`).test(markup);
    } else if (selector.startsWith('.')) {
      found = new RegExp(`\\bclass=["'][^"']*\\b${selector.slice(1)}\\b`).test(markup);
    } else {
      const m = selector.match(/^([a-z]+)#(.+)$/i);
      found = m ? new RegExp(`<${m[1]}\\b[^>]*\\bid=["']${m[2]}["']`, 'i').test(markup) : markup.includes(selector);
    }
    if (!found) {
      gate('runtime-selector-removed', `${page}: falta el contenido clave '${selector}'`, 'check-runtime fallaría en la nueva versión');
      gone++;
    }
  }
  if (gone === 0) pass('los 10 selectores críticos siguen presentes');
}

// ---------------------------------------------------------------------------
// 9. Identidad de app: appIds y schemes no pueden cambiar sin querer.
// ---------------------------------------------------------------------------
console.log('\n--- 9. Identidad de app por plataforma ---');
{
  const pairs = [
    ['app android/capacitor.config.json', 'appId'],
    ['app ios/capacitor.config.json', 'appId'],
  ];
  for (const [file, key] of pairs) {
    const ref = await refContent(file);
    const base = await baseContent(file);
    if (ref === null || base === null) continue;
    let refVal, baseVal;
    try { refVal = JSON.parse(ref)[key]; } catch { continue; }
    try { baseVal = JSON.parse(base)[key]; } catch {
      gate('appid-changed', `${file}: ya no es un JSON válido`);
      continue;
    }
    if (refVal !== baseVal) {
      gate('appid-changed', `${file}: ${key} cambió de '${refVal}' a '${baseVal}'`, 'cambiarlo rompe updates, deep links y Universal Links de la app instalada');
    } else {
      pass(`${file}: ${key} = ${baseVal} (sin cambios)`);
    }
  }
}

console.log('');
for (const w of warnings) console.log(`  ⚠️ ${w}`);
if (errors.length > 0) {
  console.error(`\n⛔ check-version-regression: ${errors.length} regresión(es) bloqueante(s) vs ${refLabel}.`);
  console.error('   Si un cambio es intencionado, re-ejecuta con REGRESSION_ALLOW=<regla> (ver cabecera del script).');
  process.exit(1);
}
console.log(`✅ check-version-regression: la nueva versión no rompe nada de ${refLabel}.`);
