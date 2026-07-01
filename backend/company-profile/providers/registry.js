"use strict";

const { BaseProvider } = require("./base");

/**
 * Provider registry.
 *
 * Providers are registered by name and sorted by priority (ascending).
 * New providers (Finnhub, Polygon, Intrinio, Alpha Vantage) can be added
 * without changing application code.
 */
class ProviderRegistry {
  constructor() {
    /** @type {BaseProvider[]} */
    this._providers = [];
  }

  /**
   * Register a provider instance.
   * @param {BaseProvider} provider
   * @returns {ProviderRegistry}
   */
  register(provider) {
    if (!(provider instanceof BaseProvider)) {
      throw new Error("Provider must extend BaseProvider");
    }
    const existing = this._providers.findIndex((p) => p.name === provider.name);
    if (existing >= 0) this._providers.splice(existing, 1);
    this._providers.push(provider);
    this._providers.sort((a, b) => a.priority - b.priority);
    return this;
  }

  /**
   * Remove a provider by name.
   * @param {string} name
   * @returns {ProviderRegistry}
   */
  unregister(name) {
    this._providers = this._providers.filter((p) => p.name !== name);
    return this;
  }

  /**
   * Return all registered providers in priority order.
   * @returns {BaseProvider[]}
   */
  all() {
    return [...this._providers];
  }

  /**
   * Return providers that report healthy.
   * @returns {BaseProvider[]}
   */
  healthy() {
    return this._providers.filter((p) => p.health().ok);
  }

  /**
   * Get a single provider by name.
   * @param {string} name
   * @returns {BaseProvider | undefined}
   */
  get(name) {
    return this._providers.find((p) => p.name === name);
  }
}

module.exports = { ProviderRegistry };
