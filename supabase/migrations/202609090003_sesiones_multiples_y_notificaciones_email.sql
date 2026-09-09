-- ==============================================================================
-- MIGRACIÓN v13.2: Soporte para Sesiones Múltiples Simultáneas y Sistema
-- de Notificaciones por Correo Electrónico para Profesionales
-- ==============================================================================

BEGIN;

-- 1. Soporte en tabla 'clases' para sesiones múltiples vinculadas (2 o más huecos simultáneos)
ALTER TABLE public.clases
  ADD COLUMN IF NOT EXISTS grupo_multiple_id text,
  ADD COLUMN IF NOT EXISTS sesion_multiple_parte integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sesion_multiple_total integer DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_clases_grupo_multiple
  ON public.clases(grupo_multiple_id)
  WHERE grupo_multiple_id IS NOT NULL;

-- 2. Configuración de notificaciones por correo en 'profesionales'
ALTER TABLE public.profesionales
  ADD COLUMN IF NOT EXISTS notificaciones_email_activas boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_notificaciones text,
  ADD COLUMN IF NOT EXISTS notificaciones_config jsonb DEFAULT '{"reserva_consulta": true, "reserva_multiple": true, "cancelacion_consulta": false}'::jsonb;

-- 3. Tabla de registro y auditoría de notificaciones enviadas
CREATE TABLE IF NOT EXISTS public.notificaciones_email_log (
  id bigserial PRIMARY KEY,
  profesional_id bigint REFERENCES public.profesionales(id) ON DELETE SET NULL,
  profesor_email text,
  evento text NOT NULL,
  destinatario text NOT NULL,
  remitente text NOT NULL DEFAULT 'hola@genyoga.studio',
  asunto text NOT NULL,
  cuerpo_html text,
  estado text NOT NULL DEFAULT 'enviado',
  detalles jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_email_profesional
  ON public.notificaciones_email_log(profesional_id, created_at DESC);

-- RLS y permisos para notificaciones_email_log
ALTER TABLE public.notificaciones_email_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'notificaciones_email_log'
       AND policyname = 'Admins y staff pueden consultar logs de notificaciones'
  ) THEN
    CREATE POLICY "Admins y staff pueden consultar logs de notificaciones"
      ON public.notificaciones_email_log
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
           WHERE profiles.id = auth.uid()
             AND lower(trim(coalesce(profiles.rol, ''))) IN ('admin', 'profesor', 'trabajador', 'profesional')
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'notificaciones_email_log'
       AND policyname = 'Usuarios autenticados y servicio pueden registrar notificaciones'
  ) THEN
    CREATE POLICY "Usuarios autenticados y servicio pueden registrar notificaciones"
      ON public.notificaciones_email_log
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT ON TABLE public.notificaciones_email_log TO authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.notificaciones_email_log_id_seq TO authenticated, service_role;

COMMIT;
