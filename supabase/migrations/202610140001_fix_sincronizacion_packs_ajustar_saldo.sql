-- ==============================================================================
-- Migración 202610140001: Sincronización atómica de class_credit_packs en ajustar_saldo_usuario
-- y regularización de bonos de Encarnación Escribano López.
--
-- 1. Permite pack_type = 'manual_admin' en class_credit_packs.
-- 2. Corrige la regresión de ajustar_saldo_usuario donde la reducción de bonos
--    por parte de administración no se descontaba de class_credit_packs, provocando
--    que al reservar una clase, el recálculo sum(credits_remaining) reviviera
--    créditos borrados.
-- 3. Asegura que tanto incrementos como decrementos de yoga queden perfectamente
--    registrados en class_credit_packs y sincronizados con profiles.bonos.
-- 4. Regulariza el pack fantasma #5 (duplicado el 02/09/2026 por regularización
--    manual simultánea con Stripe webhook) dejándolo a 0 créditos restantes.
-- ==============================================================================

BEGIN;

-- 1. Permitir 'manual_admin' en el CHECK de tipo de pack
ALTER TABLE public.class_credit_packs DROP CONSTRAINT IF EXISTS class_credit_packs_pack_type_check;
ALTER TABLE public.class_credit_packs ADD CONSTRAINT class_credit_packs_pack_type_check 
  CHECK (pack_type = ANY (ARRAY['clase_suelta'::text, 'pack_4'::text, 'pack_6'::text, 'pack_10'::text, 'manual_admin'::text]));

-- 2. Función atómica ajustar_saldo_usuario con sincronización bidireccional
CREATE OR REPLACE FUNCTION public.ajustar_saldo_usuario(
  p_user_id uuid,
  p_tipo text,
  p_delta integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_new_balance integer;
  v_to_deduct integer;
  v_pack record;
  v_sub integer;
  v_pack_sum integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_user_id IS NULL OR p_tipo IS NULL OR p_tipo NOT IN (
    'yoga', 'psicologia', 'nutricion', 'grupos', 'grupal', 'consulta_grupal',
    'clases_gratis', 'bienvenida', 'consultas_gratis', 'yoga_compania'
  ) THEN
    RAISE EXCEPTION 'invalid balance adjustment';
  END IF;

  IF p_delta IS NULL OR p_delta = 0 OR p_delta < -1000 OR p_delta > 1000 THEN
    RAISE EXCEPTION 'invalid balance delta';
  END IF;

  -- Comprobar rol de quien ejecuta la acción (admin o staff/trabajador)
  SELECT lower(coalesce(rol, '')) INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role NOT IN ('admin', 'trabajador', 'recepcion', 'profesor') THEN
    RAISE EXCEPTION 'only administrators and staff may adjust balances';
  END IF;

  -- Comprobar rol del usuario objetivo
  SELECT lower(coalesce(rol, '')) INTO v_target_role
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client profile not found';
  END IF;

  IF v_target_role IN ('admin', 'profesor', 'trabajador', 'profesional') AND v_actor_role <> 'admin' THEN
    RAISE EXCEPTION 'staff balances cannot be adjusted';
  END IF;

  -- CLASES DE YOGA: SINCRONIZACIÓN ATÓMICA CON CLASS_CREDIT_PACKS
  IF p_tipo = 'yoga' THEN
    IF p_delta < 0 THEN
      v_to_deduct := abs(p_delta);
      -- Descontar de los packs activos del usuario, empezando por los que expiran antes
      FOR v_pack IN
        SELECT id, credits_remaining
          FROM public.class_credit_packs
         WHERE user_id = p_user_id
           AND credits_remaining > 0
         ORDER BY expires_at ASC, id ASC
      LOOP
        EXIT WHEN v_to_deduct <= 0;
        v_sub := least(v_pack.credits_remaining, v_to_deduct);
        UPDATE public.class_credit_packs
           SET credits_remaining = credits_remaining - v_sub,
               updated_at = timezone('utc', now())
         WHERE id = v_pack.id;
        v_to_deduct := v_to_deduct - v_sub;
      END LOOP;

      -- Actualizar perfil
      UPDATE public.profiles
         SET bonos = greatest(coalesce(bonos, 0) + p_delta, 0),
             updated_at = timezone('utc', now())
       WHERE id = p_user_id
       RETURNING bonos INTO v_new_balance;

      -- Si el usuario tiene packs activos registrados, sincronizar canónicamente con sum(credits_remaining)
      IF EXISTS (SELECT 1 FROM public.class_credit_packs WHERE user_id = p_user_id AND expires_at > now()) THEN
        SELECT coalesce(sum(credits_remaining), 0)::integer INTO v_pack_sum
          FROM public.class_credit_packs
         WHERE user_id = p_user_id AND expires_at > now();

        UPDATE public.profiles
           SET bonos = v_pack_sum,
               updated_at = timezone('utc', now())
         WHERE id = p_user_id
         RETURNING bonos INTO v_new_balance;
      END IF;

    ELSIF p_delta > 0 THEN
      -- Si se añaden bonos desde administración, crear un registro de pack manual (60 días de validez)
      -- para que el motor de reservas (reservar_con_bono) lo consuma y no pise el saldo al sincronizar.
      INSERT INTO public.class_credit_packs (
        user_id,
        checkout_session_id,
        pack_type,
        credits_total,
        credits_remaining,
        purchased_at,
        expires_at
      ) VALUES (
        p_user_id,
        NULL,
        'manual_admin',
        p_delta,
        p_delta,
        timezone('utc', now()),
        timezone('utc', now()) + interval '60 days'
      );

      SELECT coalesce(sum(credits_remaining), 0)::integer INTO v_pack_sum
        FROM public.class_credit_packs
       WHERE user_id = p_user_id AND expires_at > now();

      UPDATE public.profiles
         SET bonos = v_pack_sum,
             updated_at = timezone('utc', now())
       WHERE id = p_user_id
       RETURNING bonos INTO v_new_balance;
    END IF;

  ELSIF p_tipo = 'psicologia' THEN
    UPDATE public.profiles
       SET saldo_psicologia = greatest(coalesce(saldo_psicologia, 0) + p_delta, 0),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id
     RETURNING saldo_psicologia INTO v_new_balance;

  ELSIF p_tipo = 'nutricion' THEN
    UPDATE public.profiles
       SET saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) + p_delta, 0),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id
     RETURNING saldo_nutricion INTO v_new_balance;

  ELSIF p_tipo IN ('grupos', 'grupal', 'consulta_grupal') THEN
    UPDATE public.profiles
       SET saldo_grupal = greatest(coalesce(saldo_grupal, 0) + p_delta, 0),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id
     RETURNING saldo_grupal INTO v_new_balance;

  ELSIF p_tipo IN ('clases_gratis', 'bienvenida') THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = greatest(coalesce(saldo_clases_gratis, 0) + p_delta, 0),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id
     RETURNING saldo_clases_gratis INTO v_new_balance;

  ELSIF p_tipo = 'yoga_compania' THEN
    UPDATE public.profiles
       SET saldo_yoga_compania = greatest(coalesce(saldo_yoga_compania, 0) + p_delta, 0),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id
     RETURNING saldo_yoga_compania INTO v_new_balance;

  ELSIF p_tipo = 'consultas_gratis' THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0),
           updated_at = timezone('utc', now())
     WHERE id = p_user_id
     RETURNING saldo_consultas_gratis INTO v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ajustar_saldo_usuario(uuid, text, integer) TO authenticated, service_role;

-- 3. REGULARIZACIÓN DE ENCARNACIÓN ESCRIBANO LÓPEZ
-- Anular los 10 créditos del Pack #5 fantasma (checkout_session_id IS NULL)
UPDATE public.class_credit_packs
   SET credits_remaining = 0,
       updated_at = timezone('utc', now())
 WHERE id = 5
   AND user_id = '9ee21207-8820-4fd0-a7cc-ba70825183dd';

-- Sincronizar el saldo real de Encarnación con sus packs activos (Pack 6 tiene 1 crédito restante)
UPDATE public.profiles
   SET bonos = (
     SELECT coalesce(sum(credits_remaining), 0)::integer
       FROM public.class_credit_packs
      WHERE user_id = '9ee21207-8820-4fd0-a7cc-ba70825183dd'
        AND expires_at > timezone('utc', now())
   ),
   updated_at = timezone('utc', now())
 WHERE id = '9ee21207-8820-4fd0-a7cc-ba70825183dd';

COMMIT;
