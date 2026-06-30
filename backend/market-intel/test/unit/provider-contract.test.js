/**
 * Unit tests: Provider contract validation
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertProviderContract,
  REQUIRED_METHODS,
  REQUIRED_FIELDS
} = require("../../domain/MarketDataProvider");

function makeMockProvider(overrides = {}) {
  const base = {
    providerKey: "mock",
    displayName: "Mock Provider",
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
    healthCheck: async () => ({ status: "healthy", latencyMs: 1, checkedAt: new Date().toISOString() }),
    ...overrides
  };
  return base;
}

describe("MarketDataProvider Contract", () => {
  it("validates a complete provider", () => {
    const provider = makeMockProvider();
    const result = assertProviderContract(provider);
    assert.ok(result);
  });

  it("rejects null/undefined", () => {
    assert.throws(() => assertProviderContract(null), TypeError);
    assert.throws(() => assertProviderContract(undefined), TypeError);
  });

  it("rejects missing providerKey", () => {
    const provider = makeMockProvider({ providerKey: undefined });
    assert.throws(() => assertProviderContract(provider), TypeError);
  });

  it("rejects empty providerKey", () => {
    const provider = makeMockProvider({ providerKey: "  " });
    assert.throws(() => assertProviderContract(provider), TypeError);
  });

  it("rejects missing methods", () => {
    const provider = makeMockProvider({ getQuote: undefined });
    assert.throws(() => assertProviderContract(provider), TypeError);
  });

  it("rejects methods that are not functions", () => {
    const provider = makeMockProvider({ getQuote: "not-a-function" });
    assert.throws(() => assertProviderContract(provider), TypeError);
  });

  it("rejects missing displayName", () => {
    const provider = makeMockProvider({ displayName: undefined });
    assert.throws(() => assertProviderContract(provider), TypeError);
  });

  it("has all required methods in the REQUIRED_METHODS list", () => {
    assert.strictEqual(REQUIRED_METHODS.length, 21);
  });
});
