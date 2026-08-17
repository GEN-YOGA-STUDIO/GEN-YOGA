import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const teacherProfiles = require(path.join(root, 'teacher-profiles.js'));

const { descriptions, getEnglishProfile, repairLegacyDescription } = teacherProfiles;
const angel = descriptions.angel;
const silvia = descriptions.silvia;

assert.match(angel, /LUGAR DE NACIMIENTO: La Roda \(Albacete\)/);
assert.doesNotMatch(angel, /\bNinguna\b/i);
assert.match(angel, /TITULACIONES:\nBaso mi aprendizaje/);
assert.match(angel, /Además, estoy cursando una mentoría para la certificación como profesor de yoga Iyengar\./);
assert.doesNotMatch(angel, /\bseptiembre\b/i);

for (const invalidCopy of [
  /personal Y/,
  /sistema nervous/i,
  /ventorías/i,
  /Yoga Center\./i,
  /^[\t ]*[*•][\t ]+/m,
]) {
  assert.doesNotMatch(silvia, invalidCopy);
}
assert.match(silvia, /práctica personal y terapeuta Ayurveda/);
assert.match(silvia, /sistema nervioso/);
assert.match(silvia, /adaptando la práctica a las necesidades individuales de cada persona\./);

for (const area of [
  'Dolor de espalda',
  'Lesiones musculoesqueléticas',
  'Estrés, ansiedad',
  'Alteraciones del sueño',
  'Regulación del sistema nervioso',
  'Procesos de duelo',
  'Menopausia',
  'Fatiga',
  'Mejora de la movilidad',
]) {
  assert.ok(silvia.includes(area), `Falta el área completa de Silvia: ${area}`);
}

const repairedAngel = repairLegacyDescription({
  nombre: 'Ángel Javier',
  especialidad: 'Yoga para hombres & Yoga terapéutico | clases',
  descripcion: 'LUGAR DE NACIMIENTO: La Roda\nTITULACIONES:\nNinguna. Baso mi aprendizaje en la práctica.'
});
assert.equal(repairedAngel.descripcion, angel);
assert.equal(repairedAngel.especialidad, 'Yoga para hombres & Yoga para Todos | clases');

const repairedSilvia = repairLegacyDescription({
  nombre: 'Silvia',
  descripcion: 'SOBRE MI:\n30 años de práctica personal Y Terapeuta Ayurveda.\nTE ACOMPAÑO:\nsistema nervous'
});
assert.equal(repairedSilvia.descripcion, silvia);

const angelEnglish = getEnglishProfile({ nombre: 'Ángel Javier' });
assert.match(angelEnglish.descripcion, /La Roda \(Albacete\)/);
assert.doesNotMatch(angelEnglish.descripcion, /\bNone\b/);
assert.doesNotMatch(angelEnglish.descripcion, /\bSeptember\b/);
assert.match(angelEnglish.descripcion, /I SUPPORT YOU:/);
assert.equal(angelEnglish.especialidad, 'Yoga for Men & Yoga for Everyone | classes');

const miriamEnglish = getEnglishProfile({ email: 'miriam_profesora@genyoga.studio' });
assert.match(miriamEnglish.descripcion, /self-awareness/);
assert.doesNotMatch(miriamEnglish.descripcion, /autoconcern/);

const [maestros, profile, migration] = await Promise.all([
  readFile(path.join(root, 'maestros.html'), 'utf8'),
  readFile(path.join(root, 'profile.html'), 'utf8'),
  readFile(path.join(root, 'supabase', 'migrations', '202608030001_angel_profile_schedule_6_8.sql'), 'utf8'),
]);

for (const page of [maestros, profile]) {
  assert.match(page, /teacher-profiles\.js\?v=6\.24/);
}

assert.doesNotMatch(maestros, /summarizeModalText|summarizeModalItems|moreAreas|moreQualifications/);
assert.doesNotMatch(maestros, /\+\$\{remaining\}|visible\.join\(['"] · ['"]\)/);
assert.match(maestros, /entries\.map\(item => `<p class="teacher-modal__section-text">/);
const galleryRenderer = maestros.match(/function renderProfesionalesLanding[\s\S]*?function parseBio/)?.[0] || '';
assert.doesNotMatch(galleryRenderer, /renderTeacherClassLinks\(prof,\s*['"]card['"]\)/);
assert.match(maestros, /renderTeacherClassLinks\(prof,\s*['"]modal['"]\)/);
assert.match(maestros, /\.teachers-gallery__grid\s*\{[\s\S]*?align-items:\s*start;/);
assert.doesNotMatch(maestros, /\.teachers-gallery__grid--4\s*\{[\s\S]*?align-items:\s*flex-end;/);
assert.match(maestros, /\.teacher-modal__section-title\s*\{[\s\S]*?font-family:\s*['"]Ubuntu['"][\s\S]*?font-weight:\s*700;/);
assert.match(maestros, /\.teacher-modal__section-text\s*\{[\s\S]*?font-family:\s*['"]Montserrat Arabic['"][\s\S]*?font-weight:\s*300;/);
assert.match(maestros, /id:\s*['"]isabel-local['"]/);
assert.match(maestros, /Psiconeuroinmunología Clínica \(PNI\) \| consultas/);
assert.match(maestros, /orderedKeys = \['angel', 'miriam', 'silvia', 'isabel', 'yanira'\]/);
assert.match(maestros, /identity\.includes\('isabel'\)/);

assert.doesNotMatch(profile, /function truncateTextProfile/);
assert.match(profile, /const bioText = parsed\.sobreMi\[0\]/);
assert.match(profile, /parsed\.titulos\.map\(t => `<p>\$\{escapeHtml\(t\)\}<\/p>`\)/);
assert.match(profile, /\(\?:\^\|\\n\)\\s\*\(LUGAR DE NACIMIENTO/);

for (const expected of [
  'La Roda (Albacete)',
  'Yoga para hombres & Yoga para Todos',
  'Además, estoy cursando una mentoría para la certificación como profesor de yoga Iyengar.',
  "set nombre = 'Yoga para Todos'",
  'extract(isodow from c.fecha_inicio at time zone \'Europe/Madrid\') = 5',
]) {
  assert.ok(migration.includes(expected), `La migración no contiene: ${expected}`);
}

console.log('Teacher profile checks passed for Ángel Javier, Silvia, Miriam, Isabel and Yanira.');
