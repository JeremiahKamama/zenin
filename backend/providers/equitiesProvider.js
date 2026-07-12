/**
 * Zenin — Equities multi-provider abstraction (Equities Desk v2, Slice D).
 *
 * Single composition point for equities quote sourcing. Each provider adapter
 * normalizes to a common shape: Map<symbol, { summary: { Change, "Perf YTD",
 * "Perf Year", "Perf 3Y", "Return% 1Y", AUM, "Flows% 1M", ... } }> — the exact
 * fields the existing buildEquities*Rows() builders read. This keeps the rest of
 * the pipeline provider-agnostic.
 *
 * Provider ordering comes from the Coverage Registry priority engine
 * (coverageService.resolveProviderPriority) — one source of truth for
 * fallback ranking. A provider that throws or returns nothing is skipped; the
 * chain falls through to the next, so adding/removing a provider is config-only.
 *
 * Finviz is injected (it lives in index.js) to avoid a circular require.
 */
const path = require("path");
const { resolveProviderPriority } = require(path.join(__dirname, "..", "coverageService"));

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

// --- Adapter: Finviz (injected; existing enrichment source) ---
function makeFinvizAdapter(fetchFinvizQuotes) {
  return {
    id: "finviz",
    async fetchQuotes(symbols) {
      if (typeof fetchFinvizQuotes !== "function") return new Map();
      return await fetchFinvizQuotes(symbols);
    },
  };
}

// --- Adapter: Massive (configured via MASSIVE_API_KEY) ---
function makeMassiveAdapter() {
  let client = null;
  try {
    client = require("./massive/restClient");
  } catch {
    client = null;
  }
  return {
    id: "massive",
    isConfigured: () => Boolean(client && client.isConfigured && client.isConfigured()),
    async fetchQuotes(symbols) {
      if (!client || !client.isConfigured || !client.isConfigured()) {
        throw new Error("massive_unconfigured");
      }
      const out = new Map();
      const results = await Promise.allSettled(
        symbols.map((symbol) => client.getSnapshot(normalizeSymbol(symbol)))
      );
      results.forEach((res, idx) => {
        if (res.status !== "fulfilled" || !res.value) return;
        const snap = res.value;
        // Massive snapshot: { ticker, ... quote fields }. Normalize to the
        // summary shape the equities builders consume.
        const q = snap.lastQuote || snap.quote || snap;
        const prevClose = Number(snap.prevClose ?? snap.prevDay?.c ?? q?.p ?? NaN);
        const last = Number(snap.last ?? snap.lastTrade?.p ?? q?.l ?? q?.c ?? NaN);
        const summary = {};
        if (Number.isFinite(last) && Number.isFinite(prevClose) && prevClose !== 0) {
          summary.Change = ((last - prevClose) / prevClose) * 100;
        }
        // Best-effort passthrough of any perf fields Massive returns.
        for (const key of ["Perf YTD", "Perf Year", "Perf 3Y", "Return% 1Y", "AUM", "Flows% 1M"]) {
          if (snap[key] != null) summary[key] = snap[key];
        }
        out.set(normalizeSymbol(symbols[idx]), { summary });
      });
      if (out.size === 0) throw new Error("massive_empty");
      return out;
    },
  };
}

// --- Adapter: FMP (structured; degrades when SDK absent) ---
function makeFmpAdapter() {
  return {
    id: "fmp",
    isConfigured: () => Boolean(process.env.FMP_API_KEY),
    async fetchQuotes() {
      if (!process.env.FMP_API_KEY) throw new Error("fmp_unconfigured");
      // Real FMP quote fetch would go here (profile + quote endpoint).
      // Intentionally not fabricated: no SDK/credentials wired in this backend.
      throw new Error("fmp_not_implemented");
    },
  };
}

// --- Adapter: Yahoo (structured; degrades when unavailable) ---
function makeYahooAdapter() {
  return {
    id: "yahoo",
    isConfigured: () => true,
    async fetchQuotes() {
      // Real Yahoo quote fetch would go here. Not fabricated.
      throw new Error("yahoo_not_implemented");
    },
  };
}

// --- Adapter: MyStocks Africa (structured; degrades when absent) ---
function makeMyStocksAdapter() {
  return {
    id: "mystocks",
    isConfigured: () => Boolean(process.env.MYSTOCKS_AFRICA_API_KEY),
    async fetchQuotes() {
      if (!process.env.MYSTOCKS_AFRICA_API_KEY) throw new Error("mystocks_unconfigured");
      // Real MyStocks Africa adapter would go here. Not fabricated.
      throw new Error("mystocks_not_implemented");
    },
  };
}

function createEquitiesProvider({ fetchFinvizQuotes } = {}) {
  // A slim provider view for the priority engine (matches coverageService shape).
  const COVERAGE_PROVIDER_VIEW = [
    { id: "massive", regions: ["Global", "Americas", "Europe", "Asia-Pacific", "Africa"], assetClasses: ["Equities", "ETFs", "Bonds", "FX", "Commodities", "Corporate Actions"], capabilities: ["quotes", "fundamentals", "breadth", "flows", "earnings"], priority: 1 },
    { id: "fmp", regions: ["Americas", "Europe", "Asia-Pacific"], assetClasses: ["Equities", "ETFs", "Bonds", "Options"], capabilities: ["quotes", "fundamentals", "earnings", "ratios", "financials"], priority: 2 },
    { id: "yahoo", regions: ["Global"], assetClasses: ["Equities", "ETFs", "FX", "Crypto", "Commodities"], capabilities: ["quotes", "history", "breadth"], priority: 3 },
    { id: "mystocks", regions: ["Africa"], assetClasses: ["Equities", "Bonds", "Money Market Funds", "REITs", "Corporate Actions"], capabilities: ["quotes", "fundamentals", "dividends", "ipos", "corporateActions"], priority: 1 },
    { id: "finviz", regions: ["Americas"], assetClasses: ["Equities", "ETFs"], capabilities: ["quotes", "screener", "breadth", "maps"], priority: 4 },
  ];

  const adapters = [
    makeFinvizAdapter(fetchFinvizQuotes),
    makeMassiveAdapter(),
    makeFmpAdapter(),
    makeYahooAdapter(),
    makeMyStocksAdapter(),
  ];
  const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));

  /**
   * Fetch equities quotes with provider fallback.
   * @param {string[]} symbols
   * @param {{ region?: string, assetClass?: string, capability?: string, preferred?: string[] }} opts
   * @returns {Promise<{quotes: Map, provider: string|null, tried: string[]}>}
   */
  async function fetchEquitiesQuotesWithFallback(symbols, opts = {}) {
    const region = opts.region || "Global";
    const assetClass = opts.assetClass || "Equities";
    const capability = opts.capability || "quotes";

    const ranked = resolveProviderPriority({ region, assetClass, capability, providers: COVERAGE_PROVIDER_VIEW })
      .map((p) => byId[p.id])
      .filter(Boolean);

    const tried = [];
    for (const adapter of ranked) {
      try {
        if (adapter.isConfigured && !adapter.isConfigured()) {
          tried.push(`${adapter.id}:unconfigured`);
          continue;
        }
        const quotes = await adapter.fetchQuotes(symbols);
        if (quotes && quotes.size > 0) {
          return { quotes, provider: adapter.id, tried };
        }
        tried.push(`${adapter.id}:empty`);
      } catch (err) {
        tried.push(`${adapter.id}:${(err && err.message) || "error"}`);
      }
    }
    return { quotes: new Map(), provider: null, tried };
  }

  return {
    fetchEquitiesQuotesWithFallback,
    listProviders: () => adapters.map((a) => ({ id: a.id, configured: a.isConfigured ? a.isConfigured() : true })),
    _adapters: adapters,
  };
}

module.exports = { createEquitiesProvider, normalizeSymbol };
