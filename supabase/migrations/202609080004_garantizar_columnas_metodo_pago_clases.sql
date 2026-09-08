-- ==============================================================================
-- Migración 202609080004: Garantizar columnas metodo_pago y stripe_lookup_key en clases
-- ==============================================================================

BEGIN;

-- 1. Añadir columnas metodo_pago y stripe_lookup_key a la tabla clases si no existen
ALTER TABLE public.clases ADD COLUMN IF NOT EXISTS metodo_pago text;
ALTER TABLE public.clases ADD COLUMN IF NOT EXISTS stripe_lookup_key text;

-- 2. Índices para agilizar consultas por método de pago y clave lookup de Stripe
CREATE INDEX IF NOT EXISTS idx_clases_stripe_lookup_key ON public.clases(stripe_lookup_key);
CREATE INDEX IF NOT EXISTS idx_clases_metodo_pago ON public.clases(metodo_pago);

COMMENT ON COLUMN public.clases.metodo_pago IS 'Identificador o nombre del método de pago/producto Stripe asociado';
COMMENT ON COLUMN public.clases.stripe_lookup_key IS 'Clave lookup o identificador de producto Stripe para checkout directo';

-- 3. Notificar a PostgREST para recargar la caché del esquema de Supabase inmediatamente
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

COMMIT;
