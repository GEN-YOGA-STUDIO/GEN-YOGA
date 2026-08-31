-- ==============================================================================
-- Migración 202609020067: Restricción estricta de sesiones gratuitas elegibles
-- Únicas sesiones gratuitas permitidas con bono de bienvenida (clases/consultas):
-- 1. Ángel Javier: Domingo 30 Ago 10:00h y 12:00h (Yoga)
-- 2. Yanira: Martes 1 Sep 19:00h y Jueves 3 Sep 19:00h (Yoga)
-- 3. Miriam: Martes 1 Sep 20:15h y Miércoles 2 Sep 11:30h (Psicología)
-- 4. Silvia: Viernes 18 Sep 11:00h y Viernes 25 Sep 11:00h (Yoga & Ayurveda)
-- 5. Isabel: Jueves 3 Sep 11:00h y Martes 22 Sep 11:00h (PNI y Nutrición)
-- ==============================================================================

begin;

-- 1. Resetear es_gratuita = false en todas las clases para evitar que clases regulares queden marcadas por error
update public.clases
   set es_gratuita = false;

-- 2. Marcar estrictamente como es_gratuita = true únicamente las 10 sesiones oficiales designadas
-- 2.1. Ángel Javier: Domingo 30 Ago 2026 a las 10:00 y 12:00
update public.clases c
   set es_gratuita = true
  from public.profesionales p
 where c.profesor_id = p.id
   and (p.slug in ('angel', 'angel-javier') or lower(p.nombre) like '%ángel%' or lower(p.nombre) like '%angel%')
   and (c.fecha_inicio at time zone 'Europe/Madrid')::date = date '2026-08-30'
   and (c.fecha_inicio at time zone 'Europe/Madrid')::time in (time '10:00', time '12:00');

-- 2.2. Yanira: Martes 1 Sep y Jueves 3 Sep 2026 a las 19:00
update public.clases c
   set es_gratuita = true
  from public.profesionales p
 where c.profesor_id = p.id
   and (p.slug = 'yanira' or lower(p.nombre) like '%yanira%')
   and (c.fecha_inicio at time zone 'Europe/Madrid')::date in (date '2026-09-01', date '2026-09-03')
   and (c.fecha_inicio at time zone 'Europe/Madrid')::time = time '19:00';

-- 2.3. Miriam Alfaro: Martes 1 Sep 20:15 y Miércoles 2 Sep 11:30
update public.clases c
   set es_gratuita = true
  from public.profesionales p
 where c.profesor_id = p.id
   and (p.slug = 'miriam' or lower(p.nombre) like '%miriam%')
   and (
     ((c.fecha_inicio at time zone 'Europe/Madrid')::date = date '2026-09-01' and (c.fecha_inicio at time zone 'Europe/Madrid')::time = time '20:15')
     or
     ((c.fecha_inicio at time zone 'Europe/Madrid')::date = date '2026-09-02' and (c.fecha_inicio at time zone 'Europe/Madrid')::time = time '11:30')
   );

-- 2.4. Silvia Jaén: Viernes 18 Sep y Viernes 25 Sep 2026 a las 11:00
update public.clases c
   set es_gratuita = true
  from public.profesionales p
 where c.profesor_id = p.id
   and (p.slug = 'silvia' or lower(p.nombre) like '%silvia%')
   and (c.fecha_inicio at time zone 'Europe/Madrid')::date in (date '2026-09-18', date '2026-09-25')
   and (c.fecha_inicio at time zone 'Europe/Madrid')::time = time '11:00';

-- 2.5. Isabel Rodríguez: Jueves 3 Sep y Martes 22 Sep 2026 a las 11:00
update public.clases c
   set es_gratuita = true
  from public.profesionales p
 where c.profesor_id = p.id
   and (p.slug = 'isabel' or lower(p.nombre) like '%isabel%')
   and (c.fecha_inicio at time zone 'Europe/Madrid')::date in (date '2026-09-03', date '2026-09-22')
   and (c.fecha_inicio at time zone 'Europe/Madrid')::time = time '11:00';

-- 3. Actualizar función determinista es_clase_elegible_bono_gratis
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
  v_local_start timestamp without time zone;
  v_local_date date;
  v_local_time time without time zone;
  v_prof text := lower(coalesce(p_identidad_profesional, ''));
begin
  if p_es_gratuita is true then
    return true;
  end if;

  if p_fecha_inicio is not null then
    v_local_start := p_fecha_inicio at time zone 'Europe/Madrid';
    v_local_date := v_local_start::date;
    v_local_time := v_local_start::time;

    -- Ángel Javier: 2026-08-30 10:00 y 12:00
    if v_local_date = date '2026-08-30' and v_local_time in (time '10:00', time '12:00') and (v_prof like '%angel%' or v_prof like '%ángel%') then
      return true;
    end if;

    -- Yanira: 2026-09-01 y 2026-09-03 a las 19:00
    if v_local_date in (date '2026-09-01', date '2026-09-03') and v_local_time = time '19:00' and v_prof like '%yanira%' then
      return true;
    end if;

    -- Miriam: 2026-09-01 20:15 y 2026-09-02 11:30
    if ((v_local_date = date '2026-09-01' and v_local_time = time '20:15') or (v_local_date = date '2026-09-02' and v_local_time = time '11:30')) and v_prof like '%miriam%' then
      return true;
    end if;

    -- Silvia: 2026-09-18 y 2026-09-25 a las 11:00
    if v_local_date in (date '2026-09-18', date '2026-09-25') and v_local_time = time '11:00' and v_prof like '%silvia%' then
      return true;
    end if;

    -- Isabel: 2026-09-03 y 2026-09-22 a las 11:00
    if v_local_date in (date '2026-09-03', date '2026-09-22') and v_local_time = time '11:00' and v_prof like '%isabel%' then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) from public;
grant execute on function public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) to anon, authenticated, service_role;

-- 4. Recrear reservar_con_bono asegurando que el bono de bienvenida SOLO pueda canjearse en sesiones gratuitas
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean default null
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
     and v_starts_at <= now() + (v_booking_limit_hours || ' hours')::interval then
    raise exception 'No se puede reservar con menos de % horas de antelación.', v_booking_limit_hours
      using errcode = 'P0003';
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

  v_is_free := v_marked_free or public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  );

  -- 1. Si el usuario intenta usar el bono de bienvenida en una clase que NO es gratuita:
  if p_use_welcome_companion is false and not v_is_free then
    raise exception 'Esta clase no es una sesión gratuita. Debes disponer de un bono de clases, pack o membresía para reservarla.' using errcode = 'P0001';
  end if;

  -- 2. Clase 100% gratuita configurada por el estudio (no descuenta saldo al alumno)
  if v_marked_free then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false, v_companion_modality
    );
    return;
  end if;

  -- 3. Elección explícita de Bono de Bienvenida (SOLO en clases elegibles como gratuitas)
  if not v_is_special and v_is_free and p_use_welcome_companion is false and v_free_credits >= 1 then
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

  -- 4. Elección explícita de Bono de Yoga en Compañía (en clases de modalidad compañía o gratuitas)
  if not v_is_special and (v_companion_modality is not null or v_is_free) and p_use_welcome_companion is true and v_companion_credits >= 1 then
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

  -- 5. Flujo por defecto si no se especificó preferencia:
  -- 5.1. Si la clase es gratuita elegible y tiene saldo gratis
  if not v_is_special and v_is_free and v_free_credits >= 1 then
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

  -- 5.2. Si la clase es de compañía y tiene saldo de compañía
  if not v_is_special and v_companion_modality is not null and v_companion_credits >= 1 then
    update public.profiles
       set saldo_yoga_compania = saldo_yoga_compania - 1
     where id = v_target_id
       and saldo_yoga_compania >= 1;
    if found then
      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, false, null, true, v_companion_modality
      );
      return;
    end if;
  end if;

  -- 6. Membresía Ilimitada
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
     and v_membership_start is not null
     and v_membership_end is not null
     and v_starts_at >= v_membership_start
     and v_starts_at < v_membership_end then
    v_use_unlimited := true;
  elsif exists (
    select 1
      from public.class_packs
     where user_id = v_target_id
       and pack_type = 'bono_ilimitado'
       and v_starts_at >= v_natural_membership_start
       and v_starts_at < v_natural_membership_end
  ) then
    v_use_unlimited := true;
  end if;

  if v_use_unlimited then
    if v_is_special then
      select count(*)::integer
        into v_special_count
        from public.reservas_yoga as r
        join public.clases as c on c.id = r.clase_id
       where r.user_id = v_target_id
         and r.estado = 'confirmada'
         and r.usado_bono_mensual = true
         and lower(trim(coalesce(c.tipo_clase, ''))) = 'taller'
         and c.fecha_inicio >= v_natural_membership_start
         and c.fecha_inicio < v_natural_membership_end;

      if v_special_count >= 1 then
        raise exception 'Ya has utilizado la clase especial mensual incluida en tu Bono Ilimitado.' using errcode = 'P0004';
      end if;
    end if;

    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado, welcome_companion_modality
    ) values (
      p_clase_id, v_target_id, 'confirmada', true, false, null, false, null
    );
    return;
  end if;

  -- 7. Packs de Clases (4, 6, 10, suelta)
  if not v_is_special then
    select id into v_pack_id
      from public.class_packs
     where user_id = v_target_id
       and clases_restantes >= 1
       and pack_type <> 'bono_ilimitado'
       and (valido_hasta is null or valido_hasta >= (v_starts_at at time zone 'Europe/Madrid')::date)
     order by created_at asc
     limit 1
     for update;

    if v_pack_id is not null then
      update public.class_packs
         set clases_restantes = clases_restantes - 1
       where id = v_pack_id
         and clases_restantes >= 1;
      if found then
        insert into public.reservas_yoga (
          clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
          class_pack_id, saldo_gratis_descontado, welcome_companion_modality
        ) values (
          p_clase_id, v_target_id, 'confirmada', false, true, v_pack_id, false, null
        );
        return;
      end if;
    end if;

    -- Saldo legacy en profiles.bonos
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
          p_clase_id, v_target_id, 'confirmada', false, true, null, false, null
        );
        return;
      end if;
    end if;
  end if;

  raise exception 'No dispones de saldo, bono activo ni pack válido para reservar esta clase.' using errcode = 'P0005';
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
  perform public.reservar_con_bono(p_clase_id, p_user_id, null);
end;
$$;

revoke all on function public.reservar_con_bono(bigint, uuid, boolean) from public;
grant execute on function public.reservar_con_bono(bigint, uuid, boolean) to anon, authenticated, service_role;

revoke all on function public.reservar_con_bono(bigint, uuid) from public;
grant execute on function public.reservar_con_bono(bigint, uuid) to anon, authenticated, service_role;

commit;
