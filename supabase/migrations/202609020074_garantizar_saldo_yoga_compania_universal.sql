-- ==============================================================================
-- Migración 202609020074: Garantizar Bono Yoga en Compañía y Bienvenida Universal
-- GEN YOGA v9.12
-- ==============================================================================

BEGIN;

-- 1. Asegurar valores por defecto a nivel de esquema en la tabla profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saldo_yoga_compania integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS saldo_clases_gratis integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS saldo_consultas_gratis integer NOT NULL DEFAULT 1;

ALTER TABLE public.profiles
  ALTER COLUMN saldo_yoga_compania SET DEFAULT 1,
  ALTER COLUMN saldo_clases_gratis SET DEFAULT 1,
  ALTER COLUMN saldo_consultas_gratis SET DEFAULT 1;

-- 2. Asegurar que los perfiles existentes sin uso previo reciban su bono de Yoga en Compañía (1)
UPDATE public.profiles p
   SET saldo_yoga_compania = 1
 WHERE coalesce(p.saldo_yoga_compania, 0) <= 0
   AND lower(trim(coalesce(p.rol, ''))) NOT IN ('admin', 'profesor', 'profesional')
   AND NOT EXISTS (
     SELECT 1 FROM public.reservas_yoga r 
      WHERE r.user_id = p.id 
        AND r.welcome_companion_modality IS NOT NULL
        AND r.estado = 'confirmada'
   );

-- 3. Trigger absoluto en auth.users para registro de nuevos usuarios
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
    saldo_psicologia,
    saldo_nutricion,
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
    0,
    0,
    1, -- 1 Bono Bienvenida / Sesión Gratuita
    1, -- 1 Consulta Gratuita
    1  -- 1 Bono Yoga en Compañía OBLIGATORIO Y AUTOMÁTICO
  )
  on conflict (id) do update
  set nombre = case
        when nullif(trim(coalesce(profiles.nombre, '')), '') is null
          then excluded.nombre
        else profiles.nombre
      end,
      apellidos = case
        when nullif(trim(coalesce(profiles.apellidos, '')), '') is null
          then excluded.apellidos
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
end;
$$;

drop trigger if exists zz_gen_yoga_profile_after_signup on auth.users;
create trigger zz_gen_yoga_profile_after_signup
after insert on auth.users
for each row execute function public.crear_perfil_nuevo_usuario();


-- 4. RPC para asegurar saldos de bienvenida en el perfil
CREATE OR REPLACE FUNCTION public.asegurar_saldos_bienvenida_usuario()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.profiles%ROWTYPE;
  v_has_companion_booking boolean;
  v_has_free_booking boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  SELECT * INTO v_p FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT found THEN
    RETURN jsonb_build_object('success', false, 'error', 'Perfil no encontrado');
  END IF;

  -- Comprobar si ya ha usado los bonos previamente
  SELECT EXISTS(
    SELECT 1 FROM public.reservas_yoga 
     WHERE user_id = v_uid AND welcome_companion_modality IS NOT NULL AND estado = 'confirmada'
  ) INTO v_has_companion_booking;

  SELECT EXISTS(
    SELECT 1 FROM public.reservas_yoga 
     WHERE user_id = v_uid AND saldo_gratis_descontado = true AND estado = 'confirmada'
  ) INTO v_has_free_booking;

  -- Si nunca ha usado Yoga en Compañía y su saldo es 0, restablecer a 1
  IF NOT v_has_companion_booking AND coalesce(v_p.saldo_yoga_compania, 0) < 1 THEN
    UPDATE public.profiles SET saldo_yoga_compania = 1 WHERE id = v_uid;
    v_p.saldo_yoga_compania := 1;
  END IF;

  -- Si nunca ha usado Clase Gratis y su saldo es 0, restablecer a 1
  IF NOT v_has_free_booking AND coalesce(v_p.saldo_clases_gratis, 0) < 1 THEN
    UPDATE public.profiles SET saldo_clases_gratis = 1 WHERE id = v_uid;
    v_p.saldo_clases_gratis := 1;
  END IF;

  -- Consulta gratis siempre al menos 1 para clientes si no la han consumido
  IF coalesce(v_p.saldo_consultas_gratis, 0) < 1 THEN
    UPDATE public.profiles SET saldo_consultas_gratis = 1 WHERE id = v_uid;
    v_p.saldo_consultas_gratis := 1;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'saldo_yoga_compania', v_p.saldo_yoga_compania,
    'saldo_clases_gratis', v_p.saldo_clases_gratis,
    'saldo_consultas_gratis', v_p.saldo_consultas_gratis
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asegurar_saldos_bienvenida_usuario() FROM public;
GRANT EXECUTE ON FUNCTION public.asegurar_saldos_bienvenida_usuario() TO authenticated, service_role;

COMMIT;
