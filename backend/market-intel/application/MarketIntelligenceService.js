/**
 * Market Intelligence Service
 * ===========================
 *
 * The application-layer orchestrator for the market intelligence domain.
 * Depends on the MarketDataProvider interface and CacheProvider — never on
 * a concrete provider implementation.
 *
 * This is the primary entry point: routes call this service, which delegates
 * to the provider with caching, error handling, and domain transformations.
 *
 * @module market-intel/application/MarketIntelligenceService
 */

"use strict";

const { CACHE_TTL } = require("../infrastructure/cache");
const { MarketIntelligenceError } = require("../domain/errors");

class MarketIntelligenceService {
  /**
   * @param {Object} deps
   * @param {Object} deps.provider        A MarketDataProvider adapter
   * @param {import("../infrastructure/cache").MemoryCacheProvider} deps.cache
   * @param {Object} [deps.db]            Database pool for persistence
   * @param {Object} [deps.eventBus]      Event emitter for market events
   */
  constructor(deps) {
    this._provider = deps.provider;
    this._cache = deps.cache;
    this._db = deps.db || null;
    this._eventBus = deps.eventBus || null;
  }

  // -----------------------------------------------------------------------
  // Quotes
  // -----------------------------------------------------------------------

  async getQuote(symbol) {
    const cacheKey = `quote:${symbol}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.QUOTE, async () => {
      const quote = await this._provider.getQuote({ symbol });
      if (this._eventBus) {
        this._eventBus.emit("quote:updated", quote);
      }
      return quote;
    });
  }

  async getQuotes(symbols) {
    // Build cache keys, check cache first
    const uncached = [];
    const results = [];
    for (const sym of symbols) {
      const cached = this._cache.get(`quote:${sym}`);
      if (cached) {
        results.push(cached);
      } else {
        uncached.push(sym);
      }
    }

    if (uncached.length > 0) {
      const fresh = await this._provider.getQuotes({ symbols: uncached });
      for (const quote of fresh) {
        this._cache.set(`quote:${quote.symbol}`, quote, CACHE_TTL.QUOTE);
        results.push(quote);
        if (this._eventBus) {
          this._eventBus.emit("quote:updated", quote);
        }
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  async searchCompanies(query, limit = 10) {
    const cacheKey = `search:${query}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.COMPANY_PROFILE, async () => {
      return this._provider.searchCompanies({ query, limit });
    });
  }

  // -----------------------------------------------------------------------
  // Company Profile
  // -----------------------------------------------------------------------

  async getCompanyProfile(symbol) {
    const cacheKey = `profile:${symbol}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.COMPANY_PROFILE, async () => {
      return this._provider.getCompanyProfile(symbol);
    });
  }

  // -----------------------------------------------------------------------
  // Historical Prices
  // -----------------------------------------------------------------------

  async getHistoricalPrices(symbol, options = {}) {
    const { from, to, resolution = "daily" } = options;
    const cacheKey = `history:${symbol}:${resolution}:${from || ""}:${to || ""}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.COMPANY_PROFILE, async () => {
      return this._provider.getHistoricalPrices({ symbol, from, to, resolution });
    });
  }

  // -----------------------------------------------------------------------
  // News
  // -----------------------------------------------------------------------

  async getNews(options = {}) {
    const { symbol, limit = 20, offset = 0, category } = options;
    const cacheKey = `news:${symbol || "general"}:${limit}:${offset}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.NEWS, async () => {
      const articles = await this._provider.getNews({ symbol, limit, offset, category });
      if (this._eventBus) {
        for (const article of articles.slice(0, 5)) {
          this._eventBus.emit("news:published", article);
        }
      }
      return articles;
    });
  }

  // -----------------------------------------------------------------------
  // Financial Statements
  // -----------------------------------------------------------------------

  async getIncomeStatements(symbol, period = "annual", limit = 5) {
    const cacheKey = `income:${symbol}:${period}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.FINANCIAL_STATEMENTS, async () => {
      return this._provider.getIncomeStatements({ symbol, period, limit });
    });
  }

  async getBalanceSheets(symbol, period = "annual", limit = 5) {
    const cacheKey = `balance:${symbol}:${period}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.FINANCIAL_STATEMENTS, async () => {
      return this._provider.getBalanceSheets({ symbol, period, limit });
    });
  }

  async getCashFlowStatements(symbol, period = "annual", limit = 5) {
    const cacheKey = `cashflow:${symbol}:${period}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.FINANCIAL_STATEMENTS, async () => {
      return this._provider.getCashFlowStatements({ symbol, period, limit });
    });
  }

  async getFinancialRatios(symbol, period = "annual", limit = 5) {
    const cacheKey = `ratios:${symbol}:${period}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.FINANCIAL_RATIOS, async () => {
      return this._provider.getFinancialRatios({ symbol, period, limit });
    });
  }

  async getKeyMetrics(symbol, period = "annual", limit = 5) {
    const cacheKey = `keymetrics:${symbol}:${period}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.KEY_METRICS, async () => {
      return this._provider.getKeyMetrics({ symbol, period, limit });
    });
  }

  // -----------------------------------------------------------------------
  // Earnings
  // -----------------------------------------------------------------------

  async getEarnings(symbol, limit = 8) {
    const cacheKey = `earnings:${symbol}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.EARNINGS, async () => {
      return this._provider.getEarnings({ symbol, limit });
    });
  }

  async getEarningsCalendar(options = {}) {
    const { from, to, symbol } = options;
    const cacheKey = `earnings_cal:${from || ""}:${to || ""}:${symbol || ""}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.EARNINGS_CALENDAR, async () => {
      return this._provider.getEarningsCalendar({ from, to, symbol });
    });
  }

  // -----------------------------------------------------------------------
  // Dividends
  // -----------------------------------------------------------------------

  async getDividends(symbol) {
    const cacheKey = `dividends:${symbol}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.DIVIDENDS, async () => {
      return this._provider.getDividends({ symbol });
    });
  }

  async getDividendCalendar(options = {}) {
    const { from, to } = options;
    const cacheKey = `dividend_cal:${from || ""}:${to || ""}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.DIVIDEND_CALENDAR, async () => {
      return this._provider.getDividendCalendar({ from, to });
    });
  }

  // -----------------------------------------------------------------------
  // Insider Trading
  // -----------------------------------------------------------------------

  async getInsiderTrading(symbol, limit = 20) {
    const cacheKey = `insider:${symbol}:${limit}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.INSIDER_TRADING, async () => {
      return this._provider.getInsiderTrading({ symbol, limit });
    });
  }

  // -----------------------------------------------------------------------
  // Analyst Ratings
  // -----------------------------------------------------------------------

  async getAnalystRatings(symbol) {
    const cacheKey = `analyst:${symbol}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.ANALYST_RATINGS, async () => {
      return this._provider.getAnalystRatings(symbol);
    });
  }

  // -----------------------------------------------------------------------
  // Market Status
  // -----------------------------------------------------------------------

  async getMarketStatus(exchange = "US") {
    const cacheKey = `market_status:${exchange}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.MARKET_STATUS, async () => {
      return this._provider.getMarketStatus(exchange);
    });
  }

  // -----------------------------------------------------------------------
  // Economic Calendar
  // -----------------------------------------------------------------------

  async getEconomicCalendar(options = {}) {
    const { from, to, country } = options;
    const cacheKey = `economic:${from || ""}:${to || ""}:${country || ""}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.ECONOMIC_CALENDAR, async () => {
      return this._provider.getEconomicCalendar({ from, to, country });
    });
  }

  // -----------------------------------------------------------------------
  // Executives
  // -----------------------------------------------------------------------

  async getCompanyExecutives(symbol) {
    const cacheKey = `executives:${symbol}`;
    return this._cache.getOrSet(cacheKey, CACHE_TTL.EXECUTIVES, async () => {
      return this._provider.getCompanyExecutives(symbol);
    });
  }

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  async healthCheck() {
    return this._provider.healthCheck();
  }

  // -----------------------------------------------------------------------
  // Watchlists (persisted in database)
  // -----------------------------------------------------------------------

  async createWatchlist(userId, workspaceId, name, description) {
    if (!this._db) throw new MarketIntelligenceError("Database not configured");
    const result = await this._db.query(
      `INSERT INTO market_watchlists (user_id, workspace_id, name, description)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, workspace_id, name, description, created_at, updated_at`,
      [userId, workspaceId || null, name, description || null]
    );
    return mapWatchlistRow(result.rows[0]);
  }

  async getWatchlists(userId, workspaceId) {
    if (!this._db) throw new MarketIntelligenceError("Database not configured");
    const result = await this._db.query(
      `SELECT id, user_id, workspace_id, name, description, created_at, updated_at
       FROM market_watchlists
       WHERE user_id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)
       ORDER BY created_at DESC`,
      [userId, workspaceId || null]
    );
    return result.rows.map(mapWatchlistRow);
  }

  async addWatchlistItem(watchlistId, symbol, name, note, targetPrice) {
    if (!this._db) throw new MarketIntelligenceError("Database not configured");
    const result = await this._db.query(
      `INSERT INTO market_watchlist_items (watchlist_id, symbol, name, note, target_price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, watchlist_id, symbol, name, note, target_price, added_at`,
      [watchlistId, symbol.toUpperCase(), name || null, note || null, targetPrice || null]
    );
    return mapWatchlistItemRow(result.rows[0]);
  }

  async removeWatchlistItem(watchlistId, symbol) {
    if (!this._db) throw new MarketIntelligenceError("Database not configured");
    await this._db.query(
      `DELETE FROM market_watchlist_items WHERE watchlist_id = $1 AND symbol = $2`,
      [watchlistId, symbol.toUpperCase()]
    );
  }

  async getWatchlistItems(watchlistId) {
    if (!this._db) throw new MarketIntelligenceError("Database not configured");
    const result = await this._db.query(
      `SELECT id, watchlist_id, symbol, name, note, target_price, added_at
       FROM market_watchlist_items
       WHERE watchlist_id = $1
       ORDER BY added_at DESC`,
      [watchlistId]
    );
    return result.rows.map(mapWatchlistItemRow);
  }

  async deleteWatchlist(watchlistId) {
    if (!this._db) throw new MarketIntelligenceError("Database not configured");
    await this._db.query(`DELETE FROM market_watchlist_items WHERE watchlist_id = $1`, [watchlistId]);
    await this._db.query(`DELETE FROM market_watchlists WHERE id = $1`, [watchlistId]);
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapWatchlistRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id || null,
    name: row.name,
    description: row.description || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null
  };
}

function mapWatchlistItemRow(row) {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    symbol: row.symbol,
    name: row.name || null,
    note: row.note || null,
    targetPrice: row.target_price ? Number(row.target_price) : null,
    addedAt: row.added_at?.toISOString?.() || row.added_at || null
  };
}

module.exports = {
  MarketIntelligenceService
};
