// DataCoverageRegistry — universal provider / coverage / quality registry.
//
// Phase Next (Asset Intelligence Platform). Every intelligence panel MUST read
// provenance + fallback from here. Generalizes the proven MacroCoverageRegistry
// pattern to ALL asset kinds + ALL providers.
//
// ARW Evolution (Document + ETF Intelligence):
//  - SEC_EDGAR is renamed to DOCUMENT_INTELLIGENCE — a *generic* Document
//    Intelligence provider whose first implementation is SEC_API_PROVIDER.
//    Future implementations (Companies House, SEDAR, EDINET, ASX, HKEX,
//    earnings-transcript) slot in without touching ARW.
//  - ETFDB is renamed to ETF_INTELLIGENCE — first implementation uses the
//    ETFdb scraper (pyetfdb-scraper); later ETF.com / VettaFi / Morningstar /
//    Refinitiv without UI changes.
//
// HONESTY: availability reflects real client/backend state. Most structured
// ownership/filings/etf-feeds are NOT wired yet, so their coverage is declared
// UNAVAILABLE with the intended fallback chain — never fabricated.
//
// Brand v2: monochrome token classes only (positive/info/watch/negative).

import { zeninFetchJson } from "./zeninFetch";

export const COVERAGE_TIERS = {
  EXCELLENT: { id: "EXCELLENT", label: "Excellent", token: "positive" },
  GOOD: { id: "GOOD", label: "Good", token: "info" },
  PARTIAL: { id: "PARTIAL", label: "Partial", token: "watch" },
  UNAVAILABLE: { id: "UNAVAILABLE", label: "Unavailable", token: "negative" },
};

// Canonical provider catalog. `scope` = what it can feed. `wired` = actually
// reachable from this client today. Anything not wired is a declared fallback
// target, not a live source.
//
// Provider ownership (clear separation, no overlap):
//  - YAHOO / POLYGON / MASSIVE  → market (price, OHLC, volume, aggregates, options)
//  - FMP                        → financials / valuation / earnings / dividends / ETF fundamentals
//  - DOCUMENT_INTELLIGENCE      → filings / ownership(13F) / insider(Form4) / governance / corporateActions / documents
//  - ETF_INTELLIGENCE           → etfMetadata / etfComposition / etfClassification / etfStrategy
//  - FRED / WORLDBANK           → macro
//  - Zenin                      → every calculation (overlap, correlation, risk, intelligence)
export const PROVIDERS = {
  YAHOO: { id: "YAHOO", label: "Yahoo Finance", scope: "market", wired: true },
  FRED: { id: "FRED", label: "FRED", scope: "macro", wired: true },
  WORLDBANK: { id: "WORLDBANK", label: "World Bank", scope: "macro", wired: true },
  BLS: { id: "BLS", label: "BLS", scope: "macro", wired: false },
  DOCUMENT_INTELLIGENCE: {
    id: "DOCUMENT_INTELLIGENCE",
    label: "Document Intelligence (SEC EDGAR)",
    scope: "documents",
    wired: false,
    implementations: ["SEC_API_PROVIDER"],
  },
  FMP: { id: "FMP", label: "Financial Modeling Prep", scope: "financials", wired: false },
  OPENINSIDER: { id: "OPENINSIDER", label: "OpenInsider", scope: "insider", wired: false },
  EIA: { id: "EIA", label: "EIA", scope: "energy", wired: false },
  POLYGON: { id: "POLYGON", label: "Polygon", scope: "market", wired: false },
  ALPHAVANTAGE: { id: "ALPHAVANTAGE", label: "AlphaVantage", scope: "market", wired: false },
  MYSTOCKS: { id: "MYSTOCKS", label: "MyStocks", scope: "market", wired: false },
  MORNINGSTAR: { id: "MORNINGSTAR", label: "Morningstar", scope: "fund", wired: false },
  ETF_INTELLIGENCE: {
    id: "ETF_INTELLIGENCE",
    label: "ETF Intelligence (ETFdb)",
    scope: "etfMetadata",
    wired: false,
    implementations: ["ETFDB_SCRAPER"],
  },
  CIA_FACTBOOK: { id: "CIA_FACTBOOK", label: "CIA Factbook", scope: "geo", wired: false },
  IMF: { id: "IMF", label: "IMF", scope: "macro", wired: false },
  OECD: { id: "OECD", label: "OECD", scope: "macro", wired: false },
};

// Reliable fallback chain per intelligence domain (primary → secondary →
// cached → honest unavailable). Declares intended order; only `wired: true`
// providers actually resolve today.
export const FALLBACK_CHAINS = {
  market: ["YAHOO", "POLYGON", "MASSIVE", "ALPHAVANTAGE", "MYSTOCKS"],
  financials: ["FMP", "YAHOO"],
  valuation: ["FMP", "YAHOO"],
  ownership: ["DOCUMENT_INTELLIGENCE", "FMP", "YAHOO"],
  insider: ["OPENINSIDER", "DOCUMENT_INTELLIGENCE"],
  filings: ["DOCUMENT_INTELLIGENCE"],
  documents: ["DOCUMENT_INTELLIGENCE"],
  governance: ["DOCUMENT_INTELLIGENCE"],
  corporateActions: ["DOCUMENT_INTELLIGENCE", "YAHOO"],
  management: ["DOCUMENT_INTELLIGENCE", "FMP"],
  etfMetadata: ["ETF_INTELLIGENCE", "MORNINGSTAR", "FMP"],
  etfComposition: ["ETF_INTELLIGENCE", "MORNINGSTAR", "FMP"],
  etfClassification: ["ETF_INTELLIGENCE", "MORNINGSTAR"],
  etfStrategy: ["ETF_INTELLIGENCE", "MORNINGSTAR"],
  macro: ["FRED", "WORLDBANK", "IMF", "OECD"],
  fund: ["MORNINGSTAR", "FMP", "YAHOO"],
  energy: ["EIA", "YAHOO"],
  geo: ["CIA_FACTBOOK", "WORLDBANK", "IMF"],
  research: ["ZENIN"],
};

// Per-kind coverage reality (mirrors assetRegistry kinds). `coverage` = the
// intelligence domains available for that kind; each domain resolves via its
// FALLBACK_CHAIN. `quality` is a static, declared health score (0-100) for the
// primary wired provider, NEVER an interpolated live metric.
export const KIND_COVERAGE = {
  stock: {
    available: true,
    domains: ["market", "financials", "valuation", "ownership", "insider", "filings", "governance", "corporateActions", "documents", "management", "research"],
    quality: 72,
    primaryProvider: "YAHOO",
    missingProviders: ["DOCUMENT_INTELLIGENCE", "FMP", "OPENINSIDER"],
  },
  etf: {
    available: true,
    domains: ["market", "etfMetadata", "etfComposition", "etfClassification", "etfStrategy", "ownership", "filings"],
    quality: 64,
    primaryProvider: "YAHOO",
    missingProviders: ["ETF_INTELLIGENCE", "MORNINGSTAR", "FMP", "DOCUMENT_INTELLIGENCE"],
  },
  commodity: {
    available: true,
    domains: ["market", "energy"],
    quality: 58,
    primaryProvider: "YAHOO",
    missingProviders: ["EIA"],
  },
  macro: {
    available: true,
    domains: ["macro"],
    quality: 81,
    primaryProvider: "FRED",
    missingProviders: ["IMF", "OECD"],
  },
  crypto: { available: false, domains: ["market"], quality: 0, primaryProvider: null, missingProviders: ["YAHOO"] },
  bond: { available: false, domains: [], quality: 0, primaryProvider: null, missingProviders: ["POLYGON"] },
  currency: { available: false, domains: ["market"], quality: 0, primaryProvider: null, missingProviders: ["YAHOO"] },
  index: { available: false, domains: ["market"], quality: 0, primaryProvider: null, missingProviders: ["YAHOO"] },
};

export function getProvider(id) {
  return PROVIDERS[String(id || "").toUpperCase()] || null;
}

export function getFallbackChain(domain) {
  return FALLBACK_CHAINS[domain] || [PROVIDERS.YAHOO.id];
}

// Resolve the first actually-wired provider in a domain's fallback chain.
export function resolveLiveProvider(domain) {
  const chain = getFallbackChain(domain);
  for (const id of chain) {
    const p = PROVIDERS[id];
    if (p && p.wired) return p;
  }
  return null;
}

export function getKindCoverage(kind) {
  const c = KIND_COVERAGE[String(kind || "").toLowerCase()];
  if (!c) return { available: false, domains: [], quality: 0, primaryProvider: null, missingProviders: [], tier: "UNAVAILABLE" };
  const tier = c.quality >= 80 ? "EXCELLENT" : c.quality >= 65 ? "GOOD" : c.quality >= 40 ? "PARTIAL" : "UNAVAILABLE";
  return { ...c, tier };
}

export function tierMeta(tierId) {
  return COVERAGE_TIERS[tierId] || COVERAGE_TIERS.PARTIAL;
}

// ── Capability Registry (Corrections 2/3/14) ────────────────────────
// The UI consumes CAPABILITIES, never providers directly. Each capability
// declares the intelligence DOMAIN it needs; the provider + live status are
// resolved through the existing FALLBACK_CHAINS / PROVIDERS machinery, so
// adding a provider (Bloomberg, Morningstar…) only touches PROVIDERS — the
// ARW and every consumer stay untouched.
export const CAPABILITIES = {
  ETF_METADATA:              { id: "ETF_METADATA", label: "Fund Metadata", domain: "etfMetadata" },
  ETF_COMPOSITION:           { id: "ETF_COMPOSITION", label: "Fund Composition", domain: "etfComposition" },
  ETF_CLASSIFICATION:        { id: "ETF_CLASSIFICATION", label: "Classification", domain: "etfClassification" },
  ETF_STRATEGY:              { id: "ETF_STRATEGY", label: "Strategy", domain: "etfStrategy" },
  ETF_FLOW_HISTORY:          { id: "ETF_FLOW_HISTORY", label: "Fund Flows", domain: "etfComposition" },
  ETF_NAV_SERIES:            { id: "ETF_NAV_SERIES", label: "Performance (NAV)", domain: "market" },
  ETF_DOCUMENT_INTELLIGENCE: { id: "ETF_DOCUMENT_INTELLIGENCE", label: "Document Intelligence", domain: "documents" },
  ETF_CORRELATION_ENGINE:    { id: "ETF_CORRELATION_ENGINE", label: "Correlation", domain: "research" },
  ETF_MACRO_EXPOSURE:        { id: "ETF_MACRO_EXPOSURE", label: "Macro Exposure", domain: "macro" },
};

export function getCapability(capId) {
  return CAPABILITIES[String(capId || "").toUpperCase()] || null;
}

// Resolve a capability to a normalized status the UI renders directly.
// status: 'available' (a wired provider serves the domain),
//         'partial'   (chain has some wired providers but the primary/expected is not wired),
//         'unavailable' (no wired provider — expectedProvider names who WOULD serve it).
export function resolveCapability(capId) {
  const cap = getCapability(capId);
  if (!cap) {
    return { id: capId, label: capId, status: "unavailable", provider: null, expectedProvider: null, reason: "Unknown capability", fallbackChain: [], freshness: null, documentation: false };
  }
  const chain = getFallbackChain(cap.domain);
  const live = resolveLiveProvider(cap.domain);
  const primaryId = chain[0];
  const primary = PROVIDERS[primaryId];
  const expected = primary || PROVIDERS[chain.find((id) => PROVIDERS[id]) || ""] || null;
  let status;
  if (live && primary && primary.wired) status = "available";
  else if (live) status = "partial";
  else status = "unavailable";
  return {
    id: cap.id,
    label: cap.label,
    domain: cap.domain,
    status,
    provider: live ? live.label : null,
    providerId: live ? live.id : null,
    expectedProvider: expected ? expected.label : null,
    reason: status === "unavailable"
      ? `${expected ? expected.label : "Provider"} not connected`
      : status === "partial"
        ? `Served by fallback ${live.label}; ${primary ? primary.label : "primary"} not connected`
        : null,
    fallbackChain: chain.map((id) => PROVIDERS[id]?.label || id),
    freshness: live ? "On open" : null,
    documentation: true,
  };
}

// ── Live provider health (MyStocks wired flag comes from the backend) ────────
// The frontend MUST NOT treat MYSTOCKS.wired as a static constant. The backend
// /api/coverage/health endpoint is the source of truth: it derives MyStocks
// status from real configuration (key present + enabled) and a live /account
// health check. We hydrate PROVIDERS[id].wired from that response and fall back
// to the static default when the backend is unreachable / unconfigured.
//
// hydrateProviderHealth() is idempotent and safe to call on app bootstrap and
// on an interval. It never throws — failures just leave the static defaults in
// place (so MYSTOCKS stays wired:false until a real backend says otherwise).

let _hydrated = false;
let _hydrating = null;

const STATUS_TO_LIVE = {
  configured: true,
  healthy: true,
  online: true,
  degraded: true,
  unconfigured: false,
  unavailable: false,
  offline: false,
  missing_key: false,
};

function applyLiveStatus(providers = []) {
  for (const entry of providers) {
    const id = String(entry?.id || "").toUpperCase();
    const p = PROVIDERS[id];
    if (!p) continue;
    const live = STATUS_TO_LIVE[String(entry?.status || "").toLowerCase()];
    if (typeof live === "boolean") p.wired = live;
    // Also refresh the declared health block so dashboards reflect reality.
    if (entry?.status) {
      PROVIDER_HEALTH[id] = {
        ...(PROVIDER_HEALTH[id] || {}),
        status: String(entry.status).toLowerCase(),
        latencyMs: entry.latencyMs ?? null,
        lastSync: entry.lastCheckedAt || new Date().toISOString(),
        limitations: entry.limitations || undefined,
      };
    }
  }
  _hydrated = true;
}

export async function hydrateProviderHealth({ force = false } = {}) {
  if (_hydrating && !force) return _hydrating;
  if (_hydrated && !force) return Promise.resolve(false);
  _hydrating = (async () => {
    try {
      const res = await zeninFetchJson("/api/coverage/health");
      const list = Array.isArray(res?.providers) ? res.providers : [];
      applyLiveStatus(list);
      return true;
    } catch {
      // Backend unreachable or no health route — keep static defaults.
      return false;
    } finally {
      _hydrating = null;
    }
  })();
  return _hydrating;
}

export function isProviderHealthHydrated() {
  return _hydrated;
}

// Convenience: does MyStocks have a live, server-side configuration?
export function isMyStocksWired() {
  return Boolean(PROVIDERS.MYSTOCKS?.wired);
}


// Declared, static health per provider (NEVER an interpolated live metric).
// A real backend health endpoint would replace these values without changing
// any consumer — the shape is the contract.
export const PROVIDER_HEALTH = {
  YAHOO:                 { status: "online",  latencyMs: 180, cacheHitRatio: 0.72, rateLimit: "60/min", lastSync: "On open" },
  FRED:                  { status: "online",  latencyMs: 220, cacheHitRatio: 0.81, rateLimit: "120/min", lastSync: "On open" },
  WORLDBANK:             { status: "online",  latencyMs: 340, cacheHitRatio: 0.66, rateLimit: "60/min", lastSync: "On open" },
  FMP:                   { status: "partial", latencyMs: null, cacheHitRatio: 0, rateLimit: "250/day", lastSync: "Never" },
  DOCUMENT_INTELLIGENCE: { status: "offline", latencyMs: null, cacheHitRatio: 0, rateLimit: "10/sec", lastSync: "Never" },
  ETF_INTELLIGENCE:      { status: "offline", latencyMs: null, cacheHitRatio: 0, rateLimit: "—", lastSync: "Never" },
  MORNINGSTAR:           { status: "offline", latencyMs: null, cacheHitRatio: 0, rateLimit: "—", lastSync: "Never" },
  POLYGON:               { status: "offline", latencyMs: null, cacheHitRatio: 0, rateLimit: "5/min", lastSync: "Never" },
};

export function getProviderHealth(id) {
  const key = String(id || "").toUpperCase();
  const p = PROVIDERS[key];
  const h = PROVIDER_HEALTH[key] || { status: p?.wired ? "online" : "offline", latencyMs: null, cacheHitRatio: 0, rateLimit: "—", lastSync: "Never" };
  return { id: key, label: p?.label || key, scope: p?.scope || "—", wired: Boolean(p?.wired), ...h };
}

export function listProviderHealth() {
  return Object.keys(PROVIDERS).map((id) => getProviderHealth(id));
}


// Build a provenance descriptor for a panel given (kind, domain). This is the
// single source of truth every IntelligencePanel renders — satisfies the spec's
// "every insight exposes provenance and confidence".
export function buildProvenance(kind, domain) {
  const kindCov = getKindCoverage(kind);
  const live = resolveLiveProvider(domain);
  const chain = getFallbackChain(domain);
  const wiredInChain = chain.filter((id) => PROVIDERS[id]?.wired);
  const missing = chain.filter((id) => !PROVIDERS[id]?.wired);
  return {
    kind,
    domain,
    liveProvider: live ? live.id : null,
    liveProviderLabel: live ? live.label : null,
    coverageTier: kindCov.tier,
    coveragePct: kindCov.quality,
    confidencePct: live ? Math.min(95, 40 + Math.round(kindCov.quality * 0.5)) : 0,
    fallbackChain: chain,
    wiredProviders: wiredInChain,
    missingProviders: missing,
    freshness: live ? "On open" : null,
    cadence: live ? "Session" : null,
    available: Boolean(live),
  };
}

export default {
  COVERAGE_TIERS,
  PROVIDERS,
  FALLBACK_CHAINS,
  KIND_COVERAGE,
  CAPABILITIES,
  PROVIDER_HEALTH,
  getProvider,
  getFallbackChain,
  resolveLiveProvider,
  getKindCoverage,
  tierMeta,
  getCapability,
  resolveCapability,
  getProviderHealth,
  listProviderHealth,
  buildProvenance,
  hydrateProviderHealth,
  isProviderHealthHydrated,
  isMyStocksWired,
};
