-- ==============================================================================
-- MIGRACIÓN: Gestión y control total de Créditos de Reprogramación para Staff y Admin
-- Permite eliminar, sumar, restar y vaciar créditos de reprogramación sin restricciones
-- ==============================================================================

BEGIN;

-- 1. Asegurar restricción de estado permisiva para cancelaciones y retiradas de admin
ALTER TABLE public.creditos_reprogramacion
  DROP CONSTRAINT IF EXISTS creditos_reprogramacion_estado_check;

ALTER TABLE public.creditos_reprogramacion
  ADD CONSTRAINT creditos_reprogramacion_estado_check
  CHECK (estado = ANY (ARRAY['disponible'::text, 'utilizado'::text, 'expirado'::text, 'retirado_admin'::text, 'cancelado'::text]));

ALTER TABLE public.creditos_reprogramacion
  DROP CONSTRAINT IF EXISTS creditos_reprogramacion_tipo_check;

ALTER TABLE public.creditos_reprogramacion
  ADD CONSTRAINT creditos_reprogramacion_tipo_check
  CHECK (tipo = ANY (ARRAY['taller'::text, 'consulta'::text, 'clase'::text]));

-- 2. Asegurar políticas RLS completas (SELECT, INSERT, UPDATE, DELETE) para staff y admin
DROP POLICY IF EXISTS "creditos_reprogramacion_admin_all" ON public.creditos_reprogramacion;
DROP POLICY IF EXISTS "creditos_reprogramacion_staff_manage" ON public.creditos_reprogramacion;

CREATE POLICY "creditos_reprogramacion_staff_manage"
  ON public.creditos_reprogramacion
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE profiles.id = auth.uid()
         AND lower(trim(coalesce(profiles.rol, ''))) IN ('admin', 'profesor', 'trabajador', 'profesional')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE profiles.id = auth.uid()
         AND lower(trim(coalesce(profiles.rol, ''))) IN ('admin', 'profesor', 'trabajador', 'profesional')
    )
  );

GRANT ALL ON TABLE public.creditos_reprogramacion TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.creditos_reprogramacion_id_seq TO authenticated, service_role;

-- 3. RPC para retirar / eliminar un crédito de reprogramación individual
CREATE OR REPLACE FUNCTION public.admin_retirar_credito_reprogramacion(
  p_credito_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'insufficient privileges' USING errcode = '42501';
  END IF;

  DELETE FROM public.creditos_reprogramacion
   WHERE id = p_credito_id;

  RETURN true;
END;
$function$;

-- 4. RPC para ajustar (sumar o restar) créditos de reprogramación de un usuario
CREATE OR REPLACE FUNCTION public.admin_ajustar_creditos_reprogramacion(
  p_user_id uuid,
  p_delta integer,
  p_tipo text DEFAULT 'consulta',
  p_subtipo text DEFAULT 'general'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_count integer;
  v_effective_tipo text := coalesce(nullif(trim(lower(p_tipo)), ''), 'consulta');
  v_effective_subtipo text := coalesce(nullif(trim(lower(p_subtipo)), ''), 'general');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'insufficient privileges' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'target user is required' USING errcode = '22023';
  END IF;

  IF v_effective_tipo NOT IN ('consulta', 'taller') THEN
    v_effective_tipo := 'consulta';
  END IF;

  IF p_delta < 0 THEN
    -- Eliminar los N créditos disponibles más recientes del usuario
    DELETE FROM public.creditos_reprogramacion
     WHERE id IN (
       SELECT id FROM public.creditos_reprogramacion
        WHERE user_id = p_user_id
          AND estado = 'disponible'
        ORDER BY created_at DESC
        LIMIT abs(p_delta)
     );
  ELSIF p_delta > 0 THEN
    -- Insertar N nuevos créditos de reprogramación
    FOR i IN 1..least(p_delta, 50) LOOP
      INSERT INTO public.creditos_reprogramacion (
        user_id,
        tipo,
        subtipo,
        mes,
        estado,
        created_at
      ) VALUES (
        p_user_id,
        v_effective_tipo,
        v_effective_subtipo,
        date_trunc('month', now())::date,
        'disponible',
        now()
      );
    END LOOP;
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM public.creditos_reprogramacion
   WHERE user_id = p_user_id
     AND estado = 'disponible';

  RETURN coalesce(v_count, 0);
END;
$function$;

-- 5. RPC para vaciar todos los créditos de reprogramación de un usuario
CREATE OR REPLACE FUNCTION public.admin_vaciar_creditos_reprogramacion(
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_actor_role
    FROM public.profiles WHERE id = v_actor_id;

  IF v_actor_role NOT IN ('admin', 'profesor', 'trabajador', 'profesional') THEN
    RAISE EXCEPTION 'insufficient privileges' USING errcode = '42501';
  END IF;

  DELETE FROM public.creditos_reprogramacion
   WHERE user_id = p_user_id
     AND estado = 'disponible';

  RETURN true;
END;
$function$;

-- 6. Otorgar permisos de ejecución
GRANT EXECUTE ON FUNCTION public.admin_retirar_credito_reprogramacion(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ajustar_creditos_reprogramacion(uuid, integer, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_vaciar_creditos_reprogramacion(uuid) TO authenticated, service_role;

COMMIT;
