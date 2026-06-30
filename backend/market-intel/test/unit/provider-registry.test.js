/**
 * Unit tests: Provider Registry
 */

"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { ProviderRegistry } = require("../../infrastructure/ProviderRegistry");
const { ProviderNotFoundError } = require("../../domain/errors");

function makeMockProvider(key = "fmp", displayName = "Financial Modeling Prep") {
  return {
    providerKey: key,
    displayName,
    getQuote: async () => ({}),
    getQuotes: async () => ([]),
    searchCompanies: async () => ([]),
    getCompanyProfile: async () => ({}),
    getHistoricalPrices: async () => ({}),
    getNews: async () => ([]),
    getDividends: async () => ([]),
    getDividendCalendar: async () => ([]),
    getEarnings: async () => ([]),
    getEarningsCalendar: async () => ([]),
    getInsiderTrading: async () => ([]),
    getIncomeStatements: async () => ([]),
    getBalanceSheets: async () => ([]),
    getCashFlowStatements: async () => ([]),
    getFinancialRatios: async () => ([]),
    getKeyMetrics: async () => ([]),
    getAnalystRatings: async () => ({}),
    getMarketStatus: async () => ({}),
    getEconomicCalendar: async () => ([]),
    getCompanyExecutives: async () => ([]),
    healthCheck: async () => ({ status: "healthy", latencyMs: 1, checkedAt: new Date().toISOString() })
  };
}

describe("ProviderRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("registers a valid provider", () => {
    const summary = registry.registerProvider(makeMockProvider());
    assert.strictEqual(summary.providerKey, "fmp");
    assert.strictEqual(summary.displayName, "Financial Modeling Prep");
  });

  it("normalizes providerKey to lowercase", () => {
    registry.registerProvider(makeMockProvider("FMP"));
    const provider = registry.getProvider("fmp");
    assert.strictEqual(provider.providerKey, "fmp");
  });

  it("throws on duplicate providerKey", () => {
    registry.registerProvider(makeMockProvider("fmp"));
    assert.throws(
      () => registry.registerProvider(makeMockProvider("fmp")),
      /already registered/
    );
  });

  it("throws on invalid provider", () => {
    assert.throws(
      () => registry.registerProvider({ providerKey: "bad" }),
      TypeError
    );
  });

  it("getProvider throws for unregistered key", () => {
    assert.throws(
      () => registry.getProvider("unknown"),
      ProviderNotFoundError
    );
  });

  it("defaultProvider returns first registered", () => {
    registry.registerProvider(makeMockProvider("first", "First"));
    registry.registerProvider(makeMockProvider("second", "Second"));
    const provider = registry.defaultProvider();
    assert.strictEqual(provider.providerKey, "first");
  });

  it("defaultProvider respects env var", () => {
    const prev = process.env.MARKET_DATA_PROVIDER;
    try {
      registry.registerProvider(makeMockProvider("first", "First"));
      registry.registerProvider(makeMockProvider("second", "Second"));
      process.env.MARKET_DATA_PROVIDER = "second";
      const provider = registry.defaultProvider();
      assert.strictEqual(provider.providerKey, "second");
    } finally {
      process.env.MARKET_DATA_PROVIDER = prev;
    }
  });

  it("defaultProvider throws when registry is empty", () => {
    assert.throws(
      () => registry.defaultProvider(),
      ProviderNotFoundError
    );
  });

  it("listProviders returns summaries", () => {
    registry.registerProvider(makeMockProvider("fmp", "FMP"));
    registry.registerProvider(makeMockProvider("polygon", "Polygon"));
    const list = registry.listProviders();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].providerKey, "fmp");
    assert.strictEqual(list[1].providerKey, "polygon");
    // Ensure provider instances are not exposed
    assert.strictEqual(typeof list[0].getQuote, "undefined");
  });

  it("hasProvider check", () => {
    registry.registerProvider(makeMockProvider("fmp"));
    assert.strictEqual(registry.hasProvider("fmp"), true);
    assert.strictEqual(registry.hasProvider("FMP"), true);
    assert.strictEqual(registry.hasProvider("unknown"), false);
  });

  it("clear() removes all providers", () => {
    registry.registerProvider(makeMockProvider("fmp"));
    registry.clear();
    assert.strictEqual(registry.listProviders().length, 0);
  });
});
