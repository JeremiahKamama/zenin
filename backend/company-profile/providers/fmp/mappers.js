"use strict";

const { numOrNull, strOrUndefined, createEmptyProfile } = require("../../domain/models");

function first(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

function parseDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

function parseFmpDate(value) {
  if (!value) return undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

function toPercent(value) {
  const n = numOrNull(value);
  if (n == null) return null;
  // FMP sometimes returns already-decimal ratios; assume raw value is ratio.
  return Math.abs(n) > 10 ? n / 100 : n;
}

/**
 * Map FMP /profile/:symbol DTO.
 */
function mapProfile(dto) {
  const d = dto || {};
  return {
    identity: {
      name: strOrUndefined(d.companyName || d.name),
      shortName: strOrUndefined(d.shortName || d.companyName),
      description: strOrUndefined(d.description),
      website: strOrUndefined(d.website),
      phone: strOrUndefined(d.phone),
      logoUrl: strOrUndefined(d.image),
      isin: strOrUndefined(d.isin),
      cusip: strOrUndefined(d.cusip),
      cik: strOrUndefined(d.cik),
      ipoDate: parseFmpDate(d.ipoDate)
    },
    company: {
      sector: strOrUndefined(d.sector),
      industry: strOrUndefined(d.industry),
      country: strOrUndefined(d.country),
      state: strOrUndefined(d.state),
      city: strOrUndefined(d.city),
      zip: strOrUndefined(d.zip),
      address: strOrUndefined(d.address),
      employees: numOrNull(d.fullTimeEmployees),
      founded: strOrUndefined(d.founded)
    },
    market: {
      exchange: strOrUndefined(d.exchange),
      currency: strOrUndefined(d.currency),
      marketCap: numOrNull(d.mktCap),
      sharesOutstanding: numOrNull(d.sharesOutstanding),
      isActivelyTrading: d.isActivelyTrading,
      isEtf: d.isEtf,
      isFund: d.isFund
    }
  };
}

/**
 * Map FMP /quote/:symbol DTO.
 */
function mapQuote(dto) {
  const d = dto || {};
  return {
    market: {
      price: numOrNull(d.price),
      volume: numOrNull(d.volume),
      avgVolume: numOrNull(d.avgVolume),
      beta: numOrNull(d.beta),
      fiftyTwoWeekLow: numOrNull(d.yearLow),
      fiftyTwoWeekHigh: numOrNull(d.yearHigh),
      marketCap: numOrNull(d.marketCap)
    },
    valuation: {
      trailingPE: numOrNull(d.pe),
      earningsPerShare: numOrNull(d.eps)
    },
    analyst: {
      targetMean: numOrNull(d.price),
      count: null
    }
  };
}

/**
 * Map FMP /key-metrics/:symbol DTO.
 */
function mapKeyMetrics(dto) {
  const d = dto || {};
  return {
    market: {
      sharesOutstanding: numOrNull(d.sharesOutstanding),
      avgVolume: numOrNull(d.volumeWeightedAveragePrice) ? null : d.averageVolume // prefer avg volume if available
    },
    financials: {
      totalRevenue: numOrNull(d.revenue),
      totalCash: numOrNull(d.cashAndCashEquivalents),
      totalDebt: numOrNull(d.totalDebt),
      debtToEquity: numOrNull(d.debtToEquity),
      currentRatio: numOrNull(d.currentRatio),
      quickRatio: numOrNull(d.quickRatio),
      returnOnAssets: numOrNull(d.returnOnAssets),
      returnOnEquity: numOrNull(d.returnOnEquity),
      returnOnCapitalEmployed: numOrNull(d.returnOnCapitalEmployed),
      capitalExpenditures: numOrNull(d.capitalExpenditure),
      freeCashflow: numOrNull(d.freeCashFlow),
      operatingCashflow: numOrNull(d.operatingCashFlow)
    },
    valuation: {
      priceToBook: numOrNull(d.priceToBookRatio),
      priceToSales: numOrNull(d.priceToSalesRatio),
      enterpriseValue: numOrNull(d.enterpriseValue),
      enterpriseToRevenue: numOrNull(d.enterpriseValueOverEBITDA) ? null : d.evToSales,
      enterpriseToEbitda: numOrNull(d.enterpriseValueOverEBITDA),
      bookValuePerShare: numOrNull(d.bookValuePerShare),
      cashPerShare: numOrNull(d.cashPerShare),
      revenuePerShare: numOrNull(d.revenuePerShare)
    }
  };
}

/**
 * Map FMP /ratios/:symbol DTO.
 */
function mapRatios(dto) {
  const d = dto || {};
  return {
    financials: {
      grossMargins: toPercent(d.grossProfitMargin),
      operatingMargins: toPercent(d.operatingProfitMargin),
      ebitdaMargins: toPercent(d.ebitdaMargin),
      profitMargins: toPercent(d.netProfitMargin),
      returnOnAssets: numOrNull(d.returnOnAssets),
      returnOnEquity: numOrNull(d.returnOnEquity),
      currentRatio: numOrNull(d.currentRatio),
      quickRatio: numOrNull(d.quickRatio),
      debtToEquity: numOrNull(d.debtToEquity)
    },
    valuation: {
      trailingPE: numOrNull(d.priceEarningsRatio),
      priceToBook: numOrNull(d.priceToBookRatio),
      dividendYield: toPercent(d.dividendYield)
    }
  };
}

/**
 * Map FMP /financial-growth/:symbol DTO.
 */
function mapFinancialGrowth(dto) {
  const d = dto || {};
  return {
    financials: {
      revenueGrowth: toPercent(d.revenueGrowth),
      earningsGrowth: toPercent(d.netIncomeGrowth)
    }
  };
}

/**
 * Map FMP /enterprise-values/:symbol DTO.
 */
function mapEnterpriseValues(dto) {
  const d = dto || {};
  return {
    market: {
      marketCap: numOrNull(d.marketCapitalization),
      sharesOutstanding: numOrNull(d.numberOfShares)
    },
    valuation: {
      enterpriseValue: numOrNull(d.enterpriseValue)
    }
  };
}

/**
 * Map FMP /rating/:symbol DTO.
 */
function mapRating(dto) {
  const d = dto || {};
  return {
    analyst: {
      rating: strOrUndefined(d.rating),
      targetMean: numOrNull(d.targetPrice)
    }
  };
}

/**
 * Map FMP /earnings-surprises/:symbol DTO.
 */
function mapEarningsSurprises(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return {
    earnings: {
      history: list.slice(0, 12).map((d) => ({
        date: parseFmpDate(d.date),
        epsEstimate: numOrNull(d.estimatedEps),
        reportedEps: numOrNull(d.actualEps),
        surprisePct: numOrNull(d.surprise)
      }))
    }
  };
}

/**
 * Map FMP /sec-filings/:symbol DTO.
 */
function mapSecFilings(arr) {
  const list = Array.isArray(arr) ? arr : [];
  const latestAnnual = list.find((f) => f.type === "10-K") || list.find((f) => /10-K/i.test(f.type));
  const latestQuarterly = list.find((f) => f.type === "10-Q") || list.find((f) => /10-Q/i.test(f.type));
  const latestCurrent = list.find((f) => f.type === "8-K") || list.find((f) => /8-K/i.test(f.type));

  function toFiling(f) {
    if (!f) return null;
    return {
      form: strOrUndefined(f.type),
      filingDate: parseFmpDate(f.filingDate),
      url: strOrUndefined(f.finalLink || f.link)
    };
  }

  return {
    filings: {
      latestAnnualReport: toFiling(latestAnnual),
      latestQuarterlyReport: toFiling(latestQuarterly),
      latestCurrentReport: toFiling(latestCurrent)
    }
  };
}

/**
 * Map FMP executive compensation / key-executives DTO if available.
 */
function mapExecutives(arr) {
  const list = Array.isArray(arr) ? arr : [];
  return {
    leadership: list.slice(0, 8).map((d) => ({
      name: strOrUndefined(d.name),
      title: strOrUndefined(d.title || d.position),
      age: numOrNull(d.age),
      compensation: numOrNull(d.pay || d.compensation)
    }))
  };
}

/**
 * Map FMP income statement DTO.
 */
function mapIncomeStatement(dto) {
  const d = dto || {};
  return {
    financials: {
      totalRevenue: numOrNull(d.revenue)
    },
    valuation: {
      earningsPerShare: numOrNull(d.eps)
    }
  };
}

/**
 * Map FMP balance sheet DTO.
 */
function mapBalanceSheet(dto) {
  const d = dto || {};
  return {
    financials: {
      totalCash: numOrNull(d.cashAndCashEquivalents),
      totalDebt: numOrNull(d.totalDebt),
      currentRatio: numOrNull(d.currentRatio)
    }
  };
}

/**
 * Map FMP cash flow DTO.
 */
function mapCashFlow(dto) {
  const d = dto || {};
  return {
    financials: {
      operatingCashflow: numOrNull(d.operatingCashFlow),
      freeCashflow: numOrNull(d.freeCashFlow),
      capitalExpenditures: numOrNull(d.capitalExpenditure)
    }
  };
}

/**
 * Map FMP short interest DTO.
 */
function mapShortInterest(dto) {
  const d = dto || {};
  return {
    ownership: {
      shortInterest: numOrNull(d.shortInterest || d.shortInterestValue || d.value),
      shortDate: parseFmpDate(d.date || d.settlementDate)
    }
  };
}

/**
 * Map FMP insider ownership / insider trading DTO.
 */
function mapInsiderOwnership(dto) {
  const d = dto || {};
  return {
    ownership: {
      insiderOwnershipPct: numOrNull(d.insiderOwnership || d.insiderOwnershipPercent || d.percentage)
    }
  };
}

/**
 * Map FMP institutional ownership DTO.
 */
function mapInstitutionalOwnership(arr) {
  const list = Array.isArray(arr) ? arr : [];
  const first = list[0] || {};
  return {
    ownership: {
      institutionalOwnershipPct: numOrNull(first.institutionalOwnership || first.percentage || first.ownershipPct),
      institutionalHoldings: list.slice(0, 20).map((d) => ({
        holder: strOrUndefined(d.holder || d.institution || d.name),
        shares: numOrNull(d.shares || d.sharesHeld),
        value: numOrNull(d.value || d.marketValue),
        date: parseFmpDate(d.date || d.reportDate)
      }))
    }
  };
}

/**
 * Merge multiple FMP endpoint mappings into a single canonical profile.
 */
function mergeFmpMappings(symbol, mappings) {
  const profile = createEmptyProfile(symbol);
  for (const mapping of mappings) {
    if (!mapping) continue;
    deepMerge(profile, mapping);
  }
  return profile;
}

function deepMerge(target, source) {
  if (!source || typeof source !== "object") return;
  for (const key of Object.keys(source)) {
    const sVal = source[key];
    if (sVal === undefined) continue;
    if (sVal === null) {
      if (target[key] === undefined) target[key] = null;
      continue;
    }
    if (Array.isArray(sVal)) {
      if (!Array.isArray(target[key])) target[key] = [];
      // Append arrays for leadership/earnings; do not duplicate primitives blindly.
      if (target[key].length === 0) target[key] = sVal;
      continue;
    }
    if (typeof sVal === "object") {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      deepMerge(target[key], sVal);
      continue;
    }
    target[key] = sVal;
  }
}

module.exports = {
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
};
