// Tax Estimator — pure logic, configuration, and calculation helpers.
// Extracted from the former monolithic TaxEstimator.jsx so calculation,
// validation, and rendering are independently testable.
// No React imports here on purpose.

import { formatCurrency } from "../../../utils/currencyUtils";
import { getAppRuntimeConfig } from "../../../config/runtimeConfigStore";

/* ----------------------------------------------------------------------------
 * Runtime configuration accessors
 * ------------------------------------------------------------------------- */

export function getTaxConfig() {
  return getAppRuntimeConfig()?.tax || {};
}

export function getTaxRules() {
  return getTaxConfig().rules || {};
}

export function getTaxRegions() {
  return Array.isArray(getTaxConfig().regions) ? getTaxConfig().regions : [];
}

export function getTaxSources() {
  return Array.isArray(getTaxConfig().sources) ? getTaxConfig().sources : [];
}

export function readStoredAccountantMode() {
  try {
    return JSON.parse(localStorage.getItem("zenin_tax_accountant_mode") || "false") === true;
  } catch {
    return false;
  }
}

export function getDefaultIncomeBreakdown() {
  return getTaxConfig().defaultIncomeBreakdown || {
    salary: 0,
    dividends: 0,
    interest: 0,
    stakingRewards: 0,
    airdrops: 0,
    otherOrdinaryIncome: 0,
  };
}

export function getDefaultAdvancedState() {
  return {
    costBasisMethod: "fifo",
    realizationMode: "realized",
    acquisitionDate: "",
    saleDate: "",
    fees: 0,
    slippage: 0,
    brokerage: 0,
    fxRate: 1,
    currency: "USD",
    lossCarryforward: 0,
    exemptionThreshold: 0,
    foreignTaxPaid: 0,
    withholdingTax: 0,
    residencyStatus: "resident",
    taxRegime: "individual",
    filingStatus: "single",
    maritalStatus: "single",
    notes: "",
    fxSource: "Manual",
  };
}

export function getDefaultScenarioState() {
  return {
    countryA: "USA",
    countryB: "",
    shiftDays: 365,
  };
}

/* ----------------------------------------------------------------------------
 * Gains data structures and math
 * ------------------------------------------------------------------------- */

export function emptyGains() {
  return {
    Equities: { shortTerm: 0, longTerm: 0 },
    Bonds: { standard: 0 },
    "Special Funds": { standard: 0 },
    MMFs: { standard: 0 },
    Crypto: { shortTerm: 0, longTerm: 0 },
  };
}

export function cloneGains(gains = emptyGains()) {
  return {
    Equities: { ...gains.Equities },
    Bonds: { ...gains.Bonds },
    "Special Funds": { ...gains["Special Funds"] },
    MMFs: { ...gains.MMFs },
    Crypto: { ...gains.Crypto },
  };
}

export function totalGainsAmount(gains = emptyGains()) {
  return (
    Number(gains?.Equities?.shortTerm || 0) +
    Number(gains?.Equities?.longTerm || 0) +
    Number(gains?.Crypto?.shortTerm || 0) +
    Number(gains?.Crypto?.longTerm || 0) +
    Number(gains?.Bonds?.standard || 0) +
    Number(gains?.["Special Funds"]?.standard || 0) +
    Number(gains?.MMFs?.standard || 0)
  );
}

export function totalOrdinaryIncome(income = getDefaultIncomeBreakdown()) {
  return Object.values(income || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

export function getHoldingPeriodClass(acquisitionDate, saleDate) {
  if (!acquisitionDate || !saleDate) return null;
  const buyTs = new Date(acquisitionDate).getTime();
  const sellTs = new Date(saleDate).getTime();
  if (!Number.isFinite(buyTs) || !Number.isFinite(sellTs) || sellTs <= buyTs) return null;
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  return sellTs - buyTs >= yearMs ? "longTerm" : "shortTerm";
}

function applyHoldingPeriodOverride(gains, acquisitionDate, saleDate) {
  const classification = getHoldingPeriodClass(acquisitionDate, saleDate);
  if (!classification) return gains;
  const next = cloneGains(gains);
  ["Equities", "Crypto"].forEach((bucket) => {
    const combined = Number(next[bucket].shortTerm || 0) + Number(next[bucket].longTerm || 0);
    next[bucket].shortTerm = classification === "shortTerm" ? combined : 0;
    next[bucket].longTerm = classification === "longTerm" ? combined : 0;
  });
  return next;
}

export function buildAdjustedGains(gains, advanced) {
  const fxRate = Number(advanced?.fxRate || 1);
  const conversionRate = Number.isFinite(fxRate) && fxRate > 0 ? fxRate : 1;
  const next = cloneGains(gains);
  ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
    Object.keys(next[bucket]).forEach((key) => {
      next[bucket][key] = Number(next[bucket][key] || 0) * conversionRate;
    });
  });

  const holdingAdjusted = applyHoldingPeriodOverride(next, advanced?.acquisitionDate, advanced?.saleDate);
  const gross = totalGainsAmount(holdingAdjusted);
  const costs = Math.max(
    0,
    Number(advanced?.fees || 0) + Number(advanced?.slippage || 0) + Number(advanced?.brokerage || 0)
  );

  const positiveBuckets = [
    ["Equities", "shortTerm"],
    ["Equities", "longTerm"],
    ["Crypto", "shortTerm"],
    ["Crypto", "longTerm"],
    ["Bonds", "standard"],
    ["Special Funds", "standard"],
    ["MMFs", "standard"],
  ].map(([bucket, key]) => ({
    bucket,
    key,
    value: Math.max(0, Number(holdingAdjusted?.[bucket]?.[key] || 0)),
  }));

  const positiveTotal = positiveBuckets.reduce((sum, row) => sum + row.value, 0);
  if (positiveTotal > 0 && costs > 0) {
    positiveBuckets.forEach(({ bucket, key, value }) => {
      const share = value / positiveTotal;
      holdingAdjusted[bucket][key] = Number(holdingAdjusted[bucket][key] || 0) - costs * share;
    });
  }

  let adjustedTotal = totalGainsAmount(holdingAdjusted);
  adjustedTotal -= Math.max(0, Number(advanced?.lossCarryforward || 0));
  adjustedTotal -= Math.max(0, Number(advanced?.exemptionThreshold || 0));
  if (String(advanced?.realizationMode || "realized") === "unrealized") {
    adjustedTotal = 0;
  }
  adjustedTotal = Math.max(0, adjustedTotal);

  const postCostTotal = Math.max(0, totalGainsAmount(holdingAdjusted));
  if (postCostTotal > 0 && adjustedTotal >= 0) {
    const scale = adjustedTotal / postCostTotal;
    ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
      const row = holdingAdjusted[bucket];
      Object.keys(row).forEach((key) => {
        row[key] = Number(row[key] || 0) * scale;
      });
    });
  } else if (postCostTotal <= 0 || adjustedTotal === 0) {
    ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
      const row = holdingAdjusted[bucket];
      Object.keys(row).forEach((key) => {
        row[key] = 0;
      });
    });
  }

  return {
    adjustedGains: holdingAdjusted,
    grossTotal: gross,
    netAfterCosts: Math.max(0, gross - costs),
    taxableGain: adjustedTotal,
    totalCosts: costs,
  };
}

export function reducePositiveGainsProportionally(gains, reductionAmount = 0) {
  const next = cloneGains(gains);
  const positiveBuckets = [
    ["Equities", "shortTerm"],
    ["Equities", "longTerm"],
    ["Crypto", "shortTerm"],
    ["Crypto", "longTerm"],
    ["Bonds", "standard"],
    ["Special Funds", "standard"],
    ["MMFs", "standard"],
  ].map(([bucket, key]) => ({
    bucket,
    key,
    value: Math.max(0, Number(next?.[bucket]?.[key] || 0)),
  }));

  const positiveTotal = positiveBuckets.reduce((sum, row) => sum + row.value, 0);
  if (positiveTotal <= 0 || reductionAmount <= 0) return next;

  const appliedReduction = Math.min(positiveTotal, Number(reductionAmount || 0));
  positiveBuckets.forEach(({ bucket, key, value }) => {
    const share = value / positiveTotal;
    next[bucket][key] = Math.max(0, Number(next[bucket][key] || 0) - appliedReduction * share);
  });
  return next;
}

export function normalizeMarketBucket(trade = {}) {
  const marketType = String(trade?.marketType || trade?.market_type || "").toLowerCase();
  const type = String(trade?.type || "").toLowerCase();
  const name = String(trade?.name || "").toLowerCase();
  const symbol = String(trade?.asset || trade?.symbol || "").toLowerCase();
  const raw = `${marketType} ${type} ${name} ${symbol}`;

  if (raw.includes("crypto") || raw.includes("perp") || raw.includes("spot")) return "Crypto";
  if (raw.includes("bond")) return "Bonds";
  if (raw.includes("mmf") || raw.includes("money market")) return "MMFs";
  if (raw.includes("fund") || raw.includes("reit") || raw.includes("structured")) return "Special Funds";
  return "Equities";
}

export function deriveGainsFromTrades(trades = [], costBasisMethod = "fifo") {
  const rows = Array.isArray(trades) ? trades : [];
  const sorted = [...rows]
    .map((trade) => {
      const qty = Math.abs(Number(trade?.quantity) || 0);
      const px = Number(trade?.price);
      const ts = new Date(trade?.executedAt || trade?.executed_at || trade?.date || 0).getTime();
      const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(px) || px < 0) return null;
      if (!Number.isFinite(ts) || ts <= 0) return null;
      const symbol = String(trade?.asset || trade?.symbol || "").toUpperCase();
      const marketType = String(trade?.marketType || trade?.market_type || "").toLowerCase();
      return { ...trade, qty, px, ts, side, symbol, marketType };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);

  const gains = emptyGains();
  const lotsByKey = new Map();

  sorted.forEach((trade) => {
    const key = `${trade.symbol}:${trade.marketType}`;
    const bucket = normalizeMarketBucket(trade);
    const lots = lotsByKey.get(key) || [];

    if (trade.side === "buy") {
      lots.push({ qty: trade.qty, px: trade.px, ts: trade.ts });
      lotsByKey.set(key, lots);
      return;
    }

    let remaining = trade.qty;
    while (remaining > 0 && lots.length > 0) {
      let lotIndex = 0;
      if (costBasisMethod === "lifo") {
        lotIndex = lots.length - 1;
      } else if (costBasisMethod === "hifo") {
        lotIndex = lots.reduce((bestIdx, entry, idx, arr) => (entry.px > arr[bestIdx].px ? idx : bestIdx), 0);
      }
      if (costBasisMethod === "average") {
        const totalQty = lots.reduce((sum, lot) => sum + Number(lot.qty || 0), 0);
        const avgPx =
          totalQty > 0
            ? lots.reduce((sum, lot) => sum + Number(lot.qty || 0) * Number(lot.px || 0), 0) / totalQty
            : trade.px;
        const matchedQty = Math.min(remaining, totalQty);
        const proceeds = matchedQty * trade.px;
        const basis = matchedQty * avgPx;
        const pnl = proceeds - basis;
        const oldestTs = lots.reduce((oldest, lot) => Math.min(oldest, Number(lot.ts || trade.ts)), trade.ts);
        const holdMs = Math.max(0, trade.ts - oldestTs);
        const isLongTerm = holdMs >= 365 * 24 * 60 * 60 * 1000;

        if (bucket === "Crypto" || bucket === "Equities") {
          gains[bucket][isLongTerm ? "longTerm" : "shortTerm"] += pnl;
        } else if (bucket === "Bonds" || bucket === "MMFs" || bucket === "Special Funds") {
          gains[bucket].standard += pnl;
        }

        let toReduce = matchedQty;
        for (let index = 0; index < lots.length && toReduce > 0; index += 1) {
          const reduction = Math.min(toReduce, lots[index].qty);
          lots[index].qty -= reduction;
          toReduce -= reduction;
        }
        for (let index = lots.length - 1; index >= 0; index -= 1) {
          if (lots[index].qty <= 1e-8) lots.splice(index, 1);
        }
        remaining -= matchedQty;
        continue;
      }

      const lot = lots[lotIndex];
      const matchedQty = Math.min(remaining, lot.qty);
      const proceeds = matchedQty * trade.px;
      const basis = matchedQty * lot.px;
      const pnl = proceeds - basis;
      const holdMs = Math.max(0, trade.ts - lot.ts);
      const isLongTerm = holdMs >= 365 * 24 * 60 * 60 * 1000;

      if (bucket === "Crypto" || bucket === "Equities") {
        gains[bucket][isLongTerm ? "longTerm" : "shortTerm"] += pnl;
      } else if (bucket === "Bonds" || bucket === "MMFs" || bucket === "Special Funds") {
        gains[bucket].standard += pnl;
      }

      lot.qty -= matchedQty;
      remaining -= matchedQty;
      if (lot.qty <= 1e-8) lots.splice(lotIndex, 1);
    }

    lotsByKey.set(key, lots);
  });

  return gains;
}

export function calcLiability(key, gains, options = {}) {
  const rule = getTaxRules()[key];
  if (!rule) return { liability: 0, details: {} };
  const { cgRate, stRate } = rule;
  const details = {};
  const ordinaryIncomeTotal = Math.max(0, Number(options?.ordinaryIncomeTotal || 0));
  const totalGains =
    gains.Equities.shortTerm +
    gains.Equities.longTerm +
    gains.Crypto.shortTerm +
    gains.Crypto.longTerm +
    gains.Bonds.standard +
    gains["Special Funds"].standard +
    gains.MMFs.standard;

  if (cgRate === 0 && stRate === 0) {
    details["Total Tax Liability"] = 0;
  } else if (key === "USA") {
    details["Equities STCG"] = Math.max(0, gains.Equities.shortTerm) * stRate;
    details["Equities LTCG"] = Math.max(0, gains.Equities.longTerm) * 0.15;
    details["Crypto STCG"] = Math.max(0, gains.Crypto.shortTerm) * stRate;
    details["Crypto LTCG"] = Math.max(0, gains.Crypto.longTerm) * 0.15;
    details["Bonds"] = Math.max(0, gains.Bonds.standard) * stRate;
    details["Funds / MMFs"] = Math.max(0, gains["Special Funds"].standard + gains.MMFs.standard) * cgRate;
  } else if (key === "India") {
    details["Equities STCG"] = Math.max(0, gains.Equities.shortTerm) * 0.2;
    details["Equities LTCG"] = Math.max(0, gains.Equities.longTerm - 125000) * 0.125;
    details["Crypto Fixed"] = Math.max(0, gains.Crypto.shortTerm + gains.Crypto.longTerm) * 0.3;
    details["Bonds / Funds"] =
      Math.max(0, gains.Bonds.standard + gains["Special Funds"].standard + gains.MMFs.standard) * 0.3;
  } else if (key === "SouthAfrica") {
    const exempt = 40000;
    const net = Math.max(0, totalGains - exempt);
    details["Aggregated CGT (40% inclusion × max bracket)"] = net * cgRate;
  } else {
    details["Total CGT"] = Math.max(0, totalGains) * cgRate;
  }

  if (ordinaryIncomeTotal > 0) {
    details["Ordinary Income Tax"] = ordinaryIncomeTotal * stRate;
  }

  const liability = Object.values(details).reduce((sum, value) => sum + value, 0);
  return { liability, details };
}

/* ----------------------------------------------------------------------------
 * Formatting & display helpers
 * ------------------------------------------------------------------------- */

export function parseDecimalInput(value, fallback = 0) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatMoney(value, currency = "USD", maximumFractionDigits = 2) {
  return formatCurrency(value, currency, { maximumFractionDigits });
}

export function formatSavedTimestamp(value) {
  const timestamp = new Date(value || Date.now());
  if (Number.isNaN(timestamp.getTime())) return "Saved recently";
  return timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function countryFlag(jurisdictionKey) {
  const key = String(jurisdictionKey || "").toUpperCase();
  const map = {
    USA: "🇺🇸",
    UAE: "🇦🇪",
    GERMANY: "🇩🇪",
    SINGAPORE: "🇸🇬",
    UK: "🇬🇧",
    CANADA: "🇨🇦",
    FRANCE: "🇫🇷",
    INDIA: "🇮🇳",
    BRAZIL: "🇧🇷",
    SPAIN: "🇪🇸",
    KENYA: "🇰🇪",
    SOUTHAFRICA: "🇿🇦",
    SOUTH_AFRICA: "🇿🇦",
  };
  return map[key] || "🌐";
}

export function jurisdictionDisplayName(jurisdictionKey, info = {}) {
  if (info?.name) return info.name;
  const key = String(jurisdictionKey || "");
  const map = {
    USA: "United States",
    UK: "United Kingdom",
    UAE: "United Arab Emirates",
    SouthAfrica: "South Africa",
    Kenya: "Kenya",
  };
  return map[key] || key;
}

export function normalizeSavedEstimateEntries(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  if (!rows.length) return [];
  if (rows[0]?.results) return rows;
  if (rows[0]?.jurisdictionKey) {
    return [
      {
        id: `legacy-${rows[0]?.timestamp || Date.now()}`,
        savedAt: rows[0]?.timestamp || new Date().toISOString(),
        label: "Imported legacy saved scenario",
        jurisdictions: rows.map((row) => row.jurisdictionKey).filter(Boolean),
        taxYear: "",
        advanced: null,
        gains: null,
        additionalIncome: null,
        results: rows,
      },
    ];
  }
  return [];
}

export function getDemoGuestState() {
  return {
    jurisdictions: ["USA", "UK", "Kenya", "SouthAfrica", "UAE"],
    gains: {
      Equities: { shortTerm: 52200, longTerm: 96250 },
      Bonds: { standard: 1250 },
      "Special Funds": { standard: 2430 },
      MMFs: { standard: 0 },
      Crypto: { shortTerm: 24810, longTerm: 18120 },
    },
    advanced: {
      ...getDefaultAdvancedState(),
      notes: "Guest workstation seeded from Zenin reference board for demo review.",
    },
    comparisonScenarios: [],
  };
}

// Map the /api/tax/rates payload into the { [country]: { cgRate, stRate } }
// shape calcLiability expects. Defensive: the backend payload shape may nest
// under `rates` or be top-level, and field names vary (cgRate/stRate vs
// capitalGainsRate/shortTermRate). Returns {} when nothing usable is found.
export function normalizeTaxRatesToRules(payload) {
  if (!payload || typeof payload !== "object") return {};
  const candidate = payload.rates && typeof payload.rates === "object" ? payload.rates : payload;
  const rules = {};
  for (const [country, value] of Object.entries(candidate)) {
    if (!value || typeof value !== "object") continue;
    const cgRate =
      Number(value.cgRate != null ? value.cgRate : value.capitalGainsRate != null ? value.capitalGainsRate : value.cgtRate);
    const stRate =
      Number(value.stRate != null ? value.stRate : value.shortTermRate != null ? value.shortTermRate : value.incomeTaxRate);
    if (Number.isFinite(cgRate) && Number.isFinite(stRate)) {
      rules[country] = { cgRate, stRate };
    }
  }
  return rules;
}
