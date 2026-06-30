/**
 * Brokerage Registry Bootstrap
 * ============================
 *
 * Wires built-in provider adapters into a BrokerageRegistry at startup.
 * This is the only place that should know which concrete providers exist;
 * the application layer receives the registry and calls defaultProvider().
 *
 * Adding a new provider:
 *   1. Implement BrokerageProvider in providers/<name>/.
 *   2. Register it here when configured.
 *   3. Set BROKERAGE_PROVIDER=<key> to select it as the default.
 */

"use strict";

const { BrokerageRegistry } = require("./BrokerageRegistry");
const {
  createSnapTradeProvider,
  isConfigured: isSnapTradeConfigured
} = require("../providers/snaptrade");

/**
 * @typedef {Object} BootstrapOptions
 * @property {NodeJS.ProcessEnv} [env]              Environment (defaults to process.env).
 * @property {string} [defaultProviderKey]          Override BROKERAGE_PROVIDER.
 * @property {import("../domain/BrokerageProvider").BrokerageProvider[]} [extraProviders]
 *   Additional providers to register (useful in tests).
 * @property {import("snaptrade-typescript-sdk").Snaptrade} [snaptradeClient]
 *   Inject SnapTrade client for tests.
 */

/**
 * Creates a registry with all configured built-in providers registered.
 *
 * @param {BootstrapOptions} [options]
 * @returns {BrokerageRegistry}
 */
function createBrokerageRegistry(options = {}) {
  const env = options.env || process.env;
  const registry = new BrokerageRegistry();

  if (isSnapTradeConfigured(env)) {
    registry.registerProvider(
      createSnapTradeProvider({
        client: options.snaptradeClient,
        config: options.snaptradeConfig
      })
    );
  }

  for (const provider of options.extraProviders || []) {
    registry.registerProvider(provider);
  }

  return registry;
}

/**
 * Singleton registry for the running process. Lazily initialized on first access
 * so require()-time never crashes when provider credentials are absent.
 *
 * @param {BootstrapOptions} [options]  Passed only on first call; ignored thereafter.
 * @returns {BrokerageRegistry}
 */
let _singleton = null;

function getBrokerageRegistry(options) {
  if (!_singleton) {
    _singleton = createBrokerageRegistry(options);
  }
  return _singleton;
}

/** Resets the process singleton. For unit tests only. */
function resetBrokerageRegistry() {
  _singleton = null;
}

module.exports = {
  createBrokerageRegistry,
  getBrokerageRegistry,
  resetBrokerageRegistry
};
