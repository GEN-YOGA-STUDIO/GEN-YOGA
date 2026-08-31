-- ==============================================================================
-- Migración 202609020072: Asignación Obligatoria y Automática de Bono de Yoga en Compañía
-- GEN YOGA v9.13
-- Garantiza que cada cuenta nueva (vía web, app, teléfono, mostrador o trigger)
-- tenga asignado obligatoriamente:
--   * saldo_yoga_compania = 1
--   * saldo_clases_gratis = 1
--   * saldo_consultas_gratis = 1
-- ==============================================================================

BEGIN;

-- 1. Asegurar columnas con valor por defecto 1 en public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saldo_yoga_compania integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS saldo_clases_gratis integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS saldo_consultas_gratis integer NOT NULL DEFAULT 1;

ALTER TABLE public.profiles
  ALTER COLUMN saldo_yoga_compania SET DEFAULT 1,
  ALTER COLUMN saldo_clases_gratis SET DEFAULT 1,
  ALTER COLUMN saldo_consultas_gratis SET DEFAULT 1;

-- 2. Asegurar que todos los clientes existentes tengan al menos 1 bono de Yoga en Compañía
UPDATE public.profiles
   SET saldo_yoga_compania = 1
 WHERE COALESCE(saldo_yoga_compania, 0) <= 0
   AND lower(trim(COALESCE(rol, ''))) NOT IN ('admin', 'profesor', 'profesional');

UPDATE public.profiles
   SET saldo_clases_gratis = 1
 WHERE COALESCE(saldo_clases_gratis, 0) <= 0
   AND lower(trim(COALESCE(rol, ''))) NOT IN ('admin', 'profesor', 'profesional');

UPDATE public.profiles
   SET saldo_consultas_gratis = 1
 WHERE COALESCE(saldo_consultas_gratis, 0) <= 0
   AND lower(trim(COALESCE(rol, ''))) NOT IN ('admin', 'profesor', 'profesional');

-- 3. Actualizar trigger global de creación de perfil tras registro en auth.users
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
    1, -- 1 Bono Bienvenida
    1, -- 1 Consulta Gratuita
    1  -- 1 Bono Yoga en Compañía OBLIGATORIO
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

COMMIT;
