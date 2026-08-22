-- Hotfix de reservas para producción.
--
-- Corrige de forma conjunta:
--   * clases promocionales que el frontend mostraba como gratuitas pero el RPC cobraba;
--   * consultas invisibles para su propietario y para administración por ausencia de RLS SELECT;
--   * procedencia ambigua del saldo al cancelar una reserva;
--   * posibilidad de omitir el cobro de una consulta de pago invocando el RPC directamente.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.reservas_yoga
  add column if not exists saldo_gratis_descontado boolean not null default false;

alter table public.reservas_psicologia
  add column if not exists saldo_gratis_descontado boolean not null default false;

alter table public.reservas_nutricion
  add column if not exists saldo_gratis_descontado boolean not null default false;

comment on column public.reservas_yoga.saldo_gratis_descontado is
  'True únicamente cuando esta reserva consumió saldo_clases_gratis y debe devolverlo al cancelar.';
comment on column public.reservas_psicologia.saldo_gratis_descontado is
  'True únicamente cuando esta reserva consumió saldo_consultas_gratis y debe devolverlo al cancelar.';
comment on column public.reservas_nutricion.saldo_gratis_descontado is
  'True únicamente cuando esta reserva consumió saldo_consultas_gratis y debe devolverlo al cancelar.';

-- Reconciliar la procedencia de reservas gratuitas anteriores a este ledger.
-- No se altera el saldo actual: pudo haber ajustes administrativos posteriores.
update public.reservas_psicologia as booking
   set saldo_gratis_descontado = true
  from public.clases as class
 where class.id = booking.clase_id
   and booking.estado = 'confirmada'
   and not coalesce(booking.saldo_descontado, false)
   and not coalesce(booking.saldo_gratis_descontado, false)
   and lower(trim(coalesce(class.tipo_clase, ''))) = 'psicologia'
   and coalesce(class.es_gratuita, false);

update public.reservas_nutricion as booking
   set saldo_gratis_descontado = true
  from public.clases as class
 where class.id = booking.clase_id
   and booking.estado = 'confirmada'
   and not coalesce(booking.saldo_descontado, false)
   and not coalesce(booking.saldo_gratis_descontado, false)
   and lower(trim(coalesce(class.tipo_clase, ''))) = 'nutricion'
   and coalesce(class.es_gratuita, false);

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_saldo_clases_gratis_nonnegative'
  ) then
    alter table public.profiles
      add constraint profiles_saldo_clases_gratis_nonnegative
      check (saldo_clases_gratis >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_saldo_consultas_gratis_nonnegative'
  ) then
    alter table public.profiles
      add constraint profiles_saldo_consultas_gratis_nonnegative
      check (saldo_consultas_gratis >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reservas_yoga'::regclass
      and conname = 'reservas_yoga_free_credit_source_check'
  ) then
    alter table public.reservas_yoga
      add constraint reservas_yoga_free_credit_source_check
      check (
        not saldo_gratis_descontado
        or (
          not bono_descontado
          and not usado_bono_mensual
          and class_pack_id is null
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reservas_psicologia'::regclass
      and conname = 'reservas_psicologia_credit_source_check'
  ) then
    alter table public.reservas_psicologia
      add constraint reservas_psicologia_credit_source_check
      check (not (saldo_descontado and saldo_gratis_descontado)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reservas_nutricion'::regclass
      and conname = 'reservas_nutricion_credit_source_check'
  ) then
    alter table public.reservas_nutricion
      add constraint reservas_nutricion_credit_source_check
      check (not (saldo_descontado and saldo_gratis_descontado)) not valid;
  end if;
end
$constraints$;

alter table public.profiles
  validate constraint profiles_saldo_clases_gratis_nonnegative;
alter table public.profiles
  validate constraint profiles_saldo_consultas_gratis_nonnegative;
alter table public.reservas_yoga
  validate constraint reservas_yoga_free_credit_source_check;
alter table public.reservas_psicologia
  validate constraint reservas_psicologia_credit_source_check;
alter table public.reservas_nutricion
  validate constraint reservas_nutricion_credit_source_check;

-- Una única regla compartida entre servidor y pruebas para las franjas de oferta.
create or replace function public.es_clase_elegible_bono_gratis(
  p_nombre text,
  p_fecha_inicio timestamptz,
  p_identidad_profesional text,
  p_marcada_gratuita boolean
)
returns boolean
language sql
stable
set search_path = pg_catalog
as $function$
  select coalesce(p_marcada_gratuita, false)
    or (
      p_fecha_inicio is not null
      and (
        translate(lower(coalesce(p_nombre, '')), 'áéíóúüñ', 'aeiouun')
          ~ '(introductoria|gratis|prueba|madre|hija)'
        or (
          extract(isodow from p_fecha_inicio at time zone 'Europe/Madrid')::integer in (1, 3)
          and (p_fecha_inicio at time zone 'Europe/Madrid')::time
            between '16:10'::time and '16:20'::time
          and translate(
            lower(coalesce(p_identidad_profesional, '')),
            'áéíóúüñ',
            'aeiouun'
          ) like '%angel%'
        )
        or (
          extract(isodow from p_fecha_inicio at time zone 'Europe/Madrid')::integer in (3, 5)
          and (p_fecha_inicio at time zone 'Europe/Madrid')::time
            between '07:55'::time and '08:15'::time
          and translate(
            lower(coalesce(p_identidad_profesional, '')),
            'áéíóúüñ',
            'aeiouun'
          ) like '%yanira%'
        )
      )
    );
$function$;

-- Materializar también la regla en los horarios futuros para clientes móviles
-- o pestañas antiguas que todavía solo consulten la columna es_gratuita.
update public.clases as class
   set es_gratuita = true,
       updated_at = now()
  from public.profesionales as professional
 where professional.id = class.profesor_id
   and lower(trim(coalesce(class.tipo_clase, ''))) = 'yoga'
   and class.activa is true
   and class.fecha_inicio >= now() - interval '2 hours'
   and not coalesce(class.es_gratuita, false)
   and public.es_clase_elegible_bono_gratis(
     class.nombre,
     class.fecha_inicio,
     lower(concat_ws(
       ' ', professional.nombre, professional.apellidos, professional.email
     )),
     class.es_gratuita
   );

revoke all on function public.es_clase_elegible_bono_gratis(
  text, timestamptz, text, boolean
) from public, anon, authenticated;

-- Reglas de lectura sin recursión RLS. Las funciones pertenecen al propietario
-- de la base de datos y solo devuelven decisiones booleanas, nunca datos.
create or replace function public.es_staff_actual()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = auth.uid()
       and lower(trim(coalesce(profile.rol, ''))) in (
         'admin', 'profesor', 'trabajador', 'profesional'
       )
       and coalesce(profile.activo, true)
       and not coalesce(profile.account_deletion_pending, false)
  );
$function$;

revoke all on function public.es_staff_actual()
  from public, anon, authenticated;
grant execute on function public.es_staff_actual()
  to authenticated, service_role;

create or replace function public.es_admin_actual()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = auth.uid()
       and lower(trim(coalesce(profile.rol, ''))) = 'admin'
       and coalesce(profile.activo, true)
       and not coalesce(profile.account_deletion_pending, false)
  );
$function$;

revoke all on function public.es_admin_actual()
  from public, anon, authenticated;
grant execute on function public.es_admin_actual()
  to authenticated, service_role;

create or replace function public.puede_ver_reserva_clase(
  p_user_id uuid,
  p_clase_id bigint
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_deletion_pending boolean;
begin
  if v_actor_id is null then
    return false;
  end if;

  select lower(trim(coalesce(profile.rol, ''))),
         lower(nullif(trim(profile.email), '')),
         coalesce(profile.account_deletion_pending, false)
    into v_actor_role, v_actor_email, v_actor_deletion_pending
    from public.profiles as profile
   where profile.id = v_actor_id
     and coalesce(profile.activo, true);

  if not found or v_actor_deletion_pending then
    return false;
  end if;

  if v_actor_id = p_user_id then
    return true;
  end if;

  if v_actor_role = 'admin' then
    return true;
  end if;

  if v_actor_role not in ('profesor', 'trabajador', 'profesional')
    or v_actor_email is null then
    return false;
  end if;

  return exists (
    select 1
      from public.clases as class
      join public.profesionales as professional
        on professional.id = class.profesor_id
     where class.id = p_clase_id
       and lower(nullif(trim(professional.email), '')) = v_actor_email
  );
end;
$function$;

revoke all on function public.puede_ver_reserva_clase(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.puede_ver_reserva_clase(uuid, bigint)
  to authenticated, service_role;

-- Ocupación agregada para mostrar plazas sin revelar UUID, perfiles ni reservas
-- de otros clientes. La reserva transaccional sigue siendo la autoridad final.
create or replace function public.obtener_ocupacion_clases(
  p_clase_ids bigint[]
)
returns table (
  clase_id bigint,
  ocupadas bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ids bigint[];
begin
  if coalesce(cardinality(p_clase_ids), 0) > 1000 then
    raise exception 'too many class ids' using errcode = '22023';
  end if;

  select array_agg(distinct requested_id)
    into v_ids
    from unnest(coalesce(p_clase_ids, array[]::bigint[])) as requested(requested_id)
   where requested_id > 0;

  if coalesce(cardinality(v_ids), 0) = 0 then
    return;
  end if;

  return query
  with requested_classes as (
    select class.id
      from public.clases as class
     where class.id = any(v_ids)
       and class.activa is true
       and class.fecha_inicio >= now() - interval '2 hours'
       and lower(trim(coalesce(class.tipo_clase, ''))) in (
         'yoga', 'taller', 'especial', 'psicologia', 'nutricion'
       )
  )
  select occupancy.class_id, sum(occupancy.confirmed_count)::bigint
    from (
      select booking.clase_id as class_id, count(*)::bigint as confirmed_count
        from public.reservas_yoga as booking
        join requested_classes as requested on requested.id = booking.clase_id
       where booking.clase_id = any(v_ids)
         and booking.estado = 'confirmada'
       group by booking.clase_id
      union all
      select booking.clase_id, count(*)::bigint
        from public.reservas_psicologia as booking
        join requested_classes as requested on requested.id = booking.clase_id
       where booking.clase_id = any(v_ids)
         and booking.estado = 'confirmada'
       group by booking.clase_id
      union all
      select booking.clase_id, count(*)::bigint
        from public.reservas_nutricion as booking
        join requested_classes as requested on requested.id = booking.clase_id
       where booking.clase_id = any(v_ids)
         and booking.estado = 'confirmada'
       group by booking.clase_id
    ) as occupancy
   group by occupancy.class_id;
end;
$function$;

revoke all on function public.obtener_ocupacion_clases(bigint[])
  from public, anon, authenticated;
grant execute on function public.obtener_ocupacion_clases(bigint[])
  to anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.reservas_yoga enable row level security;
alter table public.reservas_psicologia enable row level security;
alter table public.reservas_nutricion enable row level security;

drop policy if exists pol_profiles_select on public.profiles;
drop policy if exists profiles_select_self_or_staff on public.profiles;
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.es_admin_actual()));

-- El personal necesita un directorio para gestionar citas y grupos, pero no
-- acceso a la ficha completa (Stripe, notas privadas o datos de borrado).
-- La función privilegiada valida al actor y solo devuelve cinco columnas. La
-- vista se mantiene SECURITY INVOKER para que no eluda permisos por sí misma.
create or replace function public.listar_directorio_perfiles_staff()
returns table (
  id uuid,
  email text,
  rol text,
  nombre text,
  apellidos text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select
    profile.id,
    profile.email,
    profile.rol,
    profile.nombre,
    profile.apellidos
  from public.profiles as profile
  where public.es_staff_actual()
    and coalesce(profile.activo, true)
    and not coalesce(profile.account_deletion_pending, false);
$function$;

revoke all on function public.listar_directorio_perfiles_staff()
  from public, anon, authenticated;
grant execute on function public.listar_directorio_perfiles_staff()
  to authenticated, service_role;

drop view if exists public.directorio_perfiles_staff;
create view public.directorio_perfiles_staff
with (security_barrier = true, security_invoker = true)
as
select *
from public.listar_directorio_perfiles_staff();

revoke all on table public.directorio_perfiles_staff
  from public, anon, authenticated;
grant select on table public.directorio_perfiles_staff
  to authenticated, service_role;

drop policy if exists pol_reservas_select on public.reservas_yoga;
drop policy if exists reservas_yoga_select_autorizado on public.reservas_yoga;
create policy reservas_yoga_select_autorizado
  on public.reservas_yoga
  for select
  to authenticated
  using (public.puede_ver_reserva_clase(user_id, clase_id));

drop policy if exists reservas_psicologia_select_autorizado
  on public.reservas_psicologia;
create policy reservas_psicologia_select_autorizado
  on public.reservas_psicologia
  for select
  to authenticated
  using (public.puede_ver_reserva_clase(user_id, clase_id));

drop policy if exists reservas_nutricion_select_autorizado
  on public.reservas_nutricion;
create policy reservas_nutricion_select_autorizado
  on public.reservas_nutricion
  for select
  to authenticated
  using (public.puede_ver_reserva_clase(user_id, clase_id));

-- Las mutaciones se realizan por RPCs SECURITY DEFINER que validan actor,
-- objetivo, aforo, saldos y procedencia. El navegador solo necesita SELECT.
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.reservas_yoga from public, anon, authenticated;
revoke all on table public.reservas_psicologia from public, anon, authenticated;
revoke all on table public.reservas_nutricion from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.reservas_yoga to authenticated;
grant select on table public.reservas_psicologia to authenticated;
grant select on table public.reservas_nutricion to authenticated;

-- Reserva yoga/taller: la oferta se decide en servidor y el origen del saldo queda registrado.
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid
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
  v_actor_deletion_pending boolean;
  v_actor_is_staff boolean;
  v_target_role text;
  v_target_deletion_pending boolean;
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

  select lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), '')),
         coalesce(account_deletion_pending, false)
    into v_actor_role, v_actor_email, v_actor_deletion_pending
    from public.profiles
   where id = v_actor_id
     and coalesce(activo, true);
  if not found then
    raise exception 'No se encontró el perfil que realiza la reserva.' using errcode = 'P0002';
  end if;
  if v_actor_deletion_pending then
    raise exception 'La cuenta está pendiente de eliminación.' using errcode = '42501';
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
         bono_mensual_inicio, bono_mensual_fin,
         coalesce(account_deletion_pending, false)
    into v_target_role, v_legacy_credits, v_free_credits, v_unlimited_active,
         v_membership_start, v_membership_end, v_target_deletion_pending
    from public.profiles
   where id = v_target_id
     and coalesce(activo, true)
   for update;
  if not found then
    raise exception 'No se encontró el perfil del alumno.' using errcode = 'P0002';
  end if;
  if v_target_deletion_pending then
    raise exception 'La cuenta del alumno está pendiente de eliminación.' using errcode = '42501';
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

  if v_is_free then
    update public.profiles
       set saldo_clases_gratis = saldo_clases_gratis - 1
     where id = v_target_id
       and saldo_clases_gratis >= 1;
    if not found then
      raise exception 'Ya has utilizado tu bono de clase gratuita o no dispones de saldo gratis suficiente.'
        using errcode = 'P0001';
    end if;

    insert into public.reservas_yoga (
      clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
      class_pack_id, saldo_gratis_descontado
    ) values (
      p_clase_id, v_target_id, 'confirmada', false, false, null, true
    );
    return;
  end if;

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
        raise exception 'No tienes clases vigentes disponibles para esta fecha.' using errcode = 'P0001';
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
$function$;

revoke all on function public.reservar_con_bono(bigint, uuid) from public, anon;
grant execute on function public.reservar_con_bono(bigint, uuid)
  to authenticated, service_role;

-- Cancelación yoga/taller: devuelve exactamente el origen que quedó registrado.
create or replace function public.cancelar_con_bono(p_reserva_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_deletion_pending boolean;
  v_actor_is_staff boolean;
  v_actor_is_admin boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_class_type text;
  v_professor_id public.clases.profesor_id%type;
  v_credit_debited boolean;
  v_free_credit_debited boolean;
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

  select lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), '')),
         coalesce(account_deletion_pending, false)
    into v_actor_role, v_actor_email, v_actor_deletion_pending
    from public.profiles
   where id = v_actor_id
     and coalesce(activo, true);
  if not found then
    raise exception 'No se encontró el perfil que realiza la cancelación.' using errcode = 'P0002';
  end if;
  if v_actor_deletion_pending then
    raise exception 'La cuenta está pendiente de eliminación.' using errcode = '42501';
  end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');
  v_actor_is_admin := v_actor_role = 'admin';

  select user_id, clase_id, coalesce(bono_descontado, false),
         coalesce(saldo_gratis_descontado, false),
         coalesce(usado_bono_mensual, false), class_pack_id
    into v_target_id, v_class_id, v_credit_debited,
         v_free_credit_debited, v_used_unlimited, v_pack_id
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

  if not (v_actor_is_admin and v_allow_admin_override)
    and (v_starts_at is null
      or v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours)) then
    raise exception 'Ya no puedes cancelar: faltan % h o menos para la clase. El bono reservado no se devuelve.',
      v_cancel_limit_hours using errcode = 'P0001';
  end if;

  delete from public.reservas_yoga where id = p_reserva_id;

  if v_free_credit_debited then
    update public.profiles
       set saldo_clases_gratis = saldo_clases_gratis + 1
     where id = v_target_id;
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
grant execute on function public.cancelar_con_bono(bigint)
  to authenticated, service_role;

-- Reserva de consulta: el cliente no puede desactivar el cobro desde la API.
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
  v_actor_deletion_pending boolean;
  v_actor_is_staff boolean;
  v_target_id uuid := coalesce(p_user_id, auth.uid());
  v_target_role text;
  v_target_deletion_pending boolean;
  v_class_type text;
  v_class_active boolean;
  v_capacity integer;
  v_starts_at timestamptz;
  v_professor_id public.clases.profesor_id%type;
  v_is_free boolean;
  v_occupied integer;
  v_reservation_id bigint;
  v_staff_no_charge boolean := false;
  v_charge_credit boolean := true;
  v_booking_limit_hours integer := 12;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion') then
    raise exception 'invalid consultation type' using errcode = '22023';
  end if;
  if p_clase_id is null or p_clase_id <= 0 or v_target_id is null then
    raise exception 'invalid booking request' using errcode = '22023';
  end if;

  select lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), '')),
         coalesce(account_deletion_pending, false)
    into v_actor_role, v_actor_email, v_actor_deletion_pending
    from public.profiles
   where id = v_actor_id
     and coalesce(activo, true);
  if not found then
    raise exception 'actor profile not found' using errcode = 'P0002';
  end if;
  if v_actor_deletion_pending then
    raise exception 'account deletion pending' using errcode = '42501';
  end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');

  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'not allowed to book for another user' using errcode = '42501';
  end if;

  select lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         coalesce(capacidad_max, 0), fecha_inicio, profesor_id,
         coalesce(es_gratuita, false)
    into v_class_type, v_class_active, v_capacity, v_starts_at,
         v_professor_id, v_is_free
    from public.clases
   where id = p_clase_id
   for update;

  if not found or v_class_type <> p_tipo or not v_class_active
    or v_capacity <= 0 or v_starts_at is null or v_starts_at <= now() then
    raise exception 'consultation slot not found or invalid' using errcode = 'P0002';
  end if;

  if v_target_id <> v_actor_id and v_actor_role <> 'admin'
    and not exists (
      select 1
        from public.profesionales
       where id = v_professor_id
         and lower(nullif(trim(email), '')) = v_actor_email
    ) then
    raise exception 'staff may only manage consultation slots linked to their professional profile'
      using errcode = '42501';
  end if;

  select lower(trim(coalesce(rol, ''))),
         coalesce(account_deletion_pending, false)
    into v_target_role, v_target_deletion_pending
    from public.profiles
   where id = v_target_id
     and coalesce(activo, true)
   for update;
  if not found then
    raise exception 'target profile not found' using errcode = 'P0002';
  end if;
  if v_target_deletion_pending then
    raise exception 'target account deletion pending' using errcode = '42501';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'staff users cannot book consultations' using errcode = '42501';
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

  if not v_actor_is_staff
    and v_starts_at <= now() + make_interval(hours => v_booking_limit_hours) then
    raise exception 'consultation slot is no longer bookable' using errcode = 'P0001';
  end if;

  if p_tipo = 'psicologia' then
    if exists (
      select 1 from public.reservas_psicologia
       where clase_id = p_clase_id
         and user_id = v_target_id
         and estado = 'confirmada'
    ) then
      raise exception 'consultation already booked' using errcode = '23505';
    end if;
    select count(*)::integer
      into v_occupied
      from public.reservas_psicologia
     where clase_id = p_clase_id
       and estado = 'confirmada';
  else
    if exists (
      select 1 from public.reservas_nutricion
       where clase_id = p_clase_id
         and user_id = v_target_id
         and estado = 'confirmada'
    ) then
      raise exception 'consultation already booked' using errcode = '23505';
    end if;
    select count(*)::integer
      into v_occupied
      from public.reservas_nutricion
     where clase_id = p_clase_id
       and estado = 'confirmada';
  end if;

  if v_occupied >= v_capacity then
    raise exception 'consultation is full' using errcode = 'P0001';
  end if;

  v_staff_no_charge := v_actor_is_staff
    and v_target_id <> v_actor_id
    and not coalesce(p_cobrar_saldo, true);

  if v_is_free and not v_staff_no_charge then
    update public.profiles
       set saldo_consultas_gratis = saldo_consultas_gratis - 1
     where id = v_target_id
       and saldo_consultas_gratis >= 1;
    if not found then
      raise exception 'Ya has utilizado tu bono de consulta gratuita o no dispones de saldo gratis suficiente.'
        using errcode = 'P0001';
    end if;

    if p_tipo = 'psicologia' then
      insert into public.reservas_psicologia (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, true
      ) returning id into v_reservation_id;
    else
      insert into public.reservas_nutricion (
        clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, true
      ) returning id into v_reservation_id;
    end if;
    return v_reservation_id;
  end if;

  v_charge_credit := not v_staff_no_charge;

  if v_charge_credit and p_tipo = 'psicologia' then
    update public.profiles
       set saldo_psicologia = saldo_psicologia - 1
     where id = v_target_id
       and saldo_psicologia >= 1;
    if not found then
      raise exception 'insufficient psychology credit' using errcode = 'P0001';
    end if;
  elsif v_charge_credit and p_tipo = 'nutricion' then
    update public.profiles
       set saldo_nutricion = saldo_nutricion - 1
     where id = v_target_id
       and saldo_nutricion >= 1;
    if not found then
      raise exception 'insufficient nutrition credit' using errcode = 'P0001';
    end if;
  end if;

  if p_tipo = 'psicologia' then
    insert into public.reservas_psicologia (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
    ) values (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false
    ) returning id into v_reservation_id;
  else
    insert into public.reservas_nutricion (
      clase_id, user_id, estado, saldo_descontado, saldo_gratis_descontado
    ) values (
      p_clase_id, v_target_id, 'confirmada', v_charge_credit, false
    ) returning id into v_reservation_id;
  end if;

  return v_reservation_id;
end;
$function$;

revoke all on function public.reservar_consulta_atomica(text, bigint, uuid, boolean)
  from public, anon;
grant execute on function public.reservar_consulta_atomica(text, bigint, uuid, boolean)
  to authenticated, service_role;

-- Cancelación de consulta estricta: no busca IDs en la tabla del otro tipo.
create or replace function public.cancelar_consulta_atomica(
  p_tipo text,
  p_reserva_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_deletion_pending boolean;
  v_actor_is_staff boolean;
  v_target_id uuid;
  v_class_id bigint;
  v_starts_at timestamptz;
  v_professor_id public.clases.profesor_id%type;
  v_cancel_limit_hours integer := 24;
  v_refund_paid boolean;
  v_refund_free boolean;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion')
    or p_reserva_id is null or p_reserva_id <= 0 then
    raise exception 'invalid cancellation request' using errcode = '22023';
  end if;

  select lower(trim(coalesce(rol, ''))), lower(nullif(trim(email), '')),
         coalesce(account_deletion_pending, false)
    into v_actor_role, v_actor_email, v_actor_deletion_pending
    from public.profiles
   where id = v_actor_id
     and coalesce(activo, true);
  if not found then
    raise exception 'actor profile not found' using errcode = 'P0002';
  end if;
  if v_actor_deletion_pending then
    raise exception 'account deletion pending' using errcode = '42501';
  end if;
  v_actor_is_staff := v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional');

  if p_tipo = 'psicologia' then
    select user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      into v_target_id, v_class_id, v_refund_paid, v_refund_free
      from public.reservas_psicologia
     where id = p_reserva_id
       and estado = 'confirmada'
     for update;
  else
    select user_id, clase_id, coalesce(saldo_descontado, false),
           coalesce(saldo_gratis_descontado, false)
      into v_target_id, v_class_id, v_refund_paid, v_refund_free
      from public.reservas_nutricion
     where id = p_reserva_id
       and estado = 'confirmada'
     for update;
  end if;

  if not found then
    raise exception 'consultation booking not found' using errcode = 'P0002';
  end if;
  if v_target_id <> v_actor_id and not v_actor_is_staff then
    raise exception 'not allowed to cancel this booking' using errcode = '42501';
  end if;

  select fecha_inicio, profesor_id
    into v_starts_at, v_professor_id
    from public.clases
   where id = v_class_id
     and lower(trim(coalesce(tipo_clase, ''))) = p_tipo;
  if not found then
    raise exception 'consultation slot not found' using errcode = 'P0002';
  end if;

  if v_starts_at is null or v_starts_at <= now() then
    raise exception 'consultation already started and cannot be cancelled automatically'
      using errcode = 'P0001';
  end if;

  if v_actor_is_staff and v_actor_role <> 'admin' and not exists (
    select 1
      from public.profesionales
     where id = v_professor_id
       and lower(nullif(trim(email), '')) = v_actor_email
  ) then
    raise exception 'staff may only manage consultation slots linked to their professional profile'
      using errcode = '42501';
  end if;

  if not v_actor_is_staff then
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

    if v_starts_at is null
      or v_starts_at <= now() + make_interval(hours => v_cancel_limit_hours) then
      raise exception 'consultation cancellation deadline has passed' using errcode = 'P0001';
    end if;
  end if;

  if p_tipo = 'psicologia' then
    delete from public.reservas_psicologia where id = p_reserva_id;
    if v_refund_paid then
      update public.profiles
         set saldo_psicologia = saldo_psicologia + 1
       where id = v_target_id;
    elsif v_refund_free then
      update public.profiles
         set saldo_consultas_gratis = saldo_consultas_gratis + 1
       where id = v_target_id;
    end if;
  else
    delete from public.reservas_nutricion where id = p_reserva_id;
    if v_refund_paid then
      update public.profiles
         set saldo_nutricion = saldo_nutricion + 1
       where id = v_target_id;
    elsif v_refund_free then
      update public.profiles
         set saldo_consultas_gratis = saldo_consultas_gratis + 1
       where id = v_target_id;
    end if;
  end if;

  return true;
end;
$function$;

revoke all on function public.cancelar_consulta_atomica(text, bigint)
  from public, anon;
grant execute on function public.cancelar_consulta_atomica(text, bigint)
  to authenticated, service_role;

-- Nunca permitir que ON DELETE CASCADE borre una reserva confirmada sin pasar
-- por su RPC de cancelación y sin devolver el saldo correspondiente.
create or replace function public.proteger_borrado_clase_con_reservas()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if exists (
    select 1 from public.reservas_yoga
     where clase_id = old.id and estado = 'confirmada'
  ) or exists (
    select 1 from public.reservas_psicologia
     where clase_id = old.id and estado = 'confirmada'
  ) or exists (
    select 1 from public.reservas_nutricion
     where clase_id = old.id and estado = 'confirmada'
  ) then
    raise exception 'class has confirmed bookings; cancel them before deleting the class'
      using errcode = '23503';
  end if;

  return old;
end;
$function$;

revoke all on function public.proteger_borrado_clase_con_reservas()
  from public, anon, authenticated;

drop trigger if exists trg_proteger_borrado_clase_con_reservas
  on public.clases;
create trigger trg_proteger_borrado_clase_con_reservas
before delete on public.clases
for each row
execute function public.proteger_borrado_clase_con_reservas();

-- La cancelación, el reembolso y el borrado del turno suceden en una sola
-- transacción y bajo el mismo bloqueo de fila de la clase.
create or replace function public.eliminar_turno_consulta_atomico(
  p_tipo text,
  p_clase_id bigint,
  p_cancelar_reservas boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_email text;
  v_actor_deletion_pending boolean;
  v_professor_id public.clases.profesor_id%type;
  v_starts_at timestamptz;
  v_booking record;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('psicologia', 'nutricion')
    or p_clase_id is null or p_clase_id <= 0 then
    raise exception 'invalid consultation slot deletion request' using errcode = '22023';
  end if;

  select lower(trim(coalesce(profile.rol, ''))),
         lower(nullif(trim(profile.email), '')),
         coalesce(profile.account_deletion_pending, false)
    into v_actor_role, v_actor_email, v_actor_deletion_pending
    from public.profiles as profile
   where profile.id = v_actor_id
     and coalesce(profile.activo, true);
  if not found or v_actor_deletion_pending
    or v_actor_role not in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  select class.profesor_id, class.fecha_inicio
    into v_professor_id, v_starts_at
    from public.clases as class
   where class.id = p_clase_id
     and lower(trim(coalesce(class.tipo_clase, ''))) = p_tipo
   for update;
  if not found then
    raise exception 'consultation slot not found' using errcode = 'P0002';
  end if;
  if v_starts_at is null or v_starts_at <= now() then
    raise exception 'historical consultation slots cannot be deleted automatically'
      using errcode = 'P0001';
  end if;

  if v_actor_role <> 'admin' and not exists (
    select 1
      from public.profesionales as professional
     where professional.id = v_professor_id
       and lower(nullif(trim(professional.email), '')) = v_actor_email
  ) then
    raise exception 'staff may only manage consultation slots linked to their professional profile'
      using errcode = '42501';
  end if;

  if p_tipo = 'psicologia' then
    if not coalesce(p_cancelar_reservas, false) and exists (
      select 1 from public.reservas_psicologia
       where clase_id = p_clase_id and estado = 'confirmada'
    ) then
      raise exception 'consultation slot has confirmed booking' using errcode = '23503';
    end if;

    for v_booking in
      select id from public.reservas_psicologia
       where clase_id = p_clase_id and estado = 'confirmada'
       order by id
    loop
      perform public.cancelar_consulta_atomica(p_tipo, v_booking.id);
    end loop;
  else
    if not coalesce(p_cancelar_reservas, false) and exists (
      select 1 from public.reservas_nutricion
       where clase_id = p_clase_id and estado = 'confirmada'
    ) then
      raise exception 'consultation slot has confirmed booking' using errcode = '23503';
    end if;

    for v_booking in
      select id from public.reservas_nutricion
       where clase_id = p_clase_id and estado = 'confirmada'
       order by id
    loop
      perform public.cancelar_consulta_atomica(p_tipo, v_booking.id);
    end loop;
  end if;

  delete from public.clases
   where id = p_clase_id
     and lower(trim(coalesce(tipo_clase, ''))) = p_tipo;
  if not found then
    raise exception 'consultation slot not found' using errcode = 'P0002';
  end if;

  return true;
end;
$function$;

revoke all on function public.eliminar_turno_consulta_atomico(text, bigint, boolean)
  from public, anon, authenticated;
grant execute on function public.eliminar_turno_consulta_atomico(text, bigint, boolean)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
