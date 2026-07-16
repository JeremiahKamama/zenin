// Asset Intelligence Platform — shared relationship graph seed (single source of truth).
//
// Consolidates the three previously-duplicated literal maps
// (COMMODITY_RELATIONS ×2 + COMPANY_TO_COMMODITIES ×1) into one module.
// Reference data only — no market values, no fabricated intelligence.
//
// This is the Phase 5 graph SEED: Phase 5 promotes it to EntityRegistry +
// RelationshipGraph with multi-hop traversal. Until then, consumers read the
// 1-hop helpers below so there is exactly one place to edit relationships.

/** Commodity symbol -> reference relations + contract metadata (superset). */
export const COMMODITY_RELATIONS = {
  CL:     { companies: ["XOM", "CVX", "COP"], etfs: ["XLE", "USO"], countries: ["Saudi Arabia", "USA", "Russia"], currencies: ["USD"], indexes: ["OPEC"], category: "Energy", exchange: "NYMEX", tick: 0.01, unit: "USD/bbl", delivery: "Physical", settlement: "Cash/Physical" },
  WTI:    { companies: ["XOM", "CVX", "COP"], etfs: ["XLE", "USO"], countries: ["Saudi Arabia", "USA", "Russia"], currencies: ["USD"], indexes: ["OPEC"], category: "Energy", exchange: "NYMEX", tick: 0.01, unit: "USD/bbl", delivery: "Physical", settlement: "Cash/Physical" },
  BRENT:  { companies: ["XOM", "CVX", "BP"], etfs: ["BNO", "XLE"], countries: ["UK", "Saudi Arabia", "Russia"], currencies: ["USD"], indexes: ["OPEC"], category: "Energy", exchange: "ICE", tick: 0.01, unit: "USD/bbl", delivery: "Physical", settlement: "Cash" },
  NG:     { companies: ["CHK", "EQT", "XOM"], etfs: ["UNG"], countries: ["USA"], currencies: ["USD"], indexes: [], category: "Energy", exchange: "NYMEX", tick: 0.001, unit: "USD/MMBtu", delivery: "Physical", settlement: "Cash/Physical" },
  HG:     { companies: ["FCX", "RIO", "BHP"], etfs: ["COPX"], countries: ["Chile", "China", "Peru"], currencies: ["USD"], indexes: ["Manufacturing PMI"], category: "Industrial Metals", exchange: "COMEX", tick: 0.0005, unit: "USD/lb", delivery: "Physical", settlement: "Cash/Physical" },
  COPPER: { companies: ["FCX", "RIO", "BHP"], etfs: ["COPX"], countries: ["Chile", "China", "Peru"], currencies: ["USD"], indexes: ["Manufacturing PMI"], category: "Industrial Metals", exchange: "COMEX", tick: 0.0005, unit: "USD/lb", delivery: "Physical", settlement: "Cash/Physical" },
  GC:     { companies: ["NEM", "GOLD", "AEM"], etfs: ["GLD", "GDX"], countries: ["USA", "Canada", "Australia"], currencies: ["USD"], indexes: ["Real Rates"], category: "Precious Metals", exchange: "COMEX", tick: 0.1, unit: "USD/oz", delivery: "Physical", settlement: "Cash/Physical" },
  GOLD:   { companies: ["NEM", "GOLD", "AEM"], etfs: ["GLD", "GDX"], countries: ["USA", "Canada", "Australia"], currencies: ["USD"], indexes: ["Real Rates"], category: "Precious Metals", exchange: "COMEX", tick: 0.1, unit: "USD/oz", delivery: "Physical", settlement: "Cash/Physical" },
  SI:     { companies: ["PAAS", "AG"], etfs: ["SLV"], countries: ["Mexico", "Peru"], currencies: ["USD"], indexes: [], category: "Precious Metals", exchange: "COMEX", tick: 0.005, unit: "USD/oz", delivery: "Physical", settlement: "Cash/Physical" },
  ZW:     { companies: ["ADM", "BG"], etfs: ["WEAT"], countries: ["USA", "Russia", "Ukraine"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" },
  WHEAT:  { companies: ["ADM", "BG"], etfs: ["WEAT"], countries: ["USA", "Russia", "Ukraine"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" },
  ZC:     { companies: ["ADM", "BG"], etfs: ["CORN"], countries: ["USA", "Brazil"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" },
  ZS:     { companies: ["ADM", "BG"], etfs: ["SOYB"], countries: ["USA", "Brazil", "Argentina"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" },
};

/**
 * Core ETF seed — major US-listed ETFs (brand-name, reference metadata only).
 * Makes ETFs first-class in global search (⌘K, watchlist autocomplete) identically
 * to stocks/commodities. No market values — the UI renders honest "Unavailable"
 * until a price/holdings backend feed is wired. New ETFs: add here once.
 */
export const CORE_ETF_SEED = {
  SPY:  { name: "SPDR S&P 500 ETF Trust", issuer: "State Street", category: "US Large Cap Blend", benchmark: "S&P 500", exposure: ["Equity", "Broad US"] },
  QQQ:  { name: "Invesco QQQ Trust", issuer: "Invesco", category: "US Large Cap Growth", benchmark: "Nasdaq-100", exposure: ["Equity", "Technology"] },
  VTI:  { name: "Vanguard Total Stock Market ETF", issuer: "Vanguard", category: "US Total Market", benchmark: "CRSP US Total Market", exposure: ["Equity", "Broad US"] },
  IWM:  { name: "iShares Russell 2000 ETF", issuer: "BlackRock", category: "US Small Cap", benchmark: "Russell 2000", exposure: ["Equity", "Small Cap"] },
  VOO:  { name: "Vanguard S&P 500 ETF", issuer: "Vanguard", category: "US Large Cap Blend", benchmark: "S&P 500", exposure: ["Equity", "Broad US"] },
  IVV:  { name: "iShares Core S&P 500 ETF", issuer: "BlackRock", category: "US Large Cap Blend", benchmark: "S&P 500", exposure: ["Equity", "Broad US"] },
  VEA:  { name: "Vanguard FTSE Developed Markets ETF", issuer: "Vanguard", category: "Developed Intl Equity", benchmark: "FTSE Developed All Cap", exposure: ["Equity", "International"] },
  VWO:  { name: "Vanguard FTSE Emerging Markets ETF", issuer: "Vanguard", category: "Emerging Markets Equity", benchmark: "FTSE Emerging Markets", exposure: ["Equity", "Emerging"] },
  AGG:  { name: "iShares Core US Aggregate Bond ETF", issuer: "BlackRock", category: "US Aggregate Bond", benchmark: "Bloomberg US Agg", exposure: ["Fixed Income"] },
  TLT:  { name: "iShares 20+ Year Treasury Bond ETF", issuer: "BlackRock", category: "Long Treasury", benchmark: "ICE US Treasury 20+yr", exposure: ["Fixed Income", "Rates"] },
  GLD:  { name: "SPDR Gold Shares", issuer: "State Street", category: "Commodity", benchmark: "LBMA Gold Price", exposure: ["Commodity", "Gold"] },
  SLV:  { name: "iShares Silver Trust", issuer: "BlackRock", category: "Commodity", benchmark: "LBMA Silver Price", exposure: ["Commodity", "Silver"] },
  ARKK: { name: "ARK Innovation ETF", issuer: "ARK", category: "US Thematic Growth", benchmark: "Nasdaq", exposure: ["Equity", "Innovation"] },
  EEM:  { name: "iShares MSCI Emerging Markets ETF", issuer: "BlackRock", category: "Emerging Markets Equity", benchmark: "MSCI Emerging Markets", exposure: ["Equity", "Emerging"] },
  KWEB: { name: "KR CCSI China Internet ETF", issuer: "KraneShares", category: "China Equity", benchmark: "CSI Overseas China Internet", exposure: ["Equity", "China"] },
};

/** Company ticker -> commodities it is exposed to. Derived from COMMODITY_RELATIONS
 *  (so new commodity edges auto-propagate) and unioned with the explicit original
 *  reverse entries so no previously-shown relationship is ever lost. */
const COMPANY_TO_COMMODITIES_EXPLICIT = {
  XOM: ["CL", "WTI", "BRENT", "NG"], CVX: ["CL", "WTI", "NG"], COP: ["CL", "WTI", "NG"], BP: ["BRENT"],
  CHK: ["NG"], EQT: ["NG"],
  FCX: ["HG", "COPPER"], RIO: ["HG", "COPPER"], BHP: ["HG", "COPPER"],
  NEM: ["GC", "GOLD"], GOLD: ["GC", "GOLD"], AEM: ["GC", "GOLD"], PAAS: ["SI"], AG: ["SI"],
  ADM: ["ZW", "WHEAT", "ZC", "ZS"], BG: ["ZW", "WHEAT", "ZC", "ZS"],
};

const COMPANY_TO_COMMODITIES_DERIVED = (() => {
  const out = {};
  for (const [sym, rel] of Object.entries(COMMODITY_RELATIONS)) {
    for (const co of rel.companies || []) {
      (out[co] = out[co] || []).push(sym);
    }
  }
  // Union with explicit originals to preserve every previously-shown edge.
  for (const [co, syms] of Object.entries(COMPANY_TO_COMMODITIES_EXPLICIT)) {
    const set = new Set([...(out[co] || []), ...syms]);
    out[co] = [...set];
  }
  return out;
})();

/** 1-hop: relations + contract metadata for a commodity symbol. */
export function getCommodityRelations(symbol) {
  return COMMODITY_RELATIONS[String(symbol || "").toUpperCase()] || {};
}

/** 1-hop reverse: commodities a company is exposed to. */
export function getCompanyCommodities(ticker) {
  return COMPANY_TO_COMMODITIES_DERIVED[String(ticker || "").toUpperCase()] || [];
}

/** Back-compat: the reverse map as an object (equivalent to the old literal). */
export const COMPANY_TO_COMMODITIES = COMPANY_TO_COMMODITIES_DERIVED;
