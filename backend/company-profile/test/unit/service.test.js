"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { CompanyProfileService } = require("../../application/service");
const { CompanyProfileAggregator } = require("../../application/aggregator");
const { BaseProvider } = require("../../providers/base");

class FakeCache {
  constructor() { this._store = new Map(); }
  _key(params) { return JSON.stringify(params); }
  async get(params) { return this._store.get(this._key(params)) || null; }
  async set(params, payload) { this._store.set(this._key(params), payload); }
  async getOrCompute(params, _ttl, factory) {
    const key = this._key(params);
    const cached = this._store.get(key);
    if (cached) return { payload: cached, fromCache: true };
    const payload = await factory();
    this._store.set(key, payload);
    return { payload, fromCache: false };
  }
  stats() { return {}; }
}

class StaticProvider extends BaseProvider {
  constructor(data) { super("static", 50); this._data = data; }
  async getProfile(symbol) {
    return {
      symbol: symbol.toUpperCase(),
      identity: { name: this._data.name },
      company: { sector: this._data.sector },
      metadata: { provider: this.name }
    };
  }
}

test("service renders legacy response with catalog enrichment", async () => {
  const registry = { healthy: () => [new StaticProvider({ name: "Apple", sector: "Technology" })] };
  const aggregator = new CompanyProfileAggregator({ registry });
  const service = new CompanyProfileService({
    registry,
    cache: new FakeCache(),
    catalogEnricher: (_symbol, theme, category) => ({
      catalog: { theme: theme || null, category: category || null, role: "core", edge: null, market: "US" },
      peers: [{ symbol: "MSFT", name: "Microsoft" }],
      manufacturing: { efficiencySignals: ["signal"] }
    })
  });
  service.aggregator = aggregator;

  const response = await service.getProfile("AAPL", { theme: "tech", category: "mega" });

  assert.strictEqual(response.symbol, "AAPL");
  assert.strictEqual(response.name, "Apple");
  assert.strictEqual(response.sector, "Technology");
  assert.strictEqual(response.catalog.theme, "tech");
  assert.strictEqual(response.catalog.category, "mega");
  assert.strictEqual(response.peers[0].symbol, "MSFT");
  assert.deepStrictEqual(response.manufacturing.efficiencySignals, ["signal"]);
  assert.strictEqual(response.stale, false);
  assert.strictEqual(response.unavailable, false);
});

test("service returns cached response on second call", async () => {
  let calls = 0;
  class CountingProvider extends BaseProvider {
    constructor() { super("counting", 50); }
    async getProfile(symbol) {
      calls++;
      return { symbol: symbol.toUpperCase(), identity: { name: "Cached" } };
    }
  }
  const registry = { healthy: () => [new CountingProvider()] };
  const service = new CompanyProfileService({ registry, cache: new FakeCache() });
  service.aggregator = new CompanyProfileAggregator({ registry });

  const first = await service.getProfile("TSLA");
  const second = await service.getProfile("TSLA");

  assert.strictEqual(calls, 1);
  assert.strictEqual(first.name, "Cached");
  assert.strictEqual(second.name, "Cached");
});
