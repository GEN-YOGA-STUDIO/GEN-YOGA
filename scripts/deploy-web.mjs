import { execSync } from 'node:child_process';

console.log('\n🌐 =========================================');
console.log('🚀 Desplegando cambios para WEB...');
console.log('=========================================');

try {
  console.log('\n1️⃣ Compilando Tailwind CSS...');
  execSync('npm run build:css', { stdio: 'inherit' });

  console.log('\n2️⃣ Ejecutando batería de tests...');
  execSync('npm test', { stdio: 'inherit' });

  const msg = process.argv[2] || 'chore(web): actualizar cambios web';
  console.log(`\n3️⃣ Haciendo commit y push a GitHub: "${msg}"...`);
  execSync('git add -A', { stdio: 'inherit' });
  
  try {
    execSync(`git commit -m "${msg}"`, { stdio: 'inherit' });
    execSync('git push origin main', { stdio: 'inherit' });
  } catch (err) {
    console.log('ℹ️ No había cambios pendientes para commitear o ya estaban al día.');
  }

  console.log('\n✅ ¡Despliegue web completado con éxito!\n');
} catch (e) {
  console.error('\n❌ Error durante el despliegue web:', e.message);
  process.exit(1);
}
