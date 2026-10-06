# Registro de cambios · GEN Yoga

Desde el **30 sep 2026**, todo cambio que se ejecute en la web queda registrado aquí: versión, fecha y tipo de cambio. El detalle commit a commit de la historia anterior (v1 → v17.1) está en [`docs/HISTORIAL_VERSIONES.html`](docs/HISTORIAL_VERSIONES.html), generado desde `git log --all`.

**Tipos de cambio:**

| Tipo | Qué es | Versión | Validación | Deploy |
|---|---|---|---|---|
| **Desarrollo** (cambio mayor) | funcionalidad nueva, rediseño, decisión de producto | minor+1 → `17.1.0` ⇒ `17.2.0` | `npm test` completo (22 checks) | cert (auto) → pro con `npm run publicar` + apps |
| **Incidencia** (cambio menor) | bug, error en producción, arreglo puntual | patch+1 → `17.1.0` ⇒ `17.1.1` | `release` + `regression` + `web` + `twins` + `sync` + `deploy` + `cambios` | cert (auto) → pro con `npm run publicar`, solo web |

Un único comando lo ejecuta todo (bump → `sync_apps.py` → validación → entrada aquí → control económico → commit → historial → tag anotado → **informe** → push → apps):

```bash
npm run cambio -- desarrollo "descripción del cambio" --scope perfil --importe 100
npm run cambio -- incidencia "descripción del arreglo" --scope consultas
```

- **`npm run check:cambios`** (incluido en `npm test`) bloquea si a la versión vigente le falta su entrada aquí, su tag o su **informe** en `docs/informes/`.
- **`npm run contabilidad`** muestra el estado del control económico (documento privado, fuera del repo).
- **`npm run publicar`** es el único paso que lleva una versión a producción: valida el registro y lanza el workflow de Pages. Hasta entonces, el push solo publica en cert.

---

<!-- entradas-nuevas: las inserciones nuevas van justo debajo de esta línea (lo hace scripts/registrar-cambio.mjs) -->

## v17.6.0 — 6 oct 2026 · Desarrollo

- **Descripción:** ocultar bono ilimitado de meses pasados en tags y filtros de cliente (ámbito: admin)
- **Validación:** npm test
- **Tag:** `v17.6`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.6.0.md`

## v17.5.0 — 6 oct 2026 · Desarrollo

- **Descripción:** optimizar contraste y estados hover y activo en filtros rapidos de bonos (ámbito: admin)
- **Validación:** npm test
- **Tag:** `v17.5`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.5.0.md`

## v17.4.1 — 3 oct 2026 · Incidencia

- **Descripción:** limpiar sesion local en logout para evitar 403 en verificacion nocturna de cert (ámbito: auth)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.4.1`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.4.1.md`

## v17.4.0 — 2 oct 2026 · Desarrollo

- **Descripción:** unificar visualizacion de sesiones y alumnos, filtro por bonos VIP y clase especial automatica con bono ilimitado (ámbito: admin)
- **Validación:** npm test
- **Tag:** `v17.4`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.4.0.md`

## v17.3.1 — 2 oct 2026 · Incidencia

- **Descripción:** opcion para editar o eliminar series recurrentes de clases en administracion v17.3.1 (ámbito: admin)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.3.1`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.3.1.md`

## v17.3.0 — 2 oct 2026 · Desarrollo

- **Descripción:** unificar recuento de reservas en panel admin (todas, consultas y talleres) via RPC segura v17.3 (ámbito: admin)
- **Validación:** npm test
- **Tag:** `v17.3`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.3.0.md`

## v17.2.2 — 30 sep 2026 · Incidencia

- **Descripción:** calendario publico no hereda modo entre aperturas; briefing FALLOS_PARA_IA como paso 0 de la IA (ámbito: calendario)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.2.2`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.2.2.md`

## v17.2.1 — 30 sep 2026 · Incidencia

- **Descripción:** acabar mejoras a medias: fusion de perfiles reembolsa duplicadas y suma saldos gratuitos (migracion 202610010001), admin_eliminar_clase cerrado a anon, botones informe conciliacion con guardas y antidoble-clic, invitado elige otra clase sin repagar, cancel.html traducido (ámbito: antierrores)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.2.1`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.2.1.md`

## v17.2.0 — 30 sep 2026 · Desarrollo

- **Descripción:** sistema antierrores v17.2: locks anti-doble-clic en reservas cancelaciones y compras, doble-cargo checkout bloqueado, registro con confirmacion de email, recuperacion honesta, credito de taller en tarifas, storage de invitado unificado, i18n y back nativo (ámbito: antierrores)
- **Validación:** npm test
- **Tag:** `v17.2`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.2.0.md`

## v17.1.0 — 30 sep 2026 · Desarrollo

- **Descripción:** corregir el `ReferenceError: tagOnlineBadge` en consultas con rama llena (release v17.1).
- **Commits:** `fix(consultas): corregir ReferenceError tagOnlineBadge en rama llena + release v17.1` (65 ficheros sincronizados web + apps).
- **Validación:** `npm test` completo (21 checks en ese momento).
- **Tag:** `v17.1` (línea base del registro de versiones).
- **Contabilidad B:** sin línea nueva (la versión 17.1.0 ya estaba facturada en el documento; el vínculo automático empieza en la próxima release).
- **Informe:** `docs/informes/v17.1.0.md`

### 30 sep 2026 · Proceso (sin cambio de versión web)

- **`docs/HISTORIAL_VERSIONES.html`**: historial completo v1 → v17.1 con cada versión mayor desplegable, sus subversiones, cada commit (asunto, ficheros y cuerpo) y los tramos sin registro documentados con su evidencia. Generado por `scripts/generar-historial-versiones.mjs` (`npm run historial`).
- **`CAMBIOS.md`** (este fichero): registro obligatorio de todo cambio a partir de ahora.
- **Flujo de versionado nuevo**: `npm run cambio` clasifica el cambio (mayor/desarrollo o menor/incidencia), lo numera, valida, registra, commitea y etiqueta. `check:cambios` se añade a `npm test`.
- **`HISTORIAL_VERSIONES.html` movido de la raíz a `docs/`**: la raíz es el artefacto desplegable y `check:web` exige exactamente 8 páginas HTML.
- **Contabilidad B fuera del repo público** (`docs/contabilidad b.md` dejó de estar trackeado y el historial ya publicado se purgó con `git filter-repo`): el documento vive solo en disco + copias privadas en `APLICACIONES/contabilidad-b/`, y `npm run contabilidad` muestra su estado.
- **Informe automático por cambio**: cada release genera `docs/informes/v<versión>.md` con commits, dif, checks, despliegue y control económico; `check:cambios` lo exige.
- **Flujo cert → pro**: `Pages` pasó a fuente *Actions*, el push a `main` publica en <https://gen-yoga-studio.github.io/GEN-YOGA-CERT/> (repo espejo `GEN-YOGA-CERT`) y **producción solo se toca con `npm run publicar`**.
