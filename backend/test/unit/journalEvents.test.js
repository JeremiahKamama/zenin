// journalEvents.test.js — Phase 1 unit tests (no live DB required).
// Verifies the pure classification + dedupe logic of the journal-events layer.
// detectOrRefresh is exercised against an in-memory fake `pool` that mirrors
// the upsert-on-(workspace_id, event_key) semantics of the real Postgres query.

const test = require("node:test");
const assert = require("node:assert/strict");

// Load database.js but stub its pool so schema init / Postgres never runs.
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "pg") {
    return { Pool: class { constructor() {} } };
  }
  return originalRequire.apply(this, arguments);
};

const db = require("../../database");

test.after(() => {
  Module.prototype.require = originalRequire;
});

// ── pure classification rules (spec §1) ──────────────────────────────────
test("classify: executions and fills are decision_relevant", () => {
  assert.strictEqual(db.journalEvents.classify({ eventType: "execution" }), "decision_relevant");
  assert.strictEqual(db.journalEvents.classify({ eventType: "fill" }), "decision_relevant");
  assert.strictEqual(db.journalEvents.classify({ source: "zenin_execution" }), "decision_relevant");
  assert.strictEqual(db.journalEvents.classify({ source: "broker_sync" }), "decision_relevant");
});

test("classify: transfers and sync corrections are operational", () => {
  assert.strictEqual(db.journalEvents.classify({ eventType: "transfer" }), "operational");
  assert.strictEqual(db.journalEvents.classify({ eventType: "sync_correction" }), "operational");
  assert.strictEqual(db.journalEvents.classify({ platform: "recon-engine" }), "operational");
});

test("classify: assignments and expiries are decision_relevant", () => {
  assert.strictEqual(db.journalEvents.classify({ eventType: "assignment" }), "decision_relevant");
  assert.strictEqual(db.journalEvents.classify({ eventType: "expiry" }), "decision_relevant");
  assert.strictEqual(db.journalEvents.classify({ eventType: "forced_liquidation" }), "decision_relevant");
});

test("classify: unknown falls through to unknown", () => {
  assert.strictEqual(db.journalEvents.classify({ eventType: "mystery" }), "unknown");
});

// ── event key stability / dedupe equality ───────────────────────────────
test("buildEventKey: stable for same source identity", () => {
  const a = db.journalEvents.buildEventKey({ source: "zenin_execution", clientId: "c1", symbol: "VOO", occurredAt: "2026-07-15T10:00:00.000Z" });
  const b = db.journalEvents.buildEventKey({ source: "zenin_execution", clientId: "c1", symbol: "voo", occurredAt: "2026-07-15T10:00:00.123Z" });
  assert.strictEqual(a, b, "symbol case + sub-second timestamp should not change the key");
  assert.ok(a.includes("zenin_execution"), "key carries source");
  assert.ok(a.includes("VOO"), "key carries normalized symbol");
});

test("buildEventKey: differs by clientId", () => {
  const a = db.journalEvents.buildEventKey({ source: "zenin_execution", clientId: "c1" });
  const b = db.journalEvents.buildEventKey({ source: "zenin_execution", clientId: "c2" });
  assert.notStrictEqual(a, b);
});

// ── detectOrRefresh dedupe + classification via fake pool ────────────────
function makeFakePool() {
  // In-memory table keyed by (workspace_id, event_key).
  const rows = [];
  const pool = {
    rows,
    query(text, params) {
      const upper = text.trim().toUpperCase();
      if (upper.startsWith("INSERT INTO JOURNAL_EVENTS")) {
        const [
          workspaceId, userId, eventKey, eventType, source, symbol, assetType, marketType,
          platform, accountId, side, quantity, price, notional, fee, currency, occurredAt,
          positionBefore, positionAfter, positionDelta, classification, metadataJson,
        ] = params;
        const existing = rows.find((r) => r.workspace_id === workspaceId && r.event_key === eventKey);
        const base = {
          id: existing ? existing.id : `evt-${rows.length + 1}`,
          workspace_id: workspaceId,
          user_id: userId,
          event_key: eventKey,
          event_type: eventType,
          source,
          symbol,
          asset_type: assetType,
          market_type: marketType,
          platform,
          account_id: accountId,
          side,
          quantity,
          price,
          notional,
          fee,
          currency,
          occurred_at: occurredAt,
          position_before: positionBefore,
          position_after: positionAfter,
          position_delta: positionDelta,
          classification: existing && existing.classification !== "unknown" ? existing.classification : classification,
          status: "open",
          journal_entry_id: null,
          decision_thread_id: null,
          metadata_json: metadataJson,
          created_at: existing ? existing.created_at : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (existing) {
          Object.assign(existing, base);
        } else {
          rows.push(base);
        }
        return Promise.resolve({ rows: [base] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
  return pool;
}

test("detectOrRefresh: dedupes on (workspace_id, event_key) — one row, not two", async () => {
  const fake = makeFakePool();
  const origPool = db.__poolForTest;
  // Inject fake pool by temporarily overriding the module's pool reference.
  // database.js closes over `pool`; we expose a hook for tests.
  const journalEvents = db.journalEvents;
  // Re-bind detectOrRefresh to use the fake pool via a shallow monkeypatch:
  const realQuery = journalEvents._query;
  journalEvents._query = fake.query.bind(fake);
  try {
    const raw = { source: "zenin_execution", clientId: "c1", symbol: "VOO", quantity: 10, price: 100, notional: 1000, side: "buy" };
    const first = await journalEvents.detectOrRefresh(1, raw, 10);
    const second = await journalEvents.detectOrRefresh(1, raw, 10);
    assert.strictEqual(fake.rows.length, 1, "duplicate sync event produces exactly one journal event");
    assert.strictEqual(first.id, second.id, "same id returned on dedupe");
    assert.strictEqual(second.classification, "decision_relevant", "execution classified decision_relevant");
  } finally {
    if (realQuery) journalEvents._query = realQuery;
  }
});

test("detectOrRefresh: operational event classified operational, no false thesis trigger", async () => {
  const fake = makeFakePool();
  const journalEvents = db.journalEvents;
  const realQuery = journalEvents._query;
  journalEvents._query = fake.query.bind(fake);
  try {
    const raw = { source: "broker_sync", eventType: "transfer", clientId: "t1", symbol: "VOO", quantity: 0, notional: 0 };
    const evt = await journalEvents.detectOrRefresh(1, raw, 10);
    assert.strictEqual(evt.classification, "operational", "transfer is operational");
    assert.strictEqual(fake.rows.length, 1);
  } finally {
    if (realQuery) journalEvents._query = realQuery;
  }
});

test("detectOrRefresh: workspace isolation — event in WS 10 not visible from WS 20", async () => {
  const fake = makeFakePool();
  const journalEvents = db.journalEvents;
  const realQuery = journalEvents._query;
  journalEvents._query = fake.query.bind(fake);
  try {
    await journalEvents.detectOrRefresh(1, { source: "zenin_execution", clientId: "cX", symbol: "VOO", quantity: 5, price: 50, notional: 250 }, 10);
    const inOtherWs = fake.rows.filter((r) => r.workspace_id === 20);
    assert.strictEqual(inOtherWs.length, 0, "no cross-workspace leakage");
    assert.strictEqual(fake.rows[0].workspace_id, 10);
  } finally {
    if (realQuery) journalEvents._query = realQuery;
  }
});
