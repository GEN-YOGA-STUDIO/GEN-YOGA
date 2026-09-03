-- Migration 202609030005: hotfix de reservas con bono normal (v11.12)
--
-- Producción puede conservar una versión anterior de reservar_con_bono que
-- consulta class_credit_packs.starts_at. La fecha canónica del pack es
-- purchased_at, pero añadimos una columna de compatibilidad para que ningún
-- flujo existente vuelva a fallar mientras se actualizan las funciones.

BEGIN;

ALTER TABLE public.class_credit_packs
  ADD COLUMN IF NOT EXISTS starts_at timestamptz;

UPDATE public.class_credit_packs
   SET starts_at = purchased_at
 WHERE starts_at IS NULL;

CREATE OR REPLACE FUNCTION public.sync_class_credit_pack_starts_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.starts_at := COALESCE(NEW.starts_at, NEW.purchased_at);
  NEW.purchased_at := COALESCE(NEW.purchased_at, NEW.starts_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_class_credit_pack_starts_at
  ON public.class_credit_packs;

CREATE TRIGGER trg_sync_class_credit_pack_starts_at
BEFORE INSERT OR UPDATE OF starts_at, purchased_at
ON public.class_credit_packs
FOR EACH ROW
EXECUTE FUNCTION public.sync_class_credit_pack_starts_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
