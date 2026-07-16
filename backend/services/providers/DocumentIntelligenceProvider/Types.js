// services/providers/DocumentIntelligenceProvider/Types.js
// Shared types/shape contracts for the Document Intelligence provider.
// First implementation: SEC_API_PROVIDER (SEC EDGAR). Future: Companies House,
// SEDAR, EDINET, ASX, HKEX, earnings-transcript. ARW never sees provider-specific
// shapes — only these normalized contracts.

const FILING_TYPES = ["10-K", "10-Q", "8-K", "DEF 14A", "S-1", "SC 13D", "SC 13G", "13F-HR", "Form 4", "20-F", "6-K"];

// Normalized filing record.
// { id, ticker, formType, filedAt, title, material, url, sections? }
const FilingRecord = {
  id: String,
  ticker: String,
  formType: String,
  filedAt: String, // ISO
  title: String,
  material: Boolean,
  url: String,
  sections: Object, // { business, riskFactors, mda, ... } (Phase 2)
};

// Normalized 13F ownership.
// { institutionalPct, top5Concentration, holders:[{name,pct,change}], trend:[{period,pct}],
//   passivePct, recentChanges:[{holder,dir,pct}], hhi, largestBuyer, largestSeller }
const OwnershipRecord = {};

// Normalized insider (Form 4) activity.
// { insiderPct, byRole:[...], trades:[{id,insider,insiderType,transactionType,shares,filedAt,title}] }
const InsiderRecord = {};

// Normalized governance (proxy).
// { board:[{name,role,independent}], comp:{payRatio,medianEmployee,equityHeavy},
//   proposals:[...], committees:[...] }
const GovernanceRecord = {};

module.exports = {
  FILING_TYPES,
  FilingRecord,
  OwnershipRecord,
  InsiderRecord,
  GovernanceRecord,
};
