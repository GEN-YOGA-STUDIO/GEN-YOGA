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
    check('Badge superior bronce para clases regulares', profileContent.includes('Clases Bronce'));
    check('Badge superior plateado para bono de clases especiales a su derecha', profileContent.includes('Bono Especial') && profileContent.includes('+ Especial (20€)'));
    check('Tarjeta plateada para Bono de Clases Especiales en perfil', profileContent.includes('Bonos de Clases Especiales · Color Plata'));
    check('Modal de creación con radio selector: Clase Especial vs Taller', profileContent.includes('evento-tipo-categoria') && profileContent.includes('evento-tipo-clase-especial') && profileContent.includes('evento-tipo-taller'));
    check('Sub-pestañas en vista de eventos (Todos, Clases Especiales, Talleres)', profileContent.includes('btn-subtab-eventos-todos') && profileContent.includes('btn-subtab-eventos-clases') && profileContent.includes('btn-subtab-eventos-talleres'));
    check('Función switchEventosSubTab implementada', profileContent.includes('function switchEventosSubTab'));
    check('Función comprarBonoEspecialStripe implementada (20 €)', profileContent.includes('function comprarBonoEspecialStripe'));
    check('Carga de bonos_clases_especiales y creditos_reprogramacion en cargarEntitlementsV69', profileContent.includes("from('bonos_clases_especiales')") && profileContent.includes("from('creditos_reprogramacion')"));
    check('Lógica de reserva diferenciada para Clase Especial (bono mensual) y Taller', profileContent.includes('isClaseEspecial') && profileContent.includes('isTaller'));
    check('Aviso de cancelación en taller informando de crédito de reprogramación (>24h)', profileContent.includes('Crédito de Reprogramación'));
    check('Guardado de evento admin respetando tipo clase_especial vs taller', profileContent.includes('evento-tipo-categoria') && profileContent.includes('tipoClaseEfectivo'));
}

console.log('\n--- 4. Verificando Traducciones (i18n.js) ---');
const i18nPath = path.join(root, 'i18n.js');
if (fs.existsSync(i18nPath)) {
    const i18nContent = fs.readFileSync(i18nPath, 'utf8');
    check('profile_tab_specials traducido a EVENTOS en ES', i18nContent.includes('"profile_tab_specials": "EVENTOS"'));
    check('profile_tab_specials traducido a EVENTS en EN', i18nContent.includes('"profile_tab_specials": "EVENTS"'));
}

if (errors.length > 0) {
    console.error(`\n❌ Fallaron ${errors.length} verificaciones:\n` + errors.map(e => ` - ${e}`).join('\n'));
    process.exit(1);
} else {
    console.log('\n🎉 ¡Todas las verificaciones de la versión 12.0 superadas con éxito!');
    process.exit(0);
}
