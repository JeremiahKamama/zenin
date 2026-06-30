/**
 * SnapTrade SDK Client Wrapper
 * ============================
 *
 * THIS IS THE ONLY FILE IN THE CODEBASE THAT IMPORTS THE SNAPTRADE SDK.
 * Everything SnapTrade-specific is confined to providers/snaptrade/. No other
 * layer may touch `snaptrade-typescript-sdk` directly.
 *
 * The client is created lazily so the module can be required (e.g. by the
 * registry or tests) even when SnapTrade credentials are not configured.
 * createSnapTradeClient() throws a clear configuration error if creds are absent.
 */

"use strict";

/**
 * SnapTrade configuration. Read from the provider-local config module, never
 * from the application-wide config.
 *
 * @typedef {Object} SnapTradeConfig
 * @property {string} clientId       SNAPTRADE_CLIENT_ID
 * @property {string} consumerKey    SNAPTRADE_CONSUMER_KEY
 * @property {string} [secret]       SNAPTRADE_SECRET (consumer secret)
 * @property {string} [callbackUrl]  SNAPTRADE_CALLBACK_URL
 * @property {string} [environment]  "production" (default) | "sandbox"
 */

/**
 * Resolves SnapTrade configuration from environment variables. Returns null
 * when the required credentials are absent (so callers can skip registration).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SnapTradeConfig|null}
 */
function resolveConfig(env = process.env) {
  const clientId = (env.SNAPTRADE_CLIENT_ID || "").trim();
  const consumerKey = (env.SNAPTRADE_CONSUMER_KEY || "").trim();
  if (!clientId || !consumerKey) return null;

  return {
    clientId,
    consumerKey,
    secret: (env.SNAPTRADE_SECRET || "").trim() || undefined,
    callbackUrl: (env.SNAPTRADE_CALLBACK_URL || "").trim() || undefined,
    environment: (env.SNAPTRADE_ENVIRONMENT || "production").trim().toLowerCase() === "sandbox"
      ? "sandbox"
      : "production"
  };
}

/** @type {{ client: import("snaptrade-typescript-sdk").Snaptrade, config: SnapTradeConfig } | null} */
let cached = null;

/**
 * Creates (once) and returns the configured SnapTrade SDK client instance.
 *
 * @param {SnapTradeConfig} [overrideConfig]  Force a config (used by tests).
 * @returns {import("snaptrade-typescript-sdk").Snaptrade}
 * @throws {Error} when required credentials are missing.
 */
function createSnapTradeClient(overrideConfig) {
  if (!overrideConfig && cached) return cached.client;

  const config = overrideConfig || resolveConfig();
  if (!config) {
    throw new Error(
      "SnapTrade is not configured: set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY."
    );
  }

  // The SDK accepts consumerKey at construction; the secret is passed per-call
  // via the `SnapTradeAPI` signature headers. We keep it on the client wrapper.
  const { Snaptrade } = require("snaptrade-typescript-sdk");
  const client = new Snaptrade({
    clientId: config.clientId,
    consumerKey: config.consumerKey
  });

  if (!overrideConfig) {
    cached = { client, config };
  }
  return client;
}

/**
 * Returns the resolved config (without re-instantiating). Exposed for the
 * adapter to read callbackUrl/environment without reaching into process.env.
 * @returns {SnapTradeConfig|null}
 */
function getConfig() {
  return cached?.config || resolveConfig();
}

/** Clears the cached client (test helper). */
function resetClient() {
  cached = null;
}

module.exports = {
  resolveConfig,
  createSnapTradeClient,
  getConfig,
  resetClient
};
