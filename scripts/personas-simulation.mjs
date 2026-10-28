// scripts/personas-simulation.mjs
// Simulación de personas reales usando la aplicación (no "clicks sueltos").
//
// Tres recorridos completos, con objetivos y fricción medible:
//   1. Lucía (29, móvil, llega desde Instagram): descubrir → horario → tarifas
//      → intención de compra, sin salir jamás a Stripe.
//   2. Marta (41, escritorio, alumna): login → inicio → horarios → reserva
//      (cancelada) → perfil → logout.
//   3. Carmen (66, teclado/baja visión): navegación solo con Tab, foco visible,
//      zoom, contraste y etiquetas.
//   4. Dani (24, red lenta) solo con --full: primera pantalla útil con 3G.
//
// Reglas duras: 0 reservas/compras/escrituras. Todos los diálogos se cancelan.
//
// Uso CLI:
//   node scripts/personas-simulation.mjs
//   node scripts/personas-simulation.mjs --persona nueva-visitante --json
//   node scripts/personas-simulation.mjs --full --cert
//   node scripts/personas-simulation.mjs --out nightly-reports
//
// Integración: scripts/check-nightly-production.mjs importa simulatePersonas()
// y vuelca el resultado en el informe nocturno.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditA11y, auditKeyboard } from './a11y-audit.mjs';

export const PERSONAS = {
  'nueva-visitante': {
    name: 'Lucía', age: 29, device: 'Móvil 390×844', context: 'llega desde Instagram',
    goal: 'Descubrir el estudio y decidir si reserva su primera clase',
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    steps: [
      ['landing', 'Abrir la landing y entender qué ofrece el estudio'],
      ['oferta', 'Recibir y cerrar la oferta de bienvenida'],
      ['clases', 'Entrar en Clases y ver las categorías'],
      ['horario', 'Consultar el horario semanal real'],
      ['tarifas', 'Comparar precios y bonos'],
      ['compra', 'Llegar a la intención de compra sin pagar'],
      ['idioma', 'Cambiar a inglés y volver a español'],
    ],
  },
  'alumna-habitual': {
    name: 'Marta', age: 41, device: 'Escritorio 1440×900', context: 'alumna con cuenta',
    goal: 'Entrar, ver su próxima clase y gestionar una reserva',
    viewport: { width: 1440, height: 900 },
    steps: [
      ['login', 'Iniciar sesión con el usuario de pruebas'],
      ['inicio', 'Ver el resumen personal (saldos y próximas clases)'],
      ['horarios', 'Encontrar un día con clases y abrir su agenda'],
      ['reserva', 'Abrir el diálogo de reserva y cancelarlo'],
      ['perfil', 'Abrir la edición de perfil y cancelar'],
      ['logout', 'Cerrar sesión y comprobar que la sesión no persiste'],
    ],
  },
  'teclado': {
    name: 'Carmen', age: 66, device: 'Escritorio 1280×800', context: 'usa teclado y baja visión',
    goal: 'Navegar sin ratón y leer con comodidad',
    viewport: { width: 1280, height: 800 },
    steps: [
      ['bienvenida', 'Cerrar la bienvenida solo con teclado'],
      ['foco', 'Recorrer la landing con Tab y ver dónde está el foco'],
      ['zoom', 'Comprobar que el navegador puede ampliar'],
      ['lectura', 'Medir contraste, etiquetas y textos clave'],
    ],
  },
  'red-lenta': {
    name: 'Dani', age: 24, device: 'Móvil 3G lento', context: 'conexión inestable',
    goal: 'Que la web cargue y se pueda usar con mala cobertura',
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    steps: [['carga', 'Abrir la landing con 3G lento']],
  },
};

const FILES_BY_PAGE = {
  landing: ['index.html', 'i18n.js', 'flash-welcome'],
  clases: ['clases.html', 'public-calendar.js', 'public-calendar.css'],
  tarifas: ['tarifas.html'],
  login: ['profile.html'],
  maestros: ['maestros.html'],
};

const OPTIONAL_WARN = (msg) => Object.assign(new Error(msg), { warnOnly: true });
const FAIL = (msg) => new Error(msg);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function assert(cond, msg, opts = {}) {
  if (cond) return;
  throw opts.warn ? OPTIONAL_WARN(msg) : FAIL(msg);
}

function cleanText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

class Journey {
  constructor({ browser, base, personaId, email, password, artifactsDir, log }) {
    this.browser = browser;
    this.base = String(base).replace(/\/+$/, '');
    this.personaId = personaId;
    this.persona = PERSONAS[personaId];
    this.email = email;
    this.password = password;
    this.artifactsDir = artifactsDir;
    this.log = log;
    this.ctx = null;
    this.page = null;
    this.steps = [];
    this.findings = [];
    this.clicks = 0;
    this.dialogs = 0;
    this.deadEnds = 0;
    this.consoleErrors = [];
    this.t0 = Date.now();
  }

  async open() {
    this.ctx = await this.browser.newContext({
      viewport: this.persona.viewport,
      isMobile: Boolean(this.persona.isMobile),
      hasTouch: Boolean(this.persona.hasTouch),
      locale: 'es-ES',
    });
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(15000);
    this.page.on('pageerror', (e) => this.consoleErrors.push(String(e.message).slice(0, 200)));
    this.page.on('dialog', (d) => d.dismiss().catch(() => {}));
    return this;
  }

  async close() {
    await this.ctx?.close().catch(() => {});
  }

  async tap(locator, opts = {}) {
    this.clicks++;
    await locator.click(opts).catch((e) => { throw e; });
  }

  async step(id, title, fn) {
    const s0 = Date.now();
    const findingsBefore = this.findings.length;
    this.log(`  · ${this.persona.name}: ${title}`);
    try {
      const detail = await fn();
      this.steps.push({ id, title, status: 'pass', ms: Date.now() - s0, detail: cleanText(detail) });
    } catch (e) {
      const warnOnly = Boolean(e && e.warnOnly);
      const detail = cleanText((e && e.message) || e);
      const status = warnOnly ? 'warn' : 'fail';
      this.steps.push({ id, title, status, ms: Date.now() - s0, detail });
      // Si el paso ya registró hallazgos concretos (a11y, foco...), no se
      // duplica con un hallazgo-resumen del paso: el plan ya tiene el detalle.
      if (this.findings.length === findingsBefore) {
        this.findings.push({
          code: `persona-${this.personaId}-${id}`,
          severity: warnOnly ? 'low' : 'high',
          title: `${this.persona.name} · ${title}`,
          detail,
          step: id,
          files: this.suspectedFiles(id),
          autoApplicable: true,
        });
      }
      if (!warnOnly) this.deadEnds++;
      if (this.artifactsDir) {
        const name = `persona-${this.personaId}-${id}-${Date.now()}.png`;
        await this.page.screenshot({ path: path.join(this.artifactsDir, 'img', name) }).catch(() => {});
      }
    }
  }

  suspectedFiles(stepId) {
    if (stepId === 'lectura') return ['index.html', 'clases.html', 'tarifas.html', 'profile.html', 'i18n.js'];
    return FILES_BY_PAGE[stepId] || ['index.html', 'clases.html', 'tarifas.html'];
  }

  async goto(p, settle = 2200) {
    await this.page.goto(`${this.base}${p}`, { waitUntil: 'load', timeout: 45000 });
    await this.page.waitForTimeout(settle);
  }

  async dismissWelcome({ required = false } = {}) {
    const modal = this.page.locator('#flash-welcome-modal');
    const isOpen = await modal.evaluate((el) => {
      const s = getComputedStyle(el);
      return !el.classList.contains('pointer-events-none') && s.display !== 'none' && Number(s.opacity) > 0.01;
    }).catch(() => false);
    if (!isOpen) {
      if (required) throw OPTIONAL_WARN('La oferta de bienvenida no aparece para una visitante nueva.');
      return false;
    }
    const close = this.page.locator('#flash-welcome-modal button[onclick="cerrarFlashWelcomeModal()"]').first();
    await this.tap(close, { timeout: 5000 });
    await this.page.waitForTimeout(700);
    const still = await modal.evaluate((el) => {
      const s = getComputedStyle(el);
      return !el.classList.contains('pointer-events-none') && s.display !== 'none' && Number(s.opacity) > 0.01;
    }).catch(() => false);
    if (still) throw FAIL('La oferta de bienvenida sigue interceptando la pantalla tras pulsar la X.');
    return true;
  }

  async visibleDialogText() {
    const dlg = this.page.locator('.swal2-popup:visible').first();
    await dlg.waitFor({ state: 'visible', timeout: 12000 });
    this.dialogs++;
    return cleanText((await dlg.innerText().catch(() => '')) || '');
  }

  async cancelDialog() {
    await this.page.locator('.swal2-cancel').click({ timeout: 5000 }).catch(async () => {
      await this.page.keyboard.press('Escape');
    });
    await this.page.waitForTimeout(700);
    return (await this.page.locator('.swal2-popup:visible').count().catch(() => 1)) === 0;
  }

  bodyText() { return this.page.locator('body').innerText().catch(() => ''); }

  async navTo(pageFile, label) {
    const btn = this.page.locator(`button[onclick*="${pageFile}"]:visible`).first();
    if (!(await btn.count())) throw FAIL(`No encuentro la navegación a ${label}.`);
    await this.tap(btn);
    await this.page.waitForTimeout(2500);
    const url = this.page.url();
    if (!url.includes(pageFile.replace(/^\.\//, ''))) throw FAIL(`"${label}" no navegó (${url}).`);
    return url;
  }

  async run() {
    await this.open();
    try {
      if (this.personaId === 'nueva-visitante') await this.journeyNewVisitor();
      else if (this.personaId === 'alumna-habitual') await this.journeyStudent();
      else if (this.personaId === 'teclado') await this.journeyKeyboard();
      else if (this.personaId === 'red-lenta') await this.journeySlowNetwork();
    } finally {
      await this.close();
    }
    return this.report();
  }

  // ------------------------------------------------------------ Lucía
  async journeyNewVisitor() {
    await this.step('landing', 'Abrir la landing y entender qué ofrece el estudio', async () => {
      const t0 = Date.now();
      await this.goto('/', 1800);
      const loadMs = Date.now() - t0;
      const h1 = cleanText(await this.page.locator('h1').first().innerText().catch(() => ''));
      const body = await this.bodyText();
      assert(h1.length > 8, 'La landing no muestra un titular claro (H1 vacío).');
      assert(body.length > 500, 'La landing carga casi vacía.');
      assert(!/\b(NaN|undefined|\[object Object\])\b/.test(body), 'La landing muestra tokens corruptos (NaN/undefined/[object Object]).');
      assert(loadMs < 15000, `La landing tarda ${(loadMs / 1000).toFixed(1)}s en estar lista.`);
      if (loadMs > 7000) this.findings.push({ code: 'persona-nueva-landing-lenta', severity: 'medium', title: 'Landing lenta', detail: `${(loadMs / 1000).toFixed(1)}s hasta load`, files: ['index.html'], autoApplicable: true });
      return `${(loadMs / 1000).toFixed(1)}s · "${h1.slice(0, 70)}"`;
    });

    await this.step('oferta', 'Recibir y cerrar la oferta de bienvenida', async () => {
      const shown = await this.dismissWelcome({ required: true });
      assert(shown, 'La oferta no llegó a mostrarse.');
      const body = await this.bodyText();
      assert(/bono|bienvenida|gratis|0\s*€/i.test(body), 'La oferta no comunica el bono de bienvenida.');
      return 'aparece, se cierra y no bloquea';
    });

    await this.step('clases', 'Entrar en Clases y ver las categorías', async () => {
      await this.navTo('clases.html', 'Clases');
      const h1 = cleanText(await this.page.locator('h1').first().innerText().catch(() => ''));
      assert(/ESCOGE|CLASES/i.test(h1), `Clases no muestra su titular (${h1.slice(0, 40)}).`);
      const cats = await this.page.locator('#btn-cat-yoga, #btn-cat-consultas, #btn-cat-talleres').count().catch(() => 0);
      assert(cats === 3, `Faltan pestañas de categoría (${cats}/3).`);
      const dots = await this.page.locator('.slide-dot').count().catch(() => 0);
      assert(dots >= 3, `El carrusel no tiene controles suficientes (${dots}).`);
      return `3 categorías · ${dots} slides`;
    });

    await this.step('horario', 'Consultar el horario semanal real', async () => {
      for (const [btn] of [['#btn-cat-consultas'], ['#btn-cat-talleres'], ['#btn-cat-yoga']]) {
        const b = this.page.locator(`${btn}:visible`).first();
        if (await b.count()) {
          await this.tap(b).catch(() => {});
          await this.page.waitForTimeout(500);
        }
      }
      const launch = this.page.locator('#public-calendar-launch:visible').first();
      assert(await launch.count(), 'No hay botón "Ver horario" en Yoga.');
      await this.tap(launch);
      let opened = false;
      let days = 0;
      for (let i = 0; i < 10; i++) {
        await this.page.waitForTimeout(1000);
        opened = (await this.page.locator('#public-calendar-panel:visible').count().catch(() => 0)) > 0;
        days = await this.page.locator('#calendar-desktop [data-calendar-day], #calendar-mobile [data-calendar-day]').count().catch(() => 0);
        if (opened && days > 0) break;
      }
      assert(opened, 'El calendario público no se abre.');
      if (days === 0) {
        const next = this.page.locator('#public-calendar-panel button:visible', { hasText: /SEMANA SIGUIENTE/i }).first();
        assert(await next.count(), 'El calendario se abre pero no pinta días ni ofrece la semana siguiente.');
        await this.tap(next);
        await this.page.waitForTimeout(2500);
        days = await this.page.locator('#calendar-desktop [data-calendar-day], #calendar-mobile [data-calendar-day]').count().catch(() => 0);
        assert(days > 0, 'La semana siguiente tampoco pinta días.');
      }
      await this.page.locator('#public-calendar-close:visible').first().click({ timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(700);
      assert((await this.page.locator('#public-calendar-panel:visible').count().catch(() => 0)) === 0, 'La X no cierra el calendario.');
      return `${days} días visibles y cierre correcto`;
    });

    await this.step('tarifas', 'Comparar precios y bonos', async () => {
      await this.navTo('index.html', 'Inicio');
      await this.navTo('tarifas.html', 'Tarifas');
      await this.page.waitForTimeout(1800);
      const offers = await this.page.locator('#section-ofertas:visible').count().catch(() => 0);
      assert(offers > 0, 'La sección de ofertas no está visible en Tarifas.');
      const yogaTab = this.page.locator('#tab-yoga:visible').first();
      assert(await yogaTab.count(), 'No hay pestaña de tarifas de yoga.');
      await this.tap(yogaTab);
      await this.page.waitForTimeout(1500);
      const text = await this.bodyText();
      assert(/€/.test(text), 'Tarifas no muestra ningún precio en euros.');
      const ctas = await this.page.locator('#buy-single-class-button:visible, a[href*="profile.html?buy="]:visible, button[onclick*="Checkout"]:visible').count().catch(() => 0);
      assert(ctas > 0, 'No hay ningún botón de compra visible en Tarifas de yoga.');
      const consultas = this.page.locator('#tab-psicologia:visible').first();
      if (await consultas.count()) {
        await this.tap(consultas);
        await this.page.waitForTimeout(900);
        const psico = await this.bodyText();
        assert(/€/.test(psico), 'La pestaña de consultas no muestra precios.');
      }
      return `${ctas} CTA(s) de yoga y consultas con precios visibles`;
    });

    await this.step('compra', 'Llegar a la intención de compra sin pagar', async () => {
      if (!(await this.page.locator('#buy-single-class-button:visible').count().catch(() => 0))) {
        await this.page.locator('#tab-yoga:visible').first().click({ timeout: 5000 }).catch(() => {});
        await this.page.waitForTimeout(1200);
      }
      const cta = this.page.locator('#buy-single-class-button:visible, a[href*="profile.html?buy="]:visible, button[onclick*="Checkout"]:visible').first();
      await this.tap(cta);
      await this.page.waitForTimeout(2500);
      if (this.page.url().includes('checkout.stripe.com')) {
        this.deadEnds++;
        throw FAIL('El clic llevó directamente a Stripe sin confirmación: riesgo de cobro accidental.');
      }
      let detail = '';
      if (await this.page.locator('.swal2-popup:visible').count().catch(() => 0)) {
        detail = await this.visibleDialogText();
        assert(/comprar|clase|bono|invitad|precio|€|elegir/i.test(detail), `Diálogo de compra poco claro: "${detail.slice(0, 80)}"`);
        const closed = await this.cancelDialog();
        assert(closed, 'El diálogo de compra no se cierra al cancelar.');
        return `diálogo con "${detail.replace(/\s+/g, ' ').slice(0, 50)}" y cancelación limpia`;
      }
      if (this.page.url().includes('profile.html')) {
        detail = cleanText(await this.bodyText());
        assert(/login|entrar|registro|cuenta|contraseña/i.test(detail), 'El CTA llevó al perfil sin pedir cuenta ni explicar el siguiente paso.');
        return 'CTA lleva a login/registro de forma comprensible (sin cobro)';
      }
      throw FAIL(`El CTA no abrió diálogo ni llevó a un paso comprensible (${this.page.url()}).`);
    });

    await this.step('idioma', 'Cambiar a inglés y volver a español', async () => {
      await this.goto('/', 1800);
      await this.dismissWelcome();
      const before = cleanText(await this.page.locator('h1').first().innerText().catch(() => ''));
      const en = this.page.locator('#lang-btn-en:visible').first();
      assert(await en.count(), 'No hay selector de idioma EN visible.');
      await this.tap(en);
      await this.page.waitForTimeout(1300);
      const lang = await this.page.evaluate(() => document.documentElement.lang).catch(() => '');
      const after = cleanText(await this.page.locator('h1').first().innerText().catch(() => ''));
      assert(lang === 'en', `El idioma no cambia a EN (lang=${lang}).`);
      assert(after !== before, 'El titular no se traduce al cambiar a inglés.');
      const body = await this.bodyText();
      assert(!/\b(hero_|nav_|rate_|common_)/.test(body), 'Quedan claves i18n sin traducir en pantalla.');
      await this.page.locator('#lang-btn-es:visible').first().click({ timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(900);
      const back = await this.page.evaluate(() => document.documentElement.lang).catch(() => '');
      assert(back === 'es', `No vuelve a español (lang=${back}).`);
      return `"${before.slice(0, 26)}" → "${after.slice(0, 26)}" → ES`;
    });
  }

  // ------------------------------------------------------------ Marta
  async journeyStudent() {
    let endedAtLogin = false;
    await this.step('login', 'Iniciar sesión con el usuario de pruebas', async () => {
      await this.goto('/profile.html', 3000);
      await this.page.locator('#login-email').fill(this.email);
      await this.page.locator('#login-password').fill(this.password);
      const t0 = Date.now();
      await this.page.locator('#form-login button[type="submit"]').click();
      await this.page.locator('#app-view:visible').waitFor({ state: 'visible', timeout: 22000 });
      const ms = Date.now() - t0;
      await this.page.waitForTimeout(2500);
      const name = cleanText(await this.page.locator('#profile-nombre-full').innerText().catch(() => ''));
      assert(name.length > 1, 'El panel abre sin nombre de usuaria.');
      assert(ms < 12000, `El login tarda ${(ms / 1000).toFixed(1)}s.`);
      return `${name} · ${(ms / 1000).toFixed(1)}s`;
    });

    await this.step('inicio', 'Ver el resumen personal (saldos y próximas clases)', async () => {
      const nav = this.page.locator('#nav-public-inicio:visible').first();
      if (await nav.count()) { await this.tap(nav); await this.page.waitForTimeout(1200); }
      const saldos = await this.page.locator('#profile-saldos-wrapper').innerText().catch(() => '');
      assert(saldos.length > 0, 'El resumen no muestra saldos/bonos.');
      assert(!/\b(NaN|undefined|Invalid Date)\b/i.test(saldos), `Saldos con valores corruptos: "${cleanText(saldos).slice(0, 80)}"`);
      const empty = await this.page.locator('#inicio-empty-state').isVisible().catch(() => false);
      const reservas = await this.page.locator('#inicio-consolidado-container > *:visible').count().catch(() => 0);
      assert(empty || reservas > 0, 'El inicio no muestra ni próximas clases ni un estado vacío claro.');
      return `${empty ? 'estado vacío claro' : `${reservas} bloque(s) de reservas`} · saldos legibles`;
    });

    await this.step('horarios', 'Encontrar un día con clases y abrir su agenda', async () => {
      const nav = this.page.locator('#nav-public-horarios:visible').first();
      assert(await nav.count(), 'No hay pestaña de Clases/Horarios.');
      await this.tap(nav);
      await this.page.waitForTimeout(2500);
      const days = await this.page.locator('#calendar-grid .calendar-day.has-classes:not(.disabled)').count().catch(() => 0);
      if (days === 0) {
        const txt = cleanText(await this.page.locator('#view-horarios').innerText().catch(() => ''));
        assert(/no hay|sin clases|próximamente|vacío/i.test(txt), 'No hay días con clase ni un mensaje que lo explique.');
        throw OPTIONAL_WARN('Sin días con clases en el calendario (depende de datos).');
      }
      await this.tap(this.page.locator('#calendar-grid .calendar-day.has-classes:not(.disabled)').first());
      await this.page.waitForTimeout(1800);
      const cards = await this.page.locator('#view-horarios [id^="grid-"] > *').count().catch(() => 0);
      assert(cards > 0, 'El día seleccionado no filtra ninguna tarjeta de clase.');
      return `${days} días con clase · ${cards} tarjetas al filtrar`;
    });

    await this.step('reserva', 'Abrir el diálogo de reserva y cancelarlo', async () => {
      const reservable = this.page.locator('#view-horarios button[onclick^="reservar("]:visible');
      const n = await reservable.count().catch(() => 0);
      if (n === 0) {
        const txt = cleanText(await this.page.locator('#view-horarios').innerText().catch(() => ''));
        assert(/completa|cerrada|finalizada|no disponible|tu plaza|sin bonos/i.test(txt), 'No hay botón de reserva ni estado que explique por qué.');
        throw OPTIONAL_WARN('Sin plazas reservables para el usuario de pruebas (depende de datos).');
      }
      await this.tap(reservable.first());
      const txt = await this.visibleDialogText();
      assert(/reserv|confirmar|bono|plaza|comprar|saldo|gratis|introductori/i.test(txt), `El diálogo de reserva no explica la acción: "${txt.slice(0, 90)}"`);
      const closed = await this.cancelDialog();
      assert(closed, 'El diálogo de reserva no se cierra al cancelar.');
      return `diálogo claro ("${txt.replace(/\s+/g, ' ').slice(0, 46)}") y cancelado sin escribir`;
    });

    await this.step('perfil', 'Abrir la edición de perfil y cancelar', async () => {
      const btn = this.page.locator('#header-btn-edit-profile:visible').first();
      assert(await btn.count(), 'No hay botón de editar perfil.');
      await this.tap(btn);
      await this.page.locator('#swal-nombre').waitFor({ state: 'visible', timeout: 10000 });
      const value = await this.page.locator('#swal-nombre').inputValue().catch(() => '');
      assert(value.trim().length > 0, 'El formulario de perfil abre sin datos precargados.');
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(800);
      assert((await this.page.locator('.swal2-popup:visible').count().catch(() => 0)) === 0, 'El editor de perfil no se cierra con Escape.');
      return `datos precargados ("${cleanText(value).slice(0, 24)}") y cierre limpio`;
    });

    await this.step('logout', 'Cerrar sesión y comprobar que la sesión no persiste', async () => {
      const btn = this.page.locator('#header-btn-logout:visible').first();
      assert(await btn.count(), 'No hay botón de cerrar sesión.');
      await this.tap(btn);
      await this.page.locator('#auth-container:visible').waitFor({ state: 'visible', timeout: 15000 });
      await this.page.reload({ waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await this.page.waitForTimeout(2500);
      const loginVisible = await this.page.locator('#auth-container:visible').isVisible().catch(() => false);
      assert(loginVisible, 'Tras recargar, la sesión sigue abierta (logout incompleto).');
      endedAtLogin = true;
      return 'vuelve al login y no reabre sesión al recargar';
    });
    this.endedAtLogin = endedAtLogin;
  }

  // ------------------------------------------------------------ Carmen
  async journeyKeyboard() {
    await this.step('bienvenida', 'Cerrar la bienvenida solo con teclado', async () => {
      await this.goto('/', 2000);
      const isOpen = async () => this.page.locator('#flash-welcome-modal').evaluate((el) => {
        const s = getComputedStyle(el);
        return !el.classList.contains('pointer-events-none') && s.display !== 'none' && Number(s.opacity) > 0.01;
      }).catch(() => false);
      const visible = await isOpen();
      if (!visible) throw OPTIONAL_WARN('La oferta de bienvenida no aparece en esta sesión.');
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(800);
      const open = await isOpen();
      assert(!open, 'Escape no cierra la oferta de bienvenida: una persona con teclado queda atrapada.');
      return 'Escape cierra la oferta';
    });

    await this.step('foco', 'Recorrer la landing con Tab y ver dónde está el foco', async () => {
      const kb = await auditKeyboard(this.page, { maxTabs: 16 });
      assert(kb.stops.length >= 6, `Solo ${kb.stops.length} controles alcanzables con Tab.`);
      const names = kb.stops.slice(0, 10).map((s) => s.text || s.id || s.tag).filter(Boolean);
      assert(kb.invisible.length <= 1, `${kb.invisible.length} controles sin indicador de foco visible (${kb.invisible.map((s) => s.text || s.tag).join(', ')}).`);
      if (kb.invisible.length === 1) {
        this.findings.push({ code: 'persona-teclado-foco', severity: 'medium', title: 'Foco invisible en un control', detail: kb.invisible[0].text || kb.invisible[0].tag, files: ['index.html', 'tailwind-compiled.css'], autoApplicable: true });
      }
      return `${kb.stops.length} paradas: ${names.slice(0, 5).join(' → ')}`;
    });

    await this.step('zoom', 'Comprobar que el navegador puede ampliar', async () => {
      const vp = await this.page.evaluate(() => document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '').catch(() => '');
      assert(vp, 'La página no declara viewport móvil.');
      assert(!/user-scalable\s*=\s*(no|0)/i.test(vp), 'El viewport bloquea el zoom (user-scalable=no).');
      assert(!/maximum-scale\s*=\s*(1(\.0+)?|0?\.\d+)\s*(,|$)/i.test(vp), 'El viewport limita el zoom a 1x (maximum-scale=1).');
      return vp;
    });

    await this.step('lectura', 'Medir contraste, etiquetas y textos clave', async () => {
      const audits = [];
      for (const [p, label] of [['/', 'landing'], ['/clases.html', 'clases'], ['/tarifas.html', 'tarifas'], ['/profile.html', 'login']]) {
        await this.goto(p, 1800);
        if (p === '/') await this.dismissWelcome();
        audits.push(await auditA11y(this.page, label, { mobile: false }));
      }
      const all = audits.flatMap((a) => a.issues.map((i) => ({ ...i, page: a.label })));
      const high = all.filter((i) => i.severity === 'high');
      if (high.length) {
        for (const i of high) this.findings.push({ code: i.code, severity: 'high', title: i.detail.slice(0, 70), detail: i.detail, files: this.suspectedFiles('lectura'), autoApplicable: true });
        throw FAIL(`${high.length} barrera(s) crítica(s): ${high.map((i) => i.detail).join(' · ')}`);
      }
      const medium = all.filter((i) => i.severity === 'medium');
      const low = all.filter((i) => i.severity === 'low');
      for (const i of medium) this.findings.push({ code: i.code, severity: 'medium', title: i.detail.slice(0, 70), detail: i.detail, files: this.suspectedFiles('lectura'), autoApplicable: true });
      const font = low.filter((i) => i.code === 'a11y-font');
      if (font.length) {
        this.findings.push({ code: 'a11y-font', severity: 'low', title: 'Textos por debajo de 12px', detail: font[0].detail, files: this.suspectedFiles('lectura'), autoApplicable: true });
      }
      const pages = audits.map((a) => `${a.label}: ${a.issues.length ? a.issues.map((i) => i.code).join('/') : 'OK'}`).join(' · ');
      if (medium.length || low.length) throw OPTIONAL_WARN(`${medium.length} aviso(s) medio(s) y ${low.length} menor(es) — ${pages}`);
      return pages;
    });
  }

  // ------------------------------------------------------------ Dani
  async journeySlowNetwork() {
    await this.step('carga', 'Abrir la landing con 3G lento', async () => {
      const cdp = await this.ctx.newCDPSession(this.page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false, latency: 250, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
      });
      const t0 = Date.now();
      await this.goto('/', 0);
      const ms = Date.now() - t0;
      const body = await this.bodyText();
      assert(body.length > 500, 'Con 3G lento la landing queda vacía.');
      assert(ms < 25000, `Con 3G lento la landing tarda ${(ms / 1000).toFixed(1)}s.`);
      if (ms > 12000) {
        this.findings.push({ code: 'persona-red-lenta', severity: 'medium', title: 'Landing muy lenta con 3G', detail: `${(ms / 1000).toFixed(1)}s`, files: ['index.html', 'img/'], autoApplicable: true });
      }
      return `${(ms / 1000).toFixed(1)}s hasta load con 1,6 Mbps`;
    });
  }

  report() {
    const totalMs = Date.now() - this.t0;
    const failed = this.steps.filter((s) => s.status === 'fail').length;
    const warned = this.steps.filter((s) => s.status === 'warn').length;
    const status = failed ? 'fail' : warned ? 'warn' : 'pass';
    let friction = 0;
    for (const s of this.steps) {
      if (s.status === 'fail') friction += 22;
      else if (s.status === 'warn') friction += 7;
      if (s.ms > 15000) friction += 5;
      else if (s.ms > 8000) friction += 2;
    }
    for (const f of this.findings) {
      if (f.severity === 'high') friction += 12;
      else if (f.severity === 'medium') friction += 4;
      else friction += 1;
    }
    friction = Math.min(100, Math.round(friction));
    return {
      id: this.personaId,
      name: this.persona.name,
      age: this.persona.age,
      device: this.persona.device,
      context: this.persona.context,
      goal: this.persona.goal,
      status,
      steps: this.steps,
      findings: this.findings,
      metrics: {
        totalMs,
        clicks: this.clicks,
        dialogs: this.dialogs,
        deadEnds: this.deadEnds,
        consoleErrors: [...new Set(this.consoleErrors)].slice(0, 5),
        friction,
      },
    };
  }
}

/**
 * Ejecuta las personas y devuelve un informe estructurado.
 * @param {object} opts
 * @param {import('playwright-core').Browser} opts.browser
 * @param {string} opts.base
 * @param {string} opts.email
 * @param {string} opts.password
 * @param {string[]} [opts.personas] ids a ejecutar
 * @param {boolean} [opts.full] incluye red lenta
 * @param {string|null} [opts.artifactsDir] directorio para capturas de fallo
 * @param {(msg: string) => void} [opts.log]
 */
export async function simulatePersonas({ browser, base, email, password, personas, full = false, artifactsDir = null, log = () => {} }) {
  const ids = (personas && personas.length ? personas : Object.keys(PERSONAS))
    .filter((id) => PERSONAS[id])
    .filter((id) => id !== 'red-lenta' || full);
  if (artifactsDir) await mkdir(path.join(artifactsDir, 'img'), { recursive: true }).catch(() => {});
  const results = [];
  for (const id of ids) {
    log(`\n🧑 ${PERSONAS[id].name} (${PERSONAS[id].age}) · ${PERSONAS[id].device} · ${PERSONAS[id].context}`);
    const run = new Journey({ browser, base, personaId: id, email, password, artifactsDir, log });
    try {
      results.push(await run.run());
    } catch (e) {
      // Un fallo al abrir el contexto no debe tumbar a las demás personas.
      const detail = String((e && e.message) || e).split('\n')[0].slice(0, 300);
      const p = PERSONAS[id];
      log(`  ❌ ${p.name}: excepción del recorrido — ${detail}`);
      results.push({
        id, name: p.name, age: p.age, device: p.device, context: p.context, goal: p.goal,
        status: 'fail',
        steps: [{ id: 'excepcion', title: 'Abrir el recorrido', status: 'fail', ms: 0, detail }],
        findings: [{
          code: `persona-${id}-excepcion`, severity: 'high',
          title: `${p.name}: el recorrido no pudo arrancar`, detail,
          files: ['index.html', 'clases.html', 'tarifas.html'], autoApplicable: true,
        }],
        metrics: { totalMs: 0, clicks: 0, dialogs: 0, deadEnds: 1, consoleErrors: [detail], friction: 25 },
      });
    }
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  const friction = results.length ? Math.round(results.reduce((a, r) => a + r.metrics.friction, 0) / results.length) : 0;
  return {
    date: new Date().toISOString(),
    base,
    personas: results,
    summary: {
      total: results.length,
      passed: results.length - failed - warned,
      warned,
      failed,
      friction,
      deadEnds: results.reduce((a, r) => a + r.metrics.deadEnds, 0),
      findings: results.reduce((a, r) => a + r.findings.length, 0),
    },
  };
}

export function renderPersonaMarkdown(report) {
  const s = report.summary;
  const badge = s.failed ? '🔴' : s.warned ? '🟡' : '🟢';
  const L = [];
  L.push(`## 🧑‍🤝‍🧑 Simulación de personas · ${badge} ${s.passed}/${s.total} recorridos limpios`);
  L.push('');
  L.push(`> Fricción media: **${s.friction}/100** (0 = perfecto) · ${s.deadEnds} bloqueo(s) · ${s.findings} hallazgo(s) · ${report.base}`);
  L.push('');
  for (const p of report.personas) {
    const icon = p.status === 'pass' ? '✅' : p.status === 'warn' ? '⚠️' : '❌';
    L.push(`### ${icon} ${p.name}, ${p.age} · ${p.device}`);
    L.push(`*${p.context}.* Objetivo: ${p.goal}`);
    L.push('');
    L.push(`**Resultado:** ${p.metrics.totalMs >= 1000 ? `${(p.metrics.totalMs / 1000).toFixed(0)}s` : `${p.metrics.totalMs}ms`} · ${p.metrics.clicks} toques · ${p.metrics.dialogs} diálogo(s) · fricción ${p.metrics.friction}/100.`);
    L.push('');
    L.push('| Paso | Estado | Tiempo | Qué ocurrió |');
    L.push('| :--- | :---: | ---: | :--- |');
    for (const st of p.steps) {
      const i = st.status === 'pass' ? '✅' : st.status === 'warn' ? '⚠️' : '❌';
      L.push(`| ${st.title} | ${i} | ${(st.ms / 1000).toFixed(1)}s | ${st.detail.replace(/\|/g, '\\|').slice(0, 150) || '—'} |`);
    }
    if (p.metrics.consoleErrors.length) {
      L.push('');
      L.push(`**Errores JS:** ${p.metrics.consoleErrors.map((e) => `\`${e}\``).join(' · ')}`);
    }
    L.push('');
  }
  L.push('*Simulación de solo lectura: los diálogos de reserva/compra se cancelan antes de cualquier escritura. Los tiempos incluyen esperas de estabilización de 1–3 s; úsalos como tendencia, no como benchmark de red.*');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = await import('playwright-core');
  const args = process.argv.slice(2);
  const isCert = args.includes('--cert') || process.env.CERT_MODE === '1';
  const full = args.includes('--full');
  const jsonOnly = args.includes('--json');
  const noWrite = args.includes('--no-write');
  const base = (process.env.PROD_BASE_URL || (isCert
    ? (process.env.CERT_BASE_URL || 'https://gen-yoga-studio.github.io/GEN-YOGA-CERT')
    : 'https://genyoga.studio')).replace(/\/+$/, '');
  const outDir = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.resolve('nightly-reports');
  const wanted = args.reduce((acc, a, i) => {
    if (a === '--persona') acc.push(args[i + 1]);
    return acc;
  }, []).filter(Boolean);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const report = await simulatePersonas({
    browser,
    base,
    email: process.env.GEN_YOGA_TEST_EMAIL || 'prueba@prueba.com',
    password: process.env.GEN_YOGA_TEST_PASSWORD || 'prueba',
    personas: wanted,
    full,
    artifactsDir: noWrite ? null : outDir,
    log: (m) => console.log(m),
  });
  await browser.close();

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n' + renderPersonaMarkdown(report));
  }
  if (!noWrite) {
    const date = new Date().toISOString().slice(0, 10);
    await mkdir(outDir, { recursive: true }).catch(() => {});
    await writeFile(path.join(outDir, `personas-${date}.json`), JSON.stringify(report, null, 2));
    await writeFile(path.join(outDir, `personas-${date}.md`), renderPersonaMarkdown(report));
    console.log(`\n📄 Informe de personas: ${path.join(outDir, `personas-${date}.md`)}`);
  }
  process.exit(report.summary.failed > 0 ? 1 : 0);
}
