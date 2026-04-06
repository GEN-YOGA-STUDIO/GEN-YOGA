// --- 1. CONFIGURACIÓN ---
const SUPA_URL = 'https://jkjifmrrlyncuwpjhxvk.supabase.co';
const SUPA_KEY = 'sb_publishable_xnIELom1ouXaBDJNYaWDAQ_VJNjlnIK';
const client = window.supabase.createClient(SUPA_URL, SUPA_KEY);

let currentUser = null;
let isAdmin = false;
let userBonos = 0;
let allUsersCache = [];
let allClasesCache = [];
let selectedDate = null;
let currentCalendarMonth = new Date();
let allConfigCache = [];
let allProfesoresCache = [];
let datePickerInstance = null;

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

// --- 3. APP INIT & PROFILE ---

function formatDateLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function initApp() {
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');

    // Init Flatpickr
    datePickerInstance = flatpickr("#clase-fecha", {
        locale: "es",
        dateFormat: "Y-m-d",
        firstDayOfWeek: 1,
        disableMobile: "true"
    });

    await cargarProfesoresCache();
    await checkProfile();
    await cargarHorarios();
    renderizarCalendario();
}

async function cargarProfesoresCache() {
    const { data, error } = await client.from('profesores').select('*').order('nombre');
    if (!error && data) {
        allProfesoresCache = data;
    }
}

async function checkProfile() {
    const { data, error } = await client.from('profiles').select('rol, bonos').eq('id', currentUser.id).single();

    if (error) {
        console.error("Error perfil:", error);
        isAdmin = false;
        document.body.classList.remove('is-admin');
        return;
    }

    if (data) {
        userBonos = data.bonos || 0;
        animateValue("bonos-count", parseInt(document.getElementById('bonos-count').innerText), userBonos, 500);

        // Normalizar rol
        const rol = (data.rol || '').toLowerCase().trim();

        if (rol === 'admin') {
            isAdmin = true;
            document.body.classList.add('is-admin');
            document.body.classList.remove('is-profesor');

            const pubNav = document.getElementById('public-nav');
            if (pubNav) pubNav.classList.add('hidden');

            // Mostrar todos los tabs
            ['tab-horarios', 'tab-admin-profesores', 'tab-asistencias', 'tab-usuarios', 'tab-configuracion'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.remove('hidden');
            });

            // Resetear nombre tab asistencias
            const tAsist = document.getElementById('tab-asistencias');
            if (tAsist) tAsist.innerHTML = '<i class="ph-bold ph-list-checks text-olive"></i> Alumnos por clase';

            const btnMisClases = document.getElementById('nav-public-mis-clases');
            if (btnMisClases) btnMisClases.classList.add('hidden');

            const adminBar = document.querySelector('.admin-only');
            if (adminBar) adminBar.style.removeProperty('display');

        } else if (rol === 'profesor') {
            isAdmin = false;
            document.body.classList.remove('is-admin');
            document.body.classList.add('is-profesor');

            const pubNav = document.getElementById('public-nav');
            if (pubNav) pubNav.classList.remove('hidden');

            const btnMisClases = document.getElementById('nav-public-mis-clases');
            if (btnMisClases) btnMisClases.classList.remove('hidden');

            ['tab-horarios', 'tab-admin-profesores', 'tab-usuarios', 'tab-configuracion'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });

            const adminBar = document.querySelector('.admin-only');
            if (adminBar) {
                adminBar.style.removeProperty('display');
            }

        } else {
            isAdmin = false;
            document.body.classList.remove('is-admin');
            document.body.classList.remove('is-profesor');

            const pubNav = document.getElementById('public-nav');
            if (pubNav) pubNav.classList.remove('hidden');

            const btnMisClases = document.getElementById('nav-public-mis-clases');
            if (btnMisClases) btnMisClases.classList.add('hidden');

            const vUsuarios = document.getElementById('view-usuarios');
            if (!vUsuarios.classList.contains('hidden')) switchTab('horarios');

            const adminBar = document.querySelector('.admin-only');
            if (adminBar) {
                adminBar.style.display = '';
                adminBar.classList.add('hidden');
            }
        }

        const alertBox = document.getElementById('no-bonos-alert');
        if (userBonos < 1 && !isAdmin) alertBox.classList.remove('hidden');
        else alertBox.classList.add('hidden');
    }
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
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
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
        const hasClasses = allClasesCache.some(c => {
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

// --- 5. HORARIOS (CLASES) ---
async function cargarHorarios() {
    const container = document.getElementById('schedule-container');
    container.innerHTML = `
    <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
      <i class="ph-duotone ph-spinner animate-spin text-4xl text-olive"></i>
      <span class="text-xs uppercase tracking-widest font-bold text-gray-500">Cargando clases...</span>
    </div>`;

    // Solo traer clases futuras (desde hoy - 2 horas para permitir ver la actual)
    const now = new Date();
    now.setHours(now.getHours() - 2);
    const nowIso = now.toISOString();

    const { data: clases, error: errClases } =
        await client.from('clases')
            .select('*, profesores(*)')
            .gte('fecha_inicio', nowIso)
            .order('fecha_inicio');

    if (errClases) {
        console.error('Error cargando clases', errClases);
        container.innerHTML = '';
        document.getElementById('empty-state').classList.remove('hidden');
        allClasesCache = [];
        return;
    }

    if (!clases || clases.length === 0) {
        container.innerHTML = '';
        document.getElementById('empty-state').classList.remove('hidden');
        allClasesCache = [];
        return;
    }

    // Traer solo reservas de estas clases para optimizar consumo
    const claseIds = clases.map(c => c.id);
    const { data: reservas, error: errReservas } =
        await client.from('reservas')
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
    renderizarCalendario();
    renderizarClases();
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

    if (clasesAMostrar.length === 0) {
        container.innerHTML = `
                    <div class="bg-white/90 backdrop-blur-md rounded-2xl p-12 text-center border border-white/20 shadow-lg">
                        <i class="ph-duotone ph-calendar-x text-5xl text-cocoa/20 mb-4"></i>
                        <p class="text-cocoa/60 font-medium">No hay clases en esta fecha</p>
                        <button onclick="limpiarFiltroFecha()" class="mt-4 text-olive hover:underline text-sm font-bold">Ver todas</button>
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
        const diaNombre = dateObj.toLocaleDateString('es-ES', { weekday: 'long' });
        const diaNumero = dateObj.getDate();
        const mes = dateObj.toLocaleDateString('es-ES', { month: 'long' });

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
            const hora = new Date(c.fecha_inicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

            const isPilates = c.nombre.toLowerCase().includes('pilates') || c.nombre.toLowerCase().includes('reformer');
            const isHot = c.nombre.toLowerCase().includes('hot') || c.nombre.toLowerCase().includes('bikram');

            let iconColorClass = 'bg-sand/30 text-cocoa border-sand';
            let tipoTexto = 'Yoga';

            if (isPilates) {
                iconColorClass = 'bg-lilac/30 text-cocoa border-lilac';
                tipoTexto = 'Reformer';
            } else if (isHot) {
                iconColorClass = 'bg-cocoa/10 text-cocoa border-cocoa/20';
                tipoTexto = 'Hot';
            }

            const llena = c.ocupadas >= c.capacidad_max;
            const reservada = !!c.miReserva;

            let btnAction = '';
            if (reservada) {
                btnAction = `
                            <button onclick="cancelar(${c.miReserva.id})" class="group flex items-center gap-2 text-[11px] font-bold text-cocoa/40 hover:text-red-500 border border-cocoa/10 hover:border-red-200 bg-ivory px-4 py-2 rounded-full transition shadow-sm">
                                <i class="ph-bold ph-x group-hover:scale-110 transition"></i> CANCELAR
                            </button>`;
            } else if (llena) {
                btnAction = `<span class="text-[10px] font-bold text-cocoa/40 bg-sand/10 px-3 py-2 rounded-full uppercase tracking-wide border border-cocoa/10 cursor-not-allowed">Completa</span>`;
            } else {
                const disabledClass = (userBonos < 1 && !isAdmin) ? 'opacity-50 cursor-not-allowed grayscale' : 'hover:shadow-lg hover:brightness-110 active:scale-95';
                const btnText = (userBonos < 1 && !isAdmin) ? '0 Bonos' : 'RESERVAR';

                btnAction = `
                            <button onclick="reservar(${c.id})" class="bg-gradient-to-r from-terracotta to-golden text-white text-[11px] font-bold px-6 py-2 rounded-full shadow-md transition transform ${disabledClass}">
                                ${btnText}
                            </button>`;
            }

            const adminTrash = `<button onclick="borrarClase(${c.id})" class="admin-only hidden text-cocoa/20 hover:text-red-500 transition ml-2 p-1" title="Eliminar Clase"><i class="ph-bold ph-trash"></i></button>`;

            const profesorName = c.profesores ? c.profesores.nombre : 'Staff GEN Yoga';
            const profesorFoto = c.profesores && c.profesores.foto_url ? c.profesores.foto_url : null;
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
                                        <div class="flex items-center gap-2 bg-sand/10 px-2.5 py-1 rounded-full border border-cocoa/10 shadow-sm order-last sm:order-none" title="Instructor">
                                            <div class="w-6 h-6 rounded-full overflow-hidden border border-cocoa/10 shadow-sm flex-shrink-0">
                                                ${profesorAvatar}
                                            </div>
                                            <span class="text-xs sm:text-sm font-bold text-cocoa/70 truncate max-w-[150px]">${profesorName}</span>
                                        </div>
                                        ${adminTrash}
                                    </div>

                                    <div class="flex items-center gap-2 mt-1">
                                         <div class="flex items-center gap-1.5 text-xs text-cocoa/50 bg-ivory border border-cocoa/10 px-2 py-0.5 rounded-md shadow-sm" title="Aforo">
                                            <i class="ph-bold ph-users text-cocoa/20 text-sm"></i>
                                            <span class="font-bold text-cocoa/70">${c.ocupadas}</span>
                                            <span class="text-cocoa/30 text-[10px]">/ ${c.capacidad_max}</span>
                                        </div>
                                        ${reservada ? '<span class="text-[10px] font-bold text-olive bg-olive/10 border border-olive/20 px-2 py-0.5 rounded-md uppercase tracking-wide flex items-center gap-1"><i class="ph-fill ph-check-circle"></i> Tu Plaza</span>' : ''}
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

    // Validación preliminar con datos en caché
    const clase = allClasesCache.find(c => c.id === claseId);
    if (clase) {
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
    }

    if (userBonos < 1 && !isAdmin) return Swal.fire({
        icon: 'warning',
        title: 'Sin bonos',
        text: 'Necesitas adquirir un bono para reservar.',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#D27D60'
    });

    try {
        isReserving = true;

        // Feedback visual inmediato
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

async function cancelar(reservaId) {
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
            Toast.fire({ icon: 'info', title: 'Reserva cancelada. Bono devuelto.' });
            await checkProfile();
            await cargarHorarios();
            if (isAdmin) await cargarAsistenciasPorClase();
        }
    }
}

// --- 7. GESTIÓN ADMIN ---
async function switchTab(tabName) {
    const tHorarios = document.getElementById('tab-horarios');
    const tAsistencias = document.getElementById('tab-asistencias');
    const tUsuarios = document.getElementById('tab-usuarios');
    const tConfiguracion = document.getElementById('tab-configuracion');
    const tAdminProfesores = document.getElementById('tab-admin-profesores');

    const vHorarios = document.getElementById('view-horarios');
    const vAsistencias = document.getElementById('view-asistencias');
    const vUsuarios = document.getElementById('view-usuarios');
    const vConfiguracion = document.getElementById('view-configuracion');
    const vAdminProfesores = document.getElementById('view-admin-profesores');

    vHorarios.classList.add('hidden');
    vAsistencias.classList.add('hidden');
    vUsuarios.classList.add('hidden');
    vConfiguracion.classList.add('hidden');
    if (vAdminProfesores) vAdminProfesores.classList.add('hidden');

    [tHorarios, tAsistencias, tUsuarios, tConfiguracion, tAdminProfesores].forEach(tab => {
        if (tab) {
            tab.classList.add('border-transparent', 'text-gray-400');
            tab.classList.remove('border-olive', 'bg-gray-800', 'text-white');
        }
    });

    if (tabName === 'horarios') {
        vHorarios.classList.remove('hidden');
        tHorarios.classList.add('border-olive', 'bg-gray-800', 'text-white');
        tHorarios.classList.remove('border-transparent', 'text-gray-400');
    } else if (tabName === 'asistencias') {
        vAsistencias.classList.remove('hidden');
        tAsistencias.classList.add('border-olive', 'bg-gray-800', 'text-white');
        tAsistencias.classList.remove('border-transparent', 'text-gray-400');
        await cargarAsistenciasPorClase();
    } else if (tabName === 'usuarios') {
        vUsuarios.classList.remove('hidden');
        tUsuarios.classList.add('border-olive', 'bg-gray-800', 'text-white');
        tUsuarios.classList.remove('border-transparent', 'text-gray-400');
        await cargarUsuariosAdmin();
    } else if (tabName === 'configuracion') {
        vConfiguracion.classList.remove('hidden');
        tConfiguracion.classList.add('border-olive', 'bg-gray-800', 'text-white');
        tConfiguracion.classList.remove('border-transparent', 'text-gray-400');
        await cargarConfiguracion();
    } else if (tabName === 'admin-profesores') {
        if (vAdminProfesores) vAdminProfesores.classList.remove('hidden');
        if (tAdminProfesores) {
            tAdminProfesores.classList.add('border-olive', 'bg-gray-800', 'text-white');
            tAdminProfesores.classList.remove('border-transparent', 'text-gray-400');
        }
        await cargarProfesoresAdmin();
    }
}

async function cargarAsistenciasPorClase() {
    const cont = document.getElementById('asistencias-container');
    const empty = document.getElementById('asistencias-empty');

    cont.innerHTML = `
                <div class="flex flex-col items-center justify-center py-20 gap-4 opacity-50">
                    <i class="ph-duotone ph-spinner animate-spin text-4xl text-olive"></i>
                    <span class="text-xs uppercase tracking-widest font-bold text-gray-400">Cargando asistencias...</span>
                </div>`;

    const { data: clases, error: errClases } = await client.from('clases').select('*, profesores(*)').order('fecha_inicio');
    if (errClases) {
        console.error(errClases);
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    const { data: reservas, error: errRes } = await client.from('reservas').select('*');
    if (errRes) {
        console.error(errRes);
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

    if (!clases || clases.length === 0) {
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    const perfilesMap = {};
    (perfiles || []).forEach(p => { perfilesMap[p.id] = p; });

    const reservasPorClase = {};
    (reservas || []).forEach(r => {
        if (r.estado !== 'confirmada') return; // Filter only confirmed bookings
        if (!reservasPorClase[r.clase_id]) reservasPorClase[r.clase_id] = [];
        reservasPorClase[r.clase_id].push(r);
    });

    cont.innerHTML = '';

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let clasesFuturas = clases.filter(c => {
        const d = new Date(c.fecha_inicio);
        d.setHours(0, 0, 0, 0);
        return d >= hoy;
    });

    const isProfesor = document.body.classList.contains('is-profesor');
    if (!isAdmin && isProfesor && currentUser) {
        clasesFuturas = clasesFuturas.filter(c => {
            return c.profesores && c.profesores.email === currentUser.email;
        });
    }

    if (clasesFuturas.length === 0) {
        cont.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    const grupos = {};
    clasesFuturas.forEach(c => {
        const dateKey = formatDateLocal(new Date(c.fecha_inicio));
        if (!grupos[dateKey]) grupos[dateKey] = [];
        grupos[dateKey].push(c);
    });

    Object.keys(grupos).sort().forEach(dateKey => {
        const dateObj = new Date(dateKey);
        const diaNombre = dateObj.toLocaleDateString('es-ES', { weekday: 'long' });
        const diaNumero = dateObj.getDate();
        const mes = dateObj.toLocaleDateString('es-ES', { month: 'long' });

        const card = document.createElement('div');
        card.className = 'bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden';

        card.innerHTML = `
                    <div class="bg-gradient-to-r from-gray-400 to-gray-200 px-6 py-4 border-b border-gray-100 flex items-center justify-between">
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
            const hora = new Date(c.fecha_inicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            const p = c.profesores;
            const profesorName = p ? p.nombre : 'Staff Q19';
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
            const listadoReservas = reservasPorClase[c.id] || [];
            const totalReservas = listadoReservas.length;

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
                    const perfil = perfilesMap[r.user_id] || {};
                    const nombre = perfil.nombre || '';
                    const apellidos = perfil.apellidos || '';
                    const email = perfil.email || 'Sin email';
                    const displayEmail = email.length > 20 ? email.substring(0, 18) + '...' : email;
                    const iniciales = (nombre ? nombre[0] : (email[0] || '?')).toUpperCase();
                    const clasesAnt = perfil.clases_mes_anterior || 0;
                    const nivel = getRankConfig(clasesAnt);

                    return `
                                    <div class="flex items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md hover:border-gold-300 transition group relative overflow-hidden">
                                        <div class="w-10 h-10 rounded-full flex items-center justify-center bg-gray-50 text-gray-500 font-bold text-sm border border-gray-200 shadow-sm group-hover:scale-105 transition relative z-10">
                                            ${iniciales}
                                            <div class="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white ${nivel.color.replace('text-', 'bg-')}" title="${nivel.name}"></div>
                                        </div>
                                        <div class="flex flex-col z-10 w-full overflow-hidden">
                                            <span class="text-sm font-bold text-gray-900 truncate" title="${nombre} ${apellidos}">${nombre} ${apellidos}</span>
                                            <span class="text-[10px] text-gray-400 truncate" title="${email}">${displayEmail}</span>
                                        </div>
                                    </div>`;
                }).join('')}
                            </div>`;
            }

            fila.innerHTML = `
                        <div class="flex flex-col gap-4">
                            <div class="flex items-start sm:items-center gap-4">
                                <div class="flex flex-col items-center justify-center bg-gray-900 text-white w-14 h-14 rounded-2xl shadow-md border border-gray-800 shrink-0 z-10 relative overflow-hidden group">
                                    <div class="absolute inset-0 bg-gold-500/10 opacity-0 group-hover:opacity-100 transition"></div>
                                    <i class="ph-fill ph-clock text-gold-400 text-base"></i>
                                    <span class="text-xs font-bold font-mono mt-0.5 tracking-wide">${hora}</span>
                                </div>
                                
                                <div class="flex-grow pt-1 sm:pt-0">
                                    <h4 class="brand-font text-lg font-bold text-gray-900 leading-tight flex items-center flex-wrap gap-1">
                                        ${c.nombre}
                                        ${profHTML}
                                    </h4>
                                    <div class="flex flex-wrap items-center gap-2 mt-1.5">
                                         <span class="flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 px-2.5 py-1 rounded-lg shadow-sm">
                                            <i class="ph-bold ph-users text-gray-400"></i> ${totalReservas} / ${c.capacidad_max}
                                         </span>
                                         ${totalReservas >= c.capacidad_max ? '<span class="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded-lg uppercase tracking-wide flex items-center gap-1"><i class="ph-bold ph-warning-circle"></i> Completa</span>' : ''}
                                    </div>
                                </div>
                            </div>
                            <div class="pl-0 sm:pl-[4.5rem]">
                                ${alumnosHTML}
                            </div>
                        </div>
                    `;
            grid.appendChild(fila);
        });
    });
}

async function cargarUsuariosAdmin() {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-gray-400 italic"><i class="ph-duotone ph-spinner animate-spin"></i> Cargando...</td></tr>';

    const { data: users, error } = await client.from('profiles').select('*').order('email');

    if (error) return Swal.fire('Error Admin', 'Fallo al cargar usuarios.', 'error');

    allUsersCache = users;
    renderUsersTable(users);
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

    const headerRow = document.querySelector('#view-usuarios thead tr');
    if (headerRow && headerRow.children.length === 4) {
        const th = document.createElement('th');
        th.className = "px-6 py-4 text-center";
        th.innerText = "Nivel / Dto";
        headerRow.insertBefore(th, headerRow.children[2]);
    }

    users.forEach(u => {
        const isAdminRow = u.rol === 'admin';
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50 transition border-b border-gray-50 last:border-0';

        let roleBadge = '<span class="bg-gray-100 text-gray-400 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-gray-200">Cliente</span>';

        if (u.rol === 'admin') {
            roleBadge = '<span class="bg-gray-900 text-white text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-gray-800">Admin</span>';
        } else if (u.rol === 'profesor') {
            roleBadge = '<span class="bg-slate-200 text-slate-600 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-widest border border-slate-300">Profesor</span>';
        }

        const clasesAnt = u.clases_mes_anterior || 0;
        const levelData = getRankConfig(clasesAnt);
        const discountText = levelData.discount > 0 ? `-${levelData.discount}%` : '0%';
        const discountClass = levelData.discount > 0 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-gray-400 bg-gray-100 border-gray-200';

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
                    <td class="px-6 py-4 text-center">
                        <div class="flex flex-col items-center">
                            <span class="text-[10px] font-bold uppercase tracking-wide ${levelData.color}">${levelData.name}</span>
                            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full border ${discountClass} mt-0.5">${discountText}</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 text-center">
                        <span class="font-bold text-lg ${u.bonos > 0 ? 'text-q19-600' : 'text-gray-300'}">${u.bonos || 0}</span>
                    </td>
                    <td class="px-6 py-4 text-right">
                        <div class="flex justify-end items-center gap-2">
                            <button onclick="sumarBono('${u.id}', -1)" class="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition" title="Restar"><i class="ph-bold ph-minus"></i></button>
                            
                            <button onclick="sumarBono('${u.id}', 1)" class="px-3 h-8 flex items-center gap-1 rounded-lg bg-gray-900 text-white text-xs font-bold hover:bg-black transition shadow-sm">
                                <i class="ph-bold ph-plus"></i> 1
                            </button>
                            
                            <button onclick="sumarBono('${u.id}', 5)" class="px-3 h-8 flex items-center gap-1 rounded-lg bg-gold-500 text-white text-xs font-bold hover:bg-gold-600 transition shadow-sm" title="Pack 5">
                                <i class="ph-bold ph-ticket"></i> +5
                            </button>

                            <div class="w-px h-6 bg-gray-200 mx-1"></div>

                            <button onclick="borrarUsuario('${u.id}')" class="w-8 h-8 flex items-center justify-center rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 transition" title="Eliminar Usuario Completo">
                                <i class="ph-bold ph-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
        tbody.appendChild(row);
    });
}

// --- LOGICA PROFESORES ADMIN ---
async function cargarProfesoresAdmin() {
    const grid = document.getElementById('admin-profesores-grid');
    const noData = document.getElementById('no-profesores');
    grid.innerHTML = '';

    await cargarProfesoresCache();

    if (!allProfesoresCache || allProfesoresCache.length === 0) {
        noData.classList.remove('hidden');
        return;
    }
    noData.classList.add('hidden');

    grid.innerHTML = allProfesoresCache.map(p => {
        const initials = p.nombre
            ? p.nombre.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
            : '??';

        // Determinar gradiente basado en su color o default
        const bgGradient = p.color
            ? `linear-gradient(135deg, ${p.color}aa, ${p.color})`
            : 'linear-gradient(135deg, #6b7280, #374151)';

        const fotoHtml = p.foto_url
            ? `<img src="${p.foto_url}" class="absolute inset-0 w-full h-full object-cover z-0" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden')">
               <div class="absolute inset-0 flex items-center justify-center z-0 hidden bg-gradient-to-br from-gray-400 to-gray-600">
                    <span class="text-9xl font-sans font-bold text-white/20 select-none">${initials}</span>
               </div>`
            : `<div class="absolute inset-0 flex items-center justify-center z-0 bg-gradient-to-br from-gray-400 to-gray-600">
                    <span class="text-9xl font-sans font-bold text-white/20 select-none">${initials}</span>
               </div>`;

        return `
        <div class="bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100 hover:shadow-md transition group flex flex-col">
            <!-- Header / Cover -->
            <div class="relative h-48 bg-gray-200 overflow-hidden">
                ${fotoHtml}
                
                <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10 pointer-events-none"></div>

                <!-- Botones de Acción (Top Right) -->
                <div class="absolute top-3 right-3 z-30 flex gap-2">
                    <button onclick="editarProfesor(${p.id})" 
                        class="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md text-white hover:bg-white hover:text-q19-700 transition flex items-center justify-center shadow-sm"
                        title="Editar">
                        <i class="ph-bold ph-pencil-simple text-sm"></i>
                    </button>
                    <button onclick="borrarProfesor(${p.id})" 
                        class="w-8 h-8 rounded-full bg-white/20 backdrop-blur-md text-white hover:bg-red-500 hover:text-white transition flex items-center justify-center shadow-sm"
                        title="Eliminar">
                        <i class="ph-bold ph-trash text-sm"></i>
                    </button>
                </div>

                <!-- Info Principal (Bottom Left) -->
                <div class="absolute bottom-4 left-5 z-20">
                    <h3 class="text-white font-serif font-bold text-4xl leading-none drop-shadow-md mb-1">${p.nombre}</h3>
                    <p class="text-white/80 text-[10px] font-bold uppercase tracking-widest drop-shadow-sm">${p.especialidad || 'INSTRUCTOR'}</p>
                </div>
            </div>

            <!-- Body / Detalles -->
            <div class="p-5 flex flex-col gap-3">
                <div class="flex items-center gap-2">
                    <div class="w-3 h-3 rounded-full shadow-sm" style="background-color: ${p.color || '#9ca3af'}"></div>
                    <span class="text-xs text-gray-400 font-bold">Color Identificativo</span>
                </div>
                
                <p class="text-sm text-gray-500 line-clamp-2">
                    ${p.descripcion || 'Sin descripción disponible.'}
                </p>
            </div>
        </div>
    `}).join('');
}

async function editarProfesor(id) {
    const profesor = allProfesoresCache.find(p => p.id === id);
    if (!profesor) return;

    const { value: formValues } = await Swal.fire({
        title: 'Editar Profesor',
        html: `
                        <div class="space-y-4 text-left">
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Nombre</label>
                                <input id="swal-prof-nombre" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="${profesor.nombre || ''}">
                            </div>
                            <div>
                                <label class="text-xs font-bold uppercase text-gray-500 block mb-1">Especialidad</label>
                                <input id="swal-prof-especialidad" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-q19-500 outline-none" value="${profesor.especialidad || ''}">
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
            return {
                nombre: document.getElementById('swal-prof-nombre').value,
                especialidad: document.getElementById('swal-prof-especialidad').value,
                foto_url: document.getElementById('swal-prof-foto').value,
                color: document.getElementById('swal-prof-color').value
            }
        }
    });

    if (formValues) {
        if (!formValues.nombre) return Swal.fire('Error', 'El nombre es obligatorio', 'error');

        const { error } = await client.from('profesores').update(formValues).eq('id', id);
        if (error) Swal.fire('Error', error.message, 'error');
        else {
            Swal.fire({
                icon: 'success',
                title: 'Profesor actualizado',
                showConfirmButton: false,
                timer: 1500
            });
            await cargarProfesoresCache();
            cargarProfesoresAdmin();
        }
    }
}

async function borrarProfesor(id) {
    const res = await Swal.fire({
        title: '¿Eliminar profesor?',
        text: "Esta acción no se puede deshacer.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, eliminar'
    });

    if (res.isConfirmed) {
        const { error } = await client.from('profesores').delete().eq('id', id);
        if (error) Swal.fire('Error', error.message, 'error');
        else {
            await cargarProfesoresCache();
            cargarProfesoresAdmin();
            Swal.fire('Eliminado', 'El profesor ha sido eliminado.', 'success');
        }
    }
}

function filtrarUsuarios() {
    const term = document.getElementById('user-search').value.toLowerCase();
    const filtered = allUsersCache.filter(u => u.email && u.email.toLowerCase().includes(term));
    renderUsersTable(filtered);
}

async function sumarBono(userId, qty) {
    const { data } = await client.from('profiles').select('bonos').eq('id', userId).single();
    const nuevoSaldo = (data.bonos || 0) + qty;

    const { error } = await client.from('profiles').update({ bonos: nuevoSaldo }).eq('id', userId);

    if (error) Swal.fire('Error', error.message, 'error');
    else {
        const Toast = Swal.mixin({ toast: true, position: 'bottom-end', showConfirmButton: false, timer: 1000 });
        Toast.fire({ icon: 'success', title: 'Saldo actualizado' });
        cargarUsuariosAdmin();
    }
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
        const { error: errReservas } = await client.from('reservas').delete().eq('user_id', uid);
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
    selectProfesor.innerHTML = '<option value="" disabled selected>Selecciona un profesor</option>';

    if (allProfesoresCache && allProfesoresCache.length > 0) {
        allProfesoresCache.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.nombre + (p.especialidad ? ` (${p.especialidad})` : '');
            selectProfesor.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.disabled = true;
        option.textContent = 'No hay profesores disponibles';
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

    if (!profesorId) {
        Swal.fire('Error', 'Debes seleccionar un profesor', 'error');
        return;
    }

    const fechaInicio = new Date(`${fecha}T${horaInicio}`);
    const fechaFin = new Date(fechaInicio.getTime() + duracion * 60000);

    Swal.fire({
        title: 'Creando clase...',
        didOpen: () => Swal.showLoading()
    });

    const { data, error } = await client.from('clases').insert([{
        nombre: nombre,
        fecha_inicio: fechaInicio.toISOString(),
        fecha_fin: fechaFin.toISOString(),
        capacidad_max: capacidad,
        profesor_id: profesorId
    }]).select();

    Swal.close();

    if (error) {
        Swal.fire({
            icon: 'error',
            title: 'Error al crear clase',
            text: error.message,
            confirmButtonColor: '#1a4d4f'
        });
    } else {
        cerrarModalCrearClase();
        Swal.fire({
            icon: 'success',
            title: '¡Clase creada!',
            text: `${nombre} ha sido añadida al calendario.`,
            showConfirmButton: false,
            timer: 2000
        });
        await cargarHorarios();
        if (isAdmin) await cargarAsistenciasPorClase();
    }
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
        await cargarHorarios();
        if (isAdmin) await cargarAsistenciasPorClase();
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
                            
                            <div class="p-6 md:p-8 flex flex-col items-center text-center">
                                <div class="flex flex-col sm:flex-row items-center gap-6 mb-6 w-full">
                                    <div class="w-16 h-16 shrink-0 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-sm group-hover:scale-110 transition duration-300">
                                        <i class="ph-bold ph-clock-countdown text-3xl"></i>
                                    </div>
                                    <div class="text-left flex-1">
                                        <h3 class="font-bold text-gray-900 text-lg leading-tight mb-1">Tiempo Límite</h3>
                                        <p class="text-xs text-gray-500 mb-3">Antelación mínima para cancelar reservas.</p>
                                        
                                        <div class="flex items-center gap-3 bg-gray-50 p-1.5 rounded-xl border border-gray-200 w-fit">
                                            <button onclick="ajustarValor(-1)" class="w-8 h-8 rounded-lg bg-white text-gray-600 shadow-sm border border-gray-100 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center active:scale-95">
                                                <i class="ph-bold ph-minus"></i>
                                            </button>
                                            
                                            <div class="flex items-center gap-1 px-2">
                                                <input type="number" id="input-horas-cancelacion" value="${targetConfig.valor}" 
                                                       onchange="actualizarConfigRapido('${targetConfig.id}', this.value)"
                                                       class="w-10 bg-transparent text-center font-black text-xl text-gray-800 outline-none p-0 remove-arrow">
                                                <span class="text-gray-400 font-bold text-[10px] uppercase tracking-wide pt-1">H</span>
                                            </div>
                                            
                                            <button onclick="ajustarValor(1)" class="w-8 h-8 rounded-lg bg-white text-gray-600 shadow-sm border border-gray-100 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center active:scale-95">
                                                <i class="ph-bold ph-plus"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <p class="text-[10px] text-emerald-600/80 font-bold uppercase tracking-wider flex items-center gap-1 self-end sm:self-auto">
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
                                                <input type="text" id="new-tipo-nombre" placeholder="Ej: Pilates" required 
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
                            <button onclick="borrarTipoClase(${t.id})" class="text-gray-300 hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition opacity-0 group-hover:opacity-100">
                                <i class="ph-bold ph-trash"></i>
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

    window.ajustarValor = async (delta) => {
        const input = document.getElementById('input-horas-cancelacion');
        let val = parseInt(input.value) || 0;
        val += delta;
        if (val < 0) val = 0;
        input.value = val;
        await actualizarConfigRapido(targetConfig.id, val.toString());
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
            title: '¿Promover a Profesor?',
            text: `El usuario ${email} tendrá acceso al panel de profesores.`,
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
                await client.from('profesores').insert([{
                    nombre: userData.nombre || 'Profesor',
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

// ================= PERFIL & RANGO =================
function getRankConfig(count) {
    const images = {
        bronce: 'https://raw.githubusercontent.com/jaime312/Q19/main/images/gen_bronce.png',
        plata: 'https://raw.githubusercontent.com/jaime312/Q19/main/images/gen_plata.png',
        oro: 'https://raw.githubusercontent.com/jaime312/Q19/main/images/gen_oro.png',
        platino: 'https://raw.githubusercontent.com/jaime312/Q19/main/images/gen_platino.png',
        diamante: 'https://raw.githubusercontent.com/jaime312/Q19/main/images/gen_diamante.png'
    };
    const colors = {
        bronce: 'text-amber-700',
        plata: 'text-gray-400',
        oro: 'text-yellow-500',
        platino: 'text-slate-500',
        diamante: 'text-blue-500'
    };

    let level = {};
    if (count > 16) level = { name: 'Diamante', color: colors.diamante, img: images.diamante, discount: 20, min: 17, next: null, nextName: null };
    else if (count >= 12) level = { name: 'Platino', color: colors.platino, img: images.platino, discount: 15, min: 12, next: 17, nextName: 'Diamante' };
    else if (count >= 7) level = { name: 'Oro', color: colors.oro, img: images.oro, discount: 10, min: 7, next: 12, nextName: 'Platino' };
    else if (count >= 3) level = { name: 'Plata', color: colors.plata, img: images.plata, discount: 5, min: 3, next: 7, nextName: 'Oro' };
    else level = { name: 'Bronce', color: colors.bronce, img: images.bronce, discount: 0, min: 0, next: 3, nextName: 'Plata' };
    return level;
}

function renderProfileCard(profile) {
    const wrapper = document.getElementById('profile-card');
    if (!wrapper) return;
    if (!profile) { wrapper.classList.add('hidden'); return; }

    const nombre = profile.nombre ?? '';
    const apellidos = profile.apellidos ?? '';
    const fullNameEl = document.getElementById('profile-nombre-full');
    if (fullNameEl) fullNameEl.textContent = `${nombre} ${apellidos}`.trim();

    const countLastMonth = profile.clases_mes_anterior || 0;
    const currentLevel = getRankConfig(countLastMonth);

    const badgeImg = document.getElementById('rank-badge');
    if (badgeImg) {
        badgeImg.src = currentLevel.img;
        badgeImg.style.display = 'block';
    }

    const rankNameEl = document.getElementById('rank-name');
    if (rankNameEl) {
        rankNameEl.textContent = currentLevel.name;
        rankNameEl.className = `text-xs font-black uppercase tracking-widest ${currentLevel.color}`;
    }

    const disc = document.getElementById('discount-badge');
    if (disc) {
        if ((currentLevel.discount || 0) > 0) {
            disc.textContent = `-${currentLevel.discount}%`;
            disc.classList.remove('hidden');
        } else {
            disc.classList.add('hidden');
        }
    }

    const countThisMonth = profile.clases_completadas_mes || 0;
    const countEl = document.getElementById('clases-count-num');
    if (countEl) countEl.textContent = countThisMonth;

    const progressConfig = getRankConfig(countThisMonth);
    const progressBar = document.getElementById('rank-progress-bar');
    const nextInfo = document.getElementById('next-level-info');
    const nextDiscountText = document.getElementById('next-discount-text');

    if (progressConfig.next) {
        const target = progressConfig.next;
        const faltan = target - countThisMonth;
        const range = progressConfig.next - progressConfig.min;
        const doneInTier = countThisMonth - progressConfig.min;
        const pct = range > 0 ? Math.min(100, Math.max(5, (doneInTier / range) * 100)) : 100;

        if (progressBar) progressBar.style.width = `${pct}%`;
        const nextLvlConfig = getRankConfig(target);
        if (nextInfo) nextInfo.innerHTML = `Faltan ${faltan} para <span class="${nextLvlConfig.color}">${progressConfig.nextName}</span>`;

        if (nextDiscountText) {
            if (nextLvlConfig.discount > 0) {
                nextDiscountText.textContent = `Próximo descuento: -${nextLvlConfig.discount}%`;
                nextDiscountText.classList.remove('hidden');
            } else {
                nextDiscountText.classList.add('hidden');
            }
        }
    } else {
        if (progressBar) progressBar.style.width = '100%';
        if (nextInfo) nextInfo.textContent = '¡Nivel Máximo!';
        if (nextDiscountText) nextDiscountText.textContent = 'Máximo beneficio alcanzado';
    }
    wrapper.classList.remove('hidden');
}

async function loadProfileCard() {
    try {
        if (!currentUser?.id) { renderProfileCard(null); return; }
        const { data } = await client.from('profiles').select('nombre, apellidos, clases_completadas_mes, clases_mes_anterior').eq('id', currentUser.id).single();
        renderProfileCard(data);
    } catch (e) { renderProfileCard(null); }
}

async function abrirEditarPerfil() {
    const fullName = document.getElementById('profile-nombre-full').textContent.trim();
    const parts = fullName.split(' ');
    const currentNombre = parts[0] || '';
    const currentApellidos = parts.slice(1).join(' ') || '';

    const { value: formValues } = await Swal.fire({
        title: 'Editar Perfil',
        html: `
                    <div class="flex flex-col gap-3 text-left">
                        <div><label class="text-xs font-bold text-gray-500 uppercase">Nombre</label><input id="swal-nombre" class="swal-input-custom w-full px-4 py-2 border rounded-lg bg-gray-50" value="${currentNombre}"></div>
                        <div><label class="text-xs font-bold text-gray-500 uppercase">Apellidos</label><input id="swal-apellidos" class="swal-input-custom w-full px-4 py-2 border rounded-lg bg-gray-50" value="${currentApellidos}"></div>
                    </div>
                `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonColor: '#d4af37',
        preConfirm: () => [document.getElementById('swal-nombre').value, document.getElementById('swal-apellidos').value]
    });

    if (formValues) {
        const [newNombre, newApellidos] = formValues;
        await client.from('profiles').update({ nombre: newNombre, apellidos: newApellidos }).eq('id', currentUser.id);
        loadProfileCard();
    }
}

// --- 11. GESTIÓN PÚBLICA ---
function switchPublicView(viewName) {
    const vHorarios = document.getElementById('view-horarios');
    const vProfesores = document.getElementById('view-profesores');
    const vAsistencias = document.getElementById('view-asistencias');

    const btnHorarios = document.getElementById('nav-public-horarios');
    const btnProfesores = document.getElementById('nav-public-profesores');
    const btnMisClases = document.getElementById('nav-public-mis-clases');

    vHorarios.classList.add('hidden');
    if (vProfesores) vProfesores.classList.add('hidden');
    if (vAsistencias) vAsistencias.classList.add('hidden');

    btnHorarios.classList.remove('border-cocoa', 'text-cocoa');
    btnHorarios.classList.add('border-transparent', 'text-cocoa/60');
    btnProfesores.classList.remove('border-cocoa', 'text-cocoa');
    btnProfesores.classList.add('border-transparent', 'text-cocoa/60');
    if (btnMisClases) {
        btnMisClases.classList.remove('border-cocoa', 'text-cocoa');
        btnMisClases.classList.add('border-transparent', 'text-cocoa/60');
    }

    if (viewName === 'horarios') {
        vHorarios.classList.remove('hidden');
        btnHorarios.classList.add('border-cocoa', 'text-cocoa');
        btnHorarios.classList.remove('border-transparent', 'text-cocoa/60');
    } else if (viewName === 'profesores') {
        if (vProfesores) {
            vProfesores.classList.remove('hidden');
            renderProfesoresPublic();
        }
        btnProfesores.classList.add('border-cocoa', 'text-cocoa');
        btnProfesores.classList.remove('border-transparent', 'text-cocoa/60');
    } else if (viewName === 'mis-clases') {
        if (vAsistencias) {
            vAsistencias.classList.remove('hidden');
            cargarAsistenciasPorClase();
        }
        if (btnMisClases) {
            btnMisClases.classList.add('border-cocoa', 'text-cocoa');
            btnMisClases.classList.remove('border-transparent', 'text-cocoa/60');
        }
    }
}

function renderProfesoresPublic() {
    const grid = document.getElementById('public-profesores-grid');
    if (!grid) return;

    if (!allProfesoresCache || allProfesoresCache.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center text-gray-400 italic py-10">No hay información de instructores disponible.</div>';
        return;
    }

    grid.innerHTML = allProfesoresCache.map(p => {
        const nombres = (p.nombre || 'Instructor').split(' ');
        const iniciales = nombres.length > 1
            ? (nombres[0][0] + nombres[1][0]).toUpperCase()
            : (nombres[0][0] + (nombres[0][1] || '')).toUpperCase();
        const baseColor = p.color || '#d4af37';

        return `
                <div class="relative bg-white rounded-[2rem] overflow-hidden shadow-sm border border-gray-100">
                    <div class="h-[28rem] w-full relative overflow-hidden bg-gray-50 flex items-center justify-center">
                        <div class="absolute inset-0 opacity-20"
                             style="background: radial-gradient(circle at 70% 20%, ${baseColor}, transparent 60%), radial-gradient(circle at 0% 100%, ${baseColor}, transparent 50%);">
                        </div>
                         <span class="brand-font text-[12rem] leading-none font-bold opacity-10 select-none"
                               style="color: ${baseColor}; text-shadow: 0 10px 30px rgba(0,0,0,0.05);">
                            ${iniciales}
                        </span>
                        <div class="absolute inset-0 bg-white/10 backdrop-blur-[1px]"></div>
                        <div class="absolute bottom-0 left-0 w-full p-8 bg-gradient-to-t from-white via-white/90 to-transparent pt-24">
                             <div class="relative">
                                <span class="inline-block px-3 py-1 mb-3 text-[10px] font-bold tracking-[0.2em] uppercase text-gray-500 bg-gray-100 rounded-full border border-gray-200">
                                    ${p.especialidad || 'Instructor'}
                                </span>
                                <h3 class="text-4xl brand-font font-bold text-gray-900 mb-2 leading-tight" style="color: ${baseColor}">
                                    ${p.nombre}
                                </h3>
                                <div>
                                    <p class="text-gray-500 text-sm font-light leading-relaxed mt-4 pt-4 border-t border-gray-100">
                                         ${p.descripcion || 'Instructor certificado apasionado por el bienestar y la enseñanza de técnicas avanzadas.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
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
        osc.start(now);
        osc.stop(now + decays[index] + 1);
    });
}