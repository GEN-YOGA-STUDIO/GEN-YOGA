-- ==============================================================================
-- Migración: Fusión limpia de cuentas para Yanira Umaña (yaniumana35@gmail.com)
-- Fecha: 2026-09-02
-- ==============================================================================

DO $$
DECLARE
  v_new_user_id uuid;
  v_old_user_id uuid;
  v_canonical_prof_id bigint;
  v_old_prof_id bigint;
  r RECORD;
BEGIN
  -- 1. Obtener el ID del nuevo usuario (bueno): yaniumana35@gmail.com
  SELECT id INTO v_new_user_id
    FROM public.profiles
   WHERE lower(trim(email)) = 'yaniumana35@gmail.com';

  IF v_new_user_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el usuario con email yaniumana35@gmail.com. Asegúrate de que se haya registrado en la web/app.';
  END IF;

  -- Actualizar perfil de Yanira con su rol de profesora y nombre
  UPDATE public.profiles
     SET rol = 'profesor',
         nombre = 'Yanira',
         apellidos = 'Umana'
   WHERE id = v_new_user_id;

  -- 2. Buscar si existe un usuario antiguo/genérico de Yanira en profiles
  SELECT id INTO v_old_user_id
    FROM public.profiles
   WHERE (lower(trim(email)) LIKE '%yanira%' OR lower(trim(nombre)) LIKE '%yanira%')
     AND id <> v_new_user_id
     AND rol IN ('profesor', 'trabajador', 'profesional')
   ORDER BY created_at ASC
   LIMIT 1;

  -- 3. Localizar o consolidar la ficha canónica en la tabla 'profesionales'
  SELECT id INTO v_canonical_prof_id
    FROM public.profesionales
   WHERE lower(trim(email)) = 'yaniumana35@gmail.com'
   LIMIT 1;

  IF v_canonical_prof_id IS NULL THEN
    SELECT id INTO v_canonical_prof_id
      FROM public.profesionales
     WHERE translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%'
     ORDER BY id ASC
     LIMIT 1;
  END IF;

  IF v_canonical_prof_id IS NULL THEN
    INSERT INTO public.profesionales (nombre, apellidos, email, color, especialidad, visible_publico)
    VALUES ('Yanira', 'Umana', 'yaniumana35@gmail.com', '#df7fa5', 'Power Vinyasa, Yoga Restaurativo | yoga', true)
    RETURNING id INTO v_canonical_prof_id;
  ELSE
    UPDATE public.profesionales
       SET nombre = 'Yanira',
           apellidos = 'Umana',
           email = 'yaniumana35@gmail.com',
           color = coalesce(nullif(trim(color), ''), '#df7fa5'),
           visible_publico = true
     WHERE id = v_canonical_prof_id;
  END IF;

  -- 4. Reasignar cualquier otra ficha duplicada de 'profesionales' de Yanira a la ficha canónica
  FOR r IN (
    SELECT id FROM public.profesionales
     WHERE (translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%' OR lower(trim(email)) LIKE '%yanira%')
       AND id <> v_canonical_prof_id
  ) LOOP
    v_old_prof_id := r.id;

    UPDATE public.clases
       SET profesor_id = v_canonical_prof_id
     WHERE profesor_id = v_old_prof_id;

    UPDATE public.grupos_profesionales
       SET profesional_id = v_canonical_prof_id
     WHERE profesional_id = v_old_prof_id
       AND alumno_id NOT IN (
         SELECT alumno_id FROM public.grupos_profesionales WHERE profesional_id = v_canonical_prof_id
       );

    DELETE FROM public.grupos_profesionales WHERE profesional_id = v_old_prof_id;

    DELETE FROM public.profesionales WHERE id = v_old_prof_id;
  END LOOP;

  -- 5. Asegurar que todas las clases de Yanira apunten a su ID profesional
  UPDATE public.clases
     SET profesor_id = v_canonical_prof_id
   WHERE (
     lower(nombre) LIKE '%power vinyasa%'
     OR (lower(nombre) LIKE '%restaurativo%' AND lower(nombre) NOT LIKE '%silvia%')
   )
   AND (profesor_id IS NULL OR profesor_id = v_canonical_prof_id);

  -- 6. Si existía un usuario antiguo en 'profiles', migrar sus datos y eliminarlo limpiamente
  IF v_old_user_id IS NOT NULL THEN
    UPDATE public.reservas_yoga
       SET user_id = v_new_user_id
     WHERE user_id = v_old_user_id
       AND NOT EXISTS (
         SELECT 1 FROM public.reservas_yoga WHERE user_id = v_new_user_id AND clase_id = reservas_yoga.clase_id
       );
    DELETE FROM public.reservas_yoga WHERE user_id = v_old_user_id;

    UPDATE public.reservas_psicologia SET user_id = v_new_user_id WHERE user_id = v_old_user_id;
    UPDATE public.reservas_nutricion SET user_id = v_new_user_id WHERE user_id = v_old_user_id;

    UPDATE public.class_credit_packs SET user_id = v_new_user_id WHERE user_id = v_old_user_id;
    UPDATE public.unlimited_membership_periods SET user_id = v_new_user_id WHERE user_id = v_old_user_id;

    DELETE FROM public.profiles WHERE id = v_old_user_id;

    BEGIN
      DELETE FROM auth.users WHERE id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

END $$;
