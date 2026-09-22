import { execSync } from 'node:child_process';
import fs from 'node:fs';

// Uso: node scripts/ship.mjs 13.14 [--aab] [--submit-ios] [--no-push] [-m "mensaje"]
// Pipeline completo de subida de versión:
//   bump → CSS → sync web → cap sync → batería de checks → commit+push → (AAB)
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('-'));
const buildAab = args.includes('--aab');
const submitIos = args.includes('--submit-ios');
const noPush = args.includes('--no-push');
const msgIndex = args.findIndex((a) => a === '-m' || a === '--message');
const message = msgIndex >= 0 ? args[msgIndex + 1] : `release(apps): sincronizar nueva versión y recursos nativos`;

if (!version || !/^\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error('\n❌ Uso: node scripts/ship.mjs <version> [--aab] [--no-push] [-m "mensaje"]');
  console.error('   Ejemplo: node scripts/ship.mjs 13.14 --aab\n');
  process.exit(1);
}

function run(cmd, options = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
}

try {
  console.log(`\n🚀 SHIP v${version}${buildAab ? ' + AAB' : ''}${noPush ? ' (sin push)' : ''}`);

  console.log('\n━━━ 1/7 Versión y builds ━━━');
  run(`node scripts/bump-version.mjs ${version}`);

  console.log('\n━━━ 2/7 CSS ━━━');
  try {
    run('npx -y tailwindcss@3.4.19 -i ./tailwind-input.css -o ./tailwind-compiled.css --minify');
  } catch {
    console.log('⚠️ Tailwind no disponible; se conserva el CSS compilado actual.');
  }

  console.log('\n━━━ 3/7 Sync web → apps ━━━');
  run('python scripts/sync_apps.py');

  console.log('\n━━━ 4/7 Capacitor sync ━━━');
  run('npx cap sync android', { cwd: 'app android' });
  run('npx cap sync ios', { cwd: 'app ios' });

  console.log('\n━━━ 5/7 Batería de checks (bloqueante) ━━━');
  run('npm test');

  console.log('\n━━━ 6/7 Commit y push ━━━');
  run('git add -A');
  try {
    run(`git commit -m "${message.replace(/"/g, "'")}"`);
  } catch {
    console.log('ℹ️ Nada nuevo que commitear.');
  }
  if (!noPush) run('git push origin main');

  if (buildAab) {
    console.log('\n━━━ 7/7 AAB/APK Android ━━━');
    run('python scripts/build_android.py');
  }

  if (submitIos) {
    const short = version.split('.').slice(0, 2).join('.');
    const buildCode = fs
      .readFileSync('app android/android/app/build.gradle', 'utf8')
      .match(/versionCode\s+(\d+)/)[1];
    console.log(`\n━━━ 8/8 Submit iOS v${short} (build ${buildCode}) a revisión ━━━`);
    run(`gh workflow run submit-ios --ref main -f version=${short} -f build=${buildCode} -f whats-new="${message.replace(/"/g, "'")}"`);
  }

  console.log('\n🎉 SHIP completado.');
  console.log('   Play Store: sube app android/app-release.aab (necesitas cuenta + service account para automatizarlo con supply).');
  console.log('   App Store: requiere Mac con Xcode (npx cap open ios) o CI con runner macos; este Windows no puede firmarlo.');
} catch (e) {
  console.error(`\n⛔ SHIP abortado en un paso anterior. Corrige el error y repite.`);
  process.exit(1);
}
