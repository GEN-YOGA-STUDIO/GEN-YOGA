-- ==============================================================================
-- Migración 202609020066: Soporte explícito para selector de bonos en reservas
-- Permite elegir explícitamente entre Bono de Bienvenida (false) y Yoga en Compañía (true)
-- o resolver automáticamente según la modalidad
-- ==============================================================================

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

  -- 2. Elección explícita de Bono de Bienvenida (p_use_welcome_companion = false)
  if not v_is_special and p_use_welcome_companion is false and v_free_credits >= 1 then
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

  -- 3. Elección explícita de Bono de Yoga en Compañía (p_use_welcome_companion = true)
  if not v_is_special and p_use_welcome_companion is true and v_companion_credits >= 1 then
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

  -- 4. Flujo por defecto (cuando no se especificó preferencia)
  -- 4.1. Si la clase es de compañía y tiene saldo de compañía
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

  -- 4.2. Canje con Bono de Bienvenida general
  if not v_is_special and v_free_credits >= 1 and (v_is_free or p_use_welcome_companion is false) then
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

  -- 4.3. Canje con Bono de Compañía residual si es clase elegible
  if not v_is_special and v_companion_credits >= 1 and v_is_free then
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

  -- 5. Canje con Bono Ilimitado (mes natural)
  v_natural_membership_start := date_trunc('month', v_starts_at at time zone 'Europe/Madrid') at time zone 'Europe/Madrid';
  v_natural_membership_end := (date_trunc('month', v_starts_at at time zone 'Europe/Madrid') + interval '1 month') at time zone 'Europe/Madrid';

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

  -- 6. Canje con Packs de clases (4, 6, 10, suelta)
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

    -- Saldo heredado en profiles.bonos
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
