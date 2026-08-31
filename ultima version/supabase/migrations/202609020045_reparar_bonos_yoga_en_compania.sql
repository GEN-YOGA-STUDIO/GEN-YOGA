-- ==============================================================================
-- Migración 202609020045 (v7.67): Reparación integral de los bonos Yoga en Compañía
-- ------------------------------------------------------------------------------
-- Restaura el sistema completo de bonos gratuitos (Yoga en Compañía / Consulta Gratis):
--   1. Garantiza las columnas saldo_clases_gratis y saldo_consultas_gratis en profiles.
--   2. Rescata los saldos de la columna heredada saldo_yoga_compania si existiera.
--   3. Restaura 1 bono de bienvenida a los alumnos que nunca han consumido uno.
--   4. Recrea ajustar_saldo_usuario con soporte completo (incluye clases_gratis).
--   5. Amplía es_clase_elegible_bono_gratis para reconocer sesiones de
--      "Yoga en Compañía" / "Yoga con colegas" además del resto de modalidades.
--   6. Recrea reservar_con_bono (depende del clasificador anterior) con las
--      mismas reglas canónicas de la migración 202609020039.
--   7. Fuerza la recarga del esquema de PostgREST.
--
-- La migración es idempotente: puede ejecutarse varias veces sin efectos
-- secundarios y es segura en cualquier estado previo de la base de datos.
-- ==============================================================================

begin;

-- 1. Columnas de saldos gratuitos ------------------------------------------------
alter table public.profiles
  add column if not exists saldo_clases_gratis integer not null default 0,
  add column if not exists saldo_consultas_gratis integer not null default 0;

-- 2. Rescate de la columna heredada saldo_yoga_compania (si existe en la BD) ----
do $$
declare
  v_legacy_exists boolean;
begin
  select exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'saldo_yoga_compania'
  ) into v_legacy_exists;

  if v_legacy_exists then
    execute 'update public.profiles
                set saldo_clases_gratis = greatest(
                      coalesce(saldo_clases_gratis, 0),
                      coalesce(saldo_yoga_compania, 0)
                    )';
  end if;
end;
$$;

-- 3. Restaurar el bono de bienvenida a quien nunca lo ha consumido --------------
-- Los alumnos que tienen saldo 0 y ninguna reserva con saldo_gratis_descontado
-- recuperan su bono gratuito. Si la columna de control no existe todavía en la
-- BD remota, se restaura igualmente (comportamiento original de bienvenida).
do $$
declare
  v_flag_exists boolean;
begin
  select exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'reservas_yoga'
       and column_name = 'saldo_gratis_descontado'
  ) into v_flag_exists;

  if v_flag_exists then
    execute 'update public.profiles p
                set saldo_clases_gratis = 1
              where lower(coalesce(p.rol, ''alumno'')) not in (''admin'', ''profesor'', ''trabajador'', ''profesional'')
                and coalesce(p.saldo_clases_gratis, 0) = 0
                and not exists (
                      select 1
                        from public.reservas_yoga r
                       where r.user_id = p.id
                         and coalesce(r.saldo_gratis_descontado, false)
                    )';
  else
    update public.profiles p
       set saldo_clases_gratis = 1
     where lower(coalesce(p.rol, 'alumno')) not in ('admin', 'profesor', 'trabajador', 'profesional')
       and coalesce(p.saldo_clases_gratis, 0) = 0;
  end if;
end;
$$;

-- 4. Recrear ajustar_saldo_usuario con soporte completo --------------------------
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

comment on function public.ajustar_saldo_usuario(uuid, text, integer)
  is 'Atomically adjusts a client balance after verifying that the caller is an administrator. Supports yoga, psicologia, nutricion, clases_gratis (Yoga en Compañía) and consultas_gratis.';

-- 5. Ampliar la elegibilidad de bono gratis a Yoga en Compañía / con colegas ----
-- reservar_con_bono depende del clasificador: se eliminan ambos y se recrean
-- juntos para que la cascada nunca deje huérfana la reserva con bonos.
drop function if exists public.reservar_con_bono(bigint, uuid, boolean) cascade;
drop function if exists public.reservar_con_bono(bigint, uuid) cascade;
drop function if exists public.reservar_con_bono(numeric, uuid, boolean) cascade;
drop function if exists public.reservar_con_bono cascade;

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

  if v_nom ~ '(introductor|bienvenida|abierta|gratis|prueba|madre|hija|compania|colega)' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.es_clase_elegible_bono_gratis(text, timestamptz, text, boolean) from public, anon;

-- 6. Recrear reservar_con_bono (reglas canónicas de la migración 202609020039) --
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

  v_is_free := public.es_clase_elegible_bono_gratis(
    v_class_name,
    v_starts_at,
    v_professional_identity,
    v_marked_free
  );

  -- 1. Clase 100% gratuita por configuración del estudio
  if v_marked_free then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    return;
  end if;

  -- 2. Sesión gratuita/introductoria y el alumno tiene bono gratis disponible
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

  -- 3. Sesión introductoria asignada por el personal a un alumno
  if v_is_free and v_actor_is_staff and v_target_id <> v_actor_id then
    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, false
    );
    return;
  end if;

  -- 4. Bono Ilimitado
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

  -- 5. Packs de clases o saldo de bonos
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
        if v_is_free then
          raise exception 'No dispones de un bono gratuito ni de clases disponibles para esta sesión. Adquiere un pack de clases o bono ilimitado para reservar.' using errcode = 'P0001';
        else
          raise exception 'Esta clase regular requiere un bono o pack de clases activo. Adquiere un pack de clases para reservar.' using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;

  insert into public.reservas_yoga (
    clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
    class_pack_id, saldo_gratis_descontado
  ) values (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    not v_use_unlimited, v_pack_id, false
  );
end;
$$;

revoke all on function public.reservar_con_bono(bigint, uuid, boolean) from public;
grant execute on function public.reservar_con_bono(bigint, uuid, boolean) to anon, authenticated, service_role;

-- 7. Recargar el esquema de PostgREST para que los cambios sean visibles --------
notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
