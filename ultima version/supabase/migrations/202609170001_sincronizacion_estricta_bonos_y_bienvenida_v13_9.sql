-- ==============================================================================
-- Migración 202609170001: Sincronización Estricta de Bonos y Bienvenida (v13.9)
-- Descripción:
--   1. Establece la celda profiles.bonos y profiles.saldo_clases_gratis como la
--      fuente canónica e inmutable de la verdad.
--   2. Auto-reconcilia de forma retroactiva todos los registros de class_credit_packs
--      para que la suma de sus créditos disponibles jamás supere el saldo real en profiles.bonos.
--   3. Actualiza ajustar_saldo_usuario para que al descontar clases normales de yoga,
--      se descuente también automáticamente de class_credit_packs, evitando discrepancias
--      entre lo que visualiza el administrador y lo que visualiza el alumno.
-- ==============================================================================

BEGIN;

-- 1. AUTO-RECONCILIACIÓN RETROACTIVA DE class_credit_packs CON profiles.bonos
DO $$
DECLARE
  v_user record;
  v_surplus integer;
  v_pack record;
  v_deduct integer;
BEGIN
  FOR v_user IN
    SELECT p.id AS user_id,
           coalesce(p.bonos, 0) AS saldo_real,
           coalesce(sum(c.credits_remaining), 0)::integer AS pack_total
      FROM public.profiles p
      JOIN public.class_credit_packs c ON c.user_id = p.id
     WHERE c.credits_remaining > 0
     GROUP BY p.id, p.bonos
    HAVING coalesce(sum(c.credits_remaining), 0) > coalesce(p.bonos, 0)
  LOOP
    v_surplus := v_user.pack_total - v_user.saldo_real;

    -- Ajustar créditos sobrantes priorizando los packs más antiguos o próximos a caducar
    FOR v_pack IN
      SELECT id, credits_remaining
        FROM public.class_credit_packs
       WHERE user_id = v_user.user_id
         AND credits_remaining > 0
       ORDER BY expires_at ASC, id ASC
    LOOP
      EXIT WHEN v_surplus <= 0;

      v_deduct := least(v_pack.credits_remaining, v_surplus);

      UPDATE public.class_credit_packs
         SET credits_remaining = credits_remaining - v_deduct,
             updated_at = timezone('utc', now())
       WHERE id = v_pack.id;

      v_surplus := v_surplus - v_deduct;
    END LOOP;

    RAISE NOTICE 'Auto-reconciliado usuario %: saldo real = %, excedente ajustado = %',
      v_user.user_id, v_user.saldo_real, (v_user.pack_total - v_user.saldo_real);
  END LOOP;
END $$;


-- 2. ACTUALIZAR ajustar_saldo_usuario PARA MANTENER COHERENCIA ATÓMICA
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
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_user_id IS NULL OR p_tipo IS NULL OR p_tipo NOT IN (
    'yoga', 'psicologia', 'nutricion', 'clases_gratis', 'bienvenida', 'consultas_gratis', 'yoga_compania'
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

  -- Aplicación atómica de deltas según tipo de bono
  IF p_tipo = 'yoga' THEN
    UPDATE public.profiles
       SET bonos = greatest(coalesce(bonos, 0) + p_delta, 0)
     WHERE id = p_user_id
     RETURNING bonos INTO v_new_balance;

    -- Si se descuentan bonos (delta negativo), descontar también de class_credit_packs para evitar desfase
    IF p_delta < 0 THEN
      v_to_deduct := abs(p_delta);
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
    END IF;

  ELSIF p_tipo = 'psicologia' THEN
    UPDATE public.profiles
       SET saldo_psicologia = greatest(coalesce(saldo_psicologia, 0) + p_delta, 0)
     WHERE id = p_user_id
     RETURNING saldo_psicologia INTO v_new_balance;

  ELSIF p_tipo = 'nutricion' THEN
    UPDATE public.profiles
       SET saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) + p_delta, 0)
     WHERE id = p_user_id
     RETURNING saldo_nutricion INTO v_new_balance;

  ELSIF p_tipo IN ('clases_gratis', 'bienvenida') THEN
    UPDATE public.profiles
       SET saldo_clases_gratis = greatest(coalesce(saldo_clases_gratis, 0) + p_delta, 0)
     WHERE id = p_user_id
     RETURNING saldo_clases_gratis INTO v_new_balance;

  ELSIF p_tipo = 'yoga_compania' THEN
    UPDATE public.profiles
       SET saldo_yoga_compania = greatest(coalesce(saldo_yoga_compania, 0) + p_delta, 0)
     WHERE id = p_user_id
     RETURNING saldo_yoga_compania INTO v_new_balance;

  ELSIF p_tipo = 'consultas_gratis' THEN
    UPDATE public.profiles
       SET saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0)
     WHERE id = p_user_id
     RETURNING saldo_consultas_gratis INTO v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ajustar_saldo_usuario(uuid, text, integer)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ajustar_saldo_usuario(uuid, text, integer) IS
  'Ajusta atómicamente el saldo de bonos de clientes sincronizando profiles y class_credit_packs.';

NOTIFY pgrst, 'reload schema';

COMMIT;
