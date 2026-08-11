// stablecoins.js
//
// Single source of truth for stablecoin classification in the backend.
// Previously the membership list was duplicated across exchangeSync.js,
// database.js, and unifiedPortfolio.js with divergent membership — notably
// unifiedPortfolio.USD_EQUIVALENTS was {USD, USDC} only (no USDT), so a USDT
// cash row was flagged `missing_fx` and silently dropped from the headline.
// Importing from here keeps every consumer in agreement.
//
// A matching frontend mirror lives at frontend/src/utils/stablecoins.js.
// Keep the two lists identical when adding/removing a stable.

// Canonical stable asset symbols (uppercase). Includes USD for convenience so a
// single `isStable(symbol)` check covers the fiat peg too.
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

// Currencies treated 1:1 with the USD workspace base currency for FX purposes
// (rate = 1, no FX lookup). Depeg risk is a known simplification at the headline
// level; per-asset realized P&L still uses real fills.
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

// Quote currencies that price assets in USD-like terms (used when recognizing
// which leg of a pair is the "cash" leg). Broader than USD_EQUIVALENTS so we
// don't accidentally treat an obscure stable as a volatile quote.
const USD_LIKE_QUOTES = ["USD", "USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP"];

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

/** True if the symbol/currency is a USD-pegged stable (includes USD itself). */
function isStable(symbol) {
  return STABLE_ASSETS.has(normalizeSymbol(symbol));
}

/** True if the currency converts 1:1 with USD for FX/headline purposes. */
function isUsdEquivalent(currency) {
  return USD_EQUIVALENTS.has(normalizeSymbol(currency));
}

module.exports = {
  STABLE_ASSETS,
  USD_EQUIVALENTS,
  USD_LIKE_QUOTES,
  isStable,
  isUsdEquivalent,
  normalizeStableSymbol: normalizeSymbol
};
