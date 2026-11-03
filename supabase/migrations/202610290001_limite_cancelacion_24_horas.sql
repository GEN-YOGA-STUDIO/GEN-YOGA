-- Migración 202610290001: Establecer límite de cancelación a 24 horas exactas
-- Bloquea cualquier cancelación de clase si faltan 24 horas o menos para su inicio.

UPDATE public.configuracion
   SET valor = '24',
       descripcion = 'Horas mínimas de anticipación para cancelar y recuperar el bono',
       tipo = 'integer',
       updated_at = now()
 WHERE clave = 'horas_limite_cancelacion';

INSERT INTO public.configuracion (clave, valor, descripcion, tipo)
VALUES (
  'horas_limite_cancelacion',
  '24',
  'Horas mínimas de anticipación para cancelar y recuperar el bono',
  'integer'
)
ON CONFLICT (clave) DO UPDATE
  SET valor = '24',
      descripcion = 'Horas mínimas de anticipación para cancelar y recuperar el bono',
      tipo = 'integer',
      updated_at = now();
