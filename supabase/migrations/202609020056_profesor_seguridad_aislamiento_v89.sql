-- ============================================================================
-- Migración 202609020056: Seguridad y Aislamiento Estricto para Perfil Profesor (v8.9)
-- Sincronización de profesionales y resolución infalible de clases
-- ============================================================================

begin;

-- 1. Sincronizar emails nulos en la tabla de profesionales para vincular automáticamente con perfiles
update public.profesionales p
set email = pr.email
from public.profiles pr
where pr.rol in ('profesor', 'trabajador', 'profesional')
  and (p.email is null or trim(p.email) = '')
  and (
    lower(trim(p.nombre)) = lower(trim(pr.nombre))
    or (p.nombre ilike '%profesor%' and pr.email ilike '%profesor%')
  );

-- 2. Función RPC para obtener asistencias y reservas con aislamiento estricto
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
  v_actor_key text := '';
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
    -- Determinar si el actor es uno de los 5 profesores oficiales conocidos
    if v_actor_nombre like '%angel%' or v_actor_nombre like '%ángel%' or v_actor_email like '%angel%' then
      v_actor_key := 'angel';
    elsif v_actor_nombre like '%silvia%' or v_actor_email like '%silvia%' then
      v_actor_key := 'silvia';
    elsif v_actor_nombre like '%yanira%' or v_actor_email like '%yanira%' or v_actor_email like '%yaniumana%' then
      v_actor_key := 'yanira';
    elsif v_actor_nombre like '%miriam%' or v_actor_email like '%miriam%' then
      v_actor_key := 'miriam';
    elsif v_actor_nombre like '%isabel%' or v_actor_email like '%isabel%' then
      v_actor_key := 'isabel';
    end if;

    if v_actor_key <> '' then
      -- Profesor oficial conocido: solo resolver su ficha oficial
      select coalesce(array_agg(id), '{}'::int[])
        into v_prof_ids
        from public.profesionales
       where (lower(nombre) like '%' || v_actor_key || '%')
          or (v_actor_key = 'yanira' and (lower(nombre) like '%yanira%' or lower(email) like '%yaniumana%'))
          or (v_actor_email <> '' and lower(trim(coalesce(email, ''))) = v_actor_email);
    else
      -- Profesor de pruebas / personalizado: resolver por email o fichas que no pertenezcan a los 5 oficiales
      select coalesce(array_agg(id), '{}'::int[])
        into v_prof_ids
        from public.profesionales
       where (v_actor_email <> '' and lower(trim(coalesce(email, ''))) = v_actor_email)
          or (
             lower(nombre) not like '%angel%'
         and lower(nombre) not like '%ángel%'
         and lower(nombre) not like '%silvia%'
         and lower(nombre) not like '%yanira%'
         and lower(nombre) not like '%miriam%'
         and lower(nombre) not like '%isabel%'
         and (
           lower(nombre) like '%profesor%'
           or lower(nombre) like '%profe%'
           or lower(nombre) like '%test%'
           or (v_actor_nombre <> '' and lower(nombre) like '%' || v_actor_nombre || '%')
         )
       );
    end if;

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
