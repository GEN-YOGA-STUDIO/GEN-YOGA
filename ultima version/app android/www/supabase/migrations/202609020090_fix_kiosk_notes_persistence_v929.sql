-- ==============================================================================
-- Migración 202609020090: Persistencia de notas en alta de clientes de mostrador
-- GEN YOGA v9.29
-- Garantiza que las notas del alta/registro de clientes de mostrador queden
-- siempre guardadas en public.profiles, tanto por signUp como por RPC.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_perfil_nuevo_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_fecha_nacimiento date;
  v_notas text;
  v_auth_method text;
  v_raw_bday text;
BEGIN
  v_nombre := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'nombre',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      ''
    )),
    '\s+',
    ' ',
    'g'
  );
  v_apellidos := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'apellidos',
      new.raw_user_meta_data->>'family_name',
      ''
    )),
    '\s+',
    ' ',
    'g'
  );
  v_telefono := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'telefono',
      new.phone,
      ''
    )),
    '[^0-9+]',
    '',
    'g'
  );
  v_notas := trim(coalesce(new.raw_user_meta_data->>'notas', ''));
  v_auth_method := lower(trim(coalesce(
    new.raw_user_meta_data->>'auth_method',
    case
      when new.email ~* '^(movil|telefono)\.[0-9]+@genyoga\.studio$' or new.phone is not null then 'phone'
      else 'email'
    end
  )));
  if v_auth_method not in ('email', 'phone', 'kiosk') then
    v_auth_method := 'email';
  end if;

  v_raw_bday := trim(coalesce(new.raw_user_meta_data->>'fecha_nacimiento', ''));
  if v_raw_bday ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_fecha_nacimiento := v_raw_bday::date;
    exception when others then
      v_fecha_nacimiento := null;
    end;
  else
    v_fecha_nacimiento := null;
  end if;

  if length(v_nombre) < 1 or length(v_nombre) > 80 or v_nombre ~ '[[:cntrl:]<>&]' then
    v_nombre := 'Alumno';
  end if;
  if length(v_apellidos) > 120 or v_apellidos ~ '[[:cntrl:]<>&]' then
    v_apellidos := '';
  end if;

  insert into public.profiles (
    id,
    nombre,
    apellidos,
    email,
    telefono,
    fecha_nacimiento,
    notas,
    auth_method,
    rol,
    bonos,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  )
  values (
    new.id,
    v_nombre,
    v_apellidos,
    lower(trim(coalesce(new.email, ''))),
    nullif(v_telefono, ''),
    v_fecha_nacimiento,
    v_notas,
    v_auth_method,
    'cliente',
    0,
    1,
    1,
    1
  )
  on conflict (id) do update
  set nombre = case
        when nullif(trim(coalesce(profiles.nombre, '')), '') is null then excluded.nombre
        else profiles.nombre
      end,
      apellidos = case
        when nullif(trim(coalesce(profiles.apellidos, '')), '') is null then excluded.apellidos
        else profiles.apellidos
      end,
      email = excluded.email,
      telefono = coalesce(nullif(excluded.telefono, ''), profiles.telefono),
      fecha_nacimiento = coalesce(excluded.fecha_nacimiento, profiles.fecha_nacimiento),
      notas = case when length(coalesce(excluded.notas, '')) > 0 then excluded.notas else profiles.notas end,
      auth_method = coalesce(nullif(excluded.auth_method, ''), profiles.auth_method),
      saldo_clases_gratis = case when coalesce(profiles.saldo_clases_gratis, 0) <= 0 then 1 else profiles.saldo_clases_gratis end,
      saldo_consultas_gratis = case when coalesce(profiles.saldo_consultas_gratis, 0) <= 0 then 1 else profiles.saldo_consultas_gratis end,
      saldo_yoga_compania = case when coalesce(profiles.saldo_yoga_compania, 0) <= 0 then 1 else profiles.saldo_yoga_compania end;

  return new;
END;
$$;

DROP TRIGGER IF EXISTS zz_gen_yoga_profile_after_signup ON auth.users;
CREATE TRIGGER zz_gen_yoga_profile_after_signup
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.crear_perfil_nuevo_usuario();

CREATE OR REPLACE FUNCTION public.admin_crear_cliente_mostrador(
  p_nombre text,
  p_apellidos text DEFAULT '',
  p_fecha_nacimiento date DEFAULT null,
  p_telefono text DEFAULT null,
  p_email text DEFAULT null,
  p_notas text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_email text;
  v_notas text;
  v_profile_id uuid := gen_random_uuid();
  v_created public.profiles%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
    FROM public.profiles
   WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin', 'trabajador', 'profesor', 'profesional') THEN
    RAISE EXCEPTION 'Permisos insuficientes para crear clientes.' USING errcode = '42501';
  END IF;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');
  v_notas := trim(coalesce(p_notas, ''));
  v_email := lower(trim(coalesce(p_email, '')));

  IF length(v_nombre) < 1 THEN
    RAISE EXCEPTION 'El nombre es obligatorio.' USING errcode = '22023';
  END IF;

  IF length(v_email) < 3 OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    v_email := 'mostrador+' || substr(md5(v_profile_id::text || clock_timestamp()::text), 1, 16) || '@genyoga.studio';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    nombre,
    apellidos,
    fecha_nacimiento,
    telefono,
    notas,
    rol,
    bonos,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  ) VALUES (
    v_profile_id,
    v_email,
    v_nombre,
    v_apellidos,
    p_fecha_nacimiento,
    nullif(v_telefono, ''),
    v_notas,
    'cliente',
    0,
    1,
    1,
    1
  )
  ON CONFLICT (id) DO UPDATE
  SET email = excluded.email,
      nombre = excluded.nombre,
      apellidos = excluded.apellidos,
      fecha_nacimiento = excluded.fecha_nacimiento,
      telefono = excluded.telefono,
      notas = case when length(coalesce(excluded.notas, '')) > 0 then excluded.notas else profiles.notas end,
      rol = 'cliente'
  RETURNING * INTO v_created;

  RETURN to_jsonb(v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_actualizar_perfil_usuario(
  p_user_id uuid,
  p_nombre text DEFAULT null,
  p_apellidos text DEFAULT null,
  p_telefono text DEFAULT null,
  p_fecha_nacimiento date DEFAULT null,
  p_rol text DEFAULT null,
  p_email text DEFAULT null,
  p_notas text DEFAULT null
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_email text;
  v_notas text;
  v_rol text;
  v_updated public.profiles%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING errcode = '42501';
  END IF;

  SELECT lower(trim(coalesce(rol, ''))) INTO v_caller_role
    FROM public.profiles
   WHERE id = v_caller_id;

  IF v_caller_role NOT IN ('admin', 'trabajador', 'profesor', 'profesional') THEN
    RAISE EXCEPTION 'No tienes permisos de administración.' USING errcode = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Identificador de usuario no válido.' USING errcode = '22023';
  END IF;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');
  v_email := lower(trim(coalesce(p_email, '')));
  v_notas := trim(coalesce(p_notas, ''));
  v_rol := lower(trim(coalesce(p_rol, '')));

  UPDATE public.profiles
     SET nombre = CASE WHEN length(v_nombre) > 0 THEN v_nombre ELSE nombre END,
         apellidos = CASE WHEN p_apellidos IS NOT NULL THEN v_apellidos ELSE apellidos END,
         telefono = CASE WHEN p_telefono IS NOT NULL THEN nullif(v_telefono, '') ELSE telefono END,
         fecha_nacimiento = CASE WHEN p_fecha_nacimiento IS NOT NULL THEN p_fecha_nacimiento ELSE fecha_nacimiento END,
         email = CASE WHEN length(v_email) >= 3 AND v_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN v_email ELSE email END,
         notas = CASE WHEN p_notas IS NOT NULL THEN v_notas ELSE notas END,
         rol = CASE WHEN v_caller_role = 'admin' AND length(v_rol) > 0 THEN v_rol ELSE rol END,
         updated_at = timezone('utc', now())
   WHERE id = p_user_id
   RETURNING * INTO v_updated;

  IF NOT found THEN
    RAISE EXCEPTION 'Usuario no encontrado.' USING errcode = 'P0002';
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

GRANT UPDATE (nombre, apellidos, telefono, fecha_nacimiento, email, notas) ON TABLE public.profiles TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
