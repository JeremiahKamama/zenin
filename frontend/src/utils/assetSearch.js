// Global asset search index — single source of truth derived from assetGraph seed
// + assetRegistry kinds. Powers the ⌘K launcher and Watchlist autocomplete so
// commodities / companies / ETFs / currencies are discoverable everywhere, identically.
// Reference data only — no fabricated market values.

import { COMMODITY_RELATIONS, COMPANY_TO_COMMODITIES, CORE_ETF_SEED } from "./assetGraph.js";
import { CURATED_CURRENCIES, CURATED_FX_PAIRS, FX_BASE_QUOTE } from "./currencyInstruments.js";

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
    const [b, q] = FX_BASE_QUOTE[pair];
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

// Search the index. Returns matches scored by prefix/substring over symbol+name.
export function searchAssets(query, limit = 12) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const idx = getGlobalAssetIndex();
  const scored = [];
  for (const entry of idx) {
    const sym = entry.symbol.toLowerCase();
    const nm = entry.name.toLowerCase();
    let score = -1;
    if (sym === q) score = 0;
    else if (sym.startsWith(q)) score = 1;
    else if (nm.startsWith(q)) score = 2;
    else if (sym.includes(q) || nm.includes(q)) score = 3;
    if (score >= 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.entry);
}
