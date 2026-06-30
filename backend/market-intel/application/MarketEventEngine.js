/**
 * Market Event Engine
 * ===================
 *
 * Converts raw provider data (quotes, news, dividends, etc.) into normalised
 * MarketEvent objects. The rest of Zenin consumes only MarketEvents — never
 * raw provider responses.
 *
 * This engine:
 *   1. Listens for provider data updates (via eventBus or polling)
 *   2. Detects meaningful changes (price thresholds, new dividends, etc.)
 *   3. Emits standardised MarketEvent objects
 *
 * @module market-intel/application/MarketEventEngine
 */

"use strict";

const { generateId } = require("../domain/models");

const EVENT_TYPES = {
  PRICE_CHANGE: "PRICE_CHANGE",
  LARGE_GAIN: "LARGE_GAIN",
  LARGE_LOSS: "LARGE_LOSS",
  HIGH_52_WEEK: "HIGH_52_WEEK",
  LOW_52_WEEK: "LOW_52_WEEK",
  GAP_UP: "GAP_UP",
  GAP_DOWN: "GAP_DOWN",
  TARGET_REACHED: "TARGET_REACHED",
  DIVIDEND_DECLARED: "DIVIDEND_DECLARED",
  DIVIDEND_PAYABLE: "DIVIDEND_PAYABLE",
  EARNINGS_ANNOUNCED: "EARNINGS_ANNOUNCED",
  EARNINGS_UPCOMING: "EARNINGS_UPCOMING",
  NEWS_PUBLISHED: "NEWS_PUBLISHED",
  INSIDER_BUY: "INSIDER_BUY",
  INSIDER_SELL: "INSIDER_SELL",
  ANALYST_UPGRADE: "ANALYST_UPGRADE",
  ANALYST_DOWNGRADE: "ANALYST_DOWNGRADE",
  ECONOMIC_EVENT: "ECONOMIC_EVENT",
  MARKET_OPEN: "MARKET_OPEN",
  MARKET_CLOSE: "MARKET_CLOSE"
};

/**
 * @typedef {Object} MarketEventEngineOptions
 * @property {Object} [eventBus]               Node EventEmitter for publishing events
 * @property {number} [largeMoveThreshold=5]   Percent threshold for LARGE_GAIN/LARGE_LOSS
 * @property {number} [gapThreshold=2]         Percent threshold for GAP_UP/GAP_DOWN
 * @property {number} [priceChangeThreshold=1] Percent threshold for PRICE_CHANGE events
 */

class MarketEventEngine {
  /**
   * @param {MarketEventEngineOptions} [options]
   */
  constructor(options = {}) {
    this._eventBus = options.eventBus || null;
    this._largeMoveThreshold = options.largeMoveThreshold || 5;
    this._gapThreshold = options.gapThreshold || 2;
    this._priceChangeThreshold = options.priceChangeThreshold || 1;
    this._priceCache = new Map();    // symbol -> previous Quote
    this._drainListeners = new Set();
  }

  /**
   * Subscribe to a drain callback (for queuing/notification pipeline).
   * @param {(event: Object) => void} listener
   */
  onEvent(listener) {
    this._drainListeners.add(listener);
  }

  removeListener(listener) {
    this._drainListeners.delete(listener);
  }

  // -----------------------------------------------------------------------
  // Process incoming data
  // -----------------------------------------------------------------------

  /**
   * Process a quote update and emit relevant market events.
   * @param {import("../domain/models").Quote} quote
   * @returns {import("../domain/models").MarketEvent[]}
   */
  processQuote(quote) {
    if (!quote || !quote.symbol) return [];
    const previous = this._priceCache.get(quote.symbol);
    const events = [];

    // Cache the current quote for next comparison
    this._priceCache.set(quote.symbol, quote);

    if (!previous || !previous.price) {
      this._drain({ type: EVENT_TYPES.PRICE_CHANGE, symbol: quote.symbol, payload: { quote } });
      return [];
    }

    const changePercent = quote.changePercent || 0;

    // Large gain/loss
    if (changePercent >= this._largeMoveThreshold) {
      events.push(
        this._publish(EVENT_TYPES.LARGE_GAIN, quote.symbol, {
          symbol: quote.symbol,
          price: quote.price,
          changePercent,
          previousPrice: previous.price,
          timestamp: quote.timestamp
        })
      );
    } else if (changePercent <= -this._largeMoveThreshold) {
      events.push(
        this._publish(EVENT_TYPES.LARGE_LOSS, quote.symbol, {
          symbol: quote.symbol,
          price: quote.price,
          changePercent,
          previousPrice: previous.price,
          timestamp: quote.timestamp
        })
      );
    } else if (Math.abs(changePercent) >= this._priceChangeThreshold) {
      events.push(
        this._publish(EVENT_TYPES.PRICE_CHANGE, quote.symbol, {
          symbol: quote.symbol,
          price: quote.price,
          changePercent,
          previousPrice: previous.price,
          timestamp: quote.timestamp
        })
      );
    }

    // 52-week high/low
    if (quote.high52Week && quote.price && quote.price >= quote.high52Week) {
      events.push(
        this._publish(EVENT_TYPES.HIGH_52_WEEK, quote.symbol, {
          symbol: quote.symbol,
          price: quote.price,
          high52Week: quote.high52Week
        })
      );
    }
    if (quote.low52Week && quote.price && quote.price <= quote.low52Week) {
      events.push(
        this._publish(EVENT_TYPES.LOW_52_WEEK, quote.symbol, {
          symbol: quote.symbol,
          price: quote.price,
          low52Week: quote.low52Week
        })
      );
    }

    // Gap up/down
    if (quote.previousClose && quote.open) {
      const gapPercent = ((quote.open - quote.previousClose) / quote.previousClose) * 100;
      if (gapPercent >= this._gapThreshold) {
        events.push(
          this._publish(EVENT_TYPES.GAP_UP, quote.symbol, {
            symbol: quote.symbol,
            open: quote.open,
            previousClose: quote.previousClose,
            gapPercent
          })
        );
      } else if (gapPercent <= -this._gapThreshold) {
        events.push(
          this._publish(EVENT_TYPES.GAP_DOWN, quote.symbol, {
            symbol: quote.symbol,
            open: quote.open,
            previousClose: quote.previousClose,
            gapPercent
          })
        );
      }
    }

    for (const event of events) {
      this._drain(event);
    }

    return events;
  }

  /**
   * Process a batch of quotes.
   * @param {import("../domain/models").Quote[]} quotes
   * @returns {import("../domain/models").MarketEvent[]}
   */
  processQuotes(quotes) {
    const events = [];
    for (const quote of quotes) {
      events.push(...this.processQuote(quote));
    }
    return events;
  }

  /**
   * Process news articles.
   * @param {import("../domain/models").NewsArticle[]} articles
   * @returns {import("../domain/models").MarketEvent[]}
   */
  processNews(articles) {
    if (!Array.isArray(articles)) return [];
    const events = [];
    for (const article of articles) {
      const event = this._publish(EVENT_TYPES.NEWS_PUBLISHED, article.symbols?.[0] || null, {
        articleId: article.id,
        title: article.title,
        source: article.source,
        category: article.category,
        symbols: article.symbols,
        url: article.url,
        publishedAt: article.publishedAt
      });
      events.push(event);
      this._drain(event);
    }
    return events;
  }

  /**
   * Process dividends.
   * @param {import("../domain/models").DividendRecord[]} dividends
   * @returns {import("../domain/models").MarketEvent[]}
   */
  processDividends(dividends) {
    if (!Array.isArray(dividends)) return [];
    const events = [];
    for (const d of dividends) {
      const event = this._publish(EVENT_TYPES.DIVIDEND_DECLARED, d.symbol, {
        symbol: d.symbol,
        dividend: d.dividend,
        declarationDate: d.declarationDate,
        payableDate: d.payableDate,
        exDividendDate: d.exDividendDate,
        yield: d.yield
      });
      events.push(event);
      this._drain(event);
    }
    return events;
  }

  /**
   * Process earnings events.
   * @param {import("../domain/models").EarningsEvent[]} earnings
   * @returns {import("../domain/models").MarketEvent[]}
   */
  processEarnings(earnings) {
    if (!Array.isArray(earnings)) return [];
    const events = [];
    for (const e of earnings) {
      const event = this._publish(EVENT_TYPES.EARNINGS_ANNOUNCED, e.symbol, {
        symbol: e.symbol,
        date: e.date,
        estimatedEps: e.estimatedEps,
        actualEps: e.actualEps,
        surpriseEpsPercent: e.surpriseEpsPercent,
        estimatedRevenue: e.estimatedRevenue,
        actualRevenue: e.actualRevenue
      });
      events.push(event);
      this._drain(event);
    }
    return events;
  }

  /**
   * Process insider trades.
   * @param {import("../domain/models").InsiderTrade[]} trades
   * @returns {import("../domain/models").MarketEvent[]}
   */
  processInsiderTrades(trades) {
    if (!Array.isArray(trades)) return [];
    const events = [];
    for (const t of trades) {
      const type = t.transactionType === "buy"
        ? EVENT_TYPES.INSIDER_BUY
        : EVENT_TYPES.INSIDER_SELL;
      const event = this._publish(type, t.symbol, {
        symbol: t.symbol,
        insiderName: t.insiderName,
        title: t.title,
        transactionType: t.transactionType,
        shares: t.shares,
        totalValue: t.totalValue,
        transactionDate: t.transactionDate
      });
      events.push(event);
      this._drain(event);
    }
    return events;
  }

  /**
   * Process market status changes.
   * @param {import("../domain/models").MarketStatus} status
   * @returns {import("../domain/models").MarketEvent|null}
   */
  processMarketStatus(status) {
    if (!status) return null;
    const type = status.isOpen ? EVENT_TYPES.MARKET_OPEN : EVENT_TYPES.MARKET_CLOSE;
    const event = this._publish(type, null, {
      exchange: status.exchange,
      isOpen: status.isOpen,
      sessionStatus: status.sessionStatus,
      openTime: status.openTime,
      closeTime: status.closeTime
    });
    this._drain(event);
    return event;
  }

  /**
   * Process upcoming earnings calendar entries as alert events.
   * @param {import("../domain/models").EarningsCalendarEntry[]} entries
   * @returns {import("../domain/models").MarketEvent[]}
   */
  processEarningsCalendar(entries) {
    if (!Array.isArray(entries)) return [];
    const events = [];
    for (const entry of entries) {
      const event = this._publish(EVENT_TYPES.EARNINGS_UPCOMING, entry.symbol, {
        symbol: entry.symbol,
        name: entry.name,
        date: entry.date,
        estimatedEps: entry.estimatedEps,
        estimatedRevenue: entry.estimatedRevenue,
        timeOfDay: entry.timeOfDay
      });
      events.push(event);
      this._drain(event);
    }
    return events;
  }

  /**
   * Process analyst upgrades/downgrades.
   * @param {import("../domain/models").AnalystRating} rating
   * @returns {import("../domain/models").MarketEvent|null}
   */
  processAnalystRating(rating) {
    if (!rating) return null;
    let type = null;
    if (rating.action === "upgrade" || rating.rating === "buy" || rating.rating === "strongBuy") {
      type = EVENT_TYPES.ANALYST_UPGRADE;
    } else if (rating.action === "downgrade" || rating.rating === "sell" || rating.rating === "underperform") {
      type = EVENT_TYPES.ANALYST_DOWNGRADE;
    }
    if (!type) return null;

    const event = this._publish(type, rating.symbol, {
      symbol: rating.symbol,
      firm: rating.firm,
      rating: rating.rating,
      action: rating.action,
      targetPrice: rating.targetPrice,
      previousRating: rating.previousRating,
      date: rating.date
    });
    this._drain(event);
    return event;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Create a MarketEvent object.
   * @param {string} type
   * @param {string|null} symbol
   * @param {Object} payload
   * @returns {import("../domain/models").MarketEvent}
   */
  _publish(type, symbol, payload) {
    return {
      id: generateId(),
      type,
      symbol: symbol || undefined,
      payload,
      createdAt: new Date().toISOString(),
      source: "provider",
      origin: "system"
    };
  }

  /**
   * Emit to all listeners (eventBus + drain listeners).
   * @param {import("../domain/models").MarketEvent} event
   */
  _drain(event) {
    if (this._eventBus && typeof this._eventBus.emit === "function") {
      this._eventBus.emit("market:event", event);
      this._eventBus.emit(`market:${event.type.toLowerCase()}`, event);
    }
    for (const listener of this._drainListeners) {
      try {
        listener(event);
      } catch (_) {
        // Swallow listener errors so one bad listener doesn't block others
      }
    }
  }

  /**
   * Get the cached last quote for a symbol.
   * @param {string} symbol
   * @returns {import("../domain/models").Quote|null}
   */
  getLastQuote(symbol) {
    return this._priceCache.get(symbol) || null;
  }
}

module.exports = {
  MarketEventEngine,
  EVENT_TYPES
};
