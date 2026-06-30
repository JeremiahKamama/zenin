/**
 * Simple in-process rate limiter for provider API calls.
 */

"use strict";

class RateLimiter {
  /**
   * @param {{ maxRequests?: number, intervalMs?: number }} [options]
   */
  constructor(options = {}) {
    this.maxRequests = Math.max(1, Number(options.maxRequests) || 8);
    this.intervalMs = Math.max(100, Number(options.intervalMs) || 1000);
    /** @type {number[]} */
    this._timestamps = [];
    /** @type {Promise<void>} */
    this._chain = Promise.resolve();
  }

  /**
   * Waits until a request slot is available, then records the call.
   * @returns {Promise<void>}
   */
  acquire() {
    this._chain = this._chain.then(() => this._acquireInternal());
    return this._chain;
  }

  async _acquireInternal() {
    const now = Date.now();
    this._timestamps = this._timestamps.filter((ts) => now - ts < this.intervalMs);

    if (this._timestamps.length >= this.maxRequests) {
      const waitMs = this.intervalMs - (now - this._timestamps[0]) + 5;
      await sleep(waitMs);
      return this._acquireInternal();
    }

    this._timestamps.push(Date.now());
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @type {Map<string, RateLimiter>} */
const limitersByProvider = new Map();

/**
 * @param {string} providerKey
 * @param {{ maxRequests?: number, intervalMs?: number }} [options]
 */
function getRateLimiter(providerKey, options) {
  const key = String(providerKey || "default").toLowerCase();
  if (!limitersByProvider.has(key)) {
    limitersByProvider.set(key, new RateLimiter(options));
  }
  return limitersByProvider.get(key);
}

/** Clears cached limiters (tests only). */
function resetRateLimiters() {
  limitersByProvider.clear();
}

module.exports = {
  RateLimiter,
  getRateLimiter,
  resetRateLimiters
};
