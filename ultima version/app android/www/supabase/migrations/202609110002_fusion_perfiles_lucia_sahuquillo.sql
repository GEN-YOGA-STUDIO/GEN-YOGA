-- ==============================================================================
-- Migración 202609110002: Fusión de perfiles de Lucía Sahuquillo Esparcia
-- Canónico (Online / Email): luciasahuquillo1esparcia2@gmail.com
-- Duplicado a fusionar: Perfil Mostrador (662346800)
-- ==============================================================================

DO $$
DECLARE
  v_canonical_user_id uuid;
  v_old_user_id uuid;
  v_old_telefono text;
  v_old_notas text;
  v_old_fecha_nac date;
BEGIN
  -- 1. Identificar el perfil canónico que se queda (cuenta online con email)
  SELECT id INTO v_canonical_user_id
    FROM public.profiles
   WHERE lower(trim(email)) = 'luciasahuquillo1esparcia2@gmail.com'
   LIMIT 1;

  IF v_canonical_user_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el perfil canónico con email luciasahuquillo1esparcia2@gmail.com.';
  END IF;

  -- 2. Identificar el perfil duplicado de mostrador (por teléfono 662346800 o nombre)
  SELECT id, telefono, notas, fecha_nacimiento
    INTO v_old_user_id, v_old_telefono, v_old_notas, v_old_fecha_nac
    FROM public.profiles
   WHERE (
     telefono LIKE '%662346800%'
     OR email LIKE '%662346800%'
     OR (
       translate(lower(nombre), 'áéíóúüñ', 'aeiouun') LIKE '%lucia%'
       AND translate(lower(apellidos), 'áéíóúüñ', 'aeiouun') LIKE '%sahuquillo%'
       AND (
         email LIKE '%mostrador%'
         OR email LIKE '%telefono%'
         OR email LIKE '%movil%'
         OR coalesce(rol, '') = 'mostrador'
       )
     )
   )
   AND id <> v_canonical_user_id
   ORDER BY created_at ASC
   LIMIT 1;

  IF v_old_user_id IS NULL THEN
    RAISE NOTICE 'No se encontró perfil duplicado de mostrador para Lucía Sahuquillo Esparcia (posiblemente ya fusionado).';
  ELSE
    RAISE NOTICE 'Fusionando perfil mostrador ID % con perfil canónico ID %', v_old_user_id, v_canonical_user_id;

    -- 3. Traspasar reservas activas e históricas de yoga, psicología y nutrición
    BEGIN
      UPDATE public.reservas_yoga
         SET user_id = v_canonical_user_id
       WHERE user_id = v_old_user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.reservas_yoga
            WHERE user_id = v_canonical_user_id
              AND clase_id = reservas_yoga.clase_id
         );
      DELETE FROM public.reservas_yoga WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.reservas_yoga
         SET beneficio_invitado_de = v_canonical_user_id
       WHERE beneficio_invitado_de = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.reservas_psicologia
         SET user_id = v_canonical_user_id
       WHERE user_id = v_old_user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.reservas_psicologia
            WHERE user_id = v_canonical_user_id
              AND clase_id = reservas_psicologia.clase_id
         );
      DELETE FROM public.reservas_psicologia WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.reservas_nutricion
         SET user_id = v_canonical_user_id
       WHERE user_id = v_old_user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.reservas_nutricion
            WHERE user_id = v_canonical_user_id
              AND clase_id = reservas_nutricion.clase_id
         );
      DELETE FROM public.reservas_nutricion WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 4. Traspasar compras, suscripciones y créditos si existiesen
    BEGIN
      UPDATE public.class_credit_packs SET user_id = v_canonical_user_id WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.unlimited_membership_periods SET user_id = v_canonical_user_id WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.bonos_clases_especiales SET user_id = v_canonical_user_id WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.creditos_reprogramacion SET user_id = v_canonical_user_id WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.ofertas_canjeadas
         SET user_id = v_canonical_user_id
       WHERE user_id = v_old_user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.ofertas_canjeadas
            WHERE user_id = v_canonical_user_id
              AND tipo_oferta = ofertas_canjeadas.tipo_oferta
         );
      DELETE FROM public.ofertas_canjeadas WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.stripe_customers
         SET user_id = v_canonical_user_id
       WHERE user_id = v_old_user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.stripe_customers WHERE user_id = v_canonical_user_id
         );
      DELETE FROM public.stripe_customers WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.stripe_purchases SET user_id = v_canonical_user_id WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.stripe_subscriptions SET user_id = v_canonical_user_id WHERE user_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    BEGIN
      UPDATE public.grupos_profesionales
         SET alumno_id = v_canonical_user_id
       WHERE alumno_id = v_old_user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.grupos_profesionales
            WHERE alumno_id = v_canonical_user_id
              AND profesional_id = grupos_profesionales.profesional_id
         );
      DELETE FROM public.grupos_profesionales WHERE alumno_id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 5. Actualizar perfil canónico: compartir el teléfono (662346800), notas y asegurar nombre limpio
    --    IMPORTANTE: Los saldos de bonos del usuario con email se mantienen intactos tal como indicó el usuario.
    UPDATE public.profiles
       SET telefono = '662346800',
           nombre = 'Lucía',
           apellidos = 'Sahuquillo Esparcia',
           notas = CASE
                     WHEN v_old_notas IS NOT NULL AND btrim(v_old_notas) <> '' AND (notas IS NULL OR notas NOT LIKE '%' || btrim(v_old_notas) || '%')
                     THEN concat_ws(E'\n', nullif(btrim(notas), ''), v_old_notas)
                     ELSE notas
                   END,
           fecha_nacimiento = coalesce(fecha_nacimiento, v_old_fecha_nac)
     WHERE id = v_canonical_user_id;

    -- 6. Eliminar el perfil duplicado de mostrador
    DELETE FROM public.profiles WHERE id = v_old_user_id;

    BEGIN
      DELETE FROM auth.users WHERE id = v_old_user_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- 7. Asegurar que en auth.users el perfil canónico tenga también el teléfono
  BEGIN
    UPDATE auth.users
       SET phone = '662346800',
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"telefono": "662346800"}'::jsonb
     WHERE id = v_canonical_user_id
       AND (phone IS NULL OR phone = '');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

END $$;
