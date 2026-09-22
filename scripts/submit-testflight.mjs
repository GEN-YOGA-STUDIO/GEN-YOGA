import crypto from 'node:crypto';

// Automatiza el proceso post-TestFlight de App Store Connect:
//   1. Localiza la app por bundleId.
//   2. Reutiliza la versión editable existente o crea una nueva (versionString).
//   3. Espera a que el build (versionCode) termine de procesarse.
//   4. Asocia el build a la versión y rellena "Novedades" (whatsNew).
//   5. Envía la versión a revisión.
//
// Uso:
//   APP_STORE_CONNECT_P8="<contenido .p8>" node scripts/submit-testflight.mjs \
//     --version 13.13 --build 252 --whats-new "Correcciones y mejoras" [--platform IOS]
//
// La clave también puede venir del secreto APP_STORE_CONNECT_PRIVATE_KEY en CI.
const args = process.argv.slice(2);
const get = (name, def = null) => {
  const i = args.findIndex((a) => a === `--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const VERSION = get('version');
const BUILD = get('build');
const WHATS_NEW = get('whats-new', 'Correcciones y mejoras');
const PLATFORM = get('platform', 'IOS');
const BUNDLE_ID = get('bundle-id', 'com.genyoga.app');
const KEY_ID = process.env.APP_STORE_CONNECT_KEY_ID || 'W475U96PNK';
const ISSUER_ID = process.env.APP_STORE_CONNECT_ISSUER_ID || 'c8f0f943-872c-4153-b89a-86fb7cc78b8f';
const P8 = process.env.APP_STORE_CONNECT_P8 || process.env.APP_STORE_CONNECT_PRIVATE_KEY;

if (!VERSION || !BUILD) {
  console.error('\n❌ Uso: node scripts/submit-testflight.mjs --version <x.y> --build <n> [--whats-new "texto"]');
  process.exit(1);
}
if (!P8 || !P8.includes('BEGIN PRIVATE KEY')) {
  console.error('\n❌ Falta la clave .p8 en APP_STORE_CONNECT_P8 (o APP_STORE_CONNECT_PRIVATE_KEY).');
  process.exit(1);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwt(privateKey, keyId, issuerId) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: issuerId, iat: now - 60, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const data = Buffer.from(`${header}.${payload}`);
  // ES256 en JWT exige firma cruda R||S (ieee-p1363), NO DER.
  const keyObject = crypto.createPrivateKey({ key: privateKey.trim() + '\n', format: 'pem' });
  const signature = crypto
    .sign('SHA256', data, { key: keyObject, dsaEncoding: 'ieee-p1363' })
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${payload}.${signature}`;
}

async function api(method, path, body = null, token) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const details = json?.errors?.map((e) => `${e.code}: ${e.detail || e.title}`).join(' | ') || text.slice(0, 500);
    throw new Error(`API ${method} ${path} → ${res.status}: ${details}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let token = jwt(P8, KEY_ID, ISSUER_ID);
const auth = async (method, path, body = null) => {
  try {
    return await api(method, path, body, token);
  } catch (e) {
    if (String(e.message).includes('401')) {
      token = jwt(P8, KEY_ID, ISSUER_ID);
      return await api(method, path, body, token);
    }
    throw e;
  }
};

console.log(`\n🍎 Submit v${VERSION} (build ${BUILD}) a revisión — ${BUNDLE_ID}`);

// 1. App por bundleId
const apps = await auth('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
const app = apps?.data?.[0];
if (!app) throw new Error(`App con bundleId ${BUNDLE_ID} no encontrada en App Store Connect.`);
console.log(`  ✅ App: ${app.attributes?.name} (${app.id})`);

// 2. Versión editable existente o nueva
const versions = await auth('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=${PLATFORM}&limit=50`);
let version = (versions?.data || []).find((v) => v.attributes?.versionString === VERSION);
if (version) {
  console.log(`  ✅ Versión ${VERSION} ya existe (${version.id}, estado: ${version.attributes?.appStoreState})`);
} else {
  const create = () =>
    auth('POST', '/v1/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: { platform: PLATFORM, versionString: VERSION },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
  try {
    version = (await create()).data;
    console.log(`  ✅ Versión ${VERSION} creada (${version.id})`);
  } catch (e) {
    if (!String(e.message).includes('409')) throw e;
    // Solo cabe una versión editable: si la que ocupa el hueco está en
    // PREPARE (p. ej. una 13.13 que nunca se envió y Apple no deja borrar
    // porque ya tiene builds), se ABSORBE renombrándola a la objetivo.
    const stale = (versions?.data || []).find(
      (v) => v.attributes?.versionString !== VERSION && v.attributes?.appStoreState === 'PREPARE_FOR_SUBMISSION',
    );
    if (!stale) throw e;
    const patched = await auth('PATCH', `/v1/appStoreVersions/${stale.id}`, {
      data: { type: 'appStoreVersions', id: stale.id, attributes: { versionString: VERSION } },
    });
    version = patched.data;
    console.log(`  ♻️ Versión ${stale.attributes?.versionString} absorbida → ${VERSION} (${version.id})`);
  }
}

// 3. Esperar build procesado (hasta ~40 min)
// NOTA: /v1/apps/{id}/builds no admite filter ni sort → se filtra en cliente.
console.log(`  ⏳ Esperando build ${BUILD} procesado en TestFlight...`);
let build = null;
const deadline = Date.now() + 40 * 60 * 1000;
for (;;) {
  const builds = await auth('GET', `/v1/builds?filter[app]=${app.id}&limit=200`);
  const candidates = (builds?.data || []).filter((b) => String(b.attributes?.version) === String(BUILD));
  candidates.sort((a, b) => new Date(b.attributes?.uploadedDate) - new Date(a.attributes?.uploadedDate));
  build = candidates[0] || null;
  const state = build?.attributes?.processingState;
  if (build && (state === 'VALID' || state === 'INVALID')) break;
  if (Date.now() > deadline) throw new Error(`Build ${BUILD} no apareció/validó en 40 min (último estado: ${state || 'ausente'}).`);
  console.log(`     … estado: ${state || 'aún no subido'} (reintento en 60s)`);
  await sleep(60000);
}
if (build.attributes.processingState === 'INVALID') throw new Error(`Build ${BUILD} marcado INVALID por Apple; revisa Xcode/ resoluciones.`);
console.log(`  ✅ Build ${BUILD} VALID (${build.id})`);

// 4. Asociar build + whatsNew en cada locale
await auth('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
console.log('  ✅ Build asociado a la versión');
const locales = await auth('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
for (const loc of locales?.data || []) {
  await auth('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
    data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew: WHATS_NEW } },
  });
  console.log(`  ✅ Novedades en locale ${loc.attributes?.locale}`);
}

// 5. Enviar a revisión.
// Si la versión arrastra una submission previa atascada, Apple devuelve 403
// en el POST: hay que borrarla primero (GET relationship → DELETE → POST).
async function trySubmit() {
  return await auth('POST', '/v1/appStoreVersionSubmissions', {
    data: { type: 'appStoreVersionSubmissions', relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } } },
  });
}

async function clearStaleSubmission() {
  try {
    const rel = await auth('GET', `/v1/appStoreVersions/${version.id}/relationships/appStoreVersionSubmission`);
    const staleId = rel?.data?.id;
    if (!staleId) return false;
    await auth('DELETE', `/v1/appStoreVersionSubmissions/${staleId}`);
    console.log(`  🧹 submission previa atascada eliminada (${staleId})`);
    return true;
  } catch (e) {
    console.log(`  ⚠️ no se pudo inspeccionar/limpiar submissions: ${String(e.message).slice(0, 140)}`);
    return false;
  }
}

let submission = null;
try {
  submission = await trySubmit();
} catch (e) {
  console.log(`  ⚠️ primer intento: ${String(e.message).slice(0, 160)}`);
  await clearStaleSubmission();
  await sleep(10000);
  submission = await trySubmit();
}
console.log(`  ✅ Enviada a revisión (submission ${submission?.data?.id})`);
console.log('\n🎉 La versión está en cola de revisión de Apple. Te avisarán por email.');
