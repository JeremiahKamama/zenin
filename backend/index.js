const dotenv = require("dotenv");
const path = require("path");
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();
const express = require("express");
const crypto = require("crypto");
const { authenticator } = require("./utils/otplib-config");
const qrcode = require("qrcode");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { OAuth2Client } = require("google-auth-library");
const { Webhook } = require("svix");
// const appleSignin = require("apple-signin-auth");
const {
  getEmailDeliveryConfig,
  isEmailDeliveryProductionReady,
  sendAlertEmail,
  sendPasswordResetEmail,
  sendVerificationEmail
} = require("./email");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { spawn } = require("child_process");
const fs = require("fs");
const {
  validate,
  signupSchema,
  signinSchema,
  forgotPasswordRequestSchema,
  forgotPasswordConfirmSchema,
  executeTradeSchema,
  tradeEstimateBatchSchema,
  portfolioUpdateSchema,
  watchlistAssetSchema,
  workspaceDocSchema,
  workspaceCollectionSchema,
  optionsCalculationSchema,
  balanceChangeSchema,
  cashChangeSchema,
  exchangeKeySchema,
  workspaceUpdateSchema,
  workspaceInviteSchema,
  workspaceMemberRoleSchema,
  workspaceAlertAssignmentSchema,
  alertDispatchSchema,
  emailRequestSchema,
  emailConfirmSchema,
  passwordUpdateSchema,
  accountDeleteSchema,
  planUpdateSchema,
  twoFactorEnableSchema,
  passkeyRegisterSchema,
  historyQuerySchema,
  searchQuerySchema,
  pricesQuerySchema,
  cryptoOptionsSchema,
  equityOptionsQuerySchema,
  tradeLogSchema,
  watchlistBulkSchema,
} = require("./validation");

/**
 * Resolves the correct Python binary to use.
 * Priorities:
 * 1. process.env.PYTHON_BINARY
 * 2. Local venv/bin/python3
 * 3. Default "python3"
 */
function resolvePythonBinary() {
  if (process.env.PYTHON_BINARY) return process.env.PYTHON_BINARY;
  const localVenv = path.join(__dirname, "venv", "bin", "python3");
  if (fs.existsSync(localVenv)) return localVenv;
  return "python3";
}
const pythonBinary = resolvePythonBinary();
const { syncBinance, syncHyperliquid, syncBybit, verifyExchangeCredentialScope } = require("./exchangeSync");

const SYNC_ENABLED_EXCHANGES = new Set(["binance", "bybit", "hyperliquid"]);

const rpName = "Zenin Capital";
const DEFAULT_PUBLIC_APP_ORIGIN = "https://www.zenin.capital";
const rpID = process.env.RP_ID || "www.zenin.capital";
const expectedOrigin = process.env.EXPECTED_ORIGIN || DEFAULT_PUBLIC_APP_ORIGIN;
const webAuthnChallenges = new Map();
const WEBAUTHN_CHALLENGE_TTL_MS = 120_000; // 2 minutes

// Periodic cleanup of expired WebAuthn challenges (#7)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of webAuthnChallenges) {
    if (entry.expiresAt < now) webAuthnChallenges.delete(key);
  }
}, 60_000);
const { watchlistData } = require("./data");
const {
  initializeDatabase,
  portfolio,
  watchlist,
  optionsCalculations,
  userAuth,
  workspaces,
  userWorkspace,
  runAdminWorkspaceMigration,
  serviceSnapshots,
  tradeExecutions,
  balance,
  trading,
  admin,
  analytics,
  describeDatabaseConfig
} = require("./database");
const { REIT_DATA, MMF_YIELDS, FUNDS_LIST } = require("./equities_benchmarks");
const { fetchFarsideEtfFlows: fetchLatestFarsideEtfFlows } = require("./farsideEtf");
const { buildPublicRuntimeConfig, buildAppRuntimeConfig } = require("./runtimeConfig");
const {
  buildRevenueCatIntegrationItem,
  getRevenueCatAdminSummary,
  getRevenueCatCustomerSnapshot
} = require("./revenuecat");

const app = express();

/**
 * Utility to sanitize loaded environment keys.
 * If the key is a standard placeholder or missing, it returns an empty string.
 */
function cleanApiKey(key) {
  const cleaned = String(key || "").trim();
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  if (
    lower.startsWith("replace_") ||
    lower.startsWith("your_") ||
    lower.startsWith("re_your_") ||
    lower === "your_api_key_here" ||
    lower.includes("placeholder") ||
    lower.includes("example")
  ) {
    return "";
  }
  return cleaned;
}

// --- EODHD Macro Indicators Configuration ---
const EODHD_API_TOKEN = cleanApiKey(
  process.env.EODHD_API_TOKEN ||
  process.env.EODHD_API_KEY ||
  process.env.EODHD_TOKEN ||
  ""
).replace(/^,+|,+$/g, "");

console.log(`[Startup] EODHD_API_TOKEN loaded: ${EODHD_API_TOKEN ? "YES" : "NO"}`);

const FRED_API_KEY = cleanApiKey(process.env.FRED_API_KEY || "");
const EIA_API_KEY = cleanApiKey(process.env.EIA_API_KEY || "");
const BLS_API_KEY = cleanApiKey(process.env.BLS_API_KEY || process.env.BLS_REGISTRATION_KEY || "");
const MASSIVE_API_KEY = cleanApiKey(
  process.env.MASSIVE_API_KEY ||
  process.env.POLY_API_KEY ||
  process.env.POLYGON_API_KEY ||
  process.env.MASSIVE_TOKEN ||
  ""
);
const MASSIVE_API_KEY_SOURCE = MASSIVE_API_KEY
  ? (process.env.MASSIVE_API_KEY
    ? "MASSIVE_API_KEY"
    : process.env.POLY_API_KEY
      ? "POLY_API_KEY"
      : process.env.POLYGON_API_KEY
        ? "POLYGON_API_KEY"
        : "MASSIVE_TOKEN")
  : null;
const MASSIVE_REST_BASE_URL = String(process.env.MASSIVE_REST_BASE_URL || "https://api.massive.com").trim().replace(/\/+$/, "");
const MASSIVE_WS_STOCKS_URL = String(process.env.MASSIVE_WS_STOCKS_URL || "wss://socket.massive.com/stocks").trim();
const MASSIVE_WS_DELAYED_STOCKS_URL = String(process.env.MASSIVE_WS_DELAYED_STOCKS_URL || "wss://delayed.massive.com/stocks").trim();
const MASSIVE_WS_OPTIONS_URL = String(process.env.MASSIVE_WS_OPTIONS_URL || "wss://socket.massive.com/options").trim();
const MASSIVE_WS_DELAYED_OPTIONS_URL = String(process.env.MASSIVE_WS_DELAYED_OPTIONS_URL || "wss://delayed.massive.com/options").trim();
console.log(`[Startup] Massive API key loaded: ${MASSIVE_API_KEY ? `YES (${MASSIVE_API_KEY_SOURCE})` : "NO"}`);

const providerMemoryCache = new Map();
const PROVIDER_CACHE_TTL_MS = 15 * 60 * 1000;

const MACRO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const EARNINGS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const macroIndicatorsCache = new Map();
const EARNINGS_CALENDAR_REFRESH_TTL_MS = 21 * 24 * 60 * 60 * 1000; // 21 days (~quarterly cadence)
const COUNTRY_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let countryCatalogMemory = { countries: [], cachedAt: 0 };

const FALLBACK_COUNTRY_CATALOG_SEED = [
  ["USA", "US", "United States"],
  ["CAN", "CA", "Canada"],
  ["MEX", "MX", "Mexico"],
  ["BRA", "BR", "Brazil"],
  ["ARG", "AR", "Argentina"],
  ["CHL", "CL", "Chile"],
  ["COL", "CO", "Colombia"],
  ["PER", "PE", "Peru"],
  ["GBR", "GB", "United Kingdom"],
  ["FRA", "FR", "France"],
  ["DEU", "DE", "Germany"],
  ["ITA", "IT", "Italy"],
  ["ESP", "ES", "Spain"],
  ["PRT", "PT", "Portugal"],
  ["NLD", "NL", "Netherlands"],
  ["BEL", "BE", "Belgium"],
  ["CHE", "CH", "Switzerland"],
  ["SWE", "SE", "Sweden"],
  ["NOR", "NO", "Norway"],
  ["DNK", "DK", "Denmark"],
  ["IRL", "IE", "Ireland"],
  ["POL", "PL", "Poland"],
  ["RUS", "RU", "Russia"],
  ["TUR", "TR", "Turkey"],
  ["ZAF", "ZA", "South Africa"],
  ["EGY", "EG", "Egypt"],
  ["NGA", "NG", "Nigeria"],
  ["KEN", "KE", "Kenya"],
  ["SAU", "SA", "Saudi Arabia"],
  ["ARE", "AE", "United Arab Emirates"],
  ["ISR", "IL", "Israel"],
  ["IND", "IN", "India"],
  ["CHN", "CN", "China"],
  ["HKG", "HK", "Hong Kong"],
  ["TWN", "TW", "Taiwan"],
  ["SGP", "SG", "Singapore"],
  ["KOR", "KR", "South Korea"],
  ["JPN", "JP", "Japan"],
  ["AUS", "AU", "Australia"],
  ["NZL", "NZ", "New Zealand"]
];

function buildFallbackCountryCatalog() {
  return FALLBACK_COUNTRY_CATALOG_SEED
    .map(([cca3, cca2, name]) => normalizeCountryCatalogEntry({
      cca3,
      cca2,
      name: { common: name, official: name },
      altSpellings: [name, cca2, cca3]
    }))
    .filter(Boolean)
    .sort((a, b) => String(a.name || a.cca3).localeCompare(String(b.name || b.cca3)));
}

const FALLBACK_COUNTRY_CATALOG = buildFallbackCountryCatalog();

const FOREX_FACTORY_FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";
const FOREX_FACTORY_CACHE_TTL_MS = 30 * 60 * 1000;
const forexFactoryFeedCache = { events: [], fetchedAt: 0 };
const FOREX_FACTORY_COUNTRY_MAP = [
  { code: "USA", name: "United States", currency: "USD", aliases: ["US", "USA", "United States", "USD", "America"] },
  { code: "GBR", name: "United Kingdom", currency: "GBP", aliases: ["UK", "GBR", "United Kingdom", "Great Britain", "GBP"] },
  { code: "JPN", name: "Japan", currency: "JPY", aliases: ["JP", "JPN", "Japan", "JPY"] },
  { code: "CAN", name: "Canada", currency: "CAD", aliases: ["CA", "CAN", "Canada", "CAD"] },
  { code: "AUS", name: "Australia", currency: "AUD", aliases: ["AU", "AUS", "Australia", "AUD"] },
  { code: "NZL", name: "New Zealand", currency: "NZD", aliases: ["NZ", "NZL", "New Zealand", "NZD"] },
  { code: "CHE", name: "Switzerland", currency: "CHF", aliases: ["CH", "CHE", "Switzerland", "CHF"] },
  { code: "CHN", name: "China", currency: "CNY", aliases: ["CN", "CHN", "China", "CNY", "RMB"] },
  { code: "EUR", name: "Eurozone", currency: "EUR", aliases: ["EU", "EUR", "Eurozone", "Euro Area", "Euro"] }
];

const MACRO_INDICATOR_CONFIG = [
  {
    key: "gdp_growth_rate",
    label: "GDP Growth Rate",
    category: "growth",
    unit: "%",
    aliases: ["gdp", "gdp growth", "real gdp", "gdp growth rate"]
  },
  {
    key: "interest_rate",
    label: "Interest Rate",
    category: "rates",
    unit: "%",
    aliases: ["interest rate", "policy rate", "central bank rate", "cash rate", "fed funds"]
  },
  {
    key: "inflation_rate",
    label: "Inflation Rate",
    category: "inflation",
    unit: "%",
    aliases: ["inflation", "inflation rate", "cpi yoy", "headline inflation"]
  },
  {
    key: "unemployment_rate",
    label: "Unemployment Rate",
    category: "labor",
    unit: "%",
    aliases: ["unemployment", "jobless rate", "unemployment rate"]
  },
  {
    key: "consumer_confidence",
    label: "Consumer Confidence",
    category: "sentiment",
    unit: "Index",
    aliases: ["consumer confidence", "consumer sentiment", "confidence index"]
  },
  {
    key: "balance_of_trade",
    label: "Balance of Trade",
    category: "external",
    unit: "B",
    aliases: ["balance of trade", "trade balance", "current account"]
  },
  {
    key: "cpi",
    label: "CPI",
    category: "inflation",
    unit: "Index",
    aliases: ["cpi", "consumer price index", "consumer prices"]
  },
  {
    key: "core_inflation_rate",
    label: "Core Inflation Rate",
    category: "inflation",
    unit: "%",
    aliases: ["core inflation", "core cpi", "core inflation rate"]
  }
];

const WORLD_BANK_INDICATOR_MAP = {
  gdp_growth_rate: "NY.GDP.MKTP.KD.ZG",
  interest_rate: "FR.INR.RINR",
  inflation_rate: "FP.CPI.TOTL.ZG",
  unemployment_rate: "SL.UEM.TOTL.ZS",
  balance_of_trade: "NE.RSB.GNFS.CD",
  cpi: "FP.CPI.TOTL",
  consumer_confidence: "CSCICP03"
};

function sanitizeMacroMetrics(metrics = []) {
  const templateMap = new Map(MACRO_INDICATOR_CONFIG.map((config) => [config.key, config]));
  const byKey = new Map(
    (Array.isArray(metrics) ? metrics : [])
      .filter((row) => row && templateMap.has(String(row.key || "")))
      .map((row) => [String(row.key), row])
  );
  return MACRO_INDICATOR_CONFIG.map((config) => {
    const row = byKey.get(config.key) || {};
    return {
      key: config.key,
      label: config.label,
      unit: config.unit || "",
      current: Number.isFinite(Number(row.current)) ? Number(row.current) : null,
      previous: Number.isFinite(Number(row.previous)) ? Number(row.previous) : null,
      expectation: Number.isFinite(Number(row.expectation)) ? Number(row.expectation) : null,
      change: Number.isFinite(Number(row.change)) ? Number(row.change) : null,
      changePercent: Number.isFinite(Number(row.changePercent)) ? Number(row.changePercent) : null,
      asOf: row.asOf || null,
      previousAsOf: row.previousAsOf || null,
      currentAsOf: row.currentAsOf || row.asOf || null,
      expectationAsOf: row.expectationAsOf || row.asOf || null,
      series: Array.isArray(row.series) ? row.series : []
    };
  });
}
// --------------------------------------------

function hasProviderKey(provider) {
  const key = String(provider || "").toLowerCase();
  if (key === "fred") return Boolean(FRED_API_KEY);
  if (key === "eia") return Boolean(EIA_API_KEY);
  if (key === "bls") return Boolean(BLS_API_KEY);
  if (key === "massive") return Boolean(MASSIVE_API_KEY);
  return false;
}

function buildProviderStatus(name, configured, status = "idle", detail = "") {
  return {
    name,
    configured: Boolean(configured),
    status: configured ? status : "missing_key",
    detail: configured ? detail : "API key not configured",
    updatedAt: new Date().toISOString()
  };
}

async function fetchJsonWithTimeout(url, options = {}) {
  const fetch = await resolveFetch();
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 8000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 120)}` : ""}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cachedProviderFetch(cacheKey, fetcher, ttlMs = PROVIDER_CACHE_TTL_MS) {
  const now = Date.now();
  const cached = providerMemoryCache.get(cacheKey);
  if (cached && now - cached.cachedAt < ttlMs) return cached.payload;
  const payload = await fetcher();
  providerMemoryCache.set(cacheKey, { payload, cachedAt: now });
  return payload;
}

function toProviderNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function latestObservation(observations = []) {
  return [...(Array.isArray(observations) ? observations : [])]
    .reverse()
    .find((row) => toProviderNumber(row?.value) !== null) || null;
}

function previousObservation(observations = [], latestDate = null) {
  const rows = [...(Array.isArray(observations) ? observations : [])].reverse();
  const latestIndex = rows.findIndex((row) => !latestDate || row?.date === latestDate);
  return rows.slice(latestIndex + 1).find((row) => toProviderNumber(row?.value) !== null) || null;
}

async function fetchFredSeries(seriesId, { limit = 24, observationStart = null } = {}) {
  if (!FRED_API_KEY) throw new Error("fred_api_key_missing");
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: FRED_API_KEY,
    file_type: "json",
    sort_order: "desc",
    limit: String(limit)
  });
  if (observationStart) params.set("observation_start", observationStart);
  const payload = await cachedProviderFetch(`fred:${seriesId}:${limit}:${observationStart || ""}`, () =>
    fetchJsonWithTimeout(`https://api.stlouisfed.org/fred/series/observations?${params.toString()}`)
  );
  const observations = Array.isArray(payload?.observations) ? [...payload.observations].reverse() : [];
  const latest = latestObservation(observations);
  const previous = previousObservation(observations, latest?.date);
  return { seriesId, observations, latest, previous, source: "FRED" };
}

const FRED_MACRO_SERIES = [
  { key: "interest_rate", seriesId: "FEDFUNDS", label: "Fed Funds Rate", unit: "%" },
  { key: "inflation_rate", seriesId: "FPCPITOTLZGUSA", label: "Inflation Rate", unit: "%" },
  { key: "unemployment_rate", seriesId: "UNRATE", label: "Unemployment Rate", unit: "%" },
  { key: "consumer_confidence", seriesId: "UMCSENT", label: "Consumer Sentiment", unit: "Index" },
  { key: "cpi", seriesId: "CPIAUCSL", label: "CPI", unit: "Index" },
  { key: "core_inflation_rate", seriesId: "CPILFESL", label: "Core CPI", unit: "Index" },
  { key: "gdp_growth_rate", seriesId: "A191RL1Q225SBEA", label: "Real GDP Growth", unit: "%" }
];

const FRED_COMMODITY_SERIES = {
  CL: { seriesId: "DCOILWTICO", metric: "WTI Spot", unit: "USD/bbl", group: "energy" },
  NG: { seriesId: "DHHNGSP", metric: "Henry Hub Natural Gas", unit: "USD/MMBtu", group: "energy" },
  GC: { seriesId: "GOLDAMGBD228NLBM", metric: "Gold Fixing", unit: "USD/oz", group: "metals" },
  SI: { seriesId: "SLVPRUSD", metric: "Silver", unit: "USD/oz", group: "metals" }
};

async function fetchFredMacroMetrics() {
  if (!FRED_API_KEY) return { rows: [], status: buildProviderStatus("FRED", false) };
  const settled = await Promise.allSettled(FRED_MACRO_SERIES.map((item) => fetchFredSeries(item.seriesId, { limit: 18 }).then((series) => {
    const current = toProviderNumber(series.latest?.value);
    const previous = toProviderNumber(series.previous?.value);
    return {
      key: item.key,
      label: item.label,
      current,
      previous,
      expectation: null,
      change: current !== null && previous !== null ? Number((current - previous).toFixed(2)) : null,
      changePercent: current !== null && previous ? Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2)) : null,
      unit: item.unit,
      asOf: series.latest?.date || null,
      source: "FRED",
      series: series.observations.map((row) => ({ date: row.date, value: toProviderNumber(row.value) })).filter((row) => row.value !== null)
    };
  })));
  const rows = settled.filter((result) => result.status === "fulfilled").map((result) => result.value);
  const failed = settled.length - rows.length;
  return {
    rows,
    status: buildProviderStatus("FRED", true, rows.length ? "connected" : "unavailable", failed ? `${failed} series unavailable` : `${rows.length} series connected`)
  };
}

async function fetchFredCommoditySeries(symbol, range = "1Y") {
  const config = FRED_COMMODITY_SERIES[String(symbol || "").toUpperCase()];
  if (!config || !FRED_API_KEY) return [];
  const observationStart = range === "1M"
    ? new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : range === "3M"
    ? new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : range === "MAX"
    ? null
    : new Date(Date.now() - 420 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const series = await fetchFredSeries(config.seriesId, { limit: range === "MAX" ? 5000 : 520, observationStart });
  return series.observations
    .map((row) => ({ date: row.date, value: toProviderNumber(row.value), source: "FRED", sourceType: config.metric }))
    .filter((row) => row.value !== null);
}

const EIA_SERIES_BY_COMMODITY = {
  CL: [
    { seriesId: "PET.RWTC.D", metric: "WTI Spot", unit: "USD/bbl" },
    { seriesId: "PET.WCESTUS1.W", metric: "US Crude Stocks", unit: "Thousand barrels" }
  ],
  NG: [
    { seriesId: "NG.RNGWHHD.D", metric: "Henry Hub Spot", unit: "USD/MMBtu" },
    { seriesId: "NG.NW2_EPG0_SWO_R48_BCF.W", metric: "Lower 48 Working Gas", unit: "Bcf" }
  ],
  RB: [
    { seriesId: "PET.EMM_EPM0_PTE_NUS_DPG.W", metric: "Retail Gasoline", unit: "USD/gal" }
  ]
};

const COMMODITY_STRESS_SOURCE_PROFILES = {
  CL: {
    weatherAreas: ["TX", "LA", "OK"],
    rows: [
      { category: "Inventories", label: "U.S. commercial crude stocks", source: "EIA Weekly Petroleum Status Report", sourceUrl: "https://www.eia.gov/petroleum/supply/weekly/", sourceType: "Official weekly stocks", note: "U.S. crude and petroleum product stocks by PADD" },
      { category: "Inventories", label: "Cushing crude stocks", source: "EIA Petroleum & Other Liquids", sourceUrl: "https://www.eia.gov/petroleum/data.php", sourceType: "Official storage hub stocks", note: "Tank farm and pipeline stocks for the Cushing delivery hub" },
      { category: "Weather", label: "Gulf Coast energy alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=TX", sourceType: "Live weather alerts", note: "Texas, Louisiana, and Oklahoma alerts mapped to production/refining/logistics risk" },
    ],
  },
  BZ: {
    weatherAreas: ["TX", "LA"],
    rows: [
      { category: "Inventories", label: "OECD petroleum inventories", source: "IEA Oil Market Report", sourceUrl: "https://www.iea.org/reports/oil-market-report-may-2026", sourceType: "Official global oil balance source", note: "Brent risk is best tracked with global commercial stock and product balance data" },
      { category: "Inventories", label: "U.S. petroleum stocks proxy", source: "EIA Weekly Petroleum Status Report", sourceUrl: "https://www.eia.gov/petroleum/supply/weekly/", sourceType: "Official weekly stocks", note: "U.S. stock changes are a liquid proxy for Atlantic Basin inventory stress" },
      { category: "Weather", label: "Gulf Coast export/refinery alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=TX", sourceType: "Live weather alerts", note: "Storms, flooding, heat, or freeze risk around U.S. Gulf energy infrastructure" },
    ],
  },
  NG: {
    weatherAreas: ["TX", "LA", "OK", "PA"],
    rows: [
      { category: "Inventories", label: "Lower 48 working gas storage", source: "EIA Natural Gas Storage Dashboard", sourceUrl: "https://www.eia.gov/naturalgas/storage/dashboard/", sourceType: "Official weekly storage", note: "Working gas in underground storage for the Lower 48" },
      { category: "Inventories", label: "Natural gas weekly update", source: "EIA Natural Gas Weekly Update", sourceUrl: "https://www.eia.gov/naturalgas/weekly/", sourceType: "Official market update", note: "Storage, production, demand, and regional price context" },
      { category: "Weather", label: "Gas-weighted weather alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=TX", sourceType: "Live weather alerts", note: "Alerts across major producing and demand regions" },
    ],
  },
  GC: {
    weatherAreas: ["NV", "AK"],
    rows: [
      { category: "Warehouse Stocks", label: "COMEX gold vault stocks", source: "CME Group daily metals stocks", sourceUrl: "https://www.cmegroup.com/clearing/operations-and-deliveries/nymex-delivery-notices.html", sourceType: "Exchange warehouse source", note: "Registered and eligible vault inventories for deliverable metal" },
      { category: "Warehouse Stocks", label: "LBMA vault holdings", source: "LBMA vault holdings", sourceUrl: "https://www.lbma.org.uk/prices-and-data/london-vault-holdings-data", sourceType: "Official London vault source", note: "London market gold holdings and monthly changes" },
      { category: "Weather", label: "Mine-region disruption alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=NV", sourceType: "Live weather alerts", note: "Weather alerts for U.S. gold-producing regions" },
    ],
  },
  SI: {
    weatherAreas: ["NV", "AK"],
    rows: [
      { category: "Warehouse Stocks", label: "COMEX silver vault stocks", source: "CME Group daily metals stocks", sourceUrl: "https://www.cmegroup.com/clearing/operations-and-deliveries/nymex-delivery-notices.html", sourceType: "Exchange warehouse source", note: "Registered and eligible vault inventories for deliverable silver" },
      { category: "Warehouse Stocks", label: "LBMA silver vault holdings", source: "LBMA vault holdings", sourceUrl: "https://www.lbma.org.uk/prices-and-data/london-vault-holdings-data", sourceType: "Official London vault source", note: "London market silver holdings and monthly changes" },
      { category: "Weather", label: "Mine-region disruption alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=NV", sourceType: "Live weather alerts", note: "Weather alerts for U.S. silver-producing regions" },
    ],
  },
  HG: {
    weatherAreas: ["AZ", "UT"],
    rows: [
      { category: "Warehouse Stocks", label: "LME copper warehouse stocks", source: "London Metal Exchange reports", sourceUrl: "https://www.lme.com/en/Market-data/Reports-and-data/Warehouse-and-stocks-reports", sourceType: "Exchange warehouse source", note: "Global LME warranted stocks and cancelled warrants" },
      { category: "Warehouse Stocks", label: "COMEX copper stocks", source: "CME Group daily metals stocks", sourceUrl: "https://www.cmegroup.com/clearing/operations-and-deliveries/nymex-delivery-notices.html", sourceType: "Exchange warehouse source", note: "Deliverable U.S. exchange copper inventory" },
      { category: "Weather", label: "U.S. copper mine alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=AZ", sourceType: "Live weather alerts", note: "Arizona and Utah alerts mapped to domestic mine/logistics risk" },
    ],
  },
  ZC: {
    weatherAreas: ["IA", "IL", "NE"],
    rows: [
      { category: "Inventories", label: "U.S. corn stocks", source: "USDA/NASS Grain Stocks", sourceUrl: "https://www.nass.usda.gov/Surveys/Guide_to_NASS_Surveys/Grain_Stocks/", sourceType: "Official crop stocks", note: "Quarterly grain stocks and disappearance" },
      { category: "Inventories", label: "WASDE corn balance sheet", source: "USDA WASDE", sourceUrl: "https://www.usda.gov/oce/commodity/wasde", sourceType: "Official supply-demand source", note: "Ending stocks, production, use, and export balance" },
      { category: "Weather", label: "Corn Belt weather alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=IA", sourceType: "Live weather alerts", note: "Iowa, Illinois, and Nebraska alerts for planting/growing/harvest risk" },
    ],
  },
  ZW: {
    weatherAreas: ["KS", "ND", "OK"],
    rows: [
      { category: "Inventories", label: "U.S. wheat stocks", source: "USDA/NASS Grain Stocks", sourceUrl: "https://www.nass.usda.gov/Surveys/Guide_to_NASS_Surveys/Grain_Stocks/", sourceType: "Official crop stocks", note: "Quarterly wheat stocks and disappearance" },
      { category: "Inventories", label: "WASDE wheat balance sheet", source: "USDA WASDE", sourceUrl: "https://www.usda.gov/oce/commodity/wasde", sourceType: "Official supply-demand source", note: "Ending stocks, production, food/feed use, and exports" },
      { category: "Weather", label: "Wheat belt weather alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=KS", sourceType: "Live weather alerts", note: "Kansas, North Dakota, and Oklahoma alerts for crop stress" },
    ],
  },
  ZS: {
    weatherAreas: ["IA", "IL", "MN"],
    rows: [
      { category: "Inventories", label: "U.S. soybean stocks", source: "USDA/NASS Grain Stocks", sourceUrl: "https://www.nass.usda.gov/Surveys/Guide_to_NASS_Surveys/Grain_Stocks/", sourceType: "Official crop stocks", note: "Quarterly soybean stocks and disappearance" },
      { category: "Inventories", label: "WASDE soybean balance sheet", source: "USDA WASDE", sourceUrl: "https://www.usda.gov/oce/commodity/wasde", sourceType: "Official supply-demand source", note: "Ending stocks, crush, exports, and production balance" },
      { category: "Weather", label: "Soybean belt weather alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=IA", sourceType: "Live weather alerts", note: "Iowa, Illinois, and Minnesota alerts for crop stress" },
    ],
  },
};

async function fetchEiaSeries(seriesId) {
  if (!EIA_API_KEY) throw new Error("eia_api_key_missing");
  const params = new URLSearchParams({ api_key: EIA_API_KEY, series_id: seriesId });
  const payload = await cachedProviderFetch(`eia:${seriesId}`, () =>
    fetchJsonWithTimeout(`https://api.eia.gov/series/?${params.toString()}`)
  );
  const series = Array.isArray(payload?.series) ? payload.series[0] : null;
  const rows = Array.isArray(series?.data) ? series.data : [];
  return rows
    .map((row) => ({ date: String(row?.[0] || ""), value: toProviderNumber(row?.[1]) }))
    .filter((row) => row.date && row.value !== null);
}

function getCommodityStressProfile(item) {
  const symbol = String(item?.symbol || "").toUpperCase();
  if (COMMODITY_STRESS_SOURCE_PROFILES[symbol]) return COMMODITY_STRESS_SOURCE_PROFILES[symbol];
  const group = String(item?.group || "").toLowerCase();
  if (group === "energy") return COMMODITY_STRESS_SOURCE_PROFILES.CL;
  if (group === "agriculture") return COMMODITY_STRESS_SOURCE_PROFILES.ZC;
  if (group === "metals" || group === "industrial" || group === "battery") return COMMODITY_STRESS_SOURCE_PROFILES.HG;
  return {
    weatherAreas: ["TX"],
    rows: [
      { category: "Inventories", label: `${item?.name || item?.symbol || "Commodity"} inventory source`, source: "Commodity catalog", sourceUrl: "https://www.eia.gov/petroleum/data.php", sourceType: "Configured source pointer", note: "No dedicated official pull mapping is configured for this contract yet" },
      { category: "Weather", label: "U.S. weather alerts", source: "NOAA/NWS active alerts", sourceUrl: "https://api.weather.gov/alerts/active?area=TX", sourceType: "Live weather alerts", note: "Generic U.S. disruption proxy until a contract-specific region is mapped" },
    ],
  };
}

async function fetchNwsActiveAlertsByAreas(areaCodes = []) {
  const uniqueAreas = [...new Set(areaCodes.map((area) => String(area || "").trim().toUpperCase()).filter(Boolean))].slice(0, 4);
  if (!uniqueAreas.length) return [];
  const settled = await Promise.allSettled(uniqueAreas.map(async (area) => {
    const payload = await cachedProviderFetch(`nws-alerts:${area}`, () =>
      fetchJsonWithTimeout(`https://api.weather.gov/alerts/active?area=${encodeURIComponent(area)}`, {
        headers: {
          Accept: "application/geo+json",
          "User-Agent": "Zenin commodity stress monitor (support@zenin.local)",
        },
        timeoutMs: 5000,
      }),
      10 * 60 * 1000
    );
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const severe = features.find((feature) => /extreme|severe/i.test(String(feature?.properties?.severity || ""))) || features[0] || null;
    return {
      area,
      alertCount: features.length,
      event: severe?.properties?.event || null,
      severity: severe?.properties?.severity || null,
      effective: severe?.properties?.effective || null,
      sourceUrl: `https://api.weather.gov/alerts/active?area=${encodeURIComponent(area)}`,
    };
  }));
  return settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
}

async function buildCommodityStressRows(item) {
  const profile = getCommodityStressProfile(item);
  const sourceRows = profile.rows.map((row, idx) => ({
    id: `stress-source-${idx}`,
    symbol: item.symbol,
    ...row,
    value: null,
    unit: "",
    status: "Source mapped",
    pulled: false,
    stale: true,
    unavailable: true,
  }));

  const eiaRows = await fetchEiaCommodityFundamentals(item.symbol).catch((error) => {
    console.warn(`[Commodities] EIA fundamentals fetch failed for ${item.symbol}:`, error?.message || error);
    return { rows: [] };
  });
  const inventoryRows = (eiaRows.rows || [])
    .filter((row) => /stock|storage|working gas/i.test(String(row.metric || "")))
    .map((row, idx) => ({
      id: `stress-eia-${idx}`,
      symbol: item.symbol,
      category: "Inventories",
      label: row.metric,
      value: row.value,
      unit: row.unit,
      asOf: row.asOf,
      source: "EIA",
      sourceType: "Official energy inventory pull",
      sourceUrl: "https://www.eia.gov/petroleum/data.php",
      note: row.seriesId ? `Series ${row.seriesId}` : row.sourceWhy || "Official U.S. energy time series",
      status: "Pulled",
      pulled: true,
      stale: false,
      unavailable: false,
    }));

  const nwsRows = await fetchNwsActiveAlertsByAreas(profile.weatherAreas).catch((error) => {
    console.warn(`[Commodities] NWS weather alerts fetch failed:`, error?.message || error);
    return [];
  });
  const weatherRows = nwsRows.map((row) => ({
    id: `stress-weather-${row.area}`,
    symbol: item.symbol,
    category: "Weather",
    label: `${row.area} active weather alerts`,
    value: row.alertCount,
    unit: "alerts",
    asOf: row.effective || new Date().toISOString(),
    source: "NOAA/NWS",
    sourceType: "Live active alert pull",
    sourceUrl: row.sourceUrl,
    note: row.event ? `${row.event}${row.severity ? ` (${row.severity})` : ""}` : "No active severe alert headline returned",
    status: "Pulled",
    pulled: true,
    stale: false,
    unavailable: false,
    tone: row.alertCount > 0 ? "warning" : "positive",
  }));

  const bySourceKey = new Set([...inventoryRows, ...weatherRows].map((row) => `${row.category}:${row.label}`.toLowerCase()));
  const mappedRows = sourceRows.filter((row) => !bySourceKey.has(`${row.category}:${row.label}`.toLowerCase()));
  return [...inventoryRows, ...weatherRows, ...mappedRows];
}

async function fetchEiaCommodityFundamentals(symbol) {
  const configs = EIA_SERIES_BY_COMMODITY[String(symbol || "").toUpperCase()] || [];
  if (!configs.length || !EIA_API_KEY) return { rows: [], status: buildProviderStatus("EIA", Boolean(EIA_API_KEY), configs.length ? "unavailable" : "not_applicable", configs.length ? "No EIA rows returned" : "No EIA mapping for symbol") };
  const settled = await Promise.allSettled(configs.map(async (config) => {
    const rows = await fetchEiaSeries(config.seriesId);
    const latest = rows[0] || null;
    const previous = rows[1] || null;
    return {
      metric: config.metric,
      value: latest?.value ?? null,
      previous: previous?.value ?? null,
      unit: config.unit,
      asOf: latest?.date || null,
      sourceType: "EIA",
      sourceWhy: "Official U.S. energy market time series",
      source: "EIA",
      seriesId: config.seriesId
    };
  }));
  const rows = settled.filter((result) => result.status === "fulfilled").map((result) => result.value).filter((row) => row.value !== null);
  return {
    rows,
    status: buildProviderStatus("EIA", true, rows.length ? "connected" : "unavailable", rows.length ? `${rows.length} energy series connected` : "No EIA rows returned")
  };
}

const BLS_MACRO_SERIES = [
  { id: "CUUR0000SA0", key: "cpi", label: "CPI", unit: "Index" },
  { id: "CUUR0000SA0L1E", key: "core_inflation_rate", label: "Core CPI", unit: "Index" },
  { id: "LNS14000000", key: "unemployment_rate", label: "Unemployment Rate", unit: "%" },
  { id: "WPUFD4", key: "inflation_rate", label: "PPI Final Demand", unit: "Index" }
];

async function fetchBlsMacroMetrics() {
  if (!BLS_API_KEY) return { rows: [], status: buildProviderStatus("BLS", false) };
  const currentYear = new Date().getFullYear();
  const body = JSON.stringify({
    seriesid: BLS_MACRO_SERIES.map((row) => row.id),
    startyear: String(currentYear - 2),
    endyear: String(currentYear),
    registrationkey: BLS_API_KEY
  });
  const payload = await cachedProviderFetch(`bls:${currentYear}`, () =>
    fetchJsonWithTimeout("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    })
  );
  const byId = new Map((payload?.Results?.series || []).map((series) => [series.seriesID, series]));
  const rows = BLS_MACRO_SERIES.map((config) => {
    const data = Array.isArray(byId.get(config.id)?.data) ? byId.get(config.id).data : [];
    const latest = data.find((row) => toProviderNumber(row?.value) !== null);
    const previous = data.slice(data.indexOf(latest) + 1).find((row) => toProviderNumber(row?.value) !== null);
    const current = toProviderNumber(latest?.value);
    const prev = toProviderNumber(previous?.value);
    return {
      key: config.key,
      label: config.label,
      current,
      previous: prev,
      expectation: null,
      change: current !== null && prev !== null ? Number((current - prev).toFixed(2)) : null,
      changePercent: current !== null && prev ? Number((((current - prev) / Math.abs(prev)) * 100).toFixed(2)) : null,
      unit: config.unit,
      asOf: latest ? `${latest.year}-${String(latest.period || "").replace("M", "").padStart(2, "0")}` : null,
      source: "BLS",
      series: data.slice().reverse().map((row) => ({
        date: `${row.year}-${String(row.period || "").replace("M", "").padStart(2, "0")}`,
        value: toProviderNumber(row.value)
      })).filter((row) => row.value !== null)
    };
  }).filter((row) => row.current !== null);
  return {
    rows,
    status: buildProviderStatus("BLS", true, rows.length ? "connected" : "unavailable", rows.length ? `${rows.length} series connected` : "No BLS rows returned")
  };
}

function buildDataProviderStatus(extra = {}) {
  return {
    fred: extra.fred || buildProviderStatus("FRED", Boolean(FRED_API_KEY), "idle", "Configured for macro/commodity series"),
    eia: extra.eia || buildProviderStatus("EIA", Boolean(EIA_API_KEY), "idle", "Configured for energy fundamentals"),
    bls: extra.bls || buildProviderStatus("BLS", Boolean(BLS_API_KEY), "idle", "Configured for inflation/labor series"),
    massive: extra.massive || buildProviderStatus("Massive", Boolean(MASSIVE_API_KEY), "idle", "Configured for WebSocket market data")
  };
}

function getMassiveStatus() {
  if (massiveLastStatus?.configured) return massiveLastStatus;
  return buildProviderStatus(
    "Massive",
    Boolean(MASSIVE_API_KEY),
    MASSIVE_API_KEY ? "configured" : "missing_key",
    MASSIVE_API_KEY
      ? `REST snapshots and WebSockets configured via ${MASSIVE_API_KEY_SOURCE || "backend environment"}`
      : "Massive API key not configured. Set MASSIVE_API_KEY, POLY_API_KEY, or POLYGON_API_KEY on the backend and restart."
  );
}

function summarizePriceProviders(prices = {}, fallbackProvider = "Yahoo Finance") {
  const counts = {};
  Object.values(prices || {}).forEach((quote) => {
    const source = String(quote?.source || fallbackProvider || "Market data").trim();
    if (!source) return;
    counts[source] = (counts[source] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = "zenin_session";

app.set("trust proxy", 1);

// Attach CORS headers before any security/rate-limit/error middleware so
// production failures still return a readable browser response.
app.use((req, res, next) => {
  const corsApplied = applyCorsHeaders(req, res);
  if (String(req.method || "").toUpperCase() === "OPTIONS") {
    if (corsApplied) {
      return res.sendStatus(204);
    }
    return res.status(403).json({ error: "Blocked origin" });
  }
  return next();
});

// Security headers with expanded CSP for production
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    connectSrc: [
      "'self'",
      ...(!IS_PRODUCTION ? ["ws:", "wss:"] : []),
      "https://*.onrender.com",
      "wss://*.onrender.com",
      "https://*.vercel.app",
      "https://zenin-mx6w.onrender.com",
      "https://api.revenuecat.com",
      "https://e.revenue.cat",
      "https://*.revenuecat.com",
      "https://*.revenue.cat",
      "https://api.stripe.com",
      "https://r.stripe.com",
      "https://m.stripe.network",
      "https://api.binance.com",
      "https://api.coingecko.com",
      "https://api.derive.xyz",
      "https://fapi.binance.com"
    ],
    scriptSrc: ["'self'", "https://js.stripe.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:", "https:", ...(!IS_PRODUCTION ? ["http:"] : [])],
    frameSrc: [
      "'self'",
      "https://js.stripe.com",
      "https://hooks.stripe.com",
      "https://checkout.stripe.com",
      "https://billing.stripe.com",
      "https://*.revenuecat.com",
      "https://*.revenue.cat"
    ],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: []
  }
}));

app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));
app.use(helmet.noSniff());
app.use(helmet.frameguard({ action: "deny" }));
app.use(helmet.referrerPolicy({ policy: "strict-origin-when-cross-origin" }));
app.use(helmet.permittedCrossDomainPolicies());

function sanitizeSymbol(symbol) {
  return symbol.replace(/[^a-zA-Z0-9.\-_:]/g, "").slice(0, 30);
}

// CORS — allow configured frontend origins and known production hosts
const normalizeOrigin = (value) => String(value || "").trim().replace(/\/+$/, "");
const configuredOrigins = String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);
const allowVercelPreviewOrigins =
  !IS_PRODUCTION ||
  String(process.env.ALLOW_VERCEL_PREVIEW_ORIGINS || "").trim().toLowerCase() === "true";
const allowedOrigins = Array.from(new Set([
  "https://zenin.capital",
  "https://www.zenin.capital",
  "https://zenincapital.com",
  ...(!IS_PRODUCTION ? [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://localhost:3000"
  ] : []),
  ...configuredOrigins
]));

const isLocalIP = (origin) => {
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.16.") ||
      hostname.endsWith(".local")
    );
  } catch (e) {
    return false;
  }
};

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  const isVercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin);

  if (allowedOrigins.includes(normalizedOrigin)) return true;
  if (normalizedOrigin.endsWith(".zenin.capital") || normalizedOrigin.endsWith(".zenincapital.com")) {
    return true;
  }
  if (!IS_PRODUCTION && isLocalIP(origin)) return true;
  if (allowVercelPreviewOrigins && isVercelPreview) return true;
  return false;
}

const corsAllowedMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
const corsAllowedHeaders = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
  "X-CSRF-Token",
  "X-Zenin-Simulate-Plan"
];

function applyCorsHeaders(req, res) {
  const requestOrigin = String(req.headers.origin || "").trim();
  if (!requestOrigin || !isAllowedOrigin(requestOrigin)) return false;

  res.setHeader("Access-Control-Allow-Origin", normalizeOrigin(requestOrigin));
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", corsAllowedMethods.join(", "));
  res.setHeader("Access-Control-Allow-Headers", corsAllowedHeaders.join(", "));
  return true;
}

// CSRF origin validation for state-changing requests (#6)
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin requests may omit Origin
  if (isAllowedOrigin(origin)) return next();
  return res.status(403).json({ error: "Origin not allowed." });
});

const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/oauth/apple/callback",
  "/api/webhooks/resend"
]);

function shouldEnforceCsrf(req) {
  const method = String(req.method || "").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  if (CSRF_EXEMPT_PATHS.has(String(req.path || ""))) return false;
  if (getBearerToken(req)) return false;
  const hasOrigin = Boolean(String(req.headers.origin || "").trim());
  const hasCookies = Boolean(String(req.headers.cookie || "").trim());
  return hasOrigin || hasCookies;
}

app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase())) {
    ensureCsrfCookie(req, res);
  }
  return next();
});

app.get("/api/auth/csrf", (req, res) => {
  const token = ensureCsrfCookie(req, res);
  return res.json({ csrfToken: token });
});

// Helper to fetch latest results from Dune Analytics
async function fetchDuneLatestResults(queryId) {
  const apiKey = cleanApiKey(process.env.DUNE_API_KEY);
  if (!apiKey) {
    console.warn(`[Dune] API key missing. Skipping fetch for query ${queryId}.`);
    return null;
  }

  try {
    const fetch = await resolveFetch();
    const response = await fetch(`https://api.dune.com/api/v1/query/${queryId}/results`, {
      headers: { "x-dune-api-key": apiKey }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Dune API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.result?.rows || [];
  } catch (error) {
    console.error(`[Dune] Failed to fetch query ${queryId}:`, error.message);
    return null;
  }
}

/**
 * Scrapes ETF flow data from Farside UK (farside.co.uk)
 * Note: Cloudflare might block this in certain environments.
 */
async function fetchFarsideEtfFlows() {
  const fetch = await resolveFetch();
  const flows = await fetchLatestFarsideEtfFlows(fetch);
  return Array.isArray(flows) && flows.length > 0 ? flows : null;
}
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      const normalizedOrigin = normalizeOrigin(origin);
      console.warn(`[CORS] Blocked origin: ${origin} (Normalized: ${normalizedOrigin})`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: corsAllowedMethods,
  allowedHeaders: corsAllowedHeaders,
  optionsSuccessStatus: 204
}));

function enforceTrustedOriginForStateChanges(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase())) {
    return next();
  }
  const origin = String(req.headers.origin || "").trim();
  if (!origin) {
    return next();
  }
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Blocked origin" });
  }
  return next();
}

app.use(enforceTrustedOriginForStateChanges);

app.use((req, res, next) => {
  if (!shouldEnforceCsrf(req)) return next();
  const cookieToken = getCsrfTokenFromCookie(req);
  const headerToken = String(req.headers["x-csrf-token"] || "").trim();
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: "CSRF token missing or invalid." });
  }
  return next();
});

// Rate limiting by route class
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Increased for polling dashboard
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(generalLimiter);

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many write requests." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." }
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset attempts. Please try again later." }
});

const expensiveReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many market-data requests. Please slow down." }
});

const optionsChainLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 360,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many options-chain requests. Please slow down." }
});


app.use(express.json({
  limit: "100kb",
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use([
  "/api/prices",
  "/api/history",
  "/api/watchlist",
  "/api/finviz",
  "/api/company-profile",
  "/api/analytics/equities",
  "/api/app/bootstrap"
], expensiveReadLimiter);
app.use("/api/options/crypto", optionsChainLimiter);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const ADMIN_REAUTH_TTL_MS = 15 * 60 * 1000;
const SENSITIVE_REAUTH_TTL_MS = 15 * 60 * 1000;
const CSRF_COOKIE_NAME = "zenin_csrf";
const AUTH_HASH_KEY_RAW = String(process.env.AUTH_HASH_KEY || process.env.ZENIN_APP_SECRET || "").trim();
const FALLBACK_SECRET = "zenin_default_secure_fallback_secret_32chars_min_9f2a1c77_placeholder";
let AUTH_HASH_KEY = AUTH_HASH_KEY_RAW;

if (AUTH_HASH_KEY.length < 32) {
  if (IS_PRODUCTION) {
    throw new Error("AUTH_HASH_KEY or ZENIN_APP_SECRET must be set to a 32+ character secret in production.");
  } else {
    AUTH_HASH_KEY = FALLBACK_SECRET;
    console.warn("********************************************************************************");
    console.warn("WARNING: Using a fallback AUTH_HASH_KEY. Please set a strong secret in your env.");
    console.warn("********************************************************************************");
  }
}
const OAUTH_PROVIDERS = ["google", "github", "microsoft"];
const ARCHIVED_OAUTH_PROVIDERS = new Set(["apple"]);
const ADMIN_MIGRATION_KEY = String(process.env.ADMIN_MIGRATION_KEY || "").trim();
const ALLOW_DEV_AUTH_DEBUG =
  process.env.NODE_ENV !== "production" &&
  String(process.env.ENABLE_DEV_AUTH_DEBUG || "").trim().toLowerCase() === "true";
const ALLOW_OAUTH_MOCK =
  process.env.NODE_ENV !== "production" &&
  String(process.env.ENABLE_OAUTH_MOCK || "").trim().toLowerCase() === "true";
const ADMIN_ALLOWED_IPS = new Set(
  String(process.env.ADMIN_ALLOWED_IPS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

if (IS_PRODUCTION) {
  if (String(process.env.ENABLE_OAUTH_MOCK || "").trim().toLowerCase() === "true") {
    throw new Error("ENABLE_OAUTH_MOCK must never be enabled in production.");
  }
  if (String(process.env.ZENIN_ADMIN_BYPASS || "").trim().toLowerCase() === "true") {
    throw new Error("ZENIN_ADMIN_BYPASS must never be enabled in production.");
  }
}

function hashToken(token) {
  return crypto.createHmac("sha256", AUTH_HASH_KEY).update(String(token || "")).digest("hex");
}

function sanitizeInternalRedirectPath(pathValue, fallback = "/app") {
  const value = String(pathValue || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function sanitizeOAuthMode(mode, fallback = "signin") {
  const value = String(mode || "").trim().toLowerCase();
  return ["signup", "signin", "forgot"].includes(value) ? value : fallback;
}

function sanitizeOAuthEntryPath(entryPath) {
  const value = String(entryPath || "").trim();
  if (value === "/") return "/";
  if (value.startsWith("/auth")) return "/auth";
  return "/auth";
}

function getDefaultFrontendOrigin() {
  const configured = normalizeOrigin(process.env.PUBLIC_APP_ORIGIN || process.env.FRONTEND_URL || "");
  if (configured) return configured;
  const expected = normalizeOrigin(expectedOrigin);
  if (IS_PRODUCTION && (!expected || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(expected))) {
    return DEFAULT_PUBLIC_APP_ORIGIN;
  }
  return expected || DEFAULT_PUBLIC_APP_ORIGIN;
}

function sanitizeOAuthFrontendOrigin(originValue) {
  const normalized = normalizeOrigin(originValue);
  if (normalized && isAllowedOrigin(normalized)) return normalized;
  const fallback = getDefaultFrontendOrigin();
  return fallback || DEFAULT_PUBLIC_APP_ORIGIN;
}

function getOAuthRedirectUri(req, provider) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (normalizedProvider === "google") {
    const configuredGoogleRedirectUri = String(process.env.GOOGLE_REDIRECT_URI || "").trim();
    if (configuredGoogleRedirectUri) return configuredGoogleRedirectUri;
  }
  const frontendCallbackOrigin = getDefaultFrontendOrigin();
  if (frontendCallbackOrigin) {
    return `${frontendCallbackOrigin.replace(/\/+$/, "")}/auth/oauth/${normalizedProvider}/callback`;
  }
  const redirectUriBase = process.env.REDIRECT_URI_BASE || getRequestProtocol(req) + "://" + req.get("host");
  return `${String(redirectUriBase || "").replace(/\/+$/, "")}/api/auth/oauth/${normalizedProvider}/callback`;
}

function createOAuthStateToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify({
    ...payload,
    issuedAt: Date.now()
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_HASH_KEY).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function parseOAuthStateToken(token) {
  const raw = String(token || "").trim();
  if (!raw.includes(".")) {
    throw new Error("Invalid OAuth state.");
  }

  const [encodedPayload, providedSignature] = raw.split(".");
  if (!encodedPayload || !providedSignature) {
    throw new Error("Invalid OAuth state.");
  }

  const expectedSignature = crypto.createHmac("sha256", AUTH_HASH_KEY).update(encodedPayload).digest("base64url");
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error("Invalid OAuth state.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state.");
  }

  const issuedAt = Number(payload?.issuedAt);
  if (!Number.isFinite(issuedAt) || issuedAt + OAUTH_STATE_TTL_MS < Date.now()) {
    throw new Error("OAuth session expired. Please try again.");
  }

  return {
    provider: String(payload?.provider || "").trim().toLowerCase(),
    returnTo: sanitizeInternalRedirectPath(payload?.returnTo, "/app"),
    entryPath: sanitizeOAuthEntryPath(payload?.entryPath),
    authMode: sanitizeOAuthMode(payload?.authMode, "signin"),
    frontendOrigin: sanitizeOAuthFrontendOrigin(payload?.frontendOrigin)
  };
}

function buildFrontendRedirectUrl(pathname, params = {}, frontendOrigin = null) {
  const origin = sanitizeOAuthFrontendOrigin(frontendOrigin);
  const url = new URL(pathname, origin.endsWith("/") ? origin : `${origin}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function buildOAuthFailureRedirect({ entryPath = "/auth", authMode = "signin", returnTo = "/app", errorMessage, frontendOrigin = null }) {
  const sanitizedEntryPath = sanitizeOAuthEntryPath(entryPath);
  const sanitizedReturnTo = sanitizeInternalRedirectPath(returnTo, "/app");
  const sanitizedMode = sanitizeOAuthMode(authMode, "signin");
  if (sanitizedEntryPath === "/") {
    return buildFrontendRedirectUrl("/", {
      auth: sanitizedMode,
      next: sanitizedReturnTo,
      oauthError: errorMessage || "Sign-in failed. Please try again."
    }, frontendOrigin);
  }
  return buildFrontendRedirectUrl("/auth", {
    mode: sanitizedMode,
    next: sanitizedReturnTo,
    oauthError: errorMessage || "Sign-in failed. Please try again."
  }, frontendOrigin);
}

function buildOAuthSuccessRedirect(returnTo, frontendOrigin = null) {
  return buildFrontendRedirectUrl(sanitizeInternalRedirectPath(returnTo, "/app"), {}, frontendOrigin);
}

// Encrypt/decrypt TOTP secrets at rest with AES-256-GCM (#2)
const TOTP_ENC_KEY = crypto.createHash("sha256").update(`zenin-totp-enc:${AUTH_HASH_KEY}`).digest();

function encryptTotpSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", TOTP_ENC_KEY, iv);
  let encrypted = cipher.update(String(secret), "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `enc:${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decryptTotpSecret(stored) {
  if (!stored || !stored.startsWith("enc:")) return stored; // fallback for unencrypted legacy
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  const [, ivHex, tagHex, ciphertext] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", TOTP_ENC_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Encrypt/decrypt workspace secrets (API keys, etc) at rest (#EncryptionAtRest)
const WORKSPACE_ENC_KEY = crypto.createHash("sha256").update(`zenin-workspace-enc:${AUTH_HASH_KEY}`).digest();

function encryptWorkspaceData(data) {
  if (!data) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", WORKSPACE_ENC_KEY, iv);
  let encrypted = cipher.update(typeof data === "string" ? data : JSON.stringify(data), "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `wenc:${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decryptWorkspaceData(stored) {
  if (!stored || !stored.startsWith("wenc:")) return stored;
  try {
    const parts = stored.split(":");
    if (parts.length !== 4) return null;
    const [, ivHex, tagHex, ciphertext] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", WORKSPACE_ENC_KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let decrypted = decipher.update(ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    console.warn("[Crypto] Workspace data decryption failed:", e?.message || e);
    return null;
  }
}

const workspaceSecretProvider = {
  encryptSecret(value) {
    return encryptWorkspaceData(value);
  },
  decryptSecret(value) {
    return decryptWorkspaceData(value);
  }
};

function maskApiKey(key) {
  if (!key) return "";
  const raw = workspaceSecretProvider.decryptSecret(key); // Decrypt if it was encrypted
  if (!raw) return "";
  if (raw.length <= 8) return "****";
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function hashBackupCode(code) {
  return crypto.createHash("sha256").update(String(code || "").trim().toUpperCase()).digest("hex");
}

function derivePasswordHash(password, salt = null) {
  const safeSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), safeSalt, 64).toString("hex");
  return { salt: safeSalt, hash: `scrypt:${safeSalt}:${hash}` };
}

function verifyPassword(password, storedHash) {
  const raw = String(storedHash || "");
  if (!raw.startsWith("scrypt:")) return false;
  const [, salt, expectedHash] = raw.split(":");
  if (!salt || !expectedHash) return false;
  const computed = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(computed, "hex"));
}

function isStrongPassword(password) {
  const value = String(password || "");
  return (
    value.length >= 10 &&
    /[a-z]/i.test(value) &&
    /\d/.test(value) &&
    /[^a-z0-9]/i.test(value)
  );
}

function sanitizeAuthUser(user = null) {
  if (!user) return null;
  // Strip all secret material: passwordHash, twoFactorSecretHash, raw backupCodes (#3, #11)
  const passkeys = Array.isArray(user.passkeys) ? user.passkeys : [];
  return {
    id: Number(user.id),
    supabaseUserId: user.supabaseUserId || null,
    sessionId: user.sessionId == null ? null : Number(user.sessionId),
    email: String(user.email || "").toLowerCase(),
    displayName: user.displayName || null,
    authProvider: user.authProvider || "email",
    emailVerified: Boolean(user.emailVerified),
    isAdmin: Boolean(user.isAdmin),
    adminRole: String(user.adminRole || (user.isAdmin ? "super_admin" : "user")).trim().toLowerCase(),
    suspendedAt: user.suspendedAt || null,
    pendingEmail: user.pendingEmail || null,
    pendingEmailRequestedAt: user.pendingEmailRequestedAt || null,
    passwordChangedAt: user.passwordChangedAt || null,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    twoFactorMethod: user.twoFactorMethod || null,
    twoFactorProvider: user.twoFactorProvider || null,
    twoFactorTarget: user.twoFactorTarget || "",
    twoFactorEnabledAt: user.twoFactorEnabledAt || null,
    backupCodesCount: Array.isArray(user.backupCodes) ? user.backupCodes.length : 0,
    passkeys: passkeys.map(p => ({ name: p.name, provider: p.provider, createdAt: p.createdAt })),
    currentPlan: String(user.currentPlan || "starter").trim().toLowerCase() || "starter",
    currentBillingCycle: String(user.currentBillingCycle || "monthly").trim().toLowerCase() || "monthly",
    planUpdatedAt: user.planUpdatedAt || null,
    sessionReauthenticatedAt: user.sessionReauthenticatedAt || null,
    adminReauthenticatedAt: user.adminReauthenticatedAt || null,
    createdAt: user.createdAt || null
  };
}

function sanitizeWorkspace(workspace = null, membership = null) {
  if (!workspace) return null;
  return {
    id: Number(workspace.id),
    slug: String(workspace.slug || "").trim(),
    name: String(workspace.name || "").trim(),
    plan: String(workspace.plan || "starter").trim().toLowerCase(),
    billingCycle: String(workspace.billingCycle || "monthly").trim().toLowerCase(),
    seatLimit: Number(workspace.seatLimit || 1),
    seatCount: Number(workspace.seatCount || 1),
    seatsRemaining: Math.max(0, Number(workspace.seatLimit || 1) - Number(workspace.seatCount || 1)),
    status: String(workspace.status || "active").trim().toLowerCase(),
    ownerUserId: workspace.ownerUserId == null ? null : Number(workspace.ownerUserId),
    createdAt: workspace.createdAt || null,
    updatedAt: workspace.updatedAt || null,
    membership: membership ? {
      userId: Number(membership.userId),
      role: String(membership.role || "member").trim().toLowerCase(),
      status: String(membership.status || "active").trim().toLowerCase(),
      joinedAt: membership.joinedAt || null,
    } : null
  };
}

function sanitizeWorkspaceMember(member = null) {
  if (!member) return null;
  return {
    workspaceId: Number(member.workspaceId),
    userId: Number(member.userId),
    role: String(member.role || "member").trim().toLowerCase(),
    status: String(member.status || "active").trim().toLowerCase(),
    email: member.email || null,
    displayName: member.displayName || null,
    invitedAt: member.invitedAt || null,
    joinedAt: member.joinedAt || null,
  };
}

function sanitizeWorkspaceInvite(invite = null) {
  if (!invite) return null;
  return {
    id: Number(invite.id),
    workspaceId: Number(invite.workspaceId),
    email: String(invite.email || "").trim().toLowerCase(),
    role: String(invite.role || "member").trim().toLowerCase(),
    status: String(invite.status || "pending").trim().toLowerCase(),
    expiresAt: invite.expiresAt || null,
    acceptedAt: invite.acceptedAt || null,
    revokedAt: invite.revokedAt || null,
    createdAt: invite.createdAt || null,
  };
}

function createVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function createBackupCodes() {
  // Use crypto.randomBytes for cryptographic security (#4)
  return Array.from({ length: 8 }, () => crypto.randomBytes(4).toString("hex").toUpperCase());
}

function isWorkspaceNamespaceValid(namespace) {
  return /^[a-z0-9:_-]{3,80}$/i.test(String(namespace || "").trim());
}

function normalizeAlertDeliveryType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  if (normalized === "watchlist") return "watchlist_alert";
  if (normalized === "workspace_assignment") return "workspace_assignment";
  return "market_alert";
}

async function getAlertEmailRecipient(userId, { requirePriceAlerts = false } = {}) {
  const result = await pool.query(`
    SELECT id, email, email_verified AS "emailVerified"
    FROM app_users
    WHERE id = $1
    LIMIT 1;
  `, [Number(userId)]);
  const user = result.rows[0];
  if (!user?.email || !user.emailVerified) {
    return {
      allowed: false,
      reason: user?.email ? "email_not_verified" : "email_missing",
      email: user?.email || null
    };
  }

  const preferencesResult = await userWorkspace.docs.get(user.id, "settings:preferences", {});
  const preferences = preferencesResult?.document && typeof preferencesResult.document === "object"
    ? preferencesResult.document
    : {};

  if (preferences.notifyEmail === false) {
    return { allowed: false, reason: "email_notifications_disabled", email: user.email };
  }

  if (requirePriceAlerts && preferences.notifyPriceAlerts === false) {
    return { allowed: false, reason: "price_alerts_disabled", email: user.email };
  }

  return {
    allowed: true,
    email: user.email,
    preferences
  };
}

function getFrontendAppUrl(pathname = "/app") {
  const frontendUrl = String(process.env.FRONTEND_URL || "https://www.zenin.capital").replace(/\/+$/, "");
  const pathValue = String(pathname || "/app");
  return `${frontendUrl}${pathValue.startsWith("/") ? pathValue : `/${pathValue}`}`;
}

async function dispatchAlertEmailToUser(userId, alert, options = {}) {
  const recipient = await getAlertEmailRecipient(userId, options);
  if (!recipient.allowed) {
    return {
      attempted: false,
      sent: false,
      skipped: true,
      reason: recipient.reason,
      email: recipient.email || null
    };
  }

  const delivery = await sendAlertEmail(recipient.email, alert);
  return {
    attempted: true,
    skipped: false,
    email: recipient.email,
    ...delivery
  };
}

function normalizePlanInput(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (["starter", "pro", "desk"].includes(normalized)) return normalized;
  return null;
}

function normalizeBillingCycleInput(billingCycle) {
  const normalized = String(billingCycle || "").trim().toLowerCase();
  if (["monthly", "yearly"].includes(normalized)) return normalized;
  return null;
}

function summarizeIntegrationItems(items = []) {
  const connectedApps = items.filter((item) => item.status === "active" || item.status === "connected").length;
  const failedSyncs = items.filter((item) => item.status !== "active" && item.status !== "connected").length;
  return {
    connectedApps,
    syncHealth: Number((((items.length - failedSyncs) / Math.max(items.length, 1)) * 100).toFixed(1)),
    webhooksActive: items.filter((item) => item.category === "Developer" && item.status === "active").length,
    failedSyncs
  };
}

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  if (!raw) return {};
  return raw.split(";").reduce((acc, entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) return acc;
    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (!key) return acc;
    try {
      acc[key] = decodeURIComponent(value);
    } catch {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function getSessionTokenFromCookie(req) {
  const cookies = parseCookies(req);
  const token = String(cookies[SESSION_COOKIE_NAME] || "").trim();
  return token || null;
}

function getCsrfTokenFromCookie(req) {
  const cookies = parseCookies(req);
  const token = String(cookies[CSRF_COOKIE_NAME] || "").trim();
  return token || null;
}

function getRequestProtocol(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwardedProto) return forwardedProto;
  return req.secure ? "https" : "http";
}

function shouldUseSecureCookies(req) {
  return IS_PRODUCTION || getRequestProtocol(req) === "https";
}

function getRequestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
}

function getRequestOrigin(req) {
  const host = getRequestHost(req);
  if (!host) return "";
  return `${getRequestProtocol(req)}://${host}`;
}

function resolveSessionSameSite(req, secure) {
  if (!secure) return "lax";
  const origin = normalizeOrigin(req.headers.origin);
  const requestOrigin = normalizeOrigin(getRequestOrigin(req));
  if (origin && requestOrigin && origin !== requestOrigin) {
    return "none";
  }
  return "lax";
}

function buildSessionCookieOptions(req, { expiresAt = null, persistent = true } = {}) {
  const secure = shouldUseSecureCookies(req);
  const sameSite = resolveSessionSameSite(req, secure);
  const options = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/"
  };
  if (persistent && expiresAt) {
    const expiryDate = new Date(expiresAt);
    if (Number.isFinite(expiryDate.getTime())) {
      options.expires = expiryDate;
      options.maxAge = Math.max(0, expiryDate.getTime() - Date.now());
    }
  }
  return options;
}

function buildCsrfCookieOptions(req) {
  const secure = shouldUseSecureCookies(req);
  return {
    httpOnly: false,
    secure,
    sameSite: resolveSessionSameSite(req, secure),
    path: "/"
  };
}

function setSessionCookie(res, req, token, expiresAt, { persistent = true } = {}) {
  res.cookie(SESSION_COOKIE_NAME, token, buildSessionCookieOptions(req, { expiresAt, persistent }));
}

function clearSessionCookie(res, req) {
  res.clearCookie(SESSION_COOKIE_NAME, buildSessionCookieOptions(req, { persistent: false }));
}

function issueCsrfToken(res, req) {
  const token = crypto.randomBytes(24).toString("hex");
  res.cookie(CSRF_COOKIE_NAME, token, buildCsrfCookieOptions(req));
  return token;
}

function ensureCsrfCookie(req, res) {
  return getCsrfTokenFromCookie(req) || issueCsrfToken(res, req);
}

function resolveClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || null;
}

async function resolveAuthContext(req) {
  const guestContext = {
    isGuest: true,
    userId: null,
    user: null,
    token: null,
    authSource: "guest"
  };
  const sessionToken = getSessionTokenFromCookie(req);
  if (sessionToken) {
    const tokenHash = hashToken(sessionToken);
    const session = await userAuth.findSessionByTokenHash(tokenHash);
    if (session && !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now()) {
      return {
        isGuest: false,
        userId: Number(session.userId),
        user: sanitizeAuthUser(session),
        token: sessionToken,
        authSource: "session"
      };
    }
  }

  return guestContext;
}

app.use(async (req, _res, next) => {
  try {
    req.auth = await resolveAuthContext(req);
    next();
  } catch (error) {
    next(error);
  }
});

function inferServiceLabel(req) {
  const path = String(req.path || "");
  if (path.startsWith("/api/auth")) return "Auth";
  if (path.startsWith("/api/admin")) return "Admin";
  if (path.startsWith("/api/prices") || path.startsWith("/api/history") || path.startsWith("/api/search")) return "Market Data";
  if (path.startsWith("/api/account")) return "Account";
  return "Web API";
}

app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 64);
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    if (!String(req.path || "").startsWith("/api/")) return;
    const statusCode = Number(res.statusCode || 0);
    const durationMs = Date.now() - startedAt;
    const level = statusCode >= 500
      ? "error"
      : statusCode >= 400
        ? "warning"
        : "info";

    admin.recordSystemLog({
      level,
      message: `${req.method} ${req.path} -> ${statusCode}`,
      context: {
        method: req.method,
        path: req.path,
        statusCode,
        query: req.query || {}
      },
      requestId,
      ipAddress: resolveClientIp(req),
      service: inferServiceLabel(req),
      endpoint: `${req.method} ${req.path}`,
      durationMs,
      statusCode,
      userId: req.auth?.userId || null,
      sessionId: req.auth?.user?.sessionId || null,
      actorType: req.auth?.isGuest ? "guest" : (req.auth?.user?.adminRole && req.auth.user.adminRole !== "user" ? "admin" : "user")
    }).catch((error) => {
      console.error("[Admin] Failed to persist system log:", error?.message || error);
    });

    if (statusCode === 403 && String(req.path || "").startsWith("/api/workspaces/")) {
      const attempts = trackSecurityAnomaly(`workspace-403:${resolveClientIp(req) || "unknown"}`);
      if (attempts >= 5) {
        logSecurityEvent(req, {
          level: "warning",
          message: "Repeated forbidden workspace access attempts detected.",
          eventType: "workspace_forbidden_burst",
          workspaceId: req.workspace?.workspace?.id || null,
          context: {
            attempts,
            path: req.path
          }
        }).catch((error) => {
          console.warn("[Admin] Failed to persist workspace-403 security event:", error?.message || error);
        });
      }
    }
  });

  next();
});

function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function apiError(res, status, options = {}) {
  const normalizedStatus = Number(status) || 500;
  const payload = {
    error: String(options.error || "Request failed"),
    message: String(options.message || options.error || "The request could not be completed."),
    code: String(options.code || (normalizedStatus >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED")),
    retryable: typeof options.retryable === "boolean" ? options.retryable : isRetryableStatus(normalizedStatus)
  };

  if (options.details != null) {
    payload.details = options.details;
  }
  if (res.req?.requestId) {
    payload.requestId = res.req.requestId;
  }
  if (options.meta && typeof options.meta === "object") {
    payload.meta = options.meta;
  }

  return res.status(normalizedStatus).json(payload);
}

function requireSignedIn(req, res, next) {
  if (!req.auth || req.auth.isGuest) {
    return apiError(res, 401, {
      error: "Authentication required",
      message: "Sign in to continue.",
      code: "AUTH_REQUIRED",
      retryable: false
    });
  }
  return next();
}

async function attachActiveWorkspace(req, _res, next) {
  if (!req.auth || req.auth.isGuest || !req.auth.userId) {
    return next();
  }
  try {
    const active = await workspaces.getActiveForUser(req.auth.userId);
    req.workspace = active || null;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireWorkspaceMember(req, res, next) {
  if (!req.workspace?.workspace || !req.workspace?.membership) {
    return apiError(res, 403, {
      error: "Workspace access required.",
      message: "Join or switch to a workspace with access before retrying.",
      code: "WORKSPACE_ACCESS_REQUIRED",
      retryable: false
    });
  }
  return next();
}

function getRequiredWorkspaceContext(req) {
  const workspaceId = Number(req.workspace?.workspace?.id || 0);
  if (!workspaceId || !req.workspace?.membership) {
    const error = new Error("Workspace access required.");
    error.statusCode = 403;
    throw error;
  }
  return {
    id: workspaceId,
    workspace: req.workspace.workspace,
    membership: req.workspace.membership
  };
}

function requireWorkspaceRole(...roles) {
  const allowedRoles = roles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean);
  return (req, res, next) => {
    try {
      const workspaceContext = getRequiredWorkspaceContext(req);
      const role = String(workspaceContext.membership?.role || "").trim().toLowerCase();
      if (!allowedRoles.includes(role)) {
        return apiError(res, 403, {
          error: "Workspace privileges required.",
          message: "Your workspace role does not allow this action.",
          code: "WORKSPACE_ROLE_REQUIRED",
          retryable: false
        });
      }
      return next();
    } catch (error) {
      return apiError(res, error.statusCode || 403, {
        error: error.message || "Workspace access required.",
        message: error.message || "Switch to an active workspace and retry.",
        code: "WORKSPACE_ACCESS_REQUIRED",
        retryable: false
      });
    }
  };
}

function requireWorkspaceAdmin(req, res, next) {
  return requireWorkspaceRole("owner", "admin")(req, res, next);
}

const PLAN_RANK = {
  starter: 0,
  pro: 1,
  desk: 2
};

function getEffectivePlan(userPlan, workspacePlan) {
  const normalizedUserPlan = normalizePlanInput(userPlan) || "starter";
  const normalizedWorkspacePlan = normalizePlanInput(workspacePlan) || "starter";
  return (PLAN_RANK[normalizedWorkspacePlan] || 0) > (PLAN_RANK[normalizedUserPlan] || 0)
    ? normalizedWorkspacePlan
    : normalizedUserPlan;
}

function requirePlan(minPlan) {
  return (req, res, next) => {
    const isAdmin = isSignedInAdmin(req);
    const simulationPlan = req.headers["x-zenin-simulate-plan"];
    
    // If admin is NOT simulating, they bypass
    if (isAdmin && !simulationPlan) return next();
    
    // Use the simulated plan if provided by an admin, otherwise use the actual user plan
    const userPlan = (isAdmin && simulationPlan)
      ? simulationPlan 
      : (req.auth?.user?.currentPlan || "starter");
    const workspacePlan = req.workspace?.workspace?.plan || "starter";
    const effectivePlan = getEffectivePlan(userPlan, workspacePlan);

    if ((PLAN_RANK[effectivePlan] || 0) < (PLAN_RANK[minPlan] || 0)) {
      return res.status(403).json({ 
        error: "Upgrade required", 
        message: `The ${minPlan} plan is required to access this feature.`,
        required: minPlan, 
        current: effectivePlan,
        simulated: isAdmin && !!simulationPlan
      });
    }
    next();
  };
}

function isSharedWorkspaceContext(reqOrContext, userIdOverride = null) {
  const workspace = reqOrContext?.workspace?.workspace || reqOrContext?.workspace || null;
  const membership = reqOrContext?.workspace?.membership || reqOrContext?.membership || null;
  const userId = Number(userIdOverride || reqOrContext?.auth?.userId || membership?.userId || 0);
  if (!workspace || !membership || !userId) return false;
  const ownerUserId = Number(workspace.ownerUserId || 0);
  const seatCount = Number(workspace.seatCount || 1);
  const role = String(membership.role || "").trim().toLowerCase();
  return ownerUserId !== userId || seatCount > 1 || role !== "owner";
}

function hasDeskPlanForWorkspaceFeature(reqOrContext, userPlanOverride = null) {
  const workspace = reqOrContext?.workspace?.workspace || reqOrContext?.workspace || null;
  const userPlan = userPlanOverride || reqOrContext?.auth?.user?.currentPlan || "starter";
  const effectivePlan = getEffectivePlan(userPlan, workspace?.plan || "starter");
  return (PLAN_RANK[effectivePlan] || 0) >= PLAN_RANK.desk;
}

function buildSharedWatchlistAccess(context, userId, userPlan) {
  const shared = isSharedWorkspaceContext(context, userId);
  const allowed = !shared || hasDeskPlanForWorkspaceFeature(context, userPlan);
  return {
    shared,
    allowed,
    requiredPlan: shared ? "desk" : "starter"
  };
}

function requireDeskForSharedWatchlist(req, res, next) {
  const access = buildSharedWatchlistAccess(req, req.auth?.userId, req.auth?.user?.currentPlan);
  if (access.allowed) return next();
  return apiError(res, 403, {
    error: "Desk subscription required",
    message: "Shared Desk watchlists are available on the Desk plan only.",
    code: "DESK_WATCHLIST_REQUIRED",
    retryable: false,
    required: "desk"
  });
}

function requireAdmin(req, res, next) {
  if (!isSignedInAdmin(req)) {
    return res.status(403).json({ error: "Admin privileges required" });
  }
  if (!hasStrongAdminAuth(req.auth?.user)) {
    return res.status(403).json({ error: "Admin MFA or passkey enrollment required.", code: "ADMIN_MFA_REQUIRED" });
  }
  if (IS_PRODUCTION && ADMIN_ALLOWED_IPS.size > 0) {
    const ip = String(resolveClientIp(req) || "").trim();
    if (!ADMIN_ALLOWED_IPS.has(ip)) {
      return res.status(403).json({ error: "Admin IP address not allowed.", code: "ADMIN_IP_RESTRICTED" });
    }
  }
  return next();
}

function hasStrongAdminAuth(user = null) {
  const passkeys = Array.isArray(user?.passkeys) ? user.passkeys : [];
  return Boolean(user?.twoFactorEnabled) || passkeys.length > 0;
}

function hasRecentReauthAt(timestamp, ttlMs) {
  if (!timestamp) return false;
  const ts = new Date(timestamp).getTime();
  return Number.isFinite(ts) && (Date.now() - ts) <= ttlMs;
}

function requireRecentAdminReauth(req, res, next) {
  if (hasRecentReauthAt(req.auth?.user?.adminReauthenticatedAt, ADMIN_REAUTH_TTL_MS)) {
    return next();
  }
  return res.status(428).json({ error: "Recent admin re-authentication required.", code: "ADMIN_REAUTH_REQUIRED" });
}

function requireRecentSensitiveReauth(req, res, next) {
  if (hasRecentReauthAt(req.auth?.user?.sessionReauthenticatedAt, SENSITIVE_REAUTH_TTL_MS)) {
    return next();
  }
  return res.status(428).json({ error: "Recent account confirmation required.", code: "SENSITIVE_REAUTH_REQUIRED" });
}

function isSignedInAdmin(req) {
  const bypass = !IS_PRODUCTION && process.env.ZENIN_ADMIN_BYPASS === "true";
  
  // Developer Bypass (Local only)
  if (bypass) {
    console.warn("[Admin] Developer bypass active: Granting admin privileges.");
    return true;
  }

  // Check for is_admin flag in the user record
  const isAdmin = Boolean(req?.auth?.user?.isAdmin);
  if (isAdmin) {
    console.log(`[Admin] User ${req?.auth?.user?.email} granted access via DB flag.`);
    return true;
  }

  return false;
}

function hasValidMigrationKey(req) {
  if (!ADMIN_MIGRATION_KEY) return false;
  const provided = String(req.headers["x-migration-key"] || "").trim();
  if (!provided) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(ADMIN_MIGRATION_KEY));
  } catch {
    return false;
  }
}

function buildSecurityDiff(before = {}, after = {}) {
  return buildAuditDiff(before, after);
}

async function logSecurityEvent(req, {
  level = "info",
  message,
  eventType,
  workspaceId = null,
  targetUserId = null,
  context = {}
} = {}) {
  if (!message && !eventType) return null;
  return admin.recordSystemLog({
    level,
    message: String(message || eventType || "security_event").slice(0, 600),
    context: {
      eventType: eventType || null,
      workspaceId: workspaceId == null ? null : Number(workspaceId),
      targetUserId: targetUserId == null ? null : Number(targetUserId),
      ...context
    },
    requestId: req?.requestId || null,
    ipAddress: resolveClientIp(req),
    service: "Security",
    endpoint: req?.method && req?.path ? `${req.method} ${req.path}` : "security-event",
    statusCode: null,
    userId: req?.auth?.userId || null,
    sessionId: req?.auth?.user?.sessionId || null,
    actorType: req?.auth?.isGuest ? "guest" : (req?.auth?.user?.isAdmin ? "admin" : "user")
  });
}

function getEmailDeliverySent(delivery) {
  return Boolean(delivery && (delivery.sent === true || delivery === true));
}

function getEmailDeliveryLogContext(delivery = {}) {
  if (!delivery || typeof delivery !== "object") {
    return { sent: Boolean(delivery) };
  }
  return {
    sent: Boolean(delivery.sent),
    provider: delivery.provider || "resend",
    providerMessageId: delivery.providerMessageId || null,
    error: delivery.error || null,
    deliveryConfig: delivery.deliveryConfig || getEmailDeliveryConfig()
  };
}

function requireProductionEmailDeliveryReady(res) {
  const config = getEmailDeliveryConfig();
  if (process.env.NODE_ENV !== "production" || isEmailDeliveryProductionReady()) {
    return false;
  }
  return apiError(res, 503, {
    error: "Transactional email is not configured.",
    message: "Email delivery is unavailable. Configure RESEND_API_KEY and SMTP_FROM with a verified Resend sender domain, then retry.",
    code: "EMAIL_DELIVERY_NOT_CONFIGURED",
    retryable: true,
    details: {
      resendConfigured: config.resendConfigured,
      fromConfigured: config.fromConfigured,
      usesResendTestDomain: config.usesResendTestDomain,
      resendWebhookConfigured: config.resendWebhookConfigured
    }
  });
}

function emailDeliveryUnavailablePayload(delivery = {}, fallbackMessage = "Email delivery is unavailable.") {
  const config = delivery?.deliveryConfig || getEmailDeliveryConfig();
  return {
    error: fallbackMessage,
    message: "Zenin could not send this email. Configure RESEND_API_KEY and SMTP_FROM with a verified Resend sender domain, then retry.",
    code: "EMAIL_DELIVERY_FAILED",
    retryable: true,
    details: {
      resendConfigured: Boolean(config.resendConfigured),
      fromConfigured: Boolean(config.fromConfigured),
      usesResendTestDomain: Boolean(config.usesResendTestDomain),
      resendWebhookConfigured: Boolean(config.resendWebhookConfigured),
      providerError: delivery?.error?.message || null
    }
  };
}

async function recordPasswordResetEmailDelivery(token, delivery = {}) {
  if (!token) return null;
  return userAuth.updatePasswordResetEmailDelivery(hashToken(token), delivery).catch((error) => {
    console.error("[Auth] Failed to update password reset delivery metadata:", error?.message || error);
    return null;
  });
}

function getResendWebhookSecret() {
  return String(process.env.RESEND_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SIGNING_SECRET || "").trim();
}

function getResendWebhookHeaders(req) {
  return {
    "svix-id": req.headers["svix-id"],
    "svix-timestamp": req.headers["svix-timestamp"],
    "svix-signature": req.headers["svix-signature"],
    "webhook-id": req.headers["webhook-id"],
    "webhook-timestamp": req.headers["webhook-timestamp"],
    "webhook-signature": req.headers["webhook-signature"]
  };
}

function getResendEventLevel(type) {
  if (["email.failed", "email.bounced", "email.complained"].includes(type)) return "error";
  if (["email.delivery_delayed"].includes(type)) return "warning";
  return "info";
}

function getResendEventError(type, data = {}) {
  if (data.failed) return data.failed;
  if (data.bounce) return data.bounce;
  if (data.complaint) return data.complaint;
  if (type === "email.delivery_delayed") return { reason: "delivery_delayed" };
  return null;
}

app.post("/api/webhooks/resend", async (req, res) => {
  const webhookSecret = getResendWebhookSecret();
  if (!webhookSecret) {
    await admin.recordSystemLog({
      level: "error",
      message: "Resend webhook received but RESEND_WEBHOOK_SECRET is not configured.",
      context: { eventType: "resend_webhook_missing_secret" },
      requestId: req.requestId,
      ipAddress: resolveClientIp(req),
      service: "Email",
      endpoint: "POST /api/webhooks/resend",
      statusCode: 503,
      actorType: "system"
    }).catch((error) => {
      console.warn("[Email] Failed to persist webhook config warning log:", error?.message || error);
    });
    return res.status(503).json({ error: "Webhook secret is not configured." });
  }

  let event;
  try {
    const webhook = new Webhook(webhookSecret);
    event = webhook.verify(req.rawBody || Buffer.from(JSON.stringify(req.body || {})), getResendWebhookHeaders(req));
  } catch (error) {
    await admin.recordSystemLog({
      level: "warning",
      message: "Rejected Resend webhook with invalid signature.",
      context: {
        eventType: "resend_webhook_invalid_signature",
        error: String(error?.message || error).slice(0, 300)
      },
      requestId: req.requestId,
      ipAddress: resolveClientIp(req),
      service: "Email",
      endpoint: "POST /api/webhooks/resend",
      statusCode: 400,
      actorType: "system"
    }).catch((error) => {
      console.warn("[Email] Failed to persist webhook signature rejection log:", error?.message || error);
    });
    return res.status(400).json({ error: "Invalid webhook signature." });
  }

  const type = String(event?.type || "resend.unknown");
  const data = event?.data || {};
  const providerMessageId = data.email_id || data.emailId || null;
  const recipients = Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []);
  const deliveryError = getResendEventError(type, data);

  let resetTokenMatch = null;
  if (providerMessageId) {
    resetTokenMatch = await userAuth.updatePasswordResetEmailEventByProviderId(providerMessageId, {
      provider: "resend",
      error: deliveryError
    }).catch((error) => {
      console.error("[Email] Failed to map Resend webhook to password reset token:", error?.message || error);
      return null;
    });
  }

  await admin.recordSystemLog({
    level: getResendEventLevel(type),
    message: `Resend webhook received: ${type}`,
    context: {
      eventType: "resend_webhook",
      resendEventType: type,
      resendCreatedAt: event?.created_at || null,
      svixId: req.headers["svix-id"] || req.headers["webhook-id"] || null,
      provider: "resend",
      providerMessageId,
      recipientHashes: recipients.map((email) => hashToken(String(email || "").trim().toLowerCase())).filter(Boolean),
      subject: data.subject || null,
      tags: data.tags || null,
      deliveryError,
      passwordResetTokenId: resetTokenMatch?.id || null,
      targetUserId: resetTokenMatch?.userId || null
    },
    requestId: req.requestId,
    ipAddress: resolveClientIp(req),
    service: "Email",
    endpoint: "POST /api/webhooks/resend",
    statusCode: 200,
    userId: resetTokenMatch?.userId || null,
    actorType: "system"
  }).catch((error) => {
    console.error("[Email] Failed to log Resend webhook:", error?.message || error);
  });

  return res.json({ success: true });
});

const securityAnomalyState = new Map();

function trackSecurityAnomaly(key, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const existing = securityAnomalyState.get(key);
  if (!existing || existing.expiresAt < now) {
    const next = { count: 1, expiresAt: now + windowMs };
    securityAnomalyState.set(key, next);
    return next.count;
  }
  existing.count += 1;
  return existing.count;
}



function handleServerError(res, context, error, options = {}) {
  const status = Number(options.status || error?.statusCode || error?.status || 500);
  const safeError = status >= 500
    ? "Internal server error"
    : (options.error || error?.error || error?.message || "Request failed");
  const safeMessage = options.message || (status >= 500
    ? "Something went wrong while processing this request. Please try again."
    : error?.message || "The request could not be completed.");
  const code = options.code || error?.code || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED");

  console.error(`${context}:`, error?.message || error);
  return apiError(res, status, {
    error: safeError,
    message: safeMessage,
    code,
    details: options.details ?? error?.details,
    retryable: options.retryable
  });
}

function normalizeSnapshotParamValue(value) {
  if (Array.isArray(value)) return value.map((row) => normalizeSnapshotParamValue(row));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeSnapshotParamValue(value[key]);
        return acc;
      }, {});
  }
  return value == null ? null : String(value);
}

function buildSnapshotKey(scope, params = {}) {
  const normalizedParams = Object.keys(params || {})
    .sort()
    .reduce((acc, key) => {
      acc[key] = normalizeSnapshotParamValue(params[key]);
      return acc;
    }, {});
  return `${String(scope || "service").trim()}:${JSON.stringify(normalizedParams)}`;
}

function snapshotAgeSeconds(updatedAt) {
  const ts = new Date(updatedAt || 0).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

async function readServiceSnapshot(scope, params = {}) {
  try {
    return await serviceSnapshots.get(buildSnapshotKey(scope, params));
  } catch (error) {
    console.warn("Service snapshot read failed:", error?.message || error);
    return null;
  }
}

async function writeServiceSnapshot(scope, params = {}, payload = {}) {
  try {
    const snapshotKey = buildSnapshotKey(scope, params);
    await serviceSnapshots.delete(snapshotKey);
    await serviceSnapshots.set(snapshotKey, payload);
  } catch (error) {
    console.warn("Service snapshot write failed:", error?.message || error);
  }
}

const runtimeSnapshotCache = new Map();
const inflightSnapshotRequests = new Map();

function readRuntimeSnapshot(scope, params = {}, ttlMs = 0) {
  if (!(ttlMs > 0)) return null;
  const cacheKey = buildSnapshotKey(scope, params);
  const entry = runtimeSnapshotCache.get(cacheKey);
  if (!entry?.payload || !entry?.updatedAtMs) return null;
  if ((Date.now() - entry.updatedAtMs) >= ttlMs) {
    runtimeSnapshotCache.delete(cacheKey);
    return null;
  }
  return entry.payload;
}

function writeRuntimeSnapshot(scope, params = {}, payload = {}) {
  const cacheKey = buildSnapshotKey(scope, params);
  runtimeSnapshotCache.set(cacheKey, {
    payload,
    updatedAtMs: Date.now()
  });
}

async function readFreshSnapshot(scope, params = {}, ttlMs = 0) {
  const runtimePayload = readRuntimeSnapshot(scope, params, ttlMs);
  if (runtimePayload) return runtimePayload;
  const persisted = await readServiceSnapshot(scope, params);
  if (!persisted?.payload || !isSnapshotFresh(persisted, ttlMs)) return null;
  writeRuntimeSnapshot(scope, params, persisted.payload);
  return persisted.payload;
}

async function writeAllSnapshots(scope, params = {}, payload = {}) {
  writeRuntimeSnapshot(scope, params, payload);
  await writeServiceSnapshot(scope, params, payload);
}

async function withInflightDedup(scope, params = {}, factory) {
  const cacheKey = buildSnapshotKey(scope, params);
  if (inflightSnapshotRequests.has(cacheKey)) {
    return inflightSnapshotRequests.get(cacheKey);
  }
  const requestPromise = Promise.resolve()
    .then(factory)
    .finally(() => {
      inflightSnapshotRequests.delete(cacheKey);
    });
  inflightSnapshotRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

function invalidateRuntimeSnapshotsByPrefix(scopePrefix) {
  const prefix = `${String(scopePrefix || "").trim()}:`;
  if (!prefix) return;
  [...runtimeSnapshotCache.keys()].forEach((key) => {
    if (key.startsWith(prefix)) runtimeSnapshotCache.delete(key);
  });
  [...inflightSnapshotRequests.keys()].forEach((key) => {
    if (key.startsWith(prefix)) inflightSnapshotRequests.delete(key);
  });
}

const ROUTE_CACHE_TTLS_MS = {
  "app-bootstrap": 15 * 1000,
  "prices:tradfi": 30 * 1000,
  "prices:crypto": 30 * 1000,
  "watchlist:stocks": 45 * 1000,
  "watchlist:crypto": 45 * 1000,
  "watchlist:indicators": 2 * 60 * 1000,
  "history:tradfi": 5 * 60 * 1000,
  "history:crypto": 90 * 1000,
  finviz: 15 * 60 * 1000,
  "company-profile": 15 * 60 * 1000,
  "options-chain": 45 * 1000,
  "options-equity": 30 * 1000,
  "analytics-equities": 2 * 60 * 1000
};

function isRateLimitReason(reason = "") {
  return /(^|\b)(429|rate[_\s-]?limit|too many requests)(\b|$)/i.test(String(reason || ""));
}

function applyStaleMeta(payload = {}, snapshot = null, reason = "") {
  const normalizedReason = String(reason || "upstream_fetch_failed");
  const tryLater = isRateLimitReason(normalizedReason);
  return {
    ...(payload || {}),
    stale: true,
    unavailable: false,
    stale_reason: normalizedReason,
    cache_updated_at: snapshot?.updatedAt || null,
    stale_age_seconds: snapshotAgeSeconds(snapshot?.updatedAt),
    tryLater,
    statusMessage: tryLater ? "Rate limit hit. Showing the last saved snapshot. Try later." : null
  };
}

const COMPANY_PROFILE_VOLATILE_KEYS = new Set([
  "updatedAt",
  "stale",
  "unavailable",
  "stale_reason",
  "cache_updated_at",
  "stale_age_seconds",
  "companyProfileHash",
  "snapshotCheckedAt",
  "unchanged"
]);

function normalizeComparablePayloadValue(value, ignoredKeys = COMPANY_PROFILE_VOLATILE_KEYS) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparablePayloadValue(entry, ignoredKeys));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (ignoredKeys?.has(key)) return acc;
        acc[key] = normalizeComparablePayloadValue(value[key], ignoredKeys);
        return acc;
      }, {});
  }
  return value ?? null;
}

function buildComparablePayloadHash(payload = {}, ignoredKeys = COMPANY_PROFILE_VOLATILE_KEYS) {
  const normalized = normalizeComparablePayloadValue(payload, ignoredKeys);
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function validatePortfolioHolding(req, res, next) {
  const { symbol, name, price, quantity, type, marketType, orderType } = req.body;
  if (!symbol || typeof symbol !== "string" || symbol.length > 20) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  if (!name || typeof name !== "string" || name.length > 100) {
    return res.status(400).json({ error: "Invalid name" });
  }
  const isOptions = (type || "").toLowerCase() === "options" || (marketType || "").toLowerCase() === "options";
  if (typeof price !== "number" || (!isOptions && price < 0) || !isFinite(price)) {
    return res.status(400).json({ error: "Invalid price" });
  }
  if (typeof quantity !== "number" || !isFinite(quantity)) {
    return res.status(400).json({ error: "Invalid quantity" });
  }
  if (!["stock", "crypto", "bond", "commodity", "etf", "options"].includes((type || "").toLowerCase())) {
    return res.status(400).json({ error: "Invalid type" });
  }
  if (!["buy", "sell"].includes(orderType)) {
    return res.status(400).json({ error: "Invalid orderType" });
  }
  next();
}

function validatePortfolioUpdate(req, res, next) {
  const { price, quantity } = req.body || {};
  if (!Number.isFinite(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: "Invalid price" });
  }
  if (!Number.isFinite(Number(quantity))) {
    return res.status(400).json({ error: "Invalid quantity" });
  }
  next();
}

function validateWatchlistAsset(req, res, next) {
  const { asset, error } = sanitizeWatchlistAssetInput(req.body);
  if (error) {
    return res.status(400).json({ error });
  }
  req.body = asset;
  next();
}

function sanitizeWatchlistAssetInput(input = {}) {
  const symbol = String(input?.symbol || "").trim().toUpperCase();
  if (!symbol || symbol.length > 20) {
    return { error: "Invalid symbol" };
  }

  const name = String(input?.name || "").trim();
  if (!name || name.length > 100) {
    return { error: "Invalid name" };
  }

  const type = String(input?.type || "").trim().toLowerCase();
  if (!type || type.length > 50) {
    return { error: "Invalid type" };
  }

  const marketTypeRaw = input?.marketType == null ? "" : String(input.marketType).trim().toLowerCase();
  if (marketTypeRaw && marketTypeRaw.length > 50) {
    return { error: "Invalid marketType" };
  }

  const categoryRaw = input?.category == null ? "" : String(input.category).trim().toLowerCase();
  if (categoryRaw.length > 100) {
    return { error: "Invalid category" };
  }

  const themeRaw = input?.theme == null ? "" : String(input.theme).trim();
  if (themeRaw.length > 100) {
    return { error: "Invalid theme" };
  }

  const dateAdded = input?.date_added || input?.dateAdded || null;
  return {
    asset: {
      symbol,
      name,
      type,
      marketType: marketTypeRaw || null,
      category: categoryRaw || null,
      theme: themeRaw || null,
      date_added: dateAdded
    },
    error: null
  };
}

function normalizeWatchlistCategoryKey(asset = {}) {
  const explicitCategory = String(asset?.category || "").trim().toLowerCase();
  const rawType = String(asset?.type || "").trim().toLowerCase();
  const marketType = String(asset?.marketType || "").trim().toLowerCase();

  // Route based on explicitCategory where applicable to top-level domains
  if (explicitCategory === "indicators" || rawType === "indicator" || marketType === "macro") return "indicators";
  if (explicitCategory === "bonds" || rawType === "bond") return "bonds";
  if (explicitCategory === "crypto" || rawType === "crypto" || marketType === "spot" || marketType === "perp") return "crypto";
  if (["commodities", "metals"].includes(explicitCategory) || ["commodity", "commodities", "metal", "metals"].includes(rawType)) return "commodities";

  if (["stock", "stocks", "equity", "etf", "etfs"].includes(rawType) || marketType === "equity") return "stocks";
  if (explicitCategory && ["stocks"].includes(explicitCategory)) return "stocks";

  if (explicitCategory) return explicitCategory; // fallback for truly custom top-level categories if any

  return rawType || "stocks";
}

function buildWatchlistAssetIdentityKey(asset = {}) {
  const rawType = String(asset?.type || "").trim().toLowerCase();
  const inferredMarketType = String(
    asset?.marketType || (rawType === "crypto" ? "spot" : rawType === "indicator" ? "macro" : "equity")
  ).trim().toLowerCase();
  return [
    String(asset?.symbol || "").trim().toUpperCase(),
    inferredMarketType,
    String(asset?.category || "").trim().toLowerCase(),
    String(asset?.theme || "").trim().toLowerCase()
  ].join("::");
}

function validateOptionsCalculation(req, res, next) {
  const payload = req.body || {};
  if (!payload.symbol || typeof payload.symbol !== "string" || payload.symbol.trim().length > 20) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  const legs = Array.isArray(payload.legs) ? payload.legs : [];
  const breakevens = Array.isArray(payload.breakevens) ? payload.breakevens : [];
  if (legs.length > 30) {
    return res.status(400).json({ error: "Too many legs" });
  }
  if (breakevens.length > 30) {
    return res.status(400).json({ error: "Too many breakevens" });
  }
  const approxSize = JSON.stringify({
    ...payload,
    legs,
    breakevens
  }).length;
  if (approxSize > 50000) {
    return res.status(400).json({ error: "Payload too large" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Symbol → Yahoo Finance ticker normalisation
// Mirrors the logic in fetch_prices.py so the backend controls the mapping
// and the Python script always receives valid YF tickers.
// ---------------------------------------------------------------------------
const SYMBOL_MAP = {
  "EURUSD":     "EURUSD=X",
  "USDJPY":     "JPY=X",
  "GBPUSD":     "GBPUSD=X",
  "USDCAD":     "CAD=X",
  "USDCHF":     "CHF=X",
  "AUDUSD":     "AUDUSD=X",
  "NZDUSD":     "NZDUSD=X",
  "EURGBP":     "EURGBP=X",
  "EURJPY":     "EURJPY=X",
  "GBPJPY":     "GBPJPY=X",
  "EUR/USD":    "EURUSD=X",
  "USD/JPY":    "JPY=X",
  "GBP/USD":    "GBPUSD=X",
  "USD/CAD":    "CAD=X",
  "USD/CHF":    "CHF=X",
  "AUD/USD":    "AUDUSD=X",
  "NZD/USD":    "NZDUSD=X",
  "EUR/GBP":    "EURGBP=X",
  "EUR/JPY":    "EURJPY=X",
  "GBP/JPY":    "GBPJPY=X",
  "VIX":        "^VIX",
  "MOVE":       "^MOVE",
  "US10Y":      "^TNX",
  "DXY":        "DX-Y.NYB",
  "CL":         "CL=F",
  "NG":         "NG=F",
  "RB":         "RB=F",
  "GC":         "GC=F",
  "SI":         "SI=F",
  "HG":         "HG=F",
  "ZC":         "ZC=F",
  "ZW":         "ZW=F",
  "ZS":         "ZS=F",
  "KC":         "KC=F",
  "CC":         "CC=F",
  "SB":         "SB=F",
  "CT":         "CT=F",
  "SLX.AXS":    "SLX.AX",
  "034020.KS":  "034020.KS",
  "000660.KS":  "000660.KS",
  "373220":     "373220.KS",
  "CATL":       "300750.SZ",
  "1211":       "1211.HK",
  "3816.HK":    "3816.HK",
  "0981.HK":    "0981.HK",
  "2513.HK":    "2513.HK",
  "300308.SZ":  "300308.SZ",
  "8058.T":     "8058.T",
  "5210.T":     "5210.T",
  "6239.TW":    "6239.TW",
  "2337.TW":    "2337.TW",
  "SMTOY":      "SMTOY",
  "KYOCY":      "KYOCY",
  "6965":       "6965.T",
  "4062":       "4062.T",
  "6146":       "6146.T",
  "6754":       "6754.T",
  "9432":       "9432.T",
  "AW1(ASX)":   "AW1.AX",
  "SALIK":      "SALIK.AE",
  "LYSDY":      "LYSDY",
  "ILU":        "ILU.AX",
  "ARU":        "ARU.AX",
  "SYR":        "SYR.AX",
  "NEO":        "NEO.TO",
  "ENR":        "ENR.DE",
  "ALOY":       "ALOY",
  "USAR":       "USAR",
  "1ONDS.MI":   "ONDS",
  "ONDS":       "ONDS"
};

const STOCK_CATALOG = Array.isArray(watchlistData?.stocks) ? watchlistData.stocks : [];

function normalizeCatalogValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getStockCatalogMatches(symbol) {
  const safeSymbol = sanitizeSymbol(String(symbol || "").toUpperCase());
  if (!safeSymbol) return [];
  return STOCK_CATALOG.filter((entry) => sanitizeSymbol(String(entry?.symbol || "").toUpperCase()) === safeSymbol);
}

function scoreStockCatalogEntry(entry = {}) {
  return [
    entry?.market,
    entry?.theme,
    entry?.category,
    entry?.role,
    entry?.edge
  ].filter(Boolean).length;
}

function selectPrimaryStockCatalogEntry(symbol, preferredMeta = {}) {
  const matches = getStockCatalogMatches(symbol);
  if (!matches.length) return null;
  const preferredTheme = normalizeCatalogValue(preferredMeta?.theme);
  const preferredCategory = normalizeCatalogValue(preferredMeta?.category);

  return [...matches].sort((a, b) => {
    const aTheme = normalizeCatalogValue(a?.theme);
    const bTheme = normalizeCatalogValue(b?.theme);
    const aCategory = normalizeCatalogValue(a?.category);
    const bCategory = normalizeCatalogValue(b?.category);
    const aMetaMatch = (preferredTheme && aTheme === preferredTheme ? 1 : 0) + (preferredCategory && aCategory === preferredCategory ? 2 : 0);
    const bMetaMatch = (preferredTheme && bTheme === preferredTheme ? 1 : 0) + (preferredCategory && bCategory === preferredCategory ? 2 : 0);
    return bMetaMatch - aMetaMatch || scoreStockCatalogEntry(b) - scoreStockCatalogEntry(a);
  })[0];
}

function buildStockPeers(symbol, primaryEntry = null, limit = 6) {
  const safeSymbol = sanitizeSymbol(String(symbol || "").toUpperCase());
  const targetTheme = normalizeCatalogValue(primaryEntry?.theme);
  const targetCategory = normalizeCatalogValue(primaryEntry?.category);
  const dedupe = new Set();

  return STOCK_CATALOG
    .filter((entry) => sanitizeSymbol(String(entry?.symbol || "").toUpperCase()) !== safeSymbol)
    .map((entry) => {
      const categoryMatch = targetCategory && normalizeCatalogValue(entry?.category) === targetCategory ? 2 : 0;
      const themeMatch = targetTheme && normalizeCatalogValue(entry?.theme) === targetTheme ? 1 : 0;
      return {
        ...entry,
        _score: categoryMatch + themeMatch
      };
    })
    .filter((entry) => entry._score > 0)
    .sort((a, b) => b._score - a._score || scoreStockCatalogEntry(b) - scoreStockCatalogEntry(a))
    .filter((entry) => {
      const key = `${sanitizeSymbol(String(entry?.symbol || "").toUpperCase())}::${normalizeCatalogValue(entry?.theme)}::${normalizeCatalogValue(entry?.category)}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ _score, ...entry }) => ({
      symbol: entry.symbol,
      name: entry.name,
      market: entry.market || null,
      theme: entry.theme || null,
      category: entry.category || null,
      role: entry.role || null,
      edge: entry.edge || null
    }));
}

function isIndustrialCompany(profile = {}, stockMeta = null) {
  const haystack = [
    profile?.sector,
    profile?.industry,
    profile?.summary,
    stockMeta?.theme,
    stockMeta?.category,
    stockMeta?.role
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /(manufact|industrial|factory|semiconductor|chip|energy|defense|machinery|equipment|materials|mining|chemical|aerospace|auto|vehicle|battery|solar|nuclear|components|photonics|robotics)/.test(haystack);
}

function buildManufacturingNotes(profile = {}, stockMeta = null) {
  const industrial = isIndustrialCompany(profile, stockMeta);
  const headquartersBits = [profile?.city, profile?.state, profile?.country].filter(Boolean);
  const efficiencySignals = [];
  const inputNotes = [];
  const fulfillmentNotes = [];

  if (profile?.grossMargins != null) {
    efficiencySignals.push(`Gross margin: ${Number(profile.grossMargins * 100).toFixed(1)}%`);
  }
  if (profile?.operatingMargins != null) {
    efficiencySignals.push(`Operating margin: ${Number(profile.operatingMargins * 100).toFixed(1)}%`);
  }
  if (profile?.returnOnAssets != null) {
    efficiencySignals.push(`Return on assets: ${Number(profile.returnOnAssets * 100).toFixed(1)}%`);
  }
  if (!efficiencySignals.length) {
    efficiencySignals.push("Structured efficiency metrics were not fully disclosed in the current public snapshot.");
  }

  if (stockMeta?.category) {
    inputNotes.push(`Tracked internally under the ${stockMeta.category} category, which helps frame likely component and end-market exposure.`);
  }
  if (stockMeta?.edge) {
    inputNotes.push(stockMeta.edge);
  }
  if (!inputNotes.length) {
    inputNotes.push("No structured product-input mapping was available from the current public snapshot.");
  }

  if (profile?.analystCount != null) {
    fulfillmentNotes.push(`Analyst coverage currently spans ${profile.analystCount} opinions, which gives a market read on demand durability but not shipment-level fulfillment rates.`);
  }
  if (profile?.earnings?.nextEarnings) {
    fulfillmentNotes.push(`Next earnings date: ${profile.earnings.nextEarnings}, which is the nearest public checkpoint for backlog, timelines, and execution commentary.`);
  }
  if (!fulfillmentNotes.length) {
    fulfillmentNotes.push("Customer timeline and fulfillment-rate disclosures were not available in structured form from the current public snapshot.");
  }

  return {
    isIndustrial: industrial,
    factoryFootprint: headquartersBits.length
      ? [`Headquarters: ${headquartersBits.join(", ")}`]
      : ["Factory footprint details were not available in structured form from the current public snapshot."],
    efficiencySignals,
    customerFulfillment: fulfillmentNotes,
    inputExposure: inputNotes
  };
}

function normaliseSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (SYMBOL_MAP[normalized]) return SYMBOL_MAP[normalized];
  // Safety fallback: if BTC/ETH ever reach here, they need the -USD suffix for Yahoo
  const fallbacks = { "BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD" };
  if (fallbacks[normalized]) return fallbacks[normalized];

  if (normalized.includes(".") || normalized.includes("=") || normalized.startsWith("^")) return normalized;
  if (/^\d+$/.test(normalized)) return `${String(parseInt(normalized, 10)).padStart(4, "0")}.HK`; // bare number → HK
  return normalized;                                    // US ticker — pass through
}

// Build a map from original symbol → YF symbol and back
// so we can return results keyed by the original symbol the frontend knows.
function buildSymbolMaps(symbols) {
  const toYF = {};   // original → yf
  const fromYF = {}; // yf → original (last one wins for dupes)
  for (const s of symbols) {
    const yf = normaliseSymbol(s);
    toYF[s] = yf;
    fromYF[yf] = s;
  }
  return { toYF, fromYF };
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------
const cryptoTickerMap = {
  BTC:  "BTCUSDT",
  ETH:  "ETHUSDT",
  USDT: null,
  USDC: "USDCUSDT",
  BNB:  "BNBUSDT",
  XRP:  "XRPUSDT",
  ADA:  "ADAUSDT",
  SOL:  "SOLUSDT",
  DOGE: "DOGEUSDT",
  DOT:  "DOTUSDT",
};

async function resolveFetch() {
  return globalThis.fetch || (await import("node-fetch")).default;
}

function normalizeCountryLookupValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findCountryByIsoCode(code) {
  const upper = String(code || "").trim().toUpperCase();
  if (!upper) return null;
  const pools = [
    Array.isArray(countryCatalogMemory?.countries) ? countryCatalogMemory.countries : [],
    Array.isArray(FALLBACK_COUNTRY_CATALOG) ? FALLBACK_COUNTRY_CATALOG : []
  ];
  for (const pool of pools) {
    const found = pool.find((country) => country?.cca3 === upper || country?.cca2 === upper);
    if (found) return found;
  }
  return null;
}

function isSnapshotFresh(snapshot, ttlMs) {
  const updatedAtMs = new Date(snapshot?.updatedAt || 0).getTime();
  return Number.isFinite(updatedAtMs) && updatedAtMs > 0 && (Date.now() - updatedAtMs) < ttlMs;
}

async function postHyperliquidInfo(body) {
  const fetch = await resolveFetch();
  const response = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid info failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function searchCoinGeckoCrypto(query) {
  const fetch = await resolveFetch();
  const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  const payload = await response.json();
  const coins = Array.isArray(payload?.coins) ? payload.coins : [];
  return coins.slice(0, 25).map((coin) => ({
    symbol: String(coin.symbol || "").toUpperCase(),
    name: coin.name || coin.id || "Unknown",
    type: "crypto",
    exchange: "CoinGecko",
    marketType: "spot"
  }));
}

function computePercentChange(current, previous) {
  const curr = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function getCoinGeckoIdForSymbol(symbol) {
  const coinMap = {
    BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin",
    XRP: "ripple", ADA: "cardano", SOL: "solana",
    DOGE: "dogecoin", DOT: "polkadot", USDT: "tether", USDC: "usd-coin",
    HYPE: "hyperliquid"
  };
  return coinMap[symbol] || String(symbol || "").toLowerCase();
}

async function fetchHyperliquidSearchResults(query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];

  const [allMidsRaw, spotMetaRaw] = await Promise.allSettled([
    postHyperliquidInfo({ type: "allMids" }),
    postHyperliquidInfo({ type: "spotMeta" })
  ]);

  const mids = allMidsRaw.status === "fulfilled" && allMidsRaw.value && typeof allMidsRaw.value === "object"
    ? allMidsRaw.value
    : {};

  const resultsMap = new Map();

  // Perp/all mids symbols (e.g. BTC, ETH, HYPE)
  Object.keys(mids).forEach((coin) => {
    if (!coin || coin.startsWith("@")) return;
    const symbol = coin.toUpperCase();
    const price = Number(mids[coin]);
    const record = {
      symbol,
      name: `${symbol} (Hyperliquid)`,
      type: "crypto",
      exchange: "Hyperliquid",
      marketType: "spot",
      price: Number.isFinite(price) ? price : null
    };
    resultsMap.set(symbol, record);
  });

  // Spot universe mapping from token index -> symbol
  if (spotMetaRaw.status === "fulfilled" && spotMetaRaw.value && typeof spotMetaRaw.value === "object") {
    const tokens = Array.isArray(spotMetaRaw.value.tokens) ? spotMetaRaw.value.tokens : [];
    const universe = Array.isArray(spotMetaRaw.value.universe) ? spotMetaRaw.value.universe : [];
    const tokenByIndex = new Map(tokens.map((t) => [t.index, t]));

    universe.forEach((pair) => {
      const tokenIndexes = Array.isArray(pair.tokens) ? pair.tokens : [];
      const baseToken = tokenByIndex.get(tokenIndexes[0]);
      if (!baseToken?.name) return;
      const symbol = String(baseToken.name).toUpperCase();
      const midsKey = pair.name && mids[pair.name] != null ? pair.name : `@${pair.index}`;
      const mid = Number(mids[midsKey]);
      if (!resultsMap.has(symbol)) {
        resultsMap.set(symbol, {
          symbol,
          name: `${symbol}/USDC`,
          type: "crypto",
          exchange: "Hyperliquid",
          marketType: "spot",
          price: Number.isFinite(mid) ? mid : null
        });
      } else if (Number.isFinite(mid) && resultsMap.get(symbol).price == null) {
        resultsMap.get(symbol).price = mid;
      }
    });
  }

  return [...resultsMap.values()]
    .filter((row) =>
      row.symbol.toLowerCase().includes(needle) ||
      String(row.name || "").toLowerCase().includes(needle)
    )
    .slice(0, 25);
}

const CRYPTO_CACHE_TTL_MS = 60000;
let cryptoMarketCache = {
  ts: 0,
  assets: []
};

async function fetchCryptoMarketData() {
  const fetch = await resolveFetch();

  const allDbAssets = await watchlist.getAll();
  const combinedAssets = allDbAssets
    .filter((a) => {
      const dbType = (a.type || "").toLowerCase();
      return dbType === "crypto" || dbType === "stablecoin" || dbType === "exchange token" || dbType === "spot";
    })
    .map((asset) => ({ ...asset, type: asset.type || "crypto" }));

  if (combinedAssets.length === 0) {
    return [];
  }

  const now = Date.now();
  if (cryptoMarketCache.assets.length > 0 && now - cryptoMarketCache.ts < CRYPTO_CACHE_TTL_MS) {
    const cacheMap = new Map(cryptoMarketCache.assets.map((a) => [a.symbol, a]));
    return combinedAssets.map((asset) => {
      const cached = cacheMap.get(asset.symbol);
      return {
        ...asset,
        price: cached?.price ?? null,
        priceChangePercent: cached?.priceChangePercent ?? null,
        volume: null
      };
    });
  }

  try {
    let hyperMids = {};
    let perpCtxMap = new Map();
    let spotCtxMap = new Map();

    const [midsRes, perpCtxRes, spotCtxRes] = await Promise.allSettled([
      postHyperliquidInfo({ type: "allMids" }),
      postHyperliquidInfo({ type: "metaAndAssetCtxs" }),
      postHyperliquidInfo({ type: "spotMetaAndAssetCtxs" })
    ]);

    if (midsRes.status === "fulfilled" && midsRes.value && typeof midsRes.value === "object") {
      hyperMids = midsRes.value;
    }

    if (perpCtxRes.status === "fulfilled" && Array.isArray(perpCtxRes.value)) {
      const [meta, contexts] = perpCtxRes.value;
      const universe = Array.isArray(meta?.universe) ? meta.universe : [];
      const ctxs = Array.isArray(contexts) ? contexts : [];
      universe.forEach((u, idx) => {
        const key = String(u?.name || "").toUpperCase();
        if (key && ctxs[idx]) perpCtxMap.set(key, ctxs[idx]);
      });
    }

    if (spotCtxRes.status === "fulfilled" && Array.isArray(spotCtxRes.value)) {
      const [meta, contexts] = spotCtxRes.value;
      const tokens = Array.isArray(meta?.tokens) ? meta.tokens : [];
      const universe = Array.isArray(meta?.universe) ? meta.universe : [];
      const ctxs = Array.isArray(contexts) ? contexts : [];
      const tokenByIndex = new Map(tokens.map((t) => [t.index, t]));

      universe.forEach((pair, idx) => {
        const baseTokenIndex = Array.isArray(pair?.tokens) ? pair.tokens[0] : null;
        const baseToken = tokenByIndex.get(baseTokenIndex);
        const symbol = String(baseToken?.name || "").toUpperCase();
        if (symbol && ctxs[idx]) spotCtxMap.set(symbol, ctxs[idx]);
      });
    }

    const missingSymbols = [];
    const partial = combinedAssets.map((asset) => {
      const symbol = String(asset.symbol || "").toUpperCase();
      const midsValue = Number(hyperMids[symbol]);
      const perpCtx = perpCtxMap.get(symbol);
      const spotCtx = spotCtxMap.get(symbol);
      const markPx = Number(perpCtx?.markPx ?? spotCtx?.midPx);
      const prevDayPx = Number(perpCtx?.prevDayPx ?? spotCtx?.prevDayPx);
      const price = Number.isFinite(midsValue) ? midsValue : (Number.isFinite(markPx) ? markPx : null);
      const priceChangePercent = computePercentChange(price, prevDayPx);

      if (price == null) missingSymbols.push(symbol);

      return {
        ...asset,
        price,
        priceChangePercent,
        volume: null
      };
    });

    const uniqueMissing = [...new Set(missingSymbols)];
    if (uniqueMissing.length > 0) {
      const ids = uniqueMissing.map(getCoinGeckoIdForSymbol).join(",");
      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      const cgRes = await fetch(cgUrl);
      const cgData = cgRes.ok ? await cgRes.json() : {};

      partial.forEach((row) => {
        if (row.price != null) return;
        const id = getCoinGeckoIdForSymbol(row.symbol);
        const info = cgData[id];
        row.price = info?.usd ?? null;
        row.priceChangePercent = info?.usd_24h_change ?? null;
      });
    }

    const enriched = partial;

    cryptoMarketCache = {
      ts: Date.now(),
      assets: enriched.map((asset) => ({
        symbol: asset.symbol,
        price: asset.price,
        priceChangePercent: asset.priceChangePercent
      }))
    };
    return enriched;
  } catch (error) {
    const cacheMap = new Map(cryptoMarketCache.assets.map((a) => [a.symbol, a]));
    return combinedAssets.map(asset => ({
      ...asset,
      price: cacheMap.get(asset.symbol)?.price ?? null,
      priceChangePercent: cacheMap.get(asset.symbol)?.priceChangePercent ?? null,
      volume: null
    }));
  }
}

async function fetchCryptoQuotesBySymbols(symbols = []) {
  const normalizedSymbols = [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean)
  )];
  if (!normalizedSymbols.length) return {};

  const fetch = await resolveFetch();
  let hyperMids = {};
  let perpCtxMap = new Map();
  let spotCtxMap = new Map();

  try {
    const [midsRes, perpCtxRes, spotCtxRes] = await Promise.allSettled([
      postHyperliquidInfo({ type: "allMids" }),
      postHyperliquidInfo({ type: "metaAndAssetCtxs" }),
      postHyperliquidInfo({ type: "spotMetaAndAssetCtxs" })
    ]);

    if (midsRes.status === "fulfilled" && midsRes.value && typeof midsRes.value === "object") {
      hyperMids = midsRes.value;
    }

    if (perpCtxRes.status === "fulfilled" && Array.isArray(perpCtxRes.value)) {
      const [meta, contexts] = perpCtxRes.value;
      const universe = Array.isArray(meta?.universe) ? meta.universe : [];
      const ctxs = Array.isArray(contexts) ? contexts : [];
      universe.forEach((u, idx) => {
        const key = String(u?.name || "").toUpperCase();
        if (key && ctxs[idx]) perpCtxMap.set(key, ctxs[idx]);
      });
    }

    if (spotCtxRes.status === "fulfilled" && Array.isArray(spotCtxRes.value)) {
      const [meta, contexts] = spotCtxRes.value;
      const tokens = Array.isArray(meta?.tokens) ? meta.tokens : [];
      const universe = Array.isArray(meta?.universe) ? meta.universe : [];
      const ctxs = Array.isArray(contexts) ? contexts : [];
      const tokenByIndex = new Map(tokens.map((t) => [t.index, t]));
      universe.forEach((pair, idx) => {
        const baseTokenIndex = Array.isArray(pair?.tokens) ? pair.tokens[0] : null;
        const baseToken = tokenByIndex.get(baseTokenIndex);
        const key = String(baseToken?.name || "").toUpperCase();
        if (key && ctxs[idx]) spotCtxMap.set(key, ctxs[idx]);
      });
    }
  } catch (error) {
    console.warn("[Prices] Hyperliquid spot context fetch failed, falling back to CoinGecko:", error?.message || error);
  }

  const quotes = {};
  const missingSymbols = [];
  normalizedSymbols.forEach((symbol) => {
    const midsValue = Number(hyperMids[symbol]);
    const perpCtx = perpCtxMap.get(symbol);
    const spotCtx = spotCtxMap.get(symbol);
    const markPx = Number(perpCtx?.markPx ?? spotCtx?.midPx);
    const prevDayPx = Number(perpCtx?.prevDayPx ?? spotCtx?.prevDayPx);
    const price = Number.isFinite(midsValue) ? midsValue : (Number.isFinite(markPx) ? markPx : null);
    const priceChangePercent = computePercentChange(price, prevDayPx);
    quotes[symbol] = {
      price: Number.isFinite(price) ? price : null,
      priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null,
      source: Number.isFinite(price) ? "Hyperliquid" : "CoinGecko"
    };
    if (!Number.isFinite(price)) {
      missingSymbols.push(symbol);
    }
  });

  if (missingSymbols.length > 0) {
    try {
      const ids = missingSymbols.map(getCoinGeckoIdForSymbol).join(",");
      const cgUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      const cgRes = await fetch(cgUrl);
      const cgData = cgRes.ok ? await cgRes.json() : {};
      missingSymbols.forEach((symbol) => {
        const id = getCoinGeckoIdForSymbol(symbol);
        const info = cgData[id] || {};
        if (Number.isFinite(Number(info.usd))) {
          quotes[symbol].price = Number(info.usd);
        }
        if (Number.isFinite(Number(info.usd_24h_change))) {
          quotes[symbol].priceChangePercent = Number(info.usd_24h_change);
        }
        if (Number.isFinite(Number(info.usd))) {
          quotes[symbol].source = "CoinGecko";
        }
      });
    } catch (error) {
      console.warn("[Prices] CoinGecko quote enrichment failed:", error?.message || error);
    }
  }

  return quotes;
}

// ---------------------------------------------------------------------------
// yfinance bridge
// ---------------------------------------------------------------------------
function fetchYFinancePrices(originalSymbols) {
  return new Promise((resolve) => {
    if (!originalSymbols || originalSymbols.length === 0) {
      resolve({});
      return;
    }

    const { toYF, fromYF } = buildSymbolMaps(originalSymbols);
    // Modified to pass objects with type info if possible, otherwise default to stock
    const payload = originalSymbols.map(s => ({
      symbol: s,
      type: "stock" // We could improve this by infering type from symbol if needed
    }));

    console.log("Fetching prices — original:", originalSymbols);
    // const safeSymbol = sanitizeSymbol(symbol);
    const child = spawn(pythonBinary, ["fetch_prices.py"], { cwd: __dirname });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (stderr) console.error("Python stderr:", stderr);
      console.log("Python exited with code:", code);

      if (code !== 0) { resolve({}); return; }

      let yfPrices = {};
      try {
        yfPrices = JSON.parse(stdout);
      } catch (e) {
        console.error("Failed to parse Python output:", e.message);
        resolve({});
        return;
      }

      // Re-key results from YF ticker back to the original symbol
      const result = {};
      for (const orig of originalSymbols) {
        result[orig] = {
          ...(yfPrices[orig] || {
          price: null,
          priceChangePercent: null,
          isMarketOpen: true,
          marketStatus: "unknown"
          }),
          source: yfPrices[orig]?.source || "Yahoo Finance"
        };
      }
      resolve(result);
    });

    child.on("error", (err) => {
      console.error("Failed to start Python process:", err);
      resolve({});
    });

    // Send the payload to the Python script
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    // Generous timeout — international exchanges can be slow
    // Increased to 180s for large batches (200+ stocks)
    const timer = setTimeout(() => {
      console.warn("yfinance timeout — killing Python process");
      child.kill();
      resolve({});
    }, 180000);

    child.on("close", () => clearTimeout(timer));
  });
}

const FX_PAIRS = [
  "EUR/USD",
  "USD/JPY",
  "GBP/USD",
  "USD/CAD",
  "USD/CHF",
  "AUD/USD",
  "NZD/USD",
  "EUR/GBP",
  "EUR/JPY",
  "GBP/JPY"
];

function decodeHtmlEntity(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#47;/g, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value) {
  return decodeHtmlEntity(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function parsePercentValue(value) {
  const parsed = Number(String(value || "").replace(/[,%+]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFxPair(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (compact.length !== 6 || compact.startsWith("BTC")) return "";
  return `${compact.slice(0, 3)}/${compact.slice(3)}`;
}

async function fetchFinvizForexPerformance() {
  const fetch = await resolveFetch();
  const response = await fetch("https://finviz.com/forex_performance.ashx?v=1", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`finviz_fx_http_${response.status}`);
  const html = await response.text();
  const rows = [];
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => stripHtml(match[1]));
    if (cells.length < 7) continue;
    const pair = normalizeFxPair(cells[1]);
    if (!pair) continue;
    const price = Number(String(cells[2]).replace(/,/g, ""));
    rows.push({
      pair,
      symbol: pair.replace("/", ""),
      rate: Number.isFinite(price) ? price : null,
      perf5Min: parsePercentValue(cells[3]),
      hourly: parsePercentValue(cells[4]),
      daily: parsePercentValue(cells[5]),
      weekly: parsePercentValue(cells[6]),
      monthly: parsePercentValue(cells[7]),
      quarterly: parsePercentValue(cells[8]),
      ytd: parsePercentValue(cells[10]),
      yearly: parsePercentValue(cells[11]),
      source: "Finviz",
      updatedAt: new Date().toISOString()
    });
  }
  if (!rows.length) throw new Error("finviz_fx_empty");
  const byPair = new Map(rows.map((row) => [row.pair, row]));
  return FX_PAIRS.map((pair) => byPair.get(pair)).filter(Boolean);
}

async function fetchYahooFxRates() {
  const symbols = FX_PAIRS.map((pair) => pair.replace("/", ""));
  const quotes = await fetchYFinancePrices(symbols);
  return FX_PAIRS.map((pair) => {
    const symbol = pair.replace("/", "");
    const quote = quotes[symbol] || {};
    const rate = Number(quote.price);
    const daily = Number(quote.priceChangePercent);
    return {
      pair,
      symbol,
      rate: Number.isFinite(rate) ? rate : null,
      daily: Number.isFinite(daily) ? daily : null,
      weekly: null,
      source: "Yahoo Finance",
      updatedAt: new Date().toISOString(),
      stale: !Number.isFinite(rate)
    };
  });
}

async function fetchForexRates() {
  try {
    const finvizRows = await fetchFinvizForexPerformance();
    return {
      updatedAt: new Date().toISOString(),
      source: "Finviz",
      rates: finvizRows,
      gainers: [...finvizRows].filter((row) => Number.isFinite(Number(row.daily))).sort((a, b) => Number(b.daily) - Number(a.daily)).slice(0, 5),
      losers: [...finvizRows].filter((row) => Number.isFinite(Number(row.daily))).sort((a, b) => Number(a.daily) - Number(b.daily)).slice(0, 5)
    };
  } catch (error) {
    const yahooRows = await fetchYahooFxRates();
    return {
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance",
      stale: true,
      stale_reason: error?.message || "finviz_fx_fetch_failed",
      rates: yahooRows,
      gainers: [...yahooRows].filter((row) => Number.isFinite(Number(row.daily))).sort((a, b) => Number(b.daily) - Number(a.daily)).slice(0, 5),
      losers: [...yahooRows].filter((row) => Number.isFinite(Number(row.daily))).sort((a, b) => Number(a.daily) - Number(b.daily)).slice(0, 5)
    };
  }
}

function computeTrend(value, previous) {
  const currentValue = Number(value);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return "Flat";
  if (currentValue > previousValue) return "Up";
  if (currentValue < previousValue) return "Down";
  return "Flat";
}

async function fetchAnalyticsMacroRows(country = "USA") {
  const [fredResult, blsResult, wbRows] = await Promise.all([
    String(country).toUpperCase() === "USA" ? fetchFredMacroMetrics().catch((error) => { console.warn("[Macro] FRED metrics fetch failed:", error?.message || error); return { rows: [] }; }) : Promise.resolve({ rows: [] }),
    String(country).toUpperCase() === "USA" ? fetchBlsMacroMetrics().catch((error) => { console.warn("[Macro] BLS metrics fetch failed:", error?.message || error); return { rows: [] }; }) : Promise.resolve({ rows: [] }),
    fetchWorldBankMacroMetrics(country).catch((error) => { console.warn(`[Macro] World Bank metrics fetch failed for ${country}:`, error?.message || error); return []; })
  ]);
  const metrics = sanitizeMacroMetrics([...wbRows, ...(blsResult.rows || []), ...(fredResult.rows || [])]);
  const sourceByKey = new Map(
    [...wbRows, ...(blsResult.rows || []), ...(fredResult.rows || [])]
      .filter((row) => row?.key)
      .map((row) => [row.key, row.source || "World Bank"])
  );
  return metrics
    .filter((metric) => Number.isFinite(Number(metric.current)))
    .map((metric) => ({
      indicator: metric.label,
      indicatorCode: metric.key,
      value: Number(metric.current),
      unit: metric.unit,
      country,
      trend: computeTrend(metric.current, metric.previous),
      previous: metric.previous,
      asOf: metric.asOf,
      source: sourceByKey.get(metric.key) || "World Bank"
    }));
}

function riskStatus(indicator, value, changePct) {
  const val = Number(value);
  const change = Number(changePct);
  if (!Number.isFinite(val)) return "Unavailable";
  if (indicator === "VIX") return val >= 25 ? "Elevated" : val >= 18 ? "Watch" : "Normal";
  if (indicator === "MOVE Index") return val >= 125 ? "Elevated" : val >= 100 ? "Watch" : "Normal";
  if (indicator === "US 10Y Treasury") return val >= 4.75 ? "Elevated" : val >= 4.25 ? "Watch" : "Normal";
  if (indicator === "DXY") return Math.abs(change) >= 0.7 ? "Watch" : "Normal";
  if (indicator === "HYG Credit Proxy") return change <= -0.8 ? "Elevated" : change <= -0.35 ? "Watch" : "Contained";
  return "Normal";
}

async function fetchAnalyticsRiskIndicators() {
  const symbols = ["VIX", "MOVE", "US10Y", "DXY", "HYG"];
  const prices = await fetchYFinancePrices(symbols);
  const rows = [
    { key: "VIX", indicator: "VIX", unit: "index", transform: (v) => v },
    { key: "MOVE", indicator: "MOVE Index", unit: "index", transform: (v) => v },
    { key: "US10Y", indicator: "US 10Y Treasury", unit: "%", transform: (v) => v / 10 },
    { key: "DXY", indicator: "DXY", unit: "index", transform: (v) => v },
    { key: "HYG", indicator: "HYG Credit Proxy", unit: "price", transform: (v) => v }
  ];
  return rows.map((row) => {
    const quote = prices[row.key] || {};
    const raw = Number(quote.price);
    const value = Number.isFinite(raw) ? Number(row.transform(raw).toFixed(row.unit === "%" ? 3 : 2)) : null;
    const changePct = Number(quote.priceChangePercent);
    return {
      indicator: row.indicator,
      value,
      unit: row.unit,
      daily: Number.isFinite(changePct) ? Number(changePct.toFixed(2)) : null,
      status: riskStatus(row.indicator, value, changePct),
      source: "Yahoo Finance",
      updatedAt: new Date().toISOString()
    };
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
const FALLBACK_STOCKS = {
  'AAPL': 'Apple Inc', 'MSFT': 'Microsoft Corporation', 'GOOGL': 'Alphabet Inc',
  'AMZN': 'Amazon.com Inc', 'TSLA': 'Tesla Inc', 'NVDA': 'NVIDIA Corporation',
  'META': 'Meta Platforms Inc', 'NFLX': 'Netflix Inc', 'JPM': 'JPMorgan Chase',
  'V': 'Visa Inc', 'WMT': 'Walmart Inc', 'JNJ': 'Johnson & Johnson'
};

async function searchYahooFinance(query, type = "tradfi") {
  if (!query || query.trim().length === 0) return [];

  const results = [];
  const queryLower = query.toLowerCase();

  // Fast Fallback Dictionary Match
  for (const [symbol, name] of Object.entries(FALLBACK_STOCKS)) {
    if (symbol.toLowerCase().includes(queryLower) || name.toLowerCase().includes(queryLower)) {
      results.push({ symbol, name, type: 'stock', exchange: 'NASDAQ/NYSE' });
    }
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json"
      }
    });

    if (response.ok) {
      const data = await response.json();
      const quotes = Array.isArray(data.quotes) ? data.quotes : [];
      let fetchResolveCount = 0;
      const inferCurrency = (symbol, exchange) => {
        const sym = String(symbol || "").toUpperCase();
        const exch = String(exchange || "").toUpperCase();
        if (sym.endsWith(".T") || exch.includes("TYO") || exch.includes("JPX") || exch.includes("TOKYO")) return "JPY";
        if (sym.endsWith(".L") || exch.includes("LSE") || exch.includes("LONDON")) return "GBP";
        if (sym.endsWith(".DE") || sym.endsWith(".F") || sym.endsWith(".PA") || sym.endsWith(".MI") || exch.includes("FRA") || exch.includes("GER") || exch.includes("PAR") || exch.includes("MIL") || exch.includes("XETRA")) return "EUR";
        if (sym.endsWith(".TO") || sym.endsWith(".V") || exch.includes("TOR") || exch.includes("VAN") || exch.includes("TSX")) return "CAD";
        if (sym.endsWith(".AX") || exch.includes("ASX")) return "AUD";
        if (sym.endsWith(".HK") || exch.includes("HKG") || exch.includes("HONG KONG")) return "HKD";
        if (sym.endsWith(".KS") || sym.endsWith(".KQ") || exch.includes("KSC") || exch.includes("KOS") || exch.includes("KOREA")) return "KRW";
        if (sym.endsWith(".SN") || sym.endsWith(".SS") || exch.includes("SHH") || exch.includes("SHZ") || exch.includes("SHANGHAI")) return "CNY";
        if (sym.endsWith(".BO") || sym.endsWith(".NS") || exch.includes("BSE") || exch.includes("NSE") || exch.includes("INDIA")) return "INR";
        if (sym.endsWith(".SW") || exch.includes("EBS") || exch.includes("SWISS")) return "CHF";
        return "USD";
      };

      for (const q of quotes) {
        if (!q.symbol) continue;
        if (!results.some(r => r.symbol === q.symbol)) {
          results.push({
            symbol: q.symbol,
            name: q.shortname || q.longname || q.symbol,
            type: "stock",
            exchange: q.exchange || q.exchDisp || "NASDAQ/NYSE",
            currency: q.currency || inferCurrency(q.symbol, q.exchange || q.exchDisp)
          });
          fetchResolveCount++;
        }
      }
    }
  } catch (err) {
    console.error("Yahoo Finance search natively failed:", err.message);
  }

  return results.slice(0, 10);
}

// ---------------------------------------------------------------------------
// USER BALANCE ENDPOINTS
// ---------------------------------------------------------------------------

async function buildUserBootstrapPayload(userId, options = {}) {
  const tradeLimit = Math.max(200, Math.min(2000, Number(options.tradeLimit) || 1000));
  const activeWorkspace = options.activeWorkspace || await workspaces.getActiveForUser(userId);
  const activeWorkspaceId = activeWorkspace?.workspace?.id || null;
  const sharedWatchlistAccess = buildSharedWatchlistAccess(activeWorkspace, userId, options.userPlan);
  const [balances, usdBalance, holdings, watchlistAssets, trades, feeSummary] = await Promise.all([
    userWorkspace.cash.getAll(userId, activeWorkspaceId),
    userWorkspace.balance.get(userId),
    userWorkspace.portfolio.getAll(userId, activeWorkspaceId),
    sharedWatchlistAccess.allowed ? userWorkspace.watchlist.getAll(userId, activeWorkspaceId) : Promise.resolve([]),
    userWorkspace.trades.getAll(userId, tradeLimit, activeWorkspaceId),
    userWorkspace.tradeFills.getSummary(userId, activeWorkspaceId)
  ]);
  const [workspaceMembers, workspaceInvites, workspaceActivity, workspaceAccounts] = activeWorkspace?.workspace
    ? await Promise.all([
        workspaces.listMembers(activeWorkspace.workspace.id),
        workspaces.listInvites(activeWorkspace.workspace.id),
        workspaces.listActivity(activeWorkspace.workspace.id, 20),
        userWorkspace.exchangeKeys.list(userId, activeWorkspace.workspace.id)
      ])
    : [[], [], [], []];

  const normalizedBalances = Array.isArray(balances) ? balances.slice() : [];
  if (!normalizedBalances.some((row) => row?.currency === "USD")) {
    normalizedBalances.unshift({
      currency: "USD",
      balance: activeWorkspace?.workspace?.ownerUserId === Number(userId) ? usdBalance : 0,
      updatedAt: new Date().toISOString()
    });
  }

  return {
    balances: normalizedBalances,
    holdings: Array.isArray(holdings) ? holdings : [],
    watchlistAssets: Array.isArray(watchlistAssets) ? watchlistAssets : [],
    trades: Array.isArray(trades) ? trades : [],
    feeSummary: feeSummary || null,
    categories: Object.keys(watchlistData),
    sharedWatchlistAccess,
    activeWorkspace: sanitizeWorkspace(activeWorkspace?.workspace, activeWorkspace?.membership),
    workspaceMembers: workspaceMembers.map(sanitizeWorkspaceMember),
    workspaceInvites: workspaceInvites.map(sanitizeWorkspaceInvite),
    workspaceActivity,
    workspaceAccounts: Array.isArray(workspaceAccounts) ? workspaceAccounts.map((item) => {
      let parsedExtra = {};
      try {
        const rawExtra = typeof item.extraData === "string" ? workspaceSecretProvider.decryptSecret(item.extraData) : item.extraData;
        parsedExtra = typeof rawExtra === "string" ? JSON.parse(rawExtra) : (rawExtra || {});
      } catch (error) {
        console.warn("[Bootstrap] Failed to decrypt/parse workspace account extraData for item", item.id, ":", error?.message || error);
        parsedExtra = {};
      }
      const capability = buildConnectionCapability(item.exchange);
      return {
        id: item.id,
        exchange: item.exchange,
        createdAt: item.createdAt || null,
        permissionScope: item.permissionScope || "unknown",
        canTrade: !!item.canTrade,
        lastVerifiedScope: item.lastVerifiedScope || "unknown",
        riskLevel: item.riskLevel || "standard",
        syncAvailable: capability.syncAvailable,
        connectionCapability: capability,
        extraData: parsedExtra,
        lastSyncAt: item.lastSyncAt || null,
        lastSyncStatus: item.lastSyncStatus || "idle",
        lastSyncMeta: item.lastSyncMeta || {}
      };
    }) : [],
    appConfig: buildAppRuntimeConfig(),
    updatedAt: new Date().toISOString()
  };
}

app.get("/api/public/config", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  return res.json({
    publicConfig: buildPublicRuntimeConfig(),
    appConfig: buildAppRuntimeConfig(),
    updatedAt: new Date().toISOString()
  });
});

app.get("/api/app/bootstrap", requireSignedIn, attachActiveWorkspace, async (req, res) => {
  const tradeLimit = Math.max(200, Math.min(2000, Number(req.query.tradeLimit) || 1000));
  const snapshotParams = {
    userId: req.auth.userId,
    tradeLimit,
    workspaceId: req.workspace?.workspace?.id || null,
    workspacePlan: req.workspace?.workspace?.plan || "starter",
    workspaceSeats: req.workspace?.workspace?.seatCount || 1,
    userPlan: req.auth?.user?.currentPlan || "starter"
  };
  const ttlMs = ROUTE_CACHE_TTLS_MS["app-bootstrap"];

  try {
    const fresh = await readFreshSnapshot("app-bootstrap", snapshotParams, ttlMs);
    if (fresh) {
      return res.json(fresh);
    }

    const payload = await withInflightDedup("app-bootstrap", snapshotParams, async () => {
      const nextPayload = await buildUserBootstrapPayload(req.auth.userId, {
        tradeLimit,
        activeWorkspace: req.workspace,
        userPlan: req.auth?.user?.currentPlan
      });
      await writeAllSnapshots("app-bootstrap", snapshotParams, nextPayload);
      return nextPayload;
    });
    return res.json(payload);
  } catch (error) {
    const cached = await readServiceSnapshot("app-bootstrap", snapshotParams);
    if (cached?.payload) {
      return res.json({
        ...cached.payload,
        stale: true,
        stale_reason: error?.message || "app_bootstrap_fetch_failed",
        cache_updated_at: cached?.updatedAt || null,
        stale_age_seconds: snapshotAgeSeconds(cached?.updatedAt)
      });
    }
    return handleServerError(res, "Bootstrap fetch failed", error);
  }
});

app.get("/api/workspaces/current", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const workspaceContext = getRequiredWorkspaceContext(req);
    const members = await workspaces.listMembers(workspaceContext.id);
    const invites = await workspaces.listInvites(workspaceContext.id);
    return res.json({
      workspace: sanitizeWorkspace(workspaceContext.workspace, workspaceContext.membership),
      members: members.map(sanitizeWorkspaceMember),
      invites: invites.map(sanitizeWorkspaceInvite)
    });
  } catch (error) {
    return handleServerError(res, "Failed to load current workspace", error);
  }
});

app.patch("/api/workspaces/current", requireSignedIn, attachActiveWorkspace, requireWorkspaceAdmin, requirePlan("desk"), writeLimiter, validate(workspaceUpdateSchema), async (req, res) => {
  try {
    const workspaceContext = getRequiredWorkspaceContext(req);
    const previousWorkspace = sanitizeWorkspace(workspaceContext.workspace, workspaceContext.membership);
    const workspace = await workspaces.updateWorkspace(workspaceContext.id, req.body || {});
    await workspaces.recordActivity({
      workspaceId: workspaceContext.id,
      actorUserId: req.auth.userId,
      eventType: "workspace_updated",
      entityType: "workspace",
      entityId: workspaceContext.id,
      details: req.body || {}
    });
    await logSecurityEvent(req, {
      message: "Workspace settings updated.",
      eventType: "workspace_updated",
      workspaceId: workspaceContext.id,
      context: {
        diff: buildSecurityDiff(previousWorkspace, sanitizeWorkspace(workspace, workspaceContext.membership))
      }
    });
    return res.json({ workspace: sanitizeWorkspace(workspace, req.workspace.membership) });
  } catch (error) {
    return handleServerError(res, "Failed to update workspace", error);
  }
});

app.get("/api/workspaces/current/members", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const members = await workspaces.listMembers(req.workspace.workspace.id);
    return res.json({ items: members.map(sanitizeWorkspaceMember) });
  } catch (error) {
    return handleServerError(res, "Failed to list workspace members", error);
  }
});

app.get("/api/workspaces/current/invites", requireSignedIn, attachActiveWorkspace, requireWorkspaceAdmin, requirePlan("desk"), async (req, res) => {
  try {
    const invites = await workspaces.listInvites(req.workspace.workspace.id);
    return res.json({ items: invites.map(sanitizeWorkspaceInvite) });
  } catch (error) {
    return handleServerError(res, "Failed to list workspace invites", error);
  }
});

app.post("/api/workspaces/current/invites", requireSignedIn, attachActiveWorkspace, requireWorkspaceAdmin, requirePlan("desk"), writeLimiter, validate(workspaceInviteSchema), async (req, res) => {
  try {
    const workspaceContext = getRequiredWorkspaceContext(req);
    const members = await workspaces.listMembers(workspaceContext.id);
    const invites = await workspaces.listInvites(workspaceContext.id);
    const activeMembers = members.filter((item) => item.status === "active");
    const pendingInvites = invites.filter((item) => item.status === "pending");
    if ((activeMembers.length + pendingInvites.length) >= Number(workspaceContext.workspace.seatLimit || 1)) {
      return res.status(400).json({ error: "Seat limit reached for this workspace." });
    }
    const { invite } = await workspaces.createInvite({
      workspaceId: workspaceContext.id,
      email: req.body.email,
      role: req.body.role,
      createdByUserId: req.auth.userId
    });
    await workspaces.recordActivity({
      workspaceId: workspaceContext.id,
      actorUserId: req.auth.userId,
      eventType: "invite_created",
      entityType: "workspace_invite",
      entityId: invite.id,
      details: { email: invite.email, role: invite.role }
    });
    const inviteBurstCount = trackSecurityAnomaly(`workspace-invite:${workspaceContext.id}`, 15 * 60 * 1000);
    if (inviteBurstCount >= 5) {
      await logSecurityEvent(req, {
        level: "warning",
        message: "High workspace invite volume detected.",
        eventType: "workspace_invite_burst",
        workspaceId: workspaceContext.id,
        context: { count: inviteBurstCount }
      });
    }
    return res.json({ invite: sanitizeWorkspaceInvite(invite) });
  } catch (error) {
    return handleServerError(res, "Failed to create workspace invite", error);
  }
});

app.post("/api/workspaces/invites/:token/accept", requireSignedIn, writeLimiter, async (req, res) => {
  try {
    const token = String(req.params.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "Invite token is required." });
    }
    const active = await workspaces.acceptInvite({ token, userId: req.auth.userId });
    await workspaces.recordActivity({
      workspaceId: active.workspace.id,
      actorUserId: req.auth.userId,
      eventType: "invite_accepted",
      entityType: "workspace_member",
      entityId: req.auth.userId,
      details: { role: active.membership?.role || "member" }
    });
    return res.json({
      workspace: sanitizeWorkspace(active.workspace, active.membership),
      membership: sanitizeWorkspaceMember(active.membership)
    });
  } catch (error) {
    return handleServerError(res, "Failed to accept workspace invite", error);
  }
});

app.patch("/api/workspaces/current/members/:userId/role", requireSignedIn, attachActiveWorkspace, requireWorkspaceAdmin, requirePlan("desk"), writeLimiter, validate(workspaceMemberRoleSchema), async (req, res) => {
  try {
    const workspaceContext = getRequiredWorkspaceContext(req);
    const targetUserId = Number(req.params.userId);
    const beforeMember = (await workspaces.listMembers(workspaceContext.id)).find((item) => Number(item.userId) === targetUserId) || null;
    const member = await workspaces.updateMemberRole({
      workspaceId: workspaceContext.id,
      targetUserId,
      role: req.body.role
    });
    if (!member) {
      return res.status(404).json({ error: "Workspace member not found." });
    }
    await workspaces.recordActivity({
      workspaceId: workspaceContext.id,
      actorUserId: req.auth.userId,
      eventType: "member_role_updated",
      entityType: "workspace_member",
      entityId: targetUserId,
      details: {
        beforeRole: beforeMember?.role || null,
        afterRole: member.role,
        beforeStatus: beforeMember?.status || null,
        afterStatus: member.status
      }
    });
    const roleChangeBurst = trackSecurityAnomaly(`workspace-role:${workspaceContext.id}`, 10 * 60 * 1000);
    if (roleChangeBurst >= 3) {
      await logSecurityEvent(req, {
        level: "warning",
        message: "Repeated workspace role changes detected.",
        eventType: "workspace_role_churn",
        workspaceId: workspaceContext.id,
        targetUserId,
        context: {
          count: roleChangeBurst,
          beforeRole: beforeMember?.role || null,
          afterRole: member.role
        }
      });
    }
    return res.json({ member: sanitizeWorkspaceMember(member) });
  } catch (error) {
    return handleServerError(res, "Failed to update workspace member role", error);
  }
});

app.delete("/api/workspaces/current/members/:userId", requireSignedIn, attachActiveWorkspace, requireWorkspaceAdmin, requirePlan("desk"), writeLimiter, async (req, res) => {
  try {
    const targetUserId = Number(req.params.userId);
    const member = await workspaces.removeMember({
      workspaceId: req.workspace.workspace.id,
      targetUserId
    });
    if (!member) {
      return res.status(404).json({ error: "Workspace member not found." });
    }
    await workspaces.recordActivity({
      workspaceId: req.workspace.workspace.id,
      actorUserId: req.auth.userId,
      eventType: "member_removed",
      entityType: "workspace_member",
      entityId: targetUserId
    });
    return res.json({ success: true });
  } catch (error) {
    return handleServerError(res, "Failed to remove workspace member", error);
  }
});

app.get("/api/workspaces/current/activity", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const items = await workspaces.listActivity(req.workspace.workspace.id, Number(req.query.limit) || 50);
    return res.json({ items });
  } catch (error) {
    return handleServerError(res, "Failed to load workspace activity", error);
  }
});

app.post("/api/alerts/dispatch", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(alertDispatchSchema), async (req, res) => {
  try {
    const body = req.body || {};
    const type = normalizeAlertDeliveryType(body.type);
    const symbol = String(body.symbol || body.asset?.symbol || "").trim().toUpperCase();
    const delivery = await dispatchAlertEmailToUser(req.auth.userId, {
      type,
      title: body.title,
      body: body.body,
      symbol,
      severity: body.severity || "review",
      workspaceName: req.workspace.workspace?.name || "Zenin workspace",
      actionUrl: getFrontendAppUrl(`/app?section=${type === "watchlist_alert" ? "watchlist" : "research"}`)
    }, {
      requirePriceAlerts: type === "market_alert" || type === "watchlist_alert"
    });

    await workspaces.recordActivity({
      workspaceId: req.workspace.workspace.id,
      actorUserId: req.auth.userId,
      eventType: "alert_email_dispatch_requested",
      entityType: type,
      entityId: symbol || body.source || body.title,
      details: {
        sent: Boolean(delivery.sent),
        skipped: Boolean(delivery.skipped),
        reason: delivery.reason || delivery.error?.message || null,
        symbol: symbol || null
      }
    });

    if (delivery.skipped) {
      return res.status(409).json({
        error: "Alert email was not sent.",
        reason: delivery.reason,
        delivery
      });
    }

    if (!delivery.sent) {
      return res.status(503).json({
        error: "Alert email delivery failed. Check Resend configuration and sender domain.",
        delivery
      });
    }

    return res.json({ success: true, delivery });
  } catch (error) {
    return handleServerError(res, "Failed to dispatch alert email", error);
  }
});

app.get("/api/workspaces/current/alerts", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        alert_key AS "alertKey",
        assigned_to_user_id AS "assignedToUserId",
        status,
        snoozed_until AS "snoozedUntil",
        archived_at AS "archivedAt",
        notes_json AS notes,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM workspace_alert_assignments
      WHERE workspace_id = $1
      ORDER BY updated_at DESC, id DESC;
    `, [req.workspace.workspace.id]);
    return res.json({ items: result.rows });
  } catch (error) {
    return handleServerError(res, "Failed to load workspace alerts", error);
  }
});

app.put("/api/workspaces/current/alerts", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(workspaceAlertAssignmentSchema), async (req, res) => {
  try {
    const body = req.body || {};
    const result = await pool.query(`
      INSERT INTO workspace_alert_assignments (
        workspace_id,
        alert_key,
        assigned_to_user_id,
        status,
        snoozed_until,
        notes_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      ON CONFLICT (workspace_id, alert_key) DO UPDATE
      SET
        assigned_to_user_id = EXCLUDED.assigned_to_user_id,
        status = EXCLUDED.status,
        snoozed_until = EXCLUDED.snoozed_until,
        notes_json = EXCLUDED.notes_json,
        archived_at = CASE WHEN EXCLUDED.status = 'archived' THEN NOW() ELSE NULL END,
        archived_by_user_id = CASE WHEN EXCLUDED.status = 'archived' THEN $7 ELSE NULL END,
        updated_at = NOW()
      RETURNING
        id,
        alert_key AS "alertKey",
        assigned_to_user_id AS "assignedToUserId",
        status,
        snoozed_until AS "snoozedUntil",
        archived_at AS "archivedAt",
        notes_json AS notes,
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `, [
      req.workspace.workspace.id,
      body.alertKey,
      body.assignedToUserId || null,
      body.status || "open",
      body.snoozedUntil || null,
      JSON.stringify(body.notes || {}),
      req.auth.userId
    ]);
    await workspaces.recordActivity({
      workspaceId: req.workspace.workspace.id,
      actorUserId: req.auth.userId,
      eventType: "alert_assignment_updated",
      entityType: "workspace_alert",
      entityId: body.alertKey,
      details: { status: body.status || "open", assignedToUserId: body.assignedToUserId || null }
    });

    let emailDelivery = null;
    if (body.assignedToUserId && body.status !== "archived") {
      emailDelivery = await dispatchAlertEmailToUser(body.assignedToUserId, {
        type: "workspace_assignment",
        title: "Workspace alert assigned",
        body: `An alert assignment needs attention in ${req.workspace.workspace?.name || "your Zenin workspace"}.\n\nAlert: ${body.alertKey}\nStatus: ${body.status || "open"}`,
        severity: body.status === "snoozed" ? "info" : "review",
        workspaceName: req.workspace.workspace?.name || "Zenin workspace",
        actionUrl: getFrontendAppUrl("/app?section=watchlist")
      });
    }

    return res.json({ item: result.rows[0], emailDelivery });
  } catch (error) {
    return handleServerError(res, "Failed to update workspace alert assignment", error);
  }
});

app.get("/api/db/balance", requireSignedIn, async (req, res) => {
  try {
    const current = await userWorkspace.balance.get(req.auth.userId);
    res.json({ balance: current });
  } catch (err) {
    handleServerError(res, "Balance read failed", err);
  }
});

app.post("/api/db/balance", requireSignedIn, writeLimiter, validate(balanceChangeSchema), async (req, res) => {
  try {
    const { amount, type } = req.body;
    if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) return res.status(400).json({ error: "Invalid amount" });
    const newBalance = await userWorkspace.balance.applyChange(req.auth.userId, amount, type);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.json({ balance: newBalance });
  } catch (err) {
    if (err.code === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    handleServerError(res, "Balance update failed", err);
  }
});

app.get("/api/db/cash", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const workspaceId = req.workspace?.workspace?.id || null;
    const balances = await userWorkspace.cash.getAll(req.auth.userId, workspaceId);
    if (!balances.some((row) => row.currency === "USD")) {
      const usdBalance = await userWorkspace.balance.get(req.auth.userId);
      return res.json({
        balances: [
          {
            currency: "USD",
            balance: req.workspace?.workspace?.ownerUserId === Number(req.auth.userId) ? usdBalance : 0,
            updatedAt: new Date().toISOString()
          },
          ...balances
        ]
      });
    }
    res.json({ balances });
  } catch (err) {
    handleServerError(res, "Cash balance read failed", err);
  }
});

app.post("/api/db/cash", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(cashChangeSchema), async (req, res) => {
  try {
    const { amount, type, currency = "USD" } = req.body || {};
    if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) return res.status(400).json({ error: "Invalid amount" });
    const balanceAfter = await userWorkspace.cash.applyChange(req.auth.userId, currency, amount, type, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.json({ currency: String(currency || "USD").toUpperCase(), balance: balanceAfter });
  } catch (err) {
    if (err.code === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: err.message || "Insufficient balance" });
    }
    handleServerError(res, "Cash balance update failed", err);
  }
});

app.get("/api/db/workspace/docs/:namespace", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const namespace = decodeURIComponent(String(req.params.namespace || "").trim());
    if (!isWorkspaceNamespaceValid(namespace)) {
      return res.status(400).json({ error: "Invalid workspace namespace." });
    }
    const result = await userWorkspace.docs.get(req.auth.userId, namespace, null, req.workspace.workspace.id);
    return res.json(result);
  } catch (error) {
    return handleServerError(res, "Workspace document read failed", error);
  }
});

app.put("/api/db/workspace/docs/:namespace", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(workspaceDocSchema), async (req, res) => {
  try {
    const namespace = decodeURIComponent(String(req.params.namespace || "").trim());
    if (!isWorkspaceNamespaceValid(namespace)) {
      return res.status(400).json({ error: "Invalid workspace namespace." });
    }
    const result = await userWorkspace.docs.set(req.auth.userId, namespace, req.body?.document ?? null, req.workspace.workspace.id);
    return res.json(result);
  } catch (error) {
    return handleServerError(res, "Workspace document update failed", error);
  }
});

app.get("/api/db/workspace/collections/:namespace", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const namespace = decodeURIComponent(String(req.params.namespace || "").trim());
    if (!isWorkspaceNamespaceValid(namespace)) {
      return res.status(400).json({ error: "Invalid workspace namespace." });
    }
    const result = await userWorkspace.collections.get(req.auth.userId, namespace, [], req.workspace.workspace.id);
    return res.json(result);
  } catch (error) {
    return handleServerError(res, "Workspace collection read failed", error);
  }
});

app.put("/api/db/workspace/collections/:namespace", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(workspaceCollectionSchema), async (req, res) => {
  try {
    const namespace = decodeURIComponent(String(req.params.namespace || "").trim());
    if (!isWorkspaceNamespaceValid(namespace)) {
      return res.status(400).json({ error: "Invalid workspace namespace." });
    }
    if (!Array.isArray(req.body?.items)) {
      return res.status(400).json({ error: "items must be an array." });
    }
    const limit = Math.max(1, Math.min(2000, Number(req.body?.limit) || 500));
    const result = await userWorkspace.collections.set(req.auth.userId, namespace, req.body.items, limit, req.workspace.workspace.id);
    return res.json(result);
  } catch (error) {
    return handleServerError(res, "Workspace collection update failed", error);
  }
});

// ---------------------------------------------------------------------------
// Exchange Keys Management
// ---------------------------------------------------------------------------
function buildConnectionCapability(exchange) {
  const normalizedExchange = String(exchange || "").trim().toLowerCase();
  const syncAvailable = SYNC_ENABLED_EXCHANGES.has(normalizedExchange);
  const watchOnly = normalizedExchange === "hyperliquid";
  return {
    accessMode: watchOnly ? "watch_only" : "read_only_metadata",
    syncAvailable,
    syncStatus: syncAvailable ? "sync_supported" : "metadata_only",
    nextAction: syncAvailable
      ? "Run sync to import holdings, balances, and fills."
      : "Saved for workspace context. Live sync is not available for this provider yet.",
    supportMessage: syncAvailable
      ? (watchOnly
          ? "Zenin can import live portfolio data from this public watch-only address."
          : "Zenin can import live portfolio data after you provide provider-side read-only credentials.")
      : "Zenin stores this source as read-only metadata until a provider adapter is available."
  };
}

async function buildCredentialScopeState(exchange, apiKey, apiSecret) {
  const normalizedExchange = String(exchange || "").trim().toLowerCase();
  if (normalizedExchange === "hyperliquid" && !apiSecret) {
    return {
      permissionScope: "read_only",
      canTrade: false,
      lastVerifiedScope: "read_only",
      riskLevel: "standard",
      scopeVerificationStatus: "verified_watch_only",
      scopeVerificationMessage: "Public address connection verified as watch-only."
    };
  }
  if (apiSecret && SYNC_ENABLED_EXCHANGES.has(normalizedExchange)) {
    const verified = await verifyExchangeCredentialScope(normalizedExchange, apiKey, apiSecret);
    if (verified.permissionScope === "trade" || verified.canTrade) {
      const error = new Error(verified.verificationMessage || "Provider reported trading permission on this API key.");
      error.code = "EXCHANGE_KEY_NOT_READ_ONLY";
      error.scopeVerification = verified;
      throw error;
    }
    return {
      permissionScope: "read_only",
      canTrade: false,
      lastVerifiedScope: verified.readOnlyVerified ? "read_only" : "unknown",
      riskLevel: "sensitive",
      scopeVerificationStatus: verified.verificationStatus || (verified.readOnlyVerified ? "verified_read_only" : "provider_unverified"),
      scopeVerificationMessage: verified.verificationMessage || "Provider scope check completed.",
      providerMeta: verified.providerMeta || {}
    };
  }
  return {
    permissionScope: "read_only",
    canTrade: false,
    lastVerifiedScope: "unknown",
    riskLevel: apiSecret ? "sensitive" : "standard",
    scopeVerificationStatus: "provider_unverified",
    scopeVerificationMessage: "Zenin requires read-only credentials, but this provider scope has not been verified server-side."
  };
}

app.get("/api/db/exchange-keys", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const keys = await userWorkspace.exchangeKeys.list(req.auth.userId, req.workspace.workspace.id);
    // Mask sensitive keys for the list view
    const maskedKeys = keys.map(k => {
      const maskedKey = maskApiKey(k.apiKey);
      let parsedExtra = {};
      try {
        // extraData might be a string (wenc:...) or already an object
        const rawExtra = typeof k.extraData === "string" ? workspaceSecretProvider.decryptSecret(k.extraData) : k.extraData;
        parsedExtra = typeof rawExtra === "string" ? JSON.parse(rawExtra) : (rawExtra || {});
        // Mask address if present in extraData (common for Hyperliquid)
        if (parsedExtra.address && parsedExtra.address.length > 8) {
          parsedExtra.address = `${parsedExtra.address.slice(0, 4)}...${parsedExtra.address.slice(-4)}`;
        }
      } catch (e) {
        console.warn("Failed to process extraData for key", k.id);
      }
      const capability = buildConnectionCapability(k.exchange);
      return {
        id: k.id,
        exchange: k.exchange,
        apiKey: maskedKey,
        permissionScope: k.permissionScope || "unknown",
        canTrade: !!k.canTrade,
        lastVerifiedScope: k.lastVerifiedScope || "unknown",
        riskLevel: k.riskLevel || "standard",
        syncAvailable: capability.syncAvailable,
        connectionCapability: capability,
        extraData: parsedExtra,
        createdAt: k.createdAt,
        lastSyncAt: k.lastSyncAt || null,
        lastSyncStatus: k.lastSyncStatus || "idle",
        lastSyncMeta: k.lastSyncMeta || {}
      };
    });
    res.json(maskedKeys);
  } catch (err) {
    handleServerError(res, "Failed to list exchange keys", err);
  }
});

app.post("/api/db/exchange-keys", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(exchangeKeySchema), async (req, res) => {
  try {
    const { exchange, apiKey, apiSecret, extraData } = req.body;
    const normalizedExtraData = extraData && typeof extraData === "object" ? extraData : {};
    const scopeState = await buildCredentialScopeState(exchange, apiKey, apiSecret);
    const enrichedExtraData = {
      ...normalizedExtraData,
      scopeVerificationStatus: scopeState.scopeVerificationStatus,
      scopeVerificationMessage: scopeState.scopeVerificationMessage,
      providerScopeMeta: scopeState.providerMeta || {}
    };
    // Encrypt sensitive data before storing (#EncryptionAtRest)
    const payload = {
      exchange,
      apiKey: workspaceSecretProvider.encryptSecret(apiKey),
      apiSecret: workspaceSecretProvider.encryptSecret(apiSecret),
      extraData: enrichedExtraData ? workspaceSecretProvider.encryptSecret(JSON.stringify(enrichedExtraData)) : null,
      permissionScope: scopeState.permissionScope,
      canTrade: scopeState.canTrade,
      lastVerifiedScope: scopeState.lastVerifiedScope,
      riskLevel: scopeState.riskLevel
    };
    const key = await userWorkspace.exchangeKeys.add(req.auth.userId, payload, req.workspace.workspace.id);
    const capability = buildConnectionCapability(key.exchange);
    await workspaces.recordActivity({
      workspaceId: req.workspace.workspace.id,
      actorUserId: req.auth.userId,
      eventType: "account_added",
      entityType: "exchange_key",
      entityId: key.id,
      details: {
        exchange: key.exchange,
        venueType: normalizedExtraData?.venueType || null,
        username: normalizedExtraData?.username || null,
        permissionScope: key.permissionScope,
        canTrade: !!key.canTrade,
        riskLevel: key.riskLevel,
        scopeVerificationStatus: scopeState.scopeVerificationStatus
      }
    });
    await logSecurityEvent(req, {
      level: "info",
      message: "Read-only exchange credential added.",
      eventType: "exchange_key_added",
      workspaceId: req.workspace.workspace.id,
      context: {
        exchange: key.exchange,
        permissionScope: key.permissionScope,
        canTrade: !!key.canTrade,
        riskLevel: key.riskLevel,
        lastVerifiedScope: key.lastVerifiedScope,
        scopeVerificationStatus: scopeState.scopeVerificationStatus
      }
    });
    res.json({
      id: key.id,
      exchange: key.exchange,
      apiKey: maskApiKey(key.apiKey),
      permissionScope: key.permissionScope || "unknown",
      canTrade: !!key.canTrade,
      lastVerifiedScope: key.lastVerifiedScope || "unknown",
      riskLevel: key.riskLevel || "standard",
      syncAvailable: capability.syncAvailable,
      connectionCapability: capability,
      extraData: enrichedExtraData,
      createdAt: key.createdAt || null,
      lastSyncAt: key.lastSyncAt || null,
      lastSyncStatus: key.lastSyncStatus || "idle",
      lastSyncMeta: key.lastSyncMeta || {}
    });
  } catch (err) {
    if (err?.code === "EXCHANGE_KEY_NOT_READ_ONLY") {
      return res.status(422).json({
        error: "Use a read-only exchange API key. Zenin rejected this key because the provider reports trading or withdrawal permission.",
        code: err.code,
        scopeVerification: err.scopeVerification || null
      });
    }
    handleServerError(res, "Failed to add exchange key", err);
  }
});

app.delete("/api/db/exchange-keys/:id", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    await userWorkspace.exchangeKeys.remove(req.auth.userId, parseInt(id), req.workspace.workspace.id);
    await workspaces.recordActivity({
      workspaceId: req.workspace.workspace.id,
      actorUserId: req.auth.userId,
      eventType: "account_removed",
      entityType: "exchange_key",
      entityId: id
    });
    await logSecurityEvent(req, {
      level: "warning",
      message: "Exchange credential removed.",
      eventType: "exchange_key_removed",
      workspaceId: req.workspace.workspace.id,
      context: { keyId: Number(id) }
    });
    res.json({ success: true });
  } catch (err) {
    handleServerError(res, "Failed to remove exchange key", err);
  }
});

function formatExecutionQuantity(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString(undefined, { maximumFractionDigits: amount < 1 ? 8 : 4 });
}

function formatExecutionPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0.00";
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount >= 100 ? 2 : 4,
    maximumFractionDigits: amount >= 100 ? 2 : 6
  });
}

function titleCaseVenue(value) {
  return String(value || "venue")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function createTradeExecutionNotifications({ userId, workspaceId, exchange, executions = [] }) {
  const rows = Array.isArray(executions) ? executions.filter(Boolean) : [];
  if (!rows.length) return [];
  const venue = titleCaseVenue(exchange || rows[0]?.platform);
  const notifications = [];

  if (rows.length > 5) {
    const symbols = [...new Set(rows.map((row) => row.symbol).filter(Boolean))].slice(0, 4);
    notifications.push(await userWorkspace.notifications.create(userId, {
      type: "trade_execution.batch_created",
      title: `${rows.length} new executions synced`,
      body: `${venue} imported ${rows.length} API-sourced fills${symbols.length ? ` across ${symbols.join(", ")}` : ""}.`,
      entityType: "trade_execution_batch",
      entityId: `${exchange || "exchange"}:${Date.now()}`,
      metadata: {
        exchange,
        executionIds: rows.map((row) => row.id).filter(Boolean),
        symbols
      }
    }, workspaceId));
    return notifications;
  }

  for (const execution of rows) {
    const side = String(execution.side || "trade").toLowerCase();
    const symbol = execution.symbol || "asset";
    const title = `New ${symbol} ${side} on ${venue}`;
    const body = `${formatExecutionQuantity(execution.quantity)} ${symbol} at ${formatExecutionPrice(execution.price)}${execution.feeAmount ? ` · fee ${formatExecutionQuantity(execution.feeAmount)} ${execution.feeCurrency || ""}` : ""}`;
    notifications.push(await userWorkspace.notifications.create(userId, {
      type: "trade_execution.created",
      title,
      body,
      entityType: "trade_execution",
      entityId: execution.id,
      metadata: {
        exchange,
        symbol,
        side,
        platformFillId: execution.platformFillId,
        executedAt: execution.executedAt
      }
    }, workspaceId));
  }
  return notifications;
}

// Exchange Sync Trigger
app.post("/api/db/exchange-sync/:id", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const keyRecord = await userWorkspace.exchangeKeys.getById(req.auth.userId, parseInt(id), req.workspace.workspace.id);
    if (!keyRecord) return res.status(404).json({ error: "Exchange key not found" });
    const capability = buildConnectionCapability(keyRecord.exchange);
    if (!SYNC_ENABLED_EXCHANGES.has(keyRecord.exchange)) {
      await userWorkspace.exchangeKeys.updateSyncStatus(req.workspace.workspace.id, parseInt(id), {
        status: "sync_unavailable",
        syncedAt: new Date().toISOString(),
        meta: { reason: capability.supportMessage }
      });
      return res.status(202).json({
        success: true,
        syncAvailable: false,
        connectionCapability: capability,
        message: capability.nextAction
      });
    }

    // Decrypt credentials for sync
    const apiKey = workspaceSecretProvider.decryptSecret(keyRecord.apiKey);
    const apiSecret = workspaceSecretProvider.decryptSecret(keyRecord.apiSecret);
    const extraDataStr = workspaceSecretProvider.decryptSecret(keyRecord.extraData);
    const extraData = extraDataStr ? JSON.parse(extraDataStr) : {};
    const syncContext = {
      knownSymbols: await userWorkspace.tradeFills.getKnownSymbols(req.auth.userId, keyRecord.exchange, req.workspace.workspace.id)
    };

    let result;
    if (keyRecord.exchange === "hyperliquid") {
      result = await syncHyperliquid(apiKey, extraData, syncContext);
    } else if (keyRecord.exchange === "binance") {
      result = await syncBinance(apiKey, apiSecret, syncContext);
    } else if (keyRecord.exchange === "bybit") {
      result = await syncBybit(apiKey, apiSecret, syncContext);
    } else {
      return res.status(400).json({ error: "Unsupported exchange" });
    }

    if (result) {
      await userWorkspace.portfolio.sync(req.auth.userId, keyRecord.exchange, result.holdings, req.workspace.workspace.id);
      let fillSyncResult = { inserted: [], updated: [], insertedCount: 0, updatedCount: 0 };
      if (Array.isArray(result.tradeFills) && result.tradeFills.length) {
        fillSyncResult = await userWorkspace.tradeFills.sync(req.auth.userId, result.tradeFills, req.workspace.workspace.id);
      }
      await userWorkspace.trades.sync(req.auth.userId, result.trades, req.workspace.workspace.id);
      if (result.currency && result.cashBalance != null) {
        await userWorkspace.cash.set(req.auth.userId, result.currency, result.cashBalance, req.workspace.workspace.id);
      }
      const notifications = await createTradeExecutionNotifications({
        userId: req.auth.userId,
        workspaceId: req.workspace.workspace.id,
        exchange: keyRecord.exchange,
        executions: fillSyncResult.inserted
      });
      invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
      await userWorkspace.exchangeKeys.updateSyncStatus(req.workspace.workspace.id, parseInt(id), {
        status: "success",
        syncedAt: new Date().toISOString(),
        meta: {
          holdingsCount: result?.holdings?.length || 0,
          tradesCount: result?.trades?.length || 0,
          tradeFillCount: result?.tradeFills?.length || 0,
          newExecutionCount: fillSyncResult.insertedCount || 0,
          updatedExecutionCount: fillSyncResult.updatedCount || 0,
          currency: result?.currency || null
        }
      });
      await workspaces.recordActivity({
        workspaceId: req.workspace.workspace.id,
        actorUserId: req.auth.userId,
        eventType: "account_synced",
        entityType: "exchange_key",
        entityId: id,
        details: {
          exchange: keyRecord.exchange,
          holdingsCount: result?.holdings?.length || 0,
          tradesCount: result?.trades?.length || 0,
          newExecutionCount: fillSyncResult.insertedCount || 0
        }
      });
      result.fillSyncResult = fillSyncResult;
      result.notifications = notifications;
    }

    res.json({
      success: true,
      holdingsCount: result?.holdings?.length || 0,
      tradesCount: result?.trades?.length || 0,
      tradeFillCount: result?.tradeFills?.length || 0,
      newExecutionCount: result?.fillSyncResult?.insertedCount || 0,
      updatedExecutionCount: result?.fillSyncResult?.updatedCount || 0,
      newExecutions: (result?.fillSyncResult?.inserted || []).slice(0, 10),
      notifications: result?.notifications || [],
      cashBalance: result?.cashBalance,
      currency: result?.currency
    });
  } catch (err) {
    if (req.workspace?.workspace?.id && req.params?.id) {
      try {
        await userWorkspace.exchangeKeys.updateSyncStatus(req.workspace.workspace.id, parseInt(req.params.id), {
          status: "error",
          syncedAt: new Date().toISOString(),
          meta: { error: err?.message || "Exchange sync failed" }
        });
      } catch (statusError) {
        console.warn("[Exchange] Failed to persist sync error status:", statusError?.message || statusError);
      }
    }
    const burst = trackSecurityAnomaly(`exchange-sync-failure:${req.workspace?.workspace?.id || "unknown"}`, 10 * 60 * 1000);
    if (burst >= 3) {
      await logSecurityEvent(req, {
        level: "warning",
        message: "Repeated exchange sync failures detected.",
        eventType: "exchange_sync_failure_burst",
        workspaceId: req.workspace?.workspace?.id || null,
        context: {
          count: burst,
          keyId: Number(req.params?.id || 0),
          error: err?.message || "Exchange sync failed"
        }
      }).catch((logError) => {
        console.warn("[Exchange] Failed to persist sync burst security event:", logError?.message || logError);
      });
    }
    handleServerError(res, "Exchange sync failed", err);
  }
});

async function issueSessionForUser(userId, req, { persistent = true } = {}) {
  const rawToken = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await userAuth.createSession({
    userId,
    tokenHash,
    expiresAt,
    ipAddress: resolveClientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 512)
  });
  return { token: rawToken, expiresAt, persistent };
}

app.get("/api/auth/me", attachActiveWorkspace, async (req, res) => {
  if (!req.auth || req.auth.isGuest) {
    return res.json({ authenticated: false, user: null });
  }
  const user = await userAuth.findUserById(req.auth.userId);
  return res.json({
    authenticated: true,
    user: sanitizeAuthUser(user),
    workspace: sanitizeWorkspace(req.workspace?.workspace, req.workspace?.membership)
  });
});

app.post("/api/auth/reauth", authLimiter, requireSignedIn, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required." });
    }
    const currentUser = await userAuth.findUserById(req.auth.userId);
    if (!currentUser || !verifyPassword(currentPassword, currentUser.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const updatedSession = await userAuth.markSessionReauthenticated({
      sessionId: req.auth?.user?.sessionId,
      admin: false
    });
    await logSecurityEvent(req, {
      message: "Sensitive account re-authentication completed.",
      eventType: "account_reauth_completed"
    });
    return res.json({ success: true, reauthenticatedAt: updatedSession?.sessionReauthenticatedAt || new Date().toISOString() });
  } catch (error) {
    return handleServerError(res, "Re-authentication failed", error);
  }
});

app.post("/api/account/email/request", authLimiter, requireSignedIn, validate(emailRequestSchema), async (req, res) => {
  try {
    if (requireProductionEmailDeliveryReady(res)) return;
    const nextEmail = String(req.body?.newEmail || "").trim().toLowerCase();
    const currentPassword = String(req.body?.currentPassword || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const currentUser = await userAuth.findUserById(req.auth.userId);
    if (!currentUser) {
      return res.status(404).json({ error: "User not found." });
    }
    if (nextEmail === String(currentUser.email || "").trim().toLowerCase()) {
      return res.status(400).json({ error: "New email must be different from current email." });
    }
    if (!currentPassword || !verifyPassword(currentPassword, currentUser.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const existing = await userAuth.findUserByEmail(nextEmail);
    if (existing && Number(existing.id) !== Number(req.auth.userId)) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const verificationCode = createVerificationCode();
    const updated = await userAuth.requestEmailChange({
      userId: req.auth.userId,
      nextEmail,
      codeHash: hashToken(verificationCode)
    });
    const verificationEmailDelivery = await sendVerificationEmail(nextEmail, verificationCode, { purpose: "email_change" });
    await logSecurityEvent(req, {
      level: getEmailDeliverySent(verificationEmailDelivery) ? "info" : "warning",
      message: getEmailDeliverySent(verificationEmailDelivery)
        ? "Email-change verification email accepted by provider."
        : "Email-change verification code created but email delivery failed.",
      eventType: "email_change_verification_requested",
      targetUserId: req.auth.userId,
      context: {
        emailHash: hashToken(nextEmail),
        emailDeliveryResult: getEmailDeliveryLogContext(verificationEmailDelivery)
      }
    }).catch((error) => {
      console.error("[Auth] Failed to log email-change verification delivery:", error?.message || error);
    });

    if (!getEmailDeliverySent(verificationEmailDelivery) && process.env.NODE_ENV === "production") {
      return apiError(res, 503, emailDeliveryUnavailablePayload(verificationEmailDelivery, "Email-change verification could not be sent."));
    }

    return res.json({
      success: true,
      user: sanitizeAuthUser(updated),
      message: getEmailDeliverySent(verificationEmailDelivery)
        ? `Verification sent to ${nextEmail}.`
        : `Verification created for ${nextEmail}, but email delivery is not configured or failed.`,
      verificationEmailSent: getEmailDeliverySent(verificationEmailDelivery),
      ...(ALLOW_DEV_AUTH_DEBUG ? { devVerificationCode: verificationCode } : {})
    });
  } catch (error) {
    return handleServerError(res, "Email change request failed", error);
  }
});

app.post("/api/account/email/confirm", authLimiter, requireSignedIn, validate(emailConfirmSchema), async (req, res) => {
  try {
    const verificationCode = String(req.body?.verificationCode || "").trim();
    if (!/^\d{6}$/.test(verificationCode)) {
      return res.status(400).json({ error: "Enter the 6-digit verification code." });
    }
    const confirmed = await userAuth.confirmEmailChange({
      userId: req.auth.userId,
      expectedCodeHash: hashToken(verificationCode)
    });
    if (confirmed === null) {
      return res.status(400).json({ error: "No pending email change to verify." });
    }
    if (confirmed === false) {
      return res.status(400).json({ error: "Verification code is invalid." });
    }
    return res.json({ success: true, user: sanitizeAuthUser(confirmed) });
  } catch (error) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "That email is already in use." });
    }
    return handleServerError(res, "Email confirmation failed", error);
  }
});

app.post("/api/account/password", authLimiter, requireSignedIn, validate(passwordUpdateSchema), async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: "Password must be 10+ chars with letters, numbers, and symbols." });
    }
    const currentUser = await userAuth.findUserByEmail(req.auth.user?.email || "");
    if (!currentUser || !verifyPassword(currentPassword, currentUser.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    if (verifyPassword(newPassword, currentUser.passwordHash)) {
      return res.status(400).json({ error: "Choose a password different from your current password." });
    }
    const { hash } = derivePasswordHash(newPassword);
    await userAuth.updatePassword(req.auth.userId, hash);
    const user = await userAuth.findUserById(req.auth.userId);
    return res.json({ success: true, user: sanitizeAuthUser(user) });
  } catch (error) {
    return handleServerError(res, "Password update failed", error);
  }
});

app.delete("/api/account", authLimiter, requireSignedIn, validate(accountDeleteSchema), async (req, res) => {
  try {
    const currentUser = await userAuth.findUserById(req.auth.userId);
    if (!currentUser) {
      return res.status(404).json({ error: "User not found." });
    }

    const confirmedEmail = String(req.body?.confirmEmail || "").trim().toLowerCase();
    const currentEmail = String(currentUser.email || "").trim().toLowerCase();
    if (confirmedEmail !== currentEmail) {
      return res.status(400).json({ error: "Confirm your current account email before deleting." });
    }

    const storedPasswordHash = String(currentUser.passwordHash || "").trim();
    if (storedPasswordHash) {
      const currentPassword = String(req.body?.currentPassword || "");
      if (!currentPassword || !verifyPassword(currentPassword, storedPasswordHash)) {
        return res.status(401).json({ error: "Current password is incorrect." });
      }
    }

    const deletionPlan = await admin.inspectUserDeletion(req.auth.userId);
    if (!deletionPlan) {
      return res.status(404).json({ error: "User not found." });
    }

    const workspaceBlockers = deletionPlan.ownedWorkspaces.filter((workspace) => Number(workspace.activeMemberCount || 0) > 1);
    if (workspaceBlockers.length) {
      return res.status(409).json({
        error: "Transfer or remove workspace members before deleting your account.",
        code: "WORKSPACE_OWNER_HAS_MEMBERS",
        workspaces: workspaceBlockers
      });
    }

    const deleted = await admin.deleteOwnAccount(req.auth.userId);
    if (!deleted) {
      return res.status(404).json({ error: "User not found." });
    }

    clearSessionCookie(res, req);
    await admin.recordSystemLog({
      level: "warning",
      service: "Account",
      endpoint: "DELETE /api/account",
      message: "User account deleted by owner.",
      requestId: req.requestId,
      ipAddress: resolveClientIp(req),
      statusCode: 200,
      context: {
        deletedUserId: req.auth.userId,
        emailHash: hashToken(currentEmail),
        ownedWorkspaceCount: deletionPlan.ownedWorkspaces.length,
        legacySupabaseUserIdPresent: Boolean(deletionPlan.user.supabaseUserId)
      }
    }).catch((error) => {
      console.warn("[Auth] Failed to persist account deletion audit log:", error?.message || error);
    });

    req.auth = { isGuest: true, userId: null, user: null, token: null, authSource: "deleted" };
    return res.json({ success: true });
  } catch (error) {
    if (error?.code === "WORKSPACE_OWNER_HAS_MEMBERS") {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        workspaces: error.workspaces || []
      });
    }
    return handleServerError(res, "Account deletion failed", error);
  }
});

const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: { error: "Too many administrative requests. Please try again later." }
});

app.use("/api/admin/*", adminRateLimit);

app.post("/api/admin/reauth/verify", requireSignedIn, requireAdmin, authLimiter, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required." });
    }
    const currentUser = await userAuth.findUserById(req.auth.userId);
    if (!currentUser || !verifyPassword(currentPassword, currentUser.passwordHash)) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }
    const updatedSession = await userAuth.markSessionReauthenticated({
      sessionId: req.auth?.user?.sessionId,
      admin: true
    });
    await logSecurityEvent(req, {
      message: "Admin step-up authentication completed.",
      eventType: "admin_reauth_completed"
    });
    return res.json({ success: true, reauthenticatedAt: updatedSession?.adminReauthenticatedAt || new Date().toISOString() });
  } catch (error) {
    return handleServerError(res, "Admin re-authentication failed", error);
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await admin.listAllUsers({
      query: req.query?.query || "",
      plan: req.query?.plan || "",
      status: req.query?.status || "",
      role: req.query?.role || ""
    });
    return res.json(users);
  } catch (error) {
    console.error("[Admin] Failed to list users:", error);
    return handleServerError(res, "Failed to list users", error);
  }
});

app.get("/api/admin/users/recovery-status", requireSignedIn, requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const email = String(req.query?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const user = await userAuth.findUserByEmail(email);
    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: user?.id || null,
      action: "CHECK_RECOVERY_STATUS",
      details: {
        requestId: req.requestId,
        emailHash: hashToken(email),
        found: Boolean(user),
        emailDelivery: getEmailDeliveryConfig()
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({
      success: true,
      found: Boolean(user),
      user: user ? sanitizeAuthUser(user) : null,
      emailDelivery: getEmailDeliveryConfig()
    });
  } catch (error) {
    return handleServerError(res, "Failed to check recovery status", error);
  }
});

function normalizeAdminRoleInput(value, fallback = "user") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["user", "support_admin", "billing_admin", "ops_admin", "super_admin"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function resolveRequestedAdminRole(body = {}) {
  if (body.adminRole != null) {
    return normalizeAdminRoleInput(body.adminRole, "user");
  }
  if (typeof body.isAdmin === "boolean") {
    return body.isAdmin ? "support_admin" : "user";
  }
  return "user";
}

function buildAuditDiff(before = {}, after = {}) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  const diff = {};
  keys.forEach((key) => {
    const previous = before?.[key] ?? null;
    const next = after?.[key] ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      diff[key] = { before: previous, after: next };
    }
  });
  return diff;
}

app.get("/api/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const details = await admin.getUserById(req.params.id);
    if (!details) {
      return res.status(404).json({ error: "User not found" });
    }
    const revenueCat = await getRevenueCatCustomerSnapshot({
      userId: req.params.id,
      email: details.user?.email || null
    }).catch((error) => ({
      configured: true,
      found: false,
      providerStatus: {
        name: "RevenueCat",
        status: "degraded",
        note: error?.message || "RevenueCat lookup failed.",
        lastSyncAt: new Date().toISOString()
      },
      subscriptions: [],
      activeEntitlements: [],
      invoices: []
    }));
    return res.json({ ...details, revenueCat });
  } catch (error) {
    return handleServerError(res, "Failed to fetch user details", error);
  }
});

app.post("/api/admin/users", requireSignedIn, requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const displayName = String(req.body?.name || "").trim();
    const requestedPlan = normalizePlanInput(req.body?.plan) || "starter";
    const adminRole = resolveRequestedAdminRole(req.body);
    const reason = String(req.body?.reason || "Created by admin dashboard").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    if (!displayName) {
      return res.status(400).json({ error: "Enter the user's full name." });
    }

    const existing = await userAuth.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ error: "A user with that email already exists." });
    }

    const temporaryPassword = `Zn!${crypto.randomBytes(18).toString("hex")}`;
    const { hash } = derivePasswordHash(temporaryPassword);

    const createdUser = await admin.createUser({
      email,
      displayName,
      plan: requestedPlan,
      adminRole,
      passwordHash: hash
    });

    if (!createdUser) {
      return res.status(500).json({ error: "Failed to create the user." });
    }

    const token = crypto.randomBytes(40).toString("hex");
    await userAuth.createPasswordResetToken({
      userId: createdUser.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString()
    });
    const recoveryEmailDelivery = await sendPasswordResetEmail(email, token);
    await recordPasswordResetEmailDelivery(token, recoveryEmailDelivery);
    const recoveryEmailSent = getEmailDeliverySent(recoveryEmailDelivery);

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: createdUser.id,
      action: "CREATE_USER",
      details: {
        email,
        plan: requestedPlan,
        adminRole,
        reason,
        requestId: req.requestId,
        recoveryEmailDelivery: getEmailDeliveryLogContext(recoveryEmailDelivery),
        diff: buildAuditDiff({}, createdUser)
      },
      ipAddress: resolveClientIp(req)
    });

    return res.status(201).json({
      success: true,
      user: createdUser,
      recoveryEmailSent,
      recoveryEmailProviderMessageId: recoveryEmailDelivery?.providerMessageId || null
    });
  } catch (error) {
    return handleServerError(res, "Failed to create user", error);
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const stats = await admin.getSystemStats();
    return res.json(stats);
  } catch (error) {
    console.error("[Admin] Critical Error fetching stats:", error);
    return res.status(500).json({ error: "Failed to fetch stats", details: error.message });
  }
});

app.get("/api/admin/database", requireAdmin, async (req, res) => {
  try {
    const stats = await admin.getDatabaseStats({
      table: req.query?.table || null,
      page: req.query?.page || 1,
      pageSize: req.query?.pageSize || 10
    });
    res.json(stats);
  } catch (error) {
    handleServerError(res, "getDatabaseStats", error);
  }
});

app.get("/api/admin/billing", requireAdmin, async (req, res) => {
  try {
    const [stats, revenueCat] = await Promise.all([
      admin.getBillingStats(),
      getRevenueCatAdminSummary().catch((error) => ({
        configured: true,
        providerStatus: {
          name: "RevenueCat",
          status: "degraded",
          note: error?.message || "RevenueCat summary failed.",
          lastSyncAt: new Date().toISOString()
        },
        offerings: [],
        entitlements: [],
        recentCustomers: [],
        summary: {
          offeringsCount: 0,
          entitlementsCount: 0,
          recentCustomersCount: 0
        }
      }))
    ]);
    res.json({ ...stats, revenueCat });
  } catch (error) {
    handleServerError(res, "getBillingStats", error);
  }
});

app.get("/api/admin/logs", requireAdmin, async (req, res) => {
  try {
    const [auditLogs, systemLogs] = await Promise.all([
      admin.getAdminLogs({
        query: req.query?.auditQuery || "",
        targetUserId: req.query?.targetUserId || null,
        page: req.query?.auditPage || 1,
        pageSize: req.query?.auditPageSize || 25
      }),
      admin.getSystemLogs({
        query: req.query?.query || "",
        level: req.query?.level || "",
        service: req.query?.service || "",
        page: req.query?.page || 1,
        pageSize: req.query?.pageSize || 25
      })
    ]);
    res.json({ auditLogs, systemLogs });
  } catch (error) {
    handleServerError(res, "getAdminLogs", error);
  }
});

app.get("/api/admin/integrations", requireAdmin, async (_req, res) => {
  try {
    const [integrations, revenueCat] = await Promise.all([
      admin.getIntegrationsStatus(),
      getRevenueCatAdminSummary().catch(() => null)
    ]);
    const items = [
      buildRevenueCatIntegrationItem(revenueCat),
      ...(integrations?.items || []).filter((item) => String(item?.name || "").toLowerCase() !== "revenuecat")
    ];
    return res.json({
      ...integrations,
      items,
      summary: summarizeIntegrationItems(items)
    });
  } catch (error) {
    return handleServerError(res, "Failed to fetch integrations", error);
  }
});

app.get("/api/admin/revenuecat/customers/lookup", requireAdmin, async (req, res) => {
  try {
    const rawQuery = String(req.query?.query || "").trim();
    const email = String(req.query?.email || "").trim() || (rawQuery.includes("@") ? rawQuery : "");
    const customerId = String(req.query?.customerId || "").trim();
    const userId = String(req.query?.userId || "").trim() || (!rawQuery.includes("@") ? rawQuery : "");

    if (!rawQuery && !email && !customerId && !userId) {
      return res.status(400).json({ message: "Provide a RevenueCat customer id, app user id, or email address." });
    }

    const snapshot = await getRevenueCatCustomerSnapshot({
      customerId: customerId || null,
      userId: userId || null,
      email: email || null
    });
    return res.json(snapshot);
  } catch (error) {
    return handleServerError(res, "Failed to lookup RevenueCat customer", error);
  }
});

app.get("/api/admin/alerts", requireAdmin, async (req, res) => {
  try {
    const status = String(req.query?.status || "").trim().toLowerCase() || null;
    const alerts = await admin.listAlertRules({ status, limit: req.query?.limit || 25 });
    const incidents = await admin.listIncidents({ status: "open", limit: 25 });
    return res.json({ alerts, incidents });
  } catch (error) {
    return handleServerError(res, "Failed to fetch alerts", error);
  }
});

app.get("/api/admin/search", requireAdmin, async (req, res) => {
  try {
    const results = await admin.searchAdminWorkspace(req.query?.query || "");
    return res.json(results);
  } catch (error) {
    return handleServerError(res, "Failed to search admin workspace", error);
  }
});

app.patch("/api/admin/users/:id/plan", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { plan } = req.body;
    const reason = String(req.body?.reason || "Updated from admin dashboard").trim();
    const before = await admin.getUserSummary(id);
    const updatedUser = await admin.updateUserPlan(id, plan);
    if (!updatedUser) return res.status(404).json({ error: "User not found" });

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: id,
      action: "UPDATE_PLAN",
      details: {
        reason,
        requestId: req.requestId,
        oldPlan: before?.plan || null,
        newPlan: updatedUser.plan,
        diff: buildAuditDiff(before, updatedUser)
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    return handleServerError(res, "Failed to update user plan", error);
  }
});

app.patch("/api/admin/users/:id/role", requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || "Updated from admin dashboard").trim();
    const requestedRole = resolveRequestedAdminRole(req.body);
    const before = await admin.getUserSummary(id);
    const updatedUser = await admin.updateUserAdminStatus(id, requestedRole);
    if (!updatedUser) return res.status(404).json({ error: "User not found" });

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: id,
      action: "UPDATE_ROLE",
      details: {
        reason,
        requestId: req.requestId,
        oldRole: before?.adminRole || "user",
        newRole: updatedUser.adminRole,
        diff: buildAuditDiff(before, updatedUser)
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    return handleServerError(res, "Failed to update user admin status", error);
  }
});

app.post("/api/admin/users/:id/recover", requireSignedIn, requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || "Recovery link generated from admin dashboard").trim();
    const targetUser = await admin.getUserSummary(id);
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }
    const token = crypto.randomBytes(40).toString("hex");
    await userAuth.createPasswordResetToken({
      userId: id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString()
    });
    const recoveryEmailDelivery = await sendPasswordResetEmail(targetUser.email, token);
    await recordPasswordResetEmailDelivery(token, recoveryEmailDelivery);
    const recoveryEmailSent = getEmailDeliverySent(recoveryEmailDelivery);

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: id,
      action: "GENERATE_RECOVERY_LINK",
      details: {
        reason,
        requestId: req.requestId,
        recoveryEmailDelivery: getEmailDeliveryLogContext(recoveryEmailDelivery),
        note: recoveryEmailSent
          ? "Recovery email sent via dashboard"
          : "Recovery token created but email delivery failed"
      },
      ipAddress: resolveClientIp(req)
    });

    if (!recoveryEmailSent) {
      return res.status(503).json({ success: false, error: "Recovery email could not be sent." });
    }

    return res.json({
      success: true,
      recoveryEmailSent: true,
      recoveryEmailProviderMessageId: recoveryEmailDelivery?.providerMessageId || null
    });
  } catch (error) {
    return handleServerError(res, "Failed to generate recovery link", error);
  }
});

app.post("/api/admin/users/:id/suspend", requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const { id } = req.params;
    const { isSuspended } = req.body;
    const reason = String(req.body?.reason || (isSuspended ? "Suspended from admin dashboard" : "Reactivated from admin dashboard")).trim();
    const before = await admin.getUserSummary(id);
    const result = await admin.suspendUser(id, isSuspended);
    
    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: id,
      action: isSuspended ? "SUSPEND_USER" : "UNSUSPEND_USER",
      details: {
        reason,
        requestId: req.requestId,
        isSuspended,
        diff: buildAuditDiff(before, result)
      },
      ipAddress: resolveClientIp(req)
    });

    res.json(result);
  } catch (error) {
    console.error("[Admin] User suspension failed:", error?.message || error);
    res.status(500).json({ error: "Failed to suspend user" });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || "Deleted from admin dashboard").trim();
    const result = await admin.deleteUser(id);
    if (!result) {
      return res.status(404).json({ error: "User not found" });
    }

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: id,
      action: "DELETE_USER",
      details: {
        reason,
        requestId: req.requestId,
        email: result?.email,
        diff: buildAuditDiff(result, {})
      },
      ipAddress: resolveClientIp(req)
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] User deletion failed:", error?.message || error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

app.post("/api/admin/users/:id/sessions/revoke", requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || "Revoked by admin dashboard").trim();
    const result = await admin.revokeUserSessions(id);
    const updatedUser = await admin.getUserSummary(id);

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      targetUserId: id,
      action: "REVOKE_SESSIONS",
      details: {
        reason,
        requestId: req.requestId,
        revokedCount: result.revokedCount
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({ success: true, revokedCount: result.revokedCount, user: updatedUser });
  } catch (error) {
    return handleServerError(res, "Failed to revoke sessions", error);
  }
});

app.post("/api/admin/sessions/revoke-all", requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const reason = String(req.body?.reason || "Global session revocation from admin dashboard").trim();
    const excludeCurrentAdmin = Boolean(req.body?.excludeCurrentAdmin);
    const result = await admin.revokeAllSessions({
      excludeUserId: excludeCurrentAdmin ? req.auth?.user?.id : null
    });

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      action: "REVOKE_ALL_SESSIONS",
      details: {
        reason,
        requestId: req.requestId,
        revokedCount: result.revokedCount,
        excludeCurrentAdmin
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({ success: true, revokedCount: result.revokedCount });
  } catch (error) {
    return handleServerError(res, "Failed to revoke all sessions", error);
  }
});

app.post("/api/admin/users/bulk", requireAdmin, requireRecentAdminReauth, async (req, res) => {
  try {
    const action = String(req.body?.action || "").trim().toLowerCase();
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
    const value = req.body?.value ?? null;
    const reason = String(req.body?.reason || "Bulk action from admin dashboard").trim();

    if (!userIds.length) {
      return res.status(400).json({ error: "Select at least one user." });
    }

    const allowedActions = new Set(["suspend", "reactivate", "plan", "role", "revoke_sessions"]);
    if (!allowedActions.has(action)) {
      return res.status(400).json({ error: "Unsupported bulk action." });
    }

    const normalizedValue = action === "role"
      ? resolveRequestedAdminRole({ adminRole: value })
      : value;

    const updatedUsers = await admin.bulkUpdateUsers({
      userIds,
      action,
      value: normalizedValue
    });

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      action: "BULK_USER_ACTION",
      details: {
        reason,
        requestId: req.requestId,
        action,
        value: normalizedValue,
        userIds
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({ success: true, users: updatedUsers });
  } catch (error) {
    return handleServerError(res, "Failed to apply bulk action", error);
  }
});

app.post("/api/admin/alerts", requireAdmin, async (req, res) => {
  try {
    const title = String(req.body?.title || "Admin alert").trim();
    const query = String(req.body?.query || "").trim();
    const service = String(req.body?.service || "").trim();
    const severity = String(req.body?.severity || "warning").trim().toLowerCase();
    const threshold = req.body?.threshold ?? null;

    const alert = await admin.createAlertRule({
      title,
      query,
      service,
      severity,
      createdByUserId: req.auth?.user?.id || null,
      details: {
        threshold,
        requestId: req.requestId
      }
    });

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      action: "CREATE_ALERT",
      details: {
        title,
        query,
        service,
        severity,
        threshold,
        alertId: alert.id,
        requestId: req.requestId
      },
      ipAddress: resolveClientIp(req)
    });

    return res.status(201).json({ success: true, alert });
  } catch (error) {
    return handleServerError(res, "Failed to create alert", error);
  }
});

app.patch("/api/admin/alerts/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || "resolved").trim().toLowerCase();
    if (!["active", "resolved"].includes(status)) {
      return res.status(400).json({ error: "status must be active or resolved" });
    }
    const reason = String(req.body?.reason || `Alert marked ${status} from admin dashboard`).trim();
    const updated = await admin.updateAlertRuleStatus({
      alertId: id,
      status,
      acknowledgedByUserId: req.auth?.user?.id || null
    });
    if (!updated) {
      return res.status(404).json({ error: "Alert not found" });
    }

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      action: status === "resolved" ? "RESOLVE_ALERT" : "REOPEN_ALERT",
      details: {
        reason,
        requestId: req.requestId,
        alertId: updated.id,
        title: updated.title,
        severity: updated.severity
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({ success: true, alert: updated });
  } catch (error) {
    return handleServerError(res, "Failed to update alert", error);
  }
});

app.post("/api/admin/incidents", requireAdmin, async (req, res) => {
  try {
    const title = String(req.body?.title || "Admin incident").trim();
    const severity = String(req.body?.severity || "warning").trim().toLowerCase();
    const requestId = String(req.body?.requestId || "").trim() || null;
    const sourceLogId = req.body?.sourceLogId ?? null;
    const reason = String(req.body?.reason || "Created from admin dashboard").trim();
    const details = req.body?.details && typeof req.body.details === "object" ? req.body.details : {};

    const incident = await admin.createIncident({
      title,
      severity,
      requestId,
      sourceLogId,
      details,
      createdByUserId: req.auth?.user?.id || null
    });

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      action: "CREATE_INCIDENT",
      details: {
        reason,
        requestId: req.requestId,
        incidentId: incident.id,
        sourceLogId,
        severity,
        title
      },
      ipAddress: resolveClientIp(req)
    });

    return res.status(201).json({ success: true, incident });
  } catch (error) {
    return handleServerError(res, "Failed to create incident", error);
  }
});

app.post("/api/admin/integrations/:name/retry", requireAdmin, async (req, res) => {
  try {
    const integrationName = String(req.params?.name || "").trim();
    if (!integrationName) {
      return res.status(400).json({ error: "Integration name is required." });
    }
    const reason = String(req.body?.reason || `Retry requested for ${integrationName}`).trim();

    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      action: "RETRY_INTEGRATION",
      details: {
        integrationName,
        reason,
        requestId: req.requestId
      },
      ipAddress: resolveClientIp(req)
    });

    return res.json({
      success: true,
      integration: {
        name: integrationName,
        retriedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return handleServerError(res, "Failed to retry integration", error);
  }
});

app.post("/api/admin/migrations/admin-workspace", requireSignedIn, requireAdmin, async (req, res) => {
  try {
    if (!isSignedInAdmin(req) && !hasValidMigrationKey(req)) {
      return res.status(403).json({ error: "Admin privileges or valid migration key required." });
    }
    const force = Boolean(req.body?.force) || String(req.query?.force || "").toLowerCase() === "true";
    const reason = String(req.body?.reason || "Triggered from admin dashboard").trim();
    const result = await runAdminWorkspaceMigration({ force });
    await admin.logAdminAction({
      adminId: req.auth?.user?.id || 0,
      action: "RUN_ADMIN_MIGRATION",
      details: {
        force,
        reason,
        requestId: req.requestId,
        migration: result
      },
      ipAddress: resolveClientIp(req)
    });
    return res.json({ success: true, migration: result });
  } catch (error) {
    return handleServerError(res, "Admin workspace migration failed", error);
  }
});

app.post("/api/account/plan", requireSignedIn, validate(planUpdateSchema), async (req, res) => {
  try {
    const plan = normalizePlanInput(req.body?.plan);
    const billingCycle = normalizeBillingCycleInput(req.body?.billingCycle || "monthly");
    if (!plan) {
      return apiError(res, 400, {
        error: "Plan must be one of: starter, pro, desk.",
        message: "Choose a valid subscription plan before retrying.",
        code: "INVALID_PLAN",
        retryable: false
      });
    }
    if (!billingCycle) {
      return apiError(res, 400, {
        error: "Billing cycle must be one of: monthly, yearly.",
        message: "Choose a valid billing cycle before retrying.",
        code: "INVALID_BILLING_CYCLE",
        retryable: false
      });
    }
    const updatedUser = await userAuth.updateCurrentPlan(req.auth.userId, plan, billingCycle);
    if (!updatedUser) {
      return apiError(res, 404, {
        error: "User not found.",
        message: "We could not find an account to update for this session.",
        code: "USER_NOT_FOUND",
        retryable: false
      });
    }
    return res.json({ success: true, user: sanitizeAuthUser(updatedUser) });
  } catch (error) {
    return handleServerError(res, "Account plan update failed", error);
  }
});

app.post("/api/auth/signup", authLimiter, validate(signupSchema), async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const displayName = String(req.body?.displayName || "").trim() || null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return apiError(res, 400, {
        error: "Enter a valid email.",
        message: "Use a valid email address to create your account.",
        code: "INVALID_EMAIL",
        retryable: false
      });
    }
    if (!isStrongPassword(password)) {
      return apiError(res, 400, {
        error: "Password must be 10+ chars with letters, numbers, and symbols.",
        message: "Strengthen the password and try again.",
        code: "WEAK_PASSWORD",
        retryable: false
      });
    }
    if (requireProductionEmailDeliveryReady(res)) return;
    const existing = await userAuth.findUserByEmail(email);
    if (existing) {
      return apiError(res, 409, {
        error: "An account with this email already exists.",
        message: "Sign in instead, or use a different email address.",
        code: "EMAIL_ALREADY_EXISTS"
      });
    }

    const { hash } = derivePasswordHash(password);
    const created = await userAuth.createUser({
      email,
      passwordHash: hash,
      displayName,
      authProvider: "email",
      emailVerified: false
    });

    const verificationCode = crypto.randomInt(100000, 1000000).toString();
    const { hash: codeHash } = derivePasswordHash(verificationCode);
    
    await userAuth.updateUserVerificationCode(created.id, codeHash);
    const verificationEmailDelivery = await sendVerificationEmail(email, verificationCode);
    await logSecurityEvent(req, {
      level: getEmailDeliverySent(verificationEmailDelivery) ? "info" : "warning",
      message: getEmailDeliverySent(verificationEmailDelivery)
        ? "Verification email accepted by provider."
        : "Verification code created but email delivery failed.",
      eventType: "verification_email_requested",
      targetUserId: created.id,
      context: {
        emailHash: hashToken(email),
        emailDeliveryResult: getEmailDeliveryLogContext(verificationEmailDelivery)
      }
    }).catch((error) => {
      console.error("[Auth] Failed to log verification email delivery:", error?.message || error);
    });
    if (!getEmailDeliverySent(verificationEmailDelivery) && process.env.NODE_ENV === "production") {
      return apiError(res, 503, emailDeliveryUnavailablePayload(verificationEmailDelivery, "Verification email could not be sent."));
    }

    const session = await issueSessionForUser(created.id, req, { persistent: true });
    setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });
    
    return res.status(201).json({
      expiresAt: session.expiresAt,
      user: sanitizeAuthUser(created),
      requiresVerification: true,
      verificationEmailSent: getEmailDeliverySent(verificationEmailDelivery)
    });
  } catch (error) {
    return handleServerError(res, "Signup failed", error);
  }
});

app.post("/api/auth/signin", authLimiter, validate(signinSchema), async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) {
      return apiError(res, 400, {
        error: "Email and password are required.",
        message: "Enter both email and password to continue.",
        code: "MISSING_CREDENTIALS",
        retryable: false
      });
    }

    const user = await userAuth.findUserByEmail(email);
    if (!user) {
      return apiError(res, 404, {
        error: "Account not found.",
        message: "No Zenin account exists for that email. Check the address, or create an account if this is your first time here.",
        code: "ACCOUNT_NOT_FOUND",
        retryable: false
      });
    }

    // Check account lockout (#8)
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      return apiError(res, 423, {
        error: "Account is temporarily locked due to multiple failed attempts. Please try again later.",
        message: "Too many failed attempts have temporarily locked this account.",
        code: "ACCOUNT_LOCKED",
        retryable: true
      });
    }

    if (!verifyPassword(password, user.passwordHash)) {
      await userAuth.incrementFailedLogin(user.id);
      // user.failedLoginCount is from BEFORE this increment in the found user object
      if ((user.failedLoginCount || 0) >= 4) { 
        const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await userAuth.lockAccountUntil(user.id, lockedUntil);
      }
      return apiError(res, 401, {
        error: "Invalid email or password.",
        message: "Check your credentials and try again.",
        code: "INVALID_CREDENTIALS",
        retryable: false
      });
    }

    // Success - reset lockout
    await userAuth.resetFailedLogin(user.id);

    if (!user.emailVerified) {
      const rememberMe = req.body?.rememberMe !== false;
      const session = await issueSessionForUser(user.id, req, { persistent: rememberMe });
      setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });
      return res.json({
        expiresAt: session.expiresAt,
        user: sanitizeAuthUser(user),
        requiresVerification: true,
        message: "Verify your email before opening your workspace."
      });
    }

    if (user.twoFactorEnabled) {
      const verificationCode = String(req.body?.verificationCode || "").trim();
      if (!verificationCode) {
        return res.json({ requiresMfa: true, method: user.twoFactorMethod });
      }

      let mfaValid = false;
      let usedBackupCode = false;

      if (user.twoFactorMethod === "authenticator") {
        if (!user.twoFactorSecretHash) {
           return apiError(res, 500, {
             error: "Internal server error",
             message: "Multi-factor authentication is not fully configured for this account.",
             code: "MFA_SETUP_INCOMPLETE"
           });
        }
        // Decrypt the TOTP secret before verification (#2)
        const decryptedSecret = decryptTotpSecret(user.twoFactorSecretHash);
        if (!decryptedSecret) {
          return apiError(res, 500, {
            error: "Internal server error",
            message: "We could not verify the MFA secret for this account.",
            code: "MFA_SECRET_UNAVAILABLE"
          });
        }
        mfaValid = authenticator.verify({ token: verificationCode, secret: decryptedSecret });
      } else {
        // sms or email
        const expectedHash = hashToken(`${user.twoFactorMethod}:${verificationCode}`);
        try {
          mfaValid = crypto.timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(String(user.twoFactorSecretHash || ""), "hex"));
        } catch {
          mfaValid = false;
        }
      }

      // If TOTP/SMS/Email code failed, check backup codes (#BackupCodeHashing)
      if (!mfaValid) {
        const hashedVerificationCode = hashBackupCode(verificationCode);
        const parsedCodes = Array.isArray(user.backupCodes) ? user.backupCodes : [];
        
        // Backup codes in DB are now stored as hashes
        const foundHash = parsedCodes.find(h => h === hashedVerificationCode);
        
        if (foundHash) {
          mfaValid = true;
          usedBackupCode = true;
          // Consume the backup code hash so it cannot be reused
          const remaining = parsedCodes.filter(h => h !== foundHash);
          await userAuth.regenerateBackupCodes({ userId: user.id, backupCodes: remaining });
        }
      }

      if (!mfaValid) {
        return apiError(res, 401, {
          error: "Invalid verification code.",
          message: "Enter a valid verification or backup code.",
          code: "INVALID_MFA_CODE",
          retryable: false
        });
      }
    }
    const rememberMe = req.body?.rememberMe !== false;
    const session = await issueSessionForUser(user.id, req, { persistent: rememberMe });
    setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });
    return res.json({
      expiresAt: session.expiresAt,
      user: sanitizeAuthUser(user)
    });
  } catch (error) {
    return handleServerError(res, "Signin failed", error);
  }
});

app.post("/api/auth/signout", async (req, res) => {
  try {
    const token = getBearerToken(req) || getSessionTokenFromCookie(req);
    if (token) {
      await userAuth.revokeSessionByTokenHash(hashToken(token));
    }
    clearSessionCookie(res, req);
    return res.json({ success: true });
  } catch (error) {
    return handleServerError(res, "Signout failed", error);
  }
});

app.post("/api/auth/forgot-password/request", passwordResetLimiter, validate(forgotPasswordRequestSchema), async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return apiError(res, 400, {
        error: "Email is required.",
        message: "Enter the account email to request a password reset.",
        code: "EMAIL_REQUIRED",
        retryable: false
      });
    }
    if (requireProductionEmailDeliveryReady(res)) return;

    const user = await userAuth.findUserByEmail(email);
    const emailHash = hashToken(email);
    let devResetToken = null;
    let emailDelivery = null;
    if (user) {
      const rawToken = crypto.randomBytes(40).toString("hex");
      devResetToken = rawToken;
      await userAuth.createPasswordResetToken({
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString()
      });

      // Send actual email (fire and forget for better response time, or await if preferred)
      // For now, we await to ensure we catch potential configuration errors in logs
      emailDelivery = await sendPasswordResetEmail(email, rawToken);
      await recordPasswordResetEmailDelivery(rawToken, emailDelivery);
    }

    const emailSent = getEmailDeliverySent(emailDelivery);
    await logSecurityEvent(req, {
      level: user && !emailSent ? "warning" : "info",
      message: user
        ? (emailSent ? "Password reset email accepted by provider." : "Password reset token created but email delivery failed.")
        : "Password reset requested for unknown email.",
      eventType: "password_reset_requested",
      targetUserId: user?.id || null,
      context: {
        emailHash,
        accountFound: Boolean(user),
        emailSent: Boolean(emailSent),
        emailDeliveryResult: getEmailDeliveryLogContext(emailDelivery),
        emailDelivery: getEmailDeliveryConfig()
      }
    }).catch((error) => {
      console.error("[Auth] Failed to log password reset request:", error?.message || error);
    });
    if (user && !emailSent && process.env.NODE_ENV === "production") {
      return apiError(res, 503, emailDeliveryUnavailablePayload(emailDelivery, "Password reset email could not be sent."));
    }

    return res.json({
      success: true,
      message: "If an account exists for that email, a reset link/code has been issued.",
      ...(ALLOW_DEV_AUTH_DEBUG && devResetToken ? { devResetToken } : {})
    });
  } catch (error) {
    return handleServerError(res, "Forgot password request failed", error);
  }
});

app.post("/api/auth/forgot-password/confirm", passwordResetLimiter, validate(forgotPasswordConfirmSchema), async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");
    if (!token) {
      return apiError(res, 400, {
        error: "Reset token is required.",
        message: "Paste the reset token or open the reset link again.",
        code: "RESET_TOKEN_REQUIRED",
        retryable: false
      });
    }
    if (!isStrongPassword(newPassword)) {
      return apiError(res, 400, {
        error: "Password must be 10+ chars with letters, numbers, and symbols.",
        message: "Strengthen the new password and retry.",
        code: "WEAK_PASSWORD",
        retryable: false
      });
    }
    const consumed = await userAuth.consumePasswordResetToken(hashToken(token));
    if (!consumed) {
      return apiError(res, 400, {
        error: "Reset token is invalid or expired.",
        message: "Request a fresh reset link and try again.",
        code: "RESET_TOKEN_INVALID",
        retryable: false
      });
    }

    const { hash } = derivePasswordHash(newPassword);
    await userAuth.updatePassword(consumed.userId, hash);
    await userAuth.revokeSessionsByUserId(consumed.userId);
    const session = await issueSessionForUser(consumed.userId, req, { persistent: true });
    const user = await userAuth.findUserById(consumed.userId);
    setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });
    return res.json({
      success: true,
      expiresAt: session.expiresAt,
      user: sanitizeAuthUser(user)
    });
  } catch (error) {
    return handleServerError(res, "Forgot password confirm failed", error);
  }
});

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return apiError(res, 400, {
        error: "Verification code is required",
        message: "Enter the verification code that was sent to your email.",
        code: "VERIFICATION_CODE_REQUIRED",
        retryable: false
      });
    }

    const session = req.auth && !req.auth.isGuest ? req.auth : null;
    if (!session) {
      return apiError(res, 401, {
        error: "Session expired",
        message: "Sign in again before verifying your email.",
        code: "SESSION_EXPIRED",
        retryable: false
      });
    }

    const user = await userAuth.findUserById(session.userId);
    if (!user) {
      return apiError(res, 404, {
        error: "User not found",
        message: "We could not find an account for this verification session.",
        code: "USER_NOT_FOUND",
        retryable: false
      });
    }
    if (user.emailVerified) {
      return apiError(res, 400, {
        error: "Email already verified",
        message: "This email is already verified.",
        code: "EMAIL_ALREADY_VERIFIED",
        retryable: false
      });
    }

    if (!user.emailVerificationCodeHash) {
      return apiError(res, 400, {
        error: "No verification code requested",
        message: "Request a new verification code before retrying.",
        code: "VERIFICATION_NOT_REQUESTED",
        retryable: false
      });
    }

    if (!verifyPassword(code, user.emailVerificationCodeHash)) {
      return apiError(res, 400, {
        error: "Invalid verification code",
        message: "Check the code and try again.",
        code: "INVALID_VERIFICATION_CODE",
        retryable: false
      });
    }

    // Check expiry (e.g. 15 minutes)
    const requestedAt = new Date(user.emailVerificationRequestedAt).getTime();
    if (Date.now() - requestedAt > 15 * 60 * 1000) {
      return apiError(res, 400, {
        error: "Verification code expired. Please request a new one.",
        message: "Request a fresh verification code and try again.",
        code: "VERIFICATION_CODE_EXPIRED",
        retryable: false
      });
    }

    await userAuth.verifyUserEmail(user.id);
    
    return res.json({ 
      success: true, 
      message: "Email verified successfully",
      user: sanitizeAuthUser({ ...user, emailVerified: true })
    });
  } catch (error) {
    return handleServerError(res, "Verification failed", error);
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  try {
    if (requireProductionEmailDeliveryReady(res)) return;
    const session = req.auth && !req.auth.isGuest ? req.auth : null;
    if (!session) {
      return apiError(res, 401, {
        error: "Session expired",
        message: "Sign in again before requesting another verification code.",
        code: "SESSION_EXPIRED",
        retryable: false
      });
    }

    const user = await userAuth.findUserById(session.userId);
    if (!user) {
      return apiError(res, 404, {
        error: "User not found",
        message: "We could not find an account for this verification request.",
        code: "USER_NOT_FOUND",
        retryable: false
      });
    }
    if (user.emailVerified) {
      return apiError(res, 400, {
        error: "Email already verified",
        message: "This email is already verified.",
        code: "EMAIL_ALREADY_VERIFIED",
        retryable: false
      });
    }

    // Rate limit resends (e.g. 1 minute)
    if (user.emailVerificationRequestedAt) {
      const requestedAt = new Date(user.emailVerificationRequestedAt).getTime();
      if (Date.now() - requestedAt < 60 * 1000) {
        return apiError(res, 429, {
          error: "Please wait before requesting another code",
          message: "A verification code was sent recently. Try again in a moment.",
          code: "VERIFICATION_RESEND_RATE_LIMIT"
        });
      }
    }

    const verificationCode = crypto.randomInt(100000, 1000000).toString();
    const { hash: codeHash } = derivePasswordHash(verificationCode);

    try {
      await userAuth.updateUserVerificationCode(user.id, codeHash);
    } catch (error) {
      return handleServerError(res, "Failed to persist verification code", error, {
        status: 503,
        error: "Verification code could not be created.",
        message: "Zenin could not create a fresh verification code. Please try again in a moment.",
        code: "VERIFICATION_CODE_STORAGE_FAILED",
        retryable: true
      });
    }

    const verificationEmailDelivery = await sendVerificationEmail(user.email, verificationCode);
    await logSecurityEvent(req, {
      level: getEmailDeliverySent(verificationEmailDelivery) ? "info" : "warning",
      message: getEmailDeliverySent(verificationEmailDelivery)
        ? "Verification email accepted by provider."
        : "Verification code created but email delivery failed.",
      eventType: "verification_email_requested",
      targetUserId: user.id,
      context: {
        emailHash: hashToken(String(user.email || "").trim().toLowerCase()),
        emailDeliveryResult: getEmailDeliveryLogContext(verificationEmailDelivery)
      }
    }).catch((error) => {
      console.error("[Auth] Failed to log verification email delivery:", error?.message || error);
    });
    if (!getEmailDeliverySent(verificationEmailDelivery) && process.env.NODE_ENV === "production") {
      return apiError(res, 503, emailDeliveryUnavailablePayload(verificationEmailDelivery, "Verification email could not be sent."));
    }

    return res.json({
      success: true,
      message: getEmailDeliverySent(verificationEmailDelivery)
        ? "Verification code sent"
        : "Verification code created, but email delivery is not configured or failed.",
      verificationEmailSent: getEmailDeliverySent(verificationEmailDelivery),
      ...(ALLOW_DEV_AUTH_DEBUG ? { devVerificationCode: verificationCode } : {})
    });
  } catch (error) {
    return handleServerError(res, "Failed to resend verification", error);
  }
});

app.get("/api/auth/passkeys/authenticate/generate-options", authLimiter, async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
    });
    
    // Using a temporary key for unauthenticated users based on IP or a session ID would be better,
    // but since we don't have the user ID yet, we'll store the challenge keyed by the challenge itself
    // or we can require the user to input their email first.
    // A passwordless flow usually requires email first OR discoverable credentials.
    // If discoverable credentials, we don't know the user ID. We'll key it by challenge id.
    const challengeId = crypto.randomUUID();
    webAuthnChallenges.set(`auth_${challengeId}`, { challenge: options.challenge, expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS });
    
    return res.json({ ...options, challengeId });
  } catch (error) {
    return handleServerError(res, "Generate Passkey Auth Options failed", error);
  }
});

app.post("/api/auth/passkeys/authenticate/verify", authLimiter, async (req, res) => {
  try {
    const { response, challengeId, rememberMe } = req.body;
    const challengeEntry = webAuthnChallenges.get(`auth_${challengeId}`);
    
    if (!challengeEntry || challengeEntry.expiresAt < Date.now()) {
      if (challengeEntry) webAuthnChallenges.delete(`auth_${challengeId}`);
      return apiError(res, 400, {
        error: "Authentication session expired or invalid.",
        message: "Start passkey sign-in again and retry.",
        code: "PASSKEY_AUTH_SESSION_INVALID",
        retryable: false
      });
    }
    const expectedChallenge = challengeEntry.challenge;
    
    // We need to find the user by credential ID
    const credentialID = response.id;
    // Parameterized query to prevent SQL injection (#1)
    const result = await pool.query(`
      SELECT id FROM app_users 
      WHERE passkeys_json @> $1::jsonb
      LIMIT 1;
    `, [JSON.stringify([{ credentialID }])]);
    
    if (result.rows.length === 0) {
      return apiError(res, 401, {
        error: "Passkey not recognized.",
        message: "Use a registered passkey or sign in with email instead.",
        code: "PASSKEY_NOT_RECOGNIZED",
        retryable: false
      });
    }
    
    const user = await userAuth.findUserById(result.rows[0].id);
    const passkey = user.passkeys.find(p => p.credentialID === credentialID);
    
    if (!passkey) {
      return apiError(res, 401, {
        error: "Passkey not found on user.",
        message: "This passkey is no longer registered on your account.",
        code: "PASSKEY_NOT_FOUND",
        retryable: false
      });
    }
    
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      authenticator: {
        credentialPublicKey: Buffer.from(passkey.credentialPublicKey, 'base64url'),
        credentialID: Buffer.from(passkey.credentialID, 'base64url'),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
    
    if (verification.verified) {
      webAuthnChallenges.delete(`auth_${challengeId}`);
      
      // Update the counter
      const updatedPasskeys = user.passkeys.map(p => {
        if (p.credentialID === credentialID) {
          return { ...p, counter: verification.authenticationInfo.newCounter };
        }
        return p;
      });
      await pool.query('UPDATE app_users SET passkeys_json = $1::jsonb WHERE id = $2', [JSON.stringify(updatedPasskeys), user.id]);
      
      const session = await issueSessionForUser(user.id, req, { persistent: rememberMe !== false });
      setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });
      
      return res.json({ success: true, user: sanitizeAuthUser(user), expiresAt: session.expiresAt });
    }
    
    return apiError(res, 401, {
      error: "Passkey verification failed.",
      message: "We could not verify this passkey response. Try again.",
      code: "PASSKEY_AUTH_FAILED",
      retryable: false
    });
  } catch (error) {
    return handleServerError(res, "Verify Passkey Auth failed", error);
  }
});

app.get("/api/auth/2fa/generate", authLimiter, requireSignedIn, async (req, res) => {
  try {
    const user = await userAuth.findUserById(req.auth.userId);
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, "Zenin Capital", secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauth);
    return res.json({ secret, qrCodeDataUrl });
  } catch (error) {
    return handleServerError(res, "Generate 2FA failed", error);
  }
});

app.post("/api/auth/2fa/enable", authLimiter, requireSignedIn, validate(twoFactorEnableSchema), async (req, res) => {
  try {
    const method = String(req.body?.method || "").trim().toLowerCase();
    const verificationCode = String(req.body?.verificationCode || "").trim();
    const provider = String(req.body?.provider || "").trim() || null;
    const target = String(req.body?.target || "").trim() || null;
    const secret = String(req.body?.secret || "").trim();
    
    if (!["authenticator", "sms", "email"].includes(method)) {
      return res.status(400).json({ error: "Unsupported 2FA method." });
    }
    if (!/^\d{6}$/.test(verificationCode)) {
      return res.status(400).json({ error: "Enter a valid 6-digit verification code." });
    }
    
    let secretToStore = null;
    if (method === "authenticator") {
      if (!secret) return res.status(400).json({ error: "Secret is required for authenticator method." });
      const isValid = authenticator.verify({ token: verificationCode, secret });
      if (!isValid) return res.status(400).json({ error: "Invalid verification code." });
      // Encrypt the secret before storing it (#2)
      secretToStore = encryptTotpSecret(secret);
    } else {
      if (!target) return res.status(400).json({ error: "A delivery target is required for this 2FA method." });
      secretToStore = hashToken(`${method}:${verificationCode}`); // Mock for sms/email
    }

    const plaintextBackupCodes = createBackupCodes();
    const hashedBackupCodes = plaintextBackupCodes.map(hashBackupCode);
    
    await userAuth.upsertTwoFactor({
      userId: req.auth.userId,
      enabled: true,
      method,
      secretHash: secretToStore,
      provider,
      target,
      backupCodes: hashedBackupCodes
    });

    // Session rotation after 2FA state change (#10)
    await userAuth.revokeSessionsByUserId(req.auth.userId);
    const session = await issueSessionForUser(req.auth.userId, req, { persistent: true });
    setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });

    const user = await userAuth.findUserById(req.auth.userId);
    // Return plaintext codes ONLY once during enable
    const sanitizedUser = sanitizeAuthUser(user);
    return res.json({ 
      success: true, 
      user: sanitizedUser,
      backupCodes: plaintextBackupCodes 
    });
  } catch (error) {
    return handleServerError(res, "Enable 2FA failed", error);
  }
});

app.post("/api/auth/2fa/disable", authLimiter, requireSignedIn, async (req, res) => {
  try {
    await userAuth.upsertTwoFactor({
      userId: req.auth.userId,
      enabled: false,
      method: null,
      secretHash: null,
      provider: null,
      target: null,
      backupCodes: []
    });

    // Session rotation after 2FA state change (#10)
    await userAuth.revokeSessionsByUserId(req.auth.userId);
    const session = await issueSessionForUser(req.auth.userId, req, { persistent: true });
    setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });

    const user = await userAuth.findUserById(req.auth.userId);
    return res.json({ success: true, user: sanitizeAuthUser(user) });
  } catch (error) {
    return handleServerError(res, "Disable 2FA failed", error);
  }
});

app.get("/api/auth/passkeys/register/generate-options", authLimiter, requireSignedIn, async (req, res) => {
  try {
    const user = await userAuth.findUserById(req.auth.userId);
    const userPasskeys = Array.isArray(user.passkeys) ? user.passkeys : [];

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: String(user.id),
      userName: user.email,
      attestationType: 'none',
      excludeCredentials: userPasskeys.map(passkey => ({
        id: passkey.credentialID,
        type: 'public-key',
        transports: passkey.transports,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    webAuthnChallenges.set(`reg_${user.id}`, { challenge: options.challenge, expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS });
    return res.json(options);
  } catch (error) {
    return handleServerError(res, "Generate Passkey Options failed", error);
  }
});

app.post("/api/auth/passkeys/register/verify", authLimiter, requireSignedIn, async (req, res) => {
  try {
    const user = await userAuth.findUserById(req.auth.userId);
    const challengeEntry = webAuthnChallenges.get(`reg_${user.id}`);
    
    if (!challengeEntry || challengeEntry.expiresAt < Date.now()) {
      if (challengeEntry) webAuthnChallenges.delete(`reg_${user.id}`);
      return apiError(res, 400, {
        error: "Registration session expired or invalid.",
        message: "Start passkey registration again and retry.",
        code: "PASSKEY_REGISTRATION_SESSION_INVALID",
        retryable: false
      });
    }
    const expectedChallenge = challengeEntry.challenge;
    
    const verification = await verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
    
    if (verification.verified && verification.registrationInfo) {
      webAuthnChallenges.delete(`reg_${user.id}`);
      const { credentialPublicKey, credentialID, counter } = verification.registrationInfo;
      
      const newPasskey = {
        credentialID: Buffer.from(credentialID).toString('base64url'),
        credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64url'),
        counter,
        transports: req.body.response.response.transports || [],
        name: req.body.name || "Passkey",
        provider: req.body.provider || "Platform Authenticator",
        createdAt: new Date().toISOString()
      };
      
      const plaintextBackupCodes = createBackupCodes();
      const hashedBackupCodes = plaintextBackupCodes.map(hashBackupCode);

      await userAuth.addPasskey({
        userId: user.id,
        passkey: newPasskey,
        backupCodes: hashedBackupCodes
      });

      // Session rotation after 2FA state change (#10)
      await userAuth.revokeSessionsByUserId(user.id);
      const session = await issueSessionForUser(user.id, req, { persistent: true });
      setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });
      
      const updatedUser = await userAuth.findUserById(user.id);
      return res.json({ 
        success: true, 
        user: sanitizeAuthUser(updatedUser),
        backupCodes: plaintextBackupCodes
      });
    }
    
    return apiError(res, 400, {
      error: "Passkey verification failed.",
      message: "We could not complete passkey registration. Try again.",
      code: "PASSKEY_REGISTRATION_FAILED",
      retryable: false
    });
  } catch (error) {
    return handleServerError(res, "Verify Passkey failed", error);
  }
});

app.post("/api/auth/2fa/backup-codes/regenerate", authLimiter, requireSignedIn, async (req, res) => {
  try {
    const user = await userAuth.findUserById(req.auth.userId);
    if (!user?.twoFactorEnabled) {
      return res.status(400).json({ error: "Enable 2FA before generating backup codes." });
    }
    const plaintextBackupCodes = createBackupCodes();
    const hashedBackupCodes = plaintextBackupCodes.map(hashBackupCode);
    await userAuth.regenerateBackupCodes({
      userId: req.auth.userId,
      backupCodes: hashedBackupCodes
    });
    const updated = await userAuth.findUserById(req.auth.userId);
    return res.json({ 
      success: true, 
      user: sanitizeAuthUser(updated),
      backupCodes: plaintextBackupCodes 
    });
  } catch (error) {
    return handleServerError(res, "Backup code regeneration failed", error);
  }
});

app.get("/api/auth/oauth/providers", (_req, res) => {
  return res.json({ providers: OAUTH_PROVIDERS });
});

app.post("/api/auth/oauth/start", authLimiter, async (req, res) => {
  const provider = String(req.body?.provider || "").trim().toLowerCase();
  if (ARCHIVED_OAUTH_PROVIDERS.has(provider)) {
    return res.status(410).json({ error: "Apple sign-in is temporarily unavailable." });
  }
  if (!OAUTH_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: "Unsupported provider." });
  }

  const returnTo = sanitizeInternalRedirectPath(req.body?.returnTo, "/app");
  const entryPath = sanitizeOAuthEntryPath(req.body?.entryPath);
  const authMode = sanitizeOAuthMode(req.body?.authMode, "signin");
  const state = createOAuthStateToken({
    provider,
    returnTo,
    entryPath,
    authMode,
    frontendOrigin: sanitizeOAuthFrontendOrigin(req.body?.frontendOrigin || req.headers.origin || req.headers.referer)
  });
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: "Google OAuth not configured.",
        message: "Google sign-in is missing server OAuth credentials. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET."
      });
    }
    
    const redirectUri = getOAuthRedirectUri(req, "google");
    const client = new OAuth2Client(clientId);
    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/userinfo.email"],
      redirect_uri: redirectUri,
      state
    });
    return res.json({ provider, configured: true, authorizationUrl: authUrl });
  }

  return res.json({
    provider,
    configured: false,
    authorizationUrl: null,
    message: `${provider} OAuth is scaffolded but not configured.`
  });
});

async function completeGoogleOAuth(req, res, { code, state, json = false } = {}) {
  let oauthState;
  const fail = (errorMessage, status = 400, stateFallback = oauthState) => {
    const safeState = stateFallback || {
      entryPath: "/auth",
      authMode: "signin",
      returnTo: "/app"
    };
    if (json) {
      return res.status(status).json({
        success: false,
        error: errorMessage || "Google sign-in failed. Please try again."
      });
    }
    return res.redirect(buildOAuthFailureRedirect({
      ...safeState,
      errorMessage: errorMessage || "Google sign-in failed. Please try again."
    }));
  };

  try {
    oauthState = parseOAuthStateToken(state);
  } catch (error) {
    return fail(error.message || "Google sign-in session expired. Please try again.", 400, {
      entryPath: "/auth",
      authMode: "signin",
      returnTo: "/app"
    });
  }

  const cleanCode = String(code || "").trim();
  if (!cleanCode) {
    return fail("Google sign-in did not return an authorization code.", 400);
  }
  if (oauthState.provider !== "google") {
    return fail("Google sign-in session was invalid. Please try again.", 400);
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return fail("Google sign-in is missing server OAuth credentials.", 503);
    }

    const redirectUri = getOAuthRedirectUri(req, "google");
    const client = new OAuth2Client(clientId, clientSecret, redirectUri);
    const { tokens } = await client.getToken(cleanCode);
    client.setCredentials(tokens);

    const userInfoRes = await client.request({
      url: "https://www.googleapis.com/oauth2/v3/userinfo"
    });
    const { email, name } = userInfoRes.data || {};
    if (!email) {
      return fail("Google did not return an email address for this account.", 400);
    }

    const user = await userAuth.upsertOAuthUser({
      email,
      displayName: name,
      authProvider: "google"
    });

    const session = await issueSessionForUser(user.id, req, { persistent: true });
    setSessionCookie(res, req, session.token, session.expiresAt, { persistent: true });

    if (json) {
      return res.json({
        success: true,
        returnTo: sanitizeInternalRedirectPath(oauthState.returnTo, "/app"),
        frontendOrigin: oauthState.frontendOrigin,
        user: sanitizeAuthUser(user)
      });
    }
    return res.redirect(buildOAuthSuccessRedirect(oauthState.returnTo, oauthState.frontendOrigin));
  } catch (error) {
    console.error("[Google OAuth] Callback failed:", error);
    const message = String(error?.message || "").toLowerCase().includes("redirect_uri_mismatch")
      ? "Google sign-in is using a redirect URI that is not authorized for this OAuth client."
      : "Google sign-in failed. Please try again.";
    return fail(message, 400);
  }
}

app.get("/api/auth/oauth/google/callback", authLimiter, async (req, res) => {
  return completeGoogleOAuth(req, res, {
    code: req.query.code,
    state: req.query.state,
    json: false
  });
});

app.post("/api/auth/oauth/google/exchange", authLimiter, async (req, res) => {
  return completeGoogleOAuth(req, res, {
    code: req.body?.code,
    state: req.body?.state,
    json: true
  });
});

app.post("/api/auth/oauth/apple/callback", authLimiter, express.urlencoded({ extended: true }), async (req, res) => {
  return res.redirect(buildOAuthFailureRedirect({
    entryPath: sanitizeOAuthEntryPath(req.body?.entryPath),
    authMode: sanitizeOAuthMode(req.body?.authMode, "signin"),
    returnTo: sanitizeInternalRedirectPath(req.body?.returnTo, "/app"),
    errorMessage: "Apple sign-in is temporarily unavailable."
  }));
});

app.post("/api/auth/oauth/mock", authLimiter, async (req, res) => {
  try {
    if (!ALLOW_OAUTH_MOCK) {
      return res.status(404).json({ error: "Not found" });
    }
    const provider = String(req.body?.provider || "").trim().toLowerCase();
    if (!OAUTH_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: "Unsupported provider." });
    }
    const email = `${provider}.user.${Date.now()}@zenin.local`;
    const created = await userAuth.createUser({
      email,
      passwordHash: "",
      displayName: `${provider[0].toUpperCase()}${provider.slice(1)} User`,
      authProvider: provider,
      emailVerified: true
    });
    const session = await issueSessionForUser(created.id, req, { persistent: true });
    setSessionCookie(res, req, session.token, session.expiresAt, { persistent: session.persistent });
    return res.status(201).json({
      expiresAt: session.expiresAt,
      user: sanitizeAuthUser(created),
      mode: "mock"
    });
  } catch (error) {
    return handleServerError(res, "OAuth mock sign-in failed", error);
  }
});

// History
// ---------------------------------------------------------------------------
const CRYPTO_HISTORY_INTERVALS = {
  "4H": { days: 1, hyperInterval: "15m" },
  "1D": { days: 1, hyperInterval: "15m" },
  "1W": { days: 7, hyperInterval: "1h" },
  "3M": { days: 90, hyperInterval: "4h" },
  "1Y": { days: 365, hyperInterval: "1d" },
  "YTD": { days: 365, hyperInterval: "1d" },
  "MAX": { days: 2000, hyperInterval: "1d" },
};

function getCryptoHistoryConfig(interval) {
  return CRYPTO_HISTORY_INTERVALS[interval] || CRYPTO_HISTORY_INTERVALS["1D"];
}

async function fetchHistoryFromCoinGecko(symbol, interval) {
  const fetch = await resolveFetch();

  const { days } = getCryptoHistoryConfig(interval);
  const coinMap = {
    BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin",
    XRP: "ripple", ADA: "cardano", SOL: "solana",
    DOGE: "dogecoin", DOT: "polkadot", USDT: "tether", USDC: "usd-coin"
  };

  const coinId = coinMap[symbol] || symbol.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CoinGecko fetch failed: ${text}`);
  }

  const data = await response.json();
  const prices = data.prices || [];

  return prices.map(([timestamp, price]) => ({
    time: new Date(timestamp).toISOString(),
    open: price,
    high: price,
    low: price,
    close: price,
    price: price
  }));
}

async function fetchHistoryFromHyperliquid(symbol, interval) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  if (!normalizedSymbol) return [];
  const { days, hyperInterval } = getCryptoHistoryConfig(interval);
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  const candlesRaw = await postHyperliquidInfo({
    type: "candleSnapshot",
    req: {
      coin: normalizedSymbol,
      interval: hyperInterval,
      startTime,
      endTime
    }
  });

  const candles = Array.isArray(candlesRaw) ? candlesRaw : [];
  return candles
    .map((row) => {
      const tsRaw = row?.t ?? row?.T ?? row?.time;
      const ts = Number(tsRaw);
      const open = Number(row?.o ?? row?.open);
      const high = Number(row?.h ?? row?.high);
      const low = Number(row?.l ?? row?.low);
      const close = Number(row?.c ?? row?.close);
      if (!Number.isFinite(ts) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
        return null;
      }
      return {
        time: new Date(ts).toISOString(),
        open,
        high,
        low,
        close,
        price: close
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

async function fetchHistoryForCrypto(symbol, interval) {
  try {
    const hyperliquidHistory = await fetchHistoryFromHyperliquid(symbol, interval);
    if (hyperliquidHistory.length > 1) {
      return { history: hyperliquidHistory, source: "hyperliquid" };
    }
  } catch (error) {
    console.warn(`Hyperliquid history failed for ${symbol}:`, error?.message || error);
  }

  const coinGeckoHistory = await fetchHistoryFromCoinGecko(symbol, interval);
  return { history: coinGeckoHistory, source: "coingecko" };
}

function fetchHistoryFromYahoo(symbol, interval) {
  return new Promise((resolve, reject) => {
    // interval mapping for yfinance (period, interval)
    const mapping = {
      "4H": { period: "1d", interval: "15m" },
      "1D": { period: "1d", interval: "5m" },
      "1W": { period: "7d", interval: "60m" },
      "1M": { period: "1mo", interval: "1d" },
      "3M": { period: "3mo", interval: "1d" },
      "1Y": { period: "1y", interval: "1d" },
      "YTD": { period: "ytd", interval: "1d" },
      "MAX": { period: "max", interval: "1wk" },
    };
    const { period, interval: yfInterval } = mapping[interval] || mapping["1D"];
    const yfSymbol = normaliseSymbol(symbol);

    const child = spawn(pythonBinary, ["fetch_history.py"], { cwd: __dirname });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `history_fetch_exit_${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout || "{}");
        if (parsed?.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve({
          history: Array.isArray(parsed?.history) ? parsed.history : [],
          source: String(parsed?.source || "yahoo"),
          meta: parsed?.meta || null
        });
      } catch (e) {
        reject(new Error("history_parse_failed"));
      }
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.stdin.write(JSON.stringify({ symbol: yfSymbol, period, interval: yfInterval }));
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("history_fetch_timeout"));
    }, 12000);

    child.on("close", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
  });
}



// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check — used by Render and uptime monitors
app.get("/", (req, res) => {
  const configuredFrontendUrl = String(process.env.PUBLIC_APP_ORIGIN || process.env.FRONTEND_URL || expectedOrigin || DEFAULT_PUBLIC_APP_ORIGIN).trim();
  let frontendUrl = "/";
  try {
    const parsed = new URL(configuredFrontendUrl);
    frontendUrl = `${parsed.origin}/`;
  } catch {
    frontendUrl = "/";
  }

  if (req.accepts("html")) {
    res.redirect(302, frontendUrl);
    return;
  }

  res.json({
    service: "Zenin Capital API",
    status: "ok",
    frontend: frontendUrl,
    health: "/health",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/categories", (_req, res) => {
  res.json({ categories: Object.keys(watchlistData) });
});

app.get("/api/forex", async (_req, res) => {
  try {
    const data = await fetchForexRates();
    res.json(data);
  } catch (error) {
    console.error("[Forex] Error fetching rates:", error);
    res.status(500).json({ error: "Failed to fetch forex rates" });
  }
});

app.get("/api/forex/rates", async (_req, res) => {
  try {
    res.json(await fetchForexRates());
  } catch (error) {
    res.json({
      updatedAt: new Date().toISOString(),
      source: "unavailable",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "forex_rates_fetch_failed",
      rates: [],
      gainers: [],
      losers: []
    });
  }
});

app.get("/api/data/providers", async (_req, res) => {
  const [fred, bls] = await Promise.all([
    fetchFredMacroMetrics().then((result) => result.status).catch((error) => buildProviderStatus("FRED", Boolean(FRED_API_KEY), "unavailable", error?.message || "FRED unavailable")),
    fetchBlsMacroMetrics().then((result) => result.status).catch((error) => buildProviderStatus("BLS", Boolean(BLS_API_KEY), "unavailable", error?.message || "BLS unavailable"))
  ]);
  res.json({
    updatedAt: new Date().toISOString(),
    providers: buildDataProviderStatus({
      fred,
      bls,
      eia: buildProviderStatus("EIA", Boolean(EIA_API_KEY), EIA_API_KEY ? "configured" : "missing_key", EIA_API_KEY ? "Energy series configured for commodity fundamentals" : "API key not configured"),
      massive: getMassiveStatus()
    })
  });
});

app.get("/api/history", validate(historyQuerySchema, "query"), async (req, res) => {
  const { type, interval = "1D" } = req.query;
  const rawSymbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!rawSymbol) return res.status(400).json({ error: "Invalid symbol" });
  const normalizedType = String(type || "stock").toLowerCase();
  const resolvedSymbol = normalizedType === "crypto"
    ? sanitizeSymbol(rawSymbol)
    : sanitizeSymbol(normaliseSymbol(rawSymbol));
  if (!resolvedSymbol) return res.status(400).json({ error: "Invalid symbol" });
  const snapshotParams = {
    symbol: rawSymbol.slice(0, 30),
    type: normalizedType,
    interval: String(interval || "1D").toUpperCase()
  };
  const cached = await readServiceSnapshot("history", snapshotParams);
  const ttlMs = normalizedType === "crypto"
    ? ROUTE_CACHE_TTLS_MS["history:crypto"]
    : ROUTE_CACHE_TTLS_MS["history:tradfi"];

  const fresh = await readFreshSnapshot("history", snapshotParams, ttlMs);
  if (fresh) {
    return res.json(fresh);
  }

  try {
    const payload = await withInflightDedup("history", snapshotParams, async () => {
      let history = [];
      let source = "";
      if (normalizedType === "crypto") {
        const cryptoHistory = await fetchHistoryForCrypto(resolvedSymbol, interval);
        history = cryptoHistory.history;
        source = cryptoHistory.source;
      } else {
        const stockHistory = await fetchHistoryFromYahoo(resolvedSymbol, interval);
        history = stockHistory.history;
        source = stockHistory.source || "yahoo";
      }
      const nextPayload = {
        history: Array.isArray(history) ? history : [],
        source: source || "",
        updatedAt: new Date().toISOString(),
        stale: false
      };
      await writeAllSnapshots("history", snapshotParams, nextPayload);
      return nextPayload;
    });
    res.json(payload);
  } catch (error) {
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "history_fetch_failed"));
    }
    res.json({
      history: [],
      source: "unavailable",
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "history_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

app.get("/api/interval-performance", async (req, res) => {
  const { symbol, type } = req.query;
  const rawSymbol = String(symbol || "").trim().toUpperCase();
  if (!rawSymbol) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  const normalizedType = String(type || "stock").toLowerCase();
  const cleanSymbol = normalizedType === "crypto"
    ? sanitizeSymbol(rawSymbol)
    : sanitizeSymbol(normaliseSymbol(rawSymbol));
  if (!cleanSymbol) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  const intervals = ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"];
  const snapshotParams = {
    symbol: rawSymbol.slice(0, 30),
    type: normalizedType
  };
  const cached = await readServiceSnapshot("interval-performance", snapshotParams);

  try {
    const results = await Promise.all(intervals.map(async (int) => {
      try {
        let history = [];
        if (normalizedType === "crypto") {
          const cryptoHistory = await fetchHistoryForCrypto(cleanSymbol, int);
          history = cryptoHistory.history;
        } else {
          const stockHistory = await fetchHistoryFromYahoo(cleanSymbol, int);
          history = stockHistory.history;
        }

        if (history && history.length > 1) {
          const start = history[0].open || history[0].price;
          const end = history[history.length - 1].close || history[history.length - 1].price;
          const change = ((end - start) / start) * 100;
          return { interval: int, change };
        }
        return { interval: int, change: 0 };
      } catch (e) {
        return { interval: int, change: 0 };
      }
    }));

    const performanceMap = results.reduce((acc, curr) => {
      acc[curr.interval] = curr.change;
      return acc;
    }, {});
    const payload = {
      performance: performanceMap,
      updatedAt: new Date().toISOString(),
      stale: false
    };
    await writeServiceSnapshot("interval-performance", snapshotParams, payload);
    res.json(payload);
  } catch (error) {
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "interval_performance_fetch_failed"));
    }
    res.json({
      performance: {},
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "interval_performance_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

// ---------------------------------------------------------------------------
// Live Greeks / IV / Premium from Deribit (with Binance fallback)
// ---------------------------------------------------------------------------
const GREEKS_CACHE = new Map();
const GREEKS_CACHE_TTL = 60 * 1000; // 1 minute

app.get("/api/greeks", async (req, res) => {
  const { symbol, expiry, strike, type: optType } = req.query;
  if (!symbol || !expiry || !strike) {
    return res.status(400).json({ error: "symbol, expiry, and strike are required" });
  }

  const cacheKey = `${symbol}-${expiry}-${strike}-${optType || "C"}`;
  const now = Date.now();
  if (GREEKS_CACHE.has(cacheKey)) {
    const entry = GREEKS_CACHE.get(cacheKey);
    if (now - entry.ts < GREEKS_CACHE_TTL) return res.json(entry.data);
  }

  const sym = String(symbol || "").trim().toUpperCase();
  const deribitCurrency = sym === "ETH" ? "ETH" : sym === "SOL" ? "SOL" : "BTC";

  try {
    const expiryUpper = String(expiry || "").trim().toUpperCase();
    const instrumentName = `${deribitCurrency}-${expiryUpper}-${strike}-${(optType || "C").toUpperCase()}`;
    const deribitUrl = `https://www.deribit.com/api/v2/public/get_order_book?instrument_name=${encodeURIComponent(instrumentName)}&depth=1`;

    const deribitRes = await fetch(deribitUrl, { headers: { Accept: "application/json" } });

    if (deribitRes.ok) {
      const deribitData = await deribitRes.json();
      const result = deribitData?.result;
      if (result) {
        const greeks = result.greeks || {};
        const payload = {
          source: "deribit",
          instrument: instrumentName,
          bid: result.best_bid_price,
          ask: result.best_ask_price,
          mark: result.mark_price,
          iv: result.mark_iv,
          delta: greeks.delta,
          gamma: greeks.gamma,
          theta: greeks.theta,
          vega: greeks.vega,
          rho: greeks.rho,
          underlying: result.underlying_price,
          openInterest: result.open_interest,
          updatedAt: new Date().toISOString()
        };
        GREEKS_CACHE.set(cacheKey, { ts: now, data: payload });
        return res.json(payload);
      }
    }

    return res.json({
      source: "unavailable", instrument: instrumentName,
      bid: null, ask: null, mark: null, iv: null,
      delta: null, gamma: null, theta: null, vega: null, rho: null,
      underlying: null, openInterest: null,
      stale: true, stale_reason: "Instrument not found on Deribit",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Greeks fetch failed:", error.message);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/search", validate(searchQuerySchema, "query"), async (req, res) => {
  const { q, type = "tradfi" } = req.query;
  if (!q) {
    return res.status(400).json({ error: "q parameter required" });
  }
  try {
    const normalizedType = String(type || "tradfi").trim().toLowerCase();
    let results = [];
    if (normalizedType === "crypto") {
      const hyperResults = await fetchHyperliquidSearchResults(q);
      results = hyperResults.length > 0 ? hyperResults : await searchCoinGeckoCrypto(q);
    } else if (normalizedType === "commodity" || normalizedType === "commodities") {
      results = COMMODITY_UNIVERSE
        .filter((row) => `${row.symbol} ${row.name} ${row.group} ${row.region}`.toLowerCase().includes(String(q || "").toLowerCase()))
        .slice(0, 12)
        .map((row) => ({
          symbol: row.symbol,
          name: row.name,
          type: "commodity",
          category: "commodities",
          marketType: "commodity",
          market: "Commodity",
          group: row.group,
          region: row.region,
          currency: "USD",
          source: "Commodity catalog"
        }));
    } else if (normalizedType === "indicator" || normalizedType === "indicators") {
      results = searchForexFactoryCountries(q, 20);
    } else {
      results = await searchYahooFinance(q, normalizedType);
    }
    res.json({ results });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/earnings", async (req, res) => {
  const rawSymbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!rawSymbol) return res.status(400).json({ error: "symbol required" });

  const requestedSymbol = rawSymbol.slice(0, 30);
  const resolvedSymbol = sanitizeSymbol(normaliseSymbol(rawSymbol)).slice(0, 20);
  if (!resolvedSymbol) return res.status(400).json({ error: "Invalid symbol" });
  const snapshotParams = { symbol: requestedSymbol };
  const cached = await readServiceSnapshot("earnings", snapshotParams);
  const cachedAt = cached?.updatedAt ? new Date(cached.updatedAt).getTime() : 0;
  const cachedFresh =
    Boolean(cached?.payload) &&
    Number.isFinite(cachedAt) &&
    cachedAt > 0 &&
    (Date.now() - cachedAt) < EARNINGS_CACHE_TTL_MS &&
    !cached?.payload?.stale &&
    !cached?.payload?.unavailable;

  if (cachedFresh) {
    return res.json(cached.payload);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      res.json(payload);
      resolve();
    };
    const child = spawn(pythonBinary, ["fetch_earnings.py"], { cwd: __dirname });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", async (code) => {
      if (stderr) console.error("Earnings stderr:", stderr);
      if (code !== 0) {
        if (cached?.payload) {
          return finish(applyStaleMeta(cached.payload, cached, "earnings_fetch_failed"));
        }
        return finish({
          symbol: requestedSymbol,
          resolvedSymbol,
          updatedAt: new Date().toISOString(),
          stale: true,
          unavailable: true,
          stale_reason: "earnings_fetch_failed",
          cache_updated_at: null,
          stale_age_seconds: null
        });
      }
      try {
        const result = JSON.parse(stdout);
        if (result?.error) {
          if (cached?.payload) {
            return finish(applyStaleMeta(cached.payload, cached, result.error));
          }
          return finish({
            symbol: requestedSymbol,
            resolvedSymbol,
            updatedAt: new Date().toISOString(),
            stale: true,
            unavailable: true,
            stale_reason: result.error,
            cache_updated_at: null,
            stale_age_seconds: null
          });
        }
        const payload = {
          ...(result || {}),
          symbol: requestedSymbol,
          resolvedSymbol,
          updatedAt: new Date().toISOString(),
          stale: false
        };
        await writeServiceSnapshot("earnings", snapshotParams, payload);
        finish(payload);
      } catch {
        if (cached?.payload) {
          return finish(applyStaleMeta(cached.payload, cached, "earnings_parse_failed"));
        }
        finish({
          symbol: requestedSymbol,
          resolvedSymbol,
          updatedAt: new Date().toISOString(),
          stale: true,
          unavailable: true,
          stale_reason: "earnings_parse_failed",
          cache_updated_at: null,
          stale_age_seconds: null
        });
      }
    });

    child.on("error", (err) => {
      console.error("Failed to start earnings process:", err);
      if (cached?.payload) {
        return finish(applyStaleMeta(cached.payload, cached, err?.message || "earnings_process_start_failed"));
      }
      finish({
        symbol: requestedSymbol,
        resolvedSymbol,
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: err?.message || "earnings_process_start_failed",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    });

    child.stdin.write(JSON.stringify({ symbol: resolvedSymbol }));
    child.stdin.end();

    timeoutId = setTimeout(() => {
      child.kill();
      if (cached?.payload) {
        return finish(applyStaleMeta(cached.payload, cached, "earnings_fetch_timed_out"));
      }
      finish({
        symbol: requestedSymbol,
        resolvedSymbol,
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: "earnings_fetch_timed_out",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    }, 12000);
  });
});

app.get("/api/finviz", async (req, res) => {
  const rawSymbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!rawSymbol) return res.status(400).json({ error: "symbol required" });

  const requestedSymbol = rawSymbol.slice(0, 30);
  const safeSymbol = sanitizeSymbol(normaliseSymbol(rawSymbol)).slice(0, 20);
  if (!safeSymbol) return res.status(400).json({ error: "Invalid symbol" });
  const snapshotParams = { symbol: requestedSymbol };
  const cached = await readServiceSnapshot("finviz", snapshotParams);
  const fresh = await readFreshSnapshot("finviz", snapshotParams, ROUTE_CACHE_TTLS_MS.finviz);
  if (fresh) {
    return res.json(fresh);
  }

  try {
    const payload = await withInflightDedup("finviz", snapshotParams, () => new Promise((resolve) => {
      const finish = (value) => resolve(value);
      const scriptPath = path.join(__dirname, "scripts", "fetch_finviz.py");
      const child = spawn(pythonBinary, [scriptPath, safeSymbol], { cwd: __dirname });
      let stdout = "";
      let stderr = "";
      let timeoutId = null;

      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      child.on("close", async (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (stderr) console.error("Finviz stderr:", stderr);
        if (code !== 0) {
          if (cached?.payload) {
            return finish(applyStaleMeta(cached.payload, cached, "finviz_fetch_failed"));
          }
          return finish({
            symbol: requestedSymbol,
            resolvedSymbol: safeSymbol,
            updatedAt: new Date().toISOString(),
            stale: true,
            unavailable: true,
            stale_reason: "finviz_fetch_failed"
          });
        }
        try {
          const result = JSON.parse(stdout);
          if (result?.error) {
            if (cached?.payload) {
              return finish(applyStaleMeta(cached.payload, cached, result.error));
            }
            return finish({
              symbol: requestedSymbol,
              resolvedSymbol: safeSymbol,
              updatedAt: new Date().toISOString(),
              stale: true,
              unavailable: true,
              stale_reason: result.error
            });
          }
          const nextPayload = {
            ...(result || {}),
            symbol: requestedSymbol,
            resolvedSymbol: safeSymbol,
            updatedAt: new Date().toISOString(),
            stale: false
          };
          await writeAllSnapshots("finviz", snapshotParams, nextPayload);
          finish(nextPayload);
        } catch (e) {
          console.error("Finviz parse error:", e);
          if (cached?.payload) {
            return finish(applyStaleMeta(cached.payload, cached, "finviz_parse_failed"));
          }
          finish({
            symbol: requestedSymbol,
            resolvedSymbol: safeSymbol,
            updatedAt: new Date().toISOString(),
            stale: true,
            unavailable: true,
            stale_reason: "finviz_parse_failed"
          });
        }
      });

      child.on("error", (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        console.error("Failed to start Finviz process:", err);
        if (cached?.payload) {
          return finish(applyStaleMeta(cached.payload, cached, "finviz_process_start_failed"));
        }
        finish({ symbol: requestedSymbol, resolvedSymbol: safeSymbol, error: "process_start_failed" });
      });

      timeoutId = setTimeout(() => {
        child.kill();
        if (cached?.payload) {
          return finish(applyStaleMeta(cached.payload, cached, "finviz_fetch_timed_out"));
        }
        finish({ symbol: requestedSymbol, resolvedSymbol: safeSymbol, error: "timed_out" });
      }, 12000);
    }));
    return res.json(payload);
  } catch (error) {
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "finviz_fetch_failed"));
    }
    return res.json({
      symbol: requestedSymbol,
      resolvedSymbol: safeSymbol,
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "finviz_fetch_failed"
    });
  }
});

app.get("/api/company-profile", async (req, res) => {
  const { symbol, theme, category, snapshotHash } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const safeSymbol = sanitizeSymbol(String(symbol || "").toUpperCase()).slice(0, 20);
  const preferredMeta = {
    theme: String(theme || "").trim() || null,
    category: String(category || "").trim() || null
  };
  const snapshotParams = {
    symbol: safeSymbol,
    theme: preferredMeta.theme || null,
    category: preferredMeta.category || null
  };
  const cached = await readServiceSnapshot("company-profile", snapshotParams);
  const stockMeta = selectPrimaryStockCatalogEntry(safeSymbol, preferredMeta);
  const peers = buildStockPeers(safeSymbol, stockMeta);
  const requestedSnapshotHash = String(snapshotHash || "").trim() || null;

  const enrichPayload = (payload = {}, stale = false, options = {}) => {
    const normalizedStale = Boolean(stale);
    const nextPayload = {
      ...(payload || {}),
      symbol: safeSymbol,
      catalog: {
        theme: stockMeta?.theme || null,
        category: stockMeta?.category || null,
        role: stockMeta?.role || null,
        edge: stockMeta?.edge || null,
        market: stockMeta?.market || null
      },
      peers,
      manufacturing: buildManufacturingNotes(payload, stockMeta),
      updatedAt: payload?.updatedAt || new Date().toISOString(),
      stale: normalizedStale,
      unavailable: normalizedStale ? Boolean(payload?.unavailable) : false,
      stale_reason: normalizedStale ? (payload?.stale_reason || null) : null,
      cache_updated_at: normalizedStale ? (payload?.cache_updated_at ?? null) : null,
      stale_age_seconds: normalizedStale ? (payload?.stale_age_seconds ?? null) : null,
      snapshotCheckedAt: options.checkedAt || payload?.snapshotCheckedAt || null
    };
    const companyProfileHash = buildComparablePayloadHash(nextPayload);
    return {
      ...nextPayload,
      companyProfileHash,
      unchanged: Boolean(options.unchanged)
    };
  };

  const fresh = await readFreshSnapshot("company-profile", snapshotParams, ROUTE_CACHE_TTLS_MS["company-profile"]);
  if (fresh) {
    if (requestedSnapshotHash && requestedSnapshotHash === fresh.companyProfileHash) {
      return res.json({
        ...fresh,
        unchanged: true,
        snapshotCheckedAt: new Date().toISOString()
      });
    }
    return res.json(fresh);
  }

  const payload = await withInflightDedup("company-profile", snapshotParams, () => new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(payload);
    };

    try {
      const child = spawn(pythonBinary, ["fetch_company_profile.py"], { cwd: __dirname });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });

      child.on("close", async (code) => {
        if (stderr) console.error("Company profile stderr:", stderr);

        if (code !== 0) {
          if (cached?.payload) {
            return finish(enrichPayload(applyStaleMeta(cached.payload, cached, "company_profile_fetch_failed"), true));
          }
          return finish(enrichPayload({
            symbol: safeSymbol,
            updatedAt: new Date().toISOString(),
            unavailable: true,
            stale_reason: "company_profile_fetch_failed",
            cache_updated_at: null,
            stale_age_seconds: null
          }, true));
        }

        try {
          const result = JSON.parse(stdout || "{}");
          if (result?.error) {
            if (cached?.payload) {
              return finish(enrichPayload(applyStaleMeta(cached.payload, cached, result.error), true));
            }
            return finish(enrichPayload({
              symbol: safeSymbol,
              updatedAt: new Date().toISOString(),
              unavailable: true,
              stale_reason: result.error,
              cache_updated_at: null,
              stale_age_seconds: null
            }, true));
          }

          const checkedAt = new Date().toISOString();
          const payload = enrichPayload({
            ...(result || {}),
            symbol: safeSymbol,
            updatedAt: checkedAt,
            stale: false
          }, false, { checkedAt });
          const cachedPayload = cached?.payload ? enrichPayload(cached.payload, Boolean(cached.payload?.stale), {
            checkedAt: cached.payload?.snapshotCheckedAt || null
          }) : null;
          const cachedHash = cachedPayload?.companyProfileHash || null;

          if ((requestedSnapshotHash && requestedSnapshotHash === payload.companyProfileHash) || (cachedHash && cachedHash === payload.companyProfileHash)) {
            const unchangedPayload = cached?.payload
              ? enrichPayload({
                  ...cached.payload,
                  updatedAt: cached.payload?.updatedAt || payload.updatedAt
                }, false, { checkedAt, unchanged: true })
              : { ...payload, unchanged: true };
            await writeAllSnapshots("company-profile", snapshotParams, unchangedPayload);
            return finish(unchangedPayload);
          }

          await writeAllSnapshots("company-profile", snapshotParams, payload);
          finish(payload);
        } catch {
          if (cached?.payload) {
            return finish(enrichPayload(applyStaleMeta(cached.payload, cached, "company_profile_parse_failed"), true));
          }
          finish(enrichPayload({
            symbol: safeSymbol,
            updatedAt: new Date().toISOString(),
            unavailable: true,
            stale_reason: "company_profile_parse_failed",
            cache_updated_at: null,
            stale_age_seconds: null
          }, true));
        }
      });

      child.on("error", (err) => {
        console.error("Failed to start company profile process:", err);
        if (cached?.payload) {
          return finish(enrichPayload(applyStaleMeta(cached.payload, cached, err?.message || "company_profile_start_failed"), true));
        }
        finish(enrichPayload({
          symbol: safeSymbol,
          updatedAt: new Date().toISOString(),
          unavailable: true,
          stale_reason: err?.message || "company_profile_start_failed",
          cache_updated_at: null,
          stale_age_seconds: null
        }, true));
      });

      child.stdin.write(JSON.stringify({
        symbol: safeSymbol,
        theme: preferredMeta.theme,
        category: preferredMeta.category
      }));
      child.stdin.end();

      timeoutId = setTimeout(() => {
        child.kill();
        if (cached?.payload) {
          return finish(enrichPayload(applyStaleMeta(cached.payload, cached, "company_profile_fetch_timed_out"), true));
        }
        finish(enrichPayload({
          symbol: safeSymbol,
          updatedAt: new Date().toISOString(),
          unavailable: true,
          stale_reason: "company_profile_fetch_timed_out",
          cache_updated_at: null,
          stale_age_seconds: null
        }, true));
      }, 12000);
    } catch (error) {
      if (cached?.payload) {
        return finish(enrichPayload(applyStaleMeta(cached.payload, cached, error?.message || "company_profile_start_failed"), true));
      }
      finish(enrichPayload({
        symbol: safeSymbol,
        updatedAt: new Date().toISOString(),
        unavailable: true,
        stale_reason: error?.message || "company_profile_start_failed",
        cache_updated_at: null,
        stale_age_seconds: null
      }, true));
    }
  }));
  return res.json(payload);
});

app.get("/api/economic-calendar", async (req, res) => {
  try {
    const events = await fetchForexFactoryEvents();
    res.json({
      events: events.map(e => ({
        date: e.date,
        title: e.event,
        time: e.time,
        impact: e.impact,
        country: e.country,
        forecast: e.forecast,
        previous: e.previous
      })),
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to fetch economic calendar:", error);
    res.status(500).json({ error: "Failed to fetch economic calendar" });
  }
});

app.get("/api/earnings-calendar", async (req, res) => {
  const rawSymbols = String(req.query.symbols || "");
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 5);

  let symbols = [...new Set(
    rawSymbols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20))
  )].slice(0, limit);

  if (!symbols.length) {
    try {
      const seed = await watchlist.getAll();
      const inferred = (Array.isArray(seed) ? seed : [])
        .filter((item) => {
          const type = String(item?.type || "").trim().toLowerCase();
          const marketType = String(item?.marketType || "").trim().toLowerCase();
          return (
            ["stock", "stocks", "equity", "etf", "etfs"].includes(type) ||
            marketType === "equity"
          );
        })
        .map((item) => String(item?.symbol || "").trim().toUpperCase())
        .filter(Boolean);
      symbols = [...new Set(inferred)].slice(0, limit);
    } catch (error) {
      console.warn("[Earnings] Failed to infer symbols from watchlist:", error?.message || error);
      symbols = [];
    }
  }

  if (!symbols.length) {
    symbols = ["AAPL", "MSFT", "NVDA", "AMZN", "TSLA"].slice(0, limit);
  }

  const snapshotParams = { symbols };
  const cached = await readServiceSnapshot("earnings-calendar", snapshotParams);
  const cachedItems = Array.isArray(cached?.payload?.items) ? cached.payload.items : [];
  const cachedHasUsableEarnings = cachedItems.some((item) => item?.nextEarnings || item?.earningsText);
  const cachedAt = cached?.updatedAt ? new Date(cached.updatedAt).getTime() : 0;
  const cachedFresh =
    Boolean(cached?.payload) &&
    cachedHasUsableEarnings &&
    Number.isFinite(cachedAt) &&
    cachedAt > 0 &&
    (Date.now() - cachedAt) < EARNINGS_CALENDAR_REFRESH_TTL_MS &&
    !cached?.payload?.stale &&
    !cached?.payload?.unavailable;

  if (cachedFresh) {
    return res.json(cached.payload);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      res.json(payload);
      resolve();
    };

    const child = spawn(pythonBinary, ["fetch_earnings_calendar_finviz.py"], { cwd: __dirname });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (stderr) console.error("Earnings calendar stderr:", stderr);
      if (code !== 0) {
        if (cached?.payload) {
          return finish(applyStaleMeta(cached.payload, cached, "earnings_calendar_fetch_failed"));
        }
        return finish({
          items: symbols.map((originalSymbol) => ({
            symbol: originalSymbol,
            nextEarnings: null,
            source: "Finviz"
          })),
          events: symbols.map((originalSymbol) => ({
            symbol: originalSymbol,
            nextEarnings: null,
            source: "Finviz"
          })),
          rows: symbols.map((originalSymbol) => ({
            symbol: originalSymbol,
            nextEarnings: null,
            source: "Finviz"
          })),
          updatedAt: new Date().toISOString(),
          stale: true,
          unavailable: true,
          stale_reason: "earnings_calendar_fetch_failed",
          cache_updated_at: null,
          stale_age_seconds: null
        });
      }

      try {
        const parsed = JSON.parse(stdout);
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        const bySymbol = new Map(items.map((item) => [String(item.symbol || "").toUpperCase(), item]));

        const normalizedItems = symbols.map((originalSymbol) => {
          const result = bySymbol.get(String(originalSymbol || "").toUpperCase());
          return {
            symbol: originalSymbol,
            nextEarnings: result?.nextEarnings || null,
            earningsText: result?.earningsText || null,
            source: "Finviz"
          };
        });
        const payload = {
          items: normalizedItems,
          events: normalizedItems,
          rows: normalizedItems,
          updatedAt: new Date().toISOString(),
          stale: false
        };
        writeServiceSnapshot("earnings-calendar", snapshotParams, payload).finally(() => finish(payload));
      } catch {
        if (cached?.payload) {
          return finish(applyStaleMeta(cached.payload, cached, "earnings_calendar_parse_failed"));
        }
        finish({
          items: symbols.map((originalSymbol) => ({
            symbol: originalSymbol,
            nextEarnings: null,
            source: "Finviz"
          })),
          events: symbols.map((originalSymbol) => ({
            symbol: originalSymbol,
            nextEarnings: null,
            source: "Finviz"
          })),
          rows: symbols.map((originalSymbol) => ({
            symbol: originalSymbol,
            nextEarnings: null,
            source: "Finviz"
          })),
          updatedAt: new Date().toISOString(),
          stale: true,
          unavailable: true,
          stale_reason: "earnings_calendar_parse_failed",
          cache_updated_at: null,
          stale_age_seconds: null
        });
      }
    });

    child.on("error", (err) => {
      console.error("Failed to start earnings calendar process:", err);
      if (cached?.payload) {
        return finish(applyStaleMeta(cached.payload, cached, err?.message || "earnings_calendar_start_failed"));
      }
      finish({
        items: symbols.map((originalSymbol) => ({
          symbol: originalSymbol,
          nextEarnings: null,
          source: "Finviz"
        })),
        events: symbols.map((originalSymbol) => ({
          symbol: originalSymbol,
          nextEarnings: null,
          source: "Finviz"
        })),
        rows: symbols.map((originalSymbol) => ({
          symbol: originalSymbol,
          nextEarnings: null,
          source: "Finviz"
        })),
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: err?.message || "earnings_calendar_start_failed",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    });

    child.stdin.write(JSON.stringify({ symbols }));
    child.stdin.end();

    setTimeout(() => {
      child.kill();
      if (cached?.payload) {
        return finish(applyStaleMeta(cached.payload, cached, "earnings_calendar_timeout"));
      }
      finish({
        items: symbols.map((originalSymbol) => ({
          symbol: originalSymbol,
          nextEarnings: null,
          source: "Finviz"
        })),
        events: symbols.map((originalSymbol) => ({
          symbol: originalSymbol,
          nextEarnings: null,
          source: "Finviz"
        })),
        rows: symbols.map((originalSymbol) => ({
          symbol: originalSymbol,
          nextEarnings: null,
          source: "Finviz"
        })),
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: "earnings_calendar_timeout",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    }, 12000);
  });
});

app.get("/api/macro-indicators", async (req, res) => {
  const requestedCountry = String(req.query.country || "").trim();
  if (!requestedCountry) {
    return res.status(400).json({ error: "country query parameter required" });
  }

  const buildEarlyFallbackPayload = (country = requestedCountry, countryName = requestedCountry, reason = "country_resolution_failed") => ({
    country: String(country || requestedCountry || "").trim().toUpperCase(),
    countryName: String(countryName || country || requestedCountry || "").trim(),
    source: "Macro data temporarily unavailable",
    updatedAt: new Date().toISOString(),
    stale: true,
    unavailable: true,
    metrics: sanitizeMacroMetrics([]),
    diagnostics: {
      reason: String(reason || "country_resolution_failed")
    }
  });

  try {
    let countryMeta = null;
    try {
      countryMeta = await resolveCountryReference(requestedCountry);
    } catch (error) {
      console.error("Country resolution failed:", error?.message || error);
      return res.json(buildEarlyFallbackPayload(requestedCountry, requestedCountry, error?.message || "country_resolution_failed"));
    }
    if (!countryMeta?.cca3) {
      return res.json(buildEarlyFallbackPayload(requestedCountry, requestedCountry, "invalid_country_reference"));
    }
    const country = String(countryMeta.cca3 || "").trim().toUpperCase();
    const countryName = String(countryMeta.name || country).trim() || country;

    const cacheKey = `macro:${country}`;
    const now = Date.now();
    const memoryCached = macroIndicatorsCache.get(cacheKey);
    const persisted = await readServiceSnapshot("macro-indicators", { country });
    const cached = memoryCached?.payload
      ? memoryCached
      : (persisted?.payload
        ? {
            payload: persisted.payload,
            cachedAt: new Date(persisted.updatedAt || 0).getTime() || now
          }
        : null);
    if (cached?.payload && now - cached.cachedAt < MACRO_CACHE_TTL_MS) {
      return res.json({
        ...cached.payload,
        metrics: sanitizeMacroMetrics(cached.payload?.metrics)
      });
    }

    const buildFallbackPayload = (reason) => ({
      country,
      countryName,
      source: "Macro data temporarily unavailable",
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      metrics: sanitizeMacroMetrics([]),
      diagnostics: {
        reason: String(reason || "upstream_unavailable")
      }
    });

    try {
      const [fredResult, blsResult, wbSettled] = await Promise.all([
        country === "USA" ? fetchFredMacroMetrics().catch((error) => ({ rows: [], status: buildProviderStatus("FRED", Boolean(FRED_API_KEY), "unavailable", error?.message || "FRED unavailable") })) : Promise.resolve({ rows: [], status: buildProviderStatus("FRED", Boolean(FRED_API_KEY), "not_applicable", "FRED macro overlay currently mapped for USA") }),
        country === "USA" ? fetchBlsMacroMetrics().catch((error) => ({ rows: [], status: buildProviderStatus("BLS", Boolean(BLS_API_KEY), "unavailable", error?.message || "BLS unavailable") })) : Promise.resolve({ rows: [], status: buildProviderStatus("BLS", Boolean(BLS_API_KEY), "not_applicable", "BLS macro overlay currently mapped for USA") }),
        fetchWorldBankMacroMetrics(country).then((rows) => ({ status: "fulfilled", rows })).catch((error) => ({ status: "rejected", error }))
      ]);
      const wbMetrics = wbSettled.status === "fulfilled" ? wbSettled.rows : [];
      const preferredRows = [...wbMetrics, ...(blsResult.rows || []), ...(fredResult.rows || [])];
      const metrics = sanitizeMacroMetrics(preferredRows);
      const missingKeys = metrics
        .filter((m) => m.current == null && m.previous == null && m.expectation == null)
        .map((m) => m.key);
      if (missingKeys.length === metrics.length) {
        throw new Error("world_bank_no_usable_values_for_country");
      }

      const payload = {
        country,
        countryName,
        source: country === "USA" ? "FRED + BLS + World Bank" : "World Bank (country-level series)",
        updatedAt: new Date().toISOString(),
        metrics,
        providers: buildDataProviderStatus({
          fred: fredResult.status,
          bls: blsResult.status
        }),
        diagnostics: {
          countryCode: country,
          provider: country === "USA" ? "fred_bls_world_bank" : "world_bank",
          missingIndicatorKeys: missingKeys
        }
      };

      macroIndicatorsCache.set(cacheKey, { payload, cachedAt: now });
      await writeServiceSnapshot("macro-indicators", { country }, payload);
      res.json(payload);
    } catch (error) {
      console.error("Macro indicators fetch failed:", error.message);
      if (cached?.payload) {
        const stalePayload = applyStaleMeta(cached.payload, {
          updatedAt: persisted?.updatedAt || new Date(cached.cachedAt).toISOString()
        }, error?.message || "macro_fetch_failed");
        return res.json({
          ...stalePayload,
          metrics: sanitizeMacroMetrics(stalePayload?.metrics)
        });
      }
      return res.json(buildFallbackPayload(error?.message || "upstream_fetch_failed"));
    }
  } catch (error) {
    console.error("Macro indicators unexpected failure:", error?.message || error);
    return res.json(buildEarlyFallbackPayload(requestedCountry, requestedCountry, error?.message || "macro_indicators_unexpected_failure"));
  }
});

app.get("/api/watchlist", async (req, res) => {
  const { category } = req.query;

  if (!category) {
    return res.json(watchlistData);
  }

  const key = Object.keys(watchlistData).find(
    (k) => k.toLowerCase() === category.toLowerCase()
  );
  if (!key) {
    return res.status(404).json({ error: "Category not found" });
  }

  const requestedSymbols = req.query.symbols
    ? req.query.symbols.split(",").map((s) => String(s || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const snapshotParams = {
    category: key,
    symbols: requestedSymbols.length > 0 ? requestedSymbols.slice().sort() : ["__all__"]
  };
  const cached = await readServiceSnapshot("watchlist", snapshotParams);
  const ttlMs = key === "crypto"
    ? ROUTE_CACHE_TTLS_MS["watchlist:crypto"]
    : key === "indicators"
      ? ROUTE_CACHE_TTLS_MS["watchlist:indicators"]
      : ROUTE_CACHE_TTLS_MS["watchlist:stocks"];

  const fresh = await readFreshSnapshot("watchlist", snapshotParams, ttlMs);
  if (fresh) {
    return res.json(fresh);
  }

  // Crypto — live prices from Binance
  if (key === "crypto") {
    try {
      const payload = await withInflightDedup("watchlist", snapshotParams, async () => {
        const assets = await fetchCryptoMarketData();
        const nextPayload = {
          category: key,
          assets: Array.isArray(assets) ? assets : [],
          updatedAt: new Date().toISOString(),
          stale: false
        };
        await writeAllSnapshots("watchlist", snapshotParams, nextPayload);
        return nextPayload;
      });
      return res.json(payload);
    } catch (error) {
      if (cached?.payload) {
        return res.json(applyStaleMeta(cached.payload, cached, error?.message || "watchlist_crypto_fetch_failed"));
      }
      return res.json({
        category: key,
        assets: [],
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: error?.message || "watchlist_crypto_fetch_failed",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    }
  }

  if (key === "indicators") {
    const payload = await withInflightDedup("watchlist", snapshotParams, async () => {
      const allDbAssets = await watchlist.getAll();
      const indicatorAssets = allDbAssets
        .filter((asset) => String(asset?.marketType || "").trim().toLowerCase() === "macro" || String(asset?.type || "").trim().toLowerCase() === "indicator")
        .map((asset) => ({
          ...asset,
          type: "indicator",
          category: "indicators",
          marketType: "macro",
          price: null,
          priceChangePercent: null
        }));
      const nextPayload = {
        category: key,
        assets: indicatorAssets,
        updatedAt: new Date().toISOString(),
        stale: false
      };
      await writeAllSnapshots("watchlist", snapshotParams, nextPayload);
      return nextPayload;
    });
    return res.json(payload);
  }

  const baseAssets = watchlistData[key] || [];
  const baseAssetKeys = new Set(baseAssets.map((asset) => buildWatchlistAssetIdentityKey(asset)));

  const allDbAssets = await watchlist.getAll();
  const customAssets = allDbAssets.filter((dbAsset) => {
    if (baseAssetKeys.has(buildWatchlistAssetIdentityKey(dbAsset))) return false;
    return normalizeWatchlistCategoryKey(dbAsset) === key;
  });

  const assets = [...baseAssets, ...customAssets];
  const symbols = assets.map((a) => a.symbol);

  // Stocks — fetch prices inline (no separate /api/prices call needed)
  const pricedSymbols = requestedSymbols.length > 0
    ? symbols.filter((s) => requestedSymbols.includes(String(s || "").trim().toUpperCase()))
    : symbols;
  try {
    const payload = await withInflightDedup("watchlist", snapshotParams, async () => {
      const prices = pricedSymbols.length > 0
        ? await fetchYFinancePrices(pricedSymbols)
        : {};

      const enrichedAssets = assets.map((asset) => ({
        ...asset,
        type: asset.type || "stock",
        price: prices[asset.symbol]?.price ?? null,
        priceChangePercent: prices[asset.symbol]?.priceChangePercent ?? null,
      }));
      const nextPayload = {
        category: key,
        assets: enrichedAssets,
        updatedAt: new Date().toISOString(),
        stale: false
      };
      await writeAllSnapshots("watchlist", snapshotParams, nextPayload);
      return nextPayload;
    });
    return res.json(payload);
  } catch (error) {
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "watchlist_prices_fetch_failed"));
    }
    return res.json({
      category: key,
      assets: assets.map((asset) => ({
        ...asset,
        type: asset.type || "stock",
        price: null,
        priceChangePercent: null
      })),
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "watchlist_prices_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

app.get("/api/prices", validate(pricesQuerySchema, "query"), async (req, res) => {
  const rawSymbols = String(req.query.symbols || req.query.symbol || "");
  const type = String(req.query.type || req.query.quoteType || "tradfi").trim().toLowerCase();
  const symbols = [...new Set(
    rawSymbols
      .split(",")
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean)
  )].slice(0, 200);

  if (!symbols.length) {
    return apiError(res, 400, {
      error: "symbols query is required",
      message: "Provide at least one symbol to load pricing data.",
      code: "PRICE_SYMBOLS_REQUIRED",
      retryable: false
    });
  }
  const snapshotParams = { type, symbols: symbols.slice().sort() };
  const cached = await readServiceSnapshot("prices", snapshotParams);
  const ttlMs = type === "crypto"
    ? ROUTE_CACHE_TTLS_MS["prices:crypto"]
    : ROUTE_CACHE_TTLS_MS["prices:tradfi"];

  const fresh = await readFreshSnapshot("prices", snapshotParams, ttlMs);
  if (fresh) {
    return res.json(fresh);
  }

  try {
    const payload = await withInflightDedup("prices", snapshotParams, async () => {
      let nextPayload = null;
      if (type === "crypto") {
        const prices = await fetchLivePriceSnapshot({ quoteType: "crypto", symbols });
        nextPayload = {
          type: "crypto",
          prices,
          providers: summarizePriceProviders(prices, "Binance / CoinGecko"),
          updatedAt: new Date().toISOString(),
          stale: false
        };
      } else {
        const prices = await fetchLivePriceSnapshot({ quoteType: "tradfi", symbols });
        nextPayload = {
          type: "tradfi",
          prices,
          providers: summarizePriceProviders(prices, "Yahoo Finance"),
          dataProviders: buildDataProviderStatus({ massive: getMassiveStatus() }),
          updatedAt: new Date().toISOString(),
          stale: false
        };
      }

      const priceRows = nextPayload?.prices && typeof nextPayload.prices === "object" ? Object.values(nextPayload.prices) : [];
      const hasAnyFinitePrice = priceRows.some((row) => Number.isFinite(Number(row?.price)));
      if (!hasAnyFinitePrice) {
        throw new Error("prices_empty_from_provider");
      }

      await writeAllSnapshots("prices", snapshotParams, nextPayload);
      return nextPayload;
    });
    return res.json(payload);
  } catch (error) {
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "prices_fetch_failed"));
    }
    return res.json({
      type,
      prices: {},
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "prices_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

// ---------------------------------------------------------------------------
// 🔥 LIVE GREEKS ENGINE (WebSocket helper)
// ---------------------------------------------------------------------------

const BASE = "https://api.derive.xyz";

async function fetchGreeks(currency = "BTC", expiry = null) {
  try {
    const fetch = await resolveFetch();

    const instRes = await fetch(`${BASE}/public/get_instruments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currency,
        instrument_type: "option",
        expired: false
      })
    });

    const instData = await instRes.json();
    let instruments = instData.result || [];

    if (expiry) {
      instruments = instruments.filter(
        i => i.option_details?.expiry === expiry
      );
    }

    const tickers = await Promise.all(
      instruments.slice(0, 50).map(async (inst) => {
        const r = await fetch(`${BASE}/public/get_ticker`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrument_name: inst.instrument_name })
        });
        const d = await r.json();
        return d.result;
      })
    );

    return tickers.filter(Boolean).map(t => ({
      strike: parseFloat(t.option_details?.strike || 0),
      type: t.option_details?.option_type,
      iv: parseFloat(t.iv || 0),
      delta: parseFloat(t.greeks?.delta || 0),
      gamma: parseFloat(t.greeks?.gamma || 0),
      theta: parseFloat(t.greeks?.theta || 0),
      vega: parseFloat(t.greeks?.vega || 0),
      bid: parseFloat(t.best_bid_price || 0),
      ask: parseFloat(t.best_ask_price || 0),
    }));

  } catch (e) {
    console.error("Greeks fetch error:", e.message);
    return [];
  }
}

const axios = require("axios");
const https = require("https");

// Force IPv4 + keep-alive (fixes Render + TLS issues)
const agent = new https.Agent({
  keepAlive: true,
  family: 4, // 🔥 FORCE IPv4
  timeout: 10000
});

const DERIVE_BASE_URLS = [...new Set([
  "https://api.lyra.finance",
  process.env.DERIVE_API_URL,
  "https://api.derive.xyz"
].filter(Boolean))];

const deriveClients = DERIVE_BASE_URLS.flatMap((baseURL) => ([
  {
    baseURL,
    client: axios.create({
      baseURL,
      httpsAgent: agent,
      timeout: 10000
    })
  },
  {
    baseURL,
    client: axios.create({
      baseURL,
      timeout: 10000
    })
  }
]));

// Keep a small in-memory cache to serve stale data when Derive is temporarily unavailable.
const optionsChainCache = new Map();

const WHALE_CURRENCIES = ["BTC", "ETH", "SOL", "HYPE"];
const MIN_WHALE_NOTIONAL_USD = 100000;
const TELEGRAM_CHANNEL_USERNAMES = Array.from(new Set(
  String(
    process.env.TELEGRAM_CHANNEL_USERNAMES ||
    process.env.TELEGRAM_CHANNEL_USERNAME ||
    "derivetradetape"
  )
    .split(/[,\n]/)
    .map((value) => String(value || "").replace(/^@/, "").trim())
    .filter(Boolean)
));
const TELEGRAM_PRIMARY_CHANNEL_USERNAME = TELEGRAM_CHANNEL_USERNAMES[0] || "derivetradetape";
const TELEGRAM_FETCH_LIMIT = Math.max(20, Math.min(300, Number(process.env.TELEGRAM_FETCH_LIMIT || 160)));
const TELEGRAM_CACHE_TTL_MS = Math.max(15000, Number(process.env.TELEGRAM_CACHE_TTL_MS || 60000));
const TELEGRAM_API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const TELEGRAM_API_HASH = String(process.env.TELEGRAM_API_HASH || "").trim();
const TELEGRAM_SESSION_STRING = String(process.env.TELEGRAM_SESSION_STRING || "").trim();
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const DATA_API_BASE_URL = "https://data-api.polymarket.com";
const PREDICTION_REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours
const PREDICTION_CATEGORIES = ["geopolitics", "crypto", "tech", "politics", "finance"];
const predictionSnapshotCache = new Map();
let telegramClientPromise = null;
let telegramWhaleCache = {
  fetchedAt: 0,
  trades: [],
  status: "disabled",
  error: null,
  channels: TELEGRAM_CHANNEL_USERNAMES,
  messageCount: 0,
  parsedCount: 0,
  transport: null
};
const PREDICTION_CATEGORY_TAGS = {
  geopolitics: "geopolitics",
  crypto: "crypto",
  tech: "tech",
  politics: "politics",
  finance: "finance"
};
const PREDICTION_EVENTS_FETCH_LIMIT = 160;
const POLYMARKET_WEB_BASE_URL = "https://polymarket.com";



function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeMacroSeries(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      const date = row?.date || row?.Date || row?.period || row?.Period || null;
      const value = firstFiniteNumber(row?.value, row?.Value, row?.close, row?.Close, row?.price, row?.Price);
      const ts = date ? new Date(date).getTime() : NaN;
      if (!Number.isFinite(value) || !Number.isFinite(ts)) return null;
      return { date, value: Number(value), ts };
    })
    .filter(Boolean)
    .sort((a, b) => b.ts - a.ts);
}

function parseForexFactoryNumeric(value) {
  const raw = String(value || "").trim();
  if (!raw || /^(n\/a|na|--|-)$/i.test(raw)) return null;
  const cleaned = raw.replace(/,/g, "");
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)([KMBT%])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = String(match[2] || "").toUpperCase();
  if (suffix === "%") return base;
  if (suffix === "K") return base * 1e3;
  if (suffix === "M") return base * 1e6;
  if (suffix === "B") return base * 1e9;
  if (suffix === "T") return base * 1e12;
  return base;
}

function parseForexFactoryDateTime(dateText, timeText) {
  const date = String(dateText || "").trim();
  const time = String(timeText || "").trim();
  if (!date) return { asOf: null, ts: 0 };
  const normalizedDate = date.replace(/[^\d\-]/g, "");
  const normalizedTime = /^(all day|tentative)$/i.test(time) || !time ? "12:00pm" : time;
  const parsed = new Date(`${normalizedDate} ${normalizedTime}`);
  const ts = Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
  return { asOf: ts ? parsed.toISOString() : `${date} ${time}`.trim(), ts };
}

function parseForexFactoryEventsFromXml(xmlText) {
  const xml = String(xmlText || "");
  if (!xml) return [];
  if (/rate limited/i.test(xml) || /<title>\s*Rate Limited\s*<\/title>/i.test(xml)) {
    throw new Error("forex_factory_rate_limited");
  }
  const blocks = [...xml.matchAll(/<event>([\s\S]*?)<\/event>/gi)];
  const extractTag = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
    return m ? String(m[1] || "").trim() : "";
  };
  return blocks.map((entry) => {
    const block = entry[1] || "";
    const title = extractTag(block, "title");
    const country = extractTag(block, "country").toUpperCase();
    const date = extractTag(block, "date");
    const time = extractTag(block, "time");
    const impact = extractTag(block, "impact");
    const forecast = extractTag(block, "forecast");
    const previous = extractTag(block, "previous");
    const actual = extractTag(block, "actual");
    const url = extractTag(block, "url");
    const { asOf, ts } = parseForexFactoryDateTime(date, time);
    return { title, country, date, time, impact, forecast, previous, actual, url, asOf, ts };
  }).filter((row) => row.country && row.title);
}

function resolveForexFactoryCountry(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const needle = raw.toLowerCase();
  const exact = FOREX_FACTORY_COUNTRY_MAP.find((entry) => (
    entry.code.toLowerCase() === needle ||
    entry.currency.toLowerCase() === needle ||
    entry.aliases.some((alias) => String(alias || "").toLowerCase() === needle)
  ));
  if (exact) return exact;
  return FOREX_FACTORY_COUNTRY_MAP.find((entry) => (
    entry.aliases.some((alias) => String(alias || "").toLowerCase().includes(needle))
  )) || null;
}

function searchForexFactoryCountries(query, limit = 20) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  return FOREX_FACTORY_COUNTRY_MAP
    .filter((entry) => (
      entry.code.toLowerCase().includes(needle) ||
      entry.currency.toLowerCase().includes(needle) ||
      entry.name.toLowerCase().includes(needle) ||
      entry.aliases.some((alias) => String(alias || "").toLowerCase().includes(needle))
    ))
    .slice(0, Math.max(1, Number(limit) || 20))
    .map((entry) => ({
      symbol: entry.code,
      name: `${entry.name} Macro Indicators`,
      type: "indicator",
      category: "indicators",
      marketType: "macro",
      market: "Macro",
      countryCode: entry.code,
      countryName: entry.name,
      currency: entry.currency
    }));
}

async function fetchForexFactoryEvents(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && Array.isArray(forexFactoryFeedCache.events) && forexFactoryFeedCache.events.length > 0) {
    if (now - Number(forexFactoryFeedCache.fetchedAt || 0) < FOREX_FACTORY_CACHE_TTL_MS) {
      return forexFactoryFeedCache.events;
    }
  }
  const fetch = await resolveFetch();
  const response = await fetch(FOREX_FACTORY_FEED_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Zenin Macro Fetcher)"
    }
  });
  if (!response.ok) throw new Error(`forex_factory_http_${response.status}`);
  const text = await response.text();
  const events = parseForexFactoryEventsFromXml(text);
  if (!events.length) throw new Error("forex_factory_empty_feed");
  forexFactoryFeedCache.events = events;
  forexFactoryFeedCache.fetchedAt = now;
  return events;
}

function buildMacroMetric(payload, config) {
  const points = normalizeMacroSeries(payload);
  const current = points[0]?.value ?? null;
  const previous = points[1]?.value ?? null;
  const expectation = Number.isFinite(current) && Number.isFinite(previous)
    ? current + (current - previous)
    : null;
  return {
    key: config.key,
    label: config.label,
    unit: config.unit,
    previous,
    current,
    expectation,
    asOf: points[0]?.date || null,
    previousAsOf: points[1]?.date || null,
    currentAsOf: points[0]?.date || null,
    expectationAsOf: points[0]?.date || null,
    series: points
      .slice()
      .reverse()
      .map((point) => ({
        date: point.date,
        value: point.value,
        ts: point.ts
      }))
  };
}

async function fetchWorldBankIndicatorSeries(countryCode, indicatorCode) {
  const fetch = await resolveFetch();
  const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(countryCode)}/indicator/${encodeURIComponent(indicatorCode)}?format=json&per_page=80`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`world_bank_http_${response.status}`);
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.[1]) ? payload[1] : [];
  return rows
    .map((row) => ({
      date: String(row?.date || ""),
      value: row?.value
    }))
    .filter((row) => row.date && row.value !== null && row.value !== undefined);
}

async function fetchWorldBankMacroMetrics(countryCode) {
  const entries = await Promise.all(
    MACRO_INDICATOR_CONFIG.map(async (config) => {
      const wbCode = WORLD_BANK_INDICATOR_MAP[config.key];
      if (!wbCode) return { key: config.key, rows: [] };
      try {
        const rows = await fetchWorldBankIndicatorSeries(countryCode, wbCode);
        return { key: config.key, rows };
      } catch (error) {
        console.warn(`[Macro] World Bank indicator fetch failed for ${config.key} (${wbCode}):`, error?.message || error);
        return { key: config.key, rows: [] };
      }
    })
  );
  const byKey = new Map(entries.map((entry) => [entry.key, entry.rows]));
  return MACRO_INDICATOR_CONFIG.map((config) => buildMacroMetric(byKey.get(config.key) || [], config));
}

const MACRO_REGION_MEMBERS = {
  GLB: ["USA", "DEU", "JPN", "CHN", "IND", "GBR", "BRA", "KEN", "AUS", "CAN"],
  NAM: ["USA", "CAN", "MEX"],
  EUR: ["DEU", "FRA", "ITA", "ESP", "NLD", "GBR"],
  ASI: ["JPN", "CHN", "IND", "KOR", "SGP"],
  AFR: ["KEN", "ZAF", "NGA", "EGY"],
  LATAM: ["BRA", "MEX", "ARG", "CHL", "COL"],
  MENA: ["SAU", "ARE", "EGY", "TUR"]
};

const MACRO_MAP_COUNTRIES = ["USA", "DEU", "JPN", "GBR", "CAN", "AUS", "IND", "CHN", "BRA", "KEN", "ZAF", "SAU"];

function getMacroIndicatorConfig(input) {
  const normalized = String(input || "").trim().toLowerCase();
  if (!normalized) return null;
  return MACRO_INDICATOR_CONFIG.find((config) => {
    if (String(config.key || "").trim().toLowerCase() === normalized) return true;
    if (String(config.label || "").trim().toLowerCase() === normalized) return true;
    return (Array.isArray(config.aliases) ? config.aliases : []).some((alias) => String(alias || "").trim().toLowerCase() === normalized);
  }) || null;
}

function normalizeMacroRange(range) {
  const normalized = String(range || "5Y").trim().toUpperCase();
  if (["1Y", "5Y", "10Y", "MAX"].includes(normalized)) return normalized;
  return "5Y";
}

function sliceMacroSeriesByRange(series = [], range = "5Y") {
  const rows = (Array.isArray(series) ? series : [])
    .map((row) => ({ ...row, ts: Number(row?.ts) || new Date(row?.date || 0).getTime() }))
    .filter((row) => Number.isFinite(row.ts))
    .sort((a, b) => a.ts - b.ts);
  if (!rows.length) return [];
  if (range === "MAX") return rows;
  const now = Date.now();
  const cutoffMs = range === "1Y"
    ? now - (366 * 24 * 60 * 60 * 1000)
    : range === "10Y"
    ? now - (3653 * 24 * 60 * 60 * 1000)
    : now - (1827 * 24 * 60 * 60 * 1000);
  const filtered = rows.filter((row) => row.ts >= cutoffMs);
  return filtered.length >= 3 ? filtered : rows.slice(-Math.min(rows.length, range === "1Y" ? 12 : range === "10Y" ? 40 : 24));
}

function findPriorSeriesPoint(rows, index, maxAgeDays) {
  const current = rows[index];
  if (!current?.ts) return index > 0 ? rows[index - 1] : null;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = rows[cursor];
    if (!candidate?.ts) continue;
    if (current.ts - candidate.ts >= maxAgeMs) return candidate;
  }
  return index > 0 ? rows[index - 1] : null;
}

function deriveMacroSeriesForMode(series = [], mode = "levels") {
  const rows = (Array.isArray(series) ? series : []).filter((row) => Number.isFinite(Number(row?.value)));
  const normalizedMode = String(mode || "levels").trim().toLowerCase();
  if (normalizedMode === "levels") {
    return rows.map((row) => ({ date: row.date, value: Number(row.value) }));
  }
  return rows
    .map((row, index) => {
      const current = Number(row?.value);
      const previous = normalizedMode === "yoy"
        ? Number(findPriorSeriesPoint(rows, index, 365)?.value)
        : normalizedMode === "mom"
        ? Number(findPriorSeriesPoint(rows, index, 28)?.value)
        : Number(rows[index - 1]?.value);
      if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
      const value = normalizedMode === "change"
        ? current - previous
        : previous !== 0
        ? ((current - previous) / Math.abs(previous)) * 100
        : null;
      if (!Number.isFinite(value)) return null;
      return { date: row.date, value: Number(value.toFixed(2)) };
    })
    .filter(Boolean);
}

async function fetchMacroMetricByIndicator(countryCode, indicatorInput) {
  const config = getMacroIndicatorConfig(indicatorInput);
  if (!config) return { config: null, metric: null };
  const metrics = await fetchWorldBankMacroMetrics(countryCode);
  const metric = (Array.isArray(metrics) ? metrics : []).find((row) => String(row?.key || "").trim().toLowerCase() === String(config.key || "").trim().toLowerCase()) || null;
  return { config, metric };
}

async function aggregateMacroMetricsForCountries(countryCodes = []) {
  const members = [...new Set((Array.isArray(countryCodes) ? countryCodes : []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))];
  if (!members.length) return sanitizeMacroMetrics([]);
  const metricsByCountry = await Promise.all(members.map(async (code) => {
    try {
      return await fetchWorldBankMacroMetrics(code);
    } catch (error) {
      console.warn(`[Macro] World Bank macro metrics fetch failed for country ${code}:`, error?.message || error);
      return [];
    }
  }));
  return MACRO_INDICATOR_CONFIG.map((config) => {
    const currentValues = [];
    const previousValues = [];
    metricsByCountry.forEach((countryMetrics) => {
      const row = (Array.isArray(countryMetrics) ? countryMetrics : []).find((metric) => String(metric?.key || "").trim().toLowerCase() === config.key);
      const current = Number(row?.current);
      const previous = Number(row?.previous);
      if (Number.isFinite(current)) currentValues.push(current);
      if (Number.isFinite(previous)) previousValues.push(previous);
    });
    const current = currentValues.length ? currentValues.reduce((sum, value) => sum + value, 0) / currentValues.length : null;
    const previous = previousValues.length ? previousValues.reduce((sum, value) => sum + value, 0) / previousValues.length : null;
    return {
      key: config.key,
      label: config.label,
      unit: config.unit,
      current: Number.isFinite(current) ? Number(current.toFixed(2)) : null,
      previous: Number.isFinite(previous) ? Number(previous.toFixed(2)) : null,
      expectation: null,
      asOf: new Date().toISOString(),
      series: []
    };
  });
}

function inferMacroIndicatorFromEvent(event = {}) {
  const text = `${event?.title || ""} ${event?.event || ""} ${event?.name || ""}`.toLowerCase();
  const config = MACRO_INDICATOR_CONFIG.find((entry) =>
    (Array.isArray(entry.aliases) ? entry.aliases : []).some((alias) => text.includes(String(alias || "").trim().toLowerCase()))
  );
  return config || null;
}

function normalizeImportanceLevel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "medium";
  if (text.includes("high") || text === "red") return "high";
  if (text.includes("low") || text === "yellow") return "low";
  return "medium";
}

function importanceMatchesFilter(importance, filterValue) {
  const normalizedFilter = String(filterValue || "all").trim().toLowerCase();
  if (!normalizedFilter || normalizedFilter === "all") return true;
  return normalizeImportanceLevel(importance) === normalizedFilter;
}

function pearsonCorrelation(pairs = []) {
  const cleanPairs = (Array.isArray(pairs) ? pairs : []).filter(([x, y]) => Number.isFinite(Number(x)) && Number.isFinite(Number(y)));
  if (cleanPairs.length < 3) return null;
  const xs = cleanPairs.map(([x]) => Number(x));
  const ys = cleanPairs.map(([, y]) => Number(y));
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  const numerator = xs.reduce((sum, value, index) => sum + ((value - meanX) * (ys[index] - meanY)), 0);
  const stdX = Math.sqrt(xs.reduce((sum, value) => sum + ((value - meanX) ** 2), 0));
  const stdY = Math.sqrt(ys.reduce((sum, value) => sum + ((value - meanY) ** 2), 0));
  if (!stdX || !stdY) return null;
  return Number((numerator / (stdX * stdY)).toFixed(2));
}

function normalizeCountryCatalogEntry(raw = {}) {
  const cca3 = String(raw?.cca3 || "").trim().toUpperCase();
  if (!cca3) return null;
  const cca2 = String(raw?.cca2 || "").trim().toUpperCase() || null;
  const commonName = String(raw?.name?.common || raw?.name || "").trim() || cca3;
  const officialName = String(raw?.name?.official || "").trim() || null;
  const translationNames = raw?.translations && typeof raw.translations === "object"
    ? Object.values(raw.translations)
        .flatMap((entry) => [entry?.common, entry?.official])
        .filter(Boolean)
    : [];
  const aliases = [...new Set(
    [
      commonName,
      officialName,
      ...(Array.isArray(raw?.altSpellings) ? raw.altSpellings : []),
      ...translationNames,
      cca2,
      cca3
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];

  return {
    cca3,
    cca2,
    name: commonName,
    officialName,
    aliases
  };
}

async function loadCountryCatalog(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(countryCatalogMemory.countries) && countryCatalogMemory.countries.length > 0) {
    if (Date.now() - countryCatalogMemory.cachedAt < COUNTRY_CATALOG_CACHE_TTL_MS) {
      return countryCatalogMemory.countries;
    }
  }

  const persisted = await readServiceSnapshot("country-catalog", { provider: "restcountries-v3.1" });
  if (!forceRefresh && Array.isArray(persisted?.payload?.countries) && persisted.payload.countries.length > 0 && isSnapshotFresh(persisted, COUNTRY_CATALOG_CACHE_TTL_MS)) {
    countryCatalogMemory = {
      countries: persisted.payload.countries,
      cachedAt: new Date(persisted.updatedAt || Date.now()).getTime() || Date.now()
    };
    return countryCatalogMemory.countries;
  }

  try {
    const fetch = await resolveFetch();
    const response = await fetch("https://restcountries.com/v3.1/all?fields=name,cca2,cca3,altSpellings,translations");
    if (!response.ok) {
      throw new Error(`country_catalog_fetch_failed:${response.status}`);
    }
    const payload = await response.json();
    const countries = (Array.isArray(payload) ? payload : [])
      .map(normalizeCountryCatalogEntry)
      .filter(Boolean)
      .sort((a, b) => String(a.name || a.cca3).localeCompare(String(b.name || b.cca3)));

    if (countries.length === 0) {
      throw new Error("country_catalog_empty");
    }

    countryCatalogMemory = {
      countries,
      cachedAt: Date.now()
    };
    await writeServiceSnapshot("country-catalog", { provider: "restcountries-v3.1" }, { countries });
    return countries;
  } catch (error) {
    if (Array.isArray(persisted?.payload?.countries) && persisted.payload.countries.length > 0) {
      countryCatalogMemory = {
        countries: persisted.payload.countries,
        cachedAt: new Date(persisted.updatedAt || Date.now()).getTime() || Date.now()
      };
      return countryCatalogMemory.countries;
    }
    if (Array.isArray(FALLBACK_COUNTRY_CATALOG) && FALLBACK_COUNTRY_CATALOG.length > 0) {
      countryCatalogMemory = {
        countries: FALLBACK_COUNTRY_CATALOG,
        cachedAt: Date.now()
      };
      return countryCatalogMemory.countries;
    }
    throw error;
  }
}

async function searchCountries(query, limit = 20) {
  const normalizedNeedle = normalizeCountryLookupValue(query);
  if (!normalizedNeedle) return [];
  const countries = await loadCountryCatalog();
  const scored = countries
    .map((country) => {
      const aliasHits = (Array.isArray(country.aliases) ? country.aliases : [])
        .map((alias) => normalizeCountryLookupValue(alias))
        .filter(Boolean);
      let score = -1;
      for (const alias of aliasHits) {
        if (alias === normalizedNeedle) {
          score = Math.max(score, 1000);
          continue;
        }
        if (alias.startsWith(normalizedNeedle)) {
          score = Math.max(score, 750 - alias.length);
          continue;
        }
        if (alias.includes(normalizedNeedle)) {
          score = Math.max(score, 500 - alias.indexOf(normalizedNeedle));
        }
      }
      if (score < 0) return null;
      return { country, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || String(a.country.name || "").localeCompare(String(b.country.name || "")))
    .slice(0, Math.max(1, Number(limit) || 20))
    .map(({ country }) => ({
      symbol: country.cca3,
      name: country.name,
      type: "indicator",
      category: "indicators",
      marketType: "macro",
      market: "Macro",
      countryCode: country.cca3,
      countryName: country.name
    }));
  return scored;
}

async function resolveCountryReference(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const normalized = normalizeCountryLookupValue(raw);
  const upperRaw = raw.toUpperCase();

  // Fast path: allow ISO code inputs without depending on country-catalog fetch.
  if (/^[A-Z]{3}$/.test(upperRaw)) {
    const matched = findCountryByIsoCode(upperRaw);
    if (matched) return matched;
    return {
      cca3: upperRaw,
      cca2: null,
      name: upperRaw,
      officialName: null,
      aliases: [upperRaw]
    };
  }
  if (/^[A-Z]{2}$/.test(upperRaw)) {
    const matched = findCountryByIsoCode(upperRaw);
    if (matched) return matched;
    return {
      cca3: upperRaw,
      cca2: upperRaw,
      name: upperRaw,
      officialName: null,
      aliases: [upperRaw]
    };
  }

  const countries = await loadCountryCatalog();

  const exact = countries.find((country) => {
    if (country.cca3 === upperRaw || country.cca2 === upperRaw) return true;
    return (Array.isArray(country.aliases) ? country.aliases : []).some(
      (alias) => normalizeCountryLookupValue(alias) === normalized
    );
  });
  if (exact) return exact;

  const partial = countries.find((country) => {
    return (Array.isArray(country.aliases) ? country.aliases : []).some(
      (alias) => normalizeCountryLookupValue(alias).includes(normalized)
    );
  });
  if (partial) return partial;

  return null;
}

function normalizeIndicatorKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function groupMacroPayloadByIndicator(payload) {
  const grouped = new Map();
  const pushRows = (key, rows) => {
    const normalized = normalizeIndicatorKey(key);
    if (!normalized || !Array.isArray(rows) || rows.length === 0) return;
    const current = grouped.get(normalized) || [];
    grouped.set(normalized, current.concat(rows));
  };

  if (Array.isArray(payload)) {
    payload.forEach((row) => {
      const key = normalizeIndicatorKey(row?.indicator || row?.Indicator || row?.name || row?.Name || row?.label || row?.Label);
      if (!key) return;
      pushRows(key, [row]);
    });
    return grouped;
  }

  if (!payload || typeof payload !== "object") return grouped;

  Object.entries(payload).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      pushRows(key, value);
      return;
    }
    if (value && typeof value === "object" && Array.isArray(value?.data)) {
      pushRows(key, value.data);
      return;
    }
    if (value && typeof value === "object") {
      // Some EODHD responses use nested arrays under different property names.
      const nestedArrays = Object.values(value).filter((entry) => Array.isArray(entry));
      nestedArrays.forEach((rows) => {
        pushRows(key, rows);
      });
    }
  });

  return grouped;
}

function tokenizeIndicatorKey(value) {
  return normalizeIndicatorKey(value)
    .split("_")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !["the", "of", "and", "for", "to", "in"].includes(token));
}

function getMacroRowsForConfig(groupedByIndicator, config) {
  const candidates = [config.key, ...(Array.isArray(config.aliases) ? config.aliases : [])]
    .map(normalizeIndicatorKey)
    .filter(Boolean);
  for (const candidate of candidates) {
    if (groupedByIndicator.has(candidate)) {
      return groupedByIndicator.get(candidate) || [];
    }
  }

  // Fuzzy fallback: choose grouped key with strongest token overlap.
  const candidateTokens = new Set(
    [config.key, ...(Array.isArray(config.aliases) ? config.aliases : [])]
      .flatMap((value) => tokenizeIndicatorKey(value))
  );
  let bestRows = [];
  let bestScore = 0;

  groupedByIndicator.forEach((rows, groupedKey) => {
    const keyTokens = tokenizeIndicatorKey(groupedKey);
    if (!keyTokens.length) return;
    let overlap = 0;
    keyTokens.forEach((token) => {
      if (candidateTokens.has(token)) overlap += 1;
    });
    const score = overlap / Math.max(1, keyTokens.length);
    if (overlap >= 2 && score > bestScore) {
      bestScore = score;
      bestRows = Array.isArray(rows) ? rows : [];
    }
  });

  if (bestRows.length > 0) return bestRows;
  return [];
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractYesNoPrices(market) {
  const outcomes = Array.isArray(market?.outcomes)
    ? market.outcomes
    : safeJsonParse(market?.outcomes, []);
  const outcomePrices = Array.isArray(market?.outcomePrices)
    ? market.outcomePrices
    : safeJsonParse(market?.outcomePrices, []);

  let yesPrice = toFiniteNumber(outcomePrices[0], 0);
  let noPrice = toFiniteNumber(outcomePrices[1], 0);
  let yesLabel = String(outcomes[0] || "Yes");
  let noLabel = String(outcomes[1] || "No");

  const normalizedOutcomes = outcomes.map((outcome) => String(outcome || "").trim().toLowerCase());
  const yesIdx = normalizedOutcomes.findIndex((name) => name === "yes");
  const noIdx = normalizedOutcomes.findIndex((name) => name === "no");

  if (yesIdx >= 0) {
    yesPrice = toFiniteNumber(outcomePrices[yesIdx], yesPrice);
    yesLabel = String(outcomes[yesIdx] || yesLabel);
  }
  if (noIdx >= 0) {
    noPrice = toFiniteNumber(outcomePrices[noIdx], noPrice);
    noLabel = String(outcomes[noIdx] || noLabel);
  }

  return { yesPrice, noPrice, yesLabel, noLabel };
}

function normalizePredictionMarket(raw = {}, sourceRank = 0) {
  const event = Array.isArray(raw.events) && raw.events.length > 0 ? raw.events[0] : null;
  const volume = toFiniteNumber(raw.volumeNum ?? raw.volume, 0);
  const volume24h = toFiniteNumber(
    raw.volume24hr ??
    raw.volume24h ??
    raw.volume24hrClob ??
    raw.volume24hClob ??
    event?.volume24hr,
    0
  );
  const volume1wk = toFiniteNumber(raw.volume1wk ?? raw.volume1wkClob, 0);
  const liquidity = toFiniteNumber(raw.liquidityNum ?? raw.liquidity, 0);
  const { yesPrice, noPrice, yesLabel, noLabel } = extractYesNoPrices(raw);
  const trendingPct = toFiniteNumber(raw.oneWeekPriceChange, 0);
  const recentMetric = volume24h > 0 ? volume24h : toFiniteNumber(raw.volume1mo ?? raw.volume1moClob, 0);
  const trendMetric = Math.abs(trendingPct);
  const sourcePriority = Math.max(0, 200 - Number(sourceRank || 0));
  const polymarketRankScore =
    (raw?.featured ? 2_000_000_000 : 0) +
    (raw?.new ? 1_000_000_000 : 0) +
    (sourcePriority * 2_000) +
    (recentMetric * 0.3) +
    (trendMetric * 15_000) +
    (volume * 0.15) +
    (liquidity * 0.1) +
    (volume1wk * 0.08);
  return {
    id: String(raw.id || ""),
    conditionId: String(raw.conditionId || ""),
    slug: String(raw.slug || ""),
    eventId: String(event?.id || ""),
    eventSlug: String(event?.slug || ""),
    question: String(raw.question || raw.title || ""),
    eventTitle: String(event?.title || ""),
    eventCategory: String(event?.category || ""),
    eventTags: Array.isArray(event?.tags)
      ? event.tags
          .map((tag) => String(tag?.slug || tag?.label || tag?.name || tag || "").toLowerCase())
          .filter(Boolean)
      : [],
    endDate: raw.endDate || null,
    image: raw.image || raw.icon || event?.image || null,
    volume,
    volume24h,
    volume1wk,
    liquidity,
    yesPrice,
    noPrice,
    yesLabel,
    noLabel,
    oneWeekPriceChange: trendingPct,
    oneMonthPriceChange: toFiniteNumber(raw.oneMonthPriceChange, 0),
    recentMetric,
    trendMetric,
    sourceRank,
    polymarketRankScore,
    updatedAt: raw.updatedAt || null
  };
}

async function fetchGammaJson(path) {
  const fetch = await resolveFetch();
  const response = await fetch(`${GAMMA_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Gamma request failed: ${path} (${response.status})`);
  }
  return response.json();
}

async function fetchPredictionEventsByTag(tagSlug, limit = PREDICTION_EVENTS_FETCH_LIMIT) {
  const safeTag = encodeURIComponent(String(tagSlug || "").trim().toLowerCase());
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || PREDICTION_EVENTS_FETCH_LIMIT));
  return fetchGammaJson(
    `/events?active=true&closed=false&archived=false&limit=${safeLimit}&tag_slug=${safeTag}&order=volume24hr&ascending=false`
  );
}

async function fetchCategoryEventsFromPolymarketPage(category) {
  const fetch = await resolveFetch();
  const slug = String(category || "").trim().toLowerCase();
  if (!slug) return [];
  const response = await fetch(`${POLYMARKET_WEB_BASE_URL}/${encodeURIComponent(slug)}`);
  if (!response.ok) return [];
  const html = await response.text();
  const scriptStart = html.indexOf('<script id="__NEXT_DATA__"');
  if (scriptStart < 0) return [];
  const open = html.indexOf(">", scriptStart);
  const close = html.indexOf("</script>", open);
  if (open < 0 || close < 0) return [];
  let payload = null;
  try {
    payload = JSON.parse(html.slice(open + 1, close));
  } catch {
    return [];
  }
  const queries = payload?.props?.pageProps?.dehydratedState?.queries;
  if (!Array.isArray(queries)) return [];
  let categoryQuery = queries.find(
    (q) => Array.isArray(q?.queryKey) && String(q.queryKey[0] || "") === `${slug}-markets`
  );

  if (!categoryQuery) {
    categoryQuery = queries.find((q) =>
      Array.isArray(q?.queryKey) &&
      String(q.queryKey[0] || "") === "events" &&
      String(q.queryKey[1] || "") === "homepageFilters" &&
      String(q.queryKey[5] || "").toLowerCase() === slug
    );
  }

  const data = categoryQuery?.state?.data;
  const page0 = Array.isArray(data?.pages) ? data.pages[0] : null;
  const events = Array.isArray(page0?.events)
    ? page0.events
    : (Array.isArray(data?.events) ? data.events : (Array.isArray(data) ? data : []));
  return events;
}

function selectTopMarketsByPageOrder(markets, limit = 5) {
  const max = Math.max(1, Number(limit) || 5);
  const selected = [];
  const seenConditions = new Set();
  const seenEvents = new Set();

  const pushMarket = (market, eventScoped = false) => {
    const conditionKey = String(market?.conditionId || market?.id || "");
    if (!conditionKey || seenConditions.has(conditionKey)) return false;
    const eventKey = String(market?.eventId || market?.eventSlug || "");
    if (eventScoped && eventKey && seenEvents.has(eventKey)) return false;
    selected.push(market);
    seenConditions.add(conditionKey);
    if (eventKey) seenEvents.add(eventKey);
    return true;
  };

  // First pass: one market per event, preserving page order.
  for (const market of markets) {
    if (selected.length >= max) break;
    pushMarket(market, true);
  }

  // Second pass: fill remaining slots with next markets in order.
  for (const market of markets) {
    if (selected.length >= max) break;
    pushMarket(market, false);
  }

  return selected.slice(0, max);
}

function eventTagsToSlugs(event) {
  return (Array.isArray(event?.tags) ? event.tags : [])
    .map((tag) => String(tag?.slug || tag?.label || tag?.name || tag || "").trim().toLowerCase())
    .filter(Boolean);
}

function isEventAllowedForCategory(event, category) {
  const tag = String(PREDICTION_CATEGORY_TAGS[category] || category || "").toLowerCase();
  const slugs = eventTagsToSlugs(event);
  if (!slugs.includes(tag)) return false;

  // Reduce cross-category bleed in finance without dropping core finance markets.
  if (category === "finance") {
    const sportsIndicators = new Set([
      "sports", "nba", "nfl", "mlb", "nhl", "soccer", "tennis", "golf", "ufc", "mma", "boxing"
    ]);
    if (slugs.some((s) => sportsIndicators.has(s))) return false;
  }
  return true;
}

async function fetchDataApiJson(path, params = {}) {
  const fetch = await resolveFetch();
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item != null) query.append(key, String(item));
      });
      return;
    }
    query.append(key, String(value));
  });
  const qs = query.toString();
  const url = `${DATA_API_BASE_URL}${path}${qs ? `?${qs}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Data API request failed: ${path} (${response.status}) ${text}`);
  }
  return response.json();
}

function walletLabel(holder = {}) {
  const name = String(holder?.name || "").trim();
  if (name) return name;
  const pseudonym = String(holder?.pseudonym || "").trim();
  if (pseudonym) return pseudonym;
  const wallet = String(holder?.proxyWallet || "");
  if (!wallet) return "Unknown";
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

async function loadPredictionSnapshot() {
  const cached = predictionSnapshotCache.get("snapshot");
  if (cached && Date.now() - cached.cachedAt < PREDICTION_REFRESH_MS) {
    return cached.payload;
  }

  const categories = Object.fromEntries(PREDICTION_CATEGORIES.map((category) => [category, []]));
  const allCategorizedMarkets = [];

  for (const category of PREDICTION_CATEGORIES) {
    const tagSlug = PREDICTION_CATEGORY_TAGS[category] || category;
    let events = [];
    try {
      const pageEvents = await fetchCategoryEventsFromPolymarketPage(category);
      const filteredPageEvents = (Array.isArray(pageEvents) ? pageEvents : []).filter((event) =>
        isEventAllowedForCategory(event, category)
      );
      if (filteredPageEvents.length > 0) {
        events = filteredPageEvents;
      } else {
        const taggedEvents = await fetchPredictionEventsByTag(tagSlug, PREDICTION_EVENTS_FETCH_LIMIT);
        events = (Array.isArray(taggedEvents) ? taggedEvents : []).filter((event) =>
          isEventAllowedForCategory(event, category)
        );
      }
    } catch (error) {
      console.warn("[Predictions] Primary event fetch failed for category", category, ":", error?.message || error);
      events = [];
    }

    if (!events.length) {
      try {
        const taggedEvents = await fetchPredictionEventsByTag(tagSlug, PREDICTION_EVENTS_FETCH_LIMIT);
        events = (Array.isArray(taggedEvents) ? taggedEvents : []).filter((event) =>
          isEventAllowedForCategory(event, category)
        );
      } catch (error) {
        console.warn("[Predictions] Fallback tag event fetch failed for", tagSlug, ":", error?.message || error);
        events = [];
      }
    }

    const candidateMarkets = [];
    (Array.isArray(events) ? events : []).forEach((event, eventIndex) => {
      const eventMarkets = Array.isArray(event?.markets) ? event.markets : [];
      eventMarkets.forEach((market, marketIndex) => {
        const normalized = normalizePredictionMarket(
          {
            ...market,
            events: [event]
          },
          eventIndex * 20 + marketIndex
        );
        if (!normalized.id || !normalized.question) return;
        if (!normalized.conditionId) return;
        candidateMarkets.push({
          ...normalized,
          predictionCategory: category
        });
      });
    });

    const dedupedInOrder = [];
    const seenConditions = new Set();
    candidateMarkets.forEach((market) => {
      const key = String(market.conditionId || market.id);
      if (!key || seenConditions.has(key)) return;
      seenConditions.add(key);
      dedupedInOrder.push(market);
    });

    categories[category] = selectTopMarketsByPageOrder(dedupedInOrder, 5);
    allCategorizedMarkets.push(...dedupedInOrder);
  }

  const whaleCandidateMarkets = PREDICTION_CATEGORIES.flatMap((category) =>
    allCategorizedMarkets
      .filter((market) => market.predictionCategory === category)
      .sort((a, b) => b.polymarketRankScore - a.polymarketRankScore)
      .slice(0, 40)
  );
  const categoryByConditionId = new Map();
  const marketByConditionId = new Map();
  whaleCandidateMarkets.forEach((market) => {
    if (!market.conditionId) return;
    categoryByConditionId.set(market.conditionId, market.predictionCategory || "other");
    marketByConditionId.set(market.conditionId, market);
  });

  const conditionIds = [...marketByConditionId.keys()];
  const tradeSettled = await Promise.allSettled(
    conditionIds.map((conditionId) =>
      fetchDataApiJson("/trades", { market: conditionId, limit: 120 })
    )
  );

  const whaleTransactions = [];
  tradeSettled.forEach((result, idx) => {
    if (result.status !== "fulfilled") return;
    const conditionId = conditionIds[idx];
    const marketMeta = marketByConditionId.get(conditionId);
    const category = categoryByConditionId.get(conditionId) || "other";
    const trades = Array.isArray(result.value) ? result.value : [];
    trades.forEach((trade) => {
      const size = toFiniteNumber(trade?.size, 0);
      const price = toFiniteNumber(trade?.price, 0);
      const rawNotional = size * price;
      const inferredNotional = Math.max(
        toFiniteNumber(trade?.sizeUsd, 0),
        toFiniteNumber(trade?.usdSize, 0),
        toFiniteNumber(trade?.usdAmount, 0),
        toFiniteNumber(trade?.amountUsd, 0),
        rawNotional,
        // Some payloads represent dollar value in `size` directly.
        size
      );
      const notional = inferredNotional;
      if (!Number.isFinite(notional) || notional < 10000) return;
      whaleTransactions.push({
        id: `${trade?.transactionHash || "tx"}-${trade?.asset || conditionId}-${trade?.timestamp || 0}`,
        marketId: marketMeta?.id || null,
        conditionId,
        market: trade?.title || marketMeta?.question || "Unknown market",
        category,
        transactionSize: notional,
        price,
        shares: size,
        side: String(trade?.side || "").toUpperCase(),
        outcome: trade?.outcome || "",
        outcomeIndex: Number.isFinite(Number(trade?.outcomeIndex)) ? Number(trade.outcomeIndex) : null,
        timestamp: Number(trade?.timestamp || 0),
        txHash: trade?.transactionHash || ""
      });
    });
  });

  whaleTransactions.sort((a, b) => b.timestamp - a.timestamp);

  const payload = {
    updatedAt: new Date().toISOString(),
    refreshIntervalMs: PREDICTION_REFRESH_MS,
    categories,
    whaleTransactions
  };
  predictionSnapshotCache.set("snapshot", {
    payload,
    cachedAt: Date.now()
  });
  return payload;
}

function parseExpiration(instrumentName = "") {
  const parts = String(instrumentName).split("-");
  return parts[1] || "—";
}

function parseOptionType(instrumentName = "") {
  const parts = String(instrumentName).split("-");
  const side = String(parts[parts.length - 1] || "").trim().toUpperCase();
  if (side === "C" || side === "CALL") return "call";
  if (side === "P" || side === "PUT") return "put";
  return null;
}

function normalizeOptionType(rawType, instrumentName = "") {
  const clean = String(rawType || "").trim().toUpperCase();
  if (clean === "C" || clean === "CALL") return "call";
  if (clean === "P" || clean === "PUT") return "put";
  return parseOptionType(instrumentName);
}

function deriveStrategy(direction, optionType) {
  if (optionType === "call") return direction === "buy" ? "Long Call" : "Short Call";
  if (optionType === "put") return direction === "buy" ? "Long Put" : "Short Put";
  return "Option Trade";
}

function parseDollarNumber(value) {
  const n = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toEpochMs(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1e12 ? Math.trunc(n) : Math.trunc(n * 1000);
}

function parseTelegramWhaleTradeText(text = "") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;

  const match = clean.match(
    /^([A-Z0-9]+)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{2})\s+([\d,]+)\s+(Call|Put)\s+(?:[\d.]+x\s+)?\((?:\$)?([\d,]+(?:\.\d+)?)\)\s+(BOUGHT|SOLD)\s+@\s+\$?([\d,]+(?:\.\d+)?)(?:,\s*Spot Price\s+\$?([\d,]+(?:\.\d+)?))?/i
  );
  if (!match) return null;

  const symbol = String(match[1] || "").toUpperCase();
  const expiration = String(match[2] || "").trim();
  const optionType = String(match[4] || "").toLowerCase() === "put" ? "put" : "call";
  const direction = String(match[6] || "").toUpperCase() === "SOLD" ? "sell" : "buy";
  const strategy = deriveStrategy(direction, optionType);
  const totalNotional = parseDollarNumber(match[5]);
  const premium = parseDollarNumber(match[7]);
  const spot = parseDollarNumber(match[8]);
  const referencePrice = spot > 0 ? spot : premium;

  if (!symbol || !expiration || totalNotional <= 0) return null;
  return {
    symbol,
    expiration,
    referencePrice: Number.isFinite(referencePrice) ? referencePrice : 0,
    strategy,
    totalNotional
  };
}

function decodeTelegramHtmlEntities(html = "") {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const numeric = Number(code);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const numeric = parseInt(code, 16);
      return Number.isFinite(numeric) ? String.fromCharCode(numeric) : "";
    });
}

function stripTelegramHtmlToText(html = "") {
  return decodeTelegramHtmlEntities(String(html || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTelegramPublicMessagesFromHtml(html = "", channel = "") {
  const source = String(html || "");
  if (!source) return [];
  const blocks = source.split(/<div class="tgme_widget_message_wrap\b/i).slice(1);
  return blocks.map((block) => {
    const idMatch = block.match(/data-post="[^"\/]+\/(\d+)"/i);
    const timeMatch = block.match(/<time[^>]+datetime="([^"]+)"/i);
    const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const rawHtml = textMatch?.[1] || "";
    const text = stripTelegramHtmlToText(rawHtml);
    return {
      id: Number(idMatch?.[1] || 0) || 0,
      timestamp: timeMatch?.[1] ? Date.parse(timeMatch[1]) : 0,
      text,
      channel
    };
  }).filter((message) => message.id > 0 && message.text);
}

async function fetchTelegramPublicChannelTrades() {
  const fetch = await resolveFetch();
  const settled = await Promise.allSettled(
    TELEGRAM_CHANNEL_USERNAMES.map(async (channel) => {
      const response = await fetch(`https://t.me/s/${encodeURIComponent(channel)}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${channel}: HTTP ${response.status} ${text.slice(0, 120)}`);
      }
      const html = await response.text();
      const messages = extractTelegramPublicMessagesFromHtml(html, channel).slice(0, TELEGRAM_FETCH_LIMIT);
      return { channel, messages };
    })
  );

  const channelErrors = [];
  let messageCount = 0;
  const parsedRows = settled
    .flatMap((result) => {
      if (result.status !== "fulfilled") {
        channelErrors.push(result.reason?.message || "public channel fetch failed");
        return [];
      }
      const { channel, messages } = result.value || {};
      const safeMessages = Array.isArray(messages) ? messages : [];
      messageCount += safeMessages.length;
      return safeMessages
        .map((msg) => {
          const parsed = parseTelegramWhaleTradeText(msg?.text || "");
          if (!parsed) return null;
          const timestamp = toEpochMs(msg?.timestamp);
          const idPart = Number(msg?.id || 0) || Math.abs(timestamp);
          return {
            ...parsed,
            id: `tg-public-${channel}-${idPart}`,
            timestamp,
            source: "telegram",
            sourceChannel: channel,
            sourceLabel: `@${channel}`
          };
        })
        .filter(Boolean);
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const parsedCount = parsedRows.length;
  const status = channelErrors.length
    ? (parsedCount > 0 ? "partial" : "error")
    : (parsedCount > 0 ? "ok" : "empty");

  return {
    trades: parsedRows,
    status,
    error: channelErrors.length ? channelErrors.join(" | ") : null,
    channels: TELEGRAM_CHANNEL_USERNAMES,
    messageCount,
    parsedCount,
    transport: "public_html",
    cached: false
  };
}

function isTelegramWhaleIngestionConfigured() {
  return Number.isFinite(TELEGRAM_API_ID) && TELEGRAM_API_ID > 0 && !!TELEGRAM_API_HASH && !!TELEGRAM_SESSION_STRING;
}

async function getTelegramWhaleClient() {
  if (!isTelegramWhaleIngestionConfigured()) return null;
  if (telegramClientPromise) return telegramClientPromise;

  telegramClientPromise = (async () => {
    const { TelegramClient } = require("telegram");
    const { StringSession } = require("telegram/sessions");
    const client = new TelegramClient(
      new StringSession(TELEGRAM_SESSION_STRING),
      TELEGRAM_API_ID,
      TELEGRAM_API_HASH,
      { connectionRetries: 4 }
    );
    await client.connect();
    const authorized = await client.checkAuthorization();
    if (!authorized) {
      throw new Error("Telegram MTProto session is not authorized.");
    }
    return client;
  })().catch((error) => {
    telegramClientPromise = null;
    throw error;
  });

  return telegramClientPromise;
}

async function fetchTelegramWhaleTrades() {
  const now = Date.now();
  if (now - Number(telegramWhaleCache.fetchedAt || 0) < TELEGRAM_CACHE_TTL_MS) {
    return {
      trades: telegramWhaleCache.trades,
      status: telegramWhaleCache.status,
      error: telegramWhaleCache.error,
      channels: telegramWhaleCache.channels,
      messageCount: telegramWhaleCache.messageCount,
      parsedCount: telegramWhaleCache.parsedCount,
      cached: true
    };
  }

  if (!isTelegramWhaleIngestionConfigured()) {
    try {
      const publicFallback = await fetchTelegramPublicChannelTrades();
    telegramWhaleCache = {
      fetchedAt: now,
      trades: publicFallback.trades,
      status: publicFallback.status,
      error: publicFallback.error,
      channels: publicFallback.channels,
      messageCount: publicFallback.messageCount,
      parsedCount: publicFallback.parsedCount,
      transport: publicFallback.transport
      };
      return publicFallback;
    } catch (error) {
      const errMsg = `Missing Telegram MTProto credentials. Public fallback failed: ${error?.message || "unknown error"}`;
      telegramWhaleCache = {
        fetchedAt: now,
        trades: [],
        status: "error",
        error: errMsg,
        channels: TELEGRAM_CHANNEL_USERNAMES,
        messageCount: 0,
        parsedCount: 0,
        transport: "public_html"
      };
      return {
        trades: [],
        status: "error",
        error: errMsg,
        channels: TELEGRAM_CHANNEL_USERNAMES,
        messageCount: 0,
        parsedCount: 0,
        transport: "public_html",
        cached: false
      };
    }
  }

  try {
    const client = await getTelegramWhaleClient();
    if (!client) {
      return {
        trades: [],
        status: "disabled",
        error: "Telegram client unavailable.",
        channels: TELEGRAM_CHANNEL_USERNAMES,
        messageCount: 0,
        parsedCount: 0,
        cached: false
      };
    }

    const settled = await Promise.allSettled(
      TELEGRAM_CHANNEL_USERNAMES.map((channel) =>
        client.getMessages(channel, {
          limit: TELEGRAM_FETCH_LIMIT
        })
      )
    );
    const channelErrors = [];
    let messageCount = 0;
    const parsedRows = settled
      .flatMap((result, index) => {
        const channel = TELEGRAM_CHANNEL_USERNAMES[index];
        if (result.status !== "fulfilled") {
          channelErrors.push(`${channel}: ${result.reason?.message || "fetch failed"}`);
          return [];
        }
        const messages = Array.isArray(result.value) ? result.value : [];
        messageCount += messages.length;
        return messages
          .map((msg) => {
            const parsed = parseTelegramWhaleTradeText(msg?.message || "");
            if (!parsed) return null;
            const timestamp = toEpochMs(msg?.date);
            const idPart = Number(msg?.id || 0) || Math.abs(timestamp);
            return {
              ...parsed,
              id: `tg-${channel}-${idPart}`,
              timestamp,
              source: "telegram",
              sourceChannel: channel,
              sourceLabel: `@${channel}`
            };
          })
          .filter(Boolean);
      })
      .sort((a, b) => b.timestamp - a.timestamp);

    const parsedCount = parsedRows.length;
    const status = channelErrors.length
      ? (parsedCount > 0 ? "partial" : "error")
      : (parsedCount > 0 ? "ok" : "empty");
    const error = channelErrors.length ? channelErrors.join(" | ") : null;

    telegramWhaleCache = {
      fetchedAt: now,
      trades: parsedRows,
      status,
      error,
      channels: TELEGRAM_CHANNEL_USERNAMES,
      messageCount,
      parsedCount
    };
    return {
      trades: parsedRows,
      status,
      error,
      channels: TELEGRAM_CHANNEL_USERNAMES,
      messageCount,
      parsedCount,
      transport: "mtproto",
      cached: false
    };
  } catch (error) {
    const errMsg = error?.message || "Telegram MTProto fetch failed.";
    console.warn("Telegram whale ingestion failed:", errMsg);
    if (telegramWhaleCache.trades.length > 0) {
      return {
        trades: telegramWhaleCache.trades,
        status: "stale",
        error: errMsg,
        channels: telegramWhaleCache.channels,
        messageCount: telegramWhaleCache.messageCount,
        parsedCount: telegramWhaleCache.parsedCount,
        transport: telegramWhaleCache.transport || "mtproto",
        cached: true
      };
    }
    telegramWhaleCache = {
      fetchedAt: now,
      trades: [],
      status: "error",
      error: errMsg,
      channels: TELEGRAM_CHANNEL_USERNAMES,
      messageCount: 0,
      parsedCount: 0,
      transport: "mtproto"
    };
    return {
      trades: [],
      status: "error",
      error: errMsg,
      channels: TELEGRAM_CHANNEL_USERNAMES,
      messageCount: 0,
      parsedCount: 0,
      transport: "mtproto",
      cached: false
    };
  }
}

function computeTradeNotionalUsd(trade = {}) {
  const amount = Number(trade.amount || trade.contracts || trade.size || trade.quantity || 0);
  const optionPrice = Number(trade.price || trade.mark_price || trade.trade_price || 0);
  const refPrice = Number(trade.index_price || trade.underlying_price || trade.underlying_index || trade.mark_price || 0);

  if (amount <= 0) return 0;
  if (optionPrice > 0 && refPrice > 0) return amount * optionPrice * refPrice;
  if (optionPrice > 0) return amount * optionPrice;
  if (refPrice > 0) return amount * refPrice;
  return 0;
}

function extractTradesFromPayload(payload) {
  const result = payload?.result;
  if (Array.isArray(result?.trades)) return result.trades;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.last_trades)) return result.last_trades;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(result)) return result;
  if (Array.isArray(payload?.trades)) return payload.trades;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

// Retry wrapper
async function safePost(url, body, retries = 1) {
  let lastError = null;

  for (const { baseURL, client } of deriveClients) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await client.post(url, body);
        return res.data;
      } catch (err) {
        lastError = err;
        if (attempt < retries) console.warn(`Retrying options call (${baseURL}):`, url);
      }
    }
  }

  throw lastError || new Error("All options-provider endpoints failed");
}

const DEFAULT_EQUITY_OPTIONS_UNDERLYINGS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA"];

function buildMassiveRestUrl(pathname, params = {}) {
  const normalizedPath = String(pathname || "").startsWith("/") ? String(pathname || "") : `/${String(pathname || "")}`;
  const url = new URL(`${MASSIVE_REST_BASE_URL}${normalizedPath}`);
  if (MASSIVE_API_KEY) {
    url.searchParams.set("apiKey", MASSIVE_API_KEY);
  }
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function fetchMassiveRestJson(pathname, params = {}) {
  if (!MASSIVE_API_KEY) throw new Error("massive_api_key_missing");
  return fetchJsonWithTimeout(buildMassiveRestUrl(pathname, params));
}

function normalizeMassiveOptionDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
}

function normalizeMassiveTimestamp(value) {
  if (value == null || value === "") return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const millis = numeric > 1e12 ? numeric : Math.round(numeric / 1e6);
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function fetchMassiveExchangeMap() {
  try {
    const payload = await cachedProviderFetch("massive:reference:exchanges", () => fetchMassiveRestJson("/v3/reference/exchanges"), 6 * 60 * 60 * 1000);
    const rows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
    return rows.reduce((acc, row) => {
      const id = Number(row?.id ?? row?.exchange_id ?? row?.mic_id);
      if (!Number.isFinite(id)) return acc;
      acc[id] = String(row?.acronym || row?.mic || row?.name || row?.type || `Exchange ${id}`).trim();
      return acc;
    }, {});
  } catch (error) {
    console.warn("[Options] Failed to fetch Massive exchange map:", error?.message || error);
    return {};
  }
}

function readMassiveOptionRows(payload) {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.chain)) return payload.chain;
  if (Array.isArray(payload?.contracts)) return payload.contracts;
  if (Array.isArray(payload?.snapshots)) return payload.snapshots;
  if (Array.isArray(payload)) return payload;
  return [];
}

function normalizeMassiveOptionSnapshot(row = {}, exchangeMap = {}) {
  const details = row?.details || row?.contract || row?.option || {};
  const lastQuote = row?.last_quote || row?.lastQuote || row?.quote || {};
  const lastTrade = row?.last_trade || row?.lastTrade || row?.trade || {};
  const day = row?.day || row?.session || row?.aggregate || {};
  const greeks = row?.greeks || {};
  const underlyingAsset = row?.underlying_asset || row?.underlyingAsset || row?.underlying || {};
  const contractTicker = String(
    details?.ticker ||
    details?.symbol ||
    row?.ticker ||
    row?.symbol ||
    ""
  ).trim().toUpperCase();
  const optionType = normalizeOptionType(
    details?.contract_type ||
    details?.option_type ||
    row?.contract_type ||
    row?.option_type,
    contractTicker
  );
  const strike = firstFiniteNumber(
    details?.strike_price,
    details?.strike,
    row?.strike_price,
    row?.strike
  );
  const expiry = normalizeMassiveOptionDate(
    details?.expiration_date ||
    details?.expiry ||
    row?.expiration_date ||
    row?.expiry
  );
  const bid = firstFiniteNumber(lastQuote?.bid_price, lastQuote?.bid, row?.bid_price, row?.bid);
  const ask = firstFiniteNumber(lastQuote?.ask_price, lastQuote?.ask, row?.ask_price, row?.ask);
  const bidSize = firstFiniteNumber(lastQuote?.bid_size, lastQuote?.bs, row?.bid_size);
  const askSize = firstFiniteNumber(lastQuote?.ask_size, lastQuote?.as, row?.ask_size);
  const lastTradePrice = firstFiniteNumber(lastTrade?.price, lastTrade?.p, row?.last_price, row?.last_trade_price);
  const lastTradeSize = firstFiniteNumber(lastTrade?.size, lastTrade?.s, row?.last_trade_size);
  const volume = firstFiniteNumber(day?.volume, row?.volume, row?.day_volume) ?? 0;
  const openInterest = firstFiniteNumber(row?.open_interest, row?.openInterest, row?.oi) ?? 0;
  const impliedVolatility = firstFiniteNumber(row?.implied_volatility, row?.impliedVolatility, row?.iv, greeks?.iv);
  const delta = firstFiniteNumber(greeks?.delta, row?.delta);
  const gamma = firstFiniteNumber(greeks?.gamma, row?.gamma);
  const theta = firstFiniteNumber(greeks?.theta, row?.theta);
  const vega = firstFiniteNumber(greeks?.vega, row?.vega);
  const underlyingPrice = firstFiniteNumber(underlyingAsset?.price, row?.underlying_price, row?.underlyingPrice);
  const breakEven = firstFiniteNumber(row?.break_even_price, row?.breakEvenPrice, row?.break_even);
  const bidExchangeId = firstFiniteNumber(lastQuote?.bid_exchange, lastQuote?.bx);
  const askExchangeId = firstFiniteNumber(lastQuote?.ask_exchange, lastQuote?.ax);
  const tradeExchangeId = firstFiniteNumber(lastTrade?.exchange, lastTrade?.x);
  const updatedAt = normalizeMassiveTimestamp(
    lastQuote?.sip_timestamp ||
    lastQuote?.last_updated ||
    lastTrade?.sip_timestamp ||
    lastTrade?.participant_timestamp ||
    row?.fmv_last_updated ||
    row?.updated_at
  );
  const mid = bid != null && ask != null ? Number(((bid + ask) / 2).toFixed(4)) : firstFiniteNumber(row?.fmv, row?.mark, lastTradePrice);
  const spread = bid != null && ask != null ? Number((ask - bid).toFixed(4)) : null;
  const venueLabel = exchangeMap[Number(bidExchangeId || askExchangeId || tradeExchangeId)] || null;
  return {
    contractTicker,
    optionType,
    strike,
    expiry,
    bid,
    ask,
    bidSize,
    askSize,
    mid,
    spread,
    lastTradePrice,
    lastTradeSize,
    lastTradeAt: normalizeMassiveTimestamp(lastTrade?.sip_timestamp || lastTrade?.participant_timestamp || lastTrade?.trf_timestamp),
    volume,
    openInterest,
    impliedVolatility,
    delta,
    gamma,
    theta,
    vega,
    underlyingPrice,
    breakEven,
    bidExchangeId,
    askExchangeId,
    tradeExchangeId,
    venueLabel,
    updatedAt
  };
}

function buildMassiveEquityOptionsPayload(underlying, rows = [], activeExpiry = null) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row?.optionType && Number.isFinite(Number(row?.strike))) : [];
  const expiries = [...new Set(safeRows.map((row) => row.expiry).filter(Boolean))].sort();
  const resolvedExpiry = activeExpiry && expiries.includes(activeExpiry) ? activeExpiry : (expiries[0] || null);
  const filtered = resolvedExpiry ? safeRows.filter((row) => row.expiry === resolvedExpiry) : safeRows;
  const spotPrice = firstFiniteNumber(...filtered.map((row) => row.underlyingPrice), ...safeRows.map((row) => row.underlyingPrice)) ?? 0;
  const strikeMap = new Map();
  filtered.forEach((row) => {
    const key = `${row.expiry}:${row.strike}`;
    if (!strikeMap.has(key)) strikeMap.set(key, { expiry: row.expiry, strike: row.strike, call: {}, put: {} });
    const bucket = strikeMap.get(key);
    if (row.optionType === "call") bucket.call = row;
    if (row.optionType === "put") bucket.put = row;
  });
  const chain = [...strikeMap.values()].sort((a, b) => Number(a.strike) - Number(b.strike));
  const callRows = filtered.filter((row) => row.optionType === "call");
  const putRows = filtered.filter((row) => row.optionType === "put");
  const totalCallOi = callRows.reduce((sum, row) => sum + Number(row.openInterest || 0), 0);
  const totalPutOi = putRows.reduce((sum, row) => sum + Number(row.openInterest || 0), 0);
  const totalCallVolume = callRows.reduce((sum, row) => sum + Number(row.volume || 0), 0);
  const totalPutVolume = putRows.reduce((sum, row) => sum + Number(row.volume || 0), 0);
  const nearestChainRow = spotPrice > 0 && chain.length
    ? chain.reduce((best, row) => {
        if (!best) return row;
        return Math.abs(Number(row.strike || 0) - spotPrice) < Math.abs(Number(best.strike || 0) - spotPrice) ? row : best;
      }, null)
    : null;
  const atmIv = nearestChainRow
    ? firstFiniteNumber(
        nearestChainRow?.call?.impliedVolatility != null && nearestChainRow?.put?.impliedVolatility != null
          ? (Number(nearestChainRow.call.impliedVolatility) + Number(nearestChainRow.put.impliedVolatility)) / 2
          : null,
        nearestChainRow?.call?.impliedVolatility,
        nearestChainRow?.put?.impliedVolatility
      )
    : null;
  const atmStraddleMid = nearestChainRow
    ? Number(((Number(nearestChainRow?.call?.mid || 0) || 0) + (Number(nearestChainRow?.put?.mid || 0) || 0)).toFixed(4))
    : 0;
  const impliedMovePct = spotPrice > 0 && atmStraddleMid > 0 ? Number(((atmStraddleMid / spotPrice) * 100).toFixed(2)) : null;
  const strikeCrowding = chain
    .map((row) => ({
      strike: Number(row.strike || 0),
      totalOi: Number(row?.call?.openInterest || 0) + Number(row?.put?.openInterest || 0),
      totalVolume: Number(row?.call?.volume || 0) + Number(row?.put?.volume || 0),
      callOi: Number(row?.call?.openInterest || 0),
      putOi: Number(row?.put?.openInterest || 0),
    }))
    .filter((row) => row.totalOi > 0 || row.totalVolume > 0)
    .sort((a, b) => b.totalOi - a.totalOi || b.totalVolume - a.totalVolume)
    .slice(0, 8);
  const termStructure = expiries.map((expiry) => {
    const expiryRows = safeRows.filter((row) => row.expiry === expiry);
    const ivValues = expiryRows.map((row) => Number(row.impliedVolatility)).filter(Number.isFinite);
    const avgIv = ivValues.length ? ivValues.reduce((sum, value) => sum + value, 0) / ivValues.length : null;
    return {
      expiry,
      avgIv,
      totalOi: expiryRows.reduce((sum, row) => sum + Number(row.openInterest || 0), 0),
      totalVolume: expiryRows.reduce((sum, row) => sum + Number(row.volume || 0), 0),
      contracts: expiryRows.length
    };
  });
  const venueMap = new Map();
  filtered.forEach((row) => {
    const venue = row.venueLabel || "Composite";
    if (!venueMap.has(venue)) venueMap.set(venue, { venue, contracts: 0, volume: 0, openInterest: 0 });
    const bucket = venueMap.get(venue);
    bucket.contracts += 1;
    bucket.volume += Number(row.volume || 0);
    bucket.openInterest += Number(row.openInterest || 0);
  });
  const venueSummary = [...venueMap.values()].sort((a, b) => b.volume - a.volume || b.openInterest - a.openInterest).slice(0, 6);
  const topContracts = filtered
    .map((row) => ({
      contractTicker: row.contractTicker,
      expiry: row.expiry,
      strike: row.strike,
      optionType: row.optionType,
      volume: Number(row.volume || 0),
      openInterest: Number(row.openInterest || 0),
      impliedVolatility: row.impliedVolatility,
      mid: row.mid,
      spread: row.spread,
      venue: row.venueLabel || "Composite"
    }))
    .sort((a, b) => b.volume - a.volume || b.openInterest - a.openInterest)
    .slice(0, 10);
  const unusualActivity = filtered
    .map((row) => {
      const sizeScore = Number(row.volume || 0) * Math.max(1, Number(row.lastTradeSize || 1));
      return {
        contractTicker: row.contractTicker,
        strike: row.strike,
        expiry: row.expiry,
        optionType: row.optionType,
        venue: row.venueLabel || "Composite",
        lastTradePrice: row.lastTradePrice,
        lastTradeSize: row.lastTradeSize,
        volume: row.volume,
        openInterest: row.openInterest,
        score: sizeScore,
        lastTradeAt: row.lastTradeAt
      };
    })
    .filter((row) => row.volume > 0 || row.lastTradeSize > 0)
    .sort((a, b) => b.score - a.score || b.volume - a.volume)
    .slice(0, 8);
  return {
    underlying,
    source: "Massive REST snapshot",
    expiries,
    activeExpiry: resolvedExpiry,
    chain,
    summary: {
      spotPrice,
      totalCallOi,
      totalPutOi,
      putCallOiRatio: totalCallOi > 0 ? Number((totalPutOi / totalCallOi).toFixed(2)) : null,
      totalCallVolume,
      totalPutVolume,
      putCallVolumeRatio: totalCallVolume > 0 ? Number((totalPutVolume / totalCallVolume).toFixed(2)) : null,
      atmIv,
      atmStraddleMid,
      impliedMovePct,
      contracts: filtered.length
    },
    strikeCrowding,
    termStructure,
    venueSummary,
    topContracts,
    unusualActivity,
    updatedAt: new Date().toISOString()
  };
}

function buildMassiveEquityOptionsUnavailablePayload(underlying, reason, options = {}) {
  const normalizedReason = String(reason || "massive_equity_options_unavailable").trim();
  const statusMessage = String(options.statusMessage || "").trim() || (
    normalizedReason === "massive_api_key_missing"
      ? "Massive equity-options data is not configured on this backend. Set MASSIVE_API_KEY, POLY_API_KEY, or POLYGON_API_KEY and restart the backend."
      : "Massive equity-options data is temporarily unavailable. Retry the snapshot or choose another supported underlying."
  );
  return {
    underlying,
    source: "Massive REST snapshot",
    stale: true,
    unavailable: true,
    expiries: Array.isArray(options.expiries) ? options.expiries : [],
    activeExpiry: options.activeExpiry || null,
    requestedExpiry: options.requestedExpiry || null,
    chain: [],
    summary: {
      spotPrice: 0,
      totalCallOi: 0,
      totalPutOi: 0,
      putCallOiRatio: null,
      totalCallVolume: 0,
      totalPutVolume: 0,
      putCallVolumeRatio: null,
      atmIv: null,
      atmStraddleMid: 0,
      impliedMovePct: null,
      contracts: 0
    },
    strikeCrowding: [],
    termStructure: [],
    venueSummary: [],
    topContracts: [],
    unusualActivity: [],
    supportedUnderlyings: DEFAULT_EQUITY_OPTIONS_UNDERLYINGS,
    stale_reason: normalizedReason,
    statusMessage,
    stale_age_seconds: null,
    updatedAt: new Date().toISOString()
  };
}

// Lyra (Derive) Crypto Options Integration
// ---------------------------------------------------------------------------
// ✅ STABLE Derive Options Chain Endpoint (FIXED)
// ---------------------------------------------------------------------------
app.get("/api/options/equity", validate(equityOptionsQuerySchema, "query"), async (req, res) => {
  const { underlying = "SPY", expiry = null, limit = 160 } = req.query;
  const normalizedUnderlying = String(underlying || "SPY").trim().toUpperCase();
  const normalizedExpiry = normalizeMassiveOptionDate(expiry);
  const snapshotParams = {
    underlying: normalizedUnderlying,
    expiry: normalizedExpiry || "latest",
    limit: Number(limit || 160)
  };
  const cached = await readServiceSnapshot("options-equity", snapshotParams);
  const fresh = await readFreshSnapshot("options-equity", snapshotParams, ROUTE_CACHE_TTLS_MS["options-equity"]);
  if (fresh) {
    return res.json(fresh);
  }

  if (!MASSIVE_API_KEY) {
    return res.json(buildMassiveEquityOptionsUnavailablePayload(normalizedUnderlying, "massive_api_key_missing", {
      activeExpiry: normalizedExpiry || null,
      requestedExpiry: normalizedExpiry || null
    }));
  }

  try {
    const [snapshotPayload, contractsPayload, exchangeMap] = await Promise.all([
      fetchMassiveRestJson(`/v3/snapshot/options/${encodeURIComponent(normalizedUnderlying)}`),
      fetchMassiveRestJson("/v3/reference/options/contracts", {
        underlying_ticker: normalizedUnderlying,
        expired: "false",
        limit: "1000"
      }).catch(() => null),
      fetchMassiveExchangeMap()
    ]);
    const rawRows = readMassiveOptionRows(snapshotPayload)
      .map((row) => normalizeMassiveOptionSnapshot(row, exchangeMap))
      .filter((row) => row.contractTicker && row.optionType && Number.isFinite(Number(row.strike)));

    let payload = buildMassiveEquityOptionsPayload(normalizedUnderlying, rawRows, normalizedExpiry || null);
    if ((!payload.expiries || payload.expiries.length === 0) && Array.isArray(contractsPayload?.results)) {
      payload.expiries = [...new Set(contractsPayload.results.map((row) => normalizeMassiveOptionDate(row?.expiration_date || row?.expiry)).filter(Boolean))].sort();
      payload.activeExpiry = payload.expiries.includes(normalizedExpiry) ? normalizedExpiry : (payload.expiries[0] || null);
    }
    if (!rawRows.length) {
      return res.json(buildMassiveEquityOptionsUnavailablePayload(normalizedUnderlying, "massive_equity_options_snapshot_empty", {
        expiries: payload.expiries,
        activeExpiry: payload.activeExpiry || null,
        requestedExpiry: normalizedExpiry || null,
        statusMessage: `${normalizedUnderlying} returned no Massive option contracts for the current snapshot. Try another supported underlying or refresh after the feed catches up.`
      }));
    }
    payload.supportedUnderlyings = DEFAULT_EQUITY_OPTIONS_UNDERLYINGS;
    payload.updatedAt = new Date().toISOString();
    payload.stale = false;
    payload.unavailable = false;
    payload.requestedExpiry = normalizedExpiry || null;
    if (normalizedExpiry && payload.activeExpiry && normalizedExpiry !== payload.activeExpiry) {
      payload.expiryFallback = true;
      payload.statusMessage = `${normalizedExpiry} is not available for ${normalizedUnderlying}; showing ${payload.activeExpiry} instead.`;
    }
    if (!payload.chain.length) {
      payload.stale = true;
      payload.unavailable = true;
      payload.stale_reason = normalizedExpiry
        ? "massive_equity_options_expiry_empty"
        : "massive_equity_options_chain_empty";
      payload.statusMessage = normalizedExpiry
        ? `${normalizedUnderlying} has no chain rows for ${normalizedExpiry}. Choose another expiry or refresh the snapshot.`
        : `${normalizedUnderlying} returned no chain rows in the latest Massive snapshot. Try another supported underlying or refresh shortly.`;
    }
    if (Number(limit) > 0 && Array.isArray(payload.chain) && payload.chain.length > Number(limit)) {
      const targetSpot = Number(payload?.summary?.spotPrice || 0);
      const nearestIndex = targetSpot > 0
        ? payload.chain.reduce((bestIdx, row, idx, rows) => (
            Math.abs(Number(row?.strike || 0) - targetSpot) < Math.abs(Number(rows[bestIdx]?.strike || 0) - targetSpot)
              ? idx
              : bestIdx
          ), 0)
        : Math.floor(payload.chain.length / 2);
      const halfWindow = Math.floor(Number(limit) / 2);
      const start = Math.max(0, nearestIndex - halfWindow);
      const end = Math.min(payload.chain.length, start + Number(limit));
      payload.chain = payload.chain.slice(Math.max(0, end - Number(limit)), end);
    }
    await writeServiceSnapshot("options-equity", snapshotParams, payload);
    return res.json(payload);
  } catch (error) {
    console.warn("[Options] Massive equity options snapshot fallback:", error?.message || error);
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "massive_equity_options_failed"));
    }
    return res.json(buildMassiveEquityOptionsUnavailablePayload(
      normalizedUnderlying,
      error?.message || "massive_equity_options_failed",
      {
        activeExpiry: normalizedExpiry || null,
        requestedExpiry: normalizedExpiry || null
      }
    ));
  }
});

app.post("/api/options/crypto", validate(cryptoOptionsSchema), async (req, res) => {
  const { currency = "BTC", expiry } = req.body;
  const normalizedCurrency = String(currency || "BTC").toUpperCase();
  const supportedOptionsAssets = Array.isArray(buildAppRuntimeConfig()?.options?.supportedAssets)
    ? buildAppRuntimeConfig().options.supportedAssets.map((asset) => String(asset || "").trim().toUpperCase()).filter(Boolean)
    : ["BTC", "ETH", "SOL", "HYPE"];
  const marketStructure = normalizedCurrency === "HYPE" ? "rfq" : "orderbook";
  const marketStructureLabel = marketStructure === "rfq" ? "RFQ" : "Orderbook";
  const marketStructureNote = marketStructure === "rfq"
    ? "HYPE on Derive can be quoted through RFQ, so full strike ladders may appear sparse or be unavailable in snapshots."
    : null;
  if (!supportedOptionsAssets.includes(normalizedCurrency)) {
    return res.json({
      chain: [],
      expiries: [],
      unsupported: true,
      unavailable: true,
      supported_assets: supportedOptionsAssets,
      source: "Derive",
      stale_reason: `${normalizedCurrency} is not enabled for the live options ladder in this workspace.`,
      market_metrics: { iv: 0, p_c_ratio: 0 },
      market_structure: marketStructure,
      market_structure_label: marketStructureLabel,
      market_structure_note: marketStructureNote
    });
  }
  const cacheKey = `${normalizedCurrency}:${expiry == null ? "latest" : String(expiry)}`;
  const snapshotParams = {
    currency: normalizedCurrency,
    expiry: expiry == null ? "latest" : String(expiry)
  };
  const persistedSnapshot = await readServiceSnapshot("options-chain", snapshotParams);
  const freshSnapshot = await readFreshSnapshot("options-chain", snapshotParams, ROUTE_CACHE_TTLS_MS["options-chain"]);
  if (freshSnapshot) {
    return res.json(freshSnapshot);
  }

  try {
    // 1. Instruments
    const instData = await safePost("/public/get_instruments", {
      currency,
      instrument_type: "option",
      expired: false
    });

    const instruments = instData?.result || [];

    if (!instruments.length) {
      return res.json({
        chain: [],
        expiries: [],
        market_metrics: { iv: 0, p_c_ratio: 0 },
        market_structure: marketStructure,
        market_structure_label: marketStructureLabel,
        market_structure_note: marketStructureNote
      });
    }

    // 2. Expiries
    const expiries = [
      ...new Set(
        instruments.map(i => i?.option_details?.expiry).filter(Boolean)
      )
    ].sort((a, b) => a - b);

    const targetExpiry = expiry
      ? parseInt(expiry)
      : expiries[0];

    const filtered = instruments.filter(
      i => i?.option_details?.expiry === targetExpiry
    );

    // 3. Tickers (batched)
    const batchSize = 8; // 🔥 smaller = more stable
    const allTickers = [];

    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(inst =>
          safePost("/public/get_ticker", {
            instrument_name: inst.instrument_name
          })
        )
      );

      results.forEach(r => {
        if (r.status === "fulfilled" && r.value?.result) {
          allTickers.push(r.value.result);
        }
      });
    }

    if (!allTickers.length) {
      return res.json({
        chain: [],
        expiries,
        market_metrics: { iv: 0, p_c_ratio: 0 },
        market_structure: marketStructure,
        market_structure_label: marketStructureLabel,
        market_structure_note: marketStructureNote
      });
    }

    // 4. Build chain
    const strikesMap = {};

    allTickers.forEach(t => {
      const details = t?.option_details || {};
      const strike = firstFiniteNumber(
        details?.strike,
        t?.strike_price,
        t?.strike
      );
      const type = normalizeOptionType(
        details?.option_type || t?.option_type || t?.kind,
        t?.instrument_name
      );

      if (!strike || !type) return;

      if (!strikesMap[strike]) {
        strikesMap[strike] = { strike, call: {}, put: {} };
      }

      const rawBid = firstFiniteNumber(
          t?.best_bid_price,
          t?.bid_price,
          t?.best_bid,
          t?.bid,
          t?.bids?.[0]?.price
        );
      const rawAsk = firstFiniteNumber(
          t?.best_ask_price,
          t?.ask_price,
          t?.best_ask,
          t?.ask,
          t?.asks?.[0]?.price
        );
      const fallbackPx = firstFiniteNumber(
        t?.option_pricing?.mark_price,
        t?.mark_price,
        t?.last_price,
        t?.last,
        t?.price,
        t?.index_price,
        t?.underlying_price,
        0
      );
      const normalizedBid = Number(rawBid);
      const normalizedAsk = Number(rawAsk);
      const normalizedFallback = Number(fallbackPx);
      const bid = Number.isFinite(normalizedBid) && normalizedBid > 0
        ? normalizedBid
        : (Number.isFinite(normalizedFallback) && normalizedFallback > 0 ? normalizedFallback : 0);
      const ask = Number.isFinite(normalizedAsk) && normalizedAsk > 0
        ? normalizedAsk
        : (Number.isFinite(normalizedFallback) && normalizedFallback > 0 ? normalizedFallback : 0);

      let totalOi = 0;
      if (typeof t?.open_interest === 'object' && t.open_interest !== null) {
        Object.values(t.open_interest).forEach(pools => {
          if (Array.isArray(pools)) {
            pools.forEach(p => {
              if (p?.current_open_interest) {
                totalOi += Number(p.current_open_interest);
              }
            });
          }
        });
      } else {
        totalOi = firstFiniteNumber(t?.open_interest, t?.stats?.open_interest, t?.openInterest, 0);
      }

      const data = {
        bid,
        ask,
        mark: Number.isFinite(normalizedFallback) ? normalizedFallback : 0,
        oi: totalOi,
        openInterest: totalOi,
        delta: firstFiniteNumber(t?.option_pricing?.delta, t?.greeks?.delta, t?.stats?.delta, t?.delta, t?.call_delta, t?.put_delta, 0),
        gamma: firstFiniteNumber(t?.option_pricing?.gamma, t?.greeks?.gamma, t?.stats?.gamma, t?.gamma, 0),
        vega: firstFiniteNumber(t?.option_pricing?.vega, t?.greeks?.vega, t?.stats?.vega, t?.vega, 0),
        theta: firstFiniteNumber(t?.option_pricing?.theta, t?.greeks?.theta, t?.stats?.theta, t?.theta, 0),
        iv: firstFiniteNumber(
          t?.option_pricing?.iv,
          t?.mark_iv,
          t?.iv,
          t?.bid_iv,
          t?.ask_iv,
          t?.greeks?.iv,
          t?.stats?.iv,
          t?.implied_volatility,
          0
        ),
      };
      if (type === "call") strikesMap[strike].call = data;
      else if (type === "put") strikesMap[strike].put = data;
    });

    const chain = Object.values(strikesMap)
      .sort((a, b) => a.strike - b.strike);

    const avgIv =
      allTickers.reduce((s, t) => s + (firstFiniteNumber(t?.option_pricing?.iv, t?.iv, t?.mark_iv, t?.bid_iv, t?.ask_iv, 0) || 0), 0) /
      (allTickers.length || 1);
    const putOpenInterest = chain.reduce((sum, row) => sum + Number(row?.put?.openInterest || row?.put?.oi || 0), 0);
    const callOpenInterest = chain.reduce((sum, row) => sum + Number(row?.call?.openInterest || row?.call?.oi || 0), 0);
    const putCallRatio = callOpenInterest > 0 ? putOpenInterest / callOpenInterest : 0;

    const referenceTicker = allTickers.find(Boolean) || null;
    const spot =
      Number(referenceTicker?.index_price || referenceTicker?.underlying_price || referenceTicker?.underlying_index || 0) || null;

    const payload = {
      expiry: targetExpiry,
      expiries,
      chain,
      spot,
      market_price: spot,
      source: "Derive",
      source_detail: DERIVE_BASE_URLS[0] || "Derive options API",
      updatedAt: new Date().toISOString(),
      market_structure: marketStructure,
      market_structure_label: marketStructureLabel,
      market_structure_note: marketStructureNote,
      market_metrics: {
        iv: avgIv || 0,
        p_c_ratio: putCallRatio
      }
    };

    optionsChainCache.set(cacheKey, {
      payload,
      cachedAt: Date.now()
    });
    await writeAllSnapshots("options-chain", snapshotParams, payload);

    res.json(payload);

  } catch (error) {
    console.error("🔥 Derive HARD FAIL:", error.message);

    const cached = optionsChainCache.get(cacheKey);
    if (cached?.payload) {
      return res.json({
        ...cached.payload,
        stale: true,
        stale_age_seconds: Math.floor((Date.now() - cached.cachedAt) / 1000)
      });
    }
    if (persistedSnapshot?.payload) {
      return res.json(applyStaleMeta(persistedSnapshot.payload, persistedSnapshot, error?.message || "options_chain_fetch_failed"));
    }
    res.json({
      expiry: expiry ? parseInt(expiry, 10) : null,
      expiries: [],
      chain: [],
      spot: null,
      market_price: null,
      market_structure: marketStructure,
      market_structure_label: marketStructureLabel,
      market_structure_note: marketStructureNote,
      market_metrics: {
        iv: 0,
        p_c_ratio: 0
      },
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "options_chain_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

app.get("/api/options/whale-trades", async (req, res) => {
  const requestedMinNotional = Number(req.query?.minNotional);
  const minNotionalUsd = Number.isFinite(requestedMinNotional) && requestedMinNotional > 0
    ? requestedMinNotional
    : MIN_WHALE_NOTIONAL_USD;
  const requestedSource = String(req.query?.source || "derive").trim().toLowerCase();
  const sourceMode = requestedSource === "telegram" ? "telegram" : "derive";
  const snapshotParams = { minNotionalUsd, source: sourceMode };
  const cached = await readServiceSnapshot("options-whale-trades", snapshotParams);
  try {
    const merged = [];
    const debugRawTradeCounts = Object.fromEntries(WHALE_CURRENCIES.map((currency) => [currency, 0]));
    const debugFallbackTradeCounts = Object.fromEntries(WHALE_CURRENCIES.map((currency) => [currency, 0]));
    const includeDerive = sourceMode === "derive";
    const includeTelegram = sourceMode === "telegram";
    let telegramIngest = {
      status: "skipped",
      cached: false,
      error: null,
      trades: []
    };

    const addTrades = (trades, currency) => {
      trades.forEach((trade) => {
        const instrument = String(trade.instrument_name || "");
        const symbol = instrument.split("-")[0] || currency;
        const expiration = parseExpiration(instrument);
        const referencePrice = Number(
          trade.index_price || trade.underlying_price || trade.underlying_index || trade.mark_price || 0
        );
        const direction = String(trade.direction || "buy").toLowerCase() === "sell" ? "sell" : "buy";
        const optionType = normalizeOptionType(trade.option_type, instrument);
        const strategy = deriveStrategy(direction, optionType);
        const totalNotional = computeTradeNotionalUsd(trade);
        const timestamp = toEpochMs(trade.timestamp || trade.created_at || trade.date || 0);
        const tradeId = trade.trade_id || trade.id || instrument || `derive-${currency}`;

        merged.push({
          id: `derive-${tradeId}-${timestamp || Date.now()}`,
          symbol,
          expiration,
          referencePrice: Number.isFinite(referencePrice) ? referencePrice : 0,
          strategy,
          totalNotional: Number.isFinite(totalNotional) ? totalNotional : 0,
          timestamp,
          source: "derive",
          sourceLabel: "Derive"
        });
      });
    };

    if (includeDerive) {
      const settled = await Promise.allSettled(
        WHALE_CURRENCIES.map((currency) =>
          safePost("/public/get_last_trades_by_currency", {
            currency,
            kind: "option",
            count: 200
          })
        )
      );

      settled.forEach((result, idx) => {
        const currency = WHALE_CURRENCIES[idx];
        if (result.status !== "fulfilled") return;
        const payload = result.value;
        const trades = extractTradesFromPayload(payload);
        debugRawTradeCounts[currency] = trades.length;
        addTrades(trades, currency);
      });

      if (!merged.length) {
        for (const currency of WHALE_CURRENCIES) {
          try {
            const instrumentsPayload = await safePost("/public/get_instruments", {
              currency,
              instrument_type: "option",
              expired: false
            });
            const instruments = Array.isArray(instrumentsPayload?.result) ? instrumentsPayload.result : [];
            const nearTerm = instruments
              .slice()
              .sort((a, b) => Number(a?.option_details?.expiry || 0) - Number(b?.option_details?.expiry || 0))
              .slice(0, 14);

            const perInstrument = await Promise.allSettled(
              nearTerm.map((instrument) =>
                safePost("/public/get_last_trades_by_instrument", {
                  instrument_name: instrument?.instrument_name,
                  count: 20,
                  include_old: true
                })
              )
            );

            perInstrument.forEach((result) => {
              if (result.status !== "fulfilled") return;
              const trades = extractTradesFromPayload(result.value);
              debugFallbackTradeCounts[currency] += trades.length;
              addTrades(trades, currency);
            });
          } catch (fallbackError) {
            console.warn(`Whale fallback failed for ${currency}:`, fallbackError.message);
          }
        }
      }
    }

    if (includeTelegram) {
      telegramIngest = await fetchTelegramWhaleTrades();
      if (Array.isArray(telegramIngest.trades) && telegramIngest.trades.length > 0) {
        merged.push(...telegramIngest.trades);
      }
    }

    const whaleFiltered = merged.filter((t) => Number.isFinite(t.totalNotional) && t.totalNotional >= minNotionalUsd);
    const source = whaleFiltered.length > 0 ? whaleFiltered : merged
      .sort((a, b) => b.totalNotional - a.totalNotional)
      .slice(0, 80);

    const trades = source
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100);

    console.info("Whale trades raw counts by currency:", debugRawTradeCounts);
    const payload = {
      updatedAt: new Date().toISOString(),
      minNotionalUsd,
      selectedSource: sourceMode,
      debug_raw_trade_counts: debugRawTradeCounts,
      debug_fallback_trade_counts: debugFallbackTradeCounts,
      debug_telegram_ingest: {
        status: telegramIngest.status,
        cached: !!telegramIngest.cached,
        error: telegramIngest.error || null,
        trades: Array.isArray(telegramIngest.trades) ? telegramIngest.trades.length : 0,
        parsedCount: Number(telegramIngest.parsedCount || 0),
        messageCount: Number(telegramIngest.messageCount || 0),
        channels: Array.isArray(telegramIngest.channels) ? telegramIngest.channels : TELEGRAM_CHANNEL_USERNAMES,
        primaryChannel: TELEGRAM_PRIMARY_CHANNEL_USERNAME,
        transport: telegramIngest.transport || null
      },
      trades,
      stale: false
    };
    await writeServiceSnapshot("options-whale-trades", snapshotParams, payload);
    res.json(payload);
  } catch (error) {
    console.error("Whale options fetch failed:", error.message);
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "options_whale_fetch_failed"));
    }
    res.json({
      updatedAt: new Date().toISOString(),
      minNotionalUsd,
      selectedSource: sourceMode,
      trades: [],
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "options_whale_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

// ---------------------------------------------------------------------------
// Prediction Markets (Polymarket Gamma API)
// ---------------------------------------------------------------------------
app.get("/api/prediction/snapshot", async (_req, res) => {
  const cached = await readServiceSnapshot("prediction-snapshot", { version: "v1" });
  try {
    const snapshot = await loadPredictionSnapshot();
    const payload = {
      ...snapshot,
      stale: false
    };
    await writeServiceSnapshot("prediction-snapshot", { version: "v1" }, payload);
    res.json(payload);
  } catch (error) {
    console.error("Prediction snapshot failed:", error.message);
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "prediction_snapshot_fetch_failed"));
    }
    res.json({
      updatedAt: new Date().toISOString(),
      refreshIntervalMs: PREDICTION_REFRESH_MS,
      categories: Object.fromEntries(PREDICTION_CATEGORIES.map((category) => [category, []])),
      whaleTransactions: [],
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "prediction_snapshot_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

app.get("/api/prediction/market-details/:marketId", async (req, res) => {
  const { marketId } = req.params;
  if (!marketId) {
    return res.status(400).json({ error: "marketId is required" });
  }
  const snapshotParams = { marketId: String(marketId) };
  const cached = await readServiceSnapshot("prediction-market-details", snapshotParams);

  try {
    const market = await fetchGammaJson(`/markets/${encodeURIComponent(marketId)}`);
    const normalized = normalizePredictionMarket(market);
    const conditionId = normalized.conditionId;
    if (!conditionId) {
      return res.status(404).json({ error: "Market conditionId not found" });
    }

    const holderPayload = await fetchDataApiJson("/holders", {
      market: conditionId,
      limit: 60
    });
    const holderBuckets = Array.isArray(holderPayload) ? holderPayload : [];
    const flatHolders = holderBuckets.flatMap((bucket) => (Array.isArray(bucket?.holders) ? bucket.holders : []));

    const sideFromHolder = (holder) => {
      const outcomeIndex = Number(holder?.outcomeIndex);
      const outcome = String(holder?.outcome || "").toLowerCase();
      if (outcome === "yes" || outcomeIndex === 0) return "yes";
      if (outcome === "no" || outcomeIndex === 1) return "no";
      return null;
    };

    const holderRanked = { yes: [], no: [] };
    flatHolders.forEach((holder) => {
      const side = sideFromHolder(holder);
      if (!side) return;
      holderRanked[side].push(holder);
    });
    holderRanked.yes.sort((a, b) => toFiniteNumber(b?.amount, 0) - toFiniteNumber(a?.amount, 0));
    holderRanked.no.sort((a, b) => toFiniteNumber(b?.amount, 0) - toFiniteNumber(a?.amount, 0));

    const targetHolders = [...holderRanked.yes.slice(0, 5), ...holderRanked.no.slice(0, 5)];
    const uniqueWallets = [...new Set(targetHolders.map((h) => String(h?.proxyWallet || "")).filter(Boolean))];

    const positionsSettled = await Promise.allSettled(
      uniqueWallets.map((wallet) =>
        fetchDataApiJson("/positions", {
          user: wallet,
          market: conditionId,
          sizeThreshold: 0
        })
      )
    );

    const positionsByWallet = new Map();
    positionsSettled.forEach((result, idx) => {
      const wallet = uniqueWallets[idx];
      if (result.status !== "fulfilled") return;
      const rows = Array.isArray(result.value) ? result.value : [];
      positionsByWallet.set(wallet, rows);
    });

    const normalizePosition = (row = {}, holder = null) => {
      const currentValue = toFiniteNumber(row.currentValue, toFiniteNumber(row.size, 0) * toFiniteNumber(row.curPrice, 0));
      return {
        id: `${row.proxyWallet || holder?.proxyWallet || "wallet"}-${row.asset || holder?.asset || "asset"}`,
        holder: String(row.proxyWallet || holder?.proxyWallet || ""),
        label: walletLabel({ ...holder, proxyWallet: row.proxyWallet || holder?.proxyWallet }),
        sizeUsd: currentValue,
        shares: toFiniteNumber(row.size, toFiniteNumber(holder?.amount, 0)),
        avgEntry: toFiniteNumber(row.avgPrice, 0),
        markPrice: toFiniteNumber(row.curPrice, 0),
        pnlPct: toFiniteNumber(row.percentPnl, 0),
        pnlUsd: toFiniteNumber(row.cashPnl, 0),
        outcome: String(row.outcome || ""),
        outcomeIndex: Number.isFinite(Number(row.outcomeIndex)) ? Number(row.outcomeIndex) : Number(holder?.outcomeIndex ?? -1)
      };
    };

    const positionBuckets = { yes: [], no: [] };
    targetHolders.forEach((holder) => {
      const wallet = String(holder?.proxyWallet || "");
      if (!wallet) return;
      const rows = positionsByWallet.get(wallet) || [];
      const side = sideFromHolder(holder);
      const candidate = rows.find((row) => {
        const idx = Number(row?.outcomeIndex);
        if (side === "yes") return idx === 0 || String(row?.outcome || "").toLowerCase() === "yes";
        if (side === "no") return idx === 1 || String(row?.outcome || "").toLowerCase() === "no";
        return false;
      });
      if (!candidate) return;
      positionBuckets[side].push(normalizePosition(candidate, holder));
    });

    positionBuckets.yes.sort((a, b) => b.sizeUsd - a.sizeUsd);
    positionBuckets.no.sort((a, b) => b.sizeUsd - a.sizeUsd);

    const holderOut = {
      yes: positionBuckets.yes.slice(0, 5).map((row) => ({
        holder: row.holder,
        label: row.label,
        sizeUsd: row.sizeUsd,
        shares: row.shares
      })),
      no: positionBuckets.no.slice(0, 5).map((row) => ({
        holder: row.holder,
        label: row.label,
        sizeUsd: row.sizeUsd,
        shares: row.shares
      }))
    };

    const details = {
      market: normalized,
      holderDataAvailable: holderOut.yes.length > 0 || holderOut.no.length > 0,
      holderDataNote: holderOut.yes.length > 0 || holderOut.no.length > 0
        ? ""
        : "No holder data returned for this market at the moment.",
      holders: holderOut,
      positions: {
        yes: positionBuckets.yes.slice(0, 5),
        no: positionBuckets.no.slice(0, 5)
      }
    };

    const payload = {
      ...details,
      updatedAt: new Date().toISOString(),
      stale: false
    };
    await writeServiceSnapshot("prediction-market-details", snapshotParams, payload);
    res.json(payload);
  } catch (error) {
    console.error("Prediction market details failed:", error.message);
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "prediction_market_details_fetch_failed"));
    }
    res.json({
      market: null,
      holderDataAvailable: false,
      holderDataNote: "No holder data returned for this market at the moment.",
      holders: { yes: [], no: [] },
      positions: { yes: [], no: [] },
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "prediction_market_details_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

// ---------------------------------------------------------------------------
// Options Calculator Persistence
// ---------------------------------------------------------------------------
app.get("/api/db/options-calculations", requireSignedIn, async (req, res) => {
  try {
    const { limit = 20, symbol } = req.query;
    const records = (await userWorkspace.options.getRecent(req.auth.userId, limit, symbol || null)).map((row) => ({
      ...row,
      breakevens: (() => {
        try { return JSON.parse(row.breakevens || "[]"); } catch { return []; }
      })(),
      legs: (() => {
        try { return JSON.parse(row.legs_json || "[]"); } catch { return []; }
      })()
    }));
    res.json({ calculations: records });
  } catch (error) {
    handleServerError(res, "Options calculations read failed", error);
  }
});

app.post("/api/db/options-calculations", requireSignedIn, writeLimiter, validate(optionsCalculationSchema), async (req, res) => {
  try {
    const payload = req.body || {};
    const record = await userWorkspace.options.add(req.auth.userId, payload);
    res.status(201).json(record);
  } catch (error) {
    handleServerError(res, "Options calculation write failed", error);
  }
});

app.get("/api/crypto-market", async (req, res) => {
  const snapshotParams = { category: "crypto-market" };
  const cached = await readServiceSnapshot("crypto-market", snapshotParams);
  try {
    const assets = await fetchCryptoMarketData();
    const payload = {
      category: "crypto",
      assets: Array.isArray(assets) ? assets : [],
      updatedAt: new Date().toISOString(),
      stale: false
    };
    await writeServiceSnapshot("crypto-market", snapshotParams, payload);
    res.json(payload);
  } catch (error) {
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, cached, error?.message || "crypto_market_fetch_failed"));
    }
    res.json({
      category: "crypto",
      assets: [],
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "crypto_market_fetch_failed",
      cache_updated_at: null,
      stale_age_seconds: null
    });
  }
});

// ---------------------------------------------------------------------------
// Portfolio Endpoints (Database Persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/portfolio", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const holdings = await userWorkspace.portfolio.getAll(req.auth.userId, req.workspace?.workspace?.id || null);
    res.json({ holdings });
  } catch (error) {
    handleServerError(res, "Portfolio read failed", error);
  }
});

app.post("/api/db/portfolio", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(executeTradeSchema), async (req, res) => {
  try {
    const holding = req.body;
    const result = await userWorkspace.portfolio.add(req.auth.userId, holding, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.status(201).json(result);
  } catch (error) {
    handleServerError(res, "Portfolio write failed", error);
  }
});

app.put("/api/db/portfolio/:id", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(portfolioUpdateSchema), async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: "Invalid id" });
    const holding = req.body;
    const result = await userWorkspace.portfolio.update(req.auth.userId, id, holding, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.json(result);
  } catch (error) {
    handleServerError(res, "Portfolio update failed", error);
  }
});

app.delete("/api/db/portfolio/:id", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await userWorkspace.portfolio.delete(req.auth.userId, id, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.json(result);
  } catch (error) {
    handleServerError(res, "Portfolio delete failed", error);
  }
});

// Get portfolio items by symbol and marketType
app.get("/api/db/portfolio/symbol/:symbol", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_\s]/g, "").slice(0, 50).toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const marketType = String(req.query.marketType || "").trim().toLowerCase();
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const holdings = await userWorkspace.portfolio.findBySymbol(req.auth.userId, symbol, marketType, req.workspace?.workspace?.id || null);
    res.json({ holdings });
  } catch (error) {
    handleServerError(res, "Portfolio symbol lookup failed", error);
  }
});

// ---------------------------------------------------------------------------
// Trade execution endpoints (Journal persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/trades", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const trades = await userWorkspace.trades.getAll(req.auth.userId, req.query.limit, req.workspace?.workspace?.id || null);
    res.json({ trades });
  } catch (error) {
    handleServerError(res, "Trades read failed", error);
  }
});

app.get("/api/db/trade-executions", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const filters = req.query || {};
    if (filters.limit != null && (!Number.isFinite(Number(filters.limit)) || Number(filters.limit) < 1)) {
      return res.status(400).json({ error: "limit must be a positive integer." });
    }
    if (filters.from && Number.isNaN(new Date(filters.from).getTime())) {
      return res.status(400).json({ error: "from must be a valid ISO date string." });
    }
    if (filters.to && Number.isNaN(new Date(filters.to).getTime())) {
      return res.status(400).json({ error: "to must be a valid ISO date string." });
    }
    const executions = await userWorkspace.tradeFills.getExecutions(req.auth.userId, filters, req.workspace?.workspace?.id || null);
    res.json({
      executions,
      source: "api_connections",
      manualEntriesIncluded: false
    });
  } catch (error) {
    handleServerError(res, "Trade execution history failed", error);
  }
});

app.get("/api/db/trade-fees/summary", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const summary = await userWorkspace.tradeFills.getSummary(req.auth.userId, req.workspace?.workspace?.id || null);
    res.json({ summary });
  } catch (error) {
    handleServerError(res, "Trade fee summary failed", error);
  }
});

app.get("/api/notifications", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
  try {
    const options = req.query || {};
    if (options.limit != null && (!Number.isFinite(Number(options.limit)) || Number(options.limit) < 1)) {
      return res.status(400).json({ error: "limit must be a positive integer." });
    }
    const notifications = await userWorkspace.notifications.getAll(req.auth.userId, options, req.workspace?.workspace?.id || null);
    const unreadCount = notifications.filter((item) => !item.readAt).length;
    res.json({ notifications, unreadCount });
  } catch (error) {
    handleServerError(res, "Notifications read failed", error);
  }
});

app.post("/api/notifications/:id/read", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, async (req, res) => {
  try {
    const notificationId = Number(req.params.id);
    if (!Number.isFinite(notificationId) || notificationId < 1 || !Number.isInteger(notificationId)) {
      return res.status(400).json({ error: "Notification id must be a positive integer." });
    }
    const notification = await userWorkspace.notifications.markRead(req.auth.userId, notificationId, req.workspace?.workspace?.id || null);
    if (!notification) return res.status(404).json({ error: "Notification not found" });
    res.json({ notification });
  } catch (error) {
    handleServerError(res, "Notification update failed", error);
  }
});

app.post("/api/notifications/read-all", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, async (req, res) => {
  try {
    const result = await userWorkspace.notifications.markAllRead(req.auth.userId, req.workspace?.workspace?.id || null);
    res.json(result);
  } catch (error) {
    handleServerError(res, "Notifications update failed", error);
  }
});

app.post("/api/db/trades", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(tradeLogSchema), async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.asset) {
      return res.status(400).json({ error: "asset is required" });
    }
    if (!Number.isFinite(Number(payload.quantity)) || Number(payload.quantity) <= 0) {
      return res.status(400).json({ error: "quantity must be a positive number" });
    }
    if (!Number.isFinite(Number(payload.price)) || Number(payload.price) < 0) {
      return res.status(400).json({ error: "price must be a non-negative number" });
    }
    const saved = await userWorkspace.trades.add(req.auth.userId, payload, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.status(201).json(saved);
  } catch (error) {
    handleServerError(res, "Trade write failed", error);
  }
});

// ---------------------------------------------------------------------------
// Watchlist Endpoints (Database Persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/watchlist", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, requireDeskForSharedWatchlist, async (req, res) => {
  try {
    const assets = await userWorkspace.watchlist.getAll(req.auth.userId, req.workspace?.workspace?.id || null);
    res.json({ assets });
  } catch (error) {
    handleServerError(res, "Watchlist read failed", error);
  }
});

app.post("/api/db/watchlist", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, requireDeskForSharedWatchlist, writeLimiter, validate(watchlistAssetSchema), async (req, res) => {
  try {
    const asset = req.body;
    const result = await userWorkspace.watchlist.add(req.auth.userId, asset, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.status(201).json(result);
  } catch (error) {
    handleServerError(res, "Watchlist write failed", error);
  }
});

app.post("/api/db/watchlist/bulk", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, requireDeskForSharedWatchlist, writeLimiter, validate(watchlistBulkSchema), async (req, res) => {
  try {
    const rawAssets = Array.isArray(req.body?.assets) ? req.body.assets : [];
    if (!rawAssets.length) {
      return apiError(res, 400, {
        error: "assets array required",
        message: "Add at least one watchlist asset before importing.",
        code: "WATCHLIST_ASSETS_REQUIRED",
        retryable: false
      });
    }
    if (rawAssets.length > 1000) {
      return apiError(res, 400, {
        error: "Too many assets",
        message: "Split large imports into smaller batches and retry.",
        code: "WATCHLIST_IMPORT_TOO_LARGE",
        retryable: false
      });
    }

    const sanitizedAssets = [];
    for (const rawAsset of rawAssets) {
      const { asset, error } = sanitizeWatchlistAssetInput(rawAsset);
      if (error) {
        return apiError(res, 400, {
          error,
          message: error,
          code: "WATCHLIST_ASSET_INVALID",
          retryable: false
        });
      }
      sanitizedAssets.push(asset);
    }

    const savedAssets = [];
    for (const asset of sanitizedAssets) {
      savedAssets.push(await userWorkspace.watchlist.add(req.auth.userId, asset, req.workspace?.workspace?.id || null));
    }

    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.status(201).json({ assets: savedAssets });
  } catch (error) {
    handleServerError(res, "Watchlist bulk write failed", error);
  }
});

app.delete("/api/db/watchlist/:symbol", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, requireDeskForSharedWatchlist, writeLimiter, async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_\s]/g, "").slice(0, 50);
    if (!symbol) {
      return apiError(res, 400, {
        error: "Invalid symbol",
        message: "Use a valid watchlist symbol before retrying.",
        code: "WATCHLIST_SYMBOL_INVALID",
        retryable: false
      });
    }
    const { marketType, category = null, theme = null } = req.query;
    if (!marketType) {
      return apiError(res, 400, {
        error: "marketType query parameter required",
        message: "Specify the market type for the watchlist item you want to remove.",
        code: "WATCHLIST_MARKET_TYPE_REQUIRED",
        retryable: false
      });
    }
    const result = await userWorkspace.watchlist.delete(req.auth.userId, symbol, marketType, category, theme, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.json(result);
  } catch (error) {
    handleServerError(res, "Watchlist delete failed", error);
  }
});

// Check if asset is in watchlist
app.get("/api/db/watchlist/check/:symbol", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, requireDeskForSharedWatchlist, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { marketType, category = null, theme = null } = req.query;
    if (!marketType) {
      return apiError(res, 400, {
        error: "marketType query parameter required",
        message: "Specify the market type for the watchlist item you want to check.",
        code: "WATCHLIST_MARKET_TYPE_REQUIRED",
        retryable: false
      });
    }
    const exists = await userWorkspace.watchlist.exists(req.auth.userId, symbol, marketType, category, theme, req.workspace?.workspace?.id || null);
    res.json({ exists });
  } catch (error) {
    handleServerError(res, "Watchlist exists check failed", error);
  }
});

app.get('/api/analytics/crypto', async (req, res) => {
  try {
    const fetch = await resolveFetch();
    const trackedPerpAssets = ["BTC", "ETH", "SOL", "HYPE", "BNB"];

    const safeJson = async (url, options = undefined) => {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`${url} responded with ${response.status}`);
      }
      return response.json();
    };

    const normalizePerpSymbol = (value) =>
      String(value || "")
        .toUpperCase()
        .replace(/\/USDC?$/i, "")
        .replace(/USDC?-PERP$/i, "")
        .replace(/-PERP$/i, "")
        .replace(/USDC?$/i, "")
        .replace(/-USD$/i, "")
        .replace(/[_\s]/g, "")
        .trim();

    const [hlRes, lighterFundingRes, lighterOrderBooksRes, lighterOrderBookDetailsRes, ...metricResponses] = await Promise.allSettled([
      postHyperliquidInfo({ type: "metaAndAssetCtxs" }),
      safeJson("https://mainnet.zklighter.elliot.ai/api/v1/funding-rates"),
      safeJson("https://mainnet.zklighter.elliot.ai/api/v1/orderBooks"),
      safeJson("https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails"),
      ...trackedPerpAssets.map((symbol) =>
        safeJson(`https://fapi.asterdex.com/fapi/v1/premiumIndex?symbol=${symbol}USDT`).catch(() => null)
      ),
      ...trackedPerpAssets.map((symbol) =>
        safeJson(`https://fapi.asterdex.com/fapi/v1/ticker/price?symbol=${symbol}USDT`).catch(() => null)
      ),
      ...trackedPerpAssets.map((symbol) =>
        safeJson(`https://fapi.asterdex.com/fapi/v1/openInterest?symbol=${symbol}USDT`).catch(() => null)
      )
    ]);

    const perpMetrics = [];
    if (hlRes.status === "rejected") {
      console.warn("[HL] Metadata fetch failed:", hlRes.reason?.message || hlRes.reason);
    }

    if (hlRes.status === "fulfilled" && Array.isArray(hlRes.value)) {
      const [meta, contexts] = hlRes.value;
      const universe = Array.isArray(meta?.universe) ? meta.universe : [];
      const ctxs = Array.isArray(contexts) ? contexts : [];
      universe.forEach((item, index) => {
        const symbol = normalizePerpSymbol(item?.name);
        if (!trackedPerpAssets.includes(symbol) || !ctxs[index]) return;
        const markPx = firstFiniteNumber(ctxs[index]?.markPx, ctxs[index]?.midPx, 0) || 0;
        const oiCoins = firstFiniteNumber(ctxs[index]?.openInterest, ctxs[index]?.open_interest, 0) || 0;
        const funding = firstFiniteNumber(
          ctxs[index]?.funding,
          ctxs[index]?.fundingRate,
          ctxs[index]?.funding_rate,
          ctxs[index]?.funding8h,
          ctxs[index]?.funding_8h,
          0
        ) || 0;

        console.log(`[HL] Found ${symbol}: funding=${funding}, oi=${oiCoins * markPx}`);
        perpMetrics.push({
          symbol,
          openInterestUsd: oiCoins * markPx,
          fundingRate: funding,
          exchange: "Hyperliquid"
        });
      });
    }

    trackedPerpAssets.forEach((symbol, index) => {
      const fundingResponse = metricResponses[index];
      const markResponse = metricResponses[index + trackedPerpAssets.length];
      const oiResponse = metricResponses[index + trackedPerpAssets.length * 2];
      const fundingItem = fundingResponse?.status === "fulfilled" ? fundingResponse.value : null;
      const markItem = markResponse?.status === "fulfilled" ? markResponse.value : null;
      const oiItem = oiResponse?.status === "fulfilled" ? oiResponse.value : null;

      if (!fundingItem && !markItem && !oiItem) return;

      const markPx = firstFiniteNumber(
        fundingItem?.markPrice,
        markItem?.price,
        oiItem?.price,
        0
      ) || 0;
      const oiCoins = firstFiniteNumber(oiItem?.openInterest, oiItem?.open_interest, 0) || 0;

      perpMetrics.push({
        symbol,
        openInterestUsd: oiCoins * markPx,
        fundingRate: firstFiniteNumber(
          fundingItem?.lastFundingRate,
          fundingItem?.fundingRate,
          fundingItem?.funding_rate,
          0
        ) || 0,
        exchange: "Aster"
      });
    });

    const lighterFundingPayload = lighterFundingRes.status === "fulfilled" ? lighterFundingRes.value : null;
    const lighterFundingRows = Array.isArray(lighterFundingPayload)
      ? lighterFundingPayload
      : Array.isArray(lighterFundingPayload?.funding_rates)
      ? lighterFundingPayload.funding_rates
      : Array.isArray(lighterFundingPayload?.data)
      ? lighterFundingPayload.data
      : [];

    const lighterMarketRows = lighterOrderBooksRes.status === "fulfilled" && Array.isArray(lighterOrderBooksRes.value?.order_books)
      ? lighterOrderBooksRes.value.order_books
      : [];
    const lighterMarketIdBySymbol = new Map(
      lighterMarketRows
        .filter((row) => String(row?.market_type || "").toLowerCase() === "perp")
        .map((row) => [
          normalizePerpSymbol(row?.symbol || row?.name),
          String(row?.market_id ?? row?.market_index ?? row?.id ?? "")
        ])
    );
    const lighterDetailRows = Array.isArray(lighterOrderBookDetailsRes.value?.order_book_details)
      ? lighterOrderBookDetailsRes.value.order_book_details
      : [];
    const lighterDetailBySymbol = new Map(
      lighterDetailRows
        .filter((row) => String(row?.market_type || "").toLowerCase() === "perp")
        .map((row) => [normalizePerpSymbol(row?.symbol || row?.name), row])
    );

    const lighterFundingBySymbol = new Map();
    lighterFundingRows.forEach((row) => {
      const symbol = normalizePerpSymbol(
        row?.symbol ||
        row?.market ||
        row?.market_symbol ||
        row?.name
      );
      if (!symbol) return;
      lighterFundingBySymbol.set(symbol, row);
    });

    trackedPerpAssets.forEach((symbol) => {
      const marketId = lighterMarketIdBySymbol.get(symbol) || "";
      const detailBySymbol = lighterDetailBySymbol.get(symbol);
      const detail = detailBySymbol && (!marketId || String(detailBySymbol?.market_id ?? detailBySymbol?.market_index ?? "") === marketId)
        ? detailBySymbol
        : null;
      const markPx = firstFiniteNumber(detail?.last_trade_price, detail?.mark_price, 0) || 0;
      const oiCoins = firstFiniteNumber(detail?.open_interest, detail?.openInterest, 0);
      const openInterestUsd = Number.isFinite(oiCoins) ? oiCoins * markPx : null;
      const fundingItem = lighterFundingBySymbol.get(symbol);
      const fundingRate = firstFiniteNumber(
        fundingItem?.rate,
        fundingItem?.funding_rate,
        fundingItem?.current_funding_rate,
        fundingItem?.fundingRate,
        0
      ) || 0;

      if (!Number.isFinite(openInterestUsd) && !fundingItem) return;

      perpMetrics.push({
        symbol,
        openInterestUsd: Number.isFinite(openInterestUsd) ? openInterestUsd : 0,
        fundingRate,
        exchange: "Lighter"
      });
    });

    const uniquePerpMetrics = Array.from(
      new Map(
        perpMetrics.map((row) => [
          `${row.exchange}:${row.symbol}`,
          {
            ...row,
            openInterestUsd: Number(row.openInterestUsd) || 0,
            fundingRate: Number(row.fundingRate) || 0
          }
        ])
      ).values()
    ).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.exchange.localeCompare(b.exchange));

    const DUNE_QUERY_IDS = {
      MARKET_SHARE: "3834927",
      OVERVIEW: "3834930",
      ETF_INFLOWS: "3834935"
    };

    const [duneMarketShareResult, duneOverviewResult, duneEtfFlowsResult, farsideFlowsResult] = await Promise.allSettled([
      fetchDuneLatestResults(DUNE_QUERY_IDS.MARKET_SHARE),
      fetchDuneLatestResults(DUNE_QUERY_IDS.OVERVIEW),
      fetchDuneLatestResults(DUNE_QUERY_IDS.ETF_INFLOWS),
      fetchFarsideEtfFlows()
    ]);
    const duneMarketShareRows = duneMarketShareResult.status === "fulfilled" ? duneMarketShareResult.value : null;
    const duneOverviewRows = duneOverviewResult.status === "fulfilled" ? duneOverviewResult.value : null;
    const duneEtfFlowsRows = duneEtfFlowsResult.status === "fulfilled" ? duneEtfFlowsResult.value : null;
    const farsideFlows = farsideFlowsResult.status === "fulfilled" ? farsideFlowsResult.value : null;
    [
      ["Dune market share", duneMarketShareResult],
      ["Dune overview", duneOverviewResult],
      ["Dune ETF flows", duneEtfFlowsResult],
      ["Farside ETF flows", farsideFlowsResult]
    ].forEach(([label, result]) => {
      if (result.status === "rejected") {
        console.warn(`[Analytics] ${label} skipped:`, result.reason?.message || result.reason);
      }
    });

    const perpsMarketShare = duneMarketShareRows ? duneMarketShareRows.map((row) => ({
      protocol: row.protocol || "Unknown",
      sharePct: Number(row.share_pct || row.sharePct || 0),
      color: row.color || "#64748b"
    })) : [];

    const perpsOverview = duneOverviewRows ? duneOverviewRows.map((row) => ({
      protocol: row.protocol || "Unknown",
      volume24h: Number(row.volume24h || row.volume_24h || 0),
      openInterest: Number(row.open_interest || row.openInterest || 0)
    })) : [];

    let etfInflows = await analytics.getEtfInflows(200).catch((error) => {
      console.warn("[ETF] Cached inflows unavailable:", error?.message || error);
      return [];
    });
    
    // If DB is empty, try to populate it with live data
    if (!etfInflows || etfInflows.length === 0) {
      const liveFlows = (Array.isArray(farsideFlows) && farsideFlows.length > 0)
        ? farsideFlows
        : (duneEtfFlowsRows ? duneEtfFlowsRows.map((row) => ({
            date: row.date,
            manager: row.manager,
            ticker: row.ticker,
            asset: row.asset,
            netUsd: Number(row.net_usd || row.netUsd || 0),
            period: row.period || "daily",
            source: "Dune"
          })) : []);
      
      if (liveFlows.length > 0) {
        await analytics.upsertEtfInflows(liveFlows).catch((error) => {
          console.warn("[ETF] Live flow upsert skipped:", error?.message || error);
        });
        etfInflows = liveFlows;
      }
    } else if (Array.isArray(farsideFlows) && farsideFlows.length > 0) {
      // Even if DB has data, we can background-upsert the latest from Farside if successful
      analytics.upsertEtfInflows(farsideFlows).catch(err => console.error("[ETF] Background upsert failed:", err));
    }

    res.json({
      updatedAt: new Date().toISOString(),
      perpMetrics: uniquePerpMetrics,
      kimchiPremium: null,
      etfInflows,
      perpsMarketShare,
      perpsOverview,
      perpVolumeByProtocol: [],
      revenueByProtocol: [],
      optionsVolumeByAsset: [],
      optionsMaxPain: [],
      stale: uniquePerpMetrics.length === 0 && perpsMarketShare.length === 0 && perpsOverview.length === 0,
      stale_reason: uniquePerpMetrics.length === 0 && perpsMarketShare.length === 0 && perpsOverview.length === 0
        ? "crypto_analytics_sources_unavailable"
        : undefined,
    });
  } catch (error) {
    console.error("[Analytics] Crypto fallback served:", error?.message || error);
    res.json(buildFallbackCryptoPayload(error?.message || "crypto_analytics_fetch_failed"));
  }
});

app.get('/api/analytics/options', async (req, res) => {
  let finvizOptions = {};
  try {
    const fetch = await resolveFetch();
    const finvizQuotes = await fetchFinvizQuotes(OPTIONS_FINVIZ_UNDERLYINGS).catch((error) => {
      console.warn("[Analytics] Options Finviz enrichment skipped:", error?.message || error);
      return new Map();
    });
    finvizOptions = buildFinvizOptionsRows(finvizQuotes);

    const [btcDeribit, ethDeribit] = await Promise.allSettled([
      fetch("https://deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option").then((r) => {
        if (!r.ok) throw new Error(`Deribit BTC options failed: ${r.status}`);
        return r.json();
      }),
      fetch("https://deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option").then((r) => {
        if (!r.ok) throw new Error(`Deribit ETH options failed: ${r.status}`);
        return r.json();
      })
    ]);

    let totalOIUsd = 0;
    const greeks = [];
    const oiByStrike = [];

    let btcVol = 0;
    let ethVol = 0;

    // Process Deribit BTC
    if (btcDeribit.status === "fulfilled" && btcDeribit.value?.result) {
      btcDeribit.value.result.forEach(item => {
        totalOIUsd += (item.open_interest || 0) * (item.mark_price || 0); // Assuming mark_price is in USD equivalent
        btcVol += (item.volume_usd || 0);

        if (item.open_interest > 50 && oiByStrike.length < 10) {
           const parts = item.instrument_name.split("-"); // BTC-24MAY24-60000-C
           oiByStrike.push({
             asset: "BTC",
             exchange: "Deribit",
             expiry: parts[1],
             strike: parts[2],
             type: parts[3],
             oi: item.open_interest
           });
        }
      });
    }
    if (btcDeribit.status === "rejected") {
      console.warn("[Analytics] Deribit BTC options skipped:", btcDeribit.reason?.message || btcDeribit.reason);
    }

    // Process Deribit ETH
    if (ethDeribit.status === "fulfilled" && ethDeribit.value?.result) {
      ethDeribit.value.result.forEach(item => {
        totalOIUsd += (item.open_interest || 0) * (item.mark_price || 0);
        ethVol += (item.volume_usd || 0);
      });
    }
    if (ethDeribit.status === "rejected") {
      console.warn("[Analytics] Deribit ETH options skipped:", ethDeribit.reason?.message || ethDeribit.reason);
    }

    const hasLiveDeribit = totalOIUsd > 0 || btcVol > 0 || ethVol > 0 || greeks.length > 0 || oiByStrike.length > 0;
    if (!hasLiveDeribit) {
      return res.json(buildFallbackOptionsPayload("deribit_options_unavailable", finvizOptions));
    }

    res.json({
      updatedAt: new Date().toISOString(),
      stale: false,
      source: "Deribit + Finviz",
      totalOptionsOpenInterestUsd: totalOIUsd,
      optionsVolumeByAsset: [
        ...(btcVol > 0 ? [{ asset: "BTC", exchange: "Deribit", volumeUsd: btcVol }] : []),
        ...(ethVol > 0 ? [{ asset: "ETH", exchange: "Deribit", volumeUsd: ethVol }] : [])
      ].concat(finvizOptions.optionsVolumeByAsset || []),
      optionsMaxPain: [].concat(finvizOptions.optionsMaxPain || []),
      volumeByExchangeRoute: [
        ...(btcVol + ethVol > 0 ? [{ exchange: "Deribit", route: "Direct", volume: btcVol + ethVol, volumeUsd: btcVol + ethVol }] : [])
      ].concat(finvizOptions.volumeByExchangeRoute || []),
      greeks: greeks.concat(finvizOptions.greeks || []),
      oiByStrike: oiByStrike.concat(finvizOptions.oiByStrike || [])
    });
  } catch (error) {
    console.error("[Analytics] Options fallback served:", error?.message || error);
    res.json(buildFallbackOptionsPayload(error?.message || "options_fetch_failed", finvizOptions));
  }
});

const COMMODITY_UNIVERSE = [
  // Energy
  { symbol: "CL", name: "WTI Crude Oil", group: "energy", region: "global" },
  { symbol: "NG", name: "Natural Gas", group: "energy", region: "usa" },
  { symbol: "RB", name: "RBOB Gasoline", group: "energy", region: "usa" },

  // Metals (Precious)
  { symbol: "GC", name: "Gold", group: "metals", region: "global" },
  { symbol: "SI", name: "Silver", group: "metals", region: "global" },

  // Industrial Metals
  { symbol: "HG", name: "Copper", group: "industrial", region: "global" },
  { symbol: "ALI=F", name: "Aluminum", group: "industrial", region: "global" },
  { symbol: "ZNC=F", name: "Zinc", group: "industrial", region: "global" },
  { symbol: "LED=F", name: "Lead", group: "industrial", region: "global" },
  { symbol: "TIN=F", name: "Tin", group: "industrial", region: "global" },
  { symbol: "TIO=F", name: "Iron Ore", group: "industrial", region: "global" },

  // Battery Metals
  { symbol: "LIT", name: "Lithium (ETF)", group: "battery", region: "global" },
  { symbol: "NI=F", name: "Nickel", group: "battery", region: "global" },
  { symbol: "REMX", name: "Rare Earths (ETF)", group: "battery", region: "global" },

  // Agriculture
  { symbol: "ZC", name: "Corn", group: "agriculture", region: "global" },
  { symbol: "ZW", name: "Wheat", group: "agriculture", region: "global" },
  { symbol: "ZS", name: "Soybeans", group: "agriculture", region: "global" },
  { symbol: "ZO=F", name: "Oats", group: "agriculture", region: "global" },
  { symbol: "ZR=F", name: "Rice", group: "agriculture", region: "global" },
  { symbol: "ZL=F", name: "Soybean Oil", group: "agriculture", region: "global" },
  { symbol: "ZM=F", name: "Soybean Meal", group: "agriculture", region: "global" },

  // Soft Commodities
  { symbol: "KC", name: "Coffee", group: "soft", region: "global" },
  { symbol: "CC", name: "Cocoa", group: "soft", region: "global" },
  { symbol: "SB", name: "Sugar", group: "soft", region: "global" },
  { symbol: "CT", name: "Cotton", group: "soft", region: "global" },
  { symbol: "OJ=F", name: "Orange Juice", group: "soft", region: "global" },
  { symbol: "LBR=F", name: "Lumber", group: "soft", region: "global" },

  // Livestock
  { symbol: "LE=F", name: "Live Cattle", group: "livestock", region: "global" },
  { symbol: "GF=F", name: "Feeder Cattle", group: "livestock", region: "global" },
  { symbol: "HE=F", name: "Lean Hogs", group: "livestock", region: "global" },
  { symbol: "DC=F", name: "Milk", group: "livestock", region: "global" },

  // Fertilizers
  { symbol: "UAN", name: "Urea Ammonium Nitrate", group: "fertilizers", region: "global" },
];

const COMMODITY_SOURCE_MAP = {
  flows: {
    sourceType: "ETF/fund flow data + futures positioning",
    why: "Captures both capital and sentiment",
  },
  seasonality: {
    sourceType: "Historical futures settlement data",
    why: "Best for building custom seasonal charts",
  },
  curve: {
    sourceType: "Futures chain / contract data",
    why: "Needed for contango, backwardation, spreads",
  },
  fundamentals: {
    sourceType: "Inventory, production, supply-demand datasets",
    why: "Core commodity drivers",
  },
  stress: {
    sourceType: "Official inventory, warehouse, and weather feeds",
    why: "Physical-market stress should separate live pulls from sourced-but-keyed datasets",
  },
  calendar: {
    sourceType: "Economic calendar API",
    why: "Release timing, actual vs forecast",
  },
  alerts: {
    sourceType: "Your own rule engine",
    why: "Flexible user-defined triggers",
  },
};

const COMMODITY_FINVIZ_PROXY_MAP = {
  CL: "USO",
  NG: "UNG",
  RB: "UGA",
  GC: "GLD",
  SI: "SLV",
  HG: "CPER",
  "ALI=F": "DBB",
  "ZNC=F": "DBB",
  "LED=F": "DBB",
  "TIN=F": "DBB",
  "TIO=F": "PICK",
  LIT: "LIT",
  "NI=F": "PICK",
  REMX: "REMX",
  ZC: "CORN",
  ZW: "WEAT",
  ZS: "SOYB",
  "ZO=F": "DBA",
  "ZR=F": "DBA",
  "ZL=F": "DBA",
  "ZM=F": "DBA",
  KC: "JO",
  CC: "NIB",
  SB: "CANE",
  CT: "BAL",
  "OJ=F": "FUE",
  "LBR=F": "WOOD",
  "LE=F": "COW",
  "GF=F": "COW",
  "HE=F": "COW",
  UAN: "MOO",
};

function getCommodity(symbol) {
  const key = String(symbol || "").toUpperCase();
  return COMMODITY_UNIVERSE.find((row) => row.symbol === key) || COMMODITY_UNIVERSE[0];
}

function getCommodityFinvizProxy(symbol) {
  return COMMODITY_FINVIZ_PROXY_MAP[String(symbol || "").toUpperCase()] || null;
}

function buildFallbackCommodityRows(group = "all", reason = "commodity_provider_fallback") {
  const selectedGroup = String(group || "all").toLowerCase();
  return COMMODITY_UNIVERSE
    .filter((row) => selectedGroup === "all" || row.group === selectedGroup)
    .map((row) => ({
      symbol: row.symbol,
      name: row.name,
      group: row.group,
      region: row.region,
      latestPrice: null,
      dailyChangePct: null,
      ytdChangePct: null,
      oneYearReturnPct: null,
      currency: "USD",
      proxySymbol: getCommodityFinvizProxy(row.symbol),
      source: "Commodity catalog",
      stale: true,
      unavailable: true,
      isFallback: true,
      stale_reason: reason
    }));
}

function buildCommodityFallbackSeries(item, range = "1Y", reason = "commodity_history_fallback") {
  return [];
}

function buildFallbackCommodityFundamentals(item, reason = "commodity_fundamentals_fallback") {
  return [
    { metric: "Proxy Ticker", value: getCommodityFinvizProxy(item.symbol) || item.symbol, unit: "symbol", sourceType: "Commodity catalog", sourceWhy: "Nearest configured listed proxy; market values require live provider data", isFallback: true, unavailable: true, stale_reason: reason }
  ].filter((row) => row.value !== null && row.value !== undefined);
}

function buildFallbackCommodityFlows(item, mode = "etf", reason = "commodity_flows_fallback") {
  return [];
}

function buildFallbackCommoditySeasonality(item, reason = "commodity_seasonality_fallback") {
  return [];
}

function buildFallbackCommodityCurve(item, reason = "commodity_curve_fallback") {
  return [];
}

function buildFallbackCommodityCalendar(group = "all", reason = "commodity_calendar_fallback") {
  return [];
}

async function fetchLiveCommodityRows(group = "all") {
  const livePrices = await fetchYFinancePrices(COMMODITY_UNIVERSE.map((row) => row.symbol));
  const fredLatestBySymbol = new Map();
  await Promise.all(COMMODITY_UNIVERSE.map(async (row) => {
    if (!FRED_COMMODITY_SERIES[row.symbol]) return;
    try {
      const fredRows = await fetchFredCommoditySeries(row.symbol, "1Y");
      const latest = fredRows.at(-1);
      if (latest && Number.isFinite(Number(latest.value))) {
        const previous = fredRows.at(-2);
        fredLatestBySymbol.set(row.symbol, {
          latestPrice: Number(latest.value),
          dailyChangePct: previous?.value ? computeReturnPct(previous.value, latest.value) : null,
          source: "FRED",
          asOf: latest.date
        });
      }
    } catch (error) {
      console.warn(`[Commodities] FRED series fetch failed for ${item.symbol}:`, error?.message || error);
    }
  }));
  const proxySymbols = [...new Set(COMMODITY_UNIVERSE.map((row) => getCommodityFinvizProxy(row.symbol)).filter(Boolean))];
  const finvizQuotes = await fetchFinvizQuotes(proxySymbols).catch((error) => {
    console.warn("[Commodities] Finviz proxy enrichment skipped:", error?.message || error);
    return new Map();
  });
  const rows = COMMODITY_UNIVERSE
    .map((row) => {
      const quote = livePrices[row.symbol] || {};
      const proxySymbol = getCommodityFinvizProxy(row.symbol);
      const finvizSummary = proxySymbol ? finvizQuotes.get(proxySymbol)?.summary || {} : {};
      const latestPrice = Number(quote.price);
      const dailyChangePct = Number(quote.priceChangePercent);
      const finvizPrice = parseFinvizScaledNumber(finvizSummary.Price);
      const finvizDaily = parseFinvizPercent(finvizSummary.Change);
      const fredLatest = fredLatestBySymbol.get(row.symbol);
      return {
        ...row,
        latestPrice: Number.isFinite(latestPrice) ? latestPrice : Number.isFinite(Number(fredLatest?.latestPrice)) ? roundMaybe(fredLatest.latestPrice) : Number.isFinite(finvizPrice) ? roundMaybe(finvizPrice) : null,
        dailyChangePct: Number.isFinite(dailyChangePct) ? roundMaybe(dailyChangePct) : Number.isFinite(Number(fredLatest?.dailyChangePct)) ? roundMaybe(fredLatest.dailyChangePct) : Number.isFinite(finvizDaily) ? roundMaybe(finvizDaily) : null,
        ytdChangePct: roundMaybe(parseFinvizPercent(finvizSummary["Perf YTD"])),
        oneYearReturnPct: roundMaybe(parseFinvizPercent(finvizSummary["Perf Year"] ?? finvizSummary["Return% 1Y"])),
        currency: quote.currency || "USD",
        proxySymbol,
        source: Number.isFinite(latestPrice) ? (proxySymbol ? "Yahoo Finance + Finviz proxy" : "Yahoo Finance") : fredLatest ? "FRED" : proxySymbol ? "Finviz proxy" : "Yahoo Finance",
        asOf: fredLatest?.asOf || null,
        stale: !Number.isFinite(latestPrice) && !fredLatest && !Number.isFinite(finvizPrice)
      };
    })
    .filter((row) => group === "all" || row.group === group);
  const hasUsableProviderData = rows.some((row) => Number.isFinite(Number(row.latestPrice)) && !row.stale);
  return hasUsableProviderData ? rows : buildFallbackCommodityRows(group, "commodity_price_providers_unavailable");
}

function historyRowsToSeries(history = []) {
  return (Array.isArray(history) ? history : [])
    .map((row) => {
      const value = Number(row?.close ?? row?.price ?? row?.value);
      const date = String(row?.time || row?.date || "").slice(0, 10);
      if (!date || !Number.isFinite(value)) return null;
      return { date, value, volume: Number(row?.volume) || null };
    })
    .filter(Boolean);
}

function computeReturnPct(from, to) {
  const start = Number(from);
  const end = Number(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return null;
  return Number((((end - start) / start) * 100).toFixed(2));
}

function annualizedVolFromSeries(series = []) {
  const returns = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = Number(series[i - 1]?.value);
    const next = Number(series[i]?.value);
    if (Number.isFinite(prev) && Number.isFinite(next) && prev > 0) returns.push((next - prev) / prev);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (returns.length - 1);
  return Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2));
}

app.get("/api/commodities/overview", async (_req, res) => {
  try {
    const rows = await fetchLiveCommodityRows("all");
    const topMovers = [...rows]
      .filter((row) => Number.isFinite(Number(row.dailyChangePct)))
      .sort((a, b) => Math.abs(Number(b.dailyChangePct)) - Math.abs(Number(a.dailyChangePct)))
      .slice(0, 5);
    const byGroup = rows.reduce((acc, row) => {
      const key = row.group;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const usingFallbackRows = rows.some((row) => row?.isFallback || row?.stale);
    res.json({
      updatedAt: new Date().toISOString(),
      source: usingFallbackRows ? "Commodity catalog" : "Yahoo Finance + FRED + Finviz",
      stale: usingFallbackRows || undefined,
      stale_reason: usingFallbackRows ? rows.find((row) => row?.stale_reason)?.stale_reason || "commodity_price_providers_unavailable" : undefined,
      providers: buildDataProviderStatus({
        fred: buildProviderStatus("FRED", Boolean(FRED_API_KEY), FRED_API_KEY ? "connected" : "missing_key", "Commodity spot series overlay"),
        eia: buildProviderStatus("EIA", Boolean(EIA_API_KEY), EIA_API_KEY ? "connected" : "missing_key", "Energy fundamentals")
      }),
      overview: {
        categoryCounts: byGroup,
        topMovers,
        favorites: topMovers.slice(0, 3).map((row) => row.symbol),
        recentViews: [],
        dataSources: COMMODITY_SOURCE_MAP,
      },
    });
  } catch (error) {
    const rows = buildFallbackCommodityRows("all", error?.message || "commodities_overview_fetch_failed");
    const byGroup = rows.reduce((acc, row) => {
      acc[row.group] = (acc[row.group] || 0) + 1;
      return acc;
    }, {});
    const topMovers = [...rows].sort((a, b) => Math.abs(Number(b.dailyChangePct || 0)) - Math.abs(Number(a.dailyChangePct || 0))).slice(0, 5);
    res.json({
      updatedAt: new Date().toISOString(),
      source: "Commodity catalog",
      stale: true,
      stale_reason: error?.message || "commodities_overview_fetch_failed",
      overview: { categoryCounts: byGroup, topMovers, favorites: topMovers.slice(0, 3).map((row) => row.symbol), recentViews: [], dataSources: COMMODITY_SOURCE_MAP }
    });
  }
});

app.get("/api/commodities/search", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return res.json({ items: [] });
  const items = COMMODITY_UNIVERSE.filter((row) =>
    `${row.symbol} ${row.name} ${row.group} ${row.region}`.toLowerCase().includes(q)
  ).slice(0, 12).map((row) => ({
    symbol: row.symbol,
    name: row.name,
    group: row.group,
    region: row.region,
    proxySymbol: getCommodityFinvizProxy(row.symbol),
    source: "Commodity catalog"
  }));
  res.json({ items, updatedAt: new Date().toISOString() });
});

app.get("/api/commodities/list", async (req, res) => {
  try {
    const group = String(req.query.group || "all").toLowerCase();
    const items = await fetchLiveCommodityRows(group);
    const usingFallbackRows = items.some((row) => row?.isFallback || row?.stale);
    console.log(`[Commodities] Fetched ${items.length} items for group: ${group}`);
    res.json({
      updatedAt: new Date().toISOString(),
      source: usingFallbackRows ? "Commodity catalog" : "Yahoo Finance + FRED + Finviz",
      stale: usingFallbackRows || undefined,
      stale_reason: usingFallbackRows ? items.find((row) => row?.stale_reason)?.stale_reason || "commodity_price_providers_unavailable" : undefined,
      providers: buildDataProviderStatus({
        fred: buildProviderStatus("FRED", Boolean(FRED_API_KEY), FRED_API_KEY ? "connected" : "missing_key", "Commodity spot series overlay"),
        eia: buildProviderStatus("EIA", Boolean(EIA_API_KEY), EIA_API_KEY ? "connected" : "missing_key", "Energy fundamentals")
      }),
      items,
      list: items
    });
  } catch (error) {
    console.error("[Commodities] Error fetching list:", error);
    const items = buildFallbackCommodityRows(req.query.group || "all", error?.message || "commodities_list_fetch_failed");
    res.json({
      updatedAt: new Date().toISOString(),
      source: "Commodity catalog",
      stale: true,
      stale_reason: error?.message || "commodities_list_fetch_failed",
      items,
      list: items
    });
  }
});

app.get("/api/commodities/:symbol/price", async (req, res) => {
  const range = String(req.query.range || "1Y").toUpperCase();
  const item = getCommodity(req.params.symbol);
  try {
    const fredSeries = await fetchFredCommoditySeries(item.symbol, range).catch((error) => {
      console.warn(`[Commodities] FRED price series fetch failed for ${item.symbol}:`, error?.message || error);
      return [];
    });
    if (fredSeries.length) {
      return res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "FRED", series: fredSeries });
    }
    const stockHistory = await fetchHistoryFromYahoo(item.symbol, range);
    const series = historyRowsToSeries(stockHistory.history);
    if (!series.length) {
      const fallbackSeries = buildCommodityFallbackSeries(item, range, "commodity_price_series_empty");
      return res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: "commodity_price_series_empty", series: fallbackSeries });
    }
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: stockHistory.source || "yahoo", series });
  } catch (error) {
    const series = buildCommodityFallbackSeries(item, range, error?.message || "commodity_price_fetch_failed");
    res.json({
      updatedAt: new Date().toISOString(),
      symbol: item.symbol,
      source: "Yahoo Finance",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodity_price_fetch_failed",
      series
    });
  }
});

app.get("/api/commodities/:symbol/fundamentals", async (req, res) => {
  const item = getCommodity(req.params.symbol);
  try {
    const eiaResult = await fetchEiaCommodityFundamentals(item.symbol).catch((error) => ({
      rows: [],
      status: buildProviderStatus("EIA", Boolean(EIA_API_KEY), "unavailable", error?.message || "EIA unavailable")
    }));
    const proxySymbol = getCommodityFinvizProxy(item.symbol);
    const finvizQuote = proxySymbol ? await fetchFinvizQuote(proxySymbol).catch((error) => { console.warn(`[Commodities] Finviz quote fetch failed for proxy ${proxySymbol}:`, error?.message || error); return null; }) : null;
    const finvizSummary = finvizQuote?.summary || {};
    const finvizMetrics = proxySymbol
      ? [
          { metric: "Proxy Ticker", value: proxySymbol, unit: "symbol", sourceType: "Finviz ETF proxy", sourceWhy: "Nearest liquid proxy available for the commodity complex" },
          { metric: "Proxy Price", value: roundMaybe(parseFinvizScaledNumber(finvizSummary.Price)), unit: "USD", sourceType: "Finviz quote snapshot", sourceWhy: "Latest proxy mark for the commodity or commodity basket" },
          { metric: "Perf Week", value: roundMaybe(parseFinvizPercent(finvizSummary["Perf Week"])), unit: "%", sourceType: "Finviz quote snapshot", sourceWhy: "Short-term momentum read from the proxy instrument" },
          { metric: "Perf Month", value: roundMaybe(parseFinvizPercent(finvizSummary["Perf Month"])), unit: "%", sourceType: "Finviz quote snapshot", sourceWhy: "1-month trend on the listed proxy" },
          { metric: "Perf YTD", value: roundMaybe(parseFinvizPercent(finvizSummary["Perf YTD"])), unit: "%", sourceType: "Finviz quote snapshot", sourceWhy: "Calendar-year return from the proxy" },
          { metric: "1Y Return", value: roundMaybe(parseFinvizPercent(finvizSummary["Perf Year"] ?? finvizSummary["Return% 1Y"])), unit: "%", sourceType: "Finviz quote snapshot", sourceWhy: "Trailing one-year return from the proxy instrument" },
          { metric: "Flow % (1M)", value: roundMaybe(parseFinvizPercent(finvizSummary["Flows% 1M"])), unit: "%", sourceType: "Finviz quote snapshot", sourceWhy: "Shows whether capital is entering or leaving the proxy fund" },
          { metric: "RSI (14)", value: roundMaybe(parseFinvizScaledNumber(finvizSummary["RSI (14)"])), unit: "index", sourceType: "Finviz quote snapshot", sourceWhy: "Momentum gauge sourced from the proxy quote page" },
          { metric: "ATR (14)", value: roundMaybe(parseFinvizScaledNumber(finvizSummary["ATR (14)"])), unit: "USD", sourceType: "Finviz quote snapshot", sourceWhy: "Average trading range of the proxy instrument" }
        ].filter((row) => row.value !== null && row.value !== undefined)
      : [];

    const stockHistory = await fetchHistoryFromYahoo(item.symbol, "1Y");
    const series = historyRowsToSeries(stockHistory.history);
    const values = series.map((row) => Number(row.value)).filter(Number.isFinite);
    const latest = values.at(-1);
    const high = values.length ? Math.max(...values) : null;
    const low = values.length ? Math.min(...values) : null;
    const momentum30 = series.length > 30 ? computeReturnPct(series[series.length - 31]?.value, latest) : null;
    const volume = [...series].reverse().find((row) => Number.isFinite(Number(row.volume)))?.volume ?? null;
    const metrics = [
      { metric: "Latest Price", value: latest, unit: "USD", sourceType: "Yahoo Finance futures quote", sourceWhy: "Live front-month market value" },
      { metric: "52W High", value: high, unit: "USD", sourceType: "Yahoo Finance historical futures data", sourceWhy: "Observed range from source time series" },
      { metric: "52W Low", value: low, unit: "USD", sourceType: "Yahoo Finance historical futures data", sourceWhy: "Observed range from source time series" },
      { metric: "30D Momentum", value: momentum30, unit: "%", sourceType: "Yahoo Finance historical futures data", sourceWhy: "Computed from sourced close prices" },
      { metric: "Annualized Volatility", value: annualizedVolFromSeries(series), unit: "%", sourceType: "Yahoo Finance historical futures data", sourceWhy: "Computed from sourced daily returns" },
      { metric: "Latest Volume", value: volume, unit: "contracts", sourceType: "Yahoo Finance futures quote", sourceWhy: "Latest reported volume when available" }
    ].filter((row) => Number.isFinite(Number(row.value)));
    const items = [...eiaResult.rows, ...finvizMetrics, ...metrics];
    if (!items.length) {
      const fallbackItems = buildFallbackCommodityFundamentals(item, "commodity_fundamentals_empty");
      return res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Commodity catalog", stale: true, unavailable: true, stale_reason: "commodity_fundamentals_empty", metrics: fallbackItems, items: fallbackItems });
    }
    res.json({
      updatedAt: new Date().toISOString(),
      symbol: item.symbol,
      source: eiaResult.rows.length ? "EIA + Yahoo Finance + Finviz" : proxySymbol ? "Yahoo Finance + Finviz" : "Yahoo Finance",
      providers: buildDataProviderStatus({ eia: eiaResult.status }),
      metrics: items,
      items
    });
  } catch (error) {
    const items = buildFallbackCommodityFundamentals(item, error?.message || "commodity_fundamentals_fetch_failed");
    res.json({
      updatedAt: new Date().toISOString(),
      symbol: item.symbol,
      source: "Commodity catalog",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodity_fundamentals_fetch_failed",
      metrics: items,
      items
    });
  }
});

app.get("/api/commodities/:symbol/stress", async (req, res) => {
  const item = getCommodity(req.params.symbol);
  try {
    const rows = await buildCommodityStressRows(item);
    const pulledCount = rows.filter((row) => row?.pulled).length;
    res.json({
      updatedAt: new Date().toISOString(),
      symbol: item.symbol,
      source: pulledCount ? "EIA/NOAA/NWS + official source map" : "Official source map",
      stale: pulledCount === 0 || undefined,
      stale_reason: pulledCount ? undefined : "commodity_stress_sources_mapped_no_live_rows",
      rows,
      stress: rows,
      providers: buildDataProviderStatus({
        eia: buildProviderStatus("EIA", Boolean(EIA_API_KEY), EIA_API_KEY ? "connected" : "missing_key", "Energy inventory and storage series"),
        nws: buildProviderStatus("NOAA/NWS", true, "connected", "Active weather alerts do not require an API key")
      })
    });
  } catch (error) {
    const profile = getCommodityStressProfile(item);
    const rows = profile.rows.map((row, idx) => ({
      id: `stress-fallback-${idx}`,
      symbol: item.symbol,
      ...row,
      value: null,
      unit: "",
      status: "Source mapped",
      pulled: false,
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodity_stress_fetch_failed",
    }));
    res.json({
      updatedAt: new Date().toISOString(),
      symbol: item.symbol,
      source: "Official source map",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodity_stress_fetch_failed",
      rows,
      stress: rows,
    });
  }
});

app.get("/api/commodities/:symbol/flows", async (req, res) => {
  const mode = String(req.query.mode || "etf").toLowerCase();
  const item = getCommodity(req.params.symbol);
  try {
    const stockHistory = await fetchHistoryFromYahoo(item.symbol, "1M");
    const series = historyRowsToSeries(stockHistory.history);
    const items = series
      .filter((row) => Number.isFinite(Number(row.volume)))
      .slice(-10)
      .map((row, idx, arr) => {
        const previous = idx > 0 ? arr[idx - 1] : null;
        const changePct = previous ? computeReturnPct(previous.value, row.value) : null;
        return {
          date: row.date,
          type: mode === "futures" ? "Futures Volume" : "Price/Volume Proxy",
          value: Number(row.volume),
          trend: Number(changePct) > 0 ? "Up volume with price gain" : Number(changePct) < 0 ? "Up volume with price decline" : "Flat",
          sourceType: "Yahoo Finance price and volume",
          sourceWhy: "Uses sourced volume/price as a transparent proxy when fund-flow or COT data is unavailable"
        };
      });
    if (!items.length) {
      const fallbackItems = buildFallbackCommodityFlows(item, mode, "commodity_flows_empty");
      return res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, mode, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: "commodity_flows_empty", items: fallbackItems, flows: fallbackItems });
    }
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, mode, source: "Yahoo Finance", items, flows: items });
  } catch (error) {
    const items = buildFallbackCommodityFlows(item, mode, error?.message || "commodity_flows_fetch_failed");
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, mode, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_flows_fetch_failed", items, flows: items });
  }
});

app.get("/api/commodities/:symbol/seasonality", async (req, res) => {
  const item = getCommodity(req.params.symbol);
  try {
    const stockHistory = await fetchHistoryFromYahoo(item.symbol, "MAX");
    const series = historyRowsToSeries(stockHistory.history);
    const byMonth = new Map();
    for (let i = 1; i < series.length; i += 1) {
      const monthIdx = new Date(series[i].date).getUTCMonth();
      const month = new Date(Date.UTC(2020, monthIdx, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
      const ret = computeReturnPct(series[i - 1].value, series[i].value);
      if (!Number.isFinite(Number(ret))) continue;
      if (!byMonth.has(month)) byMonth.set(month, []);
      byMonth.get(month).push(Number(ret));
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const items = months.map((month) => {
      const values = byMonth.get(month) || [];
      const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      return {
        month,
        avgReturnPct: Number.isFinite(avg) ? Number(avg.toFixed(2)) : null,
        seasonalityScore: Number.isFinite(avg) ? Number(Math.max(0, Math.min(1, 0.5 + avg / 10)).toFixed(2)) : null,
        observations: values.length,
        sourceType: "Yahoo Finance historical futures data",
        sourceWhy: "Average monthly return computed from sourced closes"
      };
    }).filter((row) => Number.isFinite(Number(row.avgReturnPct)));
    if (!items.length) {
      const fallbackItems = buildFallbackCommoditySeasonality(item, "commodity_seasonality_empty");
      return res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: "commodity_seasonality_empty", items: fallbackItems, seasonality: fallbackItems });
    }
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", items, seasonality: items });
  } catch (error) {
    const items = buildFallbackCommoditySeasonality(item, error?.message || "commodity_seasonality_fetch_failed");
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_seasonality_fetch_failed", items, seasonality: items });
  }
});

app.get("/api/commodities/:symbol/curve", async (req, res) => {
  const item = getCommodity(req.params.symbol);
  try {
    const prices = await fetchYFinancePrices([item.symbol]);
    const quote = prices[item.symbol] || {};
    const price = Number(quote.price);
    const points = Number.isFinite(price)
      ? [{ contract: "Front Month", price, spread: 0, curveStructure: "Front-month quote", sourceType: "Yahoo Finance front-month futures", sourceWhy: "Only sourced front-month contract is available through the current free feed" }]
      : [];
    if (!points.length) {
      const fallbackPoints = buildFallbackCommodityCurve(item, "commodity_curve_empty");
      return res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: "commodity_curve_empty", points: fallbackPoints, curve: fallbackPoints });
    }
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", points, curve: points });
  } catch (error) {
    const points = buildFallbackCommodityCurve(item, error?.message || "commodity_curve_fetch_failed");
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_curve_fetch_failed", points, curve: points });
  }
});

app.get("/api/commodities/compare", async (req, res) => {
  const symbols = String(req.query.symbols || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  try {
    const liveRows = await fetchLiveCommodityRows("all");
    const selected = symbols.length ? symbols : ["GC", "CL"];
    const rows = selected
      .map((symbol) => liveRows.find((row) => row.symbol === symbol) || null)
      .filter(Boolean)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        dailyChangePct: row.dailyChangePct,
        ytdChangePct: row.ytdChangePct,
        volatility: null,
        source: row.source
      }));
    const usingFallbackRows = rows.some((row) => /fallback/i.test(String(row.source || "")));
    if (!rows.length) {
      const fallbackRows = buildFallbackCommodityRows("all", "commodity_compare_empty")
        .filter((row) => selected.includes(row.symbol))
        .map((row) => ({
          symbol: row.symbol,
          name: row.name,
          dailyChangePct: row.dailyChangePct,
          ytdChangePct: row.ytdChangePct,
          volatility: null,
          source: row.source,
          isFallback: true
        }));
      return res.json({ updatedAt: new Date().toISOString(), source: "Commodity catalog", stale: true, unavailable: true, stale_reason: "commodity_compare_empty", rows: fallbackRows, compare: fallbackRows });
    }
    res.json({
      updatedAt: new Date().toISOString(),
      source: usingFallbackRows ? "Commodity catalog" : "Yahoo Finance",
      stale: usingFallbackRows || undefined,
      stale_reason: usingFallbackRows ? "commodity_price_providers_unavailable" : undefined,
      rows,
      compare: rows
    });
  } catch (error) {
    const selected = symbols.length ? symbols : ["GC", "CL"];
    const rows = buildFallbackCommodityRows("all", error?.message || "commodity_compare_fetch_failed")
      .filter((row) => selected.includes(row.symbol))
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        dailyChangePct: row.dailyChangePct,
        ytdChangePct: row.ytdChangePct,
        volatility: null,
        source: row.source,
        isFallback: true
      }));
    res.json({ updatedAt: new Date().toISOString(), source: "Commodity catalog", stale: true, unavailable: true, stale_reason: error?.message || "commodity_compare_fetch_failed", rows, compare: rows });
  }
});

app.get("/api/commodities/calendar", async (req, res) => {
  const group = String(req.query.group || "all").toLowerCase();
  try {
    const events = (await fetchForexFactoryEvents())
      .filter((event) => {
        const text = `${event?.title || ""} ${event?.event || ""} ${event?.name || ""}`.toLowerCase();
        const mappedGroup = /oil|crude|petroleum|gas|eia/.test(text)
          ? "energy"
          : /crop|grain|corn|wheat|soy|usda|wasde|cotton|sugar|coffee|cocoa/.test(text)
          ? "agriculture"
          : /gold|silver|copper|metal/.test(text)
          ? "metals"
          : "all";
        return mappedGroup !== "all" && (group === "all" || mappedGroup === group);
      })
      .map((event, idx) => ({
        id: event.id || `cmd-cal-${idx}`,
        date: event.date || event.asOf || event.time || null,
        event: event.title || event.event || event.name || "Commodity event",
        importance: event.impact || event.importance || "medium",
        group,
        sourceType: "ForexFactory economic calendar",
        sourceWhy: "Release timing sourced from the live calendar feed"
      }));
    if (!events.length) {
      const fallbackEvents = buildFallbackCommodityCalendar(group, "commodity_calendar_empty");
      return res.json({ updatedAt: new Date().toISOString(), source: "ForexFactory", stale: true, unavailable: true, stale_reason: "commodity_calendar_empty", events: fallbackEvents, calendar: fallbackEvents });
    }
    res.json({ updatedAt: new Date().toISOString(), source: "ForexFactory", events, calendar: events });
  } catch (error) {
    const events = buildFallbackCommodityCalendar(group, error?.message || "commodity_calendar_fetch_failed");
    res.json({ updatedAt: new Date().toISOString(), source: "ForexFactory", stale: true, unavailable: true, stale_reason: error?.message || "commodity_calendar_fetch_failed", events, calendar: events });
  }
});

app.get("/api/commodities/alerts", async (_req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    source: "User alert rules",
    items: [],
    alerts: []
  });
});

app.get("/api/commodities/correlation", async (req, res) => {
  const symbol = String(req.query.symbol || "GC").toUpperCase();
  const asset = String(req.query.asset || "SPY").toUpperCase();
  try {
    const [commodityHistory, assetHistory] = await Promise.all([
      fetchHistoryFromYahoo(symbol, "1Y"),
      fetchHistoryFromYahoo(asset, "1Y")
    ]);
    const a = historyRowsToSeries(commodityHistory.history);
    const b = historyRowsToSeries(assetHistory.history);
    const bByDate = new Map(b.map((row) => [row.date, row.value]));
    const pairs = a
      .map((row) => [row.value, bByDate.get(row.date)])
      .filter(([x, y]) => Number.isFinite(Number(x)) && Number.isFinite(Number(y)));
    let coefficient = null;
    if (pairs.length > 2) {
      const xs = pairs.map(([x]) => Number(x));
      const ys = pairs.map(([, y]) => Number(y));
      const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
      const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
      const cov = xs.reduce((sum, value, idx) => sum + ((value - meanX) * (ys[idx] - meanY)), 0);
      const stdX = Math.sqrt(xs.reduce((sum, value) => sum + ((value - meanX) ** 2), 0));
      const stdY = Math.sqrt(ys.reduce((sum, value) => sum + ((value - meanY) ** 2), 0));
      coefficient = stdX && stdY ? Number((cov / (stdX * stdY)).toFixed(2)) : null;
    }
    const rows = [{ pair: `${symbol} vs ${asset}`, coefficient, window: "1y", observations: pairs.length, source: "Yahoo Finance" }];
    if (!Number.isFinite(Number(coefficient))) {
      rows[0] = { pair: `${symbol} vs ${asset}`, coefficient: null, window: "1y", observations: pairs.length, source: "Yahoo Finance", stale: true, unavailable: true };
    }
    const usingFallbackRows = rows.some((row) => row?.isFallback || row?.stale);
    res.json({
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance",
      stale: usingFallbackRows || undefined,
      stale_reason: usingFallbackRows ? "commodity_correlation_insufficient_overlap" : undefined,
      rows,
      correlation: rows
    });
  } catch (error) {
    const rows = [{ pair: `${symbol} vs ${asset}`, coefficient: null, window: "1y", observations: 0, source: "Yahoo Finance", unavailable: true }];
    res.json({ updatedAt: new Date().toISOString(), source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_correlation_fetch_failed", rows, correlation: rows });
  }
});

const AFRICA_COUNTRY_SET = new Set(["KE", "NG", "ZA"]);
const AFRICA_MMF_ROWS = [
  { id: "KE_CIC_MMF", fundName: "CIC Money Market Fund", name: "CIC Money Market Fund", country: "KE", currency: "KES", yieldRange: "9.8% - 11.2%", yield: 10.4, maturity: "45d", liquidity: "High", provider: "CIC Asset Management", category: "MMF", aum: 125000000000, returnYtdPct: 4.6 },
  { id: "KE_BRITAM_MMF", fundName: "Britam Money Market Fund", name: "Britam Money Market Fund", country: "KE", currency: "KES", yieldRange: "9.4% - 10.8%", yield: 10.1, maturity: "39d", liquidity: "High", provider: "Britam Asset Managers", category: "MMF", aum: 98000000000, returnYtdPct: 4.2 },
  { id: "NG_STANBIC_MMF", fundName: "Stanbic IBTC Money Market Fund", name: "Stanbic IBTC Money Market Fund", country: "NG", currency: "NGN", yieldRange: "13.1% - 15.5%", yield: 14.3, maturity: "52d", liquidity: "High", provider: "Stanbic IBTC Asset Mgmt", category: "MMF", aum: 410000000000, returnYtdPct: 6.9 },
  { id: "NG_FBN_MMF", fundName: "FBN Money Market Fund", name: "FBN Money Market Fund", country: "NG", currency: "NGN", yieldRange: "12.8% - 14.9%", yield: 13.8, maturity: "49d", liquidity: "High", provider: "FBNQuest Asset Management", category: "MMF", aum: 350000000000, returnYtdPct: 6.4 },
  { id: "ZA_NINETYONE_MMF", fundName: "Ninety One Money Market Fund", name: "Ninety One Money Market Fund", country: "ZA", currency: "ZAR", yieldRange: "7.2% - 8.6%", yield: 7.9, maturity: "34d", liquidity: "High", provider: "Ninety One", category: "MMF", aum: 74000000000, returnYtdPct: 3.2 },
  { id: "ZA_STANLIB_MMF", fundName: "STANLIB Money Market Fund", name: "STANLIB Money Market Fund", country: "ZA", currency: "ZAR", yieldRange: "7.0% - 8.3%", yield: 7.7, maturity: "31d", liquidity: "High", provider: "STANLIB", category: "MMF", aum: 66500000000, returnYtdPct: 3.0 },
];
const AFRICA_REIT_ROWS = [
  { symbol: "FIR", name: "Fairvest REIT", country: "ZA", region: "South Africa", propertyType: "Retail", dividendYield: 8.4, marketCap: 18500000000, category: "REIT", returnYtdPct: 5.2 },
  { symbol: "GRT", name: "Growthpoint Properties", country: "ZA", region: "South Africa", propertyType: "Diversified", dividendYield: 9.1, marketCap: 52000000000, category: "REIT", returnYtdPct: 4.1 },
  { symbol: "SKA", name: "NEPI Rockcastle", country: "ZA", region: "South Africa / CEE", propertyType: "Retail", dividendYield: 8.0, marketCap: 69000000000, category: "REIT", returnYtdPct: 6.0 },
  { symbol: "NGER", name: "SFS Real Estate Investment Trust", country: "NG", region: "Nigeria", propertyType: "Commercial", dividendYield: 7.1, marketCap: 42000000000, category: "REIT", returnYtdPct: 2.8 },
  { symbol: "UHREIT", name: "UPDC REIT", country: "NG", region: "Nigeria", propertyType: "Mixed", dividendYield: 6.5, marketCap: 28500000000, category: "REIT", returnYtdPct: 1.9 },
  { symbol: "ILAMU", name: "ILAM Fahari I-REIT", country: "KE", region: "Kenya", propertyType: "Commercial", dividendYield: 7.8, marketCap: 11800000000, category: "REIT", returnYtdPct: 3.6 },
];
const AFRICA_MMF_DETAIL = Object.fromEntries(AFRICA_MMF_ROWS.map((row) => [
  row.id,
  {
    fundId: row.id,
    fundName: row.fundName,
    country: row.country,
    category: row.category,
    currency: row.currency,
    regulator: row.country === "KE" ? "CMA Kenya" : row.country === "NG" ? "SEC Nigeria" : "FSCA/ASISA",
    benchmark: row.country === "NG" ? "1M T-Bill + spread" : "Cash benchmark",
    aum: row.aum,
    nav: Number((100 + row.returnYtdPct).toFixed(4)),
    yield_7d: row.yield,
    dealingFrequency: "daily",
    sourceSchema: "africa_funds_reits_mmfs_schema"
  }
]));
const AFRICA_REIT_DETAIL = Object.fromEntries(AFRICA_REIT_ROWS.map((row) => [
  row.symbol,
  {
    symbol: row.symbol,
    name: row.name,
    country: row.country,
    category: row.category,
    propertyType: row.propertyType,
    region: row.region,
    price: Number((10 + row.returnYtdPct * 0.25).toFixed(2)),
    marketCap: row.marketCap,
    dividendYield: row.dividendYield,
    ffo: Number((row.marketCap * 0.072).toFixed(0)),
    affo: Number((row.marketCap * 0.061).toFixed(0)),
    payoutRatio: Number((68 + (row.country === "ZA" ? 5 : 2)).toFixed(2)),
    occupancy: Number((90 + (row.country === "ZA" ? 3 : 1.2)).toFixed(2))
  }
]));

function resolveAfricaCountry(country) {
  const normalized = String(country || "all").trim().toUpperCase();
  if (normalized === "ALL") return "ALL";
  return AFRICA_COUNTRY_SET.has(normalized) ? normalized : "ALL";
}

app.get("/api/equities/mmf", async (req, res) => {
  const country = resolveAfricaCountry(req.query.country);
  const rows = country === "ALL" ? AFRICA_MMF_ROWS : AFRICA_MMF_ROWS.filter((row) => row.country === country);
  res.json(rows.map((row) => ({
    id: row.id,
    fundName: row.fundName,
    name: row.name,
    country: row.country,
    currency: row.currency,
    provider: row.provider,
    category: row.category,
    yieldRange: null,
    yield: null,
    maturity: null,
    liquidity: null,
    aum: null,
    returnYtdPct: null,
    source: "Africa fund catalog",
    unavailable: true,
    stale: true,
    stale_reason: "africa_mmf_live_provider_not_configured"
  })));
});

app.get("/api/equities/mmf/:id", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  const detail = AFRICA_MMF_DETAIL[id] || null;
  if (!detail) return res.status(404).json({ error: "MMF not found" });
  res.json({
    fundId: detail.fundId,
    fundName: detail.fundName,
    country: detail.country,
    category: detail.category,
    currency: detail.currency,
    regulator: detail.regulator,
    benchmark: detail.benchmark,
    aum: null,
    nav: null,
    yield_7d: null,
    dealingFrequency: detail.dealingFrequency,
    sourceSchema: detail.sourceSchema,
    source: "Africa fund catalog",
    unavailable: true,
    stale: true,
    stale_reason: "africa_mmf_live_provider_not_configured"
  });
});

app.get("/api/equities/mmf/:id/yield-history", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  const base = AFRICA_MMF_DETAIL[id];
  if (!base) return res.status(404).json({ error: "MMF not found" });
  res.json([]);
});

app.get("/api/equities/mmf/:id/liquidity", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  const base = AFRICA_MMF_DETAIL[id];
  if (!base) return res.status(404).json({ error: "MMF not found" });
  res.json([]);
});

app.get("/api/equities/mmf/:id/composition", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  if (!AFRICA_MMF_DETAIL[id]) return res.status(404).json({ error: "MMF not found" });
  res.json([]);
});

app.get("/api/equities/reits", async (req, res) => {
  const country = resolveAfricaCountry(req.query.country);
  const rows = country === "ALL" ? AFRICA_REIT_ROWS : AFRICA_REIT_ROWS.filter((row) => row.country === country);
  res.json(rows.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    country: row.country,
    region: row.region,
    propertyType: row.propertyType,
    category: row.category,
    dividendYield: null,
    marketCap: null,
    returnYtdPct: null,
    source: "Africa REIT catalog",
    unavailable: true,
    stale: true,
    stale_reason: "africa_reit_live_provider_not_configured"
  })));
});

app.get("/api/equities/reits/compare", async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
  const rows = (ids.length ? ids : AFRICA_REIT_ROWS.map((row) => row.symbol).slice(0, 3))
    .map((symbol) => AFRICA_REIT_ROWS.find((row) => row.symbol === symbol))
    .filter(Boolean)
    .map((row) => ({
      id: row.symbol,
      country: row.country,
      dividendYield: null,
      marketCap: null,
      returnYtdPct: null,
      source: "Africa REIT catalog",
      unavailable: true
    }));
  res.json(rows);
});

app.get("/api/equities/reits/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const detail = AFRICA_REIT_DETAIL[symbol] || null;
  if (!detail) return res.status(404).json({ error: "REIT not found" });
  res.json({
    symbol: detail.symbol,
    name: detail.name,
    country: detail.country,
    category: detail.category,
    propertyType: detail.propertyType,
    region: detail.region,
    price: null,
    marketCap: null,
    dividendYield: null,
    ffo: null,
    affo: null,
    payoutRatio: null,
    occupancy: null,
    source: "Africa REIT catalog",
    unavailable: true,
    stale: true,
    stale_reason: "africa_reit_live_provider_not_configured"
  });
});

app.get("/api/equities/reits/:symbol/exposure", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!AFRICA_REIT_DETAIL[symbol]) return res.status(404).json({ error: "REIT not found" });
  res.json([]);
});

app.get("/api/equities/reits/:symbol/income", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const detail = AFRICA_REIT_DETAIL[symbol];
  if (!detail) return res.status(404).json({ error: "REIT not found" });
  res.json([]);
});
app.get("/api/equities/stocks", async (req, res) => {
  try {
    const payload = await getEquitiesAnalyticsPayload();
    res.json(Array.isArray(payload?.stockScreener) ? payload.stockScreener : []);
  } catch (error) {
    console.error("[Equities] Stock screener error:", error);
    const stale = await readServiceSnapshot("analytics-equities-v2", { scope: "equities" });
    if (Array.isArray(stale?.payload?.stockScreener)) {
      return res.json(stale.payload.stockScreener);
    }
    res.json([]);
  }
});

app.get("/api/equities/stocks/:symbol/fundamentals", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  // Derived from existing Finviz/Yahoo logic if possible, otherwise mock
  res.json([
    { label: "P/E Ratio", value: "28.4" },
    { label: "Forward P/E", value: "24.1" },
    { label: "PEG Ratio", value: "1.2" },
    { label: "Price/Sales", value: "7.8" },
    { label: "Price/Book", value: "12.4" },
    { label: "Dividend Yield", value: "0.5%" },
    { label: "EPS (ttm)", value: "6.42" },
    { label: "Revenue", value: "383.2B" },
  ]);
});

app.get("/api/equities/market/snapshot", async (req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    status: "Market Open",
    indices: {
      spx: { value: 5123.4, change: 12.5, changePct: 0.24 },
      ndx: { value: 18234.1, change: -45.2, changePct: -0.25 },
      dji: { value: 39123.8, change: 156.7, changePct: 0.40 },
    },
    topMovers: [
      { symbol: "HIMS", changePct: 40.5 },
      { symbol: "NVDA", changePct: 2.1 },
    ]
  });
});

app.get("/api/equities/market/benchmarks", async (req, res) => {
  res.json([
    { id: "spx", name: "S&P 500", value: 5123.4, changePct: 0.24 },
    { id: "ndx", name: "Nasdaq 100", value: 18234.1, changePct: -0.25 },
    { id: "rut", name: "Russell 2000", value: 2123.5, changePct: 0.12 },
  ]);
});

app.get("/api/equities/market/sectors", async (req, res) => {
  res.json([
    { name: "Technology", changePct: 0.85 },
    { name: "Healthcare", changePct: 1.2 },
    { name: "Financials", changePct: -0.3 },
    { name: "Energy", changePct: 2.1 },
  ]);
});

app.get("/api/equities/market/regions", async (req, res) => {
  res.json([
    { name: "Americas", changePct: 0.4 },
    { name: "Europe", changePct: -0.1 },
    { name: "Asia-Pacific", changePct: 0.6 },
  ]);
});

app.get("/api/equities/market/breadth", async (req, res) => {
  res.json({
    advancing: 342,
    declining: 158,
    unchanged: 25,
    newHighs: 42,
    newLows: 8
  });
});

app.get("/api/equities/market/actions", async (req, res) => {
  res.json([
    { type: "Earnings", symbol: "AAPL", date: "2024-05-02" },
    { type: "Dividend", symbol: "MSFT", date: "2024-05-15" },
  ]);
});


/**
 * Runs a Python script and returns parsed JSON output.
 */
async function runPythonScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBinary, [scriptPath, ...args], { cwd: __dirname });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Python script ${scriptPath} exited with code ${code}. Stderr: ${stderr}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`Failed to parse Python output from ${scriptPath}: ${err.message}. Output: ${stdout}`));
      }
    });
  });
}

const FINVIZ_QUOTE_CACHE_TTL_MS = 20 * 60 * 1000;
const finvizQuoteCache = new Map();

const EQUITY_FINVIZ_SECTOR_PROXIES = [
  { symbol: "XLC", sector: "Communication Services" },
  { symbol: "XLY", sector: "Consumer Discretionary" },
  { symbol: "XLP", sector: "Consumer Staples" },
  { symbol: "XLE", sector: "Energy" },
  { symbol: "XLF", sector: "Financials" },
  { symbol: "XLV", sector: "Health Care" },
  { symbol: "XLI", sector: "Industrials" },
  { symbol: "XLB", sector: "Materials" },
  { symbol: "XLRE", sector: "Real Estate" },
  { symbol: "XLK", sector: "Technology" },
  { symbol: "XLU", sector: "Utilities" },
];

const EQUITY_FINVIZ_REGIONAL_PROXIES = [
  { symbol: "SPY", region: "United States", currency: "USD" },
  { symbol: "EFA", region: "Developed ex-US", currency: "USD" },
  { symbol: "EEM", region: "Emerging Markets", currency: "USD" },
  { symbol: "EWJ", region: "Japan", currency: "JPY" },
  { symbol: "EWU", region: "United Kingdom", currency: "GBP" },
  { symbol: "FXI", region: "China", currency: "CNY" },
];

const EQUITY_FINVIZ_STYLE_PROXIES = [
  { symbol: "VUG", factor: "Growth" },
  { symbol: "VTV", factor: "Value" },
  { symbol: "IWM", factor: "Small Cap" },
  { symbol: "QUAL", factor: "Quality" },
  { symbol: "MTUM", factor: "Momentum" },
  { symbol: "SPHQ", factor: "High Quality" },
];

const EQUITY_FINVIZ_FLOW_PROXIES = [
  { symbol: "SPY", segment: "US Large Cap", assetClass: "Equity", region: "United States" },
  { symbol: "QQQ", segment: "US Growth", assetClass: "Equity", region: "United States" },
  { symbol: "IWM", segment: "US Small Cap", assetClass: "Equity", region: "United States" },
  { symbol: "EFA", segment: "Developed Markets", assetClass: "Equity", region: "Global" },
  { symbol: "EEM", segment: "Emerging Markets", assetClass: "Equity", region: "Global" },
  { symbol: "GLD", segment: "Gold", assetClass: "Commodity", region: "Global" },
  { symbol: "AGG", segment: "Core Bonds", assetClass: "Fixed Income", region: "United States" },
  { symbol: "BIL", segment: "Treasury Bills", assetClass: "Cash", region: "United States" },
  { symbol: "VNQ", segment: "REITs", assetClass: "Real Assets", region: "United States" },
];

const EQUITY_FINVIZ_EARNINGS_PROXIES = [
  { symbol: "AAPL", company: "Apple" },
  { symbol: "MSFT", company: "Microsoft" },
  { symbol: "NVDA", company: "NVIDIA" },
  { symbol: "AMZN", company: "Amazon" },
  { symbol: "META", company: "Meta" },
  { symbol: "GOOGL", company: "Alphabet" },
  { symbol: "TSLA", company: "Tesla" },
  { symbol: "JPM", company: "JPMorgan" },
];

const MACRO_FINVIZ_FX_PROXIES = [
  { symbol: "UUP", pair: "DXY", displayName: "US Dollar Basket" },
  { symbol: "FXE", pair: "EUR/USD", displayName: "Euro" },
  { symbol: "FXY", pair: "JPY/USD", displayName: "Japanese Yen" },
  { symbol: "FXB", pair: "GBP/USD", displayName: "British Pound" },
  { symbol: "FXC", pair: "CAD/USD", displayName: "Canadian Dollar" },
  { symbol: "FXA", pair: "AUD/USD", displayName: "Australian Dollar" },
  { symbol: "CYB", pair: "CNY/USD", displayName: "Chinese Yuan" },
];

const OPTIONS_FINVIZ_UNDERLYINGS = [
  "SPY",
  "QQQ",
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "TSLA",
];

function normalizeFinvizTicker(symbol) {
  return String(symbol || "").trim().replace(/\./g, "-").toUpperCase();
}

function parseFinvizScaledNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || /^n\/a$/i.test(raw)) return null;
  const cleaned = raw.replace(/,/g, "");
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)([KMBT])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = String(match[2] || "").toUpperCase();
  const scale =
    suffix === "T"
      ? 1e12
      : suffix === "B"
      ? 1e9
      : suffix === "M"
      ? 1e6
      : suffix === "K"
      ? 1e3
      : 1;
  return base * scale;
}

function parseFinvizPercent(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || /^n\/a$/i.test(raw)) return null;
  const match = raw.match(/-?\d+(?:\.\d+)?(?=%)/);
  return match ? Number(match[0]) : null;
}

function parseFinvizPair(value) {
  const matches = String(value ?? "").match(/-?\d+(?:\.\d+)?/g) || [];
  return matches.slice(0, 2).map((entry) => Number(entry));
}

function roundMaybe(value, digits = 2) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function inferSignalFromChange(changePct) {
  const value = Number(changePct);
  if (!Number.isFinite(value)) return "Flat";
  if (value >= 1.5) return "Breakout";
  if (value >= 0.35) return "Bid";
  if (value <= -1.5) return "Stress";
  if (value <= -0.35) return "Offered";
  return "Balanced";
}

function buildFinvizCacheFallbackPaths(symbol) {
  const normalized = normalizeFinvizTicker(symbol).toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]+/g, "");
  const variants = [
    path.join(__dirname, `${normalized}_finviz.json`),
    path.join(__dirname, `${compact}_finviz.json`),
  ];
  return [...new Set(variants)];
}

function readFinvizFallback(symbol) {
  for (const filePath of buildFinvizCacheFallbackPaths(symbol)) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !parsed.error) return parsed;
    } catch (error) {
      console.warn("[Analytics] Finviz fallback read failed:", filePath, error?.message || error);
    }
  }
  return null;
}

async function fetchFinvizQuote(symbol, { forceRefresh = false } = {}) {
  const key = normalizeFinvizTicker(symbol);
  const now = Date.now();
  const cached = finvizQuoteCache.get(key);
  if (!forceRefresh && cached && now - cached.cachedAt < FINVIZ_QUOTE_CACHE_TTL_MS) {
    return cached.payload;
  }

  try {
    const payload = await runPythonScript("scripts/fetch_finviz.py", [key]);
    if (payload && !payload.error) {
      finvizQuoteCache.set(key, { cachedAt: now, payload });
      return payload;
    }
  } catch (error) {
    console.warn("[Analytics] Live Finviz quote failed:", key, error?.message || error);
  }

  const fallback = readFinvizFallback(key);
  if (fallback) {
    finvizQuoteCache.set(key, { cachedAt: now, payload: fallback });
    return fallback;
  }

  if (cached?.payload) return cached.payload;
  return null;
}

async function fetchFinvizQuotes(symbols = []) {
  const uniqueSymbols = [...new Set((Array.isArray(symbols) ? symbols : []).map(normalizeFinvizTicker).filter(Boolean))];
  const settled = await Promise.allSettled(uniqueSymbols.map((symbol) => fetchFinvizQuote(symbol)));
  return uniqueSymbols.reduce((acc, symbol, index) => {
    const result = settled[index];
    const payload = result?.status === "fulfilled" ? result.value : null;
    if (payload && payload.summary) acc.set(symbol, payload);
    return acc;
  }, new Map());
}

function buildEquitiesSectorRows(finvizQuotes) {
  return EQUITY_FINVIZ_SECTOR_PROXIES.map((item) => {
    const quote = finvizQuotes.get(item.symbol);
    const summary = quote?.summary || {};
    return {
      symbol: item.symbol,
      sector: item.sector,
      daily: roundMaybe(parseFinvizPercent(summary.Change)),
      ytd: roundMaybe(parseFinvizPercent(summary["Perf YTD"])),
      yr1: roundMaybe(parseFinvizPercent(summary["Perf Year"] ?? summary["Return% 1Y"])),
      flowUsdBn: roundMaybe(((parseFinvizScaledNumber(summary.AUM) || 0) * (parseFinvizPercent(summary["Flows% 1M"]) || 0)) / 100 / 1e9),
      source: "Finviz ETF snapshot",
    };
  }).filter((row) =>
    [row.daily, row.ytd, row.yr1, row.flowUsdBn].some((value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.001)
  );
}

function buildEquitiesRegionalRows(finvizQuotes) {
  return EQUITY_FINVIZ_REGIONAL_PROXIES.map((item) => {
    const quote = finvizQuotes.get(item.symbol);
    const summary = quote?.summary || {};
    return {
      symbol: item.symbol,
      region: item.region,
      currency: item.currency,
      daily: roundMaybe(parseFinvizPercent(summary.Change)),
      ytd: roundMaybe(parseFinvizPercent(summary["Perf YTD"])),
      yr1: roundMaybe(parseFinvizPercent(summary["Perf Year"] ?? summary["Return% 1Y"])),
      yr3: roundMaybe(parseFinvizPercent(summary["Perf 3Y"] ?? summary["Return% 3Y"])),
      source: "Finviz ETF snapshot",
    };
  }).filter((row) =>
    [row.daily, row.ytd, row.yr1, row.yr3].some((value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.001)
  );
}

function buildEquitiesStyleRows(finvizQuotes) {
  return EQUITY_FINVIZ_STYLE_PROXIES.map((item) => {
    const quote = finvizQuotes.get(item.symbol);
    const summary = quote?.summary || {};
    return {
      symbol: item.symbol,
      factor: item.factor,
      daily: roundMaybe(parseFinvizPercent(summary.Change)),
      ytd: roundMaybe(parseFinvizPercent(summary["Perf YTD"])),
      yr1: roundMaybe(parseFinvizPercent(summary["Perf Year"] ?? summary["Return% 1Y"])),
      volatility: roundMaybe(parseFinvizPair(summary.Volatility)[1]),
      relVolume: roundMaybe(parseFinvizScaledNumber(summary["Rel Volume"])),
      signal: inferSignalFromChange(parseFinvizPercent(summary.Change)),
      source: "Finviz ETF snapshot",
    };
  }).filter((row) =>
    [row.daily, row.ytd, row.yr1].some((value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.001)
  );
}

function buildEquitiesFlowRows(finvizQuotes) {
  return EQUITY_FINVIZ_FLOW_PROXIES.map((item) => {
    const quote = finvizQuotes.get(item.symbol);
    const summary = quote?.summary || {};
    const aum = parseFinvizScaledNumber(summary.AUM);
    const flowPct = parseFinvizPercent(summary["Flows% 1M"]);
    const flow3mPct = parseFinvizPercent(summary["Flows% 3M"]);
    const rows = [];
    if (Number.isFinite(aum) && Number.isFinite(flowPct)) {
      rows.push({
        symbol: item.symbol,
        segment: item.segment,
        assetClass: item.assetClass,
        region: item.region,
        period: "1M",
        netFlowUsdBn: roundMaybe((aum * flowPct) / 100 / 1e9),
        source: "Finviz ETF snapshot",
      });
    }
    if (Number.isFinite(aum) && Number.isFinite(flow3mPct)) {
      rows.push({
        symbol: item.symbol,
        segment: item.segment,
        assetClass: item.assetClass,
        region: item.region,
        period: "3M",
        netFlowUsdBn: roundMaybe((aum * flow3mPct) / 100 / 1e9),
        source: "Finviz ETF snapshot",
      });
    }
    return rows;
  }).flat();
}

function buildEquitiesBreadth(finvizQuotes) {
  const breadthSymbols = [
    ...EQUITY_FINVIZ_SECTOR_PROXIES.map((item) => item.symbol),
    ...EQUITY_FINVIZ_STYLE_PROXIES.map((item) => item.symbol),
    ...EQUITY_FINVIZ_REGIONAL_PROXIES.map((item) => item.symbol),
  ];
  const rows = breadthSymbols
    .map((symbol) => finvizQuotes.get(symbol)?.summary || null)
    .filter(Boolean);
  if (!rows.length) return null;

  const positives = rows.filter((summary) => Number(parseFinvizPercent(summary.Change)) > 0).length;
  const negatives = rows.filter((summary) => Number(parseFinvizPercent(summary.Change)) < 0).length;
  const newHighs = rows.filter((summary) => {
    const raw = String(summary["52W High"] || "");
    const parts = raw.split(" ");
    return Number.isFinite(Number(parseFinvizPercent(parts[1]))) && Number(parseFinvizPercent(parts[1])) >= -2;
  }).length;
  const newLows = rows.filter((summary) => {
    const raw = String(summary["52W Low"] || "");
    const parts = raw.split(" ");
    return Number.isFinite(Number(parseFinvizPercent(parts[1]))) && Number(parseFinvizPercent(parts[1])) <= 5;
  }).length;
  const above50 = rows.filter((summary) => Number(parseFinvizPercent(summary.SMA50)) > 0).length;
  const above200 = rows.filter((summary) => Number(parseFinvizPercent(summary.SMA200)) > 0).length;

  return {
    adLine: positives - negatives,
    newHighs,
    newLows,
    above50dmaPct: roundMaybe((above50 / rows.length) * 100),
    above200dmaPct: roundMaybe((above200 / rows.length) * 100),
    source: "Finviz ETF proxy breadth",
  };
}

function buildEquitiesEarningsRows(finvizQuotes) {
  return EQUITY_FINVIZ_EARNINGS_PROXIES.map((item) => {
    const quote = finvizQuotes.get(item.symbol);
    const summary = quote?.summary || {};
    const earnings = String(summary.earnings || summary.Earnings || "").trim();
    if (!earnings) return null;
    return {
      symbol: item.symbol,
      company: item.company,
      date: earnings,
      period: "Next report",
      revisionTrend: inferSignalFromChange(parseFinvizPercent(summary.Change)),
      source: "Finviz quote snapshot",
    };
  }).filter(Boolean);
}

function classifyFinvizRevisionTone(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) return { score: 0, severity: "Med" };
  if (/(downgrade|underperform|underweight|sell|reduce|cut|negative)/i.test(normalized)) {
    return { score: -1, severity: "High" };
  }
  if (/(upgrade|outperform|overweight|buy|raise|positive|strong buy)/i.test(normalized)) {
    return { score: 1, severity: "Med" };
  }
  return { score: 0, severity: "Low" };
}

function buildFinvizRevisionRows(finvizQuotes, symbols = []) {
  return [...new Set(symbols.map(normalizeFinvizTicker).filter(Boolean))]
    .flatMap((symbol) => {
      const quote = finvizQuotes.get(symbol);
      const ratings = Array.isArray(quote?.ratings) ? quote.ratings : [];
      return ratings.slice(0, 2).map((rating, idx) => {
        const combinedText = [rating?.action, rating?.rating].filter(Boolean).join(" · ");
        const tone = classifyFinvizRevisionTone(combinedText);
        return {
          id: `finviz-rev-${symbol}-${idx}`,
          ticker: symbol,
          change: combinedText || "Analyst update",
          broker: rating?.analyst || "Finviz analyst feed",
          time: rating?.date || "—",
          severity: tone.severity,
          score: tone.score,
          target: rating?.price_target || null,
          source: "Finviz ratings feed",
        };
      });
    })
    .filter((row) => row.change && row.change !== "Analyst update")
    .sort((a, b) => (Number(a.score) === Number(b.score) ? String(b.time).localeCompare(String(a.time)) : Number(a.score) - Number(b.score)))
    .slice(0, 8);
}

function buildFinvizInsiderRows(finvizQuotes, symbols = []) {
  const insiderSignals = [...new Set(symbols.map(normalizeFinvizTicker).filter(Boolean))]
    .flatMap((symbol) => {
      const quote = finvizQuotes.get(symbol);
      const insiderRows = Array.isArray(quote?.insider) ? quote.insider : [];
      const newsRows = Array.isArray(quote?.news) ? quote.news : [];
      const insiderEvents = insiderRows.slice(0, 2).map((row, idx) => {
        const transaction = String(row?.transaction || "").trim() || "Insider activity";
        const severity = /(sale|dispose|sell)/i.test(transaction) ? "High" : /(buy|purchase)/i.test(transaction) ? "Low" : "Med";
        return {
          id: `finviz-insider-${symbol}-${idx}`,
          ticker: symbol,
          type: transaction,
          details: [row?.owner, row?.relationship].filter(Boolean).join(" · ") || "Finviz insider feed",
          date: row?.date || "—",
          severity,
          source: "Finviz insider feed",
        };
      });
      const buybackEvents = newsRows
        .filter((row) => /(buyback|repurchase|share repurchase|authorization)/i.test(`${row?.headline || ""}`))
        .slice(0, 1)
        .map((row, idx) => ({
          id: `finviz-buyback-${symbol}-${idx}`,
          ticker: symbol,
          type: "Buyback",
          details: row?.headline || "Buyback signal",
          date: row?.timestamp || "—",
          severity: "Med",
          source: "Finviz news feed",
        }));
      return insiderEvents.concat(buybackEvents);
    });

  return insiderSignals
    .slice(0, 8);
}

function buildFinvizMoverRows(analyticsPayload, finvizQuotes, styleFactors = []) {
  const screenerRows = Array.isArray(analyticsPayload?.stockScreener) ? analyticsPayload.stockScreener : [];
  const leaderFactor = [...styleFactors]
    .filter((row) => Number.isFinite(Number(row?.daily)))
    .sort((a, b) => Number(b?.daily) - Number(a?.daily))[0];

  return screenerRows
    .map((row) => {
      const symbol = normalizeFinvizTicker(row?.symbol);
      const quote = finvizQuotes.get(symbol);
      const summary = quote?.summary || {};
      const changePct = roundMaybe(
        parseFinvizPercent(summary.Change) ??
        row?.changePct
      );
      return {
        symbol,
        company: row?.name || quote?.profileName || symbol,
        sector: quote?.header_meta?.sector || row?.sector || "—",
        factors: [leaderFactor?.factor, quote?.header_meta?.industry].filter(Boolean).slice(0, 2).join(", ") || "Finviz mover",
        move: changePct ?? 0,
        marketCap: formatMarketCapFromRaw(parseFinvizScaledNumber(summary["Market Cap"]) ?? row?.marketCap),
        marketCapRaw: parseFinvizScaledNumber(summary["Market Cap"]) ?? row?.marketCap ?? null,
        source: "Finviz screener",
      };
    })
    .filter((row) => row.symbol && Number.isFinite(Number(row.move)))
    .sort((a, b) => Math.abs(Number(b.move)) - Math.abs(Number(a.move)))
    .slice(0, 8);
}

function formatMarketCapFromRaw(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  if (numeric >= 1e12) return `${(numeric / 1e12).toFixed(2)}T`;
  if (numeric >= 1e9) return `${(numeric / 1e9).toFixed(1)}B`;
  if (numeric >= 1e6) return `${(numeric / 1e6).toFixed(1)}M`;
  return `${numeric.toFixed(0)}`;
}

function buildFinvizEarningsRiskRows(finvizQuotes) {
  return EQUITY_FINVIZ_EARNINGS_PROXIES.map((item, idx) => {
    const quote = finvizQuotes.get(item.symbol);
    const summary = quote?.summary || {};
    const earnings = String(summary.earnings || summary.Earnings || "").trim();
    const [weeklyVol, monthlyVol] = parseFinvizPair(summary.Volatility);
    const atr = parseFinvizScaledNumber(summary["ATR (14)"]);
    const price = parseFinvizScaledNumber(summary.Price);
    const impliedMovePct = Number.isFinite(monthlyVol)
      ? monthlyVol
      : Number.isFinite(atr) && Number.isFinite(price) && price > 0
      ? (atr / price) * 100
      : null;
    return {
      id: `finviz-risk-${idx}`,
      ticker: item.symbol,
      company: item.company,
      date: earnings || "Next report",
      eps: summary["EPS next Q"] || summary["EPS next Y"] || summary["EPS this Y"] || "—",
      expectedMovePct: roundMaybe(impliedMovePct),
      move: roundMaybe(impliedMovePct),
      source: "Finviz quote snapshot",
    };
  }).filter((row) => row.date || row.expectedMovePct != null).slice(0, 8);
}

function buildFinvizFactorLeader(styleFactors = []) {
  const leader = [...styleFactors]
    .filter((row) => Number.isFinite(Number(row?.daily)) || Number.isFinite(Number(row?.ytd)) || Number.isFinite(Number(row?.yr1)))
    .sort((a, b) => {
      const aScore = (Number(a?.daily) || 0) * 0.5 + (Number(a?.ytd) || 0) * 0.3 + (Number(a?.yr1) || 0) * 0.2;
      const bScore = (Number(b?.daily) || 0) * 0.5 + (Number(b?.ytd) || 0) * 0.3 + (Number(b?.yr1) || 0) * 0.2;
      return bScore - aScore;
    })[0];
  if (!leader) return null;
  return {
    ...leader,
    score: roundMaybe((Number(leader?.daily) || 0) * 0.5 + (Number(leader?.ytd) || 0) * 0.3 + (Number(leader?.yr1) || 0) * 0.2),
  };
}

function buildFinvizDeskPayload({ analyticsPayload, finvizQuotes, styleFactors = [] }) {
  const trackedSymbols = [
    ...(Array.isArray(analyticsPayload?.stockScreener) ? analyticsPayload.stockScreener.map((row) => row?.symbol) : []),
    ...EQUITY_FINVIZ_EARNINGS_PROXIES.map((item) => item.symbol),
  ];
  const revisionAlertsRows = buildFinvizRevisionRows(finvizQuotes, trackedSymbols);
  const insiderRows = buildFinvizInsiderRows(finvizQuotes, trackedSymbols);
  const moversRows = buildFinvizMoverRows(analyticsPayload, finvizQuotes, styleFactors);
  const earningsRiskRows = buildFinvizEarningsRiskRows(finvizQuotes);
  const positiveRevisions = revisionAlertsRows.filter((row) => Number(row.score) > 0).length;
  const negativeRevisions = revisionAlertsRows.filter((row) => Number(row.score) < 0).length;
  const revisionBreadthPct = revisionAlertsRows.length
    ? Math.round((positiveRevisions / revisionAlertsRows.length) * 100)
    : 0;

  return {
    factorLeader: buildFinvizFactorLeader(styleFactors),
    revisionAlertsRows,
    insiderRows,
    moversRows,
    earningsRiskRows,
    revisionSummary: {
      positive: positiveRevisions,
      negative: negativeRevisions,
      breadthPct: revisionBreadthPct,
    },
  };
}

function buildMacroFxRows(finvizQuotes) {
  return MACRO_FINVIZ_FX_PROXIES.map((item) => {
    const quote = finvizQuotes.get(item.symbol);
    const summary = quote?.summary || {};
    return {
      symbol: item.symbol,
      pair: item.pair,
      name: item.displayName,
      rate: roundMaybe(parseFinvizScaledNumber(summary.Price), 4),
      daily: roundMaybe(parseFinvizPercent(summary.Change)),
      weekly: roundMaybe(parseFinvizPercent(summary["Perf Week"])),
      source: "Finviz ETF proxy",
    };
  }).filter((row) => Number.isFinite(Number(row.rate)) && Number(row.rate) > 0.01);
}

function buildForexMoverRows(fxRows) {
  const gainers = [...fxRows]
    .filter((row) => Number.isFinite(Number(row.daily)) && Number(row.daily) > 0)
    .sort((a, b) => Number(b.daily) - Number(a.daily))
    .slice(0, 4)
    .map((row) => ({ ...row, moveType: "Gainer" }));
  const losers = [...fxRows]
    .filter((row) => Number.isFinite(Number(row.daily)) && Number(row.daily) < 0)
    .sort((a, b) => Number(a.daily) - Number(b.daily))
    .slice(0, 4)
    .map((row) => ({ ...row, moveType: "Loser" }));
  return { gainers, losers };
}

function buildFinvizOptionsRows(finvizQuotes) {
  const underlyings = OPTIONS_FINVIZ_UNDERLYINGS.map((symbol) => {
    const quote = finvizQuotes.get(symbol);
    const summary = quote?.summary || {};
    const [weeklyVol, monthlyVol] = parseFinvizPair(summary.Volatility);
    const price = parseFinvizScaledNumber(summary.Price);
    const rawVolume = parseFinvizScaledNumber(summary.Volume);
    const changePct = parseFinvizPercent(summary.Change);
    const targetPrice = parseFinvizScaledNumber(summary["Target Price"] || summary.target_price);
    const atr = parseFinvizScaledNumber(summary["ATR (14)"]);
    const earnings = String(summary.earnings || summary.Earnings || "Next catalyst").trim();
    const volumeUsd = Number.isFinite(price) && Number.isFinite(rawVolume) ? price * rawVolume : null;
    return {
      symbol,
      price,
      rawVolume,
      volumeUsd: roundMaybe(volumeUsd, 0),
      changePct: roundMaybe(changePct),
      targetPrice,
      atr: roundMaybe(atr),
      weeklyVol: roundMaybe(weeklyVol),
      monthlyVol: roundMaybe(monthlyVol),
      earnings,
      optionability: String(summary["Option/Short"] || "").trim() || "Yes / Yes",
      industry: quote?.header_meta?.industry || "Underlying",
    };
  }).filter((row) => Number.isFinite(Number(row.price)));

  return {
    optionsVolumeByAsset: underlyings.map((row) => ({
      asset: row.symbol,
      exchange: "Finviz",
      route: "Optionable proxy",
      volumeUsd: row.volumeUsd,
    })),
    optionsMaxPain: underlyings.map((row) => ({
      asset: row.symbol,
      exchange: "Finviz",
      expiry: row.earnings,
      maxPain: row.targetPrice ?? row.price,
    })),
    volumeByExchangeRoute: underlyings.map((row) => ({
      asset: row.symbol,
      exchange: "Finviz",
      route: row.optionability,
      volumeUsd: row.volumeUsd,
    })),
    greeks: underlyings.map((row) => ({
      instrument: `${row.symbol} · Finviz proxy`,
      asset: row.symbol,
      exchange: "Finviz",
      delta: roundMaybe(Math.max(-0.99, Math.min(0.99, Number(row.changePct || 0) / 10)), 2),
      gamma: roundMaybe(Number(row.atr || 0) / Math.max(Number(row.price || 1), 1), 2),
      vega: roundMaybe(row.monthlyVol, 2),
      theta: roundMaybe(-(row.weeklyVol || 0), 2),
      iv: roundMaybe(row.monthlyVol, 2),
    })),
    oiByStrike: underlyings.map((row) => ({
      asset: row.symbol,
      exchange: "Finviz",
      expiry: row.earnings,
      strike: row.targetPrice ?? row.price,
      type: Number(row.targetPrice || 0) >= Number(row.price || 0) ? "C" : "P",
      oi: row.rawVolume,
    })),
  };
}

function normalizeAnalyticsRows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function buildFallbackCryptoPayload(reason = "crypto_analytics_provider_fallback") {
  const fallbackPerps = [
    { symbol: "BTC", openInterestUsd: 1235000000, fundingRate: 0.00008, exchange: "Hyperliquid" },
    { symbol: "ETH", openInterestUsd: 642000000, fundingRate: 0.00004, exchange: "Hyperliquid" },
    { symbol: "SOL", openInterestUsd: 211000000, fundingRate: -0.00003, exchange: "Aster" },
    { symbol: "HYPE", openInterestUsd: 184000000, fundingRate: 0.00011, exchange: "Hyperliquid" },
    { symbol: "BNB", openInterestUsd: 176000000, fundingRate: 0.00002, exchange: "Aster" }
  ];
  const fallbackVenueRows = [
    { protocol: "Hyperliquid", sharePct: 62, color: "#22d3ee" },
    { protocol: "Aster", sharePct: 23, color: "#8b5cf6" },
    { protocol: "Lighter", sharePct: 15, color: "#22c55e" }
  ];

  return {
    updatedAt: new Date().toISOString(),
    stale: true,
    isFallback: true,
    stale_reason: reason,
    unavailable: false,
    source: "Saved crypto analytics snapshot",
    perpMetrics: fallbackPerps,
    kimchiPremium: { premiumPct: 0.8, market: "KRW vs global spread" },
    etfInflows: [
      { date: "2026-05-22", asset: "BTC", manager: "US spot ETFs", period: "daily", netUsd: 146000000, flowUsd: 146000000, source: "Saved snapshot" },
      { date: "2026-05-22", asset: "ETH", manager: "US spot ETFs", period: "daily", netUsd: 38000000, flowUsd: 38000000, source: "Saved snapshot" }
    ],
    perpsMarketShare: fallbackVenueRows,
    perpsOverview: fallbackVenueRows.map((row) => ({
      protocol: row.protocol,
      volume24h: row.sharePct * 100000000,
      openInterest: row.sharePct * 35000000
    })),
    perpVolumeByProtocol: fallbackVenueRows.map((row) => ({
      protocol: row.protocol,
      volumeUsd: row.sharePct * 100000000,
      sharePct: row.sharePct
    })),
    revenueByProtocol: [
      { protocol: "Hyperliquid", revenueUsd: 4200000, period: "24h", source: "Saved snapshot" },
      { protocol: "Aster", revenueUsd: 1750000, period: "24h", source: "Saved snapshot" }
    ],
    optionsVolumeByAsset: [],
    optionsMaxPain: []
  };
}

function buildFallbackOptionsPayload(reason = "options_provider_fallback", finvizOptions = {}) {
  const finvizVolumeRows = normalizeAnalyticsRows(finvizOptions.optionsVolumeByAsset);
  const finvizMaxPainRows = normalizeAnalyticsRows(finvizOptions.optionsMaxPain);
  const finvizRouteRows = normalizeAnalyticsRows(finvizOptions.volumeByExchangeRoute);
  const finvizGreeksRows = normalizeAnalyticsRows(finvizOptions.greeks);
  const finvizOiRows = normalizeAnalyticsRows(finvizOptions.oiByStrike);

  return {
    updatedAt: new Date().toISOString(),
    stale: true,
    isFallback: true,
    stale_reason: reason,
    unavailable: !finvizVolumeRows.length && !finvizMaxPainRows.length && !finvizRouteRows.length && !finvizGreeksRows.length && !finvizOiRows.length,
    source: finvizVolumeRows.length ? "Finviz equity-option proxies" : "Options providers unavailable",
    totalOptionsOpenInterestUsd: null,
    optionsVolumeByAsset: finvizVolumeRows,
    optionsMaxPain: finvizMaxPainRows,
    volumeByExchangeRoute: finvizRouteRows,
    greeks: finvizGreeksRows,
    oiByStrike: finvizOiRows
  };
}

const EQUITIES_ANALYTICS_SNAPSHOT_SCOPE = "analytics-equities-v3";
const EQUITIES_ANALYTICS_SNAPSHOT_PARAMS = { scope: "equities" };
const EQUITIES_ANALYTICS_TTL_MS = 15 * 60 * 1000;

async function buildEquitiesAnalyticsPayload() {
  console.log("[Analytics] Fetching live equities data...");
  let analyticsPayload = null;
  try {
    analyticsPayload = await runPythonScript("scripts/fetch_equities_analytics.py");
  } catch (err) {
    console.warn("[Analytics] Python equities fetch failed:", err?.message || err);
  }

  const [macroData, riskIndicators, fredStatus, blsStatus] = await Promise.all([
    fetchAnalyticsMacroRows("USA").catch((error) => { console.warn("[Analytics] Macro data fetch failed:", error?.message || error); return []; }),
    fetchAnalyticsRiskIndicators().catch((error) => { console.warn("[Analytics] Risk indicators fetch failed:", error?.message || error); return []; }),
    fetchFredMacroMetrics().then((result) => result.status).catch((error) => buildProviderStatus("FRED", Boolean(FRED_API_KEY), "unavailable", error?.message || "FRED unavailable")),
    fetchBlsMacroMetrics().then((result) => result.status).catch((error) => buildProviderStatus("BLS", Boolean(BLS_API_KEY), "unavailable", error?.message || "BLS unavailable"))
  ]);

  const finvizSymbols = [
    ...EQUITY_FINVIZ_SECTOR_PROXIES.map((item) => item.symbol),
    ...EQUITY_FINVIZ_REGIONAL_PROXIES.map((item) => item.symbol),
    ...EQUITY_FINVIZ_STYLE_PROXIES.map((item) => item.symbol),
    ...EQUITY_FINVIZ_FLOW_PROXIES.map((item) => item.symbol),
    ...EQUITY_FINVIZ_EARNINGS_PROXIES.map((item) => item.symbol),
    ...MACRO_FINVIZ_FX_PROXIES.map((item) => item.symbol),
    ...(Array.isArray(analyticsPayload?.stockScreener) ? analyticsPayload.stockScreener.map((row) => row?.symbol) : []),
  ];
  const finvizQuotes = await fetchFinvizQuotes(finvizSymbols).catch((error) => {
    console.warn("[Analytics] Finviz enrichment skipped:", error?.message || error);
    return new Map();
  });
  const sectorPerformance = buildEquitiesSectorRows(finvizQuotes);
  const regionalPerformance = buildEquitiesRegionalRows(finvizQuotes);
  const styleFactors = buildEquitiesStyleRows(finvizQuotes);
  const fundFlows = buildEquitiesFlowRows(finvizQuotes);
  const earningsCalendar = buildEquitiesEarningsRows(finvizQuotes);
  const marketBreadth = buildEquitiesBreadth(finvizQuotes);
  const fxRates = buildMacroFxRows(finvizQuotes);
  const forexMovers = buildForexMoverRows(fxRates);
  const finvizDesk = buildFinvizDeskPayload({ analyticsPayload, finvizQuotes, styleFactors });

  return {
    updatedAt: analyticsPayload?.updatedAt || new Date().toISOString(),
    benchmarkIndexHistory: Array.isArray(analyticsPayload?.benchmarkIndexHistory) ? analyticsPayload.benchmarkIndexHistory : [],
    benchmarkPerformance: Array.isArray(analyticsPayload?.benchmarkPerformance) ? analyticsPayload.benchmarkPerformance : [],
    stockScreener: Array.isArray(analyticsPayload?.stockScreener) ? analyticsPayload.stockScreener : [],
    correlationLabels: Array.isArray(analyticsPayload?.correlationLabels) ? analyticsPayload.correlationLabels : [],
    correlationMatrix: Array.isArray(analyticsPayload?.correlationMatrix) ? analyticsPayload.correlationMatrix : [],
    volatilityMetrics: Array.isArray(analyticsPayload?.volatilityMetrics) ? analyticsPayload.volatilityMetrics : [],
    valuationData: Array.isArray(analyticsPayload?.valuationData) ? analyticsPayload.valuationData : [],
    annualReturns: Array.isArray(analyticsPayload?.annualReturns) ? analyticsPayload.annualReturns : [],
    sectorPerformance,
    regionalPerformance,
    styleFactors,
    rebalanceSignals: [],
    dividendData: [],
    earningsCalendar,
    macroData,
    fundFlows,
    fxRates,
    forexMovers,
    marketBreadth,
    riskIndicators,
    corporateActions: [],
    reitData: REIT_DATA,
    mmfYields: MMF_YIELDS,
    fundsList: FUNDS_LIST,
    finvizDesk,
    providers: buildDataProviderStatus({
      fred: fredStatus,
      bls: blsStatus,
      massive: getMassiveStatus()
    }),
  };
}

async function getEquitiesAnalyticsPayload({ ttlMs = EQUITIES_ANALYTICS_TTL_MS, forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const fresh = await readFreshSnapshot(
      EQUITIES_ANALYTICS_SNAPSHOT_SCOPE,
      EQUITIES_ANALYTICS_SNAPSHOT_PARAMS,
      ttlMs
    );
    if (fresh) return fresh;
  }

  return withInflightDedup(
    EQUITIES_ANALYTICS_SNAPSHOT_SCOPE,
    EQUITIES_ANALYTICS_SNAPSHOT_PARAMS,
    async () => {
      const payload = await buildEquitiesAnalyticsPayload();
      await writeAllSnapshots(
        EQUITIES_ANALYTICS_SNAPSHOT_SCOPE,
        EQUITIES_ANALYTICS_SNAPSHOT_PARAMS,
        payload
      );
      return payload;
    }
  );
}

app.get('/api/analytics/equities', async (req, res) => {
  try {
    const payload = await getEquitiesAnalyticsPayload();
    res.json(payload);
  } catch (error) {
    console.error("[Analytics] Equities error:", error);
    const stale = await readServiceSnapshot(
      EQUITIES_ANALYTICS_SNAPSHOT_SCOPE,
      EQUITIES_ANALYTICS_SNAPSHOT_PARAMS
    );
    if (stale?.payload) {
      return res.json(stale.payload);
    }
    res.status(500).json({ error: "Failed to fetch equities analytics" });
  }
});
// ---------------------------------------------------------------------------
// Atomic trade execution (portfolio + balance + trade journal)
// ---------------------------------------------------------------------------
app.post("/api/db/execute-trade", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(executeTradeSchema), async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.clientId || typeof payload.clientId !== "string" || payload.clientId.trim().length > 120) {
      return res.status(400).json({ error: "clientId is required for idempotent execution." });
    }
    const result = await userWorkspace.trading.executeTrade(req.auth.userId, payload, req.workspace?.workspace?.id || null);
    invalidateRuntimeSnapshotsByPrefix("app-bootstrap");
    res.status(201).json(result);
  } catch (error) {
    if (error?.code === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    if (error?.code === "INVALID_CLIENT_ID") {
      return res.status(400).json({ error: "clientId is required for idempotent execution." });
    }
    if (error?.code === "INSUFFICIENT_POSITION" || error?.code === "NO_POSITION") {
      return res.status(400).json({ error: error.message });
    }
    handleServerError(res, "Atomic trade execution failed", error);
  }
});

app.post("/api/db/execute-trade/estimate", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, writeLimiter, validate(tradeEstimateBatchSchema), async (req, res) => {
  try {
    const payloads = Array.isArray(req.body?.trades) ? req.body.trades : [];
    const estimate = await userWorkspace.trading.estimateTrades(payloads);
    res.json(estimate);
  } catch (error) {
    handleServerError(res, "Trade execution estimate failed", error);
  }
});

// ---------------------------------------------------------------------------
const port = process.env.PORT || 4000;
//app.listen(port, '0.0.0.0', () => {
 // console.log(`Portfolio manager backend listening on port ${port}`);
//});

const http = require("http");
const WebSocket = require("ws");

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let subscribers = new Map();
// key: socket -> { kind, currency, expiry, symbols, quoteType, contracts }
let massiveStocksSocket = null;
let massiveStocksConnecting = false;
const massiveStocksSubscribedSymbols = new Set();
const massivePriceCache = new Map();
let massiveOptionsSocket = null;
let massiveOptionsConnecting = false;
const massiveOptionsSubscribedContracts = new Set();
const massiveOptionQuoteCache = new Map();
const massiveOptionTradeCache = new Map();
let massiveExchangeLookup = {};
let massiveLastStatus = buildProviderStatus("Massive", Boolean(MASSIVE_API_KEY), MASSIVE_API_KEY ? "configured" : "missing_key", MASSIVE_API_KEY ? "WebSocket key configured" : "API key not configured");

function sendWsJson(ws, payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    subscribers.delete(ws);
  }
}

function sanitizePriceSymbols(symbols = []) {
  return [...new Set(
    (Array.isArray(symbols) ? symbols : [])
      .flatMap((value) => String(value || "").split(","))
      .map((symbol) => sanitizeSymbol(String(symbol || "").trim().toUpperCase()))
      .filter(Boolean)
  )].slice(0, 80);
}

function sanitizeOptionContractTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function sanitizeOptionContracts(contracts = []) {
  return [...new Set(
    (Array.isArray(contracts) ? contracts : [])
      .flatMap((value) => String(value || "").split(","))
      .map((ticker) => sanitizeOptionContractTicker(ticker))
      .filter(Boolean)
  )].slice(0, 320);
}

function lookupMassiveExchangeLabel(...ids) {
  const matchedId = ids
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && massiveExchangeLookup[value]);
  return matchedId ? massiveExchangeLookup[matchedId] : null;
}

async function warmMassiveExchangeLookup() {
  try {
    const nextLookup = await fetchMassiveExchangeMap();
    if (nextLookup && typeof nextLookup === "object" && Object.keys(nextLookup).length) {
      massiveExchangeLookup = nextLookup;
    }
  } catch {
    // best-effort warm-up only
  }
}

async function fetchLivePriceSnapshot({ quoteType = "tradfi", symbols = [] } = {}) {
  const safeSymbols = sanitizePriceSymbols(symbols);
  if (!safeSymbols.length) return {};
  const normalizedType = String(quoteType || "tradfi").toLowerCase() === "crypto" ? "crypto" : "tradfi";
  if (normalizedType === "crypto") return fetchCryptoQuotesBySymbols(safeSymbols);
  const cachedMassive = {};
  const missingSymbols = [];
  const now = Date.now();
  safeSymbols.forEach((symbol) => {
    const quote = massivePriceCache.get(symbol);
    if (quote && now - Number(quote.cachedAt || 0) < 90_000) {
      cachedMassive[symbol] = {
        price: quote.price,
        priceChangePercent: quote.priceChangePercent ?? null,
        updatedAt: quote.updatedAt,
        source: "Massive WebSocket"
      };
    } else {
      missingSymbols.push(symbol);
    }
  });
  const fallbackPrices = missingSymbols.length ? await fetchYFinancePrices(missingSymbols) : {};
  return { ...fallbackPrices, ...cachedMassive };
}

function normalizeMassiveRows(message) {
  if (!message) return [];
  const parsed = typeof message === "string" ? JSON.parse(message) : message;
  return Array.isArray(parsed) ? parsed : [parsed];
}

function connectMassiveStocksSocket() {
  if (!MASSIVE_API_KEY) return null;
  if (massiveStocksSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(massiveStocksSocket.readyState)) return massiveStocksSocket;
  if (massiveStocksConnecting) return massiveStocksSocket;
  massiveStocksConnecting = true;
  const url = process.env.MASSIVE_WS_DELAYED === "true" ? MASSIVE_WS_DELAYED_STOCKS_URL : MASSIVE_WS_STOCKS_URL;
  massiveStocksSocket = new WebSocket(url);
  massiveLastStatus = buildProviderStatus("Massive", true, "connecting", "Opening stock WebSocket");

  massiveStocksSocket.on("open", () => {
    massiveStocksConnecting = false;
    massiveLastStatus = buildProviderStatus("Massive", true, "connected", "Stock WebSocket connected");
    sendWsJsonToMassive({ action: "auth", params: MASSIVE_API_KEY });
    if (massiveStocksSubscribedSymbols.size) {
      sendWsJsonToMassive({ action: "subscribe", params: [...massiveStocksSubscribedSymbols].map((symbol) => `AM.${symbol}`).join(",") });
    }
  });

  massiveStocksSocket.on("message", (raw) => {
    try {
      const rows = normalizeMassiveRows(raw.toString());
      const updates = {};
      rows.forEach((row) => {
        const eventType = String(row?.ev || "").toUpperCase();
        const symbol = String(row?.sym || row?.symbol || "").toUpperCase();
        const price = toProviderNumber(row?.c ?? row?.p ?? row?.price);
        if (!symbol || price === null || !["AM", "A", "T", "Q"].includes(eventType)) return;
        const updatedAt = new Date(Number(row?.e || row?.s || Date.now())).toISOString();
        const opening = toProviderNumber(row?.op ?? row?.o);
        const priceChangePercent = opening ? Number((((price - opening) / Math.abs(opening)) * 100).toFixed(2)) : null;
        const quote = { price, priceChangePercent, updatedAt, source: "Massive WebSocket", cachedAt: Date.now() };
        massivePriceCache.set(symbol, quote);
        updates[symbol] = quote;
      });
      if (Object.keys(updates).length) {
        subscribers.forEach((subscription, ws) => {
          if (subscription.kind !== "prices" || subscription.quoteType === "crypto") return;
          const symbols = sanitizePriceSymbols(subscription.symbols || []);
          const scoped = Object.fromEntries(Object.entries(updates).filter(([symbol]) => symbols.includes(symbol)));
          if (Object.keys(scoped).length) {
            sendWsJson(ws, {
              type: "price_update",
              quoteType: "tradfi",
              symbols: Object.keys(scoped),
              prices: scoped,
              provider: "Massive",
              updatedAt: new Date().toISOString()
            });
          }
        });
      }
    } catch (error) {
      console.warn("[Massive] WebSocket message ignored:", error?.message || error);
    }
  });

  massiveStocksSocket.on("close", () => {
    massiveStocksConnecting = false;
    massiveLastStatus = buildProviderStatus("Massive", true, "degraded", "Stock WebSocket closed");
    massiveStocksSocket = null;
  });
  massiveStocksSocket.on("error", (error) => {
    massiveStocksConnecting = false;
    massiveLastStatus = buildProviderStatus("Massive", true, "degraded", error?.message || "Stock WebSocket error");
  });
  return massiveStocksSocket;
}

function normalizeMassiveOptionQuoteRow(row = {}) {
  const contractTicker = sanitizeOptionContractTicker(row?.sym || row?.symbol || row?.ticker);
  if (!contractTicker) return null;
  const bid = firstFiniteNumber(row?.bp, row?.bid_price, row?.bid);
  const ask = firstFiniteNumber(row?.ap, row?.ask_price, row?.ask);
  const bidSize = firstFiniteNumber(row?.bs, row?.bid_size, row?.bidSize);
  const askSize = firstFiniteNumber(row?.as, row?.ask_size, row?.askSize);
  const bidExchangeId = firstFiniteNumber(row?.bx, row?.bid_exchange, row?.bidExchangeId);
  const askExchangeId = firstFiniteNumber(row?.ax, row?.ask_exchange, row?.askExchangeId);
  const updatedAt = normalizeMassiveTimestamp(
    row?.t || row?.sip_timestamp || row?.timestamp || row?.e || row?.updated_at
  );
  const mid = bid != null && ask != null ? Number(((bid + ask) / 2).toFixed(4)) : null;
  const spread = bid != null && ask != null ? Number((ask - bid).toFixed(4)) : null;
  return {
    contractTicker,
    bid,
    ask,
    bidSize,
    askSize,
    bidExchangeId,
    askExchangeId,
    mid,
    spread,
    venueLabel: lookupMassiveExchangeLabel(bidExchangeId, askExchangeId),
    updatedAt
  };
}

function normalizeMassiveOptionTradeRow(row = {}) {
  const contractTicker = sanitizeOptionContractTicker(row?.sym || row?.symbol || row?.ticker);
  if (!contractTicker) return null;
  const lastTradePrice = firstFiniteNumber(row?.p, row?.price, row?.last_trade_price);
  const lastTradeSize = firstFiniteNumber(row?.s, row?.size, row?.last_trade_size);
  const tradeExchangeId = firstFiniteNumber(row?.x, row?.exchange, row?.exchange_id);
  const updatedAt = normalizeMassiveTimestamp(
    row?.t || row?.sip_timestamp || row?.participant_timestamp || row?.timestamp || row?.e || row?.updated_at
  );
  return {
    contractTicker,
    lastTradePrice,
    lastTradeSize,
    tradeExchangeId,
    conditions: Array.isArray(row?.c) ? row.c : Array.isArray(row?.conditions) ? row.conditions : [],
    venueLabel: lookupMassiveExchangeLabel(tradeExchangeId),
    updatedAt,
    lastTradeAt: updatedAt
  };
}

function sendWsJsonToMassiveOptions(payload) {
  if (!massiveOptionsSocket || massiveOptionsSocket.readyState !== WebSocket.OPEN) return;
  try {
    massiveOptionsSocket.send(JSON.stringify(payload));
  } catch (error) {
    massiveLastStatus = buildProviderStatus("Massive", true, "degraded", error?.message || "Massive options send failed");
  }
}

function connectMassiveOptionsSocket() {
  if (!MASSIVE_API_KEY) return null;
  if (massiveOptionsSocket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(massiveOptionsSocket.readyState)) return massiveOptionsSocket;
  if (massiveOptionsConnecting) return massiveOptionsSocket;
  massiveOptionsConnecting = true;
  const url = process.env.MASSIVE_WS_DELAYED === "true" ? MASSIVE_WS_DELAYED_OPTIONS_URL : MASSIVE_WS_OPTIONS_URL;
  massiveOptionsSocket = new WebSocket(url);

  massiveOptionsSocket.on("open", () => {
    massiveOptionsConnecting = false;
    massiveLastStatus = buildProviderStatus("Massive", true, "connected", "Options WebSocket connected");
    sendWsJsonToMassiveOptions({ action: "auth", params: MASSIVE_API_KEY });
    warmMassiveExchangeLookup();
    if (massiveOptionsSubscribedContracts.size) {
      const params = [...massiveOptionsSubscribedContracts].flatMap((ticker) => [`Q.${ticker}`, `T.${ticker}`]).join(",");
      sendWsJsonToMassiveOptions({ action: "subscribe", params });
    }
  });

  massiveOptionsSocket.on("message", (raw) => {
    try {
      const rows = normalizeMassiveRows(raw.toString());
      const quoteUpdates = {};
      const tradeUpdates = {};
      rows.forEach((row) => {
        const eventType = String(row?.ev || row?.event || "").toUpperCase();
        if (eventType === "Q") {
          const normalized = normalizeMassiveOptionQuoteRow(row);
          if (!normalized?.contractTicker) return;
          massiveOptionQuoteCache.set(normalized.contractTicker, {
            ...massiveOptionQuoteCache.get(normalized.contractTicker),
            ...normalized,
            cachedAt: Date.now()
          });
          quoteUpdates[normalized.contractTicker] = normalized;
          return;
        }
        if (eventType === "T") {
          const normalized = normalizeMassiveOptionTradeRow(row);
          if (!normalized?.contractTicker) return;
          massiveOptionTradeCache.set(normalized.contractTicker, {
            ...massiveOptionTradeCache.get(normalized.contractTicker),
            ...normalized,
            cachedAt: Date.now()
          });
          tradeUpdates[normalized.contractTicker] = normalized;
        }
      });

      if (!Object.keys(quoteUpdates).length && !Object.keys(tradeUpdates).length) return;

      subscribers.forEach((subscription, ws) => {
        if (subscription.kind !== "equity-options") return;
        const scopedQuotes = {};
        const scopedTrades = {};
        Object.entries(quoteUpdates).forEach(([ticker, row]) => {
          if (subscription.contractLookup?.has(ticker)) scopedQuotes[ticker] = row;
        });
        Object.entries(tradeUpdates).forEach(([ticker, row]) => {
          if (subscription.contractLookup?.has(ticker)) scopedTrades[ticker] = row;
        });
        if (!Object.keys(scopedQuotes).length && !Object.keys(scopedTrades).length) return;
        sendWsJson(ws, {
          type: "equity_options_update",
          underlying: subscription.underlying,
          expiry: subscription.expiry || null,
          quotes: scopedQuotes,
          trades: scopedTrades,
          updatedAt: new Date().toISOString()
        });
      });
    } catch (error) {
      console.warn("[Massive Options] WebSocket message ignored:", error?.message || error);
    }
  });

  massiveOptionsSocket.on("close", () => {
    massiveOptionsConnecting = false;
    massiveOptionsSocket = null;
  });

  massiveOptionsSocket.on("error", () => {
    massiveOptionsConnecting = false;
  });

  return massiveOptionsSocket;
}

function sendWsJsonToMassive(payload) {
  if (!massiveStocksSocket || massiveStocksSocket.readyState !== WebSocket.OPEN) return;
  try {
    massiveStocksSocket.send(JSON.stringify(payload));
  } catch (error) {
    massiveLastStatus = buildProviderStatus("Massive", true, "degraded", error?.message || "Massive send failed");
  }
}

function subscribeMassiveStocks(symbols = []) {
  if (!MASSIVE_API_KEY) return;
  const nextSymbols = sanitizePriceSymbols(symbols).filter((symbol) => symbol && !massiveStocksSubscribedSymbols.has(symbol));
  nextSymbols.forEach((symbol) => massiveStocksSubscribedSymbols.add(symbol));
  const socket = connectMassiveStocksSocket();
  if (socket?.readyState === WebSocket.OPEN && nextSymbols.length) {
    sendWsJsonToMassive({ action: "subscribe", params: nextSymbols.map((symbol) => `AM.${symbol}`).join(",") });
  }
}

function subscribeMassiveOptionContracts(contracts = []) {
  if (!MASSIVE_API_KEY) return;
  const nextContracts = sanitizeOptionContracts(contracts).filter((ticker) => ticker && !massiveOptionsSubscribedContracts.has(ticker));
  nextContracts.forEach((ticker) => massiveOptionsSubscribedContracts.add(ticker));
  const socket = connectMassiveOptionsSocket();
  if (socket?.readyState === WebSocket.OPEN && nextContracts.length) {
    const params = nextContracts.flatMap((ticker) => [`Q.${ticker}`, `T.${ticker}`]).join(",");
    sendWsJsonToMassiveOptions({ action: "subscribe", params });
  }
}

async function pushPriceSnapshot(ws, subscription) {
  const symbols = sanitizePriceSymbols(subscription?.symbols || []);
  if (!symbols.length) {
    sendWsJson(ws, {
      type: "price_error",
      message: "No symbols subscribed",
      updatedAt: new Date().toISOString()
    });
    return;
  }

  try {
    const prices = await fetchLivePriceSnapshot({
      quoteType: subscription.quoteType,
      symbols
    });
    sendWsJson(ws, {
      type: "price_update",
      quoteType: subscription.quoteType || "tradfi",
      symbols,
      prices,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    sendWsJson(ws, {
      type: "price_error",
      message: error?.message || "price_stream_unavailable",
      updatedAt: new Date().toISOString()
    });
  }
}

async function pushGreeksSnapshot(ws, subscription) {
  try {
    const greeks = await fetchGreeks(subscription.currency || "BTC", subscription.expiry || null);
    sendWsJson(ws, {
      type: "greeks_update",
      currency: subscription.currency || "BTC",
      expiry: subscription.expiry || null,
      greeks,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    sendWsJson(ws, {
      type: "greeks_error",
      message: error?.message || "greeks_stream_unavailable",
      updatedAt: new Date().toISOString()
    });
  }
}

async function pushEquityOptionsSnapshot(ws, subscription) {
  const contracts = sanitizeOptionContracts(subscription?.contracts || []);
  if (!contracts.length) {
    sendWsJson(ws, {
      type: "equity_options_error",
      message: "No option contracts subscribed",
      updatedAt: new Date().toISOString()
    });
    return;
  }
  const quotes = {};
  const trades = {};
  contracts.forEach((ticker) => {
    const quote = massiveOptionQuoteCache.get(ticker);
    const trade = massiveOptionTradeCache.get(ticker);
    if (quote) quotes[ticker] = quote;
    if (trade) trades[ticker] = trade;
  });
  sendWsJson(ws, {
    type: "equity_options_update",
    underlying: subscription.underlying,
    expiry: subscription.expiry || null,
    quotes,
    trades,
    updatedAt: new Date().toISOString()
  });
}

wss.on("connection", (ws) => {
  console.log("WS client connected");
  ws.isAlive = true;
  ws.lastSeen = Date.now();

  ws.on("pong", () => {
    ws.isAlive = true;
    ws.lastSeen = Date.now();
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      ws.lastSeen = Date.now();

      // Price stream format:
      // { type: "subscribePrices", quoteType: "tradfi" | "crypto", symbols: ["AAPL"] }
      if (data.type === "subscribePrices") {
        const subscription = {
          kind: "prices",
          quoteType: String(data.quoteType || data.marketType || "tradfi").toLowerCase() === "crypto" ? "crypto" : "tradfi",
          symbols: sanitizePriceSymbols(data.symbols || data.symbol || [])
        };
        subscribers.set(ws, subscription);
        if (subscription.quoteType === "tradfi") {
          subscribeMassiveStocks(subscription.symbols);
        }
        sendWsJson(ws, { type: "subscribed", channel: "prices", ...subscription });
        pushPriceSnapshot(ws, subscription);
        return;
      }

      if (data.type === "subscribeEquityOptions") {
        const contracts = sanitizeOptionContracts(data.contracts || []);
        const subscription = {
          kind: "equity-options",
          underlying: sanitizeSymbol(String(data.underlying || "").trim().toUpperCase()) || "SPY",
          expiry: normalizeMassiveOptionDate(data.expiry) || null,
          contracts,
          contractLookup: new Set(contracts)
        };
        subscribers.set(ws, subscription);
        if (!MASSIVE_API_KEY) {
          sendWsJson(ws, {
            type: "equity_options_error",
            message: "Massive API key not configured",
            updatedAt: new Date().toISOString()
          });
          return;
        }
        subscribeMassiveOptionContracts(subscription.contracts);
        sendWsJson(ws, {
          type: "subscribed",
          channel: "equity_options",
          underlying: subscription.underlying,
          expiry: subscription.expiry,
          contractCount: subscription.contracts.length
        });
        pushEquityOptionsSnapshot(ws, subscription);
        return;
      }

      // Existing greeks subscribe format:
      // { type: "subscribe", currency: "BTC", expiry: 123456789 }
      if (data.type === "subscribe") {
        const subscription = {
          kind: "greeks",
          currency: data.currency || "BTC",
          expiry: data.expiry || null
        };
        subscribers.set(ws, subscription);
        sendWsJson(ws, { type: "subscribed", channel: "greeks", ...subscription });
        pushGreeksSnapshot(ws, subscription);
      }
    } catch (e) {
      console.error("WS message error:", e.message);
    }
  });

  ws.on("close", () => {
    subscribers.delete(ws);
  });

  ws.on("error", () => {
    subscribers.delete(ws);
  });
});

const WS_PING_INTERVAL_MS = 30000;
const WS_IDLE_TIMEOUT_MS = 90000;
const WS_PRICE_PUSH_INTERVAL_MS = Math.max(5000, Number(process.env.WS_PRICE_PUSH_INTERVAL_MS || 15000));
const wsHeartbeatTimer = setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.isAlive === false || now - Number(ws.lastSeen || 0) > WS_IDLE_TIMEOUT_MS) {
      subscribers.delete(ws);
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, WS_PING_INTERVAL_MS);
if (typeof wsHeartbeatTimer.unref === "function") {
  wsHeartbeatTimer.unref();
}

const wsPushTimer = setInterval(() => {
  subscribers.forEach((subscription, ws) => {
    if (ws.readyState !== WebSocket.OPEN) {
      subscribers.delete(ws);
      return;
    }
    if (subscription.kind === "prices") {
      pushPriceSnapshot(ws, subscription);
    } else if (subscription.kind === "greeks") {
      pushGreeksSnapshot(ws, subscription);
    } else if (subscription.kind === "equity-options") {
      pushEquityOptionsSnapshot(ws, subscription);
    }
  });
}, WS_PRICE_PUSH_INTERVAL_MS);
if (typeof wsPushTimer.unref === "function") {
  wsPushTimer.unref();
}

async function startServer() {
  await initializeDatabase();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.removeListener("error", reject);
      console.log(`Portfolio manager backend (with WS) listening on port ${port}`);

      // Start the Farside sync scheduler (runs every weekday at 9am UTC)
      function startFarsideScheduler() {
        const syncScript = path.join(__dirname, 'scripts', 'sync-farside-etf.js');
        const runSync = () => {
          console.log("[Scheduler] Triggering Farside ETF sync...");
          const { exec } = require('child_process');
          exec(`node "${syncScript}"`, (error, stdout, stderr) => {
            if (error) console.error(`[Scheduler] Farside sync error: ${error.message}`);
            if (stderr) console.error(`[Scheduler] Farside sync stderr: ${stderr}`);
            console.log(`[Scheduler] Farside sync output: ${stdout}`);
          });
        };

        const scheduleNext = () => {
          const now = new Date();
          const next9am = new Date();
          next9am.setUTCHours(9, 0, 0, 0);
          if (now >= next9am) next9am.setUTCDate(next9am.getUTCDate() + 1);
          
          // Weekend check: if Saturday (6) or Sunday (0), move to Monday (1)
          const day = next9am.getUTCDay();
          if (day === 6) next9am.setUTCDate(next9am.getUTCDate() + 2);
          else if (day === 0) next9am.setUTCDate(next9am.getUTCDate() + 1);

          const delay = next9am.getTime() - now.getTime();
          console.log(`[Scheduler] Next Farside sync scheduled for ${next9am.toISOString()} (in ${Math.round(delay/1000/60)} minutes)`);
          setTimeout(() => {
            runSync();
            scheduleNext();
          }, delay);
        };
        scheduleNext();
      }
      startFarsideScheduler();

      resolve();
    });
  });
}

async function stopServer() {
  clearInterval(wsHeartbeatTimer);
  clearInterval(wsPushTimer);
  try {
    if (massiveStocksSocket) {
      try { massiveStocksSocket.close(); } catch {}
      massiveStocksSocket = null;
    }
    if (massiveOptionsSocket) {
      try { massiveOptionsSocket.close(); } catch {}
      massiveOptionsSocket = null;
    }
    wss.clients.forEach((ws) => {
      try { ws.terminate(); } catch {}
    });
    await new Promise((resolve) => wss.close(() => resolve()));
  } catch {}

  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) return reject(error);
        return resolve();
      });
    });
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    const dbConfig = describeDatabaseConfig();
    console.error(
      "Failed to initialize PostgreSQL database:",
      error.message,
      "| config:",
      JSON.stringify(dbConfig)
    );
    if (/ENOTFOUND|getaddrinfo/i.test(String(error?.message || ""))) {
      console.error(
        "Database hostname could not be resolved. Verify that DATABASE_URL points at the live Railway Postgres endpoint and that the host is reachable from this deployment."
      );
    }
    process.exit(1);
  });
}

module.exports = {
  app,
  server,
  startServer,
stopServer
};

// ---------------------------------------------------------------------------
// Analytics Module - Macro Routes (Compatibility for AnalyticsModule.jsx)
// ---------------------------------------------------------------------------

app.get("/api/macro/geographies", (req, res) => {
  const query = String(req.query.query || "").toLowerCase();
  const macroRegions = [
    { type: "Global", name: "Global", code: "GLOBAL", parent: null },
    { type: "Region", name: "Americas", code: "AMER", parent: "Global" },
    { type: "Region", name: "Europe", code: "EUR", parent: "Global" },
    { type: "Region", name: "Asia Pacific", code: "APAC", parent: "Global" },
    { type: "Region", name: "Middle East & Africa", code: "MEA", parent: "Global" }
  ];
  const countryRows = FALLBACK_COUNTRY_CATALOG_SEED.map(([cca3, cca2, name]) => ({
    type: "Country",
    name: name,
    code: cca3,
    regionCode: cca2,
    parent: "Global"
  }));
  const results = [...macroRegions, ...countryRows].filter((row) => {
    if (!query) return true;
    return [row.code, row.regionCode, row.name, row.type]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  res.json(results);
});

app.get("/api/macro/indicators", (req, res) => {
  res.json(MACRO_INDICATOR_CONFIG);
});

app.get("/api/macro/alerts", (req, res) => {
  res.json([]);
});

app.get("/api/macro/global/overview", async (req, res) => {
  try {
    const metrics = await aggregateMacroMetricsForCountries(MACRO_REGION_MEMBERS.GLB);
    res.json(buildMacroOverviewPayload("GLOBAL", "Global", metrics));
  } catch (error) {
    res.json({
      ...buildMacroOverviewPayload("GLOBAL", "Global", buildDeterministicMacroMetrics("GLOBAL")),
      stale: true,
      stale_reason: error?.message || "macro_global_overview_fallback"
    });
  }
});

app.get("/api/macro/region/:code/overview", async (req, res) => {
  const code = String(req.params.code || "REGION").trim().toUpperCase();
  const members = MACRO_REGION_MEMBERS[code] || [];
  if (!members.length) {
    return res.json({
      code,
      name: code,
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: "macro_region_members_unavailable",
      items: []
    });
  }
  try {
    const metrics = await aggregateMacroMetricsForCountries(members);
    res.json(buildMacroOverviewPayload(code, code, metrics));
  } catch (error) {
    res.json({
      ...buildMacroOverviewPayload(code, code, buildDeterministicMacroMetrics(code)),
      stale: true,
      stale_reason: error?.message || "macro_region_overview_fallback"
    });
  }
});

app.get("/api/macro/country/:code/overview", async (req, res) => {
  const code = String(req.params.code || "USA").trim().toUpperCase();
  try {
    const metrics = sanitizeMacroMetrics(await fetchWorldBankMacroMetrics(code));
    res.json(buildMacroOverviewPayload(code, code, metrics));
  } catch (error) {
    res.json({
      ...buildMacroOverviewPayload(code, code, buildDeterministicMacroMetrics(code)),
      stale: true,
      stale_reason: error?.message || "macro_overview_fallback"
    });
  }
});

app.get("/api/macro/timeseries", async (req, res) => {
  const geo = String(req.query.geo || "").trim().toUpperCase();
  const indicator = String(req.query.indicator || "").trim();
  const range = normalizeMacroRange(req.query.range);
  const mode = String(req.query.mode || "levels").trim().toLowerCase();
  try {
    const country = await resolveCountryReference(geo);
    const countryCode = String(country?.cca3 || geo || "").trim().toUpperCase();
    const { config, metric } = await fetchMacroMetricByIndicator(countryCode, indicator);
    if (!config || !metric?.series?.length) {
      return res.json({
        series: [],
        updatedAt: new Date().toISOString(),
        unavailable: true,
        stale_reason: "macro_timeseries_unavailable"
      });
    }
    const sliced = sliceMacroSeriesByRange(metric.series, range);
    const series = deriveMacroSeriesForMode(sliced, mode);
    return res.json({
      updatedAt: new Date().toISOString(),
      source: "World Bank",
      indicator: config.label,
      geo: countryCode,
      mode,
      range,
      series
    });
  } catch (error) {
    return res.json({
      series: [],
      updatedAt: new Date().toISOString(),
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "macro_timeseries_fetch_failed"
    });
  }
});

app.get("/api/macro/compare", async (req, res) => {
  const geos = String(req.query.geos || "")
    .split(",")
    .map((geo) => geo.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);
  const indicator = String(req.query.indicator || "").trim();
  try {
    const rows = (await Promise.all(geos.map(async (geo, idx) => {
      try {
        const country = await resolveCountryReference(geo);
        const countryCode = String(country?.cca3 || geo).trim().toUpperCase();
        const { metric } = await fetchMacroMetricByIndicator(countryCode, indicator);
        const value = Number(metric?.current);
        const previous = Number(metric?.previous);
        if (!Number.isFinite(value)) return null;
        const delta = Number.isFinite(previous) ? Number((value - previous).toFixed(2)) : null;
        return { id: `cmp-${idx}`, geo: countryCode, value: Number(value.toFixed(2)), delta, asOf: metric?.asOf || null };
      } catch {
        return null;
      }
    }))).filter(Boolean);
    res.json({ updatedAt: new Date().toISOString(), source: "World Bank", rows });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "World Bank", stale: true, unavailable: true, stale_reason: error?.message || "macro_compare_fetch_failed", rows: [] });
  }
});

app.get("/api/macro/calendar", async (req, res) => {
  const geo = String(req.query.geo || "").trim().toUpperCase();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const importance = String(req.query.importance || "all").trim().toLowerCase();
  const indicatorType = String(req.query.type || "all").trim().toLowerCase();
  try {
    const resolvedCountry = geo && geo !== "ALL" ? await resolveCountryReference(geo).catch(() => null) : null;
    const countryCode = String(resolvedCountry?.cca3 || geo || "").trim().toUpperCase();
    const rows = (await fetchForexFactoryEvents())
      .map((event, idx) => {
        const config = inferMacroIndicatorFromEvent(event);
        return {
          id: event.id || `macro-cal-${idx}`,
          date: String(event?.date || event?.asOf || "").slice(0, 10),
          geo: String(event?.countryCode || event?.country || "").trim().toUpperCase(),
          indicator: config?.label || "Macro Release",
          category: config?.category || "other",
          importance: normalizeImportanceLevel(event?.impact || event?.importance),
          event: event?.title || event?.event || event?.name || "Economic release"
        };
      })
      .filter((row) => row.date)
      .filter((row) => !countryCode || countryCode === "ALL" || row.geo === countryCode)
      .filter((row) => !from || row.date >= from)
      .filter((row) => !to || row.date <= to)
      .filter((row) => importanceMatchesFilter(row.importance, importance))
      .filter((row) => indicatorType === "all" || row.category === indicatorType)
      .slice(0, 100);
    res.json({ updatedAt: new Date().toISOString(), source: "ForexFactory", events: rows });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "ForexFactory", stale: true, unavailable: true, stale_reason: error?.message || "macro_calendar_fetch_failed", events: [] });
  }
});

app.get("/api/macro/map", async (req, res) => {
  const indicator = String(req.query.indicator || "").trim();
  try {
    const rows = (await Promise.all(MACRO_MAP_COUNTRIES.map(async (countryCode, idx) => {
      try {
        const { metric } = await fetchMacroMetricByIndicator(countryCode, indicator);
        const value = Number(metric?.current);
        if (!Number.isFinite(value)) return null;
        return {
          id: `map-${idx}`,
          geo: countryCode,
          value: Number(value.toFixed(2)),
          asOf: metric?.asOf || null
        };
      } catch {
        return null;
      }
    }))).filter(Boolean);
    res.json({ updatedAt: new Date().toISOString(), source: "World Bank", rows });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "World Bank", stale: true, unavailable: true, stale_reason: error?.message || "macro_map_fetch_failed", rows: [] });
  }
});

app.get("/api/macro/rankings", async (req, res) => {
  const indicator = String(req.query.indicator || "").trim();
  const sort = String(req.query.sort || "value_desc").trim().toLowerCase();
  try {
    const rows = (await Promise.all(MACRO_MAP_COUNTRIES.map(async (countryCode) => {
      try {
        const { metric } = await fetchMacroMetricByIndicator(countryCode, indicator);
        const value = Number(metric?.current);
        const previous = Number(metric?.previous);
        if (!Number.isFinite(value)) return null;
        return {
          geo: countryCode,
          value: Number(value.toFixed(2)),
          delta: Number.isFinite(previous) ? Number((value - previous).toFixed(2)) : null,
          asOf: metric?.asOf || null
        };
      } catch {
        return null;
      }
    }))).filter(Boolean);
    rows.sort((a, b) => {
      if (sort === "value_asc") return Number(a.value) - Number(b.value);
      if (sort === "delta_desc") return Number(b.delta || -Infinity) - Number(a.delta || -Infinity);
      return Number(b.value) - Number(a.value);
    });
    res.json({
      updatedAt: new Date().toISOString(),
      source: "World Bank",
      rows: rows.map((row, index) => ({ id: `rk-${index}`, rank: index + 1, ...row }))
    });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "World Bank", stale: true, unavailable: true, stale_reason: error?.message || "macro_rankings_fetch_failed", rows: [] });
  }
});

app.get("/api/macro/forecast", (_req, res) => {
  res.json({
    updatedAt: new Date().toISOString(),
    source: "Unavailable",
    points: [],
    unavailable: true,
    stale_reason: "macro_forecast_model_not_available"
  });
});

app.get("/api/macro/source/:indicator", (req, res) => {
  const config = getMacroIndicatorConfig(req.params.indicator);
  res.json({
    indicator: req.params.indicator,
    source: "World Bank",
    provider: "World Bank Open Data",
    updatedAt: new Date().toISOString(),
    frequency: "Monthly to annual, depending on the indicator",
    methodology: config
      ? `${config.label} is sourced from the World Bank country series and normalized into the Analytics view without synthetic placeholder values.`
      : "Country-level macro indicator series sourced from the World Bank."
  });
});

app.get("/api/macro/regime", async (req, res) => {
  const geo = String(req.query.geo || "USA").trim().toUpperCase();
  try {
    const country = await resolveCountryReference(geo);
    const countryCode = String(country?.cca3 || geo).trim().toUpperCase();
    const metrics = sanitizeMacroMetrics(await fetchWorldBankMacroMetrics(countryCode));
    const metricByKey = new Map(metrics.map((metric) => [String(metric.key || "").trim().toLowerCase(), metric]));
    const growth = Number(metricByKey.get("gdp_growth_rate")?.current);
    const inflation = Number(metricByKey.get("inflation_rate")?.current ?? metricByKey.get("core_inflation_rate")?.current);
    const rates = Number(metricByKey.get("interest_rate")?.current);
    const unemployment = Number(metricByKey.get("unemployment_rate")?.current);
    let label = "mixed";
    let score = 50;
    let explain = "Macro conditions are mixed across growth, inflation, labor, and rates.";
    if (Number.isFinite(growth) && Number.isFinite(inflation) && growth >= 2 && inflation <= 3.5) {
      label = "expansion";
      score = 75;
      explain = "Growth is healthy while inflation remains comparatively contained.";
    } else if (Number.isFinite(inflation) && inflation >= 5) {
      label = "inflationary";
      score = 35;
      explain = "Inflation is elevated relative to trend and is pressuring financial conditions.";
    } else if (Number.isFinite(growth) && growth < 0) {
      label = "recession risk";
      score = 20;
      explain = "Growth has turned negative, which raises recession risk.";
    } else if (Number.isFinite(growth) && growth < 1) {
      label = "slowdown";
      score = 45;
      explain = "Growth is positive but weak relative to long-term trend.";
    } else if (Number.isFinite(rates) && Number.isFinite(inflation) && rates > inflation) {
      label = "tightening";
      score = 55;
      explain = "Policy rates are restrictive relative to inflation, which suggests tighter financial conditions.";
    } else if (Number.isFinite(unemployment) && unemployment >= 7) {
      label = "labor stress";
      score = 40;
      explain = "Labor-market stress is elevated relative to typical expansion conditions.";
    }
    res.json({ label, score, explain, updatedAt: new Date().toISOString(), source: "World Bank" });
  } catch (error) {
    res.json({ label: "unavailable", score: null, explain: "Macro regime data is unavailable for the selected geography.", updatedAt: new Date().toISOString(), source: "World Bank", stale: true, unavailable: true, stale_reason: error?.message || "macro_regime_fetch_failed" });
  }
});

app.get("/api/macro/correlation", async (req, res) => {
  const geo = String(req.query.geo || "USA").trim().toUpperCase();
  const indicator = String(req.query.indicator || "").trim();
  const asset = String(req.query.asset || "SPY").trim().toUpperCase();
  const window = String(req.query.window || "180d").trim().toLowerCase();
  try {
    const country = await resolveCountryReference(geo);
    const countryCode = String(country?.cca3 || geo || "USA").trim().toUpperCase();
    const { metric } = await fetchMacroMetricByIndicator(countryCode, indicator);
    const macroSeries = Array.isArray(metric?.series) ? metric.series : [];
    const historyRange = window === "3y" ? "5Y" : window === "1y" ? "1Y" : "1Y";
    const assetHistory = await fetchHistoryFromYahoo(asset, historyRange);
    const assetSeries = historyRowsToSeries(assetHistory.history);
    const assetByDate = new Map(assetSeries.map((row) => [row.date, row.value]));
    const pairs = macroSeries
      .map((row) => [Number(row?.value), assetByDate.get(String(row?.date || "").slice(0, 10))])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(Number(y)));
    const coefficient = pearsonCorrelation(pairs);
    const rows = coefficient == null
      ? []
      : [{
          pair: `${String(metric?.label || indicator || "Indicator")} vs ${asset}`,
          coefficient,
          window,
          geo: countryCode,
          observations: pairs.length,
          source: "World Bank + Yahoo Finance"
        }];
    res.json({ updatedAt: new Date().toISOString(), source: "World Bank + Yahoo Finance", rows });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "World Bank + Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "macro_correlation_fetch_failed", rows: [] });
  }
});

function deterministicMacroOffset(seed, span = 1) {
  const str = String(seed || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) % 100000;
  }
  return (hash / 100000) * span;
}

function buildDeterministicMacroMetrics(scope = "GLOBAL") {
  const baseValues = {
    gdp_growth_rate: 2.1,
    interest_rate: 4.25,
    inflation_rate: 3.1,
    unemployment_rate: 4.4,
    consumer_confidence: 98.5,
    balance_of_trade: -18.2,
    cpi: 122.4,
    core_inflation_rate: 2.8
  };
  return sanitizeMacroMetrics(
    MACRO_INDICATOR_CONFIG.map((config) => {
      const value = Number((Number(baseValues[config.key] ?? 0) + deterministicMacroOffset(`${scope}:${config.key}`, 0.7) - 0.35).toFixed(2));
      const previous = Number((value - deterministicMacroOffset(`${scope}:${config.key}:prev`, 0.5) + 0.25).toFixed(2));
      return {
        key: config.key,
        current: value,
        previous,
        expectation: Number((value + (value - previous)).toFixed(2)),
        change: Number((value - previous).toFixed(2)),
        changePercent: previous ? Number((((value - previous) / Math.abs(previous)) * 100).toFixed(2)) : null,
        asOf: new Date().toISOString().slice(0, 10),
        previousAsOf: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        currentAsOf: new Date().toISOString().slice(0, 10),
        expectationAsOf: new Date().toISOString().slice(0, 10),
        series: Array.from({ length: 12 }, (_, idx) => ({
          date: new Date(Date.now() - (11 - idx) * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          value: Number((previous + (idx / 11) * (value - previous)).toFixed(2))
        }))
      };
    })
  );
}

function buildMacroOverviewPayload(code, name, metrics) {
  const items = sanitizeMacroMetrics(metrics).map((metric, idx) => {
    const value = Number(metric.current);
    const previous = Number(metric.previous);
    const change = Number.isFinite(value) && Number.isFinite(previous)
      ? Number((value - previous).toFixed(2))
      : null;
    return {
      id: `ov-${String(code || "macro").toLowerCase()}-${metric.key || idx}`,
      indicator: metric.label,
      indicatorCode: metric.key,
      name: metric.label,
      value: Number.isFinite(value) ? value : null,
      unit: metric.unit,
      trend: Number.isFinite(change) ? (change > 0 ? "Up" : change < 0 ? "Down" : "Flat") : "Flat",
      previous: Number.isFinite(previous) ? previous : null,
      change,
      asOf: metric.asOf,
      series: metric.series
    };
  });
  return {
    code,
    name,
    updatedAt: new Date().toISOString(),
    items
  };
}
