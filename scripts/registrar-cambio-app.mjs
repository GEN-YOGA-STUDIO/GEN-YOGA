#!/usr/bin/env node
/**
 * scripts/registrar-cambio-app.mjs
 * Registro y bump independiente para las aplicaciones móviles (Android e iOS).
 *
 * Uso:
 *   node scripts/registrar-cambio-app.mjs <mayor|menor|parche> "<descripción>"
 *   npm run cambio:app -- menor "Añadido selector de fecha táctil"
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const hoy = () => {
  const d = new Date();
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
};

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('\n📱 Uso: node scripts/registrar-cambio-app.mjs <mayor|menor|parche> "<descripción>"');
  console.log('   Ejemplo: node scripts/registrar-cambio-app.mjs menor "Mejora en modal de reservas"');
  process.exit(1);
}

const tipoRaw = args[0].toLowerCase();
const descripcion = args.slice(1).join(' ').trim();

let appCfg = JSON.parse(fs.readFileSync(path.join(root, 'app-version.json'), 'utf8'));
const currentParts = appCfg.version.split('.').map(Number);
let [maj, min, pat] = currentParts;
const currentBuild = appCfg.build || 280;
const nextBuild = currentBuild + 1;

let nextVersion = '';
let tipoLabel = '';

if (tipoRaw === 'mayor' || tipoRaw === 'major') {
  nextVersion = `${maj + 1}.0.0`;
  tipoLabel = 'Rediseño Mayor';
} else if (tipoRaw === 'menor' || tipoRaw === 'minor') {
  nextVersion = `${maj}.${min + 1}.0`;
  tipoLabel = 'Nueva funcionalidad';
} else {
  nextVersion = `${maj}.${min}.${pat + 1}`;
  tipoLabel = 'Parche / Hotfix';
}

console.log(`\n📱 Bumping app version to v${nextVersion} (Build ${nextBuild})...`);
execSync(`node scripts/bump-app-version.mjs ${nextVersion} ${nextBuild}`, { stdio: 'inherit' });

// Inserción en CAMBIOS-APPS.md
const changelogPath = path.join(root, 'CAMBIOS-APPS.md');
let changelog = fs.readFileSync(changelogPath, 'utf8');

const nuevaEntrada = `## v${nextVersion} (Build ${nextBuild}) — ${hoy()} · ${tipoLabel}

- **Ámbito:** Apps móviles independientes (Android e iOS).
- **Descripción:** ${descripcion}
- **Build:** #${nextBuild} (versionCode / CURRENT_PROJECT_VERSION)
- **Tiendas:** Preparado para subida a Google Play y Apple TestFlight.
`;

const marcador = '<!-- entradas-nuevas: las inserciones nuevas van justo debajo de esta línea -->';
if (changelog.includes(marcador)) {
  changelog = changelog.replace(marcador, `${marcador}\n\n${nuevaEntrada}`);
} else {
  changelog += `\n\n${nuevaEntrada}`;
}

fs.writeFileSync(changelogPath, changelog, 'utf8');
console.log(`✅ Registrado en CAMBIOS-APPS.md`);

console.log('\n🔍 Verificando calidad y gemelidad...');
execSync('npm run check:apps', { stdio: 'inherit' });
execSync('npm run check:twins', { stdio: 'inherit' });

console.log(`\n🎉 Cambio de app registrado: v${nextVersion} (Build ${nextBuild}).\n`);
