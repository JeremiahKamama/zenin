// =============================================================================
// Shared formatters for Portfolio Intelligence modules.
// Pure, presentation-only helpers (no React, no color). Kept here so every
// module renders numbers identically and we don't thread 10 helpers through
// props from PortfolioModule.
// =============================================================================

export function formatMoney(value, currency = "USD", opts = {}) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const sign = opts.sign && amount > 0 ? "+" : "";
  try {
    return `${sign}${new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "USD").toUpperCase(),
      maximumFractionDigits: opts.maximumFractionDigits != null ? opts.maximumFractionDigits : 2,
      minimumFractionDigits: opts.minimumFractionDigits != null ? opts.minimumFractionDigits : 0,
    }).format(Math.abs(amount))}`;
  } catch {
    return `${sign}${amount.toFixed(2)}`;
  }
}

export function formatSignedMoney(value, currency = "USD") {
  return formatMoney(value, currency, { sign: true });
}

export function formatPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(digits)}%`;
}

export function formatSignedPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num > 0 ? "+" : ""}${num.toFixed(digits)}%`;
}

export function formatBps(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return `${num > 0 ? "+" : ""}${num.toFixed(digits)} bps`;
}

export function formatQuantity(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString(undefined, { maximumFractionDigits: amount < 1 ? 8 : 4 });
}

export function formatTimestamp(value) {
  const ts = new Date(value || Date.now());
  if (Number.isNaN(ts.getTime())) return "Unknown time";
  return ts.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatRelativeTime(value) {
  const ts = new Date(value || 0).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatTimestamp(value);
}

export function formatProgress(pct) {
  const num = Number(pct);
  if (!Number.isFinite(num)) return "0%";
  return `${Math.round(num * 100)}%`;
}
