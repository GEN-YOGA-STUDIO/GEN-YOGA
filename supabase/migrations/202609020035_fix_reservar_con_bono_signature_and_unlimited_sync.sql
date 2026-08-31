-- ==============================================================================
-- Migración: Hotfix crítico reservas, clases introductorias para admin y alumnos,
--            sincronización de Bono Ilimitado y huecos libres en calendario público.
-- Fecha: 2026-09-02 (Hotfix Urgente)
-- ==============================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- 1. Eliminar versiones previas para evitar colisiones en PostgREST
drop function if exists public.reservar_con_bono(bigint, uuid) cascade;
drop function if exists public.reservar_con_bono(bigint, uuid, boolean) cascade;
drop function if exists public.reservar_con_bono(numeric, uuid, boolean) cascade;
drop function if exists public.reservar_con_bono cascade;

-- 2. Función reservar_con_bono con lógica completa para sesiones introductorias, admin y bonos
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_is_staff boolean;
  v_target_role text;
  v_target_id uuid := p_user_id;
  v_legacy_credits integer;
  v_free_credits integer;
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
  v_marked_free boolean;
  v_professor_id public.clases.profesor_id%type;
  v_professional_identity text := '';
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

  -- Perfil de quien realiza la acción (actor)
  select lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), ''))
    into v_actor_role, v_actor_email
    from public.profiles
   where id = v_actor_id;
  if not found then
    raise exception 'No se encontró el perfil que realiza la reserva.' using errcode = 'P0002';
  end if;

  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'No puedes reservar una clase para otra persona.' using errcode = '42501';
  end if;

  -- Datos de la clase
  select coalesce(capacidad_max, 0), fecha_inicio, nombre,
         lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false)
    into v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free
    from public.clases
   where id = p_clase_id
   for update;

  if not found or v_class_type not in ('yoga', 'taller') or not v_class_active then
    raise exception 'La clase especificada no está disponible.' using errcode = 'P0002';
  end if;

  if v_professor_id is not null then
    select lower(concat_ws(
      ' ', coalesce(nombre, ''), coalesce(apellidos, ''), coalesce(email, '')
    ))
      into v_professional_identity
      from public.profesionales
     where id = v_professor_id;
    v_professional_identity := coalesce(v_professional_identity, '');
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
      select 1
        from public.profesionales
       where id = v_professor_id
         and lower(nullif(trim(email), '')) = v_actor_email
    ) then
    raise exception 'Solo puedes gestionar reservas de tus propias clases.' using errcode = '42501';
  end if;

  -- Antelación mínima (personal de administración y profesorado pueden registrar alumnos sin bloqueo por horas)
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

  if not v_actor_is_staff
    and v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) then
    raise exception 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours using errcode = 'P0001';
  end if;

  -- Comprobar si ya existe reserva confirmada
  if exists (
    select 1
      from public.reservas_yoga
     where clase_id = p_clase_id
       and user_id = v_target_id
       and estado = 'confirmada'
  ) then
    raise exception 'Ya tienes una reserva confirmada para esta clase.' using errcode = '23505';
  end if;

  -- Aforo
  select count(*)::integer
    into v_occupied
    from public.reservas_yoga
   where clase_id = p_clase_id
     and estado = 'confirmada';
  if v_occupied >= v_capacity then
    raise exception 'La clase está completa.' using errcode = 'P0001';
  end if;

  -- Perfil del alumno
  select lower(trim(coalesce(rol, ''))), coalesce(bonos, 0),
         coalesce(saldo_clases_gratis, 0), coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    into v_target_role, v_legacy_credits, v_free_credits, v_unlimited_active,
         v_membership_start, v_membership_end
    from public.profiles
   where id = v_target_id
   for update;

  if not found then
    raise exception 'No se encontró el perfil del alumno.' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo los alumnos pueden reservar clases.' using errcode = '42501';
  end if;

  -- CASO 1: Clase Gratuita o Promocional (Introductoria)
  v_is_free := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  );

  -- Si la clase está marcada como 100% gratuita por el estudio
  if v_marked_free then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    return;
  end if;

  -- Si es sesión introductoria y el alumno dispone de saldo de clase gratis
  if v_is_free and v_free_credits >= 1 then
    update public.profiles
       set saldo_clases_gratis = saldo_clases_gratis - 1
     where id = v_target_id
       and saldo_clases_gratis >= 1;
    if found then
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true
      );
      return;
    end if;
  end if;

  -- Si es sesión introductoria y el ADMIN / PERSONAL está asignando al alumno desde recepción
  if v_is_free and v_actor_is_staff and v_target_id <> v_actor_id then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    return;
  end if;

  -- CASO 2: Bono Ilimitado (Comprueba periodo que cubre la fecha de la sesión)
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
  elsif v_unlimited_active then
    if v_membership_start is null then
      v_membership_start := date_trunc('month', v_starts_at at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
    end if;
    if v_membership_end is null then
      v_membership_end := (date_trunc('month', v_starts_at at time zone 'Europe/Madrid') + interval '1 month') at time zone 'Europe/Madrid';
    end if;
  end if;

  if v_unlimited_active
    and v_membership_start is not null
    and v_membership_end is not null
    and v_starts_at >= v_membership_start
    and v_starts_at < v_membership_end then

    if v_is_special then
      select count(*)::integer
        into v_special_count
        from public.reservas_yoga as booking
        join public.clases as class on class.id = booking.clase_id
       where booking.user_id = v_target_id
         and booking.estado = 'confirmada'
         and coalesce(booking.usado_bono_mensual, false)
         and lower(trim(coalesce(class.tipo_clase, ''))) = 'taller'
         and class.fecha_inicio >= v_membership_start
         and class.fecha_inicio < v_membership_end;
      if v_special_count >= 1 then
        raise exception 'Ya has utilizado la clase especial incluida en este mes natural.'
          using errcode = 'P0001';
      end if;
    end if;

    v_use_unlimited := true;
  end if;

  -- CASO 3: Packs de Clases o Saldo de Bonos
  if not v_use_unlimited then
    if v_is_special then
      raise exception 'Las clases especiales requieren un Bono Ilimitado activo y disponibilidad mensual.'
        using errcode = 'P0001';
    end if;

    select id
      into v_pack_id
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
       where id = v_pack_id
         and credits_remaining > 0;
      if not found then
        raise exception 'El pack seleccionado ya no tiene clases disponibles.' using errcode = 'P0001';
      end if;
    else
      update public.profiles
         set bonos = coalesce(bonos, 0) - 1
       where id = v_target_id
         and coalesce(bonos, 0) >= 1;
      if not found then
        raise exception 'No dispones de un bono activo o clases disponibles para esta fecha. Adquiere un pack de clases o bono ilimitado.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- Insertar reserva
  insert into public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado
  ) values (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    not v_use_unlimited, v_pack_id, false
  );
end;
$function$;

revoke all on function public.reservar_con_bono(bigint, uuid, boolean) from public;
grant execute on function public.reservar_con_bono(bigint, uuid, boolean) to anon, authenticated, service_role;


-- 3. Función RPC para que el Calendario Público muestre siempre huecos libres exactos en tiempo real
create or replace function public.get_public_weekly_schedule(
  p_week_start date
)
returns table (
  id bigint,
  nombre text,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  duracion_minutos integer,
  capacidad_max integer,
  profesor_id bigint,
  tipo_clase text,
  tipo_clase_id bigint,
  activa boolean,
  es_especial boolean,
  ocupadas bigint,
  plazas_libres bigint,
  completa boolean,
  profesor_nombre text,
  profesor_apellidos text,
  profesor_color text,
  profesor_visible_publico boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    c.id,
    c.nombre,
    c.fecha_inicio,
    c.fecha_fin,
    c.duracion_minutos,
    case
      when lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
        then case when c.capacidad_max > 0 and c.capacidad_max <= 10 then c.capacidad_max else 10 end
      else greatest(0, coalesce(c.capacidad_max, 10))
    end as capacidad_max,
    c.profesor_id,
    c.tipo_clase,
    c.tipo_clase_id,
    c.activa,
    coalesce(c.es_especial, false) as es_especial,
    count(r.id) as ocupadas,
    greatest(0, (
      case
        when lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
          then case when c.capacidad_max > 0 and c.capacidad_max <= 10 then c.capacidad_max else 10 end
        else greatest(0, coalesce(c.capacidad_max, 10))
      end
    ) - count(r.id)) as plazas_libres,
    (count(r.id) >= (
      case
        when lower(trim(coalesce(c.tipo_clase, ''))) = 'yoga'
          then case when c.capacidad_max > 0 and c.capacidad_max <= 10 then c.capacidad_max else 10 end
        else greatest(0, coalesce(c.capacidad_max, 10))
      end
    )) as completa,
    p.nombre as profesor_nombre,
    p.apellidos as profesor_apellidos,
    p.color as profesor_color,
    coalesce(p.visible_publico, true) as profesor_visible_publico
  from public.clases c
  left join public.profesionales p on p.id = c.profesor_id
  left join public.reservas_yoga r on r.clase_id = c.id and r.estado = 'confirmada'
  where c.activa = true
    and coalesce(p.visible_publico, true) = true
    and (c.fecha_inicio at time zone 'Europe/Madrid')::date >= p_week_start
    and (c.fecha_inicio at time zone 'Europe/Madrid')::date < p_week_start + 7
  group by c.id, c.nombre, c.fecha_inicio, c.fecha_fin, c.duracion_minutos, c.capacidad_max,
           c.profesor_id, c.tipo_clase, c.tipo_clase_id, c.activa, c.es_especial,
           p.nombre, p.apellidos, p.color, p.visible_publico
  order by c.fecha_inicio;
$function$;

grant execute on function public.get_public_weekly_schedule(date) to anon, authenticated, service_role;

-- 4. Notificar a PostgREST para recargar instantáneamente el Schema Cache
notify pgrst, 'reload schema';

commit;
