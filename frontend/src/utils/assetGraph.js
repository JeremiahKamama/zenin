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

/**
 * INDEX_CONSTITUENTS — representative core members of major equity indices.
 *
 * This is a **reference seed**, not an exhaustive real-time constituent list.
 * Membership is used by Part 5 (Market Context "Group By → Index") to bucket
 * movers/losers by index membership. Non-constituent symbols fall into "Other".
 *
 * Symbols are normalised to UPPERCASE without exchange suffix (e.g. "AAPL",
 * "7203.T" stays with suffix because it is the exchange-qualified ticker).
 */
export const INDEX_CONSTITUENTS = {
  "S&P 500": [
    "AAPL", "MSFT", "GOOG", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "BRK.B", "LLY",
    "JPM", "JNJ", "V", "WMT", "XOM", "PG", "MA", "UNH", "HD", "DIS",
    "BAC", "KO", "PFE", "PEP", "AVGO", "TMO", "COST", "ABBV", "WMT", "LLY",
    "CVX", "CRM", "MRK", "T", "ADP", "NFLX", "ABBV", "WFC", "UPS", "ORCL",
    "NKE", "LLY", "ACN", "TMO", "MCD", "PYPL", "SCHW", "BMY", "TGT", "ADBE",
    "AMD", "AMGN", "GILD", "INTC", "PEP", "QCOM", "MDLZ", "LOW", "CI", "ABT",
    "CB", "AXP", "GS", "BKNG", "SPGI", "MS", "PNC", "COP", "EL", "CTAS",
  ],
  "Nasdaq-100": [
    "AAPL", "MSFT", "GOOG", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "AVGO", "ADBE",
    "INTC", "AMD", "ORCL", "CRM", "COST", "REGN", "MDLZ", "PDD", "PYPL", "QCOM",
    "SBUX", "CHTR", "BIDU", "JD", "BILI", "NTES", "PPTV", "TME", "VALE", "MELI",
    "TMUS", "AMGN", "GILD", "VRTX", "CSGP", "ASML", "TXN", "MU", "DOCU", "ZM",
    "SNOW", "PLTR", "RIVN", "LCID", "RIOT", "COIN", "MARA", "RIVN", "XPEV", "NIO",
    "SPOT", "PFE", "BMY", "ABT", "MRK", "VRTX", "REGN", "BIIB", "ALGN", "IDXX",
  ],
  "Dow Jones": [
    "AAPL", "MSFT", "GOOG", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "BRK.B", "JPM",
    "JNJ", "V", "WMT", "XOM", "PG", "MA", "UNH", "HD", "DIS", "BAC",
    "KO", "CVX", "WBA", "GS", "CRM", "MMM", "AXP", "AMGN", "HON", "CAT",
  ],
  "Nikkei 225": [
    "7203.T", "6758.T", "6861.T", "9984.T", "8306.T", "5101.T", "4502.T", "4503.T",
    "6301.T", "6326.T", "6973.T", "6716.T", "8053.T", "7203.T", "9983.T", "5401.T",
    "8035.T", "4689.T", "6672.T", "7269.T", "6806.T", "6807.T", "6752.T", "6365.T",
    "6366.T", "7741.T", "7751.T", "7752.T", "7759.T", "7760.T", "7761.T", "8001.T",
    "8002.T", "8003.T", "8012.T", "8021.T", "8028.T", "8031.T", "8053.T", "8058.T",
    "8078.T", "8086.T", "8089.T", "8090.T", "8098.T", "8103.T", "8105.T", "8113.T",
    "8118.T", "8125.T", "8133.T", "8152.T", "8165.T", "8174.T", "8182.T", "8183.T",
    "8192.T", "8195.T", "8197.T", "8200.T", "8201.T", "8202.T", "8204.T", "8205.T",
    "8206.T", "8210.T", "8214.T", "8216.T", "8218.T", "8220.T", "8221.T", "8222.T",
    "8223.T", "8224.T", "8225.T", "8227.T", "8228.T", "8233.T", "8234.T", "8237.T",
    "8248.T", "8255.T", "8256.T", "8259.T", "8264.T", "8265.T", "8269.T", "8272.T",
  ],
};

/** Lookup which index (if any) a symbol belongs to.
 *  @param {string} symbol — ticker, e.g. "AAPL" or "7203.T"
 *  @returns {string|null} index name or null for non-members. */
export function getIndexMembership(symbol) {
  const sym = String(symbol || "").toUpperCase().trim();
  for (const [indexName, constituents] of Object.entries(INDEX_CONSTITUENTS)) {
    if (constituents.some((c) => c.toUpperCase() === sym)) {
      return indexName;
    }
  }
  return null;
}

