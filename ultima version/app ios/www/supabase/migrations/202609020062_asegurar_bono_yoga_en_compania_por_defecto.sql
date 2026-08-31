-- Migration 202609020062: Asegurar bono de Yoga en Compañía por defecto (1) para todas las cuentas nuevas
begin;

-- 1. Asegurar columna y valor por defecto en public.profiles
alter table public.profiles
  add column if not exists saldo_yoga_compania integer not null default 1,
  add column if not exists saldo_clases_gratis integer not null default 1,
  add column if not exists saldo_consultas_gratis integer not null default 1;

alter table public.profiles
  alter column saldo_yoga_compania set default 1,
  alter column saldo_clases_gratis set default 1,
  alter column saldo_consultas_gratis set default 1;

-- 2. Asignar 1 bono de Yoga en Compañía a perfiles que no tengan saldo registrado
update public.profiles
set saldo_yoga_compania = 1
where coalesce(saldo_yoga_compania, 0) = 0
  and lower(trim(coalesce(rol, ''))) not in ('admin', 'profesor', 'profesional');

-- 3. Actualizar trigger de creacion de perfiles en auth.users
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_nombre text;
  v_apellidos text;
  v_telefono text;
  v_fecha_nacimiento date;
  v_auth_method text;
  v_raw_bday text;
begin
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
  v_auth_method := lower(trim(coalesce(
    new.raw_user_meta_data->>'auth_method',
    case
      when new.email ~* '^(movil|telefono)\.[0-9]+@genyoga\.studio$' or new.phone is not null then 'phone'
      else 'email'
    end
  )));
  if v_auth_method not in ('email', 'phone') then
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
    v_auth_method,
    'alumno',
    0,
    0,
    0,
    1,
    1,
    1
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
      auth_method = coalesce(nullif(excluded.auth_method, ''), profiles.auth_method),
      saldo_clases_gratis = coalesce(profiles.saldo_clases_gratis, 1),
      saldo_consultas_gratis = coalesce(profiles.saldo_consultas_gratis, 1),
      saldo_yoga_compania = coalesce(profiles.saldo_yoga_compania, 1);

  return new;
end;
$$;

drop trigger if exists zz_gen_yoga_profile_after_signup on auth.users;
create trigger zz_gen_yoga_profile_after_signup
after insert on auth.users
for each row execute function public.crear_perfil_nuevo_usuario();

commit;
