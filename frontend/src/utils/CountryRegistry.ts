// CountryRegistry.ts — single source of truth for macro country metadata.
// Evolution of the existing MacroCoverageRegistry: adds the per-country series
// taxonomy, provider routing, currency, timezone, and economic calendar key so
// every macro theme (Liquidity/Rates/Growth/Inflation/FX/Central Bank/Trade/Credit)
// can switch real datasets WITHOUT reloading the desk and WITHOUT provider-specific UI.
//
// Reference data only — no market values, no fabricated intelligence.
// Reuses MacroCoverageRegistry for tier/provider/indicator counts to avoid duplication.

import { getCountryCoverage, CROSS_ASSET_BY_COUNTRY } from "../components/macro/MacroCoverageRegistry.js";

// Per-country series taxonomy. Keys are theme families; values are the indicator
// codes the backend /macro/* surface knows. Empty arrays = theme not yet modeled
// for that country (renders an honest "Unavailable" state, never fake data).
type SeriesTaxonomy = {
  gdp?: string[];
  rates?: string[];
  inflation?: string[];
  employment?: string[];
  fx?: string[];
  debt?: string[];
  trade?: string[];
  capitalFlows?: string[];
  bonds?: string[];
  credit?: string[];
  surprise?: string[];
  manufacturing?: string[];
  services?: string[];
  calendar?: string[];
};

// seriesCode → friendly label, shared across countries. The adapter resolves these
// to provider-specific IDs (FRED/Yahoo/World Bank) at fetch time.
export const MACRO_SERIES_LABELS: Record<string, string> = {
  gdp_yoy: "GDP YoY",
  gdp_qoq: "GDP QoQ",
  ip_yoy: "Industrial Production YoY",
  retail_sales_yoy: "Retail Sales YoY",
  pmi_manufacturing: "Manufacturing PMI",
  pmi_services: "Services PMI",
  consumer_conf: "Consumer Confidence",
  leading_index: "Leading Indicators",
  cpi_yoy: "Headline CPI YoY",
  cpi_core_yoy: "Core CPI YoY",
  ppi_yoy: "PPI YoY",
  pce_core_yoy: "Core PCE YoY",
  breakeven_5y: "5Y Breakeven",
  inflation_exp: "Inflation Expectations",
  rate_policy: "Policy Rate",
  yield_2y: "2Y Yield",
  yield_5y: "5Y Yield",
  yield_10y: "10Y Yield",
  yield_30y: "30Y Yield",
  real_yield_10y: "10Y Real Yield",
  curve_2s10s: "2s10s Spread",
  unemployment: "Unemployment Rate",
  payrolls: "Non-Farm Payrolls",
  fed_balance_sheet: "Fed Balance Sheet",
  reverse_repo: "Reverse Repo",
  tga: "Treasury General Account",
  net_liquidity: "Net Liquidity",
  reserve_balances: "Reserve Balances",
  dxy: "Dollar Index (DXY)",
  eur_usd: "EURUSD",
  usd_jpy: "USDJPY",
  gbp_usd: "GBPUSD",
  aud_usd: "AUDUSD",
  usd_cnh: "USDCNH",
  usd_chf: "USDCHF",
  usd_zar: "USDZAR",
  usd_ngn: "USDNGN",
  usd_inr: "USDINR",
  usd_brl: "USDBRL",
  trade_balance: "Trade Balance",
  exports: "Exports",
  imports: "Imports",
  current_account: "Current Account",
  fdi_inflow: "FDI Inflow",
  portfolio_inflow: "Portfolio Inflow",
  sovereign_10y: "10Y Sovereign Yield",
  sovereign_spread: "Sovereign Spread vs US",
  ig_spread: "Investment Grade Spread",
  hy_spread: "High Yield Spread",
  credit_to_gdp: "Credit/GDP",
  econ_surprise: "Economic Surprise Index",
  nfci: "Chicago Fed NFCI",
};

// Country → metadata. Series codes resolve to provider IDs via the adapter.
interface CountryMeta {
  code: string;
  name: string;
  currency: string;
  timezone: string;
  calendarKey: string; // economic calendar geography key
  series: SeriesTaxonomy;
}

const BASE_META: Record<string, Omit<CountryMeta, "code" | "name">> = {
  USA: {
    currency: "USD", timezone: "America/New_York", calendarKey: "US",
    series: { gdp: ["gdp_yoy", "gdp_qoq"], rates: ["rate_policy", "yield_2y", "yield_5y", "yield_10y", "yield_30y", "real_yield_10y", "curve_2s10s"], inflation: ["cpi_yoy", "cpi_core_yoy", "ppi_yoy", "pce_core_yoy", "breakeven_5y", "inflation_exp"], employment: ["unemployment", "payrolls"], fx: ["dxy", "eur_usd", "usd_jpy", "gbp_usd", "aud_usd", "usd_cnh", "usd_chf"], debt: ["fed_balance_sheet", "reverse_repo", "tga", "net_liquidity", "reserve_balances"], trade: ["trade_balance", "exports", "imports", "current_account"], capitalFlows: ["current_account", "fdi_inflow", "portfolio_inflow"], bonds: ["sovereign_10y", "sovereign_spread"], credit: ["ig_spread", "hy_spread", "credit_to_gdp"], surprise: ["econ_surprise"], manufacturing: ["pmi_manufacturing", "ip_yoy"], services: ["pmi_services"], calendar: ["cpi_yoy", "rate_policy", "payrolls"] },
  },
  GBR: {
    currency: "GBP", timezone: "Europe/London", calendarKey: "GB",
    series: { gdp: ["gdp_yoy"], rates: ["rate_policy", "yield_10y"], inflation: ["cpi_yoy", "cpi_core_yoy"], employment: ["unemployment"], fx: ["gbp_usd", "eur_usd"], manufacturing: ["pmi_manufacturing"], services: ["pmi_services"], calendar: ["cpi_yoy", "rate_policy"] },
  },
  DEU: {
    currency: "EUR", timezone: "Europe/Berlin", calendarKey: "DE",
    series: { gdp: ["gdp_yoy"], rates: ["yield_10y"], inflation: ["cpi_yoy", "cpi_core_yoy"], employment: ["unemployment"], fx: ["eur_usd"], manufacturing: ["pmi_manufacturing"], services: ["pmi_services"], calendar: ["cpi_yoy"] },
  },
  JPN: {
    currency: "JPY", timezone: "Asia/Tokyo", calendarKey: "JP",
    series: { gdp: ["gdp_yoy"], rates: ["rate_policy", "yield_10y"], inflation: ["cpi_yoy"], employment: ["unemployment"], fx: ["usd_jpy"], manufacturing: ["pmi_manufacturing"], services: ["pmi_services"], calendar: ["cpi_yoy", "rate_policy"] },
  },
  CAN: {
    currency: "CAD", timezone: "America/Toronto", calendarKey: "CA",
    series: { gdp: ["gdp_yoy"], rates: ["rate_policy", "yield_10y"], inflation: ["cpi_yoy"], employment: ["unemployment"], fx: ["eur_usd"], trade: ["trade_balance", "exports", "imports"], calendar: ["cpi_yoy", "rate_policy"] },
  },
  AUS: {
    currency: "AUD", timezone: "Australia/Sydney", calendarKey: "AU",
    series: { gdp: ["gdp_yoy"], rates: ["rate_policy", "yield_10y"], inflation: ["cpi_yoy"], employment: ["unemployment"], fx: ["aud_usd"], calendar: ["cpi_yoy", "rate_policy"] },
  },
  CHN: {
    currency: "CNY", timezone: "Asia/Shanghai", calendarKey: "CN",
    series: { gdp: ["gdp_yoy"], inflation: ["cpi_yoy"], fx: ["usd_cnh"], trade: ["trade_balance", "exports", "imports"], manufacturing: ["pmi_manufacturing"], services: ["pmi_services"], calendar: ["cpi_yoy", "gdp_yoy"] },
  },
  IND: {
    currency: "INR", timezone: "Asia/Kolkata", calendarKey: "IN",
    series: { gdp: ["gdp_yoy"], inflation: ["cpi_yoy"], fx: ["usd_inr"], trade: ["trade_balance", "exports", "imports"], calendar: ["cpi_yoy"] },
  },
  BRA: {
    currency: "BRL", timezone: "America/Sao_Paulo", calendarKey: "BR",
    series: { gdp: ["gdp_yoy"], rates: ["rate_policy", "yield_10y"], inflation: ["cpi_yoy"], fx: ["usd_brl"], trade: ["trade_balance", "exports", "imports"], calendar: ["cpi_yoy", "rate_policy"] },
  },
  ZAF: {
    currency: "ZAR", timezone: "Africa/Johannesburg", calendarKey: "ZA",
    series: { gdp: ["gdp_yoy"], rates: ["rate_policy"], inflation: ["cpi_yoy"], fx: ["usd_zar"], trade: ["trade_balance", "exports", "imports"], calendar: ["cpi_yoy", "rate_policy"] },
  },
  NGA: {
    currency: "NGN", timezone: "Africa/Lagos", calendarKey: "NG",
    series: { gdp: ["gdp_yoy"], inflation: ["cpi_yoy"], fx: ["usd_ngn"], trade: ["trade_balance", "exports", "imports"], calendar: ["cpi_yoy"] },
  },
  KEN: {
    currency: "KES", timezone: "Africa/Nairobi", calendarKey: "KE",
    series: { gdp: ["gdp_yoy"], inflation: ["cpi_yoy"], fx: ["eur_usd"], trade: ["trade_balance", "exports", "imports"], calendar: ["cpi_yoy"] },
  },
};

// Fallback taxonomy for the remaining supported countries (World Bank / IMF coverage).
const FALLBACK_SERIES: SeriesTaxonomy = {
  gdp: ["gdp_yoy"], inflation: ["cpi_yoy"], rates: ["rate_policy"],
  employment: ["unemployment"], manufacturing: ["pmi_manufacturing"], services: ["pmi_services"],
  trade: ["trade_balance", "exports", "imports"], fx: ["eur_usd"],
};

function buildCountry(code: string): CountryMeta {
  const cov = getCountryCoverage(code);
  const base = BASE_META[String(code).toUpperCase()];
  return {
    code: String(code).toUpperCase(),
    name: cov.name,
    currency: base?.currency || "USD",
    timezone: base?.timezone || "UTC",
    calendarKey: base?.calendarKey || String(code).toUpperCase(),
    series: base?.series || FALLBACK_SERIES,
  };
}

export function getCountryMeta(code: string): CountryMeta {
  return buildCountry(code);
}

// All series codes for a country across every theme — used to fan out a single
// country switch into real dataset loads (Phase 2 real-data switching).
export function getCountrySeriesCodes(code: string): string[] {
  const meta = buildCountry(code);
  return Array.from(new Set(Object.values(meta.series).flat()));
}

// Series label lookup (adapter-agnostic).
export function getSeriesLabel(code: string): string {
  return MACRO_SERIES_LABELS[String(code)] || MACRO_SERIES_LABELS[String(code).toLowerCase()] || String(code);
}

// Cross-asset symbols for a country (re-export from coverage registry).
export function getCountryCrossAssets(code: string): string[] {
  return CROSS_ASSET_BY_COUNTRY[String(code).toUpperCase()] || [];
}

// Themes that have at least one series for a country (drives collapsible panels).
export function getCountryThemes(code: string): string[] {
  const meta = buildCountry(code);
  return Object.entries(meta.series)
    .filter(([, codes]) => (codes || []).length > 0)
    .map(([theme]) => theme);
}

export const SUPPORTED_MACRO_COUNTRIES = Object.keys(BASE_META);
export default getCountryMeta;
