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
  console.log('\n--- 1. Verificando Migración SQL 202609180003 ---');
  const migrationPath = path.join(root, 'supabase', 'migrations', '202609180003_fix_admin_consulta_assignment.sql');
  if (!(await exists(migrationPath))) {
    errors.push('No existe el archivo de migración 202609180003_fix_admin_consulta_assignment.sql');
  } else {
    console.log('  ✅ Archivo de migración 202609180003 existe');
    const sql = await readFile(migrationPath, 'utf8');

    if (!sql.includes('CREATE OR REPLACE FUNCTION public.reservar_consulta_atomica') ||
        !sql.includes('p_producto_contratado') ||
        !sql.includes('p_stripe_lookup_key') ||
        !sql.includes('p_origen_pago') ||
        !sql.includes('p_notas')) {
      errors.push('reservar_consulta_atomica no incluye los parámetros extendidos requeridos');
    } else {
      console.log('  ✅ reservar_consulta_atomica admite metadatos completos y origen de pago local');
    }

    if (!sql.includes('CREATE OR REPLACE FUNCTION public.admin_crear_o_obtener_usuario_temporal') ||
        !sql.includes('bonos,') ||
        sql.includes('saldo_clases,')) {
      errors.push('admin_crear_o_obtener_usuario_temporal no usa la columna correcta bonos');
    } else {
      console.log('  ✅ admin_crear_o_obtener_usuario_temporal corregido para usar bonos');
    }

    if (!sql.includes('ALTER TABLE public.clases') || !sql.includes('metodo_pago') || !sql.includes('stripe_lookup_key')) {
      errors.push('No se añadieron metodo_pago ni stripe_lookup_key a la tabla clases');
    } else {
      console.log('  ✅ Columnas metodo_pago y stripe_lookup_key aseguradas en clases');
    }
  }

  console.log('\n--- 2. Verificando Frontend y Flujo de Asignación en profile.html ---');
  const profileHtmlPath = path.join(root, 'profile.html');
  const html = await readFile(profileHtmlPath, 'utf8');

  const requiredChecks = [
    { name: 'Opción por defecto Pago presencial en mostrador', token: 'value="mostrador_presencial"' },
    { name: 'Selector de producto no bloqueante en modal', token: "const selectedKey = selectElem?.value || 'mostrador_presencial';" },
    { name: 'Auto-resolución de cliente en studentPicker', token: 'normalizarBusquedaAlumnosAdmin(r.selectionText) === query' },
    { name: 'Spinner de carga durante asignación', token: 'title: \'Asignando consulta...\'' },
    { name: 'Confirmación amigable tras asignación', token: 'title: multiInfo.esMultiple ? \'Sesión múltiple asignada\' : \'¡Consulta asignada!\'' },
    { name: 'Refresco tras asignación admin', token: 'await cargarConsultasAdmin();' }
  ];

  for (const check of requiredChecks) {
    if (!html.includes(check.token)) {
      errors.push(`Falta en profile.html: ${check.name} (token: ${check.token})`);
    } else {
      console.log(`  ✅ ${check.name}`);
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ Se encontraron errores:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('\n🎉 ¡Todas las verificaciones de asignación de consultas han superado con éxito!\n');
  }
}

run();
