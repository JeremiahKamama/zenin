/**
 * Zenin Admin — Coverage Registry service (backend).
 *
 * Exposes the Coverage Registry over /api/admin/coverage. This is the single
 * source of truth the admin UI consumes; the frontend seed (admin/src/coverageSeed.js)
 * is a graceful fallback only.
 *
 * Metadata-driven: all lists live in COVERAGE_SEED below. Edits persist to
 * data/coverage-overrides.json so provider status / priority / capability
 * changes survive restarts (additive — never orphans the seed).
 *
 * Africa is a first-class region (MyStocks Africa adapter).
 */
const express = require("express");
const fs = require("fs");
const path = require("path");

const OVERRIDES_PATH = path.join(__dirname, "data", "coverage-overrides.json");

const COVERAGE_SEED = {
  regions: ["Global", "Americas", "Europe", "Asia-Pacific", "Africa"],
  assetClasses: [
    "Equities", "ETFs", "Bonds", "Money Market Funds", "REITs",
    "Commodities", "FX", "Crypto", "Options", "Corporate Actions",
  ],
  providers: [
    { id: "massive", name: "Massive", status: "active", category: "Market Data", regions: ["Global", "Americas", "Europe", "Asia-Pacific", "Africa"], assetClasses: ["Equities", "ETFs", "Bonds", "FX", "Commodities", "Corporate Actions"], capabilities: ["quotes", "fundamentals", "breadth", "flows", "earnings"], priority: 1, note: "Primary global equities + fundamentals adapter." },
    { id: "fmp", name: "Financial Modeling Prep", status: "active", category: "Fundamentals", regions: ["Americas", "Europe", "Asia-Pacific"], assetClasses: ["Equities", "ETFs", "Bonds", "Options"], capabilities: ["fundamentals", "earnings", "ratios", "financials"], priority: 2, note: "Secondary fundamentals + estimates source." },
    { id: "yahoo", name: "Yahoo Finance", status: "active", category: "Market Data", regions: ["Global"], assetClasses: ["Equities", "ETFs", "FX", "Crypto", "Commodities"], capabilities: ["quotes", "history", "breadth"], priority: 3, note: "Fallback quote + history provider." },
    { id: "mystocks", name: "MyStocks Africa", status: "active", category: "Regional (Africa)", regions: ["Africa"], assetClasses: ["Equities", "Bonds", "Money Market Funds", "REITs", "Corporate Actions"], capabilities: ["quotes", "fundamentals", "dividends", "ipos", "corporateActions"], priority: 1, note: "Primary Africa equities, bonds, MMF, REITs, and corporate actions adapter." },
    { id: "finviz", name: "Finviz", status: "degraded", category: "Screener", regions: ["Americas"], assetClasses: ["Equities", "ETFs"], capabilities: ["screener", "breadth", "maps"], priority: 4, note: "US-centric screener + breadth; rate-limited." },
  ],
  markets: [
    { code: "US", name: "United States", region: "Americas", providers: ["massive", "fmp", "yahoo", "finviz"], assetClasses: ["Equities", "ETFs", "Bonds", "Options", "REITs"] },
    { code: "KE", name: "Kenya", region: "Africa", providers: ["mystocks"], assetClasses: ["Equities", "Bonds", "Money Market Funds", "REITs", "Corporate Actions"] },
    { code: "NG", name: "Nigeria", region: "Africa", providers: ["mystocks"], assetClasses: ["Equities", "Bonds", "Corporate Actions"] },
    { code: "ZA", name: "South Africa", region: "Africa", providers: ["mystocks", "massive"], assetClasses: ["Equities", "Bonds", "REITs", "ETFs"] },
    { code: "EG", name: "Egypt", region: "Africa", providers: ["mystocks"], assetClasses: ["Equities", "Bonds"] },
    { code: "GB", name: "United Kingdom", region: "Europe", providers: ["massive", "fmp"], assetClasses: ["Equities", "ETFs", "Bonds"] },
    { code: "DE", name: "Germany", region: "Europe", providers: ["massive", "fmp"], assetClasses: ["Equities", "ETFs", "Bonds"] },
    { code: "JP", name: "Japan", region: "Asia-Pacific", providers: ["massive", "yahoo"], assetClasses: ["Equities", "ETFs", "FX"] },
  ],
  exchanges: [
    { mic: "XNYS", name: "New York Stock Exchange", country: "US", region: "Americas", assetClasses: ["Equities", "ETFs"], status: "active" },
    { mic: "XNAS", name: "Nasdaq", country: "US", region: "Americas", assetClasses: ["Equities", "ETFs", "Options"], status: "active" },
    { mic: "XNSE", name: "Nairobi Securities Exchange", country: "KE", region: "Africa", assetClasses: ["Equities", "Bonds", "REITs"], status: "active" },
    { mic: "XGHA", name: "Ghana Stock Exchange", country: "GH", region: "Africa", assetClasses: ["Equities"], status: "planned" },
    { mic: "XGSE", name: "NGX (Nigeria Exchange)", country: "NG", region: "Africa", assetClasses: ["Equities", "Bonds"], status: "active" },
    { mic: "XJSE", name: "Johannesburg Stock Exchange", country: "ZA", region: "Africa", assetClasses: ["Equities", "Bonds", "REITs"], status: "active" },
    { mic: "XCAI", name: "Egyptian Exchange", country: "EG", region: "Africa", assetClasses: ["Equities", "Bonds"], status: "active" },
    { mic: "XLON", name: "London Stock Exchange", country: "GB", region: "Europe", assetClasses: ["Equities", "ETFs", "Bonds"], status: "active" },
    { mic: "XFRA", name: "Deutsche Börse", country: "DE", region: "Europe", assetClasses: ["Equities", "ETFs", "Bonds"], status: "active" },
    { mic: "XJPX", name: "Japan Exchange Group", country: "JP", region: "Asia-Pacific", assetClasses: ["Equities", "ETFs", "FX"], status: "active" },
  ],
  datasets: [
    { id: "market_breadth", name: "Market Breadth", provider: "massive", region: "Global", assetClass: "Equities", cadence: "intraday", status: "active" },
    { id: "equity_fundamentals", name: "Equity Fundamentals", provider: "fmp", region: "Americas", assetClass: "Equities", cadence: "daily", status: "active" },
    { id: "africa_quotes", name: "Africa Quotes", provider: "mystocks", region: "Africa", assetClass: "Equities", cadence: "realtime", status: "active" },
    { id: "africa_corporate_actions", name: "Africa Corporate Actions", provider: "mystocks", region: "Africa", assetClass: "Corporate Actions", cadence: "daily", status: "active" },
    { id: "dividend_calendar", name: "Dividend Calendar", provider: "mystocks", region: "Africa", assetClass: "Equities", cadence: "daily", status: "active" },
    { id: "ipo_pipeline", name: "IPO Pipeline", provider: "mystocks", region: "Africa", assetClass: "Equities", cadence: "daily", status: "active" },
    { id: "fx_rates", name: "FX Rates", provider: "yahoo", region: "Global", assetClass: "FX", cadence: "realtime", status: "active" },
    { id: "commodity_prices", name: "Commodity Prices", provider: "yahoo", region: "Global", assetClass: "Commodities", cadence: "realtime", status: "active" },
  ],
  mappings: [
    { internalId: "ZN-KE-0001", isin: "KE0000000001", figi: "BBG000000001", cusip: null, sedol: null, mic: "XNSE", ric: "SCOM.NR", ticker: "SCOM", name: "Safaricom PLC" },
    { internalId: "ZN-NG-0002", isin: "NG0000000002", figi: "BBG000000002", cusip: null, sedol: null, mic: "XGSE", ric: "DANGCEM.LG", ticker: "DANGCEM", name: "Dangote Cement" },
    { internalId: "ZN-ZA-0003", isin: "ZAE000000003", figi: "BBG000000003", cusip: null, sedol: "ZZ0000003", mic: "XJSE", ric: "NPN.JO", ticker: "NPN", name: "Naspers Ltd" },
    { internalId: "ZN-US-0004", isin: "US0378331005", figi: "BBG000B9XRY4", cusip: "037833100", sedol: "2046251", mic: "XNAS", ric: "AAPL.OQ", ticker: "AAPL", name: "Apple Inc" },
  ],
  apiHealth: [
    { provider: "massive", endpoint: "/v1/quotes", status: "healthy", latencyMs: 120, uptimePct: 99.9, lastCheck: new Date().toISOString() },
    { provider: "mystocks", endpoint: "/v1/africa/quotes", status: "healthy", latencyMs: 240, uptimePct: 99.2, lastCheck: new Date().toISOString() },
    { provider: "fmp", endpoint: "/v3/profile", status: "degraded", latencyMs: 880, uptimePct: 97.4, lastCheck: new Date().toISOString() },
    { provider: "finviz", endpoint: "/screener", status: "degraded", latencyMs: 1500, uptimePct: 91.0, lastCheck: new Date().toISOString() },
  ],
  syncJobs: [
    { id: "sync-africa-quotes", provider: "mystocks", dataset: "africa_quotes", status: "success", lastRun: new Date(Date.now() - 60000).toISOString(), durationMs: 4200, rows: 1840 },
    { id: "sync-us-fundamentals", provider: "fmp", dataset: "equity_fundamentals", status: "running", lastRun: new Date().toISOString(), durationMs: null, rows: null },
    { id: "sync-breadth", provider: "massive", dataset: "market_breadth", status: "failed", lastRun: new Date(Date.now() - 3600000).toISOString(), durationMs: 310, rows: 0 },
  ],
  auditLog: [
    { id: "aud-1", actor: "system", action: "provider.updated", target: "finviz", detail: "Seeded status degraded (rate-limit).", at: new Date(Date.now() - 86400000).toISOString() },
    { id: "aud-2", actor: "system", action: "market.added", target: "Egypt (EG)", detail: "Seeded EG market with MyStocks Africa provider.", at: new Date(Date.now() - 172800000).toISOString() },
    { id: "aud-3", actor: "system", action: "mapping.added", target: "ZN-KE-0001", detail: "Seeded Safaricom identifier cross-map.", at: new Date(Date.now() - 259200000).toISOString() },
  ],
};

const SECTIONS = ["regions", "assetClasses", "providers", "markets", "exchanges", "datasets", "mappings", "apiHealth", "syncJobs", "auditLog"];

function loadOverrides() {
  try {
    if (!fs.existsSync(OVERRIDES_PATH)) return { providerOverrides: {}, auditLog: [] };
    const raw = fs.readFileSync(OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { providerOverrides: parsed.providerOverrides || {}, auditLog: parsed.auditLog || [] };
  } catch {
    return { providerOverrides: {}, auditLog: [] };
  }
}

function persistOverrides(overrides) {
  try {
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2));
  } catch (err) {
    // Non-fatal: seed remains authoritative; overrides just won't persist.
    console.warn("[coverage] could not persist overrides:", err.message);
  }
}

function withOverrides() {
  const { providerOverrides, auditLog } = loadOverrides();
  const providers = COVERAGE_SEED.providers.map((p) => ({ ...p, ...(providerOverrides[p.id] || {}) }));
  const mergedAudit = [...auditLog, ...COVERAGE_SEED.auditLog];
  return { ...COVERAGE_SEED, providers, auditLog: mergedAudit };
}

/** Provider Priority Engine — pure, reused by the UI (admin/src/coverageSeed.js). */
function resolveProviderPriority({ region, assetClass, capability, providers = COVERAGE_SEED.providers }) {
  return providers
    .filter((p) => {
      if (region && region !== "Global" && !p.regions.includes(region) && !p.regions.includes("Global")) return false;
      if (assetClass && !p.assetClasses.includes(assetClass)) return false;
      if (capability && !p.capabilities.includes(capability)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Specialization tiebreak (non-Global only): a provider dedicated to exactly
      // this one region beats a multi-region global provider — e.g. MyStocks Africa
      // (regions: ["Africa"]) over Massive for Africa. Global region keeps priority order.
      if (region && region !== "Global") {
        const aDedicated = (a.regions || []).length === 1 && a.regions[0] === region;
        const bDedicated = (b.regions || []).length === 1 && b.regions[0] === region;
        if (aDedicated !== bDedicated) return aDedicated ? -1 : 1;
      }
      return 0;
    })
    .map((p) => ({ id: p.id, name: p.name, priority: p.priority, status: p.status }));
}

function buildRegistry() {
  const data = withOverrides();
  const africaMarkets = data.markets.filter((m) => m.region === "Africa").length;
  const activeProviders = data.providers.filter((p) => p.status === "active").length;
  const liveExchanges = data.exchanges.filter((e) => e.status === "active").length;
  const activeDatasets = data.datasets.filter((d) => d.status === "active").length;
  return {
    ...data,
    summary: {
      markets: data.markets.length,
      africaMarkets,
      providers: data.providers.length,
      activeProviders,
      exchanges: data.exchanges.length,
      liveExchanges,
      datasets: data.datasets.length,
      activeDatasets,
    },
  };
}

function createCoverageRouter() {
  const router = express.Router();

  router.get("/", (req, res) => {
    try {
      return res.json(buildRegistry());
    } catch (error) {
      return res.status(500).json({ error: "Failed to build coverage registry", detail: error.message });
    }
  });

  router.get("/priority", (req, res) => {
    try {
      const data = withOverrides();
      const result = resolveProviderPriority({
        region: req.query.region || undefined,
        assetClass: req.query.assetClass || undefined,
        capability: req.query.capability || undefined,
        providers: data.providers,
      });
      return res.json({ region: req.query.region || "Global", providers: result });
    } catch (error) {
      return res.status(500).json({ error: "Failed to resolve provider priority", detail: error.message });
    }
  });

  router.get("/:section", (req, res) => {
    try {
      const { section } = req.params;
      if (!SECTIONS.includes(section)) {
        return res.status(404).json({ error: `Unknown coverage section: ${section}` });
      }
      const data = withOverrides();
      return res.json({ [section]: data[section] });
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch coverage section", detail: error.message });
    }
  });

  router.get("/providers/:id", (req, res) => {
    try {
      const data = withOverrides();
      const provider = data.providers.find((p) => p.id === req.params.id);
      if (!provider) return res.status(404).json({ error: "Provider not found" });
      return res.json(provider);
    } catch (error) {
      return res.status(500).json({ error: "Failed to fetch provider", detail: error.message });
    }
  });

  // Mutate provider status / priority / capabilities. Writes an audit entry.
  router.patch("/providers/:id", (req, res) => {
    try {
      const { id } = req.params;
      const seed = COVERAGE_SEED.providers.find((p) => p.id === id);
      if (!seed) return res.status(404).json({ error: "Provider not found" });

      const { status, priority, capabilities, note } = req.body || {};
      const overrides = loadOverrides();
      const current = overrides.providerOverrides[id] || {};
      const next = { ...current };
      if (status !== undefined) next.status = status;
      if (priority !== undefined) next.priority = Number(priority);
      if (Array.isArray(capabilities)) next.capabilities = capabilities;
      if (note !== undefined) next.note = note;
      overrides.providerOverrides[id] = next;

      const actor = (req.auth && (req.auth.email || req.auth.userId)) || "admin";
      const changes = [];
      if (status !== undefined) changes.push(`status=${status}`);
      if (priority !== undefined) changes.push(`priority=${priority}`);
      if (Array.isArray(capabilities)) changes.push(`capabilities=${capabilities.join(",")}`);
      overrides.auditLog.unshift({
        id: `aud-${Date.now()}`,
        actor,
        action: "provider.updated",
        target: id,
        detail: `Updated ${changes.join(", ")}.`,
        at: new Date().toISOString(),
      });
      persistOverrides(overrides);

      const data = withOverrides();
      return res.json(data.providers.find((p) => p.id === id));
    } catch (error) {
      return res.status(500).json({ error: "Failed to update provider", detail: error.message });
    }
  });

  // Append an audit entry (e.g. market/region added from the UI).
  router.post("/audit", (req, res) => {
    try {
      const { action, target, detail } = req.body || {};
      if (!action || !target) return res.status(400).json({ error: "action and target are required" });
      const overrides = loadOverrides();
      const actor = (req.auth && (req.auth.email || req.auth.userId)) || "admin";
      const entry = { id: `aud-${Date.now()}`, actor, action, target, detail: detail || "", at: new Date().toISOString() };
      overrides.auditLog.unshift(entry);
      persistOverrides(overrides);
      return res.status(201).json(entry);
    } catch (error) {
      return res.status(500).json({ error: "Failed to append audit entry", detail: error.message });
    }
  });

  return router;
}

module.exports = { createCoverageRouter, resolveProviderPriority, COVERAGE_SEED };
