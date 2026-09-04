-- ==============================================================================
-- MIGRACIÓN v12.12: Método de Pago (Stripe) para Talleres y Consultas + Saldo Talleres
-- ==============================================================================

-- 1. Añadir columnas metodo_pago y stripe_lookup_key a la tabla clases
ALTER TABLE public.clases ADD COLUMN IF NOT EXISTS metodo_pago text;
ALTER TABLE public.clases ADD COLUMN IF NOT EXISTS stripe_lookup_key text;

-- 2. Añadir columna saldo_talleres a profiles para gestionar bonos de taller (35 €)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS saldo_talleres integer DEFAULT 0;

-- 3. Índices útiles para consultas por tipo y método de pago
CREATE INDEX IF NOT EXISTS idx_clases_stripe_lookup_key ON public.clases(stripe_lookup_key);
CREATE INDEX IF NOT EXISTS idx_clases_metodo_pago ON public.clases(metodo_pago);

COMMENT ON COLUMN public.clases.metodo_pago IS 'Identificador o nombre del método de pago/producto Stripe asociado';
COMMENT ON COLUMN public.clases.stripe_lookup_key IS 'Clave lookup o identificador de producto Stripe para checkout directo';
COMMENT ON COLUMN public.profiles.saldo_talleres IS 'Número de bonos de taller (35 €) disponibles para el usuario';