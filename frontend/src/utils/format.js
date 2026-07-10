/**
 * Zenin — canonical number-formatting utilities (Phase 5: Financial Data Standards).
 *
 * Every financial figure in the app MUST be formatted through one of these
 * helpers. No module may hand-roll `toFixed`/`toLocaleString` for money,
 * percentages, ratios, or volumes — that is exactly the drift this design
 * system removes. Keep formatting in one place so precision and locale rules
 * stay consistent across Portfolio, Journal, Research, Options, Analytics, Tax.
 *
 * Conventions (per Brandv2 + the plan's "Number Formatting Standards"):
 *   - prices / currency   → 2dp (JPY/KRW/CLP/VND 0dp), grouped
 *   - percent             → 2dp with explicit sign option
 *   - ratios              → 2dp (no symbol)
 *   - volume              → grouped integer, compact past 1e6
 *   - market cap          → compact (B/T)
 *   - mono is applied at the component layer (`.numeric`, `MetricCard`) — these
 *     helpers only return the string; they do NOT set font.
 */

const COMPACT_UNITS = [
  { value: 1e12, symbol: "T" },
  { value: 1e9, symbol: "B" },
  { value: 1e6, symbol: "M" },
  { value: 1e3, symbol: "K" },
];

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "CLP", "VND"]);

function safeNum(value) {
  const n = typeof value === "string" ? Number(value.replace(/[, ]/g, "")) : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** Group an integer with thousands separators without forcing decimals. */
function groupInteger(n) {
  return Math.trunc(n).toLocaleString("en-US");
}

/**
 * Price / Currency formatter.
 * @param {number|string} value
 * @param {Object} [opts]
 * @param {string} [opts.currency="USD"] - ISO code; drives symbol + zero-decimal rules.
 * @param {boolean} [opts.sign=false] - prefix explicit +/- for signed context.
 * @param {boolean} [opts.compact=false] - render 1.2B / 3.4M instead of full grouping.
 * @param {string} [opts.symbol] - override the currency symbol (e.g. already resolved).
 */
export function formatCurrency(value, opts = {}) {
  const { currency = "USD", sign = false, compact = false, symbol } = opts;
  const n = safeNum(value);
  if (Number.isNaN(n)) return symbol || "$0.00";

  const zeroDp = ZERO_DECIMAL_CURRENCIES.has(String(currency).toUpperCase());
  const dp = zeroDp ? 0 : 2;
  const sym = symbol != null ? symbol : currencySymbol(currency);

  if (compact) {
    const c = compactNumber(n, dp);
    return `${sign && n !== 0 ? signPrefix(n) : ""}${sym}${c}`;
  }

  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return `${sign ? signPrefix(n) : n < 0 ? "-" : ""}${sym}${body}`;
}

/** Currency symbol resolver. Mirrors currencyUtils.getCurrencySymbol without
 *  forcing a runtime-config import dependency on this leaf module. */
export function currencySymbol(currency = "USD") {
  const code = String(currency || "").trim().toUpperCase();
  const MAP = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", KRW: "₩", CNY: "¥", CHF: "Fr",
    CAD: "C$", AUD: "A$", HKD: "HK$", INR: "₹", BRL: "R$", MXN: "MX$",
    SEK: "kr", NOK: "kr", DKK: "kr", SGD: "S$", AED: "د.إ", ZAR: "R",
  };
  if (!code) return "$";
  return MAP[code] || `${code} `;
}

function signPrefix(n) {
  return n > 0 ? "+" : n < 0 ? "-" : "";
}

/**
 * Percent formatter.
 * @param {number|string} value - already a percentage number (e.g. 12.4 → "12.4%").
 * @param {Object} [opts]
 * @param {boolean} [opts.sign=false] - prefix explicit +/-.
 * @param {number} [opts.precision=2]
 */
export function formatPercent(value, opts = {}) {
  const { sign = false, precision = 2 } = opts;
  const n = safeNum(value);
  if (Number.isNaN(n)) return "0%";
  const body = Math.abs(n).toFixed(precision);
  return `${sign ? signPrefix(n) : n < 0 ? "-" : ""}${body}%`;
}

/** Ratio / multiple (P/E, debt/equity, beta). 2dp, no symbol. */
export function formatRatio(value, opts = {}) {
  const { precision = 2, sign = false } = opts;
  const n = safeNum(value);
  if (Number.isNaN(n)) return "0.00";
  const body = Math.abs(n).toFixed(precision);
  return `${sign ? signPrefix(n) : n < 0 ? "-" : ""}${body}`;
}

/** Volume / share count — grouped integer, compact above 1e6. */
export function formatVolume(value, opts = {}) {
  const { compact = true } = opts;
  const n = safeNum(value);
  if (Number.isNaN(n)) return "0";
  if (compact && Math.abs(n) >= 1e6) return `${compactNumber(n, 2)}`;
  return groupInteger(n);
}

/** Market cap — always compact (B/T). */
export function formatMarketCap(value) {
  const n = safeNum(value);
  if (Number.isNaN(n)) return "—";
  return compactNumber(n, 2);
}

/** Compact magnitude (e.g. 1.28B, 340.0M, 12.4K). */
export function compactNumber(value, precision = 2) {
  const n = safeNum(value);
  if (Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  for (const { value: v, symbol } of COMPACT_UNITS) {
    if (abs >= v) {
      const scaled = n / v;
      return `${scaled.toFixed(precision).replace(/\.0+$/, "")}${symbol}`;
    }
  }
  return n.toFixed(precision).replace(/\.0+$/, "");
}

/** Millions helper (e.g. revenue in $M). */
export function formatMillions(value, precision = 1) {
  const n = safeNum(value);
  if (Number.isNaN(n)) return "0M";
  return `${compactNumber(n / 1e6, precision)}M`;
}

/** Billions helper. */
export function formatBillions(value, precision = 2) {
  const n = safeNum(value);
  if (Number.isNaN(n)) return "0B";
  return `${compactNumber(n / 1e9, precision)}B`;
}

/** Trillions helper. */
export function formatTrillions(value, precision = 2) {
  const n = safeNum(value);
  if (Number.isNaN(n)) return "0T";
  return `${compactNumber(n / 1e12, precision)}T`;
}

/** Signed change helper for prices/returns — returns { text, tone } so the
 *  caller can apply positive/negative tokens without re-deriving sign. */
export function signedChange(value, opts = {}) {
  const n = safeNum(value);
  if (Number.isNaN(n)) return { text: "0", tone: "neutral" };
  const tone = n > 0 ? "positive" : n < 0 ? "negative" : "neutral";
  const text = opts.currency
    ? formatCurrency(value, { currency: opts.currency, sign: true })
    : opts.percent
      ? formatPercent(value, { sign: true })
      : `${signPrefix(n)}${Math.abs(n).toLocaleString("en-US", {
          minimumFractionDigits: opts.precision ?? 2,
          maximumFractionDigits: opts.precision ?? 2,
        })}`;
  return { text, tone };
}

export const formatters = {
  currency: formatCurrency,
  percent: formatPercent,
  ratio: formatRatio,
  volume: formatVolume,
  marketCap: formatMarketCap,
  millions: formatMillions,
  billions: formatBillions,
  trillions: formatTrillions,
  compact: compactNumber,
  signedChange,
};
