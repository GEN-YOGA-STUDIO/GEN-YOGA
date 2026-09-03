-- GEN Yoga 7.2: bienvenida de Yoga en compañía asignada por edad.
--
-- La fecha de nacimiento permanece en el esquema privado. El navegador solo
-- recibe el código de modalidad y el saldo del regalo que pertenece a la
-- persona autenticada.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Ningún alta secundaria debe recibir un saldo genérico sin modalidad. El
-- trigger de alta concede 1 únicamente después de validar la fecha.
alter table public.profiles
  alter column saldo_clases_gratis set default 0;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Reglas internas configurables. Los límites no se publican en la web ni en
-- las respuestas de la Data API.
create table if not exists private.welcome_companion_age_rules (
  companion_modality text primary key,
  min_age smallint not null,
  max_age smallint not null,
  sort_order smallint not null unique,
  updated_at timestamptz not null default now(),
  constraint welcome_companion_age_rules_modality_check
    check (companion_modality in ('colegas', 'pareja', 'hijo', 'abuela')),
  constraint welcome_companion_age_rules_range_check
    check (min_age >= 0 and max_age <= 130 and min_age <= max_age)
);

insert into private.welcome_companion_age_rules (
  companion_modality, min_age, max_age, sort_order
)
values
  ('colegas', 0, 24, 1),
  ('pareja', 25, 44, 2),
  ('hijo', 45, 64, 3),
  ('abuela', 65, 130, 4)
on conflict (companion_modality) do update
set min_age = excluded.min_age,
    max_age = excluded.max_age,
    sort_order = excluded.sort_order,
    updated_at = now();

do $rules$
begin
  if (
    select count(*) <> 4
        or min(min_age) <> 0
        or max(max_age) <> 130
        or count(*) filter (
          where companion_modality = 'colegas' and min_age = 0 and max_age = 24
             or companion_modality = 'pareja' and min_age = 25 and max_age = 44
             or companion_modality = 'hijo' and min_age = 45 and max_age = 64
             or companion_modality = 'abuela' and min_age = 65 and max_age = 130
        ) <> 4
      from private.welcome_companion_age_rules
  ) then
    raise exception 'Las reglas de edad de bienvenida no forman los cuatro tramos esperados.';
  end if;
end
$rules$;

alter table private.welcome_companion_age_rules enable row level security;
revoke all on table private.welcome_companion_age_rules
  from public, anon, authenticated;
grant select on table private.welcome_companion_age_rules to service_role;

create table if not exists private.welcome_companion_bonuses (
  profile_id uuid primary key
    references public.profiles(id) on delete cascade,
  companion_modality text not null,
  credits_remaining smallint not null default 1,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint welcome_companion_bonuses_modality_check
    check (companion_modality in ('colegas', 'pareja', 'hijo', 'abuela')),
  constraint welcome_companion_bonuses_credit_check
    check (credits_remaining between 0 and 1)
);

alter table private.welcome_companion_bonuses enable row level security;
revoke all on table private.welcome_companion_bonuses
  from public, anon, authenticated;
grant select, insert, update, delete on table private.welcome_companion_bonuses
  to service_role;

comment on table private.welcome_companion_age_rules is
  'Tramos internos que asignan una modalidad de bienvenida según la edad.';
comment on table private.welcome_companion_bonuses is
  'Modalidad y crédito de Yoga en compañía asignados a cada perfil.';

create or replace function private.companion_modality_for_birth_date(
  p_birth_date date
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, private
as $function$
declare
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_age integer;
  v_modality text;
begin
  if p_birth_date is null or p_birth_date > v_today then
    return null;
  end if;

  v_age := date_part('year', age(v_today, p_birth_date))::integer;
  if v_age < 0 or v_age > 130 then
    return null;
  end if;

  select rule.companion_modality
    into v_modality
    from private.welcome_companion_age_rules as rule
   where v_age between rule.min_age and rule.max_age
   order by rule.sort_order
   limit 1;

  return v_modality;
end;
$function$;

revoke all on function private.companion_modality_for_birth_date(date)
  from public, anon, authenticated;
grant execute on function private.companion_modality_for_birth_date(date)
  to service_role;

alter table public.clases
  add column if not exists companion_modality text;

alter table public.reservas_yoga
  add column if not exists welcome_companion_modality text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_saldo_clases_gratis_welcome_range'
  ) then
    alter table public.profiles
      add constraint profiles_saldo_clases_gratis_welcome_range
      check (saldo_clases_gratis between 0 and 1) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.clases'::regclass
       and conname = 'clases_companion_modality_check'
  ) then
    alter table public.clases
      add constraint clases_companion_modality_check
      check (
        companion_modality is null
        or (
          companion_modality in ('colegas', 'pareja', 'hijo', 'abuela')
          and lower(trim(coalesce(tipo_clase, ''))) = 'yoga'
          and coalesce(es_gratuita, false)
        )
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.reservas_yoga'::regclass
       and conname = 'reservas_yoga_welcome_companion_check'
  ) then
    alter table public.reservas_yoga
      add constraint reservas_yoga_welcome_companion_check
      check (
        welcome_companion_modality is null
        or (
          welcome_companion_modality in ('colegas', 'pareja', 'hijo', 'abuela')
          and saldo_gratis_descontado
          and not bono_descontado
          and not usado_bono_mensual
          and class_pack_id is null
        )
      ) not valid;
  end if;
end
$constraints$;

alter table public.profiles
  validate constraint profiles_saldo_clases_gratis_welcome_range;
alter table public.clases
  validate constraint clases_companion_modality_check;
alter table public.reservas_yoga
  validate constraint reservas_yoga_welcome_companion_check;

comment on column public.clases.companion_modality is
  'Modalidad regular de Yoga en compañía; nulo para el resto de clases.';
comment on column public.reservas_yoga.welcome_companion_modality is
  'Modalidad exacta del regalo de bienvenida consumido por esta reserva.';

-- Las cuatro franjas semanales existentes pasan a ser modalidades explícitas.
with mapped_classes as (
  select
    class.id,
    case
      when lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email))
             ~ '(ángel|angel)'
       and extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') = 1
       and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '16:15'
        then 'colegas'
      when lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email))
             ~ '(ángel|angel)'
       and extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') = 3
       and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '16:15'
        then 'pareja'
      when lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email))
             ~ 'yanira'
       and extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') = 3
       and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '08:00'
        then 'hijo'
      when lower(concat_ws(' ', professional.nombre, professional.apellidos, professional.email))
             ~ 'yanira'
       and extract(isodow from class.fecha_inicio at time zone 'Europe/Madrid') = 5
       and (class.fecha_inicio at time zone 'Europe/Madrid')::time = time '08:00'
        then 'abuela'
    end as companion_modality
  from public.clases as class
  join public.profesionales as professional
    on professional.id = class.profesor_id
  where coalesce(class.es_gratuita, false)
    and lower(trim(coalesce(class.tipo_clase, ''))) = 'yoga'
    and class.fecha_inicio >= timestamptz '2026-08-24 00:00:00+02'
)
update public.clases as class
   set companion_modality = mapped.companion_modality,
       nombre = case mapped.companion_modality
         when 'colegas' then 'Yoga con tus colegas'
         when 'pareja' then 'Yoga con tu pareja'
         when 'hijo' then 'Yoga con tu hijo'
         when 'abuela' then 'Yoga con tu abuela'
       end,
       es_gratuita = true
  from mapped_classes as mapped
 where mapped.id = class.id
   and mapped.companion_modality is not null;

-- Convertir el saldo de bienvenida existente en un derecho tipado cuando ya
-- existe una fecha de nacimiento privada.
insert into private.welcome_companion_bonuses (
  profile_id, companion_modality, credits_remaining
)
select
  demographics.profile_id,
  private.companion_modality_for_birth_date(demographics.fecha_nacimiento),
  least(1, greatest(0, coalesce(profile.saldo_clases_gratis, 0)))::smallint
from private.profile_demographics as demographics
join public.profiles as profile
  on profile.id = demographics.profile_id
where private.companion_modality_for_birth_date(demographics.fecha_nacimiento) is not null
  and lower(trim(coalesce(profile.rol, ''))) not in (
    'admin', 'profesor', 'trabajador', 'profesional'
  )
  and coalesce(profile.activo, true)
  and not coalesce(profile.account_deletion_pending, false)
on conflict (profile_id) do update
set companion_modality = excluded.companion_modality,
    credits_remaining = least(
      welcome_companion_bonuses.credits_remaining,
      excluded.credits_remaining
    ),
    updated_at = now();

update public.profiles as profile
   set saldo_clases_gratis = bonus.credits_remaining
  from private.welcome_companion_bonuses as bonus
 where bonus.profile_id = profile.id;

-- Etiquetar reservas gratuitas de las franjas migradas para que una
-- cancelación posterior sepa qué derecho consumieron.
update public.reservas_yoga as booking
   set welcome_companion_modality = class.companion_modality
  from public.clases as class
 where class.id = booking.clase_id
   and booking.estado = 'confirmada'
   and coalesce(booking.saldo_gratis_descontado, false)
   and booking.welcome_companion_modality is null
   and class.companion_modality is not null;

-- El alta guarda la fecha únicamente en private.profile_demographics, asigna
-- el regalo y elimina inmediatamente el dato temporal de Auth metadata.
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $function$
declare
  v_nombre text;
  v_apellidos text;
  v_birth_date date;
  v_birth_date_text text;
  v_modality text;
begin
  v_nombre := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'nombre',
      new.raw_user_meta_data->>'name',
      new.raw_user_meta_data->>'full_name',
      ''
    )),
    '\s+',
    ' ',
    'g'
  );
  v_apellidos := regexp_replace(
    trim(coalesce(
      new.raw_user_meta_data->>'apellidos',
      new.raw_user_meta_data->>'family_name',
      ''
    )),
    '\s+',
    ' ',
    'g'
  );

  if length(v_nombre) < 1
    or length(v_nombre) > 80
    or v_nombre ~ '[[:cntrl:]<>&]' then
    v_nombre := 'Alumno';
  end if;
  if length(v_apellidos) > 120
    or v_apellidos ~ '[[:cntrl:]<>&]' then
    v_apellidos := '';
  end if;

  v_birth_date_text := nullif(trim(new.raw_user_meta_data->>'fecha_nacimiento'), '');
  if pg_input_is_valid(v_birth_date_text, 'date') then
    v_birth_date := v_birth_date_text::date;
    v_modality := private.companion_modality_for_birth_date(v_birth_date);
  end if;

  insert into public.profiles (
    id, nombre, apellidos, email, rol, bonos,
    saldo_psicologia, saldo_nutricion,
    saldo_clases_gratis, saldo_consultas_gratis
  )
  values (
    new.id, v_nombre, v_apellidos,
    lower(trim(coalesce(new.email, ''))), 'alumno', 0,
    0, 0,
    case when v_modality is null then 0 else 1 end,
    1
  )
  on conflict (id) do update
  set nombre = case
        when nullif(trim(coalesce(profiles.nombre, '')), '') is null
          then excluded.nombre
        else profiles.nombre
      end,
      apellidos = case
        when nullif(trim(coalesce(profiles.apellidos, '')), '') is null
          then excluded.apellidos
        else profiles.apellidos
      end,
      email = excluded.email,
      rol = case
        when lower(trim(coalesce(profiles.rol, ''))) in (
          'admin', 'profesor', 'trabajador', 'profesional'
        ) then profiles.rol
        else 'alumno'
      end,
      saldo_clases_gratis = excluded.saldo_clases_gratis,
      saldo_consultas_gratis = coalesce(profiles.saldo_consultas_gratis, 1);

  if v_modality is not null then
    insert into private.profile_demographics (
      profile_id, fecha_nacimiento, updated_at
    ) values (
      new.id, v_birth_date, now()
    )
    on conflict (profile_id) do update
      set fecha_nacimiento = excluded.fecha_nacimiento,
          updated_at = excluded.updated_at;

    insert into private.welcome_companion_bonuses (
      profile_id, companion_modality, credits_remaining
    ) values (
      new.id, v_modality, 1
    )
    on conflict (profile_id) do update
      set companion_modality = excluded.companion_modality,
          credits_remaining = least(
            welcome_companion_bonuses.credits_remaining,
            excluded.credits_remaining
          ),
          updated_at = now();
  end if;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
       - 'fecha_nacimiento'
   where id = new.id;

  return new;
end;
$function$;

-- Producción conservaba dos AFTER INSERT que competían por crear el mismo
-- perfil. Mantener una única ruta canónica hace atómica la asignación.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists zz_gen_yoga_profile_after_signup on auth.users;
create trigger zz_gen_yoga_profile_after_signup
  after insert on auth.users
  for each row
  execute function public.crear_perfil_nuevo_usuario();

revoke all on function public.crear_perfil_nuevo_usuario()
  from public, anon, authenticated;

-- GoTrue puede crear la identidad después del usuario. Limpiar la misma clave
-- antes de escribir evita que la fecha reaparezca en identity_data.
create or replace function private.strip_signup_birth_date_from_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, auth
as $function$
begin
  new.identity_data := coalesce(new.identity_data, '{}'::jsonb)
    - 'fecha_nacimiento';
  return new;
end;
$function$;

revoke all on function private.strip_signup_birth_date_from_identity()
  from public, anon, authenticated;

drop trigger if exists zz_gen_yoga_strip_signup_birth_date on auth.identities;
create trigger zz_gen_yoga_strip_signup_birth_date
  before insert or update of identity_data on auth.identities
  for each row
  execute function private.strip_signup_birth_date_from_identity();

-- Solo devuelve el derecho del usuario autenticado; nunca la fecha ni el
-- tramo de edad que originaron la asignación.
create or replace function public.get_my_welcome_companion_bonus()
returns table (
  companion_modality text,
  credits_remaining smallint
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  select bonus.companion_modality, bonus.credits_remaining
    from private.welcome_companion_bonuses as bonus
   where bonus.profile_id = auth.uid();
$function$;

revoke all on function public.get_my_welcome_companion_bonus()
  from public, anon, authenticated;
grant execute on function public.get_my_welcome_companion_bonus()
  to authenticated, service_role;

-- Compatibilidad one-shot para cuentas anteriores a 7.2 que conservan el
-- saldo genérico. La primera fecha válida queda fijada; llamadas posteriores
-- no permiten cambiar modalidad ni regenerar el crédito.
create or replace function public.complete_my_welcome_companion_profile(
  p_birth_date date
)
returns table (
  companion_modality text,
  credits_remaining smallint
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_profile_credits integer;
  v_stored_birth_date date;
  v_modality text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(trim(coalesce(profile.rol, ''))),
         coalesce(profile.saldo_clases_gratis, 0)
    into v_actor_role, v_profile_credits
    from public.profiles as profile
   where profile.id = v_actor_id
     and coalesce(profile.activo, true)
     and not coalesce(profile.account_deletion_pending, false)
   for update;
  if not found then
    raise exception 'Perfil no disponible' using errcode = 'P0002';
  end if;
  if v_actor_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'Solo los alumnos pueden completar su modalidad de bienvenida.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from private.welcome_companion_bonuses as existing_bonus
     where existing_bonus.profile_id = v_actor_id
  ) then
    return query
      select existing_bonus.companion_modality,
             existing_bonus.credits_remaining
        from private.welcome_companion_bonuses as existing_bonus
       where existing_bonus.profile_id = v_actor_id;
    return;
  end if;

  select demographics.fecha_nacimiento
    into v_stored_birth_date
    from private.profile_demographics as demographics
   where demographics.profile_id = v_actor_id;

  if v_stored_birth_date is null then
    v_stored_birth_date := p_birth_date;
  end if;
  v_modality := private.companion_modality_for_birth_date(v_stored_birth_date);
  if v_modality is null then
    raise exception 'La fecha de nacimiento no es válida.' using errcode = '22023';
  end if;

  insert into private.profile_demographics (
    profile_id, fecha_nacimiento, updated_at
  ) values (
    v_actor_id, v_stored_birth_date, now()
  )
  on conflict (profile_id) do update
    set fecha_nacimiento = case
          when profile_demographics.fecha_nacimiento is null
            then excluded.fecha_nacimiento
          else profile_demographics.fecha_nacimiento
        end,
        updated_at = now();

  insert into private.welcome_companion_bonuses (
    profile_id, companion_modality, credits_remaining
  ) values (
    v_actor_id,
    v_modality,
    least(1, greatest(0, v_profile_credits))::smallint
  )
  on conflict (profile_id) do nothing;

  update public.profiles as profile
     set saldo_clases_gratis = bonus.credits_remaining
    from private.welcome_companion_bonuses as bonus
   where profile.id = v_actor_id
     and bonus.profile_id = profile.id;

  return query
    select bonus.companion_modality, bonus.credits_remaining
      from private.welcome_companion_bonuses as bonus
     where bonus.profile_id = v_actor_id;
end;
$function$;

revoke all on function public.complete_my_welcome_companion_profile(date)
  from public, anon, authenticated;
grant execute on function public.complete_my_welcome_companion_profile(date)
  to authenticated, service_role;

-- La edición administrativa recalcula la modalidad sin volver a regalar un
-- crédito ya consumido.
create or replace function public.admin_actualizar_fecha_nacimiento_usuario(
  p_user_id uuid,
  p_fecha_nacimiento date
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_staff_role text;
  v_target_role text;
  v_current_free_credits integer;
  v_modality text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(trim(coalesce(profile.rol, '')))
    into v_staff_role
    from public.profiles as profile
   where profile.id = auth.uid();

  if v_staff_role <> 'admin' then
    raise exception 'Solo administración puede actualizar la fecha de nacimiento de otros usuarios.'
      using errcode = '42501';
  end if;

  select lower(trim(coalesce(profile.rol, ''))),
         coalesce(profile.saldo_clases_gratis, 0)
    into v_target_role, v_current_free_credits
    from public.profiles as profile
   where profile.id = p_user_id
     and coalesce(profile.activo, true)
     and not coalesce(profile.account_deletion_pending, false)
   for update;
  if not found then
    raise exception 'Usuario no encontrado' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'La modalidad de bienvenida solo se asigna a alumnos.'
      using errcode = '42501';
  end if;

  v_modality := private.companion_modality_for_birth_date(p_fecha_nacimiento);
  if p_fecha_nacimiento is not null and v_modality is null then
    raise exception 'La fecha de nacimiento no es válida.' using errcode = '22023';
  end if;

  insert into private.profile_demographics (
    profile_id, fecha_nacimiento, updated_at
  ) values (
    p_user_id, p_fecha_nacimiento, now()
  )
  on conflict (profile_id) do update
    set fecha_nacimiento = excluded.fecha_nacimiento,
        updated_at = excluded.updated_at;

  if v_modality is null then
    delete from private.welcome_companion_bonuses
     where profile_id = p_user_id;
    update public.profiles
       set saldo_clases_gratis = 0
     where id = p_user_id;
  else
    insert into private.welcome_companion_bonuses (
      profile_id, companion_modality, credits_remaining
    ) values (
      p_user_id, v_modality,
      least(1, greatest(0, v_current_free_credits))::smallint
    )
    on conflict (profile_id) do update
      set companion_modality = excluded.companion_modality,
          updated_at = now();
  end if;
end;
$function$;

revoke all on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date)
  from public, anon, authenticated;
grant execute on function public.admin_actualizar_fecha_nacimiento_usuario(uuid, date)
  to authenticated, service_role;

-- Mantener sincronizado el contador legado que todavía utiliza la interfaz de
-- administración con el derecho privado de la modalidad.
create or replace function public.ajustar_saldo_usuario(
  p_user_id uuid,
  p_tipo text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_new_balance integer;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_user_id is null or p_tipo is null or p_tipo not in (
    'yoga', 'psicologia', 'nutricion', 'clases_gratis', 'consultas_gratis'
  ) then
    raise exception 'invalid balance adjustment' using errcode = '22023';
  end if;
  if p_delta is null or p_delta = 0 or p_delta < -1000 or p_delta > 1000 then
    raise exception 'invalid balance delta' using errcode = '22023';
  end if;

  select lower(coalesce(profile.rol, ''))
    into v_actor_role
    from public.profiles as profile
   where profile.id = v_actor_id;
  if not found or v_actor_role <> 'admin' then
    raise exception 'only administrators may adjust balances' using errcode = '42501';
  end if;

  select lower(coalesce(profile.rol, ''))
    into v_target_role
    from public.profiles as profile
   where profile.id = p_user_id
   for update;
  if not found then
    raise exception 'client profile not found' using errcode = 'P0002';
  end if;
  if v_target_role in ('admin', 'profesor', 'trabajador', 'profesional') then
    raise exception 'staff balances cannot be adjusted' using errcode = '42501';
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
    update private.welcome_companion_bonuses
       set credits_remaining = least(
             1,
             greatest(credits_remaining::integer + p_delta, 0)
           )::smallint,
           updated_at = now()
     where profile_id = p_user_id
     returning credits_remaining into v_new_balance;
    if not found then
      raise exception 'El usuario necesita una fecha de nacimiento válida antes de ajustar su clase de bienvenida.'
        using errcode = 'P0001';
    end if;
    update public.profiles
       set saldo_clases_gratis = v_new_balance
     where id = p_user_id;
  elsif p_tipo = 'consultas_gratis' then
    update public.profiles
       set saldo_consultas_gratis = greatest(coalesce(saldo_consultas_gratis, 0) + p_delta, 0)
     where id = p_user_id
     returning saldo_consultas_gratis into v_new_balance;
  end if;

  return v_new_balance;
end;
$function$;

revoke all on function public.ajustar_saldo_usuario(uuid, text, integer)
  from public, anon;
grant execute on function public.ajustar_saldo_usuario(uuid, text, integer)
  to authenticated, service_role;

-- Reserva 7.2. El tercer parámetro evita convertir una reserva anunciada como
-- gratuita en un cargo de bono de pago si el saldo cambia entre pestañas.
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid,
  p_use_welcome_companion boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
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
  v_class_type text;
  v_class_active boolean;
  v_is_special boolean;
  v_class_companion_modality text;
  v_marked_free boolean;
  v_professor_id public.clases.profesor_id%type;
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

  select coalesce(capacidad_max, 0), fecha_inicio,
         lower(trim(coalesce(tipo_clase, ''))), coalesce(activa, true),
         profesor_id, companion_modality, coalesce(es_gratuita, false)
    into v_capacity, v_starts_at, v_class_type, v_class_active,
         v_professor_id, v_class_companion_modality, v_marked_free
    from public.clases
   where id = p_clase_id
   for update;

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
    select 1 from public.reservas_yoga
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

  if p_use_welcome_companion is not false
    and v_class_companion_modality is not null
    and v_free_credits >= 1 then
    update private.welcome_companion_bonuses
       set credits_remaining = credits_remaining - 1,
           updated_at = now()
     where profile_id = v_target_id
       and companion_modality = v_class_companion_modality
       and credits_remaining >= 1;

    if found then
      update public.profiles
         set saldo_clases_gratis = saldo_clases_gratis - 1
       where id = v_target_id
         and saldo_clases_gratis >= 1;
      if not found then
        raise exception 'El saldo del regalo de bienvenida ha cambiado. Vuelve a cargar la página.'
          using errcode = 'P0001';
      end if;

      insert into public.reservas_yoga (
        clase_id, user_id, estado, usado_bono_mensual, bono_descontado,
        class_pack_id, saldo_gratis_descontado, welcome_companion_modality
      ) values (
        p_clase_id, v_target_id, 'confirmada', false, false,
        null, true, v_class_companion_modality
      );
      return;
    end if;
  end if;

  if p_use_welcome_companion is true
    or (
      p_use_welcome_companion is null
      and (v_class_companion_modality is not null or v_marked_free)
    ) then
    raise exception 'Este regalo no corresponde a la modalidad asignada o ya se ha utilizado.'
      using errcode = 'P0001';
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
    class_pack_id, saldo_gratis_descontado, welcome_companion_modality
  ) values (
    p_clase_id, v_target_id, 'confirmada', v_use_unlimited,
    not v_use_unlimited, v_pack_id, false, null
  );
end;
$function$;

revoke all on function public.reservar_con_bono(bigint, uuid, boolean)
  from public, anon;
grant execute on function public.reservar_con_bono(bigint, uuid, boolean)
  to authenticated, service_role;

-- Compatibilidad con clientes 7.1: autodetecta el regalo, pero nunca cobra una
-- clase de compañía cuando el cliente antiguo esperaba que fuera gratuita.
create or replace function public.reservar_con_bono(
  p_clase_id bigint,
  p_user_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $function$
  select public.reservar_con_bono(p_clase_id, p_user_id, null::boolean);
$function$;

revoke all on function public.reservar_con_bono(bigint, uuid)
  from public, anon;
grant execute on function public.reservar_con_bono(bigint, uuid)
  to authenticated, service_role;

create or replace function public.cancelar_con_bono(p_reserva_id bigint)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
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
  v_welcome_companion_modality text;
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
         coalesce(usado_bono_mensual, false), class_pack_id,
         welcome_companion_modality
    into v_target_id, v_class_id, v_credit_debited,
         v_free_credit_debited, v_used_unlimited, v_pack_id,
         v_welcome_companion_modality
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
      select 1 from public.profesionales
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
    perform 1 from public.profiles
     where id = v_target_id
     for update;
    if not found then
      raise exception 'No se encontró el perfil al devolver el regalo.' using errcode = 'P0002';
    end if;

    -- Si administración cambió la fecha después de reservar, se devuelve el
    -- crédito a la modalidad actual. Las reservas legacy con ledger nulo
    -- también quedan reparadas cuando ya existe un derecho tipado.
    update private.welcome_companion_bonuses
       set credits_remaining = least(1, credits_remaining + 1),
           updated_at = now()
     where profile_id = v_target_id;

    update public.profiles
       set saldo_clases_gratis = least(1, coalesce(saldo_clases_gratis, 0) + 1)
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

-- El calendario público expone la modalidad de la clase, nunca la edad.
drop function if exists public.get_public_weekly_schedule(date);

create function public.get_public_weekly_schedule(p_week_start date default null)
returns table (
  id bigint,
  nombre text,
  fecha_inicio timestamptz,
  fecha_fin timestamptz,
  duracion_minutos integer,
  capacidad_max integer,
  ocupadas integer,
  plazas_libres integer,
  completa boolean,
  profesor_id bigint,
  profesor_nombre text,
  profesor_apellidos text,
  profesor_color text,
  tipo_clase text,
  tipo_clase_id bigint,
  es_gratuita boolean,
  companion_modality text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  with requested_week as (
    select date_trunc(
      'week',
      coalesce(
        p_week_start,
        (now() at time zone 'Europe/Madrid')::date
      )::timestamp
    )::date as monday_local
  ),
  week_bounds as (
    select
      monday_local::timestamp at time zone 'Europe/Madrid' as starts_at,
      (monday_local + 7)::timestamp at time zone 'Europe/Madrid' as ends_at
    from requested_week
  )
  select
    class.id::bigint,
    class.nombre::text,
    class.fecha_inicio::timestamptz,
    class.fecha_fin::timestamptz,
    class.duracion_minutos::integer,
    case
      when lower(btrim(coalesce(class.tipo_clase, ''))) = 'yoga'
        then least(coalesce(class.capacidad_max, 10), 10)::integer
      else coalesce(class.capacidad_max, 10)::integer
    end,
    coalesce(booking_count.ocupadas, 0)::integer,
    greatest(
      case
        when lower(btrim(coalesce(class.tipo_clase, ''))) = 'yoga'
          then least(coalesce(class.capacidad_max, 10), 10)::integer
        else coalesce(class.capacidad_max, 10)::integer
      end - coalesce(booking_count.ocupadas, 0)::integer,
      0
    )::integer,
    (
      case
        when lower(btrim(coalesce(class.tipo_clase, ''))) = 'yoga'
          then least(coalesce(class.capacidad_max, 10), 10)::integer
        else coalesce(class.capacidad_max, 10)::integer
      end <= coalesce(booking_count.ocupadas, 0)::integer
    ),
    professional.id::bigint,
    professional.nombre::text,
    professional.apellidos::text,
    professional.color::text,
    lower(btrim(class.tipo_clase))::text,
    class.tipo_clase_id::bigint,
    coalesce(class.es_gratuita, false)::boolean,
    class.companion_modality::text
  from public.clases as class
  cross join week_bounds
  join public.profesionales as professional
    on professional.id = class.profesor_id
   and professional.visible_publico is true
  left join lateral (
    select count(*)::integer as ocupadas
      from public.reservas_yoga as booking
     where booking.clase_id = class.id
       and booking.estado = 'confirmada'
  ) as booking_count on true
  where class.activa is true
    and lower(btrim(coalesce(class.tipo_clase, ''))) in ('yoga', 'taller')
    and class.fecha_inicio >= week_bounds.starts_at
    and class.fecha_inicio < week_bounds.ends_at
  order by class.fecha_inicio, class.id;
$function$;

revoke all on function public.get_public_weekly_schedule(date)
  from public, anon, authenticated;
grant execute on function public.get_public_weekly_schedule(date)
  to anon, authenticated;

notify pgrst, 'reload schema';

commit;
