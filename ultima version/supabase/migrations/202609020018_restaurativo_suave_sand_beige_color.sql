-- ============================================================================
-- Migration 202609020018: Update color for Restaurativo y Suave to sand/beige (#c3b89a)
-- ============================================================================

begin;

-- Actualizar el color de 'Restaurativo y Suave' en tipos_clases a tono arena/beige (#c3b89a)
update public.tipos_clases
   set color = '#c3b89a'
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
