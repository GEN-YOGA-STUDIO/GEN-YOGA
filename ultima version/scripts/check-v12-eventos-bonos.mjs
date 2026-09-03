import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let errors = [];

function check(desc, condition) {
    if (condition) {
        console.log(`  ✅ ${desc}`);
    } else {
        console.error(`  ❌ ${desc}`);
        errors.push(desc);
    }
}

console.log('\n--- 1. Verificando Migración SQL v12.0 ---');
const migrationPath = path.join(root, 'supabase', 'migrations', '202609030007_v12_eventos_bonos_especiales_reprogramacion.sql');
check('Archivo de migración v12.0 existe', fs.existsSync(migrationPath));

if (fs.existsSync(migrationPath)) {
    const migrationContent = fs.readFileSync(migrationPath, 'utf8');
    check('Asignación de clase Yanira 75m como clase_especial', migrationContent.includes("id = 6083") && migrationContent.includes("tipo_clase = 'clase_especial'"));
    check('Asignación de taller Yanira 120m como taller', migrationContent.includes("id = 5821") && migrationContent.includes("tipo_clase = 'taller'"));
    check('Asignación de taller Miriam 120m como taller', migrationContent.includes("id = 7847") && migrationContent.includes("tipo_clase = 'taller'"));
    check('Creación de tabla bonos_clases_especiales', migrationContent.includes('CREATE TABLE IF NOT EXISTS public.bonos_clases_especiales'));
    check('Creación de tabla creditos_reprogramacion', migrationContent.includes('CREATE TABLE IF NOT EXISTS public.creditos_reprogramacion'));
    check('Asignación retroactiva automática para usuarios con bono ilimitado septiembre 2026', migrationContent.includes("2026-09-01") && migrationContent.includes("bonos_clases_especiales"));
    check('Función reservar_con_bono adaptada a clase_especial y taller', migrationContent.includes("v_class_type = 'clase_especial'") && migrationContent.includes('creditos_reprogramacion'));
    check('Función cancelar_con_bono devolviendo bono especial o crédito reprogramación taller (>24h)', migrationContent.includes('cancelar_con_bono') && migrationContent.includes('creditos_reprogramacion'));
    check('Función cancelar_consulta_atomica emitiendo crédito reprogramación (>24h)', migrationContent.includes('cancelar_consulta_atomica') && migrationContent.includes('creditos_reprogramacion'));
    check('Fulfillment de Stripe acreditando clase_especial (20 €) y +1 con bono_ilimitado', migrationContent.includes('clase_especial') && migrationContent.includes('bonos_clases_especiales'));
}

console.log('\n--- 2. Verificando Stripe Backend ---');
const stripeCatalogPath = path.join(root, 'supabase', 'functions', '_shared', 'stripe-production.ts');
const createCheckoutPath = path.join(root, 'supabase', 'functions', 'create-checkout-session', 'index.ts');

if (fs.existsSync(stripeCatalogPath)) {
    const stripeCatalog = fs.readFileSync(stripeCatalogPath, 'utf8');
    check('CLASE_ESPECIAL configurada a 20 € (2000 céntimos)', stripeCatalog.includes('CLASE_ESPECIAL') && stripeCatalog.includes('amount: 2000'));
    check('CLASE_ESPECIAL no permite checkout anónimo (requiere cuenta)', stripeCatalog.includes('CLASE_ESPECIAL') && stripeCatalog.includes('guestAllowed: false'));
}

if (fs.existsSync(createCheckoutPath)) {
    const checkoutCode = fs.readFileSync(createCheckoutPath, 'utf8');
    check('create-checkout-session valida membership_month para CLASE_ESPECIAL', checkoutCode.includes('CLASE_ESPECIAL') && checkoutCode.includes('membershipMonth'));
}

console.log('\n--- 3. Verificando Frontend (profile.html) ---');
const profilePath = path.join(root, 'profile.html');
if (fs.existsSync(profilePath)) {
    const profileContent = fs.readFileSync(profilePath, 'utf8');
    check('Navbar botón público actualizado a EVENTOS', profileContent.includes('id="nav-public-especiales"') && profileContent.includes('EVENTOS'));
    check('Badge superior para clases regulares', profileContent.includes('>Clases<') || profileContent.includes('>Clases</span>'));
    check('Badge superior plateado para clase especial a su derecha', profileContent.includes('Clase especial') && profileContent.includes('+ Especial'));
    check('Tarjeta plateada para Clase Especial en perfil', profileContent.includes('Clase especial · Color Plata'));
    check('Modal de creación con radio selector: Clase Especial vs Taller', profileContent.includes('evento-tipo-categoria') && profileContent.includes('evento-tipo-clase-especial') && profileContent.includes('evento-tipo-taller'));
    check('Sub-pestañas en vista de eventos (Todos, Clases Especiales, Talleres)', profileContent.includes('btn-subtab-eventos-todos') && profileContent.includes('btn-subtab-eventos-clases') && profileContent.includes('btn-subtab-eventos-talleres'));
    check('Función switchEventosSubTab implementada', profileContent.includes('function switchEventosSubTab'));
    check('Función comprarBonoEspecialStripe implementada', profileContent.includes('function comprarBonoEspecialStripe'));
    check('Carga de bonos_clases_especiales y creditos_reprogramacion en cargarEntitlementsV69', profileContent.includes("from('bonos_clases_especiales')") && profileContent.includes("from('creditos_reprogramacion')"));
    check('Lógica de reserva diferenciada para Clase Especial (bono mensual) y Taller', profileContent.includes('isClaseEspecial') && profileContent.includes('isTaller'));
    check('Aviso de cancelación en taller informando de crédito de reprogramación (>24h)', profileContent.includes('Crédito de Reprogramación'));
    check('Guardado de evento admin respetando tipo clase_especial vs taller', profileContent.includes('evento-tipo-categoria') && profileContent.includes('tipoClaseEfectivo'));
    check('Gestión de bonos permite asignar y modificar Clases Especiales a usuarios', profileContent.includes('cambiarClaseEspecialAdmin') && profileContent.includes('asignarNuevaClaseEspecialAdmin'));
    check('Banner voluminoso de Administración de Consultas eliminado', !profileContent.includes('elimina turnos de psicología y nutrición. Revisa las reservas y estados de consulta.'));
    check('Catálogo de clases soporta clase_especial y taller con badges específicos', profileContent.includes('CLASE ESPECIAL (PLATA)') && profileContent.includes('ajustarDuracionPorCategoriaTipo'));
    check('Creación de eventos vinculada estrictamente a tipos configurados', profileContent.includes('actualizarTiposEventoModal') && profileContent.includes('Solo se pueden crear eventos cuyo tipo'));
}

console.log('\n--- 4. Verificando Migración v12.3 ---');
const mig123Path = path.join(root, 'supabase', 'migrations', '202609030008_v12_3_nombres_oficiales_y_catalogo_clases.sql');
check('Archivo de migración v12.3 existe', fs.existsSync(mig123Path));
if (fs.existsSync(mig123Path)) {
    const m123 = fs.readFileSync(mig123Path, 'utf8');
    check('Taller 5821 renombrado a Introducción a Power Vinyasa', m123.includes('Introducción a Power Vinyasa') && m123.includes('5821'));
    check('tipos_clases incluye categorías clase_especial y taller sincronizadas', m123.includes("categoria = 'clase_especial'") && m123.includes("categoria = 'taller'"));
}

console.log('\n--- 5. Verificando Traducciones (i18n.js) ---');
const i18nPath = path.join(root, 'i18n.js');
if (fs.existsSync(i18nPath)) {
    const i18nContent = fs.readFileSync(i18nPath, 'utf8');
    check('profile_tab_specials traducido a EVENTOS en ES', i18nContent.includes('"profile_tab_specials": "EVENTOS"'));
    check('profile_tab_specials traducido a EVENTS en EN', i18nContent.includes('"profile_tab_specials": "EVENTS"'));
}

console.log('\n--- 6. Verificando Novedades v12.4 (Calendario Unificado, Guía de Bonos y Botón Especial) ---');
if (fs.existsSync(profilePath)) {
    const pContent = fs.readFileSync(profilePath, 'utf8');
    check('Guía de Bonos define freeClassTitle y detalla clase especial y talleres', pContent.includes('freeClassTitle') && pContent.includes('Bono de Clase Especial (Plata') && pContent.includes('Talleres Temáticos'));
    check('Botón + Clase Especial tiene estilo visible explícito', pContent.includes('id="btn-comprar-bono-especial"') && pContent.includes('linear-gradient(135deg, #334155 0%, #0f172a 100%)'));
    check('cargarHorarios consulta y admite clases especiales y talleres', pContent.includes('tipo_clase.eq.clase_especial') && pContent.includes('tipo_clase.eq.taller'));
    check('renderizarClases añade badge y acciones para clases especiales y talleres', pContent.includes('especialidadBadge') && pContent.includes('RESERVAR (1 ESPECIAL)') && pContent.includes('RESERVAR (20 € / ILIMITADO)'));
    check('iniciarCheckoutTallerStripe implementado en perfil', pContent.includes('async function iniciarCheckoutTallerStripe'));
}

const pubCalPath = path.join(root, 'public-calendar.js');
if (fs.existsSync(pubCalPath)) {
    const pcContent = fs.readFileSync(pubCalPath, 'utf8');
    check('Calendario público incluye clases especiales y talleres en modo clases', pcContent.includes("tipo_clase.eq.clase_especial") && pcContent.includes("targetMode === 'clases'"));
    check('public-calendar maneja color y estado de clase_especial', pcContent.includes("item.classType === 'clase_especial'") && pcContent.includes("Clase Especial"));
}

const stripePath = path.join(root, 'supabase', 'functions', '_shared', 'stripe-production.ts');
if (fs.existsSync(stripePath)) {
    const sContent = fs.readFileSync(stripePath, 'utf8');
    check('Talleres de 35 euros mapeados a prod_V5uCPKKKH5K74P', sContent.includes("TALLER_INTRO_POWER_VINYASA: 'prod_V5uCPKKKH5K74P'") && sContent.includes("TALLER_35"));
}

if (errors.length > 0) {
    console.error(`\n❌ Fallaron ${errors.length} verificaciones:\n` + errors.map(e => ` - ${e}`).join('\n'));
    process.exit(1);
} else {
    console.log('\n🎉 ¡Todas las verificaciones de la versión 12.0 - 12.4 superadas con éxito!');
    process.exit(0);
}

