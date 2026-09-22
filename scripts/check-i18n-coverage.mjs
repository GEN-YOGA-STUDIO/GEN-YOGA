import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function fail(message) {
  errors.push(message);
  console.error(`  ❌ ${message}`);
}

function pass(message) {
  console.log(`  ✅ ${message}`);
}

// Extrae el bloque {...} balanceado que empieza en el índice del '{' dado.
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

const i18n = await readFile(path.join(root, 'i18n.js'), 'utf8');
const translationsStart = i18n.indexOf('const translations');
if (translationsStart < 0) {
  fail('i18n.js: no se encontró const translations');
} else {
  const open = i18n.indexOf('{', translationsStart);
  const block = balancedBlock(i18n, open);
  if (!block) {
    fail('i18n.js: bloque translations no balanceado');
  } else {
    // Bloques de idioma de primer nivel: es: {...}, en: {...}
    const languages = {};
    for (const m of block.matchAll(/(^|[,{]\s*)([A-Za-z_][\w-]*)\s*:\s*\{/g)) {
      const lang = m[2];
      const langOpen = m.index + m[0].lastIndexOf('{');
      const langBlock = balancedBlock(block, langOpen);
      if (!langBlock) {
        fail(`i18n.js: bloque '${lang}' no balanceado`);
        continue;
      }
      const keys = new Set([...langBlock.matchAll(/"([^"]+)"\s*:/g)].map((k) => k[1]));
      languages[lang] = keys;
      pass(`i18n.js: idioma '${lang}' con ${keys.size} claves`);
    }

    if (!languages.es) fail("i18n.js: falta el idioma 'es'");
    else {
      const pages = (await readdir(root)).filter((n) => n.toLowerCase().endsWith('.html'));
      const used = new Map(); // key -> [pages]
      for (const page of pages) {
        const source = await readFile(path.join(root, page), 'utf8');
        for (const m of source.matchAll(/data-i18n="([^"]+)"/g)) {
          if (!used.has(m[1])) used.set(m[1], []);
          used.get(m[1]).push(page);
        }
      }
      console.log(`  ℹ️ ${used.size} claves data-i18n usadas en ${pages.length} páginas`);
      for (const lang of Object.keys(languages)) {
        const missing = [...used.keys()].filter((k) => !languages[lang].has(k));
        if (missing.length === 0) pass(`todas las claves existen en '${lang}'`);
        else {
          const sample = missing.slice(0, 8).map((k) => `${k} (${used.get(k).join(',')})`).join('; ');
          fail(`'${lang}': ${missing.length} clave(s) sin traducir: ${sample}${missing.length > 8 ? '…' : ''}`);
        }
      }
      // Claves huérfanas: definidas en es pero no usadas en ninguna página ni en JS via t('...').
      const jsSources = await Promise.all(
        ['i18n.js', 'public-calendar.js', 'teacher-profiles.js', 'facilities-carousel.js', 'capacitor-bridge.js'].map((f) =>
          readFile(path.join(root, f), 'utf8').catch(() => ''),
        ),
      );
      const htmlSources = await Promise.all(pages.map((p) => readFile(path.join(root, p), 'utf8')));
      const allCode = jsSources.join('\n') + '\n' + htmlSources.join('\n');
      const orphans = [...languages.es].filter((k) => !allCode.includes(k));
      if (orphans.length === 0) pass('sin claves huérfanas en es');
      else console.log(`  ⚠️ ${orphans.length} clave(s) en es sin uso aparente (revisar): ${orphans.slice(0, 10).join(', ')}${orphans.length > 10 ? '…' : ''}`);
    }
  }
}

console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-i18n-coverage: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-i18n-coverage: cobertura de traducciones verificada.');
