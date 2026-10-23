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

## v17.22.4 — 23 oct 2026 · Incidencia

- **Descripción:** Corrige los avisos toast de SweetAlert2, que se mostraban como modales bloqueantes: el traductor de i18n forzaba el contexto de Swal y perdía las opciones del mixin. Afectaba sobre todo al aviso tras cancelar una reserva. (ámbito: perfil)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.22.4`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.22.4.md`

## v17.22.3 — 23 oct 2026 · Incidencia

- **Descripción:** Elimina la opción duplicada «Clases completas» del filtro del perfil y completa las traducciones EN del área de cliente (saldos, packs y caducidades, bonos especial e ilimitado, estados vacíos y pie de página). (ámbito: perfil)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.22.3`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.22.3.md`

## v17.22.2 — 23 oct 2026 · Incidencia

- **Descripción:** Corrige el refresco tras cancelar una reserva: urlParams no definido en checkProfile y la UI se quedaba mostrando la reserva hasta recargar (ámbito: perfil)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.22.2`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.22.2.md`

## v17.22.1 — 23 oct 2026 · Incidencia

- **Descripción:** QA exhaustiva: i18n completa de success y calendario, accesibilidad de pestañas y modal, talleres dinamicos sin datos caducados, verificaciones de 9 paginas y versionado real de incidencias (ámbito: qa)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.22.1`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.22.1.md`

## v17.22.0 — 23 oct 2026 · Incidencia

- **Descripción:** Auditoria QA completa de genyoga.studio: contraste WCAG AA, targets <24px, landmarks y h1, metas SEO, i18n ES/EN, fechas caducadas y xlsx bajo demanda; anadidos 404.html, favicon.ico y manifest.json (ámbito: qa)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.22`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.22.0.md`

## v17.21.0 — 22 oct 2026 · Desarrollo

- **Descripción:** Eliminado el aviso de caducidad 60 dias bajo los botones de otorgar bonos en el modal de gestion del admin (ámbito: bonos)
- **Validación:** npm test
- **Tag:** `v17.21`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.21.0.md`

## v17.20.0 — 22 oct 2026 · Desarrollo

- **Descripción:** Solo bonos activos visibles: bonos gastados, caducados o finalizados ocultos en alumno y admin (historico en BD para reclamaciones) (ámbito: bonos)
- **Validación:** npm test
- **Tag:** `v17.20`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.20.0.md`

## v17.19.0 — 22 oct 2026 · Desarrollo

- **Descripción:** Bonos otorgados por admin con caducidad de 60 dias visible en la UI: aviso en gestion de bonos y toast con fecha de caducidad al otorgar (ámbito: bonos)
- **Validación:** npm test
- **Tag:** `v17.19`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.19.0.md`

## v17.18.0 — 22 oct 2026 · Desarrollo

- **Descripción:** Clase suelta (1 clase, 15 EUR) disponible en el modal de compra de packs de profile (ámbito: bonos)
- **Validación:** npm test
- **Tag:** `v17.18`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.18.0.md`

## v17.17.0 — 22 oct 2026 · Desarrollo

- **Descripción:** Visibilidad de la caducidad de cada bono: desglose por packs con fecha de caducidad para alumno y admin, desplegables y consumo FEFO (ámbito: bonos)
- **Validación:** npm test
- **Tag:** `v17.17`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.17.0.md`

## v17.16.0 — 21 oct 2026 · Incidencia

- **Descripción:** Filtro y navegacion de clase especial o taller al pulsar Ver en Horario (ámbito: calendario)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.16`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.16.0.md`

## v17.14.0 — 21 oct 2026 · Incidencia

- **Descripción:** Reserva directa sin doble verificación en clases especiales desde tarifas y tras pago (ámbito: clases-especiales)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.14`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.14.0.md`

## v17.13.0 — 21 oct 2026 · Incidencia

- **Descripción:** Auto-reserva de plaza en clases especiales tras compra y regularizacion de Estefania Dominguez (ámbito: clases-especiales)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.13`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.13.0.md`

## v17.12.0 — 14 oct 2026 · Incidencia

- **Descripción:** Sincronización atómica de packs en ajuste de saldo y regularización de Encarnación Escribano (ámbito: bonos)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.12`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.12.0.md`

## v17.11.0 — 13 oct 2026 · Desarrollo

- **Descripción:** Simplificación de las apps: navegación 5 pestañas estilo Ami (Sesión 29:9:2026) con conexión a Supabase real (ámbito: apps)
- **Validación:** npm test
- **Tag:** `v17.11`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.11.0.md`

## v17.10.0 — 13 oct 2026 · Desarrollo

- **Descripción:** mejora Ampliación del chequeo nocturno: validación de privacidad en navegador, layout escritorio, cabeceras MIME, assets de branding y seguridad de almacenamiento (ámbito: nightly)
- **Validación:** npm test
- **Tag:** `v17.10`
- **Contabilidad B:** sin importe (0)
- **Informe:** `docs/informes/v17.10.0.md`

## v17.9.0 — 13 oct 2026 · Incidencia

- **Descripción:** Mejoras en suite nocturna: detección de desbordamiento horizontal móvil, tokens corruptos, enlaces rotos y validación de formularios (ámbito: nightly)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.9`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.9.0.md`

## v17.8.0 — 13 oct 2026 · Incidencia

- **Descripción:** Publicar en cert mejoras del proceso nocturno, robots.txt y corrección de sondas de integridad Supabase (ámbito: nightly)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.8`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.8.0.md`

## v17.7.0 — 8 oct 2026 · Incidencia

- **Descripción:** Unificar visualización de versión en footers web y adoptar incremento exclusivo de segundo número (v17.7) (ámbito: web)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.7`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.7.0.md`

## v17.6.5 — 8 oct 2026 · Incidencia

- **Descripción:** Habilitar flujo de pago y retornos en entorno de certificación (CERT) (ámbito: stripe)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.6.5`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.6.5.md`

## v17.6.4 — 8 oct 2026 · Incidencia

- **Descripción:** Corregir resolución de lookupKey en Stripe para clases especiales (Flow y Meditación) en tarifas y perfil (ámbito: stripe)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.6.4`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.6.4.md`

## v17.6.3 — 8 oct 2026 · Incidencia

- **Descripción:** corregir condición de carrera y fallback en límite de reserva de clases (ámbito: reservas)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.6.3`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.6.3.md`

## v17.6.2 — 8 oct 2026 · Incidencia

- **Descripción:** eliminar solapamiento entre la barra de bonos y el menu de seleccion en el perfil (ámbito: perfil)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.6.2`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.6.2.md`

## v17.6.1 — 8 oct 2026 · Incidencia

- **Descripción:** iniciar sesion en tarifas de eventos lleva a login y enfoca clase concreta (ámbito: eventos)
- **Validación:** npm run check:release · npm run check:regression · npm run check:web · npm run check:twins · npm run check:sync · npm run check:deploy · npm run check:cambios
- **Tag:** `v17.6.1`
- **Contabilidad B:** sin línea propia (mantenimiento mensual)
- **Informe:** `docs/informes/v17.6.1.md`

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
