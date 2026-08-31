-- ============================================================================
-- Migration 202609020026: Sistema de Sesiones Gratuitas e Introductorias y Bonos de Bienvenida
-- ============================================================================

begin;

-- 1. Añadir columnas a public.profiles para saldos gratuitos
alter table public.profiles
  add column if not exists saldo_clases_gratis integer not null default 1,
  add column if not exists saldo_consultas_gratis integer not null default 1;

-- Asegurar que los perfiles existentes tengan 1 bono de cada tipo si estaban a 0 o nulos
update public.profiles
set
  saldo_clases_gratis = coalesce(saldo_clases_gratis, 1),
  saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 1);

-- 2. Añadir columna es_gratuita a public.clases
alter table public.clases
  add column if not exists es_gratuita boolean not null default false;

-- 3. Actualizar función crear_perfil_nuevo_usuario para incluir saldos gratuitos
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_nombre text;
  v_apellidos text;
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

  if length(v_nombre) < 1
    or length(v_nombre) > 80
    or v_nombre ~ '[[:cntrl:]<>&]' then
    v_nombre := 'Alumno';
  end if;
  if length(v_apellidos) > 120
    or v_apellidos ~ '[[:cntrl:]<>&]' then
    v_apellidos := '';
  end if;

  insert into public.profiles (
    id,
    nombre,
    apellidos,
    email,
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
      saldo_clases_gratis = coalesce(profiles.saldo_clases_gratis, 1),
      saldo_consultas_gratis = coalesce(profiles.saldo_consultas_gratis, 1);

  return new;
end;
$$;

-- 4. Actualizar función ajustar_saldo_usuario para admitir clases_gratis y consultas_gratis
create or replace function public.ajustar_saldo_usuario(
  p_user_id uuid,
  p_tipo text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_new_balance integer;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is null or p_tipo is null or p_tipo not in (
    'yoga', 'psicologia', 'nutricion', 'clases_gratis', 'consultas_gratis'
  ) then
    raise exception 'invalid balance adjustment';
  end if;
  if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
    raise exception 'invalid balance delta';
  end if;

  select lower(coalesce(rol, '')) into v_actor_role
    from public.profiles
   where id = v_actor_id;
  if not found or v_actor_role <> 'admin' then
    raise exception 'only administrators may adjust balances';
  end if;

  select lower(coalesce(rol, '')) into v_target_role
    from public.profiles
   where id = p_user_id
   for update;
  if not found then
    raise exception 'client profile not found';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'staff balances cannot be adjusted';
  end if;

  if p_tipo = 'yoga' then
    update public.profiles
       set bonos = greatest(coalesce(bonos, 0) + p_delta, 0)
     where id = p_user_id
     returning bonos into v_new_balance;
  elsif p_tipo = 'psicologia' then
    update public.profiles
       set saldo_psicologia = greatest(coalesce(saldo_psicologia, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_psicologia into v_new_balance;
  elsif p_tipo = 'nutricion' then
    update public.profiles
       set saldo_nutricion = greatest(coalesce(saldo_nutricion, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_nutricion into v_new_balance;
  elsif p_tipo = 'clases_gratis' then
    update public.profiles
       set saldo_clases_gratis = greatest(coalesce(saldo_clases_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_clases_gratis into v_new_balance;
  elsif p_tipo = 'consultas_gratis' then
    update public.profiles
       set saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;
  end if;

  return v_new_balance;
end;
$$;

revoke all on function public.ajustar_saldo_usuario(uuid, text, integer) from public, anon;
grant execute on function public.ajustar_saldo_usuario(uuid, text, integer) to authenticated;

-- 5. Actualizar reservar_con_bono para gestionar clases gratuitas
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_role text;
  v_target_id uuid := p_user_id;
  v_legacy_credits integer;
  v_unlimited_active boolean;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean;
  v_professor_id public.clases.profesor_id%type;
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_unlimited boolean := false;
  v_pack_id bigint;
  v_special_count integer := 0;
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesión para reservar.' using errcode = '42501';
  end if;
  if p_clase_id is null or p_clase_id <= 0 or v_target_id is null then
    raise exception 'La solicitud de reserva no es válida.' using errcode = '22023';
  end if;

  select lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    into v_actor_role, v_actor_email
    from public.profiles where id = v_actor_id;
  if not found then
    raise exception 'No se encontró el perfil que realiza la reserva.' using errcode = 'P0002';
  end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'No puedes reservar una clase para otra persona.' using errcode = '42501';
  end if;

  select coalesce(capacidad_max, 0), fecha_inicio,
         lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false)
    into v_capacity, v_starts_at, v_class_type, v_class_active,
         v_professor_id, v_is_free
    from public.clases where id = p_clase_id for update;
  if not found or v_class_type not in ('yoga', 'taller') or not v_class_active then
    raise exception 'La clase especificada no está disponible.' using errcode = 'P0002';
  end if;
  v_is_special := v_class_type = 'taller';
  if v_starts_at is null then
    raise exception 'La clase no tiene una hora de inicio válida.' using errcode = '22023';
  end if;
  if v_capacity <= 0 then
    raise exception 'La clase no tiene plazas disponibles.' using errcode = 'P0001';
  end if;
  if v_target_id <> v_actor_id and v_actor_role <> 'admin'
    and not exists (
      select 1 from public.profesionales
       where id = v_professor_id
         and lower(nullif(trim(email), '')) = v_actor_email
    ) then
    raise exception 'Solo puedes gestionar reservas de tus propias clases.' using errcode = '42501';
  end if;

  begin
    select case when trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
      then least(168, greatest(0, trim(valor)::integer)) else 12 end
      into v_booking_limit_hours
      from public.configuracion where clave = 'horas_limite_reserva' limit 1;
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_booking_limit_hours := 12;
  end;
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);
  if not v_actor_is_staff
    and v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) then
    raise exception 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.reservas_yoga
     where clase_id = p_clase_id and user_id = v_target_id and estado = 'confirmada'
  ) then
    raise exception 'Ya tienes una reserva confirmada para esta clase.' using errcode = '23505';
  end if;
  select count(*)::integer into v_occupied
    from public.reservas_yoga
   where clase_id = p_clase_id and estado = 'confirmada';
  if v_occupied >= v_capacity then
    raise exception 'La clase está completa.' using errcode = 'P0001';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(bonos, 0),
         coalesce(bono_mensual_activo, false), bono_mensual_inicio, bono_mensual_fin
    into v_target_role, v_legacy_credits, v_unlimited_active,
         v_membership_start, v_membership_end
    from public.profiles where id = v_target_id for update;
  if not found then
    raise exception 'No se encontró el perfil del alumno.' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo los alumnos pueden reservar clases.' using errcode = '42501';
  end if;

  -- CASO 1: Si es una clase gratuita, se descuenta de saldo_clases_gratis
  if v_is_free then
    update public.profiles
       set saldo_clases_gratis = saldo_clases_gratis - 1
     where id = v_target_id
       and (saldo_clases_gratis >= 1 or v_actor_role = 'admin');
    if not found then
      raise exception 'Ya has utilizado tu bono de clase gratuita o no dispones de saldo gratis suficiente.'
        using errcode = 'P0001';
    end if;

    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null
    );
    return;
  end if;

  -- CASO 2: Clases regulares o talleres de pago
  select starts_at, ends_at
    into v_natural_membership_start, v_natural_membership_end
    from public.unlimited_membership_periods
   where user_id = v_target_id
     and starts_at <= v_starts_at
     and ends_at > v_starts_at
   order by starts_at desc
   limit 1
   for share;
  if found then
    v_unlimited_active := true;
    v_membership_start := v_natural_membership_start;
    v_membership_end := v_natural_membership_end;
  end if;

  if v_unlimited_active
    and v_membership_start is not null and v_membership_end is not null
    and v_starts_at >= v_membership_start and v_starts_at < v_membership_end then
    if v_is_special then
      select count(*)::integer into v_special_count
        from public.reservas_yoga r
        join public.clases c on c.id = r.clase_id
       where r.user_id = v_target_id
         and r.estado = 'confirmada'
         and coalesce(r.usado_bono_mensual, false)
         and lower(trim(coalesce(c.tipo_clase, ''))) = 'taller'
         and c.fecha_inicio >= v_membership_start
         and c.fecha_inicio < v_membership_end;
      if v_special_count >= 1 then
        raise exception 'Ya has utilizado la clase especial incluida en este mes natural.'
          using errcode = 'P0001';
      end if;
    end if;
    v_use_unlimited := true;
  end if;

  if not v_use_unlimited then
    if v_is_special then
      raise exception 'Las clases especiales requieren un Bono Ilimitado activo y disponibilidad mensual.'
        using errcode = 'P0001';
    end if;

    select id into v_pack_id
      from public.class_credit_packs
     where user_id = v_target_id
       and credits_remaining > 0
       and expires_at > now()
       and expires_at >= v_starts_at
     order by expires_at, purchased_at, id
     limit 1
     for update;

    if v_pack_id is not null then
      update public.class_credit_packs
         set credits_remaining = credits_remaining - 1,
             updated_at = now()
       where id = v_pack_id and credits_remaining > 0;
      if not found then
        raise exception 'El pack seleccionado ya no tiene clases disponibles.' using errcode = 'P0001';
      end if;
    else
      update public.profiles
         set bonos = coalesce(bonos, 0) - 1
       where id = v_target_id and coalesce(bonos, 0) >= 1;
      if not found then
        raise exception 'No tienes clases vigentes disponibles para esta fecha.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id
  ) values (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    not v_use_unlimited, v_pack_id
  );
end;
$$;

revoke all on function public.reservar_con_bono(bigint, uuid) from public, anon;
grant execute on function public.reservar_con_bono(bigint, uuid) to authenticated;

-- 6. Actualizar reservar_consulta_atomica para gestionar consultas gratuitas
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
  v_is_free boolean;
  v_professional_identity text;
  v_occupied integer;
  v_reservation_id bigint;
  v_actor_is_staff boolean;
  v_charge_credit boolean;
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

  select
    lower(coalesce(class.tipo_clase, '')),
    coalesce(class.capacidad_max, 0),
    class.fecha_inicio,
    class.fecha_fin,
    class.duracion_minutos,
    class.profesor_id,
    coalesce(class.es_gratuita, false),
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
      v_is_free,
      v_professional_identity
    from public.clases as class
    left join public.profesionales as professional
      on professional.id = class.profesor_id
   where class.id = p_clase_id
     for update of class;

  if not found or coalesce(v_capacity, 0) <= 0 or v_starts_at is null then
    raise exception 'consultation slot not found or invalid';
  end if;

  select lower(coalesce(profile.rol, ''))
    into v_target_role
    from public.profiles as profile
   where profile.id = v_target_id;
  if not found then
    raise exception 'target profile not found';
  end if;

  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'staff users cannot book consultations';
  end if;

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

  -- GESTIÓN DE SALDOS:
  -- Si la consulta es gratuita, se descuenta de saldo_consultas_gratis
  if v_is_free then
    update public.profiles
       set saldo_consultas_gratis = saldo_consultas_gratis - 1
     where id = v_target_id
       and (saldo_consultas_gratis >= 1 or v_actor_role = 'admin');
    if not found then
      raise exception 'Ya has utilizado tu bono de consulta gratuita o no dispones de saldo gratis suficiente.';
    end if;

    if p_tipo = 'psicologia' then
      insert into public.reservas_psicologia (clase_id, user_id, estado, saldo_descontado)
      values (p_clase_id, v_target_id, 'confirmada', false)
      returning id into v_reservation_id;
    else
      insert into public.reservas_nutricion (clase_id, user_id, estado, saldo_descontado)
      values (p_clase_id, v_target_id, 'confirmada', false)
      returning id into v_reservation_id;
    end if;
    return v_reservation_id;
  end if;

  v_charge_credit := coalesce(p_cobrar_saldo, true);

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

revoke all on function public.reservar_consulta_atomica(text, bigint, uuid, boolean) from public, anon;
grant execute on function public.reservar_consulta_atomica(text, bigint, uuid, boolean) to authenticated;

-- 7. Sembrar las Sesiones Introductorias Gratuitas

-- 7.1. Ángel (Domingo 30 de Agosto de 2026: 10:00 y 12:00)
with teacher_angel as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria de Yoga',
  '2026-08-30 10:00:00+02'::timestamptz,
  '2026-08-30 11:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  true,
  true
from teacher_angel t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-08-30 10:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

with teacher_angel as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%angel%'
     or lower(coalesce(nombre, '')) like '%ángel%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria de Yoga',
  '2026-08-30 12:00:00+02'::timestamptz,
  '2026-08-30 13:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  true,
  true
from teacher_angel t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-08-30 12:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- 7.2. Yanira (Martes 1 y Jueves 3 de Septiembre de 2026 a las 19:00)
with teacher_yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria de Yoga',
  '2026-09-01 19:00:00+02'::timestamptz,
  '2026-09-01 20:15:00+02'::timestamptz,
  75,
  10,
  y.profesor_id,
  'yoga',
  true,
  true
from teacher_yanira y
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-01 19:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

with teacher_yanira as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%yanira%'
     or lower(coalesce(email, '')) like 'yanira%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria de Yoga',
  '2026-09-03 19:00:00+02'::timestamptz,
  '2026-09-03 20:15:00+02'::timestamptz,
  75,
  10,
  y.profesor_id,
  'yoga',
  true,
  true
from teacher_yanira y
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-03 19:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- 7.3. Isabel (Jueves 3 y Martes 22 de Septiembre de 2026 a las 11:00)
with teacher_isabel as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%isabel%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria a la Psiconeuroinmunología',
  '2026-09-03 11:00:00+02'::timestamptz,
  '2026-09-03 12:00:00+02'::timestamptz,
  60,
  10,
  t.profesor_id,
  'psicologia',
  true,
  true
from teacher_isabel t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-03 11:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

with teacher_isabel as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%isabel%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria a la Psiconeuroinmunología',
  '2026-09-22 11:00:00+02'::timestamptz,
  '2026-09-22 12:00:00+02'::timestamptz,
  60,
  10,
  t.profesor_id,
  'psicologia',
  true,
  true
from teacher_isabel t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-22 11:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- 7.3. Silvia (Viernes 18 y Viernes 25 de Septiembre de 2026 a las 11:00)
with teacher_silvia as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%silvia%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria al Yoga y Ayurveda',
  '2026-09-18 11:00:00+02'::timestamptz,
  '2026-09-18 12:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  true,
  true
from teacher_silvia t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-18 11:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

with teacher_silvia as (
  select id as profesor_id
  from public.profesionales
  where lower(coalesce(nombre, '')) like '%silvia%'
  order by id
  limit 1
)
insert into public.clases (
  nombre,
  fecha_inicio,
  fecha_fin,
  duracion_minutos,
  capacidad_max,
  profesor_id,
  tipo_clase,
  activa,
  es_gratuita
)
select
  'Sesión Introductoria al Yoga y Ayurveda',
  '2026-09-25 11:00:00+02'::timestamptz,
  '2026-09-25 12:15:00+02'::timestamptz,
  75,
  10,
  t.profesor_id,
  'yoga',
  true,
  true
from teacher_silvia t
where not exists (
  select 1
  from public.clases existing
  where existing.fecha_inicio = '2026-09-25 11:00:00+02'::timestamptz
    and lower(existing.nombre) like '%introductoria%'
);

-- Asegurar capacidad de 10 plazas y es_gratuita en todas las introductorias sembradas
update public.clases
set
  capacidad_max = 10,
  es_gratuita = true,
  activa = true
where lower(nombre) like '%introductoria%';

notify pgrst, 'reload schema';

commit;
