-- ==============================================================================
-- Migración 202609260003: Ajuste de fechas y descripciones para grupos de Miriam
-- ==============================================================================
-- Feedback Manu:
-- 1. Fechas exactas:
--    - Grupo de Autoayuda: martes 6 y 20 de octubre (y 1er y 3er martes de cada mes)
--    - Grupo Terapéutico: miércoles 7 y 21 de octubre (y 1er y 3er miércoles de cada mes)
--    - Dos sesiones al mes por grupo, 11:30 a 13:30 h (2 horas, 30 €/sesión)
-- 2. Restauración de huecos individuales en las fechas anteriores (13 y 27 de octubre, etc.)
-- 3. Descripciones diferenciadas:
--    - Terapéuticos: Grupos cerrados y continuados, espacio de confianza y vínculo, diversos temas.
--    - Autoayuda: Espacios centrados en una temática concreta con un objetivo compartido.
-- ==============================================================================

BEGIN;

-- 1. Actualizar descripción en stripe_productos
UPDATE public.stripe_productos
SET nombre = 'Sesión Grupal Miriam (Grupo Terapéutico / Autoayuda)',
    descripcion = 'Sesión psicoterapéutica grupal de 2 h (30 €). Grupo Terapéutico (miércoles) y Grupo de Autoayuda (martes).',
    unit_amount = 3000,
    precio_formateado = '30,00 €',
    activo = true
WHERE id = 'prod_VDmmlmsGGhMebt';

-- 2. Eliminar las clases de grupo previamente programadas en fechas provisionales (13, 27 oct, etc.)
DELETE FROM public.clases 
WHERE tipo_clase_id IN (65, 66);

-- 3. Restaurar huecos de consulta individual de Miriam en las fechas provisionales anteriores
--    (11:30 a 12:30 y 12:30 a 13:30) para que no queden huecos vacíos
WITH prof_miriam AS (
  SELECT id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1
),
fechas_antiguas AS (
  SELECT unnest(ARRAY[
    '2026-10-13', '2026-10-27', '2026-11-10', '2026-11-24', '2026-12-08', '2026-12-22', 
    '2027-01-12', '2027-01-26', '2027-02-09', '2027-02-23', '2027-03-09', '2027-03-23', 
    '2027-04-13', '2027-04-27', '2027-05-11', '2027-05-25', '2027-06-08', '2027-06-22', 
    '2027-07-13', '2027-07-27',
    '2026-10-14', '2026-10-28', '2026-11-11', '2026-11-25', '2026-12-09', '2026-12-23', 
    '2027-01-13', '2027-01-27', '2027-02-10', '2027-02-24', '2027-03-10', '2027-03-24', 
    '2027-04-14', '2027-04-28', '2027-05-12', '2027-05-26', '2027-06-09', '2027-06-23', 
    '2027-07-14', '2027-07-28'
  ]::date[]) AS f
),
horas_individuales AS (
  SELECT unnest(ARRAY['11:30:00'::time, '12:30:00'::time]) AS h
)
INSERT INTO public.clases (
  nombre,
  descripcion,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  tipo_clase_id,
  activa,
  plazas_reservadas,
  es_especial,
  es_gratuita,
  nivel
)
SELECT
  'Consulta Psicología',
  'Consulta Individual Psicología',
  (fa.f + hi.h) AT TIME ZONE 'Europe/Madrid',
  (fa.f + hi.h + interval '60 minutes') AT TIME ZONE 'Europe/Madrid',
  60,
  1,
  pm.id,
  'psicologia',
  46,
  true,
  0,
  false,
  false,
  'principiante'
FROM fechas_antiguas fa
CROSS JOIN horas_individuales hi
CROSS JOIN prof_miriam pm
WHERE NOT EXISTS (
  SELECT 1 FROM public.clases c
  WHERE c.profesor_id = pm.id
    AND c.fecha_inicio = ((fa.f + hi.h) AT TIME ZONE 'Europe/Madrid')
);

-- 4. Eliminar huecos individuales no reservados de Miriam que coincidan con las NUEVAS fechas
--    y horas de los grupos (6 y 20 oct, 7 y 21 oct, etc. a las 11:30 y 12:30)
DELETE FROM public.clases
WHERE profesor_id = (SELECT id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1)
  AND (fecha_inicio at time zone 'Europe/Madrid')::date IN (
    '2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15',
    '2027-01-05', '2027-01-19', '2027-02-02', '2027-02-16', '2027-03-02', '2027-03-16',
    '2027-04-06', '2027-04-20', '2027-05-04', '2027-05-18', '2027-06-01', '2027-06-15',
    '2027-07-06', '2027-07-20',
    '2026-10-07', '2026-10-21', '2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16',
    '2027-01-06', '2027-01-20', '2027-02-03', '2027-02-17', '2027-03-03', '2027-03-17',
    '2027-04-07', '2027-04-21', '2027-05-05', '2027-05-19', '2027-06-02', '2027-06-16',
    '2027-07-07', '2027-07-21'
  )
  AND to_char(fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') IN ('11:30', '12:30')
  AND NOT EXISTS (
    SELECT 1 FROM public.reservas_psicologia r WHERE r.clase_id = clases.id AND r.estado = 'confirmada'
  );

-- 5. Programar sesiones de Grupo de Autoayuda (Martes 11:30 a 13:30 h, 6 y 20 de octubre, etc.)
WITH t_autoayuda AS (
  SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) = 'grupo de autoayuda' LIMIT 1
),
prof_miriam AS (
  SELECT id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1
),
fechas_autoayuda AS (
  SELECT unnest(ARRAY[
    '2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15',
    '2027-01-05', '2027-01-19', '2027-02-02', '2027-02-16', '2027-03-02', '2027-03-16',
    '2027-04-06', '2027-04-20', '2027-05-04', '2027-05-18', '2027-06-01', '2027-06-15',
    '2027-07-06', '2027-07-20'
  ]::date[]) AS f
)
INSERT INTO public.clases (
  nombre,
  descripcion,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  tipo_clase_id,
  stripe_lookup_key,
  metodo_pago,
  activa,
  plazas_reservadas,
  es_especial,
  es_gratuita,
  nivel
)
SELECT
  'Grupo de Autoayuda',
  'Espacios grupales centrados en una temática concreta y con un objetivo compartido (2 h, 30 €).',
  (fa.f + time '11:30:00') AT TIME ZONE 'Europe/Madrid',
  (fa.f + time '13:30:00') AT TIME ZONE 'Europe/Madrid',
  120,
  10,
  pm.id,
  'consulta_grupal',
  ta.id,
  'prod_VDmmlmsGGhMebt',
  'prod_VDmmlmsGGhMebt',
  true,
  0,
  false,
  false,
  'todos los niveles'
FROM fechas_autoayuda fa
CROSS JOIN prof_miriam pm
CROSS JOIN t_autoayuda ta;

-- 6. Programar sesiones de Grupo Terapéutico (Miércoles 11:30 a 13:30 h, 7 y 21 de octubre, etc.)
WITH t_terapeutico AS (
  SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) IN ('grupo terapéutico', 'grupo terapeutico') LIMIT 1
),
prof_miriam AS (
  SELECT id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1
),
fechas_terapeutico AS (
  SELECT unnest(ARRAY[
    '2026-10-07', '2026-10-21', '2026-11-04', '2026-11-18', '2026-12-02', '2026-12-16',
    '2027-01-06', '2027-01-20', '2027-02-03', '2027-02-17', '2027-03-03', '2027-03-17',
    '2027-04-07', '2027-04-21', '2027-05-05', '2027-05-19', '2027-06-02', '2027-06-16',
    '2027-07-07', '2027-07-21'
  ]::date[]) AS f
)
INSERT INTO public.clases (
  nombre,
  descripcion,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  tipo_clase_id,
  stripe_lookup_key,
  metodo_pago,
  activa,
  plazas_reservadas,
  es_especial,
  es_gratuita,
  nivel
)
SELECT
  'Grupo Terapéutico',
  'Grupos cerrados y continuados para abordar diversos aspectos de interés del grupo (2 h, 30 €).',
  (ft.f + time '11:30:00') AT TIME ZONE 'Europe/Madrid',
  (ft.f + time '13:30:00') AT TIME ZONE 'Europe/Madrid',
  120,
  10,
  pm.id,
  'consulta_grupal',
  tt.id,
  'prod_VDmmlmsGGhMebt',
  'prod_VDmmlmsGGhMebt',
  true,
  0,
  false,
  false,
  'todos los niveles'
FROM fechas_terapeutico ft
CROSS JOIN prof_miriam pm
CROSS JOIN t_terapeutico tt;

COMMIT;
