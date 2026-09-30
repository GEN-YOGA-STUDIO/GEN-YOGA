import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
await page.goto('https://genyoga.studio/clases.html', { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(2500);
await page.locator('#public-calendar-launch:visible').first().click({ timeout: 8000 });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); return e ? `${e.checkVisibility?.()}` : 'NF'; };
  const cands = ['calendar-desktop', 'calendar-mobile', 'public-calendar-modal', 'public-calendar-overlay', 'public-calendar-close', 'public-calendar-root', 'gen-calendar'];
  return JSON.stringify(Object.fromEntries(cands.map(id => [id, vis(id)]))) + ' | body-clases: ' + document.body.className.slice(-80);
}));
await browser.close();
