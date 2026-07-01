"use strict";

/**
 * Simple metrics emitter for the company profile service.
 *
 * Events:
 *   provider.success  { provider, symbol, latencyMs }
 *   provider.error    { provider, symbol, latencyMs, error, rateLimited }
 *   aggregate.complete { symbol, providerCount, successCount, latencyMs }
 *   cache.hit         { symbol }
 *   cache.miss        { symbol }
 *   stale.served      { symbol, reason }
 *   refresh.start     { symbol }
 *   refresh.complete  { symbol, latencyMs }
 *   refresh.error     { symbol, error }
 */
class Metrics {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this._counts = new Map();
    this._latencies = new Map();
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this._staleServed = 0;
    this._providerErrors = new Map();
    this._rateLimited = 0;
    this._startTime = Date.now();
  }

  emit(event, payload) {
    this._counts.set(event, (this._counts.get(event) || 0) + 1);

    if (event === "cache.hit") this._cacheHits++;
    if (event === "cache.miss") this._cacheMisses++;
    if (event === "stale.served") this._staleServed++;
    if (event === "provider.error" && payload?.rateLimited) this._rateLimited++;
    if (event === "provider.error" && payload?.provider) {
      this._providerErrors.set(payload.provider, (this._providerErrors.get(payload.provider) || 0) + 1);
    }

    if (payload?.latencyMs != null) {
      const list = this._latencies.get(event) || [];
      list.push(payload.latencyMs);
      if (list.length > 1000) list.shift();
      this._latencies.set(event, list);
    }

    if (event.endsWith(".error") || event.endsWith(".failed")) {
      this.logger.warn(`[company-profile] ${event}`, payload);
    } else {
      this.logger.info(`[company-profile] ${event}`, payload);
    }
  }

  _percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  _latencySummary(event) {
    const list = (this._latencies.get(event) || []).slice().sort((a, b) => a - b);
    return {
      count: list.length,
      p50: this._percentile(list, 0.5),
      p95: this._percentile(list, 0.95),
      p99: this._percentile(list, 0.99),
      min: list[0] || null,
      max: list[list.length - 1] || null
    };
  }

  summary() {
    const totalCache = this._cacheHits + this._cacheMisses;
    return {
      uptimeSeconds: Math.floor((Date.now() - this._startTime) / 1000),
      eventCounts: Object.fromEntries(this._counts),
      cacheHitRatio: totalCache ? this._cacheHits / totalCache : null,
      cacheHits: this._cacheHits,
      cacheMisses: this._cacheMisses,
      staleServed: this._staleServed,
      rateLimited: this._rateLimited,
      providerErrors: Object.fromEntries(this._providerErrors),
      latencies: {
        aggregate: this._latencySummary("aggregate.complete"),
        provider: this._latencySummary("provider.success"),
        refresh: this._latencySummary("refresh.complete")
      }
    };
  }
}

module.exports = { Metrics };
