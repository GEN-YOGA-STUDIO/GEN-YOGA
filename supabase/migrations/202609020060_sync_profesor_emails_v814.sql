-- ============================================================================
-- Migración: Garantizar que todos los profesores tienen su email sincronizado
-- en la tabla profesionales (v8.14)
-- ============================================================================

begin;

-- 1. Sincronizar email de profesionales que no lo tienen pero sí tienen
--    una coincidencia por nombre en profiles con rol profesor/trabajador/profesional
update public.profesionales p
set email = sub.profile_email
from (
    select
        pr.id as profesional_id,
        prof.email as profile_email
    from public.profesionales pr
    cross join lateral (
        select email
        from public.profiles
        where rol in ('profesor', 'trabajador', 'profesional')
          and lower(trim(nombre)) = lower(trim(pr.nombre))
          and email is not null
          and trim(email) <> ''
        limit 1
    ) prof
    where pr.email is null or trim(pr.email) = ''
) sub
where p.id = sub.profesional_id;

-- 2. Para el profesor de pruebas: si hay un profesional con nombre 'Profesor'
--    o similar sin email, asignarle 'profesor@profesor.com'
update public.profesionales
set email = 'profesor@profesor.com'
where (lower(trim(nombre)) like '%profesor%' or lower(trim(nombre)) like '%profe %')
  and (email is null or trim(email) = '');

-- 3. Verificar: listar todos los profesionales y sus emails para diagnóstico
-- (esto se verá en el resultado del SQL Runner de Supabase)
select id, nombre, email from public.profesionales order by id;

commit;
