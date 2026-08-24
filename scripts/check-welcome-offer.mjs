import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilePaths = [
  'profile.html',
  path.join('app android', 'www', 'profile.html'),
  path.join('app ios', 'www', 'profile.html'),
];
const profiles = await Promise.all(profilePaths.map((relativePath) => (
  readFile(path.join(root, relativePath), 'utf8')
)));
const profile = profiles[0];

assert.equal(profiles[1], profile, 'Android debe incluir el mismo flujo de ofertas que la web');
assert.equal(profiles[2], profile, 'iOS debe incluir el mismo flujo de ofertas que la web');

for (const requiredPattern of [
  /Yoga Madre e Hija · ¡Tu Oferta Gratuita Activa!/,
  /onclick="filtrarPorOferta\('madre_hija'\)"/,
  /Reservar mi Plaza Gratis/,
  /value="oferta_madre_hija"/,
  /value="gratis"/,
  /id="oferta-activa-banner"/,
  /async function filtrarPorOferta\(ofertaKey\)/,
  /await Promise\.resolve\(switchPublicView\('horarios'\)\)/,
  /document\.getElementById\('schedule-container'\)/,
  /const requestedOffer = urlParams\.get\('oferta'\) \|\| urlParams\.get\('promo'\)/,
  /\.eq\('tipo_clase', 'yoga'\)\s*\.eq\('activa', true\)/,
]) {
  assert.match(profile, requiredPattern);
}
assert.doesNotMatch(profile, /document\.getElementById\('public-horarios'\)/);

const cardStart = profile.indexOf('const freeBalancesCard =');
const cardEnd = profile.indexOf('profileWrapper.innerHTML =', cardStart);
assert.ok(cardStart >= 0 && cardEnd > cardStart, 'No se encontró la tarjeta del bono de bienvenida');
const welcomeCard = profile.slice(cardStart, cardEnd);
assert.doesNotMatch(
  welcomeCard,
  /(?:\b\d{1,3}\s*[-–]\s*\d{1,3}\s*años\b|\(\s*\d{1,3}\s*años\s*\)|\b\d{1,3}\s*años\s*[·|]|\bactivo\s*\d{1,3}\b|\b\d{1,3}_anos\b)/i,
  'La tarjeta pública no debe revelar edades ni segmentos demográficos',
);

const helperMatch = profile.match(
  /function normalizarTextoOferta\(value\) \{[\s\S]*?\n\}\n\nasync function cargarOcupacionClases/,
);
assert.ok(helperMatch, 'No se pudo extraer la lógica real de filtrado de ofertas');
const helperSource = helperMatch[0].replace(/\n\nasync function cargarOcupacionClases$/, '');
const sandbox = {
  toSafeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  },
};
sandbox.policyNow = Date.parse('2026-08-23T00:00:00.000Z');
sandbox.getHoursUntilClass = value => (Date.parse(value) - sandbox.policyNow) / 3_600_000;
sandbox.getPolicyHours = () => 12;
vm.createContext(sandbox);
new vm.Script(`
${helperSource}
this.offerApi = { esClaseOfertaMadreHija, esClaseElegibleBonoGratis, esClaseReservablePorOferta };
`, { filename: 'profile-offer-helpers.js' }).runInContext(sandbox);

const { esClaseOfertaMadreHija, esClaseElegibleBonoGratis, esClaseReservablePorOferta } = sandbox.offerApi;
const clase = ({
  teacher,
  start,
  name = 'Yoga para Todos',
  free = false,
  occupied = 0,
  capacity = 10,
  ownReservation = false,
  active = true,
}) => ({
  nombre: name,
  fecha_inicio: start,
  es_gratuita: free,
  ocupadas: occupied,
  capacidad_max: capacity,
  miReserva: ownReservation ? { id: 99 } : null,
  activa: active,
  profesionales: { nombre: teacher },
});

const angelMonday = clase({ teacher: 'Ángel Javier', start: '2026-08-24T14:15:00.000Z', free: true });
const angelWednesday = clase({ teacher: 'Angel Javier', start: '2026-08-26T14:15:00.000Z', free: false });
const yaniraWednesday = clase({ teacher: 'Yanira', start: '2026-08-26T06:00:00.000Z', name: 'Restaurativo y Suave', free: true });
const yaniraFriday = clase({ teacher: 'Yanira', start: '2026-08-28T06:00:00.000Z', name: 'Restaurativo y Suave', free: true });
const unrelatedFree = clase({ teacher: 'Yanira', start: '2026-08-25T17:00:00.000Z', name: 'Sesión Introductoria de Yoga', free: true });
const wrongAngelTime = clase({ teacher: 'Ángel Javier', start: '2026-08-24T17:45:00.000Z', free: true });

for (const target of [angelMonday, angelWednesday, yaniraWednesday, yaniraFriday]) {
  assert.equal(esClaseOfertaMadreHija(target), true, 'Cada franja exacta de Madre e Hija debe aparecer');
  assert.equal(esClaseReservablePorOferta(target, 'madre_hija'), true, 'Una franja con hueco debe ser reservable');
}
assert.equal(esClaseOfertaMadreHija(unrelatedFree), false, 'Una introductoria ajena no debe mezclarse con Madre e Hija');
assert.equal(esClaseOfertaMadreHija(wrongAngelTime), false, 'Una clase de Ángel en otra hora no debe mezclarse con la oferta');
assert.equal(esClaseElegibleBonoGratis(unrelatedFree), true, 'El filtro general sí debe conservar otras sesiones gratuitas');
assert.equal(
  esClaseReservablePorOferta({ ...angelMonday, ocupadas: 10 }, 'madre_hija'),
  false,
  'Una clase completa no debe ofrecerse como reservable',
);
assert.equal(
  esClaseReservablePorOferta({ ...angelMonday, ocupadas: 10, miReserva: { id: 7 } }, 'madre_hija'),
  true,
  'La reserva propia debe seguir visible aunque la clase esté completa',
);
assert.equal(
  esClaseReservablePorOferta({ ...angelMonday, activa: false }, 'madre_hija'),
  false,
  'Una clase desactivada nunca debe ofrecerse como reservable',
);
const policyNowBeforeDeadlineTest = sandbox.policyNow;
sandbox.policyNow = Date.parse(angelMonday.fecha_inicio) - (5 * 3_600_000);
assert.equal(
  esClaseReservablePorOferta(angelMonday, 'madre_hija'),
  false,
  'Una clase dentro del cierre de reservas no debe ofrecerse como reservable',
);
assert.equal(
  esClaseReservablePorOferta({ ...angelMonday, miReserva: { id: 8 } }, 'madre_hija'),
  true,
  'La reserva propia debe seguir visible después del cierre de nuevas reservas',
);
sandbox.policyNow = policyNowBeforeDeadlineTest;

console.log('Welcome offer checks passed: CTA navigation, exact Madrid slots, availability and privacy are covered.');
