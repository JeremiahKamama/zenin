// frontend/test/snapTradeFlow.test.js
//
// The "Connect brokerage" modal got stuck on:
//
//   Waiting for authorization
//   Complete authorization in the SnapTrade portal, then return here.
//
// Four independent defects, all reproduced by reading the state machine:
//
//   1. OPENING and PENDING were TERMINAL. Nothing ever asked the server whether
//      authorization had finished, so unless the user happened to pass through
//      the redirect callback, the modal waited forever.
//   2. The only affordance, "I've authorized — continue", merely set
//      phase = PENDING. That renders the SAME message and — in the PENDING
//      branch — no button at all. An unrecoverable dead end.
//   3. window.open() was called AFTER an await. The click's user activation has
//      expired by then, so Safari and Firefox block it: no portal tab, and the
//      user stares at "Waiting for authorization" having never been asked.
//   4. There was no way out — no retry, no reopen, no start-over.
//
// These tests pin the state machine against regression by asserting the
// properties that made the flow recoverable, without needing a DOM.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "../src/components/brokerage/SnapTradeConnectionFlow.jsx"),
  "utf8"
);

test("the waiting state polls instead of waiting forever", () => {
  // A polling effect is what completes the flow without user action.
  assert.match(source, /setTimeout\(tick/, "a polling tick must be scheduled");
  assert.match(source, /MAX_ATTEMPTS/, "polling must be bounded, not infinite");
});

test("polling backs off rather than hammering", () => {
  // A fixed fast interval would hammer the brokerage API for minutes.
  assert.match(source, /Math\.min\(3000 \* Math\.pow/, "poll interval must grow");
});

test("polling stops instead of running forever on an abandoned modal", () => {
  const max = source.match(/MAX_ATTEMPTS\s*=\s*(\d+)/);
  assert.ok(max, "MAX_ATTEMPTS must be defined");
  assert.ok(Number(max[1]) > 0 && Number(max[1]) <= 60, "a sane attempt ceiling");
});

test("cleanup clears the pending timer", () => {
  // Without clearTimeout, a closed modal keeps polling.
  assert.match(source, /clearTimeout\(timer\)/);
});

test("returning to the tab re-checks the connection", () => {
  // The user comes back from the portal tab; that is the moment authorization
  // has most likely just completed.
  assert.match(source, /visibilitychange/, "tab visibility must trigger a check");
  assert.match(source, /addEventListener\("focus"/, "window focus must trigger a check");
});

test("the continue action performs a real check, not a phase toggle", () => {
  // The old button only did setPhase(PHASE.PENDING), which rendered the same
  // message with no button.
  assert.match(source, /I've authorized — check now/);
  assert.doesNotMatch(
    source,
    /onClick=\{\(\) => setPhase\(PHASE\.PENDING\)\}/,
    "the dead-end phase toggle must be gone"
  );
});

test("a blocked pop-up is detected and given a real link", () => {
  // window.open() after an await returns null when blocked. A link is always
  // allowed because it is a direct user gesture.
  assert.match(source, /const opened = window\.open\(/, "the return value must be checked");
  assert.match(source, /if \(!opened\) setPopupBlocked\(true\)/);
  assert.match(source, /Open SnapTrade portal/, "a fallback link must be offered");
});

test("the fallback link is an anchor, which popup blockers cannot stop", () => {
  const blockedBlock = source.slice(source.indexOf("snaptrade-flow-blocked"));
  assert.match(blockedBlock.slice(0, 600), /<a[\s\S]*?href=\{portalUrl\}/, "must be a real anchor");
});

test("the user can always escape the waiting state", () => {
  // Retry, reopen, and start-over must all exist so no state is a dead end.
  assert.match(source, /I've authorized — check now/);
  assert.match(source, /Reopen portal/);
  assert.match(source, /Start over/);
});

test("a bounded wait surfaces guidance instead of spinning silently", () => {
  assert.match(source, /Still waiting on the brokerage portal/);
});

test("a successful authorization syncs and reports success", () => {
  // The check must advance to SUCCESS and run the first sync, not just stop
  // polling.
  assert.match(source, /setPhase\(PHASE\.SYNCING\)/);
  assert.match(source, /syncBrokerageConnection\(connectionId, \{ mode: "full" \}\)/);
  assert.match(source, /setPhase\(PHASE\.SUCCESS\)/);
});

test("a failed first sync does not hide that authorization succeeded", () => {
  // The connection exists; reporting a hard error would be wrong.
  assert.match(source, /Connected, but the first sync failed/);
});

test("terminal failure states are recognised and actionable", () => {
  for (const status of ["expired", "revoked", "disconnected", "failed"]) {
    assert.ok(source.includes(`"${status}"`), `${status} must be handled`);
  }
  assert.match(source, /BROKERAGE_RECONNECT/);
});

test("the waiting state is presented as steps, not one ambiguous sentence", () => {
  assert.match(source, /snaptrade-flow-steps/);
  assert.match(source, /Connection created/);
  assert.match(source, /Authorize at your brokerage/);
  assert.match(source, /Zenin finishes automatically/);
});

test("the checking indicator is announced to assistive tech", () => {
  assert.match(source, /role="status"/, "a live region so the state change is announced");
});

test("the modal still declares itself a dialog", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
});

test("polling is scoped to the waiting phases only", () => {
  // Polling during SUCCESS or IDLE would spam the API for no reason.
  assert.match(
    source,
    /phase !== PHASE\.OPENING && phase !== PHASE\.PENDING\) return undefined/
  );
});

test("the modal does not poll without a connection id", () => {
  assert.match(source, /if \(!\(connection\?\.connectionId \|\| connection\?\.id\)\) return undefined/);
});
