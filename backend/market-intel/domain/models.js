/**
 * Market Intelligence Domain Models
 * =================================
 *
 * Provider-independent value objects for the market intelligence domain.
 * No provider terminology, no FMP types, no raw API payloads.
 *
 * Convention: camelCase field names matching the Zenin codebase.
 * All mappers translate provider DTOs into these shapes.
 *
 * @module market-intel/domain/models
 */

"use strict";

// ---------------------------------------------------------------------------
// Company & Profile
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CompanyProfile
 * @property {string} symbol
 * @property {string} [name]
 * @property {string} [exchange]
 * @property {string} [currency]
 * @property {string} [sector]
 * @property {string} [industry]
 * @property {string} [description]
 * @property {string} [ceo]
 * @property {string} [website]
 * @property {string} [logoUrl]
 * @property {string} [country]
 * @property {number} [marketCap]
 * @property {number} [sharesOutstanding]
 * @property {number} [employees]
 * @property {string} [phone]
 * @property {string} [address]
 * @property {string} [city]
 * @property {string} [state]
 * @property {string} [zip]
 * @property {string} [isin]
 * @property {string} [cik]
 * @property {string} [foundedAt]
 * @property {string} [ipoDate]
 * @property {string} [asOf]              ISO timestamp of the data
 */

/**
 * @typedef {Object} CompanySearchResult
 * @property {string} symbol
 * @property {string} name
 * @property {string} [exchange]
 * @property {string} [currency]
 * @property {string} [sector]
 * @property {string} [industry]
 */

// ---------------------------------------------------------------------------
// Quote & Price
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Quote
 * @property {string} symbol
 * @property {number} [price]              Latest trade price
 * @property {number} [change]             Absolute change from previous close
 * @property {number} [changePercent]      Percentage change from previous close
 * @property {number} [open]
 * @property {number} [high]               Day high
 * @property {number} [low]                Day low
 * @property {number} [previousClose]
 * @property {number} [volume]
 * @property {number} [avgVolume]
 * @property {number} [marketCap]
 * @property {number} [peRatio]
 * @property {number} [eps]
 * @property {number} [high52Week]
 * @property {number} [low52Week]
 * @property {number} [bid]
 * @property {number} [bidSize]
 * @property {number} [ask]
 * @property {number} [askSize]
 * @property {string} [timestamp]          ISO timestamp of the quote
 */

/**
 * @typedef {Object} HistoricalPrice
 * @property {string} symbol
 * @property {string} date                 ISO date string (YYYY-MM-DD)
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [adjustedClose]
 * @property {number} volume
 */

/**
 * @typedef {Object} HistoricalPricesResult
 * @property {string} symbol
 * @property {HistoricalPrice[]} prices
 * @property {string} resolution           "1min" | "5min" | "15min" | "30min" | "1hour" | "4hour" | "daily" | "weekly" | "monthly"
 * @property {string} [from]
 * @property {string} [to]
 */

// ---------------------------------------------------------------------------
// Financial Statements
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FinancialStatementLine
 * @property {string} label
 * @property {number} value
 */

/**
 * @typedef {Object} IncomeStatement
 * @property {string} symbol
 * @property {string} date                 YYYY-MM-DD
 * @property {string} period               "annual" | "quarter"
 * @property {number} [revenue]
 * @property {number} [costOfRevenue]
 * @property {number} [grossProfit]
 * @property {number} [operatingIncome]
 * @property {number} [netIncome]
 * @property {number} [eps]
 * @property {number} [epsDiluted]
 * @property {number} [ebitda]
 * @property {FinancialStatementLine[]} [lineItems]
 */

/**
 * @typedef {Object} BalanceSheet
 * @property {string} symbol
 * @property {string} date
 * @property {string} period               "annual" | "quarter"
 * @property {number} [totalAssets]
 * @property {number} [totalLiabilities]
 * @property {number} [totalEquity]
 * @property {number} [cashAndEquivalents]
 * @property {number} [shortTermDebt]
 * @property {number} [longTermDebt]
 * @property {number} [currentAssets]
 * @property {number} [currentLiabilities]
 * @property {FinancialStatementLine[]} [lineItems]
 */

/**
 * @typedef {Object} CashFlowStatement
 * @property {string} symbol
 * @property {string} date
 * @property {string} period               "annual" | "quarter"
 * @property {number} [operatingCashFlow]
 * @property {number} [capitalExpenditure]
 * @property {number} [freeCashFlow]
 * @property {number} [dividendsPaid]
 * @property {FinancialStatementLine[]} [lineItems]
 */

/**
 * @typedef {Object} FinancialRatios
 * @property {string} symbol
 * @property {string} date
 * @property {string} period               "annual" | "quarter"
 * @property {number} [peRatio]
 * @property {number} [pbRatio]
 * @property {number} [psRatio]
 * @property {number} [evEbitda]
 * @property {number} [roe]
 * @property {number} [roa]
 * @property {number} [roic]
 * @property {number} [debtToEquity]
 * @property {number} [currentRatio]
 * @property {number} [quickRatio]
 * @property {number} [grossMargin]
 * @property {number} [operatingMargin]
 * @property {number} [netMargin]
 * @property {number} [dividendYield]
 * @property {number} [payoutRatio]
 * @property {Object<string, number>} [additional]
 */

/**
 * @typedef {Object} KeyMetrics
 * @property {string} symbol
 * @property {string} date
 * @property {string} period
 * @property {number} [revenuePerShare]
 * @property {number} [netIncomePerShare]
 * @property {number} [operatingCashFlowPerShare]
 * @property {number} [freeCashFlowPerShare]
 * @property {number} [cashPerShare]
 * @property {number} [bookValuePerShare]
 * @property {number} [tangibleBookValuePerShare]
 * @property {number} [dividendPerShare]
 * @property {number} [marketCap]
 * @property {number} [enterpriseValue]
 * @property {number} [grahamNumber]
 */

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EarningsEvent
 * @property {string} symbol
 * @property {string} date                 YYYY-MM-DD
 * @property {string} period               "annual" | "quarter"
 * @property {string} [fiscalYear]
 * @property {string} [fiscalQuarter]
 * @property {number} [estimatedEps]
 * @property {number} [actualEps]
 * @property {number} [surpriseEps]
 * @property {number} [surpriseEpsPercent]
 * @property {number} [estimatedRevenue]
 * @property {number} [actualRevenue]
 * @property {number} [surpriseRevenue]
 * @property {number} [surpriseRevenuePercent]
 * @property {string} [timeOfDay]          "BMO" | "AMC" | "TAS"
 */

/**
 * @typedef {Object} EarningsCalendarEntry
 * @property {string} symbol
 * @property {string} name
 * @property {string} date                 YYYY-MM-DD
 * @property {string} [fiscalYear]
 * @property {string} [fiscalQuarter]
 * @property {number} [estimatedEps]
 * @property {number} [estimatedRevenue]
 * @property {string} [timeOfDay]          "BMO" | "AMC"
 * @property {string} [exchange]
 */

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DividendRecord
 * @property {string} symbol
 * @property {string} [name]
 * @property {number} [dividend]           Amount per share
 * @property {string} [declarationDate]    YYYY-MM-DD
 * @property {string} [recordDate]         YYYY-MM-DD
 * @property {string} [payableDate]        YYYY-MM-DD
 * @property {string} [exDividendDate]     YYYY-MM-DD
 * @property {string} [frequency]          "quarterly" | "monthly" | "annual" | "semi-annual" | "special"
 * @property {number} [yield]              Dividend yield as percentage
 * @property {number} [annualDividend]     Trailing-12-month dividend
 */

/**
 * @typedef {Object} DividendCalendarEntry
 * @property {string} symbol
 * @property {string} name
 * @property {number} dividend
 * @property {string} date                 YYYY-MM-DD (the key date — usually ex-div)
 * @property {string} [type]               "declaration" | "exDividend" | "record" | "payable"
 * @property {number} [yield]
 */

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} NewsArticle
 * @property {string} id                   Unique provider-agnostic identifier
 * @property {string} title
 * @property {string} [summary]
 * @property {string} [content]
 * @property {string} [url]
 * @property {string} [source]             e.g., "Bloomberg", "Reuters"
 * @property {string} [sourceUrl]
 * @property {string} [imageUrl]
 * @property {string} [publishedAt]        ISO timestamp
 * @property {string} [category]           "general" | "company" | "sector" | "market" | "economy" | "geopolitical"
 * @property {string[]} [symbols]          Related symbols
 * @property {string} [sentiment]          "positive" | "negative" | "neutral"
 */

// ---------------------------------------------------------------------------
// Insider Trading
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} InsiderTrade
 * @property {string} id                   Unique identifier
 * @property {string} symbol
 * @property {string} insiderName
 * @property {string} [title]              Job title / role
 * @property {string} [transactionType]    "buy" | "sell"
 * @property {number} [shares]
 * @property {number} [pricePerShare]
 * @property {number} [totalValue]
 * @property {string} [filingDate]         YYYY-MM-DD
 * @property {string} [transactionDate]    YYYY-MM-DD
 * @property {string} [ownershipType]      "direct" | "indirect"
 * @property {string} [secForm]            4 | 5 | 3
 */

/**
 * @typedef {Object} InsiderOwnership
 * @property {string} symbol
 * @property {string} [insiderName]
 * @property {string} [title]
 * @property {number} [sharesOwned]
 * @property {number} [percentOutstanding]
 * @property {number} [valueAtCurrentPrice]
 * @property {string} [asOf]
 */

// ---------------------------------------------------------------------------
// Analyst Ratings
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AnalystRating
 * @property {string} symbol
 * @property {string} [analystName]
 * @property {string} [firm]
 * @property {string} [rating]             "strongBuy" | "buy" | "hold" | "underperform" | "sell"
 * @property {number} [targetPrice]
 * @property {number} [priceTargetLow]
 * @property {number} [priceTargetHigh]
 * @property {number} [priceTargetAverage]
 * @property {number} [priceTargetMedian]
 * @property {number} [analystCount]
 * @property {string} [date]
 * @property {string} [action]             "upgrade" | "downgrade" | "initiate" | "reiterate" | "maintain"
 */

// ---------------------------------------------------------------------------
// Market Status
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MarketStatus
 * @property {boolean} isOpen
 * @property {string} exchange
 * @property {string} [sessionStatus]      "pre-market" | "open" | "post-market" | "closed" | "holiday"
 * @property {string} [openTime]
 * @property {string} [closeTime]
 * @property {string} [holiday]
 * @property {string} [asOf]
 */

// ---------------------------------------------------------------------------
// Economic Events
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} EconomicEvent
 * @property {string} id
 * @property {string} name
 * @property {string} [country]
 * @property {string} [currency]
 * @property {number} [previous]
 * @property {number} [forecast]
 * @property {number} [actual]
 * @property {string} [unit]
 * @property {string} [importance]         "low" | "medium" | "high"
 * @property {string} eventDate            YYYY-MM-DD
 * @property {string} [eventTime]          HH:MM
 */

// ---------------------------------------------------------------------------
// Executives
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Executive
 * @property {string} symbol
 * @property {string} name
 * @property {string} [title]
 * @property {number} [compensation]
 * @property {number} [sharesOwned]
 * @property {number} [yearBorn]
 * @property {string} [gender]
 */

// ---------------------------------------------------------------------------
// Watchlists
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} WatchlistEntry
 * @property {string} id
 * @property {string} userId
 * @property {string} [workspaceId]
 * @property {string} name
 * @property {string} [description]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

/**
 * @typedef {Object} WatchlistItem
 * @property {string} id
 * @property {string} watchlistId
 * @property {string} symbol
 * @property {string} [name]
 * @property {string} [note]
 * @property {number} [targetPrice]
 * @property {string} [addedAt]
 */

// ---------------------------------------------------------------------------
// Market Events (internal domain events)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MarketEvent
 * @property {string} id                   UUID
 * @property {string} type                 One of MARKET_EVENT_TYPES
 * @property {string} [symbol]
 * @property {Object} payload              Type-specific data
 * @property {string} createdAt            ISO timestamp
 * @property {string} [source]             Provider key
 * @property {"user" | "system" | "provider"} [origin]
 */

const MARKET_EVENT_TYPES = Object.freeze([
  "PRICE_CHANGE",
  "LARGE_GAIN",
  "LARGE_LOSS",
  "HIGH_52_WEEK",
  "LOW_52_WEEK",
  "GAP_UP",
  "GAP_DOWN",
  "TARGET_REACHED",
  "STOP_LOSS_REACHED",
  "DIVIDEND_DECLARED",
  "DIVIDEND_PAYABLE",
  "DIVIDEND_RECEIVED",
  "DIVIDEND_INCREASE",
  "DIVIDEND_CUT",
  "DIVIDEND_YIELD_THRESHOLD",
  "EARNINGS_ANNOUNCED",
  "EARNINGS_UPCOMING",
  "EPS_BEAT",
  "REVENUE_BEAT",
  "EPS_MISS",
  "GUIDANCE_RAISED",
  "GUIDANCE_LOWERED",
  "NEWS_PUBLISHED",
  "BREAKING_NEWS",
  "INSIDER_BUY",
  "INSIDER_SELL",
  "CEO_BUYING",
  "CEO_SELLING",
  "DIRECTOR_BUYING",
  "INSTITUTION_ACCUMULATION",
  "INSTITUTION_SELLING",
  "ANALYST_UPGRADE",
  "ANALYST_DOWNGRADE",
  "PRICE_TARGET_CHANGE",
  "SPLIT",
  "ECONOMIC_EVENT",
  "MARKET_OPEN",
  "MARKET_CLOSE",
  "OPTIONS_EXPIRATION",
  "UNUSUAL_OPTIONS_VOLUME",
  "HIGH_IMPLIED_VOLATILITY",
  "PORTFOLIO_MOVEMENT",
  "PORTFOLIO_ATH",
  "PORTFOLIO_DRAWDOWN",
  "ALLOCATION_DRIFT",
  "CASH_ALLOCATION_THRESHOLD",
  "SECTOR_EXPOSURE_DRIFT",
  "REBALANCE_REMINDER",
  "TAX_LOSS_HARVESTING",
  "PORTFOLIO_REVIEW_REMINDER"
]);

// ---------------------------------------------------------------------------
// Portfolio Signals
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PortfolioSignal
 * @property {string} id
 * @property {string} userId
 * @property {string} [workspaceId]
 * @property {string} eventId              Reference to the source MarketEvent
 * @property {string} eventType            Matches MARKET_EVENT_TYPES
 * @property {string} [symbol]
 * @property {Object} [payload]            Context (e.g., PnL, allocation %)
 * @property {"info" | "warning" | "alert" | "critical"} severity
 * @property {boolean} [acknowledged]
 * @property {string} [acknowledgedAt]
 * @property {string} createdAt
 */

// ---------------------------------------------------------------------------
// Alert Rules
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AlertRule
 * @property {string} id
 * @property {string} userId
 * @property {string} [workspaceId]
 * @property {string} name
 * @property {string} eventType            MARKET_EVENT_TYPES value
 * @property {string} [symbol]             null = portfolio-level
 * @property {Object} conditions           Rule conditions (threshold, direction, etc.)
 * @property {string[]} channels           ["push", "email", "sms", "inApp"]
 * @property {boolean} enabled
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 */

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Notification
 * @property {string} id
 * @property {string} userId
 * @property {string} [workspaceId]
 * @property {string} title
 * @property {string} body
 * @property {string} [category]
 * @property {string} [actionUrl]
 * @property {string[]} channels           Delivered to which channels
 * @property {"pending" | "delivered" | "failed" | "read"} status
 * @property {string} [deliveredAt]
 * @property {string} [readAt]
 * @property {string} createdAt
 */

// ---------------------------------------------------------------------------
// Value-object factories
// ---------------------------------------------------------------------------

/**
 * @param {number|string|null|undefined} value
 * @param {number} [defaultValue=0]
 * @returns {number}
 */
function toNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * @param {number|string|null|undefined} value
 * @returns {number|null}
 */
function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string|Date|number|undefined} value
 * @returns {string|null} ISO string or null
 */
function toIso(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * @param {string|Date|number|undefined} value
 * @returns {string|null} YYYY-MM-DD string or null
 */
function toDateString(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

/**
 * @param {string} [date]
 * @returns {string} YYYY-MM-DD
 */
function todayDate(date) {
  return toDateString(date || new Date()) || new Date().toISOString().split("T")[0];
}

/**
 * Generate a provider-independent UUID v4-compatible string.
 * @returns {string}
 */
function generateId() {
  const hex = "0123456789abcdef";
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map((len) =>
      Array.from({ length: len }, () => hex[Math.floor(Math.random() * 16)]).join("")
    )
    .join("-");
}

module.exports = {
  MARKET_EVENT_TYPES,
  toNumber,
  toNumberOrNull,
  toIso,
  toDateString,
  todayDate,
  generateId
};
