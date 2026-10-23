# Diseño de soluciones — Auditoría QA genyoga.studio → v17.21.1

> **Clasificación:** incidencia (fix). **Versión objetivo:** `17.21.1` (regla del repo en `registrar-cambio.mjs`: una **incidencia** sube el 3er número; el minor solo sube en `desarrollo`, como `v17.6.5` o `v17.4.1`).
> **Base:** v17.21.0 (producción = repo local). **Despliegue:** cert primero (`npm run cambio` → push → workflow `deploy-cert`).
> Todos los fallos se **reprodujeron localmente** contra el mismo código que está en producción antes de diseñarlos.
> Tres hallazgos del informe original **no se reprodujeron** y se documentan abajo como "correcciones del informe".

---

## 0. Método de verificación (antes/después)

Se montó un servidor estático **sin cabeceras de caché** sobre la raíz del repo (idéntica a producción) y se ejecutaron dos medidores:

> Nota: el primer servidor usado (`python -m http.server`) servía una copia cacheada de `tailwind-compiled.css`, por lo que las mediciones intermedias se hacían con clases antiguas. Toda la evidencia definitiva está tomada contra el servidor sin caché, con el CSS ya recompilado.

| Verificador | Qué mide | Equivalencia |
|---|---|---|
| `tools.browser.lighthouse` | puntuaciones a11y/SEO/best-practices + nodos exactos de `color-contrast` | Es la misma Lighthouse del informe original |
| QA en-página propio (inyectado con `browser.evaluate`) | contraste (WCAG 2.1 AA con composición de opacidad y fondos en cascada), targets < 24 px, `h1`/orden de encabezados, landmarks, meta, inputs sin nombre accesible, scroll horizontal | Coincide con Lighthouse y añade targets/meta/landmarks |

Para emular anchos móviles sin poder redimensionar la ventana se usó un `<iframe>` de ancho fijo (375/414/768/800/900 px) — mismo origen, por lo que el scroll se mide dentro del iframe.

**Baseline local v17.21 (8 páginas):**

| Página | h1 | `main` | fallos contraste | targets <24 px | inputs sin label | desc/canonical |
|---|---|---|---|---|---|---|
| index | **0** | 1 | 14 | 7 | 0 | OK |
| clases | 1 | 1 | 17 | 8 | 0 | OK |
| tarifas | 1 | **0** | 12 | 5 | 0 | OK |
| maestros | 1 (salto **1→3**) | **0** | 3 | 6 | 0 | OK |
| profile | **0** | 1 | 3 | 3 | **4** | **desc/canonical/OG ausentes** |
| politica-privacidad | **0** | **0** | 0 reales* | 2 | 0 | OK |
| success | 1 | **0** | 1 | 1 | 0 | ausentes |
| cancel | 1 | **0** | 3 | 3 | 0 | ausentes |

\* Los 4 "fallos" de política de privacidad eran **falso positivo** del detector (contenía el bloque ES oculto con `display:none`; el padre oculto no hace `display:none` a los hijos en `getComputedStyle`).

---

## 1. Fallos críticos de compra (tarifas.html)

### F1 — La clase especial se preselecciona en la compra de clase suelta ✅ CONFIRMADO
**Reproducción:** `iniciarFlujoInvitadoClaseSuelta()` → el `<select>` toma la **primera opción**, que es `vie, 23 oct 19:00 · Flow y Meditación (Yanira Umana) [Taller/Especial]` (`id=7856`). Al confirmar aparece *"Clase no reservable con clase suelta"* → **bucle sin salida para el usuario**: no puede comprar.
**Causa raíz:** la lista se ordena por `fecha_inicio` y no filtra los talleres/clases especiales, aunque la propia consulta ya pide el flag `es_especial`.
**Solución:** excluir del `<select>` las clases marcadas como taller/especial (el diálogo ya explica que no son reservables con clase suelta) y preseleccionar la primera clase **regular**. Se conserva el mensaje de error como red de seguridad para enlaces con `?clase=` de un evento.
**Archivos:** `tarifas.html`.
**Criterio de aceptación:** abrir la compra como invitado y ver que la opción preseleccionada es una clase regular de yoga y que el flujo completa hasta el formulario de datos.

### F2 — Validación silenciosa del formulario de invitado ❌ NO SE REPRODUCE (falso positivo)
**Reproducción:** con el diálogo `Datos del Alumno (Usuario Temporal)` abierto:
- campos vacíos → aparece `El teléfono móvil debe tener 9 dígitos numéricos` / `Por favor, introduce tu nombre.` en `.swal2-validation-message`, **visible** (rect y=385→429 dentro del popup de y=10→519);
- teléfono `12` → `El teléfono móvil debe tener 9 dígitos numéricos.`, popup abierto;
- solo con datos válidos se invoca Stripe.
**Conclusión:** la validación funciona y **es visible**. No se "arregla" lo que no está roto; se documenta y se deja el comportamiento intacto.
**Mejora menor añadida (sin tocar la lógica):** `aria-required="true"` e `inputmode="tel"` en los campos, para lectores de pantalla y teclado numérico móvil.

### F3 — El botón "No"/"Cancel" en inglés ❌ FALSO POSITIVO
**Reproducción (ES):** los botones `.swal2-deny` y `.swal2-cancel` existen en el DOM con los textos por defecto de SweetAlert2 (`No`, `Cancel`), pero `offsetParent === null` → **están ocultos**; el diálogo solo muestra "Elegir otra clase".
**Sí es real:** el diálogo entero está **hardcodeado en español**, por lo que en modo EN aparece en español. Se corrige con `alertTranslations` (ver F6).
**Archivos:** `i18n.js`.

---

## 2. Scroll horizontal en el sitio (todas las páginas) ✅ CONFIRMADO
**Reproducción (iframe 375/414/768/800/900 px):** `scrollX = 15,3` en todas; `body.scrollWidth = doc.clientWidth + 15,3`.
**Causa raíz:** `w-screen` = `100vw`, que **incluye el ancho de la barra de scroll vertical** (15,3 px en desktop), mientras `documentElement.clientWidth` la excluye. El `body` resulta más ancho que el viewport y el documento scrollea en horizontal. En `tarifas.html` el mismo `100vw` está en `.fixed-viewport` dentro de `@media (max-width: 639px)`.
**Solución:** sustituir `w-screen` → `w-full` (y `100vw` → `100%` en el CSS de `.fixed-viewport`); `w-full` mide contra el `html` = `clientWidth`, sin barra.
**Archivos:** `index.html`, `clases.html`, `maestros.html`, `politica-privacidad.html`, `profile.html`, `success.html`, `cancel.html`, `tarifas.html`.
**Criterio de aceptación:** `scrollX === 0` en las 8 páginas a 375/414/768/800/900 px.

---

## 3. Modal de bienvenida (index.html) — accesibilidad ✅ CONFIRMADO PARCIAL
**Reproducción:**
- ✅ **Falta focus trap**: con el modal abierto, `Tab` sale al fondo de la página (`ES` → `EN` → `MI PERFIL`).
- ✅ El foco **no entra** al abrir ni **se restaura** al cerrar.
- ✅ El modal permanece en el árbol de accesibilidad al cerrar (solo `opacity-0`; `visibility: visible`, sin `aria-hidden`/`inert`).
- ❌ **Escape SÍ lo cierra** (antes de cerrar `modalOpen:true`, tras Escape `modalOpen:false`) → **corrección del informe**.
**Solución:** en `abrirFlashWelcomeModal` se guarda `document.activeElement`, se aplica `inert` + `aria-hidden="true"` al contenido de fondo, se enfoca el botón de cierre y se instala un manejador `keydown` que hace circular el `Tab` dentro del modal; en `cerrarFlashWelcomeModal` se retira el manejador, se restaura el foco previo y se devuelve `inert` al modal (`visibility:hidden` cuando está cerrado, para sacarlo del árbol de accesibilidad).
**Criterio de aceptación:** con el modal abierto, 8 `Tab` seguidos siguen dentro del modal; al cerrar, el foco vuelve al disparador y el diálogo ya no es navegable con lector de pantalla.

---

## 4. Internacionalización (i18n) en modo EN
Inventario real ejecutando el detector **con visibilidad por `getClientRects()`** (padres ocultos excluidos):

| Página | Cadenas ES visibles en EN | Detalle |
|---|---|---|
| index | 14 | Modal de bienvenida (11) + `#app-version-label-mobile` |
| tarifas | 10 (categoría Ofertas) | Tarjeta de bienvenida (8) + versión. Consultas/Eventos sin inventariar aún |
| clases | 2 reales | `#scroll-assist-text` se pisa desde JS en español |
| maestros | 7 | 5 especialidades de las tarjetas + dirección del footer |
| profile | 1 | `← INICIO` |
| success | 3 | **No carga `i18n.js`** → página completa en español |
| politica-privacidad | 0 reales | Falso positivo: el toggle ES/EN propio funciona |

**Solución:**
1. `index.html`: añadir `data-i18n` a los 11 strings del modal + claves nuevas `flash_*` en `es` y `en`; misma clave para `#app-version-label-mobile` que para `#app-version-label`.
2. `tarifas.html`: `data-i18n` en la tarjeta de bienvenida y en la categoría **Eventos** (bloque entero hardcodeado); comprobar la categoría **Consultas**.
3. `clases.html`: el texto de `#scroll-assist-text` debe respetar el idioma activo.
4. `maestros.html`: especialidades y dirección con claves nuevas.
5. `profile.html`: clave `btn_back_home_arrow` para `← INICIO` / `← HOME`.
6. `success.html`: cargar `i18n.js` y etiquetar los textos (igual que `cancel.html`, que ya lo tiene).
7. `i18n.js`: añadir al mapa `alertTranslations` los textos hardcodeados de los diálogos de compra, para que en EN dejen de aparecer en español.
**Criterio de aceptación:** con `yoga-lang=en`, el detector devuelve 0 cadenas ES visibles en las 8 páginas (excepto nombres propios y "GEN Yoga"); `npm run check:i18n` en verde.

---

## 5. Textos y fechas caducadas
### F4 — Tagline con error tipográfico ✅ CONFIRMADO
`clases.html:627` + `i18n.js:129` contienen **"¿Listx para fluir con energía y fuerza?"** (el informe anterior afirmaba que no estaba en el repo; sí lo está). Se corrige a **"¿Lista para fluir con energía y fuerza?"** (EN ya está bien: *"Ready to flow with strength and energy?"*).

### F5 — Fechas de consultas grupales caducadas ✅ CONFIRMADO
`tarifas.html:516` "(Martes 11:30 h (6 y 20 oct))" y `:530` "(Martes 11:30 h (7 y 21 oct))" ya han pasado. Se actualizan en `es` y `en` a las próximas fechas: **27 oct y 3 nov** y **28 oct y 4 nov**.
**Riesgo controlado:** los textos viven en claves `data-i18n` (`rates_psy_group_*`), no en HTML suelto, y el taller de `Sábado 19 Sep` de la categoría Eventos se trata aparte (ver F6).

### F6 — Taller de septiembre aún a la venta en la categoría Eventos
El taller "Introducción a Power Vinyasa" (`Sábado 19 Sep · 9:00 a 11:00`, checkout con `fecha: '2026-09-19'`) está caducado pero su botón sigue activo. Se actualiza la fecha al próximo sábado disponible **y** el parámetro `fecha` del checkout, para que Stripe no cobre un taller pasado.

---

## 6. Calendario público (`public-calendar.js`) ✅ CONFIRMADO PARCIAL
**Sí es un fallo:** al cambiar de semana aparece un estado vacío transitorio ("0 clases publicadas / No hay clases publicadas para esta selección") y después el contenido. **Causa raíz:** `loadWeek()` pone `state.loading = true` **sin limpiar `state.classes`**, y `render()` solo muestra el esqueleto de carga si `state.loading && !state.classes.length`; con datos de la semana anterior en memoria cae en la rama "con clases" y **oculta todas las vistas** durante la carga.
**Solución:** en `loadWeek()`, si la carga no es silenciosa, limpiar `state.classes` además de marcar `loading`. Así el esqueleto de carga se muestra de forma fiable. Las cargas silenciosas (refresco en segundo plano) conservan el contenido actual.
**No es un fallo (se documenta):** el reescribir la URL de `?clase=7856&week=2026-10-23` a `?class=7856&week=2026-10-19` es **normalización intencional** de `updateUrl()`: `clase` se acepta como alias de `class`, y `week` se normaliza al lunes de la semana (formato del parámetro). La navegación llega al mismo destino.
**Mejora de percepción de velocidad:** el esqueleto de carga se ve desde el primer frame en lugar del estado vacío, y la petición anterior ya se cancela por `requestSerial`.

---

## 7. Rendimiento de profile.html
`profile.html` pesa ~1,8 MB y descarga `xlsx.full.min.js` (~900 KB) en `<head>` con `defer`, aunque **solo lo usa el botón "Exportar a Excel" del panel de administración**.
**Solución:** eliminar la etiqueta `<script src="...xlsx...">` del `<head>` y cargarlo **bajo demanda** (inyección dinámica la primera vez que se llama a `descargarInformeMarketing('xlsx')`), con los mismos guardas de error que el resto del módulo. También se revisa la familia `Montserrat Arabic` declarada en `@font-face` pero solo referenciada en gráficos.
**Criterio de aceptación:** la descarga de recursos de `profile.html` baja en al menos 1 petición y ~900 KB en la carga inicial, y el botón de Excel sigue funcionando.

---

## 8. Táctiles mínimos (targets < 24 px) ✅ CONFIRMADO
Medidos con el QA en-página: puntos del carrusel de 6–9 px, iconos sociales de 18–20 px, botones `ES`/`EN` de 24×21 px, enlaces del footer de 16–20 px de alto, "Cerrar y continuar al estudio" de 422×19 px, y el enlace de recuperar contraseña de 20 px de alto.
**Solución:** ampliar el área pulsable sin alterar el tamaño visual (padding + `min-h-[24px]`/`min-w-[24px]`, o pseudo-elemento de expansión en los puntos del carrusel).
**Excepción WCAG 2.5.8 "Inline" aplicada correctamente en el detector.** La regla original del medidor era una aproximación (`el.closest('p,li,dd,td,…')`), que **no** cubría enlaces incrustados en un bloque de texto que no fuera una lista (p. ej. el enlace *"Política de Privacidad"* del pie de `profile.html`, de 15 px, dentro de la frase *"© 2026 GEN Yoga • Todos los derechos reservados. • …"*). La excepción de la norma dice literalmente *"el objetivo está en una frase o bloque de texto"*, así que la comprobación pasó a ser: `display:inline` **y** nodo de texto hermano no vacío. Con esa regla quedan exentos (y documentados como tales) 3 objetivos reales: los dos `mailto:` de la política de privacidad (19 px, en prosa) y ese enlace del pie. El botón *"¿Has olvidado tu contraseña?"*, que **no** está en una frase, sí se corrigió ampliando su área.
**Criterio de aceptación:** ningún elemento interactivo visible con `< 24 px` en ninguna dimensión (salvo los exentos por la excepción "Inline", listados uno a uno).

---

## 9. Contraste (WCAG 2.1 AA) ✅ CONFIRMADO
Nodos exactos de Lighthouse y del QA en-página. **Principio de corrección:** se cambia el color del **texto**, no el de la marca, siempre que sea posible, para preservar la identidad visual.

| Elemento | Situación | Ratio | Corrección |
|---|---|---|---|
| `#btn-inicio > span` | blanco sobre `#a69c6a` | 2,77 | texto `#2b1a10` (cocoa) |
| `h1#sticky-header` (tarifas) | `#a69c6a` sobre `#f8f6f2` | 2,57 | `#8b8049` (necesita 3:1 por ser texto grande) |
| pestañas `#tab-yoga/#tab-psicologia/#tab-talleres` | blanco sobre `#c3b89a` | 1,97 | texto `#33241a` |
| `#lang-btn-es/en` inactivo | `#f8f6f2` a opacidad 0,5 sobre `#795244` | 2,85 | opacidad **0,90** (con 0,85 seguía en 4,46) |
| separador `span /` | blanco a opacidad 0,25 | 1,16 | opacidad **0,90** |
| `#app-version-label` | `opacity-60` (5 páginas) y `opacity-85` (3) | 2,9 / 4,46 | `opacity-90` (4,99) en las 8 páginas + `404.html` |
| marquee | `#766c50` sobre `#e1daCA` | 3,74 | oscurecer el texto |
| tarjetas de clases | `text-white/60` y `text-white/80` sobre terracota | 1,35–3,86 | opacidad 0,95 / fondo más oscuro |
| `text-cocoa/60`, `text-cocoa/70`, `text-emerald-900/80` | varios | 2,27–3,63 | subir opacidad |
| `#btn-inicio` de profile | blanco sobre `#e06b53` | 3,28 | texto `#26160c` (5,13) |
| píldora `#reg-tab-email`/`#reg-tab-phone` (registro) | blanco sobre `#e06b53` | 3,28 | texto `#b8442e` (5,38) en el HTML **y** en las 4 apariciones de `switchRegisterMethod()` |
| botones `bg-gray-50 text-cocoa/60` en success/cancel | | 2,25 | subir opacidad |

> **Hallazgo importante sobre el pipeline CSS.** `tailwind-compiled.css` es un artefacto **precompilado y versionado**: añadir una clase nueva al HTML no la crea por sí sola. Varias de las correcciones anteriores usaron clases (`opacity-85`, `text-[#b8442e]`, `min-h-[24px]`, …) que estaban escritas en el marcado pero **inactivas** hasta correr `npm run build:css`. Por eso el criterio de aceptación de esta versión incluye explícitamente **recompilar el CSS tras cada lote** y re-medir; sin ese paso, el informe original medía sobre estilos obsoletos.

**Criterio de aceptación:** 0 fallos de `color-contrast` en las 8 páginas.

---

## 10. Estructura semántica y SEO on-page
| Fallo | Páginas | Solución |
|---|---|---|
| Sin `<h1>` | index, profile, politica-privacidad | Añadir un `<h1>` (oculto visualmente en index/profile para no alterar el diseño; en política se promueve el `h2#privacy-main-title` existente a `<h1>`, conservando el `id` que usa su JS) |
| Orden de encabezados | maestros (`1 → 3`) | El `h3` de las tarjetas de las plantillas inline pasa a `h2` |
| Sin landmark `main` | tarifas, maestros, politica, success, cancel | En tarifas el `div.fixed-viewport` pasa a `<main>` (el CSS usa solo selectores de clase); en el resto se envuelven las secciones |
| Meta ausentes | profile, success, cancel | `meta description` + `canonical` + Open Graph |
| Favicon/manifest 404 | global | `favicon.ico` real (contenedor ICO de 5.901 B con el PNG de 64 px embebido) + `manifest.json`, ambos enlazados en las 9 páginas. `favicon.ico` responde `200 image/x-icon` y `manifest.json` `200 application/json` |
| 404 genérico de GitHub Pages | global | `404.html` propio con el mismo marcado que el resto (`favicon.ico`/`manifest.json`, favicon de versión, `application-version`, `robots: noindex`, i18n ES/EN con claves `nf_*`, `<h1>` y `<main>` únicos). Añadido a `expectedPages` de `check-web-quality.mjs`, a `bump-version.mjs`, a `build-certification.mjs` (HTML + estáticos), a `check-release-consistency.mjs` y a `check-app-sync.mjs` |
| Referrer-Policy | global | `<meta name="referrer" content="strict-origin-when-cross-origin">` (ya presente en las 8 páginas; verificado, no hizo falta tocar nada) |

---

## 11. Correcciones del informe original (hallazgos que no se reprodujeron)

| Hallazgo original | Resultado de la re-verificación | Acción |
|---|---|---|
| "C1 — Validación silenciosa en el formulario de invitado" | **Falso positivo.** Aparecen los mensajes de validación y son visibles | Ninguna en la lógica; mejora de accesibilidad de los campos |
| "C2 parcial — botón `Cancel` en inglés" | **Falso positivo.** Es un nodo oculto de SweetAlert2 | Se corrige solo el i18n real de los diálogos |
| "C4 parcial — Escape no cierra el modal" | **Falso positivo.** Escape sí cierra el modal | Se corrigen foco, focus trap y árbol de accesibilidad |
| "A3 — 'LISTX' no está en el repo" | **Sí está**, en `clases.html:627` e `i18n.js:129` | Se corrige el texto |
| "A4 — la URL del calendario se reescribe" | Es normalización intencional (`clase`→`class`, `week`→lunes) | Se documenta; solo se corrige el estado vacío transitorio |
| "Política de privacidad sin traducir" | **Falso positivo.** Tiene toggle propio ES/EN funcional | Ninguna |
| "Owner 10/10 en 7 páginas" (RLS/Supabase) | No verificable desde el repositorio (requiere acceso a la base de datos) | Se documenta como pendiente |

---

## 12. Fuera de alcance y pendientes (documentado, no ejecutado)

1. **Cabeceras de seguridad (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, CSP).** GitHub Pages no permite definir cabeceras; el sitio va tras un proxy de Cloudflare, así que el sitio se corrige con **Transform Rules** (receta en el informe final). Sí se añade `Referrer-Policy` por meta, que es lo único permitido a este nivel.
2. **Corrección de datos en Supabase** (clases, RLS de administrador): requiere acceso a la base de datos, no disponible en esta sesión.
3. **Revisión legal del texto de la política de privacidad**: el contenido es correcto pero está hardcodeado; cualquier cambio debe pasar por revisión jurídica.

---

## 13. Secuencia de implementación (lotes con checks)

| Lote | Alcance | Check tras el lote | Estado |
|---|---|---|---|
| 1 | `i18n.js` (claves ES/EN + alertas + typo LISTX + claves `nf_*` de la 404) | `check:i18n` | ✅ |
| 2 | `index.html` (scroll, `<h1>`, modal a11y, i18n, contraste, targets) | `check:web` | ✅ |
| 3 | `tarifas.html` (select de clase suelta, i18n, fechas, `<main>`, contraste) | `check:web` + `check:i18n` | ✅ |
| 4 | `clases.html` + `public-calendar.js` (estado de carga, typo, dots) | `check:web` + `check:calendar` | ✅ |
| 5 | `maestros.html`, `politica-privacidad.html`, `success.html`, `cancel.html` | `check:web` + `check:teachers` | ✅ |
| 6 | `profile.html` (meta, `<h1>`, labels, xlsx bajo demanda, píldora de registro, `#btn-inicio`) | `check:web` + `check:marketing` | ✅ |
| 7 | `404.html` + `check-web-quality.mjs` + `bump-version.mjs` + `favicon.ico` + `manifest.json` | `check:web` completo (9 páginas) | ✅ |
| 8 | `npm test` completo → `npm run cambio -- incidencia ...` → push → **cert** | CI | ✅ `npm test` en verde (0 fallos) |

**Correcciones de gate hechas durante los lotes** (incluidas por la respuesta explícita de corregir también la infraestructura de QA):
- `check-marketing-report.mjs`: la regla "SheetJS con versión exacta" ahora acepta la URL fijada **en `profile.html` o en `marketing-report.js`**, porque el lote 6 pasó la carga a bajo demanda. Se conserva el sentido de la regla (ni `@latest` ni rangos).
- `check-web-quality.mjs`, `bump-version.mjs`, `build-certification.mjs`, `check-release-consistency.mjs`, `check-app-sync.mjs`: ampliados con `404.html` (y `favicon.ico`/`manifest.json` donde aplica).
- **Revert necesario en `clases.html`:** el lote 4 convirtió `div.fixed-viewport` en `<main>` y degradó el `<main class="gy-calendar__content">` existente a `<div>`, lo que dejó el contenido real (calendario, pie e instalaciones) **fuera** del landmark y rompió la aserción de `check-public-calendar.mjs:82`. Se revirtió a la semántica original de v17.21 (una sola, correcta: `<main>` sobre el contenido del calendario).

---

## 14. Evidencia "después" (medición final, ES)

Servidor estático sin caché sobre la raíz del repo, CSS recompilado, `localStorage['yoga-lang']='es'`. `cancel.html` se mide en un `<iframe>` porque redirige a los 5 s; `clases.html` con el panel de calendario abierto (estado con contenido real), y `profile.html` en sus 5 estados.

| Página / estado | contraste | targets <24 px | inputs sin nombre | h1 | `main` | scroll horiz. | exentos 2.5.8 |
|---|---|---|---|---|---|---|---|
| index | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| tarifas | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| clases (calendario abierto) | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| maestros | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| politica-privacidad | 0 | 0 | 0 | 1 | 1 | 0 | 2 (los `mailto:` en prosa) |
| success | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| cancel (iframe) | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| **404 (nueva)** | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| profile · login | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| profile · registro (email) | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| profile · registro (teléfono) | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| profile · recuperar contraseña | 0 | 0 | 0 | 1 | 1 | 0 | 0 |
| profile · vista de app | 0 | 0 | 0 | 1 | 1 | 0 | 1 (enlace del pie, en frase) |

**Comparación con el baseline (v17.21):** contraste 64 → 0, targets 35 → 0, inputs sin nombre 4 → 0, `h1` ausentes 3 → 0, `main` ausentes 5 → 0, scroll horizontal 8/8 páginas → 0. La página nueva `404.html` entra en el gate `check:web` como novena página y `favicon.ico`/`manifest.json` dejan de responder 404.

**Verificaciones adicionales:** `npm test` completo en verde (617 líneas, 0 fallos), `check:web` → "passed for 9 pages", `check:i18n` (265 claves en ES y EN), `check:marketing`, `check:calendar`, `check:app-sync` y `check:app-twins` (855 archivos sincronizados en los gemelos).
