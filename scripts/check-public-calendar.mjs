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
  consultationAvailabilityMigration,
  effectiveConsultationAvailabilityMigration,
  certificationBuild,
  overlapMigration,
  welcomeMigration,
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
  read('supabase/migrations/20260817110547_consultation_availability_miriam_isabel.sql'),
  read('supabase/migrations/202609020005_silvia_ayurveda_availability.sql'),
  read('scripts/build-certification.mjs'),
  read('supabase/migrations/202609020030_enforce_teacher_and_studio_schedule_no_overlap.sql'),
  read('supabase/migrations/202609020035_welcome_companion_bonuses_7_2.sql'),
]);

for (const id of [
  'public-calendar-panel',
  'calendar-week-range',
  'calendar-style-filters',
  'calendar-table-body',
  'calendar-day-tabs',
  'calendar-day-agenda',
  'btn-cat-yoga',
  'btn-cat-consultas',
  'btn-cat-talleres',
  'public-calendar-launch',
  'public-consultas-calendar-launch',
  'public-talleres-calendar-launch',
  'calendar-mode-clases',
  'calendar-mode-consultas',
  'calendar-mode-talleres',
  'folders-deck',
  'consultas-deck',
  'talleres-deck',
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
assert.match(classesPage, /public-calendar\.css\?v=\d+\.\d+/);
assert.match(classesPage, /public-calendar\.js\?v=\d+\.\d+/);
assert.match(classesPage, /facilities-carousel\.js\?v=\d+\.\d+/);
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

const expectedConsultationStarts = [570, 630, 690, 750, 1020, 1080, 1140, 1200];
assert.deepEqual(
  [...calendarApi.consultationStartMinutesFor({ nombre: 'Miriam' }, '2026-08-18')],
  expectedConsultationStarts,
  'Miriam debe estar disponible los martes de 09:30 a 13:30 y de 17:00 a 21:00',
);
assert.deepEqual(
  [...calendarApi.consultationStartMinutesFor({ nombre: 'Miriam' }, '2026-08-19')],
  expectedConsultationStarts,
  'Miriam debe estar disponible los miércoles',
);
assert.deepEqual([...calendarApi.consultationStartMinutesFor({ nombre: 'Miriam' }, '2026-08-20')], []);
assert.deepEqual(
  [...calendarApi.consultationStartMinutesFor({ nombre: 'Isabel', apellidos: 'Rodriguez' }, '2026-08-18')],
  expectedConsultationStarts,
  'Isabel debe reconocerse con apellidos y estar disponible los martes',
);
assert.deepEqual(
  [...calendarApi.consultationStartMinutesFor({ nombre: 'Isabel', apellidos: 'Rodriguez' }, '2026-08-20')],
  expectedConsultationStarts,
  'Isabel debe estar disponible los jueves',
);
assert.deepEqual([...calendarApi.consultationStartMinutesFor({ nombre: 'Isabel' }, '2026-08-19')], []);

const expectedSilviaStarts = [900, 990, 1080];
for (const dateKey of ['2026-06-19', '2026-08-28', '2026-09-11']) {
  assert.deepEqual(
    [...calendarApi.consultationStartMinutesFor({ nombre: 'Silvia' }, dateKey)],
    expectedSilviaStarts,
    `Silvia debe ofrecer 15:00, 16:30 y 18:00 el viernes alterno ${dateKey}`,
  );
}
for (const dateKey of ['2026-08-21', '2026-09-04', '2026-09-12']) {
  assert.deepEqual(
    [...calendarApi.consultationStartMinutesFor({ nombre: 'Silvia' }, dateKey)],
    [],
    `Silvia no debe ofrecer consultas fuera de la paridad quincenal (${dateKey})`,
  );
}
assert.equal(calendarApi.consultationDurationMinutesFor({ nombre: 'Silvia' }), 90);
assert.equal(calendarApi.consultationDurationMinutesFor({ nombre: 'Miriam' }), 60);
assert.equal(calendarApi.consultationDurationMinutesFor({ nombre: 'Isabel' }), 60);
const virtualConsultationSlotBuilder = calendarScript.match(
  /if\s*\(!existsInDb\)\s*\{[\s\S]*?generatedSlots\.push\(\{[\s\S]*?\}\);\s*\}/,
)?.[0] || '';
assert.match(virtualConsultationSlotBuilder, /const durationMinutes = consultationDurationMinutesFor\(prof\)/);
assert.match(
  virtualConsultationSlotBuilder,
  /const end = new Date\(start\.getTime\(\) \+ durationMinutes \* 60_000\)/,
  'El fin virtual debe derivarse de la duración profesional',
);
assert.match(
  virtualConsultationSlotBuilder,
  /\bdurationMinutes\s*,/,
  'La duración calculada debe acompañar al hueco virtual',
);

assert.match(calendarScript, /\.eq\('activa',\s*true\)/);
assert.match(calendarScript, /(?:\.in\('tipo_clase',\s*\['yoga',\s*'taller'\]\)|\.or\('tipo_clase\.eq\.taller|\.eq\('tipo_clase',\s*'yoga'\))/);
assert.match(calendarScript, /\.rpc\('get_public_weekly_schedule'/);
assert.match(calendarScript, /postgres_changes[\s\S]*table:\s*'clases'/);
assert.doesNotMatch(calendarScript, /reservas_yoga.*select|select\([^)]*user_id/i);
assert.match(calendarScript, /timeZone:\s*TIME_ZONE/);
assert.match(calendarScript, /genyoga:calendar:open/);
assert.match(calendarScript, /genyoga:calendar:close/);
assert.match(calendarScript, /profile\.html\?\$\{params\.toString\(\)\}/);
assert.match(calendarScript, /'companion_modality'/);
assert.match(calendarScript, /companionModality:\s*normalizeCompanionModality/);
assert.match(calendarScript, /item\.companionModality !== ofKey/);
assert.doesNotMatch(calendarScript, /Yoga Madre e Hija|50 años/i);
assert.match(welcomeMigration, /returns table \([\s\S]*?es_gratuita boolean,[\s\S]*?companion_modality text/i);

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
assert.match(profilePage, /(?:\.eq\('tipo_clase',\s*'taller'\)|\.eq\('clases\.tipo_clase',\s*'taller'\)|\.or\('tipo_clase\.eq\.taller)/);
assert.match(profilePage, /\.eq\('categoria',\s*'taller'\)/);
assert.doesNotMatch(profilePage, /id="clase-es-especial"|toggleClaseEspecial/);

assert.match(migration, /security definer/i);
assert.match(migration, /time zone 'Europe\/Madrid'/i);
assert.match(migration, /booking\.estado = 'confirmada'/);
assert.match(migration, /foreign key \(tipo_clase_id\) references public\.tipos_clases\(id\)/i);
assert.doesNotMatch(migration, /foreign key \(tipo_clase_id\) references public\.tipos_servicios\(id\)/i);
assert.match(migration, /revoke all on function public\.get_public_weekly_schedule\(date\)/i);
assert.match(migration, /grant execute on function public\.get_public_weekly_schedule\(date\)[\s\S]*to anon, authenticated/i);
assert.doesNotMatch(migration, /user_id\s+(?:uuid|text)|returns table[\s\S]*email/i);

assert.match(angelMigration, /set nombre = 'Yoga para Todos'/);
assert.match(angelMigration, /set activa = false/);
assert.match(angelMigration, /extract\(isodow from c\.fecha_inicio at time zone 'Europe\/Madrid'\) = 5/);
assert.doesNotMatch(angelMigration, /\bNinguna\b|\bseptiembre\b/i);

assert.match(consultationAvailabilityMigration, /time zone 'Europe\/Madrid'/i);
assert.match(consultationAvailabilityMigration, /v_local_weekday not in \(2, 3\)/i);
assert.match(consultationAvailabilityMigration, /v_local_weekday not in \(2, 4\)/i);
for (const start of ['09:30', '10:30', '11:30', '12:30', '13:30', '17:00', '18:00', '19:00', '20:00']) {
  assert.ok(consultationAvailabilityMigration.includes(`'${start}'::time`), `Falta el inicio ${start} en la validación SQL`);
}
assert.match(consultationAvailabilityMigration, /revoke all on function public\.reservar_consulta_virtual[\s\S]*from public, anon, authenticated/i);
assert.match(consultationAvailabilityMigration, /grant execute on function public\.reservar_consulta_virtual[\s\S]*to authenticated/i);

const effectiveVirtualFunction = effectiveConsultationAvailabilityMigration.match(
  /create or replace function public\.reservar_consulta_virtual\([\s\S]*?\$function\$;/i,
)?.[0] || '';
const effectiveAtomicFunction = effectiveConsultationAvailabilityMigration.match(
  /create or replace function public\.reservar_consulta_atomica\([\s\S]*?\$function\$;/i,
)?.[0] || '';
assert.ok(effectiveVirtualFunction, 'La migración efectiva debe redefinir reservar_consulta_virtual');
assert.ok(effectiveAtomicFunction, 'La migración efectiva debe redefinir reservar_consulta_atomica');

for (const [functionSql, functionName] of [
  [effectiveVirtualFunction, 'reservar_consulta_virtual'],
  [effectiveAtomicFunction, 'reservar_consulta_atomica'],
]) {
  assert.match(functionSql, /security definer/i, `${functionName} debe ser SECURITY DEFINER`);
  assert.match(functionSql, /set search_path = pg_catalog, public/i, `${functionName} debe fijar search_path`);
  assert.match(functionSql, /auth\.uid\(\)/i, `${functionName} debe exigir una identidad autenticada`);
  assert.match(functionSql, /v_professional_identity like '%silvia%'/i, `${functionName} debe identificar a Silvia`);
  assert.match(functionSql, /p_tipo <> 'nutricion'/i, `${functionName} debe limitar a Silvia a nutrición`);
  assert.match(functionSql, /(?:v_local_weekday|extract\(isodow[^)]*\)::integer)\s*<>\s*5/i, `${functionName} debe limitar a Silvia a viernes`);
  assert.match(
    functionSql,
    /mod\([^;\n]*date '2026-06-19'[^;\n]*,\s*14\)\s*<>\s*0/i,
    `${functionName} debe conservar el ancla quincenal 2026-06-19`,
  );
  const silviaTimes = functionSql.match(
    /v_silvia_start_times\s+constant time without time zone\[\]\s*:=\s*array\[([\s\S]*?)\];/i,
  )?.[1] || '';
  assert.deepEqual(
    [...silviaTimes.matchAll(/'(\d{2}:\d{2})'::time/gi)].map((match) => match[1]),
    ['15:00', '16:30', '18:00'],
    `${functionName} debe aceptar exclusivamente los tres inicios de Silvia`,
  );
}

assert.match(effectiveVirtualFunction, /perform pg_advisory_xact_lock\s*\(/i);
assert.match(effectiveVirtualFunction, /v_duracion\s*:=\s*90/i);
assert.match(effectiveVirtualFunction, /v_fecha_fin\s*:=\s*p_fecha_inicio\s*\+\s*make_interval\(mins\s*=>\s*v_duracion\)/i);
assert.match(effectiveAtomicFunction, /v_ends_at\s*<>\s*v_starts_at\s*\+\s*interval '90 minutes'/i);
assert.match(effectiveAtomicFunction, /coalesce\(v_duration,\s*0\)\s*<>\s*90/i);

const defensiveCleanup = effectiveConsultationAvailabilityMigration.match(
  /with invalid_legacy_slot as \([\s\S]*?delete from public\.clases[\s\S]*?;/i,
)?.[0] || '';
assert.ok(defensiveCleanup, 'La migración efectiva debe retirar defensivamente el hueco legado inválido');
for (const requiredCleanupGuard of [
  "lower(trim(professional.nombre)) = 'silvia'",
  "class.tipo_clase = 'yoga'",
  'public.reservas_yoga',
  'public.reservas_psicologia',
  'public.reservas_nutricion',
  'public.reservas_talleres',
  'public.unlimited_guest_passes',
]) {
  assert.ok(
    defensiveCleanup.toLowerCase().includes(requiredCleanupGuard.toLowerCase()),
    `El borrado defensivo debe incluir ${requiredCleanupGuard}`,
  );
}
assert.equal(
  (defensiveCleanup.match(/\bnot exists\s*\(/gi) || []).length,
  5,
  'El hueco legado solo se puede borrar si no tiene ninguna reserva ni pase asociado',
);

for (const rpcSignature of [
  'reservar_consulta_virtual\\(text, bigint, timestamptz, uuid, boolean\\)',
  'reservar_consulta_atomica\\(text, bigint, uuid, boolean\\)',
]) {
  assert.match(
    effectiveConsultationAvailabilityMigration,
    new RegExp(`revoke all on function public\\.${rpcSignature}[\\s\\S]*?from public, anon, authenticated`, 'i'),
  );
  assert.match(
    effectiveConsultationAvailabilityMigration,
    new RegExp(`grant execute on function public\\.${rpcSignature}[\\s\\S]*?to authenticated`, 'i'),
  );
}

assert.match(certificationBuild, /'public-calendar\.css'/);
assert.match(certificationBuild, /'public-calendar\.js'/);
assert.match(certificationBuild, /'facilities-carousel\.js'/);

// Check schedule overlap prevention
assert.match(profilePage, /async function validateClassScheduleOverlap/);
assert.match(profilePage, /overlapCheck\.valid/);
assert.match(calendarScript, /hasTeacherClassOverlap/);
assert.match(overlapMigration, /create or replace function public\.check_clases_schedule_no_overlap/);
assert.match(overlapMigration, /create trigger trg_check_clases_schedule_no_overlap/);
assert.match(overlapMigration, /Conflicto de horario/);
assert.match(overlapMigration, /Conflicto de sala en el estudio/);

console.log('Public weekly calendar checks passed.');
