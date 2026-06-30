/**
 * Brokerage Provider Registry
 * ===========================
 *
 * Central registry for brokerage provider adapters. The application layer
 * resolves providers through this registry — never by importing a specific
 * adapter package directly.
 *
 * Registration validates the BrokerageProvider contract at insert time so
 * malformed adapters fail fast during bootstrap, not at request time.
 *
 * Usage:
 *   const registry = createBrokerageRegistry();
 *   const provider = registry.defaultProvider();
 *   const caps = registry.providerCapabilities(provider.providerKey);
 */

"use strict";

const { assertProviderContract } = require("../domain/BrokerageProvider");
const { normalizeCapabilities } = require("../domain/capabilities");
const { BrokerageProviderNotFound } = require("../domain/errors");

/**
 * @typedef {Object} ProviderSummary
 * @property {string} providerKey
 * @property {string} displayName
 * @property {import("../domain/capabilities").BrokerageCapabilitySet} capabilities
 */

class BrokerageRegistry {
  constructor() {
    /** @type {Map<string, import("../domain/BrokerageProvider").BrokerageProvider>} */
    this._providers = new Map();
    /** @type {string[]} insertion order for deterministic default fallback */
    this._registrationOrder = [];
  }

  /**
   * Registers a provider adapter. The providerKey must be unique.
   *
   * @param {import("../domain/BrokerageProvider").BrokerageProvider} provider
   * @returns {ProviderSummary}
   * @throws {TypeError} when the contract is invalid.
   * @throws {Error} when the providerKey is already registered.
   */
  registerProvider(provider) {
    assertProviderContract(provider);

    const key = normalizeProviderKey(provider.providerKey);
    if (this._providers.has(key)) {
      throw new Error(`Brokerage provider "${key}" is already registered.`);
    }

    provider.providerKey = key;
    provider.capabilities = normalizeCapabilities(provider.capabilities).capabilities;

    this._providers.set(key, provider);
    this._registrationOrder.push(key);

    return summarizeProvider(provider);
  }

  /**
   * Returns a registered provider by key.
   *
   * @param {string} providerKey
   * @returns {import("../domain/BrokerageProvider").BrokerageProvider}
   * @throws {BrokerageProviderNotFound}
   */
  getProvider(providerKey) {
    const key = normalizeProviderKey(providerKey);
    const provider = this._providers.get(key);
    if (!provider) {
      throw new BrokerageProviderNotFound(
        `Brokerage provider "${key}" is not registered.`,
        { providerKey: key }
      );
    }
    return provider;
  }

  /**
   * Returns the configured default provider.
   *
   * Resolution order:
   *   1. Explicit `defaultProviderKey` option passed to the registry factory.
   *   2. `BROKERAGE_PROVIDER` environment variable.
   *   3. First registered provider (insertion order).
   *
   * @param {{ defaultProviderKey?: string, env?: NodeJS.ProcessEnv }} [options]
   * @returns {import("../domain/BrokerageProvider").BrokerageProvider}
   * @throws {BrokerageProviderNotFound}
   */
  defaultProvider(options = {}) {
    const env = options.env || process.env;
    const configuredKey =
      options.defaultProviderKey ||
      (typeof env.BROKERAGE_PROVIDER === "string" ? env.BROKERAGE_PROVIDER.trim() : "");

    if (configuredKey) {
      return this.getProvider(configuredKey);
    }

    const firstKey = this._registrationOrder[0];
    if (!firstKey) {
      throw new BrokerageProviderNotFound(
        "No brokerage providers are registered.",
        { providerKey: null }
      );
    }

    return this.getProvider(firstKey);
  }

  /**
   * Returns capability flags for a registered provider.
   *
   * @param {string} providerKey
   * @returns {import("../domain/capabilities").BrokerageCapabilitySet}
   * @throws {BrokerageProviderNotFound}
   */
  providerCapabilities(providerKey) {
    return { ...this.getProvider(providerKey).capabilities };
  }

  /**
   * Lists registered providers without exposing adapter instances.
   *
   * @returns {ProviderSummary[]}
   */
  listProviders() {
    return this._registrationOrder.map((key) => summarizeProvider(this._providers.get(key)));
  }

  /**
   * @param {string} providerKey
   * @returns {boolean}
   */
  hasProvider(providerKey) {
    return this._providers.has(normalizeProviderKey(providerKey));
  }

  /**
   * Removes all registered providers. Intended for unit tests only.
   */
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

/**
 * @param {import("../domain/BrokerageProvider").BrokerageProvider} provider
 * @returns {ProviderSummary}
 */
function summarizeProvider(provider) {
  return {
    providerKey: provider.providerKey,
    displayName: provider.displayName,
    capabilities: { ...provider.capabilities }
  };
}

module.exports = {
  BrokerageRegistry,
  normalizeProviderKey,
  summarizeProvider
};
