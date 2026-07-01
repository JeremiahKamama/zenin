import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const outDir = '/tmp/watchlist-import-qa';
fs.mkdirSync(outDir, { recursive: true });

const widths = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 375, height: 812 }
];

const browser = await chromium.launch({ headless: true });

for (const vp of widths) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();

  // Mock OAuth sign in
  const res = await page.request.post('http://localhost:4000/api/auth/oauth/mock', {
    data: { provider: 'google' }
  });
  if (!res.ok()) {
    console.error('Mock auth failed:', await res.text());
    await browser.close();
    process.exit(1);
  }

  await page.goto('http://localhost:5173/app/watchlist');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Click Import button
  const importBtn = page.locator('button.watchlist-import-trigger').first();
  await importBtn.waitFor({ state: 'visible' });
  await importBtn.click();
  await page.waitForTimeout(300);

  // Type sample import text
  const textarea = page.locator('.watchlist-import-textarea textarea');
  await textarea.fill(`Symbol, Name, Theme
AAPL, Apple Inc., US mega
MSFT, Microsoft Corporation, US mega
NVDA, NVIDIA Corporation, AI Infrastructure
SOL, Solana, Crypto majors
BTC, Bitcoin, Crypto majors
TSLA, Tesla Inc., US growth
AMZN, Amazon.com Inc., US mega
GOOGL, Alphabet Inc., US mega
META, Meta Platforms Inc., US mega
JPM, JPMorgan Chase & Co., Financials`);
  await page.waitForTimeout(500);

  // Screenshot full import panel
  const panel = page.locator('.watchlist-import-panel');
  await panel.screenshot({ path: path.join(outDir, `import-${vp.name}.png`) });

  // Screenshot each source button
  const buttons = await page.locator('.watchlist-import-source-grid button').all();
  for (let i = 0; i < buttons.length; i++) {
    await buttons[i].screenshot({ path: path.join(outDir, `source-btn-${i}-${vp.name}.png`) });
  }

  // Screenshot preview rows
  const previewList = page.locator('.watchlist-import-preview-list');
  if (await previewList.isVisible().catch(() => false)) {
    await previewList.screenshot({ path: path.join(outDir, `preview-list-${vp.name}.png`) });
  }

  await context.close();
}

await browser.close();
console.log('Screenshots saved to', outDir);
