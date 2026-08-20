-- Migration 202609020009: Update Miriam location from Cuenca to Albacete
begin;

update public.profesionales
set descripcion = replace(
  descripcion,
  'LUGAR DE NACIMIENTO: Cuenca (España)',
  'LUGAR DE NACIMIENTO: Albacete (España)'
)
where email in ('miriam@respirapsicologia.es', 'miriam_profesora@genyoga.studio')
   or lower(coalesce(nombre, '')) like '%miriam%';

commit;
