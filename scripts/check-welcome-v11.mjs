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
        console.error(`  ❌ ERROR: ${desc}`);
        errors.push(desc);
    }
}

console.log('\n--- 1. Verificando Oferta Única en tarifas.html ---');
const tarifasHtml = fs.readFileSync(path.join(root, 'tarifas.html'), 'utf8');
check('Contiene #section-ofertas', tarifasHtml.includes('id="section-ofertas"'));
check('Título Bono de Bienvenida en sección ofertas', tarifasHtml.includes('Bono de Bienvenida'));
check('Precio 0 € destacado', tarifasHtml.includes('0 €'));
check('Audiencia para nuevos alumnos', tarifasHtml.includes('Para Nuevos Alumnos') || tarifasHtml.includes('Nuevos Alumnos'));
check('Menciona sesión gratuita de yoga para cualquier clase regular', tarifasHtml.includes('clase regular') || tarifasHtml.includes('clases normales de yoga'));
check('Menciona que se excluyen talleres y clases especiales', tarifasHtml.includes('se excluyen talleres') || tarifasHtml.includes('excluyen talleres'));
check('Menciona sesión introductoria gratuita de Psicología o PNI', tarifasHtml.includes('Psicología o PNI') || tarifasHtml.includes('PNI'));
check('Inactivada ficha de sesiones introductorias en tarifas', !tarifasHtml.includes('rates_intro_badge'));
check('Inactivada ficha de yoga en compañía en tarifas', !tarifasHtml.includes('rates_companion_eyebrow'));

console.log('\n--- 2. Verificando Calendario Público (public-calendar.js) ---');
const calJs = fs.readFileSync(path.join(root, 'public-calendar.js'), 'utf8');
check('No muestra badge diferenciado de clase gratuita (uniformidad visual)', !calJs.includes("gy-calendar__event-badge--free"));
check('Filtro de oferta bienvenida incluye clases regulares', calJs.includes("item.classType === 'taller' || item.isSpecial"));

console.log('\n--- 3. Verificando Área Privada y Reservas (profile.html) ---');
const profileHtml = fs.readFileSync(path.join(root, 'profile.html'), 'utf8');
check('Bono de bienvenida permite reservar cualquier clase regular', profileHtml.includes('const esSesionGratuita = !esEspecial;'));
check('Yoga en compañía inactivado en flags de reserva', profileHtml.includes('const modalityCompania = \'\';') && profileHtml.includes('const esCompania = false;'));
check('Modalidad selector oculto en creación de clase', profileHtml.includes('Modalidad y Acceso a la Clase (Inactivado'));
check('Yoga en Compañía oculto en modal admin de saldo de usuario', profileHtml.includes('Yoga en Compañía (Inactivado'));
check('Yoga en Compañía inactivado en saldo inicial mostrador', profileHtml.includes('saldo_yoga_compania: 0'));

console.log('\n--- 4. Verificando Migración SQL v11.0 ---');
const sqlPath = path.join(root, 'supabase', 'migrations', '202609030001_inactivar_yoga_compania_y_universalizar_bienvenida_v11.sql');
check('Archivo de migración v11.0 existe', fs.existsSync(sqlPath));
if (fs.existsSync(sqlPath)) {
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    check('Reseteo de saldos existentes a 0', sqlContent.includes('saldo_clases_gratis = 0') && sqlContent.includes('saldo_yoga_compania = 0'));
    check('Universalización de reserva_con_bono para regular', sqlContent.includes("v_class_type = 'yoga'") && sqlContent.includes('v_free_credits > 0'));
    check('Trigger actualizado para nuevos usuarios', sqlContent.includes('crear_perfil_nuevo_usuario') && sqlContent.includes('saldo_clases_gratis'));
}

console.log('\n--- 5. Verificando Mejoras v11.1 (Flash Modal, Ticker y Aforos Ocultos) ---');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
check('Flash Modal presente en index.html', indexHtml.includes('id="flash-welcome-modal"'));
check('Flash Modal anuncia primera clase gratis (0 €)', indexHtml.includes('¡Tu 1ª Clase de Yoga es Gratis!') && indexHtml.includes('0 €'));
check('Flash Modal enlaza a registro con bono', indexHtml.includes('profile.html?action=register') && indexHtml.includes('promo=bienvenida'));
check('Función para cerrar Flash Modal', indexHtml.includes('cerrarFlashWelcomeModal'));

check('Marquesina superior index.html habla del Bono de Bienvenida a 0 €', indexHtml.includes('NUEVO BONO DE BIENVENIDA · 1ª CLASE DE YOGA A 0 €'));
const i18nJs = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
check('i18n.js incluye Bono de Bienvenida a 0 € en marquesina', i18nJs.includes('NUEVO BONO DE BIENVENIDA · 1ª CLASE DE YOGA A 0 €'));

check('Perfil de alumno no muestra aforo numérico en clases regulares', profileHtml.includes('infoCapacidadOEstado') && profileHtml.includes('Reserva Disponible') && profileHtml.includes('Reserva Cerrada'));
check('Perfil de alumno no muestra aforo numérico en talleres', profileHtml.includes('aforoOEstadoTaller'));
check('Tarjeta de registro en perfil muestra incentivo del Bono de Bienvenida', profileHtml.includes('Bono de Bienvenida Automático') && profileHtml.includes('¡Tu 1ª clase de Yoga es 100% GRATIS (0 €)!'));

check('Flash Modal con fondo sólido y opaco en index.html', indexHtml.includes('background-color: #FAF7F2') || indexHtml.includes('#FAF7F2'));
check('Flash Modal solo salta una vez por sesión (sessionStorage)', indexHtml.includes('sessionStorage') && indexHtml.includes('WELCOME_MODAL_SHOWN_KEY'));
check('Flash Modal no salta si el usuario navega desde otra sección interna', indexHtml.includes('document.referrer') && indexHtml.includes('refUrl.origin === window.location.origin'));

if (errors.length > 0) {
    console.error(`\n❌ Fallaron ${errors.length} comprobaciones de v11.0 - v11.3:`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
} else {
    console.log('\n🎉 ¡Todas las verificaciones de la versión 11.0 - 11.3 han superado con éxito!\n');
    process.exit(0);
}
