"use strict";

/**
 * MyStocks Africa — REST client.
 *
 * Single client implementing the Market Data API surface. Auth standardizes on
 * `Authorization: *** (recommended "Option A" in MyStocks docs). Base URL and
 * key are resolved from environment; sandbox vs live is selected by
 * MYSTOCKS_AFRICA_ENV. Never returns keys/raw credentials/upstream headers to
 * callers — sensitive fields are stripped before any payload leaves this module.
 *
 * GET calls use retry-safe exponential backoff; 429 honors Retry-After; timeouts
 * are bounded by MYSTOCKS_AFRICA_TIMEOUT_MS. Quotes are cached briefly, reference
 * data aggressively (see cache.js).
 *
 * The HTTP transport is injectable (opts.http) for testing; defaults to axios.
 */

const axios = require("axios");
const { MyStocksError, fromHttpError, configError } = require("./errors");
const { makeCache } = require("./cache");
const { parseSymbol } = require("./symbols");

const SANDBOX_BASE = "https://mystocks.africa/api/sandbox/v1/partner";
const PROD_BASE = "https://mystocks.africa/api/v1/partner";
const QUOTE_BATCH_LIMIT = 50;

function readConfig() {
  const enabled = String(process.env.MYSTOCKS_AFRICA_ENABLED || "false").toLowerCase() === "true";
  const env = String(process.env.MYSTOCKS_AFRICA_ENV || "sandbox").toLowerCase();
  const key = env === "live"
    ? (process.env.MYSTOCKS_AFRICA_LIVE_KEY || "")
    : (process.env.MYSTOCKS_AFRICA_SANDBOX_KEY || "");
  const baseUrl = process.env.MYSTOCKS_AFRICA_BASE_URL
    ? process.env.MYSTOCKS_AFRICA_BASE_URL.replace(/\/$/, "")
    : (env === "live" ? PROD_BASE : SANDBOX_BASE);
  const timeoutMs = Number(process.env.MYSTOCKS_AFRICA_TIMEOUT_MS) || 10000;
  const tradingEnabled = String(process.env.MYSTOCKS_AFRICA_TRADING_ENABLED || "false").toLowerCase() === "true";
  return { enabled, env, key, baseUrl, timeoutMs, tradingEnabled };
}

function isConfigured(cfg) {
  return Boolean(cfg && cfg.key && cfg.key.length > 0);
}

/**
 * Strip anything sensitive before it can leak. Upstream responses are trusted
 * to not contain secrets, but we defensively drop any header-like or key field.
 */
function sanitizeOutbound(payload) {
  if (payload == null || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) return payload.map(sanitizeOutbound);
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    const lk = k.toLowerCase();
    if (lk.includes("key") || lk.includes("secret") || lk.includes("token") || lk.includes("authorization") || lk === "password") {
      continue;
    }
    out[k] = typeof v === "object" ? sanitizeOutbound(v) : v;
  }
  return out;
}

function makeClient(opts = {}) {
  const cfg = opts.config || readConfig();
  const cache = opts.cache || makeCache();
  const http = opts.http || axios;

  function buildHeaders() {
    return {
      Authorization: `Bearer ${cfg.key}`,
      Accept: "application/json",
    };
  }

  async function request(method, path, { params, data, retries = 2, tier = "reference" } = {}) {
    if (!isConfigured(cfg)) {
      throw configError("MyStocks Africa is not configured (no API key for the selected environment).");
    }
    if (!cfg.enabled && !opts.allowWhenDisabled) {
      throw configError("MyStocks Africa is disabled (MYSTOCKS_AFRICA_ENABLED=false).");
    }

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const started = Date.now();
      try {
        const resp = await http.request({
          method,
          url: `${cfg.baseUrl}${path}`,
          params,
          data,
          headers: buildHeaders(),
          timeout: cfg.timeoutMs,
          validateStatus: (s) => s < 400,
        });
        const latencyMs = Date.now() - started;
        const body = sanitizeOutbound(resp.data);
        return { body, latencyMs, requestId: resp.headers && (resp.headers["x-request-id"] || resp.headers["request-id"]) || null };
      } catch (err) {
        const me = fromHttpError(err, { requestId: err && err.response && err.response.headers
          ? (err.response.headers["x-request-id"] || err.response.headers["request-id"])
          : null });
        if (me.retryable && attempt < retries) {
          attempt += 1;
          const wait = me.retryAfterMs && me.retryAfterMs > 0
            ? Math.min(me.retryAfterMs, cfg.timeoutMs)
            : Math.min(250 * 2 ** attempt, 2000);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw me;
      }
    }
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function getQuotes(symbols) {
    const list = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
    const out = [];
    for (const batch of chunk(list, QUOTE_BATCH_LIMIT)) {
      const cached = batch
        .map((s) => cache.getQuote(s))
        .filter(Boolean);
      const uncached = batch.filter((s) => !cache.getQuote(s));
      if (uncached.length === 0) {
        out.push(...cached);
        continue;
      }
      const { body } = await request("GET", "/market/quotes", { params: { symbols: uncached.join(",") }, tier: "quote" });
      const rows = Array.isArray(body) ? body : (body && body.quotes) || [];
      for (const r of rows) {
        const sym = (r.symbol || r.ticker || "").toUpperCase();
        const normalized = require("./normalizers").normalizeQuote(r, { symbol: sym });
        if (normalized) {
          cache.setQuote(sym, normalized, normalized.updatedAt);
          out.push(normalized);
        }
      }
    }
    return out;
  }

  async function getCachedOrFetch(cacheKey, path, params) {
    const hit = cache.getReference(cacheKey);
    if (hit) return hit;
    const { body } = await request("GET", path, { params, tier: "reference" });
    cache.setReference(cacheKey, body);
    return body;
  }

  return {
    config: cfg,
    isConfigured: () => isConfigured(cfg),

    listStocks: ({ exchange, sector, assetType, search } = {}) =>
      getCachedOrFetch(`stocks:${exchange || ""}:${sector || ""}:${assetType || ""}:${search || ""}`, "/stocks", { params: { exchange, sector, assetType, search } }),
    getStock: (symbol) => request("GET", `/stocks/${encodeURIComponent(symbol)}`, { tier: "reference" }).then((r) =>
      require("./normalizers").normalizeQuote(r.body, { symbol })),
    getStockChart: (symbol, period) => request("GET", `/stocks/${encodeURIComponent(symbol)}/chart`, { params: { period }, tier: "reference" }).then((r) =>
      require("./normalizers").normalizeHistory(r.body, { symbol, interval: period })),
    getStockHistory: (symbol, period) => request("GET", `/stocks/${encodeURIComponent(symbol)}/history`, { params: { period }, tier: "reference" }).then((r) =>
      require("./normalizers").normalizeHistory(r.body, { symbol, interval: period })),

    listEtfs: ({ exchange, search } = {}) =>
      getCachedOrFetch(`etfs:${exchange || ""}:${search || ""}`, "/etfs", { params: { exchange, search } }),
    getEtf: (symbol) => request("GET", `/etfs/${encodeURIComponent(symbol)}`, { tier: "reference" }).then((r) =>
      require("./normalizers").normalizeQuote(r.body, { symbol, kind: "etf", assetClass: "etf" })),
    getEtfChart: (symbol, period) => request("GET", `/etfs/${encodeURIComponent(symbol)}/chart`, { params: { period }, tier: "reference" }).then((r) =>
      require("./normalizers").normalizeHistory(r.body, { symbol, interval: period })),
    getEtfHistory: (symbol, period) => request("GET", `/etfs/${encodeURIComponent(symbol)}/history`, { params: { period }, tier: "reference" }).then((r) =>
      require("./normalizers").normalizeHistory(r.body, { symbol, interval: period })),

    listCompanies: ({ exchange, sector } = {}) =>
      getCachedOrFetch(`companies:${exchange || ""}:${sector || ""}`, "/companies", { params: { exchange, sector } }),
    getCompany: (symbol) => request("GET", `/companies/${encodeURIComponent(symbol)}`, { tier: "reference" }).then((r) =>
      require("./normalizers").normalizeProfile(r.body, { symbol })),
    getCompanyNews: (symbol, type) => request("GET", `/companies/${encodeURIComponent(symbol)}/news`, { params: { type }, tier: "reference" }).then((r) => {
      const items = Array.isArray(r.body) ? r.body : (r.body && r.body.news) || [];
      return items.map((n) => require("./normalizers").normalizeNewsItem(n));
    }),

    getMarketMovers: ({ exchange, direction, limit, page } = {}) => request("GET", "/market/movers", { params: { exchange, direction, limit, page }, tier: "reference" }).then((r) =>
      require("./normalizers").normalizeMovers(r.body, { exchange, direction })),
    getMarketStatus: (exchange) => request("GET", "/market/status", { params: { exchange }, tier: "reference" }).then((r) =>
      require("./normalizers").normalizeMarketStatus(r.body, { exchange })),
    getMarketExchanges: () => getCachedOrFetch("exchanges", "/market/exchanges"),
    getMarketHolidays: ({ exchange, from, to } = {}) => request("GET", "/market/holidays", { params: { exchange, from, to }, tier: "reference" }).then((r) => r.body),
    getMarketSettlement: () => getCachedOrFetch("settlement", "/market/settlement"),
    getMarketOhlcv: ({ symbol, exchange, from, to } = {}) => request("GET", "/market/ohlcv", { params: { symbol, exchange, from, to }, tier: "reference" }).then((r) =>
      require("./normalizers").normalizeHistory(r.body, { symbol, interval: "1d" })),
    getDividendsCalendar: ({ exchange, from, to } = {}) => request("GET", "/market/dividends", { params: { exchange, from, to }, tier: "reference" }).then((r) => r.body),
    getBonds: ({ country, type } = {}) => getCachedOrFetch(`bonds:${country || ""}:${type || ""}`, "/bonds", { params: { country, type } }),
    getBond: (id) => request("GET", `/bonds/${encodeURIComponent(id)}`, { tier: "reference" }).then((r) => require("./normalizers").normalizeBond(r.body)),
    getFunds: ({ country, type } = {}) => getCachedOrFetch(`funds:${country || ""}:${type || ""}`, "/funds", { params: { country, type } }),
    getFund: (id) => request("GET", `/funds/${encodeURIComponent(id)}`, { tier: "reference" }).then((r) => require("./normalizers").normalizeFund(r.body)),
    getMarketIntel: ({ exchange, limit } = {}) => request("GET", "/market-intel", { params: { exchange, limit }, tier: "reference" }).then((r) => {
      const items = Array.isArray(r.body) ? r.body : (r.body && r.body.articles) || [];
      return items.map((n) => require("./normalizers").normalizeNewsItem(n));
    }),
    getFxRates: () => getCachedOrFetch("fxrates", "/fx/rates", { tier: "reference" }),

    getQuotes,
    healthCheck: async () => {
      const started = Date.now();
      try {
        await request("GET", "/account", { tier: "reference" });
        return { provider: "mystocks", configured: true, state: "healthy", latencyMs: Date.now() - started, lastCheckedAt: new Date().toISOString() };
      } catch (err) {
        const state = err instanceof MyStocksError && err.isConfigError ? "unconfigured" : "unavailable";
        return { provider: "mystocks", configured: isConfigured(cfg), state, latencyMs: Date.now() - started, lastCheckedAt: new Date().toISOString(), error: err.message };
      }
    },
  };
}

module.exports = { makeClient, readConfig, isConfigured, QUOTE_BATCH_LIMIT, SANDBOX_BASE, PROD_BASE };
