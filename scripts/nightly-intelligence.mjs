// scripts/nightly-intelligence.mjs
// Motor de precisión del bucle nocturno.
//
// Convierte informes crudos en decisiones:
//   - firma estable de fallos (misma causa = misma firma; cambio real = firma nueva)
//   - clasificación de avisos (dato de prueba ≠ defecto ≠ infraestructura)
//   - salud funcional y salud de experiencia, separadas y explicables
//   - plan de mejoras accionable (lo consume scripts/mejoras.mjs y la IA)
//
// Sin dependencias externas. Se usa desde analizar-informe-diario.mjs,
// nightly-step-summary.mjs y mejoras.mjs.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const FAIL_WEIGHT = { high: 22, medium: 7, low: 2 };
export const WARNING_WEIGHT = {
  data: 0.5, fallback: 3, a11y: 2, seo: 2, pwa: 2, 'deploy-pending': 0.5,
  i18n: 2, infra: 1, flaky: 1, personas: 1, coverage: 4, other: 2,
};

export const EXPECTED_SUITES = [
  'disponibilidad', 'seo', 'backend', 'datos', 'privacidad', 'contenido', 'landing',
  'calendario', 'auth', 'cliente', 'compra', 'retorno', 'seguridad', 'rendimiento',
  'a11y', 'enlaces', 'seo-plus', 'pwa', 'datos-vivos', 'i18n-live', 'entrega', 'personas',
];

export function normalizeDetail(text) {
  return String(text || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/https?:\/\/[^\s)]+/gi, '<url>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<ts>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[A-Za-z]:\\[^\s]+/g, '<path>')
    .replace(/\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g, '<path>')
    .replace(/\b\d+(?:[.,]\d+)?(?:ms|s|px|KB|MB)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export function failureSignature(f) {
  const raw = `${f.suite || '?'}|${f.check || '?'}|${normalizeDetail(f.detail)}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

export function classifyWarning(warning) {
  const t = String(warning || '').toLowerCase();
  if (/flaky|inestable|reintent/.test(t)) return 'flaky';
  if (/fallback a bd|no desplegada \(404|funci[oó]n .*ausente|pendiente de desplegar|no publicado/.test(t)) return 'fallback';
  if (/sin (reservas|clases|citas|huecos|datos|plazas|bonos disponibles)|depende de datos|aviso, normal|normal sin bookings/.test(t)) return 'data';
  if (/a11y|contraste|alt|foco|teclado|zoom|etiqueta|t[aá]ctil|fuente por debajo/.test(t)) return 'a11y';
  if (/canonical|json-ld|indexable|og:image|sitemap|robots|metadatos|seo/.test(t)) return 'seo';
  if (/manifest|pwa|icon|theme-color/.test(t)) return 'pwa';
  if (/i18n|idioma|traduc/.test(t)) return 'i18n';
  if (/compresi[oó]n|cach[eé]|content-encoding|infra/.test(t)) return 'infra';
  if (/no se pudo|sin informe|timeout|sin red|ca[ií]da/.test(t)) return 'coverage';
  return 'other';
}

export function warningDetail(entry) {
  if (entry && typeof entry === 'object') {
    return `${entry.suite || '?'} · ${entry.name || '?'}${entry.detail ? ` — ${entry.detail}` : ''}`;
  }
  return String(entry || '');
}

export function classifyWarnings(entries) {
  const counts = { data: 0, fallback: 0, a11y: 0, seo: 0, pwa: 0, i18n: 0, infra: 0, flaky: 0, coverage: 0, other: 0 };
  const items = [];
  for (const entry of entries || []) {
    const text = warningDetail(entry);
    const kind = entry?.meta?.kind || entry?.kind || classifyWarning(text);
    counts[kind] = (counts[kind] || 0) + 1;
    items.push({
      text,
      kind,
      code: entry?.meta?.code || '',
      severity: entry?.meta?.severity || '',
      actionable: entry?.meta?.actionable !== false,
    });
  }
  return { items, counts };
}

function suitePresent(results, expected) {
  return (results || []).some((r) => r.suite === expected || String(r.suite || '').startsWith(`${expected}-`));
}

export function computeCoverage(fullReport, { skipPersonas = false } = {}) {
  // El runner ya calcula la cobertura real (incluye SKIP_PERSONAS). Se reutiliza
  // para que el análisis y el propio informe nunca discrepen.
  if (fullReport?.coverage && Array.isArray(fullReport.coverage.missing)) {
    // El informe ya calculó su cobertura teniendo en cuenta `personasSkipped`.
    // Restar la suite otra vez al analizarlo descontaba una suite inexistente y
    // podía maquillar una cobertura incompleta (p. ej. 18/21 → 18/20).
    const alreadyAdjusted = Boolean(fullReport.personasSkipped);
    const applySkip = skipPersonas && !alreadyAdjusted;
    const missing = applySkip ? fullReport.coverage.missing.filter((s) => s !== 'personas') : fullReport.coverage.missing;
    const expected = applySkip ? Math.max(0, fullReport.coverage.expected - 1) : fullReport.coverage.expected;
    const present = Math.max(0, expected - missing.length);
    return {
      expected,
      present,
      ratio: expected ? Math.round((present / expected) * 100) / 100 : 1,
      missing,
      totalChecks: Number(fullReport.coverage.totalChecks || fullReport?.summary?.total || 0),
    };
  }
  const expected = EXPECTED_SUITES.filter((s) => !(skipPersonas && s === 'personas'));
  const present = expected.filter((s) => suitePresent(fullReport?.results, s));
  const missing = expected.filter((s) => !present.includes(s));
  const total = Number(fullReport?.summary?.total || fullReport?.results?.length || 0);
  return {
    expected: expected.length,
    present: present.length,
    ratio: expected.length ? Math.round((present.length / expected.length) * 100) / 100 : 1,
    missing,
    totalChecks: total,
  };
}

function getPerf(fullReport) {
  let ttfb = null;
  for (const r of fullReport?.results || []) {
    if (r.suite !== 'rendimiento') continue;
    const m = String(r.name || '').match(/TTFB home:\s*(\d+)ms/);
    if (m) ttfb = Number(m[1]);
  }
  // Una página se navega varias veces durante el chequeo (login, compra,
  // responsive...). Contarla N veces infla la penalización: se usa la peor
  // medición de cada página, que es la única que puede ocultar un problema.
  if (Array.isArray(fullReport?.perfSummary) && fullReport.perfSummary.length) {
    const pages = fullReport.perfSummary
      .map((p) => ({ page: p.page, ms: Number(p.worstMs ?? p.ms ?? 0) }))
      .filter((p) => p.page && p.ms > 0)
      .sort((a, b) => b.ms - a.ms);
    return { ttfb, pages };
  }
  const byPage = new Map();
  for (const r of fullReport?.results || []) {
    if (r.suite !== 'rendimiento') continue;
    const m = String(r.name || '').match(/^([^:]+):\s*(\d+)ms/);
    if (!m || m[1] === 'TTFB home') continue;
    const page = m[1].split('?')[0];
    const ms = Number(m[2]);
    byPage.set(page, Math.max(byPage.get(page) || 0, ms));
  }
  const pages = [...byPage.entries()].map(([page, ms]) => ({ page, ms })).sort((a, b) => b.ms - a.ms);
  return { ttfb, pages };
}

function getSslDays(fullReport) {
  const ssl = (fullReport?.results || []).find((r) => r.suite === 'disponibilidad' && String(r.name).includes('SSL/TLS'));
  if (!ssl) return null;
  const m = String(ssl.name).match(/(\d+)\s*d[ií]as restantes/);
  return m ? Number(m[1]) : null;
}

function personaFindings(personaReport) {
  const out = [];
  for (const p of personaReport?.personas || []) {
    for (const f of p.findings || []) out.push({ ...f, persona: p.name, personaId: p.id, friction: p.metrics?.friction ?? 0 });
  }
  return out;
}

/**
 * Salud explicable. Separa lo que rompe el negocio (funcional) de lo que
 * empeora la experiencia, para no llamar "crítico" a un texto de 10px ni
 * "excelente" a una caída de pagos.
 */
export function computeHealth({ action, fullReport, personaReport, previousAction = null, skipPersonas = false }) {
  const failures = action?.failures || [];
  const warnings = classifyWarnings(
    fullReport?.warningDetails || fullReport?.warningsDetail ||
    action?.warningDetails || action?.warningsDetail ||
    action?.warnings || fullReport?.warnings || [],
  );
  const coverage = computeCoverage(fullReport, { skipPersonas });
  const perf = getPerf(fullReport);
  const sslDays = getSslDays(fullReport);
  const findings = personaFindings(personaReport);
  const personaFailed = Number(personaReport?.summary?.failed || 0);

  const penalties = [];
  const high = failures.filter((f) => f.severity === 'high').length;
  const medium = failures.filter((f) => (f.severity || 'medium') === 'medium').length;
  const low = failures.filter((f) => f.severity === 'low').length;
  if (failures.length) {
    penalties.push({ code: 'failures', label: `${failures.length} fallo(s) bloqueante(s)`, points: Math.min(70, high * 22 + medium * 7 + low * 2), side: 'functional' });
  }

  // Avisos: solo penaliza lo que no es ruido de datos de prueba.
  let warningPoints = 0;
  for (const [kind, count] of Object.entries(warnings.counts)) {
    if (!count) continue;
    const pts = Math.min(kind === 'a11y' || kind === 'seo' || kind === 'pwa' ? 6 : 10, count * (WARNING_WEIGHT[kind] || 1));
    if (pts > 0) {
      warningPoints += pts;
      penalties.push({ code: `warn-${kind}`, label: `${count} aviso(s) ${kind}`, points: Math.round(pts * 10) / 10, side: ['a11y', 'seo', 'pwa', 'deploy-pending', 'i18n', 'infra', 'personas'].includes(kind) ? 'experience' : 'functional' });
    }
  }

  if (perf.ttfb && perf.ttfb > 700) {
    const pts = perf.ttfb > 1500 ? 10 : 5;
    penalties.push({ code: 'ttfb', label: `TTFB ${perf.ttfb}ms`, points: pts, side: 'functional' });
  }
  const slowPages = perf.pages.filter((p) => p.ms > 3000);
  if (slowPages.length) {
    penalties.push({ code: 'pages', label: `${slowPages.length} página(s) >3s`, points: Math.min(8, slowPages.length * 2), side: 'functional' });
  }
  if (sslDays !== null && sslDays <= 21) {
    penalties.push({ code: 'ssl', label: `SSL caduca en ${sslDays} días`, points: sslDays <= 7 ? 20 : sslDays <= 14 ? 12 : 5, side: 'functional' });
  }
  if (coverage.ratio < 0.9) {
    penalties.push({ code: 'coverage', label: `cobertura ${Math.round(coverage.ratio * 100)}%`, points: 8, side: 'functional' });
  }

  // Un recorrido que no puede completar su objetivo es un fallo funcional,
  // aunque la persona no haya llegado a producir un "assert" concreto.
  if (personaFailed > 0) {
    penalties.push({ code: 'persona-dead-end', label: `${personaFailed} recorrido(s) bloqueado(s)`, points: Math.min(30, personaFailed * 18), side: 'functional' });
  }

  // Experiencia de personas: fricción real + hallazgos, con techo.
  let experiencePoints = 0;
  if (findings.length) {
    const p = findings.reduce((a, f) => a + (f.severity === 'high' ? 8 : f.severity === 'medium' ? 3 : 1), 0);
    experiencePoints += Math.min(15, p);
    penalties.push({ code: 'personas', label: `${findings.length} hallazgo(s) de personas`, points: Math.min(15, p), side: 'experience' });
  }
  const friction = personaReport?.summary?.friction;
  if (typeof friction === 'number' && friction > 0) {
    const p = Math.min(10, friction / 10);
    experiencePoints += p;
    penalties.push({ code: 'friction', label: `fricción media ${friction}/100`, points: Math.round(p * 10) / 10, side: 'experience' });
  }

  const functionalPenalty = penalties.filter((p) => p.side === 'functional').reduce((a, p) => a + p.points, 0);
  const experiencePenalty = penalties.filter((p) => p.side === 'experience').reduce((a, p) => a + p.points, 0);
  const functionalScore = Math.max(0, Math.round(100 - Math.min(100, functionalPenalty)));
  const experienceScore = Math.max(0, Math.round(100 - Math.min(100, experiencePenalty)));
  const score = Math.max(0, Math.round(functionalScore * 0.75 + experienceScore * 0.25));
  // "EXCELENTE" no es "sin fallos": exige que tampoco haya deuda pendiente
  // (función sin desplegar, cobertura incompleta, a11y/SEO/PWA abiertos).
  const pendingKinds = ['fallback', 'coverage', 'infra', 'a11y', 'seo', 'pwa', 'deploy-pending', 'i18n'];
  const pendingDebt = pendingKinds.some((k) => (warnings.counts[k] || 0) > 0);
  const grade = high > 0 || personaFailed > 0 ? 'CRÍTICO'
    : score >= 92 && failures.length === 0 && !pendingDebt ? 'EXCELENTE'
      : score >= 78 ? 'BUENO'
        : score >= 60 ? 'ATENCIÓN' : 'CRÍTICO';

  // Novedad de fallos vs pasada anterior (por firma, no por texto exacto).
  const currentSigs = new Set(failures.map((f) => f.signature || failureSignature(f)));
  const prevFailures = previousAction?.failures || [];
  const prevSigs = new Set(prevFailures.map((f) => f.signature || failureSignature(f)));
  const newFailures = failures.filter((f) => !prevSigs.has(f.signature || failureSignature(f)));
  const recurringFailures = failures.filter((f) => prevSigs.has(f.signature || failureSignature(f)));
  const resolvedFailures = prevFailures.filter((f) => !currentSigs.has(f.signature || failureSignature(f)));

  return {
    score,
    grade,
    functionalScore,
    experienceScore,
    penalties,
    severity: { high, medium, low },
    warnings: warnings.counts,
    warningItems: warnings.items,
    coverage,
    perf,
    sslDays,
    personas: personaReport?.summary || null,
    personaDeadEnds: personaFailed,
    newFailures: newFailures.length,
    recurringFailures: recurringFailures.length,
    resolvedFailures: resolvedFailures.length,
    isNewFailure: (f) => !prevSigs.has(f.signature || failureSignature(f)),
  };
}

function priorityOf(rank) { return rank === 0 ? 'P1' : rank === 1 ? 'P2' : 'P3'; }
const RANK = { P1: 0, P2: 1, P3: 2 };

function manualReason(text) {
  if (/supabase|edge function|functions\/v1|no desplegada|deploy|despliegue|desplegar|publicar|migraci[oó]n|\brls\b|stripe|webhook|secret|credencial/i.test(text)) {
    return 'Requiere acceso a Supabase/Stripe o un despliegue; no es un cambio de código web seguro.';
  }
  if (/datos de prueba|sin reservas|sin huecos|depende de datos|sin citas/i.test(text)) {
    return 'Depende de datos de prueba o de la agenda real; no se corrige con código.';
  }
  return '';
}

/**
 * Convierte salud + fallos + avisos + personas en propuestas concretas.
 * @returns {{date:string, env:string, base:string, health:object, summary:object, items:Array, signature:string}}
 */
export function buildPlan({ action, fullReport, personaReport, previousAction = null, skipPersonas = false }) {
  const health = computeHealth({ action, fullReport, personaReport, previousAction, skipPersonas });
  const env = action?.env || fullReport?.env || 'produccion';
  const isCert = env === 'certificacion';
  const verify = isCert ? 'npm run check:cert' : 'npm run check:nightly';
  const raw = [];
  const seen = new Set();

  const push = (item) => {
    const key = item.key || `${item.category}|${normalizeDetail(item.title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push(item);
  };

  for (const f of action?.failures || []) {
    const text = `${f.suite} ${f.check} ${f.detail}`;
    const manual = manualReason(text);
    push({
      key: `fail|${failureSignature(f)}`,
      category: 'bug',
      priority: f.severity === 'high' ? 'P1' : 'P2',
      title: `${f.suite} · ${f.check}`,
      why: String(f.detail || '').slice(0, 400),
      evidence: { url: f.url || '', screenshot: f.evidence?.screenshot || null, console: (f.evidence?.console || []).slice(0, 3) },
      files: f.suspectedFiles || [],
      action: 'Reproducir el fallo con el usuario de pruebas, corregir la causa raíz y volver a ejecutar el escenario completo.',
      verify,
      autoApplicable: !manual,
      requires: manual || undefined,
      risk: f.severity === 'high' ? 'medium' : 'low',
      source: f.id || 'nightly',
    });
  }

  for (const w of health.warningItems) {
    // `personas` ya se materializa en propuestas concretas a partir de sus
    // hallazgos; y los avisos de datos/cobertura no se arreglan con código.
    if (w.kind === 'data' || w.kind === 'flaky' || w.kind === 'coverage' || w.kind === 'personas') continue;
    // Avisos de apoyo (p. ej. el asset 404 que ya cubre la suite PWA) no deben
    // convertirse en propuestas duplicadas.
    if (w.actionable === false) continue;
    const manual = manualReason(w.text);
    const kind = w.kind === 'deploy-pending' ? 'pwa' : w.kind;
    const priority = kind === 'fallback' ? 'P2' : kind === 'infra' ? 'P3' : 'P2';
    const category = kind === 'fallback' ? 'infra' : kind === 'a11y' ? 'a11y' : kind === 'seo' ? 'seo' : kind === 'pwa' ? 'pwa' : kind === 'i18n' ? 'i18n' : 'ux';
    push({
      key: `warn|${w.kind}|${normalizeDetail(w.text)}`,
      category,
      priority,
      title: cleanWarningTitle(w.text),
      why: w.text,
      evidence: {},
      files: filesForCategory(category),
      action: actionForCategory(category, w.text),
      verify,
      autoApplicable: !manual,
      requires: manual || undefined,
      risk: 'low',
      source: 'aviso',
    });
  }

  for (const f of personaFindings(personaReport)) {
    if (['a11y-font', 'a11y-contrast', 'a11y-name', 'a11y-label', 'a11y-img-alt', 'a11y-zoom'].includes(f.code)) {
      const nd = normalizeDetail(f.detail);
      const already = health.warningItems.some((w) => w.code === f.code) || health.warningItems.some((w) => {
        const wt = normalizeDetail(w.text);
        return wt.includes(nd) || nd.includes(wt.replace(/^[a-z0-9-]+ · [^—]+— /i, ''));
      });
      if (already) continue;
    }
    push({
      key: `persona|${f.code}|${normalizeDetail(f.detail)}`,
      category: 'ux',
      priority: f.severity === 'high' ? 'P1' : f.severity === 'medium' ? 'P2' : 'P3',
      title: f.title,
      why: `${f.persona ? `${f.persona}: ` : ''}${f.detail}`,
      evidence: { persona: f.personaId || '', friction: f.friction ?? null },
      files: f.files || [],
      action: actionForCategory('ux', f.detail),
      verify,
      autoApplicable: f.autoApplicable !== false,
      risk: 'low',
      source: 'persona',
    });
  }

  // Un recorrido puede fallar antes de registrar un hallazgo (p. ej. el login
  // no llega a cargar): se propone igualmente para no perder el bloqueo.
  for (const p of personaReport?.personas || []) {
    if (p.status !== 'fail' || (p.findings || []).length) continue;
    push({
      key: `persona-run|${p.id}`,
      category: 'ux',
      priority: 'P1',
      title: `${p.name}: recorrido bloqueado`,
      why: (p.steps || []).find((s) => s.status === 'fail')?.detail || 'No pudo completar su objetivo.',
      evidence: { persona: p.id, friction: p.metrics?.friction ?? null },
      files: ['index.html', 'clases.html', 'tarifas.html', 'profile.html'],
      action: 'Reproducir el recorrido con la persona indicada, corregir el bloqueo y repetir la simulación completa.',
      verify,
      autoApplicable: true,
      risk: 'low',
      source: 'persona',
    });
  }

  // Oportunidades de rendimiento (aunque todo pase).
  const perf = health.perf;
  if (perf.ttfb && perf.ttfb > 500) {
    push({
      key: 'perf|ttfb', category: 'rendimiento', priority: 'P3',
      title: `TTFB alto (${perf.ttfb}ms)`, why: 'El primer byte tarda más de 500ms; en móvil se nota antes de ver contenido.',
      evidence: {}, files: ['index.html', 'img/', 'tailwind-compiled.css'],
      action: 'Revisar peso del HTML crítico, preload de fuentes/hero y caché de CDN.', verify, autoApplicable: true, risk: 'low', source: 'rendimiento',
    });
  }
  for (const p of perf.pages.filter((x) => x.ms > 2000).slice(0, 3)) {
    push({
      key: `perf|${p.page}`, category: 'rendimiento', priority: 'P3',
      title: `Página lenta: ${p.page} (${p.ms}ms)`, why: 'Supera 2s de carga completa; afecta a la conversión en móvil.',
      evidence: {}, files: filesForCategory('rendimiento'),
      action: 'Medir con red lenta, reducir peticiones/bloqueos y revisar imágenes del hero.', verify, autoApplicable: true, risk: 'low', source: 'rendimiento',
    });
  }

  // Cobertura incompleta: si el propio chequeo se rompió, eso es lo primero.
  if (health.coverage.ratio < 0.9 && health.coverage.missing.length) {
    push({
      key: 'coverage|missing', category: 'infra', priority: 'P1',
      title: `Cobertura del chequeo incompleta (${health.coverage.present}/${health.coverage.expected})`,
      why: `No se ejecutaron: ${health.coverage.missing.join(', ')}. Un verde con cobertura incompleta no es un verde.`,
      evidence: {}, files: ['scripts/check-nightly-production.mjs', 'scripts/check-extended.mjs', 'scripts/personas-simulation.mjs'],
      action: 'Revisar el primer error del runner y restaurar las suites que faltan.', verify, autoApplicable: true, risk: 'low', source: 'cobertura',
    });
  }

  // Datos de prueba insuficientes: una sola propuesta, no cinco ruidos.
  if (health.warnings.data > 0) {
    push({
      key: 'data|coverage', category: 'datos', priority: 'P3',
      title: `Cobertura de datos de prueba insuficiente (${health.warnings.data} aviso(s))`,
      why: 'Reservas, citas o bonos ausentes hacen que el chequeo no pueda ejercer esos caminos: un verde parcial.',
      evidence: {}, files: ['scripts/check-nightly-production.mjs', 'supabase/migrations/'],
      action: 'Crear un usuario de pruebas con bono y una reserva/cita de test, o usar un entorno de cert con datos sembrados.', verify,
      autoApplicable: false, requires: 'Datos de prueba en Supabase (no es un cambio de código).', risk: 'low', source: 'datos',
    });
  }

  const items = raw
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.category.localeCompare(b.category))
    .slice(0, 20)
    .map((it, i) => ({ id: `M${String(i + 1).padStart(2, '0')}`, ...it }));
  const signatureRaw = items.map((i) => `${i.category}|${normalizeDetail(i.title)}|${i.priority}`).join('|');
  return {
    date: fullReport?.date || action?.date || new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    env,
    base: action?.base || fullReport?.base || 'https://genyoga.studio',
    health,
    summary: {
      total: items.length,
      p1: items.filter((i) => i.priority === 'P1').length,
      p2: items.filter((i) => i.priority === 'P2').length,
      p3: items.filter((i) => i.priority === 'P3').length,
      auto: items.filter((i) => i.autoApplicable).length,
      manual: items.filter((i) => !i.autoApplicable).length,
    },
    items,
    signature: createHash('sha1').update(signatureRaw).digest('hex').slice(0, 12),
  };
}

function cleanWarningTitle(text) {
  const parts = String(text).split('—');
  return (parts[0] || text).trim().slice(0, 90);
}

function filesForCategory(category) {
  switch (category) {
    case 'a11y': return ['index.html', 'clases.html', 'tarifas.html', 'maestros.html', 'profile.html', 'tailwind-compiled.css'];
    case 'seo': return ['index.html', 'sitemap.xml', 'robots.txt'];
    case 'pwa': return ['manifest.json', 'index.html', 'img/'];
    case 'i18n': return ['i18n.js', 'index.html', 'clases.html'];
    case 'rendimiento': return ['img/', 'index.html', 'tailwind-compiled.css'];
    case 'infra': return ['supabase/functions/', '.github/workflows/'];
    case 'datos': return ['supabase/migrations/', 'scripts/check-nightly-production.mjs'];
    default: return ['index.html', 'clases.html', 'tarifas.html'];
  }
}

function actionForCategory(category, detail) {
  switch (category) {
    case 'a11y':
      return 'Corregir el hallazgo en el HTML/CSS (nombre accesible, alt, contraste, foco o etiqueta) y revalidar con la persona de teclado.';
    case 'seo':
      return 'Añadir o corregir metadatos/JSON-LD/sitemap y comprobar que la URL responde.';
    case 'pwa':
      return 'Publicar/completar el manifest y sus iconos; verificar instalación en móvil.';
    case 'i18n':
      return 'Sincronizar la clave i18n que falta en ES/EN y comprobar el cambio de idioma.';
    case 'infra':
      return 'Revisar el despliegue indicado; no cambiar código web para tapar un problema de infraestructura.';
    case 'rendimiento':
      return 'Optimizar el recurso indicado (peso, preload, caché o peticiones) y volver a medir.';
    default:
      return `Revisar el hallazgo y aplicar la corrección mínima: ${String(detail).slice(0, 120)}`;
  }
}

export function renderPlanMarkdown(plan) {
  const h = plan.health;
  const s = plan.summary;
  const L = [];
  L.push(`# 🧭 Plan de mejoras detectadas · ${plan.env === 'certificacion' ? 'Certificación' : 'Producción'}`);
  L.push('');
  L.push(`> **${s.total} propuesta(s)** · ${s.p1} P1 · ${s.p2} P2 · ${s.p3} P3 · ${s.auto} auto-aplicables`);
  L.push(`> Salud funcional **${h.functionalScore}/100** · experiencia **${h.experienceScore}/100** · global **${h.score}/100 (${h.grade})**`);
  L.push('');
  L.push(`Base: ${plan.base} · Fecha: ${plan.date}`);
  L.push('');
  if (h.penalties?.length) {
    L.push('### Por qué esta puntuación');
    L.push('');
    for (const p of h.penalties) L.push(`- ${p.side === 'functional' ? '⚙️' : '🎨'} **${p.label}** (−${p.points} pts)`);
    L.push('');
  }
  if (h.coverage && h.coverage.ratio < 1) {
    L.push(`> ⚠️ Cobertura del chequeo: **${h.coverage.present}/${h.coverage.expected}** suites. Faltan: ${h.coverage.missing.join(', ')}.`);
    L.push('');
  }
  if (h.personas) {
    L.push(`> 🧑‍🤝‍🧑 Personas: ${h.personas.passed}/${h.personas.total} recorridos limpios · fricción media **${h.personas.friction}/100** · ${h.personas.deadEnds} bloqueo(s) · ${h.personas.findings} hallazgo(s).`);
    L.push('');
  }
  if (h.severity && (h.severity.high || h.severity.medium || h.severity.low)) {
    L.push(`> Severidad: 🔴 ${h.severity.high} alta · 🟠 ${h.severity.medium} media · 🟡 ${h.severity.low} baja. Fallos nuevos: ${h.newFailures} · recurrentes: ${h.recurringFailures} · resueltos: ${h.resolvedFailures}.`);
    L.push('');
  }
  if (!plan.items.length) {
    L.push('## 🟢 No hay mejoras pendientes');
    L.push('');
    L.push('El chequeo no ha detectado defectos ni oportunidades accionables. Nada que aplicar.');
    L.push('');
    return L.join('\n');
  }
  L.push('## Cómo aplicar este plan');
  L.push('');
  L.push('- **Con IA, desde GitHub**: añade la etiqueta `aplicar-mejoras` a este issue. El workflow `apply-improvements` ejecutará OpenCode sobre los puntos auto-aplicables, verificará y abrirá un PR.');
  L.push('- **Con IA, en local**: `npm run mejoras:aplicar -- --solo M01,M02` (o `npm run mejoras:aplicar -- --max 3`).');
  L.push('- **Solo revisar**: `npm run mejoras` regenera este plan sin tocar código.');
  L.push('- Los puntos marcados `manual` requieren Supabase/Stripe o datos de prueba: la IA no los aplicará.');
  L.push('');
  for (const it of plan.items) {
    L.push(`## ${it.id} · ${it.priority} · ${it.title}`);
    L.push('');
    L.push(`- **Categoría:** ${it.category} · **Riesgo:** ${it.risk} · **Aplicación:** ${it.autoApplicable ? 'automática (código)' : 'manual'}`);
    L.push(`- **Por qué:** ${String(it.why).replace(/\n/g, ' ').slice(0, 400)}`);
    if (it.files?.length) L.push(`- **Archivos:** ${it.files.map((f) => `\`${f}\``).join(', ')}`);
    if (it.requires) L.push(`- **Requiere:** ${it.requires}`);
    if (it.evidence?.url) L.push(`- **Evidencia:** ${it.evidence.url}`);
    if (it.evidence?.screenshot) L.push(`- **Captura:** \`${it.evidence.screenshot}\``);
    L.push(`- **Acción:** ${it.action}`);
    L.push(`- **Verificar:** \`${it.verify}\``);
    L.push('');
  }
  L.push('---');
  L.push('*Generado por el bucle nocturno. Un plan no es una predicción: cada propuesta debe verificarse con la suite completa antes de publicar.*');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- carga local
export function reportsDir(root = process.cwd()) {
  return path.join(root, 'nightly-reports');
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function actionFromFull(full) {
  if (!full) return null;
  if (Array.isArray(full.failures)) return full;
  return {
    ...full,
    failures: (full.errors || []).map((e, i) => ({
      id: `F${String(i + 1).padStart(2, '0')}`, suite: 'desconocido', check: String(e), detail: String(e),
      severity: 'medium', suspectedFiles: [], url: '', evidence: { console: [], screenshot: null },
    })),
    warningDetails: (full.warnings || []).map((w) => ({ suite: 'desconocido', name: String(w), detail: '', meta: {} })),
  };
}

function latestFullFile(dir, prefix) {
  try {
    return readdirSync(dir).filter((f) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f)).sort().pop() || null;
  } catch { return null; }
}

export function loadLatestAction(root = process.cwd(), env = 'produccion') {
  try {
    const dir = reportsDir(root);
    const prefix = env === 'certificacion' ? 'cert' : 'nightly';
    const latest = latestFullFile(dir, prefix);
    // El action diario es inmutable y casa con el informe de su fecha. El
    // `-action.json` fijo solo se usa si no hay informe diario (o es más nuevo).
    if (latest) {
      const dated = readJson(path.join(dir, latest.replace(/\.json$/, '-action.json')));
      if (dated) return dated;
      const direct = readJson(path.join(dir, `${prefix}-action.json`));
      const full = readJson(path.join(dir, latest));
      if (direct && String(direct.date || '') >= String(full?.date || '')) return direct;
      return actionFromFull(full);
    }
    return readJson(path.join(dir, `${prefix}-action.json`));
  } catch { return null; }
}

export function loadLatestFull(root = process.cwd(), env = 'produccion') {
  try {
    const dir = reportsDir(root);
    const prefix = env === 'certificacion' ? 'cert' : 'nightly';
    const file = latestFullFile(dir, prefix);
    return file ? readJson(path.join(dir, file)) : null;
  } catch { return null; }
}

export function loadLatestPersonas(root = process.cwd()) {
  try {
    const dir = reportsDir(root);
    const file = readdirSync(dir).filter((f) => /^personas-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
    return file ? readJson(path.join(dir, file)) : null;
  } catch { return null; }
}

export function loadPreviousAction(root = process.cwd(), env = 'produccion') {
  try {
    const dir = reportsDir(root);
    const prefix = env === 'certificacion' ? 'cert' : 'nightly';
    const files = readdirSync(dir).filter((f) => new RegExp(`^${prefix}-\\d{4}-\\d{2}-\d{2}\\.json$`).test(f)).sort();
    // Preferir los action diarios: conservan suite/severidad/firma. Los
    // informes antiguos solo traían `errors` como texto y hacían que todo
    // fallo pareciera nuevo cada noche.
    const actions = readdirSync(dir)
      .filter((f) => f.startsWith(`${prefix}-`) && /^\d{4}-\d{2}-\d{2}-action\.json$/.test(f.slice(prefix.length + 1)))
      .sort();
    const latestReportDate = files.length ? files[files.length - 1].slice(prefix.length + 1, prefix.length + 11) : '';
    const candidates = actions
      .map((f) => ({ date: f.slice(prefix.length + 1, prefix.length + 11), file: f }))
      .filter((x) => x.date < latestReportDate);
    if (candidates.length) return readJson(path.join(dir, candidates[candidates.length - 1].file));
    if (files.length < 2) return null;
    return actionFromFull(readJson(path.join(dir, files[files.length - 2])));
  } catch { return null; }
}
