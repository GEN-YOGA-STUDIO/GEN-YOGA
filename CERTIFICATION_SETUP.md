# Certificación aislada

La web de certificación no debe usar el proyecto Supabase ni Stripe LIVE de
producción. El antiguo directorio `subir cert` era una copia manual incompleta y
podía mezclar versiones y datos reales.

## Requisitos

1. Crear un proyecto Supabase exclusivo de certificación.
2. Aplicar allí las migraciones necesarias y usar únicamente datos de prueba.
3. No desplegar las Edge Functions LIVE de este repositorio en certificación.
4. Si se quieren probar pagos, crear una implementación separada con claves,
   Prices y webhook de Stripe TEST. El backend LIVE solo acepta operaciones desde
   el origen autorizado de producción; la interfaz web mantiene la misma versión
   6.6 y no muestra avisos técnicos distintos según el dominio.

## Construcción

En PowerShell, desde `ultima version`:

```powershell
$env:CERT_SUPABASE_URL = 'https://PROYECTO-CERT.supabase.co'
$env:CERT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_CLAVE_PUBLICA_CERT'
npm run build:cert
```

El comando falla si falta alguna variable o si se intenta usar el proyecto de
producción. Regenera `../subir cert` como un artefacto exacto de la versión 6.6,
elimina archivos heredados y crea `certification-build.json` para poder comprobar
qué entorno se está publicando.

No copies manualmente archivos entre producción y certificación. Publica siempre
el resultado completo del comando y comprueba el manifiesto antes del despliegue.
