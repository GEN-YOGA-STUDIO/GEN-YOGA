begin;

-- La ocupacion se calcula desde las reservas; clases no tiene columna ocupadas.
-- La reparacion se aplica en 066 al actualizar las funciones de disponibilidad.

notify pgrst, 'reload schema';

commit;
