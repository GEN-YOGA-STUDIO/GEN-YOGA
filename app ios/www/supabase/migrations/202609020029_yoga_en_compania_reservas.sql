-- Migration 202609020029: Soporte de reservas multiples de Yoga en Compania con acompanantes

alter table public.reservas_yoga
  add column if not exists num_plazas integer not null default 1,
  add column if not exists tipo_reserva text default 'individual',
  add column if not exists acompanantes jsonb default '[]'::jsonb;

-- Recrear funcion reservar_con_bono soportando plazas multiples y lista de acompanantes
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_num_plazas integer default 1,
  p_tipo_reserva text default 'individual',
  p_acompanantes jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
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
  v_num_plazas integer := greatest(1, least(coalesce(p_num_plazas, 1), 10));
  v_tipo_reserva text := coalesce(nullif(trim(p_tipo_reserva), ''), 'individual');
  v_acompanantes jsonb := coalesce(p_acompanantes, '[]'::jsonb);
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

  -- Comprobacion de aforo sumando todas las plazas ocupadas
  select coalesce(sum(coalesce(num_plazas, 1)), 0)::integer into v_occupied
    from public.reservas_yoga
   where clase_id = p_clase_id and estado = 'confirmada';

  if (v_occupied + v_num_plazas) > v_capacity then
    raise exception 'No hay suficientes plazas libres en esta clase (solicitadas: %, disponibles: %).',
      v_num_plazas, greatest(0, v_capacity - v_occupied) using errcode = 'P0001';
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

  -- CASO 1: Si es una clase gratuita o reserva con bono de bienvenida de Yoga en Compania
  if v_is_free or v_tipo_reserva like 'compania%' or v_tipo_reserva = 'gratis_bienvenida' then
    update public.profiles
       set saldo_clases_gratis = saldo_clases_gratis - 1
     where id = v_target_id
       and (saldo_clases_gratis >= 1 or v_actor_role = 'admin');
    if not found then
      raise exception 'Ya has utilizado tu bono de clase gratuita o no dispones de saldo gratis suficiente.'
        using errcode = 'P0001';
    end if;

    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id,
      num_plazas, tipo_reserva, acompanantes
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null,
      v_num_plazas, v_tipo_reserva, v_acompanantes
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
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id,
    num_plazas, tipo_reserva, acompanantes
  ) values (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    not v_use_unlimited, v_pack_id,
    v_num_plazas, v_tipo_reserva, v_acompanantes
  );
end;
$func$;

-- Compatibilidad de firma original (2 parametros)
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
begin
  perform public.reservar_con_bono(p_clase_id, p_user_id, 1, 'individual', '[]'::jsonb);
end;
$func$;

revoke all on function public.reservar_con_bono(bigint, uuid, integer, text, jsonb) from public, anon;
grant execute on function public.reservar_con_bono(bigint, uuid, integer, text, jsonb) to authenticated;

revoke all on function public.reservar_con_bono(bigint, uuid) from public, anon;
grant execute on function public.reservar_con_bono(bigint, uuid) to authenticated;

-- Actualizar cancelar_con_bono para reembolsar saldo_clases_gratis si fue reserva gratuita
create or replace function public.cancelar_con_bono(
  p_reserva_id bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $func$
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
  v_pack_id bigint;
  v_used_unlimited boolean;
  v_cancel_limit_hours integer := 24;
  v_allow_admin_override boolean := false;
  v_is_free boolean;
  v_tipo_reserva text;
begin
  if v_actor_id is null then
    raise exception 'Debes iniciar sesión para cancelar.' using errcode = '42501';
  end if;
  if p_reserva_id is null or p_reserva_id <= 0 then
    raise exception 'La solicitud de cancelación no es válida.' using errcode = '22023';
  end if;

  select lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    into v_actor_role, v_actor_email
    from public.profiles where id = v_actor_id;
  if not found then
    raise exception 'No se encontró el perfil que realiza la cancelación.' using errcode = 'P0002';
  end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');
  v_actor_is_admin := v_actor_role = 'admin';

  select user_id, clase_id, coalesce(bono_descontado, false), class_pack_id,
         coalesce(usado_bono_mensual, false), coalesce(tipo_reserva, 'individual')
    into v_target_id, v_class_id, v_credit_debited, v_pack_id,
         v_used_unlimited, v_tipo_reserva
    from public.reservas_yoga
   where id = p_reserva_id and estado = 'confirmada'
   for update;
  if not found then
    raise exception 'La reserva especificada no existe.' using errcode = 'P0002';
  end if;
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'No puedes cancelar la reserva de otra persona.' using errcode = '42501';
  end if;

  select fecha_inicio, lower(trim(coalesce(tipo_clase, ''))), profesor_id, coalesce(es_gratuita, false)
    into v_starts_at, v_class_type, v_professor_id, v_is_free
    from public.clases where id = v_class_id for update;
  if not found or v_class_type not in ('yoga', 'taller') then
    raise exception 'Esta reserva no corresponde a una clase reservable.' using errcode = 'P0002';
  end if;
  if v_target_id <> v_actor_id and not v_actor_is_admin
    and not exists (
      select 1 from public.profesionales
       where id = v_professor_id
         and lower(nullif(trim(email), '')) = v_actor_email
    ) then
    raise exception 'Solo puedes gestionar reservas de tus propias clases.' using errcode = '42501';
  end if;

  begin
    select case when trim(coalesce(valor, '')) ~ '^[0-9]{1,3}$'
      then least(168, greatest(0, trim(valor)::integer)) else 24 end
      into v_cancel_limit_hours
      from public.configuracion where clave = 'horas_limite_cancelacion' limit 1;
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_cancel_limit_hours := 24;
  end;
  v_cancel_limit_hours := coalesce(v_cancel_limit_hours, 24);

  begin
    select lower(trim(coalesce(valor, ''))) in ('true', '1', 'si', 't')
      into v_allow_admin_override
      from public.configuracion where clave = 'permitir_cancelacion_admin_siempre' limit 1;
    v_allow_admin_override := coalesce(v_allow_admin_override, false);
  exception when others then
    v_allow_admin_override := false;
  end;

  if not (v_actor_is_admin and v_allow_admin_override)
    and v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours) then
    raise exception 'Las cancelaciones cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_cancel_limit_hours using errcode = 'P0001';
  end if;

  delete from public.reservas_yoga where id = p_reserva_id;

  -- Reembolsar saldo correspondiente
  if v_is_free or v_tipo_reserva like 'compania%' or v_tipo_reserva = 'gratis_bienvenida' then
    update public.profiles
       set saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
     where id = v_target_id;
  elsif v_pack_id is not null then
    update public.class_credit_packs
       set credits_remaining = credits_remaining + 1,
           updated_at = now()
     where id = v_pack_id;
  elsif v_credit_debited and not v_used_unlimited then
    update public.profiles
       set bonos = coalesce(bonos, 0) + 1
     where id = v_target_id;
  end if;
end;
$func$;

revoke all on function public.cancelar_con_bono(bigint) from public, anon;
grant execute on function public.cancelar_con_bono(bigint) to authenticated;
