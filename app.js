// script.js

// --- CONFIGURACIÓN SUPABASE ---
const SUPA_URL = 'https://jkjifmrrlyncuwpjhxvk.supabase.co';
const SUPA_KEY = 'sb_publishable_xnIELom1ouXaBDJNYaWDAQ_VJNjlnIK';
const client = window.supabase.createClient(SUPA_URL, SUPA_KEY);

document.addEventListener('DOMContentLoaded', () => {
    // Platform detection (simplificado)
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /ipad|iphone|ipod/.test(ua) && !window.MSStream;
    const isAndroid = /android/.test(ua);
    document.body.classList.add(isIOS ? 'platform-ios' : (isAndroid ? 'platform-android' : 'platform-web'));

    if (!isIOS && !isAndroid) {
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

    fetchClasesLanding();
    fetchProfesoresLanding();
});

// 2. SISTEMA DE MODALES
const modalOverlay = document.getElementById('modal-overlay');
const modalContents = document.querySelectorAll('.modal-content');

window.openModal = function (modalId) {
    modalContents.forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`modal-${modalId}`);
    if (target) {
        target.classList.remove('hidden');
        modalOverlay.classList.remove('hidden');
        setTimeout(() => modalOverlay.classList.remove('opacity-0'), 10);
        history.pushState({ modalOpen: true }, "", `#${modalId}`);
    }
}

window.closeModal = function () {
    modalOverlay.classList.add('opacity-0');
    setTimeout(() => {
        modalOverlay.classList.add('hidden');
        modalContents.forEach(el => el.classList.add('hidden'));
    }, 300);
    if (window.location.hash) history.replaceState(null, "", " ");
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

window.addEventListener('popstate', () => {
    if (!modalOverlay.classList.contains('hidden')) {
        modalOverlay.classList.add('opacity-0');
        setTimeout(() => {
            modalOverlay.classList.add('hidden');
            modalContents.forEach(el => el.classList.add('hidden'));
        }, 300);
    }
});

if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });
}



// 4. HOVER IMAGES (solo escritorio)
window.showHoverImage = function (side, imgName) {
    const container = document.getElementById(`hover-image-${side}`);
    // Hide all images in this container first
    if (container) {
        const images = container.querySelectorAll('img');
        images.forEach(img => img.classList.add('hidden'));

        // Show specific image
        const targetImg = document.getElementById(`img-${imgName}`);
        if (targetImg) {
            targetImg.classList.remove('hidden');
        }

        container.classList.remove('opacity-0');
    }
}

window.hideHoverImage = function (side) {
    const container = document.getElementById(`hover-image-${side}`);
    if (container) {
        container.classList.add('opacity-0');
    }
}

// 5. DATOS DINÁMICOS (Supabase)

async function fetchClasesLanding() {
    const container = document.getElementById('landing-clases-container');
    if (!container) return;

    console.log("Fetching classes (no date filter on DB)...");

    // Traemos solo clases desde hoy - 2 horas para optimizar
    const now = new Date();
    now.setHours(now.getHours() - 2);
    const nowIso = now.toISOString();

    const { data: clases, error } = await client
        .from('clases')
        .select('*, profesores(*)')
        .gte('fecha_inicio', nowIso)
        .order('fecha_inicio', { ascending: true })
        .limit(20);

    if (error) {
        console.error('Error fetching classes:', error);
        container.innerHTML = `<div class="p-4 bg-red-50 border border-red-100 rounded-lg text-red-800 text-center">
            <p class="font-bold">No se pudieron cargar las clases</p>
        </div>`;
        return;
    }

    if (!clases || clases.length === 0) {
        // Si llega aquí sin error, es que la tabla está vacía O RLS está bloqueando la lectura pública
        container.innerHTML = `<div class="flex flex-col items-center justify-center py-10 gap-2 opacity-60">
            <i data-lucide="calendar-x" class="w-8 h-8 text-cocoa"></i>
            <p class="text-center text-cocoa text-sm">No hay clases programadas en este momento.</p>
        </div>`;
        lucide.createIcons();
        return;
    }

    // Filtrar en cliente: Solo futuras (o de hoy)
    // Usamos el 'now' ya declarado arriba

    const clasesFuturas = clases.filter(c => {
        const fecha = new Date(c.fecha_inicio);
        return fecha >= now;
    });

    if (clasesFuturas.length === 0) {
        container.innerHTML = `<div class="flex flex-col items-center justify-center py-10 gap-2 opacity-60">
            <i data-lucide="calendar-x" class="w-8 h-8 text-cocoa"></i>
            <p class="text-center text-cocoa text-sm">No hay clases próximas.</p>
        </div>`;
        lucide.createIcons();
        return;
    }

    renderClassesLanding(clasesFuturas.slice(0, 20));
}

function renderClassesLanding(clases) {
    const container = document.getElementById('landing-clases-container');
    container.innerHTML = '';

    clases.forEach(clase => {
        const fecha = new Date(clase.fecha_inicio);
        const horaStr = fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const diaStr = fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric' });

        const profName = clase.profesores ? clase.profesores.nombre : 'Staff';

        const card = document.createElement('div');
        card.className = "flex flex-col md:flex-row items-center justify-between p-8 border border-cocoa/10 hover:border-olive/50 hover:bg-cocoa/5 transition duration-300 group cursor-pointer";
        card.innerHTML = `
            <div class="flex items-center gap-8 w-full md:w-auto">
                <div class="flex flex-col items-center text-olive group-hover:text-cocoa transition min-w-[80px]">
                    <span class="text-3xl font-serif leading-none">${horaStr}</span>
                    <span class="text-xs uppercase tracking-widest opacity-60 mt-1 text-center">${diaStr}</span>
                </div>
                <div class="text-left">
                    <span class="block text-xl uppercase tracking-widest font-light text-cocoa">${clase.nombre}</span>
                    <span class="text-sm text-slate capitalize">Sala Aire • ${clase.duracion_min || 60} min</span>
                </div>
            </div>
            <div class="mt-4 md:mt-0 flex items-center gap-6 w-full md:w-auto justify-between md:justify-end">
                <span class="text-lg font-serif italic text-cocoa/60 text-right md:text-left">con ${profName}</span>
                <a href="profile.html" class="px-6 py-2 bg-terracotta text-ivory text-xs uppercase tracking-widest hover:bg-cocoa hover:text-white transition rounded-full text-center">Reservar</a>
            </div>
        `;
        container.appendChild(card);
    });
}

async function fetchProfesoresLanding() {
    const container = document.getElementById('landing-profesores-container');
    if (!container) return;

    const { data: profesores, error } = await client
        .from('profesores')
        .select('*')
        .order('nombre');

    if (error) {
        console.error('Error fetching teachers:', error);
        container.innerHTML = `<div class="col-span-full p-4 bg-red-50 border border-red-100 rounded-lg text-red-800 text-center">
            <p class="font-bold">No se pudieron cargar los maestros</p>
        </div>`;
        return;
    }

    if (!profesores || profesores.length === 0) {
        container.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center py-10 gap-2 opacity-60">
            <i data-lucide="users" class="w-8 h-8 text-cocoa"></i>
             <p class="text-center text-cocoa text-sm">No hay maestros registrados en este momento.</p>
        </div>`;
        lucide.createIcons();
        return;
    }

    renderProfesoresLanding(profesores);
}

function renderProfesoresLanding(profesores) {
    const container = document.getElementById('landing-profesores-container');
    container.innerHTML = '';

    profesores.forEach(prof => {
        const fotoUrl = prof.foto_url || null;
        const avatarHtml = fotoUrl
            ? `<img src="${fotoUrl}" alt="${prof.nombre}" class="w-full h-full object-cover">`
            : `<div class="w-full h-full bg-cocoa/5 flex items-center justify-center text-cocoa text-4xl font-serif">${prof.nombre.charAt(0)}</div>`;

        const card = document.createElement('div');
        card.className = "text-center";
        card.innerHTML = `
            <div class="w-48 h-64 mx-auto mb-6 relative overflow-hidden rounded-full border border-cocoa/10 shadow-sm transition">
                ${avatarHtml}
            </div>
            <h3 class="text-2xl font-serif text-cocoa mb-1">${prof.nombre}</h3>
            <p class="text-xs uppercase tracking-widest text-olive">${prof.especialidad || 'Yoga Instructor'}</p>
            <p class="text-sm text-cocoa/60 mt-4 px-4 font-light leading-relaxed">
                ${prof.bio || 'Instructor certificado de GEN Yoga.'}
            </p>
        `;
        container.appendChild(card);
    });
}


window.triggerLogoFantasy = function() {
    const video = document.getElementById('logo-video');
    const container = document.getElementById('logo-container');
    if (!video) return;

    if (!video.paused) {
        // Stop animation and reset to first frame
        video.pause();
        video.currentTime = 0;
        container.classList.remove('fantasy-active');
    } else {
        // Start animation
        video.play().then(() => {
            container.classList.add('fantasy-active');
        }).catch(err => {
            console.error("Video play failed:", err);
        });
    }

    video.onended = () => {
        container.classList.remove('fantasy-active');
        video.currentTime = 0;
    };
}