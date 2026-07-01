"use strict";

const crypto = require("crypto");

/**
 * Build a comparable hash for the legacy response (matches existing frontend logic).
 */
function buildResponseHash(payload, ignoredKeys = new Set([
  "updatedAt", "stale", "unavailable", "stale_reason",
  "cache_updated_at", "stale_age_seconds", "companyProfileHash",
  "snapshotCheckedAt", "unchanged", "metadata", "tryLater", "statusMessage"
])) {
  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
          if (ignoredKeys.has(key)) return acc;
          acc[key] = normalize(value[key]);
          return acc;
        }, {});
    }
    return value ?? null;
  }
  const normalized = normalize(payload);
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Register company profile routes on the Express app.
 *
 * @param {Object} app - Express app
 * @param {Object} service - CompanyProfileService instance
 * @param {Object} deps - Catalog enrichment helpers from the host app
 * @param {Function} deps.selectPrimaryStockCatalogEntry
 * @param {Function} deps.buildStockPeers
 * @param {Function} deps.buildManufacturingNotes
 */
function registerCompanyProfileRoutes(app, service, deps = {}) {
  const {
    selectPrimaryStockCatalogEntry = () => null,
    buildStockPeers = () => [],
    buildManufacturingNotes = () => ({
      factoryFootprint: [],
      efficiencySignals: [],
      customerFulfillment: [],
      inputExposure: []
    })
  } = deps;

  if (typeof service.getProfile !== "function") {
    console.warn("[company-profile] Service not ready; routes will not be registered.");
    return;
  }

  // Attach catalog enrichment so the service can build the legacy response shape.
  service.catalogEnricher = (symbol, theme, category) => {
    const stockMeta = selectPrimaryStockCatalogEntry(symbol, { theme, category });
    return {
      catalog: {
        theme: stockMeta?.theme || null,
        category: stockMeta?.category || null,
        role: stockMeta?.role || null,
        edge: stockMeta?.edge || null,
        market: stockMeta?.market || null
      },
      peers: buildStockPeers(symbol, stockMeta),
      manufacturing: buildManufacturingNotes({}, stockMeta)
    };
  };

  app.get("/api/company-profile", async (req, res) => {
    const { symbol, theme, category, snapshotHash } = req.query;

    if (!symbol || typeof symbol !== "string") {
      return res.status(400).json({ error: "symbol required" });
    }

    try {
      const payload = await service.getProfile(symbol, { theme, category });
      const responseHash = buildResponseHash(payload);
      const response = {
        ...payload,
        companyProfileHash: responseHash,
        snapshotCheckedAt: new Date().toISOString()
      };

      if (snapshotHash && String(snapshotHash) === responseHash) {
        return res.json({
          ...response,
          unchanged: true
        });
      }

      return res.json(response);
    } catch (err) {
      req.log?.warn?.({ err, symbol }, "Company profile fetch failed");
      return res.status(503).json({
        error: err.message || "Failed to fetch company profile",
        unavailable: true
      });
    }
  });

  app.get("/api/company-profile/health", (_req, res) => {
    res.json(service.stats());
  });
}

module.exports = { registerCompanyProfileRoutes, buildResponseHash };
