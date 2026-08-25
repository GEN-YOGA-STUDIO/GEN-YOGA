-- Migration 202609020050: Sistema Integral de Dias Festivos y Bloqueo de Calendario
-- ==============================================================================
-- 1. Crea la tabla public.festivos para almacenar dias festivos nacionales, regionales y locales.
-- 2. Configura RLS (lectura publica, edicion solo admin).
-- 3. Siembra festivos oficiales (Espana, Castilla-La Mancha y Albacete, incl. 8 de septiembre Virgen de los Llanos).
-- 4. Purga y elimina todas las clases existentes en el 8 de septiembre y demas festivos activos.
-- 5. Actualiza get_public_weekly_schedule para excluir clases en dias festivos activos.
-- 6. Funcion RPC para limpiar clases en un festivo concreto.
-- ==============================================================================

begin;

-- 1. Tabla de festivos
create table if not exists public.festivos (
  id bigserial primary key,
  fecha date not null unique,
  nombre text not null,
  tipo text not null default 'nacional', -- 'nacional', 'regional', 'local', 'estudio'
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.festivos enable row level security;

-- Politicas RLS
drop policy if exists "Festivos visibles para todos" on public.festivos;
create policy "Festivos visibles para todos"
  on public.festivos for select
  using (true);

drop policy if exists "Solo admin inserta festivos" on public.festivos;
create policy "Solo admin inserta festivos"
  on public.festivos for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and lower(coalesce(rol, '')) = 'admin'
    )
  );

drop policy if exists "Solo admin actualiza festivos" on public.festivos;
create policy "Solo admin actualiza festivos"
  on public.festivos for update
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and lower(coalesce(rol, '')) = 'admin'
    )
  );

drop policy if exists "Solo admin elimina festivos" on public.festivos;
create policy "Solo admin elimina festivos"
  on public.festivos for delete
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and lower(coalesce(rol, '')) = 'admin'
    )
  );

-- 2. Sembrar festivos oficiales (2026, 2027 y 2028)
insert into public.festivos (fecha, nombre, tipo, descripcion, activo)
values
  -- === 2026 ===
  ('2026-01-01', 'Ano Nuevo', 'nacional', 'Festivo nacional', true),
  ('2026-01-06', 'Epifania del Senor (Reyes Magos)', 'nacional', 'Festivo nacional', true),
  ('2026-04-02', 'Jueves Santo', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2026-04-03', 'Viernes Santo', 'nacional', 'Festivo nacional', true),
  ('2026-05-01', 'Fiesta del Trabajo', 'nacional', 'Festivo nacional', true),
  ('2026-05-31', 'Dia de Castilla-La Mancha', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2026-06-04', 'Corpus Christi', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2026-06-24', 'San Juan', 'local', 'Fiesta local de Albacete', true),
  ('2026-08-15', 'Asuncion de la Virgen', 'nacional', 'Festivo nacional', true),
  ('2026-09-08', 'Virgen de los Llanos', 'local', 'Fiesta patronal de Albacete (Feria de Albacete)', true),
  ('2026-10-12', 'Fiesta Nacional de Espana', 'nacional', 'Festivo nacional', true),
  ('2026-11-01', 'Todos los Santos', 'nacional', 'Festivo nacional', true),
  ('2026-11-02', 'Lunes siguiente a Todos los Santos', 'regional', 'Festivo trasladado', true),
  ('2026-12-06', 'Dia de la Constitucion Espanola', 'nacional', 'Festivo nacional', true),
  ('2026-12-07', 'Lunes siguiente a la Constitucion', 'regional', 'Festivo trasladado', true),
  ('2026-12-08', 'Inmaculada Concepcion', 'nacional', 'Festivo nacional', true),
  ('2026-12-25', 'Natividad del Senor (Navidad)', 'nacional', 'Festivo nacional', true),

  -- === 2027 ===
  ('2027-01-01', 'Ano Nuevo', 'nacional', 'Festivo nacional', true),
  ('2027-01-06', 'Epifania del Senor (Reyes Magos)', 'nacional', 'Festivo nacional', true),
  ('2027-03-25', 'Jueves Santo', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2027-03-26', 'Viernes Santo', 'nacional', 'Festivo nacional', true),
  ('2027-05-01', 'Fiesta del Trabajo', 'nacional', 'Festivo nacional', true),
  ('2027-05-27', 'Corpus Christi', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2027-05-31', 'Dia de Castilla-La Mancha', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2027-06-24', 'San Juan', 'local', 'Fiesta local de Albacete', true),
  ('2027-08-15', 'Asuncion de la Virgen', 'nacional', 'Festivo nacional', true),
  ('2027-09-08', 'Virgen de los Llanos', 'local', 'Fiesta patronal de Albacete (Feria de Albacete)', true),
  ('2027-10-12', 'Fiesta Nacional de Espana', 'nacional', 'Festivo nacional', true),
  ('2027-11-01', 'Todos los Santos', 'nacional', 'Festivo nacional', true),
  ('2027-12-06', 'Dia de la Constitucion Espanola', 'nacional', 'Festivo nacional', true),
  ('2027-12-08', 'Inmaculada Concepcion', 'nacional', 'Festivo nacional', true),
  ('2027-12-25', 'Natividad del Senor (Navidad)', 'nacional', 'Festivo nacional', true),

  -- === 2028 ===
  ('2028-01-01', 'Ano Nuevo', 'nacional', 'Festivo nacional', true),
  ('2028-01-06', 'Epifania del Senor (Reyes Magos)', 'nacional', 'Festivo nacional', true),
  ('2028-04-13', 'Jueves Santo', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2028-04-14', 'Viernes Santo', 'nacional', 'Festivo nacional', true),
  ('2028-05-01', 'Fiesta del Trabajo', 'nacional', 'Festivo nacional', true),
  ('2028-05-31', 'Dia de Castilla-La Mancha', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2028-06-15', 'Corpus Christi', 'regional', 'Festivo regional de Castilla-La Mancha', true),
  ('2028-06-24', 'San Juan', 'local', 'Fiesta local de Albacete', true),
  ('2028-08-15', 'Asuncion de la Virgen', 'nacional', 'Festivo nacional', true),
  ('2028-09-08', 'Virgen de los Llanos', 'local', 'Fiesta patronal de Albacete (Feria de Albacete)', true),
  ('2028-10-12', 'Fiesta Nacional de Espana', 'nacional', 'Festivo nacional', true),
  ('2028-11-01', 'Todos los Santos', 'nacional', 'Festivo nacional', true),
  ('2028-12-06', 'Dia de la Constitucion Espanola', 'nacional', 'Festivo nacional', true),
  ('2028-12-08', 'Inmaculada Concepcion', 'nacional', 'Festivo nacional', true),
  ('2028-12-25', 'Natividad del Senor (Navidad)', 'nacional', 'Festivo nacional', true)
on conflict (fecha) do update
  set nombre = excluded.nombre,
      tipo = excluded.tipo,
      descripcion = excluded.descripcion,
      activo = excluded.activo,
      updated_at = now();

-- 3. Purgar y eliminar todas las clases del 8 de septiembre de 2026 y dias festivos activos
delete from public.clases
where (fecha_inicio at time zone 'Europe/Madrid')::date = '2026-09-08'::date;

delete from public.clases
where (fecha_inicio at time zone 'Europe/Madrid')::date in (
  select fecha from public.festivos where activo is true
);

-- 4. Funcion para eliminar clases en un festivo dado
create or replace function public.eliminar_clases_en_festivo(p_fecha date)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer := 0;
  v_actor_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select lower(coalesce(rol, '')) into v_actor_role
  from public.profiles where id = auth.uid();

  if v_actor_role <> 'admin' then
    raise exception 'only admin can purge holiday classes' using errcode = '42501';
  end if;

  delete from public.clases
  where (fecha_inicio at time zone 'Europe/Madrid')::date = p_fecha;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.eliminar_clases_en_festivo(date) from public, anon;
grant execute on function public.eliminar_clases_en_festivo(date) to authenticated;

-- 5. Actualizar get_public_weekly_schedule para excluir festivos activos
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
    and not exists (
      select 1 from public.festivos f
      where f.fecha = (class.fecha_inicio at time zone 'Europe/Madrid')::date
        and f.activo is true
    )
  order by class.fecha_inicio, class.id;
$function$;

revoke all on function public.get_public_weekly_schedule(date)
  from public, anon, authenticated;
grant execute on function public.get_public_weekly_schedule(date)
  to anon, authenticated;

commit;
