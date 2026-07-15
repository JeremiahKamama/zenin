"use strict";

/**
 * MyStocks Africa — normalizers to Zenin provider-neutral contracts.
 *
 * Every upstream payload is reduced to the shape the rest of Zenin consumes.
 * Raw upstream data is preserved ONLY in `_raw` (server-side diagnostic field),
 * never returned to the frontend. Strict data-quality rules:
 *  - EOD OHLCV may carry only `close` + `volume`; never synthesize open/high/low.
 *  - Local currency and USD conversion stay SEPARATE; never overwrite price with usd.
 *  - "Key financials" are partial fundamentals — surfaced as such, never as full statements.
 */

const { parseSymbol, exchangeMeta } = require("./symbols");

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Quote normalization.
 * @param {object} raw upstream quote/stock row
 * @param {object} ctx { symbol, country?, exchange?, currency? }
 */
function normalizeQuote(raw, ctx = {}) {
  if (!raw) return null;
  const parsed = parseSymbol(ctx.symbol || raw.symbol || raw.ticker);
  const meta = exchangeMeta(parsed.exchange || ctx.exchange);
  const country = parsed.country || ctx.country || (meta && meta.country) || null;
  const exchange = parsed.exchange || ctx.exchange || null;
  const currency = ctx.currency || raw.currency || (meta && meta.currency) || null;

  const price = num(raw.price ?? raw.last ?? raw.close ?? raw.lastPrice);
  const prevClose = num(raw.prevClose ?? raw.previousClose ?? raw.open ?? null);
  let change = num(raw.change);
  let changePercent = num(raw.changePercent ?? raw.changePct);
  if (change == null && price != null && prevClose != null && prevClose !== 0) {
    change = price - prevClose;
    changePercent = (change / prevClose) * 100;
  }

  const updatedAt = iso(raw.updatedAt ?? raw.asOf ?? raw.timestamp ?? raw.lastUpdated);
  // quoteState: live if recent; the caller supplies cache freshness separately.
  const quoteState = price == null ? "unavailable" : "live";

  const result = {
    provider: "mystocks",
    source: "MyStocks Africa",
    providerSymbol: parsed.symbol || ctx.symbol,
    symbol: parsed.symbol || ctx.symbol,
    name: raw.name || raw.companyName || raw.longName || null,
    kind: ctx.kind || "stock",
    assetClass: ctx.assetClass || "equity",
    exchange,
    country,
    currency,
    price,
    priceUsd: num(raw.priceUsd ?? raw.usdPrice ?? null),
    change,
    changePercent,
    volume: num(raw.volume),
    updatedAt,
    quoteState,
    staleReason: null,
    capabilities: {
      quote: true,
      history: true,
      profile: true,
      fundamentals: "partial",
      dividends: true,
      corporateActions: true,
      news: true,
    },
  };
  if (raw.requestId || raw.request_id) result.requestId = raw.requestId || raw.request_id;
  // Diagnostic only — never sent to frontend surfaces that omit _raw.
  result._raw = raw;
  return result;
}

/**
 * History/candles normalization. EOD-only: only include fields the upstream
 * actually returned; never fabricate open/high/low when absent.
 * @param {object} raw upstream history payload
 * @param {object} ctx { symbol, interval? }
 */
function normalizeHistory(raw, ctx = {}) {
  if (!raw) return null;
  const candlesRaw = Array.isArray(raw.candles) ? raw.candles : Array.isArray(raw.data) ? raw.data : [];
  const candles = candlesRaw.map((c) => {
    const candle = { time: iso(c.time ?? c.date ?? c.t) };
    // close + volume are the EOD baseline; only attach open/high/low when present.
    const close = num(c.close ?? c.c);
    const volume = num(c.volume ?? c.v);
    if (close != null) candle.close = close;
    if (volume != null) candle.volume = volume;
    const open = num(c.open ?? c.o);
    const high = num(c.high ?? c.h);
    const low = num(c.low ?? c.l);
    if (open != null) candle.open = open;
    if (high != null) candle.high = high;
    if (low != null) candle.low = low;
    return candle;
  });

  const eodOnly = candles.some((c) => c.open == null || c.high == null || c.low == null);

  return {
    provider: "mystocks",
    symbol: ctx.symbol,
    interval: ctx.interval || raw.interval || "1d",
    candles,
    updatedAt: iso(raw.updatedAt ?? raw.asOf),
    quoteState: candles.length ? "live" : "unavailable",
    limitations: eodOnly ? ["eod_only_ohlcv"] : [],
  };
}

/** Profile normalization for a company/stock. Key financials flagged partial. */
function normalizeProfile(raw, ctx = {}) {
  if (!raw) return null;
  const parsed = parseSymbol(ctx.symbol || raw.symbol);
  const meta = exchangeMeta(parsed.exchange);
  const profile = {
    provider: "mystocks",
    source: "MyStocks Africa",
    providerSymbol: parsed.symbol || ctx.symbol,
    symbol: parsed.symbol || ctx.symbol,
    name: raw.name || raw.companyName || null,
    exchange: parsed.exchange || null,
    country: parsed.country || (meta && meta.country) || null,
    currency: ctx.currency || raw.currency || (meta && meta.currency) || null,
    sector: raw.sector || null,
    industry: raw.industry || null,
    description: raw.description || raw.about || null,
    website: raw.website || null,
    fundamentals: {
      kind: "partial", // MyStocks key financials only
      keyFinancials: raw.keyFinancials || raw.financials || null,
      // Explicitly NOT present — never represent as full statements/estimates.
      incomeStatement: null,
      balanceSheet: null,
      cashFlow: null,
      ratios: null,
      estimates: null,
      analystConsensus: null,
    },
    updatedAt: iso(raw.updatedAt ?? raw.asOf),
  };
  profile._raw = raw;
  return profile;
}

/** News / corporate-action item normalization. */
function normalizeNewsItem(raw) {
  if (!raw) return null;
  return {
    provider: "mystocks",
    source: "MyStocks Africa",
    id: raw.id || raw.uuid || null,
    title: raw.title || null,
    summary: raw.summary || raw.body || null,
    url: raw.url || null,
    type: raw.type || raw.category || "news",
    effectiveDate: iso(raw.effectiveDate ?? raw.date ?? raw.publishedAt),
    symbols: Array.isArray(raw.symbols) ? raw.symbols : raw.symbol ? [raw.symbol] : [],
    asOf: iso(raw.asOf ?? raw.publishedAt),
  };
}

/** Bond normalization (contextual card fields). */
function normalizeBond(raw) {
  if (!raw) return null;
  return {
    provider: "mystocks",
    source: "MyStocks Africa",
    id: raw.id || raw.isin || null,
    name: raw.name || null,
    country: raw.country || null,
    currency: raw.currency || null,
    kind: "bond",
    coupon: num(raw.coupon),
    maturity: raw.maturity ? String(raw.maturity) : null,
    minimumInvestment: num(raw.minimumInvestment),
    currentYield: num(raw.currentYield ?? raw.yield),
    type: raw.type || null,
    updatedAt: iso(raw.updatedAt ?? raw.asOf),
    _raw: raw,
  };
}

/** Fund / MMF / unit-trust normalization (contextual card fields). */
function normalizeFund(raw) {
  if (!raw) return null;
  return {
    provider: "mystocks",
    source: "MyStocks Africa",
    id: raw.id || raw.isin || null,
    name: raw.name || null,
    country: raw.country || null,
    currency: raw.currency || null,
    kind: "fund",
    fundType: raw.type || raw.fundType || null,
    nav: num(raw.nav),
    annualisedReturn: num(raw.annualisedReturn ?? raw.return),
    minimumInvestment: num(raw.minimumInvestment),
    updatedAt: iso(raw.updatedAt ?? raw.asOf),
    _raw: raw,
  };
}

/** Market status / exchange hours normalization. */
function normalizeMarketStatus(raw, ctx = {}) {
  return {
    provider: "mystocks",
    source: "MyStocks Africa",
    exchange: ctx.exchange || null,
    state: raw && raw.state ? String(raw.state).toLowerCase() : (raw && raw.open ? "open" : "closed"),
    open: Boolean(raw ? raw.open : false),
    nextOpen: iso(raw && raw.nextOpen),
    nextClose: iso(raw && raw.nextClose),
    asOf: iso(raw && (raw.asOf || raw.updatedAt)),
  };
}

/** Market movers normalization. */
function normalizeMovers(raw, ctx = {}) {
  const items = Array.isArray(raw) ? raw : (raw && raw.movers) || [];
  return {
    provider: "mystocks",
    source: "MyStocks Africa",
    exchange: ctx.exchange || null,
    direction: ctx.direction || "top_gainers",
    items: items.map((m) => {
      const n = normalizeQuote(m, { symbol: m.symbol, kind: "stock" });
      return n || { symbol: m.symbol, price: null, quoteState: "unavailable" };
    }),
    asOf: iso(raw && (raw.asOf || raw.updatedAt)),
  };
}

module.exports = {
  normalizeQuote,
  normalizeHistory,
  normalizeProfile,
  normalizeNewsItem,
  normalizeBond,
  normalizeFund,
  normalizeMarketStatus,
  normalizeMovers,
};
