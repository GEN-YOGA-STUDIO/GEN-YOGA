-- ============================================================================
-- Migración v8.19: RPC para Creación Directa y Atómica de Clientes de Mostrador
-- Permite tanto al Administrador como al Personal (profesores, trabajadores)
-- crear clientes desde el mostrador sin depender de Edge Functions externas.
-- ============================================================================

begin;

create or replace function public.admin_crear_cliente_mostrador(
  p_nombre text,
  p_apellidos text default '',
  p_bonos int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_nombre text;
  v_apellidos text;
  v_bonos int := coalesce(p_bonos, 0);
  v_profile_id uuid := gen_random_uuid();
  v_email text;
  v_created public.profiles%rowtype;
begin
  if v_caller_id is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))) into v_caller_role
  from public.profiles where id = v_caller_id;

  if v_caller_role not in ('admin', 'trabajador', 'profesor', 'profesional') then
    raise exception 'Permisos insuficientes para crear clientes.' using errcode = '42501';
  end if;

  v_nombre := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_apellidos := regexp_replace(trim(coalesce(p_apellidos, '')), '\s+', ' ', 'g');

  if length(v_nombre) < 1 then
    raise exception 'El nombre es obligatorio.' using errcode = '22023';
  end if;

  if v_bonos < 0 or v_bonos > 10000 then
    raise exception 'Los bonos deben estar entre 0 y 10000.' using errcode = '22023';
  end if;

  v_email := 'mostrador+' || substr(md5(v_profile_id::text || clock_timestamp()::text), 1, 16) || '@genyoga.studio';

  insert into public.profiles (
    id,
    email,
    nombre,
    apellidos,
    rol,
    bonos,
    saldo_clases_gratis,
    saldo_consultas_gratis,
    saldo_yoga_compania
  )
  values (
    v_profile_id,
    v_email,
    v_nombre,
    v_apellidos,
    'cliente',
    v_bonos,
    1,
    1,
    1
  )
  returning * into v_created;

  return to_jsonb(v_created);
end;
$$;

revoke all on function public.admin_crear_cliente_mostrador(text, text, int) from public, anon;
grant execute on function public.admin_crear_cliente_mostrador(text, text, int) to authenticated, service_role;

commit;
