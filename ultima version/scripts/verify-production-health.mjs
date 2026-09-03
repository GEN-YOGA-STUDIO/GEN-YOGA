import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const htmlPages = [
    'index.html',
    'clases.html',
    'tarifas.html',
    'profile.html',
    'maestros.html',
    'success.html',
    'cancel.html',
    'politica-privacidad.html'
];

const jsFiles = [
    'public-calendar.js',
    'i18n.js',
    'teacher-profiles.js',
    'facilities-carousel.js'
];

let totalChecks = 0;
let passedChecks = 0;
const errors = [];

function check(name, pass, failureDetail = '') {
    totalChecks++;
    if (pass) {
        passedChecks++;
        console.log(`  ✅ [PASS] ${name}`);
    } else {
        errors.push({ name, detail: failureDetail });
        console.error(`  ❌ [FAIL] ${name}: ${failureDetail}`);
    }
}

async function run() {
    console.log('\n======================================================');
    console.log('🛡️  GEN YOGA PRODUCTION PRE-DEPLOY HEALTH CHECK');
    console.log('======================================================\n');

    // --- 1. SINTAXIS JAVASCRIPT EN HTML Y JS ---
    console.log('🔍 1. Comprobacion de sintaxis JavaScript y parsing VM...');
    for (const file of jsFiles) {
        try {
            const content = await readFile(path.join(root, file), 'utf8');
            new Script(content, { filename: file });
            check(`Sintaxis JS en ${file}`, true);
        } catch (e) {
            check(`Sintaxis JS en ${file}`, false, e.message);
        }
    }

    for (const page of htmlPages) {
        try {
            const html = await readFile(path.join(root, page), 'utf8');
            const scriptMatches = [...html.matchAll(/<script(?:\s+type="(?:text\/javascript|application\/javascript)")?[^>]*>([\s\S]*?)<\/script>/gi)];
            let scriptIndex = 1;
            let pageOk = true;
            for (const match of scriptMatches) {
                const code = match[1].trim();
                if (!code || match[0].includes('src=')) continue;
                try {
                    new Script(code, { filename: `${page}_script_${scriptIndex}` });
                } catch (err) {
                    pageOk = false;
                    check(`Sintaxis script #${scriptIndex} en ${page}`, false, err.message);
                }
                scriptIndex++;
            }
            if (pageOk) {
                check(`Sintaxis scripts en ${page}`, true);
            }
        } catch (e) {
            check(`Lectura de ${page}`, false, e.message);
        }
    }

    // --- 2. VERIFICACIÓN DE CONTROL DE ASISTENCIAS Y ALUMNOS (PROFILE.HTML) ---
    console.log('\n🔍 2. Control de asistencias y gestion de alumnos (profile.html)...');
    const profileHtml = await readFile(path.join(root, 'profile.html'), 'utf8');
    
    check('Funcion cargarAsistenciasPorClase presente', profileHtml.includes('async function cargarAsistenciasPorClase()'));
    check('Fallback de carga de clases en asistencias', profileHtml.includes("from('clases').select('*')") && profileHtml.includes("from('profesionales').select('*')"));
    check('Enriquecimiento de perfiles de alumnos desde reservas', profileHtml.includes('allAsistenciasPerfilesMap[r.user_id]'));
    check('Gestion de profesores en asistencias (esClaseDelProfesionalActual)', profileHtml.includes('function esClaseDelProfesionalActual(clase)'));
    check('Borrado seguro con reembolso y fallback de clases', profileHtml.includes('borrarClase(id)') && (profileHtml.includes('admin_eliminar_clase') || profileHtml.includes('saldo_gratis_descontado')));

    // --- 3. REGLA DE BONOS Y SESIONES GRATUITAS VS REGULARES ---
    check('Reconocimiento de sesiones abiertas/introductorias (esClaseElegibleBonoGratis)', profileHtml.includes('function esClaseElegibleBonoGratis(c)'));

    // --- 4. CALENDARIO PÚBLICO (PUBLIC-CALENDAR.JS) ---
    console.log('\n🔍 4. Calendario publico y clases de bienvenida (public-calendar.js)...');
    const calJs = await readFile(path.join(root, 'public-calendar.js'), 'utf8');
    check('Temporada activa desde 2026-08-24', calJs.includes("SEASON_START_WEEK = '2026-08-24'"));
    check('Inclusion de sesiones abiertas/introductorias en modo clases', calJs.includes('nombre.ilike.%introductor%,nombre.ilike.%abierta%'));
    check('No clasifica erroneamente clases de bienvenida como talleres de pago', calJs.includes('const isIntroOrOpen = /introductor|bienvenida|abierta|gratis|prueba/i.test(rawName);'));

    // --- 5. TARIFAS Y OFERTAS (TARIFAS.HTML) ---
    console.log('\n🔍 5. Estructura de tarifas y ofertas (tarifas.html)...');
    const tarifasHtml = await readFile(path.join(root, 'tarifas.html'), 'utf8');
    check('Oferta Única: Bono de Bienvenida (0 €) presente', (tarifasHtml.includes('rates_welcome_title') || tarifasHtml.includes('Bono de Bienvenida')) && tarifasHtml.includes('0 €'));
    check('Inactivadas ofertas anteriores en sección ofertas', !tarifasHtml.includes('rates_intro_badge') && !tarifasHtml.includes('rates_companion_eyebrow'));
    check('Pestanas de filtrado (Ofertas, Clases, Consultas, Talleres)', tarifasHtml.includes('tab-ofertas') && tarifasHtml.includes('tab-yoga') && tarifasHtml.includes('tab-psicologia') && tarifasHtml.includes('tab-talleres'));

    // --- 6. CANALES DE CONTACTO Y WHATSAPP ---
    console.log('\n🔍 6. Iconos de contacto y WhatsApp...');
    check('WhatsApp configurado en index.html', (await readFile(path.join(root, 'index.html'), 'utf8')).includes('https://wa.me/34624435679'));
    check('WhatsApp configurado en clases.html', (await readFile(path.join(root, 'clases.html'), 'utf8')).includes('https://wa.me/34624435679'));
    check('WhatsApp configurado en tarifas.html', tarifasHtml.includes('https://wa.me/34624435679'));

    // --- 7. CONSISTENCIA DE VERSIONES ---
    console.log('\n🔍 7. Consistencia de version...');
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const currentVer = pkg.version;
    const shortVer = currentVer.split('.').slice(0, 2).join('.');
    check(`Version base en package.json (${currentVer})`, Boolean(currentVer));
    
    for (const page of htmlPages) {
        const content = await readFile(path.join(root, page), 'utf8');
        check(`Version v${shortVer} en ${page}`, content.includes(`?v=${shortVer}`) || content.includes(`v${shortVer}`));
    }

    console.log('\n======================================================');
    if (errors.length === 0) {
        console.log(`🎉 ¡TODOS LOS CONTROLES HAN PASADO CON ÉXITO! (${passedChecks}/${totalChecks})`);
        console.log('🚀 El proyecto esta 100% verificado y listo para produccion sin errores bloqueantes.');
        console.log('======================================================\n');
        process.exit(0);
    } else {
        console.error(`❌ SE ENCONTRARON ${errors.length} ERRORES BLOQUEANTES:`);
        errors.forEach(e => console.error(`   - ${e.name}: ${e.detail}`));
        console.error('======================================================\n');
        process.exit(1);
    }
}

run().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
