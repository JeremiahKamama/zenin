// services/providers/ETFIntelligenceProvider/Types.js
// Normalized contracts for ETF Intelligence. First impl: ETFDB_SCRAPER.
// Future: ETF.com, VettaFi, Morningstar, Refinitiv. ARW sees only these shapes.

const ETFProfile = {
  objective: String,
  strategy: String,
  benchmark: String,
  index: String,
  issuer: String,
  category: String,
  expenseRatio: Number,
  distributionPolicy: String,
};
const ETFComposition = {
  topHoldings: [{ name, weight }],
  sector: [{ name, weight }],
  country: [{ name, weight }],
  asset: [{ name, weight }],
  marketCap: [{ name, weight }],
  style: [{ name, weight }],
  concentration: Number,
};
const ETFClassification = { assetClass: String, category: String, focus: String, style: String, region: String, theme: String, strategy: String };
const ETFStrategy = { objective: String, benchmark: String, underlyingIndex: String, selectionMethodology: String, rebalancingSchedule: String, issuer: String, distributionPolicy: String };

module.exports = { ETFProfile, ETFComposition, ETFClassification, ETFStrategy };
