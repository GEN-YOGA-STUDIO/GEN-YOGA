-- ==============================================================================
-- Migración 202609020050 (v7.81): Sistema Integral de los 5 Bonos de GEN Yoga
-- ------------------------------------------------------------------------------
-- Restaura y garantiza el funcionamiento independiente de los 5 tipos de bono:
--   1. Clases Sueltas / Packs (bonos / class_credit_packs)
--   2. Bono de Bienvenida / Sesión Introductoria (saldo_clases_gratis)
--   3. Bono de Yoga en Compañía (saldo_yoga_compania)
--   4. Consulta Gratuita de Valoración (saldo_consultas_gratis)
--   5. Bono Mensual Ilimitado (unlimited_membership_periods / bono_mensual_activo)
--
-- Funciones actualizadas:
--   - es_clase_elegible_bono_gratis: reconoce clases gratuitas y de compañía.
--   - reservar_con_bono: canjea primero el bono de compañía si la clase es de
--     compañía, o el bono de bienvenida / sueltas según corresponda.
--   - cancelar_con_bono: devuelve exactamente el bono consumido.
--   - ajustar_saldo_usuario: gestiona los saldos independientes de forma atómica.
-- ==============================================================================

begin;

-- 1. Columnas independientes en profiles
alter table public.profiles
  add column if not exists saldo_clases_gratis integer not null default 0,
  add column if not exists saldo_yoga_compania integer not null default 0,
  add column if not exists saldo_consultas_gratis integer not null default 0;

-- Asegurar que los alumnos que nunca hayan consumido un bono de bienvenida o de compañía tengan saldo inicial (1)
update public.profiles p
   set saldo_clases_gratis = case when coalesce(p.saldo_clases_gratis, 0) = 0 and not exists (
         select 1 from public.reservas_yoga r where r.user_id = p.id and coalesce(r.saldo_gratis_descontado, false) and r.welcome_companion_modality is null
       ) then 1 else coalesce(p.saldo_clases_gratis, 0) end,
       saldo_yoga_compania = case when coalesce(p.saldo_yoga_compania, 0) = 0 and not exists (
         select 1 from public.reservas_yoga r where r.user_id = p.id and coalesce(r.saldo_gratis_descontado, false) and r.welcome_companion_modality is not null
       ) then 1 else coalesce(p.saldo_yoga_compania, 0) end
 where lower(coalesce(p.rol, 'alumno')) not in ('admin', 'profesor', 'trabajador', 'profesional');

-- 2. Clasificador de elegibilidad para bono gratis / Yoga en Compañía
drop function if exists public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) cascade;
drop function if exists public.es_clase_elegible_bono_gratis(text, text, timestamptz, boolean) cascade;
drop function if exists public.es_clase_elegible_bono_gratis(text, timestamptz, text) cascade;
drop function if exists public.es_clase_elegible_bono_gratis(text) cascade;
drop function if exists public.es_clase_elegible_bono_gratis cascade;

create or replace function public.es_clase_elegible_bono_gratis(
  p_nombre text,
  p_fecha_inicio timestamptz default null,
  p_identidad_profesional text default '',
  p_es_gratuita boolean default false
)
returns boolean
language plpgsql
immutable
as $$
declare
  v_nom text := translate(lower(coalesce(p_nombre, '')), 'áéíóúüñ', 'aeiouun');
begin
  if p_es_gratuita is true then
    return true;
  end if;

  if v_nom ~ '(introductor|bienvenida|abierta|gratis|prueba|madre|hija|compan|colega|pareja|abuela|hijo)' then
    return true;
  end if;

  return true;
end;
$$;

revoke all on function public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) from public, anon;
grant execute on function public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) to authenticated, anon, service_role;

-- 3. Recrear reservar_con_bono soportando Yoga en Compañía y Bienvenida de forma independiente
drop function if exists public.reservar_con_bono(bigint, uuid, boolean) cascade;
drop function if exists public.reservar_con_bono(bigint, uuid) cascade;
drop function if exists public.reservar_con_bono(numeric, uuid, boolean) cascade;
drop function if exists public.reservar_con_bono cascade;

create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean default false
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
  v_free_credits integer;
  v_companion_credits integer;
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
  v_companion_modality text;
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

  select coalesce(capacidad_max, 0), fecha_inicio, nombre,
         lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         profesor_id, coalesce(es_gratuita, false),
         companion_modality
    into v_capacity, v_starts_at, v_class_name, v_class_type, v_class_active,
         v_professor_id, v_marked_free, v_companion_modality
    from public.clases
   where id = p_clase_id
   for update;

  if not found or v_class_type not in ('yoga', 'taller') or not v_class_active then
    raise exception 'La clase especificada no está disponible.' using errcode = 'P0002';
  end if;

  if v_professor_id is not null then
    select lower(concat_ws(' ', coalesce(nombre, ''), coalesce(apellidos, ''), coalesce(email, '')))
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
    when others then
      v_booking_limit_hours := 12;
  end;
  v_booking_limit_hours := coalesce(v_booking_limit_hours, 12);

  if not v_actor_is_staff
    and v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) then
    raise exception 'Las reservas cierran % h antes del inicio. Para esta clase ya ha pasado el plazo.',
      v_booking_limit_hours using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.reservas_yoga
     where clase_id = p_clase_id
       and user_id = v_target_id
       and estado = 'confirmada'
  ) then
    raise exception 'Ya tienes una reserva confirmada para esta clase.' using errcode = '23505';
  end if;

  select count(*)::integer
    into v_occupied
    from public.reservas_yoga
   where clase_id = p_clase_id
     and estado = 'confirmada';
  if v_occupied >= v_capacity then
    raise exception 'La clase está completa.' using errcode = 'P0001';
  end if;

  select lower(trim(coalesce(rol, ''))), coalesce(bonos, 0),
         coalesce(saldo_clases_gratis, 0), coalesce(saldo_yoga_compania, 0),
         coalesce(bono_mensual_activo, false),
         bono_mensual_inicio, bono_mensual_fin
    into v_target_role, v_legacy_credits, v_free_credits, v_companion_credits,
         v_unlimited_active, v_membership_start, v_membership_end
    from public.profiles
   where id = v_target_id
   for update;

  if not found then
    raise exception 'No se encontró el perfil del alumno.' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo los alumnos pueden reservar clases.' using errcode = '42501';
  end if;

  v_is_free := v_marked_free or (v_companion_modality is not null) or public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  );

  -- 1. Clase 100% gratuita configurada por el estudio (no descuenta saldo)
  if v_marked_free then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    return;
  end if;

  -- 2. Canje con Bono de Yoga en Compañía (cuando la clase es de compañía o el alumno usa saldo de compañía)
  if not v_is_special and (v_companion_modality is not null or p_use_welcome_companion) and v_companion_credits >= 1 then
    update public.profiles
       set saldo_yoga_compania = saldo_yoga_compania - 1
     where id = v_target_id
       and saldo_yoga_compania >= 1;
    if found then
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true, coalesce(v_companion_modality, 'colegas')
      );
      return;
    end if;
  end if;

  -- 3. Canje con Bono de Bienvenida / Sesión Introductoria
  if not v_is_special and v_free_credits >= 1 then
    update public.profiles
       set saldo_clases_gratis = saldo_clases_gratis - 1
     where id = v_target_id
       and saldo_clases_gratis >= 1;
    if found then
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true, null
      );
      return;
    end if;
  end if;

  -- 4. Fallback de Bono de Yoga en Compañía para clases regulares
  if not v_is_special and v_companion_credits >= 1 then
    update public.profiles
       set saldo_yoga_compania = saldo_yoga_compania - 1
     where id = v_target_id
       and saldo_yoga_compania >= 1;
    if found then
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true, coalesce(v_companion_modality, 'colegas')
      );
      return;
    end if;
  end if;

  -- 5. Sesión asignada manualmente por staff a un alumno
  if v_is_free and v_actor_is_staff and v_target_id <> v_actor_id then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    return;
  end if;

  -- 6. Bono Mensual Ilimitado
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

  if v_is_special and not v_use_unlimited then
    raise exception 'Las clases especiales requieren un Bono Ilimitado activo.'
      using errcode = 'P0001';
  end if;

  if v_use_unlimited then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) values (
      p_clase_id, v_target_id, 'confirmada', true, false, null, false, v_companion_modality
    );
    return;
  end if;

  -- 7. Consumo de Pack de Clases (ordenados por fecha de caducidad más cercana)
  select id
    into v_pack_id
    from public.class_credit_packs
   where user_id = v_target_id
     and credits_remaining > 0
     and expires_at > now()
     and expires_at >= v_starts_at
   order by expires_at asc, id asc
   limit 1
   for update;

  if found then
    update public.class_credit_packs
       set credits_remaining = credits_remaining - 1,
           updated_at = now()
     where id = v_pack_id
       and credits_remaining > 0;
    if found then
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, true, v_pack_id, false, v_companion_modality
      );
      return;
    end if;
  end if;

  -- 8. Consumo de saldo legacy en profiles.bonos
  if v_legacy_credits >= 1 then
    update public.profiles
       set bonos = bonos - 1
     where id = v_target_id
       and bonos >= 1;
    if found then
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, true, null, false, v_companion_modality
      );
      return;
    end if;
  end if;

  raise exception 'No tienes bonos disponibles para esta clase. Adquiere un pack o bono mensual para reservar.'
    using errcode = 'P0001';
end;
$$;

create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.reservar_con_bono(p_clase_id, p_user_id, false);
end;
$$;

revoke all on function public.reservar_con_bono(bigint, uuid, boolean) from public;
grant execute on function public.reservar_con_bono(bigint, uuid, boolean) to anon, authenticated, service_role;

revoke all on function public.reservar_con_bono(bigint, uuid) from public;
grant execute on function public.reservar_con_bono(bigint, uuid) to anon, authenticated, service_role;

-- 4. Recrear cancelar_con_bono reintegrando el bono exacto
create or replace function public.cancelar_con_bono(
  p_reserva_id bigint
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
  v_actor_is_admin boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_credit_debited boolean;
  v_free_credit_debited boolean;
  v_used_unlimited boolean;
  v_companion_modality text;
  v_pack_id bigint;
  v_starts_at timestamptz;
  v_class_type text;
  v_professor_id public.clases.profesor_id%type;
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
    from public.profiles
   where id = v_actor_id;
  if not found then
    raise exception 'No se encontró el perfil que realiza la cancelación.' using errcode = 'P0002';
  end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');
  v_actor_is_admin := v_actor_role = 'admin';

  select user_id, clase_id, coalesce(bono_descontado, false),
         coalesce(saldo_gratis_descontado, false),
         coalesce(usado_bono_mensual, false), welcome_companion_modality, class_pack_id
    into v_target_id, v_class_id, v_credit_debited,
         v_free_credit_debited, v_used_unlimited, v_companion_modality, v_pack_id
    from public.reservas_yoga
   where id = p_reserva_id
     and estado = 'confirmada'
   for update;
  if not found then
    raise exception 'La reserva especificada no existe.' using errcode = 'P0002';
  end if;
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'No puedes cancelar la reserva de otra persona.' using errcode = '42501';
  end if;

  select fecha_inicio, lower(trim(coalesce(tipo_clase, ''))), profesor_id
    into v_starts_at, v_class_type, v_professor_id
    from public.clases
   where id = v_class_id
   for update;
  if not found or v_class_type not in ('yoga', 'taller') then
    raise exception 'Esta reserva no corresponde a una clase reservable.' using errcode = 'P0002';
  end if;

  if v_target_id <> v_actor_id and not v_actor_is_admin
    and not exists (
      select 1
        from public.profesionales
       where id = v_professor_id
         and lower(nullif(trim(email), '')) = v_actor_email
    ) then
    raise exception 'Solo puedes gestionar reservas de tus propias clases.' using errcode = '42501';
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
    when others then
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

  if not (v_actor_is_admin and v_allow_admin_override)
    and (v_starts_at is null
      or v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours)) then
    raise exception 'Ya no puedes cancelar: faltan % h o menos para la clase. El bono reservado no se devuelve.',
      v_cancel_limit_hours using errcode = 'P0001';
  end if;

  delete from public.reservas_yoga where id = p_reserva_id;

  if v_free_credit_debited then
    if v_companion_modality is not null then
      update public.profiles
         set saldo_yoga_compania = coalesce(saldo_yoga_compania, 0) + 1
       where id = v_target_id;
    else
      update public.profiles
         set saldo_clases_gratis = coalesce(saldo_clases_gratis, 0) + 1
       where id = v_target_id;
    end if;
  elsif v_credit_debited and v_pack_id is not null then
    update public.class_credit_packs
       set credits_remaining = least(credits_total, credits_remaining + 1),
           updated_at = now()
     where id = v_pack_id
       and user_id = v_target_id;
    if not found then
      raise exception 'No se encontró el pack al devolver la clase.' using errcode = 'P0002';
    end if;
  elsif v_credit_debited then
    update public.profiles
       set bonos = coalesce(bonos, 0) + 1
     where id = v_target_id;
  elsif v_used_unlimited then
    null;
  end if;
end;
$function$;

revoke all on function public.cancelar_con_bono(bigint) from public, anon;
grant execute on function public.cancelar_con_bono(bigint) to authenticated, anon, service_role;

-- 5. Recrear ajustar_saldo_usuario gestionando los 5 bonos independientemente
create or replace function public.ajustar_saldo_usuario(p_user_id uuid, p_tipo text, p_delta integer)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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
    'yoga', 'psicologia', 'nutricion', 'clases_gratis', 'bienvenida', 'consultas_gratis', 'yoga_compania'
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
  elsif p_tipo in ('clases_gratis', 'bienvenida') then
    update public.profiles
       set saldo_clases_gratis = greatest(coalesce(saldo_clases_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_clases_gratis into v_new_balance;
  elsif p_tipo = 'yoga_compania' then
    update public.profiles
       set saldo_yoga_compania = greatest(coalesce(saldo_yoga_compania, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_yoga_compania into v_new_balance;
  elsif p_tipo = 'consultas_gratis' then
    update public.profiles
       set saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;
  end if;

  return v_new_balance;
end;
$$;

grant execute on function public.ajustar_saldo_usuario(uuid, text, integer)
  to anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
