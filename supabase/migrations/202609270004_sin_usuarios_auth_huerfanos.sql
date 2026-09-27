-- ==============================================================================
-- Migración 202609270004: Sin usuarios de auth "huérfanos" (sin perfil)
--
-- Problema detectado (27/09/2026): al volver a dar de alta un alumno dado de
-- alta con anteriormente, Supabase Auth respondía "User already registered"
-- porque la fila seguía viva en auth.users aunque el perfil ya no existía en
-- la app. El alumno "ya no existe" en la aplicación, pero el alta seguía
-- bloqueada para siempre.
--
-- Causa raíz: hay varias rutas de borrado que eliminan public.profiles pero
-- no llegan (o fallan en silencio) a eliminar auth.users:
--   · admin_eliminar_usuario_completo → "EXCEPTION WHEN OTHERS THEN NULL"
--     al borrar auth.users: el error se tragaba y quedaba la cuenta fantasma.
--   · delete-account (Edge Function) → borra el perfil en una transacción y
--     después llama por HTTP a admin.deleteUser; si esa llamada falla, la
--     eliminación queda a medias.
--   · admin_fusionar_perfiles → en BD solo borra el perfil duplicado.
-- Además, en 202609020098 se eliminó el FK profiles_id_fkey
-- (public.profiles.id → auth.users.id), así que ya nada arrastraba la
-- eliminación en esa dirección.
--
-- Solución en 3 capas:
--   1. Trigger AFTER DELETE sobre public.profiles: si desaparece el perfil,
--      desaparece el usuario de auth en la MISMA transacción. Cualquier ruta
--      de borrado (RPC de admin, Edge Function, fusión de perfiles, SQL
--      manual) queda cubierta: sin perfil no puede quedar usuario de auth.
--   2. admin_eliminar_usuario_completo deja de tragar el error al borrar
--      auth.users: si algo falla, se revierte la operación completa y se
--      ve el error en lugar de dejar una cuenta a medias.
--   3. admin_limpieza_auth_huerfano() → RPC de reparación (solo admin) para
--      purgar y listar huérfanos residuales, por si acaso.
--
-- Válvula de escape (para flujos futuros que quisieran conservar la identidad
-- de auth al borrar un perfil): SET LOCAL app.omitir_borrado_auth = 'on';
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1) Función disparadora: sin perfil ⇒ sin usuario en auth.users
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.borrar_auth_si_desaparece_perfil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('app.omitir_borrado_auth', true), '')
       IN ('on', '1', 'true') THEN
    RETURN NULL;
  END IF;

  -- Nota: si el usuario de auth tampoco existe (perfiles de mostrador/invitados
  -- creados sin cuenta, ver 202609020098), esta sentencia afecta a 0 filas.
  DELETE FROM auth.users WHERE id = OLD.id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.borrar_auth_si_desaparece_perfil() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_perfiles_sin_auth_huerfano ON public.profiles;
CREATE TRIGGER trg_perfiles_sin_auth_huerfano
  AFTER DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.borrar_auth_si_desaparece_perfil();

-- ------------------------------------------------------------------------------
-- 2) RPC de reparación: detectar y purgar cuentas de auth sin perfil
--    (solo administradores; con p_email = NULL revisa/purga todas)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_limpieza_auth_huerfano(p_email text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_eliminados jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes estar autenticado para realizar esta operacion.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
    FROM public.profiles
   WHERE id = auth.uid();

  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo los administradores pueden ejecutar esta limpieza.' USING errcode = '42501';
  END IF;

  WITH huerfanos AS (
    SELECT u.id, lower(trim(coalesce(u.email, ''))) AS email
      FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
       AND (p_email IS NULL
            OR lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(p_email, ''))))
  ),
  borrados AS (
    DELETE FROM auth.users u
      USING huerfanos h
     WHERE u.id = h.id
    RETURNING h.id, h.email
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email)), '[]'::jsonb)
    INTO v_eliminados
    FROM borrados;

  RETURN jsonb_build_object(
    'success', true,
    'email_filter', p_email,
    'purged_count', coalesce(jsonb_array_length(v_eliminados), 0),
    'purged', v_eliminados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_limpieza_auth_huerfano(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_limpieza_auth_huerfano(text) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 3) admin_eliminar_usuario_completo: el borrado de auth.users ya no se traga
--    errores. Si algo falla, la operación completa se revierte (antes podía
--    quedar el perfil borrado y el usuario de auth vivo = cuenta fantasma).
--    Con el trigger del punto 1, el paso 12 suele afectar a 0 filas.
-- ------------------------------------------------------------------------------
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
    END;
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
  --     (el trigger trg_perfiles_sin_auth_huerfano elimina a su vez el usuario
  --      de auth.users dentro de la misma transacción)
  DELETE FROM public.profiles WHERE id = p_target_user_id;

  -- 12. Eliminar usuario en auth.users. Con el trigger del punto 1 esto suele
  --      afectar a 0 filas; se mantiene explícito y SIN tragarse errores: si
  --      algo fallara, la operación completa se revierte en lugar de dejar una
  --      cuenta de auth huérfana que bloquearía un nuevo alta con ese correo.
  DELETE FROM auth.users WHERE id = p_target_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_user_id', p_target_user_id,
    'email', v_target_email,
    'auth_user_removed', NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id)
  );
END;
$$;

-- Permisos de ejecucion para usuarios autenticados (la funcion verifica internamente el rol admin)
GRANT EXECUTE ON FUNCTION public.admin_eliminar_usuario_completo(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
