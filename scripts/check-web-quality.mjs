import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedPages = [
  'cancel.html',
  'clases.html',
  'index.html',
  'maestros.html',
  'politica-privacidad.html',
  'profile.html',
  'success.html',
  'tarifas.html',
];
const browserJavaScriptFiles = [
  'facilities-carousel.js',
  'i18n.js',
  'public-calendar.js',
  'teacher-profiles.js',
];
const errors = [];
const invokedEdgeFunctions = new Set();

async function exists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function stripExecutableBlocks(source) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

function openHtmlElementsAt(source, index) {
  const voidElements = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ]);
  const stack = [];
  const prefix = source.slice(0, index).replace(/<!--[\s\S]*?-->/g, '');
  for (const match of prefix.matchAll(/<(\/)?([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const closing = Boolean(match[1]);
    const tagName = match[2].toLowerCase();
    if (closing) {
      const matchingIndex = stack.map((element) => element.tagName).lastIndexOf(tagName);
      if (matchingIndex >= 0) stack.splice(matchingIndex);
      continue;
    }
    if (!voidElements.has(tagName) && !/\/\s*>$/.test(match[0])) {
      stack.push({ tagName, attributes: match[3] });
    }
  }
  return stack;
}

function visibleText(markup) {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isPinnedPackageCdn(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }

  if (parsed.hostname === 'unpkg.com') {
    return /^\/(?:@[^/]+\/[^/@]+|[^/@]+)@[^/]+(?:\/|$)/.test(parsed.pathname);
  }
  if (parsed.hostname === 'cdn.jsdelivr.net' && parsed.pathname.startsWith('/npm/')) {
    return /^\/npm\/(?:@[^/]+\/[^/@]+|[^/@]+)@[^/]+(?:\/|$)/.test(parsed.pathname);
  }
  return true;
}

async function hasExactPathCase(relativePath) {
  const cleanSegments = relativePath.split(/[\\/]+/).filter((segment) => segment && segment !== '.');
  let current = root;
  for (const segment of cleanSegments) {
    if (segment === '..') return true;
    const entries = await readdir(current, { withFileTypes: true });
    const exact = entries.find((entry) => entry.name === segment);
    if (!exact) return false;
    current = path.join(current, exact.name);
  }
  return true;
}

function compileInlineScripts(fileName, source) {
  const inlineScript = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(inlineScript)) {
    const attributes = match[1];
    const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
    if (type && type !== 'text/javascript' && type !== 'application/javascript') continue;
    try {
      new Script(match[2], { filename: fileName });
    } catch (error) {
      errors.push(`${fileName}: JavaScript inline inválido (${error.message})`);
    }
  }
}

function checkInlineHandlers(fileName, source) {
  const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .join('\n');
  const defined = new Set();
  for (const match of scripts.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(match[1]);
  for (const match of scripts.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) defined.add(match[1]);
  for (const match of scripts.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) defined.add(match[1]);

  const ignored = new Set([
    'if', 'for', 'while', 'switch', 'return', 'typeof',
    'alert', 'confirm', 'prompt', 't',
  ]);
  const markup = stripExecutableBlocks(source);
  for (const attribute of markup.matchAll(/\bon(?:click|change|submit|input|keydown)=["']([^"']*)["']/gi)) {
    for (const call of attribute[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const functionName = call[1];
      if (!ignored.has(functionName) && !defined.has(functionName)) {
        errors.push(`${fileName}: el handler ${attribute[0]} llama a ${functionName}(), que no está definida`);
      }
    }
  }
}

async function checkLocalReference(fileName, rawReference) {
  const reference = rawReference.trim();
  if (!reference || /^(?:#|data:|mailto:|tel:|javascript:)/i.test(reference)) return;
  if (/^(?:https?:)?\/\//i.test(reference)) {
    if (/^https?:/i.test(reference) && !isPinnedPackageCdn(reference)) {
      errors.push(`${fileName}: dependencia CDN sin versión exacta (${reference})`);
    }
    return;
  }
  if (/[${}]/.test(reference)) return;

  const withoutSuffix = reference.split(/[?#]/, 1)[0];
  if (!withoutSuffix) return;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutSuffix);
  } catch {
    errors.push(`${fileName}: referencia con codificación inválida (${reference})`);
    return;
  }
  if (path.isAbsolute(decoded)) {
    errors.push(`${fileName}: ruta local absoluta no portable (${reference})`);
    return;
  }

  const absolute = path.resolve(root, path.dirname(fileName), decoded);
  const relativeToRoot = path.relative(root, absolute);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    errors.push(`${fileName}: referencia fuera del sitio (${reference})`);
    return;
  }
  if (!await exists(absolute)) {
    errors.push(`${fileName}: recurso local inexistente (${reference})`);
  } else if (!await hasExactPathCase(relativeToRoot)) {
    errors.push(`${fileName}: mayúsculas/minúsculas incorrectas en (${reference})`);
  }
}

const actualPages = (await readdir(root))
  .filter((name) => name.toLowerCase().endsWith('.html'))
  .sort((a, b) => a.localeCompare(b));
if (actualPages.join('|') !== expectedPages.join('|')) {
  errors.push(`Páginas inesperadas. Esperadas: ${expectedPages.join(', ')}; encontradas: ${actualPages.join(', ')}`);
}

for (const fileName of browserJavaScriptFiles) {
  const source = await readFile(path.join(root, fileName), 'utf8');
  try {
    new Script(source, { filename: fileName });
  } catch (error) {
    errors.push(`${fileName}: JavaScript inválido (${error.message})`);
  }
}

for (const fileName of actualPages) {
  const source = await readFile(path.join(root, fileName), 'utf8');
  const markup = stripExecutableBlocks(source);

  for (const invocation of source.matchAll(/\.functions\.invoke\(\s*['"]([^'"]+)['"]/g)) {
    invokedEdgeFunctions.add(invocation[1]);
  }

  for (const [label, pattern] of [
    ['doctype', /<!doctype\s+html\b/gi],
    ['html', /<html\b/gi],
    ['head', /<head\b/gi],
    ['body', /<body\b/gi],
  ]) {
    if (count(markup, pattern) !== 1) errors.push(`${fileName}: debe contener exactamente un ${label}`);
  }

  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const currentVersionParts = pkg.version.split('.');
  const currentVersion = `${currentVersionParts[0]}.${currentVersionParts[1]}`;
  const versionRegexEscaped = currentVersion.replace('.', '\\.');

  const canonicalFavicon = new RegExp(`<link\\s+rel=["']icon["']\\s+type=["']image/png["']\\s+sizes=["']64x64["']\\s+href=["']img/favicon-64\\.png\\?v=${versionRegexEscaped}["']\\s*/?>`, 'gi');
  if (count(markup, canonicalFavicon) !== 1) {
    errors.push(`${fileName}: debe incluir exactamente el favicon PNG 64x64 de la versión ${currentVersion}`);
  }
  const canonicalTouchIcon = new RegExp(`<link\\s+rel=["']apple-touch-icon["']\\s+sizes=["']180x180["']\\s+href=["']img/apple-touch-icon\\.png\\?v=${versionRegexEscaped}["']\\s*/?>`, 'gi');
  if (count(markup, canonicalTouchIcon) !== 1) {
    errors.push(`${fileName}: debe incluir exactamente el icono de favoritos móvil 180x180`);
  }

  compileInlineScripts(fileName, source);
  checkInlineHandlers(fileName, source);

  const ids = new Map();
  for (const match of markup.matchAll(/\bid=["']([^"']+)["']/gi)) {
    ids.set(match[1], (ids.get(match[1]) || 0) + 1);
  }
  for (const [id, occurrences] of ids) {
    if (occurrences > 1) errors.push(`${fileName}: id duplicado "${id}" (${occurrences} veces)`);
  }

  const loadedResources = new Map();
  for (const tag of markup.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    const reference = tag[1];
    const key = reference.replace(/[?#].*$/, '');
    loadedResources.set(key, (loadedResources.get(key) || 0) + 1);
  }
  for (const [resource, occurrences] of loadedResources) {
    if (occurrences > 1) errors.push(`${fileName}: recurso cargado ${occurrences} veces (${resource})`);
  }

  for (const tag of markup.matchAll(/<(?:script|img|link|a|source|video|audio)\b[^>]*\b(?:src|href)=["']([^"']*)["'][^>]*>/gi)) {
    const reference = tag[1];
    if (!reference && /^<(?:img|script|source|video|audio)\b/i.test(tag[0])) {
      errors.push(`${fileName}: src vacío`);
      continue;
    }
    await checkLocalReference(fileName, reference);
  }

  for (const anchor of markup.matchAll(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi)) {
    const rel = anchor[0].match(/\brel=["']([^"']*)["']/i)?.[1] || '';
    if (!/\bnoopener\b/i.test(rel) || !/\bnoreferrer\b/i.test(rel)) {
      errors.push(`${fileName}: target="_blank" sin rel="noopener noreferrer"`);
    }
  }

  if (/\bstyle=["'][^"']*\bselect-none\b/i.test(markup)) {
    errors.push(`${fileName}: usa la clase select-none como si fuera una declaración style`);
  }
  const appVersionMeta = new RegExp(`<meta\\s+name=["']application-version["']\\s+content=["']${versionRegexEscaped}["']\\s*/?>`, 'i');
  if (!appVersionMeta.test(markup)) {
    errors.push(`${fileName}: falta la identidad de compilación ${currentVersion}`);
  }
  if (/@latest\b/i.test(source)) errors.push(`${fileName}: contiene una dependencia @latest`);
  const staleVisualVersion = [...source.matchAll(/\bv(\d+)\.(\d+)\b/gi)]
    .find(([, major, minor]) => `${major}.${minor}` !== currentVersion);
  if (staleVisualVersion) {
    errors.push(`${fileName}: contiene una versión visual distinta de ${currentVersion} (${staleVisualVersion[0]})`);
  }
}

for (const functionName of invokedEdgeFunctions) {
  if (!/^[a-z0-9-]+$/.test(functionName)) {
    errors.push(`Nombre de Edge Function no válido en el frontend (${functionName})`);
    continue;
  }
  const entrypoint = path.join(root, 'supabase', 'functions', functionName, 'index.ts');
  if (!await exists(entrypoint)) {
    errors.push(`El frontend invoca ${functionName}, pero falta ${path.relative(root, entrypoint)}`);
  }
}

const classesPage = await readFile(path.join(root, 'clases.html'), 'utf8');
for (const [teacher, background] of [
  ['miriam', '#744833'],
  ['silvia', '#68704a'],
  ['isabel', '#8f6b2d'],
]) {
  const cardClass = new RegExp(
    `id=["']card-${teacher}["'][\\s\\S]*?class=["'][^"']*\\bconsultation-card\\b[^"']*\\bconsultation-card--${teacher}\\b`,
    'i',
  );
  if (!cardClass.test(classesPage)) {
    errors.push(`clases.html: la tarjeta de ${teacher} no usa su clase de contraste estable`);
  }
  const backgroundRule = new RegExp(
    `\\.consultation-card--${teacher}\\s*\\{[^}]*background-color:\\s*${background}`,
    'i',
  );
  if (!backgroundRule.test(classesPage)) {
    errors.push(`clases.html: la tarjeta de ${teacher} no declara el fondo ${background}`);
  }
}
for (const requiredClass of [
  'consultation-card__eyebrow',
  'consultation-card__title',
  'consultation-card__description',
]) {
  if (!classesPage.includes(requiredClass)) {
    errors.push(`clases.html: falta la jerarquía visual ${requiredClass}`);
  }
}
if (/bg-\[#(?:744833|68704a)\]/i.test(classesPage)) {
  errors.push('clases.html: Miriam o Silvia vuelven a depender de un fondo Tailwind no compilado');
}

const consultationTab = classesPage.match(
  /<button\b[^>]*\bid=["']btn-cat-consultas["'][^>]*>[\s\S]*?<\/button>/i,
)?.[0] || '';
if (visibleText(consultationTab) !== 'Consultas') {
  errors.push('clases.html: la pestaña de consultas debe usar el rótulo breve "Consultas"');
}
if (/consultas\s+por\s+profesor/i.test(classesPage)) {
  errors.push('clases.html: la pestaña y el CTA de consultas vuelven a repetir "Consultas por profesor"');
}

const yogaCalendarLaunch = classesPage.match(
  /<button\b[^>]*\bid=["']public-calendar-launch["'][^>]*>[\s\S]*?<\/button>/i,
)?.[0] || '';
const consultationCalendarLaunch = classesPage.match(
  /<button\b[^>]*\bid=["']public-consultas-calendar-launch["'][^>]*>[\s\S]*?<\/button>/i,
)?.[0] || '';
if (!yogaCalendarLaunch || /\bclass=["'][^"']*\bhidden\b/i.test(yogaCalendarLaunch)) {
  errors.push('clases.html: el CTA de horario de yoga debe ser el único visible al abrir la categoría inicial');
}
if (!consultationCalendarLaunch || !/\bclass=["'][^"']*\bhidden\b/i.test(consultationCalendarLaunch)) {
  errors.push('clases.html: el CTA general de consultas debe empezar oculto');
}
if (visibleText(consultationCalendarLaunch) !== 'Ver disponibilidad') {
  errors.push('clases.html: el CTA de consultas debe evitar repetir el nombre de la pestaña');
}

const categorySwitchFlow = classesPage.match(
  /window\.switchCategoryDeck\s*=\s*function\s*\(cat\)\s*\{[\s\S]*?\n\};/,
)?.[0] || '';
for (const [pattern, label] of [
  [/cat === 'consultas'[\s\S]*?yogaCalendarLaunch\.classList\.add\('hidden'\)[\s\S]*?consultasCalendarLaunch\.classList\.remove\('hidden'\)/, 'mostrar solo el CTA de consultas en Consultas'],
  [/\}\s*else\s*\{[\s\S]*?consultasCalendarLaunch\.classList\.add\('hidden'\)[\s\S]*?yogaCalendarLaunch\.classList\.remove\('hidden'\)/, 'mostrar solo el CTA de horario en Yoga'],
]) {
  if (!pattern.test(categorySwitchFlow)) errors.push(`clases.html: switchCategoryDeck debe ${label}`);
}

const calendarStyles = await readFile(path.join(root, 'public-calendar.css'), 'utf8');
for (const selector of ['gy-calendar-launch', 'gy-folder-calendar-link']) {
  const spacingValues = [
    ...calendarStyles.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'g')),
  ].flatMap((match) => [
    ...match[1].matchAll(/letter-spacing:\s*([0-9.]+)em/gi),
  ].map((spacing) => Number(spacing[1])));
  if (!spacingValues.length || spacingValues.some((spacing) => spacing > 0.05)) {
    errors.push(`public-calendar.css: ${selector} debe mantener un letter-spacing máximo de 0.05em`);
  }
  const mobileSpacing = new RegExp(
    `@media \\(max-width:\\s*767px\\)\\s*\\{[\\s\\S]*?\\.${selector}\\s*\\{[^}]*letter-spacing:\\s*0\\.03em`,
    'i',
  );
  if (!mobileSpacing.test(calendarStyles)) {
    errors.push(`public-calendar.css: ${selector} debe reducir el letter-spacing móvil a 0.03em`);
  }
}

const homePage = await readFile(path.join(root, 'index.html'), 'utf8');
const translationsScript = await readFile(path.join(root, 'i18n.js'), 'utf8');
const spanishTranslations = translationsScript.match(
  /\bes\s*:\s*\{([\s\S]*?)\n\s*\},\s*\n\s*en\s*:/,
)?.[1] || '';
const historyTriggers = [...homePage.matchAll(
  /<button\b(?=[^>]*\baria-controls=["']modal-historia["'])[^>]*>[\s\S]*?<\/button>/gi,
)];
if (historyTriggers.length !== 2) {
  errors.push('index.html: Ver más debe conservar exactamente un acceso de escritorio y otro móvil');
}
for (const trigger of historyTriggers) {
  if (!/\bclass=["'][^"']*\bhistory-modal-trigger\b/i.test(trigger[0])
      || !/\bonclick=["']openModal\('historia'\)["']/i.test(trigger[0])) {
    errors.push('index.html: cada acceso Ver más debe abrir modal-historia con el trigger común');
  }
  if (visibleText(trigger[0]) !== 'Ver más') {
    errors.push('index.html: el texto HTML de respaldo de ambos triggers debe ser "Ver más"');
  }
}
if (!/["']hero_btn_more["']\s*:\s*["']Ver más["']/.test(spanishTranslations)) {
  errors.push('i18n.js: la traducción española hero_btn_more debe ser "Ver más"');
}

const desktopHistoryTrigger = historyTriggers.find((trigger) => openHtmlElementsAt(homePage, trigger.index)
  .some((element) => /\bid=["']desktop-central-content["']/.test(element.attributes)));
if (!desktopHistoryTrigger) {
  errors.push('index.html: falta el trigger de escritorio dentro de #desktop-central-content');
} else if (openHtmlElementsAt(homePage, desktopHistoryTrigger.index)
  .some((element) => /\bclass=["'][^"']*\bhide-on-short\b/.test(element.attributes))) {
  errors.push('index.html: el trigger de escritorio no puede quedar dentro de hide-on-short');
}
const mobileHistoryTrigger = historyTriggers.find((trigger) => openHtmlElementsAt(homePage, trigger.index)
  .some((element) => /\bclass=["'][^"']*\blg:hidden\b/.test(element.attributes)));
if (!mobileHistoryTrigger) errors.push('index.html: falta el acceso móvil a Ver más');

const historyVideo = homePage.match(/<iframe\b[^>]*\bid=["']history-video["'][^>]*>/i)?.[0] || '';
for (const [required, label] of [
  ['src="https://www.youtube-nocookie.com/embed/2C_eBw8H-Vk', 'URL privada del vídeo de presentación'],
  ['data-src="https://www.youtube-nocookie.com/embed/2C_eBw8H-Vk', 'URL restaurable del vídeo'],
  ['title="Vídeo de presentación de GEN Yoga"', 'título accesible del vídeo'],
  ['loading="lazy"', 'carga diferida del vídeo'],
  ['allowfullscreen', 'reproducción del vídeo a pantalla completa'],
]) {
  if (!historyVideo.includes(required)) errors.push(`index.html: falta ${label}`);
}
if (/autoplay/i.test(historyVideo)) errors.push('index.html: el vídeo de presentación no debe reproducirse automáticamente');
if (/✦\s*Reservar|Reservar clase/i.test(homePage.match(/<!-- BOTÓN DESTACADO MI PERFIL[\s\S]*?<\/button>/)?.[0] || '')) {
  errors.push('index.html: el botón de Mi perfil no debe incluir subtítulo de Reservar clase');
}
const historyVideoIndex = homePage.indexOf('id="history-video"');
const historyTextIndex = homePage.indexOf('data-i18n="modal_history_sec1_title"');
if (historyVideoIndex < 0 || historyTextIndex < 0 || historyVideoIndex >= historyTextIndex) {
  errors.push('index.html: el vídeo de presentación debe aparecer antes del texto de Ver más');
}
const modalCloseButton = homePage.match(
  /<button\b(?=[^>]*\bonclick=["']closeModal\(\)["'])[^>]*>[\s\S]*?<\/button>/i,
)?.[0] || '';
if (!/\btype=["']button["']/i.test(modalCloseButton)
    || !/\baria-label=["']Cerrar["']/i.test(modalCloseButton)
    || !/<svg\b[^>]*\baria-hidden=["']true["']/i.test(modalCloseButton)) {
  errors.push('index.html: la X del modal debe ser un botón con nombre accesible y gráfico decorativo');
}
const stopModalMediaFlow = homePage.match(
  /function stopModalMedia\(\)\s*\{[\s\S]*?(?=\n\s*window\.openModal\s*=)/,
)?.[0] || '';
const openModalFlow = homePage.match(
  /window\.openModal\s*=\s*function[\s\S]*?(?=\n\s*window\.closeModal\s*=)/,
)?.[0] || '';
const closeModalFlow = homePage.match(
  /window\.closeModal\s*=\s*function[\s\S]*?(?=\n\s*document\.addEventListener\('keydown')/,
)?.[0] || '';
if (!/querySelectorAll\('iframe'\)/.test(stopModalMediaFlow)
    || !/frame\.src\s*=\s*'about:blank'/.test(stopModalMediaFlow)) {
  errors.push('index.html: cerrar el modal debe descargar el iframe para pausar y reiniciar el vídeo');
}
if (!/frame\.src === 'about:blank'[\s\S]*?frame\.src = frame\.dataset\.src/.test(openModalFlow)) {
  errors.push('index.html: reabrir el modal debe restaurar el vídeo desde data-src');
}
if (!/stopModalMedia\(\)/.test(closeModalFlow)) {
  errors.push('index.html: closeModal debe ejecutar la pausa/reinicialización multimedia');
}

const profile = await readFile(path.join(root, 'profile.html'), 'utf8');
const adminStudentSearchFlow = profile.match(
  /const ADMIN_STUDENT_SEARCH_RESULT_LIMIT[\s\S]*?(?=\n\s*async function abrirModalAsignarClaseYoga)/,
)?.[0] || '';
const manualYogaAssignmentFlow = profile.match(
  /async function abrirModalAsignarClaseYoga[\s\S]*?(?=\n\s*async function cargarGrupoEnClaseCreada)/,
)?.[0] || '';
const manualConsultationAssignmentFlow = profile.match(
  /async function abrirModalAsignarConsulta[\s\S]*?(?=\n\s*async function asignarClienteAConsulta)/,
)?.[0] || '';
const consultationAssignmentRpcFlow = profile.match(
  /async function asignarClienteAConsulta[\s\S]*?(?=\n\s*\/\/ Las funciones legacy)/,
)?.[0] || '';
const manualWorkshopAssignmentFlow = profile.match(
  /async function abrirModalAsignarTaller[\s\S]*?(?=\n\s*async function cancelarReservaTaller)/,
)?.[0] || '';


for (const [required, label] of [
  ['ADMIN_STUDENT_SEARCH_RESULT_LIMIT = 50', 'límite de resultados del buscador de alumnos'],
  ['function normalizarBusquedaAlumnosAdmin', 'búsqueda normalizada de alumnos'],
  ['function crearMarkupBuscadorAlumnosAdmin', 'markup accesible reutilizable del buscador'],
  ['function crearBuscadorAlumnosAdmin', 'combobox de alumnos reutilizable'],
  ['const idPrefix = String(config.idPrefix', 'identificadores aislados por modal'],
  ['searchText: normalizarBusquedaAlumnosAdmin(`${label} ${email}', 'filtro por nombre y correo'],
  ['const selectionText = `${label} · ${identifier}`', 'identificador visible de la selección'],
  ['status.textContent = `Seleccionado: ${record.selectionText}.`', 'confirmación inequívoca de la selección'],
  ['name.textContent = record.label', 'nombre insertado sin HTML'],
  ['meta.textContent = record.meta', 'email o identificador insertado sin HTML'],
  ["event.key === 'ArrowDown'", 'navegación con flecha abajo'],
  ["event.key === 'ArrowUp'", 'navegación con flecha arriba'],
  ["event.key === 'Enter'", 'selección con Enter'],
  ["event.key === 'Escape'", 'cierre de resultados con Escape'],
  ['aria-activedescendant', 'opción activa accesible'],
  ['No hay ${entityPlural} que coincidan', 'estado vacío adaptable del buscador'],
  ['role="combobox"', 'rol combobox del buscador de alumnos'],
  ['aria-autocomplete="list"', 'autocompletado accesible del buscador'],
  ['role="listbox"', 'lista accesible de alumnos'],
  ['role="status" aria-live="polite"', 'anuncio accesible de resultados'],
]) {
  if (!adminStudentSearchFlow.includes(required)) {
    errors.push(`profile.html: falta ${label}`);
  }
}

if (/\.innerHTML\s*=/.test(adminStudentSearchFlow)) {
  errors.push('profile.html: el buscador reutilizable vuelve a interpolar perfiles mediante innerHTML');
}

const scalableAssignmentFlows = [
  {
    label: 'clases',
    source: manualYogaAssignmentFlow,
    idPrefix: 'swal-cliente-clase',
    permission: 'if (!tieneAccesoGestionAlumnos()) return;',
    required: [
      ["client.rpc('reservar_con_bono'", 'RPC reservar_con_bono'],
      ['p_clase_id: claseId', 'clase elegida'],
      ['p_user_id: result.value', 'alumno elegido'],
      ['btn-swal-cargar-grupo', 'botón para cargar grupo'],
      ['cargarGrupoEnClaseCreada', 'operación vigente para cargar grupo'],
    ],
  },
  {
    label: 'consultas',
    source: manualConsultationAssignmentFlow,
    idPrefix: 'swal-cliente-consulta',
    permission: 'if (!tieneAccesoConsultasAdmin()) return;',
    required: [
      ['await asignarClienteAConsulta(tipo, claseId, result.value)', 'enlace con la reserva atómica de consulta'],
    ],
  },
  {
    label: 'talleres',
    source: manualWorkshopAssignmentFlow,
    idPrefix: 'swal-cliente-taller',
    permission: 'if (!tieneAccesoGestionAlumnos()) return;',
    required: [
      ["client.rpc('reservar_con_bono'", 'RPC reservar_con_bono'],
      ['p_clase_id: claseId', 'taller elegido'],
      ['p_user_id: result.value', 'alumno elegido'],
    ],
  },
];

for (const { label, source, idPrefix, permission, required } of scalableAssignmentFlows) {
  for (const [needle, description] of [
    ['crearMarkupBuscadorAlumnosAdmin({', 'markup del buscador reutilizable'],
    ['crearBuscadorAlumnosAdmin(clientes, {', 'inicialización del buscador reutilizable'],
    ['studentPicker?.focus()', 'foco inicial en la búsqueda'],
    ['studentPicker?.getSelectedId()', 'selección estable por UUID'],
    ["customClass: { popup: 'admin-student-picker-popup' }", 'ancho accesible del modal'],
    [permission, 'permiso vigente'],
    ...required,
  ]) {
    if (!source.includes(needle)) {
      errors.push(`profile.html: el flujo de ${label} no conserva ${description}`);
    }
  }

  const prefixUses = source.match(new RegExp(`idPrefix: '${idPrefix}'`, 'g'))?.length || 0;
  if (prefixUses < 2) {
    errors.push(`profile.html: el flujo de ${label} no enlaza markup y lógica con ${idPrefix}`);
  }

  if (new RegExp(`<select[^>]+id=["']${idPrefix}(?:-[^"']*)?["']`, 'i').test(source)) {
    errors.push(`profile.html: la asignación de ${label} vuelve al desplegable no escalable`);
  }
}

for (const [required, label] of [
  ["client.rpc('reservar_consulta_atomica'", 'RPC atómica al asignar consultas'],
  ['p_tipo: tipo', 'tipo de consulta elegido'],
  ['p_clase_id: claseId', 'hueco de consulta elegido'],
  ['p_user_id: userId', 'cliente de consulta elegido'],
  ['p_cobrar_saldo: false', 'asignación admin sin consumo de saldo'],
]) {
  if (!consultationAssignmentRpcFlow.includes(required)) {
    errors.push(`profile.html: falta ${label}`);
  }
}

for (const cssClass of [
  '.admin-student-combobox__input:focus-visible',
  '.admin-student-combobox__listbox[hidden]',
  '.admin-student-combobox__option.is-active',
  '.admin-student-combobox__empty',
]) {
  if (!profile.includes(cssClass)) {
    errors.push(`profile.html: falta el estilo accesible ${cssClass}`);
  }
}

for (const rpc of ['reservar_consulta_atomica', 'cancelar_consulta_atomica']) {
  if (!profile.includes(`client.rpc('${rpc}'`)) errors.push(`profile.html: falta el flujo atómico ${rpc}`);
}
if (/\.from\(['"]reservas_(?:psicologia|nutricion)['"]\)\.insert/.test(profile)) {
  errors.push('profile.html: vuelve a insertar reservas de consulta fuera de la RPC atómica');
}
if (/\.from\(['"]reservas_yoga['"]\)\s*\.(?:insert|upsert|update|delete)\s*\(/.test(profile)) {
  errors.push('profile.html: vuelve a modificar reservas de yoga o talleres fuera de la RPC atómica');
}
if (!profile.includes("client.rpc('cancelar_con_bono'")) {
  errors.push('profile.html: la cancelación de yoga y talleres debe usar cancelar_con_bono');
}

const yogaPolicyMigrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '202607230001_yoga_booking_policy_integrity.sql',
);
if (!await exists(yogaPolicyMigrationPath)) {
  errors.push('Falta la migración que separa los límites de reserva y cancelación de yoga');
} else {
  const yogaPolicyMigration = await readFile(yogaPolicyMigrationPath, 'utf8');
  const reserveFunction = yogaPolicyMigration.match(
    /create or replace function public\.reservar_con_bono[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';
  const cancelFunction = yogaPolicyMigration.match(
    /create or replace function public\.cancelar_con_bono[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
  )?.[1] || '';

  if (!reserveFunction.includes("clave = 'horas_limite_reserva'")) {
    errors.push('La RPC de yoga no usa horas_limite_reserva');
  }
  if (reserveFunction.includes("clave = 'horas_limite_cancelacion'")) {
    errors.push('La RPC de yoga vuelve a mezclar el límite de cancelación al reservar');
  }
  if (!/v_starts_at\s*<=\s*now\(\)\s*\+\s*make_interval\(hours\s*=>\s*v_booking_limit_hours\)/i.test(reserveFunction)) {
    errors.push('La RPC de yoga no cierra la reserva exactamente en la frontera configurada');
  }
  if (!/from public\.profesionales[\s\S]*?where id = v_professor_id[\s\S]*?v_actor_email/i.test(reserveFunction)) {
    errors.push('La RPC de yoga no limita al staff a sus propias clases');
  }
  if (!cancelFunction.includes("clave = 'horas_limite_cancelacion'")) {
    errors.push('La cancelación de yoga no usa horas_limite_cancelacion');
  }
  if (cancelFunction.includes("clave = 'horas_limite_reserva'")) {
    errors.push('La cancelación de yoga vuelve a mezclar el límite de reserva');
  }
  if (!/v_starts_at\s*<=\s*now\(\)\s*\+\s*make_interval\(hours\s*=>\s*v_cancel_limit_hours\)/i.test(cancelFunction)) {
    errors.push('La RPC de yoga no cierra la cancelación exactamente en la frontera configurada');
  }
  for (const required of [
    'for update',
    'bono_descontado',
    'reservas_yoga_proteger_mutacion_directa',
    "v_actor_is_admin := v_actor_role = 'admin'",
    "v_class_type <> 'yoga'",
    'v_old_class_type',
    'v_new_class_type',
    'No se pudo verificar de forma segura la clase de la reserva.',
    'admin_actualizar_limite_reservas',
    'from public, anon',
    'to authenticated',
  ]) {
    if (!yogaPolicyMigration.toLowerCase().includes(required.toLowerCase())) {
      errors.push(`Migración de políticas de yoga: falta ${required}`);
    }
  }
}

const bookingMutationGuardPath = path.join(
  root,
  'supabase',
  'migrations',
  '202608060001_protect_taller_booking_mutations.sql',
);
if (!await exists(bookingMutationGuardPath)) {
  errors.push('Falta la migración que protege las reservas directas de talleres');
} else {
  const bookingMutationGuard = await readFile(bookingMutationGuardPath, 'utf8');
  for (const required of [
    "v_old_class_type in ('yoga', 'taller')",
    "v_new_class_type in ('yoga', 'taller')",
    "current_user in ('postgres', 'supabase_admin', 'service_role')",
    'revoke insert, update, delete on table public.reservas_yoga',
  ]) {
    if (!bookingMutationGuard.toLowerCase().includes(required.toLowerCase())) {
      errors.push(`Guard de reservas de talleres: falta ${required}`);
    }
  }
  if (/security\s+definer/i.test(bookingMutationGuard)) {
    errors.push('Guard de reservas de talleres: la función trigger no puede ser SECURITY DEFINER');
  }
}

if (!/hoursUntilClass\s*<=\s*bookingLimitHours/.test(profile)) {
  errors.push('profile.html: la prevalidación no respeta la frontera de reserva');
}
if (!/hoursUntilClass\s*<=\s*cancellationLimitHours/.test(profile)) {
  errors.push('profile.html: la prevalidación no respeta la frontera de cancelación');
}

for (const requiredFrontendText of [
  "getPolicyHours('horas_limite_reserva')",
  "getPolicyHours('horas_limite_cancelacion')",
  "client.rpc('admin_actualizar_limite_reservas'",
  "rawValue === ''",
  'policySaveInProgress',
  'El bono reservado no se devuelve.',
]) {
  if (!profile.includes(requiredFrontendText)) {
    errors.push(`profile.html: falta la regla ${requiredFrontendText}`);
  }
}

// Validate that all data-i18n and data-calendar-copy keys exist in dictionaries
const i18nFileContent = await readFile(path.join(root, 'i18n.js'), 'utf8');
const calFileContent = await readFile(path.join(root, 'public-calendar.js'), 'utf8');

const fnI18n = new Function(`
  const window = { location: { search: '', pathname: '/' }, addEventListener: () => {}, dispatchEvent: () => {}, localStorage: { getItem: () => null, setItem: () => {} }, document: { documentElement: { lang: 'es' }, body: { dataset: {} }, querySelectorAll: () => [], getElementById: () => null, createElement: () => ({ style: {} }), addEventListener: () => {} } };
  const document = window.document;
  const localStorage = window.localStorage;
  ${i18nFileContent}
  return translations;
`);
let i18nTranslations = { es: {}, en: {} };
try {
  i18nTranslations = fnI18n();
} catch (e) {
  errors.push(`i18n.js parse error: ${e.message}`);
}

const esKeys = new Set(Object.keys(i18nTranslations.es || {}));
const enKeys = new Set(Object.keys(i18nTranslations.en || {}));

const startCal = calFileContent.indexOf('const copy =');
const endCal = calFileContent.indexOf('const knownTeacherColors');
let calCopy = { es: {}, en: {} };
if (startCal !== -1 && endCal !== -1) {
  const copyCode = calFileContent.substring(startCal, endCal);
  const fnCal = new Function(`${copyCode}; return copy;`);
  calCopy = fnCal();
}
const calEsKeys = new Set(Object.keys(calCopy.es || {}));
const calEnKeys = new Set(Object.keys(calCopy.en || {}));

for (const pageName of actualPages) {
  const pageMarkup = await readFile(path.join(root, pageName), 'utf8');
  for (const match of pageMarkup.matchAll(/data-i18n=["']([^"']+)["']/g)) {
    const key = match[1];
    if (!esKeys.has(key)) errors.push(`${pageName}: data-i18n key "${key}" falta en i18n.js (es)`);
    if (!enKeys.has(key)) errors.push(`${pageName}: data-i18n key "${key}" falta en i18n.js (en)`);
  }
  for (const match of pageMarkup.matchAll(/data-calendar-copy=["']([^"']+)["']/g)) {
    const key = match[1];
    if (!calEsKeys.has(key)) errors.push(`${pageName}: data-calendar-copy key "${key}" falta en public-calendar.js (es)`);
    if (!calEnKeys.has(key)) errors.push(`${pageName}: data-calendar-copy key "${key}" falta en public-calendar.js (en)`);
  }
}

if (errors.length) {
  console.error('Web quality check failed:');
  for (const error of [...new Set(errors)]) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Web quality checks passed for ${actualPages.length} pages.`);
