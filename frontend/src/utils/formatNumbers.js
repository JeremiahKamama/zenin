/**
 * Shared number formatting utilities for Zenin.
 *
 * Consolidates the duplicated formatMoney / formatNumber / formatPercent /
 * numberOrZero helpers that were previously copy-pasted across
 * EquityOptionsDesk, AnalyticsModule, ResearchModule, CompanyProfilePage,
 * OptionsCalculator, JournalModule, and others.
 */

export function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatMoney(value, { digits = 2, compact = false, symbol = "$", fallback = "—" } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (compact) {
    const abs = Math.abs(numeric);
    const sign = numeric < 0 ? "-" : "";
    if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${sign}${symbol}${(abs / 1e3).toFixed(2)}K`;
  }
  return `${symbol}${numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function formatNumber(value, digits = 0, { fallback = "—" } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value, digits = 2, { signed = true, fallback = "—" } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const prefix = signed ? (numeric >= 0 ? "+" : "") : "";
  return `${prefix}${numeric.toFixed(digits)}%`;
}

export function formatFixed(value, digits = 2, { suffix = "", fallback = "—" } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return `${numeric.toFixed(digits)}${suffix}`;
}

export function formatSignedValue(value, digits = 2, { fallback = "—" } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(digits)}`;
}
