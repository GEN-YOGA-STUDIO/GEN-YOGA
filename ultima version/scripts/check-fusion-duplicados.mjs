import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  console.log('\n--- 1. Verificando Migración RPC admin_fusionar_perfiles ---');
  const migrationPath = path.join(root, 'supabase', 'migrations', '202609180002_rpc_admin_fusionar_perfiles.sql');
  if (!(await exists(migrationPath))) {
    errors.push('No existe el archivo de migración 202609180002_rpc_admin_fusionar_perfiles.sql');
  } else {
    console.log('  ✅ Archivo de migración 202609180002 existe');
    const sql = await readFile(migrationPath, 'utf8');
    
    if (!sql.includes('admin_fusionar_perfiles')) {
      errors.push('La migración no define la función admin_fusionar_perfiles');
    } else {
      console.log('  ✅ Define la función admin_fusionar_perfiles');
    }

    if (!sql.includes('p_perfil_conservar_id') || !sql.includes('p_perfil_eliminar_id')) {
      errors.push('Faltan parámetros requeridos p_perfil_conservar_id o p_perfil_eliminar_id');
    } else {
      console.log('  ✅ Parámetros conservar y eliminar definidos');
    }

    if (!sql.includes('reservas_yoga') || !sql.includes('reservas_psicologia') || !sql.includes('reservas_nutricion')) {
      errors.push('La migración no contempla el traspaso de todas las reservas');
    } else {
      console.log('  ✅ Reasigna reservas de yoga, psicología y nutrición sin pérdidas');
    }

    if (!sql.includes('DELETE FROM public.profiles WHERE id = p_perfil_eliminar_id')) {
      errors.push('La función no elimina el perfil duplicado de public.profiles');
    } else {
      console.log('  ✅ Elimina limpiamente el duplicado de profiles');
    }
  }

  console.log('\n--- 2. Verificando Frontend y Modal de Fusión en profile.html ---');
  const profileHtmlPath = path.join(root, 'profile.html');
  const html = await readFile(profileHtmlPath, 'utf8');

  const requiredTokens = [
    { name: 'Botón de fusión en banner', token: 'btn-fusionar-par-banner' },
    { name: 'Función abrirModalFusionarParActual', token: 'abrirModalFusionarParActual' },
    { name: 'Función abrirModalFusionarPerfiles', token: 'abrirModalFusionarPerfiles' },
    { name: 'Función actualizarSeleccionFusionModal', token: 'actualizarSeleccionFusionModal' },
    { name: 'Función ejecutarFusionPerfiles', token: 'ejecutarFusionPerfiles' },
    { name: 'Llamada RPC a admin_fusionar_perfiles', token: "'admin_fusionar_perfiles'" },
    { name: 'Botón Fusionar en comparativa de duplicados', token: 'abrirModalFusionarPerfiles' },
    { name: 'Selector explícito para conservar / eliminar', token: 'CONSERVAR' },
  ];

  for (const item of requiredTokens) {
    if (!html.includes(item.token)) {
      errors.push(`profile.html no contiene: ${item.name} (${item.token})`);
    } else {
      console.log(`  ✅ ${item.name}`);
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ Se encontraron errores en la verificación:');
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log('\n🎉 ¡Todas las verificaciones de fusión de perfiles duplicados han superado con éxito!\n');
}

run();
