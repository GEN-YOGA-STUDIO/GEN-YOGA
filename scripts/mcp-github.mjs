import { spawn, spawnSync, execSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

// Lanzador del GitHub MCP Server (stdio) para OpenCode.
//
// Por qué existe: la config de OpenCode vivía en un opencode.json compartido
// entre máquinas (OneDrive) con la ruta absoluta del binario de Windows
// (C:\Users\...\github-mcp-server.exe). Si el binario no estaba descargado,
// OpenCode fallaba con "NotFound: ChildProcess.spawn" y en el Mac ni siquiera
// existía esa ruta. Este lanzador:
//   1. resuelve el binario oficial según la máquina donde corra,
//   2. lo descarga solo si falta o está corrupto (autoreparación),
//   3. resuelve el token de GitHub (env → gh → GH_TOKEN/GITHUB_TOKEN),
//   4. y arranca el servidor pasando su stdio tal cual a OpenCode.
// Todo lo que no sea tráfico MCP se escribe por stderr (nunca por stdout).
//
// Uso en opencode.json: ["node", "scripts/mcp-github.mjs"]  (+ "cwd": ".")
// Argumentos extra se pasan al binario; sin argumentos usa DEFAULT_ARGS.

export const GH_VERSION = 'v1.12.2';
export const DEFAULT_ARGS = ['stdio', '--toolsets', 'repos,issues,pull_requests,actions'];

const PLATFORM_ASSETS = {
  'win32-x64': 'Windows_x86_64.zip',
  'win32-arm64': 'Windows_arm64.zip',
  'darwin-arm64': 'Darwin_arm64.tar.gz',
  'darwin-x64': 'Darwin_x86_64.tar.gz',
  'linux-x64': 'Linux_x86_64.tar.gz',
  'linux-arm64': 'Linux_arm64.tar.gz',
  'linux-arm': 'Linux_armv6.tar.gz',
};

// Rutas de esta máquina: config dir → bin dir → binario oficial.
export function githubMcpPaths() {
  const configDir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'opencode')
    : path.join(os.homedir(), '.config', 'opencode');
  const binDir = path.join(configDir, 'bin');
  const exeName = process.platform === 'win32' ? 'github-mcp-server.exe' : 'github-mcp-server';
  const asset = PLATFORM_ASSETS[`${process.platform}-${os.arch()}`];
  return {
    configDir,
    binDir,
    launcherPath: path.join(binDir, 'github-mcp.mjs'),
    exeName,
    exePath: path.join(binDir, exeName),
    asset,
  };
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
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} en ${url}`));
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

// Descarga y extrae el binario oficial si no está (o está a medias).
// Devuelve la ruta del binario; lanza error con mensaje claro si falla.
export async function ensureGithubMcpBinary({ force = false, quiet = false } = {}) {
  const { asset, exePath, binDir } = githubMcpPaths();
  if (!asset) throw new Error(`sin binario oficial para ${process.platform}-${os.arch()}`);
  if (!force && fs.existsSync(exePath) && fs.statSync(exePath).size > 1_000_000) return exePath;

  fs.mkdirSync(binDir, { recursive: true });
  const url = `https://github.com/github/github-mcp-server/releases/download/${GH_VERSION}/github-mcp-server_${asset}`;
  const isZip = asset.endsWith('.zip');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghmcp-'));
  const pkg = path.join(tmpDir, isZip ? 'pkg.zip' : 'pkg.tgz');
  if (!quiet) console.error(`[github-mcp] descargando ${asset} (${GH_VERSION})...`);
  try {
    await download(url, pkg);
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${pkg}' -DestinationPath '${binDir}' -Force"`, { stdio: 'pipe' });
    } else {
      execSync(`tar -xzf "${pkg}" -C "${binDir}"`, { stdio: 'pipe' });
      fs.chmodSync(exePath, 0o755);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(exePath) || fs.statSync(exePath).size < 1_000_000) {
    throw new Error(`la extracción no produjo ${exePath}`);
  }
  if (!quiet) console.error(`[github-mcp] binario listo en ${exePath}`);
  return exePath;
}

// Copia este lanzador a <config>/bin/github-mcp.mjs para que la config GLOBAL
// de OpenCode (que usa ruta absoluta de esta máquina) también funcione.
function syncSelfCopy() {
  try {
    const { binDir, launcherPath } = githubMcpPaths();
    const self = path.resolve(fileURLToPath(import.meta.url));
    if (self === path.resolve(launcherPath)) return;
    fs.mkdirSync(binDir, { recursive: true });
    fs.copyFileSync(self, launcherPath);
  } catch {
    /* la autocopia es best-effort: no debe tumbar el arranque */
  }
}

// Token: si el de la config/env no está, lo intenta con gh y con GH_TOKEN.
function resolveToken() {
  const current = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
  const looksValid = (t) => typeof t === 'string' && t.trim().length > 10 && !t.startsWith('{env:');
  if (looksValid(current)) return current;
  try {
    const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    if (r.status === 0 && looksValid(r.stdout)) return r.stdout.trim();
  } catch {}
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    if (looksValid(process.env[key])) return process.env[key].trim();
  }
  return '';
}

async function main() {
  syncSelfCopy();

  let exePath;
  try {
    exePath = await ensureGithubMcpBinary();
  } catch (e) {
    console.error(`[github-mcp] no se pudo preparar el binario: ${e.message}`);
    console.error(`[github-mcp] hazlo a mano: node scripts/setup-mcp.mjs   (o baja la release ${GH_VERSION} de https://github.com/github/github-mcp-server/releases)`);
    process.exit(1);
  }

  const env = { ...process.env };
  const token = resolveToken();
  if (token) env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
  else console.error('[github-mcp] aviso: sin GITHUB_PERSONAL_ACCESS_TOKEN (ejecuta `gh auth login` o exporta el token); el servidor arrancará pero las llamadas a GitHub darán 401.');

  const passthrough = process.argv.slice(2);
  const args = passthrough.length ? passthrough : DEFAULT_ARGS;

  const child = spawn(exePath, args, { env, stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      try {
        child.kill(sig);
      } catch {}
    });
  }
  child.on('error', (e) => {
    console.error(`[github-mcp] no se pudo lanzar ${exePath}: ${e.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(signal ? 0 : code ?? 1));
}

const self = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === self) main();
