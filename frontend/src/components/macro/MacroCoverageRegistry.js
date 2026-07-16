// MacroCoverageRegistry — per-country coverage tier + indicator counts + cross-asset map.
// Tiers drive Coverage badges (Objective 10) and "Coming Soon" disabling (Objective 1).
// Cross-asset map drives the dynamic Cross-Asset Dashboard (Objective 12).

export const COVERAGE_TIERS = {
  EXCELLENT: { id: "EXCELLENT", label: "Excellent", token: "positive" },
  GOOD: { id: "GOOD", label: "Good", token: "info" },
  PARTIAL: { id: "PARTIAL", label: "Partial", token: "watch" },
  UNAVAILABLE: { id: "UNAVAILABLE", label: "Unavailable", token: "negative" },
};

// 20 supported countries. coverage describes current backend reality:
// - USA: FRED + BLS → Excellent (74 indicators)
// - Major non-USA: World Bank + IMF → Good
// - Smaller: World Bank only → Partial
// (No "Coming Soon" in the initial supported-set; registry can disable others.)
const BASE = {
  USA: { name: "United States", flag: "🇺🇸", tier: "EXCELLENT", indicators: 74, providers: ["FRED", "BLS", "WORLDBANK"] },
  CAN: { name: "Canada", flag: "🇨🇦", tier: "GOOD", indicators: 41, providers: ["WORLDBANK", "OECD"] },
  GBR: { name: "United Kingdom", flag: "🇬🇧", tier: "GOOD", indicators: 48, providers: ["BOE", "WORLDBANK", "OECD"] },
  DEU: { name: "Germany", flag: "🇩🇪", tier: "GOOD", indicators: 46, providers: ["ECB", "WORLDBANK", "OECD"] },
  FRA: { name: "France", flag: "🇫🇷", tier: "GOOD", indicators: 44, providers: ["ECB", "WORLDBANK", "OECD"] },
  ITA: { name: "Italy", flag: "🇮🇹", tier: "GOOD", indicators: 40, providers: ["ECB", "WORLDBANK", "OECD"] },
  ESP: { name: "Spain", flag: "🇪🇸", tier: "GOOD", indicators: 39, providers: ["ECB", "WORLDBANK", "OECD"] },
  NLD: { name: "Netherlands", flag: "🇳🇱", tier: "GOOD", indicators: 37, providers: ["ECB", "WORLDBANK", "OECD"] },
  CHE: { name: "Switzerland", flag: "🇨🇭", tier: "GOOD", indicators: 35, providers: ["WORLDBANK", "OECD"] },
  JPN: { name: "Japan", flag: "🇯🇵", tier: "GOOD", indicators: 47, providers: ["BOJ", "WORLDBANK", "OECD"] },
  KOR: { name: "South Korea", flag: "🇰🇷", tier: "GOOD", indicators: 38, providers: ["WORLDBANK", "OECD"] },
  SGP: { name: "Singapore", flag: "🇸🇬", tier: "GOOD", indicators: 33, providers: ["WORLDBANK", "OECD"] },
  AUS: { name: "Australia", flag: "🇦🇺", tier: "GOOD", indicators: 42, providers: ["WORLDBANK", "OECD"] },
  NZL: { name: "New Zealand", flag: "🇳🇿", tier: "GOOD", indicators: 31, providers: ["WORLDBANK", "OECD"] },
  CHN: { name: "China", flag: "🇨🇳", tier: "GOOD", indicators: 52, providers: ["WORLDBANK", "IMF"] },
  IND: { name: "India", flag: "🇮🇳", tier: "GOOD", indicators: 49, providers: ["WORLDBANK", "IMF"] },
  BRA: { name: "Brazil", flag: "🇧🇷", tier: "GOOD", indicators: 43, providers: ["WORLDBANK", "IMF"] },
  MEX: { name: "Mexico", flag: "🇲🇽", tier: "GOOD", indicators: 36, providers: ["WORLDBANK", "OECD"] },
  ZAF: { name: "South Africa", flag: "🇿🇦", tier: "PARTIAL", indicators: 28, providers: ["WORLDBANK", "IMF"] },
  KEN: { name: "Kenya", flag: "🇰🇪", tier: "PARTIAL", indicators: 18, providers: ["WORLDBANK"] },
  NGA: { name: "Nigeria", flag: "🇳🇬", tier: "PARTIAL", indicators: 16, providers: ["WORLDBANK"] },
};

export const SUPPORTED_COUNTRIES = Object.keys(BASE);

export function getCountryCoverage(code) {
  const c = BASE[String(code || "").toUpperCase()];
  if (!c) return { code, name: code, flag: "🌍", tier: "UNAVAILABLE", indicators: 0, providers: [], available: false };
  return { code, available: true, ...c };
}

export function isCountryAvailable(code) {
  const cov = getCountryCoverage(code);
  return cov.available && cov.tier !== "UNAVAILABLE";
}

export function tierMeta(tierId) {
  return COVERAGE_TIERS[tierId] || COVERAGE_TIERS.PARTIAL;
}

// Dynamic cross-asset map (Objective 12). Keyed by country code.
export const CROSS_ASSET_BY_COUNTRY = {
  USA: ["USD", "SPY", "US10Y", "VIX"],
  CAN: ["CAD", "TSX", "CA10Y"],
  GBR: ["GBP", "UK10Y", "FTSE"],
  DEU: ["EUR", "DAX", "Bund", "EURUSD", "Euro Stoxx"],
  FRA: ["EUR", "CAC", "FR10Y"],
  ITA: ["EUR", "FTSEMIB", "IT10Y"],
  ESP: ["EUR", "IBEX", "ES10Y"],
  NLD: ["EUR", "AEX", "NL10Y"],
  CHE: ["CHF", "SMI", "CH10Y"],
  JPN: ["JPY", "Nikkei", "JGB"],
  KOR: ["KRW", "KOSPI", "KR10Y"],
  SGP: ["SGD", "STI"],
  AUS: ["AUD", "ASX", "AU10Y"],
  NZL: ["NZD", "NZ50"],
  CHN: ["CNY", "CSI300"],
  IND: ["INR", "NIFTY", "IN10Y"],
  BRA: ["BRL", "IBOV", "BR10Y"],
  MEX: ["MXN", "MEXBOL", "MX10Y"],
  ZAF: ["ZAR", "JALSH", "ZA10Y"],
  KEN: ["KES", "NSE20"],
  NGA: ["NGN", "NGSE"],
};

export function getCrossAssets(code) {
  return CROSS_ASSET_BY_COUNTRY[String(code || "").toUpperCase()] || [];
}

export default BASE;
