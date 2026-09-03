-- Migración v12.7/12.8: Gestión de códigos promocionales para administradores
-- Actualiza la RPC admin_set_promo_50 para soportar reactivación reseteando codigo_promo_usado

CREATE OR REPLACE FUNCTION public.admin_set_promo_50(p_user_id uuid, p_active boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'Solo los administradores pueden modificar el estado promocional.' USING errcode = '42501';
  END IF;

  UPDATE public.profiles
  SET descuento_promo_50_activo = p_active,
      codigo_promo_canjeado = CASE WHEN p_active THEN coalesce(codigo_promo_canjeado, 'GEN YOGA') ELSE codigo_promo_canjeado END,
      codigo_promo_usado = CASE WHEN p_active THEN false ELSE codigo_promo_usado END,
      codigo_promo_fecha_canje = CASE WHEN p_active AND codigo_promo_fecha_canje IS NULL THEN now() ELSE codigo_promo_fecha_canje END
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
