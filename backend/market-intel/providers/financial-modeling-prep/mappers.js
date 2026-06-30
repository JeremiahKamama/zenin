/**
 * FMP DTO → Domain Model Mappers
 * ===============================
 *
 * Converts raw FMP API response shapes into Zenin's provider-independent
 * domain models (domain/models.js). This is the ONLY place that reads FMP
 * field names. Nothing outside this package should ever see an FMP DTO.
 *
 * All mappers are defensive: missing/odd fields collapse to safe defaults
 * rather than throwing, so one malformed response doesn't fail everything.
 *
 * FMP field references come from:
 *   https://site.financialmodelingprep.com/developer/docs
 *
 * @module market-intel/providers/financial-modeling-prep/mappers
 */

"use strict";

const {
  toNumber,
  toNumberOrNull,
  toIso,
  toDateString,
  generateId
} = require("../../domain/models");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val) {
  return String(val ?? "");
}

function num(val) {
  return toNumber(val);
}

function numOrNull(val) {
  return toNumberOrNull(val);
}

// ---------------------------------------------------------------------------
// Company Profile
// ---------------------------------------------------------------------------

/**
 * FMP profile response fields:
 *   symbol, companyName, exchange, currency, sector, industry, description,
 *   ceo, website, image, country, mktCap, volAvg, price, changes, beta,
 *   lastDiv, range, fullTimeEmployees, phone, address, city, state, zip,
 *   isin, cusip, cik, ipoDate, isActivelyTrading, isEtf, isFund
 *
 * @param {Object} dto  FMP profile object
 * @returns {import("../../../domain/models").CompanyProfile}
 */
function mapCompanyProfile(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    name: str(d.companyName || d.name),
    exchange: str(d.exchange) || undefined,
    currency: str(d.currency) || undefined,
    sector: str(d.sector) || undefined,
    industry: str(d.industry) || undefined,
    description: str(d.description) || undefined,
    ceo: str(d.ceo) || undefined,
    website: str(d.website) || undefined,
    logoUrl: str(d.image) || undefined,
    country: str(d.country) || undefined,
    marketCap: numOrNull(d.mktCap),
    sharesOutstanding: numOrNull(d.volAvg),  // Note: FMP uses volAvg differently
    employees: numOrNull(d.fullTimeEmployees),
    phone: str(d.phone) || undefined,
    address: str(d.address) || undefined,
    city: str(d.city) || undefined,
    state: str(d.state) || undefined,
    zip: str(d.zip) || undefined,
    isin: str(d.isin) || undefined,
    cik: str(d.cik) || undefined,
    ipoDate: toDateString(d.ipoDate) || undefined,
    asOf: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * FMP search response: [{ symbol, name, currency, stockExchange, exchangeShortName }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").CompanySearchResult}
 */
function mapSearchResult(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    name: str(d.name),
    exchange: str(d.stockExchange || d.exchangeShortName) || str(d.exchange) || undefined,
    currency: str(d.currency) || undefined,
    sector: undefined,
    industry: undefined
  };
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

/**
 * FMP quote response: [{
 *   symbol, name, price, change, changesPercentage, open, high, low,
 *   previousClose, volume, avgVolume, marketCap, pe, eps,
 *   yearHigh, yearLow, bid, bidSize, ask, askSize, timestamp
 * }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").Quote}
 */
function mapQuote(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    price: numOrNull(d.price),
    change: numOrNull(d.change),
    changePercent: numOrNull(d.changesPercentage),
    open: numOrNull(d.open),
    high: numOrNull(d.high),
    low: numOrNull(d.low),
    previousClose: numOrNull(d.previousClose),
    volume: numOrNull(d.volume),
    avgVolume: numOrNull(d.avgVolume),
    marketCap: numOrNull(d.marketCap),
    peRatio: numOrNull(d.pe),
    eps: numOrNull(d.eps),
    high52Week: numOrNull(d.yearHigh),
    low52Week: numOrNull(d.yearLow),
    bid: numOrNull(d.bid),
    bidSize: numOrNull(d.bidSize),
    ask: numOrNull(d.ask),
    askSize: numOrNull(d.askSize),
    timestamp: toDateString(d.timestamp) || new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Historical Prices
// ---------------------------------------------------------------------------

/**
 * FMP historical daily response: {
 *   symbol,
 *   historical: [{ date, open, high, low, close, adjClose, volume, change, ... }]
 * }
 *
 * @param {Object} result
 * @param {import("../../../domain/MarketDataProvider").HistoricalPricesRequest} request
 * @returns {import("../../../domain/models").HistoricalPricesResult}
 */
function mapHistoricalPrices(result, request) {
  const d = result || {};
  const rows = Array.isArray(d.historical) ? d.historical : Array.isArray(d) ? d : [];
  return {
    symbol: request.symbol,
    prices: rows.map(mapHistoricalPrice),
    resolution: request.resolution || "daily",
    from: request.from,
    to: request.to
  };
}

function mapHistoricalPrice(dto) {
  const d = dto || {};
  return {
    symbol: "",
    date: toDateString(d.date) || "",
    open: num(d.open),
    high: num(d.high),
    low: num(d.low),
    close: num(d.close),
    adjustedClose: numOrNull(d.adjClose),
    volume: num(d.volume)
  };
}

// ---------------------------------------------------------------------------
// Financial Statements
// ---------------------------------------------------------------------------

/**
 * FMP income statement fields:
 * [{ date, symbol, period, revenue, costOfRevenue, grossProfit,
 *    operatingIncome, netIncome, eps, epsdiluted, ebitda, ... }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").IncomeStatement}
 */
function mapIncomeStatement(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    date: toDateString(d.date) || "",
    period: mapFiscalPeriod(d.period),
    revenue: numOrNull(d.revenue),
    costOfRevenue: numOrNull(d.costOfRevenue),
    grossProfit: numOrNull(d.grossProfit),
    operatingIncome: numOrNull(d.operatingIncome),
    netIncome: numOrNull(d.netIncome),
    eps: numOrNull(d.eps),
    epsDiluted: numOrNull(d.epsdiluted),
    ebitda: numOrNull(d.ebitda)
  };
}

/**
 * @param {Object} dto
 * @returns {import("../../../domain/models").BalanceSheet}
 */
function mapBalanceSheet(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    date: toDateString(d.date) || "",
    period: mapFiscalPeriod(d.period),
    totalAssets: numOrNull(d.totalAssets),
    totalLiabilities: numOrNull(d.totalLiabilities),
    totalEquity: numOrNull(d.totalStockholdersEquity || d.totalEquity),
    cashAndEquivalents: numOrNull(d.cashAndCashEquivalents || d.cashAndShortTermInvestments),
    shortTermDebt: numOrNull(d.shortTermDebt),
    longTermDebt: numOrNull(d.longTermDebt),
    currentAssets: numOrNull(d.totalCurrentAssets),
    currentLiabilities: numOrNull(d.totalCurrentLiabilities)
  };
}

/**
 * @param {Object} dto
 * @returns {import("../../../domain/models").CashFlowStatement}
 */
function mapCashFlowStatement(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    date: toDateString(d.date) || "",
    period: mapFiscalPeriod(d.period),
    operatingCashFlow: numOrNull(d.operatingCashFlow),
    capitalExpenditure: numOrNull(d.capitalExpenditure),
    freeCashFlow: numOrNull(d.freeCashFlow),
    dividendsPaid: numOrNull(d.dividendsPaid)
  };
}

/**
 * @param {Object} dto
 * @returns {import("../../../domain/models").FinancialRatios}
 */
function mapFinancialRatios(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    date: toDateString(d.date) || "",
    period: mapFiscalPeriod(d.period),
    peRatio: numOrNull(d.priceEarningsRatio),
    pbRatio: numOrNull(d.priceToBookRatio),
    psRatio: numOrNull(d.priceToSalesRatio),
    evEbitda: numOrNull(d.enterpriseValueOverEBITDA),
    roe: numOrNull(d.returnOnEquity),
    roa: numOrNull(d.returnOnAssets),
    roic: numOrNull(d.returnOnInvestedCapital),
    debtToEquity: numOrNull(d.debtEquityRatio),
    currentRatio: numOrNull(d.currentRatio),
    quickRatio: numOrNull(d.quickRatio),
    grossMargin: numOrNull(d.grossProfitMargin),
    operatingMargin: numOrNull(d.operatingProfitMargin),
    netMargin: numOrNull(d.netProfitMargin),
    dividendYield: numOrNull(d.dividendYield),
    payoutRatio: numOrNull(d.payoutRatio)
  };
}

/**
 * @param {Object} dto
 * @returns {import("../../../domain/models").KeyMetrics}
 */
function mapKeyMetrics(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    date: toDateString(d.date) || "",
    period: mapFiscalPeriod(d.period),
    revenuePerShare: numOrNull(d.revenuePerShare),
    netIncomePerShare: numOrNull(d.netIncomePerShare),
    operatingCashFlowPerShare: numOrNull(d.operatingCashFlowPerShare),
    freeCashFlowPerShare: numOrNull(d.freeCashFlowPerShare),
    cashPerShare: numOrNull(d.cashPerShare),
    bookValuePerShare: numOrNull(d.bookValuePerShare),
    tangibleBookValuePerShare: numOrNull(d.tangibleBookValuePerShare),
    dividendPerShare: numOrNull(d.dividendPerShare),
    marketCap: numOrNull(d.marketCap),
    enterpriseValue: numOrNull(d.enterpriseValue),
    grahamNumber: numOrNull(d.grahamNumber)
  };
}

function mapFiscalPeriod(raw) {
  const val = str(raw).toUpperCase();
  if (val === "FY" || val === "ANNUAL") return "annual";
  if (val === "Q" || val === "QUARTER") return "quarter";
  return val === "quarter" ? "quarter" : "annual";
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

/**
 * FMP earnings surprise response: [{
 *   date, symbol, period, fiscalYear, fiscalQuarter,
 *   estimatedEarning, reportedEarning, surprise, surprisePercentage,
 *   estimatedRevenue, reportedRevenue, revenueSurprise, revenueSurprisePercentage
 * }]
 *
 * FMP earnings calendar: [{
 *   date, symbol, companyName, fiscalYear, fiscalQuarter,
 *   epsEstimated, revenueEstimated, timeOfDay, exchange
 * }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").EarningsEvent}
 */
function mapEarningsEvent(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    date: toDateString(d.date) || "",
    period: "quarter",
    fiscalYear: str(d.fiscalYear) || undefined,
    fiscalQuarter: str(d.fiscalQuarter) || undefined,
    estimatedEps: numOrNull(d.estimatedEarning),
    actualEps: numOrNull(d.reportedEarning),
    surpriseEps: numOrNull(d.surprise),
    surpriseEpsPercent: numOrNull(d.surprisePercentage),
    estimatedRevenue: numOrNull(d.estimatedRevenue),
    actualRevenue: numOrNull(d.reportedRevenue),
    surpriseRevenue: numOrNull(d.revenueSurprise),
    surpriseRevenuePercent: numOrNull(d.revenueSurprisePercentage),
    timeOfDay: str(d.time) || undefined
  };
}

/**
 * @param {Object} dto
 * @returns {import("../../../domain/models").EarningsCalendarEntry}
 */
function mapEarningsCalendarEntry(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    name: str(d.companyName || d.name || d.symbol),
    date: toDateString(d.date) || "",
    fiscalYear: str(d.fiscalYear) || undefined,
    fiscalQuarter: str(d.fiscalQuarter) || undefined,
    estimatedEps: numOrNull(d.epsEstimated || d.estimatedEps),
    estimatedRevenue: numOrNull(d.revenueEstimated || d.estimatedRevenue),
    timeOfDay: str(d.timeOfDay) || undefined,
    exchange: str(d.exchange) || undefined
  };
}

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

/**
 * FMP dividend response: [{
 *   symbol, date, label, adjDividend, dividend,
 *   recordDate, paymentDate, declarationDate
 * }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").DividendRecord}
 */
function mapDividendRecord(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    name: undefined,
    dividend: numOrNull(d.dividend || d.adjDividend),
    declarationDate: toDateString(d.declarationDate) || undefined,
    recordDate: toDateString(d.recordDate) || undefined,
    payableDate: toDateString(d.paymentDate) || undefined,
    exDividendDate: toDateString(d.date) || undefined,
    frequency: undefined,
    yield: undefined,
    annualDividend: undefined
  };
}

/**
 * FMP dividend calendar: [{
 *   date, symbol, companyName, dividend, adjDividend, yield
 * }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").DividendCalendarEntry}
 */
function mapDividendCalendarEntry(dto) {
  const d = dto || {};
  return {
    symbol: str(d.symbol),
    name: str(d.companyName || d.symbol),
    dividend: num(d.dividend || d.adjDividend),
    date: toDateString(d.date) || "",
    yield: numOrNull(d.yield)
  };
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/**
 * FMP news response (v3 stock_news): [{
 *   symbol, publishedDate, title, image, site, text, url
 * }]
 *
 * FMP news response (v4 general news): [{
 *   title, author, publishedDate, articleURL, tickers, content
 * }]
 *
 * @param {Object} dto
 * @param {string} [category]   "company", "sector", "market"
 * @returns {import("../../../domain/models").NewsArticle}
 */
function mapNewsArticle(dto, category) {
  const d = dto || {};
  const symbols = d.symbol
    ? [str(d.symbol)]
    : Array.isArray(d.tickers)
      ? d.tickers.map(String)
      : undefined;

  const id = str(d.url || d.articleURL || d.title)
    ? generateId()
    : str(d.publishedDate || "") + "-" + str(d.title || "").slice(0, 40);

  return {
    id,
    title: str(d.title || d.headline || ""),
    summary: str(d.text || d.content || "").slice(0, 500) || undefined,
    content: str(d.text || d.content) || undefined,
    url: str(d.url || d.articleURL) || undefined,
    source: str(d.site || d.author || d.source) || undefined,
    sourceUrl: undefined,
    imageUrl: str(d.image) || undefined,
    publishedAt: toIso(d.publishedDate) || new Date().toISOString(),
    category: category || "general",
    symbols,
    sentiment: undefined
  };
}

// ---------------------------------------------------------------------------
// Insider Trading
// ---------------------------------------------------------------------------

/**
 * FMP insider trading response: [{
 *   symbol, transactionDate, reportingCik, acquisitionOrDisposition: "A" | "D",
 *   transactionType, securitiesOwned, securitiesTransacted, price,
 *   reportingName, typeOfOwner, link, filingDate, formType
 * }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").InsiderTrade}
 */
function mapInsiderTrade(dto) {
  const d = dto || {};
  const disposition = str(d.acquisitionOrDisposition).toUpperCase();
  const isBuy = disposition === "A";
  const isSell = disposition === "D";

  return {
    id: str(d.link || `${d.symbol}-${d.transactionDate}-${d.reportingCik}`),
    symbol: str(d.symbol),
    insiderName: str(d.reportingName),
    title: str(d.typeOfOwner) || undefined,
    transactionType: isBuy ? "buy" : isSell ? "sell" : undefined,
    shares: numOrNull(d.securitiesTransacted),
    pricePerShare: numOrNull(d.price),
    totalValue: numOrNull(d.price) != null && numOrNull(d.securitiesTransacted) != null
      ? numOrNull(d.price) * numOrNull(d.securitiesTransacted)
      : undefined,
    filingDate: toDateString(d.filingDate) || undefined,
    transactionDate: toDateString(d.transactionDate) || undefined,
    ownershipType: str(d.typeOfOwner) || undefined,
    secForm: str(d.formType) || undefined
  };
}

// ---------------------------------------------------------------------------
// Analyst Ratings
// ---------------------------------------------------------------------------

/**
 * FMP analyst estimates response: {
 *   symbol, date, analystRatings, analystTargetPrice,
 *   numberOfAnalysts, priceTarget: { low, high, average, median }
 * }
 *
 * FMP analyst recommendations: [{
 *   symbol, date, analystCompany, analystName, action, rating, recommendation
 * }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").AnalystRating}
 */
function mapAnalystRating(dto) {
  const d = dto || {};
  let rating = "hold";
  const rawRec = str(d.recommendation || d.rating || d.analystRatings).toLowerCase();
  if (rawRec.includes("strong buy") || rawRec.includes("strongbuy")) rating = "strongBuy";
  else if (rawRec.includes("buy") || rawRec.includes("outperform") || rawRec.includes("overweight")) rating = "buy";
  else if (rawRec.includes("hold") || rawRec.includes("neutral") || rawRec.includes("equal")) rating = "hold";
  else if (rawRec.includes("underperform") || rawRec.includes("underweight") || rawRec.includes("negative")) rating = "underperform";
  else if (rawRec.includes("sell")) rating = "sell";

  const actionRaw = str(d.action || d.recommendation).toLowerCase();
  let action = undefined;
  if (actionRaw.includes("upgrade")) action = "upgrade";
  else if (actionRaw.includes("downgrade")) action = "downgrade";
  else if (actionRaw.includes("initiate") || actionRaw.includes("init")) action = "initiate";
  else if (actionRaw.includes("reiterate") || actionRaw.includes("maintain")) action = "reiterate";

  return {
    symbol: str(d.symbol),
    analystName: str(d.analystName) || undefined,
    firm: str(d.analystCompany) || undefined,
    rating,
    targetPrice: numOrNull(d.analystTargetPrice || d.targetPrice),
    priceTargetLow: numOrNull(d.priceTarget?.low),
    priceTargetHigh: numOrNull(d.priceTarget?.high),
    priceTargetAverage: numOrNull(d.priceTarget?.average),
    priceTargetMedian: numOrNull(d.priceTarget?.median),
    analystCount: numOrNull(d.numberOfAnalysts || d.analystCount || d.consensusAnalysts),
    date: toDateString(d.date) || undefined,
    action
  };
}

// ---------------------------------------------------------------------------
// Market Status
// ---------------------------------------------------------------------------

/**
 * FMP market hours response: {
 *   stockMarketHolidays: [...],
 *   isTheStockMarketOpen: boolean,
 *   stockMarketHours: { openingHour, closingHour }
 * }
 *
 * @param {Object} dto
 * @param {string} exchange
 * @returns {import("../../../domain/models").MarketStatus}
 */
function mapMarketStatus(dto, exchange) {
  const d = dto || {};
  return {
    isOpen: Boolean(d.isTheStockMarketOpen),
    exchange: exchange || "US",
    sessionStatus: d.isTheStockMarketOpen ? "open" : "closed",
    openTime: str(d.stockMarketHours?.openingHour) || undefined,
    closeTime: str(d.stockMarketHours?.closingHour) || undefined,
    holiday: undefined,
    asOf: new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Economic Calendar
// ---------------------------------------------------------------------------

/**
 * FMP economic calendar response: [{
 *   event, date, country, currency, previous, estimate, actual,
 *   change, impact, changePercentage
 * }]
 *
 * @param {Object} dto
 * @returns {import("../../../domain/models").EconomicEvent}
 */
function mapEconomicEvent(dto) {
  const d = dto || {};
  return {
    id: generateId(),
    name: str(d.event),
    country: str(d.country) || undefined,
    currency: str(d.currency) || undefined,
    previous: numOrNull(d.previous),
    forecast: numOrNull(d.estimate),
    actual: numOrNull(d.actual),
    unit: undefined,
    importance: mapImpact(str(d.impact)),
    eventDate: toDateString(d.date) || "",
    eventTime: undefined
  };
}

function mapImpact(raw) {
  const val = raw.toLowerCase();
  if (val.includes("high") || val === "3") return "high";
  if (val.includes("medium") || val === "2") return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Executives
// ---------------------------------------------------------------------------

/**
 * FMP key executives response: [{
 *   name, title, pay, currencyPay, gender, yearBorn, titleSince
 * }]
 *
 * @param {Object} dto
 * @param {string} symbol
 * @returns {import("../../../domain/models").Executive}
 */
function mapExecutive(dto, symbol) {
  const d = dto || {};
  return {
    symbol,
    name: str(d.name),
    title: str(d.title) || undefined,
    compensation: numOrNull(d.pay),
    sharesOwned: undefined,
    yearBorn: numOrNull(d.yearBorn) || undefined,
    gender: str(d.gender) || undefined
  };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  mapCompanyProfile,
  mapSearchResult,
  mapQuote,
  mapHistoricalPrices,
  mapHistoricalPrice,
  mapIncomeStatement,
  mapBalanceSheet,
  mapCashFlowStatement,
  mapFinancialRatios,
  mapKeyMetrics,
  mapEarningsEvent,
  mapEarningsCalendarEntry,
  mapDividendRecord,
  mapDividendCalendarEntry,
  mapNewsArticle,
  mapInsiderTrade,
  mapAnalystRating,
  mapMarketStatus,
  mapEconomicEvent,
  mapExecutive,
  _internals: {
    mapFiscalPeriod,
    mapImpact,
    str,
    num,
    numOrNull
  }
};
