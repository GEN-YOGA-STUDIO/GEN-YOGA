-- Migración 202609020041: Método de autenticación principal (Email o Teléfono) y sincronización de perfil
begin;

-- 1. Añadir columnas a public.profiles si no existen
alter table public.profiles
  add column if not exists auth_method text not null default 'email',
  add column if not exists telefono text default null,
  add column if not exists fecha_nacimiento date default null;

-- 2. Función trigger para creación de perfil tras registro en auth.users
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
    saldo_consultas_gratis
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
      saldo_consultas_gratis = coalesce(profiles.saldo_consultas_gratis, 1);

  return new;
end;
$$;

drop trigger if exists zz_gen_yoga_profile_after_signup on auth.users;
create trigger zz_gen_yoga_profile_after_signup
after insert on auth.users
for each row execute function public.crear_perfil_nuevo_usuario();

-- 3. Actualizar función RPC para editar perfil del usuario autenticado
create or replace function public.actualizar_mi_perfil(
  p_nombre text,
  p_apellidos text default '',
  p_fecha_nacimiento date default null,
  p_telefono text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
declare
  v_nombre text;
  v_apellidos text;
  v_telefono text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');
  v_telefono := regexp_replace(trim(coalesce(p_telefono, '')), '[^0-9+]', '', 'g');

  if length(v_nombre) < 1 or length(v_nombre) > 80 or v_nombre ~ '[[:cntrl:]<>&]' then
    raise exception 'invalid first name' using errcode = '22023';
  end if;
  if length(v_apellidos) > 120 or v_apellidos ~ '[[:cntrl:]<>&]' then
    raise exception 'invalid last name' using errcode = '22023';
  end if;

  update public.profiles
  set nombre = v_nombre,
      apellidos = v_apellidos,
      fecha_nacimiento = coalesce(p_fecha_nacimiento, fecha_nacimiento),
      telefono = coalesce(nullif(v_telefono, ''), telefono)
  where id = auth.uid()
    and not coalesce(account_deletion_pending, false);

  if not found then
    raise exception 'profile not found or deletion pending' using errcode = 'P0002';
  end if;
end;
$func$;

revoke all on function public.actualizar_mi_perfil(text, text, date, text) from public, anon;
grant execute on function public.actualizar_mi_perfil(text, text, date, text) to authenticated;

notify pgrst, 'reload schema';

commit;
