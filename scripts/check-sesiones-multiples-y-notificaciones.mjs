import fs from 'fs';
import path from 'path';

console.log('=== VERIFICACION DE SESIONES MULTIPLES Y NOTIFICACIONES EMAIL ===\n');

let failedTests = 0;
function assert(condition, message) {
    if (condition) {
        console.log(`  [PASS] ${message}`);
    } else {
        console.error(`  [FAIL] ${message}`);
        failedTests++;
    }
}

// 1. Verificar profile.html
console.log('1. Analizando profile.html...');
const profilePath = path.resolve('profile.html');
const profileHtml = fs.readFileSync(profilePath, 'utf8');

assert(profileHtml.includes('id="consulta-multiple-enabled"'), 'Checkbox consulta-multiple-enabled presente');
assert(profileHtml.includes('id="consulta-multiple-options"'), 'Contenedor consulta-multiple-options presente');
assert(profileHtml.includes('id="consulta-fecha-2"'), 'Input fecha 2 presente');
assert(profileHtml.includes('id="consulta-hora-inicio-2"'), 'Input hora inicio 2 presente');
assert(profileHtml.includes('datePickerConsulta2Instance'), 'Instancia Flatpickr fecha 2 declarada');
assert(profileHtml.includes('id="modal-config-notificaciones-profesor"'), 'Modal de configuracion de notificaciones por profesor presente');
assert(profileHtml.includes('hola@genyoga.studio'), 'Remitente hola@genyoga.studio configurado en profile.html');
assert(profileHtml.includes('notif-prof-activas'), 'Switch maestro de notificaciones presente');
assert(profileHtml.includes('notif-prof-email-destino'), 'Campo de email de destino presente');
assert(profileHtml.includes('notif-cond-reserva-consulta'), 'Checkbox condicion reserva_consulta presente');
assert(profileHtml.includes('notif-cond-reserva-multiple'), 'Checkbox condicion reserva_multiple presente');
assert(profileHtml.includes('notif-cond-cancelacion'), 'Checkbox condicion cancelacion presente');
assert(profileHtml.includes('function abrirConfiguracionNotificacionesProfesor'), 'Funcion abrirConfiguracionNotificacionesProfesor presente');
assert(profileHtml.includes('function guardarConfigNotificacionesProfesor'), 'Funcion guardarConfigNotificacionesProfesor presente');
assert(profileHtml.includes('function probarEnvioEmailProfesorActual'), 'Funcion probarEnvioEmailProfesorActual presente');
assert(profileHtml.includes('function enviarNotificacionEmailProfesor'), 'Funcion enviarNotificacionEmailProfesor presente');
assert(profileHtml.includes('function obtenerDatosSesionMultiple'), 'Funcion obtenerDatosSesionMultiple presente');
assert(profileHtml.includes('function toggleConsultaMultipleOpciones'), 'Funcion toggleConsultaMultipleOpciones presente');
assert(profileHtml.includes('abrirConfiguracionNotificacionesProfesor('), 'Boton de configuracion de notificaciones vinculado en tarjetas de profesores');

// 2. Verificar logica de reserva multiple y cancelacion vinculada
console.log('\n2. Verificando logica de reserva y cancelacion vinculada en profile.html...');
assert(profileHtml.includes('multiInfo.esMultiple && partnerClase'), 'Manejo de sesion multiple en reservarConsulta');
assert(profileHtml.includes('p_cobrar_saldo: false'), 'Segundo turno reservado con p_cobrar_saldo: false');
assert(profileHtml.includes('cancelar_consulta_atomica'), 'Rollback y cancelacion atomica presente');
assert(profileHtml.includes('esSesionMultiple ? \'¿Cancelar sesión múltiple vinculada?\'') || profileHtml.includes('esSesionMultiple ?'), 'Alerta de confirmacion de cancelacion para sesion multiple');
assert(profileHtml.includes('partnerBookings'), 'Cancelacion en cascada de turnos vinculados');
assert(profileHtml.includes('Sesión Múltiple (${multi.parte}/${multi.total})') || profileHtml.includes('Sesión Múltiple (${m.parte}/${m.total})'), 'Badges de sesion multiple presentes');

// 3. Verificar Edge Function send-email-notification
console.log('\n3. Verificando Edge Function send-email-notification...');
const edgeFuncPath = path.resolve('supabase/functions/send-email-notification/index.ts');
assert(fs.existsSync(edgeFuncPath), 'Archivo send-email-notification/index.ts existe');
const edgeCode = fs.readFileSync(edgeFuncPath, 'utf8');
assert(edgeCode.includes('corsHeaders'), 'Cabeceras CORS manejadas en Edge Function');
assert(edgeCode.includes('hola@genyoga.studio'), 'Remitente hola@genyoga.studio en Edge Function');
assert(edgeCode.includes('https://api.resend.com/emails'), 'Integracion con API Resend configurada');
assert(edgeCode.includes('reserva_consulta'), 'Plantilla para reserva_consulta');
assert(edgeCode.includes('reserva_multiple'), 'Plantilla para reserva_multiple');
assert(edgeCode.includes('cancelacion_consulta'), 'Plantilla para cancelacion_consulta');

// 4. Verificar migracion SQL
console.log('\n4. Verificando migracion SQL...');
const migrationPath = path.resolve('supabase/migrations/202609090003_sesiones_multiples_y_notificaciones_email.sql');
assert(fs.existsSync(migrationPath), 'Archivo de migracion SQL existe');
const sqlCode = fs.readFileSync(migrationPath, 'utf8');
assert(sqlCode.includes('grupo_multiple_id'), 'Columna grupo_multiple_id en migracion');
assert(sqlCode.includes('notificaciones_email_activas'), 'Columna notificaciones_email_activas en migracion');
assert(sqlCode.includes('notificaciones_config'), 'Columna notificaciones_config en migracion');
assert(sqlCode.includes('notificaciones_email_log'), 'Tabla de log notificaciones_email_log en migracion');

console.log('\n----------------------------------------');
if (failedTests === 0) {
    console.log('TODAS LAS PRUEBAS PASARON CORRECTAMENTE (0 errores).');
    process.exit(0);
} else {
    console.error(`SE ENCONTRARON ${failedTests} ERRORES.`);
    process.exit(1);
}
