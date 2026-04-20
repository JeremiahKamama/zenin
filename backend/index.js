const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { watchlistData } = require("./data");
const {
  initializeDatabase,
  portfolio,
  watchlist,
  optionsCalculations,
  serviceSnapshots,
  tradeExecutions,
  balance,
  trading
} = require("./database");
const { ANNUAL_RETURNS, REIT_DATA, MMF_YIELDS, FUNDS_LIST } = require("./equities_benchmarks");

const app = express();

// Security headers
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    connectSrc: [
      "'self'",
      "https://api.binance.com",
      "https://api.coingecko.com",
      "https://api.derive.xyz",
      "https://fapi.binance.com"
    ],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
  }
}));

app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));
app.use(helmet.noSniff());
app.use(helmet.frameguard({ action: "deny" }));

function sanitizeSymbol(symbol) {
  return symbol.replace(/[^a-zA-Z0-9.\-_:]/g, "").slice(0, 30);
}

// CORS — allow configured frontend origin (or all origins in dev)
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : ["http://localhost:5173", "http://localhost:3000"];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));


// Rate limiting — 300 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many write requests." }
});


app.use(express.json({ limit: "100kb" }));

function handleServerError(res, context, error) {
  console.error(`${context}:`, error?.message || error);
  return res.status(500).json({ error: "Internal server error" });
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
  const { symbol, name, type, marketType, category, theme } = req.body;
  if (!symbol || typeof symbol !== "string" || symbol.length > 20) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  if (!name || typeof name !== "string" || name.length > 100) {
    return res.status(400).json({ error: "Invalid name" });
  }
  if (!type || typeof type !== "string" || type.length > 50) {
    return res.status(400).json({ error: "Invalid type" });
  }
  if (category != null && (typeof category !== "string" || category.length > 100)) {
    return res.status(400).json({ error: "Invalid category" });
  }
  if (theme != null && (typeof theme !== "string" || theme.length > 100)) {
    return res.status(400).json({ error: "Invalid theme" });
  }
  next();
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
  "Salik":      "SALIK.AE",
  "LYSDY":      "LYSDY",
  "ILU":        "ILU.AX",
  "ARU":        "ARU.AX",
  "SYR":        "SYR.AX",
  "NEO":        "NEO.TO",
  "ENR":        "ENR.DE",
  "ALOY":       "ALOY",
  "USAR":       "USAR",
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
  // Safety fallback: if BTC/ETH ever reach here, they need the -USD suffix for Yahoo
  const fallbacks = { "BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD" };
  if (fallbacks[symbol]) return fallbacks[symbol];
  
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol];
  if (symbol.includes(".")) return symbol;          // already has suffix
  if (/^\d+$/.test(symbol)) return `${String(parseInt(symbol, 10)).padStart(4, "0")}.HK`; // bare number → HK
  return symbol;                                    // US ticker — pass through
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
  } catch {
    // fallback to CoinGecko below
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
      priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null
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
      });
    } catch {
      // ignore CoinGecko failures
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
    const child = spawn("python3", ["fetch_prices.py"], { cwd: __dirname });
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
        result[orig] = yfPrices[orig] || { 
          price: null, 
          priceChangePercent: null,
          isMarketOpen: true,
          marketStatus: "unknown"
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
      for (const q of quotes) {
        if (!q.symbol) continue;
        if (!results.some(r => r.symbol === q.symbol)) {
          results.push({
            symbol: q.symbol,
            name: q.shortname || q.longname || q.symbol,
            type: "stock",
            exchange: q.exchange || "NASDAQ/NYSE"
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

app.get("/api/db/balance", async (_req, res) => {
  try {
    const current = await balance.get();
    res.json({ balance: current });
  } catch (err) {
    handleServerError(res, "Balance read failed", err);
  }
});

app.post("/api/db/balance", writeLimiter, async (req, res) => {
  try {
    const { amount, type } = req.body;
    if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) return res.status(400).json({ error: "Invalid amount" });
    const newBalance = await balance.applyChange(amount, type);
    res.json({ balance: newBalance });
  } catch (err) {
    if (err.code === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    handleServerError(res, "Balance update failed", err);
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
      "3M": { period: "3mo", interval: "1d" },
      "1Y": { period: "1y", interval: "1d" },
      "YTD": { period: "ytd", interval: "1d" },
      "MAX": { period: "max", interval: "1wk" },
    };
    const { period, interval: yfInterval } = mapping[interval] || mapping["1D"];
    const yfSymbol = normaliseSymbol(symbol);

    const child = spawn("python3", ["fetch_history.py"], { cwd: __dirname });
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
    }, 30000);

    child.on("close", () => clearTimeout(timer));
    child.on("error", () => clearTimeout(timer));
  });
}



// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check — used by Render and uptime monitors
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/categories", (_req, res) => {
  res.json({ categories: Object.keys(watchlistData) });
});

app.get("/api/history", async (req, res) => {
  const { type, interval = "1D" } = req.query;
  const symbol = sanitizeSymbol(req.query.symbol || "");
  if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
  const snapshotParams = {
    symbol: String(symbol).toUpperCase(),
    type: String(type || "stock").toLowerCase(),
    interval: String(interval || "1D").toUpperCase()
  };
  const cached = await readServiceSnapshot("history", snapshotParams);

  try {
    let history = [];
    let source = "";
    if (type === "crypto") {
      const cryptoHistory = await fetchHistoryForCrypto(symbol, interval);
      history = cryptoHistory.history;
      source = cryptoHistory.source;
    } else {
      const stockHistory = await fetchHistoryFromYahoo(symbol, interval);
      history = stockHistory.history;
      source = stockHistory.source || "yahoo";
    }
    const payload = {
      history: Array.isArray(history) ? history : [],
      source: source || "",
      updatedAt: new Date().toISOString(),
      stale: false
    };
    await writeServiceSnapshot("history", snapshotParams, payload);
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
  const cleanSymbol = sanitizeSymbol(symbol || "").toUpperCase();
  if (!cleanSymbol) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  const intervals = ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"];
  const snapshotParams = {
    symbol: cleanSymbol,
    type: String(type || "stock").toLowerCase()
  };
  const cached = await readServiceSnapshot("interval-performance", snapshotParams);
  
  try {
    const results = await Promise.all(intervals.map(async (int) => {
      try {
        let history = [];
        if (type === "crypto") {
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

app.get("/api/search", async (req, res) => {
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
    } else if (normalizedType === "indicator" || normalizedType === "indicators") {
      results = await searchCountries(q, 20);
    } else {
      results = await searchYahooFinance(q, normalizedType);
    }
    res.json({ results });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

const FINVIZ_CACHE = new Map();
const FINVIZ_CACHE_TTL = 3600 * 1000; // 1 hour

app.get("/api/finviz", async (req, res) => {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: "symbol query is required" });

  // Cache check
  const now = Date.now();
  if (FINVIZ_CACHE.has(symbol)) {
    const entry = FINVIZ_CACHE.get(symbol);
    if (now - entry.timestamp < FINVIZ_CACHE_TTL) {
      return res.json(entry.data);
    }
  }

  try {
    const child = spawn("python3", ["scripts/fetch_finviz.py", symbol], { cwd: __dirname });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error("Finviz scraper failed:", stderr);
        return res.status(500).json({ error: "Scraper failed" });
      }
      try {
        const data = JSON.parse(stdout);
        FINVIZ_CACHE.set(symbol, { timestamp: now, data });
        res.json(data);
      } catch (e) {
        res.status(500).json({ error: "Failed to parse scraper output" });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/earnings", async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const safeSymbol = symbol.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20);
  const snapshotParams = { symbol: safeSymbol.toUpperCase() };
  const cached = await readServiceSnapshot("earnings", snapshotParams);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      res.json(payload);
      resolve();
    };
    const child = spawn("python3", ["fetch_earnings.py"], { cwd: __dirname });
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
          symbol: safeSymbol.toUpperCase(),
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
            symbol: safeSymbol.toUpperCase(),
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
          symbol: safeSymbol.toUpperCase(),
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
          symbol: safeSymbol.toUpperCase(),
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
        symbol: safeSymbol.toUpperCase(),
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: err?.message || "earnings_process_start_failed",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    });

    child.stdin.write(JSON.stringify({ symbol: safeSymbol }));
    child.stdin.end();

    setTimeout(() => {
      child.kill();
      if (cached?.payload) {
        return finish(applyStaleMeta(cached.payload, cached, "earnings_fetch_timed_out"));
      }
      finish({
        symbol: safeSymbol.toUpperCase(),
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: "earnings_fetch_timed_out",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    }, 20000);
  });
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

    try {
      const child = spawn("python3", ["fetch_company_profile.py"], { cwd: __dirname });
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
            await writeServiceSnapshot("company-profile", snapshotParams, unchangedPayload);
            return finish(unchangedPayload);
          }

          await writeServiceSnapshot("company-profile", snapshotParams, payload);
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
      }, 25000);
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
  });
});

app.get("/api/earnings-calendar", async (req, res) => {
  const rawSymbols = String(req.query.symbols || "");
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 5);

  const symbols = [...new Set(
    rawSymbols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20))
  )].slice(0, limit);

  if (!symbols.length) {
    return res.status(400).json({ error: "symbols required" });
  }

  const { toYF } = buildSymbolMaps(symbols);
  const yfSymbols = symbols.map((s) => toYF[s]);
  const snapshotParams = { symbols };
  const cached = await readServiceSnapshot("earnings-calendar", snapshotParams);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      res.json(payload);
      resolve();
    };

    const child = spawn("python3", ["fetch_earnings.py"], { cwd: __dirname });
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
            source: "Yahoo Finance"
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
        const byYfSymbol = new Map(items.map((item) => [item.symbol, item]));

        const normalizedItems = symbols.map((originalSymbol) => {
          const yfSymbol = toYF[originalSymbol];
          const result = byYfSymbol.get(yfSymbol);
          return {
            symbol: originalSymbol,
            nextEarnings: result?.nextEarnings || null,
            source: "Yahoo Finance"
          };
        });
        const payload = {
          items: normalizedItems,
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
            source: "Yahoo Finance"
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
          source: "Yahoo Finance"
        })),
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: err?.message || "earnings_calendar_start_failed",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    });

    child.stdin.write(JSON.stringify({ symbols: yfSymbols }));
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
          source: "Yahoo Finance"
        })),
        updatedAt: new Date().toISOString(),
        stale: true,
        unavailable: true,
        stale_reason: "earnings_calendar_timeout",
        cache_updated_at: null,
        stale_age_seconds: null
      });
    }, 20000);
  });
});

app.get("/api/macro-indicators", async (req, res) => {
  const requestedCountry = String(req.query.country || "").trim();
  if (!requestedCountry) {
    return res.status(400).json({ error: "country query parameter required" });
  }

  let countryMeta = null;
  try {
    countryMeta = await resolveCountryReference(requestedCountry);
  } catch (error) {
    console.error("Country resolution failed:", error?.message || error);
    return res.status(502).json({ error: "Could not resolve the requested country right now." });
  }
  if (!countryMeta?.cca3) {
    return res.status(400).json({ error: "country must be a valid country name or ISO code" });
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
    return res.json(cached.payload);
  }

  const buildFallbackPayload = (reason) => ({
    country,
    countryName,
    source: "Macro data temporarily unavailable",
    updatedAt: new Date().toISOString(),
    stale: true,
    unavailable: true,
    metrics: MACRO_INDICATOR_CONFIG.map((config) => ({
      key: config.key,
      label: config.label,
      unit: config.unit || "",
      current: null,
      previous: null,
      expectation: null,
      change: null,
      changePercent: null,
      asOf: null,
      series: []
    })),
    diagnostics: {
      reason: String(reason || "upstream_unavailable")
    }
  });

  if (!EODHD_API_TOKEN) {
    if (cached?.payload) {
      return res.json({
        ...cached.payload,
        stale: true,
        unavailable: true,
        stale_age_seconds: Math.floor((now - cached.cachedAt) / 1000),
        diagnostics: {
          ...(cached.payload?.diagnostics || {}),
          reason: "missing_eodhd_token"
        }
      });
    }
    return res.json(buildFallbackPayload("missing_eodhd_token"));
  }

  try {
    const fetch = await resolveFetch();
    const base = `https://eodhd.com/api/macro-indicator/${encodeURIComponent(country)}`;
    const defaultParams = new URLSearchParams({
      api_token: EODHD_API_TOKEN,
      fmt: "json"
    });

    // Prefer one bulk request (more reliable and far cheaper than multiple indicator calls).
    const bulkUrl = `${base}?${defaultParams.toString()}`;
    const bulkRes = await fetch(bulkUrl);
    const bulkText = await bulkRes.text();
    if (!bulkRes.ok) {
      throw new Error(`HTTP ${bulkRes.status} ${bulkText.slice(0, 200)}`);
    }

    let bulkData = null;
    try {
      bulkData = JSON.parse(bulkText);
    } catch {
      bulkData = null;
    }

    const rawServiceMessage = typeof bulkData === "string"
      ? bulkData
      : (typeof bulkText === "string" ? bulkText : "");
    if (/Only EOD data allowed/i.test(rawServiceMessage)) {
      throw new Error("EODHD token does not include macro indicators on the current plan.");
    }

    const groupedByIndicator = groupMacroPayloadByIndicator(bulkData);

    const metrics = MACRO_INDICATOR_CONFIG.map((config) => {
      const rows = getMacroRowsForConfig(groupedByIndicator, config);
      return buildMacroMetric(rows, config);
    });

    const missingKeys = metrics.filter((m) => m.current == null).map((m) => m.key);
    if (missingKeys.length === metrics.length) {
      throw new Error("No usable macro indicator values returned by EODHD for this country/token.");
    }

    const payload = {
      country,
      countryName,
      source: "EODHD Macro Indicators API",
      updatedAt: new Date().toISOString(),
      metrics,
      diagnostics: {
        missingIndicatorKeys: missingKeys,
        groupedIndicatorCount: groupedByIndicator.size
      }
    };

    macroIndicatorsCache.set(cacheKey, { payload, cachedAt: now });
    await writeServiceSnapshot("macro-indicators", { country }, payload);
    res.json(payload);
  } catch (error) {
    console.error("Macro indicators fetch failed:", error.message);
    if (cached?.payload) {
      return res.json(applyStaleMeta(cached.payload, {
        updatedAt: persisted?.updatedAt || new Date(cached.cachedAt).toISOString()
      }, error?.message || "macro_fetch_failed"));
    }
    return res.json(buildFallbackPayload(error?.message || "upstream_fetch_failed"));
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

  // Crypto — live prices from Binance
  if (key === "crypto") {
    try {
      const assets = await fetchCryptoMarketData();
      const payload = {
        category: key,
        assets: Array.isArray(assets) ? assets : [],
        updatedAt: new Date().toISOString(),
        stale: false
      };
      await writeServiceSnapshot("watchlist", snapshotParams, payload);
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
    const payload = {
      category: key,
      assets: indicatorAssets,
      updatedAt: new Date().toISOString(),
      stale: false
    };
    await writeServiceSnapshot("watchlist", snapshotParams, payload);
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
    const prices = pricedSymbols.length > 0
      ? await fetchYFinancePrices(pricedSymbols)
      : {};

    const enrichedAssets = assets.map((asset) => ({
      ...asset,
      type: asset.type || "stock",
      price: prices[asset.symbol]?.price ?? null,
      priceChangePercent: prices[asset.symbol]?.priceChangePercent ?? null,
    }));
    const payload = {
      category: key,
      assets: enrichedAssets,
      updatedAt: new Date().toISOString(),
      stale: false
    };
    await writeServiceSnapshot("watchlist", snapshotParams, payload);
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

app.get("/api/prices", async (req, res) => {
  const rawSymbols = String(req.query.symbols || "");
  const type = String(req.query.type || "tradfi").trim().toLowerCase();
  const symbols = [...new Set(
    rawSymbols
      .split(",")
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean)
  )].slice(0, 200);

  if (!symbols.length) {
    return res.status(400).json({ error: "symbols query is required" });
  }
  const snapshotParams = { type, symbols: symbols.slice().sort() };
  const cached = await readServiceSnapshot("prices", snapshotParams);

  try {
    let payload = null;
    if (type === "crypto") {
      const prices = await fetchCryptoQuotesBySymbols(symbols);
      payload = { type: "crypto", prices, updatedAt: new Date().toISOString(), stale: false };
    } else {
      const prices = await fetchYFinancePrices(symbols);
      payload = { type: "tradfi", prices, updatedAt: new Date().toISOString(), stale: false };
    }
    await writeServiceSnapshot("prices", snapshotParams, payload);
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
const EODHD_API_TOKEN = String(
  process.env.EODHD_API_TOKEN ||
  process.env.EODHD_API_KEY ||
  process.env.EODHD_TOKEN ||
  ""
).trim().replace(/^,+|,+$/g, "");
const MACRO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const macroIndicatorsCache = new Map();
const COUNTRY_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let countryCatalogMemory = {
  countries: [],
  cachedAt: 0
};

const MACRO_INDICATOR_CONFIG = [
  { key: "consumer_price_index", label: "CPI", unit: "Index", aliases: ["cpi"] },
  { key: "inflation_consumer_prices_annual", label: "Inflation Rate", unit: "%", aliases: ["inflation_rate"] },
  { key: "gdp_growth_annual", label: "GDP Growth Rate", unit: "%", aliases: ["gdp_growth_rate"] },
  { key: "real_interest_rate", label: "Real Interest Rate", unit: "%", aliases: ["real_interest_rates"] },
  { key: "unemployment_total_percent", label: "Unemployment Rate", unit: "%", aliases: ["unemployment_rate"] },
  { key: "inflation_gdp_deflator_annual", label: "Inflation Rate (GDP Deflator)", unit: "%", aliases: ["gdp_deflator_inflation_rate"] }
];

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

  if (/^[A-Z]{3}$/.test(upperRaw)) {
    return {
      cca3: upperRaw,
      cca2: null,
      name: upperRaw,
      officialName: null,
      aliases: [upperRaw]
    };
  }
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
      const key = normalizeIndicatorKey(row?.indicator || row?.Indicator || row?.name || row?.Name);
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
    }
  });

  return grouped;
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
    } catch {
      events = [];
    }

    if (!events.length) {
      try {
        const taggedEvents = await fetchPredictionEventsByTag(tagSlug, PREDICTION_EVENTS_FETCH_LIMIT);
        events = (Array.isArray(taggedEvents) ? taggedEvents : []).filter((event) =>
          isEventAllowedForCategory(event, category)
        );
      } catch {
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

// Lyra (Derive) Crypto Options Integration
// ---------------------------------------------------------------------------
// ✅ STABLE Derive Options Chain Endpoint (FIXED)
// ---------------------------------------------------------------------------
app.post("/api/options/crypto", async (req, res) => {
  const { currency = "BTC", expiry } = req.body;
  const normalizedCurrency = String(currency || "BTC").toUpperCase();
  const marketStructure = normalizedCurrency === "HYPE" ? "rfq" : "orderbook";
  const marketStructureLabel = marketStructure === "rfq" ? "RFQ" : "Orderbook";
  const marketStructureNote = marketStructure === "rfq"
    ? "HYPE on Derive can be quoted through RFQ, so full strike ladders may appear sparse or be unavailable in snapshots."
    : null;
  const cacheKey = `${normalizedCurrency}:latest`;
  const snapshotParams = {
    currency: normalizedCurrency,
    expiry: expiry == null ? "latest" : String(expiry)
  };
  const persistedSnapshot = await readServiceSnapshot("options-chain", snapshotParams);

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
        t?.mark_price,
        t?.last_price,
        t?.last,
        t?.price,
        t?.index_price,
        t?.underlying_price,
        0
      );

      const data = {
        bid: Number.isFinite(rawBid) ? rawBid : (Number.isFinite(fallbackPx) ? fallbackPx : 0),
        ask: Number.isFinite(rawAsk) ? rawAsk : (Number.isFinite(fallbackPx) ? fallbackPx : 0),
        delta: firstFiniteNumber(t?.greeks?.delta, t?.delta, 0),
        gamma: firstFiniteNumber(t?.greeks?.gamma, t?.gamma, 0),
        vega: firstFiniteNumber(t?.greeks?.vega, t?.vega, 0),
        theta: firstFiniteNumber(t?.greeks?.theta, t?.theta, 0),
        iv: firstFiniteNumber(
          t?.iv,
          t?.mark_iv,
          t?.bid_iv,
          t?.ask_iv,
          t?.greeks?.iv,
          0
        ),
      };

      if (type === "call") strikesMap[strike].call = data;
      else if (type === "put") strikesMap[strike].put = data;
    });

    const chain = Object.values(strikesMap)
      .sort((a, b) => a.strike - b.strike)
      .slice(0, 30);

    const avgIv =
      allTickers.reduce((s, t) => s + (firstFiniteNumber(t?.iv, t?.mark_iv, t?.bid_iv, t?.ask_iv, 0) || 0), 0) /
      (allTickers.length || 1);

    const referenceTicker = allTickers.find(Boolean) || null;
    const spot =
      Number(referenceTicker?.index_price || referenceTicker?.underlying_price || referenceTicker?.underlying_index || 0) || null;

    const payload = {
      expiry: targetExpiry,
      expiries,
      chain,
      spot,
      market_price: spot,
      market_structure: marketStructure,
      market_structure_label: marketStructureLabel,
      market_structure_note: marketStructureNote,
      market_metrics: {
        iv: avgIv || 0,
        p_c_ratio: 0.85
      }
    };

    optionsChainCache.set(cacheKey, {
      payload,
      cachedAt: Date.now()
    });
    await writeServiceSnapshot("options-chain", snapshotParams, payload);

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
app.get("/api/db/options-calculations", async (req, res) => {
  try {
    const { limit = 20, symbol } = req.query;
    const records = (await optionsCalculations.getRecent(limit, symbol || null)).map((row) => ({
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

app.post("/api/db/options-calculations", writeLimiter, validateOptionsCalculation, async (req, res) => {
  try {
    const payload = req.body || {};
    const record = await optionsCalculations.add(payload);
    res.status(201).json(record);
  } catch (error) {
    handleServerError(res, "Options calculation write failed", error);
  }
});

// Keep /api/prices alive for any direct calls from the frontend
app.get("/api/prices", async (req, res) => {
  const { symbols } = req.query;
  if (!symbols) {
    return res.status(400).json({ error: "symbols parameter required" });
  }
  const symbolList = symbols.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const prices = await fetchYFinancePrices(symbolList);
    res.json(prices);
  } catch (error) {
    res.status(502).json({ error: error.message });
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
app.get("/api/db/portfolio", async (req, res) => {
  try {
    const holdings = await portfolio.getAll();
    res.json({ holdings });
  } catch (error) {
    handleServerError(res, "Portfolio read failed", error);
  }
});

app.post("/api/db/portfolio",writeLimiter, validatePortfolioHolding, async (req, res) => {
  try {
    const holding = req.body;
    const result = await portfolio.add(holding);
    res.status(201).json(result);
  } catch (error) {
    handleServerError(res, "Portfolio write failed", error);
  }
});

app.put("/api/db/portfolio/:id", writeLimiter, validatePortfolioUpdate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: "Invalid id" });
    const holding = req.body;
    const result = await portfolio.update(id, holding);
    res.json(result);
  } catch (error) {
    handleServerError(res, "Portfolio update failed", error);
  }
});

app.delete("/api/db/portfolio/:id", writeLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await portfolio.delete(id);
    res.json(result);
  } catch (error) {
    handleServerError(res, "Portfolio delete failed", error);
  }
});

// Get portfolio items by symbol and marketType
app.get("/api/db/portfolio/symbol/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_\s]/g, "").slice(0, 50).toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const marketType = String(req.query.marketType || "").trim().toLowerCase();
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const holdings = await portfolio.findBySymbol(symbol, marketType);
    res.json({ holdings });
  } catch (error) {
    handleServerError(res, "Portfolio symbol lookup failed", error);
  }
});

// ---------------------------------------------------------------------------
// Trade execution endpoints (Journal persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/trades", async (req, res) => {
  try {
    const trades = await tradeExecutions.getAll(req.query.limit);
    res.json({ trades });
  } catch (error) {
    handleServerError(res, "Trades read failed", error);
  }
});

app.post("/api/db/trades", writeLimiter, async (req, res) => {
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
    const saved = await tradeExecutions.add(payload);
    res.status(201).json(saved);
  } catch (error) {
    handleServerError(res, "Trade write failed", error);
  }
});

// ---------------------------------------------------------------------------
// Watchlist Endpoints (Database Persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/watchlist", async (req, res) => {
  try {
    const assets = await watchlist.getAll();
    res.json({ assets });
  } catch (error) {
    handleServerError(res, "Watchlist read failed", error);
  }
});

app.post("/api/db/watchlist",writeLimiter,  validateWatchlistAsset, async (req, res) => {
  try {
    const asset = req.body;
    const result = await watchlist.add(asset);
    res.status(201).json(result);
  } catch (error) {
    handleServerError(res, "Watchlist write failed", error);
  }
});

app.delete("/api/db/watchlist/:symbol", writeLimiter, async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_\s]/g, "").slice(0, 50);
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const { marketType, category = null, theme = null } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const result = await watchlist.delete(symbol, marketType, category, theme);
    res.json(result);
  } catch (error) {
    handleServerError(res, "Watchlist delete failed", error);
  }
});

// Check if asset is in watchlist
app.get("/api/db/watchlist/check/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const { marketType, category = null, theme = null } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const exists = await watchlist.exists(symbol, marketType, category, theme);
    res.json({ exists });
  } catch (error) {
    handleServerError(res, "Watchlist exists check failed", error);
  }
});

app.get('/api/analytics/crypto', async (req, res) => {
  try {
    const fetch = await resolveFetch();
    const assets = ["BTC", "ETH", "SOL", "HYPE", "BNB"];
    
    const [bybitRes, binanceFundingRes, hlRes, ...binanceOIPromises] = await Promise.allSettled([
      fetch("https://api.bybit.com/v5/market/tickers?category=linear").then(r => r.json()),
      fetch("https://fapi.binance.com/fapi/v1/premiumIndex").then(r => r.json()),
      postHyperliquidInfo({ type: "metaAndAssetCtxs" }),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT`).then(r => r.json()).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT`).then(r => r.json()).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=SOLUSDT`).then(r => r.json()).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=BNBUSDT`).then(r => r.json()).catch(() => null),
    ]);

    const perpMetrics = [];

    // Hyperliquid parsing
    if (hlRes.status === "fulfilled" && Array.isArray(hlRes.value)) {
      const [meta, contexts] = hlRes.value;
      const universe = Array.isArray(meta?.universe) ? meta.universe : [];
      const ctxs = Array.isArray(contexts) ? contexts : [];
      universe.forEach((u, idx) => {
        const symbol = String(u?.name || "").toUpperCase();
        if (assets.includes(symbol) && ctxs[idx]) {
          perpMetrics.push({
            symbol,
            openInterestUsd: Number(ctxs[idx].openInterest || 0) * Number(ctxs[idx].markPx || 0),
            fundingRate: Number(ctxs[idx].funding || 0),
            exchange: "Hyperliquid"
          });
        }
      });
    }

    // Bybit parsing
    if (bybitRes.status === "fulfilled" && bybitRes.value?.result?.list) {
      const list = bybitRes.value.result.list;
      list.forEach(item => {
        const symbol = item.symbol.replace(/USDT$/, "");
        if (assets.includes(symbol)) {
          perpMetrics.push({
            symbol,
            openInterestUsd: Number(item.openInterestValue || 0),
            fundingRate: Number(item.fundingRate || 0),
            exchange: "Bybit"
          });
        }
      });
    }

    // Binance parsing
    if (binanceFundingRes.status === "fulfilled" && Array.isArray(binanceFundingRes.value)) {
      const ois = [
        binanceOIPromises[0]?.value, // BTC
        binanceOIPromises[1]?.value, // ETH
        binanceOIPromises[2]?.value, // SOL
        binanceOIPromises[3]?.value  // BNB
      ];
      
      const symbolsToMap = ["BTC", "ETH", "SOL", "BNB"];
      symbolsToMap.forEach((sym, i) => {
        const fundingItem = binanceFundingRes.value.find(f => f.symbol === `${sym}USDT`);
        const oiItem = ois[i];
        if (fundingItem || oiItem) {
          const markPx = Number(fundingItem?.markPrice || 0);
          const oiCoins = Number(oiItem?.openInterest || 0);
          perpMetrics.push({
            symbol: sym,
            openInterestUsd: oiCoins * markPx,
            fundingRate: Number(fundingItem?.lastFundingRate || 0),
            exchange: "Binance"
          });
        }
      });
    }

    // Sort by symbol, then exchange
    perpMetrics.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.exchange.localeCompare(b.exchange));

    // Mocks for Dune & Farside due to 403 blocks
    const etfInflows = [
      { id: "1", date: new Date().toISOString().split("T")[0], ticker: "IBIT", asset: "BTC", manager: "BlackRock", netUsd: 125000000, period: "daily" },
      { id: "2", date: new Date().toISOString().split("T")[0], ticker: "FBTC", asset: "BTC", manager: "Fidelity", netUsd: 45000000, period: "daily" },
      { id: "3", date: new Date().toISOString().split("T")[0], ticker: "ETHA", asset: "ETH", manager: "BlackRock", netUsd: 8200000, period: "daily" }
    ];

    res.json({
      updatedAt: new Date().toISOString(),
      perpMetrics,
      kimchiPremium: { valuePct: 1.2, market: "KRW vs USD" },
      etfInflows,
      perpVolumeByProtocol: [
        { protocol: "Hyperliquid", volumeUsd: 1400000000 },
        { protocol: "dYdX", volumeUsd: 850000000 },
        { protocol: "Jupiter", volumeUsd: 1100000000 }
      ],
      revenueByProtocol: [
        { protocol: "Hyperliquid", revenueUsd: 250000 },
        { protocol: "dYdX", revenueUsd: 150000 },
        { protocol: "Jupiter", revenueUsd: 200000 }
      ],
      optionsVolumeByAsset: [],
      optionsMaxPain: [],
    });
  } catch (error) {
    handleServerError(res, "Analytics Crypto fetch failed", error);
  }
});

app.get('/api/analytics/options', async (req, res) => {
  try {
    const fetch = await resolveFetch();
    
    const [btcDeribit, ethDeribit] = await Promise.allSettled([
      fetch("https://deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option").then(r => r.json()),
      fetch("https://deribit.com/api/v2/public/get_book_summary_by_currency?currency=ETH&kind=option").then(r => r.json())
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
        
        if (item.open_interest > 100 && greeks.length < 5) {
           greeks.push({
             instrument: item.instrument_name,
             asset: "BTC",
             exchange: "Deribit",
             delta: item.mark_price > 0 ? (item.bid_price ? 0.45 : -0.45) : 0, // mock greeks roughly since get_book_summary doesn't have all greeks
             gamma: 0.02,
             vega: 10.5,
             theta: -1.2,
             iv: item.mark_iv || 0
           });
        }
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

    // Process Deribit ETH
    if (ethDeribit.status === "fulfilled" && ethDeribit.value?.result) {
      ethDeribit.value.result.forEach(item => {
        totalOIUsd += (item.open_interest || 0) * (item.mark_price || 0);
        ethVol += (item.volume_usd || 0);
      });
    }

    res.json({
      updatedAt: new Date().toISOString(),
      totalOptionsOpenInterestUsd: totalOIUsd > 0 ? totalOIUsd : 4500000000,
      optionsVolumeByAsset: [
        { asset: "BTC", exchange: "Deribit", volumeUsd: btcVol > 0 ? btcVol : 1200000000 },
        { asset: "ETH", exchange: "Deribit", volumeUsd: ethVol > 0 ? ethVol : 600000000 }
      ],
      optionsMaxPain: [
        { asset: "BTC", expiry: "Next Friday", maxPain: 65000, exchange: "Deribit" },
        { asset: "ETH", expiry: "Next Friday", maxPain: 3500, exchange: "Deribit" }
      ],
      volumeByExchangeRoute: [
        { exchange: "Deribit", route: "Direct", volume: btcVol + ethVol > 0 ? btcVol + ethVol : 1800000000 },
        { exchange: "Binance", route: "Direct", volume: 450000000 }
      ],
      greeks,
      oiByStrike
    });
  } catch (error) {
    handleServerError(res, "Analytics Options fetch failed", error);
  }
});

app.get('/api/analytics/equities', async (req, res) => {
  try {
    const calculateCAGR = (series, assetKey, years) => {
      const recent = series.slice(0, years);
      if (recent.length === 0) return 0;
      // Total return = Product of (1 + r) - 1
      const product = recent.reduce((acc, curr) => acc * (1 + curr[assetKey] / 100), 1);
      const cagr = (Math.pow(product, 1 / recent.length) - 1) * 100;
      return Number(cagr.toFixed(2));
    };

    const benchmarkPerformance = [
      {
        name: "S&P 500 (USA)",
        yr1: calculateCAGR(ANNUAL_RETURNS, "sp500", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "sp500", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "sp500", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "sp500", 10),
        yr20: calculateCAGR(ANNUAL_RETURNS, "sp500", 20),
      },
      {
        name: "MSCI World (Global)",
        yr1: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 10),
        yr20: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 20),
      },
      {
        name: "MSCI EM (Emerging)",
        yr1: calculateCAGR(ANNUAL_RETURNS, "msciEm", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "msciEm", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "msciEm", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "msciEm", 10),
        yr20: calculateCAGR(ANNUAL_RETURNS, "msciEm", 20),
      },
      {
        name: "Global REITs (EPRA/Nareit)",
        yr1: calculateCAGR(ANNUAL_RETURNS, "reits", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "reits", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "reits", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "reits", 10),
        yr20: calculateCAGR(ANNUAL_RETURNS, "reits", 20),
      }
    ];

    res.json({
      updatedAt: new Date().toISOString(),
      benchmarkPerformance,
      annualReturns: ANNUAL_RETURNS,
      reitData: REIT_DATA,
      mmfYields: MMF_YIELDS,
      fundsList: FUNDS_LIST
    });
  } catch (error) {
    handleServerError(res, "Analytics Equities fetch failed", error);
  }
});


// ---------------------------------------------------------------------------
// Atomic trade execution (portfolio + balance + trade journal)
// ---------------------------------------------------------------------------
app.post("/api/db/execute-trade", writeLimiter, validatePortfolioHolding, async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await trading.executeTrade(payload);
    res.status(201).json(result);
  } catch (error) {
    if (error?.code === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    if (error?.code === "INSUFFICIENT_POSITION" || error?.code === "NO_POSITION") {
      return res.status(400).json({ error: error.message });
    }
    handleServerError(res, "Atomic trade execution failed", error);
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
// key: socket -> { currency, expiry }

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

      // subscribe format:
      // { type: "subscribe", currency: "BTC", expiry: 123456789 }
      if (data.type === "subscribe") {
        subscribers.set(ws, {
          currency: data.currency || "BTC",
          expiry: data.expiry || null
        });
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
setInterval(() => {
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

async function startServer() {
  try {
    await initializeDatabase();
    server.listen(port, "0.0.0.0", () => {
      console.log(`Portfolio manager backend listening on port ${port}`);
    });
  } catch (error) {
    console.error("Failed to initialize PostgreSQL database:", error.message);
    process.exit(1);
  }
}

startServer();
