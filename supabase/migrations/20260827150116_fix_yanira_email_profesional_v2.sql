-- ==============================================================================
-- Hotfix: Alineación del email profesional de Yanira Umana con su usuario
-- Email correcto usuario:  yaniumana35@gmail.com  (una sola Y)
-- Email en profesionales:  yaniumana35@gmail.com   (una sola Y)
-- Fecha: 2026-08-27
-- ==============================================================================

DO $$
DECLARE
  v_user_id uuid;
  v_prof_id bigint;
BEGIN
  -- 1. Localizar el usuario real por su email correcto
  SELECT id INTO v_user_id
    FROM public.profiles
   WHERE lower(trim(email)) = 'yaniumana35@gmail.com';

  IF v_user_id IS NOT NULL THEN
      -- Asegurar que el perfil tiene rol de profesor por si acaso
      UPDATE public.profiles
         SET rol = COALESCE(NULLIF(trim(rol), ''), 'profesor'),
             nombre = COALESCE(NULLIF(trim(nombre), ''), 'Yanira'),
             apellidos = COALESCE(NULLIF(trim(apellidos), ''), 'Umana')
       WHERE id = v_user_id;
  END IF;

  -- 2. Localizar la ficha de Yanira en profesionales (por email antiguo o por nombre)
  SELECT id INTO v_prof_id
    FROM public.profesionales
   WHERE lower(trim(email)) = 'yaniumana35@gmail.com'
      OR lower(trim(email)) = 'yyaniumana35@gmail.com'
      OR (translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%'
          AND lower(coalesce(apellidos, '')) LIKE '%umana%')
   ORDER BY id ASC
   LIMIT 1;

  IF v_prof_id IS NOT NULL THEN
      -- Actualizar el email al CORRECTO (una sola Y) y asegurar visibilidad y datos
      UPDATE public.profesionales
         SET email              = 'yaniumana35@gmail.com',
             nombre             = COALESCE(NULLIF(trim(nombre), ''), 'Yanira'),
             apellidos          = COALESCE(NULLIF(trim(apellidos), ''), 'Umana'),
             color              = COALESCE(NULLIF(trim(color), ''), '#df7fa5'),
             visible_publico    = COALESCE(visible_publico, true),
             especialidad       = COALESCE(NULLIF(trim(especialidad), ''), 'Power Vinyasa, Yoga Restaurativo | yoga')
       WHERE id = v_prof_id;

      -- 3. Reasignar cualquier clase de Yanira que aún no apunte a su id profesional canónico
      --    (por nombre de clase si profesor_id es NULL o apuntaba a otro)
      UPDATE public.clases
         SET profesor_id = v_prof_id
       WHERE profesor_id IS DISTINCT FROM v_prof_id
         AND (
           translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%'
           OR (
             (lower(nombre) LIKE '%power vinyasa%' OR (lower(nombre) LIKE '%restaurativo%' AND lower(nombre) NOT LIKE '%silvia%'))
             AND (profesor_id IS NULL OR profesor_id = v_prof_id)
           )
         );

      -- 4. Consolidar profesionales duplicados de Yanira (si quedara alguno)
      --    Eliminar emails antiguos tipo yaniumana... que ya no son el canónico
      UPDATE public.clases
         SET profesor_id = v_prof_id
       WHERE profesor_id IN (
                 SELECT id FROM public.profesionales
                  WHERE id <> v_prof_id
                    AND (  lower(trim(email)) LIKE '%yaniumana%'
                        OR translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%')
             );

      DELETE FROM public.grupos_profesionales
       WHERE profesional_id IN (
                 SELECT id FROM public.profesionales
                  WHERE id <> v_prof_id
                    AND (  lower(trim(email)) LIKE '%yaniumana%'
                        OR translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%')
             );

      DELETE FROM public.profesionales
       WHERE id <> v_prof_id
         AND (  lower(trim(email)) LIKE '%yaniumana%'
             OR translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%');
  ELSE
      -- Si no existiera ficha profesional, crearla con el email correcto
      INSERT INTO public.profesionales (nombre, apellidos, email, color, especialidad, visible_publico)
      VALUES ('Yanira', 'Umana', 'yaniumana35@gmail.com', '#df7fa5', 'Power Vinyasa, Yoga Restaurativo | yoga', true)
      RETURNING id INTO v_prof_id;
  END IF;

END $$;