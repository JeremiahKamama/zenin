// macro/seriesResolver.js — maps logical series codes (CountryRegistry taxonomy)
// to the backend's real /macro/timeseries indicator codes.
//
// CountryRegistry uses fine-grained logical codes (yield_2y, cpi_core_yoy,
// fed_balance_sheet) so the UI can express intent. The backend /macro/timeseries
// endpoint only knows the coarse MacroIndicatorRegistry codes (GDP, CPI, INFLATION,
// INTEREST_RATE, PMI, RETAIL_SALES, MONEY_SUPPLY, HOUSING, EMPLOYMENT,
// CURRENT_ACCOUNT, DEBT). This resolver is the single translation layer — the
// adapter calls it, never the components. Series with no backend equivalent
// resolve to null → the module renders an honest "Unavailable" (never fake data).

// logicalCode -> backend indicator code (or null when the backend has no series yet).
const LOGICAL_TO_INDICATOR = {
  // Growth
  gdp_yoy: "GDP",
  gdp_qoq: "GDP",
  ip_yoy: "PMI",
  retail_sales_yoy: "RETAIL_SALES",
  pmi_manufacturing: "PMI",
  pmi_services: "PMI",
  consumer_conf: null,
  leading_index: null,
  // Inflation
  cpi_yoy: "CPI",
  cpi_core_yoy: "INFLATION",
  ppi_yoy: null,
  pce_core_yoy: "INFLATION",
  breakeven_5y: null,
  inflation_exp: null,
  // Rates
  rate_policy: "INTEREST_RATE",
  yield_2y: "INTEREST_RATE",
  yield_5y: "INTEREST_RATE",
  yield_10y: "INTEREST_RATE",
  yield_30y: "INTEREST_RATE",
  real_yield_10y: null,
  curve_2s10s: null,
  // Labor
  unemployment: "EMPLOYMENT",
  payrolls: "EMPLOYMENT",
  // Liquidity
  fed_balance_sheet: "MONEY_SUPPLY",
  reverse_repo: null,
  tga: null,
  net_liquidity: "MONEY_SUPPLY",
  reserve_balances: null,
  // External / Trade
  trade_balance: "CURRENT_ACCOUNT",
  exports: null,
  imports: null,
  current_account: "CURRENT_ACCOUNT",
  fdi_inflow: "CURRENT_ACCOUNT",
  portfolio_inflow: null,
  // Sovereign bonds / credit / surprise — no backend series yet → honest Unavailable
  sovereign_10y: null,
  sovereign_spread: null,
  ig_spread: null,
  hy_spread: null,
  credit_to_gdp: null,
  econ_surprise: null,
  // Fiscal
  debt: "DEBT",
};

// Resolve a logical series code to a backend indicator code, or null if unmapped.
export function resolveIndicatorCode(logicalCode) {
  const key = String(logicalCode || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOGICAL_TO_INDICATOR, key)
    ? LOGICAL_TO_INDICATOR[key]
    : null;
}

// True when a logical code has a real backend series behind it.
export function isResolvable(logicalCode) {
  return resolveIndicatorCode(logicalCode) != null;
}

export default resolveIndicatorCode;
