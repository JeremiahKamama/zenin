import { chromium } from '/Users/jeremiahkamama/.npm/_npx/705bc6b22212b352/node_modules/playwright/index.mjs';
import { mkdirSync } from 'fs';
const OUT = '/tmp/journal-shots'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message.slice(0,100)));

await page.goto('http://localhost:5173/app?guest=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
await page.keyboard.press('Escape');

// Click <A class="nav-btn">Journal</A>
await page.evaluate(() => {
  const links = [...document.querySelectorAll('a.nav-btn, aside a')];
  const j = links.find(a => a.textContent.trim() === 'Journal');
  if (j) { j.click(); } else { console.log('NO JOURNAL LINK'); }
});
await page.waitForTimeout(2800);
await page.keyboard.press('Escape').catch(()=>{});
await page.waitForTimeout(600);

const mounted = await page.evaluate(() => ({
  journal: !!document.querySelector('.journal-page, .journal-debrief'),
  tabs: [...document.querySelectorAll('.journal-tab-nav button')].map(b => b.textContent.trim()),
  headerText: document.querySelector('.journal-debrief-head')?.textContent?.slice(0,50),
}));
console.log('MOUNTED:', JSON.stringify(mounted));
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0,5));

await page.screenshot({ path: `${OUT}/journal-overview-dark.png` });
console.log('saved overview-dark');

for (const t of ['Entries','Calendar','Analytics','Review']) {
  await page.evaluate((name) => {
    const btn = [...document.querySelectorAll('.journal-tab-nav button')].find(b => b.textContent.trim() === name);
    if (btn) btn.click();
  }, t);
  await page.waitForTimeout(1600);
  const active = await page.evaluate(() => document.querySelector('.journal-tab-nav button.active')?.textContent?.trim());
  await page.screenshot({ path: `${OUT}/journal-${t.toLowerCase()}-dark.png` });
  console.log(`saved ${t.toLowerCase()}-dark (active=${active})`);
}

// Light theme
await page.evaluate(() => localStorage.setItem('zenin_global_theme', 'light'));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const j = [...document.querySelectorAll('a.nav-btn, aside a')].find(a => a.textContent.trim() === 'Journal');
  if (j) j.click();
});
await page.waitForTimeout(2800);
await page.screenshot({ path: `${OUT}/journal-overview-light.png` });
console.log('saved overview-light');

// Entries tab in light too
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.journal-tab-nav button')].find(b => b.textContent.trim() === 'Entries');
  if (btn) btn.click();
});
await page.waitForTimeout(1600);
await page.screenshot({ path: `${OUT}/journal-entries-light.png` });
console.log('saved entries-light');

await browser.close();
console.log('done');
