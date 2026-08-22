-- ==============================================================================
-- Migración: Fix reservas con bonos gratuitos, cancelación de consultas y sincronización
-- Fecha: 2026-09-02
-- ==============================================================================

-- 1. Actualizar reservar_con_bono para admitir clases de oferta (Ángel 16:15, Yanira 08:00 y gratuitas)
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
  v_free_credits integer := 0;
  v_unlimited_active boolean;
  v_membership_start timestamptz;
  v_membership_end timestamptz;
  v_natural_membership_start timestamptz;
  v_natural_membership_end timestamptz;
  v_capacity integer;
  v_starts_at timestamptz;
  v_class_name text;
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_is_free boolean;
  v_professor_id public.clases.profesor_id%type;
  v_professional_identity text;
  v_occupied integer;
  v_booking_limit_hours integer := 12;
  v_use_unlimited boolean := false;
  v_pack_id bigint;
  v_special_count integer := 0;
  v_local_start timestamp without time zone;
  v_local_dow integer;
  v_local_time time without time zone;
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

  select coalesce(class.capacidad_max, 0), class.fecha_inicio,
         class.nombre,
         lower(trim(coalesce(class.tipo_clase, ''))), coalesce(class.activa, true),
         class.profesor_id, coalesce(class.es_gratuita, false),
         lower(concat_ws(
           ' ',
           coalesce(professional.nombre, ''),
           coalesce(professional.apellidos, ''),
           coalesce(professional.email, '')
         ))
    into v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_is_free, v_professional_identity
    from public.clases as class
    left join public.profesionales as professional on professional.id = class.profesor_id
   where class.id = p_clase_id for update;

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

  -- Comprobar antelación
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

  select lower(trim(coalesce(rol, ''))), coalesce(bonos, 0), coalesce(saldo_clases_gratis, 0),
         coalesce(bono_mensual_activo, false), bono_mensual_inicio, bono_mensual_fin
    into v_target_role, v_legacy_credits, v_free_credits, v_unlimited_active,
         v_membership_start, v_membership_end
    from public.profiles where id = v_target_id for update;
  if not found then
    raise exception 'No se encontró el perfil del alumno.' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo los alumnos pueden reservar clases.' using errcode = '42501';
  end if;

  -- Calcular si la clase es elegible para oferta o bono de bienvenida
  v_local_start := v_starts_at at time zone 'Europe/Madrid';
  v_local_dow := extract(isodow from v_local_start)::integer;
  v_local_time := v_local_start::time;

  if not v_is_free then
    v_is_free := (
      lower(coalesce(v_class_name, '')) like '%introductoria%'
      or lower(coalesce(v_class_name, '')) like '%gratis%'
      or lower(coalesce(v_class_name, '')) like '%prueba%'
      or lower(coalesce(v_class_name, '')) like '%madre%'
      or lower(coalesce(v_class_name, '')) like '%hija%'
      or (
        -- Ángel Lunes o Miércoles 16:15
        v_local_dow in (1, 3)
        and v_local_time >= '16:10'::time and v_local_time <= '16:20'::time
        and v_professional_identity like '%angel%'
      )
      or (
        -- Yanira Miércoles o Viernes 08:00
        v_local_dow in (3, 5)
        and v_local_time >= '07:55'::time and v_local_time <= '08:15'::time
        and v_professional_identity like '%yanira%'
      )
    );
  end if;

  -- CASO 1: Si es una clase elegible gratuita/oferta y el usuario tiene saldo gratis
  if v_is_free and (v_free_credits >= 1 or v_actor_role = 'admin') then
    update public.profiles
       set saldo_clases_gratis = greatest(0, saldo_clases_gratis - 1)
     where id = v_target_id;

    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null
    );
    return;
  elsif v_is_free and v_free_credits < 1 and not v_actor_is_staff then
    -- Si es clase gratuita pero no tiene saldo gratis, verificar si tiene bono de pago
    null;
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
       where id = v_pack_id;
    elsif v_legacy_credits > 0 then
      update public.profiles
         set bonos = bonos - 1
       where id = v_target_id;
    elsif v_free_credits > 0 then
      update public.profiles
         set saldo_clases_gratis = greatest(0, saldo_clases_gratis - 1)
       where id = v_target_id;
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, false, null
      );
      return;
    else
      raise exception 'No tienes bonos disponibles para esta clase.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado, class_pack_id
  ) values (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited, (not v_use_unlimited), v_pack_id
  );
end;
$$;


-- 2. Actualizar cancelar_con_bono para devolver bono gratuito si corresponde
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
  v_used_unlimited boolean;
  v_pack_id bigint;
  v_cancel_limit_hours integer := 24;
  v_allow_admin_override boolean := false;
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

  select user_id, clase_id, coalesce(bono_descontado, false), coalesce(usado_bono_mensual, false), class_pack_id
    into v_target_id, v_class_id, v_credit_debited, v_used_unlimited, v_pack_id
    from public.reservas_yoga
   where id = p_reserva_id and estado = 'confirmada'
   for update;
  if not found then
    raise exception 'La reserva especificada no existe.' using errcode = 'P0002';
  end if;
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'No puedes cancelar la reserva de otra persona.' using errcode = '42501';
  end if;

  select fecha_inicio, lower(trim(coalesce(tipo_clase, ''))), profesor_id
    into v_starts_at, v_class_type, v_professor_id
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
  if v_actor_is_admin then
    select lower(trim(coalesce(valor, ''))) in ('true', '1', 'yes', 'on')
      into v_allow_admin_override
      from public.configuracion where clave = 'permitir_cancelacion_admin_siempre' limit 1;
    v_allow_admin_override := coalesce(v_allow_admin_override, false);
  end if;

  if not (v_actor_is_admin and v_allow_admin_override)
    and (v_starts_at is null or v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours)) then
    raise exception 'Ya no puedes cancelar: faltan % h o menos para la clase. El bono reservado no se devuelve.',
      v_cancel_limit_hours using errcode = 'P0001';
  end if;

  delete from public.reservas_yoga where id = p_reserva_id;

  if v_credit_debited and v_pack_id is not null then
    update public.class_credit_packs
       set credits_remaining = least(credits_total, credits_remaining + 1),
           updated_at = now()
     where id = v_pack_id and user_id = v_target_id;
  elsif v_credit_debited then
    update public.profiles set bonos = coalesce(bonos, 0) + 1 where id = v_target_id;
  elsif not v_used_unlimited then
    -- Si no consumió pack ni ilimitado, fue un bono de clase gratuita
    update public.profiles set saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1 where id = v_target_id;
  end if;
end;
$$;


-- 3. Actualizar cancelar_consulta_atomica para buscar en ambas tablas y devolver bono gratis
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
  v_actual_table text := null;
begin
  if v_actor_id is null then
    raise exception 'authentication required';
  end if;
  if p_reserva_id is null or p_reserva_id <= 0 then
    raise exception 'invalid cancellation request';
  end if;

  select lower(coalesce(rol, '')), lower(nullif(trim(email), ''))
    into v_actor_role, v_actor_email
    from public.profiles where id = v_actor_id;
  if not found then raise exception 'actor profile not found'; end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');

  -- Intentar encontrar la reserva en psicologia o nutricion
  if p_tipo = 'psicologia' then
    select user_id, clase_id, saldo_descontado
      into v_target_id, v_class_id, v_refund_credit
      from public.reservas_psicologia
     where id = p_reserva_id and estado = 'confirmada'
     for update;
    if found then
      v_actual_table := 'psicologia';
    else
      select user_id, clase_id, saldo_descontado
        into v_target_id, v_class_id, v_refund_credit
        from public.reservas_nutricion
       where id = p_reserva_id and estado = 'confirmada'
       for update;
      if found then v_actual_table := 'nutricion'; end if;
    end if;
  else
    select user_id, clase_id, saldo_descontado
      into v_target_id, v_class_id, v_refund_credit
      from public.reservas_nutricion
     where id = p_reserva_id and estado = 'confirmada'
     for update;
    if found then
      v_actual_table := 'nutricion';
    else
      select user_id, clase_id, saldo_descontado
        into v_target_id, v_class_id, v_refund_credit
        from public.reservas_psicologia
       where id = p_reserva_id and estado = 'confirmada'
       for update;
      if found then v_actual_table := 'psicologia'; end if;
    end if;
  end if;

  if v_actual_table is null then
    raise exception 'consultation booking not found';
  end if;

  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'not allowed to cancel this booking';
  end if;

  select fecha_inicio, profesor_id into v_starts_at, v_professor_id
    from public.clases
   where id = v_class_id;
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

  if v_actual_table = 'psicologia' then
    delete from public.reservas_psicologia where id = p_reserva_id;
    if v_refund_credit then
      update public.profiles set saldo_psicologia = coalesce(saldo_psicologia, 0) + 1 where id = v_target_id;
    else
      update public.profiles set saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1 where id = v_target_id;
    end if;
  else
    delete from public.reservas_nutricion where id = p_reserva_id;
    if v_refund_credit then
      update public.profiles set saldo_nutricion = coalesce(saldo_nutricion, 0) + 1 where id = v_target_id;
    else
      update public.profiles set saldo_consultas_gratis = coalesce(saldo_consultas_gratis, 0) + 1 where id = v_target_id;
    end if;
  end if;

  return true;
end;
$$;


-- 4. Actualizar reservar_consulta_virtual para aceptar Isabel en ambos tipos
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
  v_effective_tipo text := p_tipo;
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
    v_effective_tipo := 'psicologia';
    if v_local_weekday not in (2, 3)
      or not (v_local_time = any(v_standard_start_times)) then
      raise exception 'Miriam is not available at the requested time';
    end if;
  elsif v_professional_identity like '%isabel%' then
    v_effective_tipo := case when p_tipo = 'nutricion' then 'nutricion' else 'psicologia' end;
    if v_local_weekday not in (2, 4)
      or not (v_local_time = any(v_standard_start_times)) then
      raise exception 'Isabel is not available at the requested time';
    end if;
  elsif v_professional_identity like '%silvia%' then
    v_effective_tipo := 'nutricion';
    if v_local_weekday <> 5
      or not (v_local_time = any(v_silvia_start_times)) then
      raise exception 'Silvia is not available at the requested time';
    end if;
    v_duracion := 90;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_profesor_id::text || ':' || p_fecha_inicio::text, 0)
  );

  select class.id
    into v_clase_id
    from public.clases as class
   where class.profesor_id = p_profesor_id
     and lower(coalesce(class.tipo_clase, '')) = v_effective_tipo
     and class.fecha_inicio = p_fecha_inicio
     and class.activa is true
   order by class.id
   limit 1;

  if v_clase_id is null then
    v_nombre_clase := case
      when v_professional_identity like '%silvia%' then 'Consulta Ayurveda'
      when v_professional_identity like '%isabel%' and v_effective_tipo = 'nutricion'
        then 'Consulta PNI & Nutrición'
      when v_professional_identity like '%isabel%'
        then 'Consulta PNI / Psicología'
      when v_effective_tipo = 'psicologia' then 'Consulta Psicología'
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
      v_effective_tipo,
      v_duracion,
      true
    ) returning id into v_clase_id;
  end if;

  perform public.reservar_consulta_atomica(
    v_effective_tipo,
    v_clase_id,
    p_user_id,
    p_cobrar_saldo
  );

  return v_clase_id;
end;
$function$;
