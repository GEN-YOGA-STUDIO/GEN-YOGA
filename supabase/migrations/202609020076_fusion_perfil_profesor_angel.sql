-- ==============================================================================
-- Migración 202609020076: Fusión de Cuentas y Perfil Oficial de Ángel Javier Bueno Galindo
-- Email canónico de usuario y profesional: angeljavier.yoga@gmail.com
-- Ficha canónica en public.profesionales: ID 13
-- ==============================================================================

DO $$
DECLARE
  v_new_user_id uuid;
  v_old_user_id uuid;
  v_canonical_prof_id bigint;
  v_old_prof_id bigint;
  r RECORD;
BEGIN
  -- 1. Localizar el usuario registrado (bueno) con email: angeljavier.yoga@gmail.com
  SELECT id INTO v_new_user_id
    FROM public.profiles
   WHERE lower(trim(email)) = 'angeljavier.yoga@gmail.com'
   LIMIT 1;

  -- Si por algún motivo aún no estuviera en public.profiles pero sí en auth.users, sincronizarlo
  IF v_new_user_id IS NULL THEN
    SELECT id INTO v_new_user_id
      FROM auth.users
     WHERE lower(trim(email)) = 'angeljavier.yoga@gmail.com'
     LIMIT 1;

    IF v_new_user_id IS NOT NULL THEN
      INSERT INTO public.profiles (id, email, nombre, apellidos, rol)
      VALUES (v_new_user_id, 'angeljavier.yoga@gmail.com', 'Ángel Javier', 'Bueno Galindo', 'profesor')
      ON CONFLICT (id) DO UPDATE
      SET rol = 'profesor',
          nombre = 'Ángel Javier',
          apellidos = 'Bueno Galindo';
    ELSE
      RAISE EXCEPTION 'No se encontró el usuario con email angeljavier.yoga@gmail.com en la base de datos. Verifica que el usuario se haya registrado.';
    END IF;
  END IF;

  -- 2. Asegurar que el usuario oficial tiene rol de 'profesor' y nombres completos
  UPDATE public.profiles
     SET rol = 'profesor',
         nombre = COALESCE(NULLIF(trim(nombre), ''), 'Ángel Javier'),
         apellidos = COALESCE(NULLIF(trim(apellidos), ''), 'Bueno Galindo')
   WHERE id = v_new_user_id;

  -- 3. Localizar y consolidar la ficha canónica de Ángel en public.profesionales (ID 13)
  SELECT id INTO v_canonical_prof_id
    FROM public.profesionales
   WHERE id = 13;

  IF v_canonical_prof_id IS NULL THEN
    SELECT id INTO v_canonical_prof_id
      FROM public.profesionales
     WHERE lower(trim(email)) IN ('angeljavier.yoga@gmail.com', 'angel_profesor@genyoga.studio', 'angel@genyoga.es')
        OR translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%angel%'
     ORDER BY id ASC
     LIMIT 1;
  END IF;

  IF v_canonical_prof_id IS NULL THEN
    INSERT INTO public.profesionales (
      nombre,
      apellidos,
      email,
      especialidad,
      descripcion,
      foto_url,
      color,
      visible_publico
    ) VALUES (
      'Ángel Javier',
      'Bueno Galindo',
      'angeljavier.yoga@gmail.com',
      'Yoga para hombres & Yoga para Todos | clases',
      $angel$LUGAR DE NACIMIENTO: La Roda (Albacete)

TITULACIONES:
Baso mi aprendizaje en el autoestudio y la práctica, en recibir clases e intensivos de profesores con larga trayectoria —anatomía, asana, filosofía y todo lo necesario para mi desarrollo en el camino del yoga—. Además, estoy cursando una mentoría para la certificación como profesor de yoga Iyengar.

SOBRE MÍ:
Cuento con 6 años de experiencia en la práctica del yoga, de los cuales 5 años y medio están dedicados a estudiar y practicar yoga Iyengar en Valencia y La Roda.

TE ACOMPAÑO:
La práctica se basa en el ajuste preciso y la correcta alineación del cuerpo. Adapto la postura a las condiciones de cada alumno o alumna para encontrar los efectos y beneficios del asana. Trabajamos en la comprensión de las acciones y en sentir lo que hacemos; desde la profundidad de ese trabajo físico, abrimos la posibilidad de relacionarnos de una manera acorde con el conocimiento propio que surge con la práctica.

ME DEFINE:
"Dedicación y cuidado"$angel$,
      'img/maestro-angel-recortado.webp',
      '#7f9fc0',
      true
    )
    RETURNING id INTO v_canonical_prof_id;
  ELSE
    UPDATE public.profesionales
       SET nombre = 'Ángel Javier',
           apellidos = 'Bueno Galindo',
           email = 'angeljavier.yoga@gmail.com',
           especialidad = 'Yoga para hombres & Yoga para Todos | clases',
           descripcion = $angel$LUGAR DE NACIMIENTO: La Roda (Albacete)

TITULACIONES:
Baso mi aprendizaje en el autoestudio y la práctica, en recibir clases e intensivos de profesores con larga trayectoria —anatomía, asana, filosofía y todo lo necesario para mi desarrollo en el camino del yoga—. Además, estoy cursando una mentoría para la certificación como profesor de yoga Iyengar.

SOBRE MÍ:
Cuento con 6 años de experiencia en la práctica del yoga, de los cuales 5 años y medio están dedicados a estudiar y practicar yoga Iyengar en Valencia y La Roda.

TE ACOMPAÑO:
La práctica se basa en el ajuste preciso y la correcta alineación del cuerpo. Adapto la postura a las condiciones de cada alumno o alumna para encontrar los efectos y beneficios del asana. Trabajamos en la comprensión de las acciones y en sentir lo que hacemos; desde la profundidad de ese trabajo físico, abrimos la posibilidad de relacionarnos de una manera acorde con el conocimiento propio que surge con la práctica.

ME DEFINE:
"Dedicación y cuidado"$angel$,
           color = COALESCE(NULLIF(trim(color), ''), '#7f9fc0'),
           foto_url = COALESCE(NULLIF(trim(foto_url), ''), 'img/maestro-angel-recortado.webp'),
           visible_publico = true
     WHERE id = v_canonical_prof_id;
  END IF;

  -- 4. Reasignar cualquier otra ficha duplicada de 'profesionales' de Ángel a la ficha canónica (ID 13)
  FOR r IN (
    SELECT id FROM public.profesionales
     WHERE (
       lower(trim(email)) IN ('angel_profesor@genyoga.studio', 'angel@genyoga.es', 'angel_profesor@genyoga.es')
       OR (translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%angel%' AND id <> v_canonical_prof_id)
     )
     AND id <> v_canonical_prof_id
  ) LOOP
    v_old_prof_id := r.id;

    -- Reasignar clases
    UPDATE public.clases
       SET profesor_id = v_canonical_prof_id
     WHERE profesor_id = v_old_prof_id;

    -- Reasignar alumnos en grupos_profesionales
    UPDATE public.grupos_profesionales
       SET profesional_id = v_canonical_prof_id
     WHERE profesional_id = v_old_prof_id
       AND alumno_id NOT IN (
         SELECT alumno_id FROM public.grupos_profesionales WHERE profesional_id = v_canonical_prof_id
       );

    DELETE FROM public.grupos_profesionales WHERE profesional_id = v_old_prof_id;

    DELETE FROM public.profesionales WHERE id = v_old_prof_id;
  END LOOP;

  -- 5. Asegurar que todas las clases de Yoga para Hombres y Yoga para Todos apunten al profesional de Ángel
  UPDATE public.clases
     SET profesor_id = v_canonical_prof_id
   WHERE (
     lower(trim(nombre)) LIKE '%yoga para hombres%'
     OR (lower(trim(nombre)) LIKE '%yoga para todos%' AND (profesor_id IS NULL OR profesor_id = v_canonical_prof_id))
     OR (lower(trim(nombre)) LIKE '%sesión introductoria%' AND fecha_inicio::date = '2026-08-30' AND (profesor_id IS NULL OR profesor_id = v_canonical_prof_id))
   )
   AND (profesor_id IS NULL OR profesor_id = v_canonical_prof_id);

  -- 6. Buscar si existía un usuario antiguo/dummy en 'profiles' para Ángel y fusionar datos
  FOR r IN (
    SELECT id, email FROM public.profiles
     WHERE (
       lower(trim(email)) IN ('angel_profesor@genyoga.studio', 'angel@genyoga.es', 'angel_profesor@genyoga.es')
       OR (lower(trim(email)) LIKE '%angel%' AND rol IN ('profesor', 'trabajador', 'profesional'))
     )
     AND id <> v_new_user_id
  ) LOOP
    v_old_user_id := r.id;

    -- Traspasar teléfono o fecha_nacimiento si el nuevo no los tuviera
    UPDATE public.profiles p_new
       SET telefono = COALESCE(NULLIF(trim(p_new.telefono), ''), p_old.telefono),
           fecha_nacimiento = COALESCE(p_new.fecha_nacimiento, p_old.fecha_nacimiento)
      FROM public.profiles p_old
     WHERE p_new.id = v_new_user_id
       AND p_old.id = v_old_user_id;

    -- Traspasar reservas
    UPDATE public.reservas_yoga
       SET user_id = v_new_user_id
     WHERE user_id = v_old_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.reservas_yoga ry WHERE ry.user_id = v_new_user_id AND ry.clase_id = reservas_yoga.clase_id
       );
    DELETE FROM public.reservas_yoga WHERE user_id = v_old_user_id;

    UPDATE public.reservas_psicologia SET user_id = v_new_user_id WHERE user_id = v_old_user_id;
    UPDATE public.reservas_nutricion SET user_id = v_new_user_id WHERE user_id = v_old_user_id;

    -- Traspasar saldo y packs
    UPDATE public.class_credit_packs SET user_id = v_new_user_id WHERE user_id = v_old_user_id;
    UPDATE public.unlimited_membership_periods SET user_id = v_new_user_id WHERE user_id = v_old_user_id;

    -- Traspasar posibles asignaciones de alumno
    UPDATE public.grupos_profesionales
       SET alumno_id = v_new_user_id
     WHERE alumno_id = v_old_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.grupos_profesionales gp WHERE gp.alumno_id = v_new_user_id AND gp.profesional_id = grupos_profesionales.profesional_id
       );
    DELETE FROM public.grupos_profesionales WHERE alumno_id = v_old_user_id;

    -- Eliminar perfil antiguo duplicado
    DELETE FROM public.profiles WHERE id = v_old_user_id;

    BEGIN
      DELETE FROM auth.users WHERE id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  RAISE NOTICE 'Fusión completada con éxito. Usuario Ángel: %, Profesional ID: %', v_new_user_id, v_canonical_prof_id;
END $$;

NOTIFY pgrst, 'reload schema';
