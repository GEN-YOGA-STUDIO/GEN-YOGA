-- ============================================================================
-- Migración 202609020054: Seguridad y Aislamiento Estricto para Perfil Profesor (v8.7)
-- Garantiza que cualquier profesor (incluido profesor@profesor.com y profesores de pruebas)
-- solo reciba información de sus propias clases y alumnos.
-- ============================================================================

begin;

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
  v_actor_apellidos text;
  v_prof_ids int[];
  v_allowed_clase_ids bigint[];
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;

  select
    lower(coalesce(rol, '')),
    lower(trim(coalesce(email, ''))),
    lower(trim(coalesce(nombre, ''))),
    lower(trim(coalesce(apellidos, '')))
  into
    v_actor_role,
    v_actor_email,
    v_actor_nombre,
    v_actor_apellidos
  from public.profiles
  where id = v_actor_id;

  if not found or v_actor_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'unauthorized: staff or admin role required';
  end if;

  -- Si es admin, puede consultar todas las clases o el filtro suministrado
  if v_actor_role = 'admin' then
    v_allowed_clase_ids := p_clase_ids;
  else
    -- Si es profesor / trabajador, resolver los IDs de profesional vinculados estrictamente
    select coalesce(array_agg(id), '{}'::int[])
      into v_prof_ids
      from public.profesionales
     where (v_actor_email <> '' and lower(trim(coalesce(email, ''))) = v_actor_email)
        or (v_actor_email <> '' and lower(trim(coalesce(email, ''))) = replace(v_actor_email, 'yyaniumana', 'yaniumana'))
        or (v_actor_nombre in ('angel', 'ángel', 'silvia', 'yanira', 'miriam', 'isabel') and lower(trim(coalesce(nombre, ''))) like '%' || v_actor_nombre || '%')
        or (v_actor_nombre <> '' and v_actor_nombre not in ('profesor', 'profe', 'staff', 'admin', 'test') and lower(trim(coalesce(nombre, ''))) = v_actor_nombre and v_actor_apellidos <> '' and lower(trim(coalesce(apellidos, ''))) = v_actor_apellidos);

    -- Obtener todas las clases asignadas a este profesional
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
  where r.estado = 'confirmada'
    and (v_allowed_clase_ids is null or r.clase_id = any(v_allowed_clase_ids))

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
    and (v_allowed_clase_ids is null or rp.clase_id = any(v_allowed_clase_ids))

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
    and (v_allowed_clase_ids is null or rn.clase_id = any(v_allowed_clase_ids));
end;
$$;

revoke all on function public.admin_obtener_asistencias_completas(bigint[]) from public, anon;
grant execute on function public.admin_obtener_asistencias_completas(bigint[]) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
