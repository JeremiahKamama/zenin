"use strict";

const { fmpGet } = require("../../../market-intel/providers/financial-modeling-prep/client");
const { withRetry, CircuitBreaker } = require("../../infrastructure/resilience");

/**
 * Simple in-memory token-bucket rate limiter for FMP.
 */
class TokenBucket {
  constructor({ capacity = 300, refillPerSecond = 10 } = {}) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSecond = refillPerSecond;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const added = elapsed * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + added);
    this.lastRefill = now;
  }

  consume(tokens = 1) {
    this._refill();
    if (this.tokens < tokens) return false;
    this.tokens -= tokens;
    return true;
  }
}

const fmpBucket = new TokenBucket({
  capacity: Number(process.env.FMP_RATE_LIMIT_CAPACITY || 300),
  refillPerSecond: Number(process.env.FMP_RATE_LIMIT_REFILL || 10)
});

const fmpBreaker = new CircuitBreaker({
  name: "fmp",
  failureThreshold: Number(process.env.FMP_BREAKER_FAILURE_THRESHOLD || 5),
  cooldownMs: Number(process.env.FMP_BREAKER_COOLDOWN_MS || 30_000)
});

/**
 * Rate-limited, retried, circuit-breaker-protected wrapper around the market-intel FMP client.
 */
async function get(path, params = {}, options = {}) {
  if (!fmpBucket.consume(1)) {
    const err = new Error("FMP rate limit locally exhausted");
    err.status = 429;
    err.rateLimited = true;
    throw err;
  }

  return fmpBreaker.execute(() =>
    withRetry(() => fmpGet(path, params, options), {
      maxAttempts: Number(process.env.FMP_RETRY_ATTEMPTS || 3),
      baseDelayMs: Number(process.env.FMP_RETRY_BASE_DELAY_MS || 100),
      maxDelayMs: Number(process.env.FMP_RETRY_MAX_DELAY_MS || 1000)
    })
  );
}

module.exports = { get, TokenBucket, fmpBucket, fmpBreaker };
