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
  if (!await exists(guardPath)) {
    errors.push(`${label}: falta cursor-always-visible.css`);
    return;
  }

  const guard = await readFile(guardPath, 'utf8');
  for (const required of [
    'html:root body *',
    'cursor: default !important',
    'cursor: pointer !important',
    'cursor: text !important',
    'cursor: not-allowed !important',
  ]) {
    if (!guard.includes(required)) errors.push(`${label}: el guard no contiene ${required}`);
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const htmlFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.html'));
  for (const entry of htmlFiles) {
    const html = await readFile(path.join(directory, entry.name), 'utf8');
    const guardLinks = html.match(/<link\b[^>]*\bdata-cursor-guard\b[^>]*>/gi) || [];
    if (guardLinks.length !== 1 || !guardLinks[0].includes('cursor-always-visible.css?v=6.1')) {
      errors.push(`${label}/${entry.name}: debe cargar exactamente una vez el guard de cursor v6.1`);
    }
    const headEnd = html.toLowerCase().indexOf('</head>');
    const guardIndex = html.indexOf(guardLinks[0] || '');
    if (headEnd < 0 || guardIndex < 0 || guardIndex > headEnd) {
      errors.push(`${label}/${entry.name}: el guard debe estar dentro del head`);
    }
  }

  for (const absolute of await collectWebFiles(directory)) {
    const webSource = await readFile(absolute, 'utf8');
    const relative = path.relative(directory, absolute);
    if (/cursor\s*:\s*none\s*(?:!important\s*)?;/i.test(webSource)) {
      errors.push(`${label}/${relative}: contiene cursor:none`);
    }
    if (/cursor\s*:\s*url\s*\(/i.test(webSource)) {
      errors.push(`${label}/${relative}: contiene un cursor URL frágil`);
    }
    if (/classList\.add\(\s*['"]wink-cursor['"]/i.test(webSource)) {
      errors.push(`${label}/${relative}: vuelve a crear el cursor personalizado`);
    }
    if (/requestPointerLock\s*\(/i.test(webSource)) {
      errors.push(`${label}/${relative}: intenta capturar u ocultar el puntero`);
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

console.log('Cursor visibility checks passed.');
