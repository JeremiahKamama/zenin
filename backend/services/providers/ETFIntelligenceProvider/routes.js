// services/providers/ETFIntelligenceProvider/routes.js
// Express routes for ETF Intelligence. ARW calls these; routes delegate to the
// provider facade (never to the scraper directly). Honest empty payloads on
// unavailable data — no fabrication.

const express = require("express");
const ETFIntelligence = require("./Provider");
const { createEtfDataProvider, compareEtfs, calculateEtfPortfolioOverlap } = require("./ETFdbApiProvider");

// The package-backed adapter (inert until ETF_INTELLIGENCE_ETFDB_API_ENABLED).
const apiProvider = createEtfDataProvider();

function router() {
  const r = express.Router();
  const sym = (req) => (req.query.symbol || req.query.ticker || "").toUpperCase();
  const payload = (symbol, data, key = null) => ({
    symbol,
    available: key ? Boolean(data?.[key]) : Boolean(data),
    provider: ETFIntelligence.providerId,
    ...(data || {}),
  });

  r.get("/profile", async (req, res) => { res.json(payload(sym(req), await ETFIntelligence.getProfile(sym(req)))); });
  r.get("/composition", async (req, res) => { res.json(payload(sym(req), await ETFIntelligence.getComposition(sym(req)))); });
  r.get("/classification", async (req, res) => { res.json(payload(sym(req), await ETFIntelligence.getClassification(sym(req)))); });
  r.get("/strategy", async (req, res) => { res.json(payload(sym(req), await ETFIntelligence.getStrategy(sym(req)))); });
  r.get("/peers", async (req, res) => {
    const peers = await ETFIntelligence.getPeers(sym(req));
    res.json({ symbol: sym(req), available: peers.length > 0, provider: ETFIntelligence.providerId, peers });
  });
  r.get("/themes", async (req, res) => {
    const themes = await ETFIntelligence.getThemes(sym(req));
    res.json({ symbol: sym(req), available: themes.length > 0, provider: ETFIntelligence.providerId, themes });
  });

  // ── ETFdb API adapter routes (extend, do not replace legacy aliases) ──────
  // All return honest { available, freshness, provider } even when the adapter
  // is inert (ETF_INTELLIGENCE_ETFDB_API_ENABLED=false → freshness:"unavailable").

  r.get("/search", async (req, res) => {
    const query = String(req.query.q || req.query.query || "").trim();
    const filters = {
      assetClass: req.query.assetClass || undefined,
      issuer: req.query.issuer || undefined,
      category: req.query.category || undefined,
    };
    const page = Number(req.query.page || 1) || 1;
    const sort = req.query.sort || undefined;
    try {
      const result = await apiProvider.search({ query, filters, page, sort });
      res.json({ ...result, provider: apiProvider.providerId });
    } catch {
      res.json({ query, results: [], available: false, provider: apiProvider.providerId, freshness: "unavailable" });
    }
  });

  r.get("/:symbol/overview", async (req, res) => {
    const out = await apiProvider.getOverview(req.params.symbol);
    res.json(out);
  });
  r.get("/:symbol/composition", async (req, res) => {
    const out = await apiProvider.getComposition(req.params.symbol);
    res.json(out);
  });
  r.get("/:symbol/metrics", async (req, res) => {
    const out = await apiProvider.getMetrics(req.params.symbol);
    res.json(out);
  });
  r.get("/:symbol/flows", async (req, res) => {
    const out = await apiProvider.getFlows(req.params.symbol);
    res.json(out);
  });
  r.get("/:symbol/distributions", async (req, res) => {
    const out = await apiProvider.getOverview(req.params.symbol);
    res.json({
      symbol: out.symbol,
      distributionFrequency: out.fund?.distributionFrequency ?? null,
      dividendYieldPct: out.fund?.dividendYieldPct ?? null,
      available: out.available,
      freshness: out.freshness,
      provider: apiProvider.providerId,
    });
  });

  r.post("/compare", express.json(), async (req, res) => {
    const out = await apiProvider.compare({ symbols: req.body?.symbols || [] });
    res.json({ ...out, provider: apiProvider.providerId });
  });

  r.post("/overlap", express.json(), async (req, res) => {
    const out = calculateEtfPortfolioOverlap({
      etfSymbol: req.body?.etfSymbol,
      portfolio: req.body?.portfolio || [],
    });
    res.json({ ...out, provider: apiProvider.providerId });
  });

  return r;
}

function registerETFIntelligenceRoutes(app) {
  app.use("/api/etf", router());
}

module.exports = { router, registerETFIntelligenceRoutes };
