"use strict";

/**
 * Canonical Company Profile model.
 *
 * Provider-agnostic structure used internally by the aggregation service.
 * The renderer at the bottom converts this back into the flat legacy shape
 * expected by CompanyProfilePage.jsx.
 */

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function strOrUndefined(value) {
  const s = value == null ? "" : String(value).trim();
  return s || undefined;
}

function createEmptyProfile(symbol) {
  return {
    symbol: String(symbol || "").toUpperCase(),
    identity: {
      name: undefined,
      shortName: undefined,
      description: undefined,
      website: undefined,
      phone: undefined,
      email: undefined,
      logoUrl: undefined,
      isin: undefined,
      cusip: undefined,
      cik: undefined,
      ipoDate: undefined
    },
    company: {
      sector: undefined,
      industry: undefined,
      country: undefined,
      state: undefined,
      city: undefined,
      zip: undefined,
      address: undefined,
      employees: null,
      founded: undefined
    },
    market: {
      exchange: undefined,
      currency: undefined,
      price: null,
      marketCap: null,
      sharesOutstanding: null,
      volume: null,
      avgVolume: null,
      beta: null,
      fiftyTwoWeekLow: null,
      fiftyTwoWeekHigh: null,
      isActivelyTrading: undefined,
      isEtf: undefined,
      isFund: undefined
    },
    financials: {
      totalRevenue: null,
      revenueGrowth: null,
      earningsGrowth: null,
      grossMargins: null,
      operatingMargins: null,
      ebitdaMargins: null,
      profitMargins: null,
      freeCashflow: null,
      operatingCashflow: null,
      totalCash: null,
      totalDebt: null,
      debtToEquity: null,
      currentRatio: null,
      quickRatio: null,
      returnOnAssets: null,
      returnOnEquity: null,
      returnOnCapitalEmployed: null,
      capitalExpenditures: null
    },
    valuation: {
      trailingPE: null,
      forwardPE: null,
      priceToBook: null,
      priceToSales: null,
      enterpriseValue: null,
      enterpriseToRevenue: null,
      enterpriseToEbitda: null,
      dividendYield: null,
      bookValuePerShare: null,
      cashPerShare: null,
      revenuePerShare: null,
      earningsPerShare: null
    },
    leadership: [],
    analyst: {
      rating: undefined,
      count: null,
      targetMean: null,
      targetHigh: null,
      targetLow: null,
      topTarget: null,
      topAgency: undefined,
      ratingsHistory: []
    },
    earnings: {
      nextEarnings: undefined,
      epsEstimate: null,
      revenueEstimate: null,
      eps: null,
      revenue: null,
      history: []
    },
    dividends: {
      yield: null,
      rate: null,
      exDate: undefined,
      payDate: undefined,
      history: []
    },
    filings: {
      latestAnnualReport: null,
      latestQuarterlyReport: null,
      latestCurrentReport: null,
      sicDescription: undefined,
      sic: undefined,
      fiscalYearEnd: undefined,
      stateOfIncorporation: undefined,
      facts: {}
    },
    risk: {
      overall: null,
      audit: null,
      board: null,
      compensation: null,
      shareholderRights: null
    },
    research: {
      overview: [],
      regulatory: [],
      capitalAllocation: [],
      operations: [],
      customers: [],
      businessModel: [],
      catalysts: [],
      risks: [],
      governance: []
    },
    sources: [],
    peers: [],
    manufacturing: {
      factoryFootprint: [],
      efficiencySignals: [],
      customerFulfillment: [],
      inputExposure: []
    },
    ownership: {
      shortInterest: null,
      shortDate: undefined,
      insiderOwnershipPct: null,
      institutionalOwnershipPct: null,
      institutionalHoldings: []
    },
    regulators: {},
    metadata: {
      providers: [],
      fieldConfidence: {},
      updatedAt: new Date().toISOString()
    }
  };
}

/**
 * Render a canonical profile into the flat legacy response shape.
 * This keeps CompanyProfilePage.jsx unchanged.
 */
function toLegacyResponse(profile, { catalog = {}, peers = [] } = {}) {
  const p = profile || createEmptyProfile();
  const id = p.identity || {};
  const co = p.company || {};
  const m = p.market || {};
  const f = p.financials || {};
  const v = p.valuation || {};
  const a = p.analyst || {};
  const e = p.earnings || {};
  const d = p.dividends || {};
  const fi = p.filings || {};
  const r = p.risk || {};
  const o = p.ownership || {};

  return {
    symbol: p.symbol,
    name: id.name,
    shortName: id.shortName,
    logoUrl: id.logoUrl,
    isin: id.isin,
    cusip: id.cusip,
    cik: id.cik,
    summary: id.description,
    website: id.website,
    phone: id.phone,
    exchange: m.exchange,
    currency: m.currency,
    sector: co.sector,
    industry: co.industry,
    country: co.country,
    state: co.state,
    city: co.city,
    zip: co.zip,
    address1: co.address,
    employees: numOrNull(co.employees),

    marketCap: numOrNull(m.marketCap),
    enterpriseValue: numOrNull(v.enterpriseValue),
    currentPrice: numOrNull(m.price),
    fiftyTwoWeekLow: numOrNull(m.fiftyTwoWeekLow),
    fiftyTwoWeekHigh: numOrNull(m.fiftyTwoWeekHigh),
    beta: numOrNull(m.beta),

    trailingPE: numOrNull(v.trailingPE),
    forwardPE: numOrNull(v.forwardPE),
    priceToBook: numOrNull(v.priceToBook),
    priceToSales: numOrNull(v.priceToSales),
    enterpriseToRevenue: numOrNull(v.enterpriseToRevenue),
    enterpriseToEbitda: numOrNull(v.enterpriseToEbitda),
    dividendYield: numOrNull(d.yield ?? v.dividendYield),

    totalRevenue: numOrNull(f.totalRevenue),
    revenueGrowth: numOrNull(f.revenueGrowth),
    earningsGrowth: numOrNull(f.earningsGrowth),
    grossMargins: numOrNull(f.grossMargins),
    operatingMargins: numOrNull(f.operatingMargins),
    ebitdaMargins: numOrNull(f.ebitdaMargins),
    profitMargins: numOrNull(f.profitMargins),
    freeCashflow: numOrNull(f.freeCashflow),
    operatingCashflow: numOrNull(f.operatingCashflow),
    returnOnAssets: numOrNull(f.returnOnAssets),
    returnOnEquity: numOrNull(f.returnOnEquity),
    totalCash: numOrNull(f.totalCash),
    totalDebt: numOrNull(f.totalDebt),
    debtToEquity: numOrNull(f.debtToEquity),
    currentRatio: numOrNull(f.currentRatio),
    quickRatio: numOrNull(f.quickRatio),

    targetMeanPrice: numOrNull(a.targetMean),
    targetHighPrice: numOrNull(a.targetHigh),
    targetLowPrice: numOrNull(a.targetLow),
    analystRating: a.rating,
    analystCount: numOrNull(a.count),
    topAnalystTarget: numOrNull(a.topTarget),
    topAnalystAgency: a.topAgency,

    earnings: {
      nextEarnings: e.nextEarnings,
      eps: {
        consensus: numOrNull(e.epsEstimate),
        previous: numOrNull(e.eps)
      },
      revenue: {
        consensus: numOrNull(e.revenueEstimate),
        previous: numOrNull(e.revenue)
      }
    },
    earningsHistory: Array.isArray(e.history) ? e.history : [],

    leadership: Array.isArray(p.leadership) ? p.leadership : [],

    risk: {
      overallRisk: numOrNull(r.overall),
      auditRisk: numOrNull(r.audit),
      boardRisk: numOrNull(r.board),
      compensationRisk: numOrNull(r.compensation),
      shareHolderRightsRisk: numOrNull(r.shareholderRights)
    },

    filings: {
      latestAnnualReport: fi.latestAnnualReport,
      latestQuarterlyReport: fi.latestQuarterlyReport,
      latestCurrentReport: fi.latestCurrentReport,
      sicDescription: fi.sicDescription,
      sic: fi.sic,
      fiscalYearEnd: fi.fiscalYearEnd,
      stateOfIncorporation: fi.stateOfIncorporation,
      facts: fi.facts || {}
    },

    research: p.research || {},
    sources: Array.isArray(p.sources) ? p.sources : [],
    peers: Array.isArray(peers) ? peers : [],
    manufacturing: p.manufacturing || {},
    regulators: p.regulators || {},
    finvizMetrics: p.finvizMetrics || {},
    ownership: {
      shortInterest: numOrNull(o.shortInterest),
      shortDate: o.shortDate,
      insiderOwnershipPct: numOrNull(o.insiderOwnershipPct),
      institutionalOwnershipPct: numOrNull(o.institutionalOwnershipPct),
      institutionalHoldings: Array.isArray(o.institutionalHoldings) ? o.institutionalHoldings : []
    },

    catalog: catalog || {},
    updatedAt: p.metadata?.updatedAt || new Date().toISOString(),
    metadata: p.metadata
  };
}

module.exports = {
  createEmptyProfile,
  toLegacyResponse,
  numOrNull,
  strOrUndefined
};
