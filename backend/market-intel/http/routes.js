/**
 * Market Intelligence HTTP Routes
 * ===============================
 *
 * Provider-independent REST API endpoints. These routes know nothing about FMP
 * or any other provider — they delegate to the MarketIntelligenceService which
 * resolves the registered provider through the interface.
 *
 * No provider terminology (FMP, Finnhub, etc.) appears in route paths, query
 * params, or response bodies.
 *
 * @module market-intel/http/routes
 */

"use strict";

/**
 * @param {Object} app              Express app
 * @param {Object} deps
 * @param {import("../application/MarketIntelligenceService")} deps.service
 * @param {import("../application/AlertRulesEngine")} [deps.alertRules]
 * @param {import("../application/NotificationService")} [deps.notificationService]
 * @param {Function} deps.requireSignedIn
 * @param {Function} deps.attachActiveWorkspace
 * @param {Function} [deps.requireWorkspaceMember]
 * @param {Function} deps.apiError
 * @param {Function} deps.handleServerError
 */
function registerMarketIntelRoutes(app, deps = {}) {
  const {
    service,
    alertRules,
    notificationService,
    requireSignedIn,
    attachActiveWorkspace,
    requireWorkspaceMember = (_req, _res, next) => next(),
    apiError,
    handleServerError
  } = deps;

  const wrap = (fn) => async (req, res) => {
    try {
      const result = await fn(req, res);
      if (result !== undefined) return res.json(result);
    } catch (error) {
      if (error?.statusCode) {
        return apiError(res, error.statusCode, {
          error: error.message || "Market intelligence operation failed",
          code: error.code || "MARKET_INTEL_ERROR"
        });
      }
      return handleServerError(res, "Market intelligence operation failed", error);
    }
  };

  // -----------------------------------------------------------------------
  // Quote
  // -----------------------------------------------------------------------

  app.get("/api/market/quote", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.query;
    if (!symbol) {
      return { error: "symbol query parameter required", status: 400 };
    }
    const quote = await service.getQuote(symbol.toUpperCase());
    return { quote };
  }));

  app.post("/api/market/quotes", requireSignedIn, wrap(async (req) => {
    const { symbols } = req.body || {};
    if (!Array.isArray(symbols) || !symbols.length) {
      return { error: "symbols array required in body", status: 400 };
    }
    const quotes = await service.getQuotes(symbols.map((s) => String(s).toUpperCase()));
    return { quotes };
  }));

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  app.get("/api/market/search", requireSignedIn, wrap(async (req) => {
    const { q, limit = 10 } = req.query;
    if (!q) return { results: [] };
    const results = await service.searchCompanies(String(q), Number(limit));
    return { results };
  }));

  // -----------------------------------------------------------------------
  // Company
  // -----------------------------------------------------------------------

  app.get("/api/market/company/:symbol", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const profile = await service.getCompanyProfile(symbol.toUpperCase());
    return { company: profile };
  }));

  app.get("/api/market/company/:symbol/profile", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const profile = await service.getCompanyProfile(symbol.toUpperCase());
    return { profile };
  }));

  app.get("/api/market/company/:symbol/executives", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const executives = await service.getCompanyExecutives(symbol.toUpperCase());
    return { executives };
  }));

  // -----------------------------------------------------------------------
  // Historical Prices
  // -----------------------------------------------------------------------

  app.get("/api/market/history/:symbol", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { from, to, resolution = "daily" } = req.query;
    return service.getHistoricalPrices(symbol.toUpperCase(), { from, to, resolution });
  }));

  // -----------------------------------------------------------------------
  // Financial Statements
  // -----------------------------------------------------------------------

  app.get("/api/market/company/:symbol/income", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { period = "annual", limit = 5 } = req.query;
    const statements = await service.getIncomeStatements(symbol.toUpperCase(), period, Number(limit));
    return { statements };
  }));

  app.get("/api/market/company/:symbol/balance", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { period = "annual", limit = 5 } = req.query;
    const statements = await service.getBalanceSheets(symbol.toUpperCase(), period, Number(limit));
    return { statements };
  }));

  app.get("/api/market/company/:symbol/cashflow", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { period = "annual", limit = 5 } = req.query;
    const statements = await service.getCashFlowStatements(symbol.toUpperCase(), period, Number(limit));
    return { statements };
  }));

  app.get("/api/market/company/:symbol/ratios", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { period = "annual", limit = 5 } = req.query;
    const ratios = await service.getFinancialRatios(symbol.toUpperCase(), period, Number(limit));
    return { ratios };
  }));

  app.get("/api/market/company/:symbol/key-metrics", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { period = "annual", limit = 5 } = req.query;
    const metrics = await service.getKeyMetrics(symbol.toUpperCase(), period, Number(limit));
    return { metrics };
  }));

  // -----------------------------------------------------------------------
  // Earnings
  // -----------------------------------------------------------------------

  app.get("/api/market/earnings/:symbol", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { limit = 8 } = req.query;
    const earnings = await service.getEarnings(symbol.toUpperCase(), Number(limit));
    return { earnings };
  }));

  app.get("/api/market/earnings-calendar", requireSignedIn, wrap(async (req) => {
    const { from, to, symbol } = req.query;
    const entries = await service.getEarningsCalendar({ from, to, symbol });
    return { entries };
  }));

  // -----------------------------------------------------------------------
  // Dividends
  // -----------------------------------------------------------------------

  app.get("/api/market/dividends/:symbol", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const dividends = await service.getDividends(symbol.toUpperCase());
    return { dividends };
  }));

  app.get("/api/market/dividend-calendar", requireSignedIn, wrap(async (req) => {
    const { from, to } = req.query;
    const entries = await service.getDividendCalendar({ from, to });
    return { entries };
  }));

  // -----------------------------------------------------------------------
  // Insider Trading
  // -----------------------------------------------------------------------

  app.get("/api/market/insiders/:symbol", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const { limit = 20 } = req.query;
    const trades = await service.getInsiderTrading(symbol.toUpperCase(), Number(limit));
    return { trades };
  }));

  // -----------------------------------------------------------------------
  // Analyst Ratings
  // -----------------------------------------------------------------------

  app.get("/api/market/company/:symbol/analysts", requireSignedIn, wrap(async (req) => {
    const { symbol } = req.params;
    const rating = await service.getAnalystRatings(symbol.toUpperCase());
    return { rating };
  }));

  // -----------------------------------------------------------------------
  // News
  // -----------------------------------------------------------------------

  app.get("/api/market/news", requireSignedIn, wrap(async (req) => {
    const { symbol, limit = 20, offset = 0, category } = req.query;
    const articles = await service.getNews({ symbol, limit: Number(limit), offset: Number(offset), category });
    return { articles };
  }));

  // -----------------------------------------------------------------------
  // Market Status
  // -----------------------------------------------------------------------

  app.get("/api/market/status", requireSignedIn, wrap(async (req) => {
    const { exchange = "US" } = req.query;
    const status = await service.getMarketStatus(exchange);
    return { status };
  }));

  // -----------------------------------------------------------------------
  // Economic Calendar
  // -----------------------------------------------------------------------

  app.get("/api/market/economic-calendar", requireSignedIn, wrap(async (req) => {
    const { from, to, country } = req.query;
    const events = await service.getEconomicCalendar({ from, to, country });
    return { events };
  }));

  // -----------------------------------------------------------------------
  // Watchlists
  // -----------------------------------------------------------------------

  app.get("/api/market/watchlists", requireSignedIn, attachActiveWorkspace, wrap(async (req) => {
    const userId = req.auth?.userId;
    const workspaceId = req.workspace?.workspace?.id;
    return service.getWatchlists(userId, workspaceId);
  }));

  app.post("/api/market/watchlists", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, wrap(async (req) => {
    const userId = req.auth?.userId;
    const workspaceId = req.workspace?.workspace?.id;
    const { name, description } = req.body || {};
    const watchlist = await service.createWatchlist(userId, workspaceId, name, description);
    return { watchlist };
  }));

  app.delete("/api/market/watchlists/:id", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, wrap(async (req) => {
    await service.deleteWatchlist(req.params.id);
    return { success: true };
  }));

  app.get("/api/market/watchlists/:id/items", requireSignedIn, attachActiveWorkspace, wrap(async (req) => {
    return service.getWatchlistItems(req.params.id);
  }));

  app.post("/api/market/watchlists/:id/items", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, wrap(async (req) => {
    const { symbol, name, note, targetPrice } = req.body || {};
    const item = await service.addWatchlistItem(req.params.id, symbol, name, note, targetPrice);
    return { item };
  }));

  app.delete("/api/market/watchlists/:id/items/:symbol", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, wrap(async (req) => {
    await service.removeWatchlistItem(req.params.id, req.params.symbol);
    return { success: true };
  }));

  // -----------------------------------------------------------------------
  // Alert Rules
  // -----------------------------------------------------------------------

  if (alertRules) {
    app.get("/api/market/alerts", requireSignedIn, attachActiveWorkspace, wrap(async (req) => {
      const userId = req.auth?.userId;
      const workspaceId = req.workspace?.workspace?.id;
      const rules = await alertRules.getRules(userId, workspaceId);
      return { rules };
    }));

    app.post("/api/market/alerts", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, wrap(async (req) => {
      const userId = req.auth?.userId;
      const workspaceId = req.workspace?.workspace?.id;
      const rule = await alertRules.createRule(userId, workspaceId, req.body);
      return { rule };
    }));

    app.patch("/api/market/alerts/:id", requireSignedIn, attachActiveWorkspace, wrap(async (req) => {
      const userId = req.auth?.userId;
      const rule = await alertRules.updateRule(req.params.id, userId, req.body);
      return { rule };
    }));

    app.delete("/api/market/alerts/:id", requireSignedIn, attachActiveWorkspace, wrap(async (req) => {
      const userId = req.auth?.userId;
      await alertRules.deleteRule(req.params.id, userId);
      return { success: true };
    }));
  }

  // -----------------------------------------------------------------------
  // Notifications
  // -----------------------------------------------------------------------

  if (notificationService) {
    app.get("/api/market/notifications", requireSignedIn, attachActiveWorkspace, wrap(async (req) => {
      const userId = req.auth?.userId;
      const workspaceId = req.workspace?.workspace?.id;
      const { limit = 50 } = req.query;
      const notifications = await notificationService.getNotifications(userId, workspaceId, Number(limit));
      return { notifications };
    }));

    app.post("/api/market/notifications/:id/read", requireSignedIn, wrap(async (req) => {
      await notificationService.markRead(req.params.id);
      return { success: true };
    }));
  }

  // -----------------------------------------------------------------------
  // Public / Health
  // -----------------------------------------------------------------------

  app.get("/api/market/providers", requireSignedIn, wrap(async () => {
    // This is a simple pass-through — the registry/health info
    const healthy = await service.healthCheck();
    return { provider: healthy };
  }));

  return app;
}

module.exports = {
  registerMarketIntelRoutes
};
