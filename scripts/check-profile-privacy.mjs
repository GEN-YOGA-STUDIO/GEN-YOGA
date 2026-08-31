import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260824090616_move_profile_demographics_private.sql',
);

const publicClientFiles = [
  'clases.html',
  'maestros.html',
  'profile.html',
  path.join('app android', 'www', 'profile.html'),
  path.join('app ios', 'www', 'profile.html'),
  'public-calendar.js',
  'tarifas.html',
];

for (const relativePath of publicClientFiles) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  const privacySource = relativePath.endsWith('profile.html')
    ? source
      .replace(/fecha_nacimiento: fechaNacimiento/g, '')
      .replace(/p_birth_date: result\.value/g, '')
    : source;
  assert.doesNotMatch(
    privacySource,
    /\b(?:fecha_nacimiento|birth_date|date_of_birth|rango_edad|age_range|edad_min|edad_max|sexo)\b/i,
    `${relativePath} no debe consultar ni renderizar demografía interna de perfiles`,
  );
}

for (const profilePath of [
  'profile.html',
  path.join('app android', 'www', 'profile.html'),
  path.join('app ios', 'www', 'profile.html'),
]) {
  const source = await readFile(path.join(root, profilePath), 'utf8');
  assert.match(source, /id="reg-fecha-nacimiento"[\s\S]*?autocomplete="bday"/);
  assert.match(source, /fecha_nacimiento: fechaNacimiento/);
  assert.match(source, /complete_my_welcome_companion_profile[\s\S]*?p_birth_date: result\.value/);
  assert.doesNotMatch(source, /\.select\([^)]*fecha_nacimiento/i);
}

const migration = await readFile(migrationPath, 'utf8');

for (const requiredPattern of [
  /create table private\.profile_demographics/i,
  /from public\.profiles[\s\S]*?insert into private\.profile_demographics/i,
  /left join auth\.users[\s\S]*?raw_user_meta_data[\s\S]*?fecha_nacimiento/i,
  /from auth\.identities[\s\S]*?identity_data[\s\S]*?fecha_nacimiento/i,
  /update auth\.users[\s\S]*?raw_user_meta_data[\s\S]*?- 'fecha_nacimiento'/i,
  /update auth\.identities[\s\S]*?identity_data[\s\S]*?- 'fecha_nacimiento'/i,
  /alter table private\.profile_demographics enable row level security/i,
  /revoke all on table private\.profile_demographics[\s\S]*?from public, anon, authenticated/i,
  /grant select, insert, update, delete on table private\.profile_demographics[\s\S]*?to service_role/i,
  /alter table public\.profiles[\s\S]*?drop column fecha_nacimiento[\s\S]*?drop column sexo/i,
  /admin_actualizar_fecha_nacimiento_usuario[\s\S]*?insert into private\.profile_demographics/i,
]) {
  assert.match(migration, requiredPattern);
}

const publicRankingView = migration.match(
  /create view public\.view_profile_ranking[\s\S]*?from public\.profiles as profile\s*;/i,
)?.[0] || '';

assert.ok(publicRankingView, 'La migración debe reconstruir la vista de ranking');
assert.doesNotMatch(publicRankingView, /\bfecha_nacimiento\b/i);
assert.doesNotMatch(publicRankingView, /\bsexo\b/i);
assert.match(
  migration,
  /revoke all on table public\.view_profile_ranking[\s\S]*?from public, anon, authenticated, service_role/i,
);
assert.match(
  migration,
  /grant select on table public\.view_profile_ranking[\s\S]*?to authenticated, service_role/i,
);

for (const profilePath of [
  'profile.html',
  path.join('app android', 'www', 'profile.html'),
  path.join('app ios', 'www', 'profile.html'),
]) {
  const profilePage = await readFile(path.join(root, profilePath), 'utf8');
  assert.doesNotMatch(
    profilePage,
    /from\('profiles'\)\s*\.select\('\*'\)/i,
    `${profilePath} no debe solicitar filas completas de profiles`,
  );
  assert.match(profilePage, /\.select\(ADMIN_PROFILE_FIELDS\)/);
  assert.match(profilePage, /\.select\('id, email, rol, nombre, apellidos'\)/);
}

console.log('Profile privacy checks passed: demographic data stays outside the public client and Data API profile row.');
