// --- 1. CONFIGURACIÓN ---
const SUPA_URL = 'https://jkjifmrrlyncuwpjhxvk.supabase.co';
const SUPA_KEY = 'sb_publishable_xnIELom1ouXaBDJNYaWDAQ_VJNjlnIK';
const client = window.supabase.createClient(SUPA_URL, SUPA_KEY);

// --- DYNAMIC CATEGORIES HELPERS ---
function getEspecialidadTexto(especialidad) {
    if (!especialidad) return '';
    return especialidad.split('|')[0].trim();
}

function getEspecialidadCategorias(p) {
    if (!p) return [];
    const especialidad = p.especialidad || '';
    const email = (p.email || '').toLowerCase();
    const nombre = (p.nombre || '').toLowerCase();
    
    const parts = especialidad.split('|');
    if (parts.length > 1) {
        return parts[1].split(',').map(c => c.trim().toLowerCase());
    }
    
    // Explicit overrides for Yanira and Miriam if no pipe structure exists
    if (email === 'yanira@genyoga.es' || nombre.includes('yanira')) {
        return ['clases', 'talleres'];
    }
    if (email === 'miriam@respirapsicologia.es' || nombre.includes('miriam')) {
        return ['consultas'];
    }
    
    // Fallback/legacy matching based on keywords
    const esp = especialidad.toLowerCase();
    const cats = [];
    if (esp.includes('yoga') || esp.includes('clase') || esp.includes('instructor') || esp.includes('vinyasa') || esp.includes('hatha')) {
        cats.push('clases');
    }
    if (esp.includes('consulta') || esp.includes('psico') || esp.includes('terapia') || esp.includes('nutri') || esp.includes('diet') || esp.includes('alimen')) {
        cats.push('consultas');
    }
    if (esp.includes('taller') || esp.includes('workshop')) {
        cats.push('talleres');
    }
    return cats;
}


let currentUser = null;
let isAdmin = false;
let currentUserRole = '';
let userBonos = 0;
let userSaldoPsicologia = 0;
let userSaldoNutricion = 0;
let userBonoMensualActivo = false;
let userBonoMensualInicio = null;
let userBonoMensualFin = null;
let allUsersCache = [];
let allClasesCache = [];
let allPsicologiaCache = [];
let allNutricionCache = [];

let activePublicView = 'inicio';
let selectedDate = null; // Clases selected date
let selectedDateInicio = null;
let selectedDatePsicologia = null;
let selectedDateNutricion = null;
let selectedDateProfesor = null;
let selectedAsistenciaClaseId = 'todas';

let currentCalendarMonth = new Date(); // Clases calendar month
let currentCalendarMonthInicio = new Date();
let currentCalendarMonthPsicologia = new Date();
let currentCalendarMonthNutricion = new Date();
let currentCalendarMonthProfesor = new Date();

let allConfigCache = [];
let allProfesionalesCache = [];
let allProfesorAgendaCache = [];
let allAsistenciasClaseCache = [];
let allAsistenciasReservasMap = {};
let allAsistenciasPerfilesMap = {};
let datePickerInstance = null;
let datePickerConsultaInstance = null;
let datePickerTallerInstance = null;

const STAFF_ROLES = ['profesor', 'trabajador', 'profesional'];
const SALDOS_CONFIG = {
    yoga: { field: 'bonos', label: 'Clases', icon: 'ph-ticket', color: 'text-olive', badge: 'bg-olive/10 text-olive border-olive/20' },
    psicologia: { field: 'saldo_psicologia', label: 'Psicología', icon: 'ph-brain', color: 'text-[#3B82F6]', badge: 'bg-blue-50 text-[#3B82F6] border-blue-100' },
    nutricion: { field: 'saldo_nutricion', label: 'Nutrición', icon: 'ph-apple', color: 'text-[#8B5CF6]', badge: 'bg-purple-50 text-[#8B5CF6] border-purple-100' }
};
const CONSULTA_CONFIG = {
    psicologia: { table: 'reservas_psicologia', saldoField: 'saldo_psicologia', label: 'Psicología', color: '#3B82F6' },
    nutricion: { table: 'reservas_nutricion', saldoField: 'saldo_nutricion', label: 'Nutrición', color: '#8B5CF6' }
};

function toSafeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function esTrabajador() {
    return STAFF_ROLES.includes(currentUserRole);
}

function tieneAccesoConsultasAdmin() {
    return isAdmin || esTrabajador();
}

function getConsultaConfig(tipo) {
    return CONSULTA_CONFIG[tipo] || CONSULTA_CONFIG.psicologia;
}

function getSaldoConsultaActual(tipo) {
    return tipo === 'psicologia' ? userSaldoPsicologia : userSaldoNutricion;
}

function animateBalance(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    animateValue(id, parseInt(el.innerText, 10) || 0, toSafeNumber(value), 500);
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function generarUuidLocal() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const random = window.crypto?.getRandomValues
            ? window.crypto.getRandomValues(new Uint8Array(1))[0] % 16
            : Math.floor(Math.random() * 16);
        const value = char === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}

function normalizarSlugTexto(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 32) || 'cliente';
}

function generarEmailMostrador(nombre, apellidos) {
    const base = normalizarSlugTexto(`${nombre} ${apellidos}`.trim());
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return `mostrador+${base}-${suffix}@genyoga.studio`;
}

function esClienteMostrador(profileOrEmail) {
    const email = typeof profileOrEmail === 'string'
        ? profileOrEmail
        : profileOrEmail?.email;
    return /^mostrador\+.+@genyoga\.studio$/i.test(String(email || ''));
}

function getNombreCompletoPerfil(profile, fallback = 'Cliente') {
    const nombreCompleto = `${profile?.nombre || ''} ${profile?.apellidos || ''}`.trim();
    return nombreCompleto || profile?.email || fallback;
}

function getIdentificadorPerfil(profile) {
    if (esClienteMostrador(profile)) {
        return 'Mostrador · sin acceso online';
    }
    return profile?.email || 'Sin email';
}

function getTextoBusquedaPerfil(profile) {
    return [
        profile?.nombre,
        profile?.apellidos,
        profile?.email,
        esClienteMostrador(profile) ? 'mostrador sin acceso online' : ''
    ].filter(Boolean).join(' ').toLowerCase();
}

// --- 2. AUTHENTICATION ---

// --- 1. DETECCIÓN DE PLATAFORMA (TRINIDAD) ---
(function detectPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    const body = document.body;

    // Variables de control global (útiles para lógica en el resto del JS)
    window.isIOS = /ipad|iphone|ipod/.test(ua) && !window.MSStream;
    window.isAndroid = /android/.test(ua);
    window.isWeb = !window.isIOS && !window.isAndroid; // Si no es móvil, asumimos Web/Desktop

    // Limpiar clases previas por si acaso
    body.classList.remove('platform-ios', 'platform-android', 'platform-web');

    if (window.isIOS) {
        body.classList.add('platform-ios');
        console.log("Modo: iOS App");
    } else if (window.isAndroid) {
        body.classList.add('platform-android');
        console.log("Modo: Android App");
    } else {
        body.classList.add('platform-web');
        console.log("Modo: Web Desktop");
    }
})();

function toggleAuth(view) {
    const login = document.getElementById('login-card');
    const reg = document.getElementById('register-card');

    if (view === 'register') {
        login.classList.add('hidden');
        reg.classList.remove('hidden');
        reg.classList.add('fade-in');
    } else {
        reg.classList.add('hidden');
        login.classList.remove('hidden');
        login.classList.add('fade-in');
    }
}

client.auth.onAuthStateChange((event, session) => {
    const auth = document.getElementById('auth-container');
    const app = document.getElementById('app-view');

    if (session) {
        auth.classList.add('hidden');
        app.classList.remove('hidden');
        currentUser = session.user;
        initApp();
        loadProfileCard();
    } else {
        app.classList.add('hidden');
        auth.classList.remove('hidden');
        currentUser = null;
        document.body.classList.remove('is-admin');
    }
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    Swal.fire({
        title: 'Entrando...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
        background: '#fff',
        color: '#333'
    });

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) Swal.fire({
        icon: 'error',
        title: 'Ups...',
        text: 'Credenciales incorrectas.',
        confirmButtonColor: '#D27D60'
    });
    else Swal.close();
});

document.getElementById('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const nombre = document.getElementById('reg-nombre').value;
    const apellidos = document.getElementById('reg-apellidos').value;

    if (password.length < 6) return Swal.fire('Contraseña débil', 'Usa al menos 6 caracteres.', 'warning');

    Swal.showLoading();

    // Enviamos metadatos y luego actualizamos tabla profiles
    const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
            data: { nombre, apellidos }
        }
    });

    if (error) {
        Swal.fire('Error', error.message, 'error');
    } else {
        // Intentar asegurar que los datos estén en profiles
        if (data?.user) {
            await client.from('profiles').update({ nombre, apellidos }).eq('id', data.user.id);
        }

        Swal.fire({
            icon: 'success',
            title: '¡Bienvenido a gen Yoga!',
            text: '¡Tu cuenta ha sido creada con éxito!.',
            confirmButtonColor: '#D27D60'
        });
    }
});

async function logout() {
    localStorage.removeItem('activeAdminTab');
    localStorage.removeItem('activeAdminCrearSubTab');
    localStorage.removeItem('activePublicView');
    localStorage.removeItem('activeConsultasSubTab');
    await client.auth.signOut();
    location.reload();
}

// Mapeo de configuraciones con información amigable
const CONFIG_INFO = {
    'horas_limite_cancelacion': {
        nombre: 'Tiempo límite para cancelar',
        descripcion: 'Horas mínimas de anticipación requeridas para cancelar una reserva',
        icono: 'ph-clock-countdown',
        tipo: 'numero',
        unidad: 'horas',
        categoria: 'Reservas'
    },
    'horas_limite_reserva': {
        nombre: 'Tiempo límite para reservar',
        descripcion: 'Horas mínimas de anticipación requeridas para reservar una clase',
        icono: 'ph-clock-countdown',
        tipo: 'numero',
        unidad: 'horas',
        categoria: 'Reservas'
    },
    'permitir_cancelacion_admin_siempre': {
        nombre: 'Admins cancelan siempre',
        descripcion: 'Permitir que administradores cancelen reservas sin límite de tiempo',
        icono: 'ph-shield-check',
        tipo: 'booleano',
        categoria: 'Permisos'
    },
    'max_reservas_simultaneas': {
        nombre: 'Reservas simultáneas por usuario',
        descripcion: 'Número máximo de reservas activas que puede tener un usuario',
        icono: 'ph-users',
        tipo: 'numero',
        unidad: 'reservas',
        categoria: 'Límites'
    },
    'dias_anticipacion_max': {
        nombre: 'Anticipación máxima',
        descripcion: 'Cuántos días en el futuro se puede reservar',
        icono: 'ph-calendar-plus',
        tipo: 'numero',
        unidad: 'días',
        categoria: 'Reservas'
    }
};

let configuracionesApp = {};

async function cargarConfiguracionesApp() {
    try {
        const { data, error } = await client.from('configuracion').select('*');
        if (error) {
            console.error("Error al cargar configuraciones:", error);
            return;
        }

        configuracionesApp = {};
        if (data) {
            data.forEach(c => {
                configuracionesApp[c.clave] = c.valor;
            });

            // 1. Migrar limite de cancelacion de 12 a 24 si corresponde
            if (configuracionesApp['horas_limite_cancelacion'] === '12') {
                console.log("Migrando horas_limite_cancelacion de 12 a 24...");
                const cancelConfig = data.find(c => c.clave === 'horas_limite_cancelacion');
                if (cancelConfig) {
                    await client.from('configuracion').update({ valor: '24' }).eq('id', cancelConfig.id);
                    configuracionesApp['horas_limite_cancelacion'] = '24';
                }
            }

            // 2. Inicializar horas_limite_reserva si falta
            if (configuracionesApp['horas_limite_reserva'] === undefined) {
                console.log("Creando horas_limite_reserva en la base de datos...");
                const { data: newConfig, error: errNew } = await client.from('configuracion').insert([{
                    clave: 'horas_limite_reserva',
                    valor: '12',
                    descripcion: 'Horas mínimas de anticipación requeridas para realizar una reserva',
                    tipo: 'integer'
                }]).select();
                if (newConfig && !errNew) {
                    configuracionesApp['horas_limite_reserva'] = '12';
                }
            }
        }
    } catch (err) {
        console.error("Excepción al cargar configuraciones:", err);
    }
}

// --- 3. APP INIT & PROFILE ---

function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getCurrentLang() {
    try {
        return window.currentLang || localStorage.getItem('yoga-lang') || 'es';
    } catch (e) {
        return window.currentLang || 'es';
    }
}

function getCurrentLocale() {
    return getCurrentLang() === 'en' ? 'en-GB' : 'es-ES';
}

function profileT(key, fallback = '') {
    if (typeof window.t === 'function') {
        const translated = window.t(key);
        if (translated && translated !== key) return translated;
    }
    return fallback || key;
}

function formatDisplayTime(date) {
    return new Date(date).toLocaleTimeString(getCurrentLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDisplayWeekday(date) {
    return new Date(date).toLocaleDateString(getCurrentLocale(), { weekday: 'long' });
}

function formatDisplayMonth(date) {
    return new Date(date).toLocaleDateString(getCurrentLocale(), { month: 'long' });
}

function formatDisplayShortDate(date) {
    return new Date(date).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: 'short' });
}

function formatDisplayLongDate(date, includeYear = false) {
    const options = includeYear
        ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
        : { weekday: 'long', day: 'numeric', month: 'long' };
    return new Date(date).toLocaleDateString(getCurrentLocale(), options);
}

function formatDisplayDateTime(date) {
    return new Date(date).toLocaleString(getCurrentLocale(), { dateStyle: 'full', timeStyle: 'short', hour12: false });
}

function syncFlatpickrLocales() {
    const locale = getCurrentLang() === 'es' ? 'es' : 'default';
    [datePickerInstance, datePickerConsultaInstance, datePickerTallerInstance].forEach(instance => {
        if (instance && typeof instance.set === 'function') {
            instance.set('locale', locale);
        }
    });
}

async function initApp() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');

    // Init Flatpickr for Classes
    datePickerInstance = flatpickr("#clase-fecha", {
        locale: getCurrentLang() === 'es' ? "es" : "default",
        dateFormat: "Y-m-d",
        firstDayOfWeek: 1,
        disableMobile: "true"
    });

    // Toggle opciones de repetición en el modal de clase
    const repEnabled = document.getElementById('clase-repeat-enabled');
    const repOptions = document.getElementById('clase-repeat-options');
    if (repEnabled && repOptions) {
        repEnabled.addEventListener('change', () => {
            if (repEnabled.checked) repOptions.classList.remove('hidden');
            else repOptions.classList.add('hidden');
        });
    }

    const repEvery = document.getElementById('clase-repeat-every');
    const repDaysContainer = document.getElementById('clase-repeat-days-container');
    const repCountLabel = document.getElementById('clase-repeat-count-label');
    const repCountHelp = document.getElementById('clase-repeat-count-help');
    if (repEvery && repDaysContainer && repCountLabel && repCountHelp) {
        repEvery.addEventListener('change', () => {
            const val = repEvery.value;
            if (val === 'dias') {
                repDaysContainer.classList.remove('hidden');
                repCountLabel.textContent = 'Semanas a repetir';
                repCountHelp.textContent = 'Número de semanas durante las cuales se repetirán los días elegidos (ej: 4)';
            } else if (val === 'mensual') {
                repDaysContainer.classList.add('hidden');
                repCountLabel.textContent = 'Meses a repetir';
                repCountHelp.textContent = 'Incluye la primera clase (ej: 4 = 4 meses)';
            } else {
                repDaysContainer.classList.add('hidden');
                repCountLabel.textContent = 'Semanas a repetir';
                repCountHelp.textContent = 'Incluye la primera clase (ej: 4 = 4 semanas)';
            }
        });
    }

    // Toggle opciones de repetición en el modal de consulta
    const repConsultaEnabled = document.getElementById('consulta-repeat-enabled');
    const repConsultaOptions = document.getElementById('consulta-repeat-options');
    if (repConsultaEnabled && repConsultaOptions) {
        repConsultaEnabled.addEventListener('change', () => {
            if (repConsultaEnabled.checked) repConsultaOptions.classList.remove('hidden');
            else repConsultaOptions.classList.add('hidden');
        });
    }

    // Toggle opciones de repetición en el modal de taller
    const repTallerEnabled = document.getElementById('taller-repeat-enabled');
    const repTallerOptions = document.getElementById('taller-repeat-options');
    if (repTallerEnabled && repTallerOptions) {
        repTallerEnabled.addEventListener('change', () => {
            if (repTallerEnabled.checked) repTallerOptions.classList.remove('hidden');
            else repTallerOptions.classList.add('hidden');
        });
    }

    // Init Flatpickr for Consultations (Admin modal)
    datePickerConsultaInstance = flatpickr("#consulta-fecha", {
        locale: getCurrentLang() === 'es' ? "es" : "default",
        dateFormat: "Y-m-d",
        firstDayOfWeek: 1,
        disableMobile: "true"
    });

    // Init Flatpickr for Workshops (Admin modal)
    datePickerTallerInstance = flatpickr("#taller-fecha", {
        locale: getCurrentLang() === 'es' ? "es" : "default",
        dateFormat: "Y-m-d",
        firstDayOfWeek: 1,
        disableMobile: "true"
    });

    // Attach submit event listener to form-crear-consulta
    const formConsulta = document.getElementById('form-crear-consulta');
    if (formConsulta) {
        formConsulta.addEventListener('submit', guardarConsultaAdmin);
    }

    // Attach submit event listener to form-crear-taller
    const formTaller = document.getElementById('form-crear-taller');
    if (formTaller) {
        formTaller.addEventListener('submit', guardarTallerAdmin);
    }

    // Attach outside click listener for consulta modal
    const modalConsulta = document.getElementById('modal-crear-consulta');
    if (modalConsulta) {
        modalConsulta.addEventListener('click', (e) => {
            if (e.target.id === 'modal-crear-consulta') {
                cerrarModalCrearConsulta();
            }
        });
    }

    // Attach outside click listener for taller modal
    const modalTaller = document.getElementById('modal-crear-taller');
    if (modalTaller) {
        modalTaller.addEventListener('click', (e) => {
            if (e.target.id === 'modal-crear-taller') {
                cerrarModalCrearTaller();
            }
        });
    }

    // Listener para cambiar los profesionales según el tipo de consulta seleccionada
    const consultaTipoSelect = document.getElementById('consulta-tipo');
    if (consultaTipoSelect) {
        consultaTipoSelect.addEventListener('change', (e) => {
            actualizarProfesoresSelectConsulta(e.target.value);
        });
    }

    await cargarProfesionalesCache();
    await checkProfile();

    // Load data from Supabase
    await Promise.all([
        cargarHorarios(),
        cargarPsicologia(),
        cargarNutricion()
    ]);

    // Initial render of calendars and content
    if (isAdmin) {
        const savedTab = localStorage.getItem('activeAdminTab') || 'crear';
        await switchTab(savedTab);
    } else if (esTrabajador()) {
        const savedPublicView = localStorage.getItem('activePublicView') || 'profesor-calendario';
        switchPublicView(savedPublicView);
    } else {
        const savedPublicView = localStorage.getItem('activePublicView') || 'inicio';
        switchPublicView(savedPublicView);
    }
}

async function cargarProfesionalesCache() {
    let { data, error } = await client.from('profesionales').select('*').order('nombre');
    
    // Lista de profesionales por defecto
    const defaultProfs = [
        { email: 'profesor@profesor.com', nombre: 'Profesor de Pruebas', apellidos: 'Test', especialidad: 'Yoga | clases', color: '#9B7B37', color_bg: 'bg-olive', visible_publico: false },
        { email: 'angel_profesor@genyoga.studio', nombre: 'Ángel Javier', apellidos: '', especialidad: 'Yoga | clases', color: '#9B7B37', color_bg: 'bg-olive', visible_publico: true },
        { email: 'yanira_profesora@genyoga.studio', nombre: 'Yanira', apellidos: '', especialidad: 'Yoga | clases', color: '#D27D60', color_bg: 'bg-terracotta', visible_publico: true },
        { email: 'miriam_profesora@genyoga.studio', nombre: 'Miriam', apellidos: '', especialidad: 'Yoga | clases', color: '#8b5cf6', color_bg: 'bg-purple-50', visible_publico: true },
        { email: 'silvia_profesora@genyoga.studio', nombre: 'Silvia', apellidos: '', especialidad: 'Yoga | clases', color: '#E1654E', color_bg: 'bg-terracotta', visible_publico: true }
    ];

    if (!error && data) {
        let needsReload = false;
        
        // 1. Auto-crear o actualizar fichas en la tabla profesionales si no existen
        for (const p of defaultProfs) {
            const existingProfIndex = data.findIndex(existing => 
                (existing.email || '').toLowerCase() === p.email.toLowerCase() ||
                (existing.nombre || '').toLowerCase().trim().replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u') === 
                p.nombre.toLowerCase().trim().replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ú/g, 'u')
            );

            if (existingProfIndex === -1) {
                let { error: insErr } = await client.from('profesionales').insert([{
                    nombre: p.nombre,
                    apellidos: p.apellidos,
                    email: p.email,
                    especialidad: p.especialidad,
                    color: p.color,
                    color_bg: p.color_bg,
                    foto_url: "",
                    descripcion: `Ficha de ${p.nombre}.`,
                    visible_publico: p.visible_publico
                }]);
                
                // Fallback si la columna no existe en BD
                if (insErr && insErr.message && insErr.message.includes('visible_publico')) {
                    const { error: fallbackErr } = await client.from('profesionales').insert([{
                        nombre: p.nombre,
                        apellidos: p.apellidos,
                        email: p.email,
                        especialidad: p.especialidad,
                        color: p.color,
                        color_bg: p.color_bg,
                        foto_url: "",
                        descripcion: `Ficha de ${p.nombre}.`
                    }]);
                    insErr = fallbackErr;
                }
                
                if (!insErr) {
                    needsReload = true;
                }
            } else {
                // Si existe pero con otro email, lo actualizamos al nuevo
                const existing = data[existingProfIndex];
                if ((existing.email || '').toLowerCase() !== p.email.toLowerCase()) {
                    const updatePayload = { email: p.email };
                    if (existing.visible_publico !== undefined) {
                        updatePayload.visible_publico = p.visible_publico;
                    }
                    
                    const { error: updErr } = await client.from('profesionales')
                        .update(updatePayload)
                        .eq('id', existing.id);
                        
                    if (!updErr) {
                        needsReload = true;
                    }
                }
            }
        }

        if (needsReload) {
            const { data: newData, error: newErr } = await client.from('profesionales').select('*').order('nombre');
            if (!newErr && newData) {
                data = newData;
            }
        }

        // 2. Auto-crear perfiles en la tabla profiles (rol de profesor) si no existen
        const { data: allProfiles, error: errProfiles } = await client.from('profiles').select('email');
        if (!errProfiles && allProfiles) {
            for (const p of defaultProfs) {
                if (!allProfiles.some(existing => (existing.email || '').toLowerCase() === p.email.toLowerCase())) {
                    const newId = generarUuidLocal();
                    await client.from('profiles').insert([{
                        id: newId,
                        email: p.email,
                        nombre: p.nombre,
                        apellidos: p.apellidos,
                        rol: 'profesor',
                        bonos: 0
                    }]);
                }
            }
        }
    }
    if (!error && data) {
        allProfesionalesCache = data.map(p => {
            if ((p.email || '').toLowerCase() === 'angel@genyoga.es' || (p.nombre || '').toLowerCase() === 'ángel') {
                const updated = { ...p };
                if (!updated.nombre.includes('Javier')) {
                    updated.nombre = "Ángel Javier";
                }
                if (!updated.descripcion || !updated.descripcion.includes('LUGAR DE NACIMIENTO')) {
                    updated.descripcion = `LUGAR DE NACIMIENTO: La Roda

TITULACIONES:
Ninguna. Baso mi aprendizaje en el autoestudio/práctica, en recibir clases e intensivos de profesores con larga trayectoria (anatomía, asana, filosofía, etc., lo necesario para mi desarrollo en el camino de Yoga). En septiembre empiezo la mentoría para la certificación como profesor de Yoga Iyengar.

SOBRE MI:
Cuento con 6 años de experiencia en la práctica de yoga, de los cuales 5 años y medio están dedicados a estudiar y practicar Iyengar Yoga en Valencia y La Roda.

TE ACOMPAÑO:
La práctica está basada en el ajuste preciso y la correcta alineación del cuerpo, adaptando la postura a las condiciones de cada alumno/a para encontrar los efectos y beneficios en asana. Trabajamos en la comprensión de las acciones, en sentir lo que hacemos y, desde la profundidad de ese trabajo físico, damos la posibilidad a una manera de relación acorde al conocimiento propio que se va dando con la práctica.

ME DEFINE:
"Dedicación y Cuidado"`;
                }
                return updated;
            }
            if (p.id === 14 || (p.email || '').toLowerCase() === 'yanira@genyoga.es' || (p.nombre || '').toLowerCase().includes('yanira')) {
                const updated = { ...p };
                updated.foto_url = 'img/yanira.jpg';
                updated.descripcion = `TRAYECTORIA:
Procedente de Estados Unidos, con raíces salvadoreñas, he tenido la oportunidad de conocer y vivir en varias partes del mundo y me siento afortunada de conocer a personas de diferentes lugares y de varios caminos en la vida, ya que cada experiencia y aprendizaje me han formado como la persona que ahora soy.

Docente de profesión, he enseñado en las escuelas del área de Washington D.C. por veinte años. Mis estudios del Yoga son un proceso continuo, pero considero que mi yoga mat es mi mejor guía.

TITULACIONES:
• Máster en Educación Internacional (Framingham State College)
• Máster en Liderazgo en Educación (Universidad de George Mason)
• Instructora de Yoga certificada por Yoga Alliance (entrenamiento en DownDog en Georgetown, Washington D.C.)
• Especializaciones en Anatomía aplicada al Yoga, Yoga Infantil, Yoga y Mindfulness

TE ACOMPAÑO:
• Vinyasa Yoga (Clases virtuales y presenciales)
• Yoga Restaurativo y Meditación
• Mindfulness para adultos y niños`;
                return updated;
            }
            return p;
        });
    }
}

async function getBonoMensualStats() {
    if (!userBonoMensualActivo || !userBonoMensualInicio || !userBonoMensualFin) {
        return { semana: 0, mes: 0 };
    }

    const { data, error } = await client.from('reservas_yoga')
        .select('id, clases(fecha_inicio)')
        .eq('user_id', currentUser.id)
        .eq('estado', 'confirmada')
        .eq('usado_bono_mensual', true);

    if (error) {
        console.error('Error al obtener estadísticas de bono mensual:', error);
        return { semana: 0, mes: 0 };
    }

    let mesCount = 0;
    let semanaCount = 0;

    const hoy = new Date();
    const inicioSemana = new Date(hoy);
    const dia = inicioSemana.getDay();
    const diff = inicioSemana.getDate() - dia + (dia === 0 ? -6 : 1);
    inicioSemana.setDate(diff);
    inicioSemana.setHours(0, 0, 0, 0);

    const finSemana = new Date(inicioSemana);
    finSemana.setDate(finSemana.getDate() + 7);

    const inicioPeriodo = new Date(userBonoMensualInicio);
    const finPeriodo = new Date(userBonoMensualFin);

    (data || []).forEach(r => {
        if (r.clases && r.clases.fecha_inicio) {
            const fechaClase = new Date(r.clases.fecha_inicio);
            if (fechaClase >= inicioPeriodo && fechaClase <= finPeriodo) {
                mesCount++;
            }
            if (fechaClase >= inicioSemana && fechaClase < finSemana) {
                semanaCount++;
            }
        }
    });

    return { semana: semanaCount, mes: mesCount };
}

async function renderSaldosCliente() {
    const headerWrapper = document.getElementById('header-saldos-wrapper');
    const profileWrapper = document.getElementById('profile-saldos-wrapper');

    let html = '';
    const singleClass = profileT('common_single_class', 'Clase suelta');
    const singleClasses = profileT('common_single_classes', 'Clases sueltas');
    const monthlyPlan = profileT('common_monthly_plan', 'Bono Mensual');
    const monthlyActive = profileT('common_monthly_plan_active', 'Bono Mensual Activo');
    const monthlyInactive = profileT('common_monthly_plan_inactive', 'Bono Mensual Inactivo');
    const inactive = profileT('common_inactive', 'Inactivo');
    const request = profileT('profile_request', 'Solicitar');
    const requestActivation = profileT('profile_request_activation', 'Solicitar activación');
    const weekShort = profileT('profile_week_short', 'Sem');
    const monthShort = profileT('profile_month_short', 'Mes');
    const expires = profileT('profile_expires', 'Vence');
    
    const bonoIndividualHtml = `
        <div class="bg-white px-3 py-2 rounded-2xl border border-gray-200 shadow-sm hover:border-olive transition cursor-default min-w-[120px]"
            title="${escapeHtml(singleClasses)}">
            <span class="block text-[9px] text-cocoa/50 font-bold uppercase tracking-widest leading-none">${escapeHtml(singleClass)}</span>
            <div class="flex items-center justify-end gap-2 mt-1">
                <i class="ph-fill ph-ticket text-olive text-lg"></i>
                <span id="bonos-count" class="font-black text-cocoa text-xl leading-none">${userBonos}</span>
            </div>
        </div>`;

    let bonoMensualHtml = '';
    if (userBonoMensualActivo) {
        const stats = await getBonoMensualStats();
        const fechaFin = userBonoMensualFin ? new Date(userBonoMensualFin).toLocaleDateString(getCurrentLocale()) : '--/--/----';
        bonoMensualHtml = `
            <div class="bg-white px-3 py-2 rounded-2xl border border-[#10B981] shadow-sm hover:border-emerald-600 transition cursor-default min-w-[160px]"
                title="${escapeHtml(monthlyActive)} (${escapeHtml(expires)}: ${escapeHtml(fechaFin)})">
                <span class="block text-[9px] text-[#10B981] font-bold uppercase tracking-widest leading-none">${escapeHtml(monthlyActive)}</span>
                <div class="flex items-center justify-between gap-2 mt-1.5 text-xs text-cocoa font-semibold">
                    <div class="flex items-center gap-1">
                        <i class="ph-fill ph-flower-lotus text-[#10B981]"></i>
                        <span>${escapeHtml(weekShort)}: <b class="text-emerald-700">${stats.semana}</b>/2</span>
                    </div>
                    <div class="w-px h-3.5 bg-gray-200"></div>
                    <div>
                        <span>${escapeHtml(monthShort)}: <b class="text-emerald-700">${stats.mes}</b>/8</span>
                    </div>
                </div>
            </div>`;
    } else {
        bonoMensualHtml = `
            <div class="bg-white/40 px-3 py-2 rounded-2xl border border-dashed border-terracotta/20 shadow-sm hover:border-gray-400 transition min-w-[160px]"
                title="${escapeHtml(monthlyInactive)}">
                <span class="block text-[9px] text-terracotta font-bold uppercase tracking-widest leading-none">${escapeHtml(monthlyPlan)}</span>
                <div class="flex items-center justify-between gap-2 mt-1.5">
                    <span class="bg-terracotta/10 text-terracotta text-[9px] font-bold px-2 py-0.5 rounded border border-terracotta/20 uppercase tracking-wider">${escapeHtml(inactive)}</span>
                    <button onclick="solicitarActivacionBonoMensual()" class="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider btn-solicitar-mensual rounded transition shadow-sm">
                        ${escapeHtml(request)}
                    </button>
                </div>
            </div>`;
    }

    html = bonoIndividualHtml + bonoMensualHtml;

    if (headerWrapper) {
        headerWrapper.innerHTML = html;
    }

    if (profileWrapper) {
        let profileHtml = `
            <div class="bg-white/80 px-4 py-3 rounded-2xl border border-cocoa/10 text-center min-w-[110px]">
                <span class="block text-[9px] text-cocoa/45 font-bold uppercase tracking-widest leading-none">${escapeHtml(singleClasses)}</span>
                <div class="flex items-center justify-center gap-1.5 mt-2">
                    <i class="ph-fill ph-ticket text-olive text-lg"></i>
                    <span class="font-black text-cocoa text-2xl leading-none">${userBonos}</span>
                </div>
            </div>
        `;

        if (userBonoMensualActivo) {
            const stats = await getBonoMensualStats();
            const fechaFin = userBonoMensualFin ? new Date(userBonoMensualFin).toLocaleDateString(getCurrentLocale()) : '--/--/----';
            profileHtml += `
                <div class="bg-white/90 px-4 py-3 rounded-2xl border border-[#10B981] text-center min-w-[160px] flex flex-col justify-center items-center">
                    <div>
                        <span class="block text-[9px] text-emerald-600 font-bold uppercase tracking-widest leading-none">${escapeHtml(monthlyActive)}</span>
                        <div class="flex justify-center items-center gap-3 mt-2 text-sm text-cocoa font-bold">
                            <div class="flex items-center gap-1">
                                <i class="ph-fill ph-flower-lotus text-[#10B981]"></i>
                                <span>${escapeHtml(weekShort)}: <b class="text-emerald-700 text-lg">${stats.semana}</b>/2</span>
                            </div>
                            <div class="w-px h-4 bg-gray-200"></div>
                            <div>
                                <span>${escapeHtml(monthShort)}: <b class="text-emerald-700 text-lg">${stats.mes}</b>/8</span>
                            </div>
                        </div>
                        <span class="block text-[8px] text-gray-400 mt-1 uppercase tracking-wider font-light">${escapeHtml(expires)}: ${escapeHtml(fechaFin)}</span>
                    </div>
                </div>
            `;
        } else {
            profileHtml += `
                <div class="bg-white/90 px-4 py-3 rounded-2xl border border-dashed border-terracotta/40 text-center min-w-[190px] flex flex-col justify-between items-center shadow-sm">
                    <div>
                        <span class="block text-[9px] text-terracotta font-bold uppercase tracking-widest leading-none">${escapeHtml(monthlyInactive)}</span>
                        <div class="flex items-center justify-center gap-1.5 mt-2">
                            <span class="bg-terracotta/10 text-terracotta text-[10px] font-bold px-2.5 py-1 rounded border border-terracotta/20 uppercase tracking-wide">${escapeHtml(inactive)}</span>
                        </div>
                    </div>
                    <button onclick="solicitarActivacionBonoMensual()" class="mt-3 w-full py-2 text-[10px] font-bold uppercase tracking-wider btn-solicitar-mensual rounded-lg transition shadow-sm flex items-center justify-center gap-1.5">
                        <i class="ph-bold ph-paper-plane-tilt text-xs"></i> ${escapeHtml(requestActivation)}
                    </button>
                </div>
            `;
        }
        profileWrapper.innerHTML = profileHtml;
    }
}

async function checkProfile() {
    let { data, error } = await client.from('profiles')
        .select('rol, bonos, saldo_psicologia, saldo_nutricion, bono_mensual_activo, bono_mensual_inicio, bono_mensual_fin')
        .eq('id', currentUser.id)
        .single();

    if (error && /bono_mensual_activo|saldo_psicologia|saldo_nutricion|schema cache|column/i.test(error.message || '')) {
        console.warn('Faltan columnas de saldo en profiles. Usando solo bonos básicos.', error);
        ({ data, error } = await client.from('profiles').select('rol, bonos').eq('id', currentUser.id).single());
    }

    if (error) {
        console.error("Error perfil:", error);
        isAdmin = false;
        currentUserRole = '';
        document.body.classList.remove('is-admin');
        document.body.classList.remove('is-profesor');
        return;
    }

    if (data) {
        userBonos = toSafeNumber(data.bonos);
        userSaldoPsicologia = toSafeNumber(data.saldo_psicologia);
        userSaldoNutricion = toSafeNumber(data.saldo_nutricion);
        userBonoMensualActivo = !!data.bono_mensual_activo;
        userBonoMensualInicio = data.bono_mensual_inicio;
        userBonoMensualFin = data.bono_mensual_fin;

        await renderSaldosCliente();

        // Normalizar rol
        const rol = (data.rol || '').toLowerCase().trim();
        currentUserRole = rol;

        if (rol === 'admin') {
            isAdmin = true;
            document.body.classList.add('is-admin');
            document.body.classList.remove('is-profesor');

            const pubNav = document.getElementById('public-nav');
            if (pubNav) pubNav.classList.add('hidden');

            const bonosHeader = document.getElementById('header-bonos-container');
            if (bonosHeader) bonosHeader.classList.add('hidden');

            // Mostrar todos los tabs
            ['tab-crear', 'tab-gestion-alumnos', 'tab-admin-profesores', 'tab-usuarios', 'tab-configuracion'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('hidden');
            });

            const btnMisClases = document.getElementById('nav-public-mis-clases');
            if (btnMisClases) btnMisClases.classList.add('hidden');

            const adminBar = document.querySelector('.admin-only');
            if (adminBar) adminBar.style.removeProperty('display');

        } else if (STAFF_ROLES.includes(rol)) {
            isAdmin = false;
            document.body.classList.remove('is-admin');
            document.body.classList.add('is-profesor');

            const pubNav = document.getElementById('public-nav');
            if (pubNav) pubNav.classList.remove('hidden');

            const bonosHeader = document.getElementById('header-bonos-container');
            if (bonosHeader) bonosHeader.classList.add('hidden');

            ['nav-public-inicio', 'nav-public-horarios', 'nav-public-psicologia', 'nav-public-nutricion', 'nav-public-profesores'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
            ['nav-public-profesor-calendario', 'nav-public-mis-clases'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('hidden');
            });

            const adminBar = document.querySelector('.admin-only');
            if (adminBar) {
                adminBar.style.display = '';
                adminBar.classList.add('hidden');
            }

        } else {
            isAdmin = false;
            document.body.classList.remove('is-admin');
            document.body.classList.remove('is-profesor');

            const pubNav = document.getElementById('public-nav');
            if (pubNav) pubNav.classList.remove('hidden');

            const bonosHeader = document.getElementById('header-bonos-container');
            if (bonosHeader) bonosHeader.classList.remove('hidden');

            const btnMisClases = document.getElementById('nav-public-mis-clases');
            if (btnMisClases) btnMisClases.classList.add('hidden');
            const btnProfesorCalendario = document.getElementById('nav-public-profesor-calendario');
            if (btnProfesorCalendario) btnProfesorCalendario.classList.add('hidden');
            ['nav-public-inicio', 'nav-public-horarios', 'nav-public-psicologia', 'nav-public-profesores'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('hidden');
            });
            const btnNutri = document.getElementById('nav-public-nutricion');
            if (btnNutri) btnNutri.classList.add('hidden');

            const vistasGestion = ['view-usuarios', 'view-admin-psicologia', 'view-admin-nutricion', 'view-admin-profesores', 'view-configuracion', 'view-asistencias', 'view-profesor-calendario'];
            const hayVistaGestionActiva = vistasGestion.some(id => {
                const view = document.getElementById(id);
                return view && !view.classList.contains('hidden');
            });
            if (hayVistaGestionActiva) switchPublicView('inicio');

            const adminBar = document.querySelector('.admin-only');
            if (adminBar) {
                adminBar.style.display = '';
                adminBar.classList.add('hidden');
            }
        }

        const alertBox = document.getElementById('no-bonos-alert');
        if (alertBox) {
            if (userBonos < 1 && !isAdmin && !esTrabajador()) alertBox.classList.remove('hidden');
            else alertBox.classList.add('hidden');
        }
    }
    await cargarConfiguracionesApp();
}

function animateValue(id, start, end, duration) {
    if (start === end) return;
    const obj = document.getElementById(id);
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

// --- 4. CALENDARIO ---
function renderizarCalendario() {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();

    // Header
    const monthNames = [
        window.t('month_0'), window.t('month_1'), window.t('month_2'), window.t('month_3'),
        window.t('month_4'), window.t('month_5'), window.t('month_6'), window.t('month_7'),
        window.t('month_8'), window.t('month_9'), window.t('month_10'), window.t('month_11')
    ];
    document.getElementById('calendar-month-year').textContent = `${monthNames[month]} ${year}`;

    // Grid
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Días del mes anterior
    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        const dayEl = crearDiaCalendario(day, true, false, false, null);
        dayEl.classList.add('other-month');
        grid.appendChild(dayEl);
    }

    // Días del mes actual
    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateKey = formatDateLocal(dateObj);
        const isToday = dateObj.getTime() === today.getTime();
        const isPast = dateObj < today;
        const isTestUser = (currentUser?.email || '').toLowerCase() === 'profesor@profesor.com';
        const showTestProfesor = isAdmin || isTestUser;
        const hasClasses = allClasesCache.some(c => {
            if (!showTestProfesor && c.profesionales && c.profesionales.visible_publico === false) {
                return false;
            }
            const claseDate = formatDateLocal(new Date(c.fecha_inicio));
            return claseDate === dateKey;
        });
        const isSelected = selectedDate === dateKey;

        const dayEl = crearDiaCalendario(day, false, isToday, isPast, dateKey);
        if (hasClasses) dayEl.classList.add('has-classes');
        if (isSelected) dayEl.classList.add('selected');
        if (isPast) dayEl.classList.add('disabled');

        grid.appendChild(dayEl);
    }

    // Días del mes siguiente
    const totalCells = grid.children.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const dayEl = crearDiaCalendario(day, true, false, false, null);
        dayEl.classList.add('other-month');
        grid.appendChild(dayEl);
    }
}

function crearDiaCalendario(day, isOtherMonth, isToday, isPast, dateKey) {
    const div = document.createElement('div');
    div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20';
    div.textContent = day;

    if (isToday) div.classList.add('today');

    if (!isOtherMonth && !isPast && dateKey) {
        div.onclick = () => filtrarPorFecha(dateKey);
    }

    return div;
}

function cambiarMes(delta) {
    currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + delta);
    renderizarCalendario();
}

function filtrarPorFecha(dateKey) {
    selectedDate = dateKey;
    renderizarCalendario();
    renderizarClases();
}

function limpiarFiltroFecha() {
    selectedDate = null;
    renderizarCalendario();
    renderizarClases();
}

function aplicarFiltrosClases() {
    renderizarClases();
}

function limpiarTodosLosFiltrosClases() {
    selectedDate = null;
    const selectProfesor = document.getElementById('filtro-profesor');
    const selectTipoYoga = document.getElementById('filtro-tipo-yoga');
    const selectHorario = document.getElementById('filtro-horario');
    const selectDisponibilidad = document.getElementById('filtro-disponibilidad');

    if (selectProfesor) selectProfesor.value = 'todos';
    if (selectTipoYoga) selectTipoYoga.value = 'todos';
    if (selectHorario) selectHorario.value = 'todos';
    if (selectDisponibilidad) selectDisponibilidad.value = 'todos';

    renderizarCalendario();
    renderizarClases();
}

function actualizarOpcionesFiltrosClases() {
    const selectProfesor = document.getElementById('filtro-profesor');
    const selectTipoYoga = document.getElementById('filtro-tipo-yoga');
    
    if (!selectProfesor || !selectTipoYoga) return;

    // Guardar selección actual
    const valorProfesorPrevio = selectProfesor.value;
    const valorTipoYogaPrevio = selectTipoYoga.value;

    // Obtener valores únicos de allClasesCache
    const profesoresMap = new Map(); // id -> nombre
    const tiposYogaSet = new Set();

    const isTestUser = (currentUser?.email || '').toLowerCase() === 'profesor@profesor.com';
    const showTestProfesor = isAdmin || isTestUser;

    allClasesCache.forEach(c => {
        if (c.profesionales) {
            if (!showTestProfesor && c.profesionales.visible_publico === false) {
                return;
            }
            profesoresMap.set(c.profesionales.id, c.profesionales.nombre);
        } else {
            profesoresMap.set('staff', 'Staff GEN Yoga');
        }
        if (c.nombre) {
            tiposYogaSet.add(c.nombre);
        }
    });

    // Rellenar Profesor
    selectProfesor.innerHTML = `<option value="todos">${escapeHtml(profileT('profile_filter_all_teachers', 'Todos los profesores'))}</option>`;
    profesoresMap.forEach((nombre, id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = nombre;
        selectProfesor.appendChild(opt);
    });

    // Rellenar Tipo de Yoga
    selectTipoYoga.innerHTML = `<option value="todos">${escapeHtml(profileT('profile_filter_all_types', 'Todos los tipos'))}</option>`;
    Array.from(tiposYogaSet).sort().forEach(tipo => {
        const opt = document.createElement('option');
        opt.value = tipo;
        opt.textContent = tipo;
        selectTipoYoga.appendChild(opt);
    });

    // Restaurar selección previa si existe
    if (Array.from(selectProfesor.options).some(o => o.value === valorProfesorPrevio)) {
        selectProfesor.value = valorProfesorPrevio;
    } else {
        selectProfesor.value = 'todos';
    }

    if (Array.from(selectTipoYoga.options).some(o => o.value === valorTipoYogaPrevio)) {
        selectTipoYoga.value = valorTipoYogaPrevio;
    } else {
        selectTipoYoga.value = 'todos';
    }
}

// --- 5. HORARIOS (CLASES) ---
async function cargarHorarios() {
    const container = document.getElementById('schedule-container');
    container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
      <i class="ph-duotone ph-spinner animate-spin text-4xl text-olive"></i>
      <span class="text-xs uppercase tracking-widest font-bold text-gray-500">${escapeHtml(profileT('profile_loading_classes', 'Cargando clases...'))}</span>
    </div>`;

    // Solo traer clases futuras (desde hoy - 2 horas para permitir ver la actual)
    const now = new Date();
    now.setHours(now.getHours() - 2);
    const nowIso = now.toISOString();

    const { data: clases, error: errClases } =
        await client.from('clases')
            .select('*, profesionales(*)')
            .eq('tipo_clase', 'yoga')
            .gte('fecha_inicio', nowIso)
            .order('fecha_inicio');

    if (errClases) {
        console.error('Error cargando clases', errClases);
        container.innerHTML = '';
        document.getElementById('empty-state').classList.remove('hidden');
        allClasesCache = [];
        actualizarOpcionesFiltrosClases();
        return;
    }

    if (!clases || clases.length === 0) {
        container.innerHTML = '';
        document.getElementById('empty-state').classList.remove('hidden');
        allClasesCache = [];
        actualizarOpcionesFiltrosClases();
        return;
    }

    // Traer solo reservas de estas clases para optimizar consumo
    const claseIds = clases.map(c => c.id);
    const { data: reservas, error: errReservas } =
        await client.from('reservas_yoga')
            .select('*')
            .in('clase_id', claseIds);

    if (errReservas) {
        console.error('Error cargando reservas', errReservas);
        // Continuamos con 0 reservas si falla pero hay clases
    }
    document.getElementById('empty-state').classList.add('hidden');

    // Map por clase_id => [reservas]
    const reservasMap = {};
    (reservas || []).forEach(r => {
        if (!reservasMap[r.clase_id]) reservasMap[r.clase_id] = [];
        reservasMap[r.clase_id].push(r);
    });

    // Enriquecer clases con ocupadas y miReserva (solo confirmadas)
    clases.forEach(c => {
        const resClase = reservasMap[c.id] || [];
        const confirmadas = resClase.filter(r => r.estado === 'confirmada');
        c.ocupadas = confirmadas.length;
        c.miReserva = confirmadas.find(r => r.user_id === currentUser.id) || null;
    });

    allClasesCache = clases;
    actualizarOpcionesFiltrosClases();
    renderizarCalendario();
    renderizarClases();
    refrescarInicioSiActivo();
}

function renderizarClases() {
    const container = document.getElementById('schedule-container');

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let clasesAMostrar = allClasesCache.filter(c => {
        const fechaClase = new Date(c.fecha_inicio);
        fechaClase.setHours(0, 0, 0, 0);
        return fechaClase >= hoy;
    });

    if (selectedDate) {
        clasesAMostrar = clasesAMostrar.filter(c => {
            const claseDate = formatDateLocal(new Date(c.fecha_inicio));
            return claseDate === selectedDate;
        });
    }

    const isTestUser = (currentUser?.email || '').toLowerCase() === 'profesor@profesor.com';
    const showTestProfesor = isAdmin || isTestUser;

    if (!showTestProfesor) {
        clasesAMostrar = clasesAMostrar.filter(c => !c.profesionales || c.profesionales.visible_publico !== false);
    }

    // Aplicar filtros adicionales
    const selectProfesor = document.getElementById('filtro-profesor');
    const selectTipoYoga = document.getElementById('filtro-tipo-yoga');
    const selectHorario = document.getElementById('filtro-horario');
    const selectDisponibilidad = document.getElementById('filtro-disponibilidad');

    if (selectProfesor && selectProfesor.value !== 'todos') {
        const profId = selectProfesor.value;
        clasesAMostrar = clasesAMostrar.filter(c => {
            if (profId === 'staff') {
                return !c.profesionales || !c.profesionales.id;
            }
            return c.profesionales && String(c.profesionales.id) === profId;
        });
    }

    if (selectTipoYoga && selectTipoYoga.value !== 'todos') {
        const tipoYoga = selectTipoYoga.value;
        clasesAMostrar = clasesAMostrar.filter(c => c.nombre === tipoYoga);
    }

    if (selectHorario && selectHorario.value !== 'todos') {
        const rango = selectHorario.value;
        clasesAMostrar = clasesAMostrar.filter(c => {
            const fechaInicio = new Date(c.fecha_inicio);
            const hora = fechaInicio.getHours();
            if (rango === 'manana') return hora >= 7 && hora < 12;
            if (rango === 'mediodia') return hora >= 12 && hora < 16;
            if (rango === 'tarde') return hora >= 16 && hora < 20;
            if (rango === 'noche') return hora >= 20;
            return true;
        });
    }

    if (selectDisponibilidad && selectDisponibilidad.value !== 'todos') {
        const disp = selectDisponibilidad.value;
        clasesAMostrar = clasesAMostrar.filter(c => {
            const llena = c.ocupadas >= c.capacidad_max;
            if (disp === 'huecos') return !llena;
            if (disp === 'completas') return llena;
            return true;
        });
    }

    if (clasesAMostrar.length === 0) {
        container.innerHTML = `
                    <div class="bg-white/90 backdrop-blur-md rounded-2xl p-12 text-center border border-white/20 shadow-lg">
                        <i class="ph-duotone ph-calendar-x text-5xl text-cocoa/20 mb-4"></i>
                        <p class="text-cocoa/60 font-medium">${escapeHtml(profileT('profile_no_matching_classes', 'No hay clases que coincidan con los filtros'))}</p>
                        <button onclick="limpiarTodosLosFiltrosClases()" class="mt-4 text-olive hover:underline text-sm font-bold">${escapeHtml(profileT('profile_reset_filters', 'Restablecer filtros'))}</button>
                    </div>`;
        return;
    }

    const grupos = {};
    clasesAMostrar.forEach(c => {
        const dateKey = formatDateLocal(new Date(c.fecha_inicio));
        if (!grupos[dateKey]) grupos[dateKey] = [];
        grupos[dateKey].push(c);
    });

    container.innerHTML = '';

    Object.keys(grupos).sort().forEach(dateKey => {
        const dateObj = new Date(dateKey);
        const diaNombre = formatDisplayWeekday(dateObj);
        const diaNumero = dateObj.getDate();
        const mes = formatDisplayMonth(dateObj);

        const section = document.createElement('div');
        section.className = 'bg-white/90 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg overflow-hidden';

        section.innerHTML = `
                    <div class="bg-gradient-to-r from-cocoa/10 to-sand/5 px-6 py-4 border-b border-cocoa/5 flex items-center justify-between">
                        <div class="flex items-baseline gap-2">
                            <span class="brand-font text-xl font-bold text-cocoa capitalize">${diaNombre}</span>
                            <span class="text-xs font-semibold text-olive bg-olive/10 px-2 py-0.5 rounded-md border border-olive/20">${diaNumero} ${mes}</span>
                        </div>
                    </div>
                    <div id="grid-${dateKey}" class="divide-y divide-cocoa/5"></div>
                `;
        container.appendChild(section);

        const grid = section.querySelector(`#grid-${dateKey}`);

        grupos[dateKey].forEach(c => {
            const hora = formatDisplayTime(c.fecha_inicio);

            const isHot = c.nombre.toLowerCase().includes('hot') || c.nombre.toLowerCase().includes('bikram');

            let iconColorClass = 'bg-sand/30 text-cocoa border-sand';
            let tipoTexto = 'Yoga';

            if (isHot) {
                iconColorClass = 'bg-cocoa/10 text-cocoa border-cocoa/20';
                tipoTexto = 'Hot';
            }

            const llena = c.ocupadas >= c.capacidad_max;
            const reservada = !!c.miReserva;

            let btnAction = '';
            if (isAdmin) {
                btnAction = `
                            <button onclick="abrirModalAsignarPlazaAdmin('yoga', ${c.id})" class="bg-gradient-to-r from-cocoa to-olive text-white text-[11px] font-bold px-5 py-2 rounded-full shadow-md hover:shadow-lg transition active:scale-95 flex items-center gap-1">
                                <i class="ph-bold ph-user-plus"></i> ${escapeHtml(profileT('profile_assign', 'ASIGNAR'))}
                            </button>`;
            } else if (reservada) {
                btnAction = `
                            <button onclick="cancelar(${c.miReserva.id})" class="group flex items-center gap-2 text-[11px] font-bold text-cocoa/40 hover:text-red-500 border border-cocoa/10 hover:border-red-200 bg-ivory px-4 py-2 rounded-full transition shadow-sm">
                                <i class="ph-bold ph-x group-hover:scale-110 transition"></i> ${escapeHtml(profileT('profile_cancel', 'CANCELAR'))}
                            </button>`;
            } else if (llena) {
                btnAction = `<span class="text-[10px] font-bold text-cocoa/40 bg-sand/10 px-3 py-2 rounded-full uppercase tracking-wide border border-cocoa/10 cursor-not-allowed">${escapeHtml(profileT('profile_full', 'Completa'))}</span>`;
            } else {
                const esAlumno = !isAdmin && !STAFF_ROLES.includes(currentUserRole);
                if (!esAlumno) {
                    btnAction = `<span class="text-[10px] font-bold text-cocoa/40 bg-sand/10 px-3 py-2 rounded-full uppercase tracking-wide border border-cocoa/10 cursor-not-allowed">${escapeHtml(profileT('profile_unavailable', 'No Disponible'))}</span>`;
                } else {
                    const tieneBonoMensual = userBonoMensualActivo && userBonoMensualInicio && userBonoMensualFin;
                    const canBook = (userBonos >= 1 || tieneBonoMensual);
                    const disabledClass = (!canBook) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:shadow-lg hover:brightness-110 active:scale-95';
                    const btnText = (!canBook) ? profileT('profile_no_balance', 'Sin Saldo') : profileT('profile_book', 'RESERVAR');

                    btnAction = `
                                <button onclick="reservar(${c.id})" class="bg-gradient-to-r from-terracotta to-golden text-white text-[11px] font-bold px-6 py-2 rounded-full shadow-md transition transform ${disabledClass}">
                                    ${escapeHtml(btnText)}
                                </button>`;
                }
            }

            const adminTrash = `<button onclick="borrarClase(${c.id})" class="admin-only text-cocoa/20 hover:text-red-500 transition ml-2 p-1" title="Eliminar Clase"><i class="ph-bold ph-trash"></i></button>`;

            const profesorName = c.profesionales ? c.profesionales.nombre : 'Staff GEN Yoga';
            const profesorFoto = c.profesionales && c.profesionales.foto_url ? c.profesionales.foto_url : null;
            const profesorAvatar = profesorFoto ? `<img src="${profesorFoto}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-olive/5 flex items-center justify-center text-olive text-[10px] font-bold">${profesorName.charAt(0)}</div>`;

            const row = document.createElement('div');
            row.className = 'p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-sand/10 transition duration-300 group';

            row.innerHTML = `
                        <div class="flex items-start gap-4 w-full">
                            <div class="flex flex-col items-center justify-center w-14 h-14 rounded-xl ${iconColorClass} border shadow-sm flex-shrink-0">
                                <span class="text-[9px] font-bold opacity-80 uppercase pb-0.5">${tipoTexto}</span>
                                <span class="text-base font-black tracking-tight leading-none">${hora}</span>
                            </div>
                            
                            <div class="flex-grow">
                                <div class="flex flex-col gap-1">
                                    <div class="flex flex-wrap items-center gap-3">
                                        <h4 class="brand-font font-bold text-lg text-cocoa group-hover:text-olive transition leading-tight">
                                            ${c.nombre}
                                        </h4>
                                        <div class="flex items-center gap-2 bg-sand/10 px-2.5 py-1 rounded-full border border-cocoa/10 shadow-sm order-last sm:order-none" title="${escapeHtml(profileT('common_instructor', 'Instructor'))}">
                                            <div class="w-6 h-6 rounded-full overflow-hidden border border-cocoa/10 shadow-sm flex-shrink-0">
                                                ${profesorAvatar}
                                            </div>
                                            <span class="text-xs sm:text-sm font-bold text-cocoa/70 truncate max-w-[150px]">${profesorName}</span>
                                        </div>
                                        ${adminTrash}
                                    </div>

                                    <div class="flex items-center gap-2 mt-1">
                                         <div class="flex items-center gap-1.5 text-xs text-cocoa/50 bg-ivory border border-cocoa/10 px-2 py-0.5 rounded-md shadow-sm" title="${escapeHtml(profileT('profile_capacity', 'Aforo'))}">
                                            <i class="ph-bold ph-users text-cocoa/20 text-sm"></i>
                                            <span class="font-bold text-cocoa/70">${c.ocupadas}</span>
                                            <span class="text-cocoa/30 text-[10px]">/ ${c.capacidad_max}</span>
                                        </div>
                                        ${reservada ? `<span class="text-[10px] font-bold text-olive bg-olive/10 border border-olive/20 px-2 py-0.5 rounded-md uppercase tracking-wide flex items-center gap-1"><i class="ph-fill ph-check-circle"></i> ${escapeHtml(profileT('profile_your_spot', 'Tu Plaza'))}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="flex items-center justify-end sm:min-w-[120px]">
                            ${btnAction}
                        </div>
                    `;
            grid.appendChild(row);
        });
    });
}

// --- 6. LOGICA RESERVAS ---
let isReserving = false;

async function reservar(claseId) {
    if (isReserving) return; // Evitar doble clic

    // Validación de rol: sólo los alumnos pueden reservar
    const rol = (currentUserRole || '').toLowerCase().trim();
    const esAlumno = !isAdmin && !STAFF_ROLES.includes(rol);
    if (!esAlumno) {
        return Swal.fire({
            icon: 'error',
            title: 'Acción no permitida',
            text: 'Solo los alumnos pueden realizar reservas de clases.',
            confirmButtonColor: '#D27D60'
        });
    }

    // Validación preliminar con datos en caché
    const clase = allClasesCache.find(c => c.id === claseId);
    if (!clase) return;

    // Validación de límite de tiempo para reservar (modificable por el admin, por defecto 12h)
    const isUserAdminOrStaff = isAdmin || esTrabajador();
    if (!isUserAdminOrStaff) {
        const classDate = new Date(clase.fecha_inicio);
        const now = new Date();
        const diffMs = classDate - now;
        const diffHours = diffMs / (1000 * 60 * 60);
        
        const limitReservaHours = parseInt(configuracionesApp['horas_limite_reserva'] || '12', 10);
        
        if (diffHours <= limitReservaHours) {
            return Swal.fire({
                icon: 'error',
                title: 'No se puede reservar',
                text: 'La clase está demasiado cerca y no puedes reservar.',
                confirmButtonColor: '#D27D60'
            });
        }
    }

    if (clase.miReserva) {
        return Swal.fire({
            icon: 'warning',
            title: 'Ya estás inscrito',
            text: 'Ya tienes una reserva confirmada para esta clase.',
            confirmButtonColor: '#A4A05D'
        });
    }

    if (clase.ocupadas >= clase.capacidad_max && !isAdmin) {
        return Swal.fire({
            icon: 'error',
            title: 'Clase Completa',
            text: 'Lo sentimos, esta clase ya no tiene plazas disponibles.',
            confirmButtonColor: '#5D4037'
        });
    }

    // Verificar si se usará bono mensual o individual
    let usarBonoMensual = false;
    let mensajeConfirmacion = '¿Quieres reservar esta clase?';

    if (userBonoMensualActivo && userBonoMensualInicio && userBonoMensualFin) {
        const fechaClase = new Date(clase.fecha_inicio);
        const inicioPeriodo = new Date(userBonoMensualInicio);
        const finPeriodo = new Date(userBonoMensualFin);

        if (fechaClase >= inicioPeriodo && fechaClase <= finPeriodo) {
            // Calcular limites de reservas semanales/mensuales
            // Obtener todas las reservas de bono mensual confirmadas
            const { data: reservas, error } = await client.from('reservas_yoga')
                .select('id, clases(fecha_inicio)')
                .eq('user_id', currentUser.id)
                .eq('estado', 'confirmada')
                .eq('usado_bono_mensual', true);

            if (error) {
                console.error("Error consultando límites:", error);
            } else {
                let mesCount = 0;
                let semanaCount = 0;

                // Calcular inicio de la semana de la clase (Lunes 00:00 local)
                const inicioSemanaClase = new Date(fechaClase);
                const dia = inicioSemanaClase.getDay();
                const diff = inicioSemanaClase.getDate() - dia + (dia === 0 ? -6 : 1);
                inicioSemanaClase.setDate(diff);
                inicioSemanaClase.setHours(0, 0, 0, 0);

                const finSemanaClase = new Date(inicioSemanaClase);
                finSemanaClase.setDate(finSemanaClase.getDate() + 7);

                (reservas || []).forEach(r => {
                    if (r.clases && r.clases.fecha_inicio) {
                        const dateR = new Date(r.clases.fecha_inicio);
                        if (dateR >= inicioPeriodo && dateR <= finPeriodo) {
                            mesCount++;
                        }
                        if (dateR >= inicioSemanaClase && dateR < finSemanaClase) {
                            semanaCount++;
                        }
                    }
                });

                if (semanaCount < 2 && mesCount < 8) {
                    usarBonoMensual = true;
                    mensajeConfirmacion = `¿Quieres reservar esta clase usando tu <b>Bono Mensual</b>?<br><span class="text-xs text-gray-500">(Reservas esta semana: ${semanaCount}/2, este mes: ${mesCount}/8)</span>`;
                } else if (semanaCount >= 2) {
                    mensajeConfirmacion = `Has alcanzado el límite semanal de <b>2 clases</b> de tu bono mensual para esta semana. ¿Quieres reservar usando <b>1 clase suelta</b> (15€)?`;
                } else {
                    mensajeConfirmacion = `Has agotado las <b>8 clases</b> de tu bono mensual para este periodo. ¿Quieres reservar usando <b>1 clase suelta</b> (15€)?`;
                }
            }
        }
    }

    if (!usarBonoMensual) {
        // Requiere clase suelta
        if (userBonos < 1 && !isAdmin) {
            return Swal.fire({
                icon: 'warning',
                title: 'Sin clases sueltas',
                text: 'Has alcanzado los límites de tu bono mensual (o no lo tienes activo) y no te quedan clases sueltas (15€). Adquiere clases sueltas para reservar.',
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#D27D60'
            });
        }
        if (mensajeConfirmacion === '¿Quieres reservar esta clase?') {
            mensajeConfirmacion = '¿Quieres reservar esta clase usando <b>1 clase suelta</b>?';
        }
    }

    const confirmRes = await Swal.fire({
        title: 'Confirmar Reserva',
        html: mensajeConfirmacion,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#8C8658',
        cancelButtonColor: '#9ca3af',
        confirmButtonText: 'Sí, reservar',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmRes.isConfirmed) return;

    try {
        isReserving = true;

        const btn = document.activeElement;
        if (btn && btn.tagName === 'BUTTON') {
            btn.disabled = true;
            btn.innerHTML = '<i class="ph-duotone ph-spinner animate-spin"></i>';
        }

        const { error } = await client.rpc('reservar_con_bono', {
            p_clase_id: claseId,
            p_user_id: currentUser.id
        });

        if (error) {
            Swal.fire({ icon: 'error', title: 'Error al reservar', text: error.message });
        } else {
            playYogaSound();
            Swal.fire({
                icon: 'success',
                title: '¡Clase Reservada!',
                text: 'Tu esterilla te espera. Namasté. 🙏',
                showConfirmButton: false,
                timer: 1500,
                backdrop: `rgba(0,0,0,0.4)`
            });
            
            // Envío de email en segundo plano
            enviarEmailReserva(clase, usarBonoMensual);

            await checkProfile();
            await cargarHorarios();
            if (isAdmin) await cargarAsistenciasPorClase();
        }
    } catch (e) {
        console.error("Error inesperado al reservar:", e);
        Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error inesperado.' });
    } finally {
        isReserving = false;
    }
}

async function enviarEmailReserva(clase, usarBonoMensual) {
    try {
        if (!currentUser?.id) return;
        const { data: perfil, error: errPerfil } = await client
            .from('profiles')
            .select('nombre, apellidos, email')
            .eq('id', currentUser.id)
            .single();

        if (errPerfil || !perfil) {
            console.error("Error obteniendo datos del perfil para enviar email:", errPerfil);
            return;
        }

        const nombreCompleto = `${perfil.nombre || ''} ${perfil.apellidos || ''}`.trim() || 'Alumno';
        const userEmail = perfil.email || currentUser.email || '';

        const profesorName = clase.profesionales ? clase.profesionales.nombre : 'Staff GEN Yoga';
        const fechaClase = formatDisplayLongDate(clase.fecha_inicio, true);
        const horaClase = formatDisplayTime(clase.fecha_inicio);

        const emailBody = `
            <h3>Nueva Reserva de Clase</h3>
            <p>El/la alumno/a <strong>${nombreCompleto}</strong> (${userEmail}) ha reservado una clase desde su perfil.</p>
            <ul>
                <li><strong>Clase:</strong> ${clase.nombre}</li>
                <li><strong>Instructor:</strong> ${profesorName}</li>
                <li><strong>Fecha:</strong> ${fechaClase}</li>
                <li><strong>Hora:</strong> ${horaClase}</li>
                <li><strong>Método:</strong> ${usarBonoMensual ? 'Bono Mensual' : 'Clase suelta'}</li>
            </ul>
        `;

        await client.functions.invoke('send-email', {
            body: {
                to: 'hola@genyoga.studio',
                subject: `Nueva reserva de clase: ${nombreCompleto}`,
                html: emailBody
            }
        });
    } catch (e) {
        console.error("Error inesperado en enviarEmailReserva:", e);
    }
}

async function solicitarActivacionBonoMensual() {
    if (!currentUser?.id) return;

    const res = await Swal.fire({
        title: 'Solicitar activación',
        text: 'Enviaremos una solicitud a GEN Yoga para revisar y activar tu bono mensual.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Enviar solicitud',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#E1654E'
    });

    if (!res.isConfirmed) return;

    Swal.fire({
        title: 'Enviando solicitud...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const { data: perfil, error: errPerfil } = await client
            .from('profiles')
            .select('nombre, apellidos, email')
            .eq('id', currentUser.id)
            .single();

        if (errPerfil) {
            throw errPerfil;
        }

        const nombreCompleto = `${perfil?.nombre || ''} ${perfil?.apellidos || ''}`.trim() || 'Alumno';
        const userEmail = perfil?.email || currentUser.email || '';
        const fechaSolicitud = formatDisplayDateTime(new Date());

        const emailBody = `
            <h3>Solicitud de activación de bono mensual</h3>
            <p>El/la alumno/a <strong>${escapeHtml(nombreCompleto)}</strong> ha solicitado activar su bono mensual desde su perfil.</p>
            <ul>
                <li><strong>Email:</strong> ${escapeHtml(userEmail)}</li>
                <li><strong>ID de usuario:</strong> ${escapeHtml(currentUser.id)}</li>
                <li><strong>Fecha de solicitud:</strong> ${escapeHtml(fechaSolicitud)}</li>
            </ul>
            <p>Revisar y activar manualmente desde el panel de gestión de bonos.</p>
        `;

        const { error } = await client.functions.invoke('send-email', {
            body: {
                to: 'hola@genyoga.studio',
                subject: `Solicitud bono mensual: ${nombreCompleto}`,
                html: emailBody
            }
        });

        if (error) throw error;

        Swal.fire({
            icon: 'success',
            title: 'Solicitud enviada',
            text: 'GEN Yoga revisará tu solicitud y contactará contigo.',
            confirmButtonColor: '#9B7B37'
        });
    } catch (e) {
        console.error('Error al solicitar activación de bono mensual:', e);
        Swal.fire({
            icon: 'error',
            title: 'No se pudo enviar',
            text: 'Escríbenos a hola@genyoga.studio para solicitar la activación.',
            confirmButtonColor: '#E1654E'
        });
    }
}

async function cancelar(reservaId) {
    // 1. Validar límite de tiempo para cancelar (modificable por el admin, por defecto 24h)
    let claseFechaInicio = null;
    const isUserAdminOrStaff = isAdmin || esTrabajador();
    const permitirCancelacionAdminSiempre = configuracionesApp['permitir_cancelacion_admin_siempre'] === 'true' || configuracionesApp['permitir_cancelacion_admin_siempre'] === true;

    if (!(isUserAdminOrStaff && permitirCancelacionAdminSiempre)) {
        Swal.fire({
            title: 'Verificando reserva...',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        // Consultar el clase_id de la reserva
        const { data: resYoga, error: errYoga } = await client
            .from('reservas_yoga')
            .select('clase_id')
            .eq('id', reservaId)
            .single();

        if (resYoga && resYoga.clase_id) {
            const { data: claseData } = await client
                .from('clases')
                .select('fecha_inicio')
                .eq('id', resYoga.clase_id)
                .single();
            if (claseData) {
                claseFechaInicio = claseData.fecha_inicio;
            }
        }
        Swal.close();

        if (claseFechaInicio) {
            const classDate = new Date(claseFechaInicio);
            const now = new Date();
            const diffMs = classDate - now;
            const diffHours = diffMs / (1000 * 60 * 60);

            const limitCancelHours = parseInt(configuracionesApp['horas_limite_cancelacion'] || '24', 10);

            if (diffHours <= limitCancelHours) {
                return Swal.fire({
                    icon: 'error',
                    title: 'No se puede cancelar',
                    text: `ya no se puede cancelar debido a que la clase es en menos de ${limitCancelHours} horas.`,
                    confirmButtonColor: '#D27D60'
                });
            }
        }
    }

    const res = await Swal.fire({
        title: '¿Cancelar reserva?',
        text: "Se te devolverá el bono a tu cuenta.",
        icon: 'warning',
        iconColor: '#D27D60',
        showCancelButton: true,
        confirmButtonColor: '#8C8658',
        cancelButtonColor: '#9ca3af',
        confirmButtonText: 'Sí, cancelar'
    });

    if (res.isConfirmed) {
        const { error } = await client.rpc('cancelar_con_bono', { p_reserva_id: reservaId });
        if (error) Swal.fire('Error', error.message, 'error');
        else {
            const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
            Toast.fire({ icon: 'info', title: 'Reserva cancelada. Clase devuelta.' });
            await checkProfile();
            await cargarHorarios();
            if (isAdmin) await cargarAsistenciasPorClase();
        }
    }
}

// --- 7. GESTIÓN ADMIN ---
async function switchTab(tabName) {
    if (!isAdmin) return;
    window.scrollTo(0, 0);

    localStorage.setItem('activeAdminTab', tabName);

    const tabs = {
        'crear': { tab: 'tab-crear', view: 'view-horarios' },
        'gestion-alumnos': { tab: 'tab-gestion-alumnos', view: 'view-asistencias' },
        'admin-profesores': { tab: 'tab-admin-profesores', view: 'view-admin-profesores' },
        'usuarios': { tab: 'tab-usuarios', view: 'view-usuarios' },
        'configuracion': { tab: 'tab-configuracion', view: 'view-configuracion' }
    };

    // Hide all views and deactivate all tabs
    Object.values(tabs).forEach(item => {
        const tEl = document.getElementById(item.tab);
        const vEl = document.getElementById(item.view);
        if (vEl) vEl.classList.add('hidden');
        if (tEl) {
            tEl.classList.add('border-transparent', 'text-sand/70');
            tEl.classList.remove('border-sand', 'bg-cocoa/80', 'text-white');
        }
    });
    // Vistas legacy y nuevas que ahora se muestran dentro de "Crear"
    ['view-admin-psicologia', 'view-admin-nutricion', 'view-admin-consultas', 'view-admin-talleres'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    // Activate the selected tab/view
    const active = tabs[tabName];
    if (active) {
        const tEl = document.getElementById(active.tab);
        const vEl = document.getElementById(active.view);
        if (vEl && tabName !== 'crear') vEl.classList.remove('hidden');
        if (tEl) {
            tEl.classList.remove('border-transparent', 'text-sand/70');
            tEl.classList.add('border-sand', 'bg-cocoa/80', 'text-white');
        }
    }

    const adminCrearTabsEl = document.getElementById('admin-crear-tabs');
    if (tabName === 'crear') {
        if (adminCrearTabsEl) adminCrearTabsEl.classList.remove('hidden');
        const savedSubTab = localStorage.getItem('activeAdminCrearSubTab') || 'clases';
        await switchAdminCrearTab(savedSubTab);
    } else {
        if (adminCrearTabsEl) adminCrearTabsEl.classList.add('hidden');
    }

    // Load data based on active tab
    if (tabName === 'gestion-alumnos') {
        await cargarAsistenciasPorClase();
    } else if (tabName === 'usuarios') {
        await cargarUsuariosAdmin();
        await cargarGruposProfesionalesAdmin();
    } else if (tabName === 'configuracion') {
        await cargarConfiguracion();
    } else if (tabName === 'admin-profesores') {
        await cargarProfesoresAdmin();
    }
}

async function switchAdminCrearTab(type) {
    window.scrollTo(0, 0);
    localStorage.setItem('activeAdminCrearSubTab', type);
    const subtabs = {
        'clases': { btn: 'btn-admin-tab-clases', view: 'view-horarios' },
        'consultas': { btn: 'btn-admin-tab-consultas', view: 'view-admin-consultas' },
        'talleres': { btn: 'btn-admin-tab-talleres', view: 'view-admin-talleres' }
    };

    // Hide all sub-views and deactivate buttons
    Object.keys(subtabs).forEach(key => {
        const item = subtabs[key];
        const btnEl = document.getElementById(item.btn);
        const viewEl = document.getElementById(item.view);
        if (viewEl) viewEl.classList.add('hidden');
        if (btnEl) btnEl.classList.remove('active');
    });

    // Activate the current sub-tab
    const active = subtabs[type];
    if (active) {
        const btnEl = document.getElementById(active.btn);
        const viewEl = document.getElementById(active.view);
        if (viewEl) viewEl.classList.remove('hidden');
        if (btnEl) btnEl.classList.add('active');
    }

    // Load sub-tab specific data
    if (type === 'clases') {
        await cargarHorarios();
    } else if (type === 'consultas') {
        await cargarConsultasAdmin();
    } else if (type === 'talleres') {
        await cargarTalleresAdmin();
    }
}

function normalizarTipoClase(tipo) {
    return (tipo || 'yoga').toLowerCase();
}

function getTipoClaseMeta(tipo) {
    const tipoNormalizado = normalizarTipoClase(tipo);
    const meta = {
        yoga: { label: 'Clases', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-100', dotClass: 'yoga', icon: 'ph-person-simple-tai-chi' },
        psicologia: { label: 'Psicología', colorClass: 'bg-blue-50 text-[#3B82F6] border-blue-100', dotClass: 'psicologia', icon: 'ph-brain' },
        nutricion: { label: 'Nutrición', colorClass: 'bg-purple-50 text-[#8B5CF6] border-purple-100', dotClass: 'nutricion', icon: 'ph-apple' },
        taller: { label: 'Taller', colorClass: 'bg-orange-50 text-[#F97316] border-orange-100', dotClass: 'taller', icon: 'ph-chalkboard-teacher' }
    };
    return meta[tipoNormalizado] || meta.yoga;
}

function esClaseDelProfesionalActual(clase) {
    if (!esTrabajador() || !currentUser?.email) return true;
    return (clase?.profesionales?.email || '').toLowerCase() === currentUser.email.toLowerCase();
}

function claseEsFutura(clase) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const fecha = new Date(clase.fecha_inicio);
    fecha.setHours(0, 0, 0, 0);
    return fecha >= hoy;
}

function crearMapaReservasPorClase(...reservasGrupos) {
    const reservasPorClase = {};
    reservasGrupos.flat().forEach(r => {
        if (!r || r.estado !== 'confirmada') return;
        if (!reservasPorClase[r.clase_id]) reservasPorClase[r.clase_id] = [];
        reservasPorClase[r.clase_id].push(r);
    });
    return reservasPorClase;
}

async function cargarReservasTodasLasAreas(claseIds = []) {
    if (!claseIds.length) {
        return { reservasPorClase: {}, error: null };
    }

    const [
        { data: reservasYoga, error: errYoga },
        { data: reservasPsicologia, error: errPsicologia },
        { data: reservasNutricion, error: errNutricion }
    ] = await Promise.all([
        client.from('reservas_yoga').select('*').in('clase_id', claseIds),
        client.from('reservas_psicologia').select('*').in('clase_id', claseIds),
        client.from('reservas_nutricion').select('*').in('clase_id', claseIds)
    ]);

    const error = errYoga || errPsicologia || errNutricion;
    return {
        reservasPorClase: crearMapaReservasPorClase(reservasYoga || [], reservasPsicologia || [], reservasNutricion || []),
        error
    };
}

async function cargarAsistenciasPorClase() {
    const cont = document.getElementById('asistencias-container');
    const empty = document.getElementById('asistencias-empty');
    const filtro = document.getElementById('asistencias-filtro-clase');
    if (!cont || !empty) return;

    cont.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
                    <i class="ph-duotone ph-spinner animate-spin text-4xl text-olive"></i>
                    <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Cargando asistencias...</span>
                </div>`;

    const { data: clases, error: errClases } = await client.from('clases').select('*, profesionales(*)').order('fecha_inicio');
    if (errClases) {
        console.error(errClases);
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    const { data: perfiles, error: errPerfiles } = await client.from('profiles').select('id, nombre, apellidos, fecha_nacimiento, email');
    if (errPerfiles) {
        console.error(errPerfiles);
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let clasesFuturas = (clases || []).filter(c => claseEsFutura(c));

    if (!isAdmin && esTrabajador()) {
        clasesFuturas = clasesFuturas.filter(esClaseDelProfesionalActual);
    }

    if (!clasesFuturas || clasesFuturas.length === 0) {
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        if (filtro) {
            filtro.innerHTML = '<option value="todas">Sin clases disponibles</option>';
            filtro.disabled = true;
        }
        return;
    }

    const perfilesMap = {};
    (perfiles || []).forEach(p => { perfilesMap[p.id] = p; });

    const claseIds = clasesFuturas.map(c => c.id);
    const { reservasPorClase, error: errRes } = await cargarReservasTodasLasAreas(claseIds);
    if (errRes) {
        console.error(errRes);
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    allAsistenciasClaseCache = clasesFuturas;
    allAsistenciasReservasMap = reservasPorClase;
    allAsistenciasPerfilesMap = perfilesMap;

    if (filtro) {
        filtro.disabled = false;
        filtro.innerHTML = `<option value="todas">${isAdmin ? 'Todas' : 'Todas mis sesiones'}</option>`;
        clasesFuturas.forEach(c => {
            const option = document.createElement('option');
            const fecha = new Date(c.fecha_inicio);
            const tipoMeta = getTipoClaseMeta(c.tipo_clase);
            option.value = String(c.id);
            option.textContent = `${formatDisplayShortDate(fecha)} · ${formatDisplayTime(fecha)} · ${tipoMeta.label} · ${c.nombre || profileT('common_class', 'Clase')}`;
            filtro.appendChild(option);
        });

        if (selectedAsistenciaClaseId !== 'todas' && !clasesFuturas.some(c => String(c.id) === String(selectedAsistenciaClaseId))) {
            selectedAsistenciaClaseId = 'todas';
        }
        filtro.value = selectedAsistenciaClaseId;
    }

    renderizarAsistenciasPorClase();
}

function filtrarAsistenciaClase(claseId) {
    selectedAsistenciaClaseId = claseId || 'todas';
    renderizarAsistenciasPorClase();
}

function renderizarAsistenciasPorClase() {
    const cont = document.getElementById('asistencias-container');
    const empty = document.getElementById('asistencias-empty');
    if (!cont || !empty) return;

    let clasesFuturas = allAsistenciasClaseCache || [];
    if (selectedAsistenciaClaseId !== 'todas') {
        clasesFuturas = clasesFuturas.filter(c => String(c.id) === String(selectedAsistenciaClaseId));
    }

    if (clasesFuturas.length === 0) {
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    cont.innerHTML = '';

    const grupos = {};
    clasesFuturas.forEach(c => {
        const dateKey = formatDateLocal(new Date(c.fecha_inicio));
        if (!grupos[dateKey]) grupos[dateKey] = [];
        grupos[dateKey].push(c);
    });

    Object.keys(grupos).sort().forEach(dateKey => {
        const dateObj = new Date(dateKey);
        const diaNombre = formatDisplayWeekday(dateObj);
        const diaNumero = dateObj.getDate();
        const mes = formatDisplayMonth(dateObj);

        const card = document.createElement('div');
        card.className = 'bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden';

        card.innerHTML = `
                    <div class="bg-gradient-to-r from-gray-100 to-white px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                        <div class="flex items-baseline gap-2">
                            <span class="brand-font text-xl font-bold text-gray-800 capitalize">${diaNombre}</span>
                            <span class="text-xs font-semibold text-gold-600 bg-gold-50 px-2 py-0.5 rounded-md border border-gold-100">${diaNumero} ${mes}</span>
                        </div>
                    </div>
                    <div class="divide-y divide-y-2 divide-gray-500" id="asistencias-grid-${dateKey}"></div>
                `;

        cont.appendChild(card);

        const grid = card.querySelector(`#asistencias-grid-${dateKey}`);

        grupos[dateKey].forEach(c => {
            const hora = formatDisplayTime(c.fecha_inicio);
            const p = c.profesionales;
            const profesorName = p ? p.nombre : 'Staff GEN';
            const profesorFoto = p && p.foto_url ? p.foto_url : null;
            const profesorAvatar = profesorFoto
                ? `<img src="${profesorFoto}" class="w-full h-full object-cover">`
                : `<div class="w-full h-full bg-q19-100 flex items-center justify-center text-q19-600 text-[10px] font-bold">${profesorName.charAt(0)}</div>`;

            let profHTML = '';
            if (p) {
                profHTML = `
                        <div class="flex items-center gap-2 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-200 shadow-sm ml-2" title="Instructor">
                            <div class="w-6 h-6 rounded-full overflow-hidden border border-gray-200 shadow-sm flex-shrink-0">
                                ${profesorAvatar}
                            </div>
                            <span class="text-xs sm:text-sm font-bold text-gray-700 truncate max-w-[150px]">${profesorName}</span>
                        </div>`;
            }
            const listadoReservas = allAsistenciasReservasMap[c.id] || [];
            const totalReservas = listadoReservas.length;
            const tipoMeta = getTipoClaseMeta(c.tipo_clase);
            const capacidadMax = toSafeNumber(c.capacidad_max) || 1;
            const tipoNormalizado = normalizarTipoClase(c.tipo_clase);

            const fila = document.createElement('div');
            fila.className = 'p-5 flex flex-col gap-4';

            let alumnosHTML = '';

            if (totalReservas === 0) {
                alumnosHTML = `
                            <div class="px-4 py-3 bg-gray-50 border border-dashed border-gray-200 rounded-xl text-sm text-gray-400 flex items-center gap-2">
                                <i class="ph-duotone ph-user-circle text-xl"></i>
                                <span>Sin alumnos apuntados todavía.</span>
                            </div>`;
            } else {
                alumnosHTML = `
                            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
                                ${listadoReservas.map(r => {
                    const perfil = allAsistenciasPerfilesMap[r.user_id] || {};
                    const nombre = perfil.nombre || '';
                    const apellidos = perfil.apellidos || '';
                    const email = perfil.email || 'Sin email';
                    const displayEmail = email.length > 20 ? email.substring(0, 18) + '...' : email;
                    const iniciales = (nombre ? nombre[0] : (email[0] || '?')).toUpperCase();
                    const cancelBtn = (isAdmin || esTrabajador())
                        ? `<button onclick="cancelar(${r.id})" class="text-gray-300 hover:text-red-500 transition ml-auto relative z-20 p-1 flex-shrink-0" title="Quitar Alumno"><i class="ph-bold ph-trash text-base"></i></button>`
                        : '';

                    return `
                                    <div class="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md hover:border-gold-300 transition group relative overflow-hidden">
                                        <div class="w-10 h-10 rounded-full flex items-center justify-center bg-gray-50 text-gray-500 font-bold text-sm border border-gray-200 shadow-sm group-hover:scale-105 transition relative z-10 flex-shrink-0">
                                            ${iniciales}
                                        </div>
                                        <div class="flex flex-col z-10 flex-grow min-w-0 overflow-hidden">
                                            <span class="text-sm font-bold text-gray-900 truncate" title="${nombre} ${apellidos}">${nombre} ${apellidos}</span>
                                            <span class="text-[10px] text-gray-400 truncate" title="${email}">${displayEmail}</span>
                                        </div>
                                        ${cancelBtn}
                                    </div>`;
                }).join('')}
                            </div>`;
            }

            const asignarBtn = (isAdmin || esTrabajador()) && totalReservas < capacidadMax
                ? `
                    <div class="mt-3 flex justify-end">
                        <button onclick="abrirModalAsignarPlazaAdmin('${tipoNormalizado}', ${c.id})"
                            class="inline-flex items-center gap-2 bg-cocoa text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-black transition">
                            <i class="ph-bold ph-user-plus"></i> Asignar usuario
                        </button>
                    </div>`
                : '';

            fila.innerHTML = `
                        <div class="flex flex-col gap-4">
                            <div class="flex items-start sm:items-center gap-4">
                                <div class="flex flex-col items-center justify-center bg-gray-900 text-white w-14 h-14 rounded-2xl shadow-md border border-gray-800 shrink-0 z-10 relative overflow-hidden group">
                                    <div class="absolute inset-0 bg-gold-500/10 opacity-0 group-hover:opacity-100 transition"></div>
                                    <i class="ph-bold ${tipoMeta.icon} text-gold-400 text-base"></i>
                                    <span class="text-xs font-bold font-mono mt-0.5 tracking-wide">${hora}</span>
                                </div>
                                
                                <div class="flex-grow pt-1 sm:pt-0">
                                    <h4 class="brand-font text-lg font-bold text-gray-900 leading-tight flex items-center flex-wrap gap-1">
                                        ${c.nombre}
                                        ${profHTML}
                                    </h4>
                                    <div class="flex flex-wrap items-center gap-2 mt-1.5">
                                         <span class="flex items-center gap-1.5 text-xs font-semibold border px-2.5 py-1 rounded-lg shadow-sm ${tipoMeta.colorClass}">
                                            ${tipoMeta.label}
                                         </span>
                                         <span class="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 px-2.5 py-1 rounded-lg shadow-sm">
                                            <i class="ph-bold ph-users text-gray-400"></i> ${totalReservas} / ${capacidadMax}
                                         </span>
                                         ${totalReservas >= capacidadMax ? '<span class="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded-lg uppercase tracking-wide flex items-center gap-1"><i class="ph-bold ph-warning-circle"></i> Completa</span>' : ''}
                                    </div>
                                </div>
                            </div>
                            <div class="pl-0 sm:pl-[4.5rem]">
                                ${alumnosHTML}
                                ${asignarBtn}
                            </div>
                        </div>
                    `;
            grid.appendChild(fila);
        });
    });
}

async function cargarAgendaProfesor() {
    const container = document.getElementById('profesor-agenda-container');
    const empty = document.getElementById('profesor-agenda-empty');
    if (!container || !empty) return;

    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
            <i class="ph-duotone ph-spinner animate-spin text-4xl text-olive"></i>
            <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Cargando tu calendario...</span>
        </div>`;

    const { data: clases, error } = await client.from('clases')
        .select('*, profesionales(*)')
        .order('fecha_inicio');

    if (error) {
        console.error(error);
        container.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    let clasesProfesor = (clases || [])
        .filter(claseEsFutura)
        .filter(esClaseDelProfesionalActual);

    const claseIds = clasesProfesor.map(c => c.id);
    const { reservasPorClase, error: reservasError } = await cargarReservasTodasLasAreas(claseIds);
    if (reservasError) console.error(reservasError);

    clasesProfesor = clasesProfesor.map(c => ({
        ...c,
        reservasCount: (reservasPorClase[c.id] || []).length
    }));

    allProfesorAgendaCache = clasesProfesor;
    renderizarCalendarioProfesor();
    renderizarAgendaProfesor();
    cargarMiGrupoProfesor();
}

async function cargarMiGrupoProfesor() {
    const container = document.getElementById('profesor-mi-grupo-container');
    if (!container) return;

    container.innerHTML = `
        <div class="flex items-center justify-center py-6 gap-2 opacity-50">
            <i class="ph-duotone ph-spinner animate-spin text-lg text-olive"></i>
            <span class="text-[10px] uppercase tracking-wider font-bold text-gray-500">Cargando alumnos...</span>
        </div>`;

    try {
        if (!currentUser || !currentUser.email) {
            container.innerHTML = '<p class="text-xs text-cocoa/40 italic py-2 text-center">No se pudo identificar tu cuenta.</p>';
            return;
        }

        const { data: prof, error: errProf } = await client
            .from('profesionales')
            .select('id')
            .eq('email', currentUser.email)
            .single();

        if (errProf || !prof) {
            container.innerHTML = '<p class="text-xs text-cocoa/40 italic py-2 text-center">No tienes ficha de profesional asociada en el sistema.</p>';
            return;
        }

        const { data: groupMembers, error: errGroup } = await client
            .from('grupos_profesionales')
            .select('alumno_id')
            .eq('profesional_id', prof.id);

        if (errGroup) {
            console.error('Error al cargar alumnos del grupo:', errGroup);
            container.innerHTML = '<p class="text-xs text-red-500 italic py-2 text-center">Error al cargar alumnos.</p>';
            return;
        }

        if (!groupMembers || groupMembers.length === 0) {
            container.innerHTML = '<p class="text-xs text-cocoa/40 italic py-4 text-center">Sin alumnos asignados.</p>';
            return;
        }

        const studentIds = groupMembers.map(m => m.alumno_id);

        let clientes = allUsersCache;
        if (!clientes || clientes.length === 0) {
            const { data: users, error: errUsers } = await client.from('profiles').select('*').order('email');
            if (!errUsers && users) {
                allUsersCache = users;
                clientes = users;
            }
        }

        const alumnosGrupo = (clientes || []).filter(c => studentIds.includes(c.id));

        if (alumnosGrupo.length === 0) {
            container.innerHTML = '<p class="text-xs text-cocoa/40 italic py-4 text-center">Sin alumnos asignados.</p>';
            return;
        }

        container.innerHTML = alumnosGrupo.map(al => {
            const nombreCompleto = getNombreCompletoPerfil(al, 'Alumno');
            const identificador = getIdentificadorPerfil(al);
            return `
                <div class="flex items-center justify-between bg-sand/5 border border-cocoa/5 rounded-xl px-3 py-1.5 shadow-sm text-xs">
                    <div class="flex flex-col min-w-0">
                        <span class="font-semibold text-cocoa truncate" title="${escapeHtml(nombreCompleto)}">${escapeHtml(nombreCompleto)}</span>
                        <span class="text-[9px] text-cocoa/40 truncate">${escapeHtml(identificador)}</span>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error('Error cargando grupo de alumnos:', e);
        container.innerHTML = '<p class="text-xs text-red-500 italic py-2 text-center">Error al cargar alumnos.</p>';
    }
}

function renderizarCalendarioProfesor() {
    const year = currentCalendarMonthProfesor.getFullYear();
    const month = currentCalendarMonthProfesor.getMonth();
    const monthNames = [
        window.t('month_0'), window.t('month_1'), window.t('month_2'), window.t('month_3'),
        window.t('month_4'), window.t('month_5'), window.t('month_6'), window.t('month_7'),
        window.t('month_8'), window.t('month_9'), window.t('month_10'), window.t('month_11')
    ];

    const label = document.getElementById('profesor-calendar-month-year');
    if (label) label.textContent = `${monthNames[month]} ${year}`;

    const grid = document.getElementById('profesor-calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateKey = formatDateLocal(dateObj);
        const sesionesDia = allProfesorAgendaCache.filter(c => formatDateLocal(new Date(c.fecha_inicio)) === dateKey);
        const isToday = dateObj.getTime() === today.getTime();
        const isSelected = selectedDateProfesor === dateKey;

        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 relative';
        div.textContent = day;
        if (isToday) div.classList.add('today');
        if (isSelected) div.classList.add('selected');

        if (sesionesDia.length > 0) {
            const dotsContainer = document.createElement('div');
            dotsContainer.className = 'calendar-dots';
            const tipos = [...new Set(sesionesDia.map(c => normalizarTipoClase(c.tipo_clase)))];
            tipos.forEach(tipo => {
                const dot = document.createElement('div');
                dot.className = `calendar-dot ${getTipoClaseMeta(tipo).dotClass}`;
                dotsContainer.appendChild(dot);
            });
            div.appendChild(dotsContainer);
        }

        div.onclick = () => {
            selectedDateProfesor = dateKey;
            renderizarCalendarioProfesor();
            renderizarAgendaProfesor();
        };
        grid.appendChild(div);
    }

    const totalCells = grid.children.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }
}

function renderizarAgendaProfesor() {
    const container = document.getElementById('profesor-agenda-container');
    const empty = document.getElementById('profesor-agenda-empty');
    if (!container || !empty) return;

    let clases = allProfesorAgendaCache || [];
    if (selectedDateProfesor) {
        clases = clases.filter(c => formatDateLocal(new Date(c.fecha_inicio)) === selectedDateProfesor);
    }

    if (clases.length === 0) {
        container.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    container.innerHTML = '';

    const grupos = {};
    clases.forEach(c => {
        const dateKey = formatDateLocal(new Date(c.fecha_inicio));
        if (!grupos[dateKey]) grupos[dateKey] = [];
        grupos[dateKey].push(c);
    });

    Object.keys(grupos).sort().forEach(dateKey => {
        const dateObj = new Date(dateKey);
        const diaNombre = formatDisplayWeekday(dateObj);
        const diaNumero = dateObj.getDate();
        const mes = formatDisplayMonth(dateObj);
        const section = document.createElement('div');
        section.className = 'bg-white/90 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg overflow-hidden';
        section.innerHTML = `
            <div class="bg-gradient-to-r from-olive/10 to-white px-6 py-4 border-b border-cocoa/5 flex items-center justify-between">
                <div class="flex items-baseline gap-2">
                    <span class="brand-font text-xl font-bold text-cocoa capitalize">${diaNombre}</span>
                    <span class="text-xs font-semibold text-olive bg-olive/10 px-2 py-0.5 rounded-md border border-olive/20">${diaNumero} ${mes}</span>
                </div>
            </div>
            <div id="profesor-agenda-grid-${dateKey}" class="divide-y divide-cocoa/5"></div>
        `;
        container.appendChild(section);

        const grid = section.querySelector(`#profesor-agenda-grid-${dateKey}`);
        grupos[dateKey].forEach(c => {
            const inicio = new Date(c.fecha_inicio);
            const fin = c.fecha_fin ? new Date(c.fecha_fin) : null;
            const hora = formatDisplayTime(inicio);
            const horaFin = fin ? formatDisplayTime(fin) : null;
            const tipoMeta = getTipoClaseMeta(c.tipo_clase);
            const ocupadas = toSafeNumber(c.reservasCount);

            const row = document.createElement('div');
            row.className = 'p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-sand/5 transition';
            row.innerHTML = `
                <div class="flex items-start gap-4">
                    <div class="flex flex-col items-center justify-center w-16 h-16 rounded-xl bg-cocoa text-white border border-cocoa shadow-sm flex-shrink-0">
                        <i class="ph-bold ${tipoMeta.icon} text-sand text-base"></i>
                        <span class="text-xs font-bold font-mono mt-1">${hora}</span>
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2 mb-2">
                            <span class="text-xs font-bold border px-2.5 py-1 rounded-lg ${tipoMeta.colorClass}">${tipoMeta.label}</span>
                            <span class="text-xs font-bold text-cocoa/50 bg-sand/20 px-2.5 py-1 rounded-lg">${ocupadas} / ${c.capacidad_max || 1} alumnos</span>
                        </div>
                        <h3 class="brand-font text-xl font-bold text-cocoa">${c.nombre || 'Clase'}</h3>
                        <p class="text-sm text-cocoa/50 mt-1">${horaFin ? `${hora} - ${horaFin}` : hora}${c.descripcion ? ` · ${c.descripcion}` : ''}</p>
                    </div>
                </div>
                <button onclick="abrirAlumnosClase(${c.id})"
                    class="inline-flex items-center justify-center gap-2 bg-cocoa hover:bg-black text-white px-4 py-2.5 rounded-xl text-xs font-bold shadow-sm transition">
                    <i class="ph-bold ph-users-three"></i> Ver alumnos
                </button>
            `;
            grid.appendChild(row);
        });
    });
}

function cambiarMesProfesor(delta) {
    currentCalendarMonthProfesor.setMonth(currentCalendarMonthProfesor.getMonth() + delta);
    renderizarCalendarioProfesor();
}

function limpiarFiltroFechaProfesor() {
    selectedDateProfesor = null;
    renderizarCalendarioProfesor();
    renderizarAgendaProfesor();
}

function abrirAlumnosClase(claseId) {
    selectedAsistenciaClaseId = String(claseId);
    switchPublicView('mis-clases');
}

// --- LOGICA GRUPOS DE ALUMNOS POR PROFESIONAL ---
async function cargarGruposProfesionalesAdmin() {
    const container = document.getElementById('grupos-profesionales-container');
    if (!container) return;

    container.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-12 gap-3 opacity-50">
            <i class="ph-duotone ph-spinner animate-spin text-3xl text-olive"></i>
            <span class="text-xs uppercase tracking-widest font-bold text-gray-500">Cargando grupos...</span>
        </div>`;

    // 1. Obtener profesionales
    const { data: profesores, error: errProf } = await client
        .from('profesionales')
        .select('*')
        .order('nombre');

    if (errProf) {
        console.error('Error al cargar profesionales para grupos', errProf);
        container.innerHTML = '<div class="col-span-full text-center text-red-500 text-sm">Error al cargar profesionales</div>';
        return;
    }

    if (!profesores || profesores.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-400 text-sm italic py-8">Crea profesionales primero en la pestaña correspondiente para gestionar sus grupos.</div>';
        return;
    }

    // 2. Obtener la lista de usuarios (clientes)
    let clientes = allUsersCache;
    if (!clientes || clientes.length === 0) {
        const { data: users, error: errUsers } = await client.from('profiles').select('*').order('email');
        if (!errUsers && users) {
            allUsersCache = users;
            clientes = users;
        }
    }
    clientes = (clientes || []).filter(esClienteAsignable);

    // 3. Obtener relaciones de grupos_profesionales
    const { data: grupos, error: errGrupos } = await client
        .from('grupos_profesionales')
        .select('*');

    if (errGrupos) {
        console.error('Error al cargar relaciones de grupos', errGrupos);
        container.innerHTML = '<div class="col-span-full text-center text-red-500 text-sm">Error al cargar relaciones de grupos</div>';
        return;
    }

    // Agrupar relaciones por profesional_id
    const gruposMap = {};
    (grupos || []).forEach(g => {
        if (!gruposMap[g.profesional_id]) gruposMap[g.profesional_id] = [];
        gruposMap[g.profesional_id].push(g.alumno_id);
    });

    container.innerHTML = '';

    // Renderizar tarjetas por profesional
    profesores.forEach(p => {
        const initials = p.nombre
            ? p.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
            : '??';

        const alumnIds = gruposMap[p.id] || [];
        const alumnosGrupo = clientes.filter(c => alumnIds.includes(c.id));
        const candidatos = clientes.filter(c => !alumnIds.includes(c.id));

        let alumnosHtml = '';
        if (alumnosGrupo.length === 0) {
            alumnosHtml = `<p class="text-xs text-cocoa/40 italic py-4 text-center">Sin alumnos asignados.</p>`;
        } else {
            alumnosHtml = `<div class="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                ${alumnosGrupo.map(al => {
                    const nombreCompleto = getNombreCompletoPerfil(al, 'Alumno');
                    const identificador = getIdentificadorPerfil(al);
                    return `
                        <div class="flex items-center justify-between bg-sand/5 border border-cocoa/5 rounded-xl px-3 py-1.5 shadow-sm text-xs group/item">
                            <div class="flex flex-col min-w-0">
                                <span class="font-semibold text-cocoa truncate" title="${escapeHtml(nombreCompleto)}">${escapeHtml(nombreCompleto)}</span>
                                <span class="text-[9px] text-cocoa/40 truncate">${escapeHtml(identificador)}</span>
                            </div>
                            <button onclick="eliminarAlumnoDeGrupo(${p.id}, '${al.id}')"
                                class="w-6 h-6 rounded-lg text-cocoa/30 hover:text-red-500 hover:bg-red-50 transition flex items-center justify-center"
                                title="Quitar del grupo">
                                <i class="ph-bold ph-x text-sm"></i>
                            </button>
                        </div>
                    `;
                }).join('')}
            </div>`;
        }

        const optionsHtml = candidatos.map(cand => {
            const nombreCompleto = getNombreCompletoPerfil(cand, 'Alumno');
            return `<option value="${cand.id}">${escapeHtml(nombreCompleto)} (${escapeHtml(getIdentificadorPerfil(cand))})</option>`;
        }).join('');

        const card = document.createElement('div');
        card.className = 'flex flex-col bg-white border border-cocoa/10 rounded-2xl p-4 shadow-sm hover:shadow-md transition';
        card.innerHTML = `
            <div class="flex items-center gap-3 mb-3 border-b border-cocoa/5 pb-2">
                <div class="w-8 h-8 rounded-full overflow-hidden bg-olive/10 border border-olive/20 flex items-center justify-center text-olive font-bold text-sm">
                    ${initials}
                </div>
                <div class="min-w-0 flex-grow">
                    <h4 class="font-bold text-cocoa text-sm leading-tight truncate" title="${p.nombre}">${p.nombre}</h4>
                    <p class="text-[10px] text-cocoa/50 font-medium uppercase tracking-wider truncate">${getEspecialidadTexto(p.especialidad) || 'INSTRUCTOR'}</p>
                </div>
            </div>
            
            <div class="flex-grow mb-3">
                ${alumnosHtml}
            </div>
            
            <div class="flex gap-2 mt-auto pt-2 border-t border-cocoa/5">
                <select id="select-add-grupo-${p.id}" class="flex-grow px-2 py-1.5 bg-white border border-cocoa/10 rounded-xl text-xs outline-none focus:ring-1 focus:ring-olive text-cocoa min-w-0">
                    <option value="" disabled selected>Añadir alumno...</option>
                    ${optionsHtml}
                </select>
                <button onclick="agregarAlumnoAGrupo(${p.id})" class="px-3 py-1.5 bg-olive text-white rounded-xl text-xs font-bold hover:bg-olive/90 transition flex items-center justify-center shadow-sm shrink-0">
                    <i class="ph-bold ph-plus"></i>
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

async function agregarAlumnoAGrupo(profesionalId) {
    const select = document.getElementById(`select-add-grupo-${profesionalId}`);
    if (!select || !select.value) return;

    const alumnoId = select.value;
    Swal.fire({ title: 'Añadiendo...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

    const { error } = await client
        .from('grupos_profesionales')
        .insert([{ profesional_id: profesionalId, alumno_id: alumnoId }]);

    Swal.close();

    if (error) {
        Swal.fire('Error', 'No se pudo añadir al alumno: ' + error.message, 'error');
    } else {
        const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1200 });
        Toast.fire({ icon: 'success', title: 'Alumno añadido al grupo' });
        await cargarGruposProfesionalesAdmin();
    }
}

async function eliminarAlumnoDeGrupo(profesionalId, alumnoId) {
    const res = await Swal.fire({
        title: '¿Quitar del grupo?',
        text: 'Se eliminará la asociación del alumno con este profesional.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, quitar',
        cancelButtonText: 'Cancelar'
    });

    if (res.isConfirmed) {
        Swal.fire({ title: 'Eliminando...', didOpen: () => Swal.showLoading(), allowOutsideClick: false });

        const { error } = await client
            .from('grupos_profesionales')
            .delete()
            .eq('profesional_id', profesionalId)
            .eq('alumno_id', alumnoId);

        Swal.close();

        if (error) {
            Swal.fire('Error', 'No se pudo eliminar: ' + error.message, 'error');
        } else {
            const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1200 });
            Toast.fire({ icon: 'success', title: 'Alumno eliminado del grupo' });
            await cargarGruposProfesionalesAdmin();
        }
    }
}

async function cargarUsuariosAdmin() {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-gray-400 italic"><i class="ph-duotone ph-spinner animate-spin"></i> Cargando...</td></tr>';

    const staffBody = document.getElementById('staff-table-body');
    if (staffBody) staffBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic"><i class="ph-duotone ph-spinner animate-spin"></i> Cargando...</td></tr>';

    const { data: users, error } = await client.from('profiles').select('*').order('email');

    if (error) return Swal.fire('Error Admin', 'Fallo al cargar usuarios.', 'error');

    allUsersCache = users;

    const clients = users.filter(u => !['admin', ...STAFF_ROLES].includes((u.rol || '').toLowerCase().trim()));
    const staff = users.filter(u => ['admin', ...STAFF_ROLES].includes((u.rol || '').toLowerCase().trim()));

    renderUsersTable(clients);
    renderStaffTable(staff);
}

async function insertarPerfilMostradorDirecto(payload) {
    const perfilCompleto = {
        id: payload.id,
        email: payload.email,
        nombre: payload.nombre,
        apellidos: payload.apellidos,
        rol: 'cliente',
        bonos: payload.bonos,
        saldo_psicologia: 0,
        saldo_nutricion: 0,
        bono_mensual_activo: false,
        bono_mensual_inicio: null,
        bono_mensual_fin: null
    };

    let result = await client.from('profiles').insert(perfilCompleto).select().single();
    if (result.error && /saldo_psicologia|saldo_nutricion|bono_mensual/i.test(result.error.message || '')) {
        const perfilBasico = {
            id: payload.id,
            email: payload.email,
            nombre: payload.nombre,
            apellidos: payload.apellidos,
            rol: 'cliente',
            bonos: payload.bonos
        };
        result = await client.from('profiles').insert(perfilBasico).select().single();
    }

    return result;
}

async function crearPerfilMostradorEnServidor(payload) {
    return client.functions.invoke('create-kiosk-user', {
        body: {
            nombre: payload.nombre,
            apellidos: payload.apellidos,
            email: payload.email,
            bonos: payload.bonos
        }
    });
}

async function abrirCrearClienteMostrador() {
    if (!isAdmin) return;

    const { value: formValues } = await Swal.fire({
        title: 'Crear cliente de mostrador',
        html: `
            <div class="space-y-4 text-left">
                <p class="text-xs text-gray-500 leading-relaxed">
                    Crea un perfil interno para personas que reservan y pagan desde el mostrador. No tendrá contraseña ni acceso online.
                </p>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Nombre</label>
                    <input id="swal-kiosk-nombre" class="w-full px-3 py-2 border rounded-lg outline-none" placeholder="Nombre">
                </div>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Apellidos</label>
                    <input id="swal-kiosk-apellidos" class="w-full px-3 py-2 border rounded-lg outline-none" placeholder="Apellidos">
                </div>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Clases sueltas iniciales</label>
                    <input id="swal-kiosk-bonos" type="number" min="0" step="1" class="w-full px-3 py-2 border rounded-lg outline-none" value="0">
                </div>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Crear cliente',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#26160C',
        focusConfirm: false,
        preConfirm: () => {
            const nombre = document.getElementById('swal-kiosk-nombre').value.trim();
            const apellidos = document.getElementById('swal-kiosk-apellidos').value.trim();
            const bonos = Math.max(0, parseInt(document.getElementById('swal-kiosk-bonos').value, 10) || 0);

            if (!nombre) {
                Swal.showValidationMessage('El nombre es obligatorio');
                return false;
            }

            return { nombre, apellidos, bonos };
        }
    });

    if (!formValues) return;

    const payload = {
        id: generarUuidLocal(),
        email: generarEmailMostrador(formValues.nombre, formValues.apellidos),
        nombre: formValues.nombre,
        apellidos: formValues.apellidos,
        bonos: formValues.bonos
    };

    Swal.fire({
        title: 'Creando cliente...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    let result = await crearPerfilMostradorEnServidor(payload);
    let creadoPorServidor = !result.error;

    if (result.error) {
        const serverError = result.error;
        result = await insertarPerfilMostradorDirecto(payload);

        if (result.error) {
            console.error('Error al crear cliente de mostrador:', { serverError, directError: result.error });
            Swal.fire({
                icon: 'error',
                title: 'No se pudo crear',
                text: 'La base de datos no permitió crear el perfil. Revisa que la función create-kiosk-user esté desplegada.',
                confirmButtonColor: '#E1654E'
            });
            return;
        }
    }

    await cargarUsuariosAdmin();
    const nombreCompleto = `${payload.nombre} ${payload.apellidos}`.trim();
    Swal.fire({
        icon: 'success',
        title: 'Cliente creado',
        text: `${nombreCompleto} ya aparece en gestión de bonos${creadoPorServidor ? ' como usuario sin contraseña' : ' como perfil de mostrador'}.`,
        confirmButtonColor: '#9B7B37'
    });
}

function getSaldoConfig(tipo) {
    return SALDOS_CONFIG[tipo] || SALDOS_CONFIG.yoga;
}

function getSaldoUsuario(user, tipo) {
    const config = getSaldoConfig(tipo);
    return toSafeNumber(user?.[config.field]);
}

function renderSaldoBadgeAdmin(u) {
    // Saldo Individual
    const indValue = toSafeNumber(u.bonos);
    const indClass = indValue > 0 ? 'text-olive font-black text-base' : 'text-gray-300';
    const indBadge = 'bg-olive/10 text-olive border-olive/20';

    const indHtml = `
        <div class="flex items-center justify-between gap-3 rounded-xl border ${indBadge} px-3 py-1.5 bg-opacity-80">
            <span class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
                <i class="ph-bold ph-ticket"></i> Clases Sueltas
            </span>
            <span class="${indClass}">${indValue}</span>
        </div>`;

    // Bono Mensual
    let mensualHtml = '';
    if (u.bono_mensual_activo) {
        const fechaFin = u.bono_mensual_fin ? new Date(u.bono_mensual_fin).toLocaleDateString(getCurrentLocale()) : '--/--/----';
        mensualHtml = `
            <div class="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 px-3 py-1.5 bg-emerald-50 bg-opacity-80">
                <span class="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 uppercase tracking-wide">
                    <i class="ph-bold ph-flower-lotus"></i> Mensual Activo
                </span>
                <span class="font-bold text-xs text-emerald-700 font-sans">Hasta ${fechaFin}</span>
            </div>`;
    } else {
        mensualHtml = `
            <div class="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-1.5 bg-gray-50 bg-opacity-80">
                <span class="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                    <i class="ph-bold ph-flower-lotus"></i> Mensual Inactivo
                </span>
                <span class="font-bold text-xs text-gray-400">Inactivo</span>
            </div>`;
    }

    return `<div class="flex flex-col gap-1.5 w-full min-w-[200px]">${indHtml}${mensualHtml}</div>`;
}

function renderActionsAdmin(u) {
    const indButtons = `
        <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-bold text-gray-400 uppercase tracking-wide w-14 text-right">Clases Sueltas:</span>
            <button onclick="sumarSaldo('${u.id}', 'yoga', -1)" class="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition font-bold" title="Restar 1 clase suelta">
                -1
            </button>
            <button onclick="sumarSaldo('${u.id}', 'yoga', 1)" class="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-900 text-white hover:bg-black transition font-bold shadow-sm" title="Añadir 1 clase suelta">
                +1
            </button>
        </div>`;

    let mensualButton = '';
    if (u.bono_mensual_activo) {
        mensualButton = `
            <button onclick="cambiarBonoMensual('${u.id}', false)" class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider btn-desactivar-mensual rounded-lg transition shadow-sm flex items-center gap-1">
                <i class="ph-bold ph-x-circle text-xs"></i> Desactivar Mensual
            </button>`;
    } else {
        mensualButton = `
            <button onclick="cambiarBonoMensual('${u.id}', true)" class="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider btn-activar-mensual rounded-lg transition shadow-sm flex items-center gap-1">
                <i class="ph-bold ph-check-circle text-xs"></i> Activar Mensual
            </button>`;
    }

    const deleteUserButton = `
        <button onclick="borrarUsuario('${u.id}')" class="w-7 h-7 flex items-center justify-center rounded-lg border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 transition" title="Eliminar Usuario Completo">
            <i class="ph-bold ph-trash text-xs"></i>
        </button>`;

    return `
        <div class="flex flex-col items-end gap-2">
            ${indButtons}
            <div class="flex items-center gap-2 mt-1">
                ${mensualButton}
                ${deleteUserButton}
            </div>
        </div>`;
}

function renderUsersTable(users) {
    const tbody = document.getElementById('users-table-body');
    const noRes = document.getElementById('no-users-found');

    tbody.innerHTML = '';

    if (!users || users.length === 0) {
        noRes.classList.remove('hidden');
        return;
    }
    noRes.classList.add('hidden');

    users.forEach(u => {
        const rolUsuario = (u.rol || '').toLowerCase().trim();
        const isAdminRow = rolUsuario === 'admin';
        const isMostrador = esClienteMostrador(u);
        const nombreCompleto = getNombreCompletoPerfil(u, 'Cliente');
        const identificador = getIdentificadorPerfil(u);
        const inicial = nombreCompleto.charAt(0).toUpperCase() || '?';
        const row = document.createElement('tr');
        row.className = 'bg-white/90 hover:bg-white transition shadow-sm border border-gray-100';

        let roleBadge = '<span class="bg-gray-100 text-gray-400 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-gray-200">Cliente</span>';

        if (rolUsuario === 'admin') {
            roleBadge = '<span class="bg-gray-900 text-white text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-gray-800">Admin</span>';
        } else if (STAFF_ROLES.includes(rolUsuario)) {
            roleBadge = '<span class="bg-slate-200 text-slate-600 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-slate-300">Profesional</span>';
        } else if (isMostrador) {
            roleBadge = '<span class="bg-olive/10 text-olive text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-olive/20">Mostrador</span>';
        }

        row.innerHTML = `
                    <td class="px-6 py-4">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isAdminRow ? 'bg-gold-100 text-gold-700' : 'bg-gray-200 text-gray-500'}">
                                ${escapeHtml(inicial)}
                            </div>
                            <div class="flex flex-col">
                                <span class="font-medium text-gray-700 truncate max-w-[140px] sm:max-w-none">${escapeHtml(nombreCompleto)}</span>
                                <span class="text-[10px] ${isMostrador ? 'text-olive font-semibold' : 'text-gray-400'}">${escapeHtml(identificador)}</span>
                            </div>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center">${roleBadge}</td>
                    <td class="px-6 py-4">
                        ${renderSaldoBadgeAdmin(u)}
                    </td>
                    <td class="px-6 py-4 text-right">
                        ${renderActionsAdmin(u)}
                    </td>
                `;
        tbody.appendChild(row);
    });
}

function renderStaffTable(users) {
    const tbody = document.getElementById('staff-table-body');
    const noRes = document.getElementById('no-staff-found');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!users || users.length === 0) {
        if (noRes) noRes.classList.remove('hidden');
        return;
    }
    if (noRes) noRes.classList.add('hidden');

    // Ordenar: primero los profesionales/profesores y al final los admins
    const sortedUsers = [...users].sort((a, b) => {
        const rolA = (a.rol || '').toLowerCase().trim();
        const rolB = (b.rol || '').toLowerCase().trim();
        const isAAdmin = rolA === 'admin';
        const isBAdmin = rolB === 'admin';
        
        if (isAAdmin && !isBAdmin) return 1;  // Admin va al final
        if (!isAAdmin && isBAdmin) return -1; // Profesional va primero
        
        // Si tienen el mismo rol, ordenar alfabéticamente por email
        const emailA = (a.email || '').toLowerCase();
        const emailB = (b.email || '').toLowerCase();
        return emailA.localeCompare(emailB);
    });

    sortedUsers.forEach(u => {
        const rolUsuario = (u.rol || '').toLowerCase().trim();
        const isAdminRow = rolUsuario === 'admin';
        const row = document.createElement('tr');
        row.className = 'bg-white/90 hover:bg-white transition shadow-sm border border-gray-100';

        let roleBadge = '<span class="bg-gray-100 text-gray-400 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-gray-200">Cliente</span>';

        if (rolUsuario === 'admin') {
            roleBadge = '<span class="bg-gray-900 text-white text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-gray-800">Admin</span>';
        } else if (STAFF_ROLES.includes(rolUsuario)) {
            roleBadge = '<span class="bg-slate-200 text-slate-600 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-slate-300">Profesional</span>';
        }

        const deleteUserButton = `
            <button onclick="borrarUsuario('${u.id}')" class="w-7 h-7 flex items-center justify-center rounded-lg border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 transition" title="Eliminar Usuario Completo">
                <i class="ph-bold ph-trash text-xs"></i>
            </button>`;

        let publicoToggle = '';
        if (STAFF_ROLES.includes(rolUsuario)) {
            const profRecord = allProfesionalesCache.find(p => (p.email || '').toLowerCase() === (u.email || '').toLowerCase());
            const isVisible = profRecord ? (profRecord.visible_publico !== false) : true;
            
            publicoToggle = `
                <div class="flex justify-center">
                    <select onchange="toggleVisibilidadPublica('${u.email}', this.value === 'si')" class="bg-ivory border border-cocoa/20 rounded-xl px-2.5 py-1 text-xs text-cocoa focus:outline-none focus:border-cocoa font-bold transition cursor-pointer">
                        <option value="si" ${isVisible ? 'selected' : ''}>Sí (Público)</option>
                        <option value="no" ${!isVisible ? 'selected' : ''}>No (Oculto)</option>
                    </select>
                </div>
            `;
        } else {
            publicoToggle = '<div class="text-center text-gray-300 text-xs">-</div>';
        }

        row.innerHTML = `
            <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isAdminRow ? 'bg-gold-100 text-gold-700' : 'bg-gray-200 text-gray-500'}">
                        ${u.email ? u.email.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div class="flex flex-col">
                        <span class="font-medium text-gray-700 truncate max-w-[140px] sm:max-w-none">${u.email || 'Anon'}</span>
                        <span class="text-[10px] text-gray-400">${u.nombre || ''} ${u.apellidos || ''}</span>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 text-center">${roleBadge}</td>
            <td class="px-6 py-4 text-center">${publicoToggle}</td>
            <td class="px-6 py-4 text-right">
                <div class="flex justify-end items-center mt-1">
                    ${deleteUserButton}
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function toggleVisibilidadPublica(email, visible) {
    if (!isAdmin) return;

    // Buscar si existe en la caché
    const profRecord = allProfesionalesCache.find(p => (p.email || '').toLowerCase() === email.toLowerCase());
    
    if (!profRecord) {
        // Auto-crear ficha si no existe
        const user = allUsersCache.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
        const nombre = user ? (user.nombre || 'Profesional') : 'Profesional';
        const apellidos = user ? (user.apellidos || '') : '';
        
        let { error: insertErr } = await client.from('profesionales').insert([{
            nombre,
            apellidos,
            email,
            especialidad: "Yoga | clases",
            color: "#9B7B37",
            color_bg: "bg-olive",
            foto_url: "",
            descripcion: "Ficha de profesional.",
            visible_publico: visible
        }]);

        if (insertErr) {
            console.error('Error al crear ficha de profesional:', insertErr);
            if (insertErr.message && insertErr.message.includes('visible_publico')) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Falta columna en base de datos',
                    text: 'Debes ejecutar la consulta SQL: "ALTER TABLE profesionales ADD COLUMN visible_publico BOOLEAN DEFAULT TRUE;" en el panel de Supabase SQL Editor.',
                    confirmButtonColor: '#9B7B37'
                });
            } else {
                Swal.fire('Error', 'No se pudo crear la ficha: ' + insertErr.message, 'error');
            }
            return;
        }
    } else {
        // Actualizar visibilidad pública
        let { error: updateErr } = await client
            .from('profesionales')
            .update({ visible_publico: visible })
            .eq('email', email);

        if (updateErr) {
            console.error('Error al actualizar visibilidad pública:', updateErr);
            if (updateErr.message && updateErr.message.includes('visible_publico')) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Falta columna en base de datos',
                    text: 'Debes ejecutar la consulta SQL: "ALTER TABLE profesionales ADD COLUMN visible_publico BOOLEAN DEFAULT TRUE;" en el panel de Supabase SQL Editor.',
                    confirmButtonColor: '#9B7B37'
                });
            } else {
                Swal.fire('Error', 'No se pudo actualizar la visibilidad: ' + updateErr.message, 'error');
            }
            return;
        }
    }

    // Recargar la caché y refrescar vistas
    await cargarProfesionalesCache();
    cargarProfesoresAdmin();
    
    const toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500,
        timerProgressBar: true
    });
    toast.fire({
        icon: 'success',
        title: visible ? 'Visible en público' : 'Ocultado de público'
    });
}

async function cambiarBonoMensual(userId, activar) {
    if (!isAdmin) {
        Swal.fire({
            icon: 'info',
            title: 'Activación gestionada por GEN Yoga',
            text: 'El bono mensual solo puede activarlo o desactivarlo el equipo de GEN Yoga.',
            confirmButtonColor: '#9B7B37'
        });
        return;
    }

    if (activar) {
        const hoy = new Date().toISOString().split('T')[0];
        const enUnMes = new Date();
        enUnMes.setDate(enUnMes.getDate() + 30);
        const enUnMesStr = enUnMes.toISOString().split('T')[0];

        const { value: formValues } = await Swal.fire({
            title: 'Activar Bono Mensual',
            html: `
                <div class="space-y-4 text-left">
                    <div>
                        <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Fecha de inicio</label>
                        <input id="swal-bono-inicio" type="date" class="w-full px-3 py-2 border rounded-lg outline-none" value="${hoy}">
                    </div>
                    <div>
                        <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Fecha de vencimiento</label>
                        <input id="swal-bono-fin" type="date" class="w-full px-3 py-2 border rounded-lg outline-none" value="${enUnMesStr}">
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Activar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#10B981',
            focusConfirm: false,
            preConfirm: () => {
                const inicio = document.getElementById('swal-bono-inicio').value;
                const fin = document.getElementById('swal-bono-fin').value;
                if (!inicio || !fin) {
                    Swal.showValidationMessage('Debes seleccionar ambas fechas');
                    return false;
                }
                if (new Date(inicio) > new Date(fin)) {
                    Swal.showValidationMessage('La fecha de vencimiento debe ser posterior al inicio');
                    return false;
                }
                return { inicio, fin };
            }
        });

        if (!formValues) return;

        Swal.fire({ title: 'Activando...', didOpen: () => Swal.showLoading() });

        const { error } = await client.from('profiles').update({
            bono_mensual_activo: true,
            bono_mensual_inicio: new Date(formValues.inicio).toISOString(),
            bono_mensual_fin: new Date(formValues.fin).toISOString()
        }).eq('id', userId);

        Swal.close();

        if (error) {
            Swal.fire('Error', 'No se pudo activar el bono: ' + error.message, 'error');
        } else {
            Swal.fire({ icon: 'success', title: 'Bono Mensual activado', showConfirmButton: false, timer: 1200 });
            if (isAdmin && typeof cargarUsuariosAdmin === 'function') {
                cargarUsuariosAdmin();
            }
            if (typeof checkProfile === 'function') {
                checkProfile();
            }
        }
    } else {
        const res = await Swal.fire({
            title: '¿Desactivar Bono Mensual?',
            text: "El usuario perderá el acceso a las clases reservadas bajo este bono y volverá a usar clases sueltas.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            cancelButtonColor: '#3085d6',
            confirmButtonText: 'Sí, desactivar'
        });

        if (res.isConfirmed) {
            Swal.fire({ title: 'Desactivando...', didOpen: () => Swal.showLoading() });

            const { error } = await client.from('profiles').update({
                bono_mensual_activo: false,
                bono_mensual_inicio: null,
                bono_mensual_fin: null
            }).eq('id', userId);

            Swal.close();

            if (error) {
                Swal.fire('Error', 'No se pudo desactivar el bono: ' + error.message, 'error');
            } else {
                Swal.fire({ icon: 'success', title: 'Bono Mensual desactivado', showConfirmButton: false, timer: 1200 });
                if (isAdmin && typeof cargarUsuariosAdmin === 'function') {
                    cargarUsuariosAdmin();
                }
                if (typeof checkProfile === 'function') {
                    checkProfile();
                }
            }
        }
    }
}

// --- LOGICA PROFESORES ADMIN ---
let activeProfesoresAdminFilter = 'todos';

function normalizarEspecialidad(especialidad) {
    return String(especialidad || '').toLowerCase();
}

function filtrarProfesionalesPorArea(profesionales = [], filtro = 'todos') {
    const f = (filtro || 'todos').toLowerCase();
    if (f === 'todos') {
        return profesionales.filter(p => {
            const cats = getEspecialidadCategorias(p);
            return cats.includes('clases') || cats.includes('consultas') || cats.includes('talleres');
        });
    }

    return profesionales.filter(p => {
        const cats = getEspecialidadCategorias(p);
        if (f === 'clases') return cats.includes('clases');
        if (f === 'psicologia') return cats.includes('consultas');
        if (f === 'nutricion') return cats.includes('talleres');
        return true;
    });
}

window.filtrarProfesoresAdmin = function(filtro) {
    activeProfesoresAdminFilter = filtro || 'todos';
    cargarProfesoresAdmin();
};

function setBotonFiltroProfesActive(filtro) {
    const ids = [
        { id: 'prof-filter-todos', key: 'todos' },
        { id: 'prof-filter-clases', key: 'clases' },
        { id: 'prof-filter-psico', key: 'psicologia' },
        { id: 'prof-filter-nutri', key: 'nutricion' }
    ];

    ids.forEach(({ id, key }) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (key === (filtro || 'todos')) {
            el.className = 'px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-cocoa/10 bg-cocoa text-white shadow-sm';
        } else {
            el.className = 'px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-cocoa/10 bg-white/70 text-cocoa hover:bg-white transition';
        }
    });
}

function opcionesCategoriaProfesional(selected = '') {
    const cats = [
        { value: 'Profesor de yoga', label: 'Yoga' },
        { value: 'Consultas', label: 'Consultas' },
        { value: 'Talleres', label: 'Talleres' }
    ];

    const isPredefined = cats.some(c => c.value === selected);
    let optionsHtml = cats.map(c => `<option value="${escapeHtml(c.value)}" ${c.value === selected ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');

    if (selected && !isPredefined) {
        optionsHtml += `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`;
    }

    return optionsHtml;
}

window.crearProfesor = async function() {
    if (!isAdmin) return;

    const { value: formValues } = await Swal.fire({
        title: 'Nuevo Profesional',
        html: `
            <div class="space-y-4 text-left">
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Nombre</label>
                    <input id="swal-prof-nombre" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="">
                </div>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Email (opcional)</label>
                    <input id="swal-prof-email" type="email" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="">
                </div>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Especialidad Texto (ej: Vinyasa & Restaurativa)</label>
                    <input id="swal-prof-especialidad-texto" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-olive outline-none" value="Yoga">
                </div>
                <div class="space-y-2">
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Categorías / Subcategorías (Elige al menos una)</label>
                    <div class="flex flex-col gap-2 bg-sand/5 p-3 rounded-lg border border-cocoa/10">
                        <label class="flex items-center gap-2 text-sm text-cocoa cursor-pointer">
                            <input type="checkbox" id="swal-prof-cat-clases" class="accent-olive w-4 h-4" checked>
                            <span>Clases (Yoga)</span>
                        </label>
                        <label class="flex items-center gap-2 text-sm text-cocoa cursor-pointer">
                            <input type="checkbox" id="swal-prof-cat-consultas" class="accent-olive w-4 h-4">
                            <span>Consultas (Psicología / Nutrición)</span>
                        </label>
                        <label class="flex items-center gap-2 text-sm text-cocoa cursor-pointer">
                            <input type="checkbox" id="swal-prof-cat-talleres" class="accent-olive w-4 h-4">
                            <span>Talleres (Workshops)</span>
                        </label>
                    </div>
                    <p class="text-[10px] text-gray-400">Nota: Un profesional no puede estar en Clases y Consultas a la vez. Debe estar en al menos una categoría.</p>
                </div>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Descripción (opcional)</label>
                    <textarea id="swal-prof-descripcion" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" rows="3"></textarea>
                </div>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">URL Foto (opcional)</label>
                    <input id="swal-prof-foto" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="">
                </div>
                <div>
                    <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Color Identificativo</label>
                    <input id="swal-prof-color" type="color" class="w-full h-10 rounded cursor-pointer border border-gray-200" value="#2d8a8e">
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Crear',
        confirmButtonColor: '#1a4d4f',
        preConfirm: () => {
            const nombre = document.getElementById('swal-prof-nombre')?.value?.trim();
            const email = document.getElementById('swal-prof-email')?.value?.trim();
            const especialidadTexto = document.getElementById('swal-prof-especialidad-texto')?.value?.trim() || 'General';
            const descripcion = document.getElementById('swal-prof-descripcion')?.value?.trim();
            const foto_url = document.getElementById('swal-prof-foto')?.value?.trim();
            const color = document.getElementById('swal-prof-color')?.value;

            const catClases = document.getElementById('swal-prof-cat-clases')?.checked;
            const catConsultas = document.getElementById('swal-prof-cat-consultas')?.checked;
            const catTalleres = document.getElementById('swal-prof-cat-talleres')?.checked;

            const selectedCats = [];
            if (catClases) selectedCats.push('clases');
            if (catConsultas) selectedCats.push('consultas');
            if (catTalleres) selectedCats.push('talleres');

            if (selectedCats.length === 0) {
                Swal.showValidationMessage('Debes seleccionar al menos una categoría.');
                return false;
            }
            if (catClases && catConsultas) {
                Swal.showValidationMessage('Un profesional no puede pertenecer a Clases y Consultas a la vez.');
                return false;
            }

            return {
                nombre,
                email,
                especialidad: `${especialidadTexto} | ${selectedCats.join(', ')}`,
                descripcion,
                foto_url,
                color
            };
        }
    });

    if (!formValues) return;
    if (!formValues.nombre) return Swal.fire('Error', 'El nombre es obligatorio', 'error');

    const { error } = await client.from('profesionales').insert([formValues]);
    if (error) Swal.fire('Error', error.message, 'error');
    else {
        await cargarProfesionalesCache();
        Swal.fire({ icon: 'success', title: 'Profesional creado', timer: 1200, showConfirmButton: false });
        cargarProfesoresAdmin();
    }
};

async function cargarProfesoresAdmin() {
    const grid = document.getElementById('admin-profesores-grid');
    const noData = document.getElementById('no-profesores');

    await cargarProfesionalesCache();
    grid.innerHTML = '';

    if (!allProfesionalesCache || allProfesionalesCache.length === 0) {
        noData.classList.remove('hidden');
        return;
    }
    noData.classList.add('hidden');

    setBotonFiltroProfesActive(activeProfesoresAdminFilter);
    const profesionales = filtrarProfesionalesPorArea(allProfesionalesCache, activeProfesoresAdminFilter);

    if (!profesionales || profesionales.length === 0) {
        grid.innerHTML = '';
        noData.classList.remove('hidden');
        return;
    }

    grid.innerHTML = profesionales.map(p => {
        const initials = p.nombre
            ? p.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
            : '??';

        // Determinar icono según especialidad
        let iconClass = 'ph-user';
        const esp = (p.especialidad || '').toLowerCase();
        if (esp.includes('consulta') || esp.includes('psico') || esp.includes('terapia')) {
            iconClass = 'ph-brain';
        } else if (esp.includes('nutri') || esp.includes('diet')) {
            iconClass = 'ph-apple';
        } else if (esp.includes('taller') || esp.includes('workshop')) {
            iconClass = 'ph-chalkboard-teacher';
        } else if (esp.includes('yoga') || esp.includes('instructor')) {
            iconClass = 'ph-person-simple-tai-chi';
        }

        const baseColor = p.color || '#8c8658';
        const bgGradient = `linear-gradient(135deg, ${baseColor}15, ${baseColor}30)`;
        const textColor = baseColor;
        const tagBg = `${baseColor}08`;
        const borderStyle = `outline: 1px solid ${baseColor}30;`;

        const avatarInner = p.foto_url
            ? `<img src="${p.foto_url}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden')">
               <div class="w-full h-full flex flex-col items-center justify-center hidden" style="background: ${bgGradient}">
                    <i class="ph-fill ${iconClass}" style="font-size: 32px; color: ${textColor}"></i>
               </div>`
            : `<div class="w-full h-full flex flex-col items-center justify-center" style="background: ${bgGradient}">
                    <i class="ph-fill ${iconClass}" style="font-size: 32px; color: ${textColor}"></i>
               </div>`;

        const bioHtml = p.descripcion
            ? `<p class="text-xs text-cocoa/60 font-light line-clamp-2 px-4 text-center mt-3 leading-relaxed" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${p.descripcion}</p>`
            : '';

        const emailHtml = p.email
            ? `<div class="text-[10px] text-cocoa/40 mt-1 font-light flex items-center gap-1 justify-center">
                <i class="ph ph-envelope-simple"></i> ${p.email}
               </div>`
            : '';

        return `
        <div class="bg-white/80 backdrop-blur-xl rounded-3xl p-6 shadow-sm border border-cocoa/10 hover:shadow-md hover:scale-[1.01] transition duration-300 group flex flex-col items-center relative min-h-[260px] w-full sm:w-[300px]">
            
            <!-- Botones de Acción (Top Right) -->
            <div style="position: absolute; top: 16px; right: 16px; display: flex; gap: 8px; z-index: 10;">
                <button onclick="editarProfesor(${p.id})" 
                    class="hover:bg-cocoa hover:text-white transition flex items-center justify-center shadow-sm"
                    style="width: 32px; height: 32px; border-radius: 50%; background-color: rgba(211,202,180,0.15); border: 1px solid rgba(38,22,12,0.05); color: #26160C;"
                    title="Editar">
                    <i class="ph-bold ph-pencil-simple text-sm"></i>
                </button>
                <button onclick="borrarProfesor(${p.id})" 
                    class="hover:bg-red-500 hover:text-white transition flex items-center justify-center shadow-sm"
                    style="width: 32px; height: 32px; border-radius: 50%; background-color: rgba(211,202,180,0.15); border: 1px solid rgba(38,22,12,0.05); color: #26160C;"
                    title="Eliminar">
                    <i class="ph-bold ph-trash text-sm"></i>
                </button>
            </div>

            <!-- Contenedor del Avatar Circular -->
            <div class="rounded-full overflow-hidden shadow-sm relative group-hover:scale-105 transition duration-300 mt-2 mb-4 bg-gray-50 flex items-center justify-center"
                 style="width: 80px; height: 80px; min-width: 80px; min-height: 80px; border: 3px solid #ffffff; ${borderStyle} box-shadow: 0 4px 10px rgba(38,22,12,0.08);">
                ${avatarInner}
            </div>

            <!-- Nombre -->
            <h3 class="brand-font text-lg font-bold text-cocoa text-center mb-0.5" style="color: #26160C;">${p.nombre}</h3>
            
            <!-- Email -->
            ${emailHtml}

            <!-- Etiqueta de Especialidad -->
            <div class="mt-3">
                <span class="inline-block py-1 px-3 rounded-full text-[9px] font-bold tracking-widest uppercase"
                      style="background-color: ${tagBg}; color: ${textColor}; border: 1px solid ${baseColor}20;">
                    ${getEspecialidadTexto(p.especialidad) || 'Instructor'}
                </span>
            </div>

            <!-- Descripción (Bio) -->
            ${bioHtml}
        </div>
        `;
    }).join('');
}

async function editarProfesor(id) {
    const profesor = allProfesionalesCache.find(p => p.id === id);
    if (!profesor) return;

    const espTexto = getEspecialidadTexto(profesor.especialidad);
    const espCats = getEspecialidadCategorias(profesor);
    const tieneClases = espCats.includes('clases');
    const tieneConsultas = espCats.includes('consultas');
    const tieneTalleres = espCats.includes('talleres');

    const { value: formValues } = await Swal.fire({
        title: 'Editar Profesional',
        html: `
                        <div class="space-y-4 text-left">
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Nombre</label>
                                <input id="swal-prof-nombre" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="${profesor.nombre || ''}">
                            </div>
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Email (opcional)</label>
                                <input id="swal-prof-email" type="email" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="${profesor.email || ''}">
                            </div>
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Especialidad Texto (ej: Vinyasa & Restaurativa)</label>
                                <input id="swal-prof-especialidad-texto" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-olive outline-none" value="${escapeHtml(espTexto)}">
                            </div>
                            <div class="space-y-2">
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Categorías / Subcategorías (Elige al menos una)</label>
                                <div class="flex flex-col gap-2 bg-sand/5 p-3 rounded-lg border border-cocoa/10">
                                    <label class="flex items-center gap-2 text-sm text-cocoa cursor-pointer">
                                        <input type="checkbox" id="swal-prof-cat-clases" class="accent-olive w-4 h-4" ${tieneClases ? 'checked' : ''}>
                                        <span>Clases (Yoga)</span>
                                    </label>
                                    <label class="flex items-center gap-2 text-sm text-cocoa cursor-pointer">
                                        <input type="checkbox" id="swal-prof-cat-consultas" class="accent-olive w-4 h-4" ${tieneConsultas ? 'checked' : ''}>
                                        <span>Consultas (Psicología / Nutrición)</span>
                                    </label>
                                    <label class="flex items-center gap-2 text-sm text-cocoa cursor-pointer">
                                        <input type="checkbox" id="swal-prof-cat-talleres" class="accent-olive w-4 h-4" ${tieneTalleres ? 'checked' : ''}>
                                        <span>Talleres (Workshops)</span>
                                    </label>
                                </div>
                                <p class="text-[10px] text-gray-400">Nota: Un profesional no puede estar en Clases y Consultas a la vez. Debe estar en al menos una categoría.</p>
                            </div>
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Descripción (opcional)</label>
                                <textarea id="swal-prof-descripcion" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" rows="3">${profesor.descripcion || ''}</textarea>
                            </div>
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">URL Foto</label>
                                <input id="swal-prof-foto" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="${profesor.foto_url || ''}">
                            </div>
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Color Identificativo</label>
                                <input id="swal-prof-color" type="color" class="w-full h-10 rounded cursor-pointer border border-gray-200" value="${profesor.color || '#2d8a8e'}">
                            </div>
                        </div>
                    `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        confirmButtonColor: '#1a4d4f',
        preConfirm: () => {
            const nombre = document.getElementById('swal-prof-nombre')?.value?.trim();
            const email = document.getElementById('swal-prof-email')?.value?.trim();
            const especialidadTexto = document.getElementById('swal-prof-especialidad-texto')?.value?.trim() || 'General';
            const descripcion = document.getElementById('swal-prof-descripcion')?.value?.trim();
            const foto_url = document.getElementById('swal-prof-foto')?.value?.trim();
            const color = document.getElementById('swal-prof-color')?.value;

            const catClases = document.getElementById('swal-prof-cat-clases')?.checked;
            const catConsultas = document.getElementById('swal-prof-cat-consultas')?.checked;
            const catTalleres = document.getElementById('swal-prof-cat-talleres')?.checked;

            const selectedCats = [];
            if (catClases) selectedCats.push('clases');
            if (catConsultas) selectedCats.push('consultas');
            if (catTalleres) selectedCats.push('talleres');

            if (selectedCats.length === 0) {
                Swal.showValidationMessage('Debes seleccionar al menos una categoría.');
                return false;
            }
            if (catClases && catConsultas) {
                Swal.showValidationMessage('Un profesional no puede pertenecer a Clases y Consultas a la vez.');
                return false;
            }

            return {
                nombre,
                email,
                especialidad: `${especialidadTexto} | ${selectedCats.join(', ')}`,
                descripcion,
                foto_url,
                color
            };
        }
    });

    if (formValues) {
        if (!formValues.nombre) return Swal.fire('Error', 'El nombre es obligatorio', 'error');

        const { error } = await client.from('profesionales').update(formValues).eq('id', id);
        if (error) Swal.fire('Error', error.message, 'error');
        else {
            Swal.fire({
                icon: 'success',
                title: 'Profesional actualizado',
                showConfirmButton: false,
                timer: 1500
            });
            await cargarProfesionalesCache();
            cargarProfesoresAdmin();
        }
    }
}

async function borrarProfesor(id) {
    const res = await Swal.fire({
        title: '¿Eliminar profesional?',
        text: "Esta acción no se puede deshacer.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar'
    });

    if (res.isConfirmed) {
        const { error } = await client.from('profesionales').delete().eq('id', id);
        if (error) Swal.fire('Error', error.message, 'error');
        else {
            await cargarProfesionalesCache();
            cargarProfesoresAdmin();
            Swal.fire('Eliminado', 'El profesional ha sido eliminado.', 'success');
        }
    }
}

function filtrarUsuarios() {
    const term = document.getElementById('user-search').value.toLowerCase();
    const filtered = allUsersCache.filter(u => getTextoBusquedaPerfil(u).includes(term));
    
    const clients = filtered.filter(u => !['admin', ...STAFF_ROLES].includes((u.rol || '').toLowerCase().trim()));
    const staff = filtered.filter(u => ['admin', ...STAFF_ROLES].includes((u.rol || '').toLowerCase().trim()));
    
    renderUsersTable(clients);
    renderStaffTable(staff);
}

async function sumarSaldo(userId, tipo, qty) {
    const config = getSaldoConfig(tipo);
    const { data, error: readError } = await client.from('profiles').select(config.field).eq('id', userId).single();

    if (readError) {
        Swal.fire('Error', `No se pudo leer el saldo de ${config.label}. Revisa que exista el campo ${config.field}.`, 'error');
        return;
    }

    const nuevoSaldo = Math.max(0, toSafeNumber(data?.[config.field]) + qty);
    const { error } = await client.from('profiles').update({ [config.field]: nuevoSaldo }).eq('id', userId);

    if (error) Swal.fire('Error', error.message, 'error');
    else {
        const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1000 });
        Toast.fire({ icon: 'success', title: 'Saldo actualizado' });
        cargarUsuariosAdmin();
    }
}

async function sumarBono(userId, qty) {
    return sumarSaldo(userId, 'yoga', qty);
}

async function borrarUsuario(uid) {
    const res = await Swal.fire({
        title: '¿Eliminar usuario?',
        text: "Se borrará el perfil y sus reservas.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar'
    });

    if (res.isConfirmed) {
        Swal.showLoading();
        const { error: errReservas } = await client.from('reservas_yoga').delete().eq('user_id', uid);
        await client.from('reservas_psicologia').delete().eq('user_id', uid);
        await client.from('reservas_nutricion').delete().eq('user_id', uid);
        const { data, error } = await client.from('profiles').delete().eq('id', uid).select();

        if (error) {
            Swal.fire('Error', 'No se pudo eliminar: ' + error.message, 'error');
        } else if (!data || data.length === 0) {
            Swal.fire({
                icon: 'error',
                title: 'Permiso Denegado',
                text: 'El usuario NO fue borrado. Verifica los permisos.'
            });
        } else {
            Swal.fire('Eliminado', 'El usuario ha sido eliminado correctamente.', 'success');
            await cargarUsuariosAdmin();
        }
    }
}

// --- 8. CREAR CLASE INDIVIDUAL ---
async function abrirModalCrearClase() {
    const modal = document.getElementById('modal-crear-clase');
    modal.classList.remove('hidden');

    const hoy = new Date().toISOString().split('T')[0];

    // Reset repetición
    const repEnabled = document.getElementById('clase-repeat-enabled');
    const repOptions = document.getElementById('clase-repeat-options');
    if (repEnabled) repEnabled.checked = false;
    if (repOptions) repOptions.classList.add('hidden');

    // Reset nuevos campos
    const repEvery = document.getElementById('clase-repeat-every');
    if (repEvery) {
        repEvery.value = 'semanal';
        // Desencadenar el evento change para reajustar etiquetas/contenedores
        repEvery.dispatchEvent(new Event('change'));
    }
    document.querySelectorAll('input[name="clase-repeat-day"]').forEach(cb => cb.checked = false);

    const addGroupEnabled = document.getElementById('clase-add-group-enabled');
    if (addGroupEnabled) addGroupEnabled.checked = false;

    if (datePickerInstance) {
        datePickerInstance.set('minDate', hoy);
        datePickerInstance.setDate(hoy);
    } else {
        document.getElementById('clase-fecha').value = hoy;
    }

    const ahora = new Date();
    const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    document.getElementById('clase-hora-inicio').value = horaActual;

    const selectTipo = document.getElementById('clase-tipo-select');
    selectTipo.innerHTML = '<option value="" disabled selected>Cargando...</option>';

    const { data: tipos } = await client.from('tipos_clases').select('*').eq('activo', true).order('orden');

    selectTipo.innerHTML = '<option value="" disabled selected>Selecciona tipo de clase</option>';
    if (tipos && tipos.length > 0) {
        tipos.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.text = t.nombre;
            opt.dataset.duracion = t.duracion_predeterminada;
            selectTipo.appendChild(opt);
        });

        selectTipo.onchange = (e) => {
            const opt = selectTipo.options[selectTipo.selectedIndex];
            if (opt.dataset.duracion) {
                document.getElementById('clase-duracion').value = opt.dataset.duracion;
            }
        };
    } else {
        const opt = document.createElement('option');
        opt.text = "No hay tipos definidos (Crear en Configuración)";
        opt.disabled = true;
        selectTipo.appendChild(opt);
    }

    const selectProfesor = document.getElementById('clase-profesor-id');
    selectProfesor.innerHTML = '<option value="" disabled selected>Selecciona un profesional</option>';

    if (allProfesionalesCache && allProfesionalesCache.length > 0) {
        const clasesProfs = allProfesionalesCache.filter(p => getEspecialidadCategorias(p).includes('clases'));
        clasesProfs.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.nombre + (p.especialidad ? ` (${getEspecialidadTexto(p.especialidad)})` : '');
            selectProfesor.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.disabled = true;
        option.textContent = 'No hay profesionales disponibles';
        selectProfesor.appendChild(option);
    }
}

function cerrarModalCrearClase() {
    const modal = document.getElementById('modal-crear-clase');
    modal.classList.add('hidden');
    document.getElementById('form-crear-clase').reset();
}

document.getElementById('form-crear-clase').addEventListener('submit', async (e) => {
    e.preventDefault();

    const tipoSelect = document.getElementById('clase-tipo-select');
    const nombre = tipoSelect.options[tipoSelect.selectedIndex].text;
    const fecha = document.getElementById('clase-fecha').value;
    const horaInicio = document.getElementById('clase-hora-inicio').value;
    const duracion = parseInt(document.getElementById('clase-duracion').value);
    const capacidad = parseInt(document.getElementById('clase-capacidad').value);
    const profesorId = document.getElementById('clase-profesor-id').value;

    const repeatEnabled = !!document.getElementById('clase-repeat-enabled')?.checked;
    const repeatEvery = document.getElementById('clase-repeat-every')?.value || 'semanal';
    let repeatCount = parseInt(document.getElementById('clase-repeat-count')?.value || '1', 10);
    if (!repeatEnabled) repeatCount = 1;
    repeatCount = Math.max(1, Math.min(52, Number.isFinite(repeatCount) ? repeatCount : 1));

    const addGroupEnabled = !!document.getElementById('clase-add-group-enabled')?.checked;

    if (!profesorId) {
        Swal.fire('Error', 'Debes seleccionar un profesional', 'error');
        return;
    }

    const fechaInicio = new Date(`${fecha}T${horaInicio}`);

    const inserts = [];

    if (!repeatEnabled) {
        const end = new Date(fechaInicio.getTime() + duracion * 60000);
        inserts.push({
            tipo_clase: 'yoga',
            nombre,
            fecha_inicio: fechaInicio.toISOString(),
            fecha_fin: end.toISOString(),
            capacidad_max: capacidad,
            profesor_id: profesorId
        });
    } else if (repeatEvery === 'semanal') {
        for (let i = 0; i < repeatCount; i++) {
            const start = new Date(fechaInicio.getTime());
            start.setDate(start.getDate() + (i * 7));
            const end = new Date(start.getTime() + duracion * 60000);
            inserts.push({
                tipo_clase: 'yoga',
                nombre,
                fecha_inicio: start.toISOString(),
                fecha_fin: end.toISOString(),
                capacidad_max: capacidad,
                profesor_id: profesorId
            });
        }
    } else if (repeatEvery === 'mensual') {
        for (let i = 0; i < repeatCount; i++) {
            const start = new Date(fechaInicio.getTime());
            start.setMonth(start.getMonth() + i);
            const end = new Date(start.getTime() + duracion * 60000);
            inserts.push({
                tipo_clase: 'yoga',
                nombre,
                fecha_inicio: start.toISOString(),
                fecha_fin: end.toISOString(),
                capacidad_max: capacidad,
                profesor_id: profesorId
            });
        }
    } else if (repeatEvery === 'dias') {
        const selectedDays = Array.from(document.querySelectorAll('input[name="clase-repeat-day"]:checked')).map(cb => parseInt(cb.value, 10));
        if (selectedDays.length === 0) {
            Swal.fire('Error', 'Debes seleccionar al menos un día de la semana', 'error');
            return;
        }

        const startDayOfWeek = fechaInicio.getDay(); // 0 is Sunday, 1 is Monday, etc.
        const diffToMonday = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek;
        const mondayOfWeek = new Date(fechaInicio.getTime());
        mondayOfWeek.setDate(mondayOfWeek.getDate() + diffToMonday);

        for (let w = 0; w < repeatCount; w++) {
            selectedDays.forEach(day => {
                const dayOfWeekDate = new Date(mondayOfWeek.getTime());
                const distFromMonday = day === 0 ? 6 : day - 1;
                dayOfWeekDate.setDate(dayOfWeekDate.getDate() + (w * 7) + distFromMonday);

                if (dayOfWeekDate >= fechaInicio) {
                    const end = new Date(dayOfWeekDate.getTime() + duracion * 60000);
                    inserts.push({
                        tipo_clase: 'yoga',
                        nombre,
                        fecha_inicio: dayOfWeekDate.toISOString(),
                        fecha_fin: end.toISOString(),
                        capacidad_max: capacidad,
                        profesor_id: profesorId
                    });
                }
            });
        }
    }

    // Validar que las clases regulares solo se programen de Lunes a Viernes
    for (const item of inserts) {
        const d = new Date(item.fecha_inicio);
        const day = d.getDay(); // 0 is Sunday, 6 is Saturday
        if (day === 0 || day === 6) {
            Swal.fire('Día no permitido', 'Las clases regulares solo se pueden programar de Lunes a Viernes. Por favor, selecciona un día laborable.', 'error');
            return;
        }
    }

    Swal.fire({
        title: 'Creando clase...',
        didOpen: () => Swal.showLoading()
    });

    const { data: createdClasses, error } = await client.from('clases').insert(inserts).select();

    if (error) {
        Swal.close();
        Swal.fire({
            icon: 'error',
            title: 'Error al crear clase',
            text: error.message,
            confirmButtonColor: '#1a4d4f'
        });
        return;
    }

    let groupSummaryMsg = '';
    if (addGroupEnabled && createdClasses && createdClasses.length > 0) {
        Swal.fire({
            title: 'Inscribiendo grupo de alumnos...',
            didOpen: () => Swal.showLoading()
        });

        const { data: groupMembers, error: errGroup } = await client
            .from('grupos_profesionales')
            .select('alumno_id')
            .eq('profesional_id', profesorId);

        if (errGroup) {
            console.error('Error al obtener grupo de alumnos:', errGroup);
            groupSummaryMsg = '<br><span class="text-xs text-red-500 font-bold">No se pudo cargar el grupo del profesor.</span>';
        } else if (!groupMembers || groupMembers.length === 0) {
            groupSummaryMsg = '<br><span class="text-xs text-amber-500 font-bold">El profesor no tiene ningún alumno en su grupo.</span>';
        } else {
            const studentIds = groupMembers.map(m => m.alumno_id);
            const failedReservations = [];

            for (const cls of createdClasses) {
                for (const studentId of studentIds) {
                    const { error: errRes } = await client.rpc('reservar_con_bono', {
                        p_clase_id: cls.id,
                        p_user_id: studentId
                    });
                    if (errRes) {
                        failedReservations.push({
                            clase: cls.nombre,
                            fecha: new Date(cls.fecha_inicio).toLocaleDateString(getCurrentLocale(), { day: '2-digit', month: '2-digit' }),
                            alumno: studentId,
                            error: errRes.message
                        });
                    }
                }
            }

            if (failedReservations.length > 0) {
                const studentNames = {};
                allUsersCache.forEach(u => {
                    const fullName = `${u.nombre || ''} ${u.apellidos || ''}`.trim();
                    studentNames[u.id] = fullName || u.email || u.id;
                });

                const details = failedReservations
                    .map(fr => `• ${studentNames[fr.alumno] || fr.alumno} (${fr.fecha}): ${fr.error}`)
                    .join('<br>');

                groupSummaryMsg = `<br><div class="text-left mt-3 text-xs bg-red-50 border border-red-100 p-3 rounded-xl max-h-40 overflow-y-auto"><span class="font-bold text-red-700 block mb-1">Alumnos del grupo que no pudieron ser inscritos:</span>${details}</div>`;
            } else {
                groupSummaryMsg = `<br><span class="text-xs text-emerald-600 font-bold">Grupo de alumnos (${studentIds.length}) inscrito con éxito.</span>`;
            }
        }
    }

    Swal.close();
    cerrarModalCrearClase();

    if (groupSummaryMsg.includes('no pudieron ser inscritos') || groupSummaryMsg.includes('No se pudo cargar')) {
        Swal.fire({
            icon: 'warning',
            title: '¡Clase creada con avisos!',
            html: `Las clases fueron creadas pero el grupo no pudo inscribirse por completo:${groupSummaryMsg}`,
            confirmButtonColor: '#1a4d4f'
        });
    } else {
        Swal.fire({
            icon: 'success',
            title: '¡Clase creada!',
            html: (inserts.length > 1 
                ? `${nombre} ha sido añadida (${inserts.length} repeticiones).` 
                : `${nombre} ha sido añadida al calendario.`) + groupSummaryMsg,
            confirmButtonColor: '#1a4d4f'
        });
    }

    await cargarHorarios();
    if (isAdmin) await cargarAsistenciasPorClase();
});

document.getElementById('modal-crear-clase').addEventListener('click', (e) => {
    if (e.target.id === 'modal-crear-clase') {
        cerrarModalCrearClase();
    }
});

async function borrarClase(id) {
    const res = await Swal.fire({
        title: '¿Eliminar clase?',
        text: 'Esta acción no se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sí, borrar'
    });

    if (res.isConfirmed) {
        await client.from('clases').delete().eq('id', id);
        await cargarHorarios();
        if (isAdmin) await cargarAsistenciasPorClase();
    }
}

// --- 9. REALTIME ---
client.channel('public:db').on('postgres_changes', { event: '*', schema: 'public' }, async () => {
    if (currentUser) {
        await checkProfile();
        await Promise.all([
            cargarHorarios(),
            cargarPsicologia(),
            cargarNutricion()
        ]);
        if (isAdmin) await cargarAsistenciasPorClase();
        if (tieneAccesoConsultasAdmin()) {
            const consultasView = document.getElementById('view-admin-consultas');
            const talleresView = document.getElementById('view-admin-talleres');
            if (consultasView && !consultasView.classList.contains('hidden')) await cargarConsultasAdmin();
            if (talleresView && !talleresView.classList.contains('hidden')) await cargarTalleresAdmin();
        }
        if (esTrabajador()) {
            const profesorCalendario = document.getElementById('view-profesor-calendario');
            const alumnosClase = document.getElementById('view-asistencias');
            if (profesorCalendario && !profesorCalendario.classList.contains('hidden')) await cargarAgendaProfesor();
            if (alumnosClase && !alumnosClase.classList.contains('hidden')) await cargarAsistenciasPorClase();
        }
    }
}).subscribe();

// --- 10. GESTIÓN DE CONFIGURACIÓN ---
async function cargarConfiguracion() {
    const container = document.getElementById('view-configuracion');

    container.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20">
                    <i class="ph-duotone ph-spinner animate-spin text-4xl text-q19-600 mb-4"></i>
                    <p class="text-gray-400 text-sm">Cargando configuración...</p>
                </div>
            `;

    const { data: configs, error } = await client.from('configuracion').select('*').order('clave');

    if (error) {
        console.error('Error:', error);
        return Swal.fire('Error', 'No se pudo cargar la configuración.', 'error');
    }

    allConfigCache = configs || [];

    const targetConfig = configs.find(c => c.clave === 'horas_limite_cancelacion');
    const targetConfigReserva = configs.find(c => c.clave === 'horas_limite_reserva');

    if (!targetConfig) {
        container.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-20 text-center">
                        <i class="ph-duotone ph-warning-circle text-4xl text-gray-300 mb-4"></i>
                        <h3 class="text-lg font-bold text-gray-700">Configuración no encontrada</h3>
                        <p class="text-gray-500 text-sm">No se encontró el parámetro 'horas_limite_cancelacion'.</p>
                    </div>
                `;
        return;
    }

    container.innerHTML = `
                <div class="fade-in max-w-5xl mx-auto mt-8">
                    <div class="text-center mb-10">
                        <h2 class="text-3xl brand-font font-bold text-gray-900 mb-3">Ajustes del Sistema</h2>
                        <p class="text-gray-500 text-lg">Personaliza las reglas principales de tu aplicación.</p>
                    </div>
                    
                    <div class="space-y-8">
                    
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                        
                        <div class="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden group hover:shadow-xl transition flex flex-col h-full">
                            <div class="w-full h-1.5 bg-gradient-to-r from-purple-400 to-purple-600"></div>
                            
                            <div class="p-6 md:p-8 flex flex-col items-center text-center">
                                <div class="flex flex-col sm:flex-row items-center gap-6 mb-6 w-full">
                                    <div class="w-16 h-16 shrink-0 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shadow-sm">
                                        <i class="ph-bold ph-graduation-cap text-3xl"></i>
                                    </div>
                                    <div class="text-left flex-1 w-full">
                                        <h3 class="font-bold text-gray-900 text-lg leading-tight mb-1">Gestión de Staff</h3>
                                        <p class="text-xs text-gray-500 mb-3">Busca usuarios por email para otorgar permisos.</p>
                                        
                                        <div class="relative group/input w-full">
                                            <input type="text" id="input-search-promo" 
                                                   class="w-full pl-9 pr-10 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition text-sm font-medium"
                                                   placeholder="usuario@email.com..."
                                                   onkeyup="if(event.key === 'Enter') buscarUsuariosPromocion()">
                                            <i class="ph-bold ph-magnifying-glass absolute left-3 top-3 text-gray-400 group-focus-within/input:text-purple-500 transition"></i>
                                            <button onclick="buscarUsuariosPromocion()" class="absolute right-1.5 top-1.5 bg-purple-600 text-white w-7 h-7 rounded-lg hover:bg-purple-700 transition shadow-sm flex items-center justify-center">
                                                <i class="ph-bold ph-arrow-right"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div id="results-promo-container" class="w-full"></div>
                            </div>
                        </div>

                        <div class="bg-white rounded-3xl shadow-lg border border-gray-100 overflow-hidden group hover:shadow-xl transition flex flex-col h-full">
                            <div class="w-full h-1.5 bg-gradient-to-r from-emerald-400 to-emerald-600"></div>
                            
                            <div class="p-6 md:p-8 flex flex-col h-full justify-between">
                                <h3 class="font-bold text-gray-900 text-lg leading-tight mb-6 text-left flex items-center gap-2">
                                    <i class="ph-bold ph-clock-countdown text-emerald-600 text-2xl"></i> Límites de Tiempo
                                </h3>
                                
                                <div class="space-y-6 flex-grow">
                                    <!-- Cancelación -->
                                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-50 pb-4">
                                        <div class="text-left">
                                            <h4 class="font-bold text-gray-800 text-sm">Cancelar reserva</h4>
                                            <p class="text-xs text-gray-500">Antelación mínima para cancelar.</p>
                                        </div>
                                        <div class="flex items-center gap-3 bg-gray-50 p-1.5 rounded-xl border border-gray-200 w-fit self-start sm:self-auto">
                                            <button onclick="ajustarValorCancelacion(-1)" class="w-8 h-8 rounded-lg bg-white text-gray-600 shadow-sm border border-gray-100 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center active:scale-95">
                                                <i class="ph-bold ph-minus"></i>
                                            </button>
                                            <div class="flex items-center gap-1 px-2">
                                                <input type="number" id="input-horas-cancelacion" value="${targetConfig.valor}" 
                                                       onchange="actualizarConfigRapido('${targetConfig.id}', this.value)"
                                                       class="w-10 bg-transparent text-center font-black text-xl text-gray-800 outline-none p-0 remove-arrow">
                                                <span class="text-gray-400 font-bold text-[10px] uppercase tracking-wide pt-1">H</span>
                                            </div>
                                            <button onclick="ajustarValorCancelacion(1)" class="w-8 h-8 rounded-lg bg-white text-gray-600 shadow-sm border border-gray-100 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center active:scale-95">
                                                <i class="ph-bold ph-plus"></i>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <!-- Reserva -->
                                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div class="text-left">
                                            <h4 class="font-bold text-gray-800 text-sm">Reservar clase</h4>
                                            <p class="text-xs text-gray-500">Antelación mínima para reservar.</p>
                                        </div>
                                        <div class="flex items-center gap-3 bg-gray-50 p-1.5 rounded-xl border border-gray-200 w-fit self-start sm:self-auto">
                                            <button onclick="ajustarValorReserva(-1)" class="w-8 h-8 rounded-lg bg-white text-gray-600 shadow-sm border border-gray-100 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center active:scale-95">
                                                <i class="ph-bold ph-minus"></i>
                                            </button>
                                            <div class="flex items-center gap-1 px-2">
                                                <input type="number" id="input-horas-reserva" value="${targetConfigReserva ? targetConfigReserva.valor : 12}" 
                                                       onchange="actualizarConfigRapido('${targetConfigReserva ? targetConfigReserva.id : ''}', this.value)"
                                                       class="w-10 bg-transparent text-center font-black text-xl text-gray-800 outline-none p-0 remove-arrow">
                                                <span class="text-gray-400 font-bold text-[10px] uppercase tracking-wide pt-1">H</span>
                                            </div>
                                            <button onclick="ajustarValorReserva(1)" class="w-8 h-8 rounded-lg bg-white text-gray-600 shadow-sm border border-gray-100 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center active:scale-95">
                                                <i class="ph-bold ph-plus"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                
                                <p class="text-[10px] text-emerald-600/80 font-bold uppercase tracking-wider flex items-center gap-1 self-end mt-4">
                                    <i class="ph-bold ph-check-circle"></i> Guardado Auto
                                </p>
                            </div>
                        </div>

                    </div>

                    <div class="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden relative group hover:shadow-2xl transition">
                        <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 to-blue-600"></div>

                        <div class="p-8 pb-10">
                            <div class="flex items-center justify-center gap-4 mb-8">
                                <div class="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
                                    <i class="ph-fill ph-bookmarks text-3xl"></i>
                                </div>
                                <div class="text-left">
                                    <h3 class="text-2xl font-bold text-gray-900">Catálogo de Clases</h3>
                                    <p class="text-gray-500 text-sm">Gestiona los tipos, colores e iconos de tus actividades.</p>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                <div class="bg-gray-50 rounded-2xl p-6 border border-gray-200">
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <i class="ph-bold ph-list"></i> Tipos Activos
                                    </h4>
                                    <div class="max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                                        <div id="tipos-clases-list" class="space-y-3">
                                            <div class="flex flex-col items-center justify-center py-10 opacity-50">
                                                <i class="ph-duotone ph-spinner animate-spin text-3xl text-blue-600"></i>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h4 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <i class="ph-bold ph-plus-circle text-blue-500"></i> Crear Nuevo Tipo
                                    </h4>
                                    <form id="form-crear-tipo" class="space-y-5" onsubmit="crearTipoClase(event)">
                                        <div class="grid grid-cols-2 gap-4">
                                            <div>
                                                <label class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block pl-1">Nombre</label>
                                                <input type="text" id="new-tipo-nombre" placeholder="Ej: Yoga suave" required 
                                                    class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition hover:bg-white text-gray-800">
                                            </div>
                                            <div>
                                                <label class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 block pl-1">Duración (min)</label>
                                                <input type="number" id="new-tipo-duracion" value="60" required 
                                                    class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition hover:bg-white text-gray-800">
                                            </div>
                                        </div>

                                        <div class="space-y-4 pt-2">
                                            <div>
                                                 <label class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 block pl-1">Seleccionar Color</label>
                                                 <div class="flex flex-wrap gap-2" id="color-picker-container"></div>
                                                 <input type="hidden" id="new-tipo-color" value="#EF4444">
                                            </div>
                                            <div>
                                                 <label class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 block pl-1">Seleccionar Icono</label>
                                                 <div class="flex flex-wrap gap-2" id="icon-picker-container"></div>
                                                 <input type="hidden" id="new-tipo-icono" value="ph-person-simple-tai-chi">
                                            </div>
                                        </div>

                                        <button type="submit" class="w-full py-4 mt-2 bg-gray-900 hover:bg-black text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-xl transform active:scale-[0.98] transition flex items-center justify-center gap-2 group/btn">
                                            <span>Guardar Nuevo Tipo</span>
                                            <i class="ph-bold ph-arrow-right group-hover/btn:translate-x-1 transition-transform"></i>
                                        </button>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

    window.renderColorPicker = () => {
        const container = document.getElementById('color-picker-container');
        const standardColors = [
            '#EF4444', '#F97316', '#F59E0B', '#10B981', '#3B82F6',
            '#6366F1', '#8B5CF6', '#EC4899', '#14B8A6', '#64748B'
        ];

        container.innerHTML = standardColors.map((color, index) => `
                    <button type="button" onclick="selectColor('${color}')" 
                        class="w-8 h-8 rounded-full border-2 border-white shadow-sm hover:scale-110 transition flex items-center justify-center color-swatch ${index === 0 ? 'ring-2 ring-offset-2 ring-gray-300' : ''}"
                        style="background-color: ${color};"
                        data-color="${color}"
                        title="${color}">
                        ${index === 0 ? '<i class="ph-bold ph-check text-white text-xs"></i>' : ''}
                    </button>
                `).join('');
        document.getElementById('new-tipo-color').value = standardColors[0];
    };

    window.selectColor = (color) => {
        document.getElementById('new-tipo-color').value = color;
        const btns = document.querySelectorAll('.color-swatch');
        btns.forEach(btn => {
            btn.classList.remove('ring-2', 'ring-offset-2', 'ring-gray-300');
            btn.innerHTML = '';
            if (btn.dataset.color === color) {
                btn.classList.add('ring-2', 'ring-offset-2', 'ring-gray-300');
                btn.innerHTML = '<i class="ph-bold ph-check text-white text-xs"></i>';
            }
        });
    };

    window.renderTiposClases = async () => {
        const listContainer = document.getElementById('tipos-clases-list');
        if (!listContainer) return;

        try {
            const { data, error } = await client.from('tipos_clases').select('*').order('orden', { ascending: true });

            if (error) {
                console.error('Error fetching tipos_clases:', error);
                listContainer.innerHTML = `<p class="text-red-400 text-xs text-center">Error: ${error.message}</p>`;
                return;
            }

            if (!data || data.length === 0) {
                listContainer.innerHTML = `<p class="text-gray-400 text-xs text-center py-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">No hay tipos de clase creados.</p>`;
                return;
            }

            listContainer.innerHTML = data.map(t => {
                const color = t.color || '#2d8a8e';
                return `
                        <div class="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-100 shadow-sm hover:border-gray-200 transition group">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl flex items-center justify-center shadow-inner" style="background-color: ${color}20; color: ${color}">
                                    <i class="ph-fill ${t.icono || 'ph-hash'} text-xl"></i>
                                </div>
                                <div>
                                    <p class="font-bold text-gray-800 text-sm leading-tight">${t.nombre}</p>
                                    <p class="text-[10px] text-gray-400 font-bold tracking-wide">${t.duracion_predeterminada} MIN</p>
                                </div>
                            </div>
                            <button onclick="borrarTipoClase(${t.id})" class="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition" title="Eliminar">
                                <i class="ph-bold ph-trash text-lg"></i>
                            </button>
                        </div>`;
            }).join('');
        } catch (err) {
            console.error('Unexpected error in renderTiposClases:', err);
        }
    };

    window.crearTipoClase = async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('new-tipo-nombre').value;
        const duracion = document.getElementById('new-tipo-duracion').value;
        const color = document.getElementById('new-tipo-color').value;
        const icono = document.getElementById('new-tipo-icono').value;

        try {
            const { error } = await client.from('tipos_clases').insert([{
                nombre,
                duracion_predeterminada: parseInt(duracion),
                color,
                icono,
                activo: true
            }]);

            if (error) {
                Swal.fire('Error', 'No se pudo crear el tipo: ' + error.message, 'error');
            } else {
                document.getElementById('form-crear-tipo').reset();
                selectColor('#EF4444');
                selectIcon('ph-person-simple-tai-chi');
                await renderTiposClases();
                const toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
                toast.fire({ icon: 'success', title: 'Tipo creado exitosamente' });
            }
        } catch (err) {
            Swal.fire('Error inesperado', err.message, 'error');
        }
    };

    window.renderIconPicker = () => {
        const container = document.getElementById('icon-picker-container');
        if (!container) return;

        const icons = [
            'ph-person-simple-tai-chi', 'ph-barbell', 'ph-heart-beat',
            'ph-fire', 'ph-drop', 'ph-smiley-blank',
            'ph-yin-yang', 'ph-bicycle', 'ph-waves', 'ph-star'
        ];
        const currentIcon = document.getElementById('new-tipo-icono').value;

        container.innerHTML = icons.map(icon => `
                    <button type="button" onclick="selectIcon('${icon}')" 
                        class="w-8 h-8 rounded-xl bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100 hover:text-gray-600 transition flex items-center justify-center icon-swatch ${icon === currentIcon ? 'ring-2 ring-offset-2 ring-gray-300 !bg-gray-800 !text-white' : ''}"
                        data-icon="${icon}">
                        <i class="ph-fill ${icon} text-lg"></i>
                    </button>
                `).join('');
    };

    window.selectIcon = (icon) => {
        document.getElementById('new-tipo-icono').value = icon;
        const btns = document.querySelectorAll('.icon-swatch');
        btns.forEach(btn => {
            btn.classList.remove('ring-2', 'ring-offset-2', 'ring-gray-300', '!bg-gray-800', '!text-white');
            if (btn.dataset.icon === icon) {
                btn.classList.add('ring-2', 'ring-offset-2', 'ring-gray-300', '!bg-gray-800', '!text-white');
            }
        });
    };

    window.borrarTipoClase = async (id) => {
        const { isConfirmed } = await Swal.fire({
            title: '¿Borrar Tipo?',
            text: 'No podrás crear nuevas clases de este tipo.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, borrar',
            confirmButtonColor: '#ef4444'
        });

        if (isConfirmed) {
            const { error } = await client.from('tipos_clases').delete().eq('id', id);
            if (error) {
                Swal.fire('Error', 'No se puede borrar. Intenta desactivarlo.', 'error');
            } else {
                renderTiposClases();
            }
        }
    };

    window.ajustarValorCancelacion = async (delta) => {
        const input = document.getElementById('input-horas-cancelacion');
        let val = parseInt(input.value) || 0;
        val += delta;
        if (val < 0) val = 0;
        input.value = val;
        await actualizarConfigRapido(targetConfig.id, val.toString());
        configuracionesApp['horas_limite_cancelacion'] = val.toString();
    };

    window.ajustarValorReserva = async (delta) => {
        const input = document.getElementById('input-horas-reserva');
        let val = parseInt(input.value) || 0;
        val += delta;
        if (val < 0) val = 0;
        input.value = val;
        if (targetConfigReserva) {
            await actualizarConfigRapido(targetConfigReserva.id, val.toString());
        } else {
            const { data } = await client.from('configuracion').select('id').eq('clave', 'horas_limite_reserva').single();
            if (data) {
                await actualizarConfigRapido(data.id, val.toString());
            }
        }
        configuracionesApp['horas_limite_reserva'] = val.toString();
    };

    window.buscarUsuariosPromocion = async () => {
        const query = document.getElementById('input-search-promo').value.trim();
        const container = document.getElementById('results-promo-container');

        if (query.length < 3) {
            container.innerHTML = '<p class="text-center text-sm text-gray-400 py-2">Escribe al menos 3 caracteres...</p>';
            return;
        }

        container.innerHTML = '<div class="text-center py-4"><i class="ph-duotone ph-spinner animate-spin text-purple-600 text-xl"></i></div>';

        const { data: users, error } = await client
            .from('profiles')
            .select('*')
            .ilike('email', `%${query}%`)
            .limit(5);

        if (error || !users || users.length === 0) {
            container.innerHTML = '<p class="text-center text-sm text-gray-500 py-2">No se encontraron usuarios.</p>';
            return;
        }

        container.innerHTML = users.map(u => {
            const esProfe = u.rol === 'profesor' || u.rol === 'admin';
            return `
                        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-purple-200 transition group">
                            <div class="flex items-center gap-3 overflow-hidden">
                                <div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 flex-shrink-0">
                                    ${u.avatar_url ? `<img src="${u.avatar_url}" class="w-full h-full rounded-full object-cover">` : '<i class="ph-bold ph-user text-lg"></i>'}
                                </div>
                                <div class="min-w-0">
                                    <p class="font-bold text-gray-800 text-sm truncate">${u.nombre || 'Sin nombre'} ${u.apellidos || ''}</p>
                                    <p class="text-xs text-gray-500 truncate">${u.email}</p>
                                </div>
                            </div>
                            <div>
                                ${esProfe
                    ? `<span class="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full border border-green-200">Ya es Staff</span>`
                    : `<button onclick="promoverAProfesor('${u.id}', '${u.email}')" class="px-3 py-1.5 bg-white border border-gray-200 text-purple-600 text-xs font-bold rounded-lg hover:bg-purple-600 hover:text-white hover:border-purple-600 transition shadow-sm">
                                         Promover
                                       </button>`
                }
                            </div>
                        </div>
                    `;
        }).join('');
    };

    window.promoverAProfesor = async (uid, email) => {
        const res = await Swal.fire({
            title: '¿Promover a Profesional?',
            text: `El usuario ${email} tendrá acceso al panel de profesionales.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#9333ea',
            confirmButtonText: 'Sí, promover'
        });

        if (res.isConfirmed) {
            Swal.showLoading();
            try {
                const { data: userData } = await client.from('profiles').select('*').eq('id', uid).single();
                await client.from('profiles').update({ rol: 'profesor' }).eq('id', uid);
                await client.from('profesionales').insert([{
                    nombre: userData.nombre || 'Profesional',
                    apellidos: userData.apellidos || '',
                    email: userData.email,
                    foto_url: userData.avatar_url,
                    especialidad: 'General',
                }]);
                Swal.fire({ icon: 'success', title: '¡Promoción Completada!', timer: 2500, showConfirmButton: false });
                window.buscarUsuariosPromocion();
            } catch (err) {
                Swal.fire('Error', err.message, 'error');
            }
        }
    };

    await renderTiposClases();
    renderColorPicker();
    renderIconPicker();
}

async function actualizarConfigRapido(id, nuevoValor) {
    const { error } = await client.from('configuracion').update({ valor: nuevoValor }).eq('id', id);
    if (error) {
        Swal.fire('Error', error.message, 'error');
        cargarConfiguracion();
    } else {
        // Actualizar caché local
        const { data: configItem } = await client.from('configuracion').select('clave').eq('id', id).single();
        if (configItem) {
            configuracionesApp[configItem.clave] = nuevoValor;
        }
        const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1500 });
        Toast.fire({ icon: 'success', title: 'Configuración actualizada' });
    }
}

async function agregarConfiguracion() {
    const { value: formValues } = await Swal.fire({
        title: 'Nuevo Parámetro',
        html: `
                    <div class="space-y-4 text-left">
                        <div>
                            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 block">Clave</label>
                            <input id="config-clave" class="swal2-input w-full" placeholder="ej: max_reservas_dia">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 block">Valor</label>
                            <input id="config-valor" class="swal2-input w-full" placeholder="ej: 3">
                        </div>
                        <div>
                            <label class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 block">Descripción</label>
                            <textarea id="config-descripcion" class="swal2-textarea w-full" placeholder="Máximo de reservas por día para cada usuario"></textarea>
                        </div>
                    </div>
                `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        confirmButtonColor: '#236c6f',
        preConfirm: () => {
            const clave = document.getElementById('config-clave').value;
            const valor = document.getElementById('config-valor').value;
            const descripcion = document.getElementById('config-descripcion').value;
            if (!clave) {
                Swal.showValidationMessage('La clave es obligatoria');
                return false;
            }
            return { clave, valor, descripcion };
        }
    });

    if (formValues) {
        const { error } = await client.from('configuracion').insert([formValues]);
        if (error) Swal.fire('Error', error.message, 'error');
        else {
            Swal.fire({ icon: 'success', title: 'Parámetro creado', showConfirmButton: false, timer: 1500 });
            cargarConfiguracion();
        }
    }
}

// ================= PERFIL =================
function renderProfileCard(profile) {
    const wrapper = document.getElementById('profile-card');
    const fullNameEl = document.getElementById('profile-nombre-full');
    if (!profile) {
        if (fullNameEl) fullNameEl.textContent = '--';
        if (wrapper) wrapper.classList.add('hidden');
        return;
    }

    const nombre = profile.nombre ?? '';
    const apellidos = profile.apellidos ?? '';
    if (fullNameEl) fullNameEl.textContent = `${nombre} ${apellidos}`.trim() || currentUser?.email || '--';

    animateBalance("profile-bonos-count", userBonos);
    animateBalance("profile-saldo-psicologia-count", userSaldoPsicologia);
    animateBalance("profile-saldo-nutricion-count", userSaldoNutricion);
    if (wrapper) wrapper.classList.remove('hidden');
}

async function loadProfileCard() {
    try {
        if (!currentUser?.id) { renderProfileCard(null); return; }
        const { data } = await client.from('profiles').select('nombre, apellidos').eq('id', currentUser.id).single();
        renderProfileCard(data);
    } catch (e) { renderProfileCard(null); }
}

async function abrirEditarPerfil() {
    const fullName = document.getElementById('profile-nombre-full')?.textContent.trim() || '';
    const parts = fullName.split(' ');
    const currentNombre = parts[0] || '';
    const currentApellidos = parts.slice(1).join(' ') || '';

    const { value: formValues } = await Swal.fire({
        title: 'Ajustes de Perfil',
        html: `
            <div class="flex flex-col gap-4 text-left font-sans">
                <div>
                    <label class="text-xs font-bold text-cocoa/60 uppercase tracking-wider block mb-1">Nombre</label>
                    <input id="swal-nombre" class="w-full px-4 py-2.5 border border-cocoa/10 rounded-xl bg-ivory text-cocoa focus:ring-2 focus:ring-olive outline-none transition" value="${currentNombre}">
                </div>
                <div>
                    <label class="text-xs font-bold text-cocoa/60 uppercase tracking-wider block mb-1">Apellidos</label>
                    <input id="swal-apellidos" class="w-full px-4 py-2.5 border border-cocoa/10 rounded-xl bg-ivory text-cocoa focus:ring-2 focus:ring-olive outline-none transition" value="${currentApellidos}">
                </div>
                <div class="mt-4 pt-4 border-t border-cocoa/10">
                    <label class="text-xs font-bold text-red-500 uppercase tracking-wider block mb-2">Zona de Peligro</label>
                    <button type="button" onclick="Swal.close(); window.eliminarPropiaCuenta();" 
                        class="w-full py-3 px-4 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200/50 font-bold rounded-xl transition-all duration-200 text-xs flex items-center justify-center gap-2 active:scale-95">
                        <i class="ph-bold ph-trash-simple text-sm"></i> Eliminar Cuenta Permanentemente
                    </button>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#B48A47',
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => [
            document.getElementById('swal-nombre').value.trim(),
            document.getElementById('swal-apellidos').value.trim()
        ]
    });

    if (formValues) {
        const [newNombre, newApellidos] = formValues;
        if (!newNombre) {
            Swal.fire('Error', 'El nombre es obligatorio', 'error');
            return;
        }
        await client.from('profiles').update({ nombre: newNombre, apellidos: newApellidos }).eq('id', currentUser.id);
        loadProfileCard();
    }
}

window.eliminarPropiaCuenta = async function() {
    const res = await Swal.fire({
        title: '¿Eliminar tu cuenta definitivamente?',
        text: 'Esta acción borrará de forma permanente tu perfil, tus saldos y todas tus reservas. No se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar mi cuenta',
        cancelButtonText: 'Cancelar'
    });

    if (!res.isConfirmed) return;

    const { value: confirmEmail } = await Swal.fire({
        title: 'Confirmar eliminación',
        text: 'Por favor, escribe tu correo electrónico para confirmar que deseas eliminar tu cuenta permanentemente:',
        input: 'email',
        inputPlaceholder: 'tu@email.com',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Eliminar permanentemente',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmEmail) return;

    if (confirmEmail.toLowerCase().trim() !== currentUser.email.toLowerCase().trim()) {
        await Swal.fire('Error', 'El correo electrónico no coincide. La eliminación ha sido cancelada.', 'error');
        return;
    }

    Swal.fire({
        title: 'Eliminando cuenta...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    try {
        const uid = currentUser.id;
        
        // Borrar reservas
        const { error: errReservasYoga } = await client.from('reservas_yoga').delete().eq('user_id', uid);
        if (errReservasYoga) console.error('Error al borrar reservas de yoga:', errReservasYoga);
        
        const { error: errReservasPsicologia } = await client.from('reservas_psicologia').delete().eq('user_id', uid);
        if (errReservasPsicologia) console.error('Error al borrar reservas de psicología:', errReservasPsicologia);

        const { error: errReservasNutricion } = await client.from('reservas_nutricion').delete().eq('user_id', uid);
        if (errReservasNutricion) console.error('Error al borrar reservas de nutrición:', errReservasNutricion);

        // Borrar perfil
        const { error: errProfile } = await client.from('profiles').delete().eq('id', uid);
        
        if (errProfile) {
            throw new Error(errProfile.message);
        }

        // Cerrar sesión
        await client.auth.signOut();
        
        await Swal.fire({
            icon: 'success',
            title: 'Cuenta eliminada',
            text: 'Tu cuenta y todos tus datos asociados han sido eliminados correctamente.',
            confirmButtonText: 'Entendido'
        });
        
        location.reload();
    } catch (err) {
        console.error('Error al eliminar cuenta:', err);
        Swal.fire('Error', 'No se pudo eliminar tu cuenta: ' + err.message, 'error');
    }
}

// --- 11. GESTIÓN PÚBLICA ---
function switchPublicView(viewName) {
    if (viewName === 'nutricion') {
        localStorage.setItem('activePublicView', 'nutricion');
        localStorage.setItem('activeConsultasSubTab', 'nutricion');
        // Redirigir a la vista de consultas (psicología) con la pestaña de nutrición activa
        switchPublicView('psicologia');
        switchConsultasSubTab('nutricion');
        return;
    }

    localStorage.setItem('activePublicView', viewName);

    const views = {
        'profesor-calendario': { btn: 'nav-public-profesor-calendario', view: 'view-profesor-calendario' },
        'inicio': { btn: 'nav-public-inicio', view: 'view-inicio' },
        'horarios': { btn: 'nav-public-horarios', view: 'view-horarios' },
        'psicologia': { btn: 'nav-public-psicologia', view: 'view-psicologia' },
        'nutricion': { btn: 'nav-public-nutricion', view: 'view-nutricion' },
        'profesores': { btn: 'nav-public-profesores', view: 'view-profesores' },
        'mis-clases': { btn: 'nav-public-mis-clases', view: 'view-asistencias' }
    };

    // Hide all views and deactivate all buttons
    Object.values(views).forEach(item => {
        const vEl = document.getElementById(item.view);
        const bEl = document.getElementById(item.btn);
        if (vEl) vEl.classList.add('hidden');
        if (bEl) {
            bEl.classList.remove('border-cocoa', 'text-cocoa');
            bEl.classList.add('border-transparent', 'text-cocoa/60');
        }
    });

    // Activate selected view/button
    const active = views[viewName];
    if (active) {
        const vEl = document.getElementById(active.view);
        const bEl = document.getElementById(active.btn);
        if (vEl) vEl.classList.remove('hidden');
        if (bEl) {
            bEl.classList.add('border-cocoa', 'text-cocoa');
            bEl.classList.remove('border-transparent', 'text-cocoa/60');
        }
    }

    activePublicView = viewName;

    // Load data based on view name
    if (viewName === 'inicio') {
        renderizarCalendarioInicio();
        renderizarConsolidadoDia();
    } else if (viewName === 'profesor-calendario') {
        cargarAgendaProfesor();
    } else if (viewName === 'horarios') {
        renderizarCalendario();
        renderizarClases();
    } else if (viewName === 'psicologia') {
        const btnNutri = document.getElementById('btn-subtab-nutricion');
        if (btnNutri && btnNutri.classList.contains('active')) {
            cargarNutricion();
        } else {
            cargarPsicologia();
        }
    } else if (viewName === 'profesores') {
        renderProfesoresPublic();
    } else if (viewName === 'mis-clases') {
        cargarAsistenciasPorClase();
    }
}

function switchConsultasSubTab(type) {
    localStorage.setItem('activeConsultasSubTab', type);
    const btnPsico = document.getElementById('btn-subtab-psicologia');
    const btnNutri = document.getElementById('btn-subtab-nutricion');
    const subviewPsico = document.getElementById('sub-view-psicologia');
    const subviewNutri = document.getElementById('sub-view-nutricion');

    if (type === 'psicologia') {
        if (btnPsico) btnPsico.classList.add('active');
        if (btnNutri) btnNutri.classList.remove('active');
        if (subviewPsico) subviewPsico.classList.remove('hidden');
        if (subviewNutri) subviewNutri.classList.add('hidden');
        cargarPsicologia();
    } else {
        if (btnPsico) btnPsico.classList.remove('active');
        if (btnNutri) btnNutri.classList.add('active');
        if (subviewPsico) subviewPsico.classList.add('hidden');
        if (subviewNutri) subviewNutri.classList.remove('hidden');
        cargarNutricion();
    }
}

window.switchConsultasSubTab = switchConsultasSubTab;

function parseBio(text) {
    const sections = {
        lugar: '',
        titulos: [],
        sobreMi: [],
        teAcompano: [],
        meDefine: ''
    };
    if (!text) return sections;

    const normalized = text.replace(/\r\n/g, '\n');
    const parts = normalized.split(/\n?(LUGAR DE NACIMIENTO|TITULACIONES|SOBRE MI|SOBRE MÍ|TRAYECTORIA|TE ACOMPAÑO|ME DEFINE):?\s*/i);
    
    for (let i = 1; i < parts.length; i += 2) {
        const header = parts[i].toUpperCase();
        const content = parts[i+1] ? parts[i+1].trim() : '';
        if (header.includes('LUGAR')) {
            sections.lugar = content.replace(/,$/, '').trim();
        } else if (header.includes('TITULACION')) {
            sections.titulos = content.split('\n').map(l => l.replace(/^[\s*\-•]+/g, '').trim()).filter(Boolean);
        } else if (header.includes('SOBRE') || header.includes('TRAYECTORIA')) {
            sections.sobreMi = content.split('\n').map(p => p.trim()).filter(Boolean);
        } else if (header.includes('ACOMPA')) {
            sections.teAcompano = content.split('\n').map(l => l.replace(/^[\s*\-•*]+/g, '').trim()).filter(Boolean);
        } else if (header.includes('DEFINE')) {
            sections.meDefine = content.replace(/^["'“”«»]+/g, '').replace(/["'“”«»]+$/g, '').trim();
        }
    }
    return sections;
}

function truncateTextProfile(text, max = 150) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max).trim()}...`;
}

window.toggleProfesorDetalle = function(cardId) {
    const detailsDiv = document.getElementById(`details-${cardId}`);
    const btnSpan = document.querySelector(`#btn-toggle-${cardId} span`);
    const btnIcon = document.getElementById(`icon-toggle-${cardId}`);
    
    if (detailsDiv) {
        const isHidden = detailsDiv.classList.contains('hidden');
        if (isHidden) {
            detailsDiv.classList.remove('hidden');
            if (btnSpan) btnSpan.textContent = profileT('teachers_read_less', 'Saber menos');
            if (btnIcon) {
                btnIcon.classList.remove('ph-caret-down');
                btnIcon.classList.add('ph-caret-up');
            }
        } else {
            detailsDiv.classList.add('hidden');
            if (btnSpan) btnSpan.textContent = profileT('teachers_read_more', 'Saber más');
            if (btnIcon) {
                btnIcon.classList.remove('ph-caret-up');
                btnIcon.classList.add('ph-caret-down');
            }
        }
    }
};

function renderProfesoresPublic(filtro = 'todos') {
    const grid = document.getElementById('public-profesores-grid');
    if (!grid) return;

    if (!allProfesionalesCache || allProfesionalesCache.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-400 italic py-10">No hay información de profesionales disponible.</div>';
        return;
    }

    const filtersDiv = grid.previousElementSibling;
    if (filtersDiv && filtersDiv.tagName === 'DIV') {
        filtersDiv.style.display = 'flex';
    }

    const isTestUser = (currentUser?.email || '').toLowerCase() === 'profesor@profesor.com';
    const showTestProfesor = isAdmin || isTestUser;
    
    let baseProfs = allProfesionalesCache.map(p => window.translateProfessional ? window.translateProfessional(p) : p);
    if (!showTestProfesor) {
        baseProfs = baseProfs.filter(p => p.visible_publico !== false);
    }

    let filtrados = baseProfs;

    if (filtro === 'todos') {
        filtrados = baseProfs.filter(p => {
            const cats = getEspecialidadCategorias(p);
            return cats.includes('clases') || cats.includes('consultas') || cats.includes('talleres');
        });
    } else if (filtro === 'yoga') {
        filtrados = baseProfs.filter(p => getEspecialidadCategorias(p).includes('clases'));
    } else if (filtro === 'psicologia') {
        filtrados = baseProfs.filter(p => getEspecialidadCategorias(p).includes('consultas'));
    } else if (filtro === 'nutricion') {
        filtrados = baseProfs.filter(p => getEspecialidadCategorias(p).includes('talleres'));
    }

    if (filtrados.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-400 italic py-10">No hay profesionales registrados en esta categoría.</div>';
        return;
    }

    grid.className = "flex flex-wrap justify-center gap-8 w-full";
    grid.innerHTML = filtrados.map((p, index) => {
        const parsed = parseBio(p.descripcion || p.bio || '');
        const cardId = p.id || `idx-${index}`;
        const nombre = `${p.nombre || ''} ${p.apellidos || ''}`.trim() || 'Profesional';
        const baseColor = p.color || '#8c8658';
        const lugar = parsed.lugar
            ? `<span class="block text-xs uppercase tracking-widest text-cocoa/50 mt-1">${escapeHtml(parsed.lugar)}</span>`
            : '';

        const fotoHtml = p.foto_url
            ? `<img src="${escapeHtml(p.foto_url)}" alt="${escapeHtml(nombre)}" class="w-full h-full object-cover">`
            : `<div class="w-full h-full bg-gradient-to-br from-[#F5F2EB] to-[#E5DEC9] flex items-center justify-center text-[#8C8658] relative">
                 <svg viewBox="0 0 100 100" fill="currentColor" class="w-24 h-24 opacity-80">
                   <path d="M50 20C50 20 40 38 40 50C40 60 44 66 50 66C56 66 60 60 60 50C60 38 50 20 50 20Z" />
                   <path d="M50 32C45 40 32 50 32 60C32 68 38 72 45 72C48 72 50 69 50 69C50 69 52 72 55 72C62 72 68 68 68 60C68 50 55 40 50 32Z" opacity="0.85" />
                   <path d="M50 44C42 50 22 58 22 68C22 76 28 80 36 80C42 80 48 76 50 74C52 76 58 80 64 80C72 80 78 76 78 68C78 58 58 50 50 44Z" opacity="0.7" />
                   <path d="M35 84C45 86 55 86 65 84C60 83 50 82 35 84Z" opacity="0.5" />
                 </svg>
               </div>`;

        const fullBio = parsed.sobreMi.join(' ');
        const bioText = truncateTextProfile(fullBio || p.descripcion || p.bio || 'Profesional de GEN Yoga.', 180);

        const titulosParagraphs = parsed.titulos.length
            ? parsed.titulos.map(t => `<p class="flex items-start gap-1.5"><span class="text-olive text-sm font-bold leading-none">•</span><span>${escapeHtml(t)}</span></p>`).join('')
            : '';

        const acompanoParagraphs = parsed.teAcompano.length
            ? parsed.teAcompano.map(item => `<p class="flex items-start gap-1.5"><span class="text-olive text-sm font-bold leading-none">•</span><span>${escapeHtml(item)}</span></p>`).join('')
            : '';

        const defineText = parsed.meDefine ? `"${escapeHtml(parsed.meDefine)}"` : '';

        return `
            <div class="bg-ivory/80 backdrop-blur-md rounded-[32px] p-6 border border-ivory/40 text-center shadow-sm w-full sm:w-[320px] md:w-[340px] flex flex-col justify-between min-h-[460px] transition-all duration-300 hover:shadow-md hover:scale-[1.015]">
                <div class="flex flex-col items-center flex-grow w-full">
                    <!-- Elegant Square Image Frame (matching Silvia's 250x250 size) -->
                    <div class="rounded-3xl overflow-hidden shadow-sm bg-white border-2 border-white mb-4 relative flex-shrink-0" style="width: 250px; height: 250px; outline: 1px solid ${baseColor}30;">
                        ${fotoHtml}
                    </div>
                    <h3 class="text-3xl font-serif text-cocoa leading-tight font-bold">
                        ${escapeHtml(nombre)}
                    </h3>
                    <p class="text-xs uppercase tracking-widest text-olive font-bold mt-1.5">${escapeHtml(getEspecialidadTexto(p.especialidad) || 'Profesional')}</p>
                    ${lugar}

                    <!-- Bio Short -->
                    <p class="text-sm md:text-[15px] text-cocoa/80 leading-relaxed font-normal mt-4 text-center">
                        ${bioText}
                    </p>

                    <!-- Collapsible Details -->
                    <div id="details-${cardId}" class="hidden w-full mt-4 pt-4 border-t border-cocoa/10 text-left space-y-4">
                        <!-- Bio Completa (párrafos adicionales) -->
                        ${parsed.sobreMi.length > 1 ? `
                        <div class="space-y-2 text-sm text-cocoa/75 font-normal leading-relaxed">
                            ${parsed.sobreMi.slice(1).map(para => `<p>${escapeHtml(para)}</p>`).join('')}
                        </div>` : ''}

                        <!-- Titulaciones -->
                        ${titulosParagraphs ? `
                        <div>
                            <h4 class="text-xs font-bold uppercase tracking-wider text-cocoa/50 mb-2 flex items-center gap-1">
                                <i class="ph-bold ph-graduation-cap text-olive"></i> Titulaciones
                            </h4>
                            <div class="space-y-1 text-sm text-cocoa/75">
                                ${titulosParagraphs}
                            </div>
                        </div>` : ''}

                        <!-- Ámbitos de Sesión -->
                        ${acompanoParagraphs ? `
                        <div>
                            <h4 class="text-xs font-bold uppercase tracking-wider text-cocoa/50 mb-2 flex items-center gap-1">
                                <i class="ph-bold ph-heart text-olive"></i> Ámbitos de Sesión
                            </h4>
                            <div class="space-y-1 text-sm text-cocoa/75">
                                ${acompanoParagraphs}
                            </div>
                        </div>` : ''}
                    </div>

                    <!-- Toggle Button -->
                    <button onclick="toggleProfesorDetalle('${cardId}')" id="btn-toggle-${cardId}" class="mt-4 px-4 py-2.5 bg-cocoa/5 hover:bg-cocoa/10 text-cocoa text-xs font-bold uppercase tracking-widest rounded-xl transition w-full flex items-center justify-center gap-1.5">
                        <span>${escapeHtml(profileT('teachers_read_more', 'Saber más'))}</span>
                        <i id="icon-toggle-${cardId}" class="ph-bold ph-caret-down"></i>
                    </button>
                </div>

                <!-- Quote / Define at the bottom -->
                ${defineText ? `
                <div class="w-full mt-6 pt-4 border-t border-cocoa/10 text-sm italic text-cocoa/60 text-center font-serif leading-relaxed">
                    ${defineText}
                </div>` : ''}
            </div>
        `;
    }).join('');
}

// --- UTILIDADES EXTRA (CURSOR & SONIDO) ---

document.addEventListener('DOMContentLoaded', () => {
    // Platform checking here is done at the top of file via IIFE adding platform-web class
    if (document.body.classList.contains('platform-web')) {
        const cursor = document.createElement('div');
        cursor.classList.add('wink-cursor');
        cursor.innerText = '🧘🏼';
        document.body.appendChild(cursor);

        document.addEventListener('mousemove', (e) => {
            cursor.style.left = e.clientX + 'px';
            cursor.style.top = e.clientY + 'px';
        });
        document.addEventListener('mousedown', () => cursor.classList.add('clicking'));
        document.addEventListener('mouseup', () => cursor.classList.remove('clicking'));
        document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) cursor.style.display = 'none'; });
        document.addEventListener('mouseover', () => cursor.style.display = 'block');
    }
});

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playYogaSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const fundamental = 180;
    const ratios = [1, 2.76, 5.4, 8.9];
    const gains = [0.2, 0.1, 0.05, 0.02];
    const decays = [8.0, 6.0, 4.0, 3.0];
    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.5, now + 1.5);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + 8.0);
    masterGain.connect(audioCtx.destination);
    ratios.forEach((ratio, index) => {
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(fundamental * ratio, now);
        if (index === 0) {
            const lfo = audioCtx.createOscillator();
            lfo.frequency.value = 2;
            const lfoGain = audioCtx.createGain();
            lfoGain.gain.value = 3;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            lfo.start(now);
            lfo.stop(now + decays[index]);
        }
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(gains[index], now + 0.1 * (index + 1));
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + decays[index]);
        osc.connect(gainNode);
        gainNode.connect(masterGain);
    });
}

function mostrarFuncionEnPruebas() {
    Swal.fire({
        icon: 'info',
        title: 'Función en pruebas',
        text: 'Esta función está en periodo de pruebas y aún no está disponible.',
        confirmButtonColor: '#B48A47'
    });
}

window.mostrarFuncionEnPruebas = mostrarFuncionEnPruebas;

// =======================================================
// CONSULTAS Y TALLERES (Versión 3.4)
// =======================================================

async function cargarPsicologia() {
    const container = document.getElementById('psicologia-container');
    if (!container) return;
    container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
      <i class="ph-duotone ph-spinner animate-spin text-4xl text-[#3B82F6]"></i>
      <span class="text-xs uppercase tracking-widest font-bold text-gray-500">${escapeHtml(profileT('profile_loading_consultations', 'Cargando consultas...'))}</span>
    </div>`;

    const now = new Date();
    now.setHours(now.getHours() - 2);
    const nowIso = now.toISOString();

    const { data: clases, error: errClases } =
        await client.from('clases')
            .select('*, profesionales(*)')
            .eq('tipo_clase', 'psicologia')
            .gte('fecha_inicio', nowIso)
            .order('fecha_inicio');

    if (errClases) {
        console.error('Error cargando consultas', errClases);
        container.innerHTML = '';
        document.getElementById('psicologia-empty-state').classList.remove('hidden');
        allPsicologiaCache = [];
        return;
    }

    if (!clases || clases.length === 0) {
        container.innerHTML = '';
        document.getElementById('psicologia-empty-state').classList.remove('hidden');
        allPsicologiaCache = [];
        return;
    }

    const claseIds = clases.map(c => c.id);
    const { data: reservas, error: errReservas } =
        await client.from('reservas_psicologia')
            .select('*')
            .in('clase_id', claseIds);

    if (errReservas) {
        console.error('Error cargando reservas de consultas', errReservas);
    }
    document.getElementById('psicologia-empty-state').classList.add('hidden');

    const reservasMap = {};
    (reservas || []).forEach(r => {
        if (!reservasMap[r.clase_id]) reservasMap[r.clase_id] = [];
        reservasMap[r.clase_id].push(r);
    });

    clases.forEach(c => {
        const resClase = reservasMap[c.id] || [];
        const confirmadas = resClase.filter(r => r.estado === 'confirmada');
        c.ocupadas = confirmadas.length;
        c.miReserva = confirmadas.find(r => r.user_id === currentUser.id) || null;
    });

    allPsicologiaCache = clases;
    renderizarCalendarioPsicologia();
    renderizarPsicologia();
    refrescarInicioSiActivo();
}

async function cargarNutricion() {
    const container = document.getElementById('nutricion-container');
    if (!container) return;
    container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
      <i class="ph-duotone ph-spinner animate-spin text-4xl text-[#8B5CF6]"></i>
      <span class="text-xs uppercase tracking-widest font-bold text-gray-500">${escapeHtml(profileT('profile_loading_nutrition', 'Cargando consultas de nutrición...'))}</span>
    </div>`;

    const now = new Date();
    now.setHours(now.getHours() - 2);
    const nowIso = now.toISOString();

    const { data: clases, error: errClases } =
        await client.from('clases')
            .select('*, profesionales(*)')
            .eq('tipo_clase', 'nutricion')
            .gte('fecha_inicio', nowIso)
            .order('fecha_inicio');

    if (errClases) {
        console.error('Error cargando nutrición', errClases);
        container.innerHTML = '';
        document.getElementById('nutricion-empty-state').classList.remove('hidden');
        allNutricionCache = [];
        return;
    }

    if (!clases || clases.length === 0) {
        container.innerHTML = '';
        document.getElementById('nutricion-empty-state').classList.remove('hidden');
        allNutricionCache = [];
        return;
    }

    const claseIds = clases.map(c => c.id);
    const { data: reservas, error: errReservas } =
        await client.from('reservas_nutricion')
            .select('*')
            .in('clase_id', claseIds);

    if (errReservas) {
        console.error('Error cargando reservas de nutrición', errReservas);
    }
    document.getElementById('nutricion-empty-state').classList.add('hidden');

    const reservasMap = {};
    (reservas || []).forEach(r => {
        if (!reservasMap[r.clase_id]) reservasMap[r.clase_id] = [];
        reservasMap[r.clase_id].push(r);
    });

    clases.forEach(c => {
        const resClase = reservasMap[c.id] || [];
        const confirmadas = resClase.filter(r => r.estado === 'confirmada');
        c.ocupadas = confirmadas.length;
        c.miReserva = confirmadas.find(r => r.user_id === currentUser.id) || null;
    });

    allNutricionCache = clases;
    renderizarCalendarioNutricion();
    renderizarNutricion();
    refrescarInicioSiActivo();
}

function renderizarPsicologia() {
    const container = document.getElementById('psicologia-container');
    if (!container) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let clasesAMostrar = allPsicologiaCache.filter(c => {
        const fechaClase = new Date(c.fecha_inicio);
        fechaClase.setHours(0, 0, 0, 0);
        return fechaClase >= hoy;
    });

    if (selectedDatePsicologia) {
        clasesAMostrar = clasesAMostrar.filter(c => {
            const claseDate = formatDateLocal(new Date(c.fecha_inicio));
            return claseDate === selectedDatePsicologia;
        });
    }

    if (clasesAMostrar.length === 0) {
        container.innerHTML = `
            <div class="bg-white/90 backdrop-blur-md rounded-2xl p-12 text-center border border-white/20 shadow-lg">
                <i class="ph-duotone ph-calendar-x text-5xl text-[#3B82F6]/30 mb-4"></i>
                <p class="text-cocoa/60 font-medium">${escapeHtml(profileT('profile_no_consultations_date', 'No hay consultas en esta fecha'))}</p>
                <button onclick="limpiarFiltroFechaPsicologia()" class="mt-4 text-[#3B82F6] hover:underline text-sm font-bold">${escapeHtml(profileT('profile_view_all', 'Ver todas'))}</button>
            </div>`;
        return;
    }

    const grupos = {};
    clasesAMostrar.forEach(c => {
        const dateKey = formatDateLocal(new Date(c.fecha_inicio));
        if (!grupos[dateKey]) grupos[dateKey] = [];
        grupos[dateKey].push(c);
    });

    container.innerHTML = '';

    Object.keys(grupos).sort().forEach(dateKey => {
        const dateObj = new Date(dateKey);
        const diaNombre = formatDisplayWeekday(dateObj);
        const diaNumero = dateObj.getDate();
        const mes = formatDisplayMonth(dateObj);

        const section = document.createElement('div');
        section.className = 'bg-white/90 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg overflow-hidden';

        section.innerHTML = `
            <div class="bg-gradient-to-r from-blue-50 to-white px-6 py-4 border-b border-cocoa/5 flex items-center justify-between">
                <div class="flex items-baseline gap-2">
                    <span class="brand-font text-xl font-bold text-cocoa capitalize">${diaNombre}</span>
                    <span class="text-xs font-semibold text-[#3B82F6] bg-[#3B82F6]/10 px-2 py-0.5 rounded-md border border-[#3B82F6]/20">${diaNumero} ${mes}</span>
                </div>
            </div>
            <div id="psicologia-grid-${dateKey}" class="divide-y divide-cocoa/5"></div>
        `;
        container.appendChild(section);

        const grid = section.querySelector(`#psicologia-grid-${dateKey}`);

        grupos[dateKey].forEach(c => {
            const hora = formatDisplayTime(c.fecha_inicio);
            const llena = c.ocupadas >= c.capacidad_max;
            const reservada = !!c.miReserva;

            let btnAction = '';
            if (isAdmin) {
                btnAction = `
                    <button onclick="abrirModalAsignarPlazaAdmin('psicologia', ${c.id})" class="bg-[#3B82F6] hover:bg-blue-600 text-white text-[11px] font-bold px-5 py-2 rounded-full shadow-md hover:shadow-lg transition active:scale-95 flex items-center gap-1">
                        <i class="ph-bold ph-user-plus"></i> ${escapeHtml(profileT('profile_assign', 'ASIGNAR'))}
                    </button>`;
            } else if (reservada) {
                btnAction = `
                    <button onclick="cancelarConsulta('psicologia', ${c.miReserva.id})" class="group flex items-center gap-2 text-[11px] font-bold text-cocoa/40 hover:text-red-500 border border-cocoa/10 hover:border-red-200 bg-ivory px-4 py-2 rounded-full transition shadow-sm">
                        <i class="ph-bold ph-x group-hover:scale-110 transition"></i> ${escapeHtml(profileT('profile_cancel', 'CANCELAR'))}
                    </button>`;
            } else if (llena) {
                btnAction = `<span class="text-[10px] font-bold text-cocoa/40 bg-sand/10 px-3 py-2 rounded-full uppercase tracking-wide border border-cocoa/10 cursor-not-allowed">${escapeHtml(profileT('profile_reserved', 'Reservado'))}</span>`;
            } else {
                const esAlumno = !isAdmin && !STAFF_ROLES.includes(currentUserRole);
                if (!esAlumno) {
                    btnAction = `<span class="text-[10px] font-bold text-cocoa/40 bg-sand/10 px-3 py-2 rounded-full uppercase tracking-wide border border-cocoa/10 cursor-not-allowed">${escapeHtml(profileT('profile_unavailable', 'No Disponible'))}</span>`;
                } else {
                    const saldo = getSaldoConsultaActual('psicologia');
                    const disabledClass = (saldo < 1) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:shadow-lg hover:brightness-110 active:scale-95';
                    const btnText = (saldo < 1) ? profileT('profile_zero_sessions', '0 Sesiones') : profileT('profile_book', 'RESERVAR');
                    btnAction = `
                        <button onclick="reservarConsulta('psicologia', ${c.id})" class="bg-[#3B82F6] text-white text-[11px] font-bold px-6 py-2 rounded-full shadow-md transition transform ${disabledClass}">
                            ${escapeHtml(btnText)}
                        </button>`;
                }
            }

            const adminTrash = `<button onclick="borrarConsultaAdmin('psicologia', ${c.id})" class="admin-only text-cocoa/20 hover:text-red-500 transition ml-2 p-1" title="Eliminar Consulta"><i class="ph-bold ph-trash"></i></button>`;

            const profesionalName = c.profesionales ? c.profesionales.nombre : 'Staff GEN';
            const profesionalFoto = c.profesionales && c.profesionales.foto_url ? c.profesionales.foto_url : null;
            const profesionalAvatar = profesionalFoto ? `<img src="${profesionalFoto}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-blue-50 flex items-center justify-center text-[#3B82F6] text-[10px] font-bold">${profesionalName.charAt(0)}</div>`;

            const row = document.createElement('div');
            row.className = 'p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-blue-50/5 transition duration-300 group';

            row.innerHTML = `
                <div class="flex items-start gap-4 w-full">
                    <div class="flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-blue-50 text-[#3B82F6] border border-blue-100 shadow-sm flex-shrink-0">
                        <span class="text-[9px] font-bold opacity-80 uppercase pb-0.5">${escapeHtml(profileT('common_appointment', 'Cita'))}</span>
                        <span class="text-base font-black tracking-tight leading-none">${hora}</span>
                    </div>
                    
                    <div class="flex-grow">
                        <div class="flex flex-col gap-1">
                            <div class="flex flex-wrap items-center gap-3">
                                <h4 class="brand-font font-bold text-lg text-cocoa group-hover:text-[#3B82F6] transition leading-tight">
                                    ${escapeHtml(c.nombre || profileT('common_consultation', 'Consulta'))}
                                </h4>
                                <div class="flex items-center gap-2 bg-sand/10 px-2.5 py-1 rounded-full border border-cocoa/10 shadow-sm order-last sm:order-none" title="${escapeHtml(profileT('common_professional', 'Profesional'))}">
                                    <div class="w-6 h-6 rounded-full overflow-hidden border border-cocoa/10 shadow-sm flex-shrink-0">
                                        ${profesionalAvatar}
                                    </div>
                                    <span class="text-xs sm:text-sm font-bold text-cocoa/70 truncate max-w-[150px]">${profesionalName}</span>
                                </div>
                                ${adminTrash}
                            </div>

                            <div class="flex items-center gap-2 mt-1">
                                ${c.descripcion ? `<span class="text-xs text-cocoa/50"><i class="ph-bold ph-info"></i> ${c.descripcion}</span>` : ''}
                                ${reservada ? `<span class="text-[10px] font-bold text-[#3B82F6] bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-md uppercase tracking-wide flex items-center gap-1"><i class="ph-fill ph-check-circle"></i> ${escapeHtml(profileT('profile_your_consultation', 'Tu Consulta'))}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-end sm:min-w-[120px]">
                    ${btnAction}
                </div>
            `;
            grid.appendChild(row);
        });
    });
}

function renderizarNutricion() {
    const container = document.getElementById('nutricion-container');
    if (!container) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let clasesAMostrar = allNutricionCache.filter(c => {
        const fechaClase = new Date(c.fecha_inicio);
        fechaClase.setHours(0, 0, 0, 0);
        return fechaClase >= hoy;
    });

    if (selectedDateNutricion) {
        clasesAMostrar = clasesAMostrar.filter(c => {
            const claseDate = formatDateLocal(new Date(c.fecha_inicio));
            return claseDate === selectedDateNutricion;
        });
    }

    if (clasesAMostrar.length === 0) {
        container.innerHTML = `
            <div class="bg-white/90 backdrop-blur-md rounded-2xl p-12 text-center border border-white/20 shadow-lg">
                <i class="ph-duotone ph-calendar-x text-5xl text-[#8B5CF6]/30 mb-4"></i>
                <p class="text-cocoa/60 font-medium">${escapeHtml(profileT('profile_no_nutrition_date', 'No hay consultas de nutrición en esta fecha'))}</p>
                <button onclick="limpiarFiltroFechaNutricion()" class="mt-4 text-[#8B5CF6] hover:underline text-sm font-bold">${escapeHtml(profileT('profile_view_all', 'Ver todas'))}</button>
            </div>`;
        return;
    }

    const grupos = {};
    clasesAMostrar.forEach(c => {
        const dateKey = formatDateLocal(new Date(c.fecha_inicio));
        if (!grupos[dateKey]) grupos[dateKey] = [];
        grupos[dateKey].push(c);
    });

    container.innerHTML = '';

    Object.keys(grupos).sort().forEach(dateKey => {
        const dateObj = new Date(dateKey);
        const diaNombre = formatDisplayWeekday(dateObj);
        const diaNumero = dateObj.getDate();
        const mes = formatDisplayMonth(dateObj);

        const section = document.createElement('div');
        section.className = 'bg-white/90 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg overflow-hidden';

        section.innerHTML = `
            <div class="bg-gradient-to-r from-purple-50 to-white px-6 py-4 border-b border-cocoa/5 flex items-center justify-between">
                <div class="flex items-baseline gap-2">
                    <span class="brand-font text-xl font-bold text-cocoa capitalize">${diaNombre}</span>
                    <span class="text-xs font-semibold text-[#8B5CF6] bg-[#8B5CF6]/10 px-2 py-0.5 rounded-md border border-[#8B5CF6]/20">${diaNumero} ${mes}</span>
                </div>
            </div>
            <div id="nutricion-grid-${dateKey}" class="divide-y divide-cocoa/5"></div>
        `;
        container.appendChild(section);

        const grid = section.querySelector(`#nutricion-grid-${dateKey}`);

        grupos[dateKey].forEach(c => {
            const hora = formatDisplayTime(c.fecha_inicio);
            const llena = c.ocupadas >= c.capacidad_max;
            const reservada = !!c.miReserva;

            let btnAction = '';
            if (isAdmin) {
                btnAction = `
                    <button onclick="abrirModalAsignarPlazaAdmin('nutricion', ${c.id})" class="bg-[#8B5CF6] hover:bg-purple-600 text-white text-[11px] font-bold px-5 py-2 rounded-full shadow-md hover:shadow-lg transition active:scale-95 flex items-center gap-1">
                        <i class="ph-bold ph-user-plus"></i> ${escapeHtml(profileT('profile_assign', 'ASIGNAR'))}
                    </button>`;
            } else if (reservada) {
                btnAction = `
                    <button onclick="cancelarConsulta('nutricion', ${c.miReserva.id})" class="group flex items-center gap-2 text-[11px] font-bold text-cocoa/40 hover:text-red-500 border border-cocoa/10 hover:border-red-200 bg-ivory px-4 py-2 rounded-full transition shadow-sm">
                        <i class="ph-bold ph-x group-hover:scale-110 transition"></i> ${escapeHtml(profileT('profile_cancel', 'CANCELAR'))}
                    </button>`;
            } else if (llena) {
                btnAction = `<span class="text-[10px] font-bold text-cocoa/40 bg-sand/10 px-3 py-2 rounded-full uppercase tracking-wide border border-cocoa/10 cursor-not-allowed">${escapeHtml(profileT('profile_reserved', 'Reservado'))}</span>`;
            } else {
                const esAlumno = !isAdmin && !STAFF_ROLES.includes(currentUserRole);
                if (!esAlumno) {
                    btnAction = `<span class="text-[10px] font-bold text-cocoa/40 bg-sand/10 px-3 py-2 rounded-full uppercase tracking-wide border border-cocoa/10 cursor-not-allowed">${escapeHtml(profileT('profile_unavailable', 'No Disponible'))}</span>`;
                } else {
                    const saldo = getSaldoConsultaActual('nutricion');
                    const disabledClass = (saldo < 1) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:shadow-lg hover:brightness-110 active:scale-95';
                    const btnText = (saldo < 1) ? profileT('profile_zero_sessions', '0 Sesiones') : profileT('profile_book', 'RESERVAR');
                    btnAction = `
                        <button onclick="reservarConsulta('nutricion', ${c.id})" class="bg-[#8B5CF6] text-white text-[11px] font-bold px-6 py-2 rounded-full shadow-md transition transform ${disabledClass}">
                            ${escapeHtml(btnText)}
                        </button>`;
                }
            }

            const adminTrash = `<button onclick="borrarConsultaAdmin('nutricion', ${c.id})" class="admin-only text-cocoa/20 hover:text-red-500 transition ml-2 p-1" title="Eliminar Consulta"><i class="ph-bold ph-trash"></i></button>`;

            const profesionalName = c.profesionales ? c.profesionales.nombre : 'Staff GEN';
            const profesionalFoto = c.profesionales && c.profesionales.foto_url ? c.profesionales.foto_url : null;
            const profesionalAvatar = profesionalFoto ? `<img src="${profesionalFoto}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-purple-50 flex items-center justify-center text-[#8B5CF6] text-[10px] font-bold">${profesionalName.charAt(0)}</div>`;

            const row = document.createElement('div');
            row.className = 'p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-purple-50/5 transition duration-300 group';

            row.innerHTML = `
                <div class="flex items-start gap-4 w-full">
                    <div class="flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-purple-50 text-[#8B5CF6] border border-purple-100 shadow-sm flex-shrink-0">
                        <span class="text-[9px] font-bold opacity-80 uppercase pb-0.5">${escapeHtml(profileT('common_appointment', 'Cita'))}</span>
                        <span class="text-base font-black tracking-tight leading-none">${hora}</span>
                    </div>
                    
                    <div class="flex-grow">
                        <div class="flex flex-col gap-1">
                            <div class="flex flex-wrap items-center gap-3">
                                <h4 class="brand-font font-bold text-lg text-cocoa group-hover:text-[#8B5CF6] transition leading-tight">
                                    ${escapeHtml(c.nombre || profileT('profile_nutrition_title', 'Consulta Nutrición'))}
                                </h4>
                                <div class="flex items-center gap-2 bg-sand/10 px-2.5 py-1 rounded-full border border-cocoa/10 shadow-sm order-last sm:order-none" title="${escapeHtml(profileT('common_professional', 'Profesional'))}">
                                    <div class="w-6 h-6 rounded-full overflow-hidden border border-cocoa/10 shadow-sm flex-shrink-0">
                                        ${profesionalAvatar}
                                    </div>
                                    <span class="text-xs sm:text-sm font-bold text-cocoa/70 truncate max-w-[150px]">${profesionalName}</span>
                                </div>
                                ${adminTrash}
                            </div>

                            <div class="flex items-center gap-2 mt-1">
                                ${c.descripcion ? `<span class="text-xs text-cocoa/50"><i class="ph-bold ph-info"></i> ${c.descripcion}</span>` : ''}
                                ${reservada ? `<span class="text-[10px] font-bold text-[#8B5CF6] bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-md uppercase tracking-wide flex items-center gap-1"><i class="ph-fill ph-check-circle"></i> ${escapeHtml(profileT('profile_your_appointment', 'Tu Cita'))}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-end sm:min-w-[120px]">
                    ${btnAction}
                </div>
            `;
            grid.appendChild(row);
        });
    });
}

function esClienteAsignable(profile) {
    const rol = (profile?.rol || '').toLowerCase().trim();
    return !['admin', ...STAFF_ROLES].includes(rol);
}

async function descontarSaldoConsulta(userId, tipo) {
    const config = getConsultaConfig(tipo);
    const { data, error } = await client.from('profiles')
        .select(`id, nombre, apellidos, email, rol, ${config.saldoField}`)
        .eq('id', userId)
        .single();

    if (error) return { ok: false, error };
    if (!esClienteAsignable(data)) return { ok: true, skipped: true, perfil: data };

    const saldoActual = toSafeNumber(data?.[config.saldoField]);
    if (saldoActual < 1) return { ok: false, sinSaldo: true, perfil: data };

    const { error: updateError } = await client.from('profiles')
        .update({ [config.saldoField]: saldoActual - 1 })
        .eq('id', userId);

    if (updateError) return { ok: false, error: updateError, perfil: data };
    return { ok: true, perfil: data, saldoAnterior: saldoActual };
}

async function devolverSaldoConsulta(userId, tipo) {
    const config = getConsultaConfig(tipo);
    const { data, error } = await client.from('profiles')
        .select(`rol, ${config.saldoField}`)
        .eq('id', userId)
        .single();

    if (error || !data || !esClienteAsignable(data)) return { ok: false, error };

    const nuevoSaldo = toSafeNumber(data[config.saldoField]) + 1;
    const { error: updateError } = await client.from('profiles')
        .update({ [config.saldoField]: nuevoSaldo })
        .eq('id', userId);

    return { ok: !updateError, error: updateError };
}

function mostrarErrorSaldoConsulta(resultado, tipo) {
    const config = getConsultaConfig(tipo);
    if (resultado?.sinSaldo) {
        Swal.fire({
            icon: 'warning',
            title: `Sin saldo de ${config.label}`,
            text: `Añade saldo de ${config.label.toLowerCase()} a este cliente antes de reservar.`,
            confirmButtonColor: config.color
        });
        return;
    }

    Swal.fire({
        icon: 'error',
        title: 'Error de saldo',
        text: resultado?.error?.message || `No se pudo actualizar el saldo de ${config.label}.`,
        confirmButtonColor: config.color
    });
}

async function refrescarConsultas(tipo) {
    await checkProfile();
    if (tipo === 'psicologia') {
        await cargarPsicologia();
    } else {
        await cargarNutricion();
    }
    if (tieneAccesoConsultasAdmin()) {
        await cargarConsultasAdmin();
    }
}

async function reservarConsulta(tipo, claseId) {
    // Validación de rol: sólo los alumnos pueden reservar consultas
    const rol = (currentUserRole || '').toLowerCase().trim();
    const esAlumno = !isAdmin && !STAFF_ROLES.includes(rol);
    if (!esAlumno) {
        return Swal.fire({
            icon: 'error',
            title: 'Acción no permitida',
            text: 'Solo los alumnos pueden realizar reservas de consultas.',
            confirmButtonColor: '#B48A47'
        });
    }

    if (isReserving) return;

    try {
        isReserving = true;

        const config = getConsultaConfig(tipo);
        const table = config.table;
        const cache = tipo === 'psicologia' ? allPsicologiaCache : allNutricionCache;
        const clase = cache.find(c => c.id === claseId);

        if (clase?.miReserva) {
            return Swal.fire({
                icon: 'warning',
                title: 'Ya tienes esta cita',
                text: 'Ya hay una reserva confirmada para ti en este horario.',
                confirmButtonColor: config.color
            });
        }

        if (clase && clase.ocupadas >= clase.capacidad_max && !isAdmin) {
            return Swal.fire({
                icon: 'error',
                title: 'Consulta reservada',
                text: 'Este horario ya no está disponible.',
                confirmButtonColor: config.color
            });
        }

        const debeDescontarSaldo = !isAdmin && !esTrabajador();
        let saldoDescontado = false;
        if (debeDescontarSaldo) {
            if (getSaldoConsultaActual(tipo) < 1) {
                mostrarErrorSaldoConsulta({ sinSaldo: true }, tipo);
                return;
            }

            const resultadoSaldo = await descontarSaldoConsulta(currentUser.id, tipo);
            if (!resultadoSaldo.ok) {
                mostrarErrorSaldoConsulta(resultadoSaldo, tipo);
                return;
            }
            saldoDescontado = !resultadoSaldo.skipped;
        }

        const { error } = await client.from(table).insert([{
            clase_id: claseId,
            user_id: currentUser.id,
            estado: 'confirmada'
        }]);

        if (error) {
            if (saldoDescontado) await devolverSaldoConsulta(currentUser.id, tipo);
            Swal.fire({ icon: 'error', title: 'Error al reservar', text: error.message });
        } else {
            playYogaSound();
            Swal.fire({
                icon: 'success',
                title: '¡Cita Reservada!',
                text: 'Tu profesional te espera.',
                showConfirmButton: false,
                timer: 1500
            });
            await refrescarConsultas(tipo);
        }
    } catch (e) {
        console.error("Error al reservar consulta:", e);
    } finally {
        isReserving = false;
    }
}

async function cancelarConsulta(tipo, reservaId) {
    const res = await Swal.fire({
        title: '¿Cancelar consulta?',
        text: "Se liberará el turno de la consulta.",
        icon: 'warning',
        iconColor: '#D27D60',
        showCancelButton: true,
        confirmButtonColor: '#8C8658',
        cancelButtonColor: '#9ca3af',
        confirmButtonText: 'Sí, cancelar'
    });

    if (res.isConfirmed) {
        const config = getConsultaConfig(tipo);
        const table = config.table;
        const { error } = await client.from(table).delete().eq('id', reservaId);
        if (error) {
            Swal.fire('Error', error.message, 'error');
        } else {
            const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });
            Toast.fire({ icon: 'info', title: 'Consulta cancelada.' });
            await refrescarConsultas(tipo);
        }
    }
}

function renderizarCalendarioPsicologia() {
    const year = currentCalendarMonthPsicologia.getFullYear();
    const month = currentCalendarMonthPsicologia.getMonth();
    const monthNames = [
        window.t('month_0'), window.t('month_1'), window.t('month_2'), window.t('month_3'),
        window.t('month_4'), window.t('month_5'), window.t('month_6'), window.t('month_7'),
        window.t('month_8'), window.t('month_9'), window.t('month_10'), window.t('month_11')
    ];
    
    const label = document.getElementById('psicologia-calendar-month-year');
    if (label) label.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();

    const grid = document.getElementById('psicologia-calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateKey = formatDateLocal(dateObj);
        const isToday = dateObj.getTime() === today.getTime();
        const isPast = dateObj < today;
        const hasSessions = allPsicologiaCache.some(c => {
            const cDate = formatDateLocal(new Date(c.fecha_inicio));
            return cDate === dateKey;
        });
        const isSelected = selectedDatePsicologia === dateKey;

        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20';
        div.textContent = day;
        if (isToday) div.classList.add('today');
        if (hasSessions) div.classList.add('has-psicologia');
        if (isSelected) div.classList.add('selected');
        if (isPast) {
            div.classList.add('disabled');
        } else {
            div.onclick = () => {
                selectedDatePsicologia = dateKey;
                renderizarCalendarioPsicologia();
                renderizarPsicologia();
            };
        }
        grid.appendChild(div);
    }

    const totalCells = grid.children.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }
}

function cambiarMesPsicologia(delta) {
    currentCalendarMonthPsicologia.setMonth(currentCalendarMonthPsicologia.getMonth() + delta);
    renderizarCalendarioPsicologia();
}

function limpiarFiltroFechaPsicologia() {
    selectedDatePsicologia = null;
    renderizarCalendarioPsicologia();
    renderizarPsicologia();
}

function renderizarCalendarioNutricion() {
    const year = currentCalendarMonthNutricion.getFullYear();
    const month = currentCalendarMonthNutricion.getMonth();
    const monthNames = [
        window.t('month_0'), window.t('month_1'), window.t('month_2'), window.t('month_3'),
        window.t('month_4'), window.t('month_5'), window.t('month_6'), window.t('month_7'),
        window.t('month_8'), window.t('month_9'), window.t('month_10'), window.t('month_11')
    ];
    
    const label = document.getElementById('nutricion-calendar-month-year');
    if (label) label.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();

    const grid = document.getElementById('nutricion-calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateKey = formatDateLocal(dateObj);
        const isToday = dateObj.getTime() === today.getTime();
        const isPast = dateObj < today;
        const hasSessions = allNutricionCache.some(c => {
            const cDate = formatDateLocal(new Date(c.fecha_inicio));
            return cDate === dateKey;
        });
        const isSelected = selectedDateNutricion === dateKey;

        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20';
        div.textContent = day;
        if (isToday) div.classList.add('today');
        if (hasSessions) div.classList.add('has-nutricion');
        if (isSelected) div.classList.add('selected');
        if (isPast) {
            div.classList.add('disabled');
        } else {
            div.onclick = () => {
                selectedDateNutricion = dateKey;
                renderizarCalendarioNutricion();
                renderizarNutricion();
            };
        }
        grid.appendChild(div);
    }

    const totalCells = grid.children.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }
}

function cambiarMesNutricion(delta) {
    currentCalendarMonthNutricion.setMonth(currentCalendarMonthNutricion.getMonth() + delta);
    renderizarCalendarioNutricion();
}

function limpiarFiltroFechaNutricion() {
    selectedDateNutricion = null;
    renderizarCalendarioNutricion();
    renderizarNutricion();
}

function getReservasInicioPorFecha(dateKey) {
    const bookings = [];

    allClasesCache.forEach(c => {
        if (c.miReserva && formatDateLocal(new Date(c.fecha_inicio)) === dateKey) {
            bookings.push({
                tipo: 'yoga',
                tipoLabel: profileT('common_class', 'Clase'),
                nombre: c.nombre || profileT('common_class', 'Clase'),
                fecha: new Date(c.fecha_inicio)
            });
        }
    });

    allPsicologiaCache.forEach(c => {
        if (c.miReserva && formatDateLocal(new Date(c.fecha_inicio)) === dateKey) {
            bookings.push({
                tipo: 'psicologia',
                tipoLabel: profileT('common_psychology', 'Psicología'),
                nombre: c.nombre || profileT('common_consultation', 'Consulta'),
                fecha: new Date(c.fecha_inicio)
            });
        }
    });

    allNutricionCache.forEach(c => {
        if (c.miReserva && formatDateLocal(new Date(c.fecha_inicio)) === dateKey) {
            bookings.push({
                tipo: 'nutricion',
                tipoLabel: profileT('common_nutrition', 'Nutrición'),
                nombre: c.nombre || profileT('profile_nutrition_title', 'Consulta Nutrición'),
                fecha: new Date(c.fecha_inicio)
            });
        }
    });

    return bookings.sort((a, b) => a.fecha - b.fecha);
}

function renderizarCalendarioInicio() {
    const year = currentCalendarMonthInicio.getFullYear();
    const month = currentCalendarMonthInicio.getMonth();
    const monthNames = [
        window.t('month_0'), window.t('month_1'), window.t('month_2'), window.t('month_3'),
        window.t('month_4'), window.t('month_5'), window.t('month_6'), window.t('month_7'),
        window.t('month_8'), window.t('month_9'), window.t('month_10'), window.t('month_11')
    ];
    
    const label = document.getElementById('inicio-calendar-month-year');
    if (label) label.textContent = `${monthNames[month]} ${year}`;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();

    const grid = document.getElementById('inicio-calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const prevMonthDays = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const day = prevMonthDays - i;
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateObj = new Date(year, month, day);
        const dateKey = formatDateLocal(dateObj);
        const isToday = dateObj.getTime() === today.getTime();
        const isPast = dateObj < today;
        const isSelected = selectedDateInicio === dateKey;

        const reservasDia = getReservasInicioPorFecha(dateKey);

        const div = document.createElement('div');
        div.className = 'calendar-day inicio-calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 relative';

        const dayNumber = document.createElement('span');
        dayNumber.className = 'calendar-day-number';
        dayNumber.textContent = day;
        div.appendChild(dayNumber);

        if (isToday) div.classList.add('today');
        if (isSelected) div.classList.add('selected');

        if (reservasDia.length > 0) {
            div.classList.add('has-reservations');
            const reservasContainer = document.createElement('div');
            reservasContainer.className = 'calendar-reservation-list';

            reservasDia.slice(0, 2).forEach(b => {
                const hora = formatDisplayTime(b.fecha);
                const pill = document.createElement('div');
                pill.className = `calendar-reservation-pill ${b.tipo}`;
                pill.title = `${b.tipoLabel}: ${b.nombre} · ${hora}`;
                pill.textContent = `${hora} ${b.nombre}`;
                reservasContainer.appendChild(pill);
            });

            if (reservasDia.length > 2) {
                const more = document.createElement('div');
                more.className = 'calendar-reservation-more';
                more.textContent = `+${reservasDia.length - 2} ${profileT('profile_more', 'más')}`;
                reservasContainer.appendChild(more);
            }

            div.appendChild(reservasContainer);
        }

        div.onclick = () => {
            selectedDateInicio = dateKey;
            renderizarCalendarioInicio();
            renderizarConsolidadoDia();
        };

        grid.appendChild(div);
    }

    const totalCells = grid.children.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let day = 1; day <= remainingCells; day++) {
        const div = document.createElement('div');
        div.className = 'calendar-day rounded-lg text-sm font-medium text-cocoa bg-white/60 backdrop-blur-sm border border-white/20 other-month';
        div.textContent = day;
        grid.appendChild(div);
    }
}

function cambiarMesInicio(delta) {
    currentCalendarMonthInicio.setMonth(currentCalendarMonthInicio.getMonth() + delta);
    renderizarCalendarioInicio();
}

function limpiarFiltroFechaInicio() {
    selectedDateInicio = null;
    renderizarCalendarioInicio();
    renderizarConsolidadoDia();
}

function refrescarInicioSiActivo() {
    if (activePublicView !== 'inicio') return;
    renderizarCalendarioInicio();
    renderizarConsolidadoDia();
}

function renderizarConsolidadoDia() {
    const container = document.getElementById('inicio-consolidado-container');
    const emptyState = document.getElementById('inicio-empty-state');
    if (!container) return;

    const bookings = [];

    allClasesCache.forEach(c => {
        if (c.miReserva) {
            bookings.push({
                id: c.id,
                reservaId: c.miReserva.id,
                tipo: 'yoga',
                nombre: c.nombre,
                fecha: new Date(c.fecha_inicio),
                profesional: c.profesionales ? c.profesionales.nombre : 'Staff GEN Yoga',
                profesionalFoto: c.profesionales ? c.profesionales.foto_url : null,
                colorClass: 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20',
                tipoLabel: profileT('common_class', 'Clase'),
                descripcion: c.descripcion || ''
            });
        }
    });

    allPsicologiaCache.forEach(c => {
        if (c.miReserva) {
            bookings.push({
                id: c.id,
                reservaId: c.miReserva.id,
                tipo: 'psicologia',
                nombre: c.nombre || profileT('common_consultation', 'Consulta'),
                fecha: new Date(c.fecha_inicio),
                profesional: c.profesionales ? c.profesionales.nombre : 'Staff GEN',
                profesionalFoto: c.profesionales ? c.profesionales.foto_url : null,
                colorClass: 'bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/20',
                tipoLabel: profileT('common_psychology', 'Psicología'),
                descripcion: c.descripcion || ''
            });
        }
    });

    allNutricionCache.forEach(c => {
        if (c.miReserva) {
            bookings.push({
                id: c.id,
                reservaId: c.miReserva.id,
                tipo: 'nutricion',
                nombre: c.nombre || profileT('profile_nutrition_title', 'Consulta Nutrición'),
                fecha: new Date(c.fecha_inicio),
                profesional: c.profesionales ? c.profesionales.nombre : 'Staff GEN',
                profesionalFoto: c.profesionales ? c.profesionales.foto_url : null,
                colorClass: 'bg-[#8B5CF6]/10 text-[#8B5CF6] border-[#8B5CF6]/20',
                tipoLabel: profileT('common_nutrition', 'Nutrición'),
                descripcion: c.descripcion || ''
            });
        }
    });

    bookings.sort((a, b) => a.fecha - b.fecha);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let bookingsAMostrar = bookings;
    if (selectedDateInicio) {
        bookingsAMostrar = bookings.filter(b => formatDateLocal(b.fecha) === selectedDateInicio);
    } else {
        bookingsAMostrar = bookings.filter(b => b.fecha >= hoy);
    }

    if (bookingsAMostrar.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    container.innerHTML = '';

    const grupos = {};
    bookingsAMostrar.forEach(b => {
        const dateKey = formatDateLocal(b.fecha);
        if (!grupos[dateKey]) grupos[dateKey] = [];
        grupos[dateKey].push(b);
    });

    Object.keys(grupos).sort().forEach(dateKey => {
        const dateObj = new Date(dateKey);
        const diaNombre = formatDisplayWeekday(dateObj);
        const diaNumero = dateObj.getDate();
        const mes = formatDisplayMonth(dateObj);

        const section = document.createElement('div');
        section.className = 'bg-white/90 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg overflow-hidden';

        section.innerHTML = `
            <div class="bg-gradient-to-r from-cocoa/5 to-white px-6 py-4 border-b border-cocoa/5 flex items-center justify-between">
                <div class="flex items-baseline gap-2">
                    <span class="brand-font text-xl font-bold text-cocoa capitalize">${diaNombre}</span>
                    <span class="text-xs font-semibold text-olive bg-olive/10 px-2 py-0.5 rounded-md border border-olive/20">${diaNumero} ${mes}</span>
                </div>
            </div>
            <div id="consolidado-grid-${dateKey}" class="divide-y divide-cocoa/5"></div>
        `;
        container.appendChild(section);

        const grid = section.querySelector(`#consolidado-grid-${dateKey}`);

        grupos[dateKey].forEach(b => {
            const hora = formatDisplayTime(b.fecha);
            
            let cancelAction = '';
            if (b.tipo === 'yoga') {
                cancelAction = `onclick="cancelar(${b.reservaId})"`;
            } else {
                cancelAction = `onclick="cancelarConsulta('${b.tipo}', ${b.reservaId})"`;
            }

            const pAvatar = b.profesionalFoto
                ? `<img src="${escapeHtml(b.profesionalFoto)}" class="w-full h-full object-cover" alt="">`
                : `<div class="w-full h-full bg-olive/5 flex items-center justify-center text-olive text-[10px] font-bold">${escapeHtml(b.profesional.charAt(0))}</div>`;
            const fechaLarga = formatDisplayLongDate(b.fecha);

            const row = document.createElement('div');
            row.className = `inicio-booking-card inicio-booking-${b.tipo}`;

            row.innerHTML = `
                <div class="inicio-booking-main">
                    <div class="inicio-booking-time ${b.tipo}">
                        <span>${escapeHtml(b.tipoLabel)}</span>
                        <strong>${hora}</strong>
                    </div>

                    <div class="inicio-booking-content">
                        <span class="inicio-booking-date">${escapeHtml(fechaLarga)}</span>
                        <h4 class="brand-font inicio-booking-title">${escapeHtml(b.nombre)}</h4>

                        <div class="inicio-booking-meta">
                            <div class="inicio-booking-professional" title="${escapeHtml(profileT('common_professional', 'Profesional'))}">
                                <div class="inicio-booking-avatar">
                                    ${pAvatar}
                                </div>
                                <span>${escapeHtml(b.profesional)}</span>
                            </div>
                            <span class="inicio-booking-status"><i class="ph-fill ph-check-circle"></i> ${escapeHtml(profileT('profile_confirmed', 'Confirmada'))}</span>
                        </div>

                        ${b.descripcion ? `<p class="inicio-booking-description"><i class="ph-bold ph-info"></i> ${escapeHtml(b.descripcion)}</p>` : ''}
                    </div>
                </div>

                <button ${cancelAction} class="inicio-booking-cancel">
                    <i class="ph-bold ph-x"></i> ${escapeHtml(profileT('profile_cancel_booking', 'Cancelar reserva'))}
                </button>
            `;
            grid.appendChild(row);
        });
    });
}

function filtrarProfesionalesVista(especialidad) {
    const btns = document.querySelectorAll('.filtro-prof-btn');
    btns.forEach(btn => btn.classList.remove('active'));

    const activeBtn = document.getElementById(`btn-filtro-prof-${especialidad}`);
    if (activeBtn) activeBtn.classList.add('active');

    renderProfesoresPublic(especialidad);
}

function getProfesionalesConsultaDisponibles(tipo) {
    const isTestUser = (currentUser?.email || '').toLowerCase() === 'profesor@profesor.com';
    const showTestProfesor = isAdmin || isTestUser;
    
    let base = allProfesionalesCache;
    if (!showTestProfesor) {
        base = base.filter(p => p.visible_publico !== false);
    }
    
    let filteredProfs = base.filter(p => getEspecialidadCategorias(p).includes('consultas'));
    
    if (tipo === 'psicologia') {
        filteredProfs = filteredProfs.filter(p => {
            const esp = getEspecialidadTexto(p.especialidad).toLowerCase();
            return esp.includes('consulta') || esp.includes('psico') || esp.includes('terapia') || esp === '';
        });
    } else if (tipo === 'nutricion') {
        filteredProfs = filteredProfs.filter(p => {
            const esp = getEspecialidadTexto(p.especialidad).toLowerCase();
            return esp.includes('consulta') || esp.includes('nutri') || esp.includes('diet') || esp.includes('alimen') || esp === '';
        });
    }

    if (filteredProfs.length === 0) filteredProfs = base;

    if (!isAdmin && esTrabajador() && currentUser?.email) {
        const email = currentUser.email.toLowerCase();
        const propios = filteredProfs.filter(p => (p.email || '').toLowerCase() === email);
        if (propios.length > 0) filteredProfs = propios;
    }

    return filteredProfs;
}

function filtrarConsultasParaTrabajador(clases) {
    if (isAdmin || !esTrabajador() || !currentUser?.email) return clases || [];

    const email = currentUser.email.toLowerCase();
    return (clases || []).filter(c => (c.profesionales?.email || '').toLowerCase() === email);
}

// --- ASIGNACIÓN MANUAL (ADMIN/TRABAJADOR) ---
function tieneAccesoGestionAlumnos() {
    return isAdmin || esTrabajador();
}

window.abrirModalAsignarPlazaAdmin = async function(tipo, claseId) {
    if (!tieneAccesoGestionAlumnos()) return;
    const t = (tipo || 'yoga').toLowerCase();

    if (t === 'psicologia' || t === 'nutricion') {
        return abrirModalAsignarConsulta(t, claseId);
    }

    // Si la clase es de tipo taller (workshop), asignamos con su modal correspondiente
    const clase = allClasesCache.find(c => c.id === claseId);
    if (clase && clase.tipo_clase === 'taller') {
        return abrirModalAsignarTaller(claseId);
    }

    // Por defecto: clases normales (yoga)
    return abrirModalAsignarClaseYoga(claseId);
};

async function abrirModalAsignarClaseYoga(claseId) {
    if (!tieneAccesoGestionAlumnos()) return;

    const { data: clase, error: errClase } = await client.from('clases')
        .select('id, nombre, capacidad_max, profesor_id, profesionales(nombre, apellidos)')
        .eq('id', claseId)
        .single();

    if (errClase) {
        Swal.fire('Error', errClase.message, 'error');
        return;
    }

    const capacidad = toSafeNumber(clase?.capacidad_max) || 1;
    const { data: reservasExistentes, error: reservaError } = await client.from('reservas_yoga')
        .select('id')
        .eq('clase_id', claseId)
        .eq('estado', 'confirmada');

    if (reservaError) {
        Swal.fire('Error', reservaError.message, 'error');
        return;
    }

    if ((reservasExistentes || []).length >= capacidad) {
        Swal.fire('Clase completa', 'Esta clase ya no tiene plazas disponibles.', 'warning');
        await cargarAsistenciasPorClase();
        return;
    }

    let perfiles = [];
    let queryRes = await client.from('profiles')
        .select('id, nombre, apellidos, email, rol, bonos, bono_mensual_activo')
        .order('email');

    if (queryRes.error && /bono_mensual_activo/i.test(queryRes.error.message || '')) {
        console.warn('Falta columna bono_mensual_activo en profiles. Reintentando consulta básica.');
        queryRes = await client.from('profiles')
            .select('id, nombre, apellidos, email, rol, bonos')
            .order('email');
    }

    if (queryRes.error) {
        Swal.fire('Error', 'No se pudieron cargar los usuarios: ' + queryRes.error.message, 'error');
        return;
    }
    perfiles = queryRes.data || [];

    const clientes = perfiles.filter(esClienteAsignable);
    if (clientes.length === 0) {
        Swal.fire('Sin clientes', 'No hay clientes disponibles para asignar.', 'info');
        return;
    }

    const options = clientes.map(cliente => {
        const label = getNombreCompletoPerfil(cliente, 'Cliente');
        const saldo = toSafeNumber(cliente.bonos);
        const tieneBonoMensual = 'bono_mensual_activo' in cliente ? !!cliente.bono_mensual_activo : false;
        const mensual = tieneBonoMensual ? 'Mensual Activo' : 'Mensual Inactivo';
        return `<option value="${cliente.id}">${escapeHtml(label)} · ${escapeHtml(getIdentificadorPerfil(cliente))} · bonos ind: ${saldo} · ${mensual}</option>`;
    }).join('');

    let grupoBtnHtml = '';
    if (clase?.profesor_id && clase?.profesionales) {
        const profNombre = `${clase.profesionales.nombre || ''} ${clase.profesionales.apellidos || ''}`.trim() || 'Profesor';
        grupoBtnHtml = `
            <div class="pt-3 border-t border-cocoa/5 mt-4">
                <button type="button" id="btn-swal-cargar-grupo" class="w-full py-2.5 bg-olive/10 hover:bg-olive/20 text-olive border border-olive/20 font-bold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-2">
                    <i class="ph-bold ph-users-three text-sm"></i> Cargar Grupo de ${escapeHtml(profNombre)}
                </button>
            </div>
        `;
    }

    const result = await Swal.fire({
        title: 'Asignar alumno a clase',
        html: `
            <div class="text-left space-y-3">
                <label class="text-xs font-bold uppercase text-gray-500 block">Usuario</label>
                <select id="swal-cliente-clase" class="w-full px-3 py-3 border rounded-xl focus:ring-2 outline-none text-sm">
                    <option value="" disabled selected>Selecciona un usuario</option>
                    ${options}
                </select>
                <p class="text-xs text-gray-400">Se descontará de su bono mensual (si tiene saldo) o de sus clases sueltas al confirmar.</p>
                ${grupoBtnHtml}
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Asignar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#1a4d4f',
        focusConfirm: false,
        didOpen: () => {
            const btnCargar = document.getElementById('btn-swal-cargar-grupo');
            if (btnCargar) {
                btnCargar.addEventListener('click', () => {
                    Swal.close();
                    cargarGrupoEnClaseCreada(claseId, clase.profesor_id, `${clase.profesionales.nombre || ''} ${clase.profesionales.apellidos || ''}`.trim());
                });
            }
        },
        preConfirm: () => {
            const select = document.getElementById('swal-cliente-clase');
            if (!select?.value) {
                Swal.showValidationMessage('Selecciona un usuario');
                return false;
            }
            return select.value;
        }
    });

    if (!result.isConfirmed || !result.value) return;

    Swal.fire({ title: 'Asignando...', didOpen: () => Swal.showLoading() });
    const { error: errAssign } = await client.rpc('reservar_con_bono', {
        p_clase_id: claseId,
        p_user_id: result.value
    });
    Swal.close();

    if (errAssign) {
        Swal.fire('Error', errAssign.message, 'error');
        return;
    }

    Swal.fire({ icon: 'success', title: 'Asignado', text: 'La plaza queda reservada.', timer: 1200, showConfirmButton: false });
    await cargarHorarios();
    await cargarAsistenciasPorClase();
}

async function cargarGrupoEnClaseCreada(claseId, profesorId, profesorNombre) {
    if (!tieneAccesoGestionAlumnos()) return;

    const confirmResult = await Swal.fire({
        title: '¿Asignar grupo completo?',
        text: `¿Estás seguro de que quieres inscribir a todos los alumnos del grupo de ${profesorNombre} en esta clase? Se descontará un bono a cada alumno si corresponde.`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, asignar grupo',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#1a4d4f',
        cancelButtonColor: '#7F5040'
    });

    if (!confirmResult.isConfirmed) return;

    Swal.fire({
        title: 'Buscando alumnos del grupo...',
        didOpen: () => Swal.showLoading()
    });

    const { data: groupMembers, error: errGroup } = await client
        .from('grupos_profesionales')
        .select('alumno_id')
        .eq('profesional_id', profesorId);

    if (errGroup) {
        Swal.close();
        Swal.fire('Error', 'No se pudo cargar el grupo del profesor: ' + errGroup.message, 'error');
        return;
    }

    if (!groupMembers || groupMembers.length === 0) {
        Swal.close();
        Swal.fire('Grupo vacío', 'Este profesor no tiene ningún alumno asignado en su grupo de alumnos.', 'info');
        return;
    }

    const studentIds = groupMembers.map(m => m.alumno_id);
    const totalAlumnos = studentIds.length;
    let inscritosOk = 0;
    const failedReservations = [];

    Swal.fire({
        title: 'Inscribiendo alumnos...',
        html: `Progreso: <b>0</b> de <b>${totalAlumnos}</b> alumnos procesados.`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
    });

    for (let i = 0; i < totalAlumnos; i++) {
        const studentId = studentIds[i];
        
        Swal.update({
            html: `Progreso: <b>${i}</b> de <b>${totalAlumnos}</b> alumnos procesados.`
        });

        const { error: errRes } = await client.rpc('reservar_con_bono', {
            p_clase_id: claseId,
            p_user_id: studentId
        });

        if (errRes) {
            failedReservations.push({
                alumno: studentId,
                error: errRes.message
            });
        } else {
            inscritosOk++;
        }
    }

    Swal.close();

    const studentNames = {};
    allUsersCache.forEach(u => {
        const fullName = `${u.nombre || ''} ${u.apellidos || ''}`.trim();
        studentNames[u.id] = fullName || u.email || u.id;
    });

    let resultHtml = `Se han procesado ${totalAlumnos} alumnos:<br>`;
    if (inscritosOk > 0) {
        resultHtml += `<span class="text-emerald-600 font-bold">• ${inscritosOk} inscritos con éxito.</span><br>`;
    }

    if (failedReservations.length > 0) {
        const details = failedReservations
            .map(fr => `• ${studentNames[fr.alumno] || fr.alumno}: ${fr.error}`)
            .join('<br>');
        resultHtml += `<div class="text-left mt-3 text-xs bg-red-50 border border-red-100 p-3 rounded-xl max-h-40 overflow-y-auto"><span class="font-bold text-red-700 block mb-1">Alumnos que no pudieron ser inscritos:</span>${details}</div>`;
        
        Swal.fire({
            icon: 'warning',
            title: 'Inscripción del grupo completada con avisos',
            html: resultHtml,
            confirmButtonColor: '#1a4d4f'
        });
    } else {
        Swal.fire({
            icon: 'success',
            title: '¡Grupo asignado con éxito!',
            text: `Todos los alumnos (${inscritosOk}) se han inscrito correctamente y sus bonos han sido descontados.`,
            confirmButtonColor: '#1a4d4f'
        });
    }

    await cargarHorarios();
    await cargarAsistenciasPorClase();
}

async function abrirModalAsignarConsulta(tipo, claseId) {
    if (!tieneAccesoConsultasAdmin()) return;

    const config = getConsultaConfig(tipo);
    const { data: reservasExistentes, error: reservaError } = await client.from(config.table)
        .select('id')
        .eq('clase_id', claseId)
        .eq('estado', 'confirmada');

    if (reservaError) {
        Swal.fire('Error', reservaError.message, 'error');
        return;
    }

    if ((reservasExistentes || []).length > 0) {
        Swal.fire('Consulta ocupada', 'Este hueco ya tiene un cliente asignado.', 'warning');
        await refrescarConsultas(tipo);
        return;
    }

    const { data: perfiles, error } = await client.from('profiles')
        .select('id, nombre, apellidos, email, rol')
        .order('email');

    if (error) {
        Swal.fire('Error', 'No se pudieron cargar los clientes.', 'error');
        return;
    }

    const clientes = (perfiles || []).filter(esClienteAsignable);
    if (clientes.length === 0) {
        Swal.fire('Sin clientes', 'No hay clientes disponibles para asignar.', 'info');
        return;
    }

    const options = clientes.map(cliente => {
        const label = getNombreCompletoPerfil(cliente, 'Cliente');
        return `<option value="${cliente.id}">${escapeHtml(label)} · ${escapeHtml(getIdentificadorPerfil(cliente))}</option>`;
    }).join('');

    const result = await Swal.fire({
        title: `Asignar cliente a ${config.label}`,
        html: `
            <div class="text-left space-y-3">
                <label class="text-xs font-bold uppercase text-gray-500 block">Cliente</label>
                <select id="swal-cliente-consulta" class="w-full px-3 py-3 border rounded-xl focus:ring-2 outline-none text-sm">
                    <option value="" disabled selected>Selecciona un cliente</option>
                    ${options}
                </select>
                <p class="text-xs text-gray-400">Esta asignación de consulta no consume bonos.</p>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Asignar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: config.color,
        focusConfirm: false,
        preConfirm: () => {
            const select = document.getElementById('swal-cliente-consulta');
            if (!select?.value) {
                Swal.showValidationMessage('Selecciona un cliente');
                return false;
            }
            return select.value;
        }
    });

    if (result.isConfirmed && result.value) {
        await asignarClienteAConsulta(tipo, claseId, result.value);
    }
}

async function asignarClienteAConsulta(tipo, claseId, userId) {
    if (isReserving) return;

    const config = getConsultaConfig(tipo);
    try {
        isReserving = true;

        const { error } = await client.from(config.table).insert([{
            clase_id: claseId,
            user_id: userId,
            estado: 'confirmada'
        }]);

        if (error) {
            Swal.fire('Error al asignar', error.message, 'error');
            return;
        }

        Swal.fire({
            icon: 'success',
            title: 'Cliente asignado',
            text: 'El hueco queda reservado.',
            showConfirmButton: false,
            timer: 1500
        });
        await refrescarConsultas(tipo);
    } finally {
        isReserving = false;
    }
}

// Las funciones legacy de carga individual de consultas admin han sido eliminadas para usar la vista unificada.

function cerrarModalCrearConsulta() {
    const modal = document.getElementById('modal-crear-consulta');
    if (modal) modal.classList.add('hidden');
    const form = document.getElementById('form-crear-consulta');
    if (form) form.reset();
}

async function guardarConsultaAdmin(e) {
    if (e) e.preventDefault();

    if (!tieneAccesoConsultasAdmin()) {
        Swal.fire('Sin permiso', 'No puedes crear consultas.', 'warning');
        return;
    }

    const tipo = document.getElementById('consulta-tipo').value;
    const profesorId = document.getElementById('consulta-profesor-id').value;
    const fecha = document.getElementById('consulta-fecha').value;
    const horaInicio = document.getElementById('consulta-hora-inicio').value;
    const duracion = parseInt(document.getElementById('consulta-duracion').value);
    const notas = document.getElementById('consulta-notas').value;

    if (!profesorId) {
        Swal.fire('Error', 'Debes seleccionar un profesional', 'error');
        return;
    }

    if (!isAdmin && esTrabajador()) {
        const permitidos = getProfesionalesConsultaDisponibles(tipo).map(p => String(p.id));
        if (permitidos.length > 0 && !permitidos.includes(String(profesorId))) {
            Swal.fire('Sin permiso', 'Solo puedes crear consultas para tu profesional vinculado.', 'warning');
            return;
        }
    }

    const repeatEnabled = !!document.getElementById('consulta-repeat-enabled')?.checked;
    const repeatEveryWeeks = parseInt(document.getElementById('consulta-repeat-every')?.value || '1', 10);
    let repeatCount = parseInt(document.getElementById('consulta-repeat-count')?.value || '1', 10);
    if (!repeatEnabled) repeatCount = 1;
    repeatCount = Math.max(1, Math.min(52, Number.isFinite(repeatCount) ? repeatCount : 1));

    const fechaInicio = new Date(`${fecha}T${horaInicio}`);

    Swal.fire({
        title: repeatCount > 1 ? 'Creando consultas...' : 'Creando consulta...',
        didOpen: () => Swal.showLoading()
    });

    const nombreClase = tipo === 'psicologia' ? 'Consulta Psicología' : 'Consulta Nutrición';

    const inserts = [];
    for (let i = 0; i < repeatCount; i++) {
        const start = new Date(fechaInicio);
        start.setDate(start.getDate() + (i * 7 * repeatEveryWeeks));
        const end = new Date(start.getTime() + duracion * 60000);
        inserts.push({
            nombre: nombreClase,
            fecha_inicio: start.toISOString(),
            fecha_fin: end.toISOString(),
            capacidad_max: 1,
            profesor_id: profesorId,
            tipo_clase: tipo,
            descripcion: notas,
            duracion_minutos: duracion
        });
    }

    const { data, error } = await client.from('clases').insert(inserts).select();

    Swal.close();

    if (error) {
        Swal.fire({
            icon: 'error',
            title: 'Error al crear consulta',
            text: error.message
        });
    } else {
        cerrarModalCrearConsulta();
        Swal.fire({
            icon: 'success',
            title: repeatCount > 1 ? '¡Consultas creadas!' : '¡Consulta creada!',
            text: repeatCount > 1 ? `Los turnos han sido añadidos.` : `El turno ha sido añadido.`,
            showConfirmButton: false,
            timer: 2000
        });
        if (tipo === 'psicologia') {
            await cargarPsicologia();
        } else {
            await cargarNutricion();
        }
        await cargarConsultasAdmin();
    }
}

// --- NUEVAS FUNCIONES DE CONSULTAS Y TALLERES ---

function actualizarProfesoresSelectConsulta(tipo) {
    const select = document.getElementById('consulta-profesor-id');
    if (select) {
        select.innerHTML = '<option value="" disabled selected>Selecciona Profesional</option>';
        
        const filteredProfs = getProfesionalesConsultaDisponibles(tipo);

        filteredProfs.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nombre + (p.especialidad ? ` (${getEspecialidadTexto(p.especialidad)})` : '');
            select.appendChild(opt);
        });

        if (filteredProfs.length === 1) {
            select.value = filteredProfs[0].id;
        }
    }
}

let filtroConsultasActual = 'todas';

async function cargarConsultasAdmin() {
    const container = document.getElementById('admin-consultas-container');
    const emptyState = document.getElementById('admin-consultas-empty');
    if (!container) return;

    container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
      <i class="ph-duotone ph-spinner animate-spin text-4xl text-olive"></i>
      <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Cargando consultas...</span>
    </div>`;

    const { data: clasesData, error: errClases } = await client.from('clases')
        .select('*, profesionales(*)')
        .in('tipo_clase', ['psicologia', 'nutricion'])
        .order('fecha_inicio');

    if (errClases) {
        console.error(errClases);
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    const clases = filtrarConsultasParaTrabajador(clasesData || []);

    if (!clases || clases.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const claseIds = clases.map(c => c.id);
    const [reservasPsicoRes, reservasNutriRes, perfilesRes] = await Promise.all([
        client.from('reservas_psicologia').select('*').in('clase_id', claseIds),
        client.from('reservas_nutricion').select('*').in('clase_id', claseIds),
        client.from('profiles').select('id, nombre, apellidos, email')
    ]);

    const perfilesMap = {};
    (perfilesRes.data || []).forEach(p => { perfilesMap[p.id] = p; });

    const reservasMap = {}; // clase_id => reserva (confirmada)
    (reservasPsicoRes.data || []).forEach(r => {
        if (r.estado === 'confirmada') reservasMap[r.clase_id] = { ...r, tipo: 'psicologia' };
    });
    (reservasNutriRes.data || []).forEach(r => {
        if (r.estado === 'confirmada') reservasMap[r.clase_id] = { ...r, tipo: 'nutricion' };
    });

    // Guardar en variables globales/window para renderizar con filtros
    window.allConsultasAdminCache = clases;
    window.allConsultasAdminReservasMap = reservasMap;
    window.allConsultasAdminPerfilesMap = perfilesMap;

    renderizarConsultasAdmin();
}

function renderizarConsultasAdmin() {
    const container = document.getElementById('admin-consultas-container');
    const emptyState = document.getElementById('admin-consultas-empty');
    if (!container || !window.allConsultasAdminCache) return;

    container.innerHTML = '';

    const filtradas = window.allConsultasAdminCache.filter(c => {
        if (filtroConsultasActual === 'todas') return true;
        return c.tipo_clase === filtroConsultasActual;
    });

    if (filtradas.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    filtradas.forEach(c => {
        const hora = formatDisplayTime(c.fecha_inicio);
        const fecha = formatDisplayLongDate(c.fecha_inicio);
        const profName = c.profesionales ? c.profesionales.nombre : 'Staff Q19';
        
        const reserva = window.allConsultasAdminReservasMap[c.id];
        let alumnoHTML = '';

        if (reserva) {
            const perfil = window.allConsultasAdminPerfilesMap[reserva.user_id] || {};
            const nombre = perfil.nombre || '';
            const apellidos = perfil.apellidos || '';
            const email = perfil.email || 'Sin email';

            alumnoHTML = `
                <div class="mt-4 flex items-center justify-between p-4 bg-sand/10 border border-cocoa/10 rounded-2xl">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full flex items-center justify-center bg-cocoa/10 text-cocoa font-bold text-sm">
                            ${(nombre ? nombre[0] : '?').toUpperCase()}
                        </div>
                        <div class="flex flex-col">
                            <span class="text-sm font-bold text-gray-900">${nombre} ${apellidos}</span>
                            <span class="text-xs text-gray-500">${email}</span>
                        </div>
                    </div>
                    <button onclick="cancelarConsulta('${c.tipo_clase}', ${reserva.id})" class="text-xs font-bold text-red-500 hover:underline">
                        Cancelar Reserva
                    </button>
                </div>`;
        } else {
            alumnoHTML = `
                <div class="mt-4 px-4 py-3 bg-gray-50 border border-dashed border-gray-200 rounded-xl text-sm text-gray-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <i class="ph-bold ph-calendar-blank"></i>
                        <span>Disponible (sin reservar)</span>
                    </div>
                    <button onclick="abrirModalAsignarConsulta('${c.tipo_clase}', ${c.id})" class="inline-flex items-center justify-center gap-2 bg-cocoa hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition">
                        <i class="ph-bold ph-user-plus"></i> Asignar cliente
                    </button>
                </div>`;
        }

        const tagColor = c.tipo_clase === 'psicologia' 
            ? 'text-blue-600 bg-blue-50 border-blue-100' 
            : 'text-purple-600 bg-purple-50 border-purple-100';
        const tagLabel = c.tipo_clase === 'psicologia' ? 'Psicología' : 'Nutrición';

        const card = document.createElement('div');
        card.className = 'bg-white rounded-3xl border border-gray-100 p-6 shadow-sm';
        card.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-xs font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide border ${tagColor}">${tagLabel}</span>
                        <span class="text-xs font-bold text-gray-400">${c.duracion_minutos} min</span>
                    </div>
                    <h3 class="brand-font text-xl font-bold text-gray-900">${c.nombre || 'Consulta Individual'}</h3>
                    <p class="text-sm text-gray-500 capitalize mt-1"><i class="ph-bold ph-calendar"></i> ${fecha} - ${hora}</p>
                    <p class="text-xs text-gray-400 mt-1"><i class="ph-bold ph-user-circle"></i> Profesional: ${profName}</p>
                    ${c.descripcion ? `<p class="text-xs text-gray-400 mt-1"><i class="ph-bold ph-info"></i> Notas: ${c.descripcion}</p>` : ''}
                </div>
                <div class="flex gap-2">
                    <button onclick="borrarConsultaAdmin('${c.tipo_clase}', ${c.id})" class="text-gray-300 hover:text-red-500 p-2 rounded-lg transition" title="Eliminar Turno">
                        <i class="ph-bold ph-trash text-lg"></i>
                    </button>
                </div>
            </div>
            ${alumnoHTML}
        `;
        container.appendChild(card);
    });
}

function filtrarConsultasAdmin(filtro) {
    filtroConsultasActual = filtro;
    
    ['todas', 'psicologia', 'nutricion'].forEach(f => {
        const btn = document.getElementById(`consulta-filter-${f}`);
        if (btn) {
            if (f === filtro) {
                btn.className = "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-cocoa/10 bg-cocoa text-white shadow-sm";
            } else {
                btn.className = "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest border border-cocoa/10 bg-white/70 text-cocoa hover:bg-white transition";
            }
        }
    });

    renderizarConsultasAdmin();
}

async function cargarTalleresAdmin() {
    const container = document.getElementById('admin-talleres-container');
    const emptyState = document.getElementById('admin-talleres-empty');
    if (!container) return;

    container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
      <i class="ph-duotone ph-spinner animate-spin text-4xl text-olive"></i>
      <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Cargando talleres...</span>
    </div>`;

    const { data: clases, error: errClases } = await client.from('clases')
        .select('*, profesionales(*)')
        .eq('tipo_clase', 'taller')
        .order('fecha_inicio');

    if (errClases) {
        console.error(errClases);
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (!clases || clases.length === 0) {
        container.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    const claseIds = clases.map(c => c.id);
    const { data: reservas, error: errRes } = await client.from('reservas_yoga').select('*').in('clase_id', claseIds);
    const { data: perfiles } = await client.from('profiles').select('id, nombre, apellidos, email');

    const perfilesMap = {};
    (perfiles || []).forEach(p => { perfilesMap[p.id] = p; });

    const reservasMap = {}; // clase_id => [reservas]
    (reservas || []).forEach(r => {
        if (r.estado === 'confirmada') {
            if (!reservasMap[r.clase_id]) reservasMap[r.clase_id] = [];
            reservasMap[r.clase_id].push(r);
        }
    });

    container.innerHTML = '';

    clases.forEach(c => {
        const hora = formatDisplayTime(c.fecha_inicio);
        const fecha = formatDisplayLongDate(c.fecha_inicio);
        const profName = c.profesionales ? c.profesionales.nombre : 'Staff Q19';
        
        const resClase = reservasMap[c.id] || [];
        const ocupadas = resClase.length;
        
        let alumnosHTML = '';
        if (ocupadas > 0) {
            alumnosHTML = `
                <div class="mt-4 border-t border-cocoa/5 pt-4">
                    <span class="text-[10px] font-bold text-cocoa/40 uppercase tracking-widest mb-2 block">Alumnos Inscritos (${ocupadas}/${c.capacidad_max})</span>
                    <div class="space-y-2">
                        ${resClase.map(r => {
                            const perfil = perfilesMap[r.user_id] || {};
                            const nombre = perfil.nombre || '';
                            const apellidos = perfil.apellidos || '';
                            const email = perfil.email || 'Sin email';
                            return `
                                <div class="flex items-center justify-between p-2.5 bg-sand/5 border border-cocoa/5 rounded-xl text-xs">
                                    <div class="flex items-center gap-2">
                                        <div class="w-6 h-6 rounded-full flex items-center justify-center bg-cocoa/10 text-cocoa font-bold text-[10px]">
                                            ${(nombre ? nombre[0] : '?').toUpperCase()}
                                        </div>
                                        <span class="font-bold text-gray-900">${nombre} ${apellidos}</span>
                                        <span class="text-gray-400">(${email})</span>
                                    </div>
                                    <button onclick="cancelarReservaTaller(${r.id})" class="text-red-500 font-bold hover:underline">Eliminar</button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>`;
        } else {
            alumnosHTML = `
                <div class="mt-4 px-4 py-3 bg-gray-50 border border-dashed border-gray-200 rounded-xl text-sm text-gray-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <i class="ph-bold ph-calendar-blank"></i>
                        <span>Disponible (${ocupadas}/${c.capacidad_max} plazas ocupadas)</span>
                    </div>
                    <button onclick="abrirModalAsignarTaller(${c.id})" class="inline-flex items-center justify-center gap-2 bg-cocoa hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition">
                        <i class="ph-bold ph-user-plus"></i> Inscribir alumno
                    </button>
                </div>`;
        }

        const card = document.createElement('div');
        card.className = 'bg-white rounded-3xl border border-gray-100 p-6 shadow-sm';
        card.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div>
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-xs font-bold text-orange-600 bg-orange-50 border border-orange-100 px-2.5 py-1 rounded-lg uppercase tracking-wide">Taller</span>
                        <span class="text-xs font-bold text-gray-400">${c.duracion_minutos} min</span>
                    </div>
                    <h3 class="brand-font text-xl font-bold text-gray-900">${c.nombre || 'Taller'}</h3>
                    <p class="text-sm text-gray-500 capitalize mt-1"><i class="ph-bold ph-calendar"></i> ${fecha} - ${hora}</p>
                    <p class="text-xs text-gray-400 mt-1"><i class="ph-bold ph-user-circle"></i> Instructor: ${profName}</p>
                    ${c.descripcion ? `<p class="text-xs text-gray-400 mt-1"><i class="ph-bold ph-info"></i> Notas: ${c.descripcion}</p>` : ''}
                </div>
                <div class="flex gap-2">
                    <button onclick="borrarTallerAdmin(${c.id})" class="text-gray-300 hover:text-red-500 p-2 rounded-lg transition" title="Eliminar Taller">
                        <i class="ph-bold ph-trash text-lg"></i>
                    </button>
                </div>
            </div>
            ${alumnosHTML}
        `;
        container.appendChild(card);
    });
}

async function abrirModalAsignarTaller(claseId) {
    const { data: perfiles, error } = await client.from('profiles')
        .select('id, nombre, apellidos, email, rol')
        .order('email');

    if (error) {
        Swal.fire('Error', 'No se pudieron cargar los clientes.', 'error');
        return;
    }

    const clientes = (perfiles || []).filter(esClienteAsignable);
    if (clientes.length === 0) {
        Swal.fire('Sin clientes', 'No hay clientes disponibles para asignar.', 'info');
        return;
    }

    const options = clientes.map(cliente => {
        const label = getNombreCompletoPerfil(cliente, 'Cliente');
        return `<option value="${cliente.id}">${escapeHtml(label)} · ${escapeHtml(getIdentificadorPerfil(cliente))}</option>`;
    }).join('');

    const result = await Swal.fire({
        title: 'Asignar alumno a taller',
        html: `
            <div class="text-left space-y-3">
                <label class="text-xs font-bold uppercase text-gray-500 block">Usuario</label>
                <select id="swal-cliente-taller" class="w-full px-3 py-3 border rounded-xl focus:ring-2 outline-none text-sm">
                    <option value="" disabled selected>Selecciona un usuario</option>
                    ${options}
                </select>
                <p class="text-xs text-gray-400">Esta inscripción de taller es gratuita y no consume bonos.</p>
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Asignar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#1a4d4f',
        focusConfirm: false,
        preConfirm: () => {
            const select = document.getElementById('swal-cliente-taller');
            if (!select?.value) {
                Swal.showValidationMessage('Selecciona un usuario');
                return false;
            }
            return select.value;
        }
    });

    if (!result.isConfirmed || !result.value) return;

    Swal.fire({ title: 'Asignando...', didOpen: () => Swal.showLoading() });
    const { error: errAssign } = await client.from('reservas_yoga').insert([{
        clase_id: claseId,
        user_id: result.value,
        estado: 'confirmada',
        usado_bono_mensual: false
    }]);
    Swal.close();

    if (errAssign) {
        Swal.fire('Error', errAssign.message, 'error');
        return;
    }

    Swal.fire({ icon: 'success', title: 'Asignado', text: 'El alumno ha sido inscrito en el taller.', timer: 1200, showConfirmButton: false });
    await cargarTalleresAdmin();
}

async function cancelarReservaTaller(reservaId) {
    const res = await Swal.fire({
        title: '¿Eliminar alumno del taller?',
        text: 'Esta acción cancelará la inscripción del alumno en el taller. No requiere devolución de bonos.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sí, eliminar'
    });

    if (res.isConfirmed) {
        Swal.fire({ title: 'Cancelando reserva...', didOpen: () => Swal.showLoading() });
        const { error } = await client.from('reservas_yoga').delete().eq('id', reservaId);
        Swal.close();
        if (error) {
            Swal.fire('Error', error.message, 'error');
        } else {
            Swal.fire({ icon: 'success', title: 'Reserva cancelada', showConfirmButton: false, timer: 1500 });
            await cargarTalleresAdmin();
        }
    }
}

async function abrirModalCrearTaller() {
    const modal = document.getElementById('modal-crear-taller');
    if (!modal) return;
    modal.classList.remove('hidden');

    // Reset repetición
    const repEnabled = document.getElementById('taller-repeat-enabled');
    const repOptions = document.getElementById('taller-repeat-options');
    if (repEnabled) repEnabled.checked = false;
    if (repOptions) repOptions.classList.add('hidden');

    const hoy = new Date().toISOString().split('T')[0];
    if (datePickerTallerInstance) {
        datePickerTallerInstance.set('minDate', hoy);
        datePickerTallerInstance.setDate(hoy);
    } else {
        document.getElementById('taller-fecha').value = hoy;
    }

    const ahora = new Date();
    const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    document.getElementById('taller-hora-inicio').value = horaActual;

    // Populate professionals select
    const select = document.getElementById('taller-profesor-id');
    if (select) {
        select.innerHTML = '<option value="" disabled selected>Selecciona Instructor</option>';
        
        const talleresProfs = (allProfesionalesCache || []).filter(p => getEspecialidadCategorias(p).includes('talleres'));
        talleresProfs.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nombre + (p.especialidad ? ` (${getEspecialidadTexto(p.especialidad)})` : '');
            select.appendChild(opt);
        });
    }
}

function cerrarModalCrearTaller() {
    const modal = document.getElementById('modal-crear-taller');
    if (modal) modal.classList.add('hidden');
    const form = document.getElementById('form-crear-taller');
    if (form) form.reset();
}

async function guardarTallerAdmin(e) {
    if (e) e.preventDefault();

    if (!tieneAccesoConsultasAdmin()) {
        Swal.fire('Sin permiso', 'No puedes crear talleres.', 'warning');
        return;
    }

    const nombre = document.getElementById('taller-nombre').value;
    const profesorId = document.getElementById('taller-profesor-id').value;
    const fecha = document.getElementById('taller-fecha').value;
    const horaInicio = document.getElementById('taller-hora-inicio').value;
    const duracion = parseInt(document.getElementById('taller-duracion').value);
    const notas = document.getElementById('taller-notas').value;
    const capacidad = parseInt(document.getElementById('taller-capacidad').value) || 15;

    if (!profesorId) {
        Swal.fire('Error', 'Debes seleccionar un instructor', 'error');
        return;
    }

    const repeatEnabled = !!document.getElementById('taller-repeat-enabled')?.checked;
    const repeatEveryWeeks = parseInt(document.getElementById('taller-repeat-every')?.value || '1', 10);
    let repeatCount = parseInt(document.getElementById('taller-repeat-count')?.value || '1', 10);
    if (!repeatEnabled) repeatCount = 1;
    repeatCount = Math.max(1, Math.min(52, Number.isFinite(repeatCount) ? repeatCount : 1));

    const fechaInicio = new Date(`${fecha}T${horaInicio}`);

    Swal.fire({
        title: repeatCount > 1 ? 'Creando talleres...' : 'Creando taller...',
        didOpen: () => Swal.showLoading()
    });

    const inserts = [];
    for (let i = 0; i < repeatCount; i++) {
        const start = new Date(fechaInicio);
        start.setDate(start.getDate() + (i * 7 * repeatEveryWeeks));
        const end = new Date(start.getTime() + duracion * 60000);
        inserts.push({
            nombre: nombre,
            fecha_inicio: start.toISOString(),
            fecha_fin: end.toISOString(),
            capacidad_max: capacidad,
            profesor_id: profesorId,
            tipo_clase: 'taller',
            descripcion: notas,
            duracion_minutos: duracion
        });
    }

    // Validar que los talleres solo se programen en fin de semana (Sábado y Domingo)
    for (const item of inserts) {
        const d = new Date(item.fecha_inicio);
        const day = d.getDay(); // 0 is Sunday, 6 is Saturday
        if (day !== 0 && day !== 6) {
            Swal.fire('Día no permitido', 'Los talleres solo se pueden programar los fines de semana (Sábado y Domingo). Por favor, selecciona un día de fin de semana.', 'error');
            return;
        }
    }

    const { data, error } = await client.from('clases').insert(inserts).select();

    Swal.close();

    if (error) {
        Swal.fire({
            icon: 'error',
            title: 'Error al crear taller',
            text: error.message
        });
    } else {
        cerrarModalCrearTaller();
        Swal.fire({
            icon: 'success',
            title: repeatCount > 1 ? '¡Talleres creados!' : '¡Taller creado!',
            text: repeatCount > 1 ? `Los talleres han sido añadidos.` : `El taller ha sido añadido.`,
            showConfirmButton: false,
            timer: 2000
        });
        await cargarTalleresAdmin();
    }
}

async function borrarTallerAdmin(id) {
    if (!tieneAccesoConsultasAdmin()) return;

    const res = await Swal.fire({
        title: '¿Eliminar taller?',
        text: 'Esta acción no se puede deshacer. Se cancelarán las reservas asociadas.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Sí, borrar'
    });

    if (res.isConfirmed) {
        Swal.fire({ title: 'Eliminando taller...', didOpen: () => Swal.showLoading() });
        const { error } = await client.from('clases').delete().eq('id', id);
        Swal.close();
        if (error) {
            Swal.fire('Error', error.message, 'error');
        } else {
            Swal.fire({ icon: 'success', title: 'Taller eliminado', showConfirmButton: false, timer: 1500 });
            await cargarTalleresAdmin();
        }
    }
}

// React to language change dynamically
window.addEventListener('languageChanged', () => {
    if (typeof syncFlatpickrLocales === 'function') {
        try { syncFlatpickrLocales(); } catch(e){}
    }
    if (typeof renderSaldosCliente === 'function') {
        try { renderSaldosCliente(); } catch(e){}
    }
    if (typeof actualizarOpcionesFiltrosClases === 'function') {
        try { actualizarOpcionesFiltrosClases(); } catch(e){}
    }
    if (typeof renderizarCalendario === 'function') {
        try { renderizarCalendario(); } catch(e){}
    }
    if (typeof renderizarClases === 'function') {
        try { renderizarClases(); } catch(e){}
    }
    if (typeof renderizarCalendarioProfesor === 'function') {
        try { renderizarCalendarioProfesor(); } catch(e){}
    }
    if (typeof renderizarAgendaProfesor === 'function') {
        try { renderizarAgendaProfesor(); } catch(e){}
    }
    if (typeof renderizarCalendarioPsicologia === 'function') {
        try { renderizarCalendarioPsicologia(); } catch(e){}
    }
    if (typeof renderizarPsicologia === 'function') {
        try { renderizarPsicologia(); } catch(e){}
    }
    if (typeof renderizarCalendarioNutricion === 'function') {
        try { renderizarCalendarioNutricion(); } catch(e){}
    }
    if (typeof renderizarNutricion === 'function') {
        try { renderizarNutricion(); } catch(e){}
    }
    if (typeof renderizarCalendarioInicio === 'function') {
        try { renderizarCalendarioInicio(); } catch(e){}
    }
    if (typeof renderizarConsolidadoDia === 'function') {
        try { renderizarConsolidadoDia(); } catch(e){}
    }
    if (typeof renderizarAsistenciasPorClase === 'function') {
        try { renderizarAsistenciasPorClase(); } catch(e){}
    }
    if (typeof renderProfesoresPublic === 'function') {
        try { renderProfesoresPublic(); } catch(e){}
    }
});
