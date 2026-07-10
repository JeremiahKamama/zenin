// ESM bridge for the Massive equities SDK (@massive.com/client-js, v10.x).
// The SDK is ESM-only (no CJS main); the backend is CommonJS, so this .mjs module
// exposes async factory methods that the CJS facade (restClient.js) loads via
// dynamic import(). All methods reject cleanly if the SDK or key is unavailable so
// callers can fall back to Yahoo daily history.
//
// SDK surface (auto-generated Massive-compatible client):
//   aggregatesV1({ ticker, resolution, windowStart, limit, ... })
//   getStocksSnapshotTicker({ stocksTicker })         -> last trade + quote + prevDay
//   getTicker({ ticker, date })                       -> ticker reference/details
//   getPreviousStocksAggregates({ stocksTicker, adjusted })
//
// Gated on MASSIVE_API_KEY (present in backend/.env — production).

const API_KEY = process.env.MASSIVE_API_KEY && process.env.MASSIVE_API_KEY !== "replace_with_your_massive_api_key"
  ? process.env.MASSIVE_API_KEY
  : null;

let api = null;
let loadError = null;

async function getApi() {
  if (api) return api;
  if (loadError) throw loadError;
  if (!API_KEY) {
    loadError = new Error("massive_api_key_missing");
    throw loadError;
  }
  try {
    const mod = await import("@massive.com/client-js");
    const { Configuration, DefaultApi } = mod;
    const cfg = new Configuration({ apiKey: API_KEY });
    api = new DefaultApi(cfg);
    return api;
  } catch (err) {
    loadError = err;
    throw err;
  }
}

// Intraday/daily OHLCV aggregates. resolution: "1","5","15","30","60","day";
// windowStart: ISO date (from). Returns the raw SDK response (caller normalizes).
export async function getAggregates(symbol, resolution = "day", windowStart = null, limit = 5000) {
  const a = await getApi();
  const params = { ticker: symbol.toUpperCase() };
  if (resolution) params.resolution = resolution;
  if (windowStart) params.windowStart = windowStart;
  if (limit) params.limit = limit;
  return a.aggregatesV1(params);
}

export async function getSnapshot(ticker) {
  const a = await getApi();
  return a.getStocksSnapshotTicker({ stocksTicker: ticker.toUpperCase() });
}

export async function getTickerDetails(symbol) {
  const a = await getApi();
  // date=null => latest reference
  return a.getTicker({ ticker: symbol.toUpperCase(), date: null });
}

export async function getPreviousClose(symbol) {
  const a = await getApi();
  return a.getPreviousStocksAggregates({ stocksTicker: symbol.toUpperCase(), adjusted: true });
}

// Combined last trade + last quote (derived from the snapshot, which carries both).
export async function getLastTrade(symbol) {
  const snap = await getSnapshot(symbol);
  return snap?.ticker?.lastTrade ?? snap?.lastTrade ?? snap;
}

export async function getLastQuote(symbol) {
  const snap = await getSnapshot(symbol);
  return snap?.ticker?.lastQuote ?? snap?.lastQuote ?? snap;
}

export const isConfigured = Boolean(API_KEY);
