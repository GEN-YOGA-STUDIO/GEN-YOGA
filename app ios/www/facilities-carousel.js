(function (root) {
    'use strict';

    const AUTOPLAY_MS = 6_500;
    const INTERACTION_RESTART_MS = 9_000;
    const PROGRAMMATIC_SCROLL_MS = 1_100;

    const copy = {
        es: {
            carousel: 'Galería de instalaciones',
            viewport: 'Fotografías del espacio. Usa las flechas izquierda y derecha para recorrerlas.',
            previous: 'Foto anterior',
            next: 'Foto siguiente',
            pause: 'Pausar carrusel',
            pauseShort: 'Pausar',
            play: 'Reanudar carrusel',
            playShort: 'Reanudar',
            dots: 'Elegir fotografía',
            dot: 'Mostrar foto {current} de {total}',
            slide: 'Foto {current} de {total}',
            slideRole: 'diapositiva',
            status: 'Foto {current} de {total}: {caption}',
            alts: [
                'Sala principal de GEN Yoga con suelo de madera, grandes ventanales y luz natural',
                'Vista panorámica de la sala y la zona de recepción de GEN Yoga',
                'Estanterías con esterillas, mantas y material de práctica junto a un ventanal',
                'Zona de espera de GEN Yoga con dos sillas de madera y una mesa redonda',
                'Espacio de consulta de GEN Yoga con escritorio, sillas y luz cálida'
            ]
        },
        en: {
            carousel: 'Facilities gallery',
            viewport: 'Photos of the space. Use the left and right arrow keys to browse.',
            previous: 'Previous photo',
            next: 'Next photo',
            pause: 'Pause carousel',
            pauseShort: 'Pause',
            play: 'Resume carousel',
            playShort: 'Resume',
            dots: 'Choose a photo',
            dot: 'Show photo {current} of {total}',
            slide: 'Photo {current} of {total}',
            slideRole: 'slide',
            status: 'Photo {current} of {total}: {caption}',
            alts: [
                'GEN Yoga main studio with wooden floors, large windows and natural light',
                'Panoramic view of the GEN Yoga studio and reception area',
                'Shelves with mats, blankets and practice equipment beside a large window',
                'GEN Yoga waiting area with two wooden chairs and a round table',
                'GEN Yoga consultation room with a desk, chairs and warm light'
            ]
        }
    };

    const state = {
        initialized: false,
        index: 0,
        panelOpen: false,
        inView: false,
        pointerPaused: false,
        focusPaused: false,
        interactionPaused: false,
        userPaused: false,
        reducedMotion: false,
        motionOptIn: false,
        programmaticUntil: 0,
        autoplayTimer: null,
        scrollFrame: null,
        scrollEndTimer: null,
        resizeFrame: null,
        observer: null,
        activePointerId: null
    };

    const el = {
        panel: null,
        section: null,
        carousel: null,
        viewport: null,
        track: null,
        slides: [],
        previous: null,
        next: null,
        toggle: null,
        toggleCopy: null,
        dots: null,
        current: null,
        status: null
    };

    let motionQuery = null;

    function language() {
        return root.currentLang === 'en' ? 'en' : 'es';
    }

    function text(key, replacements) {
        let value = copy[language()][key] || copy.es[key] || key;
        Object.entries(replacements || {}).forEach(([name, replacement]) => {
            value = value.replace(`{${name}}`, String(replacement));
        });
        return value;
    }

    function normalizedIndex(index) {
        const total = el.slides.length;
        return total ? ((index % total) + total) % total : 0;
    }

    function isControlPaused() {
        return state.userPaused || (state.reducedMotion && !state.motionOptIn);
    }

    function canAutoplay() {
        return state.panelOpen
            && state.inView
            && document.visibilityState === 'visible'
            && !state.pointerPaused
            && !state.focusPaused
            && !state.interactionPaused
            && !isControlPaused();
    }

    function stopAutoplay() {
        clearTimeout(state.autoplayTimer);
        state.autoplayTimer = null;
    }

    function scheduleAutoplay(delay = AUTOPLAY_MS) {
        stopAutoplay();
        if (!canAutoplay()) return;
        state.autoplayTimer = setTimeout(() => {
            moveTo(state.index + 1, { announce: false });
            scheduleAutoplay();
        }, delay);
    }

    function slideOffset(index) {
        const first = el.slides[0];
        const target = el.slides[index];
        if (!first || !target) return 0;
        return target.offsetLeft - first.offsetLeft;
    }

    function syncTrailingSpace() {
        if (!state.panelOpen) return;
        const last = el.slides[el.slides.length - 1];
        if (!last) return;
        const viewportStyle = root.getComputedStyle(el.viewport);
        const horizontalPadding = (
            Number.parseFloat(viewportStyle.paddingLeft)
            + Number.parseFloat(viewportStyle.paddingRight)
        ) || 0;
        const trailingSpace = Math.max(
            0,
            el.viewport.clientWidth - horizontalPadding - last.offsetWidth
        );
        el.track.style.setProperty('--gy-facilities-tail', `${Math.ceil(trailingSpace)}px`);
    }

    function updateActive(index, announce) {
        state.index = normalizedIndex(index);
        const total = el.slides.length;

        el.slides.forEach((slide, slideIndex) => {
            const current = slideIndex === state.index;
            slide.toggleAttribute('data-current', current);
            slide.setAttribute('aria-label', text('slide', {
                current: slideIndex + 1,
                total
            }));
            slide.setAttribute('aria-roledescription', text('slideRole'));
        });

        [...el.dots.children].forEach((dot, dotIndex) => {
            dot.setAttribute('aria-current', String(dotIndex === state.index));
            dot.setAttribute('aria-label', text('dot', {
                current: dotIndex + 1,
                total
            }));
        });

        el.current.textContent = String(state.index + 1).padStart(2, '0');

        if (announce) {
            const caption = el.slides[state.index]?.querySelector('figcaption')?.textContent?.trim() || '';
            el.status.textContent = text('status', {
                current: state.index + 1,
                total,
                caption
            });
        }
    }

    function moveTo(index, options = {}) {
        const nextIndex = normalizedIndex(index);
        syncTrailingSpace();
        state.programmaticUntil = Date.now() + PROGRAMMATIC_SCROLL_MS;
        el.viewport.scrollTo({
            left: slideOffset(nextIndex),
            behavior: state.reducedMotion && !state.motionOptIn ? 'auto' : 'smooth'
        });
        updateActive(nextIndex, Boolean(options.announce));
    }

    function manualMove(index) {
        stopAutoplay();
        moveTo(index, { announce: true });
        scheduleAutoplay(INTERACTION_RESTART_MS);
    }

    function nearestSlideIndex() {
        const left = el.viewport.scrollLeft;
        let nearest = 0;
        let distance = Number.POSITIVE_INFINITY;
        el.slides.forEach((slide, index) => {
            const candidate = Math.abs(left - slideOffset(index));
            if (candidate < distance) {
                nearest = index;
                distance = candidate;
            }
        });
        return nearest;
    }

    function syncToggle() {
        const paused = isControlPaused();
        el.toggle.dataset.paused = String(paused);
        el.toggle.setAttribute('aria-label', text(paused ? 'play' : 'pause'));
        el.toggleCopy.textContent = text(paused ? 'playShort' : 'pauseShort');
    }

    function syncLanguage() {
        const total = el.slides.length;
        el.carousel.setAttribute('aria-label', text('carousel'));
        el.viewport.setAttribute('aria-label', text('viewport'));
        el.previous.setAttribute('aria-label', text('previous'));
        el.next.setAttribute('aria-label', text('next'));
        el.dots.setAttribute('aria-label', text('dots'));

        const alts = copy[language()].alts;
        el.slides.forEach((slide, index) => {
            const image = slide.querySelector('img');
            if (image && alts[index]) image.alt = alts[index];
            slide.setAttribute('aria-label', text('slide', {
                current: index + 1,
                total
            }));
            slide.setAttribute('aria-roledescription', text('slideRole'));
        });

        syncToggle();
        updateActive(state.index, false);
    }

    function resetTransientPauses() {
        clearTimeout(state.scrollEndTimer);
        state.scrollEndTimer = null;
        state.pointerPaused = false;
        state.focusPaused = false;
        state.interactionPaused = false;
        state.programmaticUntil = 0;
        if (
            state.activePointerId !== null
            && el.viewport.hasPointerCapture?.(state.activePointerId)
        ) {
            el.viewport.releasePointerCapture(state.activePointerId);
        }
        state.activePointerId = null;
    }

    function setPanelOpen(open) {
        state.panelOpen = Boolean(open);
        if (!state.panelOpen) {
            stopAutoplay();
            resetTransientPauses();
            return;
        }
        requestAnimationFrame(() => {
            syncTrailingSpace();
            state.programmaticUntil = Date.now() + 100;
            el.viewport.scrollTo({ left: slideOffset(state.index), behavior: 'auto' });
            const rect = el.section.getBoundingClientRect();
            state.inView = rect.bottom > 0 && rect.top < root.innerHeight;
            scheduleAutoplay();
        });
    }

    function endPointerInteraction(event) {
        if (state.activePointerId === null && !state.interactionPaused) return;
        if (
            state.activePointerId !== null
            && event?.pointerId !== undefined
            && event.pointerId !== state.activePointerId
        ) return;
        state.activePointerId = null;
        state.interactionPaused = false;
        scheduleAutoplay(INTERACTION_RESTART_MS);
    }

    function onScroll() {
        if (!state.panelOpen || Date.now() <= state.programmaticUntil) return;
        if (!state.scrollFrame) {
            state.scrollFrame = requestAnimationFrame(() => {
                state.scrollFrame = null;
                updateActive(nearestSlideIndex(), false);
            });
        }
        state.interactionPaused = true;
        stopAutoplay();
        clearTimeout(state.scrollEndTimer);
        state.scrollEndTimer = setTimeout(() => {
            state.interactionPaused = false;
            updateActive(nearestSlideIndex(), true);
            scheduleAutoplay(INTERACTION_RESTART_MS);
        }, 180);
    }

    function onMotionPreferenceChange(event) {
        state.reducedMotion = event.matches;
        state.motionOptIn = false;
        stopAutoplay();
        syncToggle();
        scheduleAutoplay();
    }

    function buildDots() {
        const fragment = document.createDocumentFragment();
        el.slides.forEach((slide, index) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'gy-facilities__dot';
            dot.dataset.facilitiesIndex = String(index);
            dot.setAttribute('aria-controls', 'facilities-viewport');
            fragment.appendChild(dot);
        });
        el.dots.replaceChildren(fragment);
    }

    function bindEvents() {
        el.previous.addEventListener('click', () => manualMove(state.index - 1));
        el.next.addEventListener('click', () => manualMove(state.index + 1));
        el.toggle.addEventListener('click', () => {
            if (state.reducedMotion && !state.motionOptIn) {
                state.motionOptIn = true;
                state.userPaused = false;
            } else {
                state.userPaused = !state.userPaused;
            }
            syncToggle();
            if (isControlPaused()) stopAutoplay();
            else scheduleAutoplay();
        });
        el.dots.addEventListener('click', event => {
            const dot = event.target.closest('[data-facilities-index]');
            if (!dot) return;
            manualMove(Number(dot.dataset.facilitiesIndex));
        });
        el.viewport.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') manualMove(0);
            else if (event.key === 'End') manualMove(el.slides.length - 1);
            else manualMove(state.index + (event.key === 'ArrowRight' ? 1 : -1));
        });
        el.viewport.addEventListener('scroll', onScroll, { passive: true });
        el.section.addEventListener('pointerenter', event => {
            if (event.pointerType !== 'mouse') return;
            state.pointerPaused = true;
            stopAutoplay();
        });
        el.section.addEventListener('pointerleave', event => {
            if (event.pointerType !== 'mouse') return;
            state.pointerPaused = false;
            scheduleAutoplay();
        });
        el.viewport.addEventListener('pointerdown', event => {
            state.activePointerId = event.pointerId;
            el.viewport.setPointerCapture?.(event.pointerId);
            state.interactionPaused = true;
            stopAutoplay();
        }, { passive: true });
        root.addEventListener('pointerup', endPointerInteraction, { passive: true });
        root.addEventListener('pointercancel', endPointerInteraction, { passive: true });
        el.viewport.addEventListener('lostpointercapture', endPointerInteraction, { passive: true });
        el.viewport.addEventListener('wheel', () => {
            state.interactionPaused = true;
            stopAutoplay();
            clearTimeout(state.scrollEndTimer);
            state.scrollEndTimer = setTimeout(endPointerInteraction, 240);
        }, { passive: true });
        el.section.addEventListener('focusin', () => {
            state.focusPaused = true;
            stopAutoplay();
        });
        el.section.addEventListener('focusout', () => {
            setTimeout(() => {
                state.focusPaused = el.section.contains(document.activeElement);
                if (!state.focusPaused) scheduleAutoplay();
            }, 0);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') scheduleAutoplay();
            else stopAutoplay();
        });
        root.addEventListener('languageChanged', syncLanguage);
        root.addEventListener('genyoga:calendar:open', () => setPanelOpen(true));
        root.addEventListener('genyoga:calendar:close', () => setPanelOpen(false));
        root.addEventListener('resize', () => {
            if (!state.panelOpen) return;
            cancelAnimationFrame(state.resizeFrame);
            state.resizeFrame = requestAnimationFrame(() => {
                syncTrailingSpace();
                state.programmaticUntil = Date.now() + 100;
                el.viewport.scrollTo({ left: slideOffset(state.index), behavior: 'auto' });
            });
        });
        root.addEventListener('beforeunload', destroy, { once: true });

        if (motionQuery.addEventListener) {
            motionQuery.addEventListener('change', onMotionPreferenceChange);
        } else {
            motionQuery.addListener(onMotionPreferenceChange);
        }
    }

    function observeVisibility() {
        if (!('IntersectionObserver' in root)) {
            state.inView = true;
            return;
        }
        state.observer = new IntersectionObserver(entries => {
            const entry = entries[0];
            state.inView = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.2);
            if (state.inView) scheduleAutoplay();
            else stopAutoplay();
        }, {
            root: null,
            threshold: [0, 0.2, 0.55]
        });
        state.observer.observe(el.section);
    }

    function collectElements() {
        el.panel = document.getElementById('public-calendar-panel');
        el.section = document.getElementById('facilities-gallery');
        el.carousel = document.getElementById('facilities-carousel');
        el.viewport = document.getElementById('facilities-viewport');
        el.track = document.getElementById('facilities-track');
        el.slides = [...document.querySelectorAll('[data-facilities-slide]')];
        el.previous = document.getElementById('facilities-prev');
        el.next = document.getElementById('facilities-next');
        el.toggle = document.getElementById('facilities-toggle');
        el.toggleCopy = el.toggle?.querySelector('[data-facilities-toggle-copy]') || null;
        el.dots = document.getElementById('facilities-dots');
        el.current = document.getElementById('facilities-current');
        el.status = document.getElementById('facilities-status');

        return Boolean(
            el.panel
            && el.section
            && el.carousel
            && el.viewport
            && el.track
            && el.slides.length
            && el.previous
            && el.next
            && el.toggle
            && el.toggleCopy
            && el.dots
            && el.current
            && el.status
        );
    }

    function destroy() {
        stopAutoplay();
        clearTimeout(state.scrollEndTimer);
        cancelAnimationFrame(state.scrollFrame);
        cancelAnimationFrame(state.resizeFrame);
        state.observer?.disconnect();
        if (motionQuery?.removeEventListener) {
            motionQuery.removeEventListener('change', onMotionPreferenceChange);
        } else {
            motionQuery?.removeListener?.(onMotionPreferenceChange);
        }
    }

    function init() {
        if (state.initialized || !collectElements()) return;
        state.initialized = true;
        motionQuery = root.matchMedia('(prefers-reduced-motion: reduce)');
        state.reducedMotion = motionQuery.matches;
        state.panelOpen = !el.panel.hidden && el.panel.getAttribute('aria-hidden') !== 'true';
        buildDots();
        syncLanguage();
        bindEvents();
        observeVisibility();
        updateActive(0, false);
        if (state.panelOpen) setPanelOpen(true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
