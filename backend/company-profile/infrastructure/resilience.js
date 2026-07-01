"use strict";

/**
 * Simple retry helper with exponential backoff.
 */
async function withRetry(fn, {
  maxAttempts = 3,
  baseDelayMs = 100,
  maxDelayMs = 1000,
  retryable = (err) => isRetryableError(err)
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !retryable(err)) throw err;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function isRetryableError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (/timeout|timed out|econnreset|socket hang up|network/i.test(String(err.message || ""))) return true;
  return false;
}

/**
 * Minimal circuit breaker.
 *
 * States: CLOSED → OPEN → HALF_OPEN after cooldown.
 */
class CircuitBreaker {
  constructor({
    name,
    failureThreshold = 5,
    cooldownMs = 30_000,
    halfOpenMaxCalls = 3
  } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.halfOpenMaxCalls = halfOpenMaxCalls;

    this._state = "CLOSED";
    this._failures = 0;
    this._successes = 0;
    this._lastFailureTime = null;
    this._halfOpenCalls = 0;
  }

  async execute(fn) {
    if (this._state === "OPEN") {
      if (Date.now() - (this._lastFailureTime || 0) >= this.cooldownMs) {
        this._state = "HALF_OPEN";
        this._halfOpenCalls = 0;
      } else {
        const err = new Error(`Circuit breaker '${this.name}' is OPEN`);
        err.circuitOpen = true;
        throw err;
      }
    }

    if (this._state === "HALF_OPEN" && this._halfOpenCalls >= this.halfOpenMaxCalls) {
      const err = new Error(`Circuit breaker '${this.name}' is HALF_OPEN and saturated`);
      err.circuitOpen = true;
      throw err;
    }

    if (this._state === "HALF_OPEN") this._halfOpenCalls++;

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    this._failures = 0;
    if (this._state === "HALF_OPEN") {
      this._successes++;
      if (this._successes >= this.halfOpenMaxCalls) {
        this._state = "CLOSED";
        this._successes = 0;
        this._halfOpenCalls = 0;
      }
    }
  }

  _onFailure() {
    this._failures++;
    this._lastFailureTime = Date.now();
    if (this._state === "HALF_OPEN" || this._failures >= this.failureThreshold) {
      this._state = "OPEN";
    }
  }

  state() {
    return {
      name: this.name,
      state: this._state,
      failures: this._failures,
      successes: this._successes,
      lastFailureTime: this._lastFailureTime
    };
  }
}

module.exports = { withRetry, CircuitBreaker, isRetryableError };
