"use strict";

const { toLegacyResponse } = require("../domain/models");
const { LayeredCache } = require("../infrastructure/cache");
const { Metrics } = require("../infrastructure/metrics");
const { CompanyProfileAggregator } = require("./aggregator");
const { ProviderRegistry } = require("../providers/registry");
const { FmpProvider } = require("../providers/fmp/provider");
const { LegacyProvider } = require("../providers/legacy/provider");
const { createRedisClient } = require("../infrastructure/redis");

const CACHE_TTLS_MS = {
  memory: 5 * 60 * 1000,
  persistent: 60 * 60 * 1000,
  stale: 24 * 60 * 60 * 1000
};

/**
 * CompanyProfileService
 *
 * Entry point for fetching company profiles. Handles:
 *   - provider registry
 *   - layered caching
 *   - request collapsing
 *   - stale-while-revalidate
 *   - enrichment (catalog, peers, manufacturing)
 *   - backward-compatible response rendering
 */
class CompanyProfileService {
  constructor({
    registry,
    cache,
    metrics,
    runtimeConfig = {},
    catalogEnricher = null,
    redisClient = null,
    backgroundRefresh = true
  } = {}) {
    this.registry = registry || this._defaultRegistry();
    this.cache = cache || new LayeredCache({ redisClient: redisClient || createRedisClient() });
    this.metrics = metrics || new Metrics();
    this.aggregator = new CompanyProfileAggregator({ registry: this.registry, metrics: this.metrics });
    this.runtimeConfig = runtimeConfig;
    this.catalogEnricher = catalogEnricher;
    this.backgroundRefresh = backgroundRefresh;
    this._refreshing = new Set();
  }

  _defaultRegistry() {
    const registry = new ProviderRegistry();
    registry.register(new FmpProvider());
    registry.register(new LegacyProvider());
    return registry;
  }

  /**
   * Fetch a company profile.
   *
   * @param {string} symbol
   * @param {Object} options
   * @param {string} [options.theme]
   * @param {string} [options.category]
   * @param {boolean} [options.allowStale=true]
   * @returns {Promise<Object>} legacy-shaped response
   */
  async getProfile(symbol, options = {}) {
    const {
      theme = "",
      category = "",
      allowStale = true
    } = options;

    const params = { symbol: String(symbol).toUpperCase(), theme, category };
    const freshTtl = this.runtimeConfig.companyProfileCacheTtlMs || 15 * 60 * 1000;

    // Try fresh cache first.
    const cached = await this.cache.get(params, freshTtl);
    if (cached) {
      this.metrics.emit("cache.hit", { symbol });
      return cached;
    }
    this.metrics.emit("cache.miss", { symbol });

    // Try to fetch and compute.
    try {
      const { payload } = await this.cache.getOrCompute(params, freshTtl, async () => {
        const canonical = await this.aggregator.aggregate(symbol, { theme, category });
        return this._render(canonical, { symbol, theme, category });
      });

      return payload;
    } catch (err) {
      // If fresh fetch fails, try to serve stale cache.
      if (allowStale) {
        const stale = await this.cache.get(params, CACHE_TTLS_MS.stale);
        if (stale) {
          this.metrics.emit("stale.served", { symbol, reason: err.message });
          this._maybeRefresh(params, symbol, theme, category);
          return {
            ...stale,
            stale: true,
            stale_reason: err.message,
            updatedAt: stale.updatedAt || new Date().toISOString()
          };
        }
      }
      throw err;
    }
  }

  /**
   * Trigger a background refresh if not already refreshing this key.
   */
  _maybeRefresh(params, symbol, theme, category, _freshTtl) {
    if (!this.backgroundRefresh) return;
    const key = this.cache._key(params);
    if (this._refreshing.has(key)) return;
    this._refreshing.add(key);

    Promise.resolve()
      .then(async () => {
        const startedAt = Date.now();
        this.metrics.emit("refresh.start", { symbol });
        const canonical = await this.aggregator.aggregate(symbol, { theme, category });
        const rendered = this._render(canonical, { symbol, theme, category });
        await this.cache.set(params, rendered);
        this.metrics.emit("refresh.complete", { symbol, latencyMs: Date.now() - startedAt });
      })
      .catch((err) => {
        this.metrics.emit("refresh.error", { symbol, error: err.message });
      })
      .finally(() => {
        this._refreshing.delete(key);
      });
  }

  _render(canonical, { symbol, theme, category }) {
    const enrichment = this.catalogEnricher
      ? this.catalogEnricher(symbol, theme, category)
      : {};
    const catalog = enrichment.catalog || {};
    const peers = enrichment.peers || [];
    const manufacturing = enrichment.manufacturing || {};

    const response = toLegacyResponse(canonical, { catalog, peers });
    response.manufacturing = manufacturing;
    response.stale = false;
    response.unavailable = false;
    return response;
  }

  stats() {
    const breakers = {};
    for (const provider of this.registry.all()) {
      if (provider.breaker) breakers[provider.name] = provider.breaker.state();
    }
    return {
      providers: this.registry.all().map((p) => ({ name: p.name, priority: p.priority, healthy: p.health() })),
      breakers,
      metrics: this.metrics.summary(),
      cache: this.cache.stats()
    };
  }
}

module.exports = { CompanyProfileService, CACHE_TTLS_MS };
