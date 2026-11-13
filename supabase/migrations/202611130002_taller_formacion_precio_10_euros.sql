-- ==============================================================================
-- Migración 202611130002: Actualizar precio oficial de 'Taller de formación' (prod_VcUrMnsweZMxrl) a 10 €
-- ==============================================================================

BEGIN;

UPDATE public.stripe_productos
SET unit_amount = 1000,
    precio_formateado = '10,00 €',
    updated_at = now()
WHERE id = 'prod_VcUrMnsweZMxrl';

UPDATE public.tipos_clases
SET stripe_product_id = 'prod_VcUrMnsweZMxrl',
    metodo_pago = 'prod_VcUrMnsweZMxrl',
    activo = true
WHERE id = 591;

UPDATE public.clases
SET metodo_pago = 'prod_VcUrMnsweZMxrl',
    stripe_lookup_key = 'prod_VcUrMnsweZMxrl',
    updated_at = now()
WHERE id = 8061;

COMMIT;
