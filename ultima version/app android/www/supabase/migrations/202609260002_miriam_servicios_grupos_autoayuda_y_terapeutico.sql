-- ==============================================================================
-- Migración 202609260002: Servicios de Miriam (Autoayuda, Terapéutico, Talleres)
-- ==============================================================================
-- 1. Actualiza el precio del producto Stripe de sesiones grupales de Miriam a 30 €
-- 2. Registra los tipos oficiales 'Grupo de Autoayuda' y 'Grupo Terapéutico' en tipos_clases
-- 3. Reemplaza los huecos individuales solapados de Miriam en las 2ª y 4ª semanas
--    por las sesiones grupales de 2 horas (11:30 a 13:30 h, 30 €/sesión):
--    - Grupo de Autoayuda: Martes 11:30 h (2ª y 4ª semana de cada mes)
--    - Grupo Terapéutico: Miércoles 11:30 h (2ª y 4ª semana de cada mes)
-- ==============================================================================

BEGIN;

-- 1. Actualizar stripe_productos para sesiones grupales de Miriam a 30 €
UPDATE public.stripe_productos
SET unit_amount = 3000,
    precio_formateado = '30,00 €',
    nombre = 'Sesión Grupal Miriam (Grupo Terapéutico / Autoayuda)',
    descripcion = 'Sesión psicoterapéutica grupal en grupo (2 h, 30 €)',
    activo = true
WHERE id = 'prod_VDmmlmsGGhMebt';

-- 2. Asegurar tipos canónicos en public.tipos_clases
-- A) Grupo de Autoayuda
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, especialidad, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Grupo de Autoayuda', 120, '#8B5CF6', 'ph-users-three', true, 21, 'consulta_grupal', 'psicologia', 'prod_VDmmlmsGGhMebt', 'prod_VDmmlmsGGhMebt', 10
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) = 'grupo de autoayuda'
);

UPDATE public.tipos_clases
SET especialidad = 'psicologia',
    categoria = 'consulta_grupal',
    stripe_product_id = 'prod_VDmmlmsGGhMebt',
    metodo_pago = 'prod_VDmmlmsGGhMebt',
    capacidad_predeterminada = 10,
    duracion_predeterminada = 120,
    color = '#8B5CF6',
    icono = 'ph-users-three',
    activo = true
WHERE lower(trim(nombre)) = 'grupo de autoayuda';

-- B) Grupo Terapéutico
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, especialidad, stripe_product_id, metodo_pago, capacidad_predeterminada)
SELECT 'Grupo Terapéutico', 120, '#8B5CF6', 'ph-users-three', true, 22, 'consulta_grupal', 'psicologia', 'prod_VDmmlmsGGhMebt', 'prod_VDmmlmsGGhMebt', 10
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) in ('grupo terapéutico', 'grupo terapeutico')
);

UPDATE public.tipos_clases
SET especialidad = 'psicologia',
    categoria = 'consulta_grupal',
    stripe_product_id = 'prod_VDmmlmsGGhMebt',
    metodo_pago = 'prod_VDmmlmsGGhMebt',
    capacidad_predeterminada = 10,
    duracion_predeterminada = 120,
    color = '#8B5CF6',
    icono = 'ph-users-three',
    activo = true
WHERE lower(trim(nombre)) in ('grupo terapéutico', 'grupo terapeutico');

-- 3. Eliminar huecos individuales no reservados de Miriam que se solapen con las 2 horas de grupo (11:30 y 12:30)
DELETE FROM public.clases
WHERE profesor_id = (SELECT id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1)
  AND (fecha_inicio at time zone 'Europe/Madrid')::date IN (
    '2026-10-13', '2026-10-27', '2026-11-10', '2026-11-24', '2026-12-08', '2026-12-22', 
    '2027-01-12', '2027-01-26', '2027-02-09', '2027-02-23', '2027-03-09', '2027-03-23', 
    '2027-04-13', '2027-04-27', '2027-05-11', '2027-05-25', '2027-06-08', '2027-06-22', 
    '2027-07-13', '2027-07-27',
    '2026-10-14', '2026-10-28', '2026-11-11', '2026-11-25', '2026-12-09', '2026-12-23', 
    '2027-01-13', '2027-01-27', '2027-02-10', '2027-02-24', '2027-03-10', '2027-03-24', 
    '2027-04-14', '2027-04-28', '2027-05-12', '2027-05-26', '2027-06-09', '2027-06-23', 
    '2027-07-14', '2027-07-28'
  )
  AND to_char(fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') IN ('11:30', '12:30')
  AND NOT EXISTS (
    SELECT 1 FROM public.reservas_psicologia r WHERE r.clase_id = clases.id AND r.estado = 'confirmada'
  );

-- 4. Programar sesiones de Grupo de Autoayuda (Martes 11:30 a 13:30 h, 2ª y 4ª semana)
WITH t_autoayuda AS (
  SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) = 'grupo de autoayuda' LIMIT 1
),
prof_miriam AS (
  SELECT id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1
),
fechas_autoayuda AS (
  SELECT unnest(ARRAY[
    '2026-10-13', '2026-10-27', '2026-11-10', '2026-11-24', '2026-12-08', '2026-12-22', 
    '2027-01-12', '2027-01-26', '2027-02-09', '2027-02-23', '2027-03-09', '2027-03-23', 
    '2027-04-13', '2027-04-27', '2027-05-11', '2027-05-25', '2027-06-08', '2027-06-22', 
    '2027-07-13', '2027-07-27'
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
  metodo_pago,
  stripe_lookup_key,
  activa,
  es_especial,
  es_gratuita
)
SELECT
  'Grupo de Autoayuda',
  'Grupo de Autoayuda con Miriam Alfaro. Espacio guiado de apoyo mutuo, autoconocimiento y herramientas compartidas para el bienestar emocional (2 h).',
  (f + time '11:30:00') AT TIME ZONE 'Europe/Madrid',
  (f + time '13:30:00') AT TIME ZONE 'Europe/Madrid',
  120,
  10,
  (SELECT id FROM prof_miriam),
  'psicologia',
  (SELECT id FROM t_autoayuda),
  'prod_VDmmlmsGGhMebt',
  'prod_VDmmlmsGGhMebt',
  true,
  false,
  false
FROM fechas_autoayuda
WHERE NOT EXISTS (
  SELECT 1 FROM public.clases c
  WHERE c.profesor_id = (SELECT id FROM prof_miriam)
    AND c.fecha_inicio = (fechas_autoayuda.f + time '11:30:00') AT TIME ZONE 'Europe/Madrid'
    AND lower(trim(c.nombre)) = 'grupo de autoayuda'
);

-- 5. Programar sesiones de Grupo Terapéutico (Miércoles 11:30 a 13:30 h, 2ª y 4ª semana)
WITH t_terapeutico AS (
  SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) in ('grupo terapéutico', 'grupo terapeutico') LIMIT 1
),
prof_miriam AS (
  SELECT id FROM public.profesionales WHERE lower(nombre) LIKE '%miriam%' LIMIT 1
),
fechas_terapeutico AS (
  SELECT unnest(ARRAY[
    '2026-10-14', '2026-10-28', '2026-11-11', '2026-11-25', '2026-12-09', '2026-12-23', 
    '2027-01-13', '2027-01-27', '2027-02-10', '2027-02-24', '2027-03-10', '2027-03-24', 
    '2027-04-14', '2027-04-28', '2027-05-12', '2027-05-26', '2027-06-09', '2027-06-23', 
    '2027-07-14', '2027-07-28'
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
  metodo_pago,
  stripe_lookup_key,
  activa,
  es_especial,
  es_gratuita
)
SELECT
  'Grupo Terapéutico',
  'Grupo Terapéutico con Miriam Alfaro. Proceso psicoterapéutico grupal de profundización, acompañamiento y regulación emocional (2 h).',
  (f + time '11:30:00') AT TIME ZONE 'Europe/Madrid',
  (f + time '13:30:00') AT TIME ZONE 'Europe/Madrid',
  120,
  10,
  (SELECT id FROM prof_miriam),
  'psicologia',
  (SELECT id FROM t_terapeutico),
  'prod_VDmmlmsGGhMebt',
  'prod_VDmmlmsGGhMebt',
  true,
  false,
  false
FROM fechas_terapeutico
WHERE NOT EXISTS (
  SELECT 1 FROM public.clases c
  WHERE c.profesor_id = (SELECT id FROM prof_miriam)
    AND c.fecha_inicio = (fechas_terapeutico.f + time '11:30:00') AT TIME ZONE 'Europe/Madrid'
    AND lower(trim(c.nombre)) in ('grupo terapéutico', 'grupo terapeutico')
);

NOTIFY pgrst, 'reload schema';

COMMIT;
