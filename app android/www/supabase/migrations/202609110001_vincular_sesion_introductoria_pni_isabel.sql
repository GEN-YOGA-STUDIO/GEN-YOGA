-- ==============================================================================
-- Migración 202609110001: Vincular Sesión Introductoria a la Psiconeuroinmunología
-- con el tipo oficial 'Sesión Introductoria Gratuita' (ID 48)
-- ==============================================================================

BEGIN;

-- 1. Asegurar la existencia del tipo 'Sesión Introductoria Gratuita' en public.tipos_clases
INSERT INTO public.tipos_clases (
  nombre,
  duracion_predeterminada,
  color,
  icono,
  activo,
  orden,
  categoria,
  especialidad,
  metodo_pago,
  capacidad_predeterminada
)
SELECT
  'Sesión Introductoria Gratuita',
  60,
  '#EC4899',
  'ph-sparkle',
  true,
  23,
  'consulta_grupal',
  'psicologia',
  'gratuita',
  10
WHERE NOT EXISTS (
  SELECT 1 FROM public.tipos_clases WHERE lower(trim(nombre)) IN ('sesión introductoria gratuita', 'sesion introductoria gratuita')
);

-- 2. Vincular los 2 turnos de Isabel Rodríguez (3 y 22 de septiembre de 2026, IDs 6086 y 6087)
--    al tipo oficial 'Sesión Introductoria Gratuita'
UPDATE public.clases
   SET tipo_clase_id = (
         SELECT id FROM public.tipos_clases
          WHERE lower(trim(nombre)) IN ('sesión introductoria gratuita', 'sesion introductoria gratuita')
          ORDER BY id DESC
          LIMIT 1
       ),
       tipo_clase = 'psicologia',
       es_gratuita = true,
       capacidad_max = 10
 WHERE id IN (6086, 6087)
    OR (
      fecha_inicio IN ('2026-09-03 09:00:00+00'::timestamptz, '2026-09-22 09:00:00+00'::timestamptz)
      AND profesor_id = (SELECT id FROM public.profesionales WHERE lower(trim(nombre)) = 'isabel' LIMIT 1)
    );

COMMIT;
