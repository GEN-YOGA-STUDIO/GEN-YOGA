-- ==============================================================================
-- Migración 202609020301: Eliminar clases duplicadas de las 10:30 de Yanira
-- ==============================================================================
-- Causa raíz:
-- En el cambio de hora de verano a invierno (25 de octubre de 2026, CEST UTC+2 -> CET UTC+1),
-- clases antiguas generadas a las 09:30 UTC que en verano se mostraban a las 11:30
-- (y que fueron borradas parcialmente hasta octubre en la migración 202609020011)
-- pasaron a mostrarse localmente a las 10:30 en horario peninsular.
-- Esto provocó que a partir de la semana del 27 de octubre de 2026 aparezcan dos clases
-- consecutivas de Power Vinyasa para Yanira (09:30 a 10:30 y 10:30 a 11:30),
-- solapándose además los viernes alternos con la sesión de Silvia.
--
-- Esta migración:
-- 1. Identifica en tabla temporal todas las clases de Yanira a las 10:30 (Martes a Viernes).
-- 2. Devuelve de forma preventiva cualquier crédito o bono si hubiera reservas.
-- 3. Elimina las reservas y las clases sobrantes de forma atómica.
-- 4. Añade un trigger de protección para impedir que se vuelvan a insertar clases a las 10:30 para Yanira.
-- 5. Recarga la caché de PostgREST.
-- ==============================================================================

begin;

-- 1. Identificar en tabla temporal las clases erróneas de las 10:30 de Yanira
create temp table temp_clases_yanira_1030 on commit drop as
select c.id
from public.clases c
join public.profesionales p on p.id = c.profesor_id
where (
  lower(coalesce(p.nombre, '')) like '%yanira%'
  or lower(coalesce(p.email, '')) like 'yanira%'
  or lower(coalesce(p.email, '')) like 'yaniumana%'
)
and to_char(c.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI') = '10:30'
and extract(isodow from c.fecha_inicio at time zone 'Europe/Madrid')::integer in (2, 3, 4, 5)
and c.fecha_inicio >= '2026-10-25 00:00:00';

-- 2. Devolución preventiva de bonos/créditos en caso de existir reservas confirmadas
-- 2.1 Packs de créditos de clase
update public.class_credit_packs ccp
   set credits_remaining = ccp.credits_remaining + 1,
       updated_at = now()
  from public.reservas_yoga r
 where r.class_pack_id = ccp.id
   and r.clase_id in (select id from temp_clases_yanira_1030)
   and r.estado = 'confirmada';

-- 2.2 Saldo de clases gratis / bienvenida
update public.profiles p
   set saldo_clases_gratis = coalesce(p.saldo_clases_gratis, 0) + 1
  from public.reservas_yoga r
 where r.user_id = p.id
   and r.saldo_gratis_descontado = true
   and r.clase_id in (select id from temp_clases_yanira_1030)
   and r.estado = 'confirmada';

-- 2.3 Bonos estándar
update public.profiles p
   set bonos = coalesce(p.bonos, 0) + 1
  from public.reservas_yoga r
 where r.user_id = p.id
   and r.bono_descontado = true
   and coalesce(r.saldo_gratis_descontado, false) = false
   and r.class_pack_id is null
   and r.clase_id in (select id from temp_clases_yanira_1030)
   and r.estado = 'confirmada';

-- 3. Eliminar reservas vinculadas a estas clases (si existiera alguna)
delete from public.reservas_yoga
 where clase_id in (select id from temp_clases_yanira_1030);

-- 4. Eliminar las clases duplicadas de las 10:30
delete from public.clases
 where id in (select id from temp_clases_yanira_1030);

-- 5. Trigger de protección para evitar que se creen clases a las 10:30 para Yanira de martes a viernes
create or replace function public.fn_reject_yanira_1030_slots()
returns trigger
language plpgsql
as $$
declare
  v_is_yanira boolean;
  v_start_madrid text;
  v_dow integer;
begin
  select exists(
    select 1
    from public.profesionales p
    where p.id = new.profesor_id
      and (lower(coalesce(p.nombre, '')) like '%yanira%'
           or lower(coalesce(p.email, '')) like 'yanira%'
           or lower(coalesce(p.email, '')) like 'yaniumana%')
  ) into v_is_yanira;

  if v_is_yanira then
    v_start_madrid := to_char(new.fecha_inicio at time zone 'Europe/Madrid', 'HH24:MI');
    v_dow := extract(isodow from new.fecha_inicio at time zone 'Europe/Madrid')::integer;

    if v_start_madrid = '10:30' and v_dow in (2, 3, 4, 5) then
      raise exception 'Horario no permitido para Yanira: las clases matinales de Power Vinyasa son de 09:30 a 10:30, no a las 10:30.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reject_yanira_1030_slots on public.clases;
create trigger trg_reject_yanira_1030_slots
before insert or update of profesor_id, fecha_inicio on public.clases
for each row
execute function public.fn_reject_yanira_1030_slots();

notify pgrst, 'reload schema';

commit;
