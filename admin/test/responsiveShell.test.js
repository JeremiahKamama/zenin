// admin/test/responsiveShell.test.js
//
// "Admin app has no responsiveness, build it."
//
// The console had responsiveness rules, but the 1180px block made the layout
// worse rather than better:
//
//   .admin-container { flex-direction: column; }
//   .sidebar { width: 100%; }
//
// A column layout with a full-width sidebar puts all nine nav items, the
// system-status card and the logout button ABOVE the content. On a phone the
// first row of real data sits below the fold, and every tab change means
// scrolling past the entire menu to reach the thing you just selected.
//
// The fix is an off-canvas drawer: fixed position, transform-based, dismissed
// by a scrim, revealed by a toggle. Off-canvas keeps the content at the top of
// the viewport where it belongs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/index.css'), 'utf8');
const app = readFileSync(join(here, '../src/App.jsx'), 'utf8');
const html = readFileSync(join(here, '../index.html'), 'utf8');

// There are two 1180px blocks: the first only reveals the drawer chrome, the
// second carries the layout. Anchor on the layout one, identified by the
// sidebar rule it must contain.
const layoutAt = css.indexOf('.sidebar[data-open="true"]');
const mobileBlock = css.slice(css.lastIndexOf('@media (max-width: 1180px)', layoutAt));
const phoneBlock = css.slice(css.indexOf('@media (max-width: 720px)'));

test('the sidebar is no longer stacked above the content', () => {
  // The specific regression: column layout + full-width sidebar.
  const block = mobileBlock.slice(0, mobileBlock.indexOf('@media (max-width: 720px)'));
  // Grab the first declaration block after each selector, with comments
  // stripped: the comments deliberately quote the old buggy declarations
  // ("previously it was flex-direction: column"), so a raw text match would
  // trip on the explanation of the bug rather than the bug itself.
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleFor = (selector) => {
    const at = stripped.indexOf(selector);
    if (at === -1) return '';
    return stripped.slice(at, stripped.indexOf('}', at));
  };
  const containerRule = ruleFor('.admin-container {');
  assert.ok(containerRule, '.admin-container must still be styled');
  assert.doesNotMatch(containerRule, /flex-direction:\s*column/);
  const sidebarRule = ruleFor('.sidebar {');
  assert.doesNotMatch(sidebarRule, /width:\s*100%/);
});

test('the sidebar becomes an off-canvas drawer on small screens', () => {
  const block = mobileBlock.slice(0, mobileBlock.indexOf('@media (max-width: 720px)'));
  assert.match(block, /\.sidebar\s*\{[^}]*position:\s*fixed/);
  assert.match(block, /transform:\s*translateX\(-100%\)/);
  assert.match(block, /\.sidebar\[data-open="true"\]\s*\{[^}]*translateX\(0\)/);
});

test('the drawer animates transform, not left', () => {
  // `left` triggers layout on every frame; transform runs on the compositor.
  const block = mobileBlock.slice(0, mobileBlock.indexOf('@media (max-width: 720px)'));
  const sidebarRule = block.slice(block.indexOf('.sidebar {'), block.indexOf('.sidebar[data-open'));
  assert.match(sidebarRule, /transition:\s*transform/);
  assert.doesNotMatch(sidebarRule, /transition:[^;]*\bleft\b/);
});

test('a scrim is rendered and gives a large dismissal target', () => {
  assert.match(app, /className=\{`sidebar-scrim/);
  assert.match(css, /\.sidebar-scrim\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.sidebar-scrim\s*\{[^}]*inset:\s*0/);
});

test('choosing a destination closes the drawer', () => {
  // Otherwise the menu stays over the content the user just asked for.
  const closes = app.match(/setIsSidebarOpen\(false\)/g) || [];
  assert.ok(closes.length >= 9, `every nav item must close the drawer (found ${closes.length})`);
});

test('the toggle is reachable and announced', () => {
  assert.match(app, /className="nav-toggle"/);
  assert.match(app, /aria-expanded=\{isSidebarOpen\}/);
  assert.match(app, /aria-controls="admin-sidebar"/);
  assert.match(app, /id="admin-sidebar"/);
});

test('touch targets meet the 44px minimum', () => {
  // Capture the shared declaration block. The selector list itself contains
// ".sidebar-close", so a naive indexOf on that ends the slice immediately.
const chromeStart = css.indexOf('.nav-toggle,\n.sidebar-close {');
const chrome = css.slice(chromeStart, css.indexOf('}', chromeStart));
  assert.match(chrome, /width:\s*44px/);
  assert.match(chrome, /height:\s*44px/);
});

test('tap highlight and double-tap zoom are suppressed', () => {
  // Capture the shared declaration block. The selector list itself contains
// ".sidebar-close", so a naive indexOf on that ends the slice immediately.
const chromeStart = css.indexOf('.nav-toggle,\n.sidebar-close {');
const chrome = css.slice(chromeStart, css.indexOf('}', chromeStart));
  assert.match(chrome, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(chrome, /touch-action:\s*manipulation/);
});

test('keyboard focus is not removed by the drawer', () => {
  // Off-canvas via transform keeps the sidebar in the tab order (unlike
  // display:none), so focus behaviour is unchanged and needs no trap.
  const block = mobileBlock.slice(0, mobileBlock.indexOf('@media (max-width: 720px)'));
  const sidebarRule = block.slice(block.indexOf('.sidebar {'), block.indexOf('.sidebar[data-open'));
  assert.doesNotMatch(sidebarRule, /display:\s*none/);
});

test('content clears the notch and home indicator', () => {
  assert.match(phoneBlock, /env\(safe-area-inset-left/);
  assert.match(phoneBlock, /env\(safe-area-inset-bottom/);
});

test('desktop grids collapse to one column on a phone', () => {
  // A grid still asking for minmax(320px, 1fr) inside a 360px viewport
  // overflows horizontally.
  assert.match(phoneBlock, /grid-template-columns:\s*1fr\s*!important/);
});

test('inputs are 16px so iOS does not zoom on focus', () => {
  assert.match(phoneBlock, /font-size:\s*16px\s*!important/);
});

test('the viewport meta does not block zooming', () => {
  assert.match(html, /width=device-width/);
  assert.match(html, /viewport-fit=cover/);
  // maximum-scale=1 breaks pinch-zoom for low-vision users.
  assert.doesNotMatch(html, /maximum-scale/);
  assert.doesNotMatch(html, /user-scalable=no/);
});

test('a collapsed grid still scrolls its wide content', () => {
  assert.match(css, /\.table-container\s*\{[^}]*overflow-x:\s*auto/);
});
