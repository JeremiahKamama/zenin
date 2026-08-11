// backend/test/unifiedNotifications.test.js
// Tier 2 unified notifications — pure event-builder (no DB/network).
// Run: node --test test/unifiedNotifications.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildUnifiedNotifications, isAuthError } = require("../unifiedNotifications");

const src = (o) => Object.assign({ provider: "binance", connectionId: "k1", status: "synced", lastError: null, stale: false, lastAttemptedSyncAt: null }, o);

test("isAuthError detects auth/credential/scope errors", () => {
  assert.equal(isAuthError("401 Unauthorized"), true);
  assert.equal(isAuthError("invalid api key"), true);
  assert.equal(isAuthError("insufficient scope for read"), true);
  assert.equal(isAuthError("network timeout"), false);
});

test("auth_failure: error with auth message", () => {
  const events = buildUnifiedNotifications({
    sources: [src({ status: "error", lastError: "401 Unauthorized" })],
    prevSources: [src({ status: "synced" })]
  });
  const e = events.find((x) => x.type === "unified.sync.auth_failure");
  assert.ok(e, "auth_failure emitted");
  assert.equal(e.severity, "error");
  assert.ok(e.dedupeKey.includes("unified-auth"));
});

test("repeated_failure: still erroring after prior error + recent attempt", () => {
  const recent = new Date(Date.now() - 1000 * 60).toISOString();
  const events = buildUnifiedNotifications({
    sources: [src({ status: "error", lastError: "boom", lastAttemptedSyncAt: recent })],
    prevSources: [src({ status: "error", lastError: "boom" })]
  });
  assert.ok(events.find((x) => x.type === "unified.sync.repeated_failure"), "repeated_failure emitted");
});

test("repeated_failure suppressed when prior was not an error", () => {
  const recent = new Date(Date.now() - 1000 * 60).toISOString();
  const events = buildUnifiedNotifications({
    sources: [src({ status: "error", lastError: "boom", lastAttemptedSyncAt: recent })],
    prevSources: [src({ status: "synced" })]
  });
  assert.equal(events.find((x) => x.type === "unified.sync.repeated_failure"), undefined, "no repeated_failure on first failure");
  assert.equal(events.find((x) => x.type === "unified.sync.auth_failure"), undefined, "not an auth error");
});

test("stale: synced but last success older than threshold", () => {
  const old = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();
  const events = buildUnifiedNotifications({
    sources: [src({ status: "synced", stale: true, last_sync_at: old })],
    prevSources: [src({ status: "synced", stale: true })]
  });
  assert.ok(events.find((x) => x.type === "unified.sync.stale"), "stale emitted");
});

test("recovered: error/stale -> synced", () => {
  const events = buildUnifiedNotifications({
    sources: [src({ status: "synced", stale: false })],
    prevSources: [src({ status: "error", lastError: "boom" })]
  });
  assert.ok(events.find((x) => x.type === "unified.sync.recovered"), "recovered emitted");
});

test("material_change: total moves >= 10%", () => {
  const events = buildUnifiedNotifications({ sources: [], prevSources: [], prevTotal: 1000, newTotal: 1200 });
  const e = events.find((x) => x.type === "unified.value.material_change");
  assert.ok(e, "material_change emitted at +20%");
  assert.equal(e.severity, "info");
});

test("material_change suppressed below threshold", () => {
  const events = buildUnifiedNotifications({ sources: [], prevSources: [], prevTotal: 1000, newTotal: 1050 });
  assert.equal(events.find((x) => x.type === "unified.value.material_change"), undefined, "no event at +5%");
});

test("no events when nothing changed", () => {
  const events = buildUnifiedNotifications({
    sources: [src({ status: "synced", stale: false })],
    prevSources: [src({ status: "synced", stale: false })],
    prevTotal: 1000,
    newTotal: 1000
  });
  assert.equal(events.length, 0);
});
