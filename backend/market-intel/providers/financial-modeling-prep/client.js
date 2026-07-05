/**
 * Financial Modeling Prep API Client
 * ==================================
 *
 * Low-level HTTP client for the FMP REST API. This is the ONLY module that
 * knows FMP URLs, authentication, and raw HTTP interactions.
 *
 * Base URL: https://financialmodelingprep.com/api/v3/
 * Auth: ?apikey=<FMP_API_KEY> query parameter
 *
 * @module market-intel/providers/financial-modeling-prep/client
 */

"use strict";

const FMP_BASE_URL = String(
  process.env.FMP_BASE_URL || "https://financialmodelingprep.com/api/v3"
).replace(/\/+$/, "");

const FMP_V4_BASE_URL = String(
  process.env.FMP_V4_BASE_URL || "https://financialmodelingprep.com/api/v4"
).replace(/\/+$/, "");

/**
 * Resolve FMP API key from environment.
 * Tries: FMP_API_KEY, FINANCIAL_MODELING_PREP_API_KEY, FINANCIAL_MODELING_PREP_APIKEY
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
function resolveConfig(env = process.env) {
  const key = String(
    env.FMP_API_KEY ||
    env.FINANCIAL_MODELING_PREP_API_KEY ||
    env.FINANCIAL_MODELING_PREP_APIKEY ||
    ""
  ).trim();
  return key || null;
}

/**
 * Check if FMP is configured with valid credentials.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isConfigured(env) {
  return Boolean(resolveConfig(env));
}

/**
 * Make an authenticated GET request to the FMP API.
 * Automatically appends ?apikey= to every request.
 *
 * @param {string} path            API path (e.g. "/quote/AAPL")
 * @param {Object} [params]        Additional query parameters
 * @param {{ v4?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<*>}           Parsed JSON response
 * @throws {Error}                 On HTTP errors
 */
async function fmpGet(path, params = {}, options = {}) {
  const apiKey = resolveConfig();
  if (!apiKey) {
    throw new Error("FMP API key is not configured. Set FMP_API_KEY environment variable.");
  }

  const base = options.v4 ? FMP_V4_BASE_URL : FMP_BASE_URL;
  const query = new URLSearchParams({ apikey: apiKey, ...params });
  const url = `${base}${path}?${query.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const startedAt = Date.now();

  // Sentry — safe no-ops when unconfigured.
  const sentry = require("../../../sentry");

  try {
    const response = await fetch(url, {
      signal: options.signal || controller.signal,
      headers: { Accept: "application/json" }
    });
    const durationMs = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      sentry.captureException(new FmpHttpError("FMP API authentication failed", response.status), {
        tags: { provider: "fmp", kind: "auth_error", statusCode: String(response.status) }
      });
      throw new FmpHttpError("FMP API authentication failed", response.status);
    }
    if (response.status === 429) {
      sentry.captureException(new FmpHttpError("FMP API rate limit exceeded", 429), {
        tags: { provider: "fmp", kind: "rate_limited", statusCode: "429" }
      });
      throw new FmpHttpError("FMP API rate limit exceeded", 429);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      sentry.addBreadcrumb({
        category: "market-intel.fmp",
        level: "warning",
        message: `FMP ${path} -> ${response.status}`,
        data: { provider: "fmp", path, statusCode: response.status, durationMs }
      });
      throw new FmpHttpError(
        `FMP API error ${response.status}: ${text.slice(0, 200)}`,
        response.status
      );
    }

    // Latency breadcrumb on success — useful for diagnosing slow market-data loads.
    sentry.addBreadcrumb({
      category: "market-intel.fmp",
      type: "http",
      message: `FMP ${path} -> 200`,
      data: { provider: "fmp", path, durationMs }
    });

    const data = await response.json();
    return data;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    if (err instanceof FmpHttpError) throw err;
    if (err.name === "AbortError") {
      sentry.captureException(new FmpHttpError("FMP API request timed out", 504), {
        tags: { provider: "fmp", kind: "timeout", statusCode: "504" },
        extra: { durationMs }
      });
      throw new FmpHttpError("FMP API request timed out", 504);
    }
    sentry.captureException(new FmpHttpError(`FMP API request failed: ${err.message}`, 0), {
      tags: { provider: "fmp", kind: "network_error", statusCode: "0" },
      extra: { durationMs }
    });
    throw new FmpHttpError(`FMP API request failed: ${err.message}`, 0);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Internal error class for FMP HTTP errors.
 */
class FmpHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "FmpHttpError";
    this.status = status || 0;
  }
}

module.exports = {
  fmpGet,
  resolveConfig,
  isConfigured,
  FMP_BASE_URL,
  FMP_V4_BASE_URL,
  FmpHttpError
};
