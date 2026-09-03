-- Migración v12.3: Nombre oficial Introducción a Power Vinyasa y Catálogo de Clases
-- 1. Renombrar oficialmente el taller de 120 min de Yanira (id 5821) a 'Introducción a Power Vinyasa'
UPDATE public.clases
   SET nombre = 'Introducción a Power Vinyasa',
       tipo_clase = 'taller',
       es_especial = true,
       duracion_minutos = 120,
       tipo_clase_id = 37
 WHERE id = 5821
    OR (
      fecha_inicio >= '2026-09-19 00:00:00+02'
      AND fecha_inicio <= '2026-09-19 23:59:59+02'
      AND duracion_minutos = 120
    );

-- 2. Asegurar que tipos_clases tiene categorías y duraciones oficiales
UPDATE public.tipos_clases
   SET categoria = 'clase_especial',
       duracion_predeterminada = 75,
       activo = true
 WHERE id = 36 OR nombre = 'Yoga y Meditación';

UPDATE public.tipos_clases
   SET categoria = 'taller',
       duracion_predeterminada = 120,
       activo = true
 WHERE id = 37 OR nombre = 'Introducción a Power Vinyasa';

UPDATE public.tipos_clases
   SET categoria = 'taller',
       duracion_predeterminada = 120,
       activo = true
 WHERE id = 39 OR nombre = 'Taller';

UPDATE public.tipos_clases
   SET categoria = 'clase_especial',
       duracion_predeterminada = 75,
       activo = true
 WHERE id = 41 OR nombre = 'Clase Especial';

INSERT INTO public.tipos_clases (nombre, duracion_predeterminada, color, icono, categoria, activo, orden)
VALUES ('Habitar el Cuerpo: Cuando Soltar es Avanzar', 120, '#A855F7', 'ph-heart', 'taller', true, 10)
ON CONFLICT (nombre) DO UPDATE SET categoria = 'taller', duracion_predeterminada = 120, activo = true;

-- 3. Vincular el taller de Miriam a su tipo de clase oficial
UPDATE public.clases
   SET tipo_clase_id = (SELECT id FROM public.tipos_clases WHERE nombre = 'Habitar el Cuerpo: Cuando Soltar es Avanzar' LIMIT 1)
 WHERE id = 7847
    OR (
      fecha_inicio >= '2026-09-25 00:00:00+02'
      AND fecha_inicio <= '2026-09-25 23:59:59+02'
      AND duracion_minutos = 120
    );
