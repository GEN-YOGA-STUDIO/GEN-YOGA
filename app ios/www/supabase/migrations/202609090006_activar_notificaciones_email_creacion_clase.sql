-- ==============================================================================
-- MIGRACIÓN v13.2: Activación y configuración de notificaciones por email
-- para profesores y profesionales al crear/asignar clases
-- ==============================================================================

BEGIN;

-- 1. Actualizar configuración por defecto de la columna en profesionales
ALTER TABLE public.profesionales
  ALTER COLUMN notificaciones_email_activas SET DEFAULT true,
  ALTER COLUMN notificaciones_config SET DEFAULT '{"creacion_clase": true, "reserva_consulta": true, "reserva_multiple": true, "cancelacion_consulta": false}'::jsonb;

-- 2. Asegurar que los profesionales existentes tengan activadas las alertas de creación de clase
-- y que su correo de destino sea por defecto su email registrado
UPDATE public.profesionales
SET
  notificaciones_email_activas = true,
  email_notificaciones = COALESCE(email_notificaciones, email),
  notificaciones_config = jsonb_set(
    COALESCE(notificaciones_config, '{"reserva_consulta": true, "reserva_multiple": true, "cancelacion_consulta": false}'::jsonb),
    '{creacion_clase}',
    'true'::jsonb,
    true
  )
WHERE email IS NOT NULL AND email LIKE '%@%';

COMMIT;
