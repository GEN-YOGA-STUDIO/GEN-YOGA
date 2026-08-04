import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const [
  classesPage,
  calendarScript,
  facilitiesScript,
  calendarStyles,
  teachersPage,
  ratesPage,
  successPage,
  profilePage,
  migration,
  angelMigration,
  certificationBuild,
] = await Promise.all([
  read('clases.html'),
  read('public-calendar.js'),
  read('facilities-carousel.js'),
  read('public-calendar.css'),
  read('maestros.html'),
  read('tarifas.html'),
  read('success.html'),
  read('profile.html'),
  read('supabase/migrations/202607240002_public_weekly_calendar.sql'),
  read('supabase/migrations/202608030001_angel_profile_schedule_6_8.sql'),
  read('scripts/build-certification.mjs'),
]);

for (const id of [
  'public-calendar-panel',
  'calendar-week-range',
  'calendar-style-filters',
  'calendar-table-body',
  'calendar-day-tabs',
  'calendar-day-agenda',
  'facilities-gallery',
  'facilities-carousel',
  'facilities-viewport',
  'facilities-prev',
  'facilities-next',
  'facilities-toggle',
  'facilities-dots',
]) {
  assert.match(classesPage, new RegExp(`id=["']${id}["']`), `Falta #${id} en clases.html`);
}
assert.match(classesPage, /public-calendar\.css\?v=6\.11/);
assert.match(classesPage, /public-calendar\.js\?v=6\.11/);
assert.match(classesPage, /facilities-carousel\.js\?v=6\.11/);
assert.match(classesPage, /GENPublicCalendar\?\.init\(\{\s*client\s*\}\)/);
assert.match(classesPage, /id=["']facilities-gallery["'][\s\S]*data-facilities-slide/);
assert.match(classesPage, /aria-roledescription=["']carousel["']/);

const calendarContentStart = classesPage.indexOf('<main class="gy-calendar__content">');
const calendarFooter = classesPage.indexOf('<div class="gy-calendar__footer-note">', calendarContentStart);
const facilitiesStart = classesPage.indexOf('<section id="facilities-gallery"', calendarFooter);
const calendarContentEnd = classesPage.indexOf('</main>', facilitiesStart);
assert.ok(
  calendarContentStart >= 0
  && calendarFooter > calendarContentStart
  && facilitiesStart > calendarFooter
  && calendarContentEnd > facilitiesStart,
  'Instalaciones debe permanecer bajo el horario y dentro del panel público',
);

const facilitySlides = [
  ...classesPage.matchAll(/<figure\b[^>]*data-facilities-slide[^>]*>[\s\S]*?<\/figure>/g),
].map((match) => match[0]);
assert.equal(facilitySlides.length, 5, 'La galería debe incluir las cinco fotografías oficiales');
facilitySlides.forEach((slide, index) => {
  assert.match(slide, /<picture>/i, `Foto ${index + 1} sin selección de formato`);
  assert.match(slide, /<img\b[^>]*\balt=["'][^"']+["']/i, `Foto ${index + 1} sin texto alternativo`);
  assert.match(slide, /<img\b[^>]*\bwidth=["']\d+["']/i, `Foto ${index + 1} sin anchura intrínseca`);
  assert.match(slide, /<img\b[^>]*\bheight=["']\d+["']/i, `Foto ${index + 1} sin altura intrínseca`);
  assert.match(slide, /<img\b[^>]*\bloading=["']lazy["']/i, `Foto ${index + 1} sin carga diferida`);
  assert.match(slide, /<source\b[^>]*media=["']\(max-width: 767px\)["'][^>]*type=["']image\/webp["']/i, `Foto ${index + 1} sin WebP móvil`);
  assert.match(slide, /<source\b[^>]*media=["']\(max-width: 767px\)["'][^>]*srcset=["'][^"']+\.jpg["']/i, `Foto ${index + 1} sin JPEG móvil`);
  assert.match(slide, /<source\b[^>]*type=["']image\/webp["'][^>]*srcset=["'][^"']+-desktop\.webp["']/i, `Foto ${index + 1} sin WebP de escritorio`);
  assert.match(slide, /<img\b[^>]*src=["']img\/espacio\/[^"']+-desktop\.jpg["']/i, `Foto ${index + 1} sin JPEG de respaldo`);
});

const facilitiesMarkup = classesPage.slice(facilitiesStart, calendarContentEnd);
assert.doesNotMatch(facilitiesMarkup, /images\.(?:unsplash|pexels)\.com/i);
const facilityAssetPaths = [...new Set(
  [...facilitiesMarkup.matchAll(/(?:src|srcset)=["'](img\/espacio\/[^"']+\.(?:webp|jpg))["']/gi)]
    .map((match) => match[1]),
)];
assert.equal(facilityAssetPaths.length, 20, 'Deben existir cuatro derivados por fotografía oficial');
await Promise.all(facilityAssetPaths.map((asset) => access(path.join(root, asset))));

const sandbox = {};
vm.createContext(sandbox);
new vm.Script(calendarScript, { filename: 'public-calendar.js' }).runInContext(sandbox);
const calendarApi = sandbox.GENPublicCalendar;
assert.ok(calendarApi, 'El módulo no publica GENPublicCalendar');
assert.equal(calendarApi.canonicalStyle('Power Vinyasa'), 'power-vinyasa');
assert.equal(calendarApi.canonicalStyle('Yoga Restaurativa o Suave'), 'restaurativa');
assert.equal(calendarApi.canonicalStyle('Yoga para Hombres'), 'yoga-para-hombres');
assert.equal(calendarApi.canonicalStyle('Yoga para Todos'), 'yoga-para-todos');
assert.equal(calendarApi.canonicalStyle('Yoga Aryuveda'), 'ayurveda');
assert.equal(calendarApi.canonicalStyle('Clase Especial (Taller)'), 'taller');
assert.equal(calendarApi.isPublicScheduleSlot({ nombre: 'Ángel Javier' }, '2026-08-07'), false);
assert.equal(calendarApi.isPublicScheduleSlot({ nombre: 'Ángel Javier' }, '2026-08-05'), true);
assert.equal(calendarApi.isPublicScheduleSlot({ nombre: 'Yanira' }, '2026-08-07'), true);

assert.match(calendarScript, /\.eq\('activa',\s*true\)/);
assert.match(calendarScript, /\.in\('tipo_clase',\s*\['yoga',\s*'taller'\]\)/);
assert.match(calendarScript, /\.rpc\('get_public_weekly_schedule'/);
assert.match(calendarScript, /postgres_changes[\s\S]*table:\s*'clases'/);
assert.doesNotMatch(calendarScript, /reservas_yoga.*select|select\([^)]*user_id/i);
assert.match(calendarScript, /timeZone:\s*TIME_ZONE/);
assert.match(calendarScript, /genyoga:calendar:open/);
assert.match(calendarScript, /genyoga:calendar:close/);
assert.match(calendarScript, /profile\.html\?\$\{params\.toString\(\)\}/);

assert.match(facilitiesScript, /AUTOPLAY_MS\s*=\s*6_500/);
assert.match(facilitiesScript, /prefers-reduced-motion:\s*reduce/);
assert.match(facilitiesScript, /IntersectionObserver/);
assert.match(facilitiesScript, /pointerenter/);
assert.match(facilitiesScript, /focusin/);
assert.match(facilitiesScript, /visibilitychange/);
assert.match(facilitiesScript, /clearTimeout\(state\.autoplayTimer\)/);
assert.match(facilitiesScript, /function syncTrailingSpace\(\)/);
assert.match(facilitiesScript, /--gy-facilities-tail/);
assert.match(facilitiesScript, /root\.addEventListener\('pointerup',\s*endPointerInteraction/);
assert.match(facilitiesScript, /if\s*\(!state\.panelOpen\)\s*return;/);
assert.match(classesPage, /body\.classList\.contains\('gy-calendar-open'\)/);
assert.doesNotMatch(
  classesPage.match(/<button id="facilities-toggle"[\s\S]*?<\/button>/)?.[0] || '',
  /aria-pressed=/,
);

assert.match(calendarStyles, /\.gy-calendar__table/);
assert.match(calendarStyles, /\.gy-calendar__mobile-event/);
assert.match(calendarStyles, /\.gy-facilities__viewport/);
assert.match(calendarStyles, /scroll-snap-type:\s*x mandatory/);
assert.match(calendarStyles, /\.gy-facilities__slide/);
assert.match(calendarStyles, /\.gy-facilities__dot::before/);
assert.match(calendarStyles, /@media \(max-width:\s*767px\)/);
assert.match(calendarStyles, /prefers-reduced-motion/);

assert.match(teachersPage, /class=["']teacher-class-link/);
assert.match(teachersPage, /#calendario-publico/);
assert.match(teachersPage, /getSlug/);
assert.match(ratesPage, /selected-yoga-class-summary/);
assert.match(ratesPage, /pending_booking_clase_id/);
assert.match(successPage, /preferred_guest_class_id/);
assert.match(successPage, /\.eq\('activa',\s*true\)/);
assert.match(profilePage, /tipo_clase_id:\s*tipoClaseId/);
assert.match(profilePage, /duracion_minutos:\s*duracion/);
assert.match(profilePage, /id="view-especiales"/);
assert.match(profilePage, /\.eq\('tipo_clase',\s*'taller'\)/);
assert.match(profilePage, /\.eq\('categoria',\s*'taller'\)/);
assert.doesNotMatch(profilePage, /id="clase-es-especial"|toggleClaseEspecial/);

assert.match(migration, /security definer/i);
assert.match(migration, /time zone 'Europe\/Madrid'/i);
assert.match(migration, /booking\.estado = 'confirmada'/);
assert.match(migration, /revoke all on function public\.get_public_weekly_schedule\(date\)/i);
assert.match(migration, /grant execute on function public\.get_public_weekly_schedule\(date\)[\s\S]*to anon, authenticated/i);
assert.doesNotMatch(migration, /user_id\s+(?:uuid|text)|returns table[\s\S]*email/i);

assert.match(angelMigration, /set nombre = 'Yoga para Todos'/);
assert.match(angelMigration, /set activa = false/);
assert.match(angelMigration, /extract\(isodow from c\.fecha_inicio at time zone 'Europe\/Madrid'\) = 5/);
assert.doesNotMatch(angelMigration, /\bNinguna\b|\bseptiembre\b/i);

assert.match(certificationBuild, /'public-calendar\.css'/);
assert.match(certificationBuild, /'public-calendar\.js'/);
assert.match(certificationBuild, /'facilities-carousel\.js'/);

console.log('Public weekly calendar checks passed.');
