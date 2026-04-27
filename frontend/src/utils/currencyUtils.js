/**
 * Basic currency formatting and conversion utilities for Zenin.
 */

export const CURRENCY_SYMBOLS = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CAD: "C$",
  AUD: "A$",
  CHF: "CHF",
  CNY: "¥",
  BTC: "₿",
  ETH: "Ξ",
  SOL: "SOL",
  HYPE: "H",
};

// Default exchange rates (fallback if not provided by backend)
// To USD
export const DEFAULT_FX_RATES = {
  USD: 1.0,
  EUR: 1.09,
  GBP: 1.27,
  JPY: 0.0066,
  CAD: 0.74,
  AUD: 0.65,
  CHF: 1.13,
  CNY: 0.14,
  BTC: 65000, // Very rough placeholder, ideally comes from spotPrices
  ETH: 3500,
  SOL: 140,
};

export function getCurrencySymbol(currency = "USD") {
  return CURRENCY_SYMBOLS[String(currency).toUpperCase()] || "$";
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
    rate = DEFAULT_FX_RATES[fromKey] || 1.0;
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
    rate = DEFAULT_FX_RATES[toKey] || 1.0;
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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  
  if (compact) {
    if (absNum >= 1e9) formatted = (absNum / 1e9).toFixed(1) + "B";
    else if (absNum >= 1e6) formatted = (absNum / 1e6).toFixed(1) + "M";
    else if (absNum >= 1e3) formatted = (absNum / 1e3).toFixed(1) + "K";
  }
  
  const signStr = sign ? (num >= 0 ? "+" : "-") : (num < 0 ? "-" : "");
  
  return `${signStr}${symbol}${formatted}`;
}
