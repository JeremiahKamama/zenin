/**
 * Cache Provider
 * ==============
 *
 * Abstract caching layer for the market intelligence domain.
 * Supports in-memory (default) and future external cache providers (Redis, etc.).
 *
 * Recommended TTLs:
 *   Quotes          30 sec
 *   News            5 min
 *   Company Profile 24 hr
 *   Financials      24 hr
 *   Earnings        1 hr
 *   Dividends       24 hr
 *   Insider Trading 30 min
 *   Market Status   5 min
 *   Economic Events 1 hr
 *
 * @module market-intel/infrastructure/cache
 */

"use strict";

const { CacheError } = require("../domain/errors");

/**
 * @typedef {Object} CacheEntry
 * @property {*} payload
 * @property {number} cachedAt   Date.now() when set
 * @property {number} ttlMs
 */

/**
 * In-memory cache implementation using Map with TTL support.
 * Implements the CacheProvider interface.
 */
class MemoryCacheProvider {
  constructor() {
    /** @type {Map<string, CacheEntry>} */
    this._store = new Map();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Get a cached value by key. Returns null if missing or expired.
   * @template T
   * @param {string} key
   * @returns {T | null}
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) {
      this._misses++;
      return null;
    }
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this._store.delete(key);
      this._misses++;
      return null;
    }
    this._hits++;
    return /** @type {T} */ (entry.payload);
  }

  /**
   * Store a value with a TTL.
   * @param {string} key
   * @param {*} payload
   * @param {number} ttlMs
   */
  set(key, payload, ttlMs) {
    this._store.set(key, {
      payload,
      cachedAt: Date.now(),
      ttlMs
    });
  }

  /**
   * Delete one or more keys (string or pattern).
   * @param {string} keyOrPattern
   */
  del(keyOrPattern) {
    if (keyOrPattern.includes("*")) {
      const regex = new RegExp("^" + keyOrPattern.replace(/\*/g, ".*") + "$");
      for (const key of this._store.keys()) {
        if (regex.test(key)) this._store.delete(key);
      }
    } else {
      this._store.delete(keyOrPattern);
    }
  }

  /**
   * Check if a non-expired entry exists.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._store.get(key);
    if (!entry) return false;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this._store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Clear the entire cache.
   */
  flush() {
    this._store.clear();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Get/set pattern with TTL. Fetches from provider if cache miss or expired.
   * @template T
   * @param {string} key
   * @param {number} ttlMs
   * @param {() => Promise<T>} fetcher
   * @returns {Promise<T>}
   */
  async getOrSet(key, ttlMs, fetcher) {
    const cached = this.get(key);
    if (cached !== null) return /** @type {T} */ (cached);

    try {
      const payload = await fetcher();
      this.set(key, payload, ttlMs);
      return payload;
    } catch (err) {
      throw new CacheError(`Cache fetch failed for key: ${key}`, {
        cause: err?.message
      });
    }
  }

  /**
   * @returns {{ size: number, hits: number, misses: number }}
   */
  stats() {
    return {
      size: this._store.size,
      hits: this._hits,
      misses: this._misses
    };
  }

  /**
   * Evict all expired entries.
   */
  evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now - entry.cachedAt > entry.ttlMs) {
        this._store.delete(key);
      }
    }
  }
}

/**
 * Standard TTL constants (milliseconds).
 */
const CACHE_TTL = Object.freeze({
  QUOTE: 30 * 1000,                    // 30 seconds
  NEWS: 5 * 60 * 1000,                 // 5 minutes
  COMPANY_PROFILE: 24 * 60 * 60 * 1000, // 24 hours
  FINANCIAL_STATEMENTS: 24 * 60 * 60 * 1000,
  EARNINGS: 1 * 60 * 60 * 1000,        // 1 hour
  EARNINGS_CALENDAR: 6 * 60 * 60 * 1000, // 6 hours
  DIVIDENDS: 24 * 60 * 60 * 1000,
  DIVIDEND_CALENDAR: 6 * 60 * 60 * 1000,
  INSIDER_TRADING: 30 * 60 * 1000,     // 30 minutes
  INSIDER_OWNERSHIP: 24 * 60 * 60 * 1000,
  ANALYST_RATINGS: 6 * 60 * 60 * 1000,
  MARKET_STATUS: 5 * 60 * 1000,        // 5 minutes
  ECONOMIC_CALENDAR: 1 * 60 * 60 * 1000,
  FINANCIAL_RATIOS: 24 * 60 * 60 * 1000,
  KEY_METRICS: 24 * 60 * 60 * 1000,
  EXECUTIVES: 24 * 60 * 60 * 1000
});

// Singleton cache instance
let _singletonCache = null;

/**
 * @returns {MemoryCacheProvider}
 */
function getCache() {
  if (!_singletonCache) {
    _singletonCache = new MemoryCacheProvider();
  }
  return _singletonCache;
}

/** Reset for testing. */
function resetCache() {
  _singletonCache = null;
}

module.exports = {
  MemoryCacheProvider,
  CACHE_TTL,
  getCache,
  resetCache
};
