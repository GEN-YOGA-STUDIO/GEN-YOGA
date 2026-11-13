-- ==============================================================================
-- Migración 202611130001: Nuevo tipo de taller 'Taller de formación' (prod_VcUrMnsweZMxrl)
-- ==============================================================================

BEGIN;

-- 1. Sincronizar nuevo producto en public.stripe_productos
INSERT INTO public.stripe_productos (
    id,
    nombre,
    descripcion,
    precio_formateado,
    unit_amount,
    currency,
    categoria,
    activo
) VALUES (
    'prod_VcUrMnsweZMxrl',
    'Taller de formación',
    'Taller de formación GEN Yoga',
    'Consultar',
    NULL,
    'eur',
    'General - Services',
    true
)
ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    categoria = EXCLUDED.categoria,
    activo = true,
    updated_at = now();

-- 2. Asegurar el tipo canónico en public.tipos_clases
INSERT INTO public.tipos_clases (
    nombre,
    duracion_predeterminada,
    capacidad_predeterminada,
    color,
    icono,
    orden,
    categoria,
    especialidad,
    stripe_product_id,
    metodo_pago,
    activo
) VALUES (
    'Taller de formación',
    120,
    15,
    '#f59e0b',
    'ph-certificate',
    15,
    'taller',
    'yoga',
    'prod_VcUrMnsweZMxrl',
    'prod_VcUrMnsweZMxrl',
    true
)
ON CONFLICT (nombre) DO UPDATE SET
    categoria = 'taller',
    especialidad = 'yoga',
    stripe_product_id = 'prod_VcUrMnsweZMxrl',
    metodo_pago = 'prod_VcUrMnsweZMxrl',
    activo = true,
    capacidad_predeterminada = 15;

COMMIT;
