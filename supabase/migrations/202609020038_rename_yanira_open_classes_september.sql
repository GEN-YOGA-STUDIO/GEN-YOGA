-- ==============================================================================
-- Migración: Renombrar sesiones de tarde de Yanira (1 y 3 de septiembre)
-- ==============================================================================

DO $$
DECLARE
  v_yanira_id bigint;
  v_updated_count integer := 0;
BEGIN
  SELECT id INTO v_yanira_id
    FROM public.profesionales
   WHERE translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%yanira%'
      OR lower(trim(email)) = 'yaniumana35@gmail.com'
      OR lower(trim(email)) LIKE '%yanira%'
   ORDER BY id ASC
   LIMIT 1;

  IF v_yanira_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró a la profesora Yanira en la tabla profesionales.';
  END IF;

  WITH updated AS (
    UPDATE public.clases
       SET nombre = 'Power Vinyasa Clase Abierta'
     WHERE profesor_id = v_yanira_id
       AND (
         (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = '2026-09-01'
         OR (fecha_inicio AT TIME ZONE 'Europe/Madrid')::date = '2026-09-03'
       )
       AND (EXTRACT(HOUR FROM fecha_inicio AT TIME ZONE 'Europe/Madrid')) >= 14
    RETURNING id, nombre, fecha_inicio
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  RAISE NOTICE '✅ Se han actualizado % sesiones de tarde de Yanira a "Power Vinyasa Clase Abierta".', v_updated_count;
END $$;
