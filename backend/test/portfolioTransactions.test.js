// backend/test/portfolioTransactions.test.js
// Tier 2 provider-neutral transaction notifications — pure service (no DB/network).
// Run: node --test test/portfolioTransactions.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const pt = require("../portfolioTransactions");

// Mock dispatcher capturing events.
function makeDispatch() {
  const events = [];
  const dispatch = async ({ userId, workspaceId, event }) => {
    events.push({ userId, workspaceId, event });
    return { id: events.length, ...event };
  };
  return { dispatch, events };
}

test("normalizeTransaction: maps provider-specific fields + stable idempotency key", () => {
  const src = { provider: "binance", connectionId: "conn-1", sourceAccountId: "acct-9" };
  const n = pt.normalizeTransaction({ side: "BUY", symbol: "BTC", quantity: 2, price: 30000, feeAmount: 5, currency: "USDT", platformFillId: "f-100", executedAt: "2026-07-19T10:00:00Z" }, src, { userId: 7, workspaceId: 3 });
  assert.equal(n.type, "buy");
  assert.equal(n.symbol, "BTC");
  assert.equal(n.quantity, 2);
  assert.equal(n.unitPrice, 30000);
  assert.equal(n.notional, 60000);
  assert.equal(n.fee, 5);
  assert.equal(n.currency, "USDT");
  assert.equal(pt.idempotencyKey(n), "txn:3:binance:acct-9:f-100");
});

test("idempotencyKey falls back to connectionId when no sourceAccountId", () => {
  const n = { workspaceId: 3, provider: "snaptrade", sourceAccountId: null, connectionId: "conn-x", externalTransactionId: "e-1" };
  assert.equal(pt.idempotencyKey(n), "txn:3:snaptrade:conn-x:e-1");
});

test("<=5 transactions -> one event per transaction, popup off for buy/fill", async () => {
  const { dispatch, events } = makeDispatch();
  const txns = [
    { side: "BUY", symbol: "AAPL", quantity: 10, price: 100 },
    { side: "SELL", symbol: "MSFT", quantity: 5, price: 200 },
    { type: "fill", symbol: "TSLA", quantity: 1, price: 250 }
  ];
  const created = await pt.createPortfolioTransactionNotifications({
    userId: 1, workspaceId: 2,
    source: { provider: "snaptrade", connectionId: "c1", sourceAccountId: "a1" },
    transactions: txns
  }, dispatch);
  assert.equal(created.length, 3);
  assert.equal(events.length, 3);
  assert.ok(events.every((e) => e.event.category === "execution" && e.event.severity === "success"));
  assert.ok(events.every((e) => e.event.metadata.popup === false));
  assert.ok(events.every((e) => /^txn:2:snaptrade:a1:/.test(e.event.dedupeKey)));
});

test(">5 transactions -> single grouped batch event, no popup", async () => {
  const { dispatch, events } = makeDispatch();
  const txns = Array.from({ length: 8 }, (_, i) => ({ side: "BUY", symbol: `SYM${i}`, quantity: 1, price: 10 }));
  const created = await pt.createPortfolioTransactionNotifications({
    userId: 1, workspaceId: 2,
    source: { provider: "binance", connectionId: "c1", sourceAccountId: "a1" },
    transactions: txns
  }, dispatch);
  assert.equal(created.length, 1);
  assert.equal(events[0].event.type, "portfolio_transaction.batch_imported");
  assert.equal(events[0].event.metadata.count, 8);
  assert.equal(events[0].event.metadata.popup, undefined);
});

test("popup policy: deposit/withdrawal/transfer ON; large notional ON", async () => {
  const { dispatch, events } = makeDispatch();
  await pt.createPortfolioTransactionNotifications({
    userId: 1, workspaceId: 2,
    source: { provider: "snaptrade", connectionId: "c1", sourceAccountId: "a1" },
    transactions: [
      { type: "deposit", symbol: null, quantity: null, price: null, notional: 5000, currency: "USD" },
      { type: "dividend", symbol: "KO", quantity: 1, price: 1, notional: 2, currency: "USD" },
      { type: "buy", symbol: "SPY", quantity: 10, price: 100, notional: 100000, currency: "USD" } // large if threshold <=100000
    ],
    opts: { largeThreshold: 50000 }
  }, dispatch);
  const byType = Object.fromEntries(events.map((e) => [e.event.metadata.transactionType, e.event.metadata.popup]));
  assert.equal(byType.deposit, true);
  assert.equal(byType.dividend, false);
  assert.equal(byType.buy, true); // large notional >= largeThreshold
});

test("empty transactions -> no events", async () => {
  const { dispatch, events } = makeDispatch();
  const created = await pt.createPortfolioTransactionNotifications({ userId: 1, workspaceId: 2, source: { provider: "x" }, transactions: [] }, dispatch);
  assert.equal(created.length, 0);
  assert.equal(events.length, 0);
});

test("idempotency: repeated sync with same externalTransactionId -> same dedupeKey", () => {
  const src = { provider: "binance", connectionId: "c", sourceAccountId: "a" };
  const t = { side: "BUY", symbol: "ETH", platformFillId: "fill-1" };
  const k1 = pt.idempotencyKey(pt.normalizeTransaction(t, src, { workspaceId: 9 }));
  const k2 = pt.idempotencyKey(pt.normalizeTransaction(t, src, { workspaceId: 9 }));
  assert.equal(k1, k2);
  assert.equal(k1, "txn:9:binance:a:fill-1");
});
