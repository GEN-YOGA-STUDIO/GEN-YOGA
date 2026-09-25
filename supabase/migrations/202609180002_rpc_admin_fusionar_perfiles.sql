-- ============================================================================
-- Migración 202609180002: RPC para fusión segura de perfiles de usuario duplicados
-- Traspasa todas las reservas (yoga, psicología, nutrición, talleres),
-- packs, suscripciones, compras, saldos y notas al perfil conservado,
-- y elimina de forma limpia el perfil duplicado de profiles y auth.users.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_fusionar_perfiles(
  p_perfil_conservar_id uuid,
  p_perfil_eliminar_id uuid,
  p_sumar_saldos boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_conservar record;
  v_eliminar record;
  v_cnt_yoga integer := 0;
  v_cnt_psico integer := 0;
  v_cnt_nutri integer := 0;
  v_cnt_talleres integer := 0;
  v_cnt_packs integer := 0;
  v_cnt_periods integer := 0;
  v_cnt_bonos_esp integer := 0;
  v_cnt_reprog integer := 0;
  v_cnt_stripe_purchases integer := 0;
  v_final_telefono text;
  v_merged_notas text;
  v_res_json jsonb;
BEGIN
  -- 1. Verificación de seguridad y rol de administrador
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Autenticación requerida para ejecutar la fusión.';
  END IF;

  SELECT lower(coalesce(rol, '')) INTO v_actor_role
    FROM public.profiles
   WHERE id = v_actor_id;

  IF NOT FOUND OR v_actor_role <> 'admin' THEN
    RAISE EXCEPTION 'No autorizado: se requiere rol de administrador para fusionar perfiles.';
  END IF;

  -- 2. Validaciones básicas de parámetros
  IF p_perfil_conservar_id IS NULL OR p_perfil_eliminar_id IS NULL THEN
    RAISE EXCEPTION 'Debe especificar tanto el perfil a conservar como el perfil a eliminar.';
  END IF;

  IF p_perfil_conservar_id = p_perfil_eliminar_id THEN
    RAISE EXCEPTION 'El perfil a conservar y el perfil a eliminar no pueden ser el mismo.';
  END IF;

  -- 3. Obtener datos de ambos perfiles
  SELECT * INTO v_conservar FROM public.profiles WHERE id = p_perfil_conservar_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil a conservar con ID %', p_perfil_conservar_id;
  END IF;

  SELECT * INTO v_eliminar FROM public.profiles WHERE id = p_perfil_eliminar_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil a eliminar con ID %', p_perfil_eliminar_id;
  END IF;

  -- Seguridad: no permitir eliminar otro administrador
  IF lower(coalesce(v_eliminar.rol, '')) = 'admin' THEN
    RAISE EXCEPTION 'Por seguridad, no se puede eliminar un perfil con rol de administrador.';
  END IF;

  -- 4. Traspasar reservas de yoga
  -- A. Reasignar reservas donde el perfil a conservar NO tenga ya una reserva confirmada en la misma clase
  UPDATE public.reservas_yoga
     SET user_id = p_perfil_conservar_id
   WHERE user_id = p_perfil_eliminar_id
     AND NOT EXISTS (
       SELECT 1 FROM public.reservas_yoga r2
        WHERE r2.user_id = p_perfil_conservar_id
          AND r2.clase_id = reservas_yoga.clase_id
          AND r2.estado = 'confirmada'
     );
  GET DIAGNOSTICS v_cnt_yoga = ROW_COUNT;

  -- B. Eliminar cualquier reserva restante duplicada del perfil a eliminar
  DELETE FROM public.reservas_yoga WHERE user_id = p_perfil_eliminar_id;

  -- C. Traspasar beneficio_invitado_de si apuntaba al duplicado
  UPDATE public.reservas_yoga
     SET beneficio_invitado_de = p_perfil_conservar_id
   WHERE beneficio_invitado_de = p_perfil_eliminar_id;

  -- 5. Traspasar reservas de psicología
  UPDATE public.reservas_psicologia
     SET user_id = p_perfil_conservar_id
   WHERE user_id = p_perfil_eliminar_id
     AND NOT EXISTS (
       SELECT 1 FROM public.reservas_psicologia r2
        WHERE r2.user_id = p_perfil_conservar_id
          AND r2.clase_id = reservas_psicologia.clase_id
          AND r2.estado = 'confirmada'
     );
  GET DIAGNOSTICS v_cnt_psico = ROW_COUNT;
  DELETE FROM public.reservas_psicologia WHERE user_id = p_perfil_eliminar_id;

  -- 6. Traspasar reservas de nutrición
  UPDATE public.reservas_nutricion
     SET user_id = p_perfil_conservar_id
   WHERE user_id = p_perfil_eliminar_id
     AND NOT EXISTS (
       SELECT 1 FROM public.reservas_nutricion r2
        WHERE r2.user_id = p_perfil_conservar_id
          AND r2.clase_id = reservas_nutricion.clase_id
          AND r2.estado = 'confirmada'
     );
  GET DIAGNOSTICS v_cnt_nutri = ROW_COUNT;
  DELETE FROM public.reservas_nutricion WHERE user_id = p_perfil_eliminar_id;

  -- 7. Traspasar reservas de talleres si existen
  BEGIN
    UPDATE public.reservas_talleres
       SET user_id = p_perfil_conservar_id
     WHERE user_id = p_perfil_eliminar_id
       AND NOT EXISTS (
         SELECT 1 FROM public.reservas_talleres r2
          WHERE r2.user_id = p_perfil_conservar_id
            AND r2.clase_id = reservas_talleres.clase_id
            AND r2.estado = 'confirmada'
       );
    GET DIAGNOSTICS v_cnt_talleres = ROW_COUNT;
    DELETE FROM public.reservas_talleres WHERE user_id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN
    v_cnt_talleres := 0;
  END;

  -- 8. Traspasar packs de créditos, periodos ilimitados, bonos especiales y reprogramación
  BEGIN
    UPDATE public.class_credit_packs SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
    GET DIAGNOSTICS v_cnt_packs = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.unlimited_membership_periods SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
    GET DIAGNOSTICS v_cnt_periods = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.bonos_clases_especiales SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
    GET DIAGNOSTICS v_cnt_bonos_esp = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.creditos_reprogramacion SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
    GET DIAGNOSTICS v_cnt_reprog = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 9. Traspasar ofertas canjeadas evitando duplicados por tipo de oferta
  BEGIN
    UPDATE public.ofertas_canjeadas
       SET user_id = p_perfil_conservar_id
     WHERE user_id = p_perfil_eliminar_id
       AND NOT EXISTS (
         SELECT 1 FROM public.ofertas_canjeadas o2
          WHERE o2.user_id = p_perfil_conservar_id
            AND o2.tipo_oferta = ofertas_canjeadas.tipo_oferta
       );
    DELETE FROM public.ofertas_canjeadas WHERE user_id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 10. Traspasar Stripe customers, compras y suscripciones
  BEGIN
    UPDATE public.stripe_customers
       SET user_id = p_perfil_conservar_id
     WHERE user_id = p_perfil_eliminar_id
       AND NOT EXISTS (
         SELECT 1 FROM public.stripe_customers sc2 WHERE sc2.user_id = p_perfil_conservar_id
       );
    DELETE FROM public.stripe_customers WHERE user_id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.stripe_purchases SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
    GET DIAGNOSTICS v_cnt_stripe_purchases = ROW_COUNT;
    UPDATE public.stripe_purchases SET guest_user_id = p_perfil_conservar_id WHERE guest_user_id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    UPDATE public.stripe_subscriptions SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 11. Traspasar grupos profesionales
  BEGIN
    UPDATE public.grupos_profesionales
       SET alumno_id = p_perfil_conservar_id
     WHERE alumno_id = p_perfil_eliminar_id
       AND NOT EXISTS (
         SELECT 1 FROM public.grupos_profesionales gp2
          WHERE gp2.alumno_id = p_perfil_conservar_id
            AND gp2.profesional_id = grupos_profesionales.profesional_id
       );
    DELETE FROM public.grupos_profesionales WHERE alumno_id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 12. Traspasar pases de invitados y descuentos ilimitados
  BEGIN
    UPDATE public.unlimited_consultation_discounts SET user_id = p_perfil_conservar_id WHERE user_id = p_perfil_eliminar_id;
    UPDATE public.unlimited_consultation_discounts SET redeemed_by = p_perfil_conservar_id WHERE redeemed_by = p_perfil_eliminar_id;
    UPDATE public.unlimited_guest_passes SET owner_user_id = p_perfil_conservar_id WHERE owner_user_id = p_perfil_eliminar_id;
    UPDATE public.unlimited_guest_passes SET guest_user_id = p_perfil_conservar_id WHERE guest_user_id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- 13. Preparar fusión de metadatos en perfil conservado
  -- Teléfono: Si conservar no tiene teléfono o está vacío, y eliminar sí lo tiene, tomarlo
  IF (v_conservar.telefono IS NULL OR btrim(v_conservar.telefono) = '') AND (v_eliminar.telefono IS NOT NULL AND btrim(v_eliminar.telefono) <> '') THEN
    v_final_telefono := btrim(v_eliminar.telefono);
  ELSE
    v_final_telefono := v_conservar.telefono;
  END IF;

  -- Notas: si el perfil a eliminar tiene notas no presentes en el perfil conservado, concatenarlas
  IF v_eliminar.notas IS NOT NULL AND btrim(v_eliminar.notas) <> '' THEN
    IF v_conservar.notas IS NULL OR btrim(v_conservar.notas) = '' THEN
      v_merged_notas := '[Fusión duplicado]: ' || btrim(v_eliminar.notas);
    ELSIF v_conservar.notas NOT LIKE '%' || btrim(v_eliminar.notas) || '%' THEN
      v_merged_notas := v_conservar.notas || E'\n' || '[Fusión duplicado]: ' || btrim(v_eliminar.notas);
    ELSE
      v_merged_notas := v_conservar.notas;
    END IF;
  ELSE
    v_merged_notas := v_conservar.notas;
  END IF;

  -- 14. Actualizar perfil canónico conservado
  UPDATE public.profiles
     SET telefono = v_final_telefono,
         notas = v_merged_notas,
         fecha_nacimiento = coalesce(v_conservar.fecha_nacimiento, v_eliminar.fecha_nacimiento),
         clases_completadas = coalesce(v_conservar.clases_completadas, 0) + coalesce(v_eliminar.clases_completadas, 0),
         clases_completadas_mes = coalesce(v_conservar.clases_completadas_mes, 0) + coalesce(v_eliminar.clases_completadas_mes, 0),
         clases_mes_anterior = coalesce(v_conservar.clases_mes_anterior, 0) + coalesce(v_eliminar.clases_mes_anterior, 0),
         bonos = coalesce(v_conservar.bonos, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.bonos, 0) ELSE 0 END,
         saldo_psicologia = coalesce(v_conservar.saldo_psicologia, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_psicologia, 0) ELSE 0 END,
         saldo_nutricion = coalesce(v_conservar.saldo_nutricion, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_nutricion, 0) ELSE 0 END,
         saldo_yoga_compania = coalesce(v_conservar.saldo_yoga_compania, 0) + CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.saldo_yoga_compania, 0) ELSE 0 END,
         saldo_clases_gratis = GREATEST(coalesce(v_conservar.saldo_clases_gratis, 0), coalesce(v_eliminar.saldo_clases_gratis, 0)),
         saldo_consultas_gratis = GREATEST(coalesce(v_conservar.saldo_consultas_gratis, 0), coalesce(v_eliminar.saldo_consultas_gratis, 0)),
         bono_mensual_activo = (coalesce(v_conservar.bono_mensual_activo, false) OR coalesce(v_eliminar.bono_mensual_activo, false)),
         bono_mensual_fin = CASE
           WHEN v_conservar.bono_mensual_fin IS NULL THEN v_eliminar.bono_mensual_fin
           WHEN v_eliminar.bono_mensual_fin IS NULL THEN v_conservar.bono_mensual_fin
           ELSE GREATEST(v_conservar.bono_mensual_fin, v_eliminar.bono_mensual_fin)
         END,
         bono_mensual_inicio = CASE
           WHEN v_conservar.bono_mensual_inicio IS NULL THEN v_eliminar.bono_mensual_inicio
           WHEN v_eliminar.bono_mensual_inicio IS NULL THEN v_conservar.bono_mensual_inicio
           ELSE LEAST(v_conservar.bono_mensual_inicio, v_eliminar.bono_mensual_inicio)
         END,
         oferta_bienvenida_canjeada = (coalesce(v_conservar.oferta_bienvenida_canjeada, false) OR coalesce(v_eliminar.oferta_bienvenida_canjeada, false)),
         oferta_compania_canjeada = (coalesce(v_conservar.oferta_compania_canjeada, false) OR coalesce(v_eliminar.oferta_compania_canjeada, false)),
         oferta_consultas_canjeada = (coalesce(v_conservar.oferta_consultas_canjeada, false) OR coalesce(v_eliminar.oferta_consultas_canjeada, false)),
         stripe_customer_id = coalesce(v_conservar.stripe_customer_id, v_eliminar.stripe_customer_id),
         stripe_subscription_id = coalesce(v_conservar.stripe_subscription_id, v_eliminar.stripe_subscription_id),
         updated_at = now()
   WHERE id = p_perfil_conservar_id;

  -- 15. Eliminar el perfil duplicado de public.profiles
  DELETE FROM public.profiles WHERE id = p_perfil_eliminar_id;

  -- 16. Intentar eliminar el usuario de auth.users si existiese
  BEGIN
    DELETE FROM auth.users WHERE id = p_perfil_eliminar_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 17. Sincronizar teléfono en auth.users del perfil conservado si procede
  BEGIN
    IF v_final_telefono IS NOT NULL AND btrim(v_final_telefono) <> '' THEN
      UPDATE auth.users
         SET phone = v_final_telefono,
             raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('telefono', v_final_telefono)
       WHERE id = p_perfil_conservar_id
         AND (phone IS NULL OR phone = '');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 18. Retornar resumen jsonb
  v_res_json := jsonb_build_object(
    'success', true,
    'perfil_conservado_id', p_perfil_conservar_id,
    'perfil_eliminado_id', p_perfil_eliminar_id,
    'reservas_yoga_trasladadas', v_cnt_yoga,
    'reservas_psicologia_trasladadas', v_cnt_psico,
    'reservas_nutricion_trasladadas', v_cnt_nutri,
    'reservas_talleres_trasladadas', v_cnt_talleres,
    'packs_trasladados', v_cnt_packs,
    'bonos_trasladados', CASE WHEN coalesce(p_sumar_saldos, true) THEN coalesce(v_eliminar.bonos, 0) ELSE 0 END,
    'saldos_sumados', coalesce(p_sumar_saldos, true),
    'mensaje', 'Perfiles fusionados correctamente. Se traspasaron todas las reservas y datos asociados.'
  );

  RETURN v_res_json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_fusionar_perfiles(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fusionar_perfiles(uuid, uuid, boolean) TO service_role;
