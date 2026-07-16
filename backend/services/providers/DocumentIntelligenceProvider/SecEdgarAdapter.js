// services/providers/DocumentIntelligenceProvider/SecEdgarAdapter.js
// No-key fallback for Document Intelligence: SEC EDGAR public REST API.
// https://www.sec.gov/edgar/search/
//
// Provides filing METADATA only (latest + recent filings). It is the honest
// fallback when SEC_API_IO_KEY is absent. Per spec, EDGAR is NEVER used for
// extracted sections, XBRL, Form 4, 13F, or N-PORT — those return an explicit
// `unavailable` capability state instead of fabricated or wrong data.

const https = require("https");
const { normalizeFiling } = require("./Normalizer");

const SEC_HOST = "data.sec.gov";
const BROWSE_HOST = "www.sec.gov";
const USER_AGENT = process.env.SEC_USER_AGENT || "zenin-research@example.com";

function secGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { host, path, headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
      (res) => {
        if (res.statusCode === 429) return reject(new Error("SEC rate limited"));
        if (res.statusCode >= 400) return reject(new Error(`SEC ${res.statusCode}`));
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("SEC timeout")));
  });
}

let _tickerCik = null;
async function tickerToCik(ticker) {
  if (!_tickerCik) _tickerCik = await secGet(BROWSE_HOST, "/files/company_tickers.json");
  const entry = Object.values(_tickerCik).find((e) => e.ticker === ticker.toUpperCase());
  return entry ? String(entry.cik_str).padStart(10, "0") : null;
}

async function getLatestFilingRecord(ticker) {
  const cik = await tickerToCik(ticker);
  if (!cik) return null;
  const data = await secGet(SEC_HOST, `/submissions/CIK${cik}.json`);
  const recents = data.filings?.recent;
  if (!recents || !recents.form?.length) return null;
  return normalizeFiling(
    {
      formType: recents.form[0],
      filingDate: recents.filingDate[0],
      accessionNumber: recents.accessionNumber[0],
      primaryDocument: recents.primaryDocument[0],
      documentUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${recents.accessionNumber[0].replace(/-/g, "")}/${recents.primaryDocument[0]}`,
    },
    ticker
  );
}

async function getFilingsList(ticker) {
  const cik = await tickerToCik(ticker);
  if (!cik) return [];
  const data = await secGet(SEC_HOST, `/submissions/CIK${cik}.json`);
  const r = data.filings?.recent;
  if (!r) return [];
  const out = [];
  for (let i = 0; i < (r.form?.length || 0); i += 1) {
    out.push(
      normalizeFiling(
        {
          formType: r.form[i],
          filingDate: r.filingDate[i],
          accessionNumber: r.accessionNumber[i],
          primaryDocument: r.primaryDocument[i],
          documentUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`,
        },
        ticker
      )
    );
  }
  return out;
}

// EDGAR fallback returns the normalized envelope; paid capabilities return
// explicit unavailable (never EDGAR for sections/XBRL/Form4/13F/N-PORT).
function unavailable(reason) {
  return { provider: "sec-edgar", fetchedAt: new Date().toISOString(), freshness: "unavailable", sourceUrl: null, accessionNumber: null, data: null, reason };
}

const Adapter = {
  providerId: "SEC_EDGAR",
  isEntitled: () => !process.env.SEC_API_IO_KEY, // EDGAR is the fallback when no paid key

  async getCompany(ticker) {
    const filings = await this.getFilings(ticker);
    const latest = filings[0] || null;
    return { provider: "sec-edgar", fetchedAt: new Date().toISOString(), freshness: "fresh", sourceUrl: latest?.url || null, accessionNumber: latest?.accessionNumber || null, data: { ticker: ticker.toUpperCase(), latestFiling: latest, filings, timeline: filings.slice(0, 20), recentEvents: filings.slice(0, 10) } };
  },
  async getFilings(ticker) {
    const list = await safeGet(() => getFilingsList(ticker), []);
    return { provider: "sec-edgar", fetchedAt: new Date().toISOString(), freshness: "fresh", sourceUrl: null, accessionNumber: null, data: list };
  },
  async getFiling(ticker, accessionNumber) {
    const filings = (await this.getFilings(ticker)).data || [];
    const found = filings.find((f) => f.id === accessionNumber || f.accessionNumber === accessionNumber);
    return { provider: "sec-edgar", fetchedAt: new Date().toISOString(), freshness: "fresh", sourceUrl: found?.url || null, accessionNumber, data: found || null };
  },
  async getSections() { return unavailable("edgar-fallback-no-extraction"); },
  async getFinancialStatements() { return unavailable("edgar-fallback-no-xbrl"); },
  async getInsiders() { return unavailable("edgar-fallback-no-form4"); },
  async getInstitutionalOwnership() { return unavailable("edgar-fallback-no-13f"); },
  async getCorporateActions() { return unavailable("edgar-fallback-no-ca"); },
  async getGovernance() { return unavailable("edgar-fallback-no-proxy"); },
  async getFundFilings() { return unavailable("edgar-fallback-no-fund"); },
  async getFundHoldings() { return unavailable("edgar-fallback-no-nport"); },
};

async function safeGet(fn, fallback) {
  try { return (await fn()) ?? fallback; } catch { return fallback; }
}

module.exports = Adapter;
