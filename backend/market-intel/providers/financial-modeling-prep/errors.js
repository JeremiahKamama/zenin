/**
 * FMP Provider Error Wrapper
 * ==========================
 *
 * Translates FMP-specific HTTP errors into provider-independent domain errors.
 * Every FMP API call should be wrapped with withFmpErrors() so no vendor
 * exception leaks into the application layer.
 *
 * @module market-intel/providers/financial-modeling-prep/errors
 */

"use strict";

const {
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  MarketDataProviderError
} = require("../../domain/errors");

/**
 * Execute an async FMP operation and map any FMP-specific errors
 * to domain errors.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} [label]          Context label for error messages
 * @returns {Promise<T>}
 * @throws {MarketDataProviderError}
 */
async function withFmpErrors(fn, label) {
  try {
    return await fn();
  } catch (err) {
    const msg = err?.message || "";
    const status = err?.status || 0;

    if (status === 401 || status === 403 || /auth/i.test(msg)) {
      throw new ProviderAuthenticationError(
        label ? `FMP authentication failed during: ${label}` : "FMP authentication failed",
        { statusCode: 401 }
      );
    }

    if (status === 429 || /rate.?limit/i.test(msg)) {
      throw new ProviderRateLimitError(
        label ? `FMP rate limit exceeded during: ${label}` : "FMP rate limit exceeded",
        { statusCode: 429 }
      );
    }

    if (status === 504 || /timeout|abort/i.test(msg)) {
      throw new ProviderUnavailableError(
        label ? `FMP request timed out during: ${label}` : "FMP request timed out",
        { statusCode: 503 }
      );
    }

    throw new MarketDataProviderError(
      label
        ? `FMP provider error during: ${label}: ${err.message}`
        : `FMP provider error: ${err.message}`,
      { statusCode: 502 }
    );
  }
}

module.exports = { withFmpErrors };
