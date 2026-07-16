// services/providers/DocumentIntelligenceProvider/SecApiIoAdapter.js
// Primary paid adapter for Document Intelligence (Sec API). Enabled only when
// SEC_API_IO_KEY is configured. Owns Sec-API-specific normalization; the
// Provider facade and ARW only ever see the normalized envelope:
//   { provider, fetchedAt, freshness, sourceUrl, accessionNumber, data }
//
// Capabilities mapping (per spec):
//   filings / sections / financials / insiders(Form4) / ownership(13F) → Sec API
//   fund filings / fund holdings (N-PORT) → Phase 2 (unavailable until built)
// Direct EDGAR is NEVER used here for extracted/structured data.

const Client = require("./SecApiIoClient");
const { normalizeFiling, normalizeOwnership, normalizeInsiders, normalizeGovernance } = require("./Normalizer");

const MATERIAL_FORMS = new Set(["8-K", "10-K", "10-Q", "DEF 14A", "S-1", "S-3", "SC 13D", "SC 13G", "13F-HR"]);

function envelope(provider, { data = null, sourceUrl = null, accessionNumber = null, freshness = "fresh" } = {}) {
  return {
    provider,
    fetchedAt: new Date().toISOString(),
    freshness,
    sourceUrl,
    accessionNumber,
    data,
  };
}

function unavailable(reason) {
  return { provider: "sec-api", fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null, reason };
}

function isEntitled() {
  return Client.isConfigured();
}

// Map a filing query result into normalized filing records.
function mapQueryFilings(payload) {
  const filings = payload?.filings || [];
  return filings.map((f) => {
    const accessionNumber = f.accessionNo || f.accessionNumber;
    const formType = (f.formType || "").trim();
    const cik = f.cik || f.cik_str;
    const accClean = accessionNumber ? String(accessionNumber).replace(/-/g, "") : "";
    const url = f.documentUrl || (cik && accClean
      ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accClean}/${f.primaryDocument || ""}`
      : null);
    return normalizeFiling(
      {
        formType,
        filingDate: f.filedAt || f.filingDate,
        accessionNumber,
        primaryDocument: f.primaryDocument,
        documentUrl: url,
      },
      f.ticker
    );
  });
}

const Adapter = {
  providerId: "SEC_API_IO",

  isEntitled,

  async getCompany(ticker) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    const filings = await this.getFilings(ticker, { limit: 20 });
    const latest = filings[0] || null;
    return envelope("sec-api", {
      data: { ticker: ticker.toUpperCase(), latestFiling: latest, filings, timeline: filings.slice(0, 20), recentEvents: filings.slice(0, 10) },
      sourceUrl: latest?.url || null,
      accessionNumber: latest?.accessionNumber || null,
    });
  },

  async getFilings(ticker, { forms, limit = 20, cursor = 0 } = {}) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    const formClause = Array.isArray(forms) && forms.length
      ? ` AND (${forms.map((f) => `formType:"${f}"`).join(" OR ")})`
      : "";
    const query = {
      query: { query_string: { query: `ticker:"${ticker}"${formClause}` } },
      from: Number(cursor) || 0,
      size: limit,
    };
    try {
      const payload = await Client.queryFilings(query);
      const filings = mapQueryFilings(payload);
      return envelope("sec-api", { data: filings });
    } catch (e) {
      return unavailable(Client.SecApiIoError.name === e.name ? e.code : "error");
    }
  },

  async getFiling(ticker, accessionNumber) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    const filings = await this.getFilings(ticker, { limit: 50 });
    const found = (filings.data || []).find((f) => f.id === accessionNumber || f.accessionNumber === accessionNumber);
    return envelope("sec-api", { data: found || null, accessionNumber });
  },

  async getSections(ticker, accessionNumber, sectionIds) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    if (!accessionNumber) return unavailable("missing-accession");
    const filings = await this.getFilings(ticker, { limit: 50 });
    const filing = (filings.data || []).find((f) => f.accessionNumber === accessionNumber);
    if (!filing?.url) return unavailable("missing-document-url");
    const sections = Array.isArray(sectionIds) ? sectionIds : ["business", "riskFactors", "mda", "legalProceedings"];
    try {
      const extracted = await Client.extractSections(filing.url, sections);
      return envelope("sec-api", { data: extracted, sourceUrl: filing.url, accessionNumber });
    } catch (e) {
      return unavailable(Client.SecApiIoError.name === e.name ? e.code : "error");
    }
  },

  async getFinancialStatements(ticker, accessionNumber) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    if (!accessionNumber) return unavailable("missing-accession");
    const filings = await this.getFilings(ticker, { limit: 50 });
    const filing = (filings.data || []).find((f) => f.accessionNumber === accessionNumber);
    if (!filing?.url) return unavailable("missing-document-url");
    try {
      const xbrl = await Client.xbrlToJson({ url: filing.url });
      return envelope("sec-api", { data: xbrl, sourceUrl: filing.url, accessionNumber });
    } catch (e) {
      return unavailable(Client.SecApiIoError.name === e.name ? e.code : "error");
    }
  },

  async getInsiders(ticker, { from, to, limit = 20 } = {}) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    try {
      const payload = await Client.queryFormFour({ ticker, size: limit });
      const records = (payload?.filings || []).map((f) => ({
        accessionNumber: f.accessionNo || f.accessionNumber,
        filedAt: f.filedAt || f.filingDate,
        url: f.documentUrl,
        insider: f.reportingOwner || f.name || null,
        transactionType: f.transactionType || null,
        shares: f.sharesTransacted ?? null,
      }));
      return envelope("sec-api", {
        data: normalizeInsiders({ trades: records }),
        sourceUrl: records[0]?.url || null,
      });
    } catch (e) {
      return unavailable(Client.SecApiIoError.name === e.name ? e.code : "error");
    }
  },

  async getInstitutionalOwnership(ticker) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    try {
      const payload = await Client.queryForm13F({ ticker });
      const current = payload?.filings?.[0];
      const holders = Array.isArray(current?.holdings)
        ? current.holdings.map((h) => ({ name: h.name, pct: Number(h.pctHeld) || null, change: h.quarterlyChange || null }))
        : [];
      const normalized = normalizeOwnership({
        institutionalPct: Number(current?.totalInstitutionalPct) || null,
        top5Concentration: Number(current?.top5Concentration) || null,
        holders,
        hhi: Number(current?.hhi) || null,
      });
      return envelope("sec-api", {
        data: normalized,
        sourceUrl: current?.documentUrl || null,
        accessionNumber: current?.accessionNo || current?.accessionNumber || null,
      });
    } catch (e) {
      return unavailable(Client.SecApiIoError.name === e.name ? e.code : "error");
    }
  },

  async getCorporateActions(ticker) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    // Sec API surfaces corporate actions via filing metadata; for now we derive
    // a lightweight marker from recent material filings. Full CA feed is a later
    // entitlement; return explicit unavailable rather than fabricate.
    return unavailable("corporate-actions-not-entitled");
  },

  async getGovernance(ticker) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    // Proxy/DEF 14A parsing is a later entitlement.
    return unavailable("governance-not-entitled");
  },

  // Phase 2 — fund regulatory filings; holdings (N-PORT) not yet built.
  async getFundFilings(ticker, { forms, limit = 10 } = {}) {
    if (!isEntitled()) return unavailable("entitlement-missing");
    try {
      const payload = await Client.queryFundFilings({ ticker, size: limit });
      const filings = mapQueryFilings(payload);
      return envelope("sec-api", { data: filings });
    } catch (e) {
      return unavailable(Client.SecApiIoError.name === e.name ? e.code : "error");
    }
  },

  async getFundHoldings() {
    // Phase 2.
    return unavailable("n-port-phase-2");
  },
};

module.exports = Adapter;
