const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { spawn } = require("child_process");
const { watchlistData } = require("./data");
const { initializeDatabase, portfolio, watchlist } = require("./database");

const app = express();

// Security headers
app.use(helmet());

// CORS — allow configured frontend origin (or all origins in dev)
const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL]
  : true; // true = reflect all origins (dev mode)
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Rate limiting — 300 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api", limiter);

app.use(express.json());

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

async function fetchBinanceTicker(endpointBase, symbol) {
  const fetch = await resolveFetch();
  const response = await fetch(`${endpointBase}?symbol=${symbol}`);
  if (!response.ok) {
    throw new Error(`Binance lookup failed for ${symbol}: ${response.statusText}`);
  }
  return response.json();
}

async function fetchCryptoMarketData(marketType = "spot") {
  const fetch = await resolveFetch();

  const coinMap = {
    BTC: "bitcoin", ETH: "ethereum", BNB: "binancecoin",
    XRP: "ripple", ADA: "cardano", SOL: "solana",
    DOGE: "dogecoin", DOT: "polkadot", USDT: "tether", USDC: "usd-coin"
  };

  const allDbAssets = watchlist.getAll();
  const customCrypto = allDbAssets.filter(a =>
    (a.type === "crypto" || a.type === "stablecoin" || a.type === "exchange token" || a.type === "spot")
    && (a.marketType || "spot") === marketType
    && !watchlistData.crypto.some(pre => pre.symbol === a.symbol)
  );

  const combinedAssets = [
    ...watchlistData.crypto,
    ...customCrypto
  ].map(asset => ({ ...asset, type: "crypto", marketType }));

  const ids = combinedAssets
    .map(a => coinMap[a.symbol] || a.symbol.toLowerCase())
    .join(",");

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
    const response = await fetch(url);
    const data = await response.json();

    return combinedAssets.map(asset => {
      const id = coinMap[asset.symbol] || asset.symbol.toLowerCase();
      const info = data[id];
      return {
        ...asset,
        price: info?.usd ?? null,
        priceChangePercent: info?.usd_24h_change ?? null,
        volume: null
      };
    });
  } catch (error) {
    return combinedAssets.map(asset => ({
      ...asset, price: null, priceChangePercent: null, volume: null
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
  const { symbol, type, interval = "1D" } = req.query;
  if (!symbol) return res.status(400).json({ error: "Symbol required" });

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
    const results = await searchYahooFinance(q, type);
    res.json({ results });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/watchlist", async (req, res) => {
  const { category, marketType = "spot" } = req.query;

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
      const assets = await fetchCryptoMarketData(marketType);
      return res.json({ category: key, marketType, assets });
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

// Lyra (Derive) Crypto Options Integration
app.post("/api/options/crypto", async (req, res) => {
  const { currency = "ETH", expiry } = req.body;
  try {
    const fetch = await resolveFetch();
    
    // 1. Get ALL active instruments for the selected currency
    const instRes = await fetch("https://api.lyra.finance/public/get_instruments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currency, instrument_type: "option", expired: false })
    });
    const instData = await instRes.json();
    const instruments = instData.result || [];
    console.log(`[Options] Fetched ${instruments.length} instruments for ${currency}`);
    
    if (instruments.length === 0) return res.json({ chain: [], expiries: [] });

    // 2. Discover all available expiries
    const uniqueExpiries = [...new Set(instruments.map(i => i.option_details?.expiry))]
      .filter(Boolean)
      .sort((a, b) => a - b);
    
    // Choose selected expiry or default to closest
    const targetExpiry = expiry ? parseInt(expiry) : uniqueExpiries[0];
    const filteredInstruments = instruments.filter(i => i.option_details?.expiry === targetExpiry);
    
    // 3. Get tickers for this specific expiry
    const tickRes = await fetch("https://api.lyra.finance/public/get_tickers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrument_type: "option", currency, expired: false, expiry: targetExpiry })
    });
    const tickData = await tickRes.json();
    const tickers = tickData.result || [];

    // 4. Group by Strike
    const strikesMap = {};
    
    filteredInstruments.forEach(inst => {
      const strike = parseFloat(inst.option_details.strike);
      const type = inst.option_details.option_type;
      const ticker = tickers.find(t => t.instrument_name === inst.instrument_name) || {};

      if (!strikesMap[strike]) {
        strikesMap[strike] = { strike, call: {}, put: {} };
      }

      const info = {
        bid: parseFloat(ticker.best_bid_price || 0),
        ask: parseFloat(ticker.best_ask_price || 0),
        delta: parseFloat(ticker.greeks?.delta || 0),
        gamma: parseFloat(ticker.greeks?.gamma || 0),
        vega: parseFloat(ticker.greeks?.vega || 0),
        theta: parseFloat(ticker.greeks?.theta || 0),
        iv: parseFloat(ticker.iv || 0)
      };

      if (type === "C") strikesMap[strike].call = info;
      else strikesMap[strike].put = info;
    });

    const chain = Object.values(strikesMap).sort((a, b) => a.strike - b.strike);
    
    res.json({ 
      expiry: targetExpiry,
      expiries: uniqueExpiries,
      chain: chain.slice(0, 15), 
      market_metrics: {
        iv: tickers[0]?.iv || 0,
        p_c_ratio: 0.85 
      }
    });
  } catch (error) {
    console.error("Lyra API Error:", error);
    res.status(502).json({ error: "Failed to fetch crypto options from Lyra" });
  }
});

app.get("/api/options/crypto/top-assets", async (req, res) => {
  try {
    const fetch = await resolveFetch();
    const response = await fetch("https://api.lyra.finance/public/get_tickers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrument_type: "perp" })
    });
    const data = await response.json();
    const tickers = data.result || [];
    
    // Filter and aggregate by base currency
    const markets = tickers
      .map(t => ({
        symbol: t.instrument_name.split("-")[0],
        price: parseFloat(t.index_price),
        volume: parseFloat(t.volume_24h),
        change: parseFloat(t.price_change_24h || 0)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);
      
    res.json({ assets: markets });
  } catch (error) {
    res.status(502).json({ error: "Failed to fetch top markets" });
  }
});

app.get("/api/options/crypto/all-assets", async (req, res) => {
  try {
    const fetch = await resolveFetch();
    const instRes = await fetch("https://api.lyra.finance/public/get_instruments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrument_type: "option", expired: false })
    });
    const instData = await instRes.json();
    const instruments = instData.result || [];
    
    // Extract unique base currencies
    const currencies = [...new Set(instruments.map(i => i.base_currency))].sort();
    
    res.json({ assets: currencies });
  } catch (error) {
    res.status(502).json({ error: "Failed to fetch all assets from Lyra" });
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
  const { marketType = "spot" } = req.query;
  try {
    const assets = await fetchCryptoMarketData(marketType);
    res.json({ category: "crypto", marketType, assets });
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

app.post("/api/db/portfolio", (req, res) => {
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

app.delete("/api/db/portfolio/:id", (req, res) => {
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
    const { symbol } = req.params;
    const { marketType } = req.query;
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

app.post("/api/db/watchlist", (req, res) => {
  try {
    const asset = req.body;
    const result = watchlist.add(asset);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/db/watchlist/:symbol", (req, res) => {
  try {
    const { symbol } = req.params;
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
app.listen(port, '0.0.0.0', () => {
  console.log(`Portfolio manager backend listening on port ${port}`);
});
