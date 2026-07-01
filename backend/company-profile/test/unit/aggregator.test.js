"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { CompanyProfileAggregator } = require("../../application/aggregator");
const { ProviderRegistry } = require("../../providers/registry");
const { BaseProvider } = require("../../providers/base");

class FakeProvider extends BaseProvider {
  constructor(name, data) {
    super(name, 50);
    this._data = data;
  }
  async getProfile(symbol) {
    return { ...this._data, symbol: symbol.toUpperCase(), metadata: { provider: this.name } };
  }
}

function makeRegistry(providers) {
  const registry = new ProviderRegistry();
  for (const p of providers) registry.register(p);
  return registry;
}

test("aggregator merges fields using provider priority", async () => {
  const registry = makeRegistry([
    new FakeProvider("fmp", {
      identity: { name: "FMP Name", description: "FMP summary" },
      market: { price: 100 }
    }),
    new FakeProvider("legacy", {
      identity: { name: "Legacy Name", description: "Legacy summary" },
      research: { overview: ["legacy note"] }
    })
  ]);

  const aggregator = new CompanyProfileAggregator({ registry });
  const profile = await aggregator.aggregate("AAPL");

  assert.strictEqual(profile.identity.name, "FMP Name"); // default merge uses registration order
  assert.deepStrictEqual(profile.research.overview, ["legacy note"]);
  assert.strictEqual(profile.metadata.providers.includes("fmp"), true);
});

test("aggregator prefers field preference order over registration order", async () => {
  const registry = makeRegistry([
    new FakeProvider("fmp", { research: { overview: ["fmp research"] } }),
    new FakeProvider("legacy", { research: { overview: ["legacy research"] } })
  ]);

  const aggregator = new CompanyProfileAggregator({ registry });
  const profile = await aggregator.aggregate("AAPL");

  // research.overview prefers legacy
  assert.deepStrictEqual(profile.research.overview, ["legacy research"]);
  assert.strictEqual(profile.metadata.fieldConfidence["research.overview"].provider, "legacy");
});

test("aggregator throws when no providers are healthy", async () => {
  const registry = makeRegistry([]);
  const aggregator = new CompanyProfileAggregator({ registry });
  await assert.rejects(() => aggregator.aggregate("AAPL"), /No healthy providers/);
});

test("aggregator throws when all providers fail", async () => {
  class BrokenProvider extends BaseProvider {
    constructor() { super("broken", 50); }
    async getProfile() { throw new Error("boom"); }
  }
  const registry = makeRegistry([new BrokenProvider()]);
  const aggregator = new CompanyProfileAggregator({ registry });
  await assert.rejects(() => aggregator.aggregate("AAPL"), /All providers failed/);
});

test("aggregator merges atomic object paths from preferred provider", async () => {
  const registry = makeRegistry([
    new FakeProvider("fmp", {
      filings: {
        latestAnnualReport: { form: "10-K", filingDate: "2025-01-01", url: "http://fmp/10k" }
      }
    }),
    new FakeProvider("legacy", {
      filings: {
        latestAnnualReport: { form: "10-K", filingDate: "2025-02-01", url: "http://legacy/10k" }
      }
    })
  ]);

  const aggregator = new CompanyProfileAggregator({ registry });
  const profile = await aggregator.aggregate("AAPL");

  assert.strictEqual(profile.filings.latestAnnualReport.url, "http://legacy/10k");
  assert.strictEqual(profile.filings.latestAnnualReport.filingDate, "2025-02-01");
});
