// ETFdbApiProvider — server-side ETFdb adapter (SHELL).
//
// This module is the integration point for ETFdb (replacing the legacy
// process-based scraper). Per the integration plan it owns package calls,
// throttling, in-flight de-duplication, per-dataset TTL cache, validation,
// normalization, stale fallback, observability, and safe error mapping.
//
// SAFETY GATE (important): NO live ETFdb request is made unless BOTH:
//   1. ETF_INTELLIGENCE_PROVIDER === "ETFDB_API"
//   2. ETF_INTELLIGENCE_ETFDB_API_ENABLED === "true"
// and a concrete `fetchImpl` is injected (the actual etfdb-api call). Until
// then every method returns the honest "unavailable" contract — no scraping,
// no fabricated data. This is intentional: ETFdb's endpoint is undocumented
// and its terms must be confirmed before production use.
//
// The calculation helpers (compareEtfs / calculateEtfPortfolioOverlap) are
// PURE Zenin logic and do NOT call ETFdb; they operate on whichever normalized
// composition data is supplied and return an explicit unavailable explanation
// when holdings are absent.

const { ETFdbApiCache } = require("./ETFdbApiCache");
const N = require("./ETFdbApiNormalizer");

const ENABLED =
  String(process.env.ETF_INTELLIGENCE_PROVIDER || "").toUpperCase() === "ETFDB_API" &&
  String(process.env.ETF_INTELLIGENCE_ETFDB_API_ENABLED || "false").toLowerCase() === "true";

const MIN_INTERVAL_MS = Math.max(
  3_000,
  Number(process.env.ETF_INTELLIGENCE_ETFDB_MIN_INTERVAL_MS || 3_500)
);

function validSymbol(symbol) {
  return /^[A-Z0-9.-]{1,15}$/.test(String(symbol || "").trim().toUpperCase());
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

// ── throttle + in-flight de-duplication (shared scaffolding) ──────────────
let lastRequestAt = 0;
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function pace() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) await wait(MIN_INTERVAL_MS - elapsed);
  lastRequestAt = Date.now();
}

// ── circuit breaker (hardening for the live path) ─────────────────────────
// Pure, no network. When upstream failures exceed the threshold within the
// window, the breaker OPENS and short-circuits live calls to "unavailable"
// (with stale fallback if cached) until the cooldown elapses. This protects
// Zenin from hammering ETFdb when it is down/rate-limiting/blocking, and is a
// required §11 guardrail. Inert while the adapter is non-live; becomes active
// the moment a fetchImpl is injected + enabled.
class CircuitBreaker {
  constructor({ threshold = 5, windowMs = 60_000, cooldownMs = 30_000 } = {}) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.cooldownMs = cooldownMs;
    this.failures = [];
    this.openedAt = 0;
    this.totalSuccess = 0;
    this.totalFailure = 0;
  }
  isOpen() {
    if (this.openedAt && Date.now() - this.openedAt < this.cooldownMs) return true;
    if (this.openedAt) this.openedAt = 0; // cooldown elapsed → try again
    const cutoff = Date.now() - this.windowMs;
    this.failures = this.failures.filter((t) => t > cutoff);
    return this.failures.length >= this.threshold;
  }
  recordSuccess() {
    this.totalSuccess += 1;
    this.failures = this.failures.filter((t) => t > Date.now() - this.windowMs);
  }
  recordFailure() {
    this.totalFailure += 1;
    this.failures.push(Date.now());
    if (this.failures.filter((t) => t > Date.now() - this.windowMs).length >= this.threshold) {
      this.openedAt = Date.now();
    }
  }
  snapshot() {
    return {
      open: this.isOpen(),
      failuresInWindow: this.failures.filter((t) => t > Date.now() - this.windowMs).length,
      threshold: this.threshold,
      totalSuccess: this.totalSuccess,
      totalFailure: this.totalFailure,
    };
  }
}

function createEtfDataProvider(options = {}) {
  const cache = options.cache || ETFdbApiCache.fromEnv();
  // fetchImpl is the single place a real etfdb-api call would live. It is
  // injected (never required directly) so the package is optional at runtime.
  const fetchImpl = options.fetchImpl && typeof options.fetchImpl === "object" ? options.fetchImpl : null;
  const live = ENABLED && Boolean(fetchImpl) && typeof fetchImpl.getOverview === "function";
  const breaker = new CircuitBreaker({
    threshold: Number(process.env.ETF_INTELLIGENCE_ETFDB_CB_THRESHOLD || 5),
    windowMs: Number(process.env.ETF_INTELLIGENCE_ETFDB_CB_WINDOW_MS || 60_000),
    cooldownMs: Number(process.env.ETF_INTELLIGENCE_ETFDB_CB_COOLDOWN_MS || 30_000),
  });
  const inflight = new Map();

  async function guardedFetch(namespace, symbol, rawFetcher, normalizer, normalizerArgs = []) {
    if (!live || !validSymbol(symbol)) {
      return { data: N.normalizeUnavailable(symbol), available: false, freshness: "unavailable" };
    }
    if (breaker.isOpen()) {
      const stale = cache.get(namespace, normalizeSymbol(symbol));
      return stale
        ? { data: stale, available: true, freshness: "stale", cached: true, breakerOpen: true }
        : { data: N.normalizeUnavailable(symbol), available: false, freshness: "unavailable", breakerOpen: true };
    }
    const key = normalizeSymbol(symbol);
    const cached = cache.get(namespace, key);
    if (cached) return { data: cached, available: true, freshness: "fresh", cached: true };

    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      try {
        await pace();
        const raw = await rawFetcher(key);
        if (!raw) { breaker.recordFailure(); return { data: N.normalizeUnavailable(symbol), available: false, freshness: "unavailable" }; }
        const fetchedAt = new Date().toISOString();
        const data = normalizer(raw, fetchedAt, "fresh", { [namespace]: N.PROVIDER });
        cache.set(namespace, key, data);
        breaker.recordSuccess();
        return { data, available: true, freshness: "fresh" };
      } catch {
        breaker.recordFailure();
        const stale = cache.get(namespace, key);
        if (stale) return { data: stale, available: true, freshness: "stale", cached: true };
        return { data: N.normalizeUnavailable(symbol), available: false, freshness: "unavailable" };
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, task);
    return task;
  }

  // ── caller-facing interface ──────────────────────────────────────────────
  async function search({ query, filters = {}, page = 1, sort } = {}) {
    if (!live) {
      return { query: query || "", results: [], available: false, provider: N.PROVIDER, freshness: "unavailable" };
    }
    // Real implementation would call fetchImpl.search(...) and normalize each
    // result. Kept minimal here to avoid live calls in the shell.
    const raw = await fetchImpl.search({ query, filters, page, sort });
    const results = Array.isArray(raw) ? raw.map(N.normalizeSearchResult) : [];
    return { query: query || "", results, available: true, provider: N.PROVIDER, freshness: "fresh" };
  }

  async function getOverview(symbol) {
    const { data, available, freshness, breakerOpen, cached } = await guardedFetch(
      "profile", symbol, (s) => fetchImpl.getOverview(s), N.normalizeOverview
    );
    return { symbol: normalizeSymbol(symbol), ...data, available, freshness, breakerOpen, cached };
  }

  async function getComposition(symbol) {
    const { data, available, freshness, breakerOpen, cached } = await guardedFetch(
      "holdings", symbol, (s) => fetchImpl.getComposition(s), N.normalizeComposition
    );
    return { symbol: normalizeSymbol(symbol), ...data, available, freshness, breakerOpen, cached };
  }

  async function getMetrics(symbol) {
    const { data, available, freshness, breakerOpen, cached } = await guardedFetch(
      "profile", symbol, (s) => fetchImpl.getMetrics(s), N.normalizeMetrics
    );
    return { symbol: normalizeSymbol(symbol), ...data, available, freshness, breakerOpen, cached };
  }

  async function getFlows(symbol) {
    const { data, available, freshness, breakerOpen, cached } = await guardedFetch(
      "flows", symbol, (s) => fetchImpl.getFlows(s), N.normalizeFlows
    );
    return { symbol: normalizeSymbol(symbol), ...data, available, freshness, breakerOpen, cached };
  }

  async function compare({ symbols = [] } = {}) {
    const syms = Array.isArray(symbols) ? symbols.map(normalizeSymbol).filter(validSymbol) : [];
    if (syms.length < 2) {
      return { symbols: syms, available: false, reason: "compare requires at least two valid symbols", freshness: "unavailable" };
    }
    if (!live) {
      return { symbols: syms, available: false, reason: "ETFdb API not enabled", freshness: "unavailable" };
    }
    const overviews = await Promise.all(syms.map((s) => getOverview(s)));
    return compareEtfs(overviews);
  }

  return {
    providerId: "ETFDB_API",
    live,
    search,
    getOverview,
    getComposition,
    getMetrics,
    getFlows,
    compare,
    get cached() { return cache; },
    get breaker() { return breaker.snapshot(); },
  };
}

// ── Pure Zenin calculations (no ETFdb call) ────────────────────────────────

// compareEtfs — fee/AUM/yield/returns comparison + holdings overlap.
// Accepts normalized overview objects (each may be unavailable).
function compareEtfs(overviews) {
  const valid = Array.isArray(overviews) ? overviews.filter((o) => o && o.available) : [];
  if (valid.length < 2) {
    return {
      available: false,
      reason: "compare requires at least two ETFs with available composition/overview data",
      freshness: "unavailable",
    };
  }
  const fundRows = valid.map((o) => ({
    symbol: o.symbol,
    expenseRatioPct: o.fund?.expenseRatioPct ?? null,
    aum: o.fund?.aum ?? null,
    dividendYieldPct: o.fund?.dividendYieldPct ?? null,
    returns: o.market?.returns ?? null,
    holdingsCount: o.fund?.holdingsCount ?? null,
  }));

  const overlap = computeHoldingsOverlap(valid);

  return {
    available: true,
    freshness: "fresh",
    symbols: valid.map((o) => o.symbol),
    funds: fundRows,
    overlap,
  };
}

// computeHoldingsOverlap — shared constituents and weighted overlap.
function computeHoldingsOverlap(overviews) {
  const bySymbol = new Map();
  for (const o of overviews) {
    const list = o.composition?.holdings || [];
    if (!list.length) continue;
    for (const h of list) {
      if (!h.symbol) continue;
      if (!bySymbol.has(h.symbol)) bySymbol.set(h.symbol, []);
      bySymbol.get(h.symbol).push({ symbol: o.symbol, weightPct: h.weightPct ?? null });
    }
  }
  const common = [];
  for (const [sym, entries] of bySymbol) {
    if (entries.length >= 2) {
      common.push({ symbol: sym, weightPctByEtf: entries });
    }
  }
  if (!common.length) {
    return { available: false, reason: "no shared holdings available (holdings data missing or disjoint)", common: [] };
  }
  return { available: true, common };
}

// calculateEtfPortfolioOverlap — duplicate constituent exposure vs portfolio.
function calculateEtfPortfolioOverlap({ etfSymbol, portfolio = [] } = {}) {
  const sym = normalizeSymbol(etfSymbol);
  if (!validSymbol(sym)) {
    return { etfSymbol: sym, available: false, reason: "invalid ETF symbol", duplicateExposure: [] };
  }
  // Portfolio rows: [{ symbol, weightPct }]
  const pfBySymbol = new Map();
  for (const row of Array.isArray(portfolio) ? portfolio : []) {
    const ps = normalizeSymbol(row?.symbol);
    if (ps) pfBySymbol.set(ps, { symbol: ps, weightPct: Number(row?.weightPct) || null });
  }
  // Without the ETF's composition we cannot compute overlap honestly.
  return {
    etfSymbol: sym,
    available: false,
    reason: "ETFdb composition required to compute overlap; supply composition or enable ETFdb API",
    duplicateExposure: [],
    portfolioHoldings: [...pfBySymbol.values()],
  };
}

module.exports = {
  createEtfDataProvider,
  compareEtfs,
  calculateEtfPortfolioOverlap,
  ENABLED,
};
