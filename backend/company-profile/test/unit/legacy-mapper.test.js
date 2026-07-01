"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { mapLegacyToCanonical } = require("../../providers/legacy/mapper");

test("maps flat legacy fields to canonical model", () => {
  const legacy = {
    symbol: "AAPL",
    name: "Apple Inc.",
    shortName: "Apple",
    summary: "Makes iPhones",
    website: "https://apple.com",
    phone: "1-800-MY-APPLE",
    sector: "Technology",
    industry: "Consumer Electronics",
    country: "United States",
    state: "CA",
    city: "Cupertino",
    zip: "95014",
    address1: "One Apple Park Way",
    employees: 161000,
    exchange: "NASDAQ",
    currency: "USD",
    currentPrice: 175.5,
    marketCap: 2700000000000,
    fiftyTwoWeekLow: 124,
    fiftyTwoWeekHigh: 199,
    beta: 1.2,
    totalRevenue: 380000000000,
    revenueGrowth: 0.05,
    grossMargins: 0.45,
    trailingPE: 28,
    enterpriseValue: 2800000000000,
    analystRating: "buy",
    analystCount: 42,
    targetMeanPrice: 190,
    topAnalystTarget: 220,
    topAnalystAgency: "Goldman Sachs"
  };

  const p = mapLegacyToCanonical(legacy);

  assert.strictEqual(p.symbol, "AAPL");
  assert.strictEqual(p.identity.name, "Apple Inc.");
  assert.strictEqual(p.identity.description, "Makes iPhones");
  assert.strictEqual(p.company.sector, "Technology");
  assert.strictEqual(p.company.employees, 161000);
  assert.strictEqual(p.market.price, 175.5);
  assert.strictEqual(p.market.marketCap, 2700000000000);
  assert.strictEqual(p.financials.totalRevenue, 380000000000);
  assert.strictEqual(p.financials.grossMargins, 0.45);
  assert.strictEqual(p.valuation.trailingPE, 28);
  assert.strictEqual(p.analyst.rating, "buy");
  assert.strictEqual(p.analyst.topTarget, 220);
});

test("maps nested earnings and filings", () => {
  const legacy = {
    symbol: "TSLA",
    earnings: {
      nextEarnings: "2026-01-29",
      eps: { consensus: 0.85, previous: 0.72 },
      revenue: { consensus: 26000000000, previous: 25000000000 }
    },
    earningsHistory: [
      { date: "2025-10-22", epsEstimate: 0.8, reportedEps: 0.82, surprisePct: 0.025 }
    ],
    filings: {
      latestAnnualReport: { form: "10-K", filingDate: "2025-02-15", url: "http://sec.gov/10k" },
      sicDescription: "Motor Vehicles & Passenger Car Bodies",
      facts: { "TotalRevenue": { value: 25000000000 } }
    },
    risk: {
      overallRisk: 4,
      auditRisk: 2,
      boardRisk: 3,
      compensationRisk: 5,
      shareHolderRightsRisk: 4
    }
  };

  const p = mapLegacyToCanonical(legacy);

  assert.strictEqual(p.earnings.nextEarnings, "2026-01-29T00:00:00.000Z");
  assert.strictEqual(p.earnings.epsEstimate, 0.85);
  assert.strictEqual(p.earnings.history[0].reportedEps, 0.82);
  assert.strictEqual(p.filings.latestAnnualReport.form, "10-K");
  assert.strictEqual(p.filings.sicDescription, "Motor Vehicles & Passenger Car Bodies");
  assert.strictEqual(p.risk.overall, 4);
});

test("ignores missing optional fields", () => {
  const p = mapLegacyToCanonical({ symbol: "META" });
  assert.strictEqual(p.symbol, "META");
  assert.strictEqual(p.identity.name, undefined);
  assert.deepStrictEqual(p.leadership, []);
  assert.deepStrictEqual(p.sources, []);
});
