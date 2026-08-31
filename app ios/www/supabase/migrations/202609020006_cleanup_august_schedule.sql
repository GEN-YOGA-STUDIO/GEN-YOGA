begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Limpiar/desactivar cualquier clase anterior a la apertura oficial del 01/09/2026.
-- Se preservan únicamente aquellas filas con reservas confirmadas existentes.
update public.clases
set activa = false
where fecha_inicio < '2026-09-01 00:00:00+02'
  and (
    exists (select 1 from public.reservas_yoga where clase_id = public.clases.id and estado = 'confirmada')
    or exists (select 1 from public.reservas_psicologia where clase_id = public.clases.id and estado = 'confirmada')
    or exists (select 1 from public.reservas_nutricion where clase_id = public.clases.id and estado = 'confirmada')
    or exists (select 1 from public.reservas_talleres where clase_id = public.clases.id and estado = 'confirmada')
  );

delete from public.clases
where fecha_inicio < '2026-09-01 00:00:00+02'
  and not exists (select 1 from public.reservas_yoga where clase_id = public.clases.id and estado = 'confirmada')
  and not exists (select 1 from public.reservas_psicologia where clase_id = public.clases.id and estado = 'confirmada')
  and not exists (select 1 from public.reservas_nutricion where clase_id = public.clases.id and estado = 'confirmada')
  and not exists (select 1 from public.reservas_talleres where clase_id = public.clases.id and estado = 'confirmada');

notify pgrst, 'reload schema';

commit;
