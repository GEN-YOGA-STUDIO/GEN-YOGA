// scripts/a11y-audit.mjs
// Auditoría de accesibilidad y UX medible, sin dependencias externas.
//
// Se usa desde:
//   - scripts/check-extended.mjs  (chequeo nocturno: suite `a11y`)
//   - scripts/personas-simulation.mjs (persona con teclado / baja visión)
//
// Filosofía: medir hechos comprobables (nombres accesibles, alt, foco visible,
// contraste real, tamaño de objetivo táctil) y separar lo crítico de lo
// cosmético. Un fallo crítico rompe el recorrido de una persona real; el resto
// se reporta como aviso accionable (y alimenta el plan de mejoras).

const CONTRAST_MIN = 4.5;
const CONTRAST_MIN_LARGE = 3;
const MIN_FONT_PX = 12;
const MIN_TARGET_PX = 24;

// Se ejecuta dentro del navegador. Devuelve datos crudos; el juicio se hace
// fuera para que las reglas sean auditables y fáciles de ajustar.
const collectA11y = () => {
  const CONTRAST_MIN = 4.5;
  const CONTRAST_MIN_LARGE = 3;
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0;
  };
  const ownText = (el) => [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent || '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const accName = (el) => {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const txt = labelledby.split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || '')
        .join(' ').replace(/\s+/g, ' ').trim();
      if (txt) return txt;
    }
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (txt) return txt;
    const img = el.querySelector('img[alt]');
    return ((img && img.getAttribute('alt')) || '').trim();
  };
  const parseColor = (raw) => {
    const m = String(raw || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)/i);
    if (!m) return null;
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? Number(m[4]) / 100 : Number(m[4]);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number.isFinite(a) ? a : 1 };
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const solidBg = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parseColor(s.backgroundColor);
      if (c && c.a >= 0.9) return c;
      node = node.parentElement;
    }
    const body = parseColor(getComputedStyle(document.body).backgroundColor);
    if (body && body.a >= 0.9) return body;
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const all = [...document.querySelectorAll('body *')];
  const imgsNoAlt = all.filter((el) => el.tagName === 'IMG' && el.getAttribute('alt') === null);
  const namelessInteractive = [...document.querySelectorAll('button, a[href], [role="button"], [role="link"], input[type="submit"], input[type="button"]')]
    .filter(isVisible)
    .filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'))
    .filter((el) => !accName(el));
  const controls = [...document.querySelectorAll('input:not([type="hidden"]), select, textarea')]
    .filter(isVisible)
    .filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return false;
      if (el.labels && el.labels.length > 0) return false;
      const placeholder = (el.getAttribute('placeholder') || '').trim();
      return !placeholder;
    });
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    ids.set(el.id, (ids.get(el.id) || 0) + 1);
  }
  const duplicateIds = [...ids.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  const smallTargets = [...document.querySelectorAll('button, a[href], input, select, [role="button"]')]
    .filter(isVisible)
    .filter((el) => {
      const r = el.getBoundingClientRect();
      // Los enlaces dentro de un párrafo son texto en línea: no son "targets" táctiles.
      if (el.tagName === 'A' && el.closest('p, li') && getComputedStyle(el).display.includes('inline')) return false;
      return r.width < 24 || r.height < 24;    })
    .slice(0, 40)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (accName(el) || el.getAttribute('href') || '').slice(0, 40),
      w: Math.round(el.getBoundingClientRect().width),
      h: Math.round(el.getBoundingClientRect().height),
    }));

  const contrastFailures = [];
  const smallText = [];
  const textNodes = [...document.querySelectorAll('p, li, span, a, button, label, h1, h2, h3, h4, h5, h6, td, th, small, strong, em')]
    .filter(isVisible)
    .filter((el) => ownText(el).length > 1);
  const seenText = new Set();
  for (const el of textNodes) {
    const text = ownText(el);
    if (seenText.has(text)) continue;
    seenText.add(text);
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize) || 16;
    if (size <= 0) continue;
    if (size < 12) {
      smallText.push({ text: text.slice(0, 40), size: Math.round(size * 10) / 10 });
    }
    // Solo texto sobre fondo sólido y sin imagen: el resto no es medible con fiabilidad.
    const bg = solidBg(el);
    if (!bg) continue;
    const fgRaw = parseColor(s.color);
    if (!fgRaw) continue;
    const fg = fgRaw.a < 1 ? blend(fgRaw, bg) : fgRaw;
    const cr = ratio(fg, bg);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    const min = large ? CONTRAST_MIN_LARGE : CONTRAST_MIN;
    if (cr + 0.01 < min) {
      contrastFailures.push({
        text: text.slice(0, 48), ratio: Math.round(cr * 100) / 100, min,
        size: Math.round(size), color: s.color, background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      });
    }
  }

  const viewportContent = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
  const zoomDisabled = /user-scalable\s*=\s*(no|0)/i.test(viewportContent)
    || /maximum-scale\s*=\s*(1(\.0+)?|0?\.\d+)\s*(,|$)/i.test(viewportContent);

  const h1Count = [...document.querySelectorAll('h1')].filter(isVisible).length;
  const images = all.filter((el) => el.tagName === 'IMG');

  // Skip link: enlace que salta al contenido principal
  const skipLink = [...document.querySelectorAll('a[href^="#"]')].some((a) => {
    const text = (a.innerText || a.getAttribute('aria-label') || '').toLowerCase();
    return text.includes('saltar') || text.includes('skip') || text.includes('contenido') || text.includes('main');
  });

  // Jerarquía de títulos: h1 → h2 → h3 (sin saltos)
  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(isVisible);
  const headingIssues = [];
  let lastLevel = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (lastLevel > 0 && level > lastLevel + 1) {
      headingIssues.push(`${h.tagName} después de h${lastLevel}`);
    }
    lastLevel = level;
  }

  return {
    url: location.href,
    lang: document.documentElement.lang || '',
    viewport: viewportContent,
    zoomDisabled,
    h1Count,
    imgsNoAlt: imgsNoAlt.slice(0, 8).map((el) => (el.getAttribute('src') || '').slice(0, 90)),
    imgsTotal: images.length,
    namelessInteractive: namelessInteractive.slice(0, 8).map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      href: el.getAttribute('href') || '',
    })),
    unlabeledControls: controls.slice(0, 8).map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      type: el.getAttribute('type') || '',
      placeholder: el.getAttribute('placeholder') || '',
    })),
    duplicateIds: duplicateIds.slice(0, 10),
    smallTargets,
    smallText: smallText.slice(0, 10),
    contrastFailures: contrastFailures.sort((a, b) => a.ratio - b.ratio).slice(0, 8),
    contrastChecked: seenText.size,
    hasSkipLink: skipLink,
    headingIssues,
  };
};

/**
 * @param {import('playwright-core').Page} page
 * @param {string} label nombre legible de la página (para el informe)
 * @param {{mobile?: boolean}} [opts]
 * @returns {Promise<{label: string, issues: Array, metrics: object, status: 'pass'|'warn'|'fail'}>}
 */
export async function auditA11y(page, label, opts = {}) {
  const raw = await page.evaluate(collectA11y).catch((e) => ({ __error: String((e && e.message) || e) }));
  if (!raw || raw.__error) {
    return {
      label, status: 'warn', issues: [{ code: 'a11y-eval', severity: 'low', detail: `no se pudo auditar la página: ${raw?.__error || 'sin datos'}` }], metrics: {},
    };
  }
  const issues = [];
  const push = (code, severity, detail, extra = {}) => issues.push({ code, severity, detail, ...extra });

  if (!raw.lang) push('a11y-lang', 'medium', 'La página no declara <html lang>, los lectores de pantalla no saben en qué idioma leer.');
  if (raw.zoomDisabled) push('a11y-zoom', 'high', 'El viewport bloquea el zoom (user-scalable=no / maximum-scale=1): impide ampliar a personas con baja visión.');
  if (raw.imgsNoAlt.length) push('a11y-img-alt', 'medium', `${raw.imgsNoAlt.length} imagen(es) sin atributo alt (${raw.imgsNoAlt.slice(0, 3).join(', ')}).`);
  if (raw.namelessInteractive.length) {
    push('a11y-name', 'medium', `${raw.namelessInteractive.length} botón(es)/enlace(s) sin nombre accesible (${raw.namelessInteractive.slice(0, 3).map((x) => x.id || x.href || x.tag).join(', ')}).`);
  }
  if (raw.unlabeledControls.length) {
    push('a11y-label', 'medium', `${raw.unlabeledControls.length} campo(s) sin etiqueta visible ni aria-label (${raw.unlabeledControls.slice(0, 3).map((x) => x.id || x.placeholder || x.type).join(', ')}).`);
  }
  if (raw.duplicateIds.length) push('a11y-duplicate-id', 'medium', `IDs duplicados (${raw.duplicateIds.slice(0, 4).join(', ')}): rompen labels y anclas.`);
  if (raw.h1Count === 0) push('a11y-h1', 'low', 'La página no tiene un H1 visible: empeora la orientación y el SEO.');
  if (raw.h1Count > 1) push('a11y-h1-multiple', 'low', `${raw.h1Count} H1 visibles: la jerarquía de títulos es ambigua.`);
  if (!raw.hasSkipLink) push('a11y-skip-link', 'low', 'No hay enlace "saltar al contenido": dificulta la navegación con teclado.');
  if (raw.headingIssues && raw.headingIssues.length) push('a11y-heading-hierarchy', 'low', `Jerarquía de títulos incorrecta: ${raw.headingIssues.slice(0, 3).join(', ')}.`);
  if (raw.smallText.length) push('a11y-font', 'low', `${raw.smallText.length} texto(s) por debajo de ${MIN_FONT_PX}px (${raw.smallText.slice(0, 3).map((x) => `${x.text} ${x.size}px`).join(' · ')}).`);
  if (raw.contrastFailures.length) {
    const worst = raw.contrastFailures[0];
    // Etiquetas cortas (pestañas, botones) se corrigen como aviso; un párrafo
    // realmente ilegible (<2:1 y texto largo) sí bloquea.
    const severity = worst.ratio < 2 && worst.text.length > 25 ? 'high' : 'medium';
    push('a11y-contrast', severity, `${raw.contrastFailures.length} texto(s) con contraste insuficiente; el peor "${worst.text}" ${worst.ratio}:1 (mínimo ${worst.min}:1).`, { samples: raw.contrastFailures.slice(0, 5) });
  }
  if (opts.mobile && raw.smallTargets.length > 8) {
    push('a11y-target', 'low', `${raw.smallTargets.length} objetivos táctiles menores de ${MIN_TARGET_PX}px (${raw.smallTargets.slice(0, 3).map((x) => `${x.tag} ${x.w}x${x.h}`).join(', ')}).`);
  }

  const status = issues.some((i) => i.severity === 'high') ? 'fail'
    : issues.length ? 'warn' : 'pass';
  return {
    label,
    status,
    issues,
    metrics: {
      lang: raw.lang,
      h1: raw.h1Count,
      imgs: raw.imgsTotal,
      contrastChecked: raw.contrastChecked,
      smallTargets: raw.smallTargets.length,
      smallText: raw.smallText.length,
      worstContrast: raw.contrastFailures[0]?.ratio ?? null,
      duplicateIds: raw.duplicateIds,
      hasSkipLink: raw.hasSkipLink,
      headingIssues: raw.headingIssues?.length ?? 0,
    },
  };
}

/**
 * Recorre la página solo con Tab y comprueba que el foco sea visible.
 * @param {import('playwright-core').Page} page
 * @param {{maxTabs?: number, dismiss?: () => Promise<void>}} [opts]
 */
export async function auditKeyboard(page, opts = {}) {
  const maxTabs = opts.maxTabs ?? 14;
  if (opts.dismiss) await opts.dismiss().catch(() => {});
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }).catch(() => {});
  const stops = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(90);
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return { end: true };
      const s = getComputedStyle(el);
      const outlineVisible = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth || '0') > 0;
      const shadowVisible = Boolean(s.boxShadow && s.boxShadow !== 'none');
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('href') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        ring: outlineVisible || shadowVisible,
        outline: `${s.outlineStyle} ${s.outlineWidth}`,
        shadow: (s.boxShadow || '').slice(0, 60),
        visible: r.width > 0 && r.height > 0,
        isDocument: el === document.body || el === document.documentElement,
      };
    }).catch(() => ({ end: true }));
    if (info.end) break;
    // El navegador pasa por <body> entre bloques: es un stop técnico, no un control.
    if (info.isDocument) continue;
    if (info.visible) stops.push(info);
  }
  const invisible = stops.filter((s) => !s.ring);
  return {
    stops,
    invisible,
    status: invisible.length >= 2 ? 'fail' : invisible.length === 1 ? 'warn' : 'pass',
  };
}

export { CONTRAST_MIN, MIN_FONT_PX, MIN_TARGET_PX };
