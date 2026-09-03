-- Migration 202609030004: hotfix definitivo de reserva con bono normal (v11.11)
--
-- Algunas instalaciones mantienen una sobrecarga antigua de reservar_con_bono
-- que consulta class_credit_packs.starts_at. Esa columna no existe: la fecha
-- de inicio del pack es purchased_at. Se parchean todas las firmas existentes
-- para que la corrección se aplique también si la migración v11.8 no llegó a
-- ejecutarse en producción.

BEGIN;

DO $$
DECLARE
  v_function RECORD;
  v_definition text;
  v_patched_definition text;
BEGIN
  FOR v_function IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'reservar_con_bono'
       AND p.prokind = 'f'
  LOOP
    v_definition := pg_get_functiondef(v_function.oid);
    v_patched_definition := regexp_replace(
      v_definition,
      '(?is)(from[[:space:]]+public\.class_credit_packs.*?and[[:space:]]+)starts_at([[:space:]]*<=[[:space:]]*v_starts_at)',
      '\1purchased_at\2'
    );

    IF v_patched_definition <> v_definition THEN
      EXECUTE v_patched_definition;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
