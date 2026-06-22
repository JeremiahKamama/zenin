const test = require("node:test");
const assert = require("node:assert/strict");

const { _internals } = require("../../exchangeSync");
const {
  toNumber,
  roundMoney,
  toIsoString,
  toDateString,
  uniqueValues,
  buildTradeAndFillRecord,
  deriveBinanceSpotSymbols,
  parseBybitExtraFees,
} = _internals;

// ── toNumber ──────────────────────────────────────────────────────────────────

test("toNumber returns numeric value for valid numbers", () => {
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber("3.14"), 3.14);
  assert.equal(toNumber("-7"), -7);
  assert.equal(toNumber(0), 0);
});

test("toNumber returns fallback for non-finite values", () => {
  assert.equal(toNumber(NaN), 0);
  assert.equal(toNumber(Infinity), 0);
  assert.equal(toNumber(-Infinity), 0);
  assert.equal(toNumber(undefined), 0);
  assert.equal(toNumber(null), 0);
  assert.equal(toNumber("abc"), 0);
});

test("toNumber uses custom fallback for non-finite values", () => {
  assert.equal(toNumber("bad", -1), -1);
  assert.equal(toNumber(undefined, 99), 99);
  assert.equal(toNumber(NaN, 42), 42);
});

// ── roundMoney ────────────────────────────────────────────────────────────────

test("roundMoney rounds to 8 decimal places", () => {
  assert.equal(roundMoney(1.123456789), 1.12345679);
  assert.equal(roundMoney(0), 0);
  assert.equal(roundMoney(100), 100);
});

test("roundMoney handles non-finite input", () => {
  assert.equal(roundMoney(NaN), 0);
  assert.equal(roundMoney(null), 0);
  assert.equal(roundMoney("abc"), 0);
});

// ── toIsoString ───────────────────────────────────────────────────────────────

test("toIsoString converts valid date", () => {
  const result = toIsoString("2025-01-15T10:30:00Z");
  assert.equal(result, "2025-01-15T10:30:00.000Z");
});

test("toIsoString converts timestamp", () => {
  const result = toIsoString(1700000000000);
  assert.ok(result.includes("2023-11"));
});

test("toIsoString returns current date for invalid input", () => {
  const before = new Date().toISOString().slice(0, 10);
  const result = toIsoString("not-a-date");
  assert.ok(result.startsWith(before) || result.includes("T"));
});

// ── toDateString ──────────────────────────────────────────────────────────────

test("toDateString extracts date portion", () => {
  assert.equal(toDateString("2025-03-20T15:00:00Z"), "2025-03-20");
});

test("toDateString handles timestamp", () => {
  const result = toDateString(1700000000000);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});

// ── uniqueValues ──────────────────────────────────────────────────────────────

test("uniqueValues deduplicates and trims", () => {
  const result = uniqueValues(["  abc ", "ABC", "abc", "", null, "def"]);
  assert.deepEqual(result, ["abc", "ABC", "def"]);
});

test("uniqueValues handles non-array input", () => {
  const result = uniqueValues(null);
  assert.deepEqual(result, []);
});

test("uniqueValues handles empty array", () => {
  const result = uniqueValues([]);
  assert.deepEqual(result, []);
});

// ── buildTradeAndFillRecord ───────────────────────────────────────────────────

test("buildTradeAndFillRecord builds correct trade and fill", () => {
  const { trade, tradeFill } = buildTradeAndFillRecord({
    platform: "Binance",
    clientId: "cl-001",
    platformFillId: "fill-1",
    executedAt: "2025-06-01T12:00:00Z",
    asset: "BTC",
    name: "Bitcoin",
    type: "crypto",
    side: "buy",
    marketType: "spot",
    quantity: 0.5,
    price: 60000,
    notional: 30000,
    fee: 15,
    feeCurrency: "usd",
    strategyName: "DCA",
  });

  assert.equal(trade.clientId, "cl-001");
  assert.equal(trade.asset, "BTC");
  assert.equal(trade.name, "Bitcoin");
  assert.equal(trade.side, "buy");
  assert.equal(trade.quantity, 0.5);
  assert.equal(trade.price, 60000);
  assert.equal(trade.notional, 30000);
  assert.equal(trade.fee, 15);
  assert.equal(trade.feeCurrency, "USD");
  assert.equal(trade.platform, "binance");
  assert.equal(trade.status, "Filled");
  assert.equal(trade.date, "2025-06-01");

  assert.equal(tradeFill.tradeClientId, "cl-001");
  assert.equal(tradeFill.platformFillId, "fill-1");
  assert.equal(tradeFill.symbol, "BTC");
  assert.equal(tradeFill.quantity, 0.5);
});

test("buildTradeAndFillRecord normalizes sell side", () => {
  const { trade } = buildTradeAndFillRecord({
    platform: "test",
    clientId: "c2",
    platformFillId: "f2",
    executedAt: new Date().toISOString(),
    asset: "ETH",
    name: "Ethereum",
    side: "SELL",
    quantity: -2,
    price: 3000,
  });

  assert.equal(trade.side, "sell");
  assert.equal(trade.quantity, 2);
});

test("buildTradeAndFillRecord defaults missing fields", () => {
  const { trade } = buildTradeAndFillRecord({
    platform: "",
    clientId: "c3",
    platformFillId: "f3",
    executedAt: new Date().toISOString(),
    asset: "SOL",
    side: "buy",
    quantity: 10,
    price: 150,
  });

  assert.equal(trade.platform, "zenin");
  assert.equal(trade.type, "crypto");
  assert.equal(trade.marketType, "spot");
  assert.equal(trade.feeCurrency, "USD");
  assert.equal(trade.name, "SOL");
  assert.equal(trade.notional, 1500);
});

// ── deriveBinanceSpotSymbols ──────────────────────────────────────────────────

test("deriveBinanceSpotSymbols builds symbols from balances", () => {
  const balances = [
    { asset: "BTC" },
    { asset: "ETH" },
    { asset: "USDT" },
  ];
  const exchangeSymbols = new Set(["BTCUSDT", "ETHUSDT", "BTCBUSD"]);
  const result = deriveBinanceSpotSymbols(balances, exchangeSymbols, []);

  assert.ok(result.includes("BTCUSDT"));
  assert.ok(result.includes("ETHUSDT"));
  assert.ok(!result.some((s) => s.includes("USDT") && !s.startsWith("BTC") && !s.startsWith("ETH")));
});

test("deriveBinanceSpotSymbols includes known symbols", () => {
  const result = deriveBinanceSpotSymbols([], new Set(), ["SOLUSDT"]);
  assert.ok(result.includes("SOLUSDT"));
});

test("deriveBinanceSpotSymbols skips stablecoins", () => {
  const balances = [{ asset: "USDC" }, { asset: "DAI" }];
  const result = deriveBinanceSpotSymbols(balances, new Set(["USDCUSDT"]), []);
  assert.ok(!result.includes("USDCUSDT"));
});

test("deriveBinanceSpotSymbols deduplicates", () => {
  const balances = [{ asset: "BTC" }, { asset: "BTC" }];
  const exchangeSymbols = new Set(["BTCUSDT"]);
  const result = deriveBinanceSpotSymbols(balances, exchangeSymbols, ["BTCUSDT"]);
  const btcCount = result.filter((s) => s === "BTCUSDT").length;
  assert.equal(btcCount, 1);
});

// ── parseBybitExtraFees ───────────────────────────────────────────────────────

test("parseBybitExtraFees returns array input directly", () => {
  const input = [{ fee: 1 }];
  assert.deepEqual(parseBybitExtraFees(input), input);
});

test("parseBybitExtraFees returns empty for falsy input", () => {
  assert.deepEqual(parseBybitExtraFees(null), []);
  assert.deepEqual(parseBybitExtraFees(undefined), []);
  assert.deepEqual(parseBybitExtraFees(0), []);
  assert.deepEqual(parseBybitExtraFees(""), []);
});

test("parseBybitExtraFees parses valid JSON string", () => {
  const result = parseBybitExtraFees('[{"fee": 0.5}]');
  assert.deepEqual(result, [{ fee: 0.5 }]);
});

test("parseBybitExtraFees returns empty for invalid JSON string", () => {
  const result = parseBybitExtraFees("not-json");
  assert.deepEqual(result, []);
});

test("parseBybitExtraFees returns empty for non-array JSON string", () => {
  const result = parseBybitExtraFees('{"fee": 1}');
  assert.deepEqual(result, []);
});
