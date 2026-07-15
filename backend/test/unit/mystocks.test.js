"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseSymbol, isMyStocksQualified, isSupportedExchange, toProviderSymbol, MYSTOCKS_EXCHANGES } = require("../../providers/mystocks/symbols");
const { resolveMarketProvider } = require("../../providers/mystocks/routing");
const { normalizeQuote, normalizeHistory, normalizeProfile, normalizeBond, normalizeFund } = require("../../providers/mystocks/normalizers");
const { fromHttpError, MyStocksError, configError } = require("../../providers/mystocks/errors");
const { QUOTE_BATCH_LIMIT } = require("../../providers/mystocks/client");

// ── Symbol parsing + routing ────────────────────────────────────────────────
test("parseSymbol extracts exchange from DOT suffix", () => {
  const p = parseSymbol("scom.ke");
  assert.equal(p.symbol, "SCOM.KE");
  assert.equal(p.exchange, "NSE");
  assert.equal(p.country, "KE");
  assert.equal(p.qualified, true);
});

test("parseSymbol with no suffix is not qualified", () => {
  const p = parseSymbol("AAPL");
  assert.equal(p.qualified, false);
  assert.equal(p.exchange, null);
});

test("isMyStocksQualified true only for supported African exchanges", () => {
  assert.equal(isMyStocksQualified("SCOM.KE"), true);
  assert.equal(isMyStocksQualified("DANGCEM.NG"), true);
  assert.equal(isMyStocksQualified("MTN.ZA"), true);
  assert.equal(isMyStocksQualified("AAPL"), false);
  assert.equal(isMyStocksQualified("SCOM.XX"), false); // unknown suffix
});

test("toProviderSymbol builds DOT symbol", () => {
  assert.equal(toProviderSymbol("scom", "ke"), "SCOM.KE");
});

test("routing: MyStocks primary for African exchange-qualified quote", () => {
  const r = resolveMarketProvider({ symbol: "SCOM.KE", capability: "quote" });
  assert.equal(r.eligible, true);
  assert.equal(r.primary, "mystocks");
  assert.ok(r.fallback.includes("massive"));
});

test("routing: no MyStocks for US/global listings", () => {
  const r = resolveMarketProvider({ symbol: "AAPL", capability: "quote" });
  assert.equal(r.eligible, false);
  assert.notEqual(r.primary, "mystocks");
});

test("routing: no MyStocks for crypto", () => {
  const r = resolveMarketProvider({ symbol: "BTC", kind: "crypto", capability: "quote" });
  assert.equal(r.eligible, false);
});

test("routing: no MyStocks for standalone FX research", () => {
  const r = resolveMarketProvider({ symbol: "EURUSD", kind: "forex", capability: "fx" });
  assert.equal(r.eligible, false);
});

test("routing: no MyStocks for intraday/estimates", () => {
  assert.equal(resolveMarketProvider({ symbol: "SCOM.KE", capability: "intraday" }).eligible, false);
  assert.equal(resolveMarketProvider({ symbol: "SCOM.KE", capability: "estimates" }).eligible, false);
});

test("routing: African profile falls back to FMP", () => {
  const r = resolveMarketProvider({ symbol: "SCOM.KE", capability: "profile" });
  assert.equal(r.primary, "mystocks");
  assert.ok(r.fallback.includes("fmp"));
});

// ── Normalization ───────────────────────────────────────────────────────────
test("normalizeQuote keeps local price and USD separate", () => {
  const q = normalizeQuote({ price: 16.5, priceUsd: 0.1273, changePercent: 1.54, volume: 4210000, updatedAt: "2026-07-15T10:00:00Z" }, { symbol: "SCOM.KE" });
  assert.equal(q.price, 16.5);
  assert.equal(q.priceUsd, 0.1273);
  assert.equal(q.currency, "KES");
  assert.equal(q.exchange, "NSE");
  assert.equal(q.quoteState, "live");
  assert.equal(q.capabilities.fundamentals, "partial");
});

test("normalizeHistory does not invent open/high/low when absent (EOD)", () => {
  const h = normalizeHistory({ candles: [{ time: "2026-07-15", close: 16.5, volume: 100 }] }, { symbol: "SCOM.KE" });
  assert.equal(h.candles.length, 1);
  assert.equal(h.candles[0].close, 16.5);
  assert.equal(h.candles[0].open, undefined);
  assert.equal(h.candles[0].high, undefined);
  assert.equal(h.candles[0].low, undefined);
  assert.deepEqual(h.limitations, ["eod_only_ohlcv"]);
});

test("normalizeHistory preserves OHLC when present", () => {
  const h = normalizeHistory({ candles: [{ time: "2026-07-15", open: 16, high: 17, low: 15.5, close: 16.5, volume: 100 }] }, { symbol: "SCOM.KE" });
  assert.equal(h.candles[0].open, 16);
  assert.equal(h.candles[0].high, 17);
  assert.equal(h.candles[0].low, 15.5);
  assert.equal(h.limitations.length, 0);
});

test("normalizeProfile flags fundamentals partial, no full statements", () => {
  const p = normalizeProfile({ name: "Safaricom PLC", keyFinancials: { eps: 0.5 } }, { symbol: "SCOM.KE" });
  assert.equal(p.fundamentals.kind, "partial");
  assert.equal(p.fundamentals.incomeStatement, null);
  assert.equal(p.fundamentals.estimates, null);
  assert.equal(p.fundamentals.analystConsensus, null);
});

test("normalizeBond and normalizeFund carry contextual fields", () => {
  const b = normalizeBond({ id: "KE10Y", coupon: 13.5, maturity: "2034", minimumInvestment: 100, currentYield: 13.2 });
  assert.equal(b.coupon, 13.5);
  assert.equal(b.kind, "bond");
  const f = normalizeFund({ id: "CICMMF", nav: 10.2, annualisedReturn: 12.1, minimumInvestment: 100 });
  assert.equal(f.nav, 10.2);
  assert.equal(f.kind, "fund");
});

// ── Error mapping ───────────────────────────────────────────────────────────
test("error mapping: 401/403 are config errors", () => {
  const e401 = fromHttpError({ response: { status: 401, data: { error: { code: "INVALID_KEY", message: "bad" } } } });
  assert.ok(e401 instanceof MyStocksError);
  assert.equal(e401.isConfigError, true);
  const e403 = fromHttpError({ response: { status: 403, data: { error: { code: "FORBIDDEN" } } } });
  assert.equal(e403.isConfigError, true);
});

test("error mapping: 429 is retryable and reads Retry-After", () => {
  const e = fromHttpError({ response: { status: 429, headers: { "retry-after": "2" }, data: { error: { code: "RATE_LIMITED" } } } });
  assert.equal(e.retryable, true);
  assert.equal(e.retryAfterMs, 2000);
});

test("error mapping: 5xx retryable; timeout identified", () => {
  const e5 = fromHttpError({ response: { status: 503, data: { error: { code: "UPSTREAM" } } } });
  assert.equal(e5.retryable, true);
  const et = fromHttpError({ code: "ECONNABORTED" });
  assert.equal(et.code, "mystocks_timeout");
});

test("configError marks unconfigured", () => {
  const e = configError("no key");
  assert.equal(e.isConfigError, true);
});

// ── Batch limit ─────────────────────────────────────────────────────────────
test("QUOTE_BATCH_LIMIT is 50", () => {
  assert.equal(QUOTE_BATCH_LIMIT, 50);
});

// ── No-key-leak guarantee (sanitizeOutbound) ────────────────────────────────
test("normalizers never surface upstream raw credentials", () => {
  const q = normalizeQuote({ price: 1, apiKey: "sk_live_secret", secret: "x", authorization: "Bearer y" }, { symbol: "SCOM.KE" });
  // _raw is the diagnostic field; sensitive keys must not appear in public fields.
  assert.equal(q.apiKey, undefined);
  assert.equal(q.secret, undefined);
  assert.equal(q.authorization, undefined);
});
