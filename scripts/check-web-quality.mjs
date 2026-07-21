import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedPages = [
  'cancel.html',
  'clases.html',
  'index.html',
  'maestros.html',
  'politica-privacidad.html',
  'profile.html',
  'success.html',
  'tarifas.html',
];
const errors = [];
const invokedEdgeFunctions = new Set();

async function exists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function stripExecutableBlocks(source) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

function isPinnedPackageCdn(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }

  if (parsed.hostname === 'unpkg.com') {
    return /^\/(?:@[^/]+\/[^/@]+|[^/@]+)@[^/]+(?:\/|$)/.test(parsed.pathname);
  }
  if (parsed.hostname === 'cdn.jsdelivr.net' && parsed.pathname.startsWith('/npm/')) {
    return /^\/npm\/(?:@[^/]+\/[^/@]+|[^/@]+)@[^/]+(?:\/|$)/.test(parsed.pathname);
  }
  return true;
}

async function hasExactPathCase(relativePath) {
  const cleanSegments = relativePath.split(/[\\/]+/).filter((segment) => segment && segment !== '.');
  let current = root;
  for (const segment of cleanSegments) {
    if (segment === '..') return true;
    const entries = await readdir(current, { withFileTypes: true });
    const exact = entries.find((entry) => entry.name === segment);
    if (!exact) return false;
    current = path.join(current, exact.name);
  }
  return true;
}

function compileInlineScripts(fileName, source) {
  const inlineScript = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(inlineScript)) {
    const attributes = match[1];
    const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
    if (type && type !== 'text/javascript' && type !== 'application/javascript') continue;
    try {
      new Script(match[2], { filename: fileName });
    } catch (error) {
      errors.push(`${fileName}: JavaScript inline inválido (${error.message})`);
    }
  }
}

function checkInlineHandlers(fileName, source) {
  const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join('\n');
  const defined = new Set();
  for (const match of scripts.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(match[1]);
  for (const match of scripts.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) defined.add(match[1]);
  for (const match of scripts.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(match[1]);

  const ignored = new Set([
    'if', 'for', 'while', 'switch', 'return', 'typeof',
    'alert', 'confirm', 'prompt', 't',
  ]);
  const markup = stripExecutableBlocks(source);
  for (const attribute of markup.matchAll(/\bon(?:click|change|submit|input|keydown)=["']([^"']*)["']/gi)) {
    for (const call of attribute[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const functionName = call[1];
      if (!ignored.has(functionName) && !defined.has(functionName)) {
        errors.push(`${fileName}: el handler ${attribute[0]} llama a ${functionName}(), que no está definida`);
      }
    }
  }
}

async function checkLocalReference(fileName, rawReference) {
  const reference = rawReference.trim();
  if (!reference || /^(?:#|data:|mailto:|tel:|javascript:)/i.test(reference)) return;
  if (/^(?:https?:)?\/\//i.test(reference)) {
    if (/^https?:/i.test(reference) && !isPinnedPackageCdn(reference)) {
      errors.push(`${fileName}: dependencia CDN sin versión exacta (${reference})`);
    }
    return;
  }
  if (/[${}]/.test(reference)) return;

  const withoutSuffix = reference.split(/[?#]/, 1)[0];
  if (!withoutSuffix) return;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    errors.push(`${fileName}: referencia con codificación inválida (${reference})`);
    return;
  }
  if (path.isAbsolute(decoded)) {
    errors.push(`${fileName}: ruta local absoluta no portable (${reference})`);
    return;
  }

  const absolute = path.resolve(root, path.dirname(fileName), decoded);
  const relativeToRoot = path.relative(root, absolute);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    errors.push(`${fileName}: referencia fuera del sitio (${reference})`);
    return;
  }
  if (!await exists(absolute)) {
    errors.push(`${fileName}: recurso local inexistente (${reference})`);
  } else if (!await hasExactPathCase(relativeToRoot)) {
    errors.push(`${fileName}: mayúsculas/minúsculas incorrectas en (${reference})`);
  }
}

const actualPages = (await readdir(root))
  .filter((name) => name.toLowerCase().endsWith('.html'))
  .sort((a, b) => a.localeCompare(b));
if (actualPages.join('|') !== expectedPages.join('|')) {
  errors.push(`Páginas inesperadas. Esperadas: ${expectedPages.join(', ')}; encontradas: ${actualPages.join(', ')}`);
}

for (const fileName of actualPages) {
  const source = await readFile(path.join(root, fileName), 'utf8');
  const markup = stripExecutableBlocks(source);

  for (const invocation of source.matchAll(/\.functions\.invoke\(\s*['"]([^'"]+)['"]/g)) {
    invokedEdgeFunctions.add(invocation[1]);
  }

  for (const [label, pattern] of [
    ['doctype', /<!doctype\s+html\b/gi],
    ['html', /<html\b/gi],
    ['head', /<head\b/gi],
    ['body', /<body\b/gi],
  ]) {
    if (count(markup, pattern) !== 1) errors.push(`${fileName}: debe contener exactamente un ${label}`);
  }

  compileInlineScripts(fileName, source);
  checkInlineHandlers(fileName, source);

  const ids = new Map();
  for (const match of markup.matchAll(/\bid=["']([^"']+)["']/gi)) {
    ids.set(match[1], (ids.get(match[1]) || 0) + 1);
  }
  for (const [id, occurrences] of ids) {
    if (occurrences > 1) errors.push(`${fileName}: id duplicado "${id}" (${occurrences} veces)`);
  }

  const loadedResources = new Map();
  for (const tag of markup.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    const reference = tag[1];
    const key = reference.replace(/[?#].*$/, '');
    loadedResources.set(key, (loadedResources.get(key) || 0) + 1);
  }
  for (const [resource, occurrences] of loadedResources) {
    if (occurrences > 1) errors.push(`${fileName}: recurso cargado ${occurrences} veces (${resource})`);
  }

  for (const tag of markup.matchAll(/<(?:script|img|link|a|source|video|audio)\b[^>]*\b(?:src|href)=["']([^"']*)["'][^>]*>/gi)) {
    const reference = tag[1];
    if (!reference && /^<(?:img|script|source|video|audio)\b/i.test(tag[0])) {
      errors.push(`${fileName}: src vacío`);
      continue;
    }
    await checkLocalReference(fileName, reference);
  }

  for (const anchor of markup.matchAll(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi)) {
    const rel = anchor[0].match(/\brel=["']([^"']*)["']/i)?.[1] || '';
    if (!/\bnoopener\b/i.test(rel) || !/\bnoreferrer\b/i.test(rel)) {
      errors.push(`${fileName}: target="_blank" sin rel="noopener noreferrer"`);
    }
  }

  if (/\bstyle=["'][^"']*\bselect-none\b/i.test(markup)) {
    errors.push(`${fileName}: usa la clase select-none como si fuera una declaración style`);
  }
  if (!/<meta\s+name=["']application-version["']\s+content=["']6\.5["']\s*\/?>/i.test(markup)) {
    errors.push(`${fileName}: falta la identidad de compilación 6.5`);
  }
  if (/@latest\b/i.test(source)) errors.push(`${fileName}: contiene una dependencia @latest`);
  if (/\bv6\.[0-4]\b/i.test(source)) errors.push(`${fileName}: contiene una versión visual anterior a 6.5`);
}

for (const functionName of invokedEdgeFunctions) {
  if (!/^[a-z0-9-]+$/.test(functionName)) {
    errors.push(`Nombre de Edge Function no válido en el frontend (${functionName})`);
    continue;
  }
  const entrypoint = path.join(root, 'supabase', 'functions', functionName, 'index.ts');
  if (!await exists(entrypoint)) {
    errors.push(`El frontend invoca ${functionName}, pero falta ${path.relative(root, entrypoint)}`);
  }
}

const profile = await readFile(path.join(root, 'profile.html'), 'utf8');
for (const rpc of ['reservar_consulta_atomica', 'cancelar_consulta_atomica']) {
  if (!profile.includes(`client.rpc('${rpc}'`)) errors.push(`profile.html: falta el flujo atómico ${rpc}`);
}
if (/\.from\(['"]reservas_(?:psicologia|nutricion)['"]\)\.insert/.test(profile)) {
  errors.push('profile.html: vuelve a insertar reservas de consulta fuera de la RPC atómica');
}

if (errors.length) {
  console.error('Web quality check failed:');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Web quality checks passed for ${actualPages.length} pages.`);
