-- ==============================================================================
-- Migración 202609080002: Integración Estricta del Catálogo de Clases con Consultas
-- ==============================================================================

BEGIN;

-- 1. Añadir columna especialidad a public.tipos_clases si no existe
ALTER TABLE public.tipos_clases
  ADD COLUMN IF NOT EXISTS especialidad text DEFAULT 'yoga';

CREATE INDEX IF NOT EXISTS idx_tipos_clases_especialidad ON public.tipos_clases(especialidad);

-- 2. Asegurar que las columnas de sincronización y capacidad existan
ALTER TABLE public.tipos_clases
  ADD COLUMN IF NOT EXISTS stripe_product_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS metodo_pago text,
  ADD COLUMN IF NOT EXISTS capacidad_predeterminada integer DEFAULT 10;

-- 3. Actualizar constraint de categorías
ALTER TABLE public.tipos_clases
  DROP CONSTRAINT IF EXISTS tipos_clases_categoria_check;

ALTER TABLE public.tipos_clases
  ADD CONSTRAINT tipos_clases_categoria_check
  CHECK (categoria IN ('yoga', 'taller', 'clase_especial', 'consulta', 'consulta_grupal'));

-- 4. Sembrar y actualizar tipos canónicos en public.tipos_clases
-- A) Consulta en grupo (Psicología / Sesión grupal Miriam)
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, especialidad, stripe_product_id, metodo_pago, capacidad_predeterminada)
VALUES ('Consulta en grupo', 60, '#8B5CF6', 'ph-users-three', true, 20, 'consulta_grupal', 'psicologia', 'prod_VDmmlmsGGhMebt', 'prod_VDmmlmsGGhMebt', 10)
ON CONFLICT (id) DO NOTHING;

UPDATE public.tipos_clases
SET especialidad = 'psicologia',
    categoria = 'consulta_grupal',
    stripe_product_id = 'prod_VDmmlmsGGhMebt',
    metodo_pago = 'prod_VDmmlmsGGhMebt',
    capacidad_predeterminada = 10,
    duracion_predeterminada = 60
WHERE lower(trim(nombre)) = 'consulta en grupo';

-- B) Consulta Individual Psicología
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, especialidad, stripe_product_id, metodo_pago, capacidad_predeterminada)
VALUES ('Consulta Psicología', 60, '#3B82F6', 'ph-heart-beat', true, 21, 'consulta', 'psicologia', 'prod_V1pKHgtMwPkCpC', 'prod_V1pKHgtMwPkCpC', 1)
ON CONFLICT (id) DO NOTHING;

UPDATE public.tipos_clases
SET especialidad = 'psicologia',
    categoria = 'consulta',
    stripe_product_id = coalesce(stripe_product_id, 'prod_V1pKHgtMwPkCpC'),
    metodo_pago = coalesce(metodo_pago, 'prod_V1pKHgtMwPkCpC'),
    capacidad_predeterminada = 1,
    duracion_predeterminada = 60
WHERE lower(trim(nombre)) in ('consulta psicología', 'consulta individual psicología', 'consulta individual');

-- C) Consulta Individual Nutrición / PNI
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, especialidad, stripe_product_id, metodo_pago, capacidad_predeterminada)
VALUES ('Consulta Nutrición / PNI', 60, '#10B981', 'ph-drop', true, 22, 'consulta', 'nutricion', 'prod_V1ppAeiDF9dlkZ', 'prod_V1ppAeiDF9dlkZ', 1)
ON CONFLICT (id) DO NOTHING;

UPDATE public.tipos_clases
SET especialidad = 'nutricion',
    categoria = 'consulta',
    stripe_product_id = coalesce(stripe_product_id, 'prod_V1ppAeiDF9dlkZ'),
    metodo_pago = coalesce(metodo_pago, 'prod_V1ppAeiDF9dlkZ'),
    capacidad_predeterminada = 1,
    duracion_predeterminada = 60
WHERE lower(trim(nombre)) in ('consulta nutrición / pni', 'consulta nutrición', 'consulta pni');

-- D) Sesión Introductoria Gratuita
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, especialidad, stripe_product_id, metodo_pago, capacidad_predeterminada)
VALUES ('Sesión Introductoria Gratuita', 60, '#EC4899', 'ph-sparkle', true, 23, 'consulta_grupal', 'psicologia', null, 'gratuita', 10)
ON CONFLICT (id) DO NOTHING;

UPDATE public.tipos_clases
SET especialidad = 'psicologia',
    categoria = 'consulta_grupal',
    metodo_pago = 'gratuita',
    capacidad_predeterminada = 10,
    duracion_predeterminada = 60
WHERE lower(trim(nombre)) in ('sesión introductoria grupal', 'sesión introductoria gratuita', 'sesion introductoria gratuita');

-- E) Consulta Ayurveda
INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, activo, orden, categoria, especialidad, stripe_product_id, metodo_pago, capacidad_predeterminada)
VALUES ('Consulta Ayurveda', 90, '#F59E0B', 'ph-yin-yang', true, 24, 'consulta', 'ayurveda', null, 'local', 1)
ON CONFLICT (id) DO NOTHING;

UPDATE public.tipos_clases
SET especialidad = 'ayurveda',
    categoria = 'consulta',
    metodo_pago = 'local',
    capacidad_predeterminada = 1,
    duracion_predeterminada = 90
WHERE lower(trim(nombre)) = 'consulta ayurveda';

-- Asignar especialidad 'yoga' a los tipos de clases de yoga existentes
UPDATE public.tipos_clases
SET especialidad = 'yoga'
WHERE categoria in ('yoga', 'taller', 'clase_especial') AND (especialidad IS NULL OR especialidad = '');

-- 5. Vincular tipo_clase_id en public.clases para consultas existentes que no lo tengan asignado
-- Primero: consultas en grupo
UPDATE public.clases c
SET tipo_clase_id = (SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) = 'consulta en grupo' LIMIT 1)
WHERE c.tipo_clase_id IS NULL
  AND c.tipo_clase IN ('psicologia', 'nutricion')
  AND (lower(c.nombre) LIKE '%grupo%' OR c.capacidad_max > 1);

-- Segundo: sesiones gratuitas / introductorias
UPDATE public.clases c
SET tipo_clase_id = (SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) = 'sesión introductoria gratuita' LIMIT 1)
WHERE c.tipo_clase_id IS NULL
  AND c.tipo_clase IN ('psicologia', 'nutricion')
  AND (c.es_gratuita = true OR lower(c.nombre) LIKE '%intro%');

-- Tercero: consultas de psicología individuales
UPDATE public.clases c
SET tipo_clase_id = (SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) in ('consulta psicología', 'consulta individual') LIMIT 1)
WHERE c.tipo_clase_id IS NULL
  AND c.tipo_clase = 'psicologia';

-- Cuarto: consultas de nutrición individuales
UPDATE public.clases c
SET tipo_clase_id = (SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) in ('consulta nutrición / pni', 'consulta nutrición') LIMIT 1)
WHERE c.tipo_clase_id IS NULL
  AND c.tipo_clase = 'nutricion';

-- Quinto: consultas de ayurveda
UPDATE public.clases c
SET tipo_clase_id = (SELECT id FROM public.tipos_clases WHERE lower(trim(nombre)) = 'consulta ayurveda' LIMIT 1)
WHERE c.tipo_clase_id IS NULL
  AND c.tipo_clase = 'ayurveda';

COMMIT;
