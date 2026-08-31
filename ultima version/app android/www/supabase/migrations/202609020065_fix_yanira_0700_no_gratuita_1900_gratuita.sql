-- ==============================================================================
-- Migración 202609020065: Corregir sesiones gratuitas y regulares de Yanira
-- - Las clases matutinas (07:00 / 08:00 / 09:30) son regulares de pago (es_gratuita = false)
-- - Las sesiones gratuitas de Yanira son las de tarde:
--     * Martes 1 de Septiembre de 19:00 a 20:15 (es_gratuita = true)
--     * Jueves 3 de Septiembre de 19:00 a 20:15 (es_gratuita = true)
-- ==============================================================================

DO $$
DECLARE
  v_yanira_id bigint;
  v_count_morning integer := 0;
  v_count_tue19 integer := 0;
  v_count_thu19 integer := 0;
BEGIN
  -- 1. Obtener ID de Yanira
  SELECT id INTO v_yanira_id
    FROM public.profesionales
   WHERE translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%'
      OR lower(trim(email)) = 'yaniumana35@gmail.com'
      OR lower(trim(email)) LIKE '%yanira%'
   ORDER BY id ASC
   LIMIT 1;

  IF v_yanira_id IS NULL THEN
    RAISE NOTICE 'No se encontró a la profesora Yanira en la tabla profesionales.';
    RETURN;
  END IF;

  -- 2. Asegurar que las clases matutinas de Yanira (07:00 - 12:00) NO sean gratuitas
  WITH updated_morning AS (
    UPDATE public.clases
       SET es_gratuita = false,
           companion_modality = null,
           nombre = CASE
             WHEN lower(nombre) LIKE '%restaurativo%' THEN 'Yoga Restaurativo'
             ELSE 'Power Vinyasa'
           END
     WHERE profesor_id = v_yanira_id
       AND EXTRACT(HOUR FROM fecha_inicio AT TIME ZONE 'Europe/Madrid') < 14
       AND (
         (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = '2026-09-01'
         OR (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = '2026-09-03'
         OR EXTRACT(HOUR FROM fecha_inicio AT TIME ZONE 'Europe/Madrid') = 7
       )
     RETURNING id
  )
  SELECT count(*) INTO v_count_morning FROM updated_morning;

  RAISE NOTICE '✅ Se actualizaron % clases matutinas de Yanira a es_gratuita = false.', v_count_morning;

  -- 3. Asegurar sesión gratuita del Martes 1 de Septiembre (19:00 - 20:15)
  WITH updated_tue AS (
    UPDATE public.clases
       SET es_gratuita = true,
           duracion_minutos = 75,
           fecha_fin = '2026-09-01 20:15:00+02'::timestamptz,
           capacidad_max = 10,
           activa = true,
           nombre = 'Power Vinyasa Clase Abierta'
     WHERE profesor_id = v_yanira_id
       AND (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = '2026-09-01'
       AND EXTRACT(HOUR FROM fecha_inicio AT TIME ZONE 'Europe/Madrid') >= 18
       AND EXTRACT(HOUR FROM fecha_inicio AT TIME ZONE 'Europe/Madrid') <= 20
     RETURNING id
  )
  SELECT count(*) INTO v_count_tue19 FROM updated_tue;

  IF v_count_tue19 = 0 THEN
    INSERT INTO public.clases (
      nombre,
      fecha_inicio,
      fecha_fin,
      duracion_minutos,
      capacidad_max,
      profesor_id,
      tipo_clase,
      activa,
      es_gratuita
    ) VALUES (
      'Power Vinyasa Clase Abierta',
      '2026-09-01 19:00:00+02'::timestamptz,
      '2026-09-01 20:15:00+02'::timestamptz,
      75,
      10,
      v_yanira_id,
      'yoga',
      true,
      true
    );
    RAISE NOTICE '✅ Se insertó la sesión gratuita de Yanira del Martes 1 de Septiembre 19:00 - 20:15.';
  ELSE
    RAISE NOTICE '✅ Se actualizó la sesión de tarde de Yanira del Martes 1 de Septiembre a gratuita (19:00 - 20:15).';
  END IF;

  -- 4. Asegurar sesión gratuita del Jueves 3 de Septiembre (19:00 - 20:15)
  WITH updated_thu AS (
    UPDATE public.clases
       SET es_gratuita = true,
           duracion_minutos = 75,
           fecha_fin = '2026-09-03 20:15:00+02'::timestamptz,
           capacidad_max = 10,
           activa = true,
           nombre = 'Power Vinyasa Clase Abierta'
     WHERE profesor_id = v_yanira_id
       AND (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = '2026-09-03'
       AND EXTRACT(HOUR FROM fecha_inicio AT TIME ZONE 'Europe/Madrid') >= 18
       AND EXTRACT(HOUR FROM fecha_inicio AT TIME ZONE 'Europe/Madrid') <= 20
     RETURNING id
  )
  SELECT count(*) INTO v_count_thu19 FROM updated_thu;

  IF v_count_thu19 = 0 THEN
    INSERT INTO public.clases (
      nombre,
      fecha_inicio,
      fecha_fin,
      duracion_minutos,
      capacidad_max,
      profesor_id,
      tipo_clase,
      activa,
      es_gratuita
    ) VALUES (
      'Power Vinyasa Clase Abierta',
      '2026-09-03 19:00:00+02'::timestamptz,
      '2026-09-03 20:15:00+02'::timestamptz,
      75,
      10,
      v_yanira_id,
      'yoga',
      true,
      true
    );
    RAISE NOTICE '✅ Se insertó la sesión gratuita de Yanira del Jueves 3 de Septiembre 19:00 - 20:15.';
  ELSE
    RAISE NOTICE '✅ Se actualizó la sesión de tarde de Yanira del Jueves 3 de Septiembre a gratuita (19:00 - 20:15).';
  END IF;

END $$;
