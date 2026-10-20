// admin/test/placeholderIntegrity.test.js
//
// The console shipped a long list of values that were invented rather than
// measured: a sparkline drawn from Math.random(), a growth chart plotted from
// `totalUsers * 0.8`, a hardcoded unread badge, a fabricated device and IP on
// the sign-out dialog, a settings panel that claimed "3 IPs configured" and an
// SSO "Enabled" state, and a fixed "Last updated: May 29, 2025" stamp.
//
// Each one is worse than an empty state, because it looks like data. These
// tests read the source and fail if any of those literals reappears. They are
// deliberately source-level: the point is to catch a regression at the point a
// developer pastes a plausible-looking constant back in.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "../src/App.jsx"), "utf8");

/**
 * Source with every comment removed.
 *
 * Block comments matter here: this file's own explanations quote the fabricated
 * literals they replaced ("MacBook Pro", "203.0.113.42"), and a line-based
 * filter would flag that prose as a regression. JSX comments ({/* *\/}) are
 * removed too, since they sit inside otherwise-live markup.
 */
function codeOnly(source) {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const code = codeOnly(appSource);

test("no SVG path is built from Math.random()", () => {
  // A random path regenerates on every render, so 28 cards of invented wiggle
  // changed on every keystroke in the search box. Math.random() itself is still
  // legitimate for id generation, so this targets the path template.
  const paths = code.match(/d=\{`[^`]*`\}/g) || [];
  const randomPaths = paths.filter((path) => /Math\.random/.test(path));
  assert.equal(
    randomPaths.length,
    0,
    `a chart path is randomised again: ${randomPaths[0]}`
  );
});

test("the growth chart is not synthesised from totalUsers", () => {
  assert.equal(
    /stats\?\.totalUsers \|\| 100\) \* 0\.8/.test(code),
    false,
    "the fabricated growth curve (totalUsers * 0.8 … 1.02) is back"
  );
});

test("the growth chart uses hardcoded month labels only if none are generated", () => {
  // 'May 1' … 'Jun 4' were literal axis labels for data that was itself faked.
  assert.equal(
    /['"]May 1['"]/.test(code) && /['"]Jun 4['"]/.test(code),
    false,
    "hardcoded 'May 1'/'Jun 4' axis labels are back"
  );
});

test("the notification bell carries no invented unread count", () => {
  assert.equal(
    /unread|>\s*7\s*</.test(code) && /Bell/.test(code) && /borderRadius: '50%'.{0,120}>7</.test(code),
    false,
    "the bell is showing a hardcoded unread count again"
  );
});

test("sign-out dialog invents no device, OS, browser, city, or IP", () => {
  for (const fabricated of [
    "MacBook Pro",
    "macOS Sonoma",
    "v125.0.6422",
    "San Francisco, US",
    "203.0.113.42",
    "Static IP"
  ]) {
    assert.equal(
      code.includes(fabricated),
      false,
      `"${fabricated}" is presented as detected session information again`
    );
  }
});

test("no invented admin IP count or SSO state", () => {
  assert.equal(code.includes("3 IPs configured"), false, '"3 IPs configured" is back');
  // SSO must report a real provider list, never a bare green "Enabled".
  assert.equal(
    />\s*Enabled\s*<ChevronRight/.test(code),
    false,
    'a bare hardcoded SSO "Enabled" label is back'
  );
});

test("the settings footer shows no fixed timestamp", () => {
  assert.equal(
    code.includes("Last updated: May 29, 2025"),
    false,
    "the fixed settings timestamp is back"
  );
});

test("no control is a select with a single option and no handler", () => {
  // A one-option <select> with no onChange is decoration dressed as a control.
  const singles = code.match(/<select(?![^>]*onChange)[^>]*>\s*<option[^>]*>[^<]*<\/option>\s*<\/select>/g) || [];
  assert.equal(
    singles.length,
    0,
    `${singles.length} inert single-option select(s) found:\n${singles.slice(0, 5).join("\n")}`
  );
});

test("no SummaryCard asserts a trend it did not measure", () => {
  // trendUp={true} meant a green rising arrow. Descriptive captions like
  // "28 suspended" were rendered as good news.
  const cards = code.match(/<SummaryCard[\s\S]*?\/>/g) || [];
  assert.ok(cards.length > 0, "expected SummaryCard usages to be found");
  const offenders = cards.filter((card) => /trendUp=\{true\}/.test(card));
  assert.equal(
    offenders.length,
    0,
    `${offenders.length} card(s) still hardcode trendUp={true}:\n${offenders.slice(0, 3).join("\n---\n")}`
  );
});

test("sparkline series come from fetched data, never a literal", () => {
  const cards = code.match(/<SummaryCard[\s\S]*?\/>/g) || [];
  const withSeries = cards.filter((card) => /\bseries=\{/.test(card));
  assert.ok(withSeries.length > 0, "expected at least one card to be fed a real series");
  for (const card of withSeries) {
    const value = card.match(/series=\{([^}]*)\}/)?.[1] || "";
    assert.equal(
      /\[[\d\s,]+\]/.test(value),
      false,
      `a sparkline series is a hardcoded array: ${value}`
    );
  }
});

test("plan breakdown iterates the canonical plan ids", () => {
  // ['Starter','Pro','Desk'] read retired keys, so all three rows always
  // reported 0 (0%) regardless of the real distribution.
  assert.equal(
    /\['Starter',\s*'Pro',\s*'Desk'\]/.test(code),
    false,
    "the retired ['Starter','Pro','Desk'] breakdown list is back"
  );
  assert.match(
    code,
    /PLAN_BREAKDOWN_ORDER/,
    "the plan breakdown no longer derives from the canonical plan list"
  );
});
