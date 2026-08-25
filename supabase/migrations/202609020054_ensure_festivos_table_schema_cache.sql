-- Migration 202609020054: Garantizar tabla public.festivos y recarga de schema cache
-- =================================================================================

begin;

create table if not exists public.festivos (
  id bigserial primary key,
  fecha date not null unique,
  nombre text not null,
  tipo text not null default 'nacional' check (tipo in ('nacional', 'regional', 'local', 'estudio')),
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_festivos_fecha on public.festivos (fecha);
create index if not exists idx_festivos_activo on public.festivos (activo);

alter table public.festivos enable row level security;

drop policy if exists "Festivos lectura publica" on public.festivos;
create policy "Festivos lectura publica"
  on public.festivos for select
  using (true);

drop policy if exists "Festivos administracion total" on public.festivos;
create policy "Festivos administracion total"
  on public.festivos for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
        and lower(coalesce(rol, '')) = 'admin'
    )
  );

grant select, insert, update, delete on public.festivos to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Pre-cargar festivos 2026, 2027 y 2028
insert into public.festivos (fecha, nombre, tipo, descripcion, activo)
values
  -- 2026
  ('2026-01-01', 'Año Nuevo', 'nacional', 'Festivo Nacional', true),
  ('2026-01-06', 'Epifanía del Señor (Reyes)', 'nacional', 'Festivo Nacional', true),
  ('2026-04-02', 'Jueves Santo', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2026-04-03', 'Viernes Santo', 'nacional', 'Festivo Nacional', true),
  ('2026-05-01', 'Fiesta del Trabajo', 'nacional', 'Festivo Nacional', true),
  ('2026-05-31', 'Día de Castilla-La Mancha', 'regional', 'Festivo Regional CLM', true),
  ('2026-06-04', 'Corpus Christi', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2026-06-24', 'San Juan', 'local', 'Festivo Local Albacete', true),
  ('2026-08-15', 'Asunción de la Virgen', 'nacional', 'Festivo Nacional', true),
  ('2026-09-08', 'Virgen de los Llanos', 'local', 'Festivo Local Albacete', true),
  ('2026-10-12', 'Fiesta Nacional de España', 'nacional', 'Festivo Nacional', true),
  ('2026-11-01', 'Todos los Santos', 'nacional', 'Festivo Nacional', true),
  ('2026-11-02', 'Todos los Santos (trasladado)', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2026-12-06', 'Día de la Constitución', 'nacional', 'Festivo Nacional', true),
  ('2026-12-07', 'Día de la Constitución (trasladado)', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2026-12-08', 'Inmaculada Concepción', 'nacional', 'Festivo Nacional', true),
  ('2026-12-25', 'Natividad del Señor (Navidad)', 'nacional', 'Festivo Nacional', true),
  -- 2027
  ('2027-01-01', 'Año Nuevo', 'nacional', 'Festivo Nacional', true),
  ('2027-01-06', 'Epifanía del Señor (Reyes)', 'nacional', 'Festivo Nacional', true),
  ('2027-03-25', 'Jueves Santo', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2027-03-26', 'Viernes Santo', 'nacional', 'Festivo Nacional', true),
  ('2027-05-01', 'Fiesta del Trabajo', 'nacional', 'Festivo Nacional', true),
  ('2027-05-27', 'Corpus Christi', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2027-05-31', 'Día de Castilla-La Mancha', 'regional', 'Festivo Regional CLM', true),
  ('2027-06-24', 'San Juan', 'local', 'Festivo Local Albacete', true),
  ('2027-08-15', 'Asunción de la Virgen', 'nacional', 'Festivo Nacional', true),
  ('2027-09-08', 'Virgen de los Llanos', 'local', 'Festivo Local Albacete', true),
  ('2027-10-12', 'Fiesta Nacional de España', 'nacional', 'Festivo Nacional', true),
  ('2027-11-01', 'Todos los Santos', 'nacional', 'Festivo Nacional', true),
  ('2027-12-06', 'Día de la Constitución', 'nacional', 'Festivo Nacional', true),
  ('2027-12-08', 'Inmaculada Concepción', 'nacional', 'Festivo Nacional', true),
  ('2027-12-25', 'Natividad del Señor (Navidad)', 'nacional', 'Festivo Nacional', true),
  -- 2028
  ('2028-01-01', 'Año Nuevo', 'nacional', 'Festivo Nacional', true),
  ('2028-01-06', 'Epifanía del Señor (Reyes)', 'nacional', 'Festivo Nacional', true),
  ('2028-04-13', 'Jueves Santo', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2028-04-14', 'Viernes Santo', 'nacional', 'Festivo Nacional', true),
  ('2028-05-01', 'Fiesta del Trabajo', 'nacional', 'Festivo Nacional', true),
  ('2028-05-31', 'Día de Castilla-La Mancha', 'regional', 'Festivo Regional CLM', true),
  ('2028-06-15', 'Corpus Christi', 'regional', 'Festivo Castilla-La Mancha', true),
  ('2028-06-24', 'San Juan', 'local', 'Festivo Local Albacete', true),
  ('2028-08-15', 'Asunción de la Virgen', 'nacional', 'Festivo Nacional', true),
  ('2028-09-08', 'Virgen de los Llanos', 'local', 'Festivo Local Albacete', true),
  ('2028-10-12', 'Fiesta Nacional de España', 'nacional', 'Festivo Nacional', true),
  ('2028-11-01', 'Todos los Santos', 'nacional', 'Festivo Nacional', true),
  ('2028-12-06', 'Día de la Constitución', 'nacional', 'Festivo Nacional', true),
  ('2028-12-08', 'Inmaculada Concepción', 'nacional', 'Festivo Nacional', true),
  ('2028-12-25', 'Natividad del Señor (Navidad)', 'nacional', 'Festivo Nacional', true)
on conflict (fecha) do update
set
  nombre = excluded.nombre,
  tipo = excluded.tipo,
  descripcion = excluded.descripcion,
  updated_at = now();

notify pgrst, 'reload schema';

commit;
