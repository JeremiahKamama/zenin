"use strict";

/**
 * MyStocks Africa — centralized market-provider routing policy.
 *
 * One function decides whether MyStocks wins a given (symbol, exchange,
 * country, kind, capability) request, and what the fallback chain is.
 *
 * MyStocks is PRIMARY only for exchange-qualified listings on the 14 supported
 * African exchanges. It must NOT win routing for US/global listings, crypto,
 * options, commodity prices, intraday technicals, full financial statements,
 * analyst estimates, or standalone currency research.
 */

const { isMyStocksQualified, isSupportedExchange, isSupportedCountry, parseSymbol } = require("./symbols");

// Capabilities MyStocks may serve as primary.
const MYSTOCKS_CAPABILITIES = new Set([
  "search",
  "quote",
  "history",
  "profile",
  "fundamentals",
  "dividends",
  "corporateActions",
  "news",
  "movers",
  "bonds",
  "funds",
  "marketStatus",
  "marketIntel",
]);

// Capabilities / contexts explicitly forbidden from MyStocks.
function isForbiddenContext({ kind, capability }) {
  const cap = String(capability || "").toLowerCase();
  const k = String(kind || "").toLowerCase();
  if (["crypto", "options", "commodity", "commodities", "fx", "forex", "currency"].includes(k)) return true;
  if (["intraday", "technicals", "indicators", "estimates", "analyst", "statements", "financials_full"].includes(cap)) return true;
  return false;
}

/**
 * Decide provider + fallback chain for a market-data request.
 * @param {object} req { symbol?, exchange?, country?, kind?, capability }
 * @returns {{ primary: string|null, fallback: string[], eligible: boolean, reason?: string }}
 */
function resolveMarketProvider(req = {}) {
  const capability = String(req.capability || "quote").toLowerCase();
  const kind = String(req.kind || "").toLowerCase();

  if (isForbiddenContext({ kind, capability })) {
    return { primary: null, fallback: [], eligible: false, reason: "capability_or_kind_not_served_by_mystocks" };
  }
  if (!MYSTOCKS_CAPABILITIES.has(capability)) {
    return { primary: null, fallback: [], eligible: false, reason: "capability_not_supported" };
  }

  // Symbol-qualified (e.g. SCOM.KE) on a supported exchange → primary.
  let exchange = req.exchange;
  if (req.symbol) {
    const parsed = parseSymbol(req.symbol);
    if (parsed.exchange) exchange = parsed.exchange;
  }
  const country = req.country || (exchange ? null : null);

  const qualifiedBySymbol = req.symbol ? isMyStocksQualified(req.symbol) : false;
  const qualifiedByExchange = isSupportedExchange(exchange);
  const qualifiedByCountry = isSupportedCountry(country);

  if (!qualifiedBySymbol && !qualifiedByExchange && !qualifiedByCountry) {
    return { primary: null, fallback: [], eligible: false, reason: "not_an_african_exchange_listing" };
  }

  // Build capability-specific fallback chain (per spec).
  let fallback = [];
  if (capability === "quote" || capability === "history") {
    fallback = ["massive", "yahoo", "cache"];
  } else if (capability === "profile" || capability === "fundamentals") {
    fallback = ["fmp", "reference"];
  } else if (capability === "search") {
    fallback = ["yahoo"];
  } else {
    fallback = ["cache"];
  }
  // FX/currency research is explicitly out of scope → no MyStocks primary.
  if (capability === "fx" || capability === "forex" || capability === "currency") {
    return { primary: null, fallback: ["fx_provider", "cache"], eligible: false, reason: "fx_is_standalone_research" };
  }

  return { primary: "mystocks", fallback, eligible: true, reason: "african_exchange_qualified" };
}

module.exports = { resolveMarketProvider, MYSTOCKS_CAPABILITIES };
