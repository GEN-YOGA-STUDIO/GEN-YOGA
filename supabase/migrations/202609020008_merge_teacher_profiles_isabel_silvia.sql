-- ============================================================================
-- Migration 202609020008: Merge Duplicate Teacher Profiles for Isabel and Silvia
-- ============================================================================
-- Canonical Base Profiles:
--   1. Isabel: isarodriguez.pni@gmail.com (PNI, Psicología, Nutrición)
--   2. Silvia: sil-hada@hotmail.com (Hatha & Iyengar Yoga, Ayurveda, Nutrición)
--   3. Miriam: miriam@respirapsicologia.es (Psicología, Nutrición, Talleres)
--   4. Ángel Javier: angel@genyoga.es (Yoga para hombres & Yoga para Todos)
--   5. Yanira: yanira@genyoga.es (Vinyasa & Restaurativa)
-- ============================================================================

begin;

-- 1. Consolidar registro canonical de ISABEL (isarodriguez.pni@gmail.com)
insert into public.profesionales (
  nombre,
  apellidos,
  email,
  especialidad,
  descripcion,
  foto_url,
  color,
  visible_publico
) values (
  'Isabel',
  'Rodríguez',
  'isarodriguez.pni@gmail.com',
  'Psiconeuroinmunología Clínica (PNI) | consultas, psicologia, nutricion',
  'LUGAR DE NACIMIENTO: Albacete (España)

TITULACIONES:
Especialista en Psiconeuroinmunología Clínica (PNI)
Grado en Nutrición Humana y Dietética
Formación en Salud Digestiva, Microbiota e Inmunonutrición
Especialización en Regulación Hormonal y Estrés Crónico

SOBRE MÍ:
Acompaño a las personas hacia el equilibrio integral de su organismo a través de la nutrición clínica, la modulación del estilo de vida y la gestión del estrés, integrando el conocimiento científico con una mirada cercana, humana y personalizada.
La Psiconeuroinmunología Clínica nos permite entender cómo interactúan la mente, el sistema nervioso, el sistema inmunitario y el sistema endocrino, abordando el origen profundo de los desequilibrios para recuperar la vitalidad y el bienestar.

TE ACOMPAÑO:
Optimización del sistema inmunitario
Salud digestiva y microbiota
Regulación metabólica y hormonal
Gestión del estrés y la inflamación crónica
Mejora de la composición corporal y hábitos de vida saludables

ME DEFINE:
"Comprender el cuerpo como un todo interconectado es la clave para acompañar a cada persona a recuperar su equilibrio y bienestar duradero."',
  null,
  '#8f6b2d',
  true
)
on conflict (email) do update
set
  nombre = excluded.nombre,
  apellidos = coalesce(nullif(excluded.apellidos, ''), public.profesionales.apellidos),
  especialidad = excluded.especialidad,
  descripcion = excluded.descripcion,
  color = excluded.color,
  visible_publico = true;

-- Reasignar clases y eliminar duplicados de Isabel en public.profesionales
do $$
declare
  v_canon_isabel_id bigint;
  v_dup_id bigint;
  v_canon_user_id uuid;
  v_dup_user_id uuid;
begin
  select id into v_canon_isabel_id
  from public.profesionales
  where lower(trim(email)) = 'isarodriguez.pni@gmail.com';

  for v_dup_id in
    select id from public.profesionales
    where lower(trim(email)) in ('isabel@genyoga.es', 'isabel_profesora@genyoga.studio')
      and id <> v_canon_isabel_id
  loop
    update public.clases set profesor_id = v_canon_isabel_id where profesor_id = v_dup_id;
    delete from public.profesionales where id = v_dup_id;
  end loop;

  -- Fusionar public.profiles si existe duplicado de Isabel
  select id into v_canon_user_id from public.profiles where lower(trim(email)) = 'isarodriguez.pni@gmail.com';
  if v_canon_user_id is not null then
    update public.profiles
    set rol = 'profesor',
        nombre = coalesce(nullif(trim(nombre), ''), 'Isabel')
    where id = v_canon_user_id;

    for v_dup_user_id in
      select id from public.profiles
      where lower(trim(email)) in ('isabel@genyoga.es', 'isabel_profesora@genyoga.studio')
        and id <> v_canon_user_id
    loop
      update public.reservas_yoga set user_id = v_canon_user_id where user_id = v_dup_user_id;
      delete from public.profiles where id = v_dup_user_id;
    end loop;
  end if;
end $$;


-- 2. Consolidar registro canonical de SILVIA (sil-hada@hotmail.com)
insert into public.profesionales (
  nombre,
  apellidos,
  email,
  especialidad,
  descripcion,
  foto_url,
  color,
  visible_publico
) values (
  'Silvia',
  'Jaen Díaz',
  'sil-hada@hotmail.com',
  'Hatha & Iyengar Yoga, Ayurveda | clases, consultas, nutricion',
  'LUGAR DE NACIMIENTO: Madrid

TITULACIONES:
Hatha Yoga y Yoga Iyengar por AIPYS. Yoga Center
Terapeuta Ayurveda. COFENAT. Alsandara

SOBRE SILVIA:
Es profesora de Yoga con más de 25 años dedicados a la enseñanza, 30 años de práctica personal y terapeuta Ayurveda. La vida la ha llevado a ayudar a muchas personas de todo el mundo a través de la práctica del Yoga.
Actualmente imparte clases en distintas ciudades de España, entre ellas Córdoba, Granada, Málaga, Valencia, Albacete, Elche y Alicante, así como cursos de formación en Madrid y Canarias.
Imparte cursos de Yoga Terapéutico para profesores y alumnos con amplia experiencia en la práctica del yoga. También ha impartido cursos para profesores titulados en India, Grecia e Indonesia.
En los últimos años acompaña a profesores de yoga en mentorías para profundizar en su práctica y pedagogía y acompañarlos en el desarrollo de sus centros de yoga.
Para ella, el Yoga es sutilidad, adaptabilidad, apertura, entrega, aceptación y conciencia.
Tras más de 25 años de enseñanza y 30 de práctica, continúa implicándose al cien por cien en su trabajo y entregando todo su amor y dedicación en cada clase.

YOGA & AYURVEDA:
Clases en las que el Yoga y el Ayurveda se integran para ofrecer una práctica precisa, consciente y adaptada a cada persona según sus necesidades.
A través de las asanas, el pranayama (respiración) y la observación, enseña a conocer el cuerpo, aquietar la mente y cultivar un equilibrio profundo que favorece la salud, la vitalidad y el bienestar físico, mental y emocional.

CONSULTAS AYURVEDA:
La Consulta de Ayurveda es un espacio abierto para quienes buscan armonizar su vida a través de la alimentación consciente, rutinas saludables y remedios naturales. Acompaña a cada persona en un viaje de regreso a su esencia, ayudándole a redescubrir su bienestar desde una mirada holística y profunda.
A través de la escucha profunda, la observación del cuerpo y el entendimiento de los doshas, identifica los desequilibrios que bloquean el flujo natural de la energía vital. Desde ahí, ofrece recomendaciones sutiles y conscientes (como alimentación, rutinas, hierbas y hábitos) para armonizar cuerpo, mente y alma. Su propósito es guiar con amor y presencia hacia una vida más plena y conectada con la sabiduría interior. Además, incluye una sesión de Yoga personalizada para experimentar un bienestar profundo.

TE ACOMPAÑA EN:
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
"Su trabajo consiste en crear espacios donde el cuerpo pueda sentirse escuchado, el sistema nervioso regulado y la persona acompañada en su proceso de volver a sí misma a través del yoga y del Ayurveda."',
  null,
  '#68704a',
  true
)
on conflict (email) do update
set
  nombre = excluded.nombre,
  apellidos = coalesce(nullif(excluded.apellidos, ''), public.profesionales.apellidos),
  especialidad = excluded.especialidad,
  descripcion = excluded.descripcion,
  color = excluded.color,
  visible_publico = true;

-- Reasignar clases y eliminar duplicados de Silvia en public.profesionales
do $$
declare
  v_canon_silvia_id bigint;
  v_dup_id bigint;
  v_canon_user_id uuid;
  v_dup_user_id uuid;
begin
  select id into v_canon_silvia_id
  from public.profesionales
  where lower(trim(email)) = 'sil-hada@hotmail.com';

  for v_dup_id in
    select id from public.profesionales
    where lower(trim(email)) in ('silvia@genyoga.es', 'silvia_profesora@genyoga.studio')
      and id <> v_canon_silvia_id
  loop
    update public.clases set profesor_id = v_canon_silvia_id where profesor_id = v_dup_id;
    delete from public.profesionales where id = v_dup_id;
  end loop;

  -- Fusionar public.profiles si existe duplicado de Silvia
  select id into v_canon_user_id from public.profiles where lower(trim(email)) = 'sil-hada@hotmail.com';
  if v_canon_user_id is not null then
    update public.profiles
    set rol = 'profesor',
        nombre = coalesce(nullif(trim(nombre), ''), 'Silvia'),
        apellidos = coalesce(nullif(trim(apellidos), ''), 'Jaen Díaz')
    where id = v_canon_user_id;

    for v_dup_user_id in
      select id from public.profiles
      where lower(trim(email)) in ('silvia@genyoga.es', 'silvia_profesora@genyoga.studio')
        and id <> v_canon_user_id
    loop
      update public.reservas_yoga set user_id = v_canon_user_id where user_id = v_dup_user_id;
      delete from public.profiles where id = v_dup_user_id;
    end loop;
  end if;
end $$;


-- 3. Estandarización de los restantes 3 perfiles
-- Miriam
update public.profesionales
set especialidad = 'Psicoterapia, Nutrición y Talleres | consultas, psicologia, nutricion, talleres'
where lower(trim(email)) in ('miriam@respirapsicologia.es', 'miriam_profesora@genyoga.studio')
   or lower(trim(nombre)) like '%miriam%';

-- Ángel Javier (solo yoga/clases)
update public.profesionales
set especialidad = 'Yoga para hombres & Yoga para Todos | clases'
where lower(trim(email)) in ('angel@genyoga.es', 'angel_profesor@genyoga.studio')
   or lower(trim(nombre)) like '%angel%'
   or lower(trim(nombre)) like '%ángel%';

-- Yanira (solo yoga/clases y talleres)
update public.profesionales
set especialidad = 'Vinyasa & Restaurativa | clases, talleres'
where lower(trim(email)) in ('yanira@genyoga.es')
   or lower(trim(nombre)) like '%yanira%';

notify pgrst, 'reload schema';

commit;
