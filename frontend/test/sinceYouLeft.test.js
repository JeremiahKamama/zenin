// frontend/test/sinceYouLeft.test.js
//
// "Since You Left" was three bare lists. Rebuilt because it answered "what
// moved?" with less information than the screen behind it:
//
//   * no money — a +2.4% move on a $12,000 position and on a $40 watchlist item
//     rendered identically, so it could not say what mattered
//   * no direction — `.positive` and `.negative` both resolved to muted greys
//   * no headline — no "you're up $X while you were away"
//   * size-blind ranking — sorted by |%| alone, so a $15 watchlist item with a
//     9% move outranked a $40,000 holding with a 3% move
//   * frozen timer — the away duration was computed once and never updated
//   * inert rows — nothing could be clicked through

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const modal = readFileSync(join(here, '../src/components/WhileYouWereGoneModal.jsx'), 'utf8');
const css = readFileSync(join(here, '../src/styles.css'), 'utf8');
const app = readFileSync(join(here, '../src/App.jsx'), 'utf8');

const syStart = css.indexOf('.since-you-left {');
const syEnd = css.indexOf('/* ── Live Data Paused Toast ──');
const sy = css.slice(syStart, syEnd);

test('a gain and a loss are visually distinguishable', () => {
  // Both used to be muted greys, so direction was conveyed by nothing.
  assert.match(sy, /\.since-you-left-change\.positive \{ color: var\(--color-success\); \}/);
  assert.match(sy, /\.since-you-left-change\.negative \{ color: var\(--color-danger\); \}/);
  assert.doesNotMatch(sy, /\.since-you-left-change\.positive \{ color: var\(--color-text-primary\)/);
});

test('direction survives greyscale and colour-blindness', () => {
  // An arrow glyph carries the meaning even when the hue does not.
  assert.match(modal, /▲/);
  assert.match(modal, /▼/);
});

test('the modal leads with the dollar impact on real positions', () => {
  // The whole point: "up $840" beats "NVDA +2.4%".
  assert.match(modal, /const netImpact = useMemo/);
  assert.match(modal, /Your positions moved/);
  assert.match(modal, /formatSignedMoney\(netImpact\.total\)/);
});

test('movers are ranked by dollar impact, not raw percentage', () => {
  // A held position with real money at stake must outrank a watchlist ticker.
  assert.match(modal, /const dollarImpact = positionValue != null/);
  assert.match(modal, /if \(aHeld && !bHeld\) return -1;/);
  assert.match(modal, /if \(!aHeld && bHeld\) return 1;/);
  assert.match(modal, /Math\.abs\(b\.dollarImpact\) - Math\.abs\(a\.dollarImpact\)/);
});

test('a dollar impact is only claimed when a position size is known', () => {
  // A watchlist item has no quantity, so a dollar figure would be invented.
  assert.match(modal, /quantity: 0,/);
  assert.match(modal, /held: false/);
  assert.match(modal, /m\.dollarImpact != null && Math\.abs\(m\.dollarImpact\) >= 0\.01/);
});

test('the away duration keeps ticking instead of freezing', () => {
  assert.match(modal, /const \[now, setNow\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(modal, /window\.setInterval\(\(\) => setNow\(Date\.now\(\)\), 30000\)/);
  assert.match(modal, /describeAway\(now - Number\(idleSince\)\)/);
});

test('away durations are human, including multi-day absences', () => {
  assert.match(modal, /function describeAway\(ms\)/);
  assert.ok(modal.includes('`${days}d ${remHours}h`'), 'multi-day with hours');
  assert.ok(modal.includes('`${days}d`'), 'whole days');
});

test('the window is described honestly rather than always "today"', () => {
  assert.match(modal, /const awayMs = idleSince \? Date\.now\(\) - Number\(idleSince\) : 0/);
  assert.match(modal, /awayMs >= 20 \* 3600000 \? "while you were away" : "recently"/);
});

test('rows become real navigation when the host provides a handler', () => {
  assert.match(modal, /const RowShell = \(\{ symbol, className, children \}\)/);
  assert.match(modal, /typeof onSelectAsset !== "function"/);
  assert.match(modal, /onClick=\{\(\) => handleSelect\(symbol\)\}/);
});

test('the call site passes spot prices so dollars can be computed', () => {
  assert.match(app, /spotPrices=\{spotPrices\}/);
  assert.match(app, /onSelectAsset=\{\(symbol\) => \{/);
});

test('a row is a button, not a div, when it navigates', () => {
  // A clickable div is unreachable by keyboard.
  assert.match(modal, /<button type="button" className="sy-left-row"/);
});

test('the row target is at least 34px tall', () => {
  assert.match(sy, /min-height: 34px/);
});

test('price ticks do not re-trigger the network fetch', () => {
  // Otherwise every quote update refetches 40 symbols.
  assert.match(modal, /const spotRef = useRef\(spotPrices\)/);
  assert.match(modal, /priceFor\(asset\.symbol\)/);
  assert.ok(modal.includes('[open, universe, idleSince]'), 'effect depends on the away window');
});

test('earnings are ordered soonest first', () => {
  // A report due tomorrow beats one three weeks out.
  assert.match(modal, /\.sort\(\(a, b\) => \{[\s\S]{0,260}?return at - bt;/);
  assert.match(modal, /function daysUntil\(raw\)/);
});

test('a partially failed load says so instead of looking empty', () => {
  assert.match(modal, /setPartialFailure\(true\)/);
  assert.match(modal, /Some sections could not be loaded/);
  assert.match(modal, /role="status"/);
});

test('the skeleton is hidden from assistive tech but announced in words', () => {
  assert.match(modal, /className="sy-left-skeleton" aria-hidden="true"/);
  assert.match(modal, /className="sy-left-sr">Loading moves/);
  assert.match(sy, /\.sy-left-sr \{[\s\S]*?clip: rect\(0, 0, 0, 0\)/);
});

test('motion respects prefers-reduced-motion', () => {
  assert.match(sy, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(sy, /\.sy-left-skeleton \{\s*animation: none;/);
});

test('long headlines are clamped so the list stays scannable', () => {
  assert.match(sy, /-webkit-line-clamp: 2/);
});

test('the layout collapses instead of overflowing on a phone', () => {
  assert.match(sy, /@media \(max-width: 720px\)/);
  assert.match(sy, /@media \(max-width: 460px\)/);
  assert.match(sy, /grid-template-columns: 1fr;/);
});

test('the close control meets the touch target minimum on small screens', () => {
  assert.match(sy, /\.since-you-left-close \{[\s\S]{0,400}?width: 36px;/);
});

test('the empty state distinguishes "nothing tracked" from "nothing moved"', () => {
  assert.match(modal, /No tracked holdings or watchlist items yet\./);
  assert.match(modal, /No price movement to report\./);
});

test('the same symbol across market types is aggregated, not duplicated', () => {
  assert.match(modal, /const entry = bySymbol\.get\(symbol\);/);
  assert.match(modal, /entry\.quantity \+= quantity;/);
});

test('the modal is labelled for assistive tech', () => {
  assert.match(modal, /labelledBy="since-you-left-title"/);
  assert.match(modal, /id="since-you-left-title"/);
  assert.match(modal, /aria-labelledby="sy-left-moves-h"/);
});
