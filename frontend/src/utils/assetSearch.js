// Global asset search index — single source of truth derived from assetGraph seed
// + assetRegistry kinds. Powers the ⌘K launcher and Watchlist autocomplete so
// commodities / companies / ETFs / currencies are discoverable everywhere, identically.
// Reference data only — no fabricated market values.

import { COMMODITY_RELATIONS, COMPANY_TO_COMMODITIES, CORE_ETF_SEED } from "./assetGraph.js";
import { CURATED_CURRENCIES, CURATED_FX_PAIRS } from "./currencyInstruments.js";
import { zeninFetch } from "./zeninFetch";

// Build a flat, searchable index of assets. Each entry carries the metadata the
// UI surfaces: symbol, name, asset class, exchange, category, provider, coverage, confidence.
function buildIndex() {
  const out = [];

  for (const [symbol, rel] of Object.entries(COMMODITY_RELATIONS)) {
    out.push({
      symbol,
      name: rel.category ? `${symbol} (${rel.category})` : symbol,
      kind: "commodity",
      assetClass: "Commodity",
      exchange: rel.exchange || "—",
      category: rel.category || "Commodity",
      provider: "EIA/FRED",
      coverage: "Global",
      confidence: 88,
      unit: rel.unit || "",
    });
    for (const etf of rel.etfs || []) {
      out.push({
        symbol: etf,
        name: `${etf} ETF`,
        kind: "etf",
        assetClass: "ETF",
        exchange: "NYSE/NASDAQ",
        category: rel.category || "Commodity",
        provider: "Market Data",
        coverage: "USA",
        confidence: 82,
      });
    }
    for (const ccy of rel.currencies || []) {
      out.push({
        symbol: ccy,
        name: `${ccy} Currency`,
        kind: "currency",
        assetClass: "Currency",
        exchange: "FX",
        category: "Currency",
        provider: "FX Feed",
        coverage: "Global",
        confidence: 90,
      });
    }
    for (const idx of rel.indexes || []) {
      out.push({
        symbol: idx,
        name: `${idx} Index`,
        kind: "index",
        assetClass: "Index",
        exchange: "Composite",
        category: rel.category || "Index",
        provider: "Reference",
        coverage: "Global",
        confidence: 80,
      });
    }
    for (const country of rel.countries || []) {
      out.push({
        symbol: country.replace(/\s+/g, "_").toUpperCase(),
        name: country,
        kind: "country",
        assetClass: "Country",
        exchange: "Macro",
        category: "Macro",
        provider: "Macro",
        coverage: country,
        confidence: 78,
      });
    }
  }

  for (const [symbol, meta] of Object.entries(CORE_ETF_SEED)) {
    out.push({
      symbol,
      name: `${symbol} (${meta.name})`,
      kind: "etf",
      assetClass: "ETF",
      exchange: "NYSE/NASDAQ",
      category: meta.category || "ETF",
      provider: meta.issuer || "Market Data",
      coverage: "USA",
      confidence: 86,
    });
  }

  for (const ticker of Object.keys(COMPANY_TO_COMMODITIES)) {
    out.push({
      symbol: ticker,
      name: `${ticker} (Company)`,
      kind: "company",
      assetClass: "Company",
      exchange: "NYSE/NASDAQ",
      category: "Equity",
      provider: "Market Data",
      coverage: "USA",
      confidence: 85,
    });
  }

  // Curated currency codes (macro/research entities).
  for (const code of CURATED_CURRENCIES) {
    out.push({
      symbol: code,
      name: `${code} Currency`,
      kind: "currency",
      assetClass: "Currency",
      exchange: "FX",
      category: "Currency",
      provider: "FX Feed",
      coverage: "Global",
      confidence: 90,
    });
  }

  // Curated FX pairs (price-bearing).
  for (const pair of CURATED_FX_PAIRS) {
    out.push({
      symbol: pair,
      name: `${pair} FX Pair`,
      kind: "forex",
      assetClass: "FX",
      exchange: "FX",
      category: "Currency",
      provider: "FX Feed",
      coverage: "Global",
      confidence: 90,
    });
  }

  return out;
}

let INDEX = null;
export function getGlobalAssetIndex() {
  if (!INDEX) INDEX = buildIndex();
  return INDEX;
}

function searchRank(entry, query) {
  const symbol = String(entry?.symbol || "").toLowerCase();
  const name = String(entry?.name || "").toLowerCase();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return Number.POSITIVE_INFINITY;

  if (symbol === q) return 0;
  if (name === q) return 1;
  if (symbol.startsWith(q)) return 2;
  if (name.startsWith(q)) return 3;
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 4;
  if (symbol.includes(q)) return 5;
  if (name.includes(q)) return 6;
  return Number.POSITIVE_INFINITY;
}

// Search the curated index by ticker and full asset name. The same scoring is
// applied again after live-provider results are merged below.
export function searchAssets(query, limit = 12) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const idx = getGlobalAssetIndex();
  const scored = idx
    .map((entry) => ({ entry, score: searchRank(entry, q) }))
    .filter(({ score }) => Number.isFinite(score));
  scored.sort((a, b) => a.score - b.score || String(a.entry.symbol).localeCompare(String(b.entry.symbol)));
  return scored.slice(0, limit).map((s) => s.entry);
}

// Map a backend /search result into the palette's expected entry shape so it
// renders correctly (symbol, assetClass, exchange, provider, category, confidence).
function mapBackendResult(result) {
  const rawType = String(result?.type || result?.instrumentType || "").toLowerCase();
  const symbol = String(result?.symbol || "").toUpperCase();
  const name = result?.name || symbol;
  const provider = Array.isArray(result?.providers) && result.providers.length
    ? result.providers.join(" + ")
    : result?.provider || result?.source || "Live market data";
  const shared = {
    symbol,
    name,
    exchange: result?.exchange || (rawType === "currency" || rawType === "forex" ? "FX" : "Market"),
    provider,
    category: result?.category || "Markets",
    coverage: result?.marketType || result?.exchange || "",
    confidence: result?.fallback ? 65 : 90,
    live: result?.live !== false,
    fallback: Boolean(result?.fallback),
    asOf: result?.asOf || null,
  };

  if (rawType === "crypto") {
    return {
      ...shared,
      kind: "crypto",
      assetClass: "Crypto",
      exchange: result?.exchange || "Spot",
      category: "Crypto",
    };
  }
  if (rawType === "bond") {
    return { ...shared, kind: "bond", assetClass: "Bond", category: "Bonds" };
  }
  if (rawType === "etf") {
    return { ...shared, kind: "etf", assetClass: "ETF", category: "ETFs" };
  }
  if (rawType === "commodity") {
    return { ...shared, kind: "commodity", assetClass: "Commodity", category: "Commodities" };
  }
  if (rawType === "indicator") {
    return { ...shared, kind: "indicator", assetClass: "Indicator", category: "Indicators" };
  }
  if (rawType === "currency" || rawType === "forex") {
    return { ...shared, kind: rawType === "forex" ? "forex" : "currency", assetClass: "Currency", category: "Currencies" };
  }
  return {
    ...shared,
    kind: "stock",
    assetClass: "Stock",
    exchange: result?.exchange || "Equity",
    category: "Stocks",
  };
}

// Live asset search: the backend performs category-aware discovery across its
// configured providers. Curated reference entries remain available only when a
// live provider cannot resolve that category, and are marked as such.
export async function searchAssetsLive(query, limit = 14) {
  const q = String(query || "").trim();
  if (!q) return [];

  let liveResults = [];
  try {
    const res = await zeninFetch(`/search?q=${encodeURIComponent(q)}&type=all`);
    if (res.ok) {
      const data = await res.json();
      liveResults = Array.isArray(data?.results) ? data.results.map(mapBackendResult) : [];
    }
  } catch {
    // Keep a usable local reference lookup if the backend is unavailable.
  }

  // Local entries are a resilience-only fallback. A live match with the same
  // symbol always wins, preserving its provider, type, and freshness metadata.
  const curated = searchAssets(q, limit).map((entry) => ({ ...entry, live: false, fallback: true }));
  const seen = new Set();
  const merged = [];
  for (const entry of liveResults) {
    const key = String(entry?.symbol || "").toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  for (const entry of curated) {
    const key = String(entry?.symbol || "").toUpperCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }

  return merged
    .map((entry) => ({ entry, score: searchRank(entry, q) }))
    .sort((a, b) => a.score - b.score || String(a.entry.symbol).localeCompare(String(b.entry.symbol)))
    .slice(0, limit)
    .map(({ entry }) => entry);
}
