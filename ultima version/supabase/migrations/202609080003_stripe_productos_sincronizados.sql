-- ==============================================================================
-- Migración 202609080003: Tabla de productos reales de Stripe sincronizados (v12.18)
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.stripe_productos (
    id text PRIMARY KEY,
    nombre text NOT NULL,
    descripcion text,
    precio_formateado text,
    unit_amount integer,
    currency text DEFAULT 'eur',
    price_id text,
    categoria text DEFAULT 'General - Services',
    activo boolean DEFAULT true,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.stripe_productos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura publica de stripe_productos" ON public.stripe_productos;
CREATE POLICY "Permitir lectura publica de stripe_productos"
  ON public.stripe_productos FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Permitir escritura servicio y autenticados en stripe_productos" ON public.stripe_productos;
CREATE POLICY "Permitir escritura servicio y autenticados en stripe_productos"
  ON public.stripe_productos FOR ALL
  USING (auth.role() = 'service_role' OR auth.role() = 'authenticated');

-- Sembrado inicial con los 20 productos reales existentes en Stripe
INSERT INTO public.stripe_productos (id, nombre, descripcion, precio_formateado, unit_amount, currency, categoria, activo)
VALUES
  ('prod_VDmmlmsGGhMebt', 'Sesion grupal Miriam', 'Sesión psicoterapéutica grupal en grupo', '80,00 €', 8000, 'eur', 'General - Services', true),
  ('prod_VDY8mI9bZ3SQeb', 'Taller con descuento', 'Taller GEN Yoga con descuento', '25,00 €', 2500, 'eur', 'General - Services', true),
  ('prod_V9eGZTzwCNJ55q', 'Clase suelta PROMOCION 50%', '1ª Clase con 50% Dto. (Promo GEN YOGA)', '7,50 €', 750, 'eur', 'General - Services', true),
  ('prod_V5uCPKKKH5K74P', 'Taller Gen Yoga', 'Taller Introducción Power Vinyasa', '35,00 €', 3500, 'eur', 'General - Services', true),
  ('prod_V5uBKuweMRE6ig', 'Clase especial', 'Clase especial 75 min', '20,00 €', 2000, 'eur', 'General - Services', true),
  ('prod_V1pxtuahf6l09m', 'Consulta de Ayurveda sucesiva con Silvia', 'Consulta de seguimiento Ayurveda (60 min)', '60,00 €', 6000, 'eur', 'General - Services', true),
  ('prod_V1pwyAFdIdxWG5', 'Consulta de Ayurveda inicial con Silvia', 'Consulta inicial Ayurveda (90 min)', '80,00 €', 8000, 'eur', 'General - Services', true),
  ('prod_V1psDxhdrLmncY', 'Bono de Salud Integrativa (6 consultas sucesivas)', 'Bono 6 consultas Ayurveda', '280,00 €', 28000, 'eur', 'General - Services', true),
  ('prod_V1psYkVdT3ZgxH', 'Bono de Salud Integrativa (3 consultas sucesivas)', 'Bono 3 consultas Ayurveda', '170,00 €', 17000, 'eur', 'General - Services', true),
  ('prod_V1pqPF6rtJf0SW', 'Consulta de Psiconeuroinmunología Clínica sucesiva con Isabel', 'Consulta de seguimiento PNI (60 min)', '60,00 €', 6000, 'eur', 'General - Services', true),
  ('prod_V1ppAeiDF9dlkZ', 'Consulta de Psiconeuroinmunología Clínica inicial con Isabel', 'Consulta inicial PNI (60 min)', '80,00 €', 8000, 'eur', 'General - Services', true),
  ('prod_V1pLWNLzr9Vb3g', 'Terapia de pareja sucesiva con Miriam', 'Terapia de pareja sucesiva (90 min)', '100,00 €', 10000, 'eur', 'General - Services', true),
  ('prod_V1pLCY3t5sprlK', 'Terapia de pareja inicial con Miriam', 'Terapia de pareja inicial (90 min)', '120,00 €', 12000, 'eur', 'General - Services', true),
  ('prod_V1pLmzpCRU8ZpL', 'Acompañamiento psicoterapéutico sucesivo con Miriam', 'Sesión psicoterapéutica sucesiva (60 min)', '65,00 €', 6500, 'eur', 'General - Services', true),
  ('prod_V1pKHgtMwPkCpC', 'Acompañamiento psicoterapéutico inicial con Miriam', 'Sesión psicoterapéutica inicial (60 min)', '75,00 €', 7500, 'eur', 'General - Services', true),
  ('prod_V0IUYoGJJbX7FW', 'Bono 10 clases', 'Bono de 10 clases presenciales', '95,00 €', 9500, 'eur', 'General - Services', true),
  ('prod_V0IUpyuvd7uX00', 'Bono 6 clases', 'Bono de 6 clases presenciales', '65,00 €', 6500, 'eur', 'General - Services', true),
  ('prod_V0ITB6mD71fwnD', 'Bono 4 clases', 'Bono de 4 clases presenciales', '50,00 €', 5000, 'eur', 'General - Services', true),
  ('prod_UqBxkWuX2OeIz8', 'Bono mensual', 'Suscripción mensual y pase ilimitado', '2 precios', 9000, 'eur', 'General - Services', true),
  ('prod_UqBwGSWJNVAK0j', 'Clase suelta', 'Clase suelta de yoga presencial', '15,00 €', 1500, 'eur', 'General - Services', true)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  precio_formateado = EXCLUDED.precio_formateado,
  unit_amount = EXCLUDED.unit_amount,
  currency = EXCLUDED.currency,
  categoria = EXCLUDED.categoria,
  activo = EXCLUDED.activo,
  updated_at = now();

COMMIT;
