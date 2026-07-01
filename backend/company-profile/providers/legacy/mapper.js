"use strict";

const { createEmptyProfile, numOrNull, strOrUndefined } = require("../../domain/models");

function parseDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function mapLeadership(list) {
  return Array.isArray(list)
    ? list
        .filter((p) => p && p.name)
        .map((p) => ({
          name: strOrUndefined(p.name),
          title: strOrUndefined(p.title),
          age: numOrNull(p.age)
        }))
    : [];
}

function mapEarningsHistory(list) {
  return Array.isArray(list)
    ? list.map((row) => ({
        date: parseDate(row.date),
        epsEstimate: numOrNull(row.epsEstimate),
        reportedEps: numOrNull(row.reportedEps),
        surprisePct: numOrNull(row.surprisePct)
      }))
    : [];
}

function mapFiling(f) {
  if (!f || !f.filingDate) return null;
  return {
    form: strOrUndefined(f.form),
    filingDate: parseDate(f.filingDate),
    url: strOrUndefined(f.url)
  };
}

/**
 * Convert the legacy Python pipeline response into the canonical model.
 */
function mapLegacyToCanonical(legacy) {
  const l = legacy || {};
  const profile = createEmptyProfile(l.symbol);

  profile.identity = {
    name: strOrUndefined(l.name),
    shortName: strOrUndefined(l.shortName),
    description: strOrUndefined(l.summary),
    website: strOrUndefined(l.website),
    phone: strOrUndefined(l.phone)
  };

  profile.company = {
    sector: strOrUndefined(l.sector),
    industry: strOrUndefined(l.industry),
    country: strOrUndefined(l.country),
    state: strOrUndefined(l.state),
    city: strOrUndefined(l.city),
    zip: strOrUndefined(l.zip),
    address: strOrUndefined(l.address1),
    employees: numOrNull(l.employees)
  };

  profile.market = {
    exchange: strOrUndefined(l.exchange),
    currency: strOrUndefined(l.currency),
    price: numOrNull(l.currentPrice),
    marketCap: numOrNull(l.marketCap),
    fiftyTwoWeekLow: numOrNull(l.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: numOrNull(l.fiftyTwoWeekHigh),
    beta: numOrNull(l.beta)
  };

  profile.financials = {
    totalRevenue: numOrNull(l.totalRevenue),
    revenueGrowth: numOrNull(l.revenueGrowth),
    earningsGrowth: numOrNull(l.earningsGrowth),
    grossMargins: numOrNull(l.grossMargins),
    operatingMargins: numOrNull(l.operatingMargins),
    ebitdaMargins: numOrNull(l.ebitdaMargins),
    profitMargins: numOrNull(l.profitMargins),
    freeCashflow: numOrNull(l.freeCashflow),
    operatingCashflow: numOrNull(l.operatingCashflow),
    totalCash: numOrNull(l.totalCash),
    totalDebt: numOrNull(l.totalDebt),
    debtToEquity: numOrNull(l.debtToEquity),
    currentRatio: numOrNull(l.currentRatio),
    quickRatio: numOrNull(l.quickRatio),
    returnOnAssets: numOrNull(l.returnOnAssets),
    returnOnEquity: numOrNull(l.returnOnEquity)
  };

  profile.valuation = {
    trailingPE: numOrNull(l.trailingPE),
    forwardPE: numOrNull(l.forwardPE),
    priceToBook: numOrNull(l.priceToBook),
    priceToSales: numOrNull(l.priceToSales),
    enterpriseValue: numOrNull(l.enterpriseValue),
    enterpriseToRevenue: numOrNull(l.enterpriseToRevenue),
    enterpriseToEbitda: numOrNull(l.enterpriseToEbitda),
    dividendYield: numOrNull(l.dividendYield)
  };

  profile.leadership = mapLeadership(l.leadership);

  profile.analyst = {
    rating: strOrUndefined(l.analystRating),
    count: numOrNull(l.analystCount),
    targetMean: numOrNull(l.targetMeanPrice),
    targetHigh: numOrNull(l.targetHighPrice),
    targetLow: numOrNull(l.targetLowPrice),
    topTarget: numOrNull(l.topAnalystTarget),
    topAgency: strOrUndefined(l.topAnalystAgency)
  };

  profile.earnings = {
    nextEarnings: l.earnings?.nextEarnings ? parseDate(l.earnings.nextEarnings) : undefined,
    epsEstimate: numOrNull(l.earnings?.eps?.consensus),
    revenueEstimate: numOrNull(l.earnings?.revenue?.consensus),
    eps: numOrNull(l.earnings?.eps?.previous),
    revenue: numOrNull(l.earnings?.revenue?.previous),
    history: mapEarningsHistory(l.earningsHistory)
  };

  profile.filings = {
    latestAnnualReport: mapFiling(l.filings?.latestAnnualReport),
    latestQuarterlyReport: mapFiling(l.filings?.latestQuarterlyReport),
    latestCurrentReport: mapFiling(l.filings?.latestCurrentReport),
    sicDescription: strOrUndefined(l.filings?.sicDescription),
    sic: strOrUndefined(l.filings?.sic),
    fiscalYearEnd: strOrUndefined(l.filings?.fiscalYearEnd),
    stateOfIncorporation: strOrUndefined(l.filings?.stateOfIncorporation),
    facts: l.filings?.facts || {}
  };

  profile.risk = {
    overall: numOrNull(l.risk?.overallRisk),
    audit: numOrNull(l.risk?.auditRisk),
    board: numOrNull(l.risk?.boardRisk),
    compensation: numOrNull(l.risk?.compensationRisk),
    shareholderRights: numOrNull(l.risk?.shareHolderRightsRisk)
  };

  profile.research = {
    overview: Array.isArray(l.research?.overview) ? l.research.overview : [],
    regulatory: Array.isArray(l.research?.regulatory) ? l.research.regulatory : [],
    capitalAllocation: Array.isArray(l.research?.capitalAllocation) ? l.research.capitalAllocation : [],
    operations: Array.isArray(l.research?.operations) ? l.research.operations : [],
    customers: Array.isArray(l.research?.customers) ? l.research.customers : [],
    businessModel: Array.isArray(l.research?.businessModel) ? l.research.businessModel : [],
    catalysts: Array.isArray(l.research?.catalysts) ? l.research.catalysts : [],
    risks: Array.isArray(l.research?.risks) ? l.research.risks : [],
    governance: Array.isArray(l.research?.governance) ? l.research.governance : []
  };

  profile.sources = Array.isArray(l.sources) ? l.sources : [];
  profile.peers = Array.isArray(l.peers) ? l.peers : [];
  profile.finvizMetrics = l.finvizMetrics || {};
  profile.regulators = l.regulators || {};

  profile.manufacturing = {
    factoryFootprint: Array.isArray(l.manufacturing?.factoryFootprint) ? l.manufacturing.factoryFootprint : [],
    efficiencySignals: Array.isArray(l.manufacturing?.efficiencySignals) ? l.manufacturing.efficiencySignals : [],
    customerFulfillment: Array.isArray(l.manufacturing?.customerFulfillment) ? l.manufacturing.customerFulfillment : [],
    inputExposure: Array.isArray(l.manufacturing?.inputExposure) ? l.manufacturing.inputExposure : []
  };

  return profile;
}

module.exports = { mapLegacyToCanonical };
