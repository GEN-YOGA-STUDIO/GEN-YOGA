-- ==============================================================================
-- Migración 202609020077: Unificación de Consultas y Sesiones en public.clases
-- Garantiza que clases y consultas convivan armónicamente en la tabla canónica
-- y optimiza índices para consultas rápidas por tipo_clase, fecha y profesor.
-- ==============================================================================

-- 1. Índices de alto rendimiento para agilizar la carga de sesiones y consultas
CREATE INDEX IF NOT EXISTS idx_clases_tipo_fecha
  ON public.clases (tipo_clase, fecha_inicio ASC);

CREATE INDEX IF NOT EXISTS idx_clases_profesor_fecha
  ON public.clases (profesor_id, fecha_inicio ASC);

CREATE INDEX IF NOT EXISTS idx_clases_fecha_inicio
  ON public.clases (fecha_inicio ASC);

-- 2. Asegurar que las reservas de psicología y nutrición tengan índices por clase_id
CREATE INDEX IF NOT EXISTS idx_reservas_psicologia_clase_estado
  ON public.reservas_psicologia (clase_id, estado);

CREATE INDEX IF NOT EXISTS idx_reservas_nutricion_clase_estado
  ON public.reservas_nutricion (clase_id, estado);

CREATE INDEX IF NOT EXISTS idx_reservas_yoga_clase_estado
  ON public.reservas_yoga (clase_id, estado);

-- 3. Vista canónica informativa 'sesiones' que unifica la consulta de clases y consultas
CREATE OR REPLACE VIEW public.sesiones AS
SELECT
  c.id,
  c.nombre,
  c.tipo_clase,
  c.fecha_inicio,
  c.fecha_fin,
  c.duracion_minutos,
  c.capacidad_max,
  c.profesor_id,
  p.nombre AS profesional_nombre,
  p.apellidos AS profesional_apellidos,
  p.email AS profesional_email,
  p.foto_url AS profesional_foto_url,
  c.activa,
  c.es_especial,
  c.es_gratuita,
  c.created_at,
  c.updated_at
FROM public.clases c
LEFT JOIN public.profesionales p ON p.id = c.profesor_id;

-- 4. Notificar recarga de esquema a PostgREST
NOTIFY pgrst, 'reload schema';
