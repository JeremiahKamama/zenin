/**
 * Zenin Admin — Coverage Registry seed metadata.
 *
 * Authoritative, metadata-driven source for market / provider / exchange /
 * dataset coverage. The UI never hardcodes these lists — it reads them from
 * here (and, when available, from the backend Coverage Service at
 * /api/admin/coverage). Edit this file (or the backend) to change coverage;
 * no React changes required.
 *
 * Africa is a first-class region (MyStocks Africa adapter) — not an add-on.
 */

export const COVERAGE_REGIONS = [
  "Global",
  "Americas",
  "Europe",
  "Asia-Pacific",
  "Africa",
];

export const COVERAGE_ASSET_CLASSES = [
  "Equities",
  "ETFs",
  "Bonds",
  "Money Market Funds",
  "REITs",
  "Commodities",
  "FX",
  "Crypto",
  "Options",
  "Corporate Actions",
];

/**
 * Providers with their coverage capabilities and per-region fallback priority.
 * `priority` is the rank used by the Provider Priority Engine: lower = preferred.
 */
export const COVERAGE_PROVIDERS = [
  {
    id: "massive",
    name: "Massive",
    status: "active",
    category: "Market Data",
    regions: ["Global", "Americas", "Europe", "Asia-Pacific", "Africa"],
    assetClasses: ["Equities", "ETFs", "Bonds", "FX", "Commodities", "Corporate Actions"],
    capabilities: ["quotes", "fundamentals", "breadth", "flows", "earnings"],
    priority: 1,
    note: "Primary global equities + fundamentals adapter.",
  },
  {
    id: "fmp",
    name: "Financial Modeling Prep",
    status: "active",
    category: "Fundamentals",
    regions: ["Americas", "Europe", "Asia-Pacific"],
    assetClasses: ["Equities", "ETFs", "Bonds", "Options"],
    capabilities: ["fundamentals", "earnings", "ratios", "financials"],
    priority: 2,
    note: "Secondary fundamentals + estimates source.",
  },
  {
    id: "yahoo",
    name: "Yahoo Finance",
    status: "active",
    category: "Market Data",
    regions: ["Global"],
    assetClasses: ["Equities", "ETFs", "FX", "Crypto", "Commodities"],
    capabilities: ["quotes", "history", "breadth"],
    priority: 3,
    note: "Fallback quote + history provider.",
  },
  {
    id: "mystocks",
    name: "MyStocks Africa",
    status: "active",
    category: "Regional (Africa)",
    regions: ["Africa"],
    assetClasses: ["Equities", "Bonds", "Money Market Funds", "REITs", "Corporate Actions"],
    capabilities: ["quotes", "fundamentals", "dividends", "ipos", "corporateActions"],
    priority: 1,
    note: "Primary Africa equities, bonds, MMF, REITs, and corporate actions adapter.",
  },
  {
    id: "finviz",
    name: "Finviz",
    status: "degraded",
    category: "Screener",
    regions: ["Americas"],
    assetClasses: ["Equities", "ETFs"],
    capabilities: ["screener", "breadth", "maps"],
    priority: 4,
    note: "US-centric screener + breadth; rate-limited.",
  },
];

export const COVERAGE_MARKETS = [
  { code: "US", name: "United States", region: "Americas", providers: ["massive", "fmp", "yahoo", "finviz"], assetClasses: ["Equities", "ETFs", "Bonds", "Options", "REITs"] },
  { code: "KE", name: "Kenya", region: "Africa", providers: ["mystocks"], assetClasses: ["Equities", "Bonds", "Money Market Funds", "REITs", "Corporate Actions"] },
  { code: "NG", name: "Nigeria", region: "Africa", providers: ["mystocks"], assetClasses: ["Equities", "Bonds", "Corporate Actions"] },
  { code: "ZA", name: "South Africa", region: "Africa", providers: ["mystocks", "massive"], assetClasses: ["Equities", "Bonds", "REITs", "ETFs"] },
  { code: "EG", name: "Egypt", region: "Africa", providers: ["mystocks"], assetClasses: ["Equities", "Bonds"] },
  { code: "GB", name: "United Kingdom", region: "Europe", providers: ["massive", "fmp"], assetClasses: ["Equities", "ETFs", "Bonds"] },
  { code: "DE", name: "Germany", region: "Europe", providers: ["massive", "fmp"], assetClasses: ["Equities", "ETFs", "Bonds"] },
  { code: "JP", name: "Japan", region: "Asia-Pacific", providers: ["massive", "yahoo"], assetClasses: ["Equities", "ETFs", "FX"] },
];

export const COVERAGE_EXCHANGES = [
  { mic: "XNYS", name: "New York Stock Exchange", country: "US", region: "Americas", assetClasses: ["Equities", "ETFs"], status: "active" },
  { mic: "XNAS", name: "Nasdaq", country: "US", region: "Americas", assetClasses: ["Equities", "ETFs", "Options"], status: "active" },
  { mic: "XNSE", name: "Nairobi Securities Exchange", country: "KE", region: "Africa", assetClasses: ["Equities", "Bonds", "REITs"], status: "active" },
  { mic: "XGHA", name: "Ghana Stock Exchange", country: "GH", region: "Africa", assetClasses: ["Equities"], status: "planned" },
  { mic: "XGSE", name: "NGX (Nigeria Exchange)", country: "NG", region: "Africa", assetClasses: ["Equities", "Bonds"], status: "active" },
  { mic: "XJSE", name: "Johannesburg Stock Exchange", country: "ZA", region: "Africa", assetClasses: ["Equities", "Bonds", "REITs"], status: "active" },
  { mic: "XCAI", name: "Egyptian Exchange", country: "EG", region: "Africa", assetClasses: ["Equities", "Bonds"], status: "active" },
  { mic: "XLON", name: "London Stock Exchange", country: "GB", region: "Europe", assetClasses: ["Equities", "ETFs", "Bonds"], status: "active" },
  { mic: "XFRA", name: "Deutsche Börse", country: "DE", region: "Europe", assetClasses: ["Equities", "ETFs", "Bonds"], status: "active" },
  { mic: "XJPX", name: "Japan Exchange Group", country: "JP", region: "Asia-Pacific", assetClasses: ["Equities", "ETFs", "FX"], status: "active" },
];

export const COVERAGE_DATASETS = [
  { id: "market_breadth", name: "Market Breadth", provider: "massive", region: "Global", assetClass: "Equities", cadence: "intraday", status: "active" },
  { id: "equity_fundamentals", name: "Equity Fundamentals", provider: "fmp", region: "Americas", assetClass: "Equities", cadence: "daily", status: "active" },
  { id: "africa_quotes", name: "Africa Quotes", provider: "mystocks", region: "Africa", assetClass: "Equities", cadence: "realtime", status: "active" },
  { id: "africa_corporate_actions", name: "Africa Corporate Actions", provider: "mystocks", region: "Africa", assetClass: "Corporate Actions", cadence: "daily", status: "active" },
  { id: "dividend_calendar", name: "Dividend Calendar", provider: "mystocks", region: "Africa", assetClass: "Equities", cadence: "daily", status: "active" },
  { id: "ipo_pipeline", name: "IPO Pipeline", provider: "mystocks", region: "Africa", assetClass: "Equities", cadence: "daily", status: "active" },
  { id: "fx_rates", name: "FX Rates", provider: "yahoo", region: "Global", assetClass: "FX", cadence: "realtime", status: "active" },
  { id: "commodity_prices", name: "Commodity Prices", provider: "yahoo", region: "Global", assetClass: "Commodities", cadence: "realtime", status: "active" },
];

/**
 * Mapping Registry — security identifier cross-references.
 * idType ∈ ISIN | FIGI | CUSIP | SEDOL | MIC | RIC | TICKER | INTERNAL
 */
export const COVERAGE_MAPPINGS = [
  { internalId: "ZN-KE-0001", isin: "KE0000000001", figi: "BBG000000001", cusip: null, sedol: null, mic: "XNSE", ric: "SCOM.NR", ticker: "SCOM", name: "Safaricom PLC" },
  { internalId: "ZN-NG-0002", isin: "NG0000000002", figi: "BBG000000002", cusip: null, sedol: null, mic: "XGSE", ric: "DANGCEM.LG", ticker: "DANGCEM", name: "Dangote Cement" },
  { internalId: "ZN-ZA-0003", isin: "ZAE000000003", figi: "BBG000000003", cusip: null, sedol: "ZZ0000003", mic: "XJSE", ric: "NPN.JO", ticker: "NPN", name: "Naspers Ltd" },
  { internalId: "ZN-US-0004", isin: "US0378331005", figi: "BBG000B9XRY4", cusip: "037833100", sedol: "2046251", mic: "XNAS", ric: "AAPL.OQ", ticker: "AAPL", name: "Apple Inc" },
];

/** API Health snapshot (graceful: mirrors what the backend would return). */
export const COVERAGE_API_HEALTH = [
  { provider: "massive", endpoint: "/v1/quotes", status: "healthy", latencyMs: 120, uptimePct: 99.9, lastCheck: new Date().toISOString() },
  { provider: "mystocks", endpoint: "/v1/africa/quotes", status: "healthy", latencyMs: 240, uptimePct: 99.2, lastCheck: new Date().toISOString() },
  { provider: "fmp", endpoint: "/v3/profile", status: "degraded", latencyMs: 880, uptimePct: 97.4, lastCheck: new Date().toISOString() },
  { provider: "finviz", endpoint: "/screener", status: "degraded", latencyMs: 1500, uptimePct: 91.0, lastCheck: new Date().toISOString() },
];

/** Sync job snapshot. */
export const COVERAGE_SYNC_JOBS = [
  { id: "sync-africa-quotes", provider: "mystocks", dataset: "africa_quotes", status: "success", lastRun: new Date(Date.now() - 60000).toISOString(), durationMs: 4200, rows: 1840 },
  { id: "sync-us-fundamentals", provider: "fmp", dataset: "equity_fundamentals", status: "running", lastRun: new Date().toISOString(), durationMs: null, rows: null },
  { id: "sync-breadth", provider: "massive", dataset: "market_breadth", status: "failed", lastRun: new Date(Date.now() - 3600000).toISOString(), durationMs: 310, rows: 0 },
];

/** Audit Log of coverage config changes. */
export const COVERAGE_AUDIT_LOG = [
  { id: "aud-1", actor: "ops_admin@zenin.capital", action: "provider.updated", target: "finviz", detail: "Set status to degraded (rate-limit).", at: new Date(Date.now() - 86400000).toISOString() },
  { id: "aud-2", actor: "super_admin@zenin.capital", action: "market.added", target: "Egypt (EG)", detail: "Added EG market with MyStocks Africa provider.", at: new Date(Date.now() - 172800000).toISOString() },
  { id: "aud-3", actor: "system", action: "mapping.added", target: "ZN-KE-0001", detail: "Registered Safaricom identifier cross-map.", at: new Date(Date.now() - 259200000).toISOString() },
];

/**
 * Provider Priority Engine — given a region + asset class + capability,
 * return the ordered list of providers to try (lowest priority first).
 * Pure function; used by the UI and reusable by the backend.
 */
export function resolveProviderPriority({ region, assetClass, capability, providers = COVERAGE_PROVIDERS }) {
  return providers
    .filter((p) => {
      if (region && region !== "Global" && !p.regions.includes(region) && !p.regions.includes("Global")) return false;
      if (assetClass && !p.assetClasses.includes(assetClass)) return false;
      if (capability && !p.capabilities.includes(capability)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Specialization tiebreak (non-Global only): provider dedicated to exactly
      // this one region beats a multi-region global provider (MyStocks Africa
      // over Massive for Africa). Global region keeps priority order.
      if (region && region !== "Global") {
        const aDedicated = (a.regions || []).length === 1 && a.regions[0] === region;
        const bDedicated = (b.regions || []).length === 1 && b.regions[0] === region;
        if (aDedicated !== bDedicated) return aDedicated ? -1 : 1;
      }
      return 0;
    })
    .map((p) => ({ id: p.id, name: p.name, priority: p.priority, status: p.status }));
}

export const COVERAGE_SEED = {
  regions: COVERAGE_REGIONS,
  assetClasses: COVERAGE_ASSET_CLASSES,
  providers: COVERAGE_PROVIDERS,
  markets: COVERAGE_MARKETS,
  exchanges: COVERAGE_EXCHANGES,
  datasets: COVERAGE_DATASETS,
  mappings: COVERAGE_MAPPINGS,
  apiHealth: COVERAGE_API_HEALTH,
  syncJobs: COVERAGE_SYNC_JOBS,
  auditLog: COVERAGE_AUDIT_LOG,
};
