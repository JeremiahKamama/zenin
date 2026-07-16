// services/providers/DocumentIntelligenceProvider/Normalizer.js
// Normalize a raw SEC EDGAR filing into the provider-agnostic FilingRecord.
// Keeps EDGAR specifics isolated here; ARW/front-end only sees normalized shapes.

function normalizeFiling(raw, ticker) {
  if (!raw) return null;
  const formType = (raw.formType || raw.form || raw.filingType || "").trim();
  return {
    id: raw.accessionNumber || raw.id || `${ticker}-${formType}-${raw.filingDate || raw.filedAt || ""}`,
    ticker: ticker.toUpperCase(),
    formType,
    filedAt: raw.filingDate || raw.filedAt || null,
    title: raw.title || raw.primaryDocument || formType,
    material: formType === "8-K" || formType === "DEF 14A" || Boolean(raw.isMaterial),
    url: raw.documentUrl || raw.primaryDocumentUrl || null,
    sections: raw.sections || null,
  };
}

function normalizeOwnership(raw) {
  if (!raw) return null;
  return {
    institutionalPct: typeof raw.institutionalPct === "number" ? raw.institutionalPct : null,
    top5Concentration: typeof raw.top5Concentration === "number" ? raw.top5Concentration : null,
    holders: Array.isArray(raw.holders) ? raw.holders : [],
    trend: Array.isArray(raw.trend) ? raw.trend : [],
    passivePct: typeof raw.passivePct === "number" ? raw.passivePct : null,
    recentChanges: Array.isArray(raw.recentChanges) ? raw.recentChanges : [],
    hhi: typeof raw.hhi === "number" ? raw.hhi : null,
    largestBuyer: raw.largestBuyer || null,
    largestSeller: raw.largestSeller || null,
  };
}

function normalizeInsiders(raw) {
  if (!raw) return null;
  return {
    insiderPct: typeof raw.insiderPct === "number" ? raw.insiderPct : null,
    byRole: Array.isArray(raw.byRole) ? raw.byRole : ["CEO", "CFO", "Director", "Officer"],
    trades: Array.isArray(raw.trades) ? raw.trades : [],
  };
}

function normalizeGovernance(raw) {
  if (!raw) return null;
  return {
    board: Array.isArray(raw.board) ? raw.board : [],
    comp: raw.comp || null,
    proposals: Array.isArray(raw.proposals) ? raw.proposals : [],
    committees: Array.isArray(raw.committees) ? raw.committees : [],
  };
}

module.exports = { normalizeFiling, normalizeOwnership, normalizeInsiders, normalizeGovernance };
