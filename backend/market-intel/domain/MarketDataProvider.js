/**
 * MarketDataProvider Interface (Domain Contract)
 * ==============================================
 *
 * The port that every market data provider adapter implements. The application
 * layer depends on this contract — never on a concrete provider SDK or DTO.
 *
 * Adapters translate provider responses into domain models from `./models`
 * and surface provider-independent errors from `./errors`.
 *
 * Adding a new provider:
 *   1. Implement all methods below in providers/<name>/
 *   2. Map all DTOs to domain models via dedicated mappers
 *   3. Never expose provider DTOs, URLs, auth details, or raw responses
 *
 * @interface MarketDataProvider
 * @module market-intel/domain/MarketDataProvider
 */

"use strict";

/**
 * @typedef {Object} QuoteRequest
 * @property {string} symbol
 * @property {string} [currency]
 */

/**
 * @typedef {Object} BatchQuoteRequest
 * @property {string[]} symbols
 */

/**
 * @typedef {Object} HistoricalPricesRequest
 * @property {string} symbol
 * @property {string} [from]              YYYY-MM-DD
 * @property {string} [to]               YYYY-MM-DD
 * @property {"1min"|"5min"|"15min"|"30min"|"1hour"|"4hour"|"daily"|"weekly"|"monthly"} [resolution="daily"]
 */

/**
 * @typedef {Object} SearchRequest
 * @property {string} query
 * @property {number} [limit=10]
 * @property {string} [exchange]
 */

/**
 * @typedef {Object} NewsRequest
 * @property {string} [symbol]           Single symbol filter
 * @property {string[]} [symbols]         Multiple symbol filter
 * @property {number} [limit=20]
 * @property {number} [offset=0]
 * @property {string} [from]             YYYY-MM-DD
 * @property {string} [to]               YYYY-MM-DD
 * @property {string} [category]         "general" | "company" | "sector" | "market"
 */

/**
 * @typedef {Object} EarningsRequest
 * @property {string} symbol
 * @property {string} [period]           "annual" | "quarter"
 * @property {number} [limit=8]
 */

/**
 * @typedef {Object} EarningsCalendarRequest
 * @property {string} [from]             YYYY-MM-DD
 * @property {string} [to]               YYYY-MM-DD
 * @property {string} [symbol]
 * @property {string} [exchange]
 */

/**
 * @typedef {Object} DividendRequest
 * @property {string} symbol
 * @property {string} [from]
 * @property {string} [to]
 */

/**
 * @typedef {Object} InsiderTradingRequest
 * @property {string} symbol
 * @property {number} [limit=20]
 * @property {string} [from]
 * @property {string} [to]
 */

/**
 * @typedef {Object} FinancialStatementRequest
 * @property {string} symbol
 * @property {string} [period]           "annual" | "quarter"
 * @property {number} [limit=5]
 */

/**
 * @typedef {Object} HealthStatus
 * @property {"healthy" | "degraded" | "unhealthy"} status
 * @property {number} latencyMs
 * @property {string} [message]
 * @property {string} [checkedAt]
 */

const MarketDataProviderInterface = {
  /** @type {string} Stable, lowercase, unique provider key (e.g. "fmp", "finnhub") */
  providerKey: "undefined",

  /** @type {string} Human-readable display name */
  displayName: "Undefined Provider",

  /**
   * Get a real-time or latest quote for a single symbol.
   * @param {QuoteRequest} request
   * @returns {Promise<import("./models").Quote>}
   */
  async getQuote(request) {},

  /**
   * Get quotes for multiple symbols in a single call.
   * @param {BatchQuoteRequest} request
   * @returns {Promise<import("./models").Quote[]>}
   */
  async getQuotes(request) {},

  /**
   * Search for companies by name or symbol.
   * @param {SearchRequest} request
   * @returns {Promise<import("./models").CompanySearchResult[]>}
   */
  async searchCompanies(request) {},

  /**
   * Get detailed company profile.
   * @param {string} symbol
   * @returns {Promise<import("./models").CompanyProfile>}
   */
  async getCompanyProfile(symbol) {},

  /**
   * Get historical price data.
   * @param {HistoricalPricesRequest} request
   * @returns {Promise<import("./models").HistoricalPricesResult>}
   */
  async getHistoricalPrices(request) {},

  /**
   * Get news articles.
   * @param {NewsRequest} [request]
   * @returns {Promise<import("./models").NewsArticle[]>}
   */
  async getNews(request) {},

  /**
   * Get dividend history for a symbol.
   * @param {DividendRequest} request
   * @returns {Promise<import("./models").DividendRecord[]>}
   */
  async getDividends(request) {},

  /**
   * Get upcoming dividend calendar.
   * @param {{ from?: string, to?: string }} [request]
   * @returns {Promise<import("./models").DividendCalendarEntry[]>}
   */
  async getDividendCalendar(request) {},

  /**
   * Get historical earnings data (surprises).
   * @param {EarningsRequest} request
   * @returns {Promise<import("./models").EarningsEvent[]>}
   */
  async getEarnings(request) {},

  /**
   * Get upcoming earnings calendar.
   * @param {EarningsCalendarRequest} [request]
   * @returns {Promise<import("./models").EarningsCalendarEntry[]>}
   */
  async getEarningsCalendar(request) {},

  /**
   * Get insider trading activity.
   * @param {InsiderTradingRequest} request
   * @returns {Promise<import("./models").InsiderTrade[]>}
   */
  async getInsiderTrading(request) {},

  /**
   * Get income statements.
   * @param {FinancialStatementRequest} request
   * @returns {Promise<import("./models").IncomeStatement[]>}
   */
  async getIncomeStatements(request) {},

  /**
   * Get balance sheets.
   * @param {FinancialStatementRequest} request
   * @returns {Promise<import("./models").BalanceSheet[]>}
   */
  async getBalanceSheets(request) {},

  /**
   * Get cash flow statements.
   * @param {FinancialStatementRequest} request
   * @returns {Promise<import("./models").CashFlowStatement[]>}
   */
  async getCashFlowStatements(request) {},

  /**
   * Get financial ratios.
   * @param {FinancialStatementRequest} request
   * @returns {Promise<import("./models").FinancialRatios[]>}
   */
  async getFinancialRatios(request) {},

  /**
   * Get key metrics (TTM basis).
   * @param {FinancialStatementRequest} request
   * @returns {Promise<import("./models").KeyMetrics[]>}
   */
  async getKeyMetrics(request) {},

  /**
   * Get analyst ratings and price targets.
   * @param {string} symbol
   * @returns {Promise<import("./models").AnalystRating>}
   */
  async getAnalystRatings(symbol) {},

  /**
   * Get market status for an exchange.
   * @param {string} [exchange="US"]
   * @returns {Promise<import("./models").MarketStatus>}
   */
  async getMarketStatus(exchange) {},

  /**
   * Get economic calendar events.
   * @param {{ from?: string, to?: string, country?: string }} [request]
   * @returns {Promise<import("./models").EconomicEvent[]>}
   */
  async getEconomicCalendar(request) {},

  /**
   * List company executives and their compensation.
   * @param {string} symbol
   * @returns {Promise<import("./models").Executive[]>}
   */
  async getCompanyExecutives(symbol) {},

  /**
   * Lightweight provider reachability / auth check.
   * @returns {Promise<HealthStatus>}
   */
  async healthCheck() {}
};

const REQUIRED_METHODS = Object.freeze([
  "getQuote",
  "getQuotes",
  "searchCompanies",
  "getCompanyProfile",
  "getHistoricalPrices",
  "getNews",
  "getDividends",
  "getDividendCalendar",
  "getEarnings",
  "getEarningsCalendar",
  "getInsiderTrading",
  "getIncomeStatements",
  "getBalanceSheets",
  "getCashFlowStatements",
  "getFinancialRatios",
  "getKeyMetrics",
  "getAnalystRatings",
  "getMarketStatus",
  "getEconomicCalendar",
  "getCompanyExecutives",
  "healthCheck"
]);

const REQUIRED_FIELDS = Object.freeze(["providerKey", "displayName"]);

/**
 * Validates that an object satisfies the MarketDataProvider contract.
 * Throws on missing fields/methods so bad adapters fail at registration time.
 *
 * @param {Object} provider
 * @returns {Object} The same provider, when valid
 * @throws {TypeError}
 */
function assertProviderContract(provider) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("MarketDataProvider must be an object.");
  }

  const missingFields = REQUIRED_FIELDS.filter(
    (f) => provider[f] === undefined || provider[f] === null
  );
  if (missingFields.length) {
    throw new TypeError(
      `MarketDataProvider missing required fields: ${missingFields.join(", ")}`
    );
  }

  if (typeof provider.providerKey !== "string" || !provider.providerKey.trim()) {
    throw new TypeError("MarketDataProvider.providerKey must be a non-empty string.");
  }

  const missingMethods = REQUIRED_METHODS.filter(
    (m) => typeof provider[m] !== "function"
  );
  if (missingMethods.length) {
    throw new TypeError(
      `MarketDataProvider "${provider.providerKey}" missing methods: ${missingMethods.join(", ")}`
    );
  }

  return provider;
}

module.exports = {
  MarketDataProviderInterface,
  REQUIRED_METHODS,
  REQUIRED_FIELDS,
  assertProviderContract
};
