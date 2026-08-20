import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

const [profileHtml, calendarJs, overlapMigration] = await Promise.all([
  read('profile.html'),
  read('public-calendar.js'),
  read('supabase/migrations/202609020030_enforce_teacher_and_studio_schedule_no_overlap.sql'),
]);

// 1. Verify overlap validation helper in profile.html
assert.match(profileHtml, /async function validateClassScheduleOverlap/);
assert.match(profileHtml, /same_batch_teacher/);
assert.match(profileHtml, /same_batch_studio/);
assert.match(profileHtml, /teacher_conflict/);
assert.match(profileHtml, /studio_conflict/);

// 2. Verify all creation handlers call validateClassScheduleOverlap
assert.match(profileHtml, /form-crear-clase[\s\S]*?validateClassScheduleOverlap\(inserts\)/);
assert.match(profileHtml, /guardarConsultaAdmin[\s\S]*?validateClassScheduleOverlap\(inserts\)/);
assert.match(profileHtml, /guardarTallerAdmin[\s\S]*?validateClassScheduleOverlap\(inserts\)/);

// 3. Verify public-calendar.js filters out consultation slots when teacher has a class
assert.match(calendarJs, /hasTeacherClassOverlap/);
assert.match(calendarJs, /c\.professor\.id !== prof\.id/);

// 4. Verify database trigger migration
assert.match(overlapMigration, /create or replace function public\.check_clases_schedule_no_overlap/);
assert.match(overlapMigration, /create trigger trg_check_clases_schedule_no_overlap/);
assert.match(overlapMigration, /Conflicto de horario/);
assert.match(overlapMigration, /Conflicto de sala en el estudio/);

// 5. Functional logic test on overlap algorithm
function isOverlapping(startA, endA, startB, endB) {
  return (new Date(startA) < new Date(endB) && new Date(endA) > new Date(startB));
}

assert.equal(isOverlapping('2026-09-08T18:00:00Z', '2026-09-08T19:30:00Z', '2026-09-08T18:30:00Z', '2026-09-08T19:30:00Z'), true);
assert.equal(isOverlapping('2026-09-08T18:00:00Z', '2026-09-08T19:30:00Z', '2026-09-08T19:30:00Z', '2026-09-08T20:30:00Z'), false);
assert.equal(isOverlapping('2026-09-08T18:00:00Z', '2026-09-08T19:30:00Z', '2026-09-08T17:00:00Z', '2026-09-08T18:00:00Z'), false);
assert.equal(isOverlapping('2026-09-08T18:00:00Z', '2026-09-08T19:30:00Z', '2026-09-08T17:30:00Z', '2026-09-08T18:30:00Z'), true);

console.log('Schedule overlap checks passed.');
