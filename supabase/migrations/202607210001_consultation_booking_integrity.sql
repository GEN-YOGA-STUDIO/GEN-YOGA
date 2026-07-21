-- Make psychology/nutrition credits and bookings atomic. The previous browser
-- implementation updated the balance and inserted/deleted the booking in
-- separate requests, which allowed double spending and lost credits on cancel.

begin;

alter table public.profiles
  add column if not exists saldo_psicologia integer not null default 0,
  add column if not exists saldo_nutricion integer not null default 0;

alter table public.reservas_psicologia
  add column if not exists saldo_descontado boolean not null default false;

alter table public.reservas_nutricion
  add column if not exists saldo_descontado boolean not null default false;

-- Capacity and credit checks are only effective if browser sessions cannot
-- bypass the RPCs with a direct write to either booking table.
revoke insert, update, delete on table public.reservas_psicologia
  from public, anon, authenticated;
revoke insert, update, delete on table public.reservas_nutricion
  from public, anon, authenticated;
grant select, insert, update, delete on table public.reservas_psicologia
  to service_role;
grant select, insert, update, delete on table public.reservas_nutricion
  to service_role;

create index if not exists reservas_psicologia_clase_estado_idx
  on public.reservas_psicologia (clase_id, estado);

create index if not exists reservas_nutricion_clase_estado_idx
  on public.reservas_nutricion (clase_id, estado);

create or replace function public.reservar_consulta_atomica(
  p_tipo text,
  p_clase_id bigint,
  p_user_id uuid default null,
  p_cobrar_saldo boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_target_role text;
  v_class_type text;
  v_capacity integer;
  v_starts_at timestamptz;
  v_professor_id public.clases.profesor_id%type;
  v_occupied integer;
  v_reservation_id bigint;
  v_actor_is_staff boolean;
  v_target_is_client boolean;
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

  select lower(coalesce(rol, '')), lower(nullif(trim(email), ''))
    into v_actor_role, v_actor_email
    from public.profiles
   where id = v_actor_id;
  if not found then
    raise exception 'actor profile not found';
  end if;

  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'not allowed to book for another user';
  end if;

  -- Serialise all bookings for the same slot before checking its capacity.
  select lower(coalesce(tipo_clase, '')), coalesce(capacidad_max, 0), fecha_inicio, profesor_id
    into v_class_type, v_capacity, v_starts_at, v_professor_id
    from public.clases
   where id = p_clase_id
   for update;
  if not found or v_class_type <> p_tipo then
    raise exception 'consultation slot not found';
  end if;
  if v_capacity <= 0 then
    raise exception 'consultation has no available capacity';
  end if;
  if v_starts_at is null or v_starts_at <= now() then
    raise exception 'consultation slot is no longer bookable';
  end if;
  if v_actor_is_staff and v_actor_role <> 'admin' and not exists (
    select 1
      from public.profesionales
     where id = v_professor_id
       and lower(nullif(trim(email), '')) = v_actor_email
  ) then
    raise exception 'staff may only manage consultation slots linked to their professional profile';
  end if;

  select lower(coalesce(rol, ''))
    into v_target_role
    from public.profiles
   where id = v_target_id
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
      select 1 from public.reservas_psicologia
       where clase_id = p_clase_id and user_id = v_target_id and estado = 'confirmada'
    ) then
      raise exception 'consultation already booked';
    end if;
    select count(*)::integer into v_occupied
      from public.reservas_psicologia
     where clase_id = p_clase_id and estado = 'confirmada';
  else
    if exists (
      select 1 from public.reservas_nutricion
       where clase_id = p_clase_id and user_id = v_target_id and estado = 'confirmada'
    ) then
      raise exception 'consultation already booked';
    end if;
    select count(*)::integer into v_occupied
      from public.reservas_nutricion
     where clase_id = p_clase_id and estado = 'confirmada';
  end if;

  if v_occupied >= v_capacity then
    raise exception 'consultation is full';
  end if;

  if v_charge_credit and p_tipo = 'psicologia' then
    update public.profiles
       set saldo_psicologia = saldo_psicologia - 1
     where id = v_target_id and saldo_psicologia >= 1;
    if not found then raise exception 'insufficient psychology credit'; end if;
  elsif v_charge_credit and p_tipo = 'nutricion' then
    update public.profiles
       set saldo_nutricion = saldo_nutricion - 1
     where id = v_target_id and saldo_nutricion >= 1;
    if not found then raise exception 'insufficient nutrition credit'; end if;
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
$$;

create or replace function public.cancelar_consulta_atomica(
  p_tipo text,
  p_reserva_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_professor_id public.clases.profesor_id%type;
  v_cancel_limit_hours integer := 24;
  v_refund_credit boolean;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion')
    or p_reserva_id is null or p_reserva_id <= 0 then
    raise exception 'invalid cancellation request';
  end if;

  select lower(coalesce(rol, '')), lower(nullif(trim(email), ''))
    into v_actor_role, v_actor_email
    from public.profiles where id = v_actor_id;
  if not found then raise exception 'actor profile not found'; end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');

  if p_tipo = 'psicologia' then
    select user_id, clase_id, saldo_descontado
      into v_target_id, v_class_id, v_refund_credit
      from public.reservas_psicologia
     where id = p_reserva_id and estado = 'confirmada'
     for update;
  else
    select user_id, clase_id, saldo_descontado
      into v_target_id, v_class_id, v_refund_credit
      from public.reservas_nutricion
     where id = p_reserva_id and estado = 'confirmada'
     for update;
  end if;
  if not found then raise exception 'consultation booking not found'; end if;
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'not allowed to cancel this booking';
  end if;

  select fecha_inicio, profesor_id into v_starts_at, v_professor_id
    from public.clases
   where id = v_class_id and lower(coalesce(tipo_clase, '')) = p_tipo;
  if not found then
    raise exception 'consultation slot not found';
  end if;

  if v_actor_is_staff and v_actor_role <> 'admin' and not exists (
    select 1
      from public.profesionales
     where id = v_professor_id
       and lower(nullif(trim(email), '')) = v_actor_email
  ) then
    raise exception 'staff may only manage consultation slots linked to their professional profile';
  end if;

  -- Enforce the same cancellation window advertised by the application. Staff
  -- may still correct their own linked slots, while administrators remain global.
  if not v_actor_is_staff then
    begin
      select least(
        168::numeric,
        greatest(0::numeric, round(nullif(trim(both '"' from valor::text), '')::numeric))
      )::integer
        into v_cancel_limit_hours
        from public.configuracion
       where clave = 'horas_limite_cancelacion'
       limit 1;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        v_cancel_limit_hours := 24;
    end;
    v_cancel_limit_hours := coalesce(v_cancel_limit_hours, 24);

    if v_starts_at is null
      or v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours) then
      raise exception 'consultation cancellation deadline has passed';
    end if;
  end if;

  if p_tipo = 'psicologia' then
    delete from public.reservas_psicologia where id = p_reserva_id;
    if v_refund_credit then
      update public.profiles set saldo_psicologia = saldo_psicologia + 1 where id = v_target_id;
      if not found then raise exception 'client profile not found'; end if;
    end if;
  else
    delete from public.reservas_nutricion where id = p_reserva_id;
    if v_refund_credit then
      update public.profiles set saldo_nutricion = saldo_nutricion + 1 where id = v_target_id;
      if not found then raise exception 'client profile not found'; end if;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.reservar_consulta_atomica(text, bigint, uuid, boolean) from public, anon;
revoke all on function public.cancelar_consulta_atomica(text, bigint) from public, anon;
grant execute on function public.reservar_consulta_atomica(text, bigint, uuid, boolean) to authenticated;
grant execute on function public.cancelar_consulta_atomica(text, bigint) to authenticated;

comment on function public.reservar_consulta_atomica(text, bigint, uuid, boolean)
  is 'Atomically checks capacity, consumes an optional consultation credit and creates a booking.';
comment on function public.cancelar_consulta_atomica(text, bigint)
  is 'Atomically cancels a consultation booking and refunds only a credit previously consumed by it.';

commit;
