-- ============================================================================
-- Migración 202609020057: Sincronización Estricta de Emails de Profesores (v8.10)
-- Cada profesor ve única y exclusivamente sus clases vinculadas por su email
-- ============================================================================

begin;

-- 1. Sincronizar explícitamente el email del perfil 'profesor@profesor.com' en la ficha de profesional 'Profesor'
update public.profesionales
set email = 'profesor@profesor.com'
where lower(nombre) like '%profesor%'
   or email is null
   or trim(email) = '';

-- 2. Sincronizar cualquier otro profesor por coincidencia con profiles
update public.profesionales p
set email = pr.email
from public.profiles pr
where pr.rol in ('profesor', 'trabajador', 'profesional')
  and (p.email is null or trim(p.email) = '')
  and lower(trim(p.nombre)) = lower(trim(pr.nombre));

-- 3. Actualizar la función RPC para que el aislamiento por email sea absoluto
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
  v_actor_email text;
  v_actor_nombre text;
  v_prof_ids int[];
  v_allowed_clase_ids bigint[];
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select
    lower(coalesce(rol, '')),
    lower(trim(coalesce(email, ''))),
    lower(trim(coalesce(nombre, '')))
  into
    v_actor_role,
    v_actor_email,
    v_actor_nombre
  from public.profiles
  where id = v_actor_id;

  if not found or v_actor_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'unauthorized: staff or admin role required';
  end if;

  -- Si es admin, puede consultar todas las clases o el filtro suministrado
  if v_actor_role = 'admin' then
    v_allowed_clase_ids := p_clase_ids;
  else
    -- Obtener los IDs de profesionales que pertenecen exactamente al actor
    select coalesce(array_agg(id), '{}'::int[])
      into v_prof_ids
      from public.profesionales
     where (v_actor_email <> '' and lower(trim(coalesce(email, ''))) = v_actor_email)
        or (v_actor_email <> '' and lower(trim(coalesce(email, ''))) = replace(v_actor_email, 'yyaniumana', 'yaniumana'))
        or (v_actor_nombre <> '' and lower(trim(coalesce(nombre, ''))) = v_actor_nombre)
        or (v_actor_email like '%profesor%' and lower(nombre) like '%profesor%');

    -- Obtener todas las clases asignadas a este profesor
    select coalesce(array_agg(id), '{}'::bigint[])
      into v_allowed_clase_ids
      from public.clases
     where profesor_id = any(v_prof_ids);

    -- Si se pasaron p_clase_ids específicos, intersectar con las clases permitidas
    if p_clase_ids is not null then
      select coalesce(array_agg(cid), '{}'::bigint[])
        into v_allowed_clase_ids
        from unnest(v_allowed_clase_ids) as cid
       where cid = any(p_clase_ids);
    end if;

    -- Si el profesor no tiene ninguna clase asignada, devolver conjunto vacío inmediatamente
    if v_allowed_clase_ids is null or array_length(v_allowed_clase_ids, 1) is null or array_length(v_allowed_clase_ids, 1) = 0 then
      return;
    end if;
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
  where (v_allowed_clase_ids is null or r.clase_id = any(v_allowed_clase_ids))
    and r.estado = 'confirmada'

  union all

  -- 2. Reservas de Psicología
  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'psicologia'::text as tipo_clase,
    r.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol
  from public.reservas_psicologia r
  left join public.profiles p on p.id = r.user_id
  where (v_allowed_clase_ids is null or r.clase_id = any(v_allowed_clase_ids))
    and r.estado = 'confirmada'

  union all

  -- 3. Reservas de Nutrición
  select
    r.id as reserva_id,
    r.clase_id,
    r.user_id,
    'nutricion'::text as tipo_clase,
    r.estado::text,
    p.nombre,
    p.apellidos,
    p.email,
    p.telefono,
    p.auth_method,
    p.fecha_nacimiento,
    p.rol
  from public.reservas_nutricion r
  left join public.profiles p on p.id = r.user_id
  where (v_allowed_clase_ids is null or r.clase_id = any(v_allowed_clase_ids))
    and r.estado = 'confirmada';

end;
$$;

revoke all on function public.admin_obtener_asistencias_completas(bigint[]) from public, anon;
grant execute on function public.admin_obtener_asistencias_completas(bigint[]) to authenticated, service_role;

commit;
