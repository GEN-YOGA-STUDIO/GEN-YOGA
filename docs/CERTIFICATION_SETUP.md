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
   6.12 y no muestra avisos técnicos distintos según el dominio.

## Cómo funciona hoy: despliegue automático a cert

Cada push a `main` del repo `GEN-YOGA` ejecuta `.github/workflows/deploy-cert.yml`:

1. `npm run build:cert-web` (`scripts/build-cert-web.mjs`) copia `ultima version/`
   y **sustituye** `SUPA_URL` / `SUPA_KEY` por los del proyecto de certificación.
2. Marca las 8 páginas con `noindex,nofollow`, escribe `cert.json` (versión,
   entorno, proyecto de Supabase) y **omite el `CNAME`** (para no pisar
   `genyoga.studio`).
3. Sube `_cert/` al repo espejo
   [GEN-YOGA-CERT](https://github.com/GEN-YOGA-STUDIO/GEN-YOGA-CERT) y GitHub Pages
   lo publica en **<https://gen-yoga-studio.github.io/GEN-YOGA-CERT/>**.

Guarda estos tres secretos en el repo `GEN-YOGA` (Settings → Secrets → Actions):

| Secreto | Qué es | Cómo se obtiene |
|---|---|---|
| `CERT_SUPABASE_URL` | URL del proyecto Supabase **de certificación** | panel Supabase → Project Settings → API → Project URL (`https://XXXX.supabase.co`) |
| `CERT_SUPABASE_PUBLISHABLE_KEY` | clave pública (`sb_publishable_…`) de ese proyecto | mismo panel → `sb_publishable_…` |
| `CERT_REPO_TOKEN` | PAT con **Contents: write** sobre `GEN-YOGA-CERT` | <https://github.com/settings/tokens> (scopes `repo` o `contents:write`) |

El build **se niega explícitamente** a usar la URL o la clave de producción, así
que un secreto mal puesto sale en rojo y no mezcla entornos. Mientras falte
algún secreto, el workflow falla con el mensaje «Certificación necesita su
propio proyecto Supabase con datos de prueba» (ver `docs/CERTIFICATION_SETUP.md`).

Para reintentar un despliegue sin esperar a un push: `npm run cert`.

### Producción

**Pro no se publica con el push**: `deploy-pages.yml` quedó en `workflow_dispatch`.
Después de revisar la versión en cert:

```bash
npm run publicar   # gate check:cambios + workflow de Pages
```

## Construcción local (opcional)

En PowerShell, desde `ultima version`:

```powershell
$env:CERT_SUPABASE_URL = 'https://PROYECTO-CERT.supabase.co'
$env:CERT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_CLAVE_PUBLICA_CERT'
npm run build:cert
```

`npm run build:cert` es el generador **local** (no el de CI). Falla si falta
alguna variable o si se intenta usar el proyecto de producción. Regenera
`../subir cert` como un artefacto exacto de la versión 6.12, elimina archivos
heredados y crea `certification-build.json` para poder comprobar qué entorno se
está publicando. Para el despliegue real se usa `build:cert-web` (arriba).

No copies manualmente archivos entre producción y certificación. Publica siempre
el resultado completo del comando y comprueba el manifiesto antes del despliegue.
