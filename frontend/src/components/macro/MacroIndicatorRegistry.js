// MacroIndicatorRegistry — catalog of macro indicators users can watch/pin.
// Drives the Country Watchlist (Objective 9) and informs which panels render.
// kind maps to formatMacroNumber kinds so formatting is consistent everywhere.

export const MACRO_INDICATORS = [
  { code: "GDP", label: "GDP", unit: "", kind: "trillions", group: "Growth", fred: "GDP" },
  { code: "CPI", label: "CPI", unit: "%", kind: "percentage", group: "Inflation", fred: "CPIAUCSL" },
  { code: "INFLATION", label: "Inflation", unit: "%", kind: "percentage", group: "Inflation", fred: "CPIAUCSL" },
  { code: "INTEREST_RATE", label: "Interest Rate", unit: "%", kind: "rate", group: "Policy", fred: "FEDFUNDS" },
  { code: "PMI", label: "PMI", unit: "", kind: "index", group: "Activity", fred: "NAPM" },
  { code: "RETAIL_SALES", label: "Retail Sales", unit: "%", kind: "percentage", group: "Activity", fred: "RSAFS" },
  { code: "MONEY_SUPPLY", label: "Money Supply", unit: "", kind: "trillions", group: "Liquidity", fred: "M2SL" },
  { code: "HOUSING", label: "Housing", unit: "%", kind: "percentage", group: "Activity", fred: "HOUST" },
  { code: "EMPLOYMENT", label: "Employment", unit: "%", kind: "percentage", group: "Labor", fred: "UNRATE" },
  { code: "CURRENT_ACCOUNT", label: "Current Account", unit: "", kind: "billions", group: "External", fred: "BOPBCA" },
  { code: "DEBT", label: "Debt", unit: "", kind: "trillions", group: "Fiscal", fred: "GFDEBTN" },
];

const BY_CODE = Object.fromEntries(MACRO_INDICATORS.map((i) => [i.code, i]));

export function getIndicator(code) {
  return BY_CODE[String(code || "").toUpperCase()] || null;
}

export function indicatorKind(code) {
  return getIndicator(code)?.kind || "decimal";
}

// Default pin set (used when no per-country pins saved yet).
export const DEFAULT_WATCH_PINS = ["GDP", "CPI", "INFLATION", "INTEREST_RATE", "PMI", "EMPLOYMENT"];

export default MACRO_INDICATORS;
