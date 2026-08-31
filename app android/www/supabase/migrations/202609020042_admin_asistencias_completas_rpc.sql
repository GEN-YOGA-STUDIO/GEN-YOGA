-- ============================================================================
-- Migración 202609020042: RPC para obtención completa y segura de asistencias
-- y datos de contacto de alumnos para Administrador y Profesionales
-- ============================================================================

begin;

-- 1. Crear función RPC con SECURITY DEFINER para consultar todas las reservas y perfiles asociados
create or replace function public.admin_obtener_asistencias_completas(
  p_clase_ids bigint[] default null
)
returns table (
  reserva_id bigint,
  clase_id bigint,
  user_id uuid,
  tipo_clase text,
  estado text,
  nombre text,
  apellidos text,
  email text,
  telefono text,
  auth_method text,
  fecha_nacimiento date,
  rol text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select lower(coalesce(rol, '')) into v_actor_role
    from public.profiles
   where id = v_actor_id;

  if not found or v_actor_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'unauthorized: staff or admin role required';
  end if;

  return query
  -- 1. Reservas de Yoga
  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'yoga'::text as tipo_clase,
    r.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol
  from public.reservas_yoga r
  left join public.profiles p on p.id = r.user_id
  where r.estado = 'confirmada'
    and (p_clase_ids is null or r.clase_id = any(p_clase_ids))

  union all

  -- 2. Reservas de Psicología
  select
    rp.id as reserva_id,
    rp.clase_id,
    rp.user_id,
    'psicologia'::text as tipo_clase,
    rp.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol
  from public.reservas_psicologia rp
  left join public.profiles p on p.id = rp.user_id
  where rp.estado = 'confirmada'
    and (p_clase_ids is null or rp.clase_id = any(p_clase_ids))

  union all

  -- 3. Reservas de Nutrición
  select
    rn.id as reserva_id,
    rn.clase_id,
    rn.user_id,
    'nutricion'::text as tipo_clase,
    rn.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol
  from public.reservas_nutricion rn
  left join public.profiles p on p.id = rn.user_id
  where rn.estado = 'confirmada'
    and (p_clase_ids is null or rn.clase_id = any(p_clase_ids));
end;
$$;

revoke all on function public.admin_obtener_asistencias_completas(bigint[]) from public, anon;
grant execute on function public.admin_obtener_asistencias_completas(bigint[]) to authenticated, service_role;

-- 2. Reafirmar permisos SELECT sobre las tablas para clientes autenticados
grant select on table public.profiles to authenticated;
grant select on table public.reservas_yoga to authenticated;
grant select on table public.reservas_psicologia to authenticated;
grant select on table public.reservas_nutricion to authenticated;

notify pgrst, 'reload schema';

commit;
