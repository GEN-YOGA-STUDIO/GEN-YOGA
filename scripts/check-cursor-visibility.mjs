import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deploymentRoot = path.resolve(sourceRoot, '..', 'subir cert');
const errors = [];

async function exists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function collectWebFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'supabase', 'scripts'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectWebFiles(absolute));
    } else if (/\.(?:html|css|js)$/i.test(entry.name)) {
      results.push(absolute);
    }
  }
  return results;
}

async function checkTarget(label, directory) {
  if (!await exists(directory)) return;

  const guardPath = path.join(directory, 'cursor-always-visible.css');
  if (await exists(guardPath)) {
    errors.push(`${label}: cursor-always-visible.css debe estar eliminado; el navegador debe gestionar el cursor nativo`);
  }

  for (const absolute of await collectWebFiles(directory)) {
    const webSource = await readFile(absolute, 'utf8');
    const relative = path.relative(directory, absolute);
    if (/cursor\s*:\s*none\b/i.test(webSource)) {
      errors.push(`${label}/${relative}: contiene cursor:none`);
    }
    if (/cursor\s*:\s*url\s*\(/i.test(webSource)) {
      errors.push(`${label}/${relative}: contiene un cursor URL frágil`);
    }
    if (/\b(?:wink-cursor|cursor-glow|custom-cursor)\b/i.test(webSource)) {
      errors.push(`${label}/${relative}: contiene infraestructura de cursor personalizado`);
    }
    if (/\b(?:data-cursor-guard|cursor-always-visible\.css)\b/i.test(webSource)) {
      errors.push(`${label}/${relative}: vuelve a cargar el antiguo guard de cursor`);
    }
    if (/\.style\.cursor\s*=\s*['"]none['"]/i.test(webSource)
      || /\.style\.setProperty\(\s*['"]cursor['"]\s*,\s*['"]none['"]/i.test(webSource)) {
      errors.push(`${label}/${relative}: oculta el cursor desde JavaScript`);
    }
    if (/requestPointerLock\s*\(/i.test(webSource)) {
      errors.push(`${label}/${relative}: intenta capturar u ocultar el puntero`);
    }

    for (const rule of webSource.matchAll(/([^{}]+)\{([^{}]*)\}/gs)) {
      if (!/\bcursor\s*:/i.test(rule[2])) continue;
      const globalSelector = rule[1]
        .split(',')
        .map((selector) => selector.trim().replace(/\s+/g, ' '))
        .find((selector) => /^(?:\*|html(?::root)?|body|body \*|html(?::root)? body(?: \*)?)$/i.test(selector));
      if (globalSelector) {
        errors.push(`${label}/${relative}: fuerza el cursor globalmente sobre ${globalSelector}`);
        break;
      }
    }
  }
}

await checkTarget('ultima version', sourceRoot);
await checkTarget('subir cert', deploymentRoot);

if (errors.length) {
  console.error('Cursor visibility check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Native cursor checks passed.');
