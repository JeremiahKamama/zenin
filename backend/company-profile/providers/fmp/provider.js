"use strict";

const { BaseProvider } = require("../base");
const client = require("./client");
const {
  mapProfile,
  mapQuote,
  mapKeyMetrics,
  mapRatios,
  mapFinancialGrowth,
  mapEnterpriseValues,
  mapRating,
  mapEarningsSurprises,
  mapSecFilings,
  mapExecutives,
  mapIncomeStatement,
  mapBalanceSheet,
  mapCashFlow,
  mapShortInterest,
  mapInsiderOwnership,
  mapInstitutionalOwnership,
  mergeFmpMappings,
  first
} = require("./mappers");

/**
 * Financial Modeling Prep provider.
 *
 * Primary data source. Fetches profile, quote, key metrics, ratios,
 * financial growth, enterprise values, ratings, earnings surprises,
 * SEC filings, and financial statements in parallel.
 */
class FmpProvider extends BaseProvider {
  constructor() {
    super("fmp", 10);
    this._enabled = true;
  }

  health() {
    return { ok: this._enabled, reason: this._enabled ? undefined : "disabled" };
  }

  async getProfile(symbol, { timeoutMs = 800 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const results = await this._fetchAll(symbol, controller.signal);
      return mergeFmpMappings(symbol, [
        mapProfile(first(results.profile)),
        mapQuote(first(results.quote)),
        mapKeyMetrics(first(results.keyMetrics)),
        mapRatios(first(results.ratios)),
        mapFinancialGrowth(first(results.financialGrowth)),
        mapEnterpriseValues(first(results.enterpriseValues)),
        mapRating(first(results.rating)),
        mapEarningsSurprises(results.earningsSurprises),
        mapSecFilings(results.secFilings),
        mapExecutives(results.keyExecutives),
        mapIncomeStatement(first(results.incomeStatement)),
        mapBalanceSheet(first(results.balanceSheet)),
        mapCashFlow(first(results.cashFlowStatement)),
        mapShortInterest(first(results.shortInterest)),
        mapInsiderOwnership(first(results.insiderOwnership)),
        mapInstitutionalOwnership(results.institutionalOwnership)
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async _fetchAll(symbol, signal) {
    const s = String(symbol).toUpperCase();
    const opts = { signal };

    const calls = {
      profile: client.get(`/profile/${s}`, {}, opts).catch(() => []),
      quote: client.get(`/quote/${s}`, {}, opts).catch(() => []),
      keyMetrics: client.get(`/key-metrics/${s}`, { limit: "1" }, opts).catch(() => []),
      ratios: client.get(`/ratios/${s}`, { limit: "1" }, opts).catch(() => []),
      financialGrowth: client.get(`/financial-growth/${s}`, { limit: "1" }, opts).catch(() => []),
      enterpriseValues: client.get(`/enterprise-values/${s}`, { limit: "1" }, opts).catch(() => []),
      rating: client.get(`/rating/${s}`, {}, opts).catch(() => []),
      earningsSurprises: client.get(`/earnings-surprises/${s}`, {}, opts).catch(() => []),
      secFilings: client.get(`/sec-filings/${s}`, { limit: "10" }, opts).catch(() => []),
      keyExecutives: client.get(`/key-executives/${s}`, {}, opts).catch(() => []),
      incomeStatement: client.get(`/income-statement/${s}`, { limit: "1" }, opts).catch(() => []),
      balanceSheet: client.get(`/balance-sheet-statement/${s}`, { limit: "1" }, opts).catch(() => []),
      cashFlowStatement: client.get(`/cash-flow-statement/${s}`, { limit: "1" }, opts).catch(() => []),
      shortInterest: client.get(`/short-interest/${s}`, {}, opts).catch(() => []),
      insiderOwnership: client.get(`/insider-ownership/${s}`, {}, opts).catch(() => []),
      institutionalOwnership: client.get(`/institutional-ownership/${s}`, {}, opts).catch(() => [])
    };

    const entries = await Promise.all(Object.entries(calls).map(async ([key, promise]) => [key, await promise]));
    return Object.fromEntries(entries);
  }
}

module.exports = { FmpProvider };
