const dotenv = require("dotenv");
const path = require("path");
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();
const express = require("express");
const crypto = require("crypto");
const { sendPasswordResetEmail } = require("./email");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { spawn } = require("child_process");
const fs = require("fs");

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

const { watchlistData } = require("./data");
const {
  initializeDatabase,
  portfolio,
  watchlist,
  optionsCalculations,
  userAuth,
  userWorkspace,
  runAdminWorkspaceMigration,
  serviceSnapshots,
  tradeExecutions,
  balance,
  trading
} = require("./database");
const { ANNUAL_RETURNS, REIT_DATA, MMF_YIELDS, FUNDS_LIST } = require("./equities_benchmarks");

const app = express();

// --- EODHD Macro Indicators Configuration ---
const EODHD_API_TOKEN = String(
  process.env.EODHD_API_TOKEN ||
  process.env.EODHD_API_KEY ||
  process.env.EODHD_TOKEN ||
  ""
).trim().replace(/^,+|,+$/g, "");

console.log(`[Startup] EODHD_API_TOKEN loaded: ${EODHD_API_TOKEN ? "YES" : "NO"}`);

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
    unit: "%",
    aliases: ["gdp", "gdp growth", "real gdp", "gdp growth rate"]
  },
  {
    key: "interest_rate",
    label: "Interest Rate",
    unit: "%",
    aliases: ["interest rate", "policy rate", "central bank rate", "cash rate", "fed funds"]
  },
  {
    key: "inflation_rate",
    label: "Inflation Rate",
    unit: "%",
    aliases: ["inflation", "inflation rate", "cpi yoy", "headline inflation"]
  },
  {
    key: "unemployment_rate",
    label: "Unemployment Rate",
    unit: "%",
    aliases: ["unemployment", "jobless rate", "unemployment rate"]
  },
  {
    key: "consumer_confidence",
    label: "Consumer Confidence",
    unit: "Index",
    aliases: ["consumer confidence", "consumer sentiment", "confidence index"]
  },
  {
    key: "balance_of_trade",
    label: "Balance of Trade",
    unit: "B",
    aliases: ["balance of trade", "trade balance", "current account"]
  },
  {
    key: "cpi",
    label: "CPI",
    unit: "Index",
    aliases: ["cpi", "consumer price index", "consumer prices"]
  },
  {
    key: "core_inflation_rate",
    label: "Core Inflation Rate",
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
  cpi: "FP.CPI.TOTL"
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
      series: Array.isArray(row.series) ? row.series : []
    };
  });
}
// --------------------------------------------


// Security headers with expanded CSP for production
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    connectSrc: [
      "'self'",
      "ws:",
      "wss:",
      "https://*.onrender.com",
      "wss://*.onrender.com",
      "https://*.vercel.app",
      "https://zenin-mx6w.onrender.com",
      "https://api.binance.com",
      "https://api.coingecko.com",
      "https://api.derive.xyz",
      "https://fapi.binance.com"
    ],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Added unsafe-eval for some runtime modules if needed
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    imgSrc: ["'self'", "data:", "https:", "http:"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    upgradeInsecureRequests: [], // Allow upgrading if needed
  }
}));

app.use(helmet.hsts({ maxAge: 31536000, includeSubDomains: true }));
app.use(helmet.noSniff());
app.use(helmet.frameguard({ action: "deny" }));

function sanitizeSymbol(symbol) {
  return symbol.replace(/[^a-zA-Z0-9.\-_:]/g, "").slice(0, 30);
}

// CORS — allow configured frontend origins and known production hosts
const normalizeOrigin = (value) => String(value || "").trim().replace(/\/+$/, "");
const configuredOrigins = String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:5175",
  "http://localhost:3000",
  "https://zenin.capital",
  "https://www.zenin.capital",
  "https://zenincapital.com",
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

// Helper to fetch latest results from Dune Analytics
async function fetchDuneLatestResults(queryId) {
  const apiKey = process.env.DUNE_API_KEY;
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
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalizedOrigin = normalizeOrigin(origin);
    const isVercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin);

    if (allowedOrigins.includes(normalizedOrigin) || isVercelPreview || isLocalIP(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin} (Normalized: ${normalizedOrigin})`);
      if (normalizedOrigin.endsWith(".zenin.capital") || normalizedOrigin.endsWith(".zenincapital.com")) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
  optionsSuccessStatus: 204
}));


// Rate limiting — 300 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Increased for polling dashboard
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." }
});


app.use(express.json({ limit: "100kb" }));

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const AUTH_HASH_KEY_RAW = String(process.env.AUTH_HASH_KEY || process.env.ZENIN_APP_SECRET || "").trim();
const FALLBACK_SECRET = "zenin_default_secure_fallback_secret_32chars_min_9f2a1c77_placeholder";
const AUTH_HASH_KEY = AUTH_HASH_KEY_RAW.length >= 32 ? AUTH_HASH_KEY_RAW : FALLBACK_SECRET;

if (AUTH_HASH_KEY === FALLBACK_SECRET) {
  console.warn("********************************************************************************");
  console.warn("WARNING: Using a fallback AUTH_HASH_KEY. Please set a strong secret in your env.");
  console.warn("********************************************************************************");
}
const OAUTH_PROVIDERS = ["google", "apple", "github", "microsoft"];
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "admin@zenin.app").trim().toLowerCase();
const ADMIN_MIGRATION_KEY = String(process.env.ADMIN_MIGRATION_KEY || "").trim();
const ALLOW_DEV_AUTH_DEBUG =
  process.env.NODE_ENV !== "production" &&
  String(process.env.ENABLE_DEV_AUTH_DEBUG || "").trim().toLowerCase() === "true";
const ALLOW_OAUTH_MOCK =
  process.env.NODE_ENV !== "production" &&
  String(process.env.ENABLE_OAUTH_MOCK || "").trim().toLowerCase() === "true";

function hashToken(token) {
  return crypto.createHmac("sha256", AUTH_HASH_KEY).update(String(token || "")).digest("hex");
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
  return {
    id: Number(user.id),
    email: String(user.email || "").toLowerCase(),
    displayName: user.displayName || null,
    authProvider: user.authProvider || "email",
    emailVerified: Boolean(user.emailVerified),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    twoFactorMethod: user.twoFactorMethod || null,
    passkeys: Array.isArray(user.passkeys) ? user.passkeys : [],
    currentPlan: String(user.currentPlan || "starter").trim().toLowerCase() || "starter",
    currentBillingCycle: String(user.currentBillingCycle || "monthly").trim().toLowerCase() || "monthly",
    planUpdatedAt: user.planUpdatedAt || null,
    createdAt: user.createdAt || null
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

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

function resolveClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || null;
}

async function resolveAuthContext(req) {
  const token = getBearerToken(req);
  if (!token) {
    // For now, allow access without sign-up by defaulting to the Guest User (ID 1)
    return {
      isGuest: false,
      userId: 1,
      user: {
        id: 1,
        email: "guest@zenin.app",
        displayName: "Guest User",
        authProvider: "guest",
        emailVerified: true,
        currentPlan: "desk", // Upgraded to Desk for full app access (Options/Predictions)
        currentBillingCycle: "monthly"
      },
      token: null
    };
  }
  const tokenHash = hashToken(token);
  const session = await userAuth.findSessionByTokenHash(tokenHash);
  if (!session) {
    // If a token was provided but is invalid, still fall back to Guest instead of blocking
    return {
      isGuest: false,
      userId: 1,
      user: {
        id: 1,
        email: "guest@zenin.app",
        displayName: "Guest User",
        authProvider: "guest",
        emailVerified: true,
        currentPlan: "desk",
        currentBillingCycle: "monthly"
      },
      token: null
    };
  }
  const GUEST_CONTEXT = {
    isGuest: false,
    userId: 1,
    user: {
      id: 1,
      email: "guest@zenin.app",
      displayName: "Guest User",
      authProvider: "guest",
      emailVerified: true,
      currentPlan: "desk",
      currentBillingCycle: "monthly"
    },
    token: null
  };

  if (session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return GUEST_CONTEXT;
  }

  return {
    isGuest: false,
    userId: Number(session.userId),
    user: sanitizeAuthUser(session),
    token
  };
}

app.use(async (req, _res, next) => {
  try {
    req.auth = await resolveAuthContext(req);
    next();
  } catch (error) {
    next(error);
  }
});

function requireSignedIn(req, res, next) {
  if (!req.auth || req.auth.isGuest) {
    return res.status(401).json({ error: "Authentication required" });
  }
  return next();
}

function isSignedInAdmin(req) {
  const email = String(req?.auth?.user?.email || "").trim().toLowerCase();
  return Boolean(email) && email === ADMIN_EMAIL;
}

function hasValidMigrationKey(req) {
  if (!ADMIN_MIGRATION_KEY) return false;
  const provided = String(req.headers["x-migration-key"] || "").trim();
  return provided && provided === ADMIN_MIGRATION_KEY;
}




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
  const metrics = sanitizeMacroMetrics(await fetchWorldBankMacroMetrics(country));
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
      source: "World Bank"
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

app.get("/api/db/balance", requireSignedIn, async (req, res) => {
  try {
    const current = await userWorkspace.balance.get(req.auth.userId);
    res.json({ balance: current });
  } catch (err) {
    handleServerError(res, "Balance read failed", err);
  }
});

app.post("/api/db/balance", requireSignedIn, writeLimiter, async (req, res) => {
  try {
    const { amount, type } = req.body;
    if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) return res.status(400).json({ error: "Invalid amount" });
    const newBalance = await userWorkspace.balance.applyChange(req.auth.userId, amount, type);
    res.json({ balance: newBalance });
  } catch (err) {
    if (err.code === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    handleServerError(res, "Balance update failed", err);
  }
});

app.get("/api/db/cash", requireSignedIn, async (req, res) => {
  try {
    const balances = await userWorkspace.cash.getAll(req.auth.userId);
    if (!balances.some((row) => row.currency === "USD")) {
      const usdBalance = await userWorkspace.balance.get(req.auth.userId);
      return res.json({
        balances: [
          { currency: "USD", balance: usdBalance, updatedAt: new Date().toISOString() },
          ...balances
        ]
      });
    }
    res.json({ balances });
  } catch (err) {
    handleServerError(res, "Cash balance read failed", err);
  }
});

app.post("/api/db/cash", requireSignedIn, writeLimiter, async (req, res) => {
  try {
    const { amount, type, currency = "USD" } = req.body || {};
    if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) return res.status(400).json({ error: "Invalid amount" });
    const balanceAfter = await userWorkspace.cash.applyChange(req.auth.userId, currency, amount, type);
    res.json({ currency: String(currency || "USD").toUpperCase(), balance: balanceAfter });
  } catch (err) {
    if (err.code === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({ error: err.message || "Insufficient balance" });
    }
    handleServerError(res, "Cash balance update failed", err);
  }
});

async function issueSessionForUser(userId, req) {
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
  return { token: rawToken, expiresAt };
}

app.get("/api/auth/me", async (req, res) => {
  if (!req.auth || req.auth.isGuest) {
    return res.json({ authenticated: false, user: null });
  }
  const user = await userAuth.findUserById(req.auth.userId);
  return res.json({ authenticated: true, user: sanitizeAuthUser(user) });
});

app.post("/api/admin/migrations/admin-workspace", async (req, res) => {
  try {
    if (!isSignedInAdmin(req) && !hasValidMigrationKey(req)) {
      return res.status(403).json({ error: "Admin privileges or valid migration key required." });
    }
    const force = Boolean(req.body?.force) || String(req.query?.force || "").toLowerCase() === "true";
    const result = await runAdminWorkspaceMigration({ force });
    return res.json({ success: true, migration: result });
  } catch (error) {
    return handleServerError(res, "Admin workspace migration failed", error);
  }
});

app.post("/api/account/plan", requireSignedIn, async (req, res) => {
  try {
    const plan = normalizePlanInput(req.body?.plan);
    const billingCycle = normalizeBillingCycleInput(req.body?.billingCycle || "monthly");
    if (!plan) {
      return res.status(400).json({ error: "Plan must be one of: starter, pro, desk." });
    }
    if (!billingCycle) {
      return res.status(400).json({ error: "Billing cycle must be one of: monthly, yearly." });
    }
    const updatedUser = await userAuth.updateCurrentPlan(req.auth.userId, plan, billingCycle);
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.json({ success: true, user: sanitizeAuthUser(updatedUser) });
  } catch (error) {
    return handleServerError(res, "Account plan update failed", error);
  }
});

app.post("/api/auth/signup", authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const displayName = String(req.body?.displayName || "").trim() || null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email." });
    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: "Password must be 10+ chars with letters, numbers, and symbols." });
    }
    const existing = await userAuth.findUserByEmail(email);
    if (existing) return res.status(409).json({ error: "An account with this email already exists." });

    const { hash } = derivePasswordHash(password);
    const created = await userAuth.createUser({
      email,
      passwordHash: hash,
      displayName,
      authProvider: "email",
      emailVerified: false
    });
    const session = await issueSessionForUser(created.id, req);
    return res.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeAuthUser(created)
    });
  } catch (error) {
    return handleServerError(res, "Signup failed", error);
  }
});

app.post("/api/auth/signin", authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const user = await userAuth.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // MFA verification is intentionally disabled until full WebAuthn/TOTP flows are implemented.
    // This avoids accepting insecure passkey-id/OTP-only shortcuts.

    const session = await issueSessionForUser(user.id, req);
    return res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeAuthUser(user)
    });
  } catch (error) {
    return handleServerError(res, "Signin failed", error);
  }
});

app.post("/api/auth/signout", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (token) {
      await userAuth.revokeSessionByTokenHash(hashToken(token));
    }
    return res.json({ success: true });
  } catch (error) {
    return handleServerError(res, "Signout failed", error);
  }
});

app.post("/api/auth/forgot-password/request", authLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required." });

    const user = await userAuth.findUserByEmail(email);
    let devResetToken = null;
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
      await sendPasswordResetEmail(email, rawToken);
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

app.post("/api/auth/forgot-password/confirm", authLimiter, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");
    if (!token) return res.status(400).json({ error: "Reset token is required." });
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: "Password must be 10+ chars with letters, numbers, and symbols." });
    }
    const consumed = await userAuth.consumePasswordResetToken(hashToken(token));
    if (!consumed) return res.status(400).json({ error: "Reset token is invalid or expired." });

    const { hash } = derivePasswordHash(newPassword);
    await userAuth.updatePassword(consumed.userId, hash);
    await userAuth.revokeSessionsByUserId(consumed.userId);
    const session = await issueSessionForUser(consumed.userId, req);
    const user = await userAuth.findUserById(consumed.userId);
    return res.json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: sanitizeAuthUser(user)
    });
  } catch (error) {
    return handleServerError(res, "Forgot password confirm failed", error);
  }
});

app.post("/api/auth/2fa/enable", authLimiter, requireSignedIn, async (req, res) => {
  try {
    return res.status(501).json({
      error: "2FA enable is temporarily disabled until secure WebAuthn/TOTP verification is implemented."
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
      secretHash: null
    });
    const user = await userAuth.findUserById(req.auth.userId);
    return res.json({ success: true, user: sanitizeAuthUser(user) });
  } catch (error) {
    return handleServerError(res, "Disable 2FA failed", error);
  }
});

app.post("/api/auth/passkeys/register", authLimiter, requireSignedIn, async (req, res) => {
  try {
    return res.status(501).json({
      error: "Passkey registration requires full WebAuthn support and is currently disabled."
    });
  } catch (error) {
    return handleServerError(res, "Passkey registration failed", error);
  }
});

app.get("/api/auth/oauth/providers", (_req, res) => {
  return res.json({ providers: OAUTH_PROVIDERS });
});

app.post("/api/auth/oauth/start", authLimiter, async (req, res) => {
  const provider = String(req.body?.provider || "").trim().toLowerCase();
  if (!OAUTH_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: "Unsupported provider." });
  }
  const redirectUri = String(req.body?.redirectUri || "").trim() || null;
  return res.json({
    provider,
    redirectUri,
    configured: false,
    authorizationUrl: null,
    message: `${provider} OAuth is scaffolded but not configured.`
  });
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
    const session = await issueSessionForUser(created.id, req);
    return res.status(201).json({
      token: session.token,
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

app.get("/api/history", async (req, res) => {
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

  try {
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

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      res.json(payload);
      resolve();
    };

    const scriptPath = path.join(__dirname, "scripts", "fetch_finviz.py");
    const child = spawn(pythonBinary, [scriptPath, safeSymbol], { cwd: __dirname });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", async (code) => {
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
        const payload = {
          ...(result || {}),
          symbol: requestedSymbol,
          resolvedSymbol: safeSymbol,
          updatedAt: new Date().toISOString(),
          stale: false
        };
        await writeServiceSnapshot("finviz", snapshotParams, payload);
        finish(payload);
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
      console.error("Failed to start Finviz process:", err);
      if (cached?.payload) {
        return finish(applyStaleMeta(cached.payload, cached, "finviz_process_start_failed"));
      }
      finish({ symbol: requestedSymbol, resolvedSymbol: safeSymbol, error: "process_start_failed" });
    });

    setTimeout(() => {
      child.kill();
      if (cached?.payload) {
        return finish(applyStaleMeta(cached.payload, cached, "finviz_fetch_timed_out"));
      }
      finish({ symbol: requestedSymbol, resolvedSymbol: safeSymbol, error: "timed_out" });
    }, 12000);
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
  });
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
    } catch {
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
      const wbMetrics = await fetchWorldBankMacroMetrics(country);
      const metrics = sanitizeMacroMetrics(wbMetrics);
      const missingKeys = metrics
        .filter((m) => m.current == null && m.previous == null && m.expectation == null)
        .map((m) => m.key);
      if (missingKeys.length === metrics.length) {
        throw new Error("world_bank_no_usable_values_for_country");
      }

      const payload = {
        country,
        countryName,
        source: "World Bank (country-level series)",
        updatedAt: new Date().toISOString(),
        metrics,
        diagnostics: {
          countryCode: country,
          provider: "world_bank",
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

    const priceRows = payload?.prices && typeof payload.prices === "object" ? Object.values(payload.prices) : [];
    const hasAnyFinitePrice = priceRows.some((row) => Number.isFinite(Number(row?.price)));
    if (!hasAnyFinitePrice) {
      throw new Error("prices_empty_from_provider");
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
      } catch {
        return { key: config.key, rows: [] };
      }
    })
  );
  const byKey = new Map(entries.map((entry) => [entry.key, entry.rows]));
  return MACRO_INDICATOR_CONFIG.map((config) => buildMacroMetric(byKey.get(config.key) || [], config));
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

app.post("/api/db/options-calculations", requireSignedIn, writeLimiter, validateOptionsCalculation, async (req, res) => {
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
app.get("/api/db/portfolio", requireSignedIn, async (req, res) => {
  try {
    const holdings = await userWorkspace.portfolio.getAll(req.auth.userId);
    res.json({ holdings });
  } catch (error) {
    handleServerError(res, "Portfolio read failed", error);
  }
});

app.post("/api/db/portfolio", requireSignedIn, writeLimiter, validatePortfolioHolding, async (req, res) => {
  try {
    const holding = req.body;
    const result = await userWorkspace.portfolio.add(req.auth.userId, holding);
    res.status(201).json(result);
  } catch (error) {
    handleServerError(res, "Portfolio write failed", error);
  }
});

app.put("/api/db/portfolio/:id", requireSignedIn, writeLimiter, validatePortfolioUpdate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: "Invalid id" });
    const holding = req.body;
    const result = await userWorkspace.portfolio.update(req.auth.userId, id, holding);
    res.json(result);
  } catch (error) {
    handleServerError(res, "Portfolio update failed", error);
  }
});

app.delete("/api/db/portfolio/:id", requireSignedIn, writeLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await userWorkspace.portfolio.delete(req.auth.userId, id);
    res.json(result);
  } catch (error) {
    handleServerError(res, "Portfolio delete failed", error);
  }
});

// Get portfolio items by symbol and marketType
app.get("/api/db/portfolio/symbol/:symbol", requireSignedIn, async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_\s]/g, "").slice(0, 50).toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const marketType = String(req.query.marketType || "").trim().toLowerCase();
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const holdings = await userWorkspace.portfolio.findBySymbol(req.auth.userId, symbol, marketType);
    res.json({ holdings });
  } catch (error) {
    handleServerError(res, "Portfolio symbol lookup failed", error);
  }
});

// ---------------------------------------------------------------------------
// Trade execution endpoints (Journal persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/trades", requireSignedIn, async (req, res) => {
  try {
    const trades = await userWorkspace.trades.getAll(req.auth.userId, req.query.limit);
    res.json({ trades });
  } catch (error) {
    handleServerError(res, "Trades read failed", error);
  }
});

app.post("/api/db/trades", requireSignedIn, writeLimiter, async (req, res) => {
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
    const saved = await userWorkspace.trades.add(req.auth.userId, payload);
    res.status(201).json(saved);
  } catch (error) {
    handleServerError(res, "Trade write failed", error);
  }
});

// ---------------------------------------------------------------------------
// Watchlist Endpoints (Database Persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/watchlist", requireSignedIn, async (req, res) => {
  try {
    const assets = await userWorkspace.watchlist.getAll(req.auth.userId);
    res.json({ assets });
  } catch (error) {
    handleServerError(res, "Watchlist read failed", error);
  }
});

app.post("/api/db/watchlist", requireSignedIn, writeLimiter, validateWatchlistAsset, async (req, res) => {
  try {
    const asset = req.body;
    const result = await userWorkspace.watchlist.add(req.auth.userId, asset);
    res.status(201).json(result);
  } catch (error) {
    handleServerError(res, "Watchlist write failed", error);
  }
});

app.post("/api/db/watchlist/bulk", requireSignedIn, writeLimiter, async (req, res) => {
  try {
    const rawAssets = Array.isArray(req.body?.assets) ? req.body.assets : [];
    if (!rawAssets.length) {
      return res.status(400).json({ error: "assets array required" });
    }
    if (rawAssets.length > 1000) {
      return res.status(400).json({ error: "Too many assets" });
    }

    const sanitizedAssets = [];
    for (const rawAsset of rawAssets) {
      const { asset, error } = sanitizeWatchlistAssetInput(rawAsset);
      if (error) {
        return res.status(400).json({ error });
      }
      sanitizedAssets.push(asset);
    }

    const savedAssets = [];
    for (const asset of sanitizedAssets) {
      savedAssets.push(await userWorkspace.watchlist.add(req.auth.userId, asset));
    }

    res.status(201).json({ assets: savedAssets });
  } catch (error) {
    handleServerError(res, "Watchlist bulk write failed", error);
  }
});

app.delete("/api/db/watchlist/:symbol", requireSignedIn, writeLimiter, async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_\s]/g, "").slice(0, 50);
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const { marketType, category = null, theme = null } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const result = await userWorkspace.watchlist.delete(req.auth.userId, symbol, marketType, category, theme);
    res.json(result);
  } catch (error) {
    handleServerError(res, "Watchlist delete failed", error);
  }
});

// Check if asset is in watchlist
app.get("/api/db/watchlist/check/:symbol", requireSignedIn, async (req, res) => {
  try {
    const { symbol } = req.params;
    const { marketType, category = null, theme = null } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const exists = await userWorkspace.watchlist.exists(req.auth.userId, symbol, marketType, category, theme);
    res.json({ exists });
  } catch (error) {
    handleServerError(res, "Watchlist exists check failed", error);
  }
});

app.get('/api/analytics/crypto', async (req, res) => {
  try {
    const fetch = await resolveFetch();
    const assets = ["BTC", "ETH", "SOL", "HYPE", "BNB"];

    const [bybitRes, binanceFundingRes, binanceMarkRes, hlRes, ...binanceOIPromises] = await Promise.allSettled([
      fetch("https://api.bybit.com/v5/market/tickers?category=linear").then(r => r.json()),
      fetch("https://fapi.binance.com/fapi/v1/premiumIndex").then(r => r.json()),
      fetch("https://fapi.binance.com/fapi/v1/ticker/price").then(r => r.json()),
      postHyperliquidInfo({ type: "metaAndAssetCtxs" }),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT`).then(r => r.json()).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=ETHUSDT`).then(r => r.json()).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=SOLUSDT`).then(r => r.json()).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=BNBUSDT`).then(r => r.json()).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=HYPEUSDT`).then(r => r.json()).catch(() => null),
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
          const markPx = firstFiniteNumber(ctxs[idx]?.markPx, ctxs[idx]?.midPx, 0) || 0;
          const oiCoins = firstFiniteNumber(ctxs[idx]?.openInterest, ctxs[idx]?.open_interest, 0) || 0;
          const funding = firstFiniteNumber(
            ctxs[idx]?.funding,
            ctxs[idx]?.fundingRate,
            ctxs[idx]?.funding_rate,
            ctxs[idx]?.funding8h,
            ctxs[idx]?.funding_8h,
            0
          ) || 0;
          perpMetrics.push({
            symbol,
            openInterestUsd: oiCoins * markPx,
            fundingRate: funding,
            exchange: "Hyperliquid"
          });
        }
      });
    }

    // Bybit parsing
    if (bybitRes.status === "fulfilled" && bybitRes.value?.result?.list) {
      const list = bybitRes.value.result.list;
      list.forEach(item => {
        const symbol = String(item?.symbol || "").replace(/USDT$/, "").replace(/USDC$/, "");
        if (assets.includes(symbol)) {
          const lastPx = firstFiniteNumber(item?.lastPrice, item?.markPrice, item?.indexPrice, 0) || 0;
          const oiUsd = firstFiniteNumber(
            item?.openInterestValue,
            item?.open_interest_value,
            item?.openInterestUsd,
            item?.open_interest_usd,
            (firstFiniteNumber(item?.openInterest, item?.open_interest, 0) || 0) * lastPx,
            0
          ) || 0;
          const funding = firstFiniteNumber(
            item?.fundingRate,
            item?.funding_rate,
            item?.nextFundingRate,
            item?.next_funding_rate,
            0
          ) || 0;
          perpMetrics.push({
            symbol,
            openInterestUsd: oiUsd || (firstFiniteNumber(item?.openInterest, 0) * lastPx),
            fundingRate: funding,
            exchange: "Bybit"
          });
        }
      });
    }

    // Binance parsing
    if (binanceFundingRes.status === "fulfilled" && Array.isArray(binanceFundingRes.value)) {
      const markRows = binanceMarkRes.status === "fulfilled" && Array.isArray(binanceMarkRes.value)
        ? binanceMarkRes.value
        : [];
      const ois = [
        binanceOIPromises[0]?.value, // BTC
        binanceOIPromises[1]?.value, // ETH
        binanceOIPromises[2]?.value, // SOL
        binanceOIPromises[3]?.value, // BNB
        binanceOIPromises[4]?.value  // HYPE
      ];

      const symbolsToMap = ["BTC", "ETH", "SOL", "BNB", "HYPE"];
      symbolsToMap.forEach((sym, i) => {
        const fundingItem = binanceFundingRes.value.find(f => f.symbol === `${sym}USDT`);
        const markItem = markRows.find(f => f.symbol === `${sym}USDT`);
        const oiItem = ois[i];
        if (fundingItem || oiItem) {
          const markPx = firstFiniteNumber(fundingItem?.markPrice, markItem?.price, oiItem?.price, 0) || 0;
          const oiCoins = firstFiniteNumber(oiItem?.openInterest, oiItem?.open_interest, 0) || 0;
          perpMetrics.push({
            symbol: sym,
            openInterestUsd: oiCoins * markPx,
            fundingRate: firstFiniteNumber(
              fundingItem?.lastFundingRate,
              fundingItem?.fundingRate,
              fundingItem?.last_funding_rate,
              0
            ) || 0,
            exchange: "Binance"
          });
        }
      });
    }

    // Sort by symbol, then exchange
    perpMetrics.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.exchange.localeCompare(b.exchange));

    // Attempt live Dune fetches for specialized metrics
    // REPLACE these placeholders with your actual Dune Query IDs
    const DUNE_QUERY_IDS = {
      MARKET_SHARE: "3834927", // Example ID for Market Share
      OVERVIEW: "3834930",     // Example ID for Perps Overview
      ETF_INFLOWS: "3834935"   // Example ID for ETF Flows
    };

    const [duneMarketShareRows, duneOverviewRows, duneEtfFlowsRows] = await Promise.all([
      fetchDuneLatestResults(DUNE_QUERY_IDS.MARKET_SHARE),
      fetchDuneLatestResults(DUNE_QUERY_IDS.OVERVIEW),
      fetchDuneLatestResults(DUNE_QUERY_IDS.ETF_INFLOWS)
    ]);

    // Map Dune data to our visual formats, falling back to static mocks if API fails
    const perpsMarketShare = duneMarketShareRows ? duneMarketShareRows.map(row => ({
      protocol: row.protocol || "Unknown",
      sharePct: Number(row.share_pct || row.sharePct || 0),
      color: row.color || "#64748b"
    })) : [
      { protocol: "Hyperliquid", sharePct: 53.3, color: "#00ff9d" },
      { protocol: "Aster", sharePct: 14.1, color: "#3d96ff" },
      { protocol: "edgeX", sharePct: 6.8, color: "#ff3d6b" },
      { protocol: "Lighter", sharePct: 5.1, color: "#ffcc00" },
      { protocol: "Variational", sharePct: 4.4, color: "#a855f7" },
      { protocol: "Others", sharePct: 16.3, color: "#64748b" }
    ];

    const perpsOverview = duneOverviewRows ? duneOverviewRows.map(row => ({
      protocol: row.protocol || "Unknown",
      volume24h: Number(row.volume24h || row.volume_24h || 0),
      openInterest: Number(row.open_interest || row.openInterest || 0)
    })) : [
      { protocol: "Hyperliquid", volume24h: 3460000000, openInterest: 7407000000 },
      { protocol: "ApeX", volume24h: 986740000, openInterest: 125800000 },
      { protocol: "dYdX", volume24h: 813500000, openInterest: 0 },
      { protocol: "Aster", volume24h: 786100000, openInterest: 1956000000 },
      { protocol: "Variational", volume24h: 436460000, openInterest: 612210000 },
      { protocol: "StandX", volume24h: 430760000, openInterest: 134230000 }
    ];

    const etfInflows = duneEtfFlowsRows ? duneEtfFlowsRows.map(row => ({
      id: row.id || `etf-${row.ticker}-${row.date}`,
      date: row.date || new Date().toISOString().split("T")[0],
      manager: row.manager || row.fund_manager || "Fidelity",
      ticker: row.ticker || "FBTC",
      asset: row.asset || "BTC",
      netUsd: Number(row.net_usd || row.amount || 0),
      period: row.period || "daily"
    })) : [
      { id: "farside-1", date: "2024-03-27", manager: "BlackRock", ticker: "IBIT", asset: "BTC", netUsd: 323800000, period: "daily" },
      { id: "farside-2", date: "2024-03-27", manager: "Fidelity", ticker: "FBTC", asset: "BTC", netUsd: 279500000, period: "daily" },
      { id: "farside-3", date: "2024-03-27", manager: "Ark 21Shares", ticker: "ARKB", asset: "BTC", netUsd: 200700000, period: "daily" },
      { id: "farside-4", date: "2024-03-27", manager: "Bitwise", ticker: "BITB", asset: "BTC", netUsd: 67200000, period: "daily" },
      { id: "farside-5", date: "2024-03-27", manager: "Grayscale", ticker: "GBTC", asset: "BTC", netUsd: -299800000, period: "daily" }
    ];

    res.json({
      updatedAt: new Date().toISOString(),
      perpMetrics,
      kimchiPremium: { valuePct: 1.2, market: "KRW vs USD" },
      etfInflows,
      perpsMarketShare,
      perpsOverview,
      perpVolumeByProtocol: [
        { protocol: "Hyperliquid", volumeUsd: 1400000000 },
        { protocol: "Jupiter", volumeUsd: 1100000000 },
        { protocol: "dYdX", volumeUsd: 850000000 },
        { protocol: "GMX", volumeUsd: 420000000 },
        { protocol: "Synthetix", volumeUsd: 310000000 },
        { protocol: "ApeX", volumeUsd: 980000000 },
        { protocol: "Aster", volumeUsd: 780000000 }
      ],
      revenueByProtocol: [
        { protocol: "Hyperliquid", revenueUsd: 250000 },
        { protocol: "Jupiter", revenueUsd: 200000 },
        { protocol: "dYdX", revenueUsd: 150000 },
        { protocol: "GMX", revenueUsd: 180000 },
        { protocol: "Synthetix", revenueUsd: 95000 },
        { protocol: "ApeX", revenueUsd: 120000 }
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

const COMMODITY_UNIVERSE = [
  // Energy
  { symbol: "CL", name: "WTI Crude Oil", group: "energy", region: "global", latestPrice: 82.1, dailyChangePct: -0.55, ytdChangePct: 6.8, oneYearReturnPct: 11.2 },
  { symbol: "NG", name: "Natural Gas", group: "energy", region: "usa", latestPrice: 2.34, dailyChangePct: 1.1, ytdChangePct: -3.2, oneYearReturnPct: -8.6 },
  { symbol: "RB", name: "RBOB Gasoline", group: "energy", region: "usa", latestPrice: 2.61, dailyChangePct: 0.4, ytdChangePct: 3.7, oneYearReturnPct: 6.2 },

  // Metals (Precious)
  { symbol: "GC", name: "Gold", group: "metals", region: "global", latestPrice: 2378.2, dailyChangePct: 0.41, ytdChangePct: 12.9, oneYearReturnPct: 19.4 },
  { symbol: "SI", name: "Silver", group: "metals", region: "global", latestPrice: 29.4, dailyChangePct: 0.78, ytdChangePct: 10.2, oneYearReturnPct: 14.1 },

  // Industrial Metals
  { symbol: "HG", name: "Copper", group: "industrial", region: "global", latestPrice: 4.48, dailyChangePct: -0.2, ytdChangePct: 7.1, oneYearReturnPct: 9.9 },
  { symbol: "ALI=F", name: "Aluminum", group: "industrial", region: "global", latestPrice: 2540.0, dailyChangePct: 0.15, ytdChangePct: 4.2, oneYearReturnPct: 8.5 },
  { symbol: "ZNC=F", name: "Zinc", group: "industrial", region: "global", latestPrice: 2840.0, dailyChangePct: -0.42, ytdChangePct: 2.1, oneYearReturnPct: 5.4 },
  { symbol: "LED=F", name: "Lead", group: "industrial", region: "global", latestPrice: 2150.0, dailyChangePct: 0.1, ytdChangePct: -1.2, oneYearReturnPct: 2.3 },
  { symbol: "TIN=F", name: "Tin", group: "industrial", region: "global", latestPrice: 32400.0, dailyChangePct: 1.2, ytdChangePct: 15.4, oneYearReturnPct: 22.1 },
  { symbol: "TIO=F", name: "Iron Ore", group: "industrial", region: "global", latestPrice: 112.5, dailyChangePct: -0.8, ytdChangePct: -8.4, oneYearReturnPct: -4.2 },

  // Battery Metals
  { symbol: "LIT", name: "Lithium (ETF)", group: "battery", region: "global", latestPrice: 45.2, dailyChangePct: -1.4, ytdChangePct: -18.2, oneYearReturnPct: -24.5 },
  { symbol: "NI=F", name: "Nickel", group: "battery", region: "global", latestPrice: 18450.0, dailyChangePct: 0.35, ytdChangePct: 5.1, oneYearReturnPct: 7.8 },
  { symbol: "REMX", name: "Rare Earths (ETF)", group: "battery", region: "global", latestPrice: 52.8, dailyChangePct: -0.6, ytdChangePct: -12.4, oneYearReturnPct: -15.8 },

  // Agriculture
  { symbol: "ZC", name: "Corn", group: "agriculture", region: "global", latestPrice: 4.85, dailyChangePct: -0.63, ytdChangePct: 1.9, oneYearReturnPct: -2.4 },
  { symbol: "ZW", name: "Wheat", group: "agriculture", region: "global", latestPrice: 5.78, dailyChangePct: 0.33, ytdChangePct: 2.4, oneYearReturnPct: 1.1 },
  { symbol: "ZS", name: "Soybeans", group: "agriculture", region: "global", latestPrice: 11.93, dailyChangePct: 0.12, ytdChangePct: 3.2, oneYearReturnPct: 4.8 },
  { symbol: "ZO=F", name: "Oats", group: "agriculture", region: "global", latestPrice: 3.45, dailyChangePct: 0.25, ytdChangePct: 1.8, oneYearReturnPct: 3.2 },
  { symbol: "ZR=F", name: "Rice", group: "agriculture", region: "global", latestPrice: 18.42, dailyChangePct: -0.15, ytdChangePct: 5.4, oneYearReturnPct: 9.1 },
  { symbol: "ZL=F", name: "Soybean Oil", group: "agriculture", region: "global", latestPrice: 0.45, dailyChangePct: 0.1, ytdChangePct: -2.1, oneYearReturnPct: -4.5 },
  { symbol: "ZM=F", name: "Soybean Meal", group: "agriculture", region: "global", latestPrice: 342.0, dailyChangePct: 0.45, ytdChangePct: 2.8, oneYearReturnPct: 5.2 },

  // Soft Commodities
  { symbol: "KC", name: "Coffee", group: "soft", region: "global", latestPrice: 224.5, dailyChangePct: 1.2, ytdChangePct: 18.4, oneYearReturnPct: 24.2 },
  { symbol: "CC", name: "Cocoa", group: "soft", region: "global", latestPrice: 9450.0, dailyChangePct: -2.4, ytdChangePct: 142.1, oneYearReturnPct: 215.0 },
  { symbol: "SB", name: "Sugar", group: "soft", region: "global", latestPrice: 19.42, dailyChangePct: 0.35, ytdChangePct: -4.2, oneYearReturnPct: -2.1 },
  { symbol: "CT", name: "Cotton", group: "soft", region: "global", latestPrice: 82.4, dailyChangePct: -0.1, ytdChangePct: -2.8, oneYearReturnPct: -5.4 },
  { symbol: "OJ=F", name: "Orange Juice", group: "soft", region: "global", latestPrice: 382.0, dailyChangePct: 1.8, ytdChangePct: 24.5, oneYearReturnPct: 42.1 },
  { symbol: "LBR=F", name: "Lumber", group: "soft", region: "global", latestPrice: 540.0, dailyChangePct: -0.8, ytdChangePct: -4.2, oneYearReturnPct: -1.8 },

  // Livestock
  { symbol: "LE=F", name: "Live Cattle", group: "livestock", region: "global", latestPrice: 182.4, dailyChangePct: 0.25, ytdChangePct: 8.4, oneYearReturnPct: 12.1 },
  { symbol: "GF=F", name: "Feeder Cattle", group: "livestock", region: "global", latestPrice: 248.0, dailyChangePct: 0.42, ytdChangePct: 9.1, oneYearReturnPct: 14.5 },
  { symbol: "HE=F", name: "Lean Hogs", group: "livestock", region: "global", latestPrice: 92.4, dailyChangePct: -0.15, ytdChangePct: 12.4, oneYearReturnPct: 18.2 },
  { symbol: "DC=F", name: "Milk", group: "livestock", region: "global", latestPrice: 18.42, dailyChangePct: 0.1, ytdChangePct: -2.4, oneYearReturnPct: -4.8 },

  // Fertilizers
  { symbol: "UAN", name: "Urea Ammonium Nitrate", group: "fertilizers", region: "global", latestPrice: 318.0, dailyChangePct: 0.28, ytdChangePct: 4.1, oneYearReturnPct: 8.0 },
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
  calendar: {
    sourceType: "Economic calendar API",
    why: "Release timing, actual vs forecast",
  },
  alerts: {
    sourceType: "Your own rule engine",
    why: "Flexible user-defined triggers",
  },
};

function getCommodity(symbol) {
  const key = String(symbol || "").toUpperCase();
  return COMMODITY_UNIVERSE.find((row) => row.symbol === key) || COMMODITY_UNIVERSE[0];
}

async function fetchLiveCommodityRows(group = "all") {
  const livePrices = await fetchYFinancePrices(COMMODITY_UNIVERSE.map((row) => row.symbol));
  return COMMODITY_UNIVERSE
    .map((row) => {
      const quote = livePrices[row.symbol] || {};
      const latestPrice = Number(quote.price);
      const dailyChangePct = Number(quote.priceChangePercent);
      return {
        ...row,
        latestPrice: Number.isFinite(latestPrice) ? latestPrice : null,
        dailyChangePct: Number.isFinite(dailyChangePct) ? dailyChangePct : null,
        ytdChangePct: null,
        oneYearReturnPct: null,
        currency: quote.currency || "USD",
        source: "Yahoo Finance",
        stale: !Number.isFinite(latestPrice)
      };
    })
    .filter((row) => group === "all" || row.group === group);
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
    res.json({
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance",
      overview: {
        categoryCounts: byGroup,
        topMovers,
        favorites: topMovers.slice(0, 3).map((row) => row.symbol),
        recentViews: [],
        dataSources: COMMODITY_SOURCE_MAP,
      },
    });
  } catch (error) {
    res.json({
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodities_overview_fetch_failed",
      overview: { categoryCounts: {}, topMovers: [], favorites: [], recentViews: [], dataSources: COMMODITY_SOURCE_MAP }
    });
  }
});

app.get("/api/commodities/search", async (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return res.json({ items: [] });
  const items = COMMODITY_UNIVERSE.filter((row) =>
    `${row.symbol} ${row.name} ${row.group} ${row.region}`.toLowerCase().includes(q)
  ).slice(0, 12);
  res.json({ items, updatedAt: new Date().toISOString() });
});

app.get("/api/commodities/list", async (req, res) => {
  try {
    const group = String(req.query.group || "all").toLowerCase();
    const items = await fetchLiveCommodityRows(group);
    console.log(`[Commodities] Fetched ${items.length} items for group: ${group}`);
    res.json({ updatedAt: new Date().toISOString(), source: "Yahoo Finance", items, list: items });
  } catch (error) {
    console.error("[Commodities] Error fetching list:", error);
    res.json({
      updatedAt: new Date().toISOString(),
      source: "Yahoo Finance",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodities_list_fetch_failed",
      items: [],
      list: []
    });
  }
});

app.get("/api/commodities/:symbol/price", async (req, res) => {
  const range = String(req.query.range || "1Y").toUpperCase();
  const item = getCommodity(req.params.symbol);
  try {
    const stockHistory = await fetchHistoryFromYahoo(item.symbol, range);
    const series = historyRowsToSeries(stockHistory.history);
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: stockHistory.source || "yahoo", series });
  } catch (error) {
    res.json({
      updatedAt: new Date().toISOString(),
      symbol: item.symbol,
      source: "Yahoo Finance",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodity_price_fetch_failed",
      series: []
    });
  }
});

app.get("/api/commodities/:symbol/fundamentals", async (req, res) => {
  const item = getCommodity(req.params.symbol);
  try {
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
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", metrics, items: metrics });
  } catch (error) {
    res.json({
      updatedAt: new Date().toISOString(),
      symbol: item.symbol,
      source: "Yahoo Finance",
      stale: true,
      unavailable: true,
      stale_reason: error?.message || "commodity_fundamentals_fetch_failed",
      metrics: [],
      items: []
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
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, mode, source: "Yahoo Finance", items, flows: items });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, mode, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_flows_fetch_failed", items: [], flows: [] });
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
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", items, seasonality: items });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_seasonality_fetch_failed", items: [], seasonality: [] });
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
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", points, curve: points });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), symbol: item.symbol, source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_curve_fetch_failed", points: [], curve: [] });
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
    res.json({ updatedAt: new Date().toISOString(), source: "Yahoo Finance", rows, compare: rows });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_compare_fetch_failed", rows: [], compare: [] });
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
    res.json({ updatedAt: new Date().toISOString(), source: "ForexFactory", events, calendar: events });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "ForexFactory", stale: true, unavailable: true, stale_reason: error?.message || "commodity_calendar_fetch_failed", events: [], calendar: [] });
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
    res.json({ updatedAt: new Date().toISOString(), source: "Yahoo Finance", rows, correlation: rows });
  } catch (error) {
    res.json({ updatedAt: new Date().toISOString(), source: "Yahoo Finance", stale: true, unavailable: true, stale_reason: error?.message || "commodity_correlation_fetch_failed", rows: [], correlation: [] });
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
  res.json(rows);
});

app.get("/api/equities/mmf/:id", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  const detail = AFRICA_MMF_DETAIL[id] || null;
  if (!detail) return res.status(404).json({ error: "MMF not found" });
  res.json(detail);
});

app.get("/api/equities/mmf/:id/yield-history", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  const base = AFRICA_MMF_DETAIL[id];
  if (!base) return res.status(404).json({ error: "MMF not found" });
  const history = Array.from({ length: 12 }, (_, idx) => {
    const daysAgo = (11 - idx) * 7;
    return {
      date: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      yield_7d: Number((Number(base.yield_7d) + Math.sin(idx / 2.1) * 0.24).toFixed(2)),
      nav: Number((Number(base.nav) + idx * 0.03).toFixed(4))
    };
  });
  res.json(history);
});

app.get("/api/equities/mmf/:id/liquidity", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  const base = AFRICA_MMF_DETAIL[id];
  if (!base) return res.status(404).json({ error: "MMF not found" });
  const rows = Array.from({ length: 6 }, (_, idx) => ({
    date: new Date(Date.now() - idx * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    dla: `${Math.max(18, 29 - idx)}%`,
    wla: `${Math.max(35, 48 - idx)}%`,
    timeToLiquidate: `${Math.max(1, 3 - Math.floor(idx / 3))}d`
  }));
  res.json(rows);
});

app.get("/api/equities/mmf/:id/composition", async (req, res) => {
  const id = String(req.params.id || "").toUpperCase();
  if (!AFRICA_MMF_DETAIL[id]) return res.status(404).json({ error: "MMF not found" });
  res.json([
    { bucket: "Treasury Bills", weightPct: 44.2 },
    { bucket: "Repos / Cash", weightPct: 21.8 },
    { bucket: "Commercial Paper", weightPct: 18.4 },
    { bucket: "Bank Deposits", weightPct: 15.6 },
  ]);
});

app.get("/api/equities/reits", async (req, res) => {
  const country = resolveAfricaCountry(req.query.country);
  const rows = country === "ALL" ? AFRICA_REIT_ROWS : AFRICA_REIT_ROWS.filter((row) => row.country === country);
  res.json(rows);
});

app.get("/api/equities/reits/compare", async (req, res) => {
  const ids = String(req.query.ids || "").split(",").map((v) => v.trim().toUpperCase()).filter(Boolean);
  const rows = (ids.length ? ids : AFRICA_REIT_ROWS.map((row) => row.symbol).slice(0, 3))
    .map((symbol) => AFRICA_REIT_ROWS.find((row) => row.symbol === symbol))
    .filter(Boolean)
    .map((row) => ({
      id: row.symbol,
      country: row.country,
      dividendYield: row.dividendYield,
      marketCap: row.marketCap,
      returnYtdPct: row.returnYtdPct
    }));
  res.json(rows);
});

app.get("/api/equities/reits/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const detail = AFRICA_REIT_DETAIL[symbol] || null;
  if (!detail) return res.status(404).json({ error: "REIT not found" });
  res.json(detail);
});

app.get("/api/equities/reits/:symbol/exposure", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!AFRICA_REIT_DETAIL[symbol]) return res.status(404).json({ error: "REIT not found" });
  res.json([
    { segment: "Retail", weightPct: 36.2 },
    { segment: "Office", weightPct: 28.4 },
    { segment: "Industrial", weightPct: 19.1 },
    { segment: "Residential / Other", weightPct: 16.3 },
  ]);
});

app.get("/api/equities/reits/:symbol/income", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  const detail = AFRICA_REIT_DETAIL[symbol];
  if (!detail) return res.status(404).json({ error: "REIT not found" });
  const rows = ["2025Q1", "2025Q2", "2025Q3", "2025Q4"].map((period, idx) => ({
    period,
    dividend: Number((0.19 + idx * 0.01).toFixed(2)),
    payoutRatio: Number((detail.payoutRatio + Math.sin(idx) * 1.4).toFixed(2)),
    ffo: Number((detail.ffo * (0.22 + idx * 0.01)).toFixed(0))
  }));
  res.json(rows);
});
app.get("/api/equities/stocks", async (req, res) => {
  // Returns the list of available stocks (placeholder for now)
  res.json([
    { symbol: "AAPL", name: "Apple Inc.", sector: "Technology" },
    { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology" },
    { symbol: "HIMS", name: "Hims & Hers Health, Inc.", sector: "Healthcare" },
  ]);
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

    const calcAnnualizedVolatility = (series, assetKey) => {
      const returns = series
        .map((row) => Number(row?.[assetKey]))
        .filter((v) => Number.isFinite(v))
        .map((v) => v / 100);
      if (returns.length < 2) return 0;
      const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
      const variance = returns.reduce((s, v) => s + ((v - mean) ** 2), 0) / (returns.length - 1);
      return Number((Math.sqrt(variance) * Math.sqrt(252) * 100).toFixed(2));
    };

    const calcMaxDrawdown = (series, assetKey) => {
      const returns = series
        .slice()
        .reverse()
        .map((row) => Number(row?.[assetKey]))
        .filter((v) => Number.isFinite(v))
        .map((v) => 1 + (v / 100));
      if (!returns.length) return 0;
      let equity = 1;
      let peak = 1;
      let maxDd = 0;
      returns.forEach((r) => {
        equity *= r;
        peak = Math.max(peak, equity);
        maxDd = Math.min(maxDd, (equity / peak) - 1);
      });
      return Number((Math.abs(maxDd) * 100).toFixed(2));
    };

    const calcSharpe = (series, assetKey, rf = 0.03) => {
      const returns = series
        .map((row) => Number(row?.[assetKey]))
        .filter((v) => Number.isFinite(v))
        .map((v) => v / 100);
      if (returns.length < 2) return 0;
      const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
      const std = Math.sqrt(returns.reduce((s, v) => s + ((v - mean) ** 2), 0) / (returns.length - 1));
      if (std === 0) return 0;
      return Number((((mean - rf / 252) / std) * Math.sqrt(252)).toFixed(2));
    };

    const calcSortino = (series, assetKey, rf = 0.03) => {
      const returns = series
        .map((row) => Number(row?.[assetKey]))
        .filter((v) => Number.isFinite(v))
        .map((v) => v / 100);
      if (returns.length < 2) return 0;
      const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
      const downside = returns.filter((v) => v < 0);
      if (!downside.length) return 0;
      const downsideDev = Math.sqrt(downside.reduce((s, v) => s + (v ** 2), 0) / downside.length);
      if (downsideDev === 0) return 0;
      return Number((((mean - rf / 252) / downsideDev) * Math.sqrt(252)).toFixed(2));
    };

    const benchmarkIndexHistory = [
      {
        id: "spx",
        name: "S&P 500",
        symbol: "SPX",
        region: "USA",
        currency: "USD",
        daily: 0.42,
        weekly: 1.34,
        monthly: 2.85,
        annual: calculateCAGR(ANNUAL_RETURNS, "sp500", 1),
        ytd: 9.78,
        yr1: calculateCAGR(ANNUAL_RETURNS, "sp500", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "sp500", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "sp500", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "sp500", 10),
        sparkline: ANNUAL_RETURNS.slice(0, 10).reverse().map((r) => Number(r.sp500))
      },
      {
        id: "mxwo",
        name: "MSCI World",
        symbol: "MXWO",
        region: "Global",
        currency: "USD",
        daily: 0.31,
        weekly: 1.09,
        monthly: 2.12,
        annual: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 1),
        ytd: 8.24,
        yr1: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "msciWorld", 10),
        sparkline: ANNUAL_RETURNS.slice(0, 10).reverse().map((r) => Number(r.msciWorld))
      },
      {
        id: "mxef",
        name: "MSCI EM",
        symbol: "MXEF",
        region: "Emerging Markets",
        currency: "USD",
        daily: 0.57,
        weekly: 1.81,
        monthly: 3.06,
        annual: calculateCAGR(ANNUAL_RETURNS, "msciEm", 1),
        ytd: 11.32,
        yr1: calculateCAGR(ANNUAL_RETURNS, "msciEm", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "msciEm", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "msciEm", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "msciEm", 10),
        sparkline: ANNUAL_RETURNS.slice(0, 10).reverse().map((r) => Number(r.msciEm))
      },
      {
        id: "reit",
        name: "Global REITs",
        symbol: "EPRA/NAREIT",
        region: "Global",
        currency: "USD",
        daily: 0.15,
        weekly: 0.72,
        monthly: 1.24,
        annual: calculateCAGR(ANNUAL_RETURNS, "reits", 1),
        ytd: 4.2,
        yr1: calculateCAGR(ANNUAL_RETURNS, "reits", 1),
        yr3: calculateCAGR(ANNUAL_RETURNS, "reits", 3),
        yr5: calculateCAGR(ANNUAL_RETURNS, "reits", 5),
        yr10: calculateCAGR(ANNUAL_RETURNS, "reits", 10),
        sparkline: ANNUAL_RETURNS.slice(0, 10).reverse().map((r) => Number(r.reits))
      }
    ];

    const sectorPerformance = [
      { sector: "Technology", daily: 0.64, ytd: 18.2, yr1: 24.5, flowUsdBn: 6.2 },
      { sector: "Financials", daily: 0.28, ytd: 11.1, yr1: 14.0, flowUsdBn: 2.4 },
      { sector: "Healthcare", daily: -0.12, ytd: 6.4, yr1: 8.9, flowUsdBn: -0.8 },
      { sector: "Energy", daily: 0.43, ytd: 9.8, yr1: 12.2, flowUsdBn: 1.3 },
      { sector: "Industrials", daily: 0.37, ytd: 10.5, yr1: 13.7, flowUsdBn: 1.7 },
      { sector: "Consumer", daily: 0.21, ytd: 7.3, yr1: 10.1, flowUsdBn: 0.9 },
      { sector: "Utilities", daily: -0.05, ytd: 3.9, yr1: 5.4, flowUsdBn: 0.4 }
    ];

    const regionalPerformance = [
      { region: "USA", currency: "USD", daily: 0.42, ytd: 9.78, yr1: 25.02, yr3: calculateCAGR(ANNUAL_RETURNS, "sp500", 3) },
      { region: "Europe", currency: "EUR", daily: 0.19, ytd: 6.42, yr1: 12.14, yr3: 6.88 },
      { region: "Asia", currency: "JPY", daily: 0.33, ytd: 8.11, yr1: 15.24, yr3: 7.11 },
      { region: "Emerging Markets", currency: "USD", daily: 0.57, ytd: 11.32, yr1: calculateCAGR(ANNUAL_RETURNS, "msciEm", 1), yr3: calculateCAGR(ANNUAL_RETURNS, "msciEm", 3) },
      { region: "Frontier Markets", currency: "USD", daily: 0.25, ytd: 5.38, yr1: 9.04, yr3: 4.82 }
    ];

    const styleFactors = [
      { factor: "Value", daily: 0.24, ytd: 7.2, yr1: 11.8 },
      { factor: "Growth", daily: 0.58, ytd: 14.7, yr1: 22.6 },
      { factor: "Momentum", daily: 0.49, ytd: 13.4, yr1: 20.1 },
      { factor: "Quality", daily: 0.31, ytd: 10.2, yr1: 14.9 },
      { factor: "Low Volatility", daily: 0.12, ytd: 5.1, yr1: 7.6 },
      { factor: "Size (Small Cap)", daily: 0.19, ytd: 6.3, yr1: 9.4 }
    ];

    const rebalanceSignals = [
      { bucket: "Technology", targetWeight: 27, currentWeight: 31, driftPct: 4.0, signal: "Trim" },
      { bucket: "Financials", targetWeight: 14, currentWeight: 12.2, driftPct: -1.8, signal: "Add" },
      { bucket: "Healthcare", targetWeight: 13, currentWeight: 11.4, driftPct: -1.6, signal: "Add" },
      { bucket: "Energy", targetWeight: 8, currentWeight: 7.5, driftPct: -0.5, signal: "Hold" },
      { bucket: "Industrials", targetWeight: 10, currentWeight: 9.7, driftPct: -0.3, signal: "Hold" }
    ];

    const correlationLabels = ["SPX", "World", "EM", "REIT", "US10Y"];
    const correlationMatrix = [
      [1.00, 0.88, 0.71, 0.64, -0.31],
      [0.88, 1.00, 0.79, 0.67, -0.22],
      [0.71, 0.79, 1.00, 0.52, -0.18],
      [0.64, 0.67, 0.52, 1.00, -0.36],
      [-0.31, -0.22, -0.18, -0.36, 1.00]
    ];

    const volatilityMetrics = [
      {
        asset: "S&P 500",
        annualizedVolatility: calcAnnualizedVolatility(ANNUAL_RETURNS, "sp500"),
        maxDrawdown: calcMaxDrawdown(ANNUAL_RETURNS, "sp500"),
        sharpe: calcSharpe(ANNUAL_RETURNS, "sp500"),
        sortino: calcSortino(ANNUAL_RETURNS, "sp500")
      },
      {
        asset: "MSCI World",
        annualizedVolatility: calcAnnualizedVolatility(ANNUAL_RETURNS, "msciWorld"),
        maxDrawdown: calcMaxDrawdown(ANNUAL_RETURNS, "msciWorld"),
        sharpe: calcSharpe(ANNUAL_RETURNS, "msciWorld"),
        sortino: calcSortino(ANNUAL_RETURNS, "msciWorld")
      },
      {
        asset: "MSCI EM",
        annualizedVolatility: calcAnnualizedVolatility(ANNUAL_RETURNS, "msciEm"),
        maxDrawdown: calcMaxDrawdown(ANNUAL_RETURNS, "msciEm"),
        sharpe: calcSharpe(ANNUAL_RETURNS, "msciEm"),
        sortino: calcSortino(ANNUAL_RETURNS, "msciEm")
      }
    ];

    const dividendData = [
      { symbol: "SPY", dividendYield: 1.34, payoutRatio: 38.1, exDividendDate: "2026-06-20", dividendGrowth5Y: 6.2 },
      { symbol: "VIG", dividendYield: 1.79, payoutRatio: 44.7, exDividendDate: "2026-06-24", dividendGrowth5Y: 7.1 },
      { symbol: "SCHD", dividendYield: 3.45, payoutRatio: 52.3, exDividendDate: "2026-06-22", dividendGrowth5Y: 10.4 }
    ];

    const earningsCalendar = [
      { date: "2026-04-24", symbol: "MSFT", period: "Q1", estimateEPS: 3.12, previousSurprisePct: 4.1, revisionTrend: "Up" },
      { date: "2026-04-25", symbol: "AAPL", period: "Q2", estimateEPS: 1.66, previousSurprisePct: 2.3, revisionTrend: "Flat" },
      { date: "2026-04-26", symbol: "AMZN", period: "Q1", estimateEPS: 1.12, previousSurprisePct: 5.2, revisionTrend: "Up" },
      { date: "2026-04-28", symbol: "NVDA", period: "Q1", estimateEPS: 6.08, previousSurprisePct: 7.9, revisionTrend: "Up" }
    ];

    const valuationData = [
      { scope: "USA (S&P 500)", pe: 22.8, pb: 4.3, evEbitda: 14.2, dividendYield: 1.4, fcfYield: 3.9 },
      { scope: "Europe (STOXX 600)", pe: 14.1, pb: 1.9, evEbitda: 9.7, dividendYield: 3.2, fcfYield: 6.1 },
      { scope: "Asia (MSCI Asia)", pe: 15.8, pb: 1.7, evEbitda: 10.9, dividendYield: 2.4, fcfYield: 5.3 },
      { scope: "Emerging (MSCI EM)", pe: 12.9, pb: 1.6, evEbitda: 8.8, dividendYield: 2.7, fcfYield: 6.8 }
    ];

    const [macroData, fxPayload, riskIndicators] = await Promise.all([
      fetchAnalyticsMacroRows("USA"),
      fetchForexRates(),
      fetchAnalyticsRiskIndicators()
    ]);

    const fundFlows = [
      { segment: "US Tech ETFs", assetClass: "Equities", region: "USA", sector: "Technology", period: "1W", netFlowUsdBn: 4.2 },
      { segment: "EM Broad ETFs", assetClass: "Equities", region: "Emerging Markets", sector: "Broad", period: "1W", netFlowUsdBn: 1.6 },
      { segment: "US IG Bond ETFs", assetClass: "Fixed Income", region: "USA", sector: "Investment Grade", period: "1W", netFlowUsdBn: 2.1 },
      { segment: "Energy Sector ETFs", assetClass: "Equities", region: "Global", sector: "Energy", period: "1W", netFlowUsdBn: -0.4 }
    ];

    const fxRates = Array.isArray(fxPayload?.rates) ? fxPayload.rates : [];
    const forexMovers = {
      gainers: Array.isArray(fxPayload?.gainers) ? fxPayload.gainers : [],
      losers: Array.isArray(fxPayload?.losers) ? fxPayload.losers : [],
      source: fxPayload?.source || "Finviz",
      stale: Boolean(fxPayload?.stale),
      stale_reason: fxPayload?.stale_reason || null
    };

    const marketBreadth = {
      adLine: 12850,
      newHighs: 184,
      newLows: 41,
      above50dmaPct: 62.3,
      above200dmaPct: 58.7
    };

    const corporateActions = [
      { date: "2026-04-18", symbol: "TSLA", action: "Split Proposal", detail: "Board authorized review for 3-for-1 split." },
      { date: "2026-04-15", symbol: "AAPL", action: "Buyback", detail: "Authorized additional $90B repurchase plan." },
      { date: "2026-04-12", symbol: "XOM", action: "Special Dividend", detail: "Declared special cash dividend of $0.35/share." },
      { date: "2026-04-09", symbol: "UNH", action: "M&A", detail: "Announced acquisition of care-tech provider." }
    ];

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

    const enrichedFundsList = FUNDS_LIST.map((fund, idx) => ({
      ...fund,
      domicile: fund.jurisdiction,
      structure: String(fund.type || "").toLowerCase().includes("etf") ? "UCITS/40-Act ETF" : "Open-end Fund",
      feeBps: [3, 6, 9, 12, 18, 24, 35][idx % 7],
      assetClass: idx % 3 === 0 ? "Equities" : idx % 3 === 1 ? "Multi-Asset" : "Fixed Income"
    }));

    res.json({
      updatedAt: new Date().toISOString(),
      benchmarkIndexHistory,
      benchmarkPerformance,
      sectorPerformance,
      regionalPerformance,
      styleFactors,
      rebalanceSignals,
      correlationLabels,
      correlationMatrix,
      volatilityMetrics,
      dividendData,
      earningsCalendar,
      valuationData,
      macroData,
      fundFlows,
      fxRates,
      forexMovers,
      marketBreadth,
      riskIndicators,
      corporateActions,
      annualReturns: ANNUAL_RETURNS,
      reitData: REIT_DATA,
      mmfYields: MMF_YIELDS,
      fundsList: enrichedFundsList
    });
  } catch (error) {
    handleServerError(res, "Analytics Equities fetch failed", error);
  }
});


// ---------------------------------------------------------------------------
// Atomic trade execution (portfolio + balance + trade journal)
// ---------------------------------------------------------------------------
app.post("/api/db/execute-trade", requireSignedIn, writeLimiter, validatePortfolioHolding, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.clientId || typeof payload.clientId !== "string" || payload.clientId.trim().length > 120) {
      return res.status(400).json({ error: "clientId is required for idempotent execution." });
    }
    const result = await userWorkspace.trading.executeTrade(req.auth.userId, payload);
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
// key: socket -> { kind, currency, expiry, symbols, quoteType }

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

async function fetchLivePriceSnapshot({ quoteType = "tradfi", symbols = [] } = {}) {
  const safeSymbols = sanitizePriceSymbols(symbols);
  if (!safeSymbols.length) return {};
  const normalizedType = String(quoteType || "tradfi").toLowerCase() === "crypto" ? "crypto" : "tradfi";
  return normalizedType === "crypto"
    ? fetchCryptoQuotesBySymbols(safeSymbols)
    : fetchYFinancePrices(safeSymbols);
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
        sendWsJson(ws, { type: "subscribed", channel: "prices", ...subscription });
        pushPriceSnapshot(ws, subscription);
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
      console.log(`Portfolio manager backend listening on port ${port}`);
      resolve();
    });
  });
}

async function stopServer() {
  clearInterval(wsHeartbeatTimer);
  clearInterval(wsPushTimer);
  try {
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
    console.error("Failed to initialize PostgreSQL database:", error.message);
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
  res.json(MACRO_INDICATOR_CONFIG.map(c => ({
    code: c.key.toUpperCase(),
    name: c.label,
    category: "growth", // Fallback category
    unit: c.unit
  })));
});

app.get("/api/macro/alerts", (req, res) => {
  res.json([]);
});

app.get("/api/macro/global/overview", async (req, res) => {
  res.json(buildMacroOverviewPayload("GLOBAL", "Global", buildDeterministicMacroMetrics("GLOBAL")));
});

app.get("/api/macro/region/:code/overview", async (req, res) => {
  const code = String(req.params.code || "REGION").trim().toUpperCase();
  res.json(buildMacroOverviewPayload(code, code, buildDeterministicMacroMetrics(code)));
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

app.get("/api/macro/timeseries", (req, res) => {
  const { indicator, range } = req.query;
  const points = range === "1Y" ? 12 : range === "5Y" ? 24 : 60;
  const series = Array.from({ length: points }, (_, i) => ({
    date: new Date(Date.now() - (points - i) * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    value: 100 + i * 0.5 + Math.sin(i / 2) * 5
  }));
  res.json({ series });
});

app.get("/api/macro/compare", (req, res) => {
  const geos = String(req.query.geos || "")
    .split(",")
    .map((geo) => geo.trim().toUpperCase())
    .filter(Boolean);
  const rows = geos.map((geo, idx) => ({
    id: `cmp-${idx}`,
    geo,
    value: Number((100 + deterministicMacroOffset(geo, 9)).toFixed(2)),
    delta: Number((deterministicMacroOffset(`${geo}:delta`, 2) - 1).toFixed(2))
  }));
  res.json({ rows });
});

app.get("/api/macro/calendar", (req, res) => {
  res.json({ events: [] });
});

app.get("/api/macro/map", (req, res) => {
  res.json({ rows: [] });
});

app.get("/api/macro/rankings", (req, res) => {
  res.json({ rows: [] });
});

app.get("/api/macro/forecast", (req, res) => {
  res.json({ points: [] });
});

app.get("/api/macro/source/:indicator", (req, res) => {
  res.json({
    source: "EODHD + World Bank",
    updatedAt: new Date().toISOString(),
    methodology: "Blended real-time and structural indicators."
  });
});

app.get("/api/macro/regime", (req, res) => {
  res.json({ label: "expansion", score: 65, explain: "Overall positive momentum." });
});

app.get("/api/macro/correlation", (req, res) => {
  res.json({ rows: [] });
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
