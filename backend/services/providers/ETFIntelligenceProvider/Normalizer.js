// services/providers/ETFIntelligenceProvider/Normalizer.js
// Normalize a raw ETFdb scrape into provider-agnostic shapes.

function normalizeProfile(raw) {
  if (!raw) return null;
  return {
    objective: raw.objective || raw.description || null,
    strategy: raw.strategy || null,
    benchmark: raw.benchmark || raw.index || null,
    index: raw.index || raw.underlying || null,
    issuer: raw.issuer || null,
    category: raw.category || null,
    expenseRatio: typeof raw.expenseRatio === "number" ? raw.expenseRatio : (raw.expenseRatioPct != null ? raw.expenseRatioPct / 100 : null),
    distributionPolicy: raw.distributionPolicy || null,
  };
}
function normalizeComposition(raw) {
  if (!raw) return null;
  return {
    topHoldings: Array.isArray(raw.topHoldings) ? raw.topHoldings : [],
    sector: Array.isArray(raw.sector) ? raw.sector : [],
    country: Array.isArray(raw.country) ? raw.country : [],
    asset: Array.isArray(raw.asset) ? raw.asset : [],
    marketCap: Array.isArray(raw.marketCap) ? raw.marketCap : [],
    style: Array.isArray(raw.style) ? raw.style : [],
    concentration: typeof raw.concentration === "number" ? raw.concentration : null,
  };
}
function normalizeClassification(raw) {
  if (!raw) return null;
  return {
    assetClass: raw.assetClass || null,
    category: raw.category || null,
    focus: raw.focus || null,
    style: raw.style || null,
    region: raw.region || null,
    theme: raw.theme || null,
    strategy: raw.strategy || null,
  };
}
function normalizeStrategy(raw) {
  if (!raw) return null;
  return {
    objective: raw.objective || null,
    benchmark: raw.benchmark || null,
    underlyingIndex: raw.underlyingIndex || raw.index || null,
    selectionMethodology: raw.selectionMethodology || null,
    rebalancingSchedule: raw.rebalancingSchedule || null,
    issuer: raw.issuer || null,
    distributionPolicy: raw.distributionPolicy || null,
  };
}
module.exports = { normalizeProfile, normalizeComposition, normalizeClassification, normalizeStrategy };
