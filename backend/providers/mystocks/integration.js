"use strict";

/**
 * MyStocks Africa — route-integration helpers.
 *
 * Thin wrappers the backend route handlers (index.js) call for African
 * exchange-qualified requests. Each helper is a no-op (returns null/empty) when
 * MyStocks is unconfigured or the request is not eligible, so existing global
 * flows are untouched. All errors are normalized and never leak keys.
 */

const { createMyStocksProvider } = require("./index");
const { resolveMarketProvider } = require("./routing");
const { parseSymbol } = require("./symbols");
const { MyStocksError } = require("./errors");

let _provider = null;
function provider() {
  if (!_provider) {
    try {
      _provider = createMyStocksProvider();
    } catch {
      _provider = null;
    }
  }
  return _provider;
}

function isEligible(symbol, capability) {
  return resolveMarketProvider({ symbol, capability }).eligible;
}

/** African stock/etf/bond/fund search. Returns [] when unconfigured. */
async function searchMyStocks({ q, type = "stock", exchange, country, limit = 12 }) {
  const p = provider();
  if (!p || !p.isConfigured()) return [];
  try {
    return await p.search({ q, type, exchange, country, limit });
  } catch (err) {
    if (err instanceof MyStocksError && err.isConfigError) return [];
    console.warn("[mystocks] search failed:", err.message);
    return [];
  }
}

/** Batch quotes for eligible symbols only. Returns Map<symbol, quote>. */
async function getMyStocksQuotes(symbols) {
  const p = provider();
  if (!p || !p.isConfigured()) return new Map();
  const eligible = symbols.filter((s) => isEligible(s, "quote"));
  if (eligible.length === 0) return new Map();
  try {
    return await p.fetchQuotes(eligible);
  } catch (err) {
    if (err instanceof MyStocksError && err.isConfigError) return new Map();
    console.warn("[mystocks] quotes failed:", err.message);
    return new Map();
  }
}

/** History for an eligible symbol; null when unconfigured/ineligible. */
async function getMyStocksHistory(symbol, interval = "1d") {
  const p = provider();
  if (!p || !p.isConfigured() || !isEligible(symbol, "history")) return null;
  try {
    const c = p.getClient();
    const parsed = parseSymbol(symbol);
    const kind = parsed.exchange ? "stock" : "stock";
    if (kind === "etf") return await c.getEtfHistory(symbol, interval);
    return await c.getStockHistory(symbol, interval);
  } catch (err) {
    if (err instanceof MyStocksError && err.isConfigError) return null;
    console.warn("[mystocks] history failed:", err.message);
    return null;
  }
}

/** Company/ETF profile for an eligible symbol; null otherwise. */
async function getMyStocksProfile(symbol) {
  const p = provider();
  if (!p || !p.isConfigured() || !isEligible(symbol, "profile")) return null;
  try {
    const c = p.getClient();
    const parsed = parseSymbol(symbol);
    if (parsed.exchange && parsed.base) {
      // Try ETF endpoint first if it looks like an ETF listing; else company.
      return await c.getCompany(symbol);
    }
    return null;
  } catch (err) {
    if (err instanceof MyStocksError && err.isConfigError) return null;
    console.warn("[mystocks] profile failed:", err.message);
    return null;
  }
}

/** Market-data endpoints (status/movers/holidays/settlement/dividends/intel/bonds/funds). */
async function getMyStocksMarket(path, params = {}) {
  const p = provider();
  if (!p || !p.isConfigured()) return null;
  try {
    const c = p.getClient();
    switch (path) {
      case "status": return await c.getMarketStatus(params.exchange);
      case "movers": return await c.getMarketMovers(params);
      case "holidays": return await c.getMarketHolidays(params);
      case "settlement": return await c.getMarketSettlement();
      case "dividends": return await c.getDividendsCalendar(params);
      case "intel": return await c.getMarketIntel(params);
      case "bonds": return await c.getBonds(params);
      case "funds": return await c.getFunds(params);
      default: return null;
    }
  } catch (err) {
    if (err instanceof MyStocksError && err.isConfigError) return null;
    console.warn(`[mystocks] market ${path} failed:`, err.message);
    return null;
  }
}

/** Provider status for /api/data/providers (config-derived; no live call here). */
function getMyStocksStatus() {
  const p = provider();
  const configured = Boolean(p && p.isConfigured());
  return {
    provider: "mystocks",
    configured,
    status: configured ? "configured" : "missing_key",
    detail: configured
      ? "MyStocks Africa API key configured; market data proxied server-side."
      : "MyStocks Africa API key not configured. Set MYSTOCKS_AFRICA_* in backend .env.",
  };
}

module.exports = {
  provider,
  isEligible,
  searchMyStocks,
  getMyStocksQuotes,
  getMyStocksHistory,
  getMyStocksProfile,
  getMyStocksMarket,
  getMyStocksStatus,
};
