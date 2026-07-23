import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(sourceRoot, '..');
const targetRoot = path.resolve(workspaceRoot, 'subir cert');
const expectedTarget = path.join(workspaceRoot, 'subir cert');
const productionProjectId = 'jkjifmrrlyncuwpjhxvk';
const productionUrl = `https://${productionProjectId}.supabase.co`;
const productionPublishableKey = 'sb_publishable_xnIELom1ouXaBDJNYaWDAQ_VJNjlnIK';
const version = '6.6';

function requireVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} es obligatoria para construir certificación.`);
  return value;
}

function validateCertificationConfig() {
  const supabaseUrl = requireVariable('CERT_SUPABASE_URL');
  const publishableKey = requireVariable('CERT_SUPABASE_PUBLISHABLE_KEY');
  let parsed;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new Error('CERT_SUPABASE_URL no es una URL válida.');
  }

  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== '/'
    || !/^[a-z0-9]{20}\.supabase\.co$/.test(parsed.hostname)
  ) {
    throw new Error('CERT_SUPABASE_URL debe ser la URL HTTPS raíz de un proyecto Supabase.');
  }
  if (parsed.hostname.split('.')[0] === productionProjectId) {
    throw new Error('Certificación no puede utilizar el proyecto Supabase de producción.');
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)) {
    throw new Error('CERT_SUPABASE_PUBLISHABLE_KEY no tiene formato de clave pública de Supabase.');
  }

  return { supabaseUrl: parsed.origin, publishableKey };
}

function assertSafeTarget() {
  if (targetRoot !== expectedTarget || path.basename(targetRoot) !== 'subir cert') {
    throw new Error(`Destino de certificación inesperado: ${targetRoot}`);
  }
  if (path.dirname(targetRoot) !== workspaceRoot || targetRoot === sourceRoot) {
    throw new Error('El destino de certificación no está aislado del código fuente.');
  }
}

const htmlFiles = [
  'cancel.html',
  'clases.html',
  'index.html',
  'maestros.html',
  'politica-privacidad.html',
  'profile.html',
  'success.html',
  'tarifas.html',
];
const staticFiles = [
  'tailwind-compiled.css',
];
const staticDirectories = ['fonts', 'img'];

const certification = validateCertificationConfig();
assertSafeTarget();
const validateOnly = process.env.CERT_BUILD_VALIDATE_ONLY === '1';

const transformedHtml = new Map();
for (const fileName of htmlFiles) {
  const source = await readFile(path.join(sourceRoot, fileName), 'utf8');
  let transformed = source
    .replaceAll(productionUrl, certification.supabaseUrl)
    .replaceAll(productionPublishableKey, certification.publishableKey);

  const robotsMeta = '<meta name="robots" content="noindex,nofollow">';
  if (/<meta\s+name=["']robots["'][^>]*>/i.test(transformed)) {
    transformed = transformed.replace(/<meta\s+name=["']robots["'][^>]*>/i, robotsMeta);
  } else {
    transformed = transformed.replace(
      /(<meta\s+name=["']application-version["']\s+content=["']6\.6["']\s*\/?>)/i,
      `$1\n    ${robotsMeta}`,
    );
  }
  if (!transformed.includes(robotsMeta)) {
    throw new Error(`${fileName} no se pudo marcar como no indexable en certificación.`);
  }
  if (transformed.includes(productionUrl) || transformed.includes(productionPublishableKey)) {
    throw new Error(`${fileName} conserva configuración de producción.`);
  }
  const embeddedSupabaseOrigins = [...transformed.matchAll(/https:\/\/[a-z0-9.-]+\.supabase\.co/gi)]
    .map((match) => match[0].toLowerCase());
  if (embeddedSupabaseOrigins.some((origin) => origin !== certification.supabaseUrl.toLowerCase())) {
    throw new Error(`${fileName} contiene un proyecto Supabase ajeno a certificación.`);
  }
  const embeddedPublishableKeys = [...transformed.matchAll(/sb_publishable_[A-Za-z0-9_-]{20,}/g)]
    .map((match) => match[0]);
  if (embeddedPublishableKeys.some((key) => key !== certification.publishableKey)) {
    throw new Error(`${fileName} contiene una clave pública ajena a certificación.`);
  }
  if (
    !transformed.includes(`v${version}`)
    && !transformed.includes(`v=${version}`)
    && !transformed.includes(`APP_VERSION = '${version}'`)
  ) {
    throw new Error(`${fileName} no identifica la versión ${version}.`);
  }
  transformedHtml.set(fileName, transformed);
}

if (validateOnly) {
  console.log(`Configuración de certificación ${version} validada; no se han escrito archivos.`);
} else {
  // The target is an exact generated artifact. Its identity is validated above
  // before removing the previous build, so legacy files cannot leak into a deploy.
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  for (const [fileName, source] of transformedHtml) {
    await writeFile(path.join(targetRoot, fileName), source, 'utf8');
  }
  for (const fileName of staticFiles) {
    await cp(path.join(sourceRoot, fileName), path.join(targetRoot, fileName));
  }
  for (const directory of staticDirectories) {
    await cp(path.join(sourceRoot, directory), path.join(targetRoot, directory), { recursive: true });
  }

  const manifest = {
    app: 'GEN Yoga',
    version,
    environment: 'certification',
    generatedAt: new Date().toISOString(),
    supabaseOrigin: certification.supabaseUrl,
    livePaymentsEnabled: false,
  };
  await writeFile(
    path.join(targetRoot, 'certification-build.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log(`Certificación ${version} generada de forma aislada en ${targetRoot}`);
}
