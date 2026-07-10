// CJS facade for the Massive equities SDK.
// The backend is CommonJS; the SDK bridge lives in restClient.mjs (ESM). This
// facade loads it via dynamic import() and exposes promise-returning methods so
// the rest of index.js (CJS) can call them without touching ESM directly.
//
// Every method rejects if Massive is unconfigured or the SDK isn't installed,
// letting callers fall back to Yahoo daily history. Never throws at load time.

"use strict";

let bridgePromise = null;

function loadBridge() {
  if (!bridgePromise) {
    bridgePromise = import("./restClient.mjs").catch((err) => {
      bridgePromise = null; // allow a later retry
      throw err;
    });
  }
  return bridgePromise;
}

async function call(method, ...args) {
  const bridge = await loadBridge();
  return bridge[method](...args);
}

module.exports = {
  isConfigured: () => Boolean(
    process.env.MASSIVE_API_KEY && process.env.MASSIVE_API_KEY !== "replace_with_your_massive_api_key"
  ),
  getAggregates: (symbol, multiplier, span, from, to) => call("getAggregates", symbol, multiplier, span, from, to),
  getLastTrade: (symbol) => call("getLastTrade", symbol),
  getLastQuote: (symbol) => call("getLastQuote", symbol),
  getSnapshot: (ticker) => call("getSnapshot", ticker),
  getTickerDetails: (symbol) => call("getTickerDetails", symbol),
};
