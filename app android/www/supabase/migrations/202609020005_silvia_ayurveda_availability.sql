begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Retira únicamente el hueco legado de "consultas" de Silvia que quedó fuera
-- del nuevo horario. El predicado no depende de ids generados y aborta el
-- borrado si apareció cualquier reserva o pase asociado entre la auditoría y
-- la ejecución de esta migración.
with invalid_legacy_slot as (
  select class.id
    from public.clases as class
    join public.profesionales as professional
      on professional.id = class.profesor_id
   where lower(trim(professional.nombre)) = 'silvia'
     and class.nombre = 'Yoga (Silvia) Consultas'
     and class.tipo_clase = 'yoga'
     and class.fecha_inicio = make_timestamptz(2026, 8, 28, 11, 30, 0, 'Europe/Madrid')
     and class.fecha_fin = make_timestamptz(2026, 8, 28, 13, 30, 0, 'Europe/Madrid')
     and not exists (select 1 from public.reservas_yoga as booking where booking.clase_id = class.id)
     and not exists (select 1 from public.reservas_psicologia as booking where booking.clase_id = class.id)
     and not exists (select 1 from public.reservas_nutricion as booking where booking.clase_id = class.id)
     and not exists (select 1 from public.reservas_talleres as booking where booking.clase_id = class.id)
     and not exists (select 1 from public.unlimited_guest_passes as pass where pass.class_id = class.id)
)
delete from public.clases as class
 using invalid_legacy_slot as invalid
 where class.id = invalid.id;

-- Esta es la definición autoritativa final. Se coloca después de las
-- migraciones 202609020003/004 para que una instalación nueva no recupere la
-- versión antigua que aceptaba cualquier día y forzaba 60 minutos.
create or replace function public.reservar_consulta_virtual(
  p_tipo text,
  p_profesor_id bigint,
  p_fecha_inicio timestamptz,
  p_user_id uuid,
  p_cobrar_saldo boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_clase_id bigint;
  v_nombre_clase text;
  v_duracion integer := 60;
  v_fecha_fin timestamptz;
  v_professional_identity text;
  v_local_start timestamp without time zone;
  v_local_weekday integer;
  v_local_time time without time zone;
  v_standard_start_times constant time without time zone[] := array[
    '09:30'::time,
    '10:30'::time,
    '11:30'::time,
    '12:30'::time,
    '13:30'::time,
    '17:00'::time,
    '18:00'::time,
    '19:00'::time,
    '20:00'::time
  ];
  v_silvia_start_times constant time without time zone[] := array[
    '15:00'::time,
    '16:30'::time,
    '18:00'::time
  ];
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion') then
    raise exception 'invalid consultation type';
  end if;
  if p_profesor_id is null or p_user_id is null or p_fecha_inicio is null then
    raise exception 'invalid parameters';
  end if;
  if p_fecha_inicio <= now() then
    raise exception 'consultation slot must be in the future';
  end if;

  select lower(concat_ws(
    ' ',
    coalesce(professional.nombre, ''),
    coalesce(professional.apellidos, ''),
    coalesce(professional.email, '')
  ))
    into v_professional_identity
    from public.profesionales as professional
   where professional.id = p_profesor_id
     and professional.visible_publico is true;
  if not found then
    raise exception 'consultation professional not found';
  end if;

  v_local_start := p_fecha_inicio at time zone 'Europe/Madrid';
  v_local_weekday := extract(isodow from v_local_start)::integer;
  v_local_time := v_local_start::time;

  if v_professional_identity like '%miriam%' then
    if p_tipo <> 'psicologia'
      or v_local_weekday not in (2, 3)
      or not (v_local_time = any(v_standard_start_times)) then
      raise exception 'Miriam is not available at the requested time';
    end if;
  elsif v_professional_identity like '%isabel%' then
    if p_tipo <> 'psicologia'
      or v_local_weekday not in (2, 4)
      or not (v_local_time = any(v_standard_start_times)) then
      raise exception 'Isabel is not available at the requested time';
    end if;
  elsif v_professional_identity like '%silvia%' then
    if p_tipo <> 'nutricion'
      or v_local_weekday <> 5
      or mod(v_local_start::date - date '2026-06-19', 14) <> 0
      or not (v_local_time = any(v_silvia_start_times)) then
      raise exception 'Silvia is not available at the requested time';
    end if;
    v_duracion := 90;
  end if;

  -- Evita materializar dos clases equivalentes ante reservas simultáneas.
  perform pg_advisory_xact_lock(
    hashtextextended(p_profesor_id::text || ':' || p_fecha_inicio::text, 0)
  );

  select class.id
    into v_clase_id
    from public.clases as class
   where class.profesor_id = p_profesor_id
     and lower(coalesce(class.tipo_clase, '')) = p_tipo
     and class.fecha_inicio = p_fecha_inicio
     and class.activa is true
   order by class.id
   limit 1;

  if v_clase_id is null then
    v_nombre_clase := case
      when v_professional_identity like '%silvia%' then 'Consulta Ayurveda'
      when p_tipo = 'psicologia' and v_professional_identity like '%isabel%'
        then 'Consulta PNI / Psicología'
      when p_tipo = 'psicologia' then 'Consulta Psicología'
      else 'Consulta Nutrición'
    end;
    v_fecha_fin := p_fecha_inicio + make_interval(mins => v_duracion);

    insert into public.clases (
      nombre,
      fecha_inicio,
      fecha_fin,
      capacidad_max,
      profesor_id,
      tipo_clase,
      duracion_minutos,
      activa
    ) values (
      v_nombre_clase,
      p_fecha_inicio,
      v_fecha_fin,
      1,
      p_profesor_id,
      p_tipo,
      v_duracion,
      true
    ) returning id into v_clase_id;
  end if;

  perform public.reservar_consulta_atomica(
    p_tipo,
    v_clase_id,
    p_user_id,
    p_cobrar_saldo
  );

  return v_clase_id;
end;
$function$;

-- La validación se repite al reservar una clase ya materializada. Así una
-- fila creada desde el panel de administración no puede saltarse el horario.
create or replace function public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid default null,
  p_cobrar_saldo boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_target_role text;
  v_class_type text;
  v_capacity integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_duration integer;
  v_professor_id public.clases.profesor_id%type;
  v_professional_identity text;
  v_local_start timestamp without time zone;
  v_occupied integer;
  v_reservation_id bigint;
  v_actor_is_staff boolean;
  v_target_is_client boolean;
  v_charge_credit boolean;
  v_silvia_start_times constant time without time zone[] := array[
    '15:00'::time,
    '16:30'::time,
    '18:00'::time
  ];
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion') then
    raise exception 'invalid consultation type';
  end if;
  if p_clase_id is null or p_clase_id <= 0 or v_target_id is null then
    raise exception 'invalid booking request';
  end if;

  select lower(coalesce(profile.rol, '')), lower(nullif(trim(profile.email), ''))
    into v_actor_role, v_actor_email
    from public.profiles as profile
   where profile.id = v_actor_id;
  if not found then
    raise exception 'actor profile not found';
  end if;

  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'not allowed to book for another user';
  end if;

  -- Serializa todas las reservas del mismo hueco antes de comprobar aforo.
  select
    lower(coalesce(class.tipo_clase, '')),
    coalesce(class.capacidad_max, 0),
    class.fecha_inicio,
    class.fecha_fin,
    class.duracion_minutos,
    class.profesor_id,
    lower(concat_ws(
      ' ',
      coalesce(professional.nombre, ''),
      coalesce(professional.apellidos, ''),
      coalesce(professional.email, '')
    ))
    into
      v_class_type,
      v_capacity,
      v_starts_at,
      v_ends_at,
      v_duration,
      v_professor_id,
      v_professional_identity
    from public.clases as class
    left join public.profesionales as professional
      on professional.id = class.profesor_id
   where class.id = p_clase_id
   for update of class;
  if not found or v_class_type <> p_tipo then
    raise exception 'consultation slot not found';
  end if;
  if v_capacity <= 0 then
    raise exception 'consultation has no available capacity';
  end if;
  if v_starts_at is null or v_starts_at <= now() then
    raise exception 'consultation slot is no longer bookable';
  end if;

  if v_professional_identity like '%silvia%' then
    v_local_start := v_starts_at at time zone 'Europe/Madrid';
    if p_tipo <> 'nutricion'
      or extract(isodow from v_local_start)::integer <> 5
      or mod(v_local_start::date - date '2026-06-19', 14) <> 0
      or not (v_local_start::time = any(v_silvia_start_times))
      or v_ends_at <> v_starts_at + interval '90 minutes'
      or coalesce(v_duration, 0) <> 90 then
      raise exception 'Silvia consultation slot is outside the allowed schedule';
    end if;
  end if;

  if v_actor_is_staff and v_actor_role <> 'admin' and not exists (
    select 1
      from public.profesionales as professional
     where professional.id = v_professor_id
       and lower(nullif(trim(professional.email), '')) = v_actor_email
  ) then
    raise exception 'staff may only manage consultation slots linked to their professional profile';
  end if;

  select lower(coalesce(profile.rol, ''))
    into v_target_role
    from public.profiles as profile
   where profile.id = v_target_id
   for update;
  if not found then
    raise exception 'client profile not found';
  end if;

  v_target_is_client := v_target_role not in ('admin', 'profesor', 'trabajador', 'profesional');
  if not v_target_is_client then
    raise exception 'consultations can only be booked for client profiles';
  end if;
  v_charge_credit := not v_actor_is_staff or coalesce(p_cobrar_saldo, true);

  if p_tipo = 'psicologia' then
    if exists (
      select 1
        from public.reservas_psicologia
       where clase_id = p_clase_id
         and user_id = v_target_id
         and estado = 'confirmada'
    ) then
      raise exception 'consultation already booked';
    end if;
    select count(*)::integer
      into v_occupied
      from public.reservas_psicologia
     where clase_id = p_clase_id
       and estado = 'confirmada';
  else
    if exists (
      select 1
        from public.reservas_nutricion
       where clase_id = p_clase_id
         and user_id = v_target_id
         and estado = 'confirmada'
    ) then
      raise exception 'consultation already booked';
    end if;
    select count(*)::integer
      into v_occupied
      from public.reservas_nutricion
     where clase_id = p_clase_id
       and estado = 'confirmada';
  end if;

  if v_occupied >= v_capacity then
    raise exception 'consultation is full';
  end if;

  if v_charge_credit and p_tipo = 'psicologia' then
    update public.profiles
       set saldo_psicologia = saldo_psicologia - 1
     where id = v_target_id
       and saldo_psicologia >= 1;
    if not found then
      raise exception 'insufficient psychology credit';
    end if;
  elsif v_charge_credit and p_tipo = 'nutricion' then
    update public.profiles
       set saldo_nutricion = saldo_nutricion - 1
     where id = v_target_id
       and saldo_nutricion >= 1;
    if not found then
      raise exception 'insufficient nutrition credit';
    end if;
  end if;

  if p_tipo = 'psicologia' then
    insert into public.reservas_psicologia (clase_id, user_id, estado, saldo_descontado)
    values (p_clase_id, v_target_id, 'confirmada', v_charge_credit)
    returning id into v_reservation_id;
  else
    insert into public.reservas_nutricion (clase_id, user_id, estado, saldo_descontado)
    values (p_clase_id, v_target_id, 'confirmada', v_charge_credit)
    returning id into v_reservation_id;
  end if;

  return v_reservation_id;
end;
$function$;

revoke all on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean)
  to authenticated;

revoke all on function public.reservar_consulta_atomica(text, bigint, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.reservar_consulta_atomica(text, bigint, uuid, boolean)
  to authenticated;

comment on function public.reservar_consulta_virtual(text, bigint, timestamptz, uuid, boolean)
  is 'Materializa y reserva consultas permitidas. Silvia: viernes alternos desde 2026-06-19, 15:00/16:30/18:00, 90 minutos, Europe/Madrid.';
comment on function public.reservar_consulta_atomica(text, bigint, uuid, boolean)
  is 'Reserva consultas atómicamente y revalida el horario autoritativo de Ayurveda para Silvia.';

notify pgrst, 'reload schema';

commit;
