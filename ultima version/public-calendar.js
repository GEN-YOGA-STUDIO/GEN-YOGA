(function (root) {
    'use strict';

    const TIME_ZONE = 'Europe/Madrid';
    const CALENDAR_HASH = '#calendario-publico';
    const WEEK_DAYS_BASE = 6;
    const REFRESH_INTERVAL_MS = 60_000;
    const MAX_DEEP_LINK_DAYS = 120;
    const DIRECT_SELECT = [
        'id',
        'nombre',
        'fecha_inicio',
        'fecha_fin',
        'duracion_minutos',
        'capacidad_max',
        'profesor_id',
        'tipo_clase',
        'tipo_clase_id',
        'activa',
        'es_especial',
        'companion_modality',
        'profesionales!inner(id,nombre,apellidos,color,visible_publico)'
    ].join(',');

    // Modalidades de Yoga en Compañía: alias de URL -> valor en clases.companion_modality
    const COMPANION_MODALITY_MAP = {
        colegas: 'colegas',
        colega: 'colegas',
        compania_colegas: 'colegas',
        pareja: 'pareja',
        parejas: 'pareja',
        compania_pareja: 'pareja',
        hijo: 'hijo',
        hijos: 'hijo',
        compania_hijo: 'hijo',
        abuela: 'abuela',
        abuelas: 'abuela',
        abuelo: 'abuela',
        compania_abuela: 'abuela',
        madre: 'madre',
        madre_hija: 'madre',
        'madre-hija': 'madre',
        '50_anos': 'madre'
    };
    const COMPANION_MODALITY_LABELS = {
        colegas: 'Yoga con colegas',
        pareja: 'Yoga con tu pareja',
        hijo: 'Yoga con tu hijo/a',
        abuela: 'Yoga con tu abuela/nieta',
        madre: 'Yoga con tu Madre/Hija'
    };
    function normalizeCompanionModality(value) {
        return COMPANION_MODALITY_MAP[String(value || '').toLowerCase().trim()] || '';
    }

    const copy = {
        es: {
            back: 'Clases',
            live: 'Horario conectado en directo',
            schedule: 'Horario',
            weekly: ' semanal',
            intro: 'Elige tu momento. Cada cambio realizado en el estudio aparece aquí automáticamente.',
            today: 'Hoy',
            weekOf: 'Semana del',
            filter: 'Filtrar por práctica',
            clear: 'Quitar filtros',
            errorTitle: 'No hemos podido cargar el horario',
            errorText: 'Comprueba tu conexión y vuelve a intentarlo.',
            retry: 'Reintentar',
            emptyTitle: 'Esta semana respira un poco más despacio',
            emptyText: 'No hay clases publicadas para esta selección.',
            emptyFiltered: 'No hay clases de esta práctica en la semana seleccionada. Puedes cambiar de semana o quitar los filtros.',
            nextWeek: 'Ver semana siguiente',
            caption: 'Horario semanal público de GEN Yoga',
            updated: 'Datos actualizados desde el estudio',
            timezone: 'Horario de Albacete · Europe/Madrid',
            facilitiesEyebrow: 'El espacio',
            facilitiesTitle: 'Instalaciones',
            facilitiesIntro: 'Luz, calma y todo lo necesario para que llegues, respires y solo tengas que estar.',
            facilityOne: 'Sala de práctica',
            facilityTwo: 'Luz y amplitud',
            facilityThree: 'Todo preparado',
            facilityFour: 'Un rincón para llegar',
            facilityFive: 'Atención cercana',
            all: 'Todas',
            time: 'Hora',
            loading: 'Consultando el horario del estudio…',
            loadedOne: '1 clase publicada',
            loadedMany: '{count} clases publicadas',
            refreshed: 'Actualizado a las {time}',
            available: 'Disponible',
            checkSpot: 'Consultar plaza',
            spotsOne: '1 libre',
            spotsMany: '{count} libres',
            full: 'Completa',
            finished: 'Finalizada',
            closed: 'Reserva cerrada',
            buy: 'Comprar o reservar',
            workshop: 'Reservar clase especial',
            noDayClasses: 'No hay clases publicadas para este día.',
            selectedStyle: 'Mostrando {style}',
            selectedTeacher: 'con {teacher}',
            previousWeek: 'Semana anterior',
            followingWeek: 'Semana siguiente',
            viewTeacher: 'Ver el perfil de {teacher}',
            classAction: '{action}: {name}, {date}, de {start} a {end}',
            vinyasa: 'Power Vinyasa',
            powerVinyasa: 'Power Vinyasa',
            restorative: 'Yoga Restaurativo',
            men: 'Yoga para Hombres',
            everyone: 'Yoga para Todos',
            therapeutic: 'Yoga terapéutico',
            silviaYoga: 'Yoga con Silvia',
            ayurveda: 'Yoga y Ayurveda',
            special: 'Talleres',
            filterPractice: 'Filtrar por práctica',
            filterSpecialist: 'Filtrar por profesional',
            filterWorkshop: 'Filtrar por taller o evento',
            calendar_mode_all: 'Calendario Global',
            calendar_mode_classes: 'Clases de Yoga',
            calendar_mode_consultations: 'Consultas',
            calendar_mode_workshops: 'Talleres y Clases Especiales',
            calendar_spot_free: 'Disponible',
            calendar_spot_occupied: 'Ocupada',
            calendar_book_consultation: 'Reservar consulta'
        },
        en: {
            back: 'Classes',
            live: 'Live connected schedule',
            schedule: 'Schedule',
            weekly: ' weekly',
            intro: 'Choose your moment. Every studio change appears here automatically.',
            today: 'Today',
            weekOf: 'Week of',
            filter: 'Filter by practice',
            clear: 'Clear filters',
            errorTitle: 'We could not load the schedule',
            errorText: 'Check your connection and try again.',
            retry: 'Try again',
            emptyTitle: 'A quieter week to breathe',
            emptyText: 'There are no published classes for this selection.',
            emptyFiltered: 'There are no classes for this practice in the selected week. Change week or clear the filters.',
            nextWeek: 'View next week',
            caption: 'GEN Yoga public weekly schedule',
            updated: 'Live data from the studio',
            timezone: 'Albacete time · Europe/Madrid',
            facilitiesEyebrow: 'The space',
            facilitiesTitle: 'Facilities',
            facilitiesIntro: 'Light, calm and everything you need to arrive, breathe and simply be.',
            facilityOne: 'Practice room',
            facilityTwo: 'Light and openness',
            facilityThree: 'Everything ready',
            facilityFour: 'A place to arrive',
            facilityFive: 'Personal attention',
            all: 'All',
            time: 'Time',
            loading: 'Checking the studio schedule…',
            loadedOne: '1 class published',
            loadedMany: '{count} classes published',
            refreshed: 'Updated at {time}',
            available: 'Available',
            checkSpot: 'Check spot',
            spotsOne: '1 spot',
            spotsMany: '{count} spots',
            full: 'Full',
            finished: 'Finished',
            closed: 'Booking closed',
            buy: 'Buy or book',
            workshop: 'Book special class',
            noDayClasses: 'There are no published classes on this day.',
            selectedStyle: 'Showing {style}',
            selectedTeacher: 'with {teacher}',
            previousWeek: 'Previous week',
            followingWeek: 'Next week',
            viewTeacher: 'View {teacher} profile',
            classAction: '{action}: {name}, {date}, from {start} to {end}',
            vinyasa: 'Power Vinyasa',
            powerVinyasa: 'Power Vinyasa',
            restorative: 'Restorative Yoga',
            men: 'Yoga for Men',
            everyone: 'Yoga for Everyone',
            therapeutic: 'Therapeutic yoga',
            silviaYoga: 'Yoga with Silvia',
            ayurveda: 'Yoga and Ayurveda',
            special: 'Workshops',
            filterPractice: 'Filter by practice',
            filterSpecialist: 'Filter by specialist',
            filterWorkshop: 'Filter by workshop or event',
            calendar_mode_all: 'Global Schedule',
            calendar_mode_classes: 'Yoga Classes',
            calendar_mode_consultations: 'Consultations',
            calendar_mode_workshops: 'Workshops & Special Classes',
            calendar_spot_free: 'Available',
            calendar_spot_occupied: 'Occupied',
            calendar_book_consultation: 'Book consultation'
        }
    };

    const knownTeacherColors = Object.freeze({
        'angel-javier': '#7f9fc0',
        yanira: '#df7fa5',
        silvia: '#68704a',
        miriam: '#9a83b9',
        isabel: '#8f6b2d'
    });
    const consultationSlotStartMinutes = Object.freeze([
        9 * 60 + 30,
        10 * 60 + 30,
        11 * 60 + 30,
        12 * 60 + 30,
        17 * 60,
        18 * 60,
        19 * 60,
        20 * 60
    ]);
    const silviaConsultationSlotStartMinutes = Object.freeze([
        15 * 60,
        16 * 60 + 30,
        18 * 60
    ]);
    const silviaConsultationAnchorDate = '2026-06-19';
    const consultationWeekdays = Object.freeze({
        miriam: Object.freeze([2, 3]),
        isabel: Object.freeze([2, 4])
    });
    const SEASON_START_WEEK = '2026-08-24';
    const SEASON_START_DATE = '2026-08-24';

    function defaultWeekStart() {
        const currentMonday = mondayFor(todayKeyMadrid());
        return currentMonday < SEASON_START_WEEK ? SEASON_START_WEEK : currentMonday;
    }

    const state = {
        initialized: false,
        open: false,
        client: null,
        mode: 'clases',
        oferta: '',
        weekStart: '',
        classes: [],
        typeColors: new Map(),
        typeColorsLoaded: false,
        style: '',
        teacher: '',
        classId: null,
        selectedDay: '',
        loading: false,
        error: null,
        availabilityExact: false,
        rpcAvailable: null,
        targetResolved: true,
        explicitWeek: false,
        requestSerial: 0,
        lastUpdated: null,
        lastFocus: null,
        historyPushed: false,
        realtimeChannel: null,
        reloadTimer: null,
        pollingTimer: null,
        dirty: false,
        inertSiblings: [],
        pendingOpenOptions: null
    };

    const el = {};

    function currentLanguage() {
        return root.currentLang === 'en' ? 'en' : 'es';
    }

    function locale() {
        return currentLanguage() === 'en' ? 'en-GB' : 'es-ES';
    }

    function text(key, replacements) {
        let value = copy[currentLanguage()]?.[key] || copy.es?.[key] || '';
        if (!value) {
            // Clean fallback: remove technical prefix and formatting
            value = String(key || '')
                .replace(/^calendar_mode_/, '')
                .replace(/^calendar_spot_/, '')
                .replace(/^calendar_/, '')
                .replace(/_/g, ' ');
        }
        Object.entries(replacements || {}).forEach(([name, replacement]) => {
            value = value.replace(`{${name}}`, String(replacement));
        });
        return value;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function safePositiveInteger(value) {
        const number = Number(value);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
    }

    function stripDiacritics(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function slugify(value) {
        return stripDiacritics(value)
            .toLowerCase()
            .replace(/&/g, ' y ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
    }

    function canonicalStyle(value) {
        const normalized = stripDiacritics(value)
            .toLowerCase()
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalized) return '';
        if (normalized.includes('introductor') || normalized.includes('bienvenida') || normalized.includes('gratis') || normalized.includes('prueba') || normalized.includes('clase abierta') || normalized.includes('abierta')) return 'sesion-introductoria';
        if (normalized.includes('power') && normalized.includes('vinyasa')) return 'power-vinyasa';
        if (normalized.includes('restaur') || normalized.includes('suave')) return 'restaurativa';
        if (normalized.includes('hombre')) return 'yoga-para-hombres';
        if (normalized.includes('para todos') || normalized.includes('for everyone')) return 'yoga-para-todos';
        if (normalized.includes('terapeut')) return 'yoga-terapeutico';
        if (normalized.includes('aryuved') || normalized.includes('ayurved')) return 'ayurveda';
        if (normalized.includes('silvia') && normalized.includes('yoga')) return 'yoga-con-silvia';
        if (normalized.includes('taller') || normalized.includes('especial')) return 'taller';
        if (normalized.includes('vinyasa')) return 'vinyasa';
        return slugify(normalized);
    }

    function publicClassName(value) {
        const original = String(value || '').trim();
        const normalized = stripDiacritics(original).toLowerCase().replace(/\s+/g, ' ');
        if (normalized === 'yoga aryuveda' || normalized === 'yoga ayurveda') return 'Yoga y Ayurveda';
        if (normalized === 'yoga (silvia) consultas') return 'Yoga con Silvia';
        return original;
    }

    function normalizeTeacherParam(value) {
        const slug = slugify(value);
        if (slug === 'angel' || slug === 'angel-javier' || slug === 'angeljavier') return 'angel-javier';
        return slug;
    }

    function teacherSlug(profile) {
        const fromShared = root.GENTeacherProfiles?.getSlug?.(profile);
        if (fromShared) return normalizeTeacherParam(fromShared);

        const identity = `${profile?.nombre || ''} ${profile?.apellidos || ''} ${profile?.email || ''}`.toLowerCase();
        if (identity.includes('yanira')) return 'yanira';
        if (identity.includes('miriam') || identity.includes('respira')) return 'miriam';
        if (identity.includes('silvia') || identity.includes('sil-hada')) return 'silvia';
        if (identity.includes('isabel') || identity.includes('isarodriguez')) return 'isabel';
        if (identity.includes('ángel') || identity.includes('angel')) return 'angel-javier';
        return slugify(identity) || (safePositiveInteger(profile?.id) ? `profesor-${profile.id}` : 'profesor');
    }

    function consultationStartMinutesFor(profile, dateKey) {
        const validDate = validDateKey(dateKey);
        if (!validDate) return [];

        const weekday = new Date(`${validDate}T12:00:00Z`).getUTCDay() || 7;
        const slug = teacherSlug(profile);
        const allowedWeekdays = consultationWeekdays[slug];
        if (allowedWeekdays) {
            return allowedWeekdays.includes(weekday) ? consultationSlotStartMinutes : [];
        }

        if (slug === 'silvia') {
            const anchor = new Date(`${silviaConsultationAnchorDate}T12:00:00Z`);
            const requested = new Date(`${validDate}T12:00:00Z`);
            const daysFromAnchor = Math.round((requested.getTime() - anchor.getTime()) / 86_400_000);
            return weekday === 5 && daysFromAnchor % 14 === 0
                ? silviaConsultationSlotStartMinutes
                : [];
        }
        return [];
    }

    function consultationDurationMinutesFor(profile) {
        return teacherSlug(profile) === 'silvia' ? 90 : 60;
    }

    function isCanonicalConsultationClass(item) {
        if (!item) return false;
        if (item?.professor?.slug === 'silvia') {
            return item.classType === 'nutricion'
                && item.durationMinutes === 90
                && consultationStartMinutesFor(item.professor, item.dateKey).includes(item.startMinutes);
        }
        if (item?.professor?.slug === 'angel-javier') {
            if (item.startMinutes >= 1260) return false;
            if (item.startMinutes === 1080 && item.durationMinutes === 60) return false;
        }
        return true;
    }

    function isPublicScheduleSlot(profile, dateKey) {
        const validDate = validDateKey(dateKey);
        if (!validDate) return false;
        const weekday = new Date(`${validDate}T12:00:00Z`).getUTCDay();
        return !(teacherSlug(profile) === 'angel-javier' && weekday === 5);
    }

    function validDateKey(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '';
        const date = new Date(`${value}T12:00:00Z`);
        return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
    }

    function addDays(dateKey, amount) {
        const date = new Date(`${dateKey}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() + amount);
        return date.toISOString().slice(0, 10);
    }

    function mondayFor(dateKey) {
        const valid = validDateKey(dateKey) || todayKeyMadrid();
        const date = new Date(`${valid}T12:00:00Z`);
        const weekday = date.getUTCDay() || 7;
        return addDays(valid, 1 - weekday);
    }

    function dateKeyPartsInMadrid(dateValue) {
        const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
        if (Number.isNaN(date.getTime())) return null;

        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            hourCycle: 'h23'
        }).formatToParts(date);
        const mapped = Object.fromEntries(parts.map(part => [part.type, part.value]));
        const hour = Number(mapped.hour) === 24 ? 0 : Number(mapped.hour);
        return {
            dateKey: `${mapped.year}-${mapped.month}-${mapped.day}`,
            hour,
            minute: Number(mapped.minute),
            minutes: hour * 60 + Number(mapped.minute)
        };
    }

    function todayKeyMadrid() {
        return dateKeyPartsInMadrid(new Date())?.dateKey || new Date().toISOString().slice(0, 10);
    }

    function formatDateKey(dateKey, options) {
        const date = new Date(`${dateKey}T12:00:00Z`);
        return new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...options }).format(date);
    }

    function formatTime(dateValue) {
        return new Intl.DateTimeFormat(locale(), {
            timeZone: TIME_ZONE,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            hourCycle: 'h23'
        }).format(new Date(dateValue));
    }

    function formatMinutes(minutes) {
        const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
        const mins = String(minutes % 60).padStart(2, '0');
        return `${hours}:${mins}`;
    }

    function weekRangeLabel(weekStart) {
        const weekEnd = addDays(weekStart, 6);
        const startYear = weekStart.slice(0, 4);
        const endYear = weekEnd.slice(0, 4);
        const startMonth = weekStart.slice(5, 7);
        const endMonth = weekEnd.slice(5, 7);

        if (startYear === endYear && startMonth === endMonth) {
            const startDay = formatDateKey(weekStart, { day: 'numeric' });
            const end = formatDateKey(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' });
            return `${startDay} – ${end}`;
        }

        const start = formatDateKey(weekStart, {
            day: 'numeric',
            month: 'short',
            ...(startYear !== endYear ? { year: 'numeric' } : {})
        });
        const end = formatDateKey(weekEnd, { day: 'numeric', month: 'short', year: 'numeric' });
        return `${start} – ${end}`;
    }

    function normaliseColor(value) {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
    }

    function normalizeClassRow(raw, exactAvailability) {
        const id = safePositiveInteger(raw?.id);
        const start = new Date(raw?.fecha_inicio);
        if (!id || Number.isNaN(start.getTime())) return null;

        const duration = Number(raw?.duracion_minutos);
        let end = new Date(raw?.fecha_fin);
        if (Number.isNaN(end.getTime()) || end <= start) {
            end = new Date(start.getTime() + (Number.isFinite(duration) && duration > 0 ? duration : 60) * 60_000);
        }

        const madridStart = dateKeyPartsInMadrid(start);
        if (!madridStart || madridStart.dateKey < SEASON_START_DATE) return null;
        const professional = Array.isArray(raw?.profesionales)
            ? raw.profesionales[0]
            : raw?.profesionales;
        const professor = {
            id: safePositiveInteger(raw?.profesor_id ?? professional?.id),
            nombre: String(raw?.profesor_nombre ?? professional?.nombre ?? '').trim(),
            apellidos: String(raw?.profesor_apellidos ?? professional?.apellidos ?? '').trim(),
            color: normaliseColor(raw?.profesor_color ?? professional?.color)
        };
        professor.slug = teacherSlug(professor);
        professor.displayName = `${professor.nombre} ${professor.apellidos}`.trim() || 'GEN Yoga';
        if (!isPublicScheduleSlot(professor, madridStart.dateKey)) return null;

        const freeSpots = Number(raw?.plazas_libres);
        const occupied = Number(raw?.ocupadas);
        const rawClassType = String(raw?.tipo_clase || '').toLowerCase().trim();
        const rawName = String(raw?.nombre || '').trim();
        const isIntroOrOpen = /introductor|bienvenida|abierta|gratis|prueba/i.test(rawName);
        const isSpecial = !isIntroOrOpen && (
            raw?.es_especial === true
            || rawClassType === 'taller'
            || rawClassType === 'especial'
            || /taller|masterclass/i.test(rawName)
        );
        const classType = isSpecial ? 'taller' : (rawClassType || 'yoga');
        const databaseName = publicClassName(
            rawName || (isSpecial ? 'Taller GEN Yoga' : 'Yoga')
        );
        const name = professor.slug === 'angel-javier'
            && canonicalStyle(databaseName) === 'yoga-terapeutico'
            ? 'Yoga para Todos'
            : databaseName;

        const rawCap = Number(raw?.capacidad_max);
        const capacity = classType === 'yoga'
            ? (Number.isFinite(rawCap) && rawCap > 0 && rawCap <= 10 ? rawCap : 10)
            : Math.max(0, rawCap || 0);

        let finalOccupied = exactAvailability && Number.isFinite(occupied) ? Math.max(0, occupied) : null;
        let finalFreeSpots = exactAvailability && Number.isFinite(freeSpots) ? Math.max(0, freeSpots) : null;
        if (classType === 'yoga' && exactAvailability) {
            if (finalOccupied !== null) {
                finalFreeSpots = Math.max(0, capacity - finalOccupied);
            } else if (finalFreeSpots !== null && finalFreeSpots > 10) {
                finalFreeSpots = 10;
            }
        }
        const hours = Math.floor(madridStart.minutes / 60);
        const mins = madridStart.minutes % 60;
        const timeStr = String(hours).padStart(2, '0') + ':' + String(mins).padStart(2, '0');
        const profSlug = professor.slug || '';
        const isOfficialFree = (
            (madridStart.dateKey === '2026-08-30' && (timeStr === '10:00' || timeStr === '12:00') && profSlug.includes('angel')) ||
            ((madridStart.dateKey === '2026-09-01' || madridStart.dateKey === '2026-09-03') && timeStr === '19:00' && profSlug.includes('yanira')) ||
            (((madridStart.dateKey === '2026-09-01' && timeStr === '20:15') || (madridStart.dateKey === '2026-09-02' && timeStr === '11:30')) && (profSlug.includes('miriam') || classType === 'psicologia')) ||
            ((madridStart.dateKey === '2026-09-18' || madridStart.dateKey === '2026-09-25') && timeStr === '11:00' && profSlug.includes('silvia')) ||
            ((madridStart.dateKey === '2026-09-03' || madridStart.dateKey === '2026-09-22') && timeStr === '11:00' && (profSlug.includes('isabel') || classType === 'nutricion' || classType === 'psicologia'))
        );

        const complete = exactAvailability
            ? (raw?.completa === true || (finalFreeSpots !== null && finalFreeSpots <= 0))
            : null;

        return {
            id,
            name,
            start,
            end,
            dateKey: madridStart.dateKey,
            startMinutes: madridStart.minutes,
            durationMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)),
            capacity,
            occupied: finalOccupied,
            freeSpots: finalFreeSpots,
            complete,
            professor,
            classType,
            isSpecial,
            isFree: isOfficialFree,
            classTypeId: safePositiveInteger(raw?.tipo_clase_id),
            companionModality: String(raw?.companion_modality || '').toLowerCase().trim(),
            style: canonicalStyle(name)
        };
    }

    function classMatchesFilters(item) {
        if (state.oferta) {
            const ofKey = state.oferta.toLowerCase().trim();
            if (COMPANION_MODALITY_LABELS[ofKey]) {
                if (ofKey === 'abuela' || ofKey === 'madre') {
                    if (item.companionModality !== 'abuela' && item.companionModality !== 'madre') return false;
                } else if (item.companionModality !== ofKey) {
                    return false;
                }
            } else if (['yoga', 'bienvenida', 'gratis', 'intro', 'introductoria'].includes(ofKey)) {
                if (!item.isFree) return false;
            }
        }
        if (state.style) {
            if (state.style === 'sesion-introductoria') {
                const isIntro = item.style === 'sesion-introductoria' || String(item.name || '').toLowerCase().includes('introductoria') || String(item.name || '').toLowerCase().includes('abierta');
                if (!isIntro) return false;
            } else if (item.style !== state.style) {
                return false;
            }
        }
        if (state.teacher) {
            const teacherMatch = item.professor.slug === state.teacher
                || String(item.professor.id || '') === state.teacher;
            if (!teacherMatch) return false;
        }
        return true;
    }

    function filteredClasses() {
        return state.classes.filter(classMatchesFilters);
    }

    function styleLabel(style, sourceClasses) {
        const known = {
            'sesion-introductoria': 'Sesión Introductoria de Yoga',
            'power-vinyasa': text('powerVinyasa'),
            vinyasa: text('vinyasa'),
            restaurativa: text('restorative'),
            'yoga-para-hombres': text('men'),
            'yoga-para-todos': text('everyone'),
            'yoga-terapeutico': text('therapeutic'),
            'yoga-con-silvia': text('silviaYoga'),
            ayurveda: text('ayurveda'),
            taller: text('special')
        };
        if (known[style]) return known[style];

        const sample = (sourceClasses || state.classes).find(item => item.style === style);
        if (sample?.name) return sample.name;
        return style
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    const defaultStyleColors = Object.freeze({
        'sesion-introductoria': '#047857',
        'power-vinyasa': '#df7fa5',
        vinyasa: '#df7fa5',
        restaurativa: '#c3b89a',
        'yoga-para-hombres': '#5A8A7A',
        'yoga-para-todos': '#7f9fc0',
        'yoga-terapeutico': '#68704a',
        'yoga-con-silvia': '#c9a74c',
        ayurveda: '#68704a',
        taller: '#c07238'
    });

    function eventColor(item) {
        if (item.companionModality) return '#D97706';
        if (state.mode === 'consultas' || item.classType === 'psicologia' || item.classType === 'nutricion' || item.classType === 'consulta') {
            if (item.professor?.slug && knownTeacherColors[item.professor.slug]) return knownTeacherColors[item.professor.slug];
            if (item.professor?.color) return item.professor.color;
        }
        if (state.mode === 'talleres' || item.classType === 'taller' || item.classType === 'especial') {
            if (defaultStyleColors[item.style]) return defaultStyleColors[item.style];
            return '#c07238';
        }
        const byTypeId = item.classTypeId ? state.typeColors.get(`id:${item.classTypeId}`) : '';
        const byStyle = state.typeColors.get(`style:${item.style}`);
        if (byTypeId) return byTypeId;
        if (byStyle) return byStyle;
        if (defaultStyleColors[item.style]) return defaultStyleColors[item.style];
        if (item.professor?.color) return item.professor.color;
        return knownTeacherColors[item.professor?.slug] || '#d96542';
    }

    function bookingCutoffHours() {
        try {
            if (typeof lastReservaVal !== 'undefined') {
                const value = Number(lastReservaVal);
                if (Number.isFinite(value) && value >= 0 && value <= 168) return value;
            }
        } catch (_) {}
        return 12;
    }

    function getEventState(item) {
        const now = Date.now();
        if (item.end.getTime() <= now) {
            return { disabled: true, stateClass: 'is-past', badge: text('finished'), hint: text('finished') };
        }
        if (item.classType === 'psicologia' || item.classType === 'nutricion' || item.classType === 'consulta') {
            if (item.complete === true || (Number.isFinite(item.freeSpots) && item.freeSpots <= 0)) {
                return { disabled: true, stateClass: 'is-full gy-calendar__event-badge--occupied', badge: text('calendar_spot_occupied'), hint: text('calendar_spot_occupied') };
            }
            const spotsText = Number.isFinite(item.freeSpots)
                ? (item.freeSpots === 1 ? text('spotsOne') : text('spotsMany', { count: item.freeSpots }))
                : text('calendar_spot_free');
            return { disabled: false, stateClass: 'gy-calendar__event-badge--free', badge: spotsText, hint: text('calendar_book_consultation') };
        }
        if (item.complete === true || (Number.isFinite(item.freeSpots) && item.freeSpots <= 0)) {
            return { disabled: true, stateClass: 'is-full', badge: text('full'), hint: text('full') };
        }
        if (
            item.start.getTime() <= now + bookingCutoffHours() * 60 * 60 * 1000
        ) {
            return { disabled: true, stateClass: 'is-closed', badge: text('closed'), hint: text('closed') };
        }
        if (item.classType === 'taller') {
            const spotsText = Number.isFinite(item.freeSpots)
                ? (item.freeSpots === 1 ? text('spotsOne') : text('spotsMany', { count: item.freeSpots }))
                : text('available');
            return { disabled: false, stateClass: '', badge: spotsText, hint: text('workshop') };
        }
        if (item.isFree) {
            const spotsText = Number.isFinite(item.freeSpots)
                ? (item.freeSpots === 1 ? text('spotsOne') : text('spotsMany', { count: item.freeSpots }))
                : text('available');
            const badge = `🎁 Gratuita · ${spotsText}`;
            return { disabled: false, stateClass: 'gy-calendar__event-badge--free', badge, hint: 'Reservar gratis' };
        }
        const badge = item.freeSpots === 1
            ? text('spotsOne')
            : (Number.isFinite(item.freeSpots)
                ? text('spotsMany', { count: item.freeSpots })
                : text('checkSpot'));
        return { disabled: false, stateClass: '', badge, hint: text('buy') };
    }

    function teacherUrl(item) {
        const params = new URLSearchParams();
        params.set('cat', item.classType === 'taller' ? 'talleres' : 'yoga');
        params.set('teacher', item.professor.slug);
        return `maestros.html?${params.toString()}#teacher-${encodeURIComponent(item.professor.slug)}`;
    }

    function classActionLabel(item, action) {
        const date = formatDateKey(item.dateKey, { weekday: 'long', day: 'numeric', month: 'long' });
        return text('classAction', {
            action,
            name: item.name,
            date,
            start: formatTime(item.start),
            end: formatTime(item.end)
        });
    }

    function eventCardHtml(item) {
        const status = getEventState(item);
        const focused = state.classId === item.id ? ' is-focused' : '';
        const disabled = status.disabled ? ' disabled' : '';
        const teacher = item.professor.displayName;
        return `
            <article class="gy-calendar-event ${status.stateClass}${focused}" style="--event-color:${escapeHtml(eventColor(item))}" data-calendar-event="${item.id}">
                <button type="button" class="gy-calendar-event__main" data-calendar-class="${item.id}"${disabled}
                    aria-label="${escapeHtml(classActionLabel(item, status.hint))}">
                    <span class="gy-calendar-event__time">
                        <span>${escapeHtml(formatTime(item.start))}–${escapeHtml(formatTime(item.end))}</span>
                        <span class="gy-calendar-event__status">${escapeHtml(status.badge)}</span>
                    </span>
                    <strong class="gy-calendar-event__name">${escapeHtml(item.name)}</strong>
                    <span class="gy-calendar-event__hint">${escapeHtml(status.hint)} →</span>
                </button>
                <a class="gy-calendar-event__teacher" href="${escapeHtml(teacherUrl(item))}"
                    aria-label="${escapeHtml(text('viewTeacher', { teacher }))}">
                    <span>${escapeHtml(teacher)}</span>
                </a>
            </article>
        `;
    }

    function mobileEventHtml(item) {
        const status = getEventState(item);
        const focused = state.classId === item.id ? ' is-focused' : '';
        const disabled = status.disabled ? ' disabled' : '';
        const teacher = item.professor.displayName;
        return `
            <article class="gy-calendar__mobile-event ${status.stateClass}${focused}" style="--event-color:${escapeHtml(eventColor(item))}" data-calendar-event="${item.id}">
                <div class="gy-calendar__mobile-time">
                    ${escapeHtml(formatTime(item.start))}
                    <small>${escapeHtml(formatTime(item.end))}</small>
                </div>
                <div class="gy-calendar__mobile-main">
                    <button type="button" class="gy-calendar__mobile-action" data-calendar-class="${item.id}"${disabled}
                        aria-label="${escapeHtml(classActionLabel(item, status.hint))}">
                        <strong>${escapeHtml(item.name)}</strong>
                        <span>${escapeHtml(status.badge)} · ${escapeHtml(status.hint)} →</span>
                    </button>
                    <a class="gy-calendar__mobile-teacher" href="${escapeHtml(teacherUrl(item))}"
                        aria-label="${escapeHtml(text('viewTeacher', { teacher }))}">
                        <span>${escapeHtml(teacher)}</span>
                    </a>
                </div>
            </article>
        `;
    }

    function displayDayKeys(classes) {
        const keys = Array.from({ length: WEEK_DAYS_BASE }, (_, index) => addDays(state.weekStart, index));
        const sunday = addDays(state.weekStart, 6);
        if (classes.some(item => item.dateKey === sunday)) keys.push(sunday);
        return keys;
    }

    function renderTable(classes) {
        const days = displayDayKeys(state.classes);
        const today = todayKeyMadrid();
        const timeRows = [...new Set(classes.map(item => item.startMinutes))].sort((a, b) => a - b);

        el.tableHead.innerHTML = `
            <tr>
                <th scope="col">${escapeHtml(text('time'))}</th>
                ${days.map(day => `
                    <th scope="col" class="${day === today ? 'is-today' : ''}">
                        <span class="gy-calendar__table-day">${escapeHtml(formatDateKey(day, { weekday: 'long' }))}</span>
                        <span class="gy-calendar__table-date">${escapeHtml(formatDateKey(day, { day: 'numeric', month: 'short' }))}</span>
                    </th>
                `).join('')}
            </tr>
        `;

        el.tableBody.innerHTML = timeRows.map(minutes => `
            <tr>
                <th scope="row">${escapeHtml(formatMinutes(minutes))}</th>
                ${days.map(day => {
                    const events = classes.filter(item => item.dateKey === day && item.startMinutes === minutes);
                    return `
                        <td class="${day === today ? 'is-today' : ''}">
                            <div class="gy-calendar__cell-stack">${events.map(eventCardHtml).join('')}</div>
                        </td>
                    `;
                }).join('')}
            </tr>
        `).join('');
    }

    function ensureSelectedMobileDay(days, classes) {
        if (days.includes(state.selectedDay)) return;
        const today = todayKeyMadrid();
        if (days.includes(today)) {
            state.selectedDay = today;
            return;
        }
        state.selectedDay = days.find(day => classes.some(item => item.dateKey === day)) || days[0] || state.weekStart;
    }

    function renderMobile(classes) {
        const days = displayDayKeys(state.classes);
        ensureSelectedMobileDay(days, classes);
        const today = todayKeyMadrid();

        el.dayTabs.innerHTML = days.map(day => {
            const count = classes.filter(item => item.dateKey === day).length;
            const selected = day === state.selectedDay;
            return `
                <button type="button" class="gy-calendar__day-tab ${day === today ? 'is-today' : ''}"
                    role="tab" aria-selected="${selected}" data-calendar-day="${day}"
                    aria-controls="calendar-day-agenda">
                    <span>${escapeHtml(formatDateKey(day, { weekday: 'short' }))}</span>
                    <strong>${escapeHtml(formatDateKey(day, { day: 'numeric' }))}</strong>
                    ${count ? '<i aria-hidden="true"></i>' : ''}
                </button>
            `;
        }).join('');

        const dayClasses = classes
            .filter(item => item.dateKey === state.selectedDay)
            .sort((a, b) => a.start - b.start);
        el.dayAgenda.setAttribute(
            'aria-label',
            formatDateKey(state.selectedDay, { weekday: 'long', day: 'numeric', month: 'long' })
        );
        el.dayAgenda.innerHTML = dayClasses.length
            ? dayClasses.map(mobileEventHtml).join('')
            : `<div class="gy-calendar__agenda-empty">${escapeHtml(text('noDayClasses'))}</div>`;
    }

    function syncStaticCopy() {
        document.querySelectorAll('[data-calendar-copy]').forEach(node => {
            const key = node.getAttribute('data-calendar-copy');
            const translation = copy[currentLanguage()]?.[key] || copy.es?.[key];
            if (translation) node.textContent = text(key);
        });
        el.prevWeek?.setAttribute('aria-label', text('previousWeek'));
        el.nextWeek?.setAttribute('aria-label', text('followingWeek'));
        el.dayTabs?.setAttribute('aria-label', currentLanguage() === 'en' ? 'Days of the week' : 'Días de la semana');
    }

    function renderFilters() {
        if (state.mode === 'consultas') {
            const profs = [
                { slug: '', label: text('all'), color: '' },
                { slug: 'miriam', label: 'Miriam Alfaro (Psicología)', color: '#9a83b9' },
                { slug: 'silvia', label: 'Silvia Jaén (Ayurveda)', color: '#68704a' },
                { slug: 'isabel', label: 'Isabel Rodríguez (PNI)', color: '#8f6b2d' }
            ];
            el.styleFilters.innerHTML = profs.map(prof => `
                <button type="button" class="gy-calendar__filter"
                    data-calendar-teacher="${escapeHtml(prof.slug)}"
                    aria-pressed="${state.teacher === prof.slug}"
                    ${prof.color ? `style="--filter-accent:${prof.color}"` : ''}>
                    ${escapeHtml(prof.label)}
                </button>
            `).join('');
            const filterLabel = document.querySelector('.gy-calendar__filter-label');
            if (filterLabel) filterLabel.textContent = text('filterSpecialist');
            el.styleFilters.setAttribute('aria-label', text('filterSpecialist'));
            el.clearFilters.hidden = !(state.style || state.teacher || state.oferta);
            return;
        }

        if (state.mode === 'talleres') {
            const styles = [];
            state.classes.forEach(item => {
                if (item.style && !styles.includes(item.style)) styles.push(item.style);
            });
            if (state.style && !styles.includes(state.style)) styles.unshift(state.style);

            const buttons = [
                { style: '', label: text('all') },
                ...styles.map(style => ({ style, label: styleLabel(style, state.classes) }))
            ];
            el.styleFilters.innerHTML = buttons.map(button => `
                <button type="button" class="gy-calendar__filter"
                    data-calendar-style="${escapeHtml(button.style)}"
                    aria-pressed="${state.style === button.style}">
                    ${escapeHtml(button.label)}
                </button>
            `).join('');
            const filterLabel = document.querySelector('.gy-calendar__filter-label');
            if (filterLabel) filterLabel.textContent = text('filterWorkshop');
            el.styleFilters.setAttribute('aria-label', text('filterWorkshop'));
            el.clearFilters.hidden = !(state.style || state.teacher || state.oferta);
            return;
        }

        // Mode 'clases'
        const source = state.teacher
            ? state.classes.filter(item => (
                item.professor.slug === state.teacher
                || String(item.professor.id || '') === state.teacher
            ))
            : state.classes;
        const styles = [];
        source.forEach(item => {
            if (item.style && !styles.includes(item.style)) styles.push(item.style);
        });
        if (state.style && !styles.includes(state.style)) styles.unshift(state.style);

        const buttons = [
            { style: '', label: text('all') },
            ...styles.map(style => ({ style, label: styleLabel(style, source) }))
        ];
        el.styleFilters.innerHTML = buttons.map(button => `
            <button type="button" class="gy-calendar__filter"
                data-calendar-style="${escapeHtml(button.style)}"
                aria-pressed="${state.style === button.style}">
                ${escapeHtml(button.label)}
            </button>
        `).join('');
        const filterLabel = document.querySelector('.gy-calendar__filter-label');
        if (filterLabel) filterLabel.textContent = text('filterPractice');
        el.styleFilters.setAttribute('aria-label', text('filterPractice'));
        el.clearFilters.hidden = !(state.style || state.teacher || state.oferta);
    }

    function renderSelectionNote() {
        if (!state.style && !state.teacher && !state.oferta) {
            el.selection.hidden = true;
            el.selection.replaceChildren();
            return;
        }

        const fragments = [];
        if (COMPANION_MODALITY_LABELS[state.oferta]) {
            fragments.push(`🤝 Yoga en Compañía · ${COMPANION_MODALITY_LABELS[state.oferta]}: mostrando únicamente las clases de esta modalidad.`);
        } else if (state.oferta === 'madre_hija') {
            fragments.push('🎁 Oferta Activa: Yoga Madre e Hija (50 años) · Horarios válidos: Lunes y Miércoles 16:15 (Ángel) y Miércoles y Viernes 08:00 (Yanira)');
        } else if (state.oferta === 'yoga') {
            fragments.push('🎁 Bono de Bienvenida Activo: Clases introductorias y gratuitas de Yoga');
        }
        if (state.style) {
            fragments.push(text('selectedStyle', { style: styleLabel(state.style, state.classes) }));
        }
        if (state.teacher) {
            const teacherClass = state.classes.find(item => (
                item.professor.slug === state.teacher
                || String(item.professor.id || '') === state.teacher
            ));
            const teacherName = teacherClass?.professor.displayName
                || (state.teacher === 'miriam' ? 'Miriam Alfaro' : (state.teacher === 'silvia' ? 'Silvia Jaén' : (state.teacher === 'isabel' ? 'Isabel Rodríguez' : state.teacher.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase()))));
            fragments.push(text('selectedTeacher', { teacher: teacherName }));
        }
        el.selection.textContent = `${fragments.join('. ')}.`;
        el.selection.hidden = false;
    }

    function hideResultViews() {
        el.skeleton.hidden = true;
        el.error.hidden = true;
        el.empty.hidden = true;
        el.desktop.hidden = true;
        el.mobile.hidden = true;
    }

    function render() {
        if (!state.initialized) return;
        syncStaticCopy();
        const btnGlobal = document.getElementById('calendar-mode-global') || document.getElementById('calendar-mode-todo');
        const btnClases = document.getElementById('calendar-mode-clases');
        const btnConsultas = document.getElementById('calendar-mode-consultas');
        const btnTalleres = document.getElementById('calendar-mode-talleres');
        if (btnGlobal) btnGlobal.classList.toggle('active', state.mode === 'todo' || state.mode === 'global');
        if (btnClases) btnClases.classList.toggle('active', state.mode === 'clases');
        if (btnConsultas) btnConsultas.classList.toggle('active', state.mode === 'consultas');
        if (btnTalleres) btnTalleres.classList.toggle('active', state.mode === 'talleres');
        el.weekRange.textContent = weekRangeLabel(state.weekStart);
        if (el.prevWeek) {
            const atSeasonStart = state.weekStart <= SEASON_START_WEEK;
            el.prevWeek.disabled = atSeasonStart;
            el.prevWeek.classList.toggle('gy-calendar__nav-button--disabled', atSeasonStart);
        }
        renderFilters();
        renderSelectionNote();
        hideResultViews();

        if (state.loading && !state.classes.length) {
            el.status.textContent = text('loading');
            el.skeleton.hidden = false;
            return;
        }

        if (state.error && !state.classes.length) {
            el.status.textContent = '';
            el.error.hidden = false;
            return;
        }

        const classes = filteredClasses();
        const refreshedAt = state.lastUpdated
            ? new Intl.DateTimeFormat(locale(), {
                timeZone: TIME_ZONE,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).format(state.lastUpdated)
            : '';
        const countCopy = classes.length === 1
            ? text('loadedOne')
            : text('loadedMany', { count: classes.length });
        el.status.textContent = refreshedAt
            ? `${countCopy} · ${text('refreshed', { time: refreshedAt })}`
            : countCopy;

        if (!classes.length) {
            el.emptyCopy.textContent = state.style || state.teacher ? text('emptyFiltered') : text('emptyText');
            el.empty.hidden = false;
            return;
        }

        el.desktop.hidden = false;
        el.mobile.hidden = false;
        renderTable(classes);
        renderMobile(classes);

        if (state.classId) {
            requestAnimationFrame(() => {
                const focused = el.panel.querySelector(`[data-calendar-event="${state.classId}"]`);
                focused?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
            });
        }
    }

    async function loadTypeColors() {
        if (state.typeColorsLoaded || !state.client) return;
        try {
            const { data, error } = await state.client
                .from('tipos_clases')
                .select('id,nombre,color,activo')
                .eq('activo', true)
                .order('orden');
            if (error) throw error;

            state.typeColors.clear();
            (data || []).forEach(type => {
                const color = normaliseColor(type.color);
                if (!color) return;
                const typeId = safePositiveInteger(type.id);
                if (typeId) state.typeColors.set(`id:${typeId}`, color);
                state.typeColors.set(`style:${canonicalStyle(type.nombre)}`, color);
            });
        } catch (error) {
            console.warn('No se pudieron cargar los colores públicos del horario:', error?.message || error);
        } finally {
            state.typeColorsLoaded = true;
        }
    }

    function broadUtcBounds(weekStart) {
        const start = new Date(`${addDays(weekStart, -1)}T00:00:00Z`);
        const end = new Date(`${addDays(weekStart, 8)}T00:00:00Z`);
        return { start: start.toISOString(), end: end.toISOString() };
    }

    async function fetchDirectWeek(weekStart, targetMode) {
        const bounds = broadUtcBounds(weekStart);
        let query = state.client
            .from('clases')
            .select(DIRECT_SELECT)
            .eq('activa', true)
            .eq('profesionales.visible_publico', true)
            .gte('fecha_inicio', bounds.start)
            .lt('fecha_inicio', bounds.end)
            .order('fecha_inicio')
            .limit(300);

        if (targetMode === 'talleres') {
            query = query.or('tipo_clase.eq.taller,tipo_clase.eq.especial,es_especial.eq.true');
        } else if (targetMode === 'clases') {
            query = query.or('tipo_clase.eq.yoga,tipo_clase.is.null,es_especial.eq.false,nombre.ilike.%introductor%,nombre.ilike.%abierta%,nombre.ilike.%bienvenida%');
        }

        const { data, error } = await query;
        if (error) throw error;
        const mapped = (data || [])
            .map(row => normalizeClassRow(row, false))
            .filter(Boolean)
            .filter(item => item.dateKey >= weekStart && item.dateKey < addDays(weekStart, 7));

        let filtered = [];
        if (targetMode === 'talleres') {
            filtered = mapped.filter(item => item.classType === 'taller' || item.classType === 'especial' || item.isSpecial);
        } else if (targetMode === 'clases') {
            filtered = mapped.filter(item => (item.classType === 'yoga' || !item.classType) && !item.isSpecial);
        } else {
            filtered = mapped;
        }

        const ids = filtered.map(item => item.id);
        if (ids.length > 0) {
            try {
                // RLS oculta las reservas ajenas (anon/alumno solo ven las suyas),
                // así que el aforo real se pide a la RPC obtener_ocupacion_clases.
                let occupiedMap = null;
                const { data: occRows, error: occError } = await state.client
                    .rpc('obtener_ocupacion_clases', { p_clase_ids: ids });
                if (!occError) {
                    occupiedMap = {};
                    (occRows || []).forEach(r => {
                        occupiedMap[r.clase_id] = Number(r.ocupadas) || 0;
                    });
                } else {
                    const { data: reservas } = await state.client
                        .from('reservas_yoga')
                        .select('clase_id')
                        .in('clase_id', ids)
                        .eq('estado', 'confirmada');
                    occupiedMap = {};
                    (reservas || []).forEach(r => {
                        occupiedMap[r.clase_id] = (occupiedMap[r.clase_id] || 0) + 1;
                    });
                }

                filtered.forEach(item => {
                    const occ = occupiedMap[item.id] || 0;
                    item.occupied = occ;
                    item.freeSpots = Math.max(0, item.capacity - occ);
                    item.complete = item.freeSpots <= 0;
                });
            } catch (e) {
                console.warn('No se pudo calcular la ocupación exacta en fetchDirectWeek:', e);
            }
        }

        return filtered;
    }

    async function fetchWeekData(weekStart) {
        if (state.mode === 'todo' || state.mode === 'global') {
            const [yogaAndWorkshops, consultations] = await Promise.all([
                (async () => {
                    if (state.rpcAvailable !== false) {
                        const { data, error } = await state.client.rpc('get_public_weekly_schedule', {
                            p_week_start: weekStart
                        });
                        if (!error && Array.isArray(data)) {
                            state.rpcAvailable = true;
                            return data.map(row => normalizeClassRow(row, true)).filter(Boolean);
                        }
                    }
                    return await fetchDirectWeek(weekStart, 'todo');
                })(),
                (async () => {
                    const savedMode = state.mode;
                    state.mode = 'consultas';
                    const res = await fetchWeekData(weekStart);
                    state.mode = savedMode;
                    return res.classes || [];
                })()
            ]);

            const merged = [...(yogaAndWorkshops || []), ...(consultations || [])]
                .sort((a, b) => a.start.getTime() - b.start.getTime());
            return { exactAvailability: true, classes: merged };
        }

        if (state.mode === 'consultas') {
            const bounds = broadUtcBounds(weekStart);
            const [clasesRes, professionalsRes] = await Promise.all([
                state.client
                    .from('clases')
                    .select(DIRECT_SELECT)
                    .eq('activa', true)
                    .gte('fecha_inicio', bounds.start)
                    .lt('fecha_inicio', bounds.end)
                    .order('fecha_inicio')
                    .limit(500),
                state.client
                    .from('profesionales')
                    .select('id, nombre, apellidos, email, color, visible_publico')
                    .eq('visible_publico', true)
            ]);

            if (clasesRes.error) throw clasesRes.error;
            if (professionalsRes.error) throw professionalsRes.error;

            const rawWeekClasses = (clasesRes.data || [])
                .map(row => normalizeClassRow(row, false))
                .filter(Boolean)
                .filter(item => item.dateKey >= weekStart && item.dateKey < addDays(weekStart, 7));

            // STRICT FILTER: Only consultation classes from DB (psychology / nutrition / consultations)
            const dbClases = rawWeekClasses.filter(c =>
                (c.classType === 'psicologia' || c.classType === 'nutricion' || c.classType === 'consulta')
                && isCanonicalConsultationClass(c)
            );

            if (dbClases.length > 0) {
                const ids = dbClases.map(c => c.id);
                const mapReservas = {};
                // RLS oculta las reservas ajenas: el aforo real se pide a la RPC
                // obtener_ocupacion_clases (también cuenta psicología/nutrición).
                const { data: occRows, error: occError } = await state.client
                    .rpc('obtener_ocupacion_clases', { p_clase_ids: ids });
                if (!occError) {
                    (occRows || []).forEach(r => {
                        mapReservas[r.clase_id] = Number(r.ocupadas) || 0;
                    });
                } else {
                    const [resPsico, resNutri] = await Promise.all([
                        state.client.from('reservas_psicologia').select('clase_id,estado').in('clase_id', ids),
                        state.client.from('reservas_nutricion').select('clase_id,estado').in('clase_id', ids)
                    ]);
                    [...(resPsico.data || []), ...(resNutri.data || [])].forEach(r => {
                        if (r.estado === 'confirmada') {
                            mapReservas[r.clase_id] = (mapReservas[r.clase_id] || 0) + 1;
                        }
                    });
                }

                dbClases.forEach(item => {
                    const occupied = mapReservas[item.id] || 0;
                    item.occupied = occupied;
                    item.freeSpots = Math.max(0, item.capacity - occupied);
                    item.complete = item.freeSpots <= 0;
                });
            }

            const professionalsData = professionalsRes.data || [];
            const selectedProf = professionalsData.find(prof => {
                const slug = normalizeTeacherParam(root.GENTeacherProfiles?.getSlug?.(prof) || `${prof.nombre || ''} ${prof.apellidos || ''}`);
                return slug === state.teacher || String(prof.id) === state.teacher;
            });

            let virtualIdCounter = 9000000;
            const generatedSlots = [];
            const profsToGenerate = selectedProf ? [selectedProf] : professionalsData.filter(p => {
                const slug = teacherSlug(p);
                return ['miriam', 'silvia', 'isabel'].includes(slug);
            });

            profsToGenerate.forEach(prof => {
                const profSlug = teacherSlug(prof);
                const slotType = (profSlug === 'miriam' || profSlug === 'isabel') ? 'psicologia' : 'nutricion';
                const displayName = `${prof.nombre || ''} ${prof.apellidos || ''}`.trim();
                const profColor = prof.color || knownTeacherColors[profSlug] || '#d96542';

                for (let dayIdx = 0; dayIdx < 6; dayIdx++) {
                    const dateKey = addDays(weekStart, dayIdx);
                    if (dateKey < '2026-09-01') continue;
                    const slotStarts = consultationStartMinutesFor(prof, dateKey);

                    slotStarts.forEach(startMinutes => {
                        const existsInDb = dbClases.some(c =>
                            c.dateKey === dateKey &&
                            c.startMinutes === startMinutes &&
                            c.professor.id === prof.id
                        );

                        if (!existsInDb) {
                            const durationMinutes = consultationDurationMinutesFor(prof);
                            const slotEndMinutes = startMinutes + durationMinutes;

                            const hasTeacherClassOverlap = rawWeekClasses.some(c => {
                                if (c.professor.id !== prof.id || c.dateKey !== dateKey) return false;
                                const cStart = c.startMinutes;
                                const cEnd = c.startMinutes + (c.durationMinutes || 60);
                                return (startMinutes < cEnd && slotEndMinutes > cStart);
                            });

                            if (!hasTeacherClassOverlap) {
                                const startHour = Math.floor(startMinutes / 60);
                                const startMinute = startMinutes % 60;
                                const startStr = `${dateKey}T${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}:00`;
                                const start = new Date(startStr);
                                const end = new Date(start.getTime() + durationMinutes * 60_000);
                                const name = profSlug === 'isabel' ? 'Consulta PNI / Psicología' : (profSlug === 'silvia' ? 'Consulta Ayurveda' : 'Consulta Psicología');

                                generatedSlots.push({
                                    id: ++virtualIdCounter,
                                    name,
                                    start,
                                    end,
                                    dateKey,
                                    startMinutes,
                                    durationMinutes,
                                    capacity: 1,
                                    occupied: 0,
                                    freeSpots: 1,
                                    complete: false,
                                    professor: {
                                        id: prof.id,
                                        nombre: prof.nombre || '',
                                        apellidos: prof.apellidos || '',
                                        color: profColor,
                                        slug: profSlug,
                                        displayName
                                    },
                                    classType: slotType,
                                    classTypeId: null,
                                    style: canonicalStyle(name),
                                    isVirtual: true
                                });
                            }
                        }
                    });
                }
            });

            // Todas las consultas en el horario público y de alumnos provienen de la base de datos real (dbClases),
            // con el mismo criterio canónico que las clases de Yoga y Talleres: al eliminarse en el panel de administración,
            // desaparecen de inmediato y de forma definitiva de la vista pública.
            const allSlots = dbClases;
            return { exactAvailability: true, classes: allSlots };
        }

        if (state.mode === 'talleres') {
            if (state.rpcAvailable !== false) {
                const { data, error } = await state.client.rpc('get_public_weekly_schedule', {
                    p_week_start: weekStart
                });

                if (!error && Array.isArray(data)) {
                    state.rpcAvailable = true;
                    return {
                        exactAvailability: true,
                        classes: data
                            .map(row => normalizeClassRow(row, true))
                            .filter(Boolean)
                            .filter(c => c.classType === 'taller' || c.classType === 'especial')
                    };
                }

                const missingFunction = error?.code === 'PGRST202'
                    || error?.code === '42883'
                    || /get_public_weekly_schedule|schema cache/i.test(String(error?.message || ''));
                if (missingFunction) state.rpcAvailable = false;
            }

            return {
                exactAvailability: false,
                classes: await fetchDirectWeek(weekStart, 'talleres')
            };
        }

        // Regular yoga classes mode ('clases')
        if (state.rpcAvailable !== false) {
            const { data, error } = await state.client.rpc('get_public_weekly_schedule', {
                p_week_start: weekStart
            });

            if (!error && Array.isArray(data)) {
                state.rpcAvailable = true;
                return {
                    exactAvailability: true,
                    classes: data
                        .map(row => normalizeClassRow(row, true))
                        .filter(Boolean)
                        .filter(c => c.classType === 'yoga')
                };
            }

            const missingFunction = error?.code === 'PGRST202'
                || error?.code === '42883'
                || /get_public_weekly_schedule|schema cache/i.test(String(error?.message || ''));
            if (missingFunction) state.rpcAvailable = false;
        }

        return {
            exactAvailability: false,
            classes: await fetchDirectWeek(weekStart, 'clases')
        };
    }

    async function loadWeek(options = {}) {
        if (!state.client || !state.open) return;
        const silent = options.silent === true && state.classes.length > 0;
        const requestId = ++state.requestSerial;
        state.error = null;
        if (!silent) state.loading = true;
        render();

        try {
            const [result] = await Promise.all([
                fetchWeekData(state.weekStart),
                loadTypeColors()
            ]);
            if (requestId !== state.requestSerial || !state.open) return;

            state.classes = result.classes.sort((a, b) => a.start - b.start || a.id - b.id);
            state.availabilityExact = result.exactAvailability;
            state.loading = false;
            state.error = null;
            state.lastUpdated = new Date();
            state.dirty = false;
            render();
        } catch (error) {
            if (requestId !== state.requestSerial || !state.open) return;
            console.error('No se pudo cargar el calendario público:', error);
            state.loading = false;
            state.error = error;
            if (!silent) state.classes = [];
            render();
        }
    }

    function parseUrlState() {
        const url = new URL(root.location.href);
        const modeParam = url.searchParams.get('mode');
        if (modeParam === 'todo' || modeParam === 'global' || modeParam === 'consultas' || modeParam === 'talleres' || modeParam === 'clases') {
            state.mode = modeParam === 'global' ? 'todo' : modeParam;
        }
        const ofertaParam = (url.searchParams.get('oferta') || url.searchParams.get('promo') || url.searchParams.get('filter') || url.searchParams.get('filtro') || '').toLowerCase().trim();
        const companionModality = normalizeCompanionModality(ofertaParam);
        if (companionModality) {
            // Yoga en Compañía: calendario filtrado SOLO por esa modalidad
            state.oferta = companionModality;
            state.mode = 'clases';
        } else if (['madre_hija', 'compania', '50_anos', '50', 'madre-e-hija', 'madre'].includes(ofertaParam)) {
            state.oferta = 'madre_hija';
            state.mode = 'clases';
        } else if (['yoga', 'bienvenida', 'gratis', 'intro', 'introductoria'].includes(ofertaParam)) {
            state.oferta = 'yoga';
            state.mode = 'clases';
        } else if (['pni', 'isabel'].includes(ofertaParam)) {
            state.mode = 'consultas';
            state.teacher = 'isabel';
            state.oferta = '';
        } else if (['psicologia', 'miriam'].includes(ofertaParam)) {
            state.mode = 'consultas';
            state.teacher = 'miriam';
            state.oferta = '';
        } else {
            state.oferta = '';
        }
        const week = validDateKey(url.searchParams.get('week'));
        const classId = safePositiveInteger(url.searchParams.get('class') || url.searchParams.get('clase'));
        const teacher = normalizeTeacherParam(url.searchParams.get('teacher') || url.searchParams.get('profesional') || url.searchParams.get('profesor') || '');
        const rawStyle = url.searchParams.get('style') || url.searchParams.get('type') || url.searchParams.get('tipo') || url.searchParams.get('clase_tipo') || '';
        const style = canonicalStyle(rawStyle);

        state.weekStart = week ? mondayFor(week) : defaultWeekStart();
        if (state.weekStart < SEASON_START_WEEK) {
            state.weekStart = SEASON_START_WEEK;
        }
        state.explicitWeek = Boolean(week);
        state.classId = classId;
        state.teacher = teacher;
        state.style = style;
        state.targetResolved = !(classId || ((teacher || style || state.oferta) && !week));
    }

    async function fetchTargetClass(classId) {
        const { data, error } = await state.client
            .from('clases')
            .select(DIRECT_SELECT)
            .eq('id', classId)
            .eq('activa', true)
            .eq('profesionales.visible_publico', true)
            .maybeSingle();
        if (error) throw error;
        return data ? normalizeClassRow(data, false) : null;
    }

    async function findNextMatchingClass() {
        const now = Date.now();
        const baseStartDate = state.mode === 'consultas' ? '2026-09-01' : SEASON_START_DATE;
        const seasonTime = new Date(`${baseStartDate}T00:00:00+02:00`).getTime();
        const start = new Date(Math.max(now, Number.isFinite(seasonTime) ? seasonTime : now));
        const end = new Date(start.getTime() + MAX_DEEP_LINK_DAYS * 24 * 60 * 60 * 1000);
        let query = state.client
            .from('clases')
            .select(DIRECT_SELECT)
            .eq('activa', true)
            .eq('profesionales.visible_publico', true)
            .gte('fecha_inicio', start.toISOString())
            .lt('fecha_inicio', end.toISOString())
            .order('fecha_inicio')
            .limit(300);

        if (state.mode === 'talleres') {
            query = query.or('tipo_clase.eq.taller,tipo_clase.eq.especial,es_especial.eq.true');
        } else if (state.mode === 'clases') {
            query = query.eq('tipo_clase', 'yoga');
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data || [])
            .map(row => normalizeClassRow(row, false))
            .filter(Boolean)
            .filter(c => {
                if (state.mode === 'talleres') return c.classType === 'taller' || c.classType === 'especial' || c.isSpecial;
                if (state.mode === 'clases') return (c.classType === 'yoga' || !c.classType) && !c.isSpecial;
                return true;
            })
            .find(classMatchesFilters) || null;
    }

    async function resolveTargetIfNeeded() {
        if (state.targetResolved || !state.client) return;
        try {
            let target = null;
            if (state.classId) {
                target = await fetchTargetClass(state.classId);
                if (!target) state.classId = null;
            }
            if (!target && !state.explicitWeek && (state.mode === 'talleres' || state.teacher || state.style)) {
                target = await findNextMatchingClass();
                if (target && (state.classId || state.teacher || state.style)) state.classId = target.id;
            }
            if (target) state.weekStart = mondayFor(target.dateKey);
            if (state.weekStart < SEASON_START_WEEK) state.weekStart = SEASON_START_WEEK;
        } catch (error) {
            console.warn('No se pudo resolver el enlace directo del calendario:', error?.message || error);
        } finally {
            state.targetResolved = true;
        }
    }

    function updateUrl(mode) {
        const url = new URL(root.location.href);
        url.hash = CALENDAR_HASH;
        if (state.mode && state.mode !== 'clases') {
            url.searchParams.set('mode', state.mode);
        } else {
            url.searchParams.delete('mode');
        }
        url.searchParams.set('week', state.weekStart);
        if (state.style) url.searchParams.set('style', state.style);
        else url.searchParams.delete('style');
        url.searchParams.delete('type');
        if (state.teacher) url.searchParams.set('teacher', state.teacher);
        else url.searchParams.delete('teacher');
        if (state.classId) url.searchParams.set('class', String(state.classId));
        else url.searchParams.delete('class');
        url.searchParams.delete('clase');

        if (mode === 'push') {
            root.history.pushState({ genPublicCalendar: true }, '', url);
            state.historyPushed = true;
        } else if (mode === 'replace') {
            root.history.replaceState({ genPublicCalendar: true }, '', url);
        }
    }

    function clearCalendarUrl() {
        const url = new URL(root.location.href);
        ['mode', 'week', 'style', 'type', 'teacher', 'class', 'clase'].forEach(key => url.searchParams.delete(key));
        url.hash = '';
        root.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }

    function shouldAutoOpenFromUrl() {
        const url = new URL(root.location.href);
        return url.hash === CALENDAR_HASH
            || ['mode', 'week', 'style', 'type', 'tipo', 'teacher', 'profesional', 'profesor', 'class', 'clase', 'oferta', 'promo', 'filter', 'filtro'].some(key => url.searchParams.has(key));
    }

    function startPolling() {
        clearInterval(state.pollingTimer);
        state.pollingTimer = setInterval(() => {
            if (state.open && document.visibilityState === 'visible') loadWeek({ silent: true });
        }, REFRESH_INTERVAL_MS);
    }

    function stopPolling() {
        clearInterval(state.pollingTimer);
        state.pollingTimer = null;
    }

    function setBackgroundInert(enabled) {
        if (enabled) {
            const newSiblings = [...document.body.children]
                .filter(node => node !== el.panel && node instanceof HTMLElement && !node.hasAttribute('inert'));
            newSiblings.forEach(node => node.setAttribute('inert', ''));
            state.inertSiblings.push(...newSiblings);
            return;
        }
        state.inertSiblings.forEach(node => node.removeAttribute('inert'));
        state.inertSiblings = [];
    }

    function applyOpenOptions(options) {
        if (Object.prototype.hasOwnProperty.call(options, 'mode')) {
            state.mode = (options.mode === 'todo' || options.mode === 'global' || options.mode === 'consultas' || options.mode === 'talleres') ? (options.mode === 'global' ? 'todo' : options.mode) : 'clases';
        }
        if (Object.prototype.hasOwnProperty.call(options, 'oferta')) {
            const ofKey = String(options.oferta || '').toLowerCase().trim();
            const companionModality = normalizeCompanionModality(ofKey);
            if (companionModality) {
                // Yoga en Compañía: calendario filtrado SOLO por esa modalidad
                state.oferta = companionModality;
                state.mode = 'clases';
            } else if (['madre_hija', 'compania', '50_anos', '50', 'madre-e-hija', 'madre'].includes(ofKey)) {
                state.oferta = 'madre_hija';
                state.mode = 'clases';
            } else if (['yoga', 'bienvenida', 'gratis', 'intro', 'introductoria'].includes(ofKey)) {
                state.oferta = 'yoga';
                state.mode = 'clases';
                state.style = 'sesion-introductoria';
            } else if (['pni', 'isabel'].includes(ofKey)) {
                state.mode = 'consultas';
                state.teacher = 'isabel';
                state.oferta = '';
            } else if (['psicologia', 'miriam'].includes(ofKey)) {
                state.mode = 'consultas';
                state.teacher = 'miriam';
                state.oferta = '';
            } else {
                state.oferta = '';
            }
        }
        if (Object.prototype.hasOwnProperty.call(options, 'teacher') || Object.prototype.hasOwnProperty.call(options, 'profesional') || Object.prototype.hasOwnProperty.call(options, 'profesor')) {
            state.teacher = normalizeTeacherParam(options.teacher || options.profesional || options.profesor);
        }
        if (Object.prototype.hasOwnProperty.call(options, 'style') || Object.prototype.hasOwnProperty.call(options, 'tipo') || Object.prototype.hasOwnProperty.call(options, 'type')) {
            state.style = canonicalStyle(options.style || options.tipo || options.type);
        }
        if (Object.prototype.hasOwnProperty.call(options, 'classId')) {
            state.classId = safePositiveInteger(options.classId);
        }
        if (Object.prototype.hasOwnProperty.call(options, 'week')) {
            const valid = validDateKey(options.week);
            if (valid) {
                state.weekStart = mondayFor(valid);
                state.explicitWeek = true;
            }
        }
    }

    async function open(options = {}) {
        if (!state.initialized) {
            state.pendingOpenOptions = options;
            return;
        }

        applyOpenOptions(options);
        const wasOpen = state.open;
        state.open = true;
        state.lastFocus = wasOpen ? state.lastFocus : document.activeElement;
        el.panel.hidden = false;
        document.body.classList.add('gy-calendar-open');
        setBackgroundInert(true);
        startPolling();
        await resolveTargetIfNeeded();
        updateUrl(wasOpen ? 'replace' : 'push');
        root.dispatchEvent(new CustomEvent('genyoga:calendar:open', { detail: { week: state.weekStart, mode: state.mode } }));
        await loadWeek();
        el.panel.scrollTo({ top: 0, behavior: 'auto' });
        el.close.focus();
    }

    function hidePanel() {
        el.panel.hidden = true;
        document.body.classList.remove('gy-calendar-open');
        setBackgroundInert(false);
        stopPolling();
        state.open = false;
        root.dispatchEvent(new CustomEvent('genyoga:calendar:close'));
        if (state.lastFocus && typeof state.lastFocus.focus === 'function') {
            state.lastFocus.focus();
        }
    }

    function close() {
        if (!state.open) return;
        if (state.historyPushed && root.location.hash === CALENDAR_HASH) {
            state.historyPushed = false;
            root.history.back();
            return;
        }
        hidePanel();
        clearCalendarUrl();
        parseUrlState();
    }

    function navigateWeek(dayDelta) {
        const nextWeek = addDays(state.weekStart, dayDelta);
        if (dayDelta < 0 && nextWeek < SEASON_START_WEEK) return;
        state.weekStart = nextWeek;
        state.classId = null;
        state.selectedDay = '';
        state.explicitWeek = true;
        state.targetResolved = true;
        updateUrl('replace');
        loadWeek();
        el.panel.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function goToClass(classId) {
        const item = state.classes.find(entry => entry.id === safePositiveInteger(classId));
        if (!item || getEventState(item).disabled) return;

        let hasSession = false;
        if (state.client?.auth?.getSession) {
            try {
                const { data } = await state.client.auth.getSession();
                hasSession = Boolean(data?.session?.user);
            } catch (_) {
                hasSession = false;
            }
        }

        if (item.classType === 'psicologia' || item.classType === 'nutricion' || item.classType === 'consulta') {
            if (item.isVirtual) {
                const params = new URLSearchParams({
                    view: item.classType === 'psicologia' ? 'psicologia' : (item.classType === 'nutricion' ? 'nutricion' : 'consultas'),
                    clase: String(item.id),
                    from: 'calendario',
                    virtual: 'true',
                    fecha: item.dateKey,
                    hora: formatTime(item.start),
                    profesor_id: String(item.professor.id)
                });
                if (!hasSession) params.set('prompt', 'register');
                root.location.href = `profile.html?${params.toString()}`;
                return;
            }

            // Clases o sesiones introductorias presenciales en el estudio (ej. PNI con Isabel)
            const params = new URLSearchParams({
                view: 'horarios',
                clase: String(item.id),
                fecha: item.dateKey,
                from: 'calendario'
            });
            if (item.isFree) params.set('intro', 'true');
            if (item.professor?.slug) params.set('teacher', item.professor.slug);
            if (!hasSession) params.set('prompt', 'register');
            root.location.href = `profile.html?${params.toString()}`;
            return;
        }

        if (item.classType === 'taller' || item.classType === 'especial') {
            const params = new URLSearchParams({
                view: 'especiales',
                clase: String(item.id),
                from: 'calendario'
            });
            if (!hasSession) params.set('prompt', 'register');
            root.location.href = `profile.html?${params.toString()}`;
            return;
        }

        const params = new URLSearchParams({
            view: 'horarios',
            clase: String(item.id),
            from: 'calendario'
        });
        if (item.companionModality) {
            params.set('oferta', item.companionModality);
            params.set('companion_modality', item.companionModality);
        } else if (item.isFree || state.oferta) {
            params.set('oferta', state.oferta || 'yoga');
        }
        if (!hasSession) {
            params.set('prompt', 'register');
        }
        root.location.href = `profile.html?${params.toString()}`;
    }

    function bindEvents() {
        el.close.addEventListener('click', close);
        el.prevWeek.addEventListener('click', () => {
            if (state.weekStart <= SEASON_START_WEEK) return;
            navigateWeek(-7);
        });
        el.nextWeek.addEventListener('click', () => navigateWeek(7));
        el.today.addEventListener('click', () => {
            state.weekStart = defaultWeekStart();
            state.classId = null;
            state.selectedDay = todayKeyMadrid() < SEASON_START_DATE ? SEASON_START_DATE : todayKeyMadrid();
            state.explicitWeek = true;
            state.targetResolved = true;
            updateUrl('replace');
            loadWeek();
        });
        el.retry.addEventListener('click', () => loadWeek());
        el.emptyNext.addEventListener('click', () => navigateWeek(7));
        el.clearFilters.addEventListener('click', () => {
            state.style = '';
            state.teacher = '';
            state.oferta = '';
            state.classId = null;
            state.targetResolved = true;
            updateUrl('replace');
            loadWeek();
        });
        const modeToggle = document.getElementById('calendar-mode-toggle');
        if (modeToggle) {
            modeToggle.addEventListener('click', event => {
                const btn = event.target.closest('[data-calendar-mode]');
                if (!btn) return;
                const newMode = btn.dataset.calendarMode;
                if ((newMode === 'todo' || newMode === 'global' || newMode === 'clases' || newMode === 'consultas' || newMode === 'talleres') && state.mode !== newMode) {
                    state.mode = newMode === 'global' ? 'todo' : newMode;
                    state.style = '';
                    state.teacher = '';
                    state.classId = null;
                    const btnGlobal = document.getElementById('calendar-mode-global') || document.getElementById('calendar-mode-todo');
                    const btnClases = document.getElementById('calendar-mode-clases');
                    const btnConsultas = document.getElementById('calendar-mode-consultas');
                    const btnTalleres = document.getElementById('calendar-mode-talleres');
                    if (btnGlobal) btnGlobal.classList.toggle('active', state.mode === 'todo' || state.mode === 'global');
                    if (btnClases) btnClases.classList.toggle('active', state.mode === 'clases');
                    if (btnConsultas) btnConsultas.classList.toggle('active', state.mode === 'consultas');
                    if (btnTalleres) btnTalleres.classList.toggle('active', state.mode === 'talleres');
                    loadWeek();
                }
            });
        }

        el.styleFilters.addEventListener('click', event => {
            const button = event.target.closest('[data-calendar-style], [data-calendar-teacher]');
            if (!button) return;
            if (button.dataset.calendarTeacher !== undefined) {
                state.teacher = normalizeTeacherParam(button.dataset.calendarTeacher);
                state.style = '';
            } else if (button.dataset.calendarStyle !== undefined) {
                state.style = canonicalStyle(button.dataset.calendarStyle);
            }
            state.classId = null;
            state.targetResolved = true;
            updateUrl('replace');
            render();
        });
        el.panel.addEventListener('click', event => {
            const classButton = event.target.closest('[data-calendar-class]');
            if (classButton) goToClass(classButton.dataset.calendarClass);

            const dayButton = event.target.closest('[data-calendar-day]');
            if (dayButton) {
                state.selectedDay = validDateKey(dayButton.dataset.calendarDay) || state.selectedDay;
                renderMobile(filteredClasses());
            }
        });
        document.addEventListener('keydown', event => {
            if (!state.open) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...el.panel.querySelectorAll(
                'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )].filter(node => !node.hidden && node.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        root.addEventListener('languageChanged', () => render());
        root.addEventListener('popstate', () => {
            if (root.location.hash === CALENDAR_HASH) {
                parseUrlState();
                if (!state.open) open({ historyMode: 'none' });
                else {
                    resolveTargetIfNeeded().then(() => loadWeek());
                }
            } else {
                hidePanel();
                parseUrlState();
            }
        });
        root.addEventListener('focus', () => {
            if (state.open) loadWeek({ silent: true });
        });
        document.addEventListener('visibilitychange', () => {
            if (state.open && document.visibilityState === 'visible') loadWeek({ silent: true });
        });
    }

    function scheduleRealtimeReload(typeColorsChanged) {
        if (typeColorsChanged) state.typeColorsLoaded = false;
        if (!state.open) {
            state.dirty = true;
            return;
        }
        clearTimeout(state.reloadTimer);
        state.reloadTimer = setTimeout(() => loadWeek({ silent: true }), 350);
    }

    function subscribeRealtime() {
        if (!state.client?.channel) return;
        state.realtimeChannel = state.client
            .channel('public:weekly-schedule')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'clases' }, () => {
                scheduleRealtimeReload(false);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profesionales' }, () => {
                scheduleRealtimeReload(false);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tipos_clases' }, () => {
                scheduleRealtimeReload(true);
            })
            .subscribe();

        root.addEventListener('beforeunload', () => {
            clearTimeout(state.reloadTimer);
            stopPolling();
            if (state.realtimeChannel) state.client.removeChannel(state.realtimeChannel);
        }, { once: true });
    }

    function collectElements() {
        Object.assign(el, {
            panel: document.getElementById('public-calendar-panel'),
            close: document.getElementById('public-calendar-close'),
            prevWeek: document.getElementById('calendar-prev-week'),
            nextWeek: document.getElementById('calendar-next-week'),
            today: document.getElementById('calendar-today'),
            weekRange: document.getElementById('calendar-week-range'),
            styleFilters: document.getElementById('calendar-style-filters'),
            clearFilters: document.getElementById('calendar-clear-filters'),
            selection: document.getElementById('calendar-selection-note'),
            status: document.getElementById('calendar-status'),
            skeleton: document.getElementById('calendar-skeleton'),
            error: document.getElementById('calendar-error'),
            retry: document.getElementById('calendar-retry'),
            empty: document.getElementById('calendar-empty'),
            emptyCopy: document.getElementById('calendar-empty-copy'),
            emptyNext: document.getElementById('calendar-empty-next'),
            desktop: document.getElementById('calendar-desktop'),
            tableHead: document.getElementById('calendar-table-head'),
            tableBody: document.getElementById('calendar-table-body'),
            mobile: document.getElementById('calendar-mobile'),
            dayTabs: document.getElementById('calendar-day-tabs'),
            dayAgenda: document.getElementById('calendar-day-agenda')
        });
        return Object.values(el).every(Boolean);
    }

    function init(options = {}) {
        if (state.initialized) return;
        if (!collectElements()) {
            console.error('El calendario público no pudo inicializarse porque falta parte de su interfaz.');
            return;
        }
        state.client = options.client || null;
        state.initialized = true;
        parseUrlState();
        bindEvents();
        subscribeRealtime();
        syncStaticCopy();
        document.addEventListener('DOMContentLoaded', () => {
            if (state.open) setBackgroundInert(true);
        }, { once: true });

        if (shouldAutoOpenFromUrl()) {
            open({ historyMode: 'none' });
        } else if (state.pendingOpenOptions) {
            const pending = state.pendingOpenOptions;
            state.pendingOpenOptions = null;
            open(pending);
        }
    }

    root.GENPublicCalendar = Object.freeze({
        init,
        open,
        close,
        refresh: () => loadWeek({ silent: true }),
        canonicalStyle,
        isPublicScheduleSlot,
        consultationStartMinutesFor,
        consultationDurationMinutesFor
    });
})(typeof window !== 'undefined' ? window : globalThis);
