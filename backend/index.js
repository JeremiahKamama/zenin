const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { spawn } = require("child_process");
const { watchlistData } = require("./data");
const { initializeDatabase, portfolio, watchlist, optionsCalculations, tradeExecutions, db } = require("./database");

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


app.use(express.json());
function validatePortfolioHolding(req, res, next) {
  const { symbol, name, price, quantity, type, marketType, orderType } = req.body;
  if (!symbol || typeof symbol !== "string" || symbol.length > 20) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  if (!name || typeof name !== "string" || name.length > 100) {
    return res.status(400).json({ error: "Invalid name" });
  }
  if (typeof price !== "number" || price < 0 || !isFinite(price)) {
    return res.status(400).json({ error: "Invalid price" });
  }
  if (typeof quantity !== "number" || !isFinite(quantity)) {
    return res.status(400).json({ error: "Invalid quantity" });
  }
  if (!["stock", "crypto", "bond", "commodity", "etf"].includes((type || "").toLowerCase())) {
    return res.status(400).json({ error: "Invalid type" });
  }
  if (!["buy", "sell"].includes(orderType)) {
    return res.status(400).json({ error: "Invalid orderType" });
  }
  next();
}

function validateWatchlistAsset(req, res, next) {
  const { symbol, name, type, marketType } = req.body;
  if (!symbol || typeof symbol !== "string" || symbol.length > 20) {
    return res.status(400).json({ error: "Invalid symbol" });
  }
  if (!name || typeof name !== "string" || name.length > 100) {
    return res.status(400).json({ error: "Invalid name" });
  }
  if (!type || typeof type !== "string" || type.length > 50) {
    return res.status(400).json({ error: "Invalid type" });
  }
  next();
}

// Initialize database on start
initializeDatabase();

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

  const allDbAssets = watchlist.getAll();
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
    const yfSymbols = [...new Set(Object.values(toYF))]; // deduplicated YF tickers

    console.log("Fetching prices — original:", originalSymbols);
    console.log("Normalised YF tickers:     ", yfSymbols);
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
        const yf = toYF[orig];
        result[orig] = yfPrices[yf] || { price: null, priceChangePercent: null };
      }
      resolve(result);
    });

    child.on("error", (err) => {
      console.error("Failed to start Python process:", err);
      resolve({});
    });

    // Send the normalised YF tickers to the Python script
    child.stdin.write(JSON.stringify(yfSymbols));
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
function searchYahooFinance(query, type = "tradfi") {
  return new Promise((resolve) => {
    if (!query || query.trim().length === 0) {
      resolve([]);
      return;
    }

    const child = spawn("python3", ["search_symbols.py"], { cwd: __dirname });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (stderr) console.error("Python stderr:", stderr);
      console.log("Search exited with code:", code);

      if (code !== 0) { resolve([]); return; }

      let results = [];
      try {
        results = JSON.parse(stdout);
      } catch (e) {
        console.error("Failed to parse Python output:", e.message);
        resolve([]);
        return;
      }

      resolve(results);
    });

    child.on("error", (err) => {
      console.error("Failed to start Python process:", err);
      resolve([]);
    });

    // Send the search query and type to the Python script
    const inputData = { query, type };
    child.stdin.write(JSON.stringify(inputData));
    child.stdin.end();

    // Timeout for search requests
    const timer = setTimeout(() => {
      console.warn("Search timeout — killing Python process");
      child.kill();
      resolve([]);
    }, 15000);

    child.on("close", () => clearTimeout(timer));
  });
}

// ---------------------------------------------------------------------------
// USER BALANCE ENDPOINTS
// ---------------------------------------------------------------------------

app.get("/api/db/balance", (req, res) => {
  try {
    const row = db.prepare("SELECT balance FROM user_balance WHERE id = 1").get();
    res.json({ balance: row?.balance ?? 10000 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add to database.js schema in initializeDatabase()

// Balance endpoints in index.js
app.get("/api/db/balance", (req, res) => {
  try {
    const row = db.prepare("SELECT balance FROM user_balance WHERE id = 1").get();
    res.json({ balance: row?.balance ?? 10000 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/db/balance", (req, res) => {
  try {
    const { amount, type } = req.body;
    if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) return res.status(400).json({ error: "Invalid amount" });
    const row = db.prepare("SELECT balance FROM user_balance WHERE id = 1").get();
    const current = row?.balance ?? 10000;
    const newBalance = type === "deposit" ? current + amount : current - amount;
    if (newBalance < 0) return res.status(400).json({ error: "Insufficient balance" });
    db.prepare("UPDATE user_balance SET balance = ? WHERE id = 1").run(newBalance);
    res.json({ balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});  

// History
// ---------------------------------------------------------------------------
async function fetchHistoryFromBinance(symbol, interval) {
  const fetch = await resolveFetch();

  const intervalMap = {
    "4H":  { days: 1 },
    "1D":  { days: 1 },
    "1W":  { days: 7 },
    "3M":  { days: 90 },
    "1Y":  { days: 365 },
    "YTD": { days: 365 },
    "MAX": { days: 2000 },
  };

  const { days } = intervalMap[interval] || intervalMap["1D"];
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

function fetchHistoryFromYahoo(symbol, interval) {
  return new Promise((resolve) => {
    // interval mapping for yfinance (period, interval)
    const mapping = {
      "4H": { period: "1d", interval: "15m" },
      "1D": { period: "1d", interval: "5m" },
      "1W": { period: "7d", interval: "1h" },
      "3M": { period: "3mo", interval: "1d" },
      "1Y": { period: "1y", interval: "1d" },
      "YTD": { period: "ytd", interval: "1d" },
      "MAX": { period: "max", interval: "1wk" },
    };
    const { period, interval: yfInterval } = mapping[interval] || mapping["1D"];
    const yfSymbol = normaliseSymbol(symbol);

    const child = spawn("python3", ["fetch_history.py"], { cwd: __dirname });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0) { resolve([]); return; }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        resolve([]);
      }
    });

    child.stdin.write(JSON.stringify({ symbol: yfSymbol, period, interval: yfInterval }));
    child.stdin.end();
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
 // if (!symbol) return res.status(400).json({ error: "Symbol required" });

  try {
    let history = [];
    if (type === "crypto") {
      history = await fetchHistoryFromBinance(symbol, interval);
    } else {
      history = await fetchHistoryFromYahoo(symbol, interval);
    }
    res.json({ history });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/interval-performance", async (req, res) => {
  const { symbol, type } = req.query;
  const intervals = ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"];
  
  try {
    const results = await Promise.all(intervals.map(async (int) => {
      try {
        let history = [];
        if (type === "crypto") {
          history = await fetchHistoryFromBinance(symbol, int);
        } else {
          history = await fetchHistoryFromYahoo(symbol, int);
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
    
    res.json({ performance: performanceMap });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/search", async (req, res) => {
  const { q, type = "tradfi" } = req.query;
  if (!q) {
    return res.status(400).json({ error: "q parameter required" });
  }
  try {
    let results = [];
    if (String(type).toLowerCase() === "crypto") {
      const hyperResults = await fetchHyperliquidSearchResults(q);
      results = hyperResults.length > 0 ? hyperResults : await searchCoinGeckoCrypto(q);
    } else {
      results = await searchYahooFinance(q, type);
    }
    res.json({ results });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/earnings", async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  const safeSymbol = symbol.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20);

  return new Promise((resolve) => {
    const child = spawn("python3", ["fetch_earnings.py"], { cwd: __dirname });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      if (stderr) console.error("Earnings stderr:", stderr);
      if (code !== 0) {
        res.status(502).json({ error: "Failed to fetch earnings" });
        resolve();
        return;
      }
      try {
        const result = JSON.parse(stdout);
        res.json(result);
      } catch {
        res.status(502).json({ error: "Failed to parse earnings data" });
      }
      resolve();
    });

    child.on("error", (err) => {
      console.error("Failed to start earnings process:", err);
      res.status(502).json({ error: err.message });
      resolve();
    });

    child.stdin.write(JSON.stringify({ symbol: safeSymbol }));
    child.stdin.end();

    setTimeout(() => {
      child.kill();
      res.status(504).json({ error: "Earnings fetch timed out" });
      resolve();
    }, 20000);
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

  return new Promise((resolve) => {
    let settled = false;
    const finish = (statusCode, payload) => {
      if (settled) return;
      settled = true;
      res.status(statusCode).json(payload);
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
        return finish(502, { error: "Failed to fetch earnings calendar" });
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

        finish(200, { items: normalizedItems });
      } catch {
        finish(502, { error: "Failed to parse earnings calendar data" });
      }
    });

    child.on("error", (err) => {
      console.error("Failed to start earnings calendar process:", err);
      finish(502, { error: err.message });
    });

    child.stdin.write(JSON.stringify({ symbols: yfSymbols }));
    child.stdin.end();

    setTimeout(() => {
      child.kill();
      finish(504, { error: "Earnings calendar fetch timed out" });
    }, 20000);
  });
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

  // Crypto — live prices from Binance
  if (key === "crypto") {
    try {
      const assets = await fetchCryptoMarketData();
      return res.json({ category: key, assets });
    } catch (error) {
      return res.status(502).json({ error: error.message });
    }
  }

  const baseAssets = watchlistData[key] || [];

  const allDbAssets = watchlist.getAll();
  const customAssets = allDbAssets.filter(dbAsset => {
    if (baseAssets.some(a => a.symbol === dbAsset.symbol)) return false;
    const dbType = (dbAsset.type || "").toLowerCase();
    
    if (key === 'stocks' && (dbType === 'stock' || dbType === 'equity' || dbType === 'etf')) return true;
    if (key === 'bonds' && dbType === 'bond') return true;
    if (key === 'metals' && dbType === 'commodity') return true;
    if (key === 'commodities' && dbType === 'commodity') return true;
    if (dbType === key) return true;
    
    return false;
  });

  const assets = [...baseAssets, ...customAssets];
  const symbols = assets.map((a) => a.symbol);

  // Stocks — fetch prices inline (no separate /api/prices call needed)
  const requestedSymbols = req.query.symbols
    ? req.query.symbols.split(",").map(s => s.trim())
    : [];

  const pricedSymbols = requestedSymbols.length > 0
    ? symbols.filter(s => requestedSymbols.includes(s))
    : [];

  const prices = pricedSymbols.length > 0
    ? await fetchYFinancePrices(pricedSymbols)
    : {};
    // await fetchYFinancePrices(symbols);

  const enrichedAssets = assets.map((asset) => ({
    ...asset,
    type: asset.type || "stock",
    price: prices[asset.symbol]?.price ?? null,
    priceChangePercent: prices[asset.symbol]?.priceChangePercent ?? null,
  }));

  return res.json({ category: key, assets: enrichedAssets });
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

function parseExpiration(instrumentName = "") {
  const parts = String(instrumentName).split("-");
  return parts[1] || "—";
}

function parseOptionType(instrumentName = "") {
  const parts = String(instrumentName).split("-");
  const side = parts[parts.length - 1];
  return side === "C" ? "call" : side === "P" ? "put" : null;
}

function deriveStrategy(direction, optionType) {
  if (optionType === "call") return direction === "buy" ? "Long Call" : "Short Call";
  if (optionType === "put") return direction === "buy" ? "Long Put" : "Short Put";
  return "Option Trade";
}

function computeTradeNotionalUsd(trade = {}) {
  const amount = Number(trade.amount || trade.contracts || trade.size || 0);
  const optionPrice = Number(trade.price || trade.mark_price || 0);
  const refPrice = Number(trade.index_price || trade.underlying_price || trade.mark_price || 0);

  if (amount <= 0 || refPrice <= 0) return 0;
  if (optionPrice > 0) return amount * optionPrice * refPrice;
  return amount * refPrice;
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
  const cacheKey = `${String(currency).toUpperCase()}:latest`;

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
        market_metrics: { iv: 0, p_c_ratio: 0 }
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
        market_metrics: { iv: 0, p_c_ratio: 0 }
      });
    }

    // 4. Build chain
    const strikesMap = {};

    allTickers.forEach(t => {
      const strike = parseFloat(t?.option_details?.strike);
      const type = t?.option_details?.option_type;

      if (!strike || !type) return;

      if (!strikesMap[strike]) {
        strikesMap[strike] = { strike, call: {}, put: {} };
      }

      const data = {
        bid: parseFloat(t?.best_bid_price || 0),
        ask: parseFloat(t?.best_ask_price || 0),
        delta: parseFloat(t?.greeks?.delta ?? 0),
        gamma: parseFloat(t?.greeks?.gamma ?? 0),
        vega: parseFloat(t?.greeks?.vega ?? 0),
        theta: parseFloat(t?.greeks?.theta ?? 0),
        iv: parseFloat(t?.iv || 0),
      };

      if (type === "C") strikesMap[strike].call = data;
      else if (type === "P") strikesMap[strike].put = data;
    });

    const chain = Object.values(strikesMap)
      .sort((a, b) => a.strike - b.strike)
      .slice(0, 30);

    const avgIv =
      allTickers.reduce((s, t) => s + parseFloat(t?.iv || 0), 0) /
      (allTickers.length || 1);

    const payload = {
      expiry: targetExpiry,
      expiries,
      chain,
      market_metrics: {
        iv: avgIv || 0,
        p_c_ratio: 0.85
      }
    };

    optionsChainCache.set(cacheKey, {
      payload,
      cachedAt: Date.now()
    });

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

    res.status(502).json({
      error: "Failed to fetch options: fetch failed"
    });
  }
});

app.get("/api/options/whale-trades", async (_req, res) => {
  try {
    const settled = await Promise.allSettled(
      WHALE_CURRENCIES.map((currency) =>
        safePost("/public/get_last_trades_by_currency", {
          currency,
          kind: "option",
          count: 100,
          include_old: true
        })
      )
    );

    const merged = [];
    settled.forEach((result, idx) => {
      const currency = WHALE_CURRENCIES[idx];
      if (result.status !== "fulfilled") return;
      const payload = result.value;
      const trades = Array.isArray(payload?.result?.trades)
        ? payload.result.trades
        : Array.isArray(payload?.result)
          ? payload.result
          : [];

      trades.forEach((trade) => {
        const instrument = String(trade.instrument_name || "");
        const symbol = instrument.split("-")[0] || currency;
        const expiration = parseExpiration(instrument);
        const referencePrice = Number(trade.index_price || trade.underlying_price || 0);
        const direction = String(trade.direction || "buy").toLowerCase() === "sell" ? "sell" : "buy";
        const optionType = parseOptionType(instrument);
        const strategy = deriveStrategy(direction, optionType);
        const totalNotional = computeTradeNotionalUsd(trade);

        merged.push({
          id: `${trade.trade_id || instrument}-${trade.timestamp || Date.now()}`,
          symbol,
          expiration,
          referencePrice: Number.isFinite(referencePrice) ? referencePrice : 0,
          strategy,
          totalNotional: Number.isFinite(totalNotional) ? totalNotional : 0,
          timestamp: Number(trade.timestamp || 0)
        });
      });
    });

    const whaleFiltered = merged.filter((t) => t.totalNotional >= MIN_WHALE_NOTIONAL_USD);
    const source = whaleFiltered.length > 0 ? whaleFiltered : merged
      .sort((a, b) => b.totalNotional - a.totalNotional)
      .slice(0, 80);

    const trades = source
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100);

    res.json({
      updatedAt: new Date().toISOString(),
      minNotionalUsd: MIN_WHALE_NOTIONAL_USD,
      trades
    });
  } catch (error) {
    console.error("Whale options fetch failed:", error.message);
    res.status(502).json({ error: "Failed to fetch whale options trades" });
  }
});

// ---------------------------------------------------------------------------
// Options Calculator Persistence
// ---------------------------------------------------------------------------
app.get("/api/db/options-calculations", (req, res) => {
  try {
    const { limit = 20, symbol } = req.query;
    const records = optionsCalculations.getRecent(limit, symbol || null).map((row) => ({
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
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/db/options-calculations", (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }
    const record = optionsCalculations.add(payload);
    res.status(201).json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
  try {
    const assets = await fetchCryptoMarketData();
    res.json({ category: "crypto", assets });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Portfolio Endpoints (Database Persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/portfolio", (req, res) => {
  try {
    const holdings = portfolio.getAll();
    res.json({ holdings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/db/portfolio",writeLimiter, validatePortfolioHolding, (req, res) => {
  try {
    const holding = req.body;
    const result = portfolio.add(holding);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/db/portfolio/:id", (req, res) => {
  try {
    const { id } = req.params;
    const holding = req.body;
    const result = portfolio.update(id, holding);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/db/portfolio/:id", writeLimiter, (req, res) => {
  try {
    const { id } = req.params;
    const result = portfolio.delete(id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get portfolio items by symbol and marketType
app.get("/api/db/portfolio/symbol/:symbol", (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20).toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const marketType = String(req.query.marketType || "").trim().toLowerCase();
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const holdings = portfolio.findBySymbol(symbol, marketType);
    res.json({ holdings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Trade execution endpoints (Journal persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/trades", (req, res) => {
  try {
    const trades = tradeExecutions.getAll(req.query.limit);
    res.json({ trades });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/db/trades", writeLimiter, (req, res) => {
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
    const saved = tradeExecutions.add(payload);
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Watchlist Endpoints (Database Persistence)
// ---------------------------------------------------------------------------
app.get("/api/db/watchlist", (req, res) => {
  try {
    const assets = watchlist.getAll();
    res.json({ assets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/db/watchlist",writeLimiter,  validateWatchlistAsset, (req, res) => {
  try {
    const asset = req.body;
    const result = watchlist.add(asset);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/db/watchlist/:symbol", writeLimiter,(req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20);
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const { marketType } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const result = watchlist.delete(symbol, marketType);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check if asset is in watchlist
app.get("/api/db/watchlist/check/:symbol", (req, res) => {
  try {
    const { symbol } = req.params;
    const { marketType } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const exists = watchlist.exists(symbol, marketType);
    res.json({ exists });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

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
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Portfolio manager backend listening on port ${port}`);
});
