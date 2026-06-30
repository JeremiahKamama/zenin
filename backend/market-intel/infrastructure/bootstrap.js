/**
 * Market Intel Registry Bootstrap
 * ===============================
 *
 * Wires built-in provider adapters into a ProviderRegistry at startup.
 * This is the only place that knows which concrete providers exist.
 *
 * Adding a new provider:
 *   1. Implement MarketDataProvider in providers/<name>/
 *   2. Register it here when configured
 *   3. Set MARKET_DATA_PROVIDER=<key> to select it as default
 *
 * @module market-intel/infrastructure/bootstrap
 */

"use strict";

const { ProviderRegistry } = require("./ProviderRegistry");
const {
  createFmpProvider,
  isConfigured: isFmpConfigured
} = require("../providers/financial-modeling-prep");

/**
 * @typedef {Object} BootstrapOptions
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [defaultProviderKey]
 * @property {Object[]} [extraProviders]   Additional providers for testing
 */

/**
 * Creates a registry with all configured built-in providers registered.
 * @param {BootstrapOptions} [options]
 * @returns {ProviderRegistry}
 */
function createProviderRegistry(options = {}) {
  const env = options.env || process.env;
  const registry = new ProviderRegistry();

  if (isFmpConfigured(env)) {
    registry.registerProvider(createFmpProvider({ env }));
  }

  for (const provider of options.extraProviders || []) {
    registry.registerProvider(provider);
  }

  return registry;
}

// Process singleton
let _singleton = null;

/**
 * @param {BootstrapOptions} [options]
 * @returns {ProviderRegistry}
 */
function getProviderRegistry(options) {
  if (!_singleton) {
    _singleton = createProviderRegistry(options);
  }
  return _singleton;
}

function resetProviderRegistry() {
  _singleton = null;
}

module.exports = {
  createProviderRegistry,
  getProviderRegistry,
  resetProviderRegistry
};
