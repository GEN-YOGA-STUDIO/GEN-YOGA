-- 202609020048_permisos_ejecucion_bonos_yoga_en_compania.sql
--
-- PROBLEMA DETECTADO (verificado en producción 2026-08-27):
--   Las llamadas RPC del panel de administración para dar/quitar el bono de
--   "Yoga en Compañía" (saldo_clases_gratis) fallaban con:
--     {"code":"42501","message":"permission denied for function ajustar_saldo_usuario"}
--   Causa raíz: la migración 202609020045 otorgó EXECUTE de ajustar_saldo_usuario
--   SOLO al rol `authenticated` (línea: grant execute ... to authenticated), y el
--   cliente web del panel emite la llamada con la clave anon antes de adjuntar el
--   JWT de sesión, por lo que PostgREST resolvía la llamada con rol `anon` y la
--   denegaba. es_clase_elegible_bono_gratis tenía el mismo problema.
--
-- SOLUCIÓN:
--   Conceder EXECUTE explícito a anon, authenticated y service_role. La función
--   ajustar_saldo_usuario sigue siendo segura: valida internamente que quien llama
--   tiene rol 'admin' en profiles y rechaza cualquier otro actor con excepción.
--
-- VERIFICACIÓN POST-APLICACIÓN:
--   POST /rest/v1/rpc/ajustar_saldo_usuario con apikey anon -> deja de devolver 42501
--   POST /rest/v1/rpc/es_clase_elegible_bono_gratis -> true para "Yoga en Compañía"

grant execute on function public.ajustar_saldo_usuario(uuid, text, integer)
  to anon, authenticated, service_role;

grant execute on function public.es_clase_elegible_bono_gratis(text, timestamp with time zone, text, boolean)
  to anon, authenticated, service_role;

-- Recargar el caché de esquema de PostgREST para que los permisos sean efectivos
notify pgrst, 'reload schema';
