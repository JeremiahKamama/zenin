// Asset Intelligence Platform — Asset Registry (Phase 2.2).
//
// Single source of truth for every asset kind. Replaces ad-hoc per-kind routing,
// action sets, and tier lists. Consumers (App openers, AssetModal, future merged
// workspace/profile) resolve everything through here — no hardcoded routing.
//
// Route types keep their existing SPA values (company/asset/commodity/
// commodity-profile) as aliases so all current URLs keep working. The registry
// is the canonical resolver; openers call buildAssetRoute(kind, symbol).
//
// Brand v2: monochrome, desktop-first, institutional. Actions identical per kind.

import { getAdapter } from "./assetAdapters";

/** Universal action set. Every kind exposes the same actions (Phase 2 / Asset Modal). */
export const UNIVERSAL_ACTIONS = [
  "research",
  "profile",
  "watchlist",
  "journal",
  "decisionLedger",
  "compare",
  "copySymbol",
];

/** Default workspace/profile tiers per kind. Drives the merged (P2.5/P2.6) surfaces;
 *  also documents intent for the current per-kind components. */
const STOCK_TIERS = {
  workspace: ["overview", "marketIntel", "ownership", "filings", "insider", "governance", "business", "mda", "riskFactors", "research", "catalysts", "decisionLedger"],
  profile: ["overview", "financials", "ownership", "relatedAssets", "history"],
};
const COMMODITY_TIERS = {
  workspace: ["overview", "marketStructure", "supplyDemand", "inventories", "positioning", "seasonality", "macroDrivers", "technicals", "research", "catalysts", "decisionLedger"],
  profile: ["overview", "contractDetails", "marketStructure", "relatedAssets", "history", "references"],
};
const ETF_TIERS = {
  // Mirrors the equity workspace's intelligence coverage so ETFs consume the
  // Phase Next layer consistently (spec acceptance: every research workspace
  // gets the same intelligence). Fund-specific tiers first, then the shared
  // intelligence panels, then Decide. All ids map to renderIntel()/ScenarioLab.
  workspace: [
    "overview",
    "investmentThesis",
    "portfolioIntel",
    "ownership",
    "filings",
    "insider",
    "supplyChain",
    "fundComposition",
    "geographic",
    "corporateTimeline",
    "governance",
    "business",
    "mda",
    "alternative",
    "factor",
    "currency",
    "risk",
    "riskFactors",
    "overlap",
    "performance",
    "fundFlows",
    "macroIntel",
    "correlation",
    "discovery",
    "compare",
    "research",
    "consensus",
    "catalysts",
    "decisionReplay",
    "decisionLedger",
    "scenarioLab",
  ],
  profile: ["overview", "holdings", "fundDetails", "performance", "references"],
};
const MACRO_TIERS = {
  // 9 workspace tiers (spec). Registry-driven: MacroAssetWorkspace renders
  // exactly these, in order, reusing the shared macro modules.
  workspace: [
    "executiveBrief",
    "regimeDashboard",
    "themeExplorer",
    "crossAssetImpact",
    "regionalIntelligence",
    "scenarioAnalysis",
    "transmission",
    "relatedAssets",
    "economicDependency",
    "etfRecommendations",
    "intelligenceFeed",
    "scenarioLab",
    "researchDecisions",
  ],
  // Reference-only profile (spec Profile section).
  profile: [
    "definitions",
    "methodologies",
    "indicators",
    "providers",
    "calendars",
    "revisions",
    "coverage",
    "sourceQuality",
  ],
};

/**
 * @typedef {Object} AssetKindEntry
 * @property {string} kind
 * @property {string} displayName
 * @property {string} routeType           Canonical SPA routeState.type (alias).
 * @property {string} profileRouteType    SPA routeState.type for profile (alias).
 * @property {string} researchPath         URL path for research.
 * @property {string} profilePath          URL path for profile.
 * @property {string[]} actions
 * @property {{workspace:string[], profile:string[]}} tiers
 * @property {string[]} coverage           Intelligence surfaces that feed coverage.
 * @property {Function} adapter
 */

const CURRENCY_TIERS = {
  // Currency / FX Asset Research Workspace sections (spec §6). The same ARW
  // renders in `pair` (fx-pair) or `currency` (currency-code) mode; pair adds
  // a Portfolio-impact tier. Drives the sidebar; CurrencyResearchWorkspace
  // filters by mode.
  workspace: [
    "overview",
    "drivers",
    "events",
    "crosses",
    "portfolioImpact", // pair mode only
    "research",
    "catalysts",
    "decisionLedger",
    "scenarioLab",
  ],
  profile: ["overview", "relatedAssets", "history"],
};
export const assetRegistry = {
  stock: {
    kind: "stock",
    displayName: "Stock",
    routeType: "asset",
    profileRouteType: "company",
    researchPath: (s) => `/app/asset/${encodeURIComponent(s)}`,
    profilePath: (s) => `/app/company/${encodeURIComponent(s)}`,
    actions: UNIVERSAL_ACTIONS,
    tiers: STOCK_TIERS,
    coverage: ["research", "profile", "macro", "decision"],
    adapter: getAdapter("stock"),
  },
  etf: {
    kind: "etf",
    displayName: "ETF",
    routeType: "etf",
    profileRouteType: "etf-profile",
    researchPath: (s) => `/app/etf/${encodeURIComponent(s)}`,
    profilePath: (s) => `/app/etf/${encodeURIComponent(s)}/profile`,
    actions: UNIVERSAL_ACTIONS,
    tiers: ETF_TIERS,
    coverage: ["research", "profile", "macro", "decision"],
    adapter: getAdapter("etf"),
  },
  commodity: {
    kind: "commodity",
    displayName: "Commodity",
    routeType: "commodity",
    profileRouteType: "commodity-profile",
    researchPath: (s) => `/app/commodities/${encodeURIComponent(s)}`,
    profilePath: (s) => `/app/commodities/${encodeURIComponent(s)}/profile`,
    actions: UNIVERSAL_ACTIONS,
    tiers: COMMODITY_TIERS,
    coverage: ["research", "profile", "macro", "decision"],
    adapter: getAdapter("commodity"),
  },
  macro: {
    kind: "macro",
    displayName: "Macro",
    // Macro is identified by a country code (e.g. "USA") or "GLOBAL".
    routeType: "macro",
    profileRouteType: "macro-profile",
    researchPath: (s) => `/app/macro/${encodeURIComponent(s || "USA")}`,
    profilePath: (s) => `/app/macro/${encodeURIComponent(s || "USA")}/profile`,
    actions: UNIVERSAL_ACTIONS,
    tiers: MACRO_TIERS,
    // Macro is itself an intelligence source; it feeds research + decisions and
    // is referenced by every other asset kind's "macro drivers" coverage.
    coverage: ["research", "profile", "macro", "decision"],
    adapter: getAdapter("macro"),
  },
  // Indicator — a macro data point (CPI, PPI, Core CPI, PCE, Employment…).
  // First-class Transmission node and a watchlist asset kind. Deep-links follow
  // the spec's two acceptable forms depending on routing context.
  indicator: {
    kind: "indicator",
    displayName: "Indicator",
    routeType: "indicator",
    profileRouteType: "macro",
    researchPath: (s) => `/app/research/indicator/${encodeURIComponent(s)}`,
    profilePath: (s) => `/app/macro/${encodeURIComponent(s)}`,
    actions: UNIVERSAL_ACTIONS,
    tiers: MACRO_TIERS,
    coverage: ["research", "profile", "macro", "decision"],
    adapter: getAdapter("indicator"),
  },
  // Currency / FX — one ARW (CurrencyResearchWorkspace) rendered in `pair`
  // (fx-pair) or `currency` (currency-code) mode. RouteType `currency` keeps
  // URLs stable and distinct from equity/commodity routes.
  currency: {
    kind: "currency",
    displayName: "Currency",
    routeType: "currency",
    profileRouteType: "currency-profile",
    researchPath: (s) => `/app/currency/${encodeURIComponent(s)}`,
    profilePath: (s) => `/app/currency/${encodeURIComponent(s)}/profile`,
    actions: UNIVERSAL_ACTIONS,
    tiers: CURRENCY_TIERS,
    coverage: ["research", "macro", "decision"],
    adapter: getAdapter("currency"),
  },
  // forex is an alias resolver path: same Currency ARW, pair mode. Registry
  // consumers route by kind result, never by manual route strings.
  forex: {
    kind: "forex",
    displayName: "FX Pair",
    routeType: "currency",
    profileRouteType: "currency-profile",
    researchPath: (s) => `/app/currency/${encodeURIComponent(s)}`,
    profilePath: (s) => `/app/currency/${encodeURIComponent(s)}/profile`,
    actions: UNIVERSAL_ACTIONS,
    tiers: CURRENCY_TIERS,
    coverage: ["research", "macro", "decision"],
    adapter: getAdapter("currency"),
  },
};

/**
 * Resolve a registry entry by kind. Returns null when unsupported.
 * @param {string} kind
 * @returns {AssetKindEntry|null}
 */
export function getAssetKind(kind) {
  return assetRegistry[String(kind || "").toLowerCase()] || null;
}

/**
 * Build the route + URL pair for an asset. Single resolver so openers never
 * hardcode paths. Returns null for unknown kind.
 * @param {"research"|"profile"} view
 * @param {string} kind
 * @param {string} symbol
 * @returns {{routeType:string, symbol:string, path:string}|null}
 */
export function buildAssetRoute(view, kind, symbol) {
  const entry = getAssetKind(kind);
  if (!entry) return null;
  const sym = String(symbol || "").toUpperCase();
  if (view === "profile") {
    return { routeType: entry.profileRouteType, symbol: sym, path: entry.profilePath(sym) };
  }
  return { routeType: entry.routeType, symbol: sym, path: entry.researchPath(sym) };
}

/** Does this kind expose a given universal action? (UI gates on this, never branches manually.) */
export function kindSupportsAction(kind, action) {
  const entry = getAssetKind(kind);
  return Boolean(entry && entry.actions.includes(action));
}

/** List of registered kinds (for any future "add a kind" UI). */
export function registeredKinds() {
  return Object.keys(assetRegistry);
}
