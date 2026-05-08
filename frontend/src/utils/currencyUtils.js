/**
 * Basic currency formatting and conversion utilities for Zenin.
 */
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";

function getCurrencySymbolsMap() {
  return getAppRuntimeConfig()?.currency?.symbols || {};
}

function getForexQuoteCurrencyMap() {
  return getAppRuntimeConfig()?.currency?.forexQuoteCurrency || {};
}

function getDefaultFxRatesMap() {
  return getAppRuntimeConfig()?.currency?.defaultFxRates || { USD: 1 };
}

const dynamicConfigProxyHandler = (resolver) => ({
  get(_target, prop) {
    if (typeof prop === "symbol") return undefined;
    return resolver()?.[prop];
  },
  ownKeys() {
    return Reflect.ownKeys(resolver() || {});
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  }
});

export const CURRENCY_SYMBOLS = new Proxy({}, dynamicConfigProxyHandler(getCurrencySymbolsMap));
export const DEFAULT_FX_RATES = new Proxy({}, dynamicConfigProxyHandler(getDefaultFxRatesMap));

export function getCurrencySymbol(currency = "USD") {
  const code = String(currency || "").trim().toUpperCase();
  if (!code) return "$";
  return getCurrencySymbolsMap()[code] || `${code} `;
}

export function inferAssetCurrency(assetOrSymbol, fallback = "USD") {
  const asset = assetOrSymbol && typeof assetOrSymbol === "object" ? assetOrSymbol : null;
  const directCurrency = String(asset?.currency || asset?.quotedCurrency || "").trim().toUpperCase();
  if (directCurrency) return directCurrency;

  const symbol = String(asset ? asset.symbol || "" : assetOrSymbol || "").trim().toUpperCase();
  if (!symbol) return fallback;

  const forexQuoteCurrency = getForexQuoteCurrencyMap();
  if (forexQuoteCurrency[symbol]) return forexQuoteCurrency[symbol];

  if (symbol.includes("/")) {
    const [, quote] = symbol.split("/");
    if (quote && quote.length === 3) return quote;
  }

  if (symbol.length === 6 && /^[A-Z]+$/.test(symbol)) {
    return symbol.slice(3);
  }

  if (symbol.endsWith(".T")) return "JPY";
  if (symbol.endsWith(".L")) return "GBP";
  if ([".DE", ".F", ".PA", ".MI", ".VI", ".AS", ".BR", ".LI", ".MC"].some((ext) => symbol.endsWith(ext))) return "EUR";
  if ([".TO", ".V"].some((ext) => symbol.endsWith(ext))) return "CAD";
  if (symbol.endsWith(".AX")) return "AUD";
  if (symbol.endsWith(".HK")) return "HKD";
  if ([".KS", ".KQ"].some((ext) => symbol.endsWith(ext))) return "KRW";
  if ([".SZ", ".SS"].some((ext) => symbol.endsWith(ext))) return "CNY";
  if (symbol.endsWith(".TW")) return "TWD";
  if ([".BO", ".NS"].some((ext) => symbol.endsWith(ext))) return "INR";
  if (symbol.endsWith(".SW")) return "CHF";
  if (symbol.endsWith(".MX")) return "MXN";
  if (symbol.endsWith(".SA")) return "BRL";
  if (symbol.endsWith(".AE")) return "AED";

  return fallback;
}

/**
 * Updates the persistent FX rate cache in localStorage.
 * @param {Object} newRates - Map of currency codes to USD rates.
 */
export function updateFXRates(newRates) {
  if (!newRates || typeof newRates !== "object") return;
  try {
    const stored = localStorage.getItem("zenin_fx_rates");
    const current = stored ? JSON.parse(stored) : {};
    const updated = { ...current, ...newRates };
    localStorage.setItem("zenin_fx_rates", JSON.stringify(updated));
  } catch (e) {
    console.warn("Failed to update FX rate cache:", e);
  }
}

/**
 * Converts a value from a source currency to a target currency (default USD).
 * @param {number} value - The numeric value.
 * @param {string} from - Source currency code (e.g., "EUR").
 * @param {Object} rates - Optional map of FX rates to USD (e.g. spotPrices).
 * @returns {number} - Converted value in USD.
 */
export function convertToUSD(value, from = "USD", rates = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  
  const fromKey = String(from).toUpperCase();
  if (fromKey === "USD") return num;

  // 1) Use provided live rates (e.g. spotPrices from App state)
  let rate = rates[fromKey];

  // 2) Fallback to localStorage (last fetched data)
  if (rate == null) {
    try {
      const stored = localStorage.getItem("zenin_fx_rates");
      const cached = stored ? JSON.parse(stored) : {};
      rate = cached[fromKey];
    } catch (e) {
      // ignore
    }
  }

  // 3) Final fallback to hardcoded defaults
  if (rate == null) {
    rate = getDefaultFxRatesMap()[fromKey] || 1.0;
  }
  
  return num * rate;
}

/**
 * Converts a value from USD to a target currency.
 * @param {number} value - The numeric value in USD.
 * @param {string} to - Target currency code (e.g., "EUR").
 * @param {Object} rates - Optional map of FX rates to USD.
 * @returns {number} - Converted value.
 */
export function convertFromUSD(value, to = "USD", rates = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  
  const toKey = String(to).toUpperCase();
  if (toKey === "USD") return num;

  // Find the rate (X to USD)
  let rate = rates[toKey];
  if (rate == null) {
    try {
      const stored = localStorage.getItem("zenin_fx_rates");
      const cached = stored ? JSON.parse(stored) : {};
      rate = cached[toKey];
    } catch (e) {
      // ignore
    }
  }
  if (rate == null) {
    rate = getDefaultFxRatesMap()[toKey] || 1.0;
  }
  
  // value_usd = value_x * rate  => value_x = value_usd / rate
  return rate !== 0 ? num / rate : 0;
}

/**
 * Formats a numeric value with its appropriate currency symbol.
 * @param {number} value 
 * @param {string} currency 
 * @param {Object} options 
 * @returns {string}
 */
export function formatCurrency(value, currency = "USD", options = {}) {
  const num = Number(value);
  const { sign = false, compact = false } = options;
  
  if (!Number.isFinite(num)) return `${getCurrencySymbol(currency)}0.00`;
  
  const absNum = Math.abs(num);
  const symbol = getCurrencySymbol(currency);
  
  let formatted = absNum.toLocaleString(undefined, {
    minimumFractionDigits: (currency === "JPY" || currency === "KRW" || currency === "CLP" || currency === "VND") ? 0 : 2,
    maximumFractionDigits: (currency === "JPY" || currency === "KRW" || currency === "CLP" || currency === "VND") ? 0 : 2,
  });
  
  if (compact) {
    if (absNum >= 1e9) formatted = (absNum / 1e9).toFixed(1) + "B";
    else if (absNum >= 1e6) formatted = (absNum / 1e6).toFixed(1) + "M";
    else if (absNum >= 1e3) formatted = (absNum / 1e3).toFixed(1) + "K";
  }
  
  const signStr = sign ? (num >= 0 ? "+" : "-") : (num < 0 ? "-" : "");
  
  return `${signStr}${symbol}${formatted}`;
}
