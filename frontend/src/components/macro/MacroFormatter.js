// MacroFormatter — single source of truth for macro number formatting.
// Auto-compact: never exceed ~4 visible characters before suffix.
// Brand v2: monochrome, no decorative symbols. Suffixes: K / M / B / T.

const COMPACT_SUFFIXES = [
  { factor: 1e12, suffix: "T" },
  { factor: 1e9, suffix: "B" },
  { factor: 1e6, suffix: "M" },
  { factor: 1e3, suffix: "K" },
];

function toFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Compact magnitude formatter: 14.6T, 1.2B, 89.5M, 1.3K, 143.9, 2.95, 0.00
// Spec: 89,450,000 -> 89.5M | 143.86 -> 143.9 | 2.9495 -> 2.95 | 0.0045235 -> 0.00.
// Compact magnitudes: 1 decimal (0 when >=100 to keep <=4 visible chars before suffix).
// Raw >=100: 1 decimal. Raw <100: 2 decimals.
export function formatCompact(value) {
  const n = toFinite(value);
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  for (const { factor, suffix } of COMPACT_SUFFIXES) {
    if (abs >= factor) {
      const scaled = n / factor;
      const d = Math.abs(scaled) >= 100 ? 0 : 1;
      let out = scaled.toFixed(d);
      if (d === 1 && out.endsWith(".0")) out = out.slice(0, -2);
      return `${out}${suffix}`;
    }
  }
  if (abs >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

// Master formatter. kind drives unit + precision.
export function formatMacroNumber(value, opts = {}) {
  const { kind = "decimal", digits, signed = false, currency = "USD" } = opts;
  const n = toFinite(value);
  if (n == null) return "—";
  const sign = signed && n > 0 ? "+" : "";

  switch (kind) {
    case "currency": {
      const compact = formatCompact(Math.abs(n), digits ?? 2);
      const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "JPY" ? "¥" : "";
      return `${n < 0 ? "-" : sign}${symbol}${compact}`;
    }
    case "percentage":
      return `${sign}${n.toFixed(digits ?? 2)}%`;
    case "index":
      return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "bps":
      return `${sign}${Math.round(n).toLocaleString()} bps`;
    case "rate":
      // Yields/rates: 2 decimals + %.
      return `${sign}${n.toFixed(digits ?? 2)}%`;
    case "millions":
      return `${sign}${formatCompact(n * 1e6, digits ?? 1)}`;
    case "billions":
      return `${sign}${formatCompact(n * 1e9, digits ?? 1)}`;
    case "trillions":
      return `${sign}${formatCompact(n * 1e12, digits ?? 1)}`;
    case "decimal":
    default:
      return `${sign}${formatCompact(n, digits ?? 2)}`;
  }
}

// Convenience: signed percentage (used by change columns).
export function formatMacroPercent(value, digits = 2) {
  return formatMacroNumber(value, { kind: "percentage", digits, signed: true });
}

export default formatMacroNumber;
