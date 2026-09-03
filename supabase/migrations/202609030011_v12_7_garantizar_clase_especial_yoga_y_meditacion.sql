-- Migración v12.7: Garantizar que la clase especial Yoga y Meditación del 18 Sep 2026
-- (y cualquier clase especial de 75 min) esté registrada como clase_especial y no como taller.

UPDATE public.clases
   SET tipo_clase = 'clase_especial',
       es_especial = true,
       duracion_minutos = 75
 WHERE id = 6083
    OR (
      lower(trim(nombre)) = 'yoga y meditación'
      AND fecha_inicio >= '2026-09-18 00:00:00+02'
      AND fecha_inicio <= '2026-09-18 23:59:59+02'
    );

-- Asegurar que en tipos_clases la categoría sea clase_especial para 'Yoga y Meditación'
UPDATE public.tipos_clases
   SET categoria = 'clase_especial',
       duracion_predeterminada = 75
 WHERE lower(trim(nombre)) = 'yoga y meditación';
