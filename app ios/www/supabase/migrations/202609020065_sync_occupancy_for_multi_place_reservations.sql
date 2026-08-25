begin;

-- La ocupacion se sincroniza siempre de forma agregada en 066.
-- No se persiste en public.clases porque esa columna no existe.

notify pgrst, 'reload schema';

commit;
