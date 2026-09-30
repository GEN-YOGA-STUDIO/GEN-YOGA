// Sonda SECTOR CLASES (clases.html) como cliente, despacio.
import { chromium } from 'playwright-core';
const BASE = 'https://genyoga.studio';
const out = [];
const V = (step, exp, obs, ok, extra = '') => { out.push(ok); console.log(`${ok ? '✅' : '❌'} ${step}\n   esperado: ${exp}\n   visto: ${obs}${extra ? `\n   nota: ${extra}` : ''}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const js = [];
page.on('pageerror', (e) => js.push(String(e.message).slice(0, 130)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('compute-pressure')) js.push(m.text().slice(0, 130)); });
await page.goto(`${BASE}/clases.html`, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(2500);

const calOpen = async () => (await page.locator('#calendar-desktop').isVisible().catch(() => false))
  || (await page.locator('#calendar-mobile').isVisible().catch(() => false));
const calClose = async () => {
  await page.locator('#public-calendar-close:visible').first().click({ timeout: 6000 }).catch(async () => page.keyboard.press('Escape'));
  await page.waitForTimeout(900);
};

// C1. Carrusel: 5 dots cambian de slide
{
  let okAll = true;
  for (let i = 0; i < 5; i++) {
    await page.locator('.slide-dot').nth(i).click({ timeout: 6000 }).catch(() => { okAll = false; });
    await page.waitForTimeout(700);
    const active = await page.locator('.slide-dot').nth(i).evaluate((el) => el.classList.contains('active')).catch(() => false);
    if (!active) okAll = false;
  }
  V('C1 carrusel 5 dots', 'cada dot activa su slide', okAll ? 'los 5 conmutan' : 'algún dot no conmuta', okAll);
}
// C2. btn-inicio → index
{
  const href = await page.locator('#btn-inicio').first().getAttribute('onclick').catch(() => '');
  V('C2 btn-inicio', "handleNavClick a index.html", href || 'sin onclick', (href || '').includes('index.html'));
}
// C3-C5. Pestañas yoga/consultas/talleres
for (const [btn, deck, label] of [['#btn-cat-yoga', '#folders-deck', 'Yoga'], ['#btn-cat-consultas', '#consultas-deck', 'Consultas'], ['#btn-cat-talleres', '#talleres-deck', 'Talleres']]) {
  await page.locator(btn).click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  const vis = await page.locator(deck).isVisible().catch(() => false);
  V(`C ${label}: pestaña muestra su mazo`, `${deck} visible`, `visible=${vis}`, vis);
}
// C6-C8. Los 3 lanzadores abren el calendario y la X lo cierra
for (const [sel, label] of [['#public-calendar-launch', 'yoga'], ['#public-consultas-calendar-launch', 'consultas'], ['#public-talleres-calendar-launch', 'talleres']]) {
  const btn = page.locator(`${sel}:visible`).first();
  if ((await btn.count().catch(() => 0)) === 0) {
    // la pestaña correspondiente debe estar activa para ver su lanzador
    if (label === 'consultas') await page.locator('#btn-cat-consultas').click({ timeout: 8000 }).catch(() => {});
    if (label === 'talleres') await page.locator('#btn-cat-talleres').click({ timeout: 8000 }).catch(() => {});
    if (label === 'yoga') await page.locator('#btn-cat-yoga').click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.locator(`${sel}:visible`).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const open = await calOpen();
  V(`C lanzador ${label} abre calendario`, 'calendario visible', `visible=${open}`, open);
  if (open) {
    const days = await page.locator('#calendar-desktop [data-calendar-day], #calendar-mobile [data-calendar-day]').count().catch(() => 0);
    V(`C calendario ${label} pinta días`, 'días > 0', `días=${days}`, days > 0);
    await calClose();
    const closed = !(await calOpen());
    V(`C X cierra calendario (${label})`, 'cerrado', closed ? 'cerrado' : 'SIGUE ABIERTO', closed);
  }
}
// C9. Tarjeta de estilo abre calendario (power-vinyasa)
{
  await page.locator('#btn-cat-yoga').click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  const card = page.locator('[onclick*="power-vinyasa"]:visible').first();
  if ((await card.count().catch(() => 0)) === 0) V('C9 tarjeta power-vinyasa', 'abre calendario', 'tarjeta no visible', false);
  else {
    await card.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const open = await calOpen();
    V('C9 tarjeta power-vinyasa abre calendario', 'calendario visible', `visible=${open}`, open);
    if (open) await calClose();
  }
}
// C10. Tarjeta de profe abre calendario (miriam)
{
  await page.locator('#btn-cat-consultas').click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  const card = page.locator('[onclick*="miriam"]:visible').first();
  if ((await card.count().catch(() => 0)) === 0) V('C10 tarjeta miriam', 'abre calendario', 'tarjeta no visible', false);
  else {
    await card.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const open = await calOpen();
    V('C10 tarjeta miriam abre calendario', 'calendario visible', `visible=${open}`, open);
    if (open) await calClose();
  }
}
// C11. scroll-assist desplaza
{
  const y0 = await page.evaluate(() => window.scrollY);
  await page.locator('#scroll-assist').first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const y1 = await page.evaluate(() => window.scrollY);
  V('C11 scroll-assist', 'desplaza la página', `y ${Math.round(y0)}→${Math.round(y1)}`, y1 !== y0);
}
V('C12 cero errores JS en sector clases', '0 errores', `${js.length}`, js.length === 0, js.slice(0, 3).join(' | '));
const bad = out.filter((x) => !x).length;
console.log(`\n===== CLASES: ${out.length - bad}/${out.length} OK =====`);
await browser.close();
if (bad) process.exit(1);
