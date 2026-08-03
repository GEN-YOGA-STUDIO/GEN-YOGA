(function (root) {
    'use strict';

    const descriptions = Object.freeze({
        angel: `LUGAR DE NACIMIENTO: La Roda (Albacete)

TITULACIONES:
Baso mi aprendizaje en el autoestudio y la práctica, en recibir clases e intensivos de profesores con larga trayectoria —anatomía, asana, filosofía y todo lo necesario para mi desarrollo en el camino del yoga—. Además, estoy cursando una mentoría para la certificación como profesor de yoga Iyengar.

SOBRE MÍ:
Cuento con 6 años de experiencia en la práctica del yoga, de los cuales 5 años y medio están dedicados a estudiar y practicar yoga Iyengar en Valencia y La Roda.

TE ACOMPAÑO:
La práctica se basa en el ajuste preciso y la correcta alineación del cuerpo. Adapto la postura a las condiciones de cada alumno o alumna para encontrar los efectos y beneficios del asana. Trabajamos en la comprensión de las acciones y en sentir lo que hacemos; desde la profundidad de ese trabajo físico, abrimos la posibilidad de relacionarnos de una manera acorde con el conocimiento propio que surge con la práctica.

ME DEFINE:
"Dedicación y cuidado"`,
        miriam: `LUGAR DE NACIMIENTO: Cuenca (España)

TITULACIONES:
Graduada en Psicología por la Universidad de Valencia
Máster en Trastornos de la Conducta Alimentaria por la Universidad Complutense de Madrid
Formación en EMDR (desensibilización y reprocesamiento por movimientos oculares)
Formación en Brainspotting
Formación en Terapia Gestalt
Formación especializada en trauma, apego, regulación emocional, violencia de género, abuso sexual y crecimiento personal
Técnica en Dietética y Nutrición
Técnica Superior en Animación de Actividades Físicas y Deportivas
Técnica en Conducción de Actividades Físico-Deportivas en el Medio Natural
Formación en quiromasaje y otras disciplinas vinculadas al cuidado corporal

SOBRE MÍ:
Mi trayectoria profesional comenzó en el ámbito de la actividad física, el deporte y la promoción de hábitos saludables. Durante años trabajé como monitora deportiva, socorrista y formadora, acompañando a personas de diferentes edades en procesos relacionados con el movimiento, el bienestar y la salud.
Con el tiempo surgió en mí el interés por comprender aquello que muchas veces se expresa a través del cuerpo: las emociones, las dificultades personales, el sufrimiento y los procesos de transformación. Ese camino me llevó a estudiar Psicología y, posteriormente, a especializarme en trastornos de la conducta alimentaria, trauma y regulación emocional.
Actualmente soy fundadora de Respira, un espacio de acompañamiento psicológico donde trabajo principalmente con adolescentes y personas adultas en procesos relacionados con la autoestima, la ansiedad, los trastornos de la conducta alimentaria, el trauma, el autoconocimiento y el bienestar emocional.
Además de la intervención individual, realizo charlas, talleres y actividades grupales, y divulgo contenidos sobre salud mental a través de redes sociales y del programa de radio y pódcast "Más allá de la comida". También he impulsado iniciativas comunitarias, como un club de lectura terapéutico, y participo activamente en jornadas sociales, encuentros de mujeres y actividades relacionadas con la promoción de la salud física, mental y emocional.

TE ACOMPAÑO:
Trastornos de la conducta alimentaria (TCA)
Relación con la comida y la imagen corporal
Autoestima y autoconfianza
Ansiedad y regulación emocional
Trauma y heridas emocionales
Procesos de cambio vital
Duelo y pérdidas
Crecimiento personal y autoconocimiento
Conexión cuerpo-mente
Bienestar integral y autocuidado

ME DEFINE:
"Creo profundamente en la capacidad de las personas para transformarse cuando encuentran un espacio seguro donde sentirse escuchadas. Mi trabajo consiste en acompañar ese proceso integrando cuerpo, mente y emociones para favorecer una vida más consciente, libre y auténtica."`,
        silvia: `LUGAR DE NACIMIENTO: Madrid

TITULACIONES:
Hatha Yoga y Yoga Iyengar por AIPYS. Yoga Center
Terapeuta Ayurveda. COFENAT. Alsandara

SOBRE MÍ:
Soy profesora de Yoga con más de 25 años dedicados a la enseñanza, 30 años de práctica personal y terapeuta Ayurveda. La vida me ha llevado a ayudar a muchas personas de todo el mundo a través de la práctica del Yoga.
Actualmente imparto clases en distintas ciudades de España, entre ellas Córdoba, Granada, Málaga, Valencia, Albacete, Elche y Alicante, así como cursos de formación en Madrid y Canarias.
Imparto cursos de Yoga Terapéutico para profesores y alumnos con amplia experiencia en la práctica del yoga. También he impartido cursos para profesores titulados en India, Grecia e Indonesia.
En los últimos años acompaño a profesores de yoga en mentorías para profundizar en su práctica y pedagogía y acompañarlos en el desarrollo de sus centros de yoga.
Para mí, el Yoga es sutilidad, adaptabilidad, apertura, entrega, aceptación y conciencia.
Tras más de 25 años de enseñanza y 30 de práctica, continúo implicándome al cien por cien en mi trabajo y entregando todo mi amor y dedicación en cada clase.

TE ACOMPAÑO:
Acompaño procesos de bienestar físico, emocional y del sistema nervioso mediante el yoga terapéutico, adaptando la práctica a las necesidades individuales de cada persona.
Dolor de espalda, cervicales y articulaciones
Lesiones musculoesqueléticas y procesos de recuperación funcional
Estrés, ansiedad y agotamiento físico y mental
Alteraciones del sueño e insomnio
Regulación del sistema nervioso
Procesos de duelo, cambios vitales y gestión emocional
Menopausia y salud de la mujer
Fatiga, falta de energía y desequilibrios asociados al estilo de vida
Mejora de la movilidad, la postura y la respiración

ME DEFINE:
"Mi trabajo consiste en crear espacios donde el cuerpo pueda sentirse escuchado, el sistema nervioso regulado y la persona acompañada en su proceso de volver a sí misma a través del yoga y del Ayurveda."`,
        yanira: `TRAYECTORIA:
Procedente de Estados Unidos y con raíces salvadoreñas, he tenido la oportunidad de vivir en distintos lugares del mundo y conocer a personas con trayectorias muy diversas. Cada experiencia y aprendizaje han contribuido a formar la persona que soy hoy.
Docente de profesión, he enseñado durante veinte años en escuelas del área de Washington D. C. Mi formación en yoga es un proceso continuo, pero considero que mi esterilla es mi mejor guía.

TITULACIONES:
Máster en Educación Internacional (Framingham State College)
Máster en Liderazgo en Educación (Universidad George Mason)
Instructora de yoga certificada por Yoga Alliance (formación en Down Dog Yoga, Georgetown, Washington D. C.)
Especializaciones en anatomía aplicada al yoga, yoga infantil, yoga y mindfulness

TE ACOMPAÑO:
Vinyasa Yoga (clases virtuales y presenciales)
Yoga restaurativo y meditación
Mindfulness para adultos y niños`
    });

    const englishProfiles = Object.freeze({
        angel: Object.freeze({
            nombre: 'Ángel Javier',
            especialidad: 'Yoga for Men & Yoga for Everyone | classes',
            descripcion: `PLACE OF BIRTH: La Roda (Albacete)

QUALIFICATIONS:
I base my learning on self-study and practice, as well as classes and intensive courses with highly experienced teachers in anatomy, asana, philosophy and everything needed for my development on the path of yoga. In addition, I am currently undertaking a mentorship toward certification as an Iyengar yoga teacher.

ABOUT ME:
I have 6 years of yoga experience, including 5 and a half years dedicated to studying and practising Iyengar yoga in Valencia and La Roda.

I SUPPORT YOU:
The practice is based on precise adjustment and correct body alignment. I adapt each posture to every student's needs so they can experience the effects and benefits of asana. We work on understanding the actions and feeling what we do; through the depth of this physical work, we open a way of relating to ourselves that reflects the self-knowledge developed through practice.

WHAT DEFINES ME:
"Dedication and care"`
        }),
        miriam: Object.freeze({
            nombre: 'Miriam',
            especialidad: 'Psychotherapy, Nutrition & Workshops | consultations',
            descripcion: `PLACE OF BIRTH: Cuenca (Spain)

QUALIFICATIONS:
Degree in Psychology from the University of Valencia
Master's degree in Eating Disorders from the Complutense University of Madrid
Training in EMDR (Eye Movement Desensitization and Reprocessing)
Training in Brainspotting
Training in Gestalt therapy
Specialist training in trauma, attachment, emotional regulation, gender-based violence, sexual abuse and personal growth
Technician in Dietetics and Nutrition
Advanced technician in Physical Activity and Sports
Technician in Outdoor Physical and Sports Activities
Training in massage therapy and other body-care disciplines

ABOUT ME:
My professional career began in physical activity, sport and the promotion of healthy habits. For years, I worked as a sports instructor, lifeguard and trainer, supporting people of different ages in processes connected with movement, well-being and health.
Over time, I became interested in understanding what is often expressed through the body: emotions, personal difficulties, suffering and transformation. That path led me to study psychology and later specialise in eating disorders, trauma and emotional regulation.
I am the founder of Respira, a psychological support space where I work mainly with adolescents and adults on self-esteem, anxiety, eating disorders, trauma, self-awareness and emotional well-being.
Alongside individual sessions, I lead talks, workshops and group activities, and share mental-health content through social media and the radio programme and podcast "Más allá de la comida". I have also developed community initiatives such as a therapeutic book club and take part in social events, women's gatherings and activities that promote physical, mental and emotional health.

I SUPPORT YOU:
Eating disorders
Relationship with food and body image
Self-esteem and self-confidence
Anxiety and emotional regulation
Trauma and emotional wounds
Life transitions
Grief and loss
Personal growth and self-awareness
Mind-body connection
Holistic well-being and self-care

WHAT DEFINES ME:
"I deeply believe in people's ability to transform when they find a safe space where they feel heard. My work is to support that process by integrating body, mind and emotions, helping each person move toward a more conscious, free and authentic life."`
        }),
        silvia: Object.freeze({
            nombre: 'Silvia',
            especialidad: 'Hatha & Iyengar Yoga, Ayurveda | classes',
            descripcion: `PLACE OF BIRTH: Madrid

QUALIFICATIONS:
Hatha Yoga and Iyengar Yoga through AIPYS. Yoga Center
Ayurveda therapist. COFENAT. Alsandara

ABOUT ME:
I am a yoga teacher with more than 25 years devoted to teaching, 30 years of personal practice and experience as an Ayurveda therapist. Life has led me to help people from around the world through the practice of yoga.
I currently teach in several Spanish cities, including Córdoba, Granada, Málaga, Valencia, Albacete, Elche and Alicante, and lead training courses in Madrid and the Canary Islands.
I teach therapeutic yoga courses for teachers and experienced students. I have also taught qualified teachers in India, Greece and Indonesia.
In recent years, I have mentored yoga teachers to deepen their practice and teaching skills and supported the development of their yoga centres.
For me, yoga is subtlety, adaptability, openness, surrender, acceptance and awareness.
After more than 25 years of teaching and 30 years of practice, I remain fully committed to my work and bring all my care and dedication to every class.

I SUPPORT YOU:
I support physical, emotional and nervous-system well-being through therapeutic yoga, adapting the practice to each person's needs.
Back, neck and joint pain
Musculoskeletal injuries and functional recovery
Stress, anxiety and physical and mental exhaustion
Sleep disorders and insomnia
Nervous-system regulation
Grief, life changes and emotional management
Menopause and women's health
Fatigue, low energy and lifestyle-related imbalances
Improved mobility, posture and breathing

WHAT DEFINES ME:
"My work is to create spaces where the body feels heard, the nervous system can regulate and each person feels supported in the process of returning to themselves through yoga and Ayurveda."`
        }),
        yanira: Object.freeze({
            nombre: 'Yanira',
            especialidad: 'Vinyasa & Restorative Yoga | classes,workshops',
            descripcion: `BACKGROUND:
Originally from the United States and with Salvadoran roots, I have had the opportunity to live in different parts of the world and meet people with very diverse paths. Every experience and lesson has helped shape who I am today.
I am a teacher by profession and taught for twenty years in schools in the Washington, D. C. area. My yoga education is an ongoing process, but I consider my yoga mat my best guide.

QUALIFICATIONS:
Master's degree in International Education (Framingham State College)
Master's degree in Educational Leadership (George Mason University)
Yoga Alliance certified yoga instructor (training at Down Dog Yoga in Georgetown, Washington, D. C.)
Specialist training in yoga anatomy, children's yoga, yoga and mindfulness

I SUPPORT YOU:
Vinyasa Yoga (online and in-person classes)
Restorative yoga and meditation
Mindfulness for adults and children`
        })
    });

    const publicSlugs = Object.freeze({
        angel: 'angel-javier',
        miriam: 'miriam',
        silvia: 'silvia',
        yanira: 'yanira'
    });

    function slugify(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/&/g, ' y ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80)
            .replace(/-+$/g, '');
    }

    function getKey(profile) {
        const identity = `${profile?.nombre || ''} ${profile?.apellidos || ''} ${profile?.email || ''}`.toLowerCase();
        if (identity.includes('yanira')) return 'yanira';
        if (identity.includes('miriam')) return 'miriam';
        if (identity.includes('silvia')) return 'silvia';
        if (identity.includes('ángel') || identity.includes('angel')) return 'angel';
        return '';
    }

    function getSlug(profile) {
        const directKey = typeof profile === 'string'
            && Object.prototype.hasOwnProperty.call(publicSlugs, profile)
            ? profile
            : '';
        const key = directKey || getKey(profile);
        if (key && publicSlugs[key]) return publicSlugs[key];

        const numericId = Number(profile?.id);
        if (Number.isSafeInteger(numericId) && numericId > 0) {
            return `profesor-${numericId}`;
        }

        const nameSlug = slugify(`${profile?.nombre || ''} ${profile?.apellidos || ''}`);
        return nameSlug ? `profesor-${nameSlug}` : '';
    }

    function getEnglishProfile(profile) {
        return englishProfiles[getKey(profile)] || null;
    }

    function repairLegacyDescription(profile) {
        if (!profile) return profile;

        const key = getKey(profile);
        const original = String(profile.descripcion || profile.bio || '');
        const originalSpecialty = String(profile.especialidad || '');
        if (!original && !originalSpecialty) return profile;

        let corrected = original.replace(/\r\n/g, '\n');
        let correctedSpecialty = originalSpecialty;

        if (key === 'angel') {
            if (/(TITULACIONES:\s*)Ninguna\./i.test(corrected)) {
                corrected = descriptions.angel;
            }
            corrected = corrected
                .replace(
                    /(LUGAR DE NACIMIENTO:\s*)La Roda(?!\s*\(Albacete\))/i,
                    '$1La Roda (Albacete)'
                )
                .replace(/(TITULACIONES:\s*)Ninguna\.\s*/i, '$1')
                .replace(
                    /En septiembre comienzo la mentoría para la certificación como profesor de yoga Iyengar\./i,
                    'Además, estoy cursando una mentoría para la certificación como profesor de yoga Iyengar.'
                );
            correctedSpecialty = correctedSpecialty.replace(
                /Yoga terap[eé]utico/gi,
                'Yoga para Todos'
            );
        }

        if (key === 'silvia') {
            if (
                /sistema nervous/i.test(corrected)
                || /[Pp]ráctica personal\s+Y\s+[Tt]erapeuta Ayurveda/.test(corrected)
            ) {
                corrected = descriptions.silvia;
            }
            corrected = corrected
                .replace(/(LUGAR DE NACIMIENTO:\s*Madrid),/i, '$1')
                .replace(/Aipys\.\s*Yoga Center\./gi, 'AIPYS Yoga Center')
                .replace(
                    /Terapeuta Ayurveda\.\s*Cofenat\.\s*Alsandara\s*\./gi,
                    'Terapeuta de Ayurveda por COFENAT y Alsándara'
                )
                .replace(
                    /[Pp]ráctica personal\s+Y\s+[Tt]erapeuta Ayurveda\s*\./,
                    'práctica personal y terapeuta de Ayurveda.'
                )
                .replace(/\bsistema nervous\b/gi, 'sistema nervioso')
                .replace(/\bventorías\b/gi, 'mentorías')
                .replace(/\bPara mi,/g, 'Para mí,')
                .replace(/^\s*[*•]\s*/gm, '')
                .replace(/[ \t]+([,.;:])/g, '$1');
        }

        if (key === 'miriam' && /Eye Movement Desensitization and Reprocessing|\*\s*Trastornos de la Conducta Alimentaria/i.test(corrected)) {
            corrected = descriptions.miriam;
        }

        if (
            key === 'yanira'
            && (
                /Profesora de Yoga especializada en Vinyasa/i.test(corrected)
                || /\byoga mat\b/i.test(corrected)
            )
        ) {
            corrected = descriptions.yanira;
        }

        if (corrected === original && correctedSpecialty === originalSpecialty) return profile;
        return {
            ...profile,
            ...(original ? { descripcion: corrected } : {}),
            ...(profile.bio ? { bio: corrected } : {}),
            ...(originalSpecialty ? { especialidad: correctedSpecialty } : {})
        };
    }

    const api = Object.freeze({
        descriptions,
        publicSlugs,
        slugify,
        getKey,
        getSlug,
        getEnglishProfile,
        repairLegacyDescription
    });

    root.GENTeacherProfiles = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
