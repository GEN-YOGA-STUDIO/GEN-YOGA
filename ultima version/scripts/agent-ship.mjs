#!/usr/bin/env node
/**
 * scripts/agent-ship.mjs
 * Script centralizado de validación, sincronización y despliegue agéntico.
 * 
 * Uso:
 *   node scripts/agent-ship.mjs [version] [mensaje de commit]
 *   npm run ship -- "feat: mi cambio"
 *   npm run ship -- 13.3 "feat: nueva funcionalidad v13.3"
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('\n======================================================');
console.log('🚀 GEN YOGA — SISTEMA INTEGRAL DE ENTREGA Y CALIDAD');
console.log('======================================================\n');

// 1. Parsear argumentos
const args = process.argv.slice(2);
let targetVersion = null;
let commitMessage = null;

if (args.length === 1) {
  if (/^\d+\.\d+(\.\d+)?$/.test(args[0])) {
    targetVersion = args[0];
    commitMessage = `chore: actualización a versión ${targetVersion}`;
  } else {
    commitMessage = args[0];
  }
} else if (args.length >= 2) {
  if (/^\d+\.\d+(\.\d+)?$/.test(args[0])) {
    targetVersion = args[0];
    commitMessage = args[1];
  } else {
    commitMessage = args.join(' ');
  }
}

if (!commitMessage) {
  commitMessage = 'chore: actualización automática de calidad y despliegue';
}

function run(cmd, desc) {
  console.log(`\n▶️  [${desc}]`);
  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
    console.log(`✅  ${desc} completado.`);
    return true;
  } catch (err) {
    console.error(`❌  Fallo en: ${desc}`);
    throw err;
  }
}

try {
  // Paso 1: Actualización de versión si fue solicitada
  if (targetVersion) {
    run(`node scripts/bump-version.mjs ${targetVersion}`, `Sincronizando versión ${targetVersion}`);
  }

  // Paso 2: Recompilar Tailwind CSS
  run('npm run build:css', 'Compilando Tailwind CSS minificado');

  // Paso 3: Sincronizar assets con apps nativas y raíz
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  run(`${pythonCmd} scripts/sync_apps.py`, 'Sincronizando assets con Android, iOS y raíz');

  // Paso 4: Batería completa de pruebas de calidad
  run('npm test', 'Ejecutando suite de 9 pruebas de calidad');

  // Paso 5: Preparar cambios para control de versiones
  console.log(`\n📦 Preparando commit: "${commitMessage}"...`);
  try {
    execSync('git add -A', { cwd: rootDir, stdio: 'inherit' });
    
    // Comprobar si hay cambios staged
    const staged = execSync('git diff --cached --name-only', { cwd: rootDir, encoding: 'utf8' }).trim();
    if (!staged) {
      console.log('ℹ️  No hay archivos modificados pendientes de commit.');
    } else {
      execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: rootDir, stdio: 'inherit' });
      console.log('✅  Commit local creado con éxito.');

      // Intentar git push local
      console.log('📤 Intentando push a origin main...');
      try {
        execSync('git push origin main', { cwd: rootDir, stdio: 'inherit' });
        console.log('🎉 ¡Push a GitHub completado con éxito!');
      } catch (pushErr) {
        console.log('⚠️  Aviso: El push directo por Git local requiere autenticación de red.');
        console.log('   Si estás operando dentro del entorno agéntico de Antigravity,');
        console.log('   el agente puede utilizar directamente el servidor MCP de GitHub (push_files).');
      }
    }
  } catch (gitErr) {
    console.log(`ℹ️  Aviso en fase Git: ${gitErr.message}`);
  }

  console.log('\n======================================================');
  console.log('✨ PROCESO DE VALIDACIÓN Y DESPLIEGUE FINALIZADO CON ÉXITO');
  console.log('======================================================\n');
} catch (error) {
  console.error('\n🛑 PROCESO DETENIDO POR ERROR DE CALIDAD O EJECUCIÓN.');
  process.exit(1);
}
