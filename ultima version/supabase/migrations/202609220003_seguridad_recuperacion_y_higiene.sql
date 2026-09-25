-- ============================================================================
-- Auditoría 2026-09-22: seguridad recuperación + higiene.
-- 1) Las RPCs de recuperación permitían cambiar la contraseña de CUALQUIER
--    cuenta con solo conocer su email/teléfono (sin verificación). Se
--    sustituyen por flujo con código por email (edge functions
--    request-recovery-code / reset-password-with-code): revocar EXECUTE.
-- 2) Códigos de un solo uso con caducidad (solo service_role los toca: sin
--    policies = denegado para anon/authenticated).
-- 3) reservas_talleres: RLS sin policies -> lecturas silenciosamente vacías
--    (el modal de fusión la consulta). Lectura staff como el resto.
-- 4) Índice duplicado byte a byte en reservas_yoga: se conserva el original.
-- ============================================================================

-- 1. Tabla de códigos de recuperación (denegación total salvo service_role).
create table if not exists public.password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.password_reset_codes enable row level security;
create index if not exists password_reset_codes_user_idx
  on public.password_reset_codes (user_id, created_at desc);

-- 2. Neutralizar las RPCs de recuperación sin verificación.
revoke all on function public.restablecer_contrasena_usuario(text, text)
  from anon, authenticated, public;
revoke all on function public.verificar_usuario_recuperacion(text)
  from anon, authenticated, public;

-- 3. Lectura staff de reservas_talleres ( granted para que la policy aplique).
drop policy if exists "reservas_talleres_staff_select" on public.reservas_talleres;
create policy "reservas_talleres_staff_select"
on public.reservas_talleres
for select
to authenticated
using (public.es_staff_o_admin(auth.uid()));
grant select on public.reservas_talleres to authenticated;

-- 4. Quitar el índice duplicado (idéntico a reservas_unique_confirmada).
drop index if exists public.reservas_yoga_clase_usuario_confirmada_uidx;
