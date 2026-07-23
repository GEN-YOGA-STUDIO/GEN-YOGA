begin;

-- Keep booking and cancellation as two independent settings. Existing valid
-- values are preserved; missing or invalid values receive the documented
-- defaults.
insert into public.configuracion (clave, valor, descripcion, tipo)
values
  (
    'horas_limite_reserva',
    '12',
    'Horas mínimas de anticipación requeridas para realizar una reserva',
    'integer'
  ),
  (
    'horas_limite_cancelacion',
    '24',
    'Horas mínimas de anticipación para cancelar y recuperar el bono',
    'integer'
  )
on conflict (clave) do update
set valor = case
      when trim(coalesce(public.configuracion.valor, '')) ~ '^[0-9]{1,3}$'
        then case
          when trim(public.configuracion.valor)::integer between 0 and 168
            then trim(public.configuracion.valor)
          else excluded.valor
        end
      else excluded.valor
    end,
    descripcion = excluded.descripcion,
    tipo = excluded.tipo;

-- `usado_bono_mensual = false` is not enough to prove that an individual
-- credit was consumed (paid guest bookings and workshops also use false).
-- Record the debit explicitly so cancellation can never mint a free credit.
alter table public.reservas_yoga
  add column if not exists bono_descontado boolean not null default false;

do $backfill$
begin
  if to_regclass('public.stripe_purchases') is not null then
    update public.reservas_yoga r
    set bono_descontado = true
    from public.clases c
    where c.id = r.clase_id
      and lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
      and r.estado = 'confirmada'
      and not coalesce(r.usado_bono_mensual, false)
      and not r.bono_descontado
      and not exists (
        select 1
        from public.stripe_purchases purchase
        where purchase.guest_reservation_id = r.id
      );
  else
    -- Without the Stripe purchase table there cannot be a booking redeemed by
    -- the current paid-guest flow, so every existing non-monthly yoga booking
    -- came through the credit-consuming RPC.
    update public.reservas_yoga r
    set bono_descontado = true
    from public.clases c
    where c.id = r.clase_id
      and lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
      and r.estado = 'confirmada'
      and not coalesce(r.usado_bono_mensual, false)
      and not r.bono_descontado;
  end if;
end;
$backfill$;

comment on column public.reservas_yoga.bono_descontado
  is 'True only when this reservation atomically consumed one profiles.bonos credit.';

-- Keep workshops compatible with their existing staff flow, but prevent a
-- browser role from bypassing the yoga RPC by inserting, updating or deleting
-- a yoga booking directly. Security-definer database functions and the
-- service role continue to work.
create or replace function public.reservas_yoga_proteger_mutacion_directa()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old_class_type text;
  v_new_class_type text;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select lower(trim(coalesce(tipo_clase, '')))
      into v_old_class_type
    from public.clases
    where id = old.clase_id;

    if old.clase_id is not null
      and (not found or coalesce(v_old_class_type, '') = '') then
      raise exception 'No se pudo verificar de forma segura la clase de la reserva.'
        using errcode = '42501';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select lower(trim(coalesce(tipo_clase, '')))
      into v_new_class_type
    from public.clases
    where id = new.clase_id;

    if new.clase_id is not null
      and (not found or coalesce(v_new_class_type, '') = '') then
      raise exception 'No se pudo verificar de forma segura la clase de la reserva.'
        using errcode = '42501';
    end if;
  end if;

  -- UPDATE must inspect both sides: otherwise a browser could move a yoga
  -- reservation to a non-yoga class and evade the protection.
  if v_old_class_type = 'yoga' or v_new_class_type = 'yoga' then
    raise exception 'Las reservas de yoga solo pueden modificarse mediante su operación segura.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists reservas_yoga_proteger_mutacion_directa
  on public.reservas_yoga;
create trigger reservas_yoga_proteger_mutacion_directa
before insert or update or delete on public.reservas_yoga
for each row execute function public.reservas_yoga_proteger_mutacion_directa();

revoke all on function public.reservas_yoga_proteger_mutacion_directa()
  from public, anon, authenticated;

create index if not exists reservas_yoga_clase_estado_idx
  on public.reservas_yoga (clase_id, estado);

create index if not exists reservas_yoga_usuario_estado_idx
  on public.reservas_yoga (user_id, estado);

-- Add the invariant when historical data is clean, without making the whole
-- policy migration fail if old duplicates first require a manual audit.
do $unique_index$
begin
  if not exists (
    select 1
    from public.reservas_yoga
    where estado = 'confirmada'
    group by clase_id, user_id
    having count(*) > 1
  ) then
    execute '
      create unique index if not exists reservas_yoga_clase_usuario_confirmada_uidx
      on public.reservas_yoga (clase_id, user_id)
      where estado = ''confirmada''
    ';
  else
    raise warning
      'No se creó el índice único de reservas_yoga: existen reservas confirmadas duplicadas.';
  end if;
end;
$unique_index$;

-- CREATE OR REPLACE cannot change a legacy return type. Remove only a
-- mismatched legacy signature so this migration is safe on every environment;
-- the replacement happens in the same transaction.
do $legacy_return_types$
declare
  v_reserve_proc oid := to_regprocedure(
    'public.reservar_con_bono(bigint,uuid)'
  );
  v_cancel_proc oid := to_regprocedure(
    'public.cancelar_con_bono(bigint)'
  );
begin
  if v_reserve_proc is not null
    and exists (
      select 1
      from pg_catalog.pg_proc
      where oid = v_reserve_proc
        and (
          prorettype <> 'pg_catalog.void'::regtype
          or proretset
        )
    ) then
    execute 'drop function public.reservar_con_bono(bigint, uuid)';
  end if;

  if v_cancel_proc is not null
    and exists (
      select 1
      from pg_catalog.pg_proc
      where oid = v_cancel_proc
        and (
          prorettype <> 'pg_catalog.void'::regtype
          or proretset
        )
    ) then
    execute 'drop function public.cancelar_con_bono(bigint)';
  end if;
end;
$legacy_return_types$;

-- The browser only performs a preliminary check. This function is the
-- transactional authority for the booking deadline, capacity and credit.
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
  v_bonos integer;
  v_monthly_active boolean;
  v_monthly_start timestamptz;
  v_monthly_end timestamptz;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_type text;
  v_class_active boolean;
  v_professor_id public.clases.profesor_id%type;
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_monthly_week_count integer := 0;
  v_monthly_period_count integer := 0;
  v_use_monthly boolean := false;
  v_class_local timestamp;
  v_week_start timestamp;
  v_week_end timestamp;
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesión para reservar.'
      using errcode = '42501';
  end if;
  if p_clase_id is null or p_clase_id <= 0 or v_target_id is null then
    raise exception 'La solicitud de reserva no es válida.'
      using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(rol, ''))),
    lower(nullif(trim(email), ''))
    into
      v_actor_role,
      v_actor_email
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'No se encontró el perfil que realiza la reserva.'
      using errcode = 'P0002';
  end if;

  v_actor_is_staff := v_actor_role in (
    'admin',
    'profesor',
    'trabajador',
    'profesional'
  );

  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'No puedes reservar una clase para otra persona.'
      using errcode = '42501';
  end if;

  -- Serialise every booking for this class before checking the last place.
  select
    coalesce(capacidad_max, 0),
    fecha_inicio,
    lower(trim(coalesce(tipo_clase, ''))),
    coalesce(activa, true),
    profesor_id
  into
    v_capacity,
    v_starts_at,
    v_class_type,
    v_class_active,
    v_professor_id
  from public.clases
  where id = p_clase_id
  for update;

  if not found or v_class_type <> 'yoga' or not v_class_active then
    raise exception 'La clase especificada no está disponible.'
      using errcode = 'P0002';
  end if;
  if v_starts_at is null then
    raise exception 'La clase no tiene una hora de inicio válida.'
      using errcode = '22023';
  end if;
  if v_capacity <= 0 then
    raise exception 'La clase no tiene plazas disponibles.'
      using errcode = 'P0001';
  end if;
  if v_target_id <> v_actor_id
    and v_actor_role <> 'admin'
    and not exists (
      select 1
      from public.profesionales
      where id = v_professor_id
        and lower(nullif(trim(email), '')) = v_actor_email
    ) then
    raise exception 'Solo puedes gestionar reservas de tus propias clases.'
      using errcode = '42501';
  end if;

  begin
    select case
      when trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
        then least(168, greatest(0, trim(valor)::integer))
      else 12
    end
    into v_booking_limit_hours
    from public.configuracion
    where clave = 'horas_limite_reserva'
    limit 1;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      v_booking_limit_hours := 12;
  end;
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  -- Staff can correct or assign the timetable. Student bookings always use
  -- the reservation setting, never the cancellation setting.
  if not v_actor_is_staff and (
    v_starts_at <= now() + make_interval(hours => v_booking_limit_hours)
  ) then
    raise exception
      'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.reservas_yoga
    where clase_id = p_clase_id
      and user_id = v_target_id
      and estado = 'confirmada'
  ) then
    raise exception 'Ya tienes una reserva confirmada para esta clase.'
      using errcode = '23505';
  end if;

  select count(*)::integer
    into v_occupied
  from public.reservas_yoga
  where clase_id = p_clase_id
    and estado = 'confirmada';

  if v_occupied >= v_capacity then
    raise exception 'La clase está completa.'
      using errcode = 'P0001';
  end if;

  -- Lock the client row so credits and monthly limits cannot be spent twice
  -- by concurrent bookings for different classes.
  select
    lower(trim(coalesce(rol, ''))),
    coalesce(bonos, 0),
    coalesce(bono_mensual_activo, false),
    bono_mensual_inicio,
    bono_mensual_fin
  into
    v_target_role,
    v_bonos,
    v_monthly_active,
    v_monthly_start,
    v_monthly_end
  from public.profiles
  where id = v_target_id
  for update;

  if not found then
    raise exception 'No se encontró el perfil del alumno.'
      using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo los alumnos pueden reservar clases.'
      using errcode = '42501';
  end if;

  if v_monthly_active
    and v_monthly_start is not null
    and v_monthly_end is not null
    and v_starts_at between v_monthly_start and v_monthly_end then
    v_class_local := v_starts_at at time zone 'Europe/Madrid';
    v_week_start := date_trunc('week', v_class_local);
    v_week_end := v_week_start + interval '7 days';

    select
      count(*) filter (
        where c.fecha_inicio between v_monthly_start and v_monthly_end
      )::integer,
      count(*) filter (
        where c.fecha_inicio between v_monthly_start and v_monthly_end
          and (c.fecha_inicio at time zone 'Europe/Madrid') >= v_week_start
          and (c.fecha_inicio at time zone 'Europe/Madrid') < v_week_end
      )::integer
    into
      v_monthly_period_count,
      v_monthly_week_count
    from public.reservas_yoga r
    join public.clases c on c.id = r.clase_id
    where r.user_id = v_target_id
      and r.estado = 'confirmada'
      and coalesce(r.usado_bono_mensual, false);

    v_use_monthly :=
      coalesce(v_monthly_period_count, 0) < 8
      and coalesce(v_monthly_week_count, 0) < 2;
  end if;

  if not v_use_monthly then
    update public.profiles
    set bonos = coalesce(bonos, 0) - 1
    where id = v_target_id
      and coalesce(bonos, 0) >= 1;

    if not found then
      raise exception 'No tienes bonos disponibles para reservar esta clase.'
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.reservas_yoga (
    clase_id,
    user_id,
    estado,
    usado_bono_mensual,
    bono_descontado
  )
  values (
    p_clase_id,
    v_target_id,
    'confirmada',
    v_use_monthly,
    not v_use_monthly
  );
end;
$$;

-- Late cancellation is a hard stop. The reservation remains in place and the
-- consumed credit is not refunded. A timely cancellation deletes the booking
-- and returns exactly one individual credit when one was consumed.
create or replace function public.cancelar_con_bono(
  p_reserva_id bigint
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
  v_actor_is_admin boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_class_type text;
  v_professor_id public.clases.profesor_id%type;
  v_credit_debited boolean;
  v_cancel_limit_hours integer := 24;
  v_allow_admin_override boolean := false;
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesión para cancelar.'
      using errcode = '42501';
  end if;
  if p_reserva_id is null or p_reserva_id <= 0 then
    raise exception 'La solicitud de cancelación no es válida.'
      using errcode = '22023';
  end if;

  select
    lower(trim(coalesce(rol, ''))),
    lower(nullif(trim(email), ''))
  into
    v_actor_role,
    v_actor_email
  from public.profiles
  where id = v_actor_id;

  if not found then
    raise exception 'No se encontró el perfil que realiza la cancelación.'
      using errcode = 'P0002';
  end if;

  v_actor_is_staff := v_actor_role in (
    'admin',
    'profesor',
    'trabajador',
    'profesional'
  );
  v_actor_is_admin := v_actor_role = 'admin';

  select
    user_id,
    clase_id,
    coalesce(bono_descontado, false)
  into
    v_target_id,
    v_class_id,
    v_credit_debited
  from public.reservas_yoga
  where id = p_reserva_id
    and estado = 'confirmada'
  for update;

  if not found then
    raise exception 'La reserva especificada no existe.'
      using errcode = 'P0002';
  end if;
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'No puedes cancelar la reserva de otra persona.'
      using errcode = '42501';
  end if;

  select
    fecha_inicio,
    lower(trim(coalesce(tipo_clase, ''))),
    profesor_id
  into
    v_starts_at,
    v_class_type,
    v_professor_id
  from public.clases
  where id = v_class_id
  for update;

  if not found or v_class_type <> 'yoga' then
    raise exception 'Esta reserva no corresponde a una clase de yoga.'
      using errcode = 'P0002';
  end if;
  if v_target_id <> v_actor_id
    and not v_actor_is_admin
    and not exists (
      select 1
      from public.profesionales
      where id = v_professor_id
        and lower(nullif(trim(email), '')) = v_actor_email
    ) then
    raise exception 'Solo puedes gestionar reservas de tus propias clases.'
      using errcode = '42501';
  end if;

  begin
    select case
      when trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
        then least(168, greatest(0, trim(valor)::integer))
      else 24
    end
    into v_cancel_limit_hours
    from public.configuracion
    where clave = 'horas_limite_cancelacion'
    limit 1;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      v_cancel_limit_hours := 24;
  end;
  v_cancel_limit_hours := coalesce(v_cancel_limit_hours, 24);

  if v_actor_is_admin then
    select lower(trim(coalesce(valor, ''))) in ('true', '1', 'yes', 'on')
      into v_allow_admin_override
    from public.configuracion
    where clave = 'permitir_cancelacion_admin_siempre'
    limit 1;
    v_allow_admin_override := coalesce(v_allow_admin_override, false);
  end if;

  if not (v_actor_is_admin and v_allow_admin_override) and (
    v_starts_at is null
    or v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours)
  ) then
    raise exception
      'Ya no puedes cancelar: faltan % h o menos para la clase. El bono reservado no se devuelve.',
      v_cancel_limit_hours
      using errcode = 'P0001';
  end if;

  delete from public.reservas_yoga
  where id = p_reserva_id;

  if v_credit_debited then
    update public.profiles
    set bonos = coalesce(bonos, 0) + 1
    where id = v_target_id;

    if not found then
      raise exception 'No se encontró el perfil al devolver el bono.'
        using errcode = 'P0002';
    end if;
  end if;
end;
$$;

-- Admin-only and validated persistence for the two policy values. This avoids
-- silent browser UPDATEs that affect zero rows.
create or replace function public.admin_actualizar_limite_reservas(
  p_clave text,
  p_horas integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_role text;
  v_description text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para cambiar la configuración.'
      using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, '')))
    into v_actor_role
  from public.profiles
  where id = auth.uid();

  if not found or v_actor_role <> 'admin' then
    raise exception 'Solo un administrador puede cambiar estos límites.'
      using errcode = '42501';
  end if;
  if p_clave is null or p_clave not in (
    'horas_limite_reserva',
    'horas_limite_cancelacion'
  ) then
    raise exception 'El límite indicado no es válido.'
      using errcode = '22023';
  end if;
  if p_horas is null or p_horas < 0 or p_horas > 168 then
    raise exception 'Las horas deben ser un número entero entre 0 y 168.'
      using errcode = '22023';
  end if;

  v_description := case p_clave
    when 'horas_limite_reserva'
      then 'Horas mínimas de anticipación requeridas para realizar una reserva'
    else 'Horas mínimas de anticipación para cancelar y recuperar el bono'
  end;

  insert into public.configuracion (
    clave,
    valor,
    descripcion,
    tipo
  )
  values (
    p_clave,
    p_horas::text,
    v_description,
    'integer'
  )
  on conflict (clave) do update
  set valor = excluded.valor,
      descripcion = excluded.descripcion,
      tipo = excluded.tipo;
end;
$$;

revoke all on function public.reservar_con_bono(bigint, uuid)
  from public, anon;
revoke all on function public.cancelar_con_bono(bigint)
  from public, anon;
revoke all on function public.admin_actualizar_limite_reservas(text, integer)
  from public, anon;

grant execute on function public.reservar_con_bono(bigint, uuid)
  to authenticated;
grant execute on function public.cancelar_con_bono(bigint)
  to authenticated;
grant execute on function public.admin_actualizar_limite_reservas(text, integer)
  to authenticated;

comment on function public.reservar_con_bono(bigint, uuid)
  is 'Atomically books yoga using the independent booking cutoff, capacity and the correct monthly or individual credit.';
comment on function public.cancelar_con_bono(bigint)
  is 'Atomically cancels yoga before the cancellation cutoff and refunds only an individual credit actually consumed.';
comment on function public.admin_actualizar_limite_reservas(text, integer)
  is 'Admin-only validated update for independent booking and cancellation hour limits.';

notify pgrst, 'reload schema';

commit;
