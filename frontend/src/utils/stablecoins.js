// utils/stablecoins.js
//
// Frontend mirror of backend/stablecoins.js. Keep the two lists identical when
// adding/removing a stable. This is the single source of truth on the frontend
// for stable classification — previously the membership was duplicated across
// App.jsx, HomeModule.jsx, and PortfolioModule.jsx with divergent membership
// (e.g. App.jsx buying-power only counted USD/USDC/USDT while the Portfolio
// table used a 10-member set).

const STABLE_ASSETS = new Set([
  "USD",
  "USDT",
  "USDC",
  "BUSD",
  "DAI",
  "FDUSD",
  "TUSD",
  "USDP",
  "USDE",
  "USDD"
]);

// Currencies treated 1:1 with USD for buying-power / cash aggregation.
// Matches the backend USD_EQUIVALENTS set.
const USD_EQUIVALENTS = new Set([
  "USD",
  "USDT",
  "USDC",
  "BUSD",
  "DAI",
  "FDUSD",
  "TUSD",
  "USDP",
  "USDE",
  "USDD"
]);

const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();

/** True if the symbol is a USD-pegged stable (includes USD itself). */
export function isStable(symbol) {
  return STABLE_ASSETS.has(normalizeSymbol(symbol));
}

/** True if the currency is treated 1:1 with USD for cash aggregation. */
export function isUsdEquivalent(currency) {
  return USD_EQUIVALENTS.has(normalizeSymbol(currency));
}

export { STABLE_ASSETS, USD_EQUIVALENTS };
export default STABLE_ASSETS;
