// backend/test/unit/watchlistIntentWiring.test.js
//
// "Open or Journal buttons don't even work."
//
// Both buttons were rendered and clickable, and both called handleIntent(),
// which forwarded to the App-level onIntent callback. That callback handled
// exactly one intent:
//
//   onIntent={(asset, intent) => {
//     if (intent === "alert") void dispatchWatchlistAlertEmail(asset, intent);
//     ...
//   }}
//
// "inspect" (Open) and "journal" (Journal) fell straight through and did
// nothing at all. The buttons were not broken — they were wired to a handler
// that ignored them, which is why there was no error to debug.
//
// The locked/shared instance was worse: onAdd was `() => {}`, a silent no-op,
// so clicking a row in a shared watchlist did nothing and said nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "../../../frontend/src/App.jsx"), "utf8");
const watchlistSource = readFileSync(
  join(here, "../../../frontend/src/components/Watchlist.jsx"),
  "utf8"
);

test("the watchlist actually emits the intents its buttons raise", () => {
  // Guard the contract this bug violated: these exact strings must be emitted.
  assert.match(watchlistSource, /handleIntent\(asset, "inspect"\)/, "Open emits inspect");
  assert.match(watchlistSource, /handleIntent\(asset, "journal"\)/, "Journal emits journal");
});

test("Open is handled by the App-level intent callback", () => {
  const handler = appSource.slice(appSource.indexOf("onIntent={(asset, intent) => {"));
  const body = handler.slice(0, handler.indexOf("\n              }}"));
  assert.match(body, /intent === "inspect"/, "Open must be handled, not ignored");
  assert.match(body, /setSelectedAsset\(asset\)/, "Open must open the asset modal");
});

test("Journal is handled and carries the symbol into the journal", () => {
  const handler = appSource.slice(appSource.indexOf("onIntent={(asset, intent) => {"));
  const body = handler.slice(0, handler.indexOf("\n              }}"));
  assert.match(body, /intent === "journal"/, "Journal must be handled, not ignored");
  assert.match(body, /setJournalThreadContext\(/, "Journal must seed the thread context");
  assert.match(body, /setActiveSection\("Journal"\)/, "Journal must navigate to the journal");
});

test("the alert intent still works and short-circuits", () => {
  // Regression guard: the fix must not break the one intent that did work.
  const handler = appSource.slice(appSource.indexOf("onIntent={(asset, intent) => {"));
  const body = handler.slice(0, handler.indexOf("\n              }}"));
  assert.match(body, /intent === "alert"/);
  assert.match(body, /dispatchWatchlistAlertEmail/);
  assert.match(body, /return;/, "the alert branch must not fall through");
});

test("no watchlist onAdd prop is a silent no-op", () => {
  // `onAdd={() => {}}` is indistinguishable from a broken button.
  const occurrences = appSource.match(/onAdd=\{\(\) => \{\}\}/g) || [];
  assert.equal(occurrences.length, 0, "onAdd must not silently discard the click");
});

test("a locked watchlist explains itself instead of doing nothing", () => {
  // The locked instance must tell the user why the row will not open.
  assert.match(
    appSource,
    /is in a shared watchlist\. Upgrade to \$\{lockedWatchlistPlanLabel\} to open and manage it\./
  );
});
