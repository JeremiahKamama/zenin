/**
 * Financial Modeling Prep Provider Adapter
 * ========================================
 *
 * Implements the MarketDataProvider interface for FMP. This is the SINGLE point
 * where FMP API calls are made and FMP DTOs are turned into Zenin domain models.
 *
 * Contract responsibilities:
 *   - Implement every MarketDataProvider method with provider-independent I/O
 *   - Wrap every HTTP call in withFmpErrors() so no vendor exception leaks
 *   - Map every response via mappers.js so no raw DTO escapes
 *
 * @module market-intel/providers/financial-modeling-prep/FmpProvider
 */

"use strict";

const { withFmpErrors } = require("./errors");
const { fmpGet, resolveConfig, isConfigured } = require("./client");
const mappers = require("./mappers");
const { CACHE_TTL } = require("../../infrastructure/cache");

/**
 * Create the FMP market data provider adapter.
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 * @returns {import("../../domain/MarketDataProvider").MarketDataProvider}
 */
function createFmpProvider(options = {}) {
  const env = options.env || process.env;

  return {
    providerKey: "fmp",
    displayName: "Financial Modeling Prep",

    // ---- Quote ----

    async getQuote(request) {
      return withFmpErrors(async () => {
        const data = await fmpGet(`/quote/${request.symbol}`);
        const arr = Array.isArray(data) ? data : [data];
        if (!arr.length) {
          const { MarketDataNotAvailableError } = require("../../domain/errors");
          throw new MarketDataNotAvailableError(request.symbol);
        }
        return mappers.mapQuote(arr[0]);
      }, `getQuote(${request.symbol})`);
    },

    async getQuotes(request) {
      return withFmpErrors(async () => {
        const symbols = request.symbols.join(",");
        const data = await fmpGet(`/quote/${symbols}`);
        const arr = Array.isArray(data) ? data : [data];
        return arr.map(mappers.mapQuote).filter((q) => q.symbol);
      }, `getQuotes(${request.symbols.length} symbols)`);
    },

    // ---- Search ----

    async searchCompanies(request) {
      return withFmpErrors(async () => {
        const data = await fmpGet("/search", {
          query: request.query,
          limit: String(request.limit || 10),
          exchange: request.exchange || ""
        });
        const arr = Array.isArray(data) ? data : [];
        return arr.slice(0, request.limit || 10).map(mappers.mapSearchResult);
      }, `searchCompanies(${request.query})`);
    },

    // ---- Company Profile ----

    async getCompanyProfile(symbol) {
      return withFmpErrors(async () => {
        const data = await fmpGet(`/profile/${symbol}`);
        const arr = Array.isArray(data) ? data : [data];
        if (!arr.length) {
          const { MarketDataNotAvailableError } = require("../../domain/errors");
          throw new MarketDataNotAvailableError(symbol);
        }
        return mappers.mapCompanyProfile(arr[0]);
      }, `getCompanyProfile(${symbol})`);
    },

    // ---- Historical Prices ----

    async getHistoricalPrices(request) {
      return withFmpErrors(async () => {
        const resolution = request.resolution || "daily";

        // Map resolution to FMP endpoint
        let endpoint;
        if (["1min", "5min", "15min", "30min", "1hour", "4hour"].includes(resolution)) {
          // Intraday chart endpoint (v3)
          const data = await fmpGet(`/historical-chart/${resolution}/${request.symbol}`, {
            from: request.from || "",
            to: request.to || ""
          });
          return mappers.mapHistoricalPrices(
            { historical: Array.isArray(data) ? data : [] },
            request
          );
        }

        // Daily chart endpoint
        const data = await fmpGet(`/historical-price-full/${request.symbol}`, {
          from: request.from || "",
          to: request.to || ""
        });

        const result = {
          symbol: data?.symbol || request.symbol,
          historical: Array.isArray(data?.historical) ? data.historical : []
        };
        return mappers.mapHistoricalPrices(result, request);
      }, `getHistoricalPrices(${request.symbol})`);
    },

    // ---- News ----

    async getNews(request = {}) {
      return withFmpErrors(async () => {
        const limit = request.limit || 20;

        if (request.symbol) {
          // Stock-specific news (v3)
          const data = await fmpGet("/stock_news", {
            tickers: request.symbol,
            limit: String(limit)
          });
          const arr = Array.isArray(data) ? data : [];
          return arr.map((d) => mappers.mapNewsArticle(d, "company"));
        }

        // General market news (v4)
        const data = await fmpGet("/news", {
          limit: String(limit),
          page: String(Math.floor((request.offset || 0) / limit))
        }, { v4: true });
        const arr = Array.isArray(data) ? data : [];
        return arr.map((d) => mappers.mapNewsArticle(d, "market"));
      }, "getNews");
    },

    // ---- Financial Statements ----

    async getIncomeStatements(request) {
      return withFmpErrors(async () => {
        const period = request.period === "quarter" ? "quarter" : "annual";
        const limit = request.limit || 5;
        const data = await fmpGet(`/income-statement/${request.symbol}`, {
          period,
          limit: String(limit)
        });
        const arr = Array.isArray(data) ? data : [];
        return arr.map(mappers.mapIncomeStatement);
      }, `getIncomeStatements(${request.symbol})`);
    },

    async getBalanceSheets(request) {
      return withFmpErrors(async () => {
        const period = request.period === "quarter" ? "quarter" : "annual";
        const limit = request.limit || 5;
        const data = await fmpGet(`/balance-sheet-statement/${request.symbol}`, {
          period,
          limit: String(limit)
        });
        const arr = Array.isArray(data) ? data : [];
        return arr.map(mappers.mapBalanceSheet);
      }, `getBalanceSheets(${request.symbol})`);
    },

    async getCashFlowStatements(request) {
      return withFmpErrors(async () => {
        const period = request.period === "quarter" ? "quarter" : "annual";
        const limit = request.limit || 5;
        const data = await fmpGet(`/cash-flow-statement/${request.symbol}`, {
          period,
          limit: String(limit)
        });
        const arr = Array.isArray(data) ? data : [];
        return arr.map(mappers.mapCashFlowStatement);
      }, `getCashFlowStatements(${request.symbol})`);
    },

    async getFinancialRatios(request) {
      return withFmpErrors(async () => {
        const period = request.period === "quarter" ? "quarter" : "annual";
        const limit = request.limit || 5;
        const data = await fmpGet(`/ratios-ttm/${request.symbol}`, { limit: String(limit) });
        // ratios-ttm returns array of TTM ratios; period filtering isn't meaningful for TTM
        let arr = Array.isArray(data) ? data : [];
        if (!arr.length) {
          // Fallback to regular ratios endpoint
          const fallback = await fmpGet(`/ratios/${request.symbol}`, {
            period,
            limit: String(limit)
          });
          arr = Array.isArray(fallback) ? fallback : [];
        }
        return arr.map(mappers.mapFinancialRatios);
      }, `getFinancialRatios(${request.symbol})`);
    },

    async getKeyMetrics(request) {
      return withFmpErrors(async () => {
        const period = request.period === "quarter" ? "quarter" : "annual";
        const limit = request.limit || 5;
        const data = await fmpGet(`/key-metrics-ttm/${request.symbol}`, { limit: String(limit) });
        let arr = Array.isArray(data) ? data : [];
        if (!arr.length) {
          const fallback = await fmpGet(`/key-metrics/${request.symbol}`, {
            period,
            limit: String(limit)
          });
          arr = Array.isArray(fallback) ? fallback : [];
        }
        return arr.map(mappers.mapKeyMetrics);
      }, `getKeyMetrics(${request.symbol})`);
    },

    // ---- Earnings ----

    async getEarnings(request) {
      return withFmpErrors(async () => {
        const data = await fmpGet(`/earnings-surprises/${request.symbol}`);
        const arr = Array.isArray(data) ? data : [];
        const limit = request.limit || arr.length;
        return arr.slice(0, limit).map(mappers.mapEarningsEvent);
      }, `getEarnings(${request.symbol})`);
    },

    async getEarningsCalendar(request = {}) {
      return withFmpErrors(async () => {
        const params = {};
        if (request.from) params.from = request.from;
        if (request.to) params.to = request.to;
        if (request.symbol) params.symbol = request.symbol;

        const data = await fmpGet("/earning_calendar", params);
        const arr = Array.isArray(data) ? data : [];
        return arr.map(mappers.mapEarningsCalendarEntry);
      }, "getEarningsCalendar");
    },

    // ---- Dividends ----

    async getDividends(request) {
      return withFmpErrors(async () => {
        const data = await fmpGet(`/historical-price-full/stock_dividend/${request.symbol}`);
        const historical = data?.historical || (Array.isArray(data) ? data : []);
        const arr = Array.isArray(historical) ? historical : [];
        return arr.map(mappers.mapDividendRecord);
      }, `getDividends(${request.symbol})`);
    },

    async getDividendCalendar(request = {}) {
      return withFmpErrors(async () => {
        const params = {};
        if (request.from) params.from = request.from;
        if (request.to) params.to = request.to;
        const data = await fmpGet("/stock_dividend_calendar", params);
        const arr = Array.isArray(data) ? data : [];
        return arr.map(mappers.mapDividendCalendarEntry);
      }, "getDividendCalendar");
    },

    // ---- Insider Trading ----

    async getInsiderTrading(request) {
      return withFmpErrors(async () => {
        const data = await fmpGet("/insider-trading", {
          symbol: request.symbol,
          limit: String(request.limit || 20)
        });
        const arr = Array.isArray(data) ? data : [];
        return arr.map(mappers.mapInsiderTrade);
      }, `getInsiderTrading(${request.symbol})`);
    },

    // ---- Analyst Ratings ----

    async getAnalystRatings(symbol) {
      return withFmpErrors(async () => {
        // Fetch analyst estimates + recommendations in parallel
        const [estimatesRaw, recsRaw] = await Promise.all([
          fmpGet(`/analyst-estimates/${symbol}`).catch(() => []),
          fmpGet("/analyst-stock-recommendations", { symbol, limit: "5" }).catch(() => [])
        ]);

        const estimates = Array.isArray(estimatesRaw) ? estimatesRaw[0] : estimatesRaw || {};
        const recs = Array.isArray(recsRaw) ? recsRaw[0] : recsRaw || {};

        return mappers.mapAnalystRating({
          ...estimates,
          ...recs,
          symbol
        });
      }, `getAnalystRatings(${symbol})`);
    },

    // ---- Market Status ----

    async getMarketStatus(exchange = "US") {
      return withFmpErrors(async () => {
        const data = await fmpGet("/is-the-market-open");
        return mappers.mapMarketStatus(data, exchange);
      }, "getMarketStatus");
    },

    // ---- Economic Calendar ----

    async getEconomicCalendar(request = {}) {
      return withFmpErrors(async () => {
        const params = {};
        if (request.from) params.from = request.from;
        if (request.to) params.to = request.to;
        // FMP v3 economic calendar endpoint
        const data = await fmpGet("/economic_calendar", params);
        const arr = Array.isArray(data) ? data : [];
        return arr.map(mappers.mapEconomicEvent);
      }, "getEconomicCalendar");
    },

    // ---- Executives ----

    async getCompanyExecutives(symbol) {
      return withFmpErrors(async () => {
        const data = await fmpGet("/key-executives/" + symbol);
        const arr = Array.isArray(data) ? data : [];
        return arr.map((d) => mappers.mapExecutive(d, symbol));
      }, `getCompanyExecutives(${symbol})`);
    },

    // ---- Health ----

    async healthCheck() {
      const start = Date.now();
      try {
        await fmpGet("/quote/AAPL", {}, {});
        return {
          status: "healthy",
          latencyMs: Date.now() - start,
          checkedAt: new Date().toISOString()
        };
      } catch (err) {
        // Determine degradation level
        const msg = err?.message || "";
        let status = "unhealthy";
        if (/rate.?limit/i.test(msg)) status = "degraded";

        return {
          status,
          latencyMs: Date.now() - start,
          message: msg.slice(0, 200),
          checkedAt: new Date().toISOString()
        };
      }
    }
  };
}

module.exports = {
  createFmpProvider,
  isConfigured
};
