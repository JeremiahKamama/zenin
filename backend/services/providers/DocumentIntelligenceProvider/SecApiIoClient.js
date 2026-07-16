// services/providers/DocumentIntelligenceProvider/SecApiIoClient.js
// Low-level HTTP client for the paid Sec API (https://api.sec-api.io).
//
// This module owns ALL Sec API specifics: base URL, Authorization header,
// request construction for the Filing Query / Extractor / XBRL / Form 4 / 13F
// endpoints, retries with capped backoff, timeout, and 429 rate-limit mapping.
// Adapters call these methods and never build URLs or parse transport errors
// themselves. Every method throws a typed SecApiIoError so the adapter can
// translate failures into an explicit `unavailable` capability state.

const https = require("https");
const { URL } = require("url");

const SEC_API_BASE = "https://api.sec-api.io";
const DEFAULT_TIMEOUT_MS = Number(process.env.SEC_API_IO_TIMEOUT_MS || 12000);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 600;

class SecApiIoError extends Error {
  constructor(message, { status, code, retryable = false } = {}) {
    super(message);
    this.name = "SecApiIoError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function buildOptions(path, body) {
  const url = new URL(path, SEC_API_BASE);
  const key = process.env.SEC_API_IO_KEY;
  return {
    method: "POST",
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: {
      Authorization: key || "",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: DEFAULT_TIMEOUT_MS,
  };
}

function requestJson(path, payload) {
  return new Promise((resolve, reject) => {
    const opts = buildOptions(path, payload);
    const body = Buffer.from(JSON.stringify(payload || {}));
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const status = res.statusCode;
        if (status === 401 || status === 403) {
          return reject(new SecApiIoError("Sec API authorization failed", { status, code: "UNAUTHORIZED" }));
        }
        if (status === 429) {
          return reject(new SecApiIoError("Sec API rate limited", { status, code: "RATE_LIMITED", retryable: true }));
        }
        if (status >= 400) {
          return reject(new SecApiIoError(`Sec API HTTP ${status}`, { status, code: "HTTP_ERROR", retryable: status >= 500 }));
        }
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch (e) {
          reject(new SecApiIoError("Sec API returned non-JSON body", { status, code: "BAD_RESPONSE" }));
        }
      });
    });
    req.on("error", (err) => reject(new SecApiIoError(err.message, { code: "NETWORK", retryable: true })));
    req.on("timeout", () => req.destroy(new SecApiIoError("Sec API timeout", { code: "TIMEOUT", retryable: true })));
    req.end(body);
  });
}

async function requestWithRetry(path, payload, attempt = 1) {
  try {
    return await requestJson(path, payload);
  } catch (err) {
    const retryable = err.retryable && attempt < MAX_RETRIES;
    if (!retryable) throw err;
    const backoff = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), 8000);
    await new Promise((r) => setTimeout(r, backoff));
    return requestWithRetry(path, payload, attempt + 1);
  }
}

const Client = {
  SecApiIoError,
  isConfigured() {
    return Boolean(process.env.SEC_API_IO_KEY);
  },

  // Filing Query API: full-text + structured query over EDGAR filings.
  // https://sec-api.io/docs/query-api
  queryFilings({ query, from = 0, size = 10 } = {}) {
    return requestWithRetry("/", { query, from, size });
  },

  // Extractor API: pull specific sections (Business, Risk Factors, MD&A, …)
  // from a filing by document URL.
  // https://sec-api.io/docs/extractor-api
  extractSections(documentUrl, sections) {
    return requestWithRetry("/extractor", { url: documentUrl, sections });
  },

  // XBRL-to-JSON API: structured financial statements.
  // https://sec-api.io/docs/xbrl-api
  xbrlToJson({ url, accessionNumber, cik } = {}) {
    if (url) return requestWithRetry("/xbrl-to-json", { url });
    if (accessionNumber && cik) return requestWithRetry("/xbrl-to-json", { accessionNumber, cik });
    throw new SecApiIoError("xbrlToJson requires url or accessionNumber+cik", { code: "BAD_REQUEST" });
  },

  // Form 4: query recent Form 4 filings for a ticker, then extract the
  // transaction table from the primary document.
  queryFormFour({ ticker, from = 0, size = 20 } = {}) {
    const query = {
      query: { query_string: { query: `formType:"4" AND ticker:"${ticker}"` } },
      from,
      size,
    };
    return requestWithRetry("/", query);
  },

  // Form 13F: institutional ownership holdings.
  queryForm13F({ ticker, from = 0, size = 10 } = {}) {
    const query = {
      query: { query_string: { query: `formType:"13F-HR" AND ticker:"${ticker}"` } },
      from,
      size,
    };
    return requestWithRetry("/", query);
  },

  // Fund regulatory filings (N-PORT, N-CSR, N-CEN, 485BPOS, 497K) — Phase 2.
  queryFundFilings({ ticker, from = 0, size = 10 } = {}) {
    const query = {
      query: {
        query_string: {
          query: `ticker:"${ticker}" AND (formType:"N-PORT" OR formType:"N-CSR" OR formType:"N-CEN" OR formType:"485BPOS" OR formType:"497K")`,
        },
      },
      from,
      size,
    };
    return requestWithRetry("/", query);
  },
};

module.exports = Client;
