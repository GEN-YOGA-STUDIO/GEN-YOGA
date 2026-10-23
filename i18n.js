
// GEN Yoga shared internationalization & native platform detector.
// Loaded by public pages and client profile.
(function() {
    function detectNativeApp() {
        try {
            var isNative = !!(window.isNativeApp)
                || !!(window.Capacitor && (window.Capacitor.isNativePlatform ? window.Capacitor.isNativePlatform() : (window.Capacitor.getPlatform && window.Capacitor.getPlatform() !== 'web')))
                || window.location.protocol === 'capacitor:'
                || window.location.protocol === 'ionic:'
                || (window.location.hostname === 'localhost' && !window.location.port && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
            if (isNative) {
                if (document.documentElement) {
                    document.documentElement.classList.add('is-native-app');
                }
                var metaTheme = document.querySelector('meta[name="theme-color"]');
                if (metaTheme) {
                    metaTheme.setAttribute('content', '#26160c');
                }
                var ensureShield = function() {
                    if (document.body && !document.getElementById('gy-notch-shield')) {
                        var shield = document.createElement('div');
                        shield.id = 'gy-notch-shield';
                        shield.className = 'gy-notch-shield';
                        shield.setAttribute('aria-hidden', 'true');
                        document.body.prepend(shield);
                    }
                };
                if (document.body) {
                    ensureShield();
                } else {
                    document.addEventListener('DOMContentLoaded', ensureShield);
                }
            } else {
                if (document.documentElement) {
                    document.documentElement.classList.remove('is-native-app');
                }
                var existing = document.getElementById('gy-notch-shield');
                if (existing) {
                    existing.remove();
                }
            }
        } catch (e) {}
    }
    detectNativeApp();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', detectNativeApp);
    }
    window.addEventListener('load', detectNativeApp);
})();

const translations = {
    es: {
        // Navigation & Menu
        "nav_sessions": "SESIONES",
        "nav_clases": "CLASES",
        "nav_tarifas": "TARIFAS",
        "nav_maestros": "MAESTROS",
        "nav_profesores": "PROFESORES",
        "nav_perfil": "MI PERFIL",
        "nav_inicio": "Inicio",
        "btn_back_home": "Inicio",
        "btn_prof_all": "Todos",
        "page_title_index": "GEN Yoga | Studio",
        "page_title_clases": "GEN Yoga | Clases",
        "page_title_tarifas": "Tarifas y Bonos de Clases | GEN Yoga",
        "page_title_maestros": "GEN Yoga | Maestros",
        "page_title_profile": "Mi perfil | GEN Yoga",
        "page_title_success": "¡Gracias por tu compra! | GEN Yoga",
        "page_title_cancel": "Reserva Cancelada - GEN Yoga",
        "page_title_404": "Página no encontrada - GEN Yoga",
        "forgot_password_link": "¿Has olvidado tu contraseña?",
        "recover_pwd_title": "Recuperar Contraseña",
        "recover_pwd_subtitle": "Restablece tu acceso con tu email o teléfono registrado",
        "recover_pwd_btn_verify": "Comprobar cuenta",
        "recover_pwd_btn_submit": "Guardar nueva contraseña",
        "recover_pwd_back_to_login": "Volver al inicio de sesión",
        "month_0": "Enero",
        "month_1": "Febrero",
        "month_2": "Marzo",
        "month_3": "Abril",
        "month_4": "Mayo",
        "month_5": "Junio",
        "month_6": "Julio",
        "month_7": "Agosto",
        "month_8": "Septiembre",
        "month_9": "Octubre",
        "month_10": "Noviembre",
        "month_11": "Diciembre",

        // index.html Central Hero
        "hero_quote": "En GEN Yoga fusionamos movimiento, respiración y consciencia para crear un espacio donde tu cuerpo y tu mente encuentren su equilibrio natural...",
        "hero_btn_more": "Ver más",
        "hero_subquote": "Tu refugio, tu energía, tu momento",
        "marquee_text": "NUEVO BONO DE BIENVENIDA · 1ª CLASE DE YOGA A 0 € AL CREAR TU CUENTA &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ECOSISTEMA DE SALUD INTEGRATIVA &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; EN ALIANZA CON FARMACIA Q19 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ALBACETE &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; CENTRO LIDERADO POR PROFESIONALES SANITARIOS &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 1ª CLASE DE YOGA GRATIS (0 €) EN CUALQUIER HORARIO REGULAR &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; YOGA Y MEDITACIÓN &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; BONOS FLEXIBLES",

        // index.html Modals
        "modal_history_title": "GEN YOGA",
        "modal_history_sec1_title": "Historia de la marca",
        "modal_history_sec1_p1": "Estudio GEN Yoga es un espacio de bienestar individual y colectivo, nacido del compromiso con la salud física, mental y emocional desde el autoconocimiento y la capacitación como estrategia preventiva y sostenible.",
        "modal_history_sec1_bullet1": "<strong>GEN</strong> tiene diversas connotaciones, una de ellas con el fundamento biológico de la salud. En ese sentido, estudio GEN Yoga es el primer centro de bienestar integrativo de Castilla-La Mancha liderado por una farmacéutica, Ana Isabel Meroño, instructora de yoga y especializada en nutrición, calidad del sueño, así como disciplinas orientales del bienestar. Desde tus GENes hasta tus emociones.",
        "modal_history_sec1_bullet2": "Ana también gestiona la Farmacia Q19, a solo unos pasos del Estudio GEN Yoga, por lo cual ambos espacios contribuyen a la idea del ecosistema de la salud, tanto preventiva (GEN Yoga) como farmacológica (Q19), desde el rigor profesional y la atención adaptada a cada cliente.",
        "modal_history_sec1_p2": "Estas sinergias no solo contribuyen al bienestar individual, sino al comunitario, haciendo del barrio y su entorno un lugar con más oportunidades y mejores servicios para tu salud.",
        "modal_history_sec1_p3": "Creemos que la medicina convencional es imprescindible, pero no suficiente por sí sola, y por eso creamos un espacio donde las personas puedan escucharse, cuidarse y acompañarse de manera consciente y activa. Un proceso de presencialidad del bienestar en tiempo y espacios.",
        "modal_history_sec1_p4": "Estudio GEN Yoga surge como una referencia que amplía la concepción del bienestar, tanto por sus servicios de yoga, como por sus profesionales (médicos, farmacéuticos, psicólogos, fisioterapeutas, nutricionistas), conectando GENeraciones. Para ello fomentamos la reGENeración personal y colectiva, esto es, la salud física, mental y emocional, promoviendo tu bienestar integral a través de la experiencia corporal, la atención consciente y los vínculos humanos.",
        "modal_history_mision_title": "Misión",
        "modal_history_mision_p1": "Acompañar a las personas a lograr su bienestar integral a través de prácticas físicas y espirituales, desde el yoga, y mediante asanas, respiración consciente, música, meditación y diálogo en un espacio profesional, humano y accesible.",
        "modal_history_mision_p2": "Lograr una atención personalizada, multidisciplinar y continuada, ampliando tus horizontes de salud preventiva y conectando contigo, tu grupo, tu barrio, tu ciudad, tu tierra.",
        "modal_history_vision_title": "Visión",
        "modal_history_vision_p1": "Ser un espacio inclusivo e interGENeracional que inspire confianza y GENere bienestar, otorgando para ello herramientas de autocuidado, capacitando al cliente para superar sus limitaciones, y conectando GENeraciones y saberes.",
        "modal_history_vision_p2": "Estudio GEN Yoga aspira a ofrecer una atención plena al usuario – al prójimo, en sinergia con Farmacia Q19, para contribuir a la reGENeración personal y colectiva de quienes lo forman, sus clientes, sus profesionales, su dirección, haciendo de Albacete una comunidad activa y atractiva, comprometida con la salud integral.",
        "modal_history_value_title": "Propuesta de Valor",
        "modal_history_value_bullet1_title": "• Prevención e Integración:",
        "modal_history_value_bullet1_desc": "combina yoga y prácticas conscientes, físicas y espirituales, con un enfoque riguroso, desde la ética clínica y la evidencia farmacológica, por ejemplo, la Respiración SOMA o el yoga terapéutico, promoviendo salud real y responsable.",
        "modal_history_value_bullet1_sub": "Para ello, atiende las comorbilidades que causan malestar, dolor o enfermedad, como la alimentación, el estado físico y mental, y la gestión emocional.",
        "modal_history_value_bullet2_title": "• Acompañamiento Personalizado:",
        "modal_history_value_bullet2_desc": "Brinda confianza, seguridad y respeto mediante procesos individuales y continuados para cada persona.",
        "modal_history_value_bullet2_sub": "Para ello, pone a disposición del cliente diversas opciones y diversos profesionales que complementan los servicios del ciclo de vida en bienestar.",
        "modal_history_value_bullet3_title": "• Comunidad y Continuidad:",
        "modal_history_value_bullet3_desc": "Fortalece el vínculo entre estudio, farmacia y comunidad, GENerando bienestar, seguimiento y sentido de pertenencia.",
        "modal_history_value_bullet3_sub": "Para ello, ofrece recursos digitales, como una aplicación móvil única, y presenciales, como la atención en GEN Yoga y Farmacia Q19, ambas en una misma calle, mismo barrio, misma ciudad, donde converGEN perfiles y saberes GENeracionales diversos.",
        "footer_privacy": "Política de privacidad",
        "cancel_page_title": "Pago Cancelado",
        "cancel_page_message": "Parece que el proceso de pago ha sido cancelado y no se ha realizado ningún cargo. No te preocupes, puedes volver a intentarlo cuando estés listo.",
        "nf_title": "Página no encontrada",
        "nf_message": "La página que buscas no existe o se ha movido. Puede que el enlace esté anticuado o que se haya escrito mal la dirección.",
        "nf_btn_home": "Volver al inicio",
        "nf_btn_rates": "Ver clases y tarifas",
        "cancel_btn_rates": "Volver a Tarifas",
        "cancel_btn_profile": "Volver a mi Perfil",
        "cancel_btn_profile_go": "Ir a mi Perfil",
        "cancel_dest_profile": "tu perfil",
        "cancel_dest_rates": "tarifas",
        "cancel_redirect_to": "Redirigiéndote a {dest} en ",
        "cancel_redirect_suffix": " segundos...",

        // clases.html (Sessions list)
        "classes_title": "Escoge tus sesiones",
        "classes_subtitle": "Descubre nuestros estilos de yoga",
        "classes_card_vinyasa_title": "Power Vinyasa",
        "classes_vinyasa_tagline": "¿Lista para fluir con energía y fuerza?",
        "classes_card_vinyasa_desc": "Una práctica dinámica, fluida y vigorosa donde cada respiración guía el movimiento. Conecta posturas continuas (vinyasas) que desarrollan fuerza muscular, equilibrio, resistencia y concentración mientras tu cuerpo se mueve al ritmo de tu propia energía.",
        "classes_card_hombres_title": "Yoga Alineación",
        "classes_hombres_tagline": "Ajuste preciso, fuerza y consciencia corporal.",
        "classes_card_hombres_desc": "Una práctica basada en el ajuste preciso y la correcta alineación del cuerpo. Adaptada a las condiciones de cada persona para profundizar de forma segura y consciente en cada asana, liberar sobrecargas y cultivar presencia y estabilidad.",
        "classes_card_alineacion_title": "Yoga Alineación",
        "classes_alineacion_tagline": "Ajuste preciso, fuerza y consciencia corporal.",
        "classes_card_alineacion_desc": "Una práctica basada en el ajuste preciso y la correcta alineación del cuerpo. Adaptada a las condiciones de cada persona para profundizar de forma segura y consciente en cada asana, liberar sobrecargas y cultivar presencia y estabilidad.",
        "classes_card_para_todos_title": "Yoga para Todos",
        "classes_para_todos_tagline": "Alineación, consciencia y práctica a tu medida.",
        "classes_card_para_todos_desc": "Una sesión equilibrada, accesible y adaptada a cualquier condición física o nivel de experiencia. Basada en el ajuste postural y la alineación precisa, enseña a escuchar el cuerpo, ganar movilidad progresiva y sentir los beneficios profundos de cada asana sin forzar.",
        "classes_card_restaurativo_title": "Yoga Restaurativo",
        "classes_restaurativa_tagline": "Suelta el día, calma tu sistema nervioso.",
        "classes_card_restaurativa_desc": "Una práctica suave, pausada y consciente orientada al descanso profundo y la regeneración. Mediante posturas sostenidas con apoyos y respiración guiada, ayuda a liberar la fatiga acumulada, regular el sistema nervioso y restaurar la vitalidad física y mental.",
        "classes_cta_tagline": "Tu práctica empieza aquí",
        "classes_cta_title": "¿No sabes por<br>dónde empezar?",
        "classes_cta_desc": "Ven a probar tu primera sesión sin compromiso. Te acompañamos a elegir el estilo y ritmo que mejor conecte con tu energía.",
        "classes_cta_btn": "Reservar mi primera clase",
        "classes_scroll_prompt": "Ver más clases",
        "classes_scroll_arrow_text": "Ver más clases",
        "classes_scroll_arrow_doubt": "¿Tienes dudas?",
        "classes_tab_vinyasa": "POWER VINYASA",
        "classes_tab_hombres": "ALINEACIÓN",
        "classes_tab_alineacion": "ALINEACIÓN",
        "classes_tab_para_todos": "PARA TODOS",
        "classes_tab_restaurativo": "RESTAURATIVO",
        "classes_tab_talleres": "EVENTOS",
        "btn_cat_yoga": "Clases de Yoga",
        "btn_cat_consultas": "Consultas",
        "btn_cat_talleres": "Eventos",
        "classes_calendar_btn": "Ver horario semanal",
        "classes_consultas_calendar_btn": "Ver disponibilidad",
        "classes_talleres_calendar_btn": "Ver calendario de eventos",
        "classes_card_taller_int_title": "Talleres Intensivos",
        "classes_taller_int_tagline": "Profundización, práctica y autoconocimiento.",
        "classes_card_taller_int_desc": "Espacios monográficos de inmersión y aprendizaje intensivo para profundizar en asana, alineación biomecánica, filosofía y desarrollo consciente.",
        "classes_card_masterclass_title": "Masterclasses Especiales",
        "classes_masterclass_tagline": "Experiencias transformadoras con maestros invitados.",
        "classes_card_masterclass_desc": "Sesiones maestras y masterclasses especiales impartidas por maestros de amplia trayectoria y profesores invitados de referencia nacional e internacional.",
        "classes_card_salud_title": "Salud Integrativa & Bienestar",
        "classes_salud_tagline": "Cuidado holístico: mente, cuerpo y hábitos conscientes.",
        "classes_card_salud_desc": "Talleres vivenciales de salud integrativa, nutrición consciente, fitoterapia, Ayurveda aplicado y gestión emocional en grupo.",
        "footer_address": "Calle San Carlos 2, Albacete",
        "calendar_mode_classes": "Clases de Yoga",
        "calendar_mode_consultations": "Consultas",
        "calendar_mode_workshops": "Eventos y Clases Especiales",
        "calendar_spot_free": "Disponible",
        "calendar_spot_occupied": "Ocupada",
        "calendar_book_consultation": "Reservar consulta",

        // tarifas.html (Pricing)
        "rates_title": "Tarifas",
        "rates_tab_yoga": "Clases",
        "rates_tab_psy": "Consultas",
        "rates_tab_workshops": "Eventos",
        "rates_tab_types": "Tipos de tarifas",
        "rates_psy_item_individual_1": "Acompañamiento psicoterapéutico (1ª sesión)",
        "rates_psy_item_individual_follow": "Acompañamiento psicoterapéutico (siguientes)",
        "rates_psy_item_couple_1": "Terapia de pareja (1ª sesión)",
        "rates_psy_item_couple_follow": "Terapia de pareja (siguientes)",
        "rates_ayur_item_first": "Primera consulta",
        "rates_ayur_item_follow": "Seguimiento",
        "rates_ayur_item_bond3": "Bono Salud Integrativa (3 sesiones)",
        "rates_ayur_item_bond6": "Bono Salud Integrativa (6 sesiones)",
        "rates_ayur_buy_btn_bond3": "Comprar Bono 3 (170 €)",
        "rates_ayur_buy_btn_bond6": "Comprar Bono 6 (280 €)",
        "rates_tab_offers": "Ofertas",
        "rates_suelta_title": "Clase suelta",
        "rates_suelta_cat": "Yoga",
        "rates_suelta_feat1": "1 clase de yoga",
        "rates_suelta_feat2": "Reserva desde tu perfil o recepción",
        "rates_suelta_feat3": "60 días naturales desde la compra",
        "rates_selected_class_label": "Clase seleccionada",
        "rates_selected_class_loading": "Comprobando la clase seleccionada...",
        "rates_selected_class_unavailable": "La clase seleccionada ya no está disponible. Puedes comprar una clase suelta y elegir otro horario.",
        "rates_selected_class_teacher": "Con {teacher}",
        "rates_suelta_btn": "Comprar clase",
        "rates_pack4_title": "Pack 4 clases",
        "rates_pack6_title": "Pack 6 clases",
        "rates_pack10_title": "Pack 10 clases",
        "rates_pack_cat": "Bono flexible",
        "rates_pack_validity": "60 días desde la compra",
        "rates_pack_regular": "Válido para clases no especiales",
        "rates_pack_profile": "Saldo y caducidad visibles en tu perfil",
        "rates_pack_btn": "Comprar pack",
        "rates_mensual_badge": "★ Libertad total",
        "rates_mensual_title": "Bono Ilimitado",
        "rates_mensual_cat": "Mes natural elegido",
        "rates_mensual_feat1": "Todas las clases regulares que quieras",
        "rates_mensual_feat2": "1 clase especial en el mes elegido",
        "rates_mensual_feat3": "1 invitado gratis en el mes elegido",
        "rates_mensual_feat4": "30% en la primera consulta de nutrición o psicología",
        "rates_mensual_btn": "Elegir mes",
        "rates_per_month": "/mes natural",
        "rates_psy_title": "Psicología",
        "rates_psy_cat": "Bienestar y salud mental con Miriam",
        "rates_psy_sub": "Sesiones individuales, grupos y talleres",
        "rates_psy_desc": "Sesiones individuales (75 € 1ª / 65 € sig.), Terapia de pareja (120 € 1ª / 100 € sig.) y Sesiones grupales (Grupo de Autoayuda y Grupo Terapéutico: 30 € / sesión de 2 h).",
        "rates_psy_sub1": "Acompañamiento psicoterapéutico",
        "rates_psy_desc1": "Primera sesión: 75 € · Siguientes: 65 €",
        "rates_psy_sub2": "Terapia de pareja (2 personas)",
        "rates_psy_desc2": "Primera sesión: 120 € · Siguientes: 100 €",
        "rates_psy_dur": "50 min",
        "rates_psy_buy_btn_75": "Comprar 1ª sesión (75 €)",
        "rates_psy_buy_btn_65": "Comprar sesión sucesiva (65 €)",
        "rates_psy_buy_btn_120": "Comprar 1ª sesión pareja (120 €)",
        "rates_psy_buy_btn_100": "Comprar sesión pareja sucesiva (100 €)",
        "rates_psy_group_autoayuda_title": "🌱 Grupo de Autoayuda",
        "rates_psy_group_autoayuda_desc": "Martes 11:30 h (27 oct y 3 nov) · 2 sesiones/mes · 2 h",
        "rates_psy_group_autoayuda_focus": "Espacio centrado en una temática concreta con un objetivo compartido.",
        "rates_psy_group_autoayuda_badge": "30 € · 2 h",
        "rates_psy_group_autoayuda_buy": "Comprar sesión Autoayuda (30 €)",
        "rates_psy_group_terapeutico_title": "🫂 Grupo Terapéutico",
        "rates_psy_group_terapeutico_desc": "Miércoles 11:30 h (28 oct y 4 nov) · 2 sesiones/mes · 2 h",
        "rates_psy_group_terapeutico_focus": "Grupo cerrado y continuado para abordar diversos temas con confianza y vínculo.",
        "rates_psy_group_terapeutico_badge": "30 € · 2 h",
        "rates_psy_group_terapeutico_buy": "Comprar sesión Terapéutica (30 €)",
        "rates_psy_contact_recep": "Sesiones con Miriam",
        "rates_psy_popup_info": "Acompañamiento psicoterapéutico: 1ª sesión 75 €, siguientes 65 € (50 min).\nTerapia de pareja: 1ª sesión 120 €, siguientes 100 € (50 min).\nGrupo de Autoayuda: martes 11:30 h (6 y 20 oct, 2 h) 30 €/sesión.\nGrupo Terapéutico: miércoles 11:30 h (7 y 21 oct, 2 h) 30 €/sesión.",
        "rates_ayur_title": "Ayurveda",
        "rates_ayur_cat": "Equilibrio y bienestar integral con Silvia",
        "rates_ayur_desc1": "Historia clínica ayurvédica, análisis de doshas, recomendaciones de alimentación, rutinas y estilo de vida. Fitoterapia si procede.",
        "rates_ayur_desc2": "Evaluamos tus progresos y adaptamos las pautas ayurvédicas para consolidar tu equilibrio a largo plazo.",
        "rates_ayur_buy_btn_80": "Comprar 1ª consulta (80 €)",
        "rates_ayur_buy_btn_60": "Comprar seguimiento (60 €)",
        "rates_ayur_contact_recep": "Sesiones con Silvia",
        "rates_pni_title": "Salud e Inmune",
        "rates_pni_cat": "PNI y salud integral con Isabel",
        "rates_pni_sub1": "Primera consulta PNI",
        "rates_pni_sub2": "Consulta de seguimiento PNI",
        "rates_pni_buy_btn_80": "Comprar 1ª consulta (80 €)",
        "rates_pni_buy_btn_60": "Comprar seguimiento (60 €)",
        "rates_pni_contact_recep": "Consultas con Isabel",
        "rates_talleres_title": "Clases especiales / Talleres",
        "rates_talleres_cat": "Calendario independiente",
        "rates_talleres_desc": "Experiencias puntuales separadas de las clases regulares. El Bono Ilimitado incluye una clase especial por cada mes natural comprado.",
        "rates_talleres_contact_recep": "1 clase especial al mes con el Bono Ilimitado",
        "rates_talleres_btn": "Ver próximas fechas",
        "rates_welcome_badge": "★ 100% Gratuito",
        "rates_welcome_audience": "Nuevos alumnos",
        "rates_welcome_title": "Bono de Bienvenida",
        "rates_welcome_price_note": "sin cuota de alta",
        "rates_welcome_description": "Crea tu cuenta gratuita en GEN Yoga y disfruta de tu primera clase de Yoga de regalo.",
        "rates_welcome_yoga": "1 clase regular de Yoga gratuita para nuevos alumnos",
        "rates_welcome_consultation": "1 clase regular de Yoga gratuita",
        "rates_welcome_activation": "Canjea tu bono fácilmente desde tu cuenta",
        "rates_welcome_create": "Crear Cuenta y Recibir Bono (0 €)",
        "rates_welcome_view_classes": "Ver clases disponibles →",
        "rates_intro_badge": "✨ Edición Especial",
        "rates_intro_eyebrow": "Conoce a nuestros maestros · Fechas limitadas",
        "rates_intro_title": "Sesiones Introductorias",
        "rates_intro_description": "Encuentros y clases introductorias gratuitas para conocer en persona a cada profesional del equipo:",
        "rates_intro_angel_title": "Yoga con Ángel Javier",
        "rates_intro_angel_desc": "Bases de la práctica, respiración consciente y alineación.",
        "rates_intro_yanira_title": "Yoga con Yanira",
        "rates_intro_yanira_desc": "Fluidez, movilidad articular y presencia en movimiento.",
        "rates_intro_miriam_title": "Psicología con Miriam",
        "rates_intro_miriam_desc": "Acercamiento al bienestar emocional y gestión del estrés.",
        "rates_intro_silvia_title": "Yoga & Ayurveda con Silvia",
        "rates_intro_silvia_desc": "Equilibrio de doshas, salud integrativa y autocuidado.",
        "rates_intro_isabel_title": "PNI y Nutrición con Isabel",
        "rates_intro_isabel_desc": "Salud metabólica, descanso y modulación inflamatoria.",
        "rates_intro_view_all": "Ver todas las sesiones introductorias →",
        "rates_companion_eyebrow": "Práctica compartida · cuatro modalidades",
        "rates_companion_title": "Yoga en compañía",
        "rates_companion_description": "Ven con quien tú elijas. Todos los bonos de esta sección sirven para las cuatro modalidades y, al crear tu cuenta, recibirás una clase gratuita de la modalidad que te corresponda según tu edad.",
        "rates_companion_colleagues_title": "Yoga con colegas",
        "rates_companion_colleagues_tagline": "Compartid energía, movimiento y un plan diferente.",
        "rates_view_schedule": "Ver horarios →",
        "rates_companion_partner_title": "Yoga con tu pareja",
        "rates_companion_partner_tagline": "Respirad, conectad y regalad tiempo a la relación.",
        "rates_companion_child_title": "Yoga con tu hijo",
        "rates_companion_child_tagline": "Jugad, escuchad el cuerpo y cread recuerdos juntos.",
        "rates_companion_grandmother_title": "Yoga con tu abuela",
        "rates_companion_grandmother_tagline": "Moveos con calma y compartid bienestar entre generaciones.",
        "nav_login_register": "Acceso / Registro",
        "nav_login_short": "Iniciar Sesión",
        "nav_register_short": "Regístrate Gratis",
        "nav_perfil_subtitle": "Acceso, reservas y bonos",
        "classes_consultas_calendar_btn": "Ver disponibilidad",
        "calendar_mode_classes": "Clases de Yoga",
        "calendar_mode_consultations": "Consultas (Psicología / Nutrición)",
        "calendar_week_nav": "Navegación por semanas",
        "calendar_mode_filter": "Filtrar calendario",
        "calendar_filter_teacher": "Filtrar por profesional",
        "calendar_all_teachers": "Todos los profesionales",
        "calendar_spot_free": "Hueco libre",
        "calendar_spot_occupied": "Ocupado",
        "calendar_book_consultation": "Reservar consulta",
        "calendar_loading_consultations": "Cargando consultas disponibles...",

        "teachers_title": "Nuestros Profesionales",
        "teachers_subtitle": "Un equipo dedicado a guiar tu camino de bienestar integral",
        "teachers_read_more": "Saber más",
        "teachers_read_less": "Saber menos",
        "teachers_hero_our": "Nuestros",
        "teachers_hero_teachers": "Maestros",
        "teachers_scroll_meet": "Conócelos",
        "teachers_no_category": "No hay profesores en esta categoría.",
        "teachers_fallback_spec": "Profesor de GEN Yoga",
        "teachers_view_card": "Ver ficha de",
        "teachers_upcoming_classes": "Próximas clases",
        "teachers_class_links_label": "Próximas clases de",
        "teachers_view_next_class": "Ver la próxima clase de",
        "teachers_aria_home": "Volver a la página de inicio",
        "teachers_aria_list": "Listado de maestros",
        "teachers_aria_filter": "Filtrar maestros por servicio",
        "teachers_modal_close": "Cerrar ficha del maestro",

        // profile.html (Client Profile & Login)
        "profile_slogan": "Tu espacio para el bienestar integral, la salud física y la paz mental.",
        "profile_categories": "Clases de Yoga • Consultas de Psicología y Nutrición • Talleres",
        "auth_welcome": "Bienvenido",
        "auth_login_subtitle": "Accede a tu cuenta",
        "auth_create_subtitle": "Únete a la comunidad",
        "auth_back_login": "← Volver a Iniciar Sesión",
        "profile_title": "Área de Clientes",
        "profile_desc": "Gestiona tus clases, consultas y bienestar",
        "profile_btn_logout": "Cerrar Sesión",
        "login_card_title": "Iniciar Sesión",
        "login_email_label": "Email o Teléfono Móvil",
        "login_identifier_placeholder": "tu@email.com o 612345678",
        "login_password_label": "Contraseña",
        "login_btn_submit": "Inicio sesión &rarr;",
        "login_no_account": "¿Aún no tienes cuenta?",
        "login_btn_register": "Regístrate gratis aquí",
        "register_card_title": "Crear Cuenta",
        "register_method_label": "Registrarse con",
        "register_method_email": "Email",
        "register_method_phone": "Teléfono Móvil",
        "register_name_label": "Nombre",
        "register_lastname_label": "Apellidos",
        "register_email_label": "Email",
        "register_phone_label": "Teléfono Móvil (9 dígitos)",
        "register_phone_placeholder": "Ej: 612345678",
        "register_phone_hint": "Introduce los 9 dígitos de tu móvil. Lo usaremos para identificarte y enviarte notificaciones.",
        "register_phone_invalid": "El teléfono móvil debe tener exactamente 9 dígitos numéricos.",
        "register_birth_label": "Fecha de nacimiento",
        "register_birth_hint": "Lo usamos de forma privada para asignarte tu opción de bienvenida.",
        "register_password_label": "Contraseña (mín. 8 caracteres)",
        "register_btn_submit": "Registrarse &rarr;",
        "register_has_account": "¿Ya tienes una cuenta?",
        "register_btn_login": "Inicia sesión aquí",
        "register_welcome_bonus_title": "Bono de Bienvenida Automático",
        "register_welcome_bonus_headline": "¡Tu 1ª clase de Yoga es 100% GRATIS (0 €)!",
        "register_welcome_bonus_desc": "Incluye 1 clase regular de yoga gratis + 1 valoración de Psicología/PNI al registrarte. ¡Apúntate ahora!",
        "recover_step1_help": "Introduce el correo electrónico o el teléfono móvil con el que creaste tu cuenta originalmente.",
        "recover_identifier_label": "Email o Teléfono Móvil",
        "recover_code_sent": "Código enviado",
        "recover_code_help": "Revisa tu correo e introduce el código",
        "recover_code_label": "Código de 6 dígitos",
        "recover_new_password_label": "Nueva Contraseña",
        "recover_confirm_password_label": "Repetir Nueva Contraseña",
        "recover_new_password_placeholder": "Mínimo 8 caracteres",
        "recover_confirm_password_placeholder": "Repite la contraseña",
        "profile_edit_phone_label": "Teléfono Móvil",
        "profile_tab_inicio": "INICIO",
        "profile_tab_horarios": "CLASES",
        "profile_tab_specials": "EVENTOS",
        "profile_specials_badge": "Experiencias únicas",
        "profile_specials_title": "Eventos: Clases Especiales y Talleres",
        "profile_specials_desc": "Actividades independientes del horario habitual. Las Clases Especiales se reservan con el Bono de Clase Especial (incluido 1 gratis con Bono Ilimitado o 20 €) y los Talleres mediante plaza individual.",
        "profile_specials_unlimited": "VER BONO ILIMITADO",
        "profile_specials_empty": "No hay eventos programados todavía.",
        "profile_specials_empty_desc": "Cuando publiquemos un nuevo evento aparecerá aquí.",
        "profile_tab_psicologia": "CONSULTAS",
        "profile_tab_nutricion": "NUTRICIÓN",
        "profile_tab_profesores": "MAESTROS",
        "profile_tab_configuracion": "Configuración",
        "profile_tab_asistencias": "Asistencias",
        "profile_btn_edit_profile": "Editar perfil",
        "profile_saldos_label": "Mis saldos",
        "profile_saldos_heading": "Mis Bonos y Saldos Disponibles",
        "profile_saldos_subheading": "Consulta tus packs activos, meses ilimitados comprados y bonos gratuitos disponibles.",
        "profile_btn_guide_bonos": "¿Cómo funcionan mis bonos?",
        "profile_saldos_info_title": "Tus Bonos y Saldos Disponibles",
        "profile_saldos_info_intro": "En GEN Yoga dispones de diferentes tipos de saldo para tus prácticas y servicios:",
        "profile_saldos_info_packs_title": "Packs de Clases (4, 6 o 10 clases)",
        "profile_saldos_info_packs_desc": "Saldo de clases sueltas o packs. Cada crédito te permite reservar 1 sesión regular de Yoga. Caducan a los 60 días naturales desde la compra. Se consumen primero los más próximos a caducar.",
        "profile_saldos_info_unlimited_title": "Bono Mensual Ilimitado (90 € / mes natural)",
        "profile_saldos_info_unlimited_desc": "Acceso ilimitado a todas las clases regulares de Yoga durante el mes natural activo (del 1 al último día del mes). Incluye además 1 Taller o Clase Especial y 1 Invitado Gratuito durante ese mes.",
        "profile_saldos_info_free_class_title": "Bono de Bienvenida (0 €)",
        "profile_saldos_info_free_class_desc": "Crédito promocional de bienvenida para reservar y disfrutar de tu primera sesión de Yoga sin coste alguno.",
        "profile_saldos_info_companion_title": "Bono Yoga en Compañía (0 €)",
        "profile_saldos_info_companion_desc": "Crédito especial para reservar sesiones de Yoga en Compañía (Colegas, Pareja, Madre e Hija, Abuela y Nieta) para 2 personas a coste 0 €.",
        "profile_saldos_info_free_consultation_title": "Consultas Gratuitas de Bienvenida (0 €)",
        "profile_saldos_info_free_consultation_desc": "Sesión de valoración inicial gratuita con nuestros especialistas (Psicología, Psiconeuroinmunología PNI o Nutrición/Ayurveda) para orientarte.",
        "profile_saldos_info_btn_rates": "Ver Todas las Tarifas",
        "profile_saldos_info_btn_close": "Entendido",
        "profile_tab_my_calendar": "Mi calendario",
        "profile_tab_students_per_class": "Alumnos por clase",
        "common_yoga": "Yoga",
        "common_classes": "Clases",
        "common_class": "Clase",
        "common_psychology": "Psicología",
        "common_nutrition": "Nutrición",
        "common_workshops": "Talleres",
        "common_teacher": "Profesor",
        "common_instructor": "Instructor",
        "common_professional": "Profesional",
        "common_appointment": "Cita",
        "common_consultation": "Consulta",
        "common_consultations": "Consultas",
        "common_single_class": "Clase suelta",
        "common_single_classes": "Clases sueltas",
        "common_monthly_plan": "Bono Ilimitado",
        "common_monthly_plan_active": "Bono Ilimitado Activo",
        "common_monthly_plan_inactive": "Bono Ilimitado Inactivo",
        "common_inactive": "Inactivo",
        "profile_loading_classes": "Cargando clases...",
        "profile_loading_consultations": "Cargando consultas...",
        "profile_loading_nutrition": "Cargando consultas de nutrición...",
        "profile_classes_bookings_calendar": "Calendario de Clases y Reservas",
        "profile_general_calendar": "Calendario General",
        "profile_view_all_bookings": "Ver todas las reservas",
        "profile_upcoming_title": "Mis Próximas Citas y Clases",
        "profile_no_bookings_title": "No tienes reservas",
        "profile_no_bookings_desc": "Navega por las pestañas de Clases y Consultas para programar tus reservas.",
        "profile_schedule_title": "Reserva tu práctica",
        "profile_schedule_desc": "Encuentra el equilibrio perfecto entre cuerpo y mente. Selecciona tu clase y prepárate para desconectar.",
        "profile_filter_teacher": "Profesor",
        "profile_filter_type": "Tipo de Yoga",
        "profile_filter_schedule": "Horario",
        "profile_filter_availability": "Disponibilidad",
        "profile_filter_all_teachers": "Todos los profesores",
        "profile_filter_all_types": "Todos los tipos",
        "profile_filter_any_time": "Cualquier hora",
        "profile_filter_morning": "Mañana (07:00 - 12:00)",
        "profile_filter_midday": "Mediodía (12:00 - 16:00)",
        "profile_filter_afternoon": "Tarde (16:00 - 20:00)",
        "profile_filter_evening": "Noche (20:00 - 23:00)",
        "profile_filter_all_classes": "Todas las clases",
        "profile_filter_free_spots": "Con plazas libres",
        "profile_filter_full_classes": "Clases completas",
        "profile_no_balance_title": "Sin bonos disponibles",
        "profile_no_balance_desc": "Elige una clase suelta o un pack de 4, 6 o 10 clases para reservar tu próxima sesión.",
        "profile_directions": "Cómo llegar",
        "profile_no_classes_available": "No hay clases disponibles",
        "profile_no_classes_available_desc": "Estamos planificando la próxima semana. Vuelve a consultar en breve.",
        "profile_select_day": "Selecciona un día",
        "profile_view_all_classes": "Ver todas las clases",
        "profile_no_matching_classes": "No hay clases que coincidan con los filtros",
        "profile_reset_filters": "Restablecer filtros",
        "profile_assign": "ASIGNAR",
        "profile_cancel": "CANCELAR",
        "profile_full": "Completa",
        "profile_unavailable": "No Disponible",
        "profile_no_balance": "Sin Saldo",
        "profile_buy_extra_credit": "Ver packs",
        "profile_buy_extra_credit_short": "Ver packs",
        "profile_book": "RESERVAR",
        "profile_your_spot": "Tu Plaza",
        "profile_capacity": "Aforo",
        "profile_request": "Solicitar",
        "profile_request_activation": "Solicitar activación",
        "profile_manage_billing": "Gestionar suscripción y facturación",
        "profile_week_short": "Sem",
        "profile_month_short": "Mes",
        "profile_expires": "Vence",
        "profile_mental_wellbeing": "Bienestar Mental",
        "profile_nutritional_wellbeing": "Bienestar Nutricional",
        "profile_psychology_title": "Consultas de Psicología",
        "profile_psychology_desc": "Reserva tus consultas de acompañamiento psicoterapéutico o terapia de pareja con nuestro equipo experto.",
        "profile_nutrition_title": "Consultas de Nutrición",
        "profile_nutrition_desc": "Mejora tus hábitos alimenticios y bienestar con el acompañamiento personalizado de nuestro equipo de nutrición.",
        "profile_calendar_consultations": "Calendario de Consultas",
        "profile_calendar_nutrition": "Calendario de Nutrición",
        "profile_view_all_consultations": "Ver todas las consultas",
        "profile_no_consultations_available": "No hay consultas disponibles",
        "profile_no_consultations_available_desc": "Actualmente no hay disponibilidad configurada para consultas. Vuelve a consultar pronto.",
        "profile_no_nutrition_available": "No hay consultas de nutrición disponibles",
        "profile_no_nutrition_available_desc": "Actualmente no hay disponibilidad configurada para consultas de nutrición. Vuelve a consultar pronto.",
        "profile_no_consultations_date": "No hay consultas en esta fecha",
        "profile_no_nutrition_date": "No hay consultas de nutrición en esta fecha",
        "profile_view_all": "Ver todas",
        "profile_filter_consultation_type": "Consultas",
        "profile_filter_all_consultations": "Todas las consultas",
        "profile_filter_my_booked_consultations": "Mis consultas reservadas",
        "profile_filter_available_consultations": "Disponibles",
        "profile_no_booked_consultations": "Sin consultas reservadas",
        "profile_no_booked_consultations_desc": "No tienes ninguna consulta reservada actualmente.",
        "profile_reserved": "Reservado",
        "profile_zero_sessions": "0 Sesiones",
        "profile_your_consultation": "Tu Consulta",
        "profile_your_appointment": "Tu Cita",
        "profile_confirmed": "Confirmada",
        "profile_cancel_booking": "Cancelar reserva",
        "profile_more": "más",
        "profile_teachers_badge": "Maestros Expertos",
        "profile_teachers_title": "Maestros del Centro",
        "profile_teachers_desc": "Conoce a los maestros que guiarán tu práctica, consultas y talleres. Cada uno aporta una energía única y años de experiencia para ayudarte a crecer.",
        "profile_filter_all": "Todos",
        
        // SweetAlerts & Dynamic labels (for app.js / profile.js)
        "alert_error": "Error",
        "alert_warning": "Atención",
        "alert_success": "Éxito",
        "alert_info": "Información",
        "alert_cancel": "Cancelar",
        "alert_yes_cancel": "Sí, cancelar",
        "alert_yes_reserve": "Sí, reservar",
        "alert_no_credits": "Necesitas un bono o pack",
        "alert_no_credits_desc": "No dispones de un bono activo para esta clase. Elige un pack de clases o bono ilimitado para reservar.",
        "alert_class_too_close": "Las reservas cierran {hours} h antes del inicio. Para esta clase ya ha pasado el plazo.",
        "alert_cancel_too_close": "Ya no puedes cancelar: faltan {hours} h o menos para la clase. El bono reservado no se devuelve.",
        "alert_confirm_reservation": "Confirmar Reserva",
        "alert_reserve_mensual": "¿Quieres reservar esta clase con tu <b>Bono Ilimitado</b>?",
        "alert_reserve_semana_limit": "¿Quieres reservar esta clase con tu <b>Bono Ilimitado</b>?",
        "alert_reserve_mes_limit": "Tu Bono Ilimitado te da acceso a todas las clases normales que quieras durante el mes natural.",
        "alert_reserve_suelta": "¿Quieres reservar esta clase usando <b>uno de tus bonos</b>?",
        "alert_booking_confirmed": "¡Clase Reservada!",
        "alert_booking_confirmed_desc": "Tu esterilla te espera. Namasté. 🙏",
        "alert_cancel_confirmed": "Reserva cancelada. Saldo actualizado.",
        "btn_reserve": "RESERVAR",
        "btn_no_balance": "Sin Saldo",
        "btn_full": "Completa",
        "btn_not_available": "No Disponible",
        "badge_mensual_active": "Bono Mensual Activo",
        "badge_mensual_inactive": "Bono Mensual Inactivo",
        "badge_clases_sueltas": "Clase suelta",
        "badge_clases_sueltas_pl": "Clases sueltas",
        "title_cancel": "CANCELAR",
        
        // policy wording dynamic
        "policy_booking_limit": "Las reservas cierran <b>{res} h</b> antes del inicio.",
        "policy_cancel_limit": "Puedes cancelar y recuperar el bono mientras falten más de <b>{can} h</b>. Al llegar a ese límite, la cancelación se bloquea y el bono no se devuelve.",
        "footer_address": "Calle San Carlos 2, Albacete",

        // --- QA | Modal de bienvenida de la home (index.html) ---
        "flash_badge": "★ 100% Gratuito · Nuevos Alumnos",
        "home_h1": "GEN Yoga · Estudio de yoga y bienestar en Albacete",
        "flash_price_note": "sin cuota de alta · sin compromiso",
        "flash_close_label": "Cerrar aviso promocional",
        "flash_title": "¡Tu 1ª Clase de Yoga es Gratis!",
        "flash_lead": "Crea tu cuenta en <strong>GEN Yoga</strong> y recibe automáticamente en tu perfil tu <strong>Bono de Bienvenida</strong> para empezar a entrenar con nosotros:",
        "flash_benefit_session": "1 Sesión Gratuita de Yoga para cualquier clase regular",
        "flash_benefit_valid": "Válida para cualquier horario regular de la parrilla semanal (excluye talleres y clases especiales)",
        "flash_benefit_activation": "Activación Inmediata:",
        "flash_benefit_instant": "Disponible al instante tras registrarte. ¡Apúntate y ven a conocernos!",
        "flash_cta": "✨ Crear Cuenta y Recibir Bono (0 €) →",
        "flash_secondary": "Cerrar y continuar al estudio",

        // --- QA | Tarjeta de bienvenida (tarifas.html) ---
        "rates_welcome_free_session": "1 Sesión Gratuita de Yoga para cualquier clase regular",
        "rates_welcome_valid_for": "Válida para reservar tu plaza en",
        "rates_welcome_regular_classes": "cualquiera de las clases normales de yoga",
        "rates_welcome_schedule_note": "de nuestra parrilla semanal (se excluyen talleres y clases especiales)",
        "rates_welcome_instant_title": "Activación Inmediata y Automática",
        "rates_welcome_instant_text": "Disponible en tu perfil tan pronto como completes el registro. Sin esperas ni códigos.",
        "rates_welcome_view_schedule": "Ver clases y horarios regulares →",

        // --- QA | Categoría Eventos: tarjetas dinámicas (tarifas.html) ---
        "rates_events_next_taller": "Próximo Taller",
        "rates_events_next_special": "Próxima Clase Especial",
        "rates_events_date": "{day} {num} {month} · {start} a {end}",
        "rates_events_subtitle_taller": "Con {teacher} · {duration}",
        "rates_events_subtitle_special": "Con {teacher} · Sesión Temática ({duration} min)",
        "rates_events_duration_hours": "2 Horas de Inmersión",
        "rates_events_duration_minutes": "{duration} Minutos de Inmersión",
        "rates_events_price_taller": "/ plaza ({duration} min)",
        "rates_events_price_special": "/ plaza (o con Bono Ilimitado)",
        "rates_events_desc_taller": "Inmersión completa de {duration} minutos diseñada para aprender y consolidar los fundamentos de la práctica con atención personalizada.",
        "rates_events_desc_special": "Práctica guiada de profundización que combina asana suave con técnicas de pranayama y meditación profunda para calmar el sistema nervioso y restaurar el equilibrio interior.",
        "rates_events_bullet_taller_1": "Máximo {capacity} alumnos para atención personalizada",
        "rates_events_bullet_taller_2": "Ajustes manuales y soporte individual",
        "rates_events_bullet_taller_3": "Material de apoyo e infusiones incluidas",
        "rates_events_bullet_special_1": "Grupos reducidos (máximo {capacity} plazas)",
        "rates_events_bullet_special_2": "<strong>1 clase al mes incluida</strong> con el Bono Ilimitado",
        "rates_events_bullet_special_3": "Disponible para compra suelta o reserva con bono",
        "rates_events_link_taller": "Ver detalles en el calendario →",
        "rates_events_link_special": "Ver próximas fechas en horario →",
        "rates_events_empty_title": "Próximamente nuevos talleres",
        "rates_events_empty": "Actualmente no hay talleres o clases especiales activas con fechas futuras. Muy pronto publicaremos nuevas experiencias y fechas. Consulta nuestro horario semanal para descubrir todas las clases regulares.",
        "rates_events_empty_cta": "Ver horario completo",
        "rates_events_book": "Reservar Plaza",
        "rates_events_loading": "Cargando próximos talleres…",

        // --- QA | Otros textos sueltos ---
        "teachers_footer_address": "© 2026 GEN Yoga • Calle San Carlos 2, Albacete",
        "btn_back_home_arrow": "← INICIO",
        "success_verifying": "Verificando tu compra...",
        "success_error_title": "No pudimos verificar el pago",
        "success_error_message": "No se ha confirmado ninguna compra. Comprueba el enlace o vuelve a intentarlo.",
        "success_error_verify_network": "No se ha podido confirmar el pago con Stripe. Si el importe se ha cobrado en tu tarjeta, tu bono se sincronizará automáticamente. No repitas el cobro antes de pulsar Reintentar verificación.",
        "success_error_verify_retry": "No se ha podido confirmar el pago con Stripe. Si el importe se ha cobrado en tu tarjeta, tu bono se sincronizará en tu cuenta en breve.",
        "success_error_retry": "Reintentar verificación",
        "success_error_back": "Volver a Tarifas",
        "success_done_title": "¡Pago Completado!",
        "success_done_message": "Stripe ha confirmado tu compra. Tu cuenta se actualizará automáticamente; si aún no ves el nuevo saldo al entrar en tu perfil, recarga la página tranquilamente.",
        "success_redirecting": "Redirigiéndote a tu perfil en <span id=\"countdown\">5</span> segundos...",
        "success_go_profile": "Ir a mi Perfil",
        "success_manage_invoices": "Gestionar mis Facturas / Suscripción",
        "success_error_invalid_session": "El enlace no contiene una sesión de pago LIVE válida. No se ha confirmado ninguna compra.",
        "success_guest_title": "¡Clase Adquirida!",
        "success_guest_intro": "Has comprado <strong>1 clase suelta</strong> como invitado. Selecciona a continuación la clase de Yoga a la que deseas asistir e introduce tus datos para confirmar tu plaza.",
        "success_guest_select_label": "1. Selecciona tu clase de Yoga",
        "success_guest_loading_classes": "Cargando clases disponibles...",
        "success_guest_name_label": "Nombre",
        "success_guest_name_placeholder": "Tu nombre",
        "success_guest_surname_label": "Apellidos",
        "success_guest_surname_placeholder": "Tus apellidos",
        "success_guest_confirm": "Confirmar y Reservar Plaza",
        "success_guest_back_home": "Volver a Inicio",
        "success_consultation_title": "¡Consulta adquirida!",
        "success_consultation_default_message": "Stripe ha confirmado el pago y tu consulta ha quedado registrada correctamente.",
        "success_consultation_payment_label": "Pago registrado",
        "success_consultation_instructions": "Escríbenos para concertar la fecha de tu consulta. Indica el nombre o teléfono y el correo utilizados durante el pago para localizarla rápidamente.",
        "success_consultation_contact": "Contactar con GEN Yoga",
        "success_consultation_back_rates": "Volver a Tarifas",
        "success_consultation_message": "Stripe ha confirmado el pago de tu <strong>{item}</strong>.",
        "success_consultation_receipt": " Tu recibo de compra se ha enviado a <strong>{email}</strong>.",
        "success_consultation_identify": " Para el día de la sesión podrás identificarte en el centro con tus datos (<strong>{data}</strong>).",
        "success_redeemed_title": "Reserva ya Canjeada",
        "success_redeemed_message": "Esta compra de clase suelta ya ha sido utilizada para realizar una reserva. Si necesitas modificar tu reserva, ponte en contacto con recepción.",
        "success_redeemed_back_home": "Volver a Inicio",
        "success_bono_month": "Tu Bono Ilimitado para {month} ya está registrado. Podrás usarlo desde el día 1 hasta el último día de ese mes natural.",
        "success_single_class": "Tu clase suelta ya está registrada como un bono independiente y caducará 60 días naturales después de la compra.",
        "success_pack_credits": "Tu Pack de {credits} clases ya está registrado y activo en tu cuenta con 60 días de validez. ¡Ya puedes reservar tus clases!",
        "success_workshop_confirmed": "Tu plaza para el Taller de Introducción a Power Vinyasa ya está confirmada y registrada en tu cuenta.",
        "success_special_class_confirmed": "Tu plaza para la Clase Especial ya está confirmada y registrada en tu cuenta.",
        "success_item_fallback": "Reserva",
        "success_portal_connecting_title": "Conectando con la pasarela de pagos...",
        "success_portal_wait": "Por favor, espera un momento.",
        "success_portal_invalid_url": "El servidor devolvió una dirección de facturación no válida.",
        "success_portal_error": "No se pudo abrir el portal.",
        "success_classes_none": "No hay clases disponibles en este momento",
        "success_classes_choose": "-- Elige una clase de Yoga --",
        "success_classes_full": "Todas las próximas clases están completas",
        "success_classes_error": "No se pudieron comprobar las plazas disponibles",
        "success_classes_spots": "libres",
        "success_classes_with": "con",
        "success_yoga_class": "Clase de Yoga",
        "success_instructor": "Instructor",
        "success_date_at": "{day}, {num} {month} a las {time}",
        "success_guest_select_required": "Por favor, selecciona una clase de Yoga.",
        "success_guest_name_required": "El nombre es un campo obligatorio.",
        "success_guest_booking_title": "Reservando tu clase...",
        "success_guest_booking_success_title": "¡Reserva Completada!",
        "success_guest_booking_success_text": "Tu clase ha sido reservada con éxito. Te esperamos en el estudio.",
        "success_guest_booking_other_title": "Elige otra clase",
        "success_guest_booking_other_text": "Tu pago sigue vigente (no se ha cobrado de nuevo), pero esa clase ya no está disponible. Elige otra de la lista y pulsa «Confirmar reserva». Si necesitas ayuda, contacta con recepción.",
        "success_guest_booking_network": "No se pudo conectar con el servidor de reservas. Tu compra está registrada; inténtalo de nuevo en unos segundos o contacta con recepción para asignar tu plaza.",
        "success_guest_booking_error_title": "Error al reservar",
        "success_guest_booking_error": "No se pudo procesar tu reserva. Inténtalo de nuevo."
    },
    en: {
        // Navigation & Menu
        "nav_sessions": "SESSIONS",
        "nav_clases": "CLASSES",
        "nav_tarifas": "RATES",
        "nav_maestros": "TEACHERS",
        "nav_profesores": "TEACHERS",
        "nav_perfil": "MY PROFILE",
        "nav_inicio": "Home",
        "btn_back_home": "Home",
        "btn_prof_all": "All",
        "page_title_index": "GEN Yoga | Studio",
        "page_title_clases": "GEN Yoga | Classes",
        "page_title_tarifas": "Rates and Class Passes | GEN Yoga",
        "page_title_maestros": "GEN Yoga | Teachers",
        "page_title_profile": "My profile | GEN Yoga",
        "page_title_success": "Thank you for your purchase! | GEN Yoga",
        "page_title_cancel": "Booking Cancelled - GEN Yoga",
        "page_title_404": "Page not found - GEN Yoga",
        "forgot_password_link": "Forgot your password?",
        "recover_pwd_title": "Recover Password",
        "recover_pwd_subtitle": "Reset your access with your registered email or phone",
        "recover_pwd_btn_verify": "Verify account",
        "recover_pwd_btn_submit": "Save new password",
        "recover_pwd_back_to_login": "Back to login",
        "month_0": "January",
        "month_1": "February",
        "month_2": "March",
        "month_3": "April",
        "month_4": "May",
        "month_5": "June",
        "month_6": "July",
        "month_7": "August",
        "month_8": "September",
        "month_9": "October",
        "month_10": "November",
        "month_11": "December",

        // index.html Central Hero
        "hero_quote": "At GEN Yoga we fuse movement, breath and awareness to create a space where your body and mind find their natural balance...",
        "hero_btn_more": "learn more",
        "hero_subquote": "Your refuge, your energy, your moment",
        "marquee_text": "NEW WELCOME PASS · 1ST YOGA CLASS AT 0 € WHEN CREATING YOUR ACCOUNT &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; INTEGRATIVE HEALTH ECOSYSTEM &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; IN PARTNERSHIP WITH PHARMACY Q19 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ALBACETE &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; CENTER LED BY HEALTHCARE PROFESSIONALS &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 1ST REGULAR YOGA CLASS FREE (0 €) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; YOGA & MEDITATION &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; FLEXIBLE PASSES",

        // index.html Modals
        "modal_history_title": "GEN YOGA",
        "modal_history_sec1_title": "Brand History",
        "modal_history_sec1_p1": "Studio GEN Yoga is a space for individual and collective well-being, born from a commitment to physical, mental and emotional health based on self-knowledge and empowerment as a preventive and sustainable strategy.",
        "modal_history_sec1_bullet1": "<strong>GEN</strong> has various connotations, one of which relates to the biological foundation of health. In this sense, Study GEN Yoga is the first integrative well-being center in Castilla-La Mancha led by a pharmacist, Ana Isabel Meroño, a yoga instructor specialized in nutrition, sleep quality, and Eastern well-being disciplines. From your GENes to your emotions.",
        "modal_history_sec1_bullet2": "Ana also manages Farmacia Q19, just a few steps away from Study GEN Yoga, meaning both spaces contribute to the health ecosystem concept—both preventive (GEN Yoga) and pharmacological (Q19)—with professional rigor and personalized care tailored to each client.",
        "modal_history_sec1_p2": "These synergies contribute not only to individual well-being but also to the community, making the neighborhood and its surroundings a place with more opportunities and better services for your health.",
        "modal_history_sec1_p3": "We believe that conventional medicine is essential, but not sufficient on its own. That is why we created a space where people can listen to themselves, care for themselves, and support each other consciously and actively. A process of well-being presence in time and spaces.",
        "modal_history_sec1_p4": "Study GEN Yoga emerges as a reference that broadens the concept of well-being, both through its yoga services and its professionals (doctors, pharmacists, psychologists, physiotherapists, nutritionists), connecting GENerations. To do this, we promote personal and collective reGENeration—physical, mental, and emotional health—supporting your overall well-being through bodily experience, mindful awareness, and human connection.",
        "modal_history_mision_title": "Mission",
        "modal_history_mision_p1": "To support people in achieving their overall well-being through physical and spiritual practices, starting from yoga, using asanas, conscious breathing, music, meditation, and dialogue in a professional, human, and accessible space.",
        "modal_history_mision_p2": "To provide personalized, multidisciplinary, and continuous care, broadening your preventive health horizons and connecting with you, your group, your neighborhood, your city, your land.",
        "modal_history_vision_title": "Vision",
        "modal_history_vision_p1": "To be an inclusive, interGENerational space that inspires trust and GENerates well-being, providing tools for self-care, empowering clients to overcome their limitations, and connecting GENerations and knowledge.",
        "modal_history_vision_p2": "Study GEN Yoga aspires to offer full attention to users in synergy with Farmacia Q19, contributing to the personal and collective reGENeration of its members, clients, professionals, and management, making Albacete an active, attractive community committed to holistic health.",
        "modal_history_value_title": "Value Proposition",
        "modal_history_value_bullet1_title": "• Prevention and Integration:",
        "modal_history_value_bullet1_desc": "combines yoga and conscious physical and spiritual practices with a rigorous approach based on clinical ethics and pharmacological evidence, such as SOMA Breathwork or therapeutic yoga, promoting real and responsible health.",
        "modal_history_value_bullet1_sub": "To do this, it addresses co-morbidities that cause discomfort, pain, or disease, such as nutrition, physical and mental state, and emotional management.",
        "modal_history_value_bullet2_title": "• Personalized Support:",
        "modal_history_value_bullet2_desc": "Provides trust, safety, and respect through continuous individual processes for each person.",
        "modal_history_value_bullet2_sub": "To do this, it offers clients various options and professionals that complement well-being lifecycle services.",
        "modal_history_value_bullet3_title": "• Community and Continuity:",
        "modal_history_value_bullet3_desc": "Strengthens the bond between the studio, the pharmacy, and the community, GENerating well-being, follow-ups, and a sense of belonging.",
        "modal_history_value_bullet3_sub": "To do this, it offers digital resources, such as a unique mobile application, and in-person resources, such as care at GEN Yoga and Farmacia Q19, both in the same street, same neighborhood, same city, where diverse profiles and generational knowledge converge.",
        "footer_privacy": "Privacy Policy",
        "cancel_page_title": "Payment Cancelled",
        "cancel_page_message": "It looks like the payment process was cancelled and no charge has been made. Don't worry, you can try again whenever you're ready.",
        "nf_title": "Page not found",
        "nf_message": "The page you are looking for does not exist or has moved. The link may be out of date, or the address may be misspelled.",
        "nf_btn_home": "Back to home",
        "nf_btn_rates": "See classes and rates",
        "cancel_btn_rates": "Back to Rates",
        "cancel_btn_profile": "Back to my Profile",
        "cancel_btn_profile_go": "Go to my Profile",
        "cancel_dest_profile": "your profile",
        "cancel_dest_rates": "rates",
        "cancel_redirect_to": "Redirecting you to {dest} in ",
        "cancel_redirect_suffix": " seconds...",

        // clases.html (Sessions list)
        "classes_title": "Choose your sessions",
        "classes_subtitle": "Discover our yoga styles",
        "classes_card_vinyasa_title": "Power Vinyasa",
        "classes_vinyasa_tagline": "Ready to flow with strength and energy?",
        "classes_card_vinyasa_desc": "A dynamic, fluid and vigorous practice where each breath guides movement. Connect continuous postures (vinyasas) that develop muscular strength, balance, stamina and focus as your body moves to the rhythm of your own energy.",
        "classes_card_hombres_title": "Alignment Yoga",
        "classes_hombres_tagline": "Precise adjustment, strength and body awareness.",
        "classes_card_hombres_desc": "A practice focused on precise adjustment, proper alignment, and functional anatomy. Adapted to each person's condition to deepen safely and mindfully in every asana, release tension, and cultivate presence and stability.",
        "classes_card_alineacion_title": "Alignment Yoga",
        "classes_alineacion_tagline": "Precise adjustment, strength and body awareness.",
        "classes_card_alineacion_desc": "A practice focused on precise adjustment, proper alignment, and functional anatomy. Adapted to each person's condition to deepen safely and mindfully in every asana, release tension, and cultivate presence and stability.",
        "classes_card_para_todos_title": "Yoga for Everyone",
        "classes_para_todos_tagline": "Conscious alignment and tailored practice.",
        "classes_card_para_todos_desc": "A balanced, accessible session tailored to any fitness level or experience. Based on mindful posture adjustments and precise alignment, it guides you to listen to your body, build progressive mobility and experience the deep benefits of every asana without strain.",
        "classes_card_restaurativo_title": "Restorative Yoga",
        "classes_restaurativa_tagline": "Let go of the day, calm your nervous system.",
        "classes_card_restaurativa_desc": "A gentle, slow and mindful practice dedicated to deep rest and renewal. Through supported postures with props and guided breathing, it releases built-up fatigue, regulates the nervous system and restores physical and mental vitality.",
        "classes_cta_tagline": "Your journey starts here",
        "classes_cta_title": "Don't know where<br>to start?",
        "classes_cta_desc": "Come try your first session with no commitment. We will guide you to find the style and pace that connects with your energy.",
        "classes_cta_btn": "Book my first class",
        "classes_scroll_prompt": "See more classes",
        "classes_scroll_arrow_text": "See more classes",
        "classes_scroll_arrow_doubt": "Any questions?",
        "classes_tab_vinyasa": "POWER VINYASA",
        "classes_tab_hombres": "ALIGNMENT",
        "classes_tab_alineacion": "ALIGNMENT",
        "classes_tab_para_todos": "FOR EVERYONE",
        "classes_tab_restaurativo": "RESTORATIVE",
        "classes_tab_talleres": "EVENTS",
        "btn_cat_yoga": "Yoga Classes",
        "btn_cat_consultas": "Consultations",
        "btn_cat_talleres": "Events",
        "classes_calendar_btn": "View weekly schedule",
        "classes_consultas_calendar_btn": "Check availability",
        "classes_talleres_calendar_btn": "View events calendar",
        "classes_card_taller_int_title": "Intensive Workshops",
        "classes_taller_int_tagline": "Deepening, practice and self-knowledge.",
        "classes_card_taller_int_desc": "Dedicated immersive and intensive learning spaces to delve into asana, biomechanical alignment, philosophy, and conscious growth.",
        "classes_card_masterclass_title": "Special Masterclasses",
        "classes_masterclass_tagline": "Transformative experiences with guest teachers.",
        "classes_card_masterclass_desc": "Master sessions and special masterclasses taught by seasoned teachers and renowned national and international guest instructors.",
        "classes_card_salud_title": "Integrative Health & Well-being",
        "classes_salud_tagline": "Holistic care: mind, body, and mindful habits.",
        "classes_card_salud_desc": "Experiential workshops on integrative health, conscious nutrition, phytotherapy, applied Ayurveda, and group emotional regulation.",
        "footer_address": "Calle San Carlos 2, Albacete",
        "calendar_mode_classes": "Yoga Classes",
        "calendar_mode_consultations": "Consultations",
        "calendar_mode_workshops": "Events & Special Classes",
        "calendar_spot_free": "Available",
        "calendar_spot_occupied": "Occupied",
        "calendar_book_consultation": "Book consultation",

        // tarifas.html (Pricing)
        "rates_title": "Rates",
        "rates_tab_yoga": "Classes",
        "rates_tab_psy": "Consultations",
        "rates_tab_workshops": "Events",
        "rates_tab_types": "Rate types",
        "rates_psy_item_individual_1": "Psychotherapeutic support (1st session)",
        "rates_psy_item_individual_follow": "Psychotherapeutic support (follow-up)",
        "rates_psy_item_couple_1": "Couples therapy (1st session)",
        "rates_psy_item_couple_follow": "Couples therapy (follow-up)",
        "rates_ayur_item_first": "First consultation",
        "rates_ayur_item_follow": "Follow-up",
        "rates_ayur_item_bond3": "Integrative Health Pass (3 sessions)",
        "rates_ayur_item_bond6": "Integrative Health Pass (6 sessions)",
        "rates_ayur_buy_btn_bond3": "Buy 3-session pass (€170)",
        "rates_ayur_buy_btn_bond6": "Buy 6-session pass (€280)",
        "rates_tab_offers": "Offers",
        "rates_suelta_title": "Single class",
        "rates_suelta_cat": "Yoga",
        "rates_suelta_feat1": "1 yoga class",
        "rates_suelta_feat2": "Book from your profile or reception",
        "rates_suelta_feat3": "Valid for 60 calendar days after purchase",
        "rates_selected_class_label": "Selected class",
        "rates_selected_class_loading": "Checking the selected class...",
        "rates_selected_class_unavailable": "The selected class is no longer available. You can buy a single class and choose another time.",
        "rates_selected_class_teacher": "With {teacher}",
        "rates_suelta_btn": "Buy class",
        "rates_pack4_title": "4-class pack",
        "rates_pack6_title": "6-class pack",
        "rates_pack10_title": "10-class pack",
        "rates_pack_cat": "Flexible pass",
        "rates_pack_validity": "60 days from purchase",
        "rates_pack_regular": "Valid for non-special classes",
        "rates_pack_profile": "Balance and expiry shown in your profile",
        "rates_pack_btn": "Buy pack",
        "rates_mensual_badge": "★ Total freedom",
        "rates_mensual_title": "Unlimited Pass",
        "rates_mensual_cat": "Selected calendar month",
        "rates_mensual_feat1": "Unlimited regular classes",
        "rates_mensual_feat2": "1 special class in the selected month",
        "rates_mensual_feat3": "1 free guest in the selected month",
        "rates_mensual_feat4": "30% off the first nutrition or psychology consultation",
        "rates_mensual_btn": "Choose month",
        "rates_per_month": "/calendar month",
        "rates_psy_title": "Psychology",
        "rates_psy_cat": "Well-being and mental health with Miriam",
        "rates_psy_sub": "Individual sessions, groups and workshops",
        "rates_psy_desc": "Individual sessions (€75 1st / €65 foll.), Couples therapy (€120 1st / €100 foll.) and Group sessions (Self-Help Group & Therapeutic Group: €30 / 2h session).",
        "rates_psy_sub1": "Psychotherapeutic Accompaniment",
        "rates_psy_desc1": "First session: €75 · Following: €65",
        "rates_psy_sub2": "Couples Therapy (2 people)",
        "rates_psy_desc2": "First session: €120 · Following: €100",
        "rates_psy_dur": "50 min",
        "rates_psy_buy_btn_75": "Buy 1st session (€75)",
        "rates_psy_buy_btn_65": "Buy follow-up session (€65)",
        "rates_psy_buy_btn_120": "Buy 1st couple session (€120)",
        "rates_psy_buy_btn_100": "Buy follow-up couple session (€100)",
        "rates_psy_group_autoayuda_title": "🌱 Self-Help Group",
        "rates_psy_group_autoayuda_desc": "Tuesdays 11:30 (Oct 27 & Nov 3) · 2 sessions/month · 2 h",
        "rates_psy_group_autoayuda_focus": "Space focused on a specific theme with a shared goal.",
        "rates_psy_group_autoayuda_badge": "30 € · 2 h",
        "rates_psy_group_autoayuda_buy": "Buy Self-Help session (€30)",
        "rates_psy_group_terapeutico_title": "🫂 Therapeutic Group",
        "rates_psy_group_terapeutico_desc": "Wednesdays 11:30 (Oct 28 & Nov 4) · 2 sessions/month · 2 h",
        "rates_psy_group_terapeutico_focus": "Closed, ongoing group exploring diverse themes with trust and connection.",
        "rates_psy_group_terapeutico_badge": "30 € · 2 h",
        "rates_psy_group_terapeutico_buy": "Buy Therapeutic session (€30)",
        "rates_psy_contact_recep": "Sessions with Miriam",
        "rates_psy_popup_info": "Psychotherapeutic accompaniment: 1st session €75, following €65 (50 min).\nCouples therapy: 1st session €120, following €100 (50 min).\nSelf-Help Group: Tuesdays 11:30 (Oct 6 & 20, 2 h) €30/session.\nTherapeutic Group: Wednesdays 11:30 (Oct 7 & 21, 2 h) €30/session.",
        "rates_ayur_title": "Ayurveda",
        "rates_ayur_cat": "Balance and holistic well-being with Silvia",
        "rates_ayur_desc1": "Ayurvedic clinical history, dosha analysis, dietary recommendations, routines and lifestyle guidance. Phytotherapy if applicable.",
        "rates_ayur_desc2": "We evaluate your progress and adapt Ayurvedic guidelines to consolidate your long-term balance.",
        "rates_ayur_buy_btn_80": "Buy 1st consultation (€80)",
        "rates_ayur_buy_btn_60": "Buy follow-up (€60)",
        "rates_ayur_contact_recep": "Sessions with Silvia",
        "rates_pni_title": "Health & Immune",
        "rates_pni_cat": "PNI and integrative health with Isabel",
        "rates_pni_sub1": "First PNI consultation",
        "rates_pni_sub2": "PNI follow-up consultation",
        "rates_pni_buy_btn_80": "Buy 1st consultation (€80)",
        "rates_pni_buy_btn_60": "Buy follow-up (€60)",
        "rates_pni_contact_recep": "Consultations with Isabel",
        "rates_talleres_title": "Special Classes / Workshops",
        "rates_talleres_cat": "Independent calendar",
        "rates_talleres_desc": "One-off experiences kept separate from regular classes. The Unlimited Plan includes one special class in each purchased calendar month.",
        "rates_talleres_contact_recep": "1 special class per month with the Unlimited Plan",
        "rates_talleres_btn": "See upcoming dates",
        "rates_welcome_badge": "★ 100% Free",
        "rates_welcome_audience": "New students",
        "rates_welcome_title": "Welcome Pass",
        "rates_welcome_price_note": "no sign-up fee",
        "rates_welcome_description": "Create your free account at GEN Yoga and enjoy your first Yoga class for free.",
        "rates_welcome_yoga": "1 free regular Yoga class for new students",
        "rates_welcome_consultation": "1 free regular Yoga class",
        "rates_welcome_activation": "Easily redeem your voucher from your account",
        "rates_welcome_create": "Create Account & Get Voucher (0 €)",
        "rates_welcome_view_classes": "View available classes →",
        "rates_intro_badge": "✨ Special Edition",
        "rates_intro_eyebrow": "Meet our teachers · Limited dates",
        "rates_intro_title": "Introductory Sessions",
        "rates_intro_description": "Free introductory meetings and classes to meet each team professional in person:",
        "rates_intro_angel_title": "Yoga with Ángel Javier",
        "rates_intro_angel_desc": "Practice foundations, conscious breathing and alignment.",
        "rates_intro_yanira_title": "Yoga with Yanira",
        "rates_intro_yanira_desc": "Flow, joint mobility and mindful movement.",
        "rates_intro_miriam_title": "Psychology with Miriam",
        "rates_intro_miriam_desc": "Approach to emotional well-being and stress management.",
        "rates_intro_silvia_title": "Yoga & Ayurveda with Silvia",
        "rates_intro_silvia_desc": "Dosha balance, integrative health and self-care.",
        "rates_intro_isabel_title": "PNI & Nutrition with Isabel",
        "rates_intro_isabel_desc": "Metabolic health, rest and inflammatory modulation.",
        "rates_intro_view_all": "View all introductory sessions →",
        "rates_companion_eyebrow": "Shared practice and learning",
        "rates_companion_title": "Yoga in Company",
        "rates_companion_description": "Guided small group classes designed to share the mat with those who are part of your everyday life:",
        "rates_companion_colleagues_title": "Work Colleagues",
        "rates_companion_colleagues_tagline": "Disconnect from the workday routine and recharge together.",
        "rates_view_schedule": "View schedule →",
        "rates_companion_partner_title": "Couples",
        "rates_companion_partner_tagline": "Sync breath and presence in a peaceful space.",
        "rates_companion_child_title": "Parents & Children",
        "rates_companion_child_tagline": "Mindful connection and movement across generations.",
        "rates_companion_grandmother_title": "Grandparents & Grandchildren",
        "rates_companion_grandmother_tagline": "Gentle mobility, complicity and mutual care.",
        "nav_login_register": "Login / Register",
        "nav_login_short": "Sign In",
        "nav_register_short": "Register Free",
        "nav_perfil_subtitle": "Login, bookings & passes",
        "classes_consultas_calendar_btn": "View availability",
        "calendar_mode_classes": "Yoga Classes",
        "calendar_mode_consultations": "Consultations (Psychology / Nutrition)",
        "calendar_week_nav": "Week navigation",
        "calendar_mode_filter": "Filter calendar",
        "calendar_filter_teacher": "Filter by professional",
        "calendar_all_teachers": "All professionals",
        "calendar_spot_free": "Free slot",
        "calendar_spot_occupied": "Occupied",
        "calendar_book_consultation": "Book consultation",
        "calendar_loading_consultations": "Loading available consultations...",

        "teachers_title": "Our Professionals",
        "teachers_subtitle": "A team dedicated to guiding your path of holistic well-being",
        "teachers_read_more": "Read more",
        "teachers_read_less": "Read less",
        "teachers_hero_our": "Our",
        "teachers_hero_teachers": "Teachers",
        "teachers_scroll_meet": "Meet them",
        "teachers_no_category": "No teachers in this category.",
        "teachers_fallback_spec": "GEN Yoga Teacher",
        "teachers_view_card": "View profile of",
        "teachers_upcoming_classes": "Upcoming classes",
        "teachers_class_links_label": "Upcoming classes with",
        "teachers_view_next_class": "View the next",
        "teachers_aria_home": "Back to the home page",
        "teachers_aria_list": "Teachers list",
        "teachers_aria_filter": "Filter teachers by service",
        "teachers_modal_close": "Close teacher profile",

        // profile.html (Client Profile & Login)
        "profile_slogan": "Your space for holistic well-being, physical health, and peace of mind.",
        "profile_categories": "Yoga Classes • Psychology & Nutrition Consultations • Workshops",
        "auth_welcome": "Welcome",
        "auth_login_subtitle": "Access your account",
        "auth_create_subtitle": "Join the community",
        "auth_back_login": "← Back to Sign In",
        "profile_title": "Clients Area",
        "profile_desc": "Manage your classes, consultations, and well-being",
        "profile_btn_logout": "Logout",
        "login_card_title": "Sign In",
        "login_email_label": "Email or Mobile Phone",
        "login_identifier_placeholder": "your@email.com or 612345678",
        "login_password_label": "Password",
        "login_btn_submit": "Sign In &rarr;",
        "login_no_account": "Don't have an account yet?",
        "login_btn_register": "Register for free here",
        "register_card_title": "Create Account",
        "register_method_label": "Register with",
        "register_method_email": "Email",
        "register_method_phone": "Mobile Phone",
        "register_name_label": "First Name",
        "register_lastname_label": "Last Name",
        "register_email_label": "Email",
        "register_phone_label": "Mobile Phone (9 digits)",
        "register_phone_placeholder": "E.g.: 612345678",
        "register_phone_hint": "Enter your 9-digit mobile number. We will use it to identify you and send notifications.",
        "register_phone_invalid": "Mobile phone number must have exactly 9 digits.",
        "register_birth_label": "Date of Birth",
        "register_birth_hint": "We use it privately to assign your welcome option.",
        "register_password_label": "Password (min. 8 characters)",
        "register_btn_submit": "Register &rarr;",
        "register_has_account": "Already have an account?",
        "register_btn_login": "Sign in here",
        "register_welcome_bonus_title": "Automatic Welcome Pass",
        "register_welcome_bonus_headline": "Your 1st Yoga class is 100% FREE (€0)!",
        "register_welcome_bonus_desc": "Includes 1 free regular yoga class + 1 Psychology/PNI assessment when you sign up. Join now!",
        "recover_step1_help": "Enter the email address or mobile phone number you originally used to create your account.",
        "recover_identifier_label": "Email or Mobile Phone",
        "recover_code_sent": "Code sent",
        "recover_code_help": "Check your email and enter the code",
        "recover_code_label": "6-digit code",
        "recover_new_password_label": "New Password",
        "recover_confirm_password_label": "Repeat New Password",
        "recover_new_password_placeholder": "At least 8 characters",
        "recover_confirm_password_placeholder": "Repeat the password",
        "profile_edit_phone_label": "Mobile Phone",
        "profile_tab_inicio": "HOME",
        "profile_tab_horarios": "CLASSES",
        "profile_tab_specials": "EVENTS",
        "profile_specials_badge": "Unique experiences",
        "profile_specials_title": "Events: Special Classes & Workshops",
        "profile_specials_desc": "Activities independent of regular schedule. Special Classes are booked with Special Class Passes (1 free/month with Unlimited Plan or €20) and Workshops with individual booking.",
        "profile_specials_unlimited": "VIEW UNLIMITED PLAN",
        "profile_specials_empty": "There are no events scheduled yet.",
        "profile_specials_empty_desc": "New events will appear here when they are published.",
        "profile_tab_psicologia": "CONSULTATIONS",
        "profile_tab_nutricion": "NUTRITION",
        "profile_tab_profesores": "TEACHERS",
        "profile_tab_configuracion": "Configuration",
        "profile_tab_asistencias": "Attendance",
        "profile_btn_edit_profile": "Edit profile",
        "profile_saldos_label": "My balances",
        "profile_saldos_heading": "My Passes & Balances",
        "profile_saldos_subheading": "Check your active class packs, purchased unlimited months and free welcome bonuses.",
        "profile_btn_guide_bonos": "How do passes work?",
        "profile_saldos_info_title": "Your Passes & Balances",
        "profile_saldos_info_intro": "At GEN Yoga, you have different types of balances for your practices and services:",
        "profile_saldos_info_packs_title": "Class Packs (4, 6, or 10 classes)",
        "profile_saldos_info_packs_desc": "Balance from single classes or multi-class packs. Each credit lets you book 1 regular Yoga class. Expire 60 days from purchase. Closest to expiry are used first.",
        "profile_saldos_info_unlimited_title": "Unlimited Monthly Pass (90 € / calendar month)",
        "profile_saldos_info_unlimited_desc": "Unlimited access to all regular Yoga classes during the active calendar month (from the 1st to the last day). Also includes 1 Special Workshop and 1 Free Guest Pass during that month.",
        "profile_saldos_info_free_class_title": "Welcome Pass (0 €)",
        "profile_saldos_info_free_class_desc": "Complimentary welcome credit to book and enjoy your first Yoga session at zero cost.",
        "profile_saldos_info_companion_title": "Companion Yoga Pass (0 €)",
        "profile_saldos_info_companion_desc": "Special promotional pass to book Companion Yoga sessions (Friends, Couples, Mother & Daughter, Grandma & Grandchild) for 2 people at 0 €.",
        "profile_saldos_info_free_consultation_title": "Free Welcome Consultations (0 €)",
        "profile_saldos_info_free_consultation_desc": "Complimentary initial consultation session with our specialists (Psychology, Clinical PNI, or Nutrition/Ayurveda) to guide you.",
        "profile_saldos_info_btn_rates": "View All Rates",
        "profile_saldos_info_btn_close": "Got it",
        "profile_tab_my_calendar": "My schedule",
        "profile_tab_students_per_class": "Students per class",
        "common_yoga": "Yoga",
        "common_classes": "Classes",
        "common_class": "Class",
        "common_psychology": "Psychology",
        "common_nutrition": "Nutrition",
        "common_workshops": "Workshops",
        "common_teacher": "Teacher",
        "common_instructor": "Instructor",
        "common_professional": "Professional",
        "common_appointment": "Session",
        "common_consultation": "Consultation",
        "common_consultations": "Consultations",
        "common_single_class": "Single class",
        "common_single_classes": "Single classes",
        "common_monthly_plan": "Unlimited Pass",
        "common_monthly_plan_active": "Unlimited Pass Active",
        "common_monthly_plan_inactive": "Unlimited Pass Inactive",
        "common_inactive": "Inactive",
        "profile_loading_classes": "Loading classes...",
        "profile_loading_consultations": "Loading consultations...",
        "profile_loading_nutrition": "Loading nutrition consultations...",
        "profile_classes_bookings_calendar": "Classes and Bookings Calendar",
        "profile_general_calendar": "General Calendar",
        "profile_view_all_bookings": "View all bookings",
        "profile_upcoming_title": "My Upcoming Appointments and Classes",
        "profile_no_bookings_title": "You have no bookings",
        "profile_no_bookings_desc": "Use the Classes and Consultations tabs to schedule your bookings.",
        "profile_schedule_title": "Book your practice",
        "profile_schedule_desc": "Find the perfect balance between body and mind. Choose your class and get ready to disconnect.",
        "profile_filter_teacher": "Teacher",
        "profile_filter_type": "Yoga Type",
        "profile_filter_schedule": "Schedule",
        "profile_filter_availability": "Availability",
        "profile_filter_all_teachers": "All teachers",
        "profile_filter_all_types": "All types",
        "profile_filter_any_time": "Any time",
        "profile_filter_morning": "Morning (07:00 - 12:00)",
        "profile_filter_midday": "Midday (12:00 - 16:00)",
        "profile_filter_afternoon": "Afternoon (16:00 - 20:00)",
        "profile_filter_evening": "Evening (20:00 - 23:00)",
        "profile_filter_all_classes": "All classes",
        "profile_filter_free_spots": "With free spots",
        "profile_filter_full_classes": "Full classes",
        "profile_no_balance_title": "No class credits available",
        "profile_no_balance_desc": "Buy a single class or a pack of 4, 6 or 10 classes to book your next session.",
        "profile_directions": "Directions",
        "profile_no_classes_available": "No classes available",
        "profile_no_classes_available_desc": "We are planning next week. Check back soon.",
        "profile_select_day": "Select a day",
        "profile_view_all_classes": "View all classes",
        "profile_no_matching_classes": "No classes match the filters",
        "profile_reset_filters": "Reset filters",
        "profile_assign": "ASSIGN",
        "profile_cancel": "CANCEL",
        "profile_full": "Full",
        "profile_unavailable": "Unavailable",
        "profile_no_balance": "No Balance",
        "profile_buy_extra_credit": "Buy extra credit 15€",
        "profile_buy_extra_credit_short": "Pay 15€",
        "profile_book": "BOOK",
        "profile_your_spot": "Your Spot",
        "profile_capacity": "Capacity",
        "profile_request": "Request",
        "profile_request_activation": "Request activation",
        "profile_manage_billing": "Manage subscription and billing",
        "profile_week_short": "Week",
        "profile_month_short": "Month",
        "profile_expires": "Expires",
        "profile_mental_wellbeing": "Mental Well-being",
        "profile_nutritional_wellbeing": "Nutritional Well-being",
        "profile_psychology_title": "Psychology Consultations",
        "profile_psychology_desc": "Book your psychotherapeutic accompaniment or couples therapy consultations with our expert team.",
        "profile_nutrition_title": "Nutrition Consultations",
        "profile_nutrition_desc": "Improve your eating habits and well-being with personalized guidance from our nutrition team.",
        "profile_calendar_consultations": "Consultations Calendar",
        "profile_calendar_nutrition": "Nutrition Calendar",
        "profile_view_all_consultations": "View all consultations",
        "profile_no_consultations_available": "No consultations available",
        "profile_no_consultations_available_desc": "There is currently no availability configured for consultations. Check back soon.",
        "profile_no_nutrition_available": "No nutrition consultations available",
        "profile_no_nutrition_available_desc": "There is currently no availability configured for nutrition consultations. Check back soon.",
        "profile_no_consultations_date": "No consultations on this date",
        "profile_no_nutrition_date": "No nutrition consultations on this date",
        "profile_view_all": "View all",
        "profile_filter_consultation_type": "Consultations",
        "profile_filter_all_consultations": "All consultations",
        "profile_filter_my_booked_consultations": "My booked consultations",
        "profile_filter_available_consultations": "Available",
        "profile_no_booked_consultations": "No booked consultations",
        "profile_no_booked_consultations_desc": "You have no consultations booked at this time.",
        "profile_reserved": "Booked",
        "profile_zero_sessions": "0 Sessions",
        "profile_your_consultation": "Your Consultation",
        "profile_your_appointment": "Your Appointment",
        "profile_confirmed": "Confirmed",
        "profile_cancel_booking": "Cancel booking",
        "profile_more": "more",
        "profile_teachers_badge": "Expert Teachers",
        "profile_teachers_title": "Studio Teachers",
        "profile_teachers_desc": "Meet the teachers who will guide your practice, consultations and workshops. Each brings unique energy and years of experience to help you grow.",
        "profile_filter_all": "All",

        // SweetAlerts & Dynamic labels (for app.js / profile.js)
        "alert_error": "Error",
        "alert_warning": "Warning",
        "alert_success": "Success",
        "alert_info": "Information",
        "alert_cancel": "Cancel",
        "alert_yes_cancel": "Yes, cancel",
        "alert_yes_reserve": "Yes, book",
        "alert_no_credits": "You need a pass or pack",
        "alert_no_credits_desc": "You do not have an active pass for this class. Choose a class pack or unlimited pass to book.",
        "alert_class_too_close": "Bookings close {hours} hours before the start. The deadline for this class has passed.",
        "alert_cancel_too_close": "You can no longer cancel: the class starts in {hours} hours or less. The reserved credit is not refunded.",
        "alert_confirm_reservation": "Confirm Booking",
        "alert_reserve_mensual": "Do you want to book this class using your <b>Unlimited Pass</b>?",
        "alert_reserve_semana_limit": "Do you want to book this class using your <b>Unlimited Pass</b>?",
        "alert_reserve_mes_limit": "Your Unlimited Pass gives you access to all the regular classes you want during the natural month.",
        "alert_reserve_suelta": "Do you want to book this class using <b>one of your class credits</b>?",
        "alert_booking_confirmed": "Class Booked!",
        "alert_booking_confirmed_desc": "Your yoga mat awaits you. Namaste. 🙏",
        "alert_cancel_confirmed": "Booking cancelled. Balance updated.",
        "btn_reserve": "BOOK NOW",
        "btn_no_balance": "No Balance",
        "btn_full": "Full",
        "btn_not_available": "Unavailable",
        "badge_mensual_active": "Monthly Plan Active",
        "badge_mensual_inactive": "Monthly Plan Inactive",
        "badge_clases_sueltas": "Single class",
        "badge_clases_sueltas_pl": "Single classes",
        "title_cancel": "CANCEL",

        // policy wording dynamic
        "policy_booking_limit": "Bookings close <b>{res} hours</b> before the start.",
        "policy_cancel_limit": "You can cancel and recover the credit while more than <b>{can} hours</b> remain. At that cutoff, cancellation is blocked and the credit is not refunded.",
        "footer_address": "2 San Carlos St, Albacete",

        // --- QA | Home welcome modal (index.html) ---
        "flash_badge": "★ 100% Free · New students",
        "home_h1": "GEN Yoga · Yoga and wellness studio in Albacete",
        "flash_price_note": "no sign-up fee · no strings attached",
        "flash_close_label": "Close promotional notice",
        "flash_title": "Your 1st Yoga Class is Free!",
        "flash_lead": "Create your account at <strong>GEN Yoga</strong> and automatically receive in your profile your <strong>Welcome Pass</strong> to start practising with us:",
        "flash_benefit_session": "1 Free Yoga Session for any regular class",
        "flash_benefit_valid": "Valid for any regular slot in the weekly timetable (workshops and special classes excluded)",
        "flash_benefit_activation": "Instant activation:",
        "flash_benefit_instant": "Available the moment you sign up. Join us and come meet us!",
        "flash_cta": "✨ Create Account and Claim Your Pass (€0) →",
        "flash_secondary": "Close and continue to the studio",

        // --- QA | Welcome card (tarifas.html) ---
        "rates_welcome_free_session": "1 Free Yoga Session for any regular class",
        "rates_welcome_valid_for": "Valid for booking your spot in",
        "rates_welcome_regular_classes": "any of our regular yoga classes",
        "rates_welcome_schedule_note": "in the weekly timetable (workshops and special classes excluded)",
        "rates_welcome_instant_title": "Instant and Automatic Activation",
        "rates_welcome_instant_text": "Available in your profile as soon as you finish signing up. No waiting, no codes.",
        "rates_welcome_view_schedule": "See regular classes and timetable →",

        // --- QA | Events category: dynamic cards (tarifas.html) ---
        "rates_events_next_taller": "Next Workshop",
        "rates_events_next_special": "Next Special Class",
        "rates_events_date": "{day} {num} {month} · {start} to {end}",
        "rates_events_subtitle_taller": "With {teacher} · {duration}",
        "rates_events_subtitle_special": "With {teacher} · Themed Session ({duration} min)",
        "rates_events_duration_hours": "2 Hours of Immersion",
        "rates_events_duration_minutes": "{duration} Minutes of Immersion",
        "rates_events_price_taller": "/ spot ({duration} min)",
        "rates_events_price_special": "/ spot (or with the Unlimited Pass)",
        "rates_events_desc_taller": "A complete {duration}-minute immersion designed to learn and consolidate the foundations of the practice with personal attention.",
        "rates_events_desc_special": "A guided deepening practice combining gentle asana with pranayama and deep meditation techniques to calm the nervous system and restore inner balance.",
        "rates_events_bullet_taller_1": "Up to {capacity} students for personal attention",
        "rates_events_bullet_taller_2": "Hands-on adjustments and individual support",
        "rates_events_bullet_taller_3": "Support material and infusions included",
        "rates_events_bullet_special_1": "Small groups (up to {capacity} spots)",
        "rates_events_bullet_special_2": "<strong>1 class a month included</strong> with the Unlimited Pass",
        "rates_events_bullet_special_3": "Available for drop-in purchase or pass booking",
        "rates_events_link_taller": "See details on the calendar →",
        "rates_events_link_special": "See upcoming dates on the timetable →",
        "rates_events_empty_title": "New workshops coming soon",
        "rates_events_empty": "There are currently no active workshops or special classes with future dates. We will soon publish new experiences and dates. Check our weekly timetable to discover all the regular classes.",
        "rates_events_empty_cta": "See full timetable",
        "rates_events_book": "Book a Spot",
        "rates_events_loading": "Loading upcoming workshops…",

        // --- QA | Other copy ---
        "teachers_footer_address": "© 2026 GEN Yoga • 2 San Carlos St, Albacete",
        "btn_back_home_arrow": "← HOME",
        "success_verifying": "Verifying your purchase...",
        "success_error_title": "We could not verify the payment",
        "success_error_message": "No purchase has been confirmed. Check the link or try again.",
        "success_error_verify_network": "We could not confirm the payment with Stripe. If your card has been charged, your pass will sync automatically. Do not pay again before pressing Retry verification.",
        "success_error_verify_retry": "We could not confirm the payment with Stripe. If your card has been charged, your pass will sync to your account shortly.",
        "success_error_retry": "Try verification again",
        "success_error_back": "Back to Rates",
        "success_done_title": "Payment Complete!",
        "success_done_message": "Stripe has confirmed your purchase. Your account will update automatically; if you still do not see the new balance when you open your profile, simply reload the page.",
        "success_redirecting": "Redirecting you to your profile in <span id=\"countdown\">5</span> seconds...",
        "success_go_profile": "Go to my profile",
        "success_manage_invoices": "Manage my invoices / subscription",
        "success_error_invalid_session": "The link does not contain a valid LIVE payment session. No purchase has been confirmed.",
        "success_guest_title": "Class Purchased!",
        "success_guest_intro": "You have purchased <strong>1 single class</strong> as a guest. Choose the yoga class you want to attend below and enter your details to confirm your spot.",
        "success_guest_select_label": "1. Choose your yoga class",
        "success_guest_loading_classes": "Loading available classes...",
        "success_guest_name_label": "First name",
        "success_guest_name_placeholder": "Your first name",
        "success_guest_surname_label": "Last name",
        "success_guest_surname_placeholder": "Your last name",
        "success_guest_confirm": "Confirm and Book Spot",
        "success_guest_back_home": "Back to Home",
        "success_consultation_title": "Consultation purchased!",
        "success_consultation_default_message": "Stripe has confirmed the payment and your consultation has been registered successfully.",
        "success_consultation_payment_label": "Payment registered",
        "success_consultation_instructions": "Write to us to arrange the date of your consultation. Include the name or phone number and email used during payment so we can find it quickly.",
        "success_consultation_contact": "Contact GEN Yoga",
        "success_consultation_back_rates": "Back to Rates",
        "success_consultation_message": "Stripe has confirmed the payment for your <strong>{item}</strong>.",
        "success_consultation_receipt": " Your purchase receipt has been sent to <strong>{email}</strong>.",
        "success_consultation_identify": " On the day of the session you can identify yourself at the studio with your details (<strong>{data}</strong>).",
        "success_redeemed_title": "Booking Already Redeemed",
        "success_redeemed_message": "This single-class purchase has already been used to make a booking. If you need to change your booking, please contact reception.",
        "success_redeemed_back_home": "Back to Home",
        "success_bono_month": "Your Unlimited Pass for {month} is now registered. You can use it from the first to the last day of that calendar month.",
        "success_single_class": "Your single class is now registered as a separate pass and will expire 60 calendar days after purchase.",
        "success_pack_credits": "Your {credits}-class pack is now registered and active in your account with 60 days of validity. You can start booking your classes!",
        "success_workshop_confirmed": "Your spot for the Introduction to Power Vinyasa workshop is confirmed and registered in your account.",
        "success_special_class_confirmed": "Your spot for the Special Class is confirmed and registered in your account.",
        "success_item_fallback": "Booking",
        "success_portal_connecting_title": "Connecting to the payment gateway...",
        "success_portal_wait": "Please wait a moment.",
        "success_portal_invalid_url": "The server returned an invalid billing address.",
        "success_portal_error": "The portal could not be opened.",
        "success_classes_none": "No classes available at the moment",
        "success_classes_choose": "-- Choose a yoga class --",
        "success_classes_full": "All upcoming classes are full",
        "success_classes_error": "Available spots could not be checked",
        "success_classes_spots": "available",
        "success_classes_with": "with",
        "success_yoga_class": "Yoga Class",
        "success_instructor": "Instructor",
        "success_date_at": "{day}, {num} {month} at {time}",
        "success_guest_select_required": "Please select a yoga class.",
        "success_guest_name_required": "First name is a required field.",
        "success_guest_booking_title": "Booking your class...",
        "success_guest_booking_success_title": "Booking Complete!",
        "success_guest_booking_success_text": "Your class has been booked successfully. We look forward to seeing you at the studio.",
        "success_guest_booking_other_title": "Choose another class",
        "success_guest_booking_other_text": "Your payment is still valid (you have not been charged again), but that class is no longer available. Choose another one from the list and press “Confirm booking”. If you need help, contact reception.",
        "success_guest_booking_network": "Could not connect to the booking server. Your purchase is registered; try again in a few seconds or contact reception to assign your spot.",
        "success_guest_booking_error_title": "Booking error",
        "success_guest_booking_error": "Your booking could not be processed. Please try again."
    }
};

function translateProfessional(p) {
    if (!p) return p;
    const lang = window.currentLang || (typeof safeGetItem === 'function' ? safeGetItem('yoga-lang', 'es') : 'es');
    if (lang === 'en') {
        const trans = window.GENTeacherProfiles?.getEnglishProfile(p);
        if (trans) {
            return {
                ...p,
                nombre: trans.nombre || p.nombre,
                especialidad: trans.especialidad || p.especialidad,
                descripcion: trans.descripcion || p.descripcion,
                bio: trans.descripcion || p.bio
            };
        }
    }
    return p;
}

window.translateProfessional = translateProfessional;

function safeGetItem(key, fallback) {
    try {
        return localStorage.getItem(key) || fallback;
    } catch (e) {
        return fallback;
    }
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        // Safe fallback for sandboxed preview windows
    }
}

function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        // Safe fallback for sandboxed preview windows
    }
}

let currentLang = safeGetItem('yoga-lang', 'es');
if (currentLang !== 'es' && currentLang !== 'en') {
    // Idioma corrupto en storage: volver a ES y reescribirlo (evita píldora sin activo).
    currentLang = 'es';
    safeSetItem('yoga-lang', 'es');
}

function setLanguage(lang) {
    if (lang !== 'es' && lang !== 'en') return;
    currentLang = lang;
    window.currentLang = currentLang;
    document.documentElement.lang = lang;
    if (document.body) document.body.dataset.lang = lang;
    safeSetItem('yoga-lang', lang);
    applyTranslations();
    
    // Update selector buttons styling using native CSS styles (bypassing Tailwind compiler completely)
    const btnEs = document.getElementById('lang-btn-es');
    const btnEn = document.getElementById('lang-btn-en');
    
    if (btnEs && btnEn) {
        const isNative = !!(document.documentElement && document.documentElement.classList && document.documentElement.classList.contains('is-native-app'));
        [btnEs, btnEn].forEach(btn => {
            btn.style.cursor = 'pointer';
            btn.style.fontFamily = 'system-ui, -apple-system, sans-serif';
            btn.style.border = 'none';
            btn.style.background = 'none';
            btn.style.padding = isNative ? '4px 10px' : '2px 6px';
            if (isNative) {
                btn.style.minWidth = '34px';
                btn.style.minHeight = '32px';
                btn.style.display = 'inline-flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'center';
                btn.style.touchAction = 'manipulation';
                btn.style.webkitTapHighlightColor = 'transparent';
            }
            btn.style.outline = 'none';
            btn.style.transition = 'all 0.2s ease';
        });

        if (lang === 'es') {
            btnEs.style.fontWeight = '900';
            btnEs.style.textDecoration = 'underline';
            btnEs.style.textDecorationThickness = '2px';
            btnEs.style.textUnderlineOffset = '4px';
            btnEs.style.color = '#f8f6f2';
            btnEs.style.opacity = '1';

            btnEn.style.fontWeight = '500';
            btnEn.style.textDecoration = 'none';
            btnEn.style.color = '#f8f6f2';
            btnEn.style.opacity = '0.85';
        } else {
            btnEn.style.fontWeight = '900';
            btnEn.style.textDecoration = 'underline';
            btnEn.style.textDecorationThickness = '2px';
            btnEn.style.textUnderlineOffset = '4px';
            btnEn.style.color = '#f8f6f2';
            btnEn.style.opacity = '1';

            btnEs.style.fontWeight = '500';
            btnEs.style.textDecoration = 'none';
            btnEs.style.color = '#f8f6f2';
            btnEs.style.opacity = '0.85';
        }
    }

    // Trigger standard global event so other modules can react
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
}

function t(key, fallback = '') {
    if (translations[currentLang]?.[key] !== undefined && translations[currentLang][key] !== '') {
        return translations[currentLang][key];
    }
    if (translations['es']?.[key] !== undefined && translations['es'][key] !== '') {
        return translations['es'][key];
    }
    return fallback || key || '';
}

const alertTranslations = {
    "Contraseña débil": "Weak password",
    "Usa al menos 6 caracteres.": "Use at least 6 characters.",
    "Usa al menos 8 caracteres.": "Use at least 8 characters.",
    "Error": "Error",
    "Atención": "Warning",
    "Éxito": "Success",
    "Información": "Information",
    "Acción no permitida": "Action not allowed",
    "Solo los alumnos pueden realizar reservas de clases.": "Only students can book classes.",
    "No se puede reservar": "Cannot book",
    "La clase está demasiado cerca y no puedes reservar.": "The class starts too soon and you cannot book.",
    "Ya estás inscrito": "Already registered",
    "Ya tienes una reserva confirmada para esta clase.": "You already have a confirmed booking for this class.",
    "Clase Completa": "Class Full",
    "Lo sentimos, esta clase ya no tiene plazas disponibles.": "Sorry, this class has no places available.",
    "¿Quieres reservar esta clase?": "Do you want to book this class?",
    "¿Eliminar reserva?": "Delete booking?",
    "Esta acción no se puede deshacer.": "This action cannot be undone.",
    "Sí, borrar": "Yes, delete",
    "No hay clases registradas o reservas aún.": "No classes or bookings registered yet.",
    "¿Eliminar taller?": "Delete workshop?",
    "Taller creado": "Workshop created",
    "Taller eliminado": "Workshop deleted",
    "Eliminando taller...": "Deleting workshop...",
    "Clase creada": "Class created",
    "Clase eliminada": "Class deleted",
    "Eliminando clase...": "Deleting class...",
    "Bono Mensual activado": "Monthly Plan activated",
    "Bono Mensual desactivado": "Monthly Plan deactivated",
    "No se pudo activar el bono": "Could not activate plan",
    "Bono desactivado": "Plan deactivated",
    "¿Desactivar bono?": "Deactivate plan?",
    "Sí, desactivar": "Yes, deactivate",
    "Bono activado": "Plan activated",
    "Fallo al cargar": "Failed to load",
    "¡Clase Reservada!": "Class Booked!",
    "Tu esterilla te espera. Namasté. 🙏": "Your mat awaits you. Namaste. 🙏",
    "Reserva Cancelada": "Booking Cancelled",
    "La reserva ha sido cancelada y la clase devuelta a tu saldo.": "Your booking has been cancelled and the class credited back to your balance.",
    "¿Quieres cancelar esta reserva?": "Do you want to cancel this booking?",
    "Sí, cancelar": "Yes, cancel",
    "No se puede cancelar": "Cannot cancel",
    "No se puede reservar: ya es tarde.": "Cannot book: it's too late.",
    "Error al reservar": "Booking error",
    "Accediendo...": "Logging in...",
    "Sesión iniciada": "Logged in",
    "Bienvenido de nuevo": "Welcome back",
    "Creando cuenta...": "Creating account...",
    "Cuenta creada": "Account created",
    "Ups...": "Oops...",
    "Credenciales incorrectas. Comprueba tu email o teléfono y contraseña.": "Incorrect credentials. Check your email or phone and password.",
    "Reintentar": "Try again",
    "¿Olvidaste tu contraseña?": "Forgot your password?",
    "Campo obligatorio": "Required field",
    "Introduce tu correo electrónico o tu teléfono móvil.": "Enter your email address or mobile phone number.",
    "Recuperación solo por email": "Email recovery only",
    "La recuperación online solo funciona con tu email registrado (no hay SMS). Si te registraste con teléfono, pide el reseteo en recepción.": "Online recovery only works with your registered email address (there is no SMS). If you signed up with a phone number, ask reception to reset it.",
    "Sin conexión": "No connection",
    "No hay conexión con el servidor. Inténtalo de nuevo.": "There is no connection to the server. Please try again.",
    "No hay conexión con el servidor.": "There is no connection to the server.",
    "Enviando código...": "Sending code...",
    "Revisa tu correo": "Check your email",
    "Si existe una cuenta con estos datos, te hemos enviado un código de 6 dígitos (caduca en 15 minutos).<br><br>¿Teléfono sin email? Pide el reseteo en recepción.": "If an account exists with these details, we have sent you a 6-digit code (valid for 15 minutes).<br><br>Phone without email? Ask reception to reset it.",
    "No se pudo enviar": "Could not send",
    "Comprueba tu conexión e inténtalo de nuevo.": "Check your connection and try again.",
    "Falta el identificador de cuenta.": "The account identifier is missing.",
    "Código incompleto": "Incomplete code",
    "Introduce el código de 6 dígitos que te hemos enviado por email.": "Enter the 6-digit code we sent to your email.",
    "La nueva contraseña debe tener al menos 8 caracteres.": "The new password must be at least 8 characters long.",
    "Las contraseñas no coinciden": "Passwords do not match",
    "Verifica que ambas contraseñas escritas sean exactamente iguales.": "Make sure both passwords are exactly the same.",
    "Verificando código...": "Verifying code...",
    "¡Contraseña restablecida!": "Password reset!",
    "Tu contraseña se ha actualizado correctamente. Ya puedes acceder con ella.": "Your password has been updated successfully. You can now sign in with it.",
    "Entrar ahora": "Sign in now",
    "No se pudo completar": "Could not complete",
    "Código incorrecto o caducado. Pide uno nuevo e inténtalo de nuevo.": "Incorrect or expired code. Request a new one and try again.",
    "Sí, reservar": "Yes, book",
    "Cancelar": "Cancel",
    "Entendido": "Understood",
    "Compra un bono extra": "Buy an extra credit",
    "Has alcanzado los límites de tu bono mensual (o no lo tienes activo) y no te quedan bonos disponibles. Compra un bono extra por 15€ para reservar.": "You do not have an active pass or class credit left. Choose a class pack or unlimited pass to book.",
    "¿Quieres reservar esta clase con tu <b>Bono Ilimitado</b>?": "Do you want to book this class with your <b>Unlimited Pass</b>?",
    "¿Quieres reservar esta clase usando tu <b>Bono Ilimitado</b>?": "Do you want to book this class with your <b>Unlimited Pass</b>?",
    "¿Quieres reservar esta clase usando <b>uno de tus bonos</b>?": "Do you want to book this class using <b>one of your class credits</b>?",

    // --- QA | Diálogos de compra de tarifas.html (no estaban en el mapa) ---
    "Clase suelta de Yoga · 15 €": "Drop-in Yoga Class · €15",
    "Selecciona la clase a la que quieres asistir:": "Select the class you want to attend:",
    "No se pudo cargar la lista de clases. Inténtalo de nuevo.": "We could not load the class list. Please try again.",
    "Elige la fecha de tu primera clase de yoga gratuita. Después crearás tu cuenta.": "Choose the date of your first free yoga class. You will create your account next.",
    "Datos del Alumno (Usuario Temporal)": "Student details (temporary user)",
    "¿Prefieres usar tu cuenta? Inicia sesión y tus datos se completarán automáticamente.": "Prefer to use your account? Sign in and your details will be filled in automatically.",
    "Introduce tus datos para registrar tu reserva temporal y enviarte el acceso a la clase:": "Enter your details to register your temporary booking and receive your class access:",
    "Este campo es obligatorio.": "This field is required.",
    "El nombre es obligatorio.": "The first name is required.",
    "El apellido es obligatorio.": "The last name is required.",
    "Por favor, introduce tu nombre.": "Please enter your first name.",
    "Por favor, introduce tus apellidos.": "Please enter your last name.",
    "El teléfono móvil debe tener 9 dígitos numéricos.": "The mobile number must be 9 numeric digits.",
    "El email no es válido.": "The email is not valid.",
    "Solo clases regulares de yoga (no incluye talleres ni clases especiales)": "Regular yoga classes only (workshops and special classes excluded)",
    "Próxima clase disponible": "Next available class",
    "Selecciona una fecha futura para tu clase.": "Select a future date for your class.",
    "Este taller ha comenzado o finalizado.": "This workshop has started or finished.",
    "¿Quieres comprar esta plaza?": "Do you want to buy this spot?",
    "Clase no reservable con clase suelta": "This session cannot be booked with a drop-in class",
    "Esta sesión es un taller o clase especial y no se puede reservar con clase suelta o bono normal (15 €). Por favor, selecciona una clase regular de yoga.": "This session is a workshop or special class and cannot be booked with a drop-in or normal pass (€15). Please select a regular yoga class.",
    "Elegir otra clase": "Choose another class",
    "Ver horario completo": "See full timetable",
    "Ver detalles en el calendario →": "See details on the calendar →"
};

function translateText(text) {
    if (typeof text !== 'string') return text;
    const trimmed = text.trim();
    if (alertTranslations[trimmed]) {
        return alertTranslations[trimmed];
    }
    // Check dynamic cancellation
    if (trimmed.includes("ya no se puede cancelar debido a que la clase es en menos de")) {
        const match = trimmed.match(/\d+/);
        const hours = match ? match[0] : '24';
        return `Cancellations are not allowed within less than ${hours} hours from the class.`;
    }
    // Check dynamic monthly plan info
    if (trimmed.includes("Bono Ilimitado") || trimmed.includes("Bono Mensual")) {
        return "Do you want to book this class with your <b>Unlimited Pass</b>?";
    }
    let newText = text;
    for (const key in alertTranslations) {
        if (newText.includes(key)) {
            newText = newText.replaceAll(key, alertTranslations[key]);
        }
    }
    return newText;
}

if (window.Swal) {
    const originalSwalFire = window.Swal.fire;
    window.Swal.fire = function(...args) {
        if (currentLang === 'en') {
            if (args.length === 1 && typeof args[0] === 'object') {
                const opts = { ...args[0] };
                if (opts.title) opts.title = translateText(opts.title);
                if (opts.text) opts.text = translateText(opts.text);
                if (opts.html) opts.html = translateText(opts.html);
                if (opts.confirmButtonText) opts.confirmButtonText = translateText(opts.confirmButtonText);
                if (opts.cancelButtonText) opts.cancelButtonText = translateText(opts.cancelButtonText);
                if (opts.denyButtonText) opts.denyButtonText = translateText(opts.denyButtonText);
                if (opts.inputLabel) opts.inputLabel = translateText(opts.inputLabel);
                if (opts.inputPlaceholder) opts.inputPlaceholder = translateText(opts.inputPlaceholder);
                if (opts.inputErrorMessages && typeof opts.inputErrorMessages === 'object') {
                    opts.inputErrorMessages = Object.fromEntries(
                        Object.entries(opts.inputErrorMessages).map(([k, v]) => [k, translateText(v)])
                    );
                }
                return originalSwalFire.call(window.Swal, opts);
            } else {
                const newArgs = args.map(arg => typeof arg === 'string' ? translateText(arg) : arg);
                return originalSwalFire.apply(window.Swal, newArgs);
            }
        }
        return originalSwalFire.apply(window.Swal, args);
    };
}

function translateDayHeaders() {
    const daysES = ["L", "M", "X", "J", "V", "S", "D"];
    const daysEN = ["M", "T", "W", "T", "F", "S", "S"];
    
    document.querySelectorAll(".grid-cols-7").forEach(grid => {
        const children = Array.from(grid.children);
        if (children.length === 7) {
            const childTexts = children.map(c => c.textContent.trim());
            const matchesES = childTexts.every((txt, idx) => txt === daysES[idx] || txt === daysEN[idx]);
            if (matchesES) {
                children.forEach((child, idx) => {
                    child.textContent = currentLang === 'es' ? daysES[idx] : daysEN[idx];
                });
            }
        }
    });
}

function applyTranslations() {
    // 1. Scopes static tags with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = t(key);
        if (translation && translation !== key) {
            if (el.tagName === 'INPUT' && el.placeholder !== undefined) {
                el.placeholder = translation;
            } else {
                el.innerHTML = translation;
            }
        }
    });

    // 1b. Scopes accessible labels (aria-label) — QA v17.22
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const translation = t(el.getAttribute('data-i18n-aria-label'));
        if (translation) el.setAttribute('aria-label', translation);
    });

    // 2. Translate document title dynamically based on key
    const pageTitleKey = document.body.dataset.pageTitleKey;
    if (pageTitleKey) {
        const pageTitle = t(pageTitleKey);
        if (pageTitle) document.title = pageTitle;
    }

    // 3. Translate day headers
    translateDayHeaders();
}

// Global exposure
window.translations = translations;
window.setLanguage = setLanguage;
window.t = t;
window.currentLang = currentLang;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    // Auto-inject language pill selector if not already statically defined
    let langDiv = document.getElementById('floating-lang-selector');
    if (!langDiv) {
        langDiv = document.createElement('div');
        langDiv.id = 'floating-lang-selector';
        
        // CSS Style declarations for layout and high-contrast styling (completely bypassing Tailwind to avoid compiling issues)
        langDiv.style.position = 'fixed';
        
        // Calculate marquee height dynamically to avoid overlaps
        const marquee = document.querySelector('.custom-marquee-bg') || document.querySelector('.animate-marquee');
        let marqueeHeight = 0;
        if (marquee) {
            marqueeHeight = marquee.getBoundingClientRect().height;
        }
        
        const isNative = !!(document.documentElement && document.documentElement.classList && document.documentElement.classList.contains('is-native-app'));
        const isProfilePage = window.location.pathname.includes('profile.html');
        if (isProfilePage) {
            langDiv.classList.add('is-profile-lang');
            langDiv.style.top = 'auto';
            langDiv.style.right = 'auto';
            langDiv.style.bottom = isNative ? 'max(calc(env(safe-area-inset-bottom, 0px) + 12px), 18px)' : '18px';
            langDiv.style.left = '18px';
        } else if (marqueeHeight > 0) {
            if (isNative) {
                langDiv.style.top = `calc(var(--gy-notch-shield-height, 42px) + ${marqueeHeight + 10}px)`;
                langDiv.style.right = '16px';
            } else {
                langDiv.style.top = (marqueeHeight + 16) + 'px'; // Positioned mathematically below the marquee banner
                langDiv.style.right = '24px';
            }
            langDiv.style.bottom = 'auto';
            langDiv.style.left = 'auto';
        } else {
            if (isNative) {
                langDiv.style.top = 'calc(var(--gy-notch-shield-height, 42px) + 14px)';
                langDiv.style.right = '16px';
            } else {
                langDiv.style.top = '16px';
                langDiv.style.right = '24px';
            }
            langDiv.style.bottom = 'auto';
            langDiv.style.left = 'auto';
        }
        
        langDiv.style.zIndex = '9998'; // Keep the language control above the page content.
        langDiv.style.backgroundColor = '#795244'; // Elegant brand brown
        langDiv.style.border = '1px solid rgba(248, 246, 242, 0.15)';
        langDiv.style.borderRadius = '9999px';
        langDiv.style.padding = isNative ? '4px 8px' : '4px 10px';
        langDiv.style.display = 'flex';
        langDiv.style.alignItems = 'center';
        langDiv.style.gap = isNative ? '2px' : '4px';
        langDiv.style.fontSize = isNative ? '12px' : '11px';
        langDiv.style.color = '#f8f6f2'; // Brand cream text
        langDiv.style.boxShadow = isNative ? '0 4px 14px rgba(38, 22, 12, 0.35)' : '0 6px 16px rgba(38, 22, 12, 0.2)';
        langDiv.style.userSelect = 'none';
        langDiv.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        langDiv.style.pointerEvents = 'auto'; // Ensure clicks are always received
        if (isNative) {
            langDiv.style.touchAction = 'manipulation';
            langDiv.style.webkitTapHighlightColor = 'transparent';
        }
        
        langDiv.innerHTML = `
            <button id="lang-btn-es" style="cursor:pointer; font-family:inherit; border:none; background:none; padding:${isNative ? '4px 10px' : '4px 8px'}; min-width:${isNative ? '34px' : '32px'}; min-height:${isNative ? '32px' : '24px'}; display:${isNative ? 'inline-flex' : 'inline'}; align-items:center; justify-content:center; outline:none; font-weight:900; text-decoration:underline; text-decoration-thickness:2px; text-underline-offset:4px; color:#f8f6f2; opacity:1; ${isNative ? 'touch-action:manipulation; -webkit-tap-highlight-color:transparent;' : ''}">ES</button>
            <span style="color:rgba(248, 246, 242, 0.95); font-size:11px; pointer-events:none; user-select:none;">/</span>
            <button id="lang-btn-en" style="cursor:pointer; font-family:inherit; border:none; background:none; padding:${isNative ? '4px 10px' : '4px 8px'}; min-width:${isNative ? '34px' : '32px'}; min-height:${isNative ? '32px' : '24px'}; display:${isNative ? 'inline-flex' : 'inline'}; align-items:center; justify-content:center; outline:none; font-weight:500; text-decoration:none; color:#f8f6f2; opacity:0.85; ${isNative ? 'touch-action:manipulation; -webkit-tap-highlight-color:transparent;' : ''}">EN</button>
        `;
        document.body.appendChild(langDiv);
    }
    
    // Bind programmatic click handlers for ES/EN buttons
    const btnEs = document.getElementById('lang-btn-es');
    const btnEn = document.getElementById('lang-btn-en');
    if (btnEs) btnEs.addEventListener('click', () => setLanguage('es'));
    if (btnEn) btnEn.addEventListener('click', () => setLanguage('en'));
    
    // Set initial states
    setLanguage(currentLang);
});
