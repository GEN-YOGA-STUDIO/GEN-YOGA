BEGIN;

-- Compatibilidad con clientes/PostgREST que resuelven los parámetros en el
-- orden histórico (clase, acompañante, usuario).
CREATE OR REPLACE FUNCTION public.reservar_con_bono_compania(
  p_clase_id bigint,
  p_nombre_acompanante text,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.reservar_con_bono_compania(
    p_clase_id,
    p_user_id,
    p_nombre_acompanante
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_con_bono_compania(bigint, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_con_bono_compania(bigint, text, uuid) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
