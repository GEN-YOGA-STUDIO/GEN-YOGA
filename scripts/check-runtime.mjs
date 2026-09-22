import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
  console.error(`  ❌ ${message}`);
}

function pass(message) {
  console.log(`  ✅ ${message}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    let rel = urlPath.replace(/^\/+/, '') || 'index.html';
    const abs = path.join(root, rel);
    const relative = path.relative(root, abs);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.writeHead(403);
      res.end();
      return;
    }
    await stat(abs);
    const body = await readFile(abs);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// Selectores de "funcionamiento clave" por página: si faltan, la página está rota.
const pages = [
  { file: 'index.html', selector: '#logo-img', extra: '.btn-nav-mobile' },
  { file: 'clases.html', selector: '#btn-inicio', extra: '#sticky-header' },
  { file: 'tarifas.html', selector: 'a#btn-inicio', extra: null },
  { file: 'maestros.html', selector: '#maestros-grid-section', extra: null },
  { file: 'profile.html', selector: '#login-email', extra: null },
  { file: 'politica-privacidad.html', selector: '#privacy-main-title', extra: null },
  { file: 'success.html', selector: '#countdown', extra: null },
  { file: 'cancel.html', selector: '#countdown-dynamic', extra: null },
];

const browser = await chromium.launch();
try {
  for (const { file, selector, extra } of pages) {
    const pageErrors = [];
    const localFailed = [];
    const externalFailed = [];
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err).slice(0, 200)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console: ${msg.text().slice(0, 200)}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 400) {
        const url = res.url();
        (url.startsWith(base) ? localFailed : externalFailed).push(`${res.status()} ${url.slice(0, 120)}`);
      }
    });
    await page.goto(`${base}/${file}`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2500);
    const title = await page.title();
    const hasSelector = (await page.$(selector)) !== null;
    const hasExtra = extra ? (await page.$(extra)) !== null : true;
    await context.close();

    if (!hasSelector || !hasExtra) fail(`${file}: falta contenido clave (${[selector, extra].filter(Boolean).join(', ')})`);
    else if (!title) fail(`${file}: <title> vacío`);
    else if (pageErrors.length > 0) fail(`${file}: ${pageErrors.length} error(es) JS: ${pageErrors[0]}`);
    else if (localFailed.length > 0) fail(`${file}: recursos locales rotos: ${localFailed[0]}`);
    else pass(`${file}: sin errores JS, contenido clave visible`);
    for (const ext of [...new Set(externalFailed)].slice(0, 2)) {
      warnings.push(`${file}: externo falló (aviso): ${ext}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}

for (const w of warnings) console.log(`  ⚠️ ${w}`);
console.log('');
if (errors.length > 0) {
  console.error(`⛔ check-runtime: ${errors.length} fallo(s) bloqueante(s).`);
  process.exit(1);
}
console.log('✅ check-runtime: las 8 páginas cargan sin errores JS en móvil.');
