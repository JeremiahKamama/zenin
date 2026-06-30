/**
 * Market Data Provider Registry
 * =============================
 *
 * Central registry for market data provider adapters. The application layer
 * resolves providers through this registry — never by importing a specific
 * adapter directly.
 *
 * Registration validates the MarketDataProvider contract at insert time.
 *
 * @module market-intel/infrastructure/ProviderRegistry
 */

"use strict";

const { assertProviderContract } = require("../domain/MarketDataProvider");
const { ProviderNotFoundError } = require("../domain/errors");

/**
 * @typedef {Object} ProviderSummary
 * @property {string} providerKey
 * @property {string} displayName
 */

class ProviderRegistry {
  constructor() {
    /** @type {Map<string, Object>} */
    this._providers = new Map();
    /** @type {string[]} insertion order */
    this._registrationOrder = [];
  }

  /**
   * Registers a provider adapter. providerKey must be unique.
   * @param {Object} provider
   * @returns {ProviderSummary}
   * @throws {TypeError|Error}
   */
  registerProvider(provider) {
    assertProviderContract(provider);

    const key = normalizeProviderKey(provider.providerKey);
    if (this._providers.has(key)) {
      throw new Error(`Market data provider "${key}" is already registered.`);
    }

    provider.providerKey = key;
    this._providers.set(key, provider);
    this._registrationOrder.push(key);

    return { providerKey: key, displayName: provider.displayName };
  }

  /**
   * Returns a registered provider by key.
   * @param {string} providerKey
   * @returns {Object}
   * @throws {ProviderNotFoundError}
   */
  getProvider(providerKey) {
    const key = normalizeProviderKey(providerKey);
    const provider = this._providers.get(key);
    if (!provider) {
      throw new ProviderNotFoundError(key);
    }
    return provider;
  }

  /**
   * Returns the configured default provider.
   * Resolution: explicit option > env > first registered.
   * @param {{ defaultProviderKey?: string }} [options]
   * @returns {Object}
   * @throws {ProviderNotFoundError}
   */
  defaultProvider(options = {}) {
    const configuredKey =
      options.defaultProviderKey ||
      (typeof process.env.MARKET_DATA_PROVIDER === "string"
        ? process.env.MARKET_DATA_PROVIDER.trim()
        : "");

    if (configuredKey) {
      return this.getProvider(configuredKey);
    }

    const firstKey = this._registrationOrder[0];
    if (!firstKey) {
      throw new ProviderNotFoundError("default");
    }

    return this.getProvider(firstKey);
  }

  /**
   * Lists registered providers without exposing adapter instances.
   * @returns {ProviderSummary[]}
   */
  listProviders() {
    return this._registrationOrder.map((key) => ({
      providerKey: key,
      displayName: this._providers.get(key)?.displayName || key
    }));
  }

  /**
   * @param {string} providerKey
   * @returns {boolean}
   */
  hasProvider(providerKey) {
    return this._providers.has(normalizeProviderKey(providerKey));
  }

  /** Reset for testing. */
  clear() {
    this._providers.clear();
    this._registrationOrder.length = 0;
  }
}

/**
 * @param {string} providerKey
 * @returns {string}
 */
function normalizeProviderKey(providerKey) {
  if (typeof providerKey !== "string" || !providerKey.trim()) {
    throw new TypeError("providerKey must be a non-empty string.");
  }
  return providerKey.trim().toLowerCase();
}

module.exports = {
  ProviderRegistry,
  normalizeProviderKey
};
