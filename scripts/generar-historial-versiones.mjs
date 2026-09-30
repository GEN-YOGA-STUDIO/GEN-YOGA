import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = process.argv[2] || "HISTORIAL_VERSIONES.html";

const run = (cmd) =>
  execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });

/* ---------------------------------------------------------------- 1. datos */
const raw = run(
  'git log --all --reverse --date=short --pretty=format:"%x1e%H%x1f%ad%x1f%s%x1f%b"'
);
const commits = raw
  .split("\u001e")
  .filter((s) => s.trim())
  .map((chunk) => {
    const [hash, date, subject, body] = chunk.split("\u001f");
    return {
      hash,
      date,
      subject: (subject || "").replace(/\\n/g, " ").trim(),
      body: (body || "").trim(),
      ts: Date.parse(date + "T00:00:00"),
    };
  });

const pkgRaw = run(
  'git log --all --reverse -p --pretty=format:"@@@%H" -- package.json'
);
const pkgVer = new Map();
let curHash = null;
for (const line of pkgRaw.split("\n")) {
  if (line.startsWith("@@@")) { curHash = line.slice(3).trim(); continue; }
  const m = line.match(/^\+\s*"version":\s*"([^"]+)"/);
  if (m && curHash && !pkgVer.has(curHash)) pkgVer.set(curHash, m[1]);
}

const filesRaw = run(
  'git log --all --reverse --name-only --pretty=format:"@@@%H"'
);
const filesMap = new Map();
curHash = null;
for (const line of filesRaw.split("\n")) {
  if (line.startsWith("@@@")) {
    curHash = line.slice(3).trim();
    filesMap.set(curHash, []);
    continue;
  }
  if (line.trim() && curHash) filesMap.get(curHash).push(line.trim());
}

/* ------------------------------------------------------- 2. detección */
const TOKEN_RE = /(?<![\d.])(v)?(\d{1,2})\.(\d{1,2})(?:\.(\d{1,3}))?(?![\d.])/gi;
const CTX_OK =
  /(?:^|[\s(\[,:|])(?:v|version\s+|versi[oó]n\s+|to\s+|a\s+|bump\w*(?:\s+\w+){0,3}\s+to\s+|release\s+(?:version\s+)?|sincronizar\s+|actualizar\w*\s+a\s+)$/i;

function detectTokens(text) {
  const out = [];
  if (!text) return out;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const hasV = !!m[1];
    const pre = text.slice(0, m.index);
    const atStart = pre.trim().length === 0;
    if (!hasV && !atStart && !CTX_OK.test(pre)) continue;
    out.push({ major: parseInt(m[2], 10), minor: parseInt(m[3], 10) });
  }
  return out;
}

const stripTrailers = (b) =>
  (b || "")
    .split("\n")
    .filter(
      (l) =>
        !/^(Co-authored-by|Co-Authored-By|Generated with|Signed-off-by)/i.test(
          l.trim()
        )
    )
    .join("\n")
    .trim();

/* --------------------------------------------------------- 3. asignación */
let era = 1;
const maxMinorByMajor = {};
const work = commits.map((c) => {
  let det = null;
  let src = null;
  let all = [];

  if (c.subject === "Initial commit") {
    det = null;
  } else {
    const fromSubj = detectTokens(c.subject);
    if (fromSubj.length) {
      all = fromSubj;
      det = fromSubj[fromSubj.length - 1];
      src = "asunto";
    } else {
      const fromBody = detectTokens(stripTrailers(c.body));
      const ok = fromBody.filter((t) => Math.abs(t.major - era) <= 2);
      if (ok.length) {
        all = ok;
        det = ok[ok.length - 1];
        src = "detalle";
      } else {
        const pv = pkgVer.get(c.hash);
        if (pv) {
          const pm = pv.match(/^(\d{1,2})\.(\d{1,2})/);
          if (pm) {
            const major = parseInt(pm[1], 10);
            const minor = parseInt(pm[2], 10);
            const curMax = maxMinorByMajor[major];
            if (
              Math.abs(major - era) <= 2 &&
              (major !== era || curMax === undefined || minor >= curMax)
            ) {
              det = { major, minor };
              src = "package.json";
              all = [det];
            }
          }
        }
      }
    }
  }

  if (det) {
    era = det.major;
    if (
      maxMinorByMajor[det.major] === undefined ||
      det.minor > maxMinorByMajor[det.major]
    )
      maxMinorByMajor[det.major] = det.minor;
  }
  return { ...c, det, src, all, internal: /^Agent host session/.test(c.subject) };
});

const distBack = (arr, i) => {
  for (let j = i - 1; j >= 0; j--)
    if (arr[j].det) return Math.abs(arr[i].ts - arr[j].ts);
  return 1e15;
};
const distFwd = (arr, i) => {
  for (let j = i + 1; j < arr.length; j++)
    if (arr[j].det) return Math.abs(arr[j].ts - arr[i].ts);
  return 1e15;
};

for (let i = 0; i < work.length; i++) {
  if (work[i].det) continue;
  let back = null, fwd = null;
  for (let j = i - 1; j >= 0; j--) if (work[j].det) { back = work[j]; break; }
  for (let j = i + 1; j < work.length; j++) if (work[j].det) { fwd = work[j]; break; }
  let major = null;
  if (back && fwd) major = distBack(work, i) <= distFwd(work, i) ? back.det.major : fwd.det.major;
  else if (back) major = back.det.major;
  else if (fwd) major = fwd.det.major;
  work[i].eraMajor = major;
}

/* ----------------------------------------------------------- 4. duplicados */
const seen = new Map();
const items = [];
for (const c of work) {
  const key = c.date + "|" + c.subject;
  if (seen.has(key)) { items[seen.get(key)].dup++; continue; }
  seen.set(key, items.length);
  items.push({ ...c, dup: 1 });
}

/* --------------------------------------------------------- 5. agrupación */
// evidencia de versiones vistas en package.json (aunque el commit no lleve etiqueta)
const pkgEvidence = new Map();
for (const [, v] of pkgVer) {
  const m = v.match(/^(\d{1,2})\.(\d{1,2})/);
  if (!m) continue;
  const maj = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!pkgEvidence.has(maj)) pkgEvidence.set(maj, new Set());
  pkgEvidence.get(maj).add(min);
}

const lastMinorByMajor = {};
const majors = new Map();
for (const it of items) {
  let major, minor;
  if (it.det) {
    major = it.det.major;
    minor = it.det.minor;
    lastMinorByMajor[major] = minor;
  } else {
    major = it.eraMajor || era;
    minor = lastMinorByMajor[major];
  }
  if (!majors.has(major))
    majors.set(major, { groups: new Map(), internal: [], dates: [], verSet: new Set() });
  const M = majors.get(major);
  M.dates.push(it.date);
  for (const t of it.all || []) M.verSet.add(t.minor);
  if (it.det) M.verSet.add(it.det.minor);
  if (it.internal) { M.internal.push(it); continue; }
  const gk = minor === undefined || minor === null ? "__genesis" : minor;
  if (!M.groups.has(gk)) M.groups.set(gk, []);
  M.groups.get(gk).push(it);
}

// versiones que solo aparecen en package.json cuentan como registradas
for (const [maj, mins] of pkgEvidence) {
  if (!majors.has(maj)) continue;
  for (const n of mins) majors.get(maj).verSet.add(n);
}

// todas las etapas v1..v17 deben existir, aunque no tengan ni un commit
for (let m = 1; m <= 17; m++) {
  if (!majors.has(m))
    majors.set(m, { groups: new Map(), internal: [], dates: [], verSet: new Set() });
}

/* ------------------------------------------------- 6. resúmenes y evidencias */
const INFO = {
  1: ["Primeros pasos de la web", "Nace la web con un único <code>index.html</code> de 674 líneas (23 dic 2025) y una treintena de iteraciones numeradas. Los mensajes de commit son solo el número de versión, así que para saber qué cambió en cada una hay que mirar los ficheros tocados: aparecen desplegados en cada línea."],
  2: ["Consolidación y dominio propio", "De v2.1.0 a v2.10.0 (ene–may 2026). Etapa de crecimiento de contenido y maquetación, creación del <code>CNAME</code> para apuntar la web a un dominio propio y entregas numeradas."],
  3: ["Reorganización del proyecto", "Solo dos etiquetas reales: <b>v3.6.4</b> (17 mar 2026, probablemente mal etiquetada: ese mismo día también se registró v2.6.4) y <b>3.7</b> (16 jun 2026, rama <code>develop</code>: «inicializar proyecto y subir archivos de la web»)."],
  4: ["Proyecto npm y Stripe en producción", "Aparece <code>package.json</code> (v4.3, 6 jul 2026) y se conecta Stripe Checkout en modo producción (20 jul): llamadas a Checkout, verificación segura del retorno, página de cancelación y acceso persistente al portal de facturación."],
  5: ["Sin ningún registro", "No existe ni un commit, migración ni fichero con la etiqueta v5 en todo el repositorio. Corresponde al hueco entre v4.3 (6 jul 2026) y v6.3 (21 jul 2026)."],
  6: ["La gran etapa multiplataforma", "De v6.3 a v6.53 (21 jul – 20 ago 2026): Stripe en producción, apps iOS/Android con Capacitor y sus flujos de despliegue automático, consultas de psicología/nutrición/ayurveda, alta de profesionales, catálogo de clases, fotos del profesorado y sincronización web ↔ apps."],
  7: ["Calidad, reservas y calendario", "De v7.0 a v7.51 (20–25 ago 2026): SEO y tarjetas sociales, suites de QA (de 39 a 51 checks), sistema de reservas multiplaza «Yoga en Compañía», días festivos, borrado con reembolso, calendario global semanal y unificación visual de toda la app."],
  8: ["Sin commits, pero con trabajo hecho", "No hay ningún commit con etiqueta v8. Existen, sí, migraciones con sufijo <code>_v87</code>, <code>_v88</code>, <code>_v89</code>, <code>_v810</code>, <code>_v814</code>, <code>_v819</code> y <code>_v834</code> (v8.7 → v8.34), lo que prueba que esa etapa se trabajó y luego quedó consolidada en el «Initial commit» del 31 ago 2026."],
  9: ["Reinicio del repositorio", "El 31 ago 2026 el histórico se vuelve a crear (<i>Initial commit</i>) y se pierde el detalle de v7.52–v9.8. A partir de ahí, de v9.9 a v9.52 (31 ago – 2 sep): bonos y saldos, «Yoga en Compañía», notas de mostrador, kiosco, consumo atómico de bonos y reservas de sesiones introductorias."],
  10: ["Bonos por canjeo de ofertas", "De v10.0 a v10.19 (2–3 sep 2026): nuevo sistema de bonos por canjeo voluntario de ofertas con perfil inicial vacío y protección anti-abuso, consultas de ayurveda de Silvia Jaén, calendarios mensuales de consultas y talleres, y estados discretos en el calendario público."],
  11: ["Bono de bienvenida universal", "De v11.0 a v11.12 (3 sep 2026): el bono de bienvenida se universaliza a clases regulares, se inactiva «Yoga en Compañía», aparece el flash de bienvenida y se prodiga una racha de arreglos sobre la RPC <code>reservar_con_bono</code>."],
  12: ["Eventos, talleres y códigos promocionales", "De v12.0 a v12.20 (3–8 sep 2026): eventos con clases especiales y talleres, reprogramación universal, gestión de códigos promocionales GENYOGA, bonos por meses, gestión de psicología/nutrición e integración estricta de las consultas con catálogo y Stripe."],
  13: ["Acceso, apps nativas y perfiles", "De v13.0 a v13.13 (9–22 sep 2026): recuperación de contraseña por email o móvil, pipeline agéntico (agent-ship + AI_WORKFLOW), Notch Shield y ajustes de cabecera en apps nativas, fusión de perfiles duplicados, análisis de duplicados y App Links/Universal Links."],
  14: ["Release gemela de apps", "v14.0 (22 sep 2026): build 253 de Android e iOS apuntando a <code>gen.yoga.app</code> para conservar el historial en Play Store, con distribución automática de AAB."],
  15: ["Informe de marketing", "v15.0 y v15.1 (22 sep 2026): informe de marketing en Excel/PDF dentro del dashboard de administración, verificado cifra a cifra contra Supabase (retención, funnel, ingresos), con horarios en Europe/Madrid y un bloque nuevo de checks de pre-subida."],
  16: ["Retirada de la promo y pulido", "De v16.0 a v16.3 (26–27 sep 2026): retirada de la promoción GENYOGA 50% para octubre, arreglo de la modal de portada (z-index), nuevos contenidos de Miriam (Yoga Alineación, grupos) y arreglos de perfil, consultas y calendario."],
  17: ["Última etapa registrada", "v17.0 y v17.1 (28–30 sep 2026): sesión gratuita sin bono para Isabel Rodríguez, visibilidad de consultas de Silvia los viernes y arreglo del <code>ReferenceError</code> de «rama llena» en consultas."],
};

const GENESIS_LABEL = {
  1: "Génesis · subidas iniciales sin versión (23 dic 2025)",
  6: "Cambios sin versión entre v4.3 y v6.3 — la era v5 no dejó registro",
  9: "Reinicio del repositorio · v7.52 – v9.8 sin detalle (31 ago 2026)",
};

const EVID = {
  "5": "Entre v4.3 (6 jul 2026) y v6.3 (21 jul 2026) solo hay tres commits, ninguno con versión: «Connect production Stripe Checkout», «cursor» y «mejora».",
  "4": "v4.3 es la primera versión con <code>package.json</code>; su campo <code>version</code> todavía decía «1.0.0».",
  "6": "v6.3 es la primera etiqueta de la serie: no hay registro de v6.0–v6.2.",
  "8": "Evidencia: migraciones <code>202609020054..0057_profesor_seguridad_aislamiento_v87/v88/v89/v810</code>, <code>202609020060_sync_profesor_emails_v814</code>, <code>202609020061_crear_cliente_mostrador_rpc_v819</code> y <code>202609020064_profesor_visibilidad_total_alumnos_v834</code>.",
  "9": "Evidencia: el <code>package.json</code> del «Initial commit» describe «verificaciones de calidad para la versión <b>9.8</b>» y existe la migración <code>202609020068_fix_yoga_booking_and_promo_stripe_v96</code> (v9.6). El detalle commit a commit no está en git.",
  "9.35": "Evidencia: migraciones <code>202609020091_fix_companion_bonus_consumption_v935</code> y <code>202609020092_require_companion_name_and_pair_v937</code> (v9.35 y v9.37).",
  "10": "Evidencia: migraciones <code>202609020201_eliminar_bono_bienvenida_v102</code> y <code>202609020300_consolidacion_v103_sin_bienvenida</code> (v10.2 y v10.3).",
  "11": "Evidencia: migración <code>202609030004_fix_introductory_sessions_only_v11_9</code> (v11.9).",
  "12": "Evidencia: migraciones <code>202609040001_v12_15_producto_contratado_consultas_online_y_local</code> y <code>202609070001_v12_16_asistencias_metodo_pago_tipo_reserva</code> (v12.15 y v12.16).",
};

const NOTES_MINOR = {
  "3.6": "Etiqueta inusual: ese mismo día (17 mar 2026) también se registró v2.6.4, por lo que podría ser un error de etiquetado.",
  "7.3": "Este commit consolida la v7.2 y sube la versión a la 7.3.",
};

/* --------------------------------------------------------- 7. utilidades */
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
function fmtFecha(f) {
  const [y, m, d] = f.split("-");
  return `${d} ${MESES[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

const VAGUE =
  /^(v?\d+(\.\d+)+|Add files via upload|Create CNAME|cursor|mejora)$/i;

function rangoFechas(fechas) {
  if (!fechas.length) return "";
  const s = [...fechas].sort();
  return `${fmtFecha(s[0])} → ${fmtFecha(s[s.length - 1])}`;
}

function colapsar(nums) {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j - i >= 1 ? `${s[i]}–${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return out;
}

/* --------------------------------------------------------- 8. render */
const totalCommits = commits.length;
const uniq = items.length;
const internalTotal = items.filter((i) => i.internal).length;
const dupTotal = totalCommits - uniq;
const orderedMajors = [...majors.keys()].sort((a, b) => a - b);
const totalSub = orderedMajors.reduce(
  (n, m) => n + [...majors.get(m).groups.keys()].filter((k) => k !== "__genesis").length,
  0
);

function renderCambio(it) {
  const badges = [];
  if (it.dup > 1)
    badges.push(
      `<span class="badge dup" title="Este mismo mensaje aparece en ${it.dup} commits distintos (copias entre ramas)">×${it.dup}</span>`
    );
  if (!it.det) badges.push(`<span class="badge nv">sin nº de versión</span>`);
  if (it.src === "package.json")
    badges.push(`<span class="badge pkg" title="Versión recuperada del campo version de package.json">de package.json</span>`);
  if (it.src === "detalle")
    badges.push(`<span class="badge pkg" title="Versión recuperada del cuerpo del commit">del cuerpo del commit</span>`);

  const files = filesMap.get(it.hash) || [];
  let fileLine = "";
  if (files.length) {
    if (VAGUE.test(it.subject)) {
      const shown = files.slice(0, 10);
      fileLine =
        `<div class="ficheros">` +
        shown.map((f) => `<code>${esc(f.split("/").pop())}</code>`).join(" ") +
        (files.length > 10 ? ` <span class="mas">+${files.length - 10} más</span>` : "") +
        `</div>`;
    } else {
      fileLine = `<div class="nfich">+${files.length} fichero${files.length > 1 ? "s" : ""}</div>`;
    }
  }

  const limpio = stripTrailers(it.body);
  const cuerpo = limpio
    ? `<details class="detalle"><summary>detalle del commit</summary><pre>${esc(limpio)}</pre></details>`
    : "";

  return `<li class="cambio">
    <span class="fecha">${fmtFecha(it.date)}</span>
    <div class="texto">
      <div class="asunto">${esc(it.subject)}${badges.length ? " " + badges.join(" ") : ""}</div>
      ${fileLine}
      ${cuerpo}
    </div>
  </li>`;
}

const partes = [];
for (const maj of orderedMajors) {
  const M = majors.get(maj);
  const [titulo, desc] = INFO[maj] || [`Etapa v${maj}`, ""];
  const nCambios = M.groups.size
    ? [...M.groups.values()].reduce((n, a) => n + a.length, 0)
    : 0;
  const nInternos = M.internal.length;

  const gKeys = [...M.groups.keys()].sort((a, b) => {
    if (a === "__genesis") return -1;
    if (b === "__genesis") return 1;
    return parseInt(a, 10) - parseInt(b, 10);
  });

  // huecos: menores ausentes entre 0 y el máximo registrado
  const verSet = [...M.verSet];
  const huecos = [];
  if (verSet.length) {
    const max = Math.max(...verSet);
    const falta = [];
    for (let n = 0; n <= max; n++) if (!M.verSet.has(n)) falta.push(n);
    for (const [a, b] of colapsar(falta).map((r) => r.split("–").map(Number))) {
      huecos.push([a, b === undefined ? a : b]);
    }
  }

  // huecos pendientes: se pintan tras el primer grupo que les precede
  let cuerpoFinal = "";
  const pendientes = [...huecos];
  for (const k of gKeys) {
    const arr = M.groups.get(k);
    let bloque = "";
    if (k === "__genesis") {
      const label =
        GENESIS_LABEL[maj] || `Cambios sin número de versión al inicio de v${maj}`;
      bloque = `<div class="grupo genesis"><h4>${esc(label)} <span class="cuenta">${arr.length}</span></h4><ul class="lista">${arr.map(renderCambio).join("")}</ul></div>`;
    } else {
      const nota = NOTES_MINOR[`${maj}.${k}`] ? `<span class="nota">${NOTES_MINOR[`${maj}.${k}`]}</span>` : "";
      bloque = `<details class="minor"><summary><span class="pill">v${maj}.${k}</span><span class="cuenta">${arr.length} cambio${arr.length > 1 ? "s" : ""}</span>${nota}</summary><ul class="lista">${arr.map(renderCambio).join("")}</ul></details>`;
    }
    cuerpoFinal += bloque;
    const num = k === "__genesis" ? -1 : parseInt(k, 10);
    while (pendientes.length && pendientes[0][0] <= num) {
      const [a, b] = pendientes.shift();
      cuerpoFinal += renderHueco(maj, a, b);
    }
  }
  while (pendientes.length) {
    const [a, b] = pendientes.shift();
    cuerpoFinal += renderHueco(maj, a, b);
  }

  const sinRegistro = nCambios === 0
    ? `<div class="hueco grande">⚠ <b>v${maj}</b> no tiene ni un commit. ${EVID[`${maj}`] || ""}</div>`
    : "";

  const bloqueInt = nInternos
    ? `<details class="minor internos"><summary><span class="pill gris">commits internos</span><span class="cuenta">${nInternos} checkpoints de agente</span></summary><ul class="lista">${M.internal.map(renderCambio).join("")}</ul></details>`
    : "";

  partes.push(`<details class="major" id="v${maj}" data-major="${maj}">
    <summary>
      <span class="ver">v${maj}</span>
      <span class="tit">${esc(titulo)}</span>
      <span class="meta">${rangoFechas(M.dates)} · ${nCambios} cambio${nCambios === 1 ? "" : "s"} · ${[...M.groups.keys()].filter((k) => k !== "__genesis").length} subversiones${nInternos ? ` · +${nInternos} internos` : ""}</span>
    </summary>
    <div class="cuerpo">
      <p class="desc">${desc}</p>
      ${sinRegistro}
      ${cuerpoFinal}
      ${bloqueInt}
    </div>
  </details>`);
}

function renderHueco(maj, a, b) {
  const rango = a === b ? `v${maj}.${a}` : `v${maj}.${a} – v${maj}.${b}`;
  const ev = EVID[`${maj}.${a}`] || EVID[`${maj}`] || "";
  return `<div class="hueco">⚠ <b>${rango}</b> · sin registro en git (el trabajo, si se hizo, no quedó con su propio commit).${ev ? `<br><span class="ev">${ev}</span>` : ""}</div>`;
}

/* ------------------------------------------------- 9. índice lateral */
const indice = orderedMajors
  .map((m) => {
    const M = majors.get(m);
    const n = [...M.groups.values()].reduce((a, x) => a + x.length, 0);
    return `<a href="#v${m}" class="item-idx"><span class="v">v${m}</span><span class="d">${rangoFechas(M.dates)}</span><span class="n">${n}</span></a>`;
  })
  .join("");

/* ------------------------------------------------- 10. huecos globales */
const huecosGlobales = [
  ["v4.0 – v4.2", "Sin registro. v4.3 (6 jul 2026) es la primera versión con package.json."],
  ["v5.x (entera)", "Sin ningún registro en todo el repositorio (6–21 jul 2026)."],
  ["v6.0 – v6.2", "Sin registro. Antes de v6.3 (21 jul 2026)."],
  ["v7.52 – v9.8", "Del 25 al 31 de agosto de 2026 no hay commits con detalle: el «Initial commit» (31 ago) los consolida. Migraciones con sufijo _v87…_v834 y _v96 atestiguan esa etapa."],
  ["v10.2 – v10.13", "Sin commits propios; las migraciones _v102 y _v103 cubren v10.2 y v10.3."],
  ["v11.9 · v12.15 · v12.16", "Sin commit propio; existen las migraciones _v11_9, _v12_15 y _v12_16 con esos números."],
  ["v9.15 – v9.16 · v9.27 – v9.28 · v9.35 – v9.39", "Saltos de numeración entre releases; v9.35 y v9.37 solo aparecen en el sufijo de dos migraciones."],
  ["v7.5 · v7.16 – v7.19 · v7.24 – v7.29 · v7.48", "Saltos de numeración: no hay commits con esas etiquetas."],
  ["v2.0 · v2.2 · v2.4 – v2.5 · v2.7 · v2.9", "Saltos de numeración en la etapa 2 (ene–may 2026)."],
];

/* ------------------------------------------------- 11. HTML */
const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Historial de versiones · GEN Yoga Studio</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f5f4fa;color:#20222e;line-height:1.5}
  header.cab{background:linear-gradient(135deg,#4c1d95 0%,#7c3aed 55%,#a855f7 100%);color:#fff;padding:34px 24px 28px}
  header.cab .in{max-width:1240px;margin:0 auto}
  header.cab h1{margin:0 0 6px;font-size:1.75rem;letter-spacing:-.02em}
  header.cab p{margin:0;opacity:.92;font-size:.95rem}
  .stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
  .stat{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.25);border-radius:12px;padding:8px 14px;font-size:.82rem}
  .stat b{display:block;font-size:1.15rem;line-height:1.2}
  .layout{max-width:1240px;margin:0 auto;padding:22px;display:grid;grid-template-columns:250px 1fr;gap:22px;align-items:start}
  aside{position:sticky;top:14px;background:#fff;border:1px solid #e7e3f4;border-radius:14px;padding:14px;max-height:calc(100vh - 30px);overflow:auto}
  aside h3{margin:2px 0 10px;font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:#7c3aed}
  .item-idx{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:9px;text-decoration:none;color:#2b2d3a;font-size:.86rem}
  .item-idx:hover{background:#f3efff}
  .item-idx .v{font-weight:700;color:#5b21b6;min-width:34px}
  .item-idx .d{flex:1;color:#8b8fa3;font-size:.74rem}
  .item-idx .n{background:#ede9fe;color:#5b21b6;border-radius:999px;padding:1px 7px;font-size:.7rem}
  .leyenda{margin-top:12px;border-top:1px solid #eee;padding-top:10px;font-size:.74rem;color:#6b7280}
  .badge{display:inline-block;border-radius:999px;padding:1px 7px;font-size:.66rem;font-weight:600;vertical-align:middle}
  .badge.dup{background:#fee2e2;color:#b91c1c}
  .badge.nv{background:#fef3c7;color:#92400e}
  .badge.pkg{background:#e0f2fe;color:#075985}
  .barra{display:flex;gap:10px;flex-wrap:wrap;align-items:center;background:#fff;border:1px solid #e7e3f4;border-radius:14px;padding:12px;margin-bottom:16px;position:sticky;top:8px;z-index:5}
  .barra input{flex:1;min-width:200px;padding:9px 12px;border:1px solid #d8d2ef;border-radius:10px;font-size:.9rem;outline:none}
  .barra input:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.15)}
  .btn{border:1px solid #d8d2ef;background:#f8f6ff;color:#4c1d95;border-radius:10px;padding:8px 12px;font-size:.82rem;cursor:pointer;font-weight:600}
  .btn:hover{background:#ede9fe}
  #contador{font-size:.8rem;color:#6b7280}
  details.major{background:#fff;border:1px solid #e7e3f4;border-radius:16px;margin-bottom:14px;box-shadow:0 1px 2px rgba(30,20,70,.05);overflow:hidden}
  details.major>summary{cursor:pointer;list-style:none;padding:15px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  details.major>summary::-webkit-details-marker{display:none}
  details.major>summary:hover{background:#faf9ff}
  details.major[open]>summary{background:#faf9ff;border-bottom:1px solid #efecfa}
  .ver{background:linear-gradient(135deg,#5b21b6,#7c3aed);color:#fff;border-radius:999px;padding:4px 13px;font-weight:700;font-size:.95rem;min-width:58px;text-align:center}
  .tit{font-weight:700;font-size:1.02rem;color:#22243a}
  .meta{margin-left:auto;color:#8b8fa3;font-size:.78rem}
  .cuerpo{padding:14px 18px 18px}
  .desc{margin:0 0 14px;font-size:.9rem;color:#4b4f63;background:#f8f6ff;border-left:3px solid #a78bfa;padding:10px 12px;border-radius:0 10px 10px 0}
  details.minor{border-left:3px solid #ddd6fe;margin:8px 0 8px 6px;padding-left:12px}
  details.minor>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:4px 0;font-size:.9rem}
  details.minor>summary::-webkit-details-marker{display:none}
  details.minor>summary:hover{color:#5b21b6}
  .pill{background:#ede9fe;color:#5b21b6;border-radius:999px;padding:2px 10px;font-weight:700;font-size:.82rem}
  .pill.gris{background:#e5e7eb;color:#374151}
  .cuenta{color:#9ca3af;font-size:.74rem}
  .nota{font-size:.74rem;color:#b45309;background:#fffbeb;border:1px dashed #fcd34d;border-radius:8px;padding:1px 8px}
  .grupo.genesis{background:#fbfaff;border:1px dashed #c4b5fd;border-radius:12px;padding:10px 12px;margin:8px 0}
  .grupo.genesis h4{margin:0 0 6px;font-size:.83rem;color:#5b21b6;font-weight:700}
  ul.lista{list-style:none;margin:6px 0 4px;padding:0}
  li.cambio{display:grid;grid-template-columns:88px 1fr;gap:10px;padding:7px 2px;border-bottom:1px dashed #eeeef4;font-size:.88rem}
  li.cambio:last-child{border-bottom:none}
  .fecha{color:#8b8fa3;font-size:.75rem;font-variant-numeric:tabular-nums;white-space:nowrap;padding-top:2px}
  .asunto{color:#26283a}
  .ficheros{margin-top:3px;font-size:.74rem;color:#6b7280}
  .ficheros code{background:#f3f2f8;border-radius:5px;padding:1px 5px;margin-right:4px;font-size:.72rem}
  .ficheros .mas{color:#9ca3af}
  .nfich{margin-top:2px;font-size:.7rem;color:#b0b3c2}
  details.detalle{margin-top:5px}
  details.detalle summary{cursor:pointer;font-size:.73rem;color:#7c3aed;list-style:none}
  details.detalle summary::-webkit-details-marker{display:none}
  details.detalle pre{white-space:pre-wrap;background:#f8f7fc;border:1px solid #ecebf5;border-radius:9px;padding:10px;font-size:.77rem;color:#4b4f63;margin:6px 0 0;max-height:340px;overflow:auto}
  .hueco{background:#fffbeb;border:1px dashed #fcd34d;color:#92400e;border-radius:12px;padding:9px 13px;margin:9px 0;font-size:.8rem}
  .hueco.grande{font-size:.86rem}
  .hueco .ev{color:#a16207;font-size:.76rem}
  section.blanco{background:#fff;border:1px solid #e7e3f4;border-radius:16px;padding:18px 20px;margin-bottom:16px}
  section.blanco h2{margin:0 0 10px;font-size:1.1rem;color:#4c1d95}
  table{width:100%;border-collapse:collapse;font-size:.83rem}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #f0eefa;vertical-align:top}
  th{color:#5b21b6;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em}
  td:first-child{white-space:nowrap;font-weight:600;color:#4c1d95}
  footer{text-align:center;color:#8b8fa3;font-size:.78rem;padding:22px}
  @media (max-width:900px){.layout{grid-template-columns:1fr}aside{position:static;max-height:none}.meta{margin-left:0;width:100%}}
  @media print{body{background:#fff}.barra,aside{display:none}.layout{display:block;padding:0}details.major, details.minor, details.detalle{border-color:#ccc}li.cambio{break-inside:avoid}}
</style>
</head>
<body>
<header class="cab">
  <div class="in">
    <h1>Historial de versiones · GEN Yoga Studio</h1>
    <p>Listado completo de la vida de la web, de arriba abajo: cada versión mayor desplegable con todas sus subversiones y cada cambio ejecutado desde el primer commit.</p>
    <div class="stats">
      <div class="stat"><b>${totalCommits}</b>commits analizados</div>
      <div class="stat"><b>${uniq}</b>cambios únicos</div>
      <div class="stat"><b>${dupTotal}</b>repetidos entre ramas</div>
      <div class="stat"><b>${orderedMajors.length}</b>versiones mayores (v1–v17)</div>
      <div class="stat"><b>${totalSub}</b>subversiones</div>
      <div class="stat"><b>23 dic 25 → 30 sep 26</b>rango completo</div>
    </div>
  </div>
</header>

<div class="layout">
  <aside>
    <h3>Índice de versiones</h3>
    ${indice}
    <div class="leyenda">
      <b>Leyenda</b><br>
      <span class="badge dup">×N</span> mismo mensaje en varios commits<br>
      <span class="badge nv">sin nº</span> cambio sin versión propia<br>
      <span class="badge pkg">package.json</span> versión recuperada de otra fuente<br>
      <span class="hueco" style="display:inline-block;padding:0 6px;margin-top:4px">⚠</span> tramo sin registro en git
    </div>
  </aside>

  <main>
    <div class="barra">
      <input id="buscar" type="search" placeholder="Buscar un cambio: bono, stripe, consulta, notch, promo…">
      <button class="btn" id="expandir">Expandir todo</button>
      <button class="btn" id="contraer">Contraer todo</button>
      <span id="contador"></span>
    </div>

    ${partes.join("\n")}

    <section class="blanco" id="huecos">
      <h2>Tramos del historial sin registro propio</h2>
      <p style="font-size:.86rem;color:#4b4f63;margin-top:0">Trabajo que se hizo (lo prueban <code>package.json</code>, los nombres de las migraciones y las fechas), pero que en git no tiene commits individuales:</p>
      <table>
        <thead><tr><th>Tramo</th><th>Qué se sabe</th></tr></thead>
        <tbody>
          ${huecosGlobales.map((h) => `<tr><td>${h[0]}</td><td>${h[1]}</td></tr>`).join("\n          ")}
        </tbody>
      </table>
    </section>

    <section class="blanco" id="metodologia">
      <h2>Cómo está hecho este documento</h2>
      <ul style="font-size:.86rem;color:#4b4f63;margin:0;padding-left:18px">
        <li>Fuente: <b>todos los commits de todas las ramas</b> del repositorio (<code>git log --all</code>): ${totalCommits} commits, ${uniq} mensajes distintos. Los ${dupTotal} repetidos son copias del mismo cambio en varias ramas y se muestran con la etiqueta <span class="badge dup">×N</span>.</li>
        <li>Cada versión detectada en el <b>mensaje del commit</b>; si no la lleva, se busca en el <b>cuerpo del commit</b> y después en el campo <code>version</code> de <b>package.json</b> (se marcan con <span class="badge pkg">package.json</span>).</li>
        <li>Los cambios sin número propio se agrupan bajo la subversión anterior de su etapa y llevan <span class="badge nv">sin nº de versión</span>. Si no hay ninguna anterior, van en el bloque «génesis» de esa versión.</li>
        <li>Los ${internalTotal} checkpoints internos de agentes (<i>Agent host session…</i>) van en un bloque propio al final de cada versión mayor, para que no interrumpan el relato.</li>
        <li>Se han descartado falsos positivos de detección (p. ej. «Capacitor 8.4» o «Swift 5.9» no son versiones de la web).</li>
        <li>Las fechas son las de los commits, en la zona horaria local.</li>
      </ul>
    </section>
  </main>
</div>

<footer>Generado el 30 sep 2026 a partir del repositorio <code>GEN-YOGA-STUDIO/GEN-YOGA</code> (rama main + develop + ramas codex y agents).</footer>

<script>
(function(){
  var input = document.getElementById('buscar');
  var contador = document.getElementById('contador');
  function filtrar(){
    var q = input.value.trim().toLowerCase();
    var cambios = document.querySelectorAll('li.cambio');
    var n = 0;
    cambios.forEach(function(li){
      var hit = !q || li.textContent.toLowerCase().indexOf(q) !== -1;
      li.style.display = hit ? '' : 'none';
      if (hit && q) n++;
    });
    document.querySelectorAll('details.minor, .grupo.genesis').forEach(function(d){
      var vis = Array.prototype.some.call(d.querySelectorAll('li.cambio'), function(li){ return li.style.display !== 'none'; });
      d.style.display = (!q || vis) ? '' : 'none';
      if (q && vis && d.tagName === 'DETAILS') d.open = true;
    });
    document.querySelectorAll('details.major').forEach(function(d){
      var vis = Array.prototype.some.call(d.querySelectorAll('li.cambio'), function(li){ return li.style.display !== 'none'; });
      d.style.display = (!q || vis) ? '' : 'none';
      if (q && vis) d.open = true;
    });
    contador.textContent = q ? (n + ' cambios coinciden') : '';
  }
  var t;
  input.addEventListener('input', function(){ clearTimeout(t); t = setTimeout(filtrar, 140); });
  document.getElementById('expandir').addEventListener('click', function(){
    document.querySelectorAll('details').forEach(function(d){ d.open = true; });
  });
  document.getElementById('contraer').addEventListener('click', function(){
    document.querySelectorAll('details').forEach(function(d){ d.open = false; });
  });
  window.addEventListener('beforeprint', function(){
    document.querySelectorAll('details').forEach(function(d){ d.open = true; });
  });
})();
</script>
</body>
</html>`;

writeFileSync(OUT, html, "utf8");
console.log(`OK -> ${OUT}`);
console.log(
  `commits=${totalCommits} unicos=${uniq} internos=${internalTotal} majors=${orderedMajors.length} subversiones=${totalSub} tamano=${(html.length / 1024).toFixed(0)}KB`
);
