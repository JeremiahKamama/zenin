const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { spawn } = require("child_process");
const { watchlistData } = require("./data");
const { initializeDatabase, portfolio, watchlist, optionsCalculations, tradeExecutions, balance } = require("./database");

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

app.get("/api/db/balance", async (_req, res) => {
  try {
    const current = await balance.get();
    res.json({ balance: current });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/db/balance", async (req, res) => {
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

  const allDbAssets = await watchlist.getAll();
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
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const DATA_API_BASE_URL = "https://data-api.polymarket.com";
const PREDICTION_REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours
const PREDICTION_CATEGORIES = ["geopolitics", "crypto", "fintech", "tech", "finance"];
const predictionSnapshotCache = new Map();

function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
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

  const normalizedOutcomes = outcomes.map((outcome) => String(outcome || "").trim().toLowerCase());
  const yesIdx = normalizedOutcomes.findIndex((name) => name === "yes");
  const noIdx = normalizedOutcomes.findIndex((name) => name === "no");

  if (yesIdx >= 0) yesPrice = toFiniteNumber(outcomePrices[yesIdx], yesPrice);
  if (noIdx >= 0) noPrice = toFiniteNumber(outcomePrices[noIdx], noPrice);

  return { yesPrice, noPrice };
}

function normalizePredictionMarket(raw = {}) {
  const event = Array.isArray(raw.events) && raw.events.length > 0 ? raw.events[0] : null;
  const volume = toFiniteNumber(raw.volumeNum ?? raw.volume, 0);
  const volume24h = toFiniteNumber(raw.volume24hr ?? raw.volume24hrClob, 0);
  const liquidity = toFiniteNumber(raw.liquidityNum ?? raw.liquidity, 0);
  const { yesPrice, noPrice } = extractYesNoPrices(raw);
  return {
    id: String(raw.id || ""),
    conditionId: String(raw.conditionId || ""),
    slug: String(raw.slug || ""),
    question: String(raw.question || raw.title || ""),
    eventTitle: String(event?.title || ""),
    eventCategory: String(event?.category || ""),
    eventTags: Array.isArray(event?.tags) ? event.tags.map((tag) => String(tag?.name || tag || "").toLowerCase()) : [],
    endDate: raw.endDate || null,
    image: raw.image || raw.icon || event?.image || null,
    volume,
    volume24h,
    liquidity,
    yesPrice,
    noPrice,
    oneWeekPriceChange: toFiniteNumber(raw.oneWeekPriceChange, 0),
    oneMonthPriceChange: toFiniteNumber(raw.oneMonthPriceChange, 0),
    updatedAt: raw.updatedAt || null
  };
}

function classifyPredictionCategory(market) {
  const haystack = [
    market.question,
    market.eventTitle,
    market.eventCategory,
    ...(market.eventTags || [])
  ]
    .join(" ")
    .toLowerCase();

  const matchesAny = (keywords) => keywords.some((keyword) => haystack.includes(keyword));
  if (matchesAny(["geopolitic", "war", "ceasefire", "election", "government", "president", "middle east", "ukraine", "russia", "china", "iran", "israel"])) {
    return "geopolitics";
  }
  if (matchesAny(["crypto", "bitcoin", "ethereum", "solana", "xrp", "bnb", "dogecoin", "hype", "defi", "token"])) {
    return "crypto";
  }
  if (matchesAny(["fintech", "payments", "paypal", "block", "stripe", "visa", "mastercard", "neobank"])) {
    return "fintech";
  }
  if (matchesAny(["tech", "ai", "apple", "microsoft", "google", "meta", "tesla", "nvidia", "openai", "amazon"])) {
    return "tech";
  }
  if (matchesAny(["finance", "economy", "fed", "interest rate", "inflation", "stocks", "equity", "earnings", "gdp", "recession", "s&p", "nasdaq", "dow"])) {
    return "finance";
  }
  return null;
}

async function fetchGammaJson(path) {
  const fetch = await resolveFetch();
  const response = await fetch(`${GAMMA_BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`Gamma request failed: ${path} (${response.status})`);
  }
  return response.json();
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

  let rawMarkets = [];
  try {
    rawMarkets = await fetchGammaJson("/markets?active=true&closed=false&archived=false&limit=800");
  } catch {
    rawMarkets = await fetchGammaJson("/markets?limit=800");
  }
  const normalized = (Array.isArray(rawMarkets) ? rawMarkets : [])
    .map(normalizePredictionMarket)
    .filter((market) => market.id && market.question);

  const categories = Object.fromEntries(PREDICTION_CATEGORIES.map((category) => [category, []]));
  normalized
    .map((market) => ({ ...market, predictionCategory: classifyPredictionCategory(market) }))
    .filter((market) => market.predictionCategory)
    .sort((a, b) => b.volume - a.volume)
    .forEach((market) => {
      const bucket = categories[market.predictionCategory];
      if (bucket && bucket.length < 5) bucket.push(market);
    });

  const categoryMarkets = Object.values(categories).flatMap((items) => items);
  const categoryByConditionId = new Map();
  const marketByConditionId = new Map();
  categoryMarkets.forEach((market) => {
    if (!market.conditionId) return;
    categoryByConditionId.set(market.conditionId, classifyPredictionCategory(market) || "other");
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
      const notional = size * price;
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

      const data = {
        bid: firstFiniteNumber(
          t?.best_bid_price,
          t?.bid_price,
          t?.best_bid,
          t?.bid,
          t?.bids?.[0]?.price,
          0
        ),
        ask: firstFiniteNumber(
          t?.best_ask_price,
          t?.ask_price,
          t?.best_ask,
          t?.ask,
          t?.asks?.[0]?.price,
          0
        ),
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

app.get("/api/options/whale-trades", async (req, res) => {
  try {
    const requestedMinNotional = Number(req.query?.minNotional);
    const minNotionalUsd = Number.isFinite(requestedMinNotional) && requestedMinNotional > 0
      ? requestedMinNotional
      : MIN_WHALE_NOTIONAL_USD;

    const merged = [];
    const debugRawTradeCounts = Object.fromEntries(WHALE_CURRENCIES.map((currency) => [currency, 0]));
    const debugFallbackTradeCounts = Object.fromEntries(WHALE_CURRENCIES.map((currency) => [currency, 0]));

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
    };

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

    const whaleFiltered = merged.filter((t) => Number.isFinite(t.totalNotional) && t.totalNotional >= minNotionalUsd);
    const source = whaleFiltered.length > 0 ? whaleFiltered : merged
      .sort((a, b) => b.totalNotional - a.totalNotional)
      .slice(0, 80);

    const trades = source
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 100);

    console.info("Whale trades raw counts by currency:", debugRawTradeCounts);

    res.json({
      updatedAt: new Date().toISOString(),
      minNotionalUsd,
      debug_raw_trade_counts: debugRawTradeCounts,
      debug_fallback_trade_counts: debugFallbackTradeCounts,
      trades
    });
  } catch (error) {
    console.error("Whale options fetch failed:", error.message);
    res.status(502).json({ error: "Failed to fetch whale options trades" });
  }
});

// ---------------------------------------------------------------------------
// Prediction Markets (Polymarket Gamma API)
// ---------------------------------------------------------------------------
app.get("/api/prediction/snapshot", async (_req, res) => {
  try {
    const snapshot = await loadPredictionSnapshot();
    res.json(snapshot);
  } catch (error) {
    console.error("Prediction snapshot failed:", error.message);
    res.status(502).json({ error: "Failed to fetch prediction markets snapshot" });
  }
});

app.get("/api/prediction/market-details/:marketId", async (req, res) => {
  const { marketId } = req.params;
  if (!marketId) {
    return res.status(400).json({ error: "marketId is required" });
  }

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

    res.json(details);
  } catch (error) {
    console.error("Prediction market details failed:", error.message);
    res.status(502).json({ error: "Failed to fetch prediction market details" });
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
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/db/options-calculations", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.symbol) {
      return res.status(400).json({ error: "symbol is required" });
    }
    const record = await optionsCalculations.add(payload);
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
app.get("/api/db/portfolio", async (req, res) => {
  try {
    const holdings = await portfolio.getAll();
    res.json({ holdings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/db/portfolio",writeLimiter, validatePortfolioHolding, async (req, res) => {
  try {
    const holding = req.body;
    const result = await portfolio.add(holding);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/db/portfolio/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const holding = req.body;
    const result = await portfolio.update(id, holding);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/db/portfolio/:id", writeLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await portfolio.delete(id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get portfolio items by symbol and marketType
app.get("/api/db/portfolio/symbol/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20).toUpperCase();
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const marketType = String(req.query.marketType || "").trim().toLowerCase();
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const holdings = await portfolio.findBySymbol(symbol, marketType);
    res.json({ holdings });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/db/watchlist",writeLimiter,  validateWatchlistAsset, async (req, res) => {
  try {
    const asset = req.body;
    const result = await watchlist.add(asset);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/db/watchlist/:symbol", writeLimiter, async (req, res) => {
  try {
    const symbol = req.params.symbol.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, 20);
    if (!symbol) return res.status(400).json({ error: "Invalid symbol" });
    const { marketType } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const result = await watchlist.delete(symbol, marketType);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check if asset is in watchlist
app.get("/api/db/watchlist/check/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const { marketType } = req.query;
    if (!marketType) {
      return res.status(400).json({ error: "marketType query parameter required" });
    }
    const exists = await watchlist.exists(symbol, marketType);
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
