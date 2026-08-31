import { execSync } from 'node:child_process';

console.log('\n📱 =========================================');
console.log('🚀 Actualizando versión y recursos de APPS (iOS / Android)...');
console.log('=========================================');

try {
  console.log('\n1️⃣ Incrementando versión y build number...');
  execSync('node scripts/bump-version.mjs', { stdio: 'inherit' });

  console.log('\n2️⃣ Compilando Tailwind CSS...');
  execSync('npm run build:css', { stdio: 'inherit' });

  console.log('\n3️⃣ Sincronizando recursos en Android e iOS...');
  execSync('python scripts/sync_apps.py', { stdio: 'inherit' });

  console.log('\n4️⃣ Ejecutando tests de validación...');
  execSync('npm test', { stdio: 'inherit' });

  const msg = process.argv[2] || 'release(apps): sincronizar nueva versión y recursos nativos';
  console.log(`\n5️⃣ Commiteando release completo: "${msg}"...`);
  execSync('git add -A', { stdio: 'inherit' });
  
  try {
    execSync(`git commit -m "${msg}"`, { stdio: 'inherit' });
    execSync('git push origin main', { stdio: 'inherit' });
  } catch (err) {
    console.log('ℹ️ No había cambios pendientes para commitear o ya estaban al día.');
  }

  console.log('\n🎉 ¡Release de Apps e integración multiplataforma completado con éxito!\n');
} catch (e) {
  console.error('\n❌ Error durante la actualización de apps:', e.message);
  process.exit(1);
}
