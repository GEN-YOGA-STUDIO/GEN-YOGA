-- ==============================================================================
-- Migración 202610190001: Desactivar alertas por email de creación de huecos vacíos
-- y garantizar activación de alertas de reservas y cancelaciones de consultas.
-- ==============================================================================

BEGIN;

-- 1. Actualizar configuración por defecto de la columna en profesionales
ALTER TABLE public.profesionales
  ALTER COLUMN notificaciones_email_activas SET DEFAULT true,
  ALTER COLUMN notificaciones_config SET DEFAULT '{"creacion_clase": false, "reserva_consulta": true, "reserva_multiple": true, "cancelacion_consulta": true}'::jsonb;

-- 2. Actualizar registros existentes de profesionales:
-- - creacion_clase = false (los huecos nuevos vacíos no se notifican)
-- - reserva_consulta = true (se notifica cuando un alumno reserva)
-- - cancelacion_consulta = true (se notifica cuando se cancela una reserva)
UPDATE public.profesionales
SET
  notificaciones_config = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(notificaciones_config, '{}'::jsonb),
        '{creacion_clase}',
        'false'::jsonb,
        true
      ),
      '{reserva_consulta}',
      'true'::jsonb,
      true
    ),
    '{cancelacion_consulta}',
    'true'::jsonb,
    true
  )
WHERE email IS NOT NULL;

COMMIT;
