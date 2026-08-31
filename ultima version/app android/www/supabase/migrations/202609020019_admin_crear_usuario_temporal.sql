-- ============================================================================
-- Migration 202609020019: RPC para crear o recuperar usuarios temporales
-- ============================================================================

begin;

create or replace function public.admin_crear_o_obtener_usuario_temporal(
  p_nombre text,
  p_apellidos text default '',
  p_email text default null,
  p_telefono text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_user_id uuid;
  v_clean_email text;
  v_clean_nombre text;
  v_clean_apellidos text;
  v_clean_telefono text;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select lower(coalesce(rol, ''))
    into v_actor_role
    from public.profiles
   where id = v_actor_id;

  if not found or v_actor_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'unauthorized: staff or admin role required';
  end if;

  v_clean_nombre := trim(coalesce(p_nombre, ''));
  if v_clean_nombre = '' then
    raise exception 'El nombre es obligatorio';
  end if;

  v_clean_apellidos := trim(coalesce(p_apellidos, ''));
  v_clean_telefono := trim(coalesce(p_telefono, ''));
  v_clean_email := lower(trim(coalesce(p_email, '')));

  -- 1. Si se proporciona email y ya existe en profiles, retornar su id y actualizar datos
  if v_clean_email <> '' then
    select id into v_user_id
      from public.profiles
     where lower(trim(email)) = v_clean_email
     limit 1;

    if v_user_id is not null then
      update public.profiles
         set
           nombre = coalesce(nullif(nombre, ''), v_clean_nombre),
           apellidos = coalesce(nullif(apellidos, ''), v_clean_apellidos),
           telefono = coalesce(nullif(telefono, ''), v_clean_telefono)
       where id = v_user_id;

      return v_user_id;
    end if;
  else
    -- Generar email ficticio temporal único si no se aportó
    v_clean_email := 'paciente.' || substr(md5(random()::text || clock_timestamp()::text), 1, 10) || '@temporal.genyoga.studio';
  end if;

  -- 2. Crear nuevo perfil temporal/rápido
  v_user_id := gen_random_uuid();

  insert into public.profiles (
    id,
    nombre,
    apellidos,
    email,
    telefono,
    rol,
    saldo_clases,
    saldo_psicologia,
    saldo_nutricion,
    activo
  ) values (
    v_user_id,
    v_clean_nombre,
    v_clean_apellidos,
    v_clean_email,
    v_clean_telefono,
    'cliente',
    0,
    0,
    0,
    true
  );

  return v_user_id;
end;
$$;

revoke all on function public.admin_crear_o_obtener_usuario_temporal(text, text, text, text) from public, anon;
grant execute on function public.admin_crear_o_obtener_usuario_temporal(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
