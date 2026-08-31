-- ============================================================================
-- Migration 202609020012: Update color for Restaurativo y Suave
-- ============================================================================

begin;

-- Actualizar el color de 'Restaurativo y Suave' en tipos_clases a un verde salvia relajante y distintivo
update public.tipos_clases
   set color = '#5a8f76'
 where lower(btrim(coalesce(nombre, ''))) in (
   'restaurativo y suave',
   'restaurativa y suave',
   'restaurativa o suave',
   'restaurativo o suave',
   'yoga restaurativa',
   'yoga restaurativo',
   'restaurativa'
 );

notify pgrst, 'reload schema';

commit;
