// services/providers/DocumentIntelligenceProvider/routes.js
// Express routes for Document Intelligence. ARW calls these; the routes delegate
// to the provider facade (never to SEC directly). Honest empty payloads on
// unavailable data — no fabrication. Every response carries the normalized
// envelope: { provider, fetchedAt, freshness, sourceUrl, accessionNumber, data }.

const express = require("express");
const DocumentIntelligence = require("./Provider");

function router() {
  const r = express.Router();

  // GET /api/document/:ticker/company  → canonical company endpoint
  r.get("/:ticker/company", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getCompany(req.params.ticker)) });
  });
  // GET /api/document/company/:ticker  → legacy alias (compat)
  r.get("/company/:ticker", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getCompany(req.params.ticker)) });
  });

  // GET /api/document/:ticker/filings
  r.get("/:ticker/filings", async (req, res) => {
    const forms = req.query.forms ? String(req.query.forms).split(",").map((s) => s.trim()) : undefined;
    const opts = { forms, limit: req.query.limit ? Number(req.query.limit) : 20, cursor: req.query.cursor ? Number(req.query.cursor) : 0 };
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getFilings(req.params.ticker, opts)) });
  });

  // GET /api/document/:ticker/filings/:accessionNumber
  r.get("/:ticker/filings/:accessionNumber", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getFiling(req.params.ticker, req.params.accessionNumber)) });
  });

  // GET /api/document/:ticker/sections?accessionNumber=&sections=
  r.get("/:ticker/sections", async (req, res) => {
    const sections = req.query.sections ? String(req.query.sections).split(",").map((s) => s.trim()) : undefined;
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getSections(req.params.ticker, req.query.accessionNumber, sections)) });
  });

  // GET /api/document/:ticker/financials?accessionNumber=
  r.get("/:ticker/financials", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getFinancialStatements(req.params.ticker, req.query.accessionNumber)) });
  });

  // GET /api/document/:ticker/insiders
  r.get("/:ticker/insiders", async (req, res) => {
    const opts = { from: req.query.from, to: req.query.to, limit: req.query.limit ? Number(req.query.limit) : 20 };
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getInsiders(req.params.ticker, opts)) });
  });

  // GET /api/document/:ticker/ownership  (13F)
  r.get("/:ticker/ownership", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getInstitutionalOwnership(req.params.ticker)) });
  });

  // GET /api/document/:ticker/corporate-actions
  r.get("/:ticker/corporate-actions", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), corporateActions: (await DocumentIntelligence.getCorporateActions(req.params.ticker)).data });
  });

  // GET /api/document/:ticker/fund-filings
  r.get("/:ticker/fund-filings", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getFundFilings(req.params.ticker)) });
  });

  // GET /api/document/:ticker/fund-holdings  (Phase 2 — N-PORT)
  r.get("/:ticker/fund-holdings", async (req, res) => {
    res.json({ ticker: req.params.ticker.toUpperCase(), ...(await DocumentIntelligence.getFundHoldings(req.params.ticker)) });
  });

  return r;
}

function registerDocumentIntelligenceRoutes(app) {
  app.use("/api/document", router());
}

module.exports = { router, registerDocumentIntelligenceRoutes };
