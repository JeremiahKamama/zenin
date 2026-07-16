// services/providers/DocumentIntelligenceProvider/Provider.js
// Generic Document Intelligence provider facade. Holds the active implementation
// and exposes a provider-agnostic interface. Swapping implementations means
// changing ONLY this file — ARW and the routes stay untouched.
//
// Adapter selection (per spec):
//   - SecApiIoAdapter   : primary paid adapter; used when SEC_API_IO_KEY is set.
//   - SecEdgarAdapter   : no-key EDGAR fallback for filing METADATA only.
// Direct EDGAR is NEVER used for extracted sections / XBRL / Form 4 / 13F / N-PORT;
// those capabilities return explicit `unavailable` from the adapter.

const Cache = require("./Cache");
const SecApiIo = require("./SecApiIoAdapter");
const SecEdgar = require("./SecEdgarAdapter");
const { normalizeOwnership, normalizeInsiders, normalizeGovernance } = require("./Normalizer");

// Active implementation registry. Add new impls here without touching ARW.
const IMPLEMENTATIONS = { SEC_API_IO: SecApiIo, SEC_EDGAR: SecEdgar };
const ACTIVE = process.env.DOCUMENT_INTELLIGENCE_PROVIDER || (process.env.SEC_API_IO_KEY ? "SEC_API_IO" : "SEC_EDGAR");
const impl = IMPLEMENTATIONS[ACTIVE] || (process.env.SEC_API_IO_KEY ? SecApiIo : SecEdgar);

// Graceful degradation: if any capability throws, return an honest empty result
// rather than fabricating data.
async function safe(fn, fallback) {
  try { return (await fn()) ?? fallback; } catch { return fallback; }
}

// The facade methods return the adapter's normalized envelope directly:
//   { provider, fetchedAt, freshness, sourceUrl, accessionNumber, data }
async function getCompany(ticker) { return safe(() => impl.getCompany(ticker), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getFilings(ticker, opts) { return safe(() => impl.getFilings(ticker, opts), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: [] }); }
async function getFiling(ticker, accessionNumber) { return safe(() => impl.getFiling(ticker, accessionNumber), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getSections(ticker, accessionNumber, sectionIds) { return safe(() => impl.getSections(ticker, accessionNumber, sectionIds), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getFinancialStatements(ticker, accessionNumber) { return safe(() => impl.getFinancialStatements(ticker, accessionNumber), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getInsiders(ticker, opts) { return safe(() => impl.getInsiders(ticker, opts), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getInstitutionalOwnership(ticker) { return safe(() => impl.getInstitutionalOwnership(ticker), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getCorporateActions(ticker) { return safe(() => impl.getCorporateActions(ticker), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getGovernance(ticker) { return safe(() => impl.getGovernance(ticker), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getFundFilings(ticker, opts) { return safe(() => impl.getFundFilings(ticker, opts), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }
async function getFundHoldings(ticker) { return safe(() => impl.getFundHoldings(ticker), { provider: impl.providerId, fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null }); }

module.exports = {
  providerId: ACTIVE,
  activeImpl: impl,
  getCompany,
  getFilings,
  getFiling,
  getSections,
  getFinancialStatements,
  getInsiders,
  getInstitutionalOwnership,
  getCorporateActions,
  getGovernance,
  getFundFilings,
  getFundHoldings,
};
