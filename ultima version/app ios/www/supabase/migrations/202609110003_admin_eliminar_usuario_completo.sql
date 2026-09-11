-- ==============================================================================
-- Migración 202609110003: Eliminación completa de usuarios por administradores
-- Permite a administradores purgar perfiles de la base de datos sin quedar
-- bloqueados por sesiones de pago recientes en Stripe o estados pendientes.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.admin_eliminar_usuario_completo(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_target_role text;
  v_target_email text;
  v_admin_count integer;
BEGIN
  -- 1. Verificar autenticacion del solicitante
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para realizar esta operacion.' USING errcode = '42501';
  END IF;

  -- 2. Verificar que el solicitante es administrador
  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
    FROM public.profiles
   WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo los administradores pueden eliminar usuarios.' USING errcode = '42501';
  END IF;

  -- 3. Validar el ID de destino
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'El identificador de usuario no es valido.' USING errcode = '22023';
  END IF;

  -- 4. Impedir auto-eliminacion por esta via administrativa
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'No puedes eliminar tu propia cuenta desde la gestion administrativa.' USING errcode = '42501';
  END IF;

  -- 5. Obtener datos del perfil destino
  SELECT lower(trim(coalesce(rol, ''))), lower(trim(coalesce(email, '')))
    INTO v_target_role, v_target_email
    FROM public.profiles
   WHERE id = p_target_user_id;

  -- 6. Proteger la ultima cuenta administradora
  IF v_target_role = 'admin' THEN
    SELECT count(*) INTO v_admin_count
      FROM public.profiles
     WHERE lower(trim(coalesce(rol, ''))) = 'admin'
       AND id <> p_target_user_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'No se puede eliminar la ultima cuenta administradora.' USING errcode = '42501';
    END IF;
  END IF;

  -- 7. Limpiar reservas (yoga, psicologia, nutricion)
  BEGIN
    DELETE FROM public.reservas_yoga WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.reservas_yoga SET beneficio_invitado_de = NULL WHERE beneficio_invitado_de = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.reservas_psicologia WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.reservas_nutricion WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  -- 8. Limpiar grupos profesionales y datos de profesional si existiesen
  BEGIN
    DELETE FROM public.grupos_profesionales WHERE alumno_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  IF v_target_email IS NOT NULL AND v_target_email <> '' THEN
    BEGIN
      DELETE FROM public.grupos_profesionales
       WHERE profesional_id IN (
         SELECT id FROM public.profesionales WHERE lower(trim(email)) = v_target_email
       );
      UPDATE public.profesionales
         SET visible_publico = false,
             activo = false,
             nombre = 'Profesional retirado',
             apellidos = '',
             email = 'retirado+' || md5(p_target_user_id::text) || '@genyoga.invalid'
       WHERE lower(trim(email)) = v_target_email;
    EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
    END IF;
  END IF;

  -- 9. Limpiar bonos, pases de invitado, descuentos y creditos
  BEGIN
    DELETE FROM public.unlimited_guest_passes WHERE guest_user_id = p_target_user_id OR owner_user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.unlimited_consultation_discounts WHERE user_id = p_target_user_id OR redeemed_by = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.unlimited_membership_periods WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.class_credit_packs WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.bonos_clases_especiales WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.creditos_reprogramacion WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.ofertas_canjeadas WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  -- 10. Limpiar o desvincular Stripe
  BEGIN
    DELETE FROM public.stripe_subscriptions WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    DELETE FROM public.stripe_customers WHERE user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.stripe_purchases SET user_id = NULL WHERE user_id = p_target_user_id;
    UPDATE public.stripe_purchases SET guest_user_id = NULL WHERE guest_user_id = p_target_user_id;
  EXCEPTION WHEN undefined_table THEN NULL; WHEN OTHERS THEN NULL;
  END;

  -- 11. Eliminar perfil en public.profiles
  DELETE FROM public.profiles WHERE id = p_target_user_id;

  -- 12. Eliminar usuario en auth.users
  BEGIN
    DELETE FROM auth.users WHERE id = p_target_user_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_user_id', p_target_user_id,
    'email', v_target_email
  );
END;
$$;

-- Permisos de ejecucion para usuarios autenticados (la funcion verifica internamente el rol admin)
GRANT EXECUTE ON FUNCTION public.admin_eliminar_usuario_completo(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
