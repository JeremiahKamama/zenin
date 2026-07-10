import { chromium } from '/Users/jeremiahkamama/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
import { mkdirSync } from 'fs';
const OUT = '/tmp/journal-shots'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:5173/app?guest=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
await page.keyboard.press('Escape');

// Find the Journal nav button by walking sidebar buttons
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('aside button, nav button, [role="button"]')];
  const j = btns.find(b => /journal/i.test(b.textContent) && b.textContent.trim().length < 30);
  if (j) { j.click(); return j.textContent.trim().slice(0,40); }
  return null;
});
console.log('clicked journal nav:', clicked);
await page.waitForTimeout(2500);
await page.keyboard.press('Escape').catch(()=>{});
await page.waitForTimeout(800);

const mounted = await page.evaluate(() => ({
  journal: !!document.querySelector('.journal-page, .journal-debrief'),
  tabs: [...document.querySelectorAll('.journal-tab-nav button')].map(b => b.textContent.trim()),
  header: document.querySelector('.journal-debrief-head h1, h2')?.textContent?.slice(0,60),
}));
console.log('MOUNTED:', JSON.stringify(mounted));

await page.screenshot({ path: `${OUT}/journal-overview-dark.png` });
console.log('saved overview-dark');

for (const t of ['Entries','Calendar','Analytics','Review']) {
  const ok = await page.evaluate((name) => {
    const btn = [...document.querySelectorAll('.journal-tab-nav button')].find(b => b.textContent.trim() === name);
    if (btn) { btn.click(); return true; } return false;
  }, t);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/journal-${t.toLowerCase()}-dark.png` });
  console.log(`saved ${t.toLowerCase()}-dark (clicked=${ok})`);
}

// Light theme
await page.evaluate(() => localStorage.setItem('zenin_global_theme', 'light'));
await page.goto('http://localhost:5173/app?guest=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('aside button, nav button, [role="button"]')];
  const j = btns.find(b => /journal/i.test(b.textContent) && b.textContent.trim().length < 30);
  if (j) j.click();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/journal-overview-light.png` });
console.log('saved overview-light');

await browser.close();
console.log('done');
