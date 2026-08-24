import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appRoots = ['', path.join('app android', 'www'), path.join('app ios', 'www')];
const readSurface = (base, file) => readFile(path.join(root, base, file), 'utf8');

const [profiles, rates, calendars, translations, migrations] = await Promise.all([
  Promise.all(appRoots.map(base => readSurface(base, 'profile.html'))),
  Promise.all(appRoots.map(base => readSurface(base, 'tarifas.html'))),
  Promise.all(appRoots.map(base => readSurface(base, 'public-calendar.js'))),
  Promise.all(appRoots.map(base => readSurface(base, 'i18n.js'))),
  Promise.all(appRoots.map(base => readSurface(base, path.join(
    'supabase', 'migrations', '202609020035_welcome_companion_bonuses_7_2.sql',
  )))),
]);

for (const [label, sources] of [
  ['profile.html', profiles],
  ['tarifas.html', rates],
  ['public-calendar.js', calendars],
  ['i18n.js', translations],
  ['migration 035', migrations],
]) {
  assert.equal(sources[1], sources[0], `Android debe sincronizar ${label}`);
  assert.equal(sources[2], sources[0], `iOS debe sincronizar ${label}`);
}

const profile = profiles[0];
const ratesPage = rates[0];
const calendar = calendars[0];
const migration = migrations[0];
const modalities = [
  ['colegas', 'Yoga con tus colegas'],
  ['pareja', 'Yoga con tu pareja'],
  ['hijo', 'Yoga con tu hijo'],
  ['abuela', 'Yoga con tu abuela'],
];

for (const [code, label] of modalities) {
  assert.match(ratesPage, new RegExp(`data-companion-modality="${code}"[\\s\\S]*?${label}`));
  assert.match(ratesPage, new RegExp(`oferta=${code}#calendario-publico`));
  assert.match(profile, new RegExp(`value="companion_${code}"`));
  assert.match(calendar, new RegExp(`\\b${code}: 'companion`));
  assert.match(migration, new RegExp(`'${code}'`));
}

assert.match(ratesPage, /1 clase gratuita de Yoga en compañía, asignada según tu edad/);
assert.match(ratesPage, /Todos los bonos[\s\S]*?sirven para las cuatro modalidades/);
assert.doesNotMatch(ratesPage, /Power Vinyasa[\s\S]*?data-companion-modality/);
assert.doesNotMatch(`${ratesPage}\n${profile}\n${calendar}`, /Yoga Madre e Hija|50 años/i);

for (const requiredPattern of [
  /id="reg-fecha-nacimiento"[\s\S]*?autocomplete="bday"[\s\S]*?required/,
  /data: \{ nombre, apellidos, fecha_nacimiento: fechaNacimiento \}/,
  /get_my_welcome_companion_bonus/,
  /complete_my_welcome_companion_profile/,
  /userWelcomeCompanionModality/,
  /p_use_welcome_companion: !isAdmin && esGratuita/,
  /p_use_welcome_companion: false/,
  /id="oferta-activa-banner"/,
  /await Promise\.resolve\(switchPublicView\('horarios'\)\)/,
]) {
  assert.match(profile, requiredPattern);
}

const cardStart = profile.indexOf('const companionWelcomeBlock =');
const cardEnd = profile.indexOf('profileWrapper.innerHTML =', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart, 'No se encontró la tarjeta de bienvenida');
const welcomeCard = profile.slice(cardStart, cardEnd);
assert.doesNotMatch(
  welcomeCard,
  /\b\d{1,3}\s*[-–]\s*\d{1,3}\s*años\b|\(\s*\d{1,3}\s*años\s*\)|\b\d{1,3}_anos\b/i,
  'La tarjeta no debe revelar tramos demográficos',
);

for (const requiredPattern of [
  /'es_gratuita'/,
  /'companion_modality'/,
  /companionModality: normalizeCompanionModality\(raw\?\.companion_modality\)/,
  /item\.companionModality !== ofKey/,
  /oferta: item\.companionModality/,
]) {
  assert.match(calendar, requiredPattern);
}
assert.doesNotMatch(calendar, /badge: '🎁 Gratuita'|hint: 'Reservar gratis'/);
assert.doesNotMatch(
  calendar,
  /\['(?:pni|psicologia)'[^\]]*\]\.includes\((?:ofertaParam|ofKey)\)/,
  'La oferta de compañía no debe introducir rutas de consultas ajenas',
);

const targetResolver = calendar.slice(
  calendar.indexOf('async function resolveTargetIfNeeded()'),
  calendar.indexOf('function updateUrl(', calendar.indexOf('async function resolveTargetIfNeeded()')),
);
assert.match(
  targetResolver,
  /state\.mode === 'talleres' \|\| state\.teacher \|\| state\.style \|\| state\.oferta/,
  'Un enlace de modalidad debe buscar la siguiente semana que tenga una sesión coincidente',
);

const urlHelpers = calendar.slice(
  calendar.indexOf('function updateUrl('),
  calendar.indexOf('function startPolling(', calendar.indexOf('function updateUrl(')),
);
assert.match(urlHelpers, /searchParams\.set\('oferta', state\.oferta\)/);
assert.match(urlHelpers, /'oferta', 'promo', 'filter', 'filtro'/);

const modeToggleBlock = calendar.slice(
  calendar.indexOf("const modeToggle = document.getElementById('calendar-mode-toggle')"),
  calendar.indexOf("el.styleFilters.addEventListener('click'", calendar.indexOf("const modeToggle = document.getElementById('calendar-mode-toggle')")),
);
assert.match(modeToggleBlock, /state\.oferta = ''/);
assert.match(modeToggleBlock, /updateUrl\('replace'\)/);

for (const requiredPattern of [
  /create table if not exists private\.welcome_companion_age_rules/,
  /\('colegas', 0, 24, 1\)/,
  /\('pareja', 25, 44, 2\)/,
  /\('hijo', 45, 64, 3\)/,
  /\('abuela', 65, 130, 4\)/,
  /create table if not exists private\.welcome_companion_bonuses/,
  /alter table private\.welcome_companion_bonuses enable row level security/,
  /add column if not exists companion_modality text/,
  /add column if not exists welcome_companion_modality text/,
  /drop trigger if exists on_auth_user_created on auth\.users/,
  /before insert or update of identity_data on auth\.identities/,
  /new\.identity_data :=[\s\S]*?- 'fecha_nacimiento'/,
  /create or replace function public\.get_my_welcome_companion_bonus/,
  /create or replace function public\.complete_my_welcome_companion_profile/,
  /p_use_welcome_companion boolean/,
  /companion_modality = v_class_companion_modality[\s\S]*?credits_remaining >= 1/,
  /p_use_welcome_companion is null[\s\S]*?v_marked_free/,
  /update private\.welcome_companion_bonuses[\s\S]*?where profile_id = v_target_id/,
  /returns table \([\s\S]*?es_gratuita boolean,[\s\S]*?companion_modality text/,
]) {
  assert.match(migration, requiredPattern);
}

const helperMatch = profile.match(
  /function getClaseCompanionModality\(clase\) \{[\s\S]*?function esClaseReservablePorOferta\(clase, tipo\) \{[\s\S]*?\n\}/,
);
assert.ok(helperMatch, 'No se pudo extraer la lógica real de modalidades');
const sandbox = {
  normalizeCompanionModality(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return modalities.some(([code]) => code === normalized) ? normalized : '';
  },
  toSafeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  },
  getHoursUntilClass: () => 72,
  getPolicyHours: () => 12,
};
vm.createContext(sandbox);
new vm.Script(`
let userSaldoClasesGratis = 1;
let userWelcomeCompanionModality = '';
${helperMatch[0]}
this.offerApi = {
  esClaseElegibleBonoGratis,
  esClaseModalidadCompania,
  esClaseReservablePorOferta,
  setUser(modality, credits) {
    userWelcomeCompanionModality = modality;
    userSaldoClasesGratis = credits;
  }
};
`, { filename: 'profile-companion-helpers.js' }).runInContext(sandbox);

const makeClass = modality => ({
  companion_modality: modality,
  activa: true,
  capacidad_max: 10,
  ocupadas: 0,
  fecha_inicio: '2026-10-01T10:00:00.000Z',
  miReserva: null,
});

for (const [userModality] of modalities) {
  sandbox.offerApi.setUser(userModality, 1);
  for (const [classModality] of modalities) {
    const target = makeClass(classModality);
    assert.equal(
      sandbox.offerApi.esClaseElegibleBonoGratis(target),
      userModality === classModality,
      `Solo la diagonal ${userModality}/${classModality} puede ser gratuita`,
    );
    assert.equal(
      sandbox.offerApi.esClaseReservablePorOferta(target, userModality),
      userModality === classModality,
      'El filtro debe comparar la modalidad exacta',
    );
  }
}

sandbox.offerApi.setUser('colegas', 0);
for (const [classModality] of modalities) {
  assert.equal(
    sandbox.offerApi.esClaseElegibleBonoGratis(makeClass(classModality)),
    false,
    'Con saldo cero ninguna modalidad debe mostrarse gratuita',
  );
}

console.log('Welcome companion checks passed: four modalities, private age assignment, exact free booking and app sync are covered.');
