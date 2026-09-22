import { execSync, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

// Autoconexión de MCPs: deja operativos supabase, github, stripe, context7 y
// playwright en CUALQUIER máquina (Windows/macOS/Linux) sin pasos manuales,
// salvo los OAuth de navegador que exigen un clic del usuario.
// Uso: node scripts/setup-mcp.mjs [--check]   (--check solo diagnostica)

const CHECK_ONLY = process.argv.includes('--check');
const GH_VERSION = 'v1.12.2';
const PROJECT_REF = 'jkjifmrrlyncuwpjhxvk';
const HOME = os.homedir();
const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'opencode')
  : path.join(HOME, '.config', 'opencode');
const BIN_DIR = path.join(CONFIG_DIR, 'bin');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

const results = [];
const ok = (name, detail = '') => {
  results.push({ name, status: 'OK', detail });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
};
const warn = (name, detail = '') => {
  results.push({ name, status: 'PENDIENTE', detail });
  console.log(`  ⚠️ ${name}${detail ? ` — ${detail}` : ''}`);
};
const bad = (name, detail = '') => {
  results.push({ name, status: 'FALLO', detail });
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
};

function sh(cmd, options = {}) {
  try {
    return { ok: true, out: execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...options }).trim() };
  } catch (e) {
    return { ok: false, out: String((e && e.stdout) || e.message).trim() };
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'genyoga-setup-mcp' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'genyoga-setup-mcp' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (e) => {
      try {
        fs.unlinkSync(dest);
      } catch {}
      reject(e);
    });
  });
}

function endpointAlive(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 15000 }, (res) => {
      resolve(res.statusCode === 401 || res.statusCode === 400 || res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end('{}');
  });
}

console.log('\n🔌 SETUP-MCP: autoconexión de MCPs\n');

// 1. Requisitos
console.log('--- 1. Requisitos ---');
const node = sh('node --version');
node.ok ? ok('node', node.out) : bad('node', 'instala Node.js LTS');
const npx = sh(IS_WIN ? 'npx --version' : 'npx --version');
npx.ok ? ok('npx', npx.out) : bad('npx', 'reinstala Node.js con npm');
const gh = sh('gh --version');
gh.ok ? ok('gh CLI', gh.out.split('\n')[0]) : warn('gh CLI', 'instala GitHub CLI para auto-auth de GitHub');

// 2. Directorios
console.log('\n--- 2. Directorios ---');
fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(BIN_DIR, { recursive: true });
ok('config dir', CONFIG_DIR);
ok('bin dir', BIN_DIR);

// 3. Binario oficial de GitHub MCP (por plataforma)
console.log('\n--- 3. Binario GitHub MCP ---');
const arch = os.arch();
const platformMap = {
  'win32-x64': 'Windows_x86_64.zip',
  'win32-arm64': 'Windows_arm64.zip',
  'darwin-arm64': 'Darwin_arm64.tar.gz',
  'darwin-x64': 'Darwin_x86_64.tar.gz',
  'linux-x64': 'Linux_x86_64.tar.gz',
  'linux-arm64': 'Linux_arm64.tar.gz',
  'linux-arm': 'Linux_armv6.tar.gz',
};
const asset = platformMap[`${process.platform}-${arch}`];
const exeName = IS_WIN ? 'github-mcp-server.exe' : 'github-mcp-server';
const exePath = path.join(BIN_DIR, exeName);
if (!asset) {
  bad('plataforma', `${process.platform}-${arch} sin binario oficial; usa Docker o avisa`);
} else if (fs.existsSync(exePath) && fs.statSync(exePath).size > 1_000_000 && !process.argv.includes('--force')) {
  ok('github-mcp-server', `ya descargado (${GH_VERSION})`);
} else if (!CHECK_ONLY) {
  try {
    const url = `https://github.com/github/github-mcp-server/releases/download/${GH_VERSION}/github-mcp-server_${asset}`;
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ghmcp-')), `pkg${asset.endsWith('.zip') ? '.zip' : '.tgz'}`);
    console.log(`  ⬇️ descargando ${asset}...`);
    await download(url, tmp);
    if (IS_WIN) execSync(`powershell -NoProfile -Command "Expand-Archive '${tmp}' '${BIN_DIR}' -Force"`, { stdio: 'pipe' });
    else execSync(`tar -xzf "${tmp}" -C "${BIN_DIR}"`, { stdio: 'pipe' });
    if (!IS_WIN) fs.chmodSync(exePath, 0o755);
    ok('github-mcp-server', GH_VERSION);
  } catch (e) {
    bad('github-mcp-server', `descarga fallida: ${e.message}`);
  }
} else {
  warn('github-mcp-server', 'no descargado (modo --check)');
}

// 4. Auth de GitHub: reutiliza gh (cero navegador)
console.log('\n--- 4. Auth GitHub (vía gh, sin navegador) ---');
let tokenOk = false;
if (gh.ok) {
  const who = sh('gh auth status');
  if (who.ok) {
    ok('gh autenticado', (who.out.split('\n')[1] || '').trim());
    if (!CHECK_ONLY) {
      const t = sh('gh auth token');
      if (t.ok && t.out.length > 10) {
        if (IS_WIN) {
          const r = spawnSync('powershell', ['-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('GITHUB_PERSONAL_ACCESS_TOKEN', (gh auth token), 'User')`], { encoding: 'utf8' });
          tokenOk = r.status === 0;
        } else {
          const shell = process.env.SHELL || '';
          const rc = shell.includes('zsh') ? path.join(HOME, '.zshrc') : path.join(HOME, '.bashrc');
          let content = '';
          try {
            content = fs.readFileSync(rc, 'utf8');
          } catch {}
          content = content.replace(/^export GITHUB_PERSONAL_ACCESS_TOKEN=.*$/m, '').trim() + '\n';
          fs.writeFileSync(rc, `${content}export GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)"\n`);
          tokenOk = true;
        }
        tokenOk ? ok('GITHUB_PERSONAL_ACCESS_TOKEN persistido', IS_WIN ? 'setx (reinicia sesión)' : 'rc + reinicia terminal') : bad('persistir token', 'ponlo a mano');
      } else bad('leer token de gh', 'revisa gh auth status');
    } else {
      warn('token', 'se persistiría al ejecutar sin --check');
    }
  } else warn('gh sin login', 'ejecuta: gh auth login (una vez por máquina)');
} else warn('gh ausente', 'sin gh no hay auto-auth; instala GitHub CLI');

// 5. Escribir opencode.json (proyecto + global), preservando lo existente
console.log('\n--- 5. opencode.json ---');
const servers = {
  supabase: {
    type: 'remote',
    url: `https://mcp.supabase.com/mcp?project_ref=${PROJECT_REF}&features=docs%2Caccount%2Cdatabase%2Cdebugging%2Cdevelopment%2Cfunctions%2Cbranching`,
  },
  github: {
    type: 'local',
    command: [exePath, 'stdio', '--toolsets', 'repos,issues,pull_requests,actions'],
    environment: { GITHUB_PERSONAL_ACCESS_TOKEN: '{env:GITHUB_PERSONAL_ACCESS_TOKEN}' },
    timeout: { startup: 60000 },
  },
  stripe: { type: 'remote', url: 'https://mcp.stripe.com/' },
  context7: { type: 'remote', url: 'https://mcp.context7.com/mcp/' },
  playwright: {
    type: 'local',
    command: ['npx', '-y', '@playwright/mcp@latest'],
    timeout: { startup: 90000 },
  },
};
for (const file of [path.join(ROOT, 'opencode.json'), path.join(CONFIG_DIR, 'opencode.json')]) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  cfg.$schema = 'https://opencode.ai/config.json';
  cfg.mcp = cfg.mcp || {};
  cfg.mcp.servers = { ...(cfg.mcp.servers || {}), ...servers };
  if (!CHECK_ONLY) {
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    ok(path.relative(ROOT, file) || file, '5 servidores');
  } else warn(file, 'se escribiría sin --check');
}

// 6. Verificación extremo a extremo
console.log('\n--- 6. Verificación ---');
(await endpointAlive('https://mcp.supabase.com/mcp')) ? ok('supabase remoto alcanzable', 'falta 1 clic OAuth en /mcps') : bad('supabase remoto', 'revisa red/proxy');
(await endpointAlive('https://mcp.stripe.com/')) ? ok('stripe remoto alcanzable', 'falta 1 clic OAuth en /mcps') : bad('stripe remoto', 'revisa red/proxy');
(await endpointAlive('https://mcp.context7.com/mcp')) ? ok('context7 remoto alcanzable', 'sin login') : bad('context7 remoto', 'revisa red/proxy');
if (fs.existsSync(exePath)) {
  const h = sh(`"${exePath}" --help`);
  h.ok && h.out.includes('stdio') ? ok('github binario habla MCP', 'stdio OK') : bad('github binario', 're-descarga con --force');
} else bad('github binario', 'no existe');
sh('npx -y @playwright/mcp@latest --version').ok ? ok('playwright npx', 'paquete verificado') : warn('playwright npx', 'se descargará al primer uso');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const pending = results.filter((r) => r.status !== 'OK');
if (pending.length === 0) console.log('🎉 Todo conectado. Reinicia la sesión de OpenCode y verifica en /mcps.');
else {
  console.log(`⚠️ ${pending.length} punto(s) requieren tu acción (una vez por máquina):`);
  for (const p of pending) console.log(`   • ${p.name}: ${p.detail}`);
  console.log('   OAuth (supabase/stripe/github-remoto): /mcps → seleccionar → iniciar sesión.');
}
console.log('');
