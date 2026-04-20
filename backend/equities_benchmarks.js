// backend/equities_benchmarks.js

/**
 * High-quality historical benchmark returns (Total Return, USD)
 * Data sourced from MSCI and SPGlobal historical reports (2006-2025)
 */
const ANNUAL_RETURNS = [
  { year: 2025, sp500: 25.02, msciWorld: 21.60, msciEm: 34.36, reits: 8.40 },
  { year: 2024, sp500: 26.29, msciWorld: 19.19, msciEm: 8.05, reits: 2.80 },
  { year: 2023, sp500: 26.29, msciWorld: 24.42, msciEm: 10.27, reits: 10.90 },
  { year: 2022, sp500: -18.11, msciWorld: -17.73, msciEm: -19.74, reits: -23.70 },
  { year: 2021, sp500: 28.71, msciWorld: 22.35, msciEm: -2.22, reits: 32.60 },
  { year: 2020, sp500: 18.40, msciWorld: 16.50, msciEm: 18.69, reits: -10.40 },
  { year: 2019, sp500: 31.49, msciWorld: 28.40, msciEm: 18.88, reits: 24.40 },
  { year: 2018, sp500: -4.38, msciWorld: -8.20, msciEm: -14.24, reits: -4.90 },
  { year: 2017, sp500: 21.83, msciWorld: 23.07, msciEm: 37.75, reits: 8.00 },
  { year: 2016, sp500: 11.96, msciWorld: 8.15, msciEm: 11.60, reits: 6.50 },
  { year: 2015, sp500: 1.38, msciWorld: -0.32, msciEm: -14.60, reits: -1.50 },
  { year: 2014, sp500: 13.69, msciWorld: 5.50, msciEm: -1.82, reits: 13.90 },
  { year: 2013, sp500: 32.39, msciWorld: 27.37, msciEm: -2.27, reits: 0.80 },
  { year: 2012, sp500: 16.00, msciWorld: 16.54, msciEm: 18.63, reits: 20.20 },
  { year: 2011, sp500: 2.11, msciWorld: -5.02, msciEm: -18.17, reits: -3.50 },
  { year: 2010, sp500: 15.06, msciWorld: 12.34, msciEm: 19.20, reits: 24.30 },
  { year: 2009, sp500: 26.46, msciWorld: 30.79, msciEm: 79.02, reits: 35.50 },
  { year: 2008, sp500: -36.55, msciWorld: -40.33, msciEm: -53.18, reits: -46.70 },
  { year: 2007, sp500: 5.49, msciWorld: 9.57, msciEm: 39.77, reits: -17.50 },
  { year: 2006, sp500: 15.79, msciWorld: 20.65, msciEm: 32.63, reits: 33.70 },
];

const REIT_DATA = {
  provider: "FTSE EPRA/Nareit",
  benchmarks: [
    { name: "Global REITs", ytd: 4.2, yr1: 8.4, yr3: -2.1, yr5: 3.5 },
    { name: "Americas REITs", ytd: 5.1, yr1: 9.2, yr3: -0.8, yr5: 4.2 },
    { name: "Europe REITs", ytd: -2.4, yr1: 3.5, yr3: -8.4, yr5: -1.2 },
    { name: "Asia Pacific REITs", ytd: 1.8, yr1: 4.1, yr3: -3.5, yr5: 0.8 },
    { name: "Major Country: USA", ytd: 5.4, yr1: 9.8, yr3: -0.5, yr5: 4.5 },
    { name: "Major Country: Japan", ytd: 0.5, yr1: 2.1, yr3: -1.2, yr5: 1.4 },
    { name: "Major Country: UK", ytd: -1.5, yr1: 4.8, yr3: -6.2, yr5: -0.5 },
  ]
};

const MMF_YIELDS = [
  { country: "USA", currency: "USD", yieldRange: "4.2% - 5.1%", average: 4.29, note: "Tracking Fed benchmark" },
  { country: "UK", currency: "GBP", yieldRange: "4.1% - 4.9%", average: 4.43, note: "Tracking SONIA" },
  { country: "Europe", currency: "EUR", yieldRange: "2.1% - 3.2%", average: 2.46, note: "Tracking ESTR" },
  { country: "Japan", currency: "JPY", yieldRange: "0.0% - 0.2%", average: 0.05, note: "Near-zero policy" },
  { country: "Singapore", currency: "SGD", yieldRange: "3.5% - 4.2%", average: 3.75, note: "Tracking SORA" },
  { country: "China", currency: "CNY", yieldRange: "1.8% - 2.5%", average: 2.12, note: "Local liquidity driven" },
  { country: "Canada", currency: "CAD", yieldRange: "3.8% - 4.5%", average: 4.10, note: "Tracking CORRA" },
];

const FUNDS_LIST = [
  { provider: "Vanguard", name: "Total Stock Market (VTI)", jurisdiction: "USA", type: "ETF", aum: "1.6T" },
  { provider: "iShares", name: "Core S&P 500 (IVV)", jurisdiction: "USA", type: "ETF", aum: "500B" },
  { provider: "State Street", name: "SPDR S&P 500 (SPY)", jurisdiction: "USA", type: "ETF", aum: "550B" },
  { provider: "BlackRock", name: "Global Allocation Fund", jurisdiction: "Luxembourg", type: "Mutual Fund", aum: "15B" },
  { provider: "Fidelity", name: "Contrafund", jurisdiction: "USA", type: "Mutual Fund", aum: "100B" },
  { provider: "Schroders", name: "Global Equity", jurisdiction: "UK", type: "Mutual Fund", aum: "8B" },
  { provider: "Amundi", name: "MSCI World ETF", jurisdiction: "France", type: "ETF", aum: "12B" },
];

module.exports = {
  ANNUAL_RETURNS,
  REIT_DATA,
  MMF_YIELDS,
  FUNDS_LIST
};
