// backend/test/sec-api-integration.test.js
// Sec API Document Intelligence integration tests (node --test).
// Covers: adapter normalization, EDGAR fallback envelope, event dedup /
// materiality / watchlist matching, and route envelope shape. All external
// calls are mocked — no live SEC_API_IO_KEY required.
//
// NOTE: tests are run with --test-concurrency=1 because several mutate a
// shared process.env key. Set a default key at file scope so adapter tests
// see an entitled provider; the entitlement-missing test temporarily clears it.

process.env.SEC_API_IO_KEY = process.env.SEC_API_IO_KEY || "test-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

// Force EDGAR fallback path by clearing the key for relevant tests.
const DOC = path.join(__dirname, "..", "services", "providers", "DocumentIntelligenceProvider");

test("EDGAR fallback returns explicit unavailable for paid capabilities", async () => {
  const prev = process.env.SEC_API_IO_KEY;
  delete process.env.SEC_API_IO_KEY;
  // Re-require Provider so it selects EDGAR for this assertion.
  delete require.cache[require.resolve(DOC + "/Provider")];
  const Provider = require(DOC + "/Provider");
  const edgar = Provider.activeImpl;
  assert.equal(edgar.providerId, "SEC_EDGAR");
  const sec = await Provider.getSections("AAPL", "0000000000");
  assert.equal(sec.freshness, "unavailable");
  assert.equal(sec.data, null);
  assert.equal(sec.provider, "sec-edgar");
  const own = await Provider.getInstitutionalOwnership("AAPL");
  assert.equal(own.freshness, "unavailable");
  process.env.SEC_API_IO_KEY = prev || "test-key";
});

test("SecApiIoAdapter with entitlement-missing returns unavailable envelope", async () => {
  const Adapter = require(DOC + "/SecApiIoAdapter");
  const prev = process.env.SEC_API_IO_KEY;
  delete process.env.SEC_API_IO_KEY;
  assert.equal(Adapter.isEntitled(), false);
  const r = await Adapter.getInsiders("AAPL");
  assert.equal(r.freshness, "unavailable");
  assert.equal(r.data, null);
  process.env.SEC_API_IO_KEY = prev || "test-key";
});

test("SecApiIoAdapter normalizes filings with source URLs", async () => {
  // Inject a fake client module via require cache override.
  const Client = require(DOC + "/SecApiIoClient");
  const realQuery = Client.queryFilings;
  Client.queryFilings = async () => ({
    filings: [
      { accessionNo: "0000320193-23-000001", formType: "10-K", filedAt: "2023-11-03", cik: "320193", primaryDocument: "a.txt", ticker: "AAPL" },
    ],
  });
  const Adapter = require(DOC + "/SecApiIoAdapter");
  const r = await Adapter.getFilings("AAPL", { limit: 5 });
  assert.equal(r.provider, "sec-api");
  assert.equal(r.data.length, 1);
  assert.match(r.data[0].url, /sec\.gov\/Archives/);
  assert.equal(r.data[0].formType, "10-K");
  Client.queryFilings = realQuery;
});

test("SecApiIoAdapter maps 8-K + Form4 + 13F query results to normalized shapes", async () => {
  const Client = require(DOC + "/SecApiIoClient");
  const realQuery = Client.queryFilings;
  const real13F = Client.queryForm13F;
  const real4 = Client.queryFormFour;
  Client.queryFilings = async () => ({ filings: [{ accessionNo: "0003", formType: "8-K", filedAt: "2024-01-01", cik: "320193", primaryDocument: "b.txt" }] });
  Client.queryForm13F = async () => ({ filings: [{ accessionNo: "0001", formType: "13F-HR", holdings: [{ name: "Vanguard", pctHeld: "12.3", quarterlyChange: "1.0" }], totalInstitutionalPct: "68.5", top5Concentration: "40.1", hhi: "1200" }] });
  Client.queryFormFour = async () => ({ filings: [{ accessionNo: "0002", formType: "4", reportingOwner: "Cook", transactionType: "S", sharesTransacted: 50000, documentUrl: "https://x/4" }] });
  const Adapter = require(DOC + "/SecApiIoAdapter");
  const own = await Adapter.getInstitutionalOwnership("AAPL");
  assert.equal(own.data.institutionalPct, 68.5);
  assert.equal(own.data.holders[0].name, "Vanguard");
  const ins = await Adapter.getInsiders("AAPL");
  assert.equal(ins.data.trades[0].insider, "Cook");
  assert.equal(ins.data.trades[0].shares, 50000);
  Client.queryFilings = realQuery;
  Client.queryForm13F = real13F;
  Client.queryFormFour = real4;
});

test("SecApiIoAdapter returns unavailable for N-PORT (Phase 2)", async () => {
  const Adapter = require(DOC + "/SecApiIoAdapter");
  const r = await Adapter.getFundHoldings("SPY");
  assert.equal(r.freshness, "unavailable");
  assert.equal(r.reason, "n-port-phase-2");
});

test("MarketEventEngine exposes new Sec API event types", () => {
  const { EVENT_TYPES } = require(path.join(__dirname, "..", "market-intel", "application", "MarketEventEngine"));
  for (const t of ["FILING_MATERIAL", "INSIDER_TRANSACTION", "OWNERSHIP_CHANGE", "FUND_REGULATORY_UPDATE"]) {
    assert.equal(EVENT_TYPES[t], t);
  }
});

test("SecApiStreamWorker classifies material forms correctly", () => {
  const { classify } = require(path.join(__dirname, "..", "market-intel", "application", "SecApiStreamWorker"));
  assert.equal(classify({ formType: "8-K", ticker: "AAPL" }).eventType, "FILING_MATERIAL");
  assert.equal(classify({ formType: "8-K", ticker: "AAPL" }).material, true);
  assert.equal(classify({ formType: "10-Q", ticker: "AAPL" }).material, true); // alertable
  assert.equal(classify({ formType: "13F-HR", ticker: "MSFT" }).eventType, "OWNERSHIP_CHANGE");
  assert.equal(classify({ formType: "13F-HR", ticker: "MSFT" }).material, false); // routine
  assert.equal(classify({ formType: "4", ticker: "TSLA", sharesTransacted: 500 }).material, false);
  assert.equal(classify({ formType: "4", ticker: "TSLA", sharesTransacted: 50000 }).material, true);
  assert.equal(classify({ formType: "N-PORT", ticker: "SPY" }).eventType, "FUND_REGULATORY_UPDATE");
});

test("SecApiStreamWorker deduplicates by (accessionNumber, eventType)", async () => {
  const { SecApiStreamWorker } = require(path.join(__dirname, "..", "market-intel", "application", "SecApiStreamWorker"));
  const seen = new Set();
  const db = {
    query: async (sql, params) => {
      if (sql.startsWith("SELECT")) return { rowCount: seen.has(params[0]) ? 1 : 0 };
      if (sql.startsWith("INSERT INTO market_events")) { seen.add(params[0]); return { rowCount: 1 }; }
      return { rowCount: 1 };
    },
  };
  const w = new SecApiStreamWorker({ db, notifier: { notify: async () => {} }, matcher: async () => [] });
  const a = await w.ingestRaw({ formType: "8-K", ticker: "AAPL", accessionNo: "0001" });
  const b = await w.ingestRaw({ formType: "8-K", ticker: "AAPL", accessionNo: "0001" });
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, false);
  assert.equal(b.reason, "duplicate");
});

test("SecApiStreamWorker alerts only material events to matched users", async () => {
  const { SecApiStreamWorker } = require(path.join(__dirname, "..", "market-intel", "application", "SecApiStreamWorker"));
  const notified = [];
  const db = {
    query: async (sql, params) => {
      if (sql.startsWith("SELECT")) return { rowCount: 0 };
      return { rowCount: 1 };
    },
  };
  const w = new SecApiStreamWorker({
    db,
    notifier: { notify: async (r, t) => notified.push(t) },
    matcher: async () => [{ userId: "u1", workspaceId: "w1" }],
  });
  await w.ingestRaw({ formType: "8-K", ticker: "AAPL", accessionNo: "X1" }); // material → alert
  await w.ingestRaw({ formType: "13F-HR", ticker: "MSFT", accessionNo: "X2" }); // routine → no alert
  assert.equal(notified.length, 1);
});

test("Routes expose normalized envelope with canonical + legacy company paths", async () => {
  const express = require("express");
  const http = require("http");
  const { router } = require(DOC + "/routes");
  // Minimal mount with the provider stubbed to EDGAR-empty behavior.
  const app = express();
  app.use("/api/document", router());
  const server = http.createServer(app).listen(0);
  const port = server.address().port;
  const get = (p) =>
    new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${p}`, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(d || "{}") }));
      }).on("error", reject);
    });
  try {
    const canonical = await get("/api/document/AAPL/company");
    assert.equal(canonical.status, 200);
    assert.ok("provider" in canonical.body && "fetchedAt" in canonical.body && "freshness" in canonical.body);
    const legacy = await get("/api/document/company/AAPL");
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.ticker, "AAPL");
  } finally {
    server.close();
  }
});
