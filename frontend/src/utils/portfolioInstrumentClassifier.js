// Portfolio instrument classifier (spec §7).
//
// Single source of truth used BEFORE computing value, P&L, allocation,
// concentration, or rebalance output. Maps a holding's symbol / marketType /
// category / instrumentType / type to exactly one exposure bucket:
//
//   Equities | ETFs | Crypto | Commodities | Bonds | FX | Cash | Other
//
// Non-negotiables honored:
//  - ETF is a direct fund exposure; never reclassified as its underlying.
//  - FX pair exposure is separate from cash translation exposure.
//  - Currency *codes* are excluded from portfolio totals unless backed by a
//    real cash balance / broker position (callers enforce via hasRealPosition).
//  - No fabricated valuations.

import { normalizeInstrumentSymbol, resolveCurrencyInstrument } from "./currencyInstruments.js";
import { isStable } from "./stablecoins";

/**
 * classifyPortfolioInstrument — returns one of the canonical buckets.
 * @param {object} holding  { symbol, marketType, category, instrumentType, type, currency, hasRealPosition }
 * @returns {"Equities"|"ETFs"|"Crypto"|"Commodities"|"Bonds"|"FX"|"Cash"|"Other"}
 */
export function classifyPortfolioInstrument(holding = {}) {
  const symbol = String(holding?.symbol || holding?.name || "").trim().toUpperCase();
  const marketType = String(holding?.marketType || holding?.type || "").trim().toLowerCase();
  const category = String(holding?.category || "").trim().toLowerCase();
  const instrumentType = String(holding?.instrumentType || "").trim().toLowerCase();
  const type = String(holding?.type || "").trim().toLowerCase();

  // Stablecoins (by symbol OR explicit tag) are Cash. Symbol-aware so a Binance
  // spot USDT balance (tagged type:"crypto") still reaches the Cash bucket —
  // otherwise it would fall through to "Crypto" and contradict the Holdings-table
  // "Cash" badge and the HomeModule cash split.
  if (isStable(symbol) || type === "stablecoin" || category === "stablecoin") return "Cash";

  // FX pair (e.g. EUR/USD, EURUSD=X) — price-bearing, separate bucket.
  if (instrumentType === "fx-pair" || marketType === "forex" || type === "forex" || type === "fx") {
    const inst = resolveCurrencyInstrument(normalizeInstrumentSymbol(symbol));
    if (inst?.kind === "forex") return "FX";
  }

  // Currency code is research-only unless a real cash/position record backs it.
  if (instrumentType === "currency-code" || type === "currency" || category === "currencies") {
    return holding?.hasRealPosition ? "Cash" : "Other";
  }

  if (["etf", "etfs"].includes(type) || category === "etfs" || instrumentType === "security") return "ETFs";
  if (["stock", "equity", "equities"].includes(type) || marketType === "equity" || category === "stocks") return "Equities";
  if (type === "crypto" || marketType === "spot" || marketType === "perp" || category === "crypto") return "Crypto";
  if (["commodity", "commodities", "metal", "metals", "future", "futures"].includes(type) || category === "commodities") return "Commodities";
  if (type === "bond" || marketType === "bond" || category === "bonds") return "Bonds";
  if (marketType === "cash" || type === "cash") return "Cash";

  return "Other";
}

export const PORTFOLIO_BUCKETS = ["Equities", "ETFs", "Crypto", "Commodities", "Bonds", "FX", "Cash", "Other"];
