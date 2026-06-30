/**
 * Retry helper for provider operations.
 */

"use strict";

const { BrokerageError } = require("../domain/errors");

/**
 * @typedef {Object} RetryOptions
 * @property {number} [maxAttempts=3]
 * @property {number} [baseDelayMs=500]
 * @property {number} [maxDelayMs=8000]
 * @property {(error: unknown) => boolean} [shouldRetry]
 * @property {AbortSignal} [signal]
 */

/**
 * @param {() => Promise<T>} fn
 * @param {RetryOptions} [options]
 * @template T
 * @returns {Promise<T>}
 */
async function withRetry(fn, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
  const baseDelayMs = Number(options.baseDelayMs) || 500;
  const maxDelayMs = Number(options.maxDelayMs) || 8000;
  const shouldRetry =
    options.shouldRetry ||
    ((error) => error instanceof BrokerageError && error.retryable === true);

  let attempt = 0;
  let lastError;

  while (attempt < maxAttempts) {
    if (options.signal?.aborted) {
      throw new BrokerageError("Sync aborted.", { code: "BROKERAGE_SYNC_ABORTED", statusCode: 499 });
    }

    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;

      const retryAfterMs =
        error instanceof BrokerageError && error.retryAfterMs
          ? error.retryAfterMs
          : Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));

      await sleep(retryAfterMs, options.signal);
    }
  }

  throw lastError;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new BrokerageError("Sync aborted.", { code: "BROKERAGE_SYNC_ABORTED", statusCode: 499 }));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

module.exports = {
  withRetry
};
