import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCurrency, convertToUSD, convertFromUSD } from "../utils/currencyUtils";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { DensePanelHeader, GuidedEmptyState, InlineControlGroup, RightRailDrawer } from "./CompactWorkspaceUI";
import { TaxCompliancePanel } from "./InstitutionalPanels";
import { buildTaxEstimatorLedger, summarizeLedgerToGains } from "../utils/taxEstimatorLedger";

function getTaxConfig() {
  return getAppRuntimeConfig()?.tax || {};
}

function getTaxRules() {
  return getTaxConfig().rules || {};
}

function getTaxRegions() {
  return Array.isArray(getTaxConfig().regions) ? getTaxConfig().regions : [];
}

function getTaxSources() {
  return Array.isArray(getTaxConfig().sources) ? getTaxConfig().sources : [];
}

function readStoredAccountantMode() {
  try {
    return JSON.parse(localStorage.getItem("zenin_tax_accountant_mode") || "false") === true;
  } catch {
    return false;
  }
}

function getDefaultIncomeBreakdown() {
  return getTaxConfig().defaultIncomeBreakdown || {
    salary: 0,
    dividends: 0,
    interest: 0,
    stakingRewards: 0,
    airdrops: 0,
    otherOrdinaryIncome: 0,
  };
}

function getDefaultAdvancedState() {
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

function getDefaultScenarioState() {
  return {
    countryA: "USA",
    countryB: "",
    shiftDays: 365,
  };
}

function emptyGains() {
  return {
    Equities: { shortTerm: 0, longTerm: 0 },
    Bonds: { standard: 0 },
    "Special Funds": { standard: 0 },
    MMFs: { standard: 0 },
    Crypto: { shortTerm: 0, longTerm: 0 },
  };
}

function cloneGains(gains = emptyGains()) {
  return {
    Equities: { ...gains.Equities },
    Bonds: { ...gains.Bonds },
    "Special Funds": { ...gains["Special Funds"] },
    MMFs: { ...gains.MMFs },
    Crypto: { ...gains.Crypto },
  };
}

function totalGainsAmount(gains = emptyGains()) {
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

function totalOrdinaryIncome(income = getDefaultIncomeBreakdown()) {
  return Object.values(income || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function normalizeSavedEstimateEntries(raw) {
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

function formatSavedTimestamp(value) {
  const timestamp = new Date(value || Date.now());
  if (Number.isNaN(timestamp.getTime())) return "Saved recently";
  return timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getHoldingPeriodClass(acquisitionDate, saleDate) {
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

function buildAdjustedGains(gains, advanced) {
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

function reducePositiveGainsProportionally(gains, reductionAmount = 0) {
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

function normalizeMarketBucket(trade = {}) {
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

function deriveGainsFromTrades(trades = [], costBasisMethod = "fifo") {
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

function calcLiability(key, gains, options = {}) {
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

function parseDecimalInput(value, fallback = 0) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value, currency = "USD", maximumFractionDigits = 2) {
  return formatCurrency(value, currency, { maximumFractionDigits });
}

function countryFlag(jurisdictionKey) {
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

function jurisdictionDisplayName(jurisdictionKey, info = {}) {
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

function getDemoGuestState() {
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

export function TaxEstimator({ trades = [], portfolio = [], spotPrices = {} }) {
  const searchParams = new URLSearchParams(globalThis?.location?.search || "");
  const isGuestDemo = searchParams.get("guest") === "1";
  const guestDemoState = useMemo(() => getDemoGuestState(), []);
  const taxConfig = getTaxConfig();
  const taxRules = getTaxRules();
  const taxRegions = getTaxRegions();
  const taxSources = getTaxSources();
  const taxRulesLastUpdated = String(taxConfig.lastUpdated || "");
  const defaultIncomeBreakdown = getDefaultIncomeBreakdown();
  const defaultAdvancedState = useMemo(() => getDefaultAdvancedState(), []);
  const importInputRef = useRef(null);

  const [jurisdictions, setJurisdictions] = useState(() =>
    isGuestDemo ? guestDemoState.jurisdictions : ["USA"]
  );
  const [jurisdictionSearch, setJurisdictionSearch] = useState("");
  const [activeRegion, setActiveRegion] = useState("All");
  const [taxYear, setTaxYear] = useState("2026");
  const [gains, setGains] = useState(() =>
    isGuestDemo ? guestDemoState.gains : emptyGains()
  );
  const [hasManualGainEdit, setHasManualGainEdit] = useState(isGuestDemo);
  const [results, setResults] = useState([]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);
  const [showSavedScenarios, setShowSavedScenarios] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState("");
  const [additionalIncome, setAdditionalIncome] = useState(defaultIncomeBreakdown);
  const [scenario, setScenario] = useState(getDefaultScenarioState());
  const [comparisonScenarios, setComparisonScenarios] = useState(() =>
    isGuestDemo ? guestDemoState.comparisonScenarios : []
  );
  const [advanced, setAdvanced] = useState(() =>
    isGuestDemo ? guestDemoState.advanced : defaultAdvancedState
  );
  const [ledgerOverrides, setLedgerOverrides] = useState({});
  const [fileName, setFileName] = useState("");
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [formNotice, setFormNotice] = useState("");
  const [formNoticeTone, setFormNoticeTone] = useState("warning");
  const [showRuleDetails, setShowRuleDetails] = useState(false);
  const [showUtilities, setShowUtilities] = useState(false);
  const [accountantMode, setAccountantMode] = useState(() => readStoredAccountantMode());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("zenin_tax_estimates") || "[]");
      setSavedEstimates(normalizeSavedEstimateEntries(saved));
      const trail = JSON.parse(localStorage.getItem("zenin_tax_audit_trail") || "[]");
      setAuditTrail(Array.isArray(trail) ? trail : []);
    } catch {
      setSavedEstimates([]);
      setAuditTrail([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncAccountantMode = () => {
      setAccountantMode(readStoredAccountantMode());
    };
    window.addEventListener("storage", syncAccountantMode);
    window.addEventListener("zenin:tax-accountant-mode", syncAccountantMode);
    return () => {
      window.removeEventListener("storage", syncAccountantMode);
      window.removeEventListener("zenin:tax-accountant-mode", syncAccountantMode);
    };
  }, []);

  useEffect(() => {
    const locale = String(globalThis?.navigator?.language || "").toLowerCase();
    if (locale.includes("us")) setDetectedCountry("USA");
    else if (locale.includes("gb")) setDetectedCountry("UK");
    else if (locale.includes("ca")) setDetectedCountry("Canada");
    else if (locale.includes("de")) setDetectedCountry("Germany");
    else if (locale.includes("fr")) setDetectedCountry("France");
    else setDetectedCountry("USA");
  }, []);

  useEffect(() => {
    if (!detectedCountry || jurisdictions.length > 0) return;
    if (taxRules[detectedCountry]) setJurisdictions([detectedCountry]);
  }, [detectedCountry, jurisdictions.length, taxRules]);

  useEffect(() => {
    if (hasManualGainEdit) return;
    if (!Array.isArray(trades) || trades.length === 0) return;
    setGains(deriveGainsFromTrades(trades, advanced.costBasisMethod));
  }, [trades, hasManualGainEdit, advanced.costBasisMethod]);

  const ordinaryIncomeTotal = useMemo(() => totalOrdinaryIncome(additionalIncome), [additionalIncome]);

  const ledgerSections = useMemo(
    () =>
      buildTaxEstimatorLedger({
        trades,
        portfolio,
        spotPrices,
        gains,
        advanced,
        overrides: ledgerOverrides,
      }),
    [advanced, gains, ledgerOverrides, portfolio, spotPrices, trades]
  );

  const effectiveGains = useMemo(() => summarizeLedgerToGains(ledgerSections), [ledgerSections]);

  const filteredJurisdictions = useMemo(
    () =>
      Object.entries(taxRules).filter(([key, info]) => {
        const matchSearch =
          info.name.toLowerCase().includes(jurisdictionSearch.toLowerCase()) ||
          key.toLowerCase().includes(jurisdictionSearch.toLowerCase());
        const matchRegion = activeRegion === "All" || info.region === activeRegion;
        return matchSearch && matchRegion;
      }),
    [activeRegion, jurisdictionSearch, taxRules]
  );

  const summaryPreview = useMemo(() => {
    const { adjustedGains, grossTotal, taxableGain, netAfterCosts, totalCosts } = buildAdjustedGains(
      effectiveGains,
      advanced
    );
    const first = jurisdictions[0] || "USA";
    const targetCurrency = taxRules[first]?.currency || "USD";
    const inputCurrency = advanced.currency || "USD";
    const toUSDRate = inputCurrency === "USD" ? 1 : convertToUSD(1, inputCurrency, spotPrices);

    const localGains = cloneGains(adjustedGains);
    const conversionToLocal = (value) => {
      const valueUSD = value * toUSDRate;
      return convertFromUSD(valueUSD, targetCurrency, spotPrices);
    };

    ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
      Object.keys(localGains[bucket]).forEach((key) => {
        localGains[bucket][key] = conversionToLocal(localGains[bucket][key]);
      });
    });

    const localOrdinaryIncome = conversionToLocal(ordinaryIncomeTotal);
    const { liability: baseLiability } = calcLiability(first, localGains, { ordinaryIncomeTotal: localOrdinaryIncome });
    const fromLocalToUSD = targetCurrency === "USD" ? 1 : convertToUSD(1, targetCurrency, spotPrices);
    const estimatedTax = (baseLiability * fromLocalToUSD) / toUSDRate;
    const taxableBase = taxableGain + ordinaryIncomeTotal;
    const effectiveRate = taxableBase > 0 ? (estimatedTax / taxableBase) * 100 : 0;

    return {
      jurisdiction: taxRules[first]?.name || "N/A",
      currency: inputCurrency,
      grossTotal,
      netAfterCosts,
      totalCosts,
      taxableGain,
      ordinaryIncomeTotal,
      estimatedTax,
      effectiveRate,
    };
  }, [advanced, effectiveGains, jurisdictions, ordinaryIncomeTotal, spotPrices, taxRules]);

  const netAfterTax = useMemo(
    () => Math.max(0, Number(summaryPreview.grossTotal || 0) - Number(summaryPreview.estimatedTax || 0)),
    [summaryPreview]
  );

  const taxSavingsVsUAE = useMemo(() => {
    const { adjustedGains } = buildAdjustedGains(effectiveGains, advanced);
    const currentKey = jurisdictions[0] || "USA";
    const currentLiability = calcLiability(currentKey, adjustedGains, { ordinaryIncomeTotal }).liability;
    const uaeLiability = calcLiability("UAE", adjustedGains, { ordinaryIncomeTotal }).liability;
    return currentLiability - uaeLiability;
  }, [advanced, effectiveGains, jurisdictions, ordinaryIncomeTotal]);

  const validationState = useMemo(() => {
    const errors = [];
    const warnings = [];
    const fieldErrors = {};
    const fieldWarnings = {};
    const ledgerFieldErrors = {};

    if (!jurisdictions.length) {
      errors.push("Select at least one jurisdiction to calculate the filing view.");
    }
    if (String(advanced.realizationMode) === "unrealized") {
      warnings.push("Unrealized mode keeps the liability at zero until a sale is recorded.");
    }
    if (advanced.acquisitionDate && advanced.saleDate && new Date(advanced.saleDate) < new Date(advanced.acquisitionDate)) {
      errors.push("Sale date is earlier than acquisition date.");
      fieldErrors.acquisitionDate = "Acquisition date must be on or before the sale date.";
      fieldErrors.saleDate = "Sale date must be on or after the acquisition date.";
    }
    if (!Number.isFinite(Number(advanced.fxRate)) || Number(advanced.fxRate) <= 0) {
      errors.push("FX conversion must be greater than zero.");
      fieldErrors.fxRate = "Enter an FX rate greater than zero.";
    }
    if (Number(advanced.fees || 0) < 0) {
      errors.push("Fees cannot be negative.");
      fieldErrors.fees = "Use a zero or positive fee amount.";
    }
    ledgerSections.forEach((section) => {
      section.rows.forEach((row) => {
        if (!Number.isFinite(Number(row.fxRate)) || Number(row.fxRate) <= 0) {
          errors.push(`${row.instrument} has an invalid FX rate.`);
          ledgerFieldErrors[row.id] = {
            ...(ledgerFieldErrors[row.id] || {}),
            fxRate: "FX rate must be greater than zero.",
          };
        }
        if (Number(row.fees || 0) < 0) {
          errors.push(`${row.instrument} has negative fees.`);
          ledgerFieldErrors[row.id] = {
            ...(ledgerFieldErrors[row.id] || {}),
            fees: "Fees must be zero or greater.",
          };
        }
      });
    });
    if (summaryPreview.taxableGain <= 0 && totalGainsAmount(effectiveGains) > 0) {
      warnings.push("Adjustments reduce taxable gain to zero. Review carryforwards, exemptions, and costs.");
    }
    if (String(advanced.residencyStatus) === "non-resident" && Number(advanced.withholdingTax || 0) <= 0) {
      warnings.push("Non-resident filing selected. Add withholding tax where applicable.");
      fieldWarnings.withholdingTax = "Add withholding tax if the selected jurisdiction withholds non-resident gains.";
    }
    if (!advanced.notes?.trim()) {
      warnings.push("Notes are blank. Add assumptions for auditability before sharing the output.");
      fieldWarnings.notes = "Add filing assumptions, treaty treatment, or manual adjustments for auditability.";
    }
    return {
      errors: Array.from(new Set(errors)),
      warnings,
      fieldErrors,
      fieldWarnings,
      ledgerFieldErrors,
    };
  }, [advanced, effectiveGains, jurisdictions.length, ledgerSections, summaryPreview.taxableGain]);

  const inputWarnings = useMemo(() => {
    const warnings = [...validationState.warnings];
    if (!jurisdictions.length) warnings.unshift("Select at least one jurisdiction to calculate the filing view.");
    if (advanced.acquisitionDate && advanced.saleDate && new Date(advanced.saleDate) < new Date(advanced.acquisitionDate)) {
      warnings.push("Sale date is earlier than acquisition date.");
    }
    if (validationState.errors.length) {
      warnings.unshift("Resolve blocking input issues before calculating.");
    }
    return Array.from(new Set(warnings));
  }, [advanced.acquisitionDate, advanced.saleDate, jurisdictions.length, validationState.errors.length, validationState.warnings]);

  const taxLossSuggestions = useMemo(() => {
    const taxableGain = Math.max(0, Number(summaryPreview.taxableGain || 0));
    const estimatedTax = Math.max(0, Number(summaryPreview.estimatedTax || 0));
    const marginalRate = taxableGain > 0 ? Math.min(0.5, estimatedTax / taxableGain) : 0;
    if (!Array.isArray(portfolio) || portfolio.length === 0) return [];

    return portfolio
      .map((holding) => {
        const symbol = String(holding?.symbol || "").trim().toUpperCase();
        const quantity = Math.max(0, Number(holding?.quantity || 0));
        const currentPrice = Number(
          spotPrices?.[symbol] ?? holding?.price ?? holding?.markPrice ?? holding?.currentPrice
        );
        const costBasis = Number(
          holding?.entryPrice ?? holding?.averageCost ?? holding?.avgPrice ?? holding?.costBasis
        );
        if (!symbol || quantity <= 0 || !Number.isFinite(currentPrice) || !Number.isFinite(costBasis)) return null;
        const unrealizedLoss = Math.max(0, (costBasis - currentPrice) * quantity);
        if (unrealizedLoss <= 1) return null;
        const offsetAmount = taxableGain > 0 ? Math.min(taxableGain, unrealizedLoss) : unrealizedLoss;
        const estimatedSaving = taxableGain > 0 ? offsetAmount * marginalRate : 0;
        return {
          symbol,
          name: holding?.name || symbol,
          quantity,
          currentPrice,
          costBasis,
          unrealizedLoss,
          offsetAmount,
          estimatedSaving,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.estimatedSaving - a.estimatedSaving || b.unrealizedLoss - a.unrealizedLoss)
      .slice(0, 4);
  }, [portfolio, spotPrices, summaryPreview.estimatedTax, summaryPreview.taxableGain]);

  const guestScenarioBase = useMemo(() => {
    const adjusted = buildAdjustedGains(effectiveGains, advanced).adjustedGains;
    const harvestOffset = taxLossSuggestions.reduce((sum, item) => sum + Math.max(0, Number(item.offsetAmount || 0)), 0);
    return {
      adjusted,
      harvestOffset,
      aggressiveHarvestOffset: harvestOffset > 0 ? harvestOffset * 1.35 : Math.max(0, totalGainsAmount(adjusted) * 0.14),
    };
  }, [advanced, effectiveGains, taxLossSuggestions]);

  const scenarioComparison = useMemo(() => {
    const { adjustedGains } = buildAdjustedGains(effectiveGains, advanced);
    const countryA = taxRules[scenario.countryA] ? scenario.countryA : "USA";
    const countryB = taxRules[scenario.countryB] ? scenario.countryB : "";
    const shiftDays = Number(scenario.shiftDays || 0);
    const shiftedSaleDate = advanced.saleDate
      ? new Date(new Date(advanced.saleDate).getTime() + shiftDays * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : "";
    const shiftedGains = buildAdjustedGains(effectiveGains, { ...advanced, saleDate: shiftedSaleDate }).adjustedGains;
    const nowA = calcLiability(countryA, adjustedGains, { ordinaryIncomeTotal }).liability;
    const nowB = countryB ? calcLiability(countryB, adjustedGains, { ordinaryIncomeTotal }).liability : null;
    const shiftedA = calcLiability(countryA, shiftedGains, { ordinaryIncomeTotal }).liability;
    return {
      countryA,
      countryB,
      nowA,
      nowB,
      shiftedA,
      shiftDays,
    };
  }, [advanced, effectiveGains, ordinaryIncomeTotal, scenario, taxRules]);

  const comparisonScenarioRows = useMemo(
    () =>
      comparisonScenarios.map((item) => {
        const shiftedSaleDate = advanced.saleDate
          ? new Date(new Date(advanced.saleDate).getTime() + Number(item.shiftDays || 0) * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10)
          : "";
        let scenarioGains = buildAdjustedGains(effectiveGains, { ...advanced, saleDate: shiftedSaleDate }).adjustedGains;

        if (item.strategy === "harvest") {
          scenarioGains = reducePositiveGainsProportionally(guestScenarioBase.adjusted, guestScenarioBase.harvestOffset);
        } else if (item.strategy === "defer-long-term") {
          scenarioGains = cloneGains(guestScenarioBase.adjusted);
          scenarioGains.Equities.longTerm = 0;
          scenarioGains.Crypto.longTerm = 0;
        } else if (item.strategy === "realize-losses") {
          scenarioGains = reducePositiveGainsProportionally(guestScenarioBase.adjusted, guestScenarioBase.aggressiveHarvestOffset);
        }

        const liability = calcLiability(item.country, scenarioGains, { ordinaryIncomeTotal }).liability;
        return {
          ...item,
          liability,
          effectiveRate:
            summaryPreview.taxableGain > 0
              ? (liability / (summaryPreview.taxableGain + ordinaryIncomeTotal)) * 100
              : 0,
          netAfterTax: Math.max(0, summaryPreview.grossTotal - liability),
        };
      }),
    [advanced, comparisonScenarios, effectiveGains, guestScenarioBase.adjusted, guestScenarioBase.aggressiveHarvestOffset, guestScenarioBase.harvestOffset, ordinaryIncomeTotal, summaryPreview.grossTotal, summaryPreview.taxableGain]
  );

  const scenarioTableRows = useMemo(() => {
    const baseNet = Math.max(0, summaryPreview.grossTotal - scenarioComparison.nowA);
    const baseRate =
      summaryPreview.taxableGain > 0
        ? (scenarioComparison.nowA / (summaryPreview.taxableGain + ordinaryIncomeTotal)) * 100
        : 0;
    const rows = [
      {
        id: `scenario-${scenarioComparison.countryA}`,
        country: scenarioComparison.countryA,
        scenario: `${countryFlag(scenarioComparison.countryA)} ${taxRules[scenarioComparison.countryA]?.name || scenarioComparison.countryA}`,
        description: "Base filing jurisdiction",
        taxDue: scenarioComparison.nowA,
        effectiveRate: baseRate,
        netAfterTax: baseNet,
        delta: 0,
        deltaPercent: 0,
        notes: taxRules[scenarioComparison.countryA]?.logic || "Base case",
        updated: taxRulesLastUpdated || "Current rules",
      },
      ...(scenarioComparison.countryB
        ? [{
            id: `scenario-${scenarioComparison.countryB}`,
            country: scenarioComparison.countryB,
            scenario: `${countryFlag(scenarioComparison.countryB)} ${taxRules[scenarioComparison.countryB]?.name || scenarioComparison.countryB}`,
            description: "Current comparison jurisdiction",
            taxDue: Number(scenarioComparison.nowB || 0),
            effectiveRate:
              summaryPreview.taxableGain > 0 && Number.isFinite(Number(scenarioComparison.nowB))
                ? (Number(scenarioComparison.nowB) / (summaryPreview.taxableGain + ordinaryIncomeTotal)) * 100
                : 0,
            netAfterTax: Math.max(0, summaryPreview.grossTotal - Number(scenarioComparison.nowB || 0)),
            delta: Number(scenarioComparison.nowB || 0) - scenarioComparison.nowA,
            deltaPercent:
              scenarioComparison.nowA > 0 ? (((Number(scenarioComparison.nowB || 0) - scenarioComparison.nowA) / scenarioComparison.nowA) * 100) : 0,
            notes: taxRules[scenarioComparison.countryB]?.logic || "Comparison",
            updated: taxRulesLastUpdated || "Current rules",
          }]
        : []),
      ...comparisonScenarioRows.map((item) => ({
        id: item.id,
        country: item.country,
        scenario: item.label || `${countryFlag(item.country)} ${taxRules[item.country]?.name || item.country}`,
        description: item.description || `${Number(item.shiftDays || 0)} day sale shift`,
        taxDue: item.liability,
        effectiveRate: item.effectiveRate,
        netAfterTax: item.netAfterTax,
        delta: item.liability - scenarioComparison.nowA,
        deltaPercent:
          scenarioComparison.nowA > 0 ? ((item.liability - scenarioComparison.nowA) / scenarioComparison.nowA) * 100 : 0,
        notes: item.notes || `Shifted sale date by ${Number(item.shiftDays || 0)} days`,
        updated: taxRulesLastUpdated || "Current rules",
        badge: item.strategy === "harvest" && item.liability < scenarioComparison.nowA ? "Model" : "",
      })),
    ];
    return rows;
  }, [
    comparisonScenarioRows,
    ordinaryIncomeTotal,
    scenarioComparison.countryA,
    scenarioComparison.countryB,
    scenarioComparison.nowA,
    scenarioComparison.nowB,
    summaryPreview.grossTotal,
    summaryPreview.taxableGain,
    taxRules,
    taxRulesLastUpdated,
  ]);

  const jurisdictionRecommendations = useMemo(() => {
    if (results.length === 0) return [];
    const primaryLiability = results.reduce((sum, row) => sum + row.liability, 0);
    if (primaryLiability <= 0) return [];

    const currentKeys = new Set(results.map((row) => row.jurisdictionKey));
    return Object.keys(taxRules)
      .filter((key) => !currentKeys.has(key))
      .map((key) => {
        const { liability } = calcLiability(key, effectiveGains, { ordinaryIncomeTotal });
        return {
          key,
          name: taxRules[key].name,
          currency: taxRules[key].currency,
          region: taxRules[key].region,
          logic: taxRules[key].logic,
          liability,
          saving: primaryLiability - liability,
        };
      })
      .filter((row) => row.saving > 0)
      .sort((a, b) => b.saving - a.saving)
      .slice(0, 5);
  }, [effectiveGains, ordinaryIncomeTotal, results, taxRules]);

  const canExportResults = results.length > 0;
  const accountantCopy = useMemo(() => ({
    eyebrow: accountantMode ? "Accountant Review" : "Tax desk",
    title: accountantMode ? "Accountant Review Workbench" : "Tax Scenario Desk",
    subtitle: accountantMode
      ? "Audit-ready ledger, filing assumptions, and jurisdiction outputs prepared for review and handoff."
      : "Capital gains, filing assumptions, and after-tax outcomes in one compact workbench.",
    syncLabel: accountantMode ? "Review mode" : "Sync State",
    syncValue: accountantMode ? "Accountant mode · Audit posture enabled" : `Synced · ${formatSavedTimestamp(new Date().toISOString())}`,
    exportLabel: accountantMode ? "Export review CSV" : "Export",
    saveLabel: accountantMode ? "Save review pack" : "Save Scenario",
    jurisdictionTitle: accountantMode ? "Filing Jurisdictions" : "Jurisdiction Ledger",
    ledgerTitle: accountantMode ? "Forensic Capital Gains Ledger" : "Capital Gains Input Ledger",
    ledgerSubtitle: accountantMode ? "Audit-ready amounts in USD" : "All amounts in USD",
    summaryTitle: accountantMode ? "Accountant Review Summary" : "Decision Summary",
    scenarioTitle: accountantMode ? "Filing Scenario Comparison" : "Scenario Comparison",
    utilitiesTitle: accountantMode ? "Advanced Filing Context" : "Advanced Context",
    utilitiesSubtitle: accountantMode
      ? "Capture basis method, residency, credits, import evidence, and notes for the accountant handoff pack."
      : "Capture basis method, dates, residency, credits, and import notes without interrupting the main ledger.",
    resultsTitle: accountantMode ? "Jurisdiction Output Pack" : "Calculated Liabilities",
    resultsSubtitle: accountantMode
      ? `${results.length ? `${results.length} review output${results.length === 1 ? "" : "s"}` : "Run a calculation to prepare the accountant review outputs."}`
      : `${results.length ? `${results.length} jurisdiction output${results.length === 1 ? "" : "s"}` : "Run a calculation to populate jurisdiction outputs."}`,
    footerTitle: accountantMode ? "Source register & filing notes" : "Compliance & sources",
    primaryAction: accountantMode ? "Recalculate review package" : "Calculate estimated liabilities",
  }), [accountantMode, results.length]);

  const handleToggleJurisdiction = (key) => {
    setJurisdictions((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    );
    setFormNotice("");
  };

  const handleLedgerOverride = (rowId, field, value) => {
    const parsed = parseDecimalInput(value, 0);
    setHasManualGainEdit(true);
    setLedgerOverrides((current) => ({
      ...current,
      [rowId]: {
        ...current[rowId],
        [field]: parsed,
      },
    }));
  };

  const handleAdvancedChange = (field, value) => {
    setAdvanced((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleIncomeChange = (field, value) => {
    setAdditionalIncome((current) => ({
      ...current,
      [field]: parseDecimalInput(value, current[field]),
    }));
  };

  const handleCalculate = (event) => {
    event.preventDefault();
    if (validationState.errors.length) {
      setShowUtilities(true);
      setFormNotice(
        `Resolve ${validationState.errors.length} blocking issue${validationState.errors.length === 1 ? "" : "s"} before calculating.`
      );
      setFormNoticeTone("warning");
      return;
    }

    const { adjustedGains, grossTotal, taxableGain, netAfterCosts, totalCosts } = buildAdjustedGains(
      effectiveGains,
      advanced
    );

    const newResults = jurisdictions.map((jurisdictionKey) => {
      const targetCurrency = taxRules[jurisdictionKey]?.currency || advanced.currency || "USD";
      const inputCurrency = advanced.currency || "USD";
      const toUSDRate = inputCurrency === "USD" ? 1 : convertToUSD(1, inputCurrency, spotPrices);
      const localGains = cloneGains(adjustedGains);
      const convertToLocal = (value) => {
        const valueUSD = value * toUSDRate;
        return convertFromUSD(valueUSD, targetCurrency, spotPrices);
      };

      ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
        Object.keys(localGains[bucket]).forEach((key) => {
          localGains[bucket][key] = convertToLocal(localGains[bucket][key]);
        });
      });

      const localOrdinaryIncome = convertToLocal(ordinaryIncomeTotal);
      const localTaxableGain = convertToLocal(taxableGain);
      const localGrossGain = convertToLocal(grossTotal);
      const localNetGain = convertToLocal(netAfterCosts);
      const localCosts = convertToLocal(totalCosts);
      const { liability: baseLiability, details } = calcLiability(jurisdictionKey, localGains, {
        ordinaryIncomeTotal: localOrdinaryIncome,
      });

      const taxCredits =
        Math.max(0, Number(advanced.foreignTaxPaid || 0)) + Math.max(0, Number(advanced.withholdingTax || 0));
      const localTaxCredits = convertToLocal(taxCredits);
      const liability = Math.max(0, baseLiability - localTaxCredits);
      const taxableBase = localTaxableGain + localOrdinaryIncome;
      const effectiveRate = taxableBase > 0 ? (liability / taxableBase) * 100 : 0;
      const liabilityUSD = convertToUSD(liability, targetCurrency, spotPrices);

      return {
        jurisdictionKey,
        jurisdiction: taxRules[jurisdictionKey]?.name || jurisdictionKey,
        currency: targetCurrency,
        liability,
        liabilityUSD,
        grossGain: localGrossGain,
        netGain: localNetGain,
        taxableGain: localTaxableGain,
        ordinaryIncomeTotal: localOrdinaryIncome,
        effectiveRate,
        totalCosts: localCosts,
        taxCredits: localTaxCredits,
        details,
        timestamp: new Date().toISOString(),
      };
    });

    setResults(newResults);
    setFormNotice("");
    setFormNoticeTone("success");
    const trailEntry = {
      id: `${Date.now()}`,
      timestamp: new Date().toISOString(),
      taxYear,
      jurisdictions,
      advanced,
      income: additionalIncome,
      gains: effectiveGains,
      ledgerOverrides,
    };
    const nextTrail = [trailEntry, ...auditTrail].slice(0, 20);
    setAuditTrail(nextTrail);
    localStorage.setItem("zenin_tax_audit_trail", JSON.stringify(nextTrail));
  };

  const handleSave = () => {
    if (!results.length) {
      setFormNotice("Run a calculation before saving a scenario.");
      setFormNoticeTone("warning");
      return;
    }
    const entry = {
      id: `tax-scenario-${Date.now()}`,
      savedAt: new Date().toISOString(),
      label: `${taxYear || "Tax year"} · ${jurisdictions.join(", ")}`,
      jurisdictions: [...jurisdictions],
      taxYear,
      advanced: { ...advanced },
      gains: cloneGains(effectiveGains),
      additionalIncome: { ...additionalIncome },
      ledgerOverrides: { ...ledgerOverrides },
      results: results.map((row) => ({ ...row })),
    };
    const nextSaved = [entry, ...savedEstimates].slice(0, 12);
    setSavedEstimates(nextSaved);
    localStorage.setItem("zenin_tax_estimates", JSON.stringify(nextSaved));
    setFormNotice("Scenario saved to Saved scenarios.");
    setFormNoticeTone("success");
  };

  const handleLoadSavedScenario = (entry) => {
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry.jurisdictions) && entry.jurisdictions.length) setJurisdictions(entry.jurisdictions);
    if (entry.taxYear) setTaxYear(entry.taxYear);
    if (entry.gains) {
      setGains(cloneGains(entry.gains));
      setHasManualGainEdit(true);
    }
    if (entry.advanced) setAdvanced((current) => ({ ...current, ...entry.advanced }));
    if (entry.additionalIncome) setAdditionalIncome({ ...defaultIncomeBreakdown, ...entry.additionalIncome });
    if (entry.ledgerOverrides) setLedgerOverrides(entry.ledgerOverrides);
    if (Array.isArray(entry.results)) setResults(entry.results);
    setShowSavedScenarios(false);
    setFormNotice(`Loaded ${entry.label || "saved scenario"}.`);
    setFormNoticeTone("success");
  };

  const handleDeleteSavedScenario = (id) => {
    const nextSaved = savedEstimates.filter((entry) => entry.id !== id);
    setSavedEstimates(nextSaved);
    localStorage.setItem("zenin_tax_estimates", JSON.stringify(nextSaved));
  };

  const handleExportCsv = () => {
    if (!results.length) return;
    let csv = "data:text/csv;charset=utf-8,";
    if (accountantMode) {
      csv += `Mode:,Accountant review\n`;
      csv += `Tax year:,${taxYear}\n`;
      csv += `Jurisdictions:,${jurisdictions.join(" | ")}\n`;
      csv += `Prepared at:,${new Date().toISOString()}\n`;
      csv += `Rules freshness:,${taxRulesLastUpdated || "Current release"}\n`;
      csv += `Source:,${taxSources.map((source) => source.label).join(" | ") || "Runtime config"}\n`;
      csv += `Notes:,${String(advanced.notes || "").replace(/\n/g, " ")}\n\n`;
    }
    results.forEach((row) => {
      csv += `Jurisdiction:,${row.jurisdiction}\nCurrency:,${row.currency}\nTotal Liability:,${row.liability}\nTaxable Gain:,${row.taxableGain}\nOrdinary Income:,${row.ordinaryIncomeTotal || 0}\nEffective Rate:,${row.effectiveRate}\n\n`;
      Object.entries(row.details).forEach(([key, value]) => {
        csv += `"${key}",${value}\n`;
      });
      csv += "\n---\n\n";
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `${accountantMode ? "accountant_review" : "tax_estimate"}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setFormNotice(accountantMode ? "Accountant review CSV exported." : "Scenario export generated.");
    setFormNoticeTone("success");
  };

  const handleReset = () => {
    setJurisdictions(isGuestDemo ? guestDemoState.jurisdictions : ["USA"]);
    setJurisdictionSearch("");
    setActiveRegion("All");
    setTaxYear("2026");
    setGains(isGuestDemo ? guestDemoState.gains : emptyGains());
    setHasManualGainEdit(isGuestDemo);
    setResults([]);
    setSavedEstimates((current) => current);
    setFileName("");
    setShowImportPreview(false);
    setAdditionalIncome(defaultIncomeBreakdown);
    setScenario(getDefaultScenarioState());
    setComparisonScenarios(isGuestDemo ? guestDemoState.comparisonScenarios : []);
    setAdvanced(isGuestDemo ? guestDemoState.advanced : defaultAdvancedState);
    setLedgerOverrides({});
    setFormNotice("");
    setFormNoticeTone("warning");
    setShowRuleDetails(false);
  };

  const handleDocumentImport = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setShowImportPreview(true);
    setFormNotice("Import preview attached. Map the file manually before calculation.");
    setFormNoticeTone("success");
  };

  const handleAddScenario = () => {
    const usedCountries = new Set([
      scenario.countryA,
      ...(scenario.countryB ? [scenario.countryB] : []),
      ...comparisonScenarios.map((item) => item.country),
    ]);
    const nextCountry = Object.keys(taxRules).find((key) => !usedCountries.has(key)) || "Singapore";
    setComparisonScenarios((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        country: nextCountry,
        shiftDays: Number(scenario.shiftDays || 0) + (current.length + 1) * 30,
      },
    ]);
  };

  const confidenceScore = useMemo(() => {
    if (isGuestDemo) return 82;
    const notesScore = advanced.notes?.trim() ? 14 : 0;
    const tradeScore = Array.isArray(trades) && trades.length > 0 ? 38 : 10;
    const resultScore = results.length > 0 ? 22 : 8;
    const fxScore = Number(advanced.fxRate || 0) > 0 ? 10 : 0;
    return Math.min(96, notesScore + tradeScore + resultScore + fxScore);
  }, [advanced.fxRate, advanced.notes, isGuestDemo, results.length, trades]);
  const summaryModel = useMemo(
    () => [
      {
        label: accountantMode ? "Estimated filing liability (USD)" : "Estimated liability (USD)",
        value: formatMoney(summaryPreview.estimatedTax, advanced.currency || "USD"),
        tone: "negative",
      },
      {
        label: accountantMode ? "Blended effective rate" : "Effective rate",
        value: `${summaryPreview.effectiveRate.toFixed(2)}%`,
        tone: "positive",
      },
      {
        label: accountantMode ? "Taxable gain ledger" : "Taxable gain",
        value: formatMoney(summaryPreview.taxableGain, advanced.currency || "USD"),
        tone: "warning",
      },
      {
        label: accountantMode ? "Client net after tax" : "Net after tax",
        value: formatMoney(netAfterTax, advanced.currency || "USD"),
        tone: "positive",
      },
      {
        label: accountantMode ? "Vs. zero-tax regime" : "Vs. base case",
        value: `${taxSavingsVsUAE <= 0 ? "" : "+"}${formatMoney(taxSavingsVsUAE, advanced.currency || "USD")}`,
        tone: taxSavingsVsUAE <= 0 ? "negative" : "positive",
      },
    ],
    [accountantMode, advanced.currency, netAfterTax, summaryPreview.effectiveRate, summaryPreview.estimatedTax, summaryPreview.taxableGain, taxSavingsVsUAE]
  );
  const utilitiesPanelId = "tax-workbench-utilities";
  const insightsPanelId = "tax-workbench-insights-body";
  const ruleDetailsId = "tax-workbench-rule-details";
  const formStatusId = "tax-workbench-form-status";
  const validationSummaryId = "tax-workbench-validation-summary";
  const hasBlockingIssues = validationState.errors.length > 0;
  const reviewStateLabel = hasBlockingIssues
    ? `${validationState.errors.length} blocking issue${validationState.errors.length === 1 ? "" : "s"}`
    : inputWarnings.length
      ? `${inputWarnings.length} review item${inputWarnings.length === 1 ? "" : "s"}`
      : "Ready to calculate";
  const reviewStateCopy = hasBlockingIssues
    ? accountantMode
      ? "Open Advanced Filing Context and correct the highlighted fields before exporting or sharing the review pack."
      : "Open advanced context and correct the highlighted fields before calculating."
    : inputWarnings.length
      ? accountantMode
        ? "Inputs are reviewable, but add the missing filing context before handing this off to an accountant."
        : "Inputs are usable, but add the missing context before sharing or exporting."
      : accountantMode
        ? "Inputs are consistent and the accountant-facing review pack is ready."
        : "Inputs are consistent and the current filing view is ready for calculation.";

  return (
    <div className="tax-workbench">
      <form className="tax-workbench-shell" onSubmit={handleCalculate}>
        <input ref={importInputRef} id="tax-import-input-hidden" className="tax-workbench-hidden-input" type="file" onChange={handleDocumentImport} />
        {formNotice ? (
          <div
            id={formStatusId}
            className={`tax-workbench-banner ${formNoticeTone}`.trim()}
            role={formNoticeTone === "warning" ? "alert" : "status"}
            aria-live={formNoticeTone === "warning" ? "assertive" : "polite"}
          >
            {formNotice}
          </div>
        ) : null}

        <header className="tax-workbench-command-header">
          <div className="tax-workbench-title-block">
            <span>{accountantCopy.eyebrow}</span>
            <h2>{accountantCopy.title}</h2>
            <p>{accountantCopy.subtitle}</p>
          </div>
          <div className="tax-workbench-command-actions">
            <div className="tax-workbench-sync-state">
              <span>{accountantCopy.syncLabel}</span>
              <strong>{accountantCopy.syncValue}</strong>
            </div>
            <label className="tax-workbench-scenario-select">
              <span>Saved Scenarios</span>
              <select
                value=""
                onChange={(event) => {
                  const entry = savedEstimates.find((item) => item.id === event.target.value);
                  if (entry) handleLoadSavedScenario(entry);
                }}
              >
                <option value="">Base Case</option>
                {savedEstimates.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.label || "Saved scenario"}</option>
                ))}
              </select>
            </label>
            <button type="button" className="tax-workbench-btn" onClick={handleExportCsv}>
              {accountantCopy.exportLabel}
            </button>
            <button type="button" className="tax-workbench-btn tax-workbench-btn-accent" onClick={handleSave}>
              {accountantCopy.saveLabel}
            </button>
          </div>
        </header>

        {accountantMode ? (
          <section className="tax-workbench-accountant-banner" aria-label="Accountant mode status">
            <div>
              <strong>Accountant Mode is active</strong>
              <span>Exports, labels, and review guidance are now framed for audit handoff and filing review.</span>
            </div>
            <div className="tax-workbench-accountant-banner-meta">
              <span>Audit trail entries</span>
              <strong>{auditTrail.length}</strong>
            </div>
          </section>
        ) : null}

        <section className="tax-scenario-workbench" aria-label="Tax scenario workbench">
          <div className="tax-scenario-command">
            <span>Scenario desk</span>
            <h3>Model the tax consequence before you sell.</h3>
            <p>
              Connected to {Array.isArray(portfolio) ? portfolio.length : 0} portfolio holding{Array.isArray(portfolio) && portfolio.length === 1 ? "" : "s"}
              {" "}and {Array.isArray(trades) ? trades.length : 0} trade record{Array.isArray(trades) && trades.length === 1 ? "" : "s"}.
            </p>
          </div>
          <div className="tax-scenario-controls">
            <label>
              <span>Jurisdiction</span>
              <select
                value={jurisdictions[0] || "USA"}
                onChange={(event) => setJurisdictions((current) => [event.target.value, ...current.filter((key) => key !== event.target.value).slice(0, 3)])}
              >
                {Object.entries(taxRules).map(([key, info]) => (
                  <option key={key} value={key}>{countryFlag(key)} {info.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Basis method</span>
              <select value={advanced.costBasisMethod} onChange={(event) => handleAdvancedChange("costBasisMethod", event.target.value)}>
                <option value="fifo">FIFO</option>
                <option value="lifo">LIFO</option>
                <option value="hifo">HIFO</option>
                <option value="average">Average cost</option>
              </select>
            </label>
            <label>
              <span>Sale timing</span>
              <select value={scenario.shiftDays} onChange={(event) => setScenario((current) => ({ ...current, shiftDays: Number(event.target.value) }))}>
                <option value={0}>Today</option>
                <option value={30}>+30 days</option>
                <option value={90}>+90 days</option>
                <option value={365}>+1 year</option>
              </select>
            </label>
            <button type="submit" className="tax-workbench-primary-btn">Run scenario</button>
          </div>
          <div className="tax-scenario-delta">
            <div>
              <span>Estimated tax</span>
              <strong>{formatMoney(summaryPreview.estimatedTax, advanced.currency || "USD")}</strong>
            </div>
            <div>
              <span>Taxable gain</span>
              <strong>{formatMoney(summaryPreview.taxableGain, advanced.currency || "USD")}</strong>
            </div>
            <div>
              <span>After-tax result</span>
              <strong>{formatMoney(netAfterTax, advanced.currency || "USD")}</strong>
            </div>
          </div>
        </section>

        <div className="tax-workbench-primary-grid">
          <section className="tax-workbench-panel tax-workbench-jurisdictions">
            <DensePanelHeader
              title={accountantCopy.jurisdictionTitle}
              meta={`Tax year ${taxYear === "2026" ? "2024/25" : taxYear}`}
            />

            <div className="tax-workbench-toolbar tax-workbench-toolbar-ledger">
              <label className="tax-workbench-field">
                <span>Search countries</span>
                <input
                  id="tax-jurisdiction-search"
                  type="search"
                  autoComplete="off"
                  placeholder="Search by country, region, or code"
                  value={jurisdictionSearch}
                  onChange={(event) => setJurisdictionSearch(event.target.value)}
                />
              </label>
              <label className="tax-workbench-field">
                <span>Tax year</span>
                <select value={taxYear} onChange={(event) => setTaxYear(event.target.value)}>
                  <option value="2026">2024/25</option>
                  <option value="2025">2025</option>
                  <option value="2024">2024</option>
                  <option value="2023">2023</option>
                </select>
              </label>
            </div>

            <div className="tax-workbench-jurisdiction-status">
              <div className="tax-workbench-mini-title">
                <span>Selected jurisdictions ({jurisdictions.length})</span>
                {jurisdictions.length > 1 ? (
                  <button type="button" onClick={() => setJurisdictions(jurisdictions.slice(0, 1))}>Reset to base</button>
                ) : null}
              </div>
              <div className="tax-workbench-selected-inline" role="list" aria-label="Selected jurisdictions">
                {jurisdictions.map((key) => {
                  const info = taxRules[key] || {};
                  const displayName = jurisdictionDisplayName(key, info);
                  const isBase = jurisdictions[0] === key;
                  return (
                    <button
                      key={`selected-${key}`}
                      type="button"
                      className={`tax-workbench-selected-chip ${isBase ? "base" : ""}`.trim()}
                      onClick={() => (!isBase && jurisdictions.length > 1 ? handleToggleJurisdiction(key) : null)}
                      role="listitem"
                    >
                      <span aria-hidden="true">{countryFlag(key)}</span>
                      <strong>{displayName}</strong>
                      <em>{isBase ? "Base" : key}</em>
                    </button>
                  );
                })}
              </div>
            </div>

            <fieldset className="tax-workbench-region-filter">
              <legend>Regions</legend>
              <div className="tax-workbench-pill-row">
                {["All", ...taxRegions].map((region) => (
                  <button
                    key={region}
                    type="button"
                    className={`tax-workbench-pill ${activeRegion === region ? "active" : ""}`.trim()}
                    onClick={() => setActiveRegion(region)}
                  >
                    {region}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="tax-workbench-jurisdiction-list" role="list">
              {filteredJurisdictions.length ? (
                filteredJurisdictions.map(([key, info], index) => (
                  <label
                    key={key}
                    className={`tax-workbench-jurisdiction-card ${jurisdictions.includes(key) ? "selected" : ""}`.trim()}
                  >
                    <div className="tax-workbench-jurisdiction-copy">
                      <div className="tax-workbench-jurisdiction-main">
                        <span aria-hidden="true">{countryFlag(key)}</span>
                        <strong>{info.name}</strong>
                        {index === 0 && detectedCountry === key ? <em>Detected</em> : null}
                      </div>
                      <p>{jurisdictions[0] === key ? "Base jurisdiction" : info.logic || info.region}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={jurisdictions.includes(key)}
                      onChange={() => handleToggleJurisdiction(key)}
                      aria-label={`Select ${info.name}`}
                    />
                  </label>
                ))
              ) : (
                <div className="tax-workbench-empty">
                  <h3>No jurisdictions match</h3>
                  <p>Widen the region filter or search using a country code like `US`, `SG`, or `AE`.</p>
                </div>
              )}
            </div>

            <div className="tax-workbench-jurisdiction-foot">
              <span>Base currency · {advanced.currency || "USD"}</span>
            </div>
          </section>

          <section className="tax-workbench-panel tax-workbench-ledger">
            <DensePanelHeader
              title={accountantCopy.ledgerTitle}
              subtitle={accountantCopy.ledgerSubtitle}
              actions={
                <InlineControlGroup>
                  <button
                    type="button"
                    className="tax-workbench-btn tax-workbench-btn-accent"
                    onClick={() => setShowUtilities(true)}
                    aria-expanded={showUtilities}
                    aria-controls={utilitiesPanelId}
                  >
                    + Add transaction
                  </button>
                  <button type="button" className="tax-workbench-btn" onClick={() => importInputRef.current?.click()}>
                    Import CSV
                  </button>
                  <button type="button" className="tax-workbench-btn" onClick={() => setShowSavedScenarios(true)}>
                    ⋮
                  </button>
                </InlineControlGroup>
              }
            />

            <div className="tax-workbench-ledger-stack">
              {ledgerSections.map((section) => (
                <article key={section.key} className="tax-workbench-ledger-section">
                  <header className="tax-workbench-ledger-section-head">
                    <div>
                      <h4>{section.title}</h4>
                      <p>{section.description}</p>
                    </div>
                    <div className="tax-workbench-ledger-section-total">
                      {formatMoney(
                        section.totals.shortTermGain + section.totals.longTermGain + section.totals.standardGain,
                        advanced.currency || "USD"
                      )}
                    </div>
                  </header>

                  <div className="tax-workbench-ledger-table" role="table" aria-label={`${section.title} ledger`}>
                    <div className="tax-workbench-ledger-head" role="rowgroup">
                      <div role="row">
                        <span role="columnheader">Asset class / instrument</span>
                        <span role="columnheader">Term</span>
                        <span role="columnheader">Qty / Units</span>
                        <span role="columnheader">Cost basis (USD)</span>
                        <span role="columnheader">Proceeds (USD)</span>
                        <span role="columnheader">Gain / loss (USD)</span>
                        <span role="columnheader">Acq. date</span>
                        <span role="columnheader">Sale date</span>
                        <span role="columnheader">Fees / FX</span>
                      </div>
                    </div>
                    <div className="tax-workbench-ledger-body" role="rowgroup">
                      {section.rows.length ? (
                        section.rows.map((row) => (
                          <div className="tax-workbench-ledger-row" role="row" key={row.id}>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Asset class / instrument" role="cell">
                              <div className="tax-workbench-ledger-instrument">
                                <strong>{row.instrument}</strong>
                                <span>{row.subtitle}</span>
                              </div>
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Term" role="cell">
                              <span className="tax-workbench-ledger-text">{String(row.classification || "Standard").toUpperCase()}</span>
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Qty / Units" role="cell">
                              <LedgerInput
                                label={`${row.instrument} quantity`}
                                value={row.quantity}
                                onChange={(value) => handleLedgerOverride(row.id, "quantity", value)}
                              />
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Cost basis (USD)" role="cell">
                              <LedgerInput
                                label={`${row.instrument} cost basis`}
                                value={row.costBasis}
                                onChange={(value) => handleLedgerOverride(row.id, "costBasis", value)}
                              />
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Proceeds (USD)" role="cell">
                              <LedgerInput
                                label={`${row.instrument} proceeds`}
                                value={row.marketValue}
                                onChange={(value) => handleLedgerOverride(row.id, "marketValue", value)}
                              />
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Gain / loss (USD)" role="cell">
                              {(() => {
                                const editableField =
                                  row.bucket === "Equities" || row.bucket === "Crypto"
                                    ? Math.abs(Number(row.longTermGain || 0)) > Math.abs(Number(row.shortTermGain || 0))
                                      ? "longTermGain"
                                      : "shortTermGain"
                                    : "standardGain";
                                const gainValue = Number(row.shortTermGain || 0) + Number(row.longTermGain || 0) + Number(row.standardGain || 0);
                                return (
                                  <LedgerInput
                                    label={`${row.instrument} gain or loss`}
                                    value={gainValue}
                                    tone={gainValue ? (gainValue >= 0 ? "positive" : "negative") : ""}
                                    onChange={(value) => handleLedgerOverride(row.id, editableField, value)}
                                  />
                                );
                              })()}
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Acq. date" role="cell">
                              <span className="tax-workbench-ledger-text">
                                {advanced.acquisitionDate || (row.updatedAt ? new Date(row.updatedAt).toISOString().slice(0, 10) : "—")}
                              </span>
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Sale date" role="cell">
                              <span className="tax-workbench-ledger-text">
                                {advanced.saleDate || (row.updatedAt ? new Date(row.updatedAt).toISOString().slice(0, 10) : "—")}
                              </span>
                            </div>
                            <div className="tax-workbench-cell tax-workbench-ledger-cell tax-workbench-fee-fx-cell" data-label="Fees / FX" role="cell">
                              <LedgerInput
                                label={`${row.instrument} fees`}
                                value={row.fees}
                                invalid={Boolean(validationState.ledgerFieldErrors[row.id]?.fees)}
                                message={validationState.ledgerFieldErrors[row.id]?.fees}
                                onChange={(value) => handleLedgerOverride(row.id, "fees", value)}
                              />
                              <LedgerInput
                                label={`${row.instrument} fx rate`}
                                value={row.fxRate}
                                invalid={Boolean(validationState.ledgerFieldErrors[row.id]?.fxRate)}
                                message={validationState.ledgerFieldErrors[row.id]?.fxRate}
                                onChange={(value) => handleLedgerOverride(row.id, "fxRate", value)}
                              />
                            </div>
                          </div>
                        ))
                      ) : (
                        <GuidedEmptyState
                          eyebrow="Ledger workflow"
                          title="No ledger rows yet"
                          description="The estimator needs instrument-level gains before it can model liabilities across jurisdictions."
                          steps={[
                            "Import a trade file or add holdings in Portfolio to seed the ledger.",
                            "Review cost basis, proceeds, dates, fees, and FX before calculating.",
                          ]}
                          className="tax-guided-empty"
                        />
                      )}
                    </div>
                    <div className="tax-workbench-ledger-foot" role="row">
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Asset class / instrument" role="cell">
                        <span>Portfolio total</span>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Term" role="cell">
                        <strong>—</strong>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Qty / Units" role="cell">
                        <strong>{section.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0).toLocaleString()}</strong>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Cost basis (USD)" role="cell">
                        <strong>{formatMoney(section.totals.costBasis, advanced.currency || "USD")}</strong>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Proceeds (USD)" role="cell">
                        <strong>{formatMoney(section.rows.reduce((sum, row) => sum + Number(row.marketValue || 0), 0), advanced.currency || "USD")}</strong>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Gain / loss (USD)" role="cell">
                        <strong>{formatMoney(section.totals.shortTermGain + section.totals.longTermGain + section.totals.standardGain, advanced.currency || "USD")}</strong>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Acq. date" role="cell">
                        <strong>—</strong>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Sale date" role="cell">
                        <strong>—</strong>
                      </div>
                      <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Fees / FX" role="cell">
                        <strong>{formatMoney(section.totals.fees, advanced.currency || "USD")}</strong>
                        <strong>{Number(section.rows[0]?.fxRate || advanced.fxRate || 1).toFixed(2)}</strong>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="tax-workbench-panel tax-workbench-summary">
            <DensePanelHeader
              title={accountantCopy.summaryTitle}
              subtitle={`${countryFlag(jurisdictions[0] || "USA")} ${summaryPreview.jurisdiction}`}
            />

            <div className="tax-workbench-summary-stack">
              {summaryModel.map((item) => (
                <article key={item.label} className={`tax-workbench-summary-stat ${item.tone}`.trim()}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              ))}
            </div>

            <div className="tax-workbench-meta-block">
              <div
                id={validationSummaryId}
                className={`tax-workbench-validation-summary ${
                  hasBlockingIssues ? "error" : inputWarnings.length ? "warning" : "ready"
                }`.trim()}
                role="status"
                aria-live="polite"
              >
                <strong>{reviewStateLabel}</strong>
                <span>{reviewStateCopy}</span>
              </div>
              {hasBlockingIssues ? (
                <GuidedEmptyState
                  eyebrow="Recovery"
                  title="Calculation is blocked until the required inputs are fixed"
                  description="Zenin found missing or invalid tax inputs. Fix the highlighted fields first, then rerun the estimate."
                  steps={[
                    "Complete the required jurisdictions, ledger rows, and date / FX inputs.",
                    "Open Advanced Context if you need to fix filing, residency, or import assumptions.",
                  ]}
                  tone="warning"
                  className="guided-empty-state--compact tax-guided-empty"
                />
              ) : null}
              <div className="tax-workbench-confidence-meter">
                <div><span>Confidence & rules</span><strong>{confidenceScore}%</strong></div>
                <div className="tax-workbench-meter-track"><div className="tax-workbench-meter-fill" style={{ width: `${confidenceScore}%` }} /></div>
              </div>
              <div><span>Rules freshness</span><strong>{taxRulesLastUpdated || "Current release"}</strong></div>
              <div><span>Tax data source</span><strong>{taxSources[0]?.label || "Vertex (v2024.05)"}</strong></div>
            </div>

            <button type="submit" className="tax-workbench-primary-btn" aria-describedby={validationSummaryId}>
              {accountantCopy.primaryAction}
            </button>

            <button
              type="button"
              className="tax-workbench-link-btn"
              onClick={() => setShowRuleDetails((current) => !current)}
              aria-expanded={showRuleDetails}
              aria-controls={ruleDetailsId}
            >
              {showRuleDetails ? "Hide rule details" : "View rule details"}
            </button>

            {showRuleDetails ? (
              <div id={ruleDetailsId} className="tax-workbench-rule-sheet">
                <div>
                  <span>Base case logic</span>
                  <strong>{taxRules[jurisdictions[0] || "USA"]?.logic || "General capital gains treatment"}</strong>
                </div>
                <div>
                  <span>Filing context</span>
                  <strong>{advanced.taxRegime} · {advanced.filingStatus} · {advanced.residencyStatus}</strong>
                </div>
                <div>
                  <span>Primary notes</span>
                  <strong>{advanced.notes?.trim() || "No scenario notes recorded yet."}</strong>
                </div>
              </div>
            ) : null}
          </aside>
        </div>

        <section className="tax-workbench-panel tax-workbench-scenarios">
          <DensePanelHeader
            title={accountantCopy.scenarioTitle}
            subtitle=""
            actions={
              <InlineControlGroup>
                <button type="button" className="tax-workbench-btn" onClick={handleAddScenario}>
                  + Add scenario
                </button>
              </InlineControlGroup>
            }
          />

          <div className="tax-workbench-scenario-table" role="table" aria-label="Scenario comparison table">
            <div className="tax-workbench-scenario-head" role="rowgroup">
              <div role="row">
                <span role="columnheader">Scenario</span>
                <span role="columnheader">Description</span>
                <span role="columnheader">Tax due</span>
                <span role="columnheader">Effective rate</span>
                <span role="columnheader">Net after tax</span>
                <span role="columnheader">Delta vs base</span>
                <span role="columnheader">Delta %</span>
                <span role="columnheader">Key notes</span>
                <span role="columnheader">Updated</span>
              </div>
            </div>
            <div className="tax-workbench-scenario-body" role="rowgroup">
              {scenarioTableRows.map((row, index) => (
                <div className={`tax-workbench-scenario-row ${index === 0 ? "base" : ""}`.trim()} role="row" key={row.id}>
                  <div className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Scenario" role="cell">
                    <strong>{row.scenario}</strong>
                    {row.badge ? <em className="tax-workbench-row-badge">{row.badge}</em> : null}
                  </div>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Description" role="cell">{row.description}</span>
                  <strong className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Tax due" role="cell">{formatMoney(row.taxDue, advanced.currency || "USD")}</strong>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Effective rate" role="cell">{row.effectiveRate.toFixed(2)}%</span>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Net after tax" role="cell">{formatMoney(row.netAfterTax, advanced.currency || "USD")}</span>
                  <span className={`tax-workbench-cell tax-workbench-scenario-cell ${row.delta <= 0 ? "positive" : "negative"}`.trim()} data-label="Delta vs base" role="cell">
                    {row.delta === 0 ? "—" : formatMoney(row.delta, advanced.currency || "USD")}
                  </span>
                  <span className={`tax-workbench-cell tax-workbench-scenario-cell ${row.deltaPercent <= 0 ? "positive" : "negative"}`.trim()} data-label="Delta %" role="cell">
                    {row.delta === 0 ? "—" : `${row.deltaPercent.toFixed(2)}%`}
                  </span>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Key notes" role="cell">{row.notes}</span>
                  <span className="tax-workbench-cell tax-workbench-scenario-cell" data-label="Updated" role="cell">{row.updated}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <TaxCompliancePanel
          jurisdictions={jurisdictions}
          ledgerRows={ledgerSections.flatMap((section) => section.rows || [])}
          scenarioRows={scenarioTableRows}
          currency={advanced.currency || "USD"}
          summary={summaryPreview}
        />

        {showUtilities ? (
        <div id={utilitiesPanelId} className="tax-workbench-secondary-grid">
          <section className="tax-workbench-panel tax-workbench-context">
            <DensePanelHeader
              title={accountantCopy.utilitiesTitle}
              subtitle={accountantCopy.utilitiesSubtitle}
              actions={
                <button type="button" className="tax-workbench-link-btn" onClick={handleReset}>
                  Reset inputs
                </button>
              }
            />

            <div className="tax-workbench-context-grid">
              <TaxField label="Realization mode">
                <select
                  value={advanced.realizationMode}
                  onChange={(event) => handleAdvancedChange("realizationMode", event.target.value)}
                >
                  <option value="realized">Realized</option>
                  <option value="unrealized">Unrealized</option>
                </select>
              </TaxField>
              <TaxField
                label="Acquisition date"
                invalid={Boolean(validationState.fieldErrors.acquisitionDate)}
                message={validationState.fieldErrors.acquisitionDate}
              >
                <input
                  type="date"
                  value={advanced.acquisitionDate}
                  onChange={(event) => handleAdvancedChange("acquisitionDate", event.target.value)}
                />
              </TaxField>
              <TaxField
                label="Sale date"
                invalid={Boolean(validationState.fieldErrors.saleDate)}
                message={validationState.fieldErrors.saleDate}
              >
                <input
                  type="date"
                  value={advanced.saleDate}
                  onChange={(event) => handleAdvancedChange("saleDate", event.target.value)}
                />
              </TaxField>
              <TaxField
                label="FX rate"
                invalid={Boolean(validationState.fieldErrors.fxRate)}
                message={validationState.fieldErrors.fxRate}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={advanced.fxRate}
                  onChange={(event) => handleAdvancedChange("fxRate", parseDecimalInput(event.target.value, advanced.fxRate))}
                />
              </TaxField>
              <TaxField
                label="Fees"
                invalid={Boolean(validationState.fieldErrors.fees)}
                message={validationState.fieldErrors.fees}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={advanced.fees}
                  onChange={(event) => handleAdvancedChange("fees", parseDecimalInput(event.target.value, advanced.fees))}
                />
              </TaxField>
              <TaxField label="Brokerage">
                <input
                  type="text"
                  inputMode="decimal"
                  value={advanced.brokerage}
                  onChange={(event) => handleAdvancedChange("brokerage", parseDecimalInput(event.target.value, advanced.brokerage))}
                />
              </TaxField>
              <TaxField label="Loss carryforward">
                <input
                  type="text"
                  inputMode="decimal"
                  value={advanced.lossCarryforward}
                  onChange={(event) =>
                    handleAdvancedChange("lossCarryforward", parseDecimalInput(event.target.value, advanced.lossCarryforward))
                  }
                />
              </TaxField>
              <TaxField label="Exemption threshold">
                <input
                  type="text"
                  inputMode="decimal"
                  value={advanced.exemptionThreshold}
                  onChange={(event) =>
                    handleAdvancedChange("exemptionThreshold", parseDecimalInput(event.target.value, advanced.exemptionThreshold))
                  }
                />
              </TaxField>
              <TaxField label="Foreign tax paid">
                <input
                  type="text"
                  inputMode="decimal"
                  value={advanced.foreignTaxPaid}
                  onChange={(event) =>
                    handleAdvancedChange("foreignTaxPaid", parseDecimalInput(event.target.value, advanced.foreignTaxPaid))
                  }
                />
              </TaxField>
              <TaxField
                label="Withholding tax"
                message={validationState.fieldWarnings.withholdingTax}
                tone={validationState.fieldWarnings.withholdingTax ? "warning" : "default"}
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={advanced.withholdingTax}
                  onChange={(event) =>
                    handleAdvancedChange("withholdingTax", parseDecimalInput(event.target.value, advanced.withholdingTax))
                  }
                />
              </TaxField>
              <TaxField label="Residency status">
                <select
                  value={advanced.residencyStatus}
                  onChange={(event) => handleAdvancedChange("residencyStatus", event.target.value)}
                >
                  <option value="resident">Resident</option>
                  <option value="non-resident">Non-resident</option>
                </select>
              </TaxField>
              <TaxField label="Tax regime">
                <select
                  value={advanced.taxRegime}
                  onChange={(event) => handleAdvancedChange("taxRegime", event.target.value)}
                >
                  <option value="individual">Individual</option>
                  <option value="company">Company</option>
                  <option value="trust">Trust</option>
                  <option value="fund">Fund</option>
                </select>
              </TaxField>
              <TaxField label="Filing status">
                <select
                  value={advanced.filingStatus}
                  onChange={(event) => handleAdvancedChange("filingStatus", event.target.value)}
                >
                  <option value="single">Single</option>
                  <option value="married-joint">Married (Joint)</option>
                  <option value="married-separate">Married (Separate)</option>
                  <option value="head-of-household">Head of household</option>
                </select>
              </TaxField>
              <TaxField label="Salary income">
                <input
                  type="text"
                  inputMode="decimal"
                  value={additionalIncome.salary}
                  onChange={(event) => handleIncomeChange("salary", event.target.value)}
                />
              </TaxField>
              <TaxField label="Dividends">
                <input
                  type="text"
                  inputMode="decimal"
                  value={additionalIncome.dividends}
                  onChange={(event) => handleIncomeChange("dividends", event.target.value)}
                />
              </TaxField>
              <TaxField label="Interest">
                <input
                  type="text"
                  inputMode="decimal"
                  value={additionalIncome.interest}
                  onChange={(event) => handleIncomeChange("interest", event.target.value)}
                />
              </TaxField>
              <TaxField label="Staking / airdrops">
                <input
                  type="text"
                  inputMode="decimal"
                  value={Number(additionalIncome.stakingRewards || 0) + Number(additionalIncome.airdrops || 0)}
                  onChange={(event) => {
                    const next = parseDecimalInput(event.target.value);
                    setAdditionalIncome((current) => ({
                      ...current,
                      stakingRewards: next / 2,
                      airdrops: next / 2,
                    }));
                  }}
                />
              </TaxField>
            </div>

            <TaxField
              label="Scenario notes"
              className="full-span"
              message={validationState.fieldWarnings.notes}
              tone={validationState.fieldWarnings.notes ? "warning" : "default"}
            >
              <textarea
                value={advanced.notes}
                onChange={(event) => handleAdvancedChange("notes", event.target.value)}
                placeholder="Add filing assumptions, exceptions, treaty treatment, or any manual basis adjustments."
              />
            </TaxField>

            <div className="tax-workbench-import-row">
              <label className="tax-workbench-file-input">
                <span>Import statement preview</span>
                <input type="file" onChange={handleDocumentImport} />
              </label>
              {showImportPreview ? (
                <div className="tax-workbench-import-preview">
                  <strong>{fileName || "Imported file attached"}</strong>
                  <span>Preview only. Reconcile jurisdiction, basis, proceeds, and FX before submitting.</span>
                </div>
              ) : null}
            </div>
          </section>

          <section className="tax-workbench-panel tax-workbench-insights">
            <DensePanelHeader
              title="Insights"
              subtitle="Warnings, harvest ideas, and quick judgment support."
              actions={
                <button
                  type="button"
                  className="tax-workbench-link-btn"
                  onClick={() => setShowInsights((current) => !current)}
                  aria-expanded={showInsights}
                  aria-controls={insightsPanelId}
                >
                  {showInsights ? "Hide" : "Show"}
                </button>
              }
            />

            <div className="tax-workbench-warning-list" role="status" aria-live="polite">
              {inputWarnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>

            {showInsights ? (
              taxLossSuggestions.length ? (
                <div id={insightsPanelId} className="tax-workbench-insight-list">
                  {taxLossSuggestions.map((idea) => (
                    <article key={idea.symbol} className="tax-workbench-insight-card">
                      <div>
                        <strong>{idea.symbol}</strong>
                        <span>{idea.name}</span>
                      </div>
                      <dl>
                        <div><dt>Unrealized loss</dt><dd>{formatMoney(idea.unrealizedLoss, advanced.currency || "USD")}</dd></div>
                        <div><dt>Offset available</dt><dd>{formatMoney(idea.offsetAmount, advanced.currency || "USD")}</dd></div>
                        <div><dt>Estimated saving</dt><dd>{formatMoney(idea.estimatedSaving, advanced.currency || "USD")}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="tax-workbench-empty">
                  <h3>No harvest candidates</h3>
                  <p>Current portfolio holdings do not show meaningful unrealized losses against the taxable base.</p>
                </div>
              )
            ) : null}
          </section>

          <section className="tax-workbench-panel tax-workbench-results">
            <DensePanelHeader
              title={accountantCopy.resultsTitle}
              subtitle={accountantCopy.resultsSubtitle}
            />

            {results.length ? (
              <div className="tax-workbench-result-list">
                {results.map((row) => (
                  <article key={row.jurisdictionKey} className="tax-workbench-result-card">
                    <div className="tax-workbench-result-head">
                      <div>
                        <strong>{countryFlag(row.jurisdictionKey)} {row.jurisdiction}</strong>
                        <span>{row.currency} filing basis</span>
                      </div>
                      <div>
                        <strong>{row.currency} {row.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        <span>≈ {formatMoney(row.liabilityUSD, "USD")}</span>
                      </div>
                    </div>
                    <div className="tax-workbench-result-lines">
                      {Object.entries(row.details).map(([label, value]) => (
                        <div key={label}>
                          <span>{label}</span>
                          <strong>{row.currency} {Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <GuidedEmptyState
                eyebrow="Decision workflow"
                title="No liabilities calculated yet"
                description="Review the ledger and summary inputs, then run the primary calculation to generate jurisdiction outputs."
                steps={[
                  "Confirm the jurisdictions and gains ledger reflect the scenario you want to test.",
                  "Use the Decision Summary action once the validation state is ready.",
                ]}
                tone="subtle"
                className="tax-guided-empty"
              />
            )}
            {results.length > 1 ? (
              <div
                className="tax-workbench-liability-bar"
                role="img"
                aria-label={`Liability by jurisdiction chart. ${results.length} jurisdictions. Lowest is ${Math.min(...results.map((r) => r.liabilityUSD)).toLocaleString(undefined, { style: "currency", currency: "USD" })}; highest is ${Math.max(...results.map((r) => r.liabilityUSD)).toLocaleString(undefined, { style: "currency", currency: "USD" })}.`}
              >
                <div className="zenin-eyebrow">Liability by jurisdiction (USD)</div>
                {(() => {
                  const maxLiability = Math.max(...results.map((r) => r.liabilityUSD), 1);
                  return results.map((row) => {
                    const pct = (row.liabilityUSD / maxLiability) * 100;
                    return (
                      <div key={row.jurisdictionKey} className="tax-workbench-liability-row">
                        <span className="tax-workbench-liability-label">{countryFlag(row.jurisdictionKey)} {row.jurisdiction}</span>
                        <span className="tax-workbench-liability-track" aria-hidden="true">
                          <i style={{ width: `${Math.max(2, pct).toFixed(2)}%` }} />
                        </span>
                        <strong className="tax-workbench-liability-value">{formatMoney(row.liabilityUSD, "USD")}</strong>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : null}
          </section>
        </div>
        ) : (
          <button
            type="button"
            className="tax-workbench-utility-toggle"
            onClick={() => setShowUtilities(true)}
            aria-expanded={showUtilities}
            aria-controls={utilitiesPanelId}
          >
            Show advanced context, import tools, and liability detail
          </button>
        )}

        {jurisdictionRecommendations.length ? (
          <section className="tax-workbench-panel tax-workbench-ideas">
            <DensePanelHeader
              title="Jurisdiction Ideas"
              subtitle="Lower-liability alternatives based on the current gains mix. Click Apply to add a jurisdiction to the ledger."
            />
            <div className="tax-workbench-idea-grid">
              {jurisdictionRecommendations.map((row) => {
                const isApplied = jurisdictions.includes(row.key);
                return (
                  <article key={row.key} className={`tax-workbench-idea-card ${isApplied ? "is-applied" : ""}`}>
                    <strong>{countryFlag(row.key)} {row.name}</strong>
                    <span>{row.logic}</span>
                    <div>
                      <em>Potential saving</em>
                      <strong>{formatMoney(row.saving, advanced.currency || "USD")}</strong>
                    </div>
                    <button
                      type="button"
                      className="tax-workbench-idea-apply"
                      onClick={() => {
                        if (isApplied) {
                          setJurisdictions((prev) => prev.filter((item) => item !== row.key));
                        } else {
                          setJurisdictions((prev) => (prev.includes(row.key) ? prev : [...prev, row.key]));
                        }
                      }}
                      aria-pressed={isApplied}
                    >
                      {isApplied ? "Remove" : "Apply"}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        <details className="tax-workbench-panel tax-workbench-footer">
          <summary>{accountantCopy.footerTitle}</summary>
          <div className="tax-workbench-footer-body">
            <p>
              This estimator is informational only and does not replace tax advice. Validate rates, treaty treatment, entity structure, and filing rules with a qualified advisor.
            </p>
            <div className="tax-workbench-source-links">
              {taxSources.length ? (
                taxSources.map((source) => (
                  <a key={source.href} href={source.href} target="_blank" rel="noreferrer">
                    {source.label}
                  </a>
                ))
              ) : (
                <span>No external sources linked in runtime config.</span>
              )}
            </div>
          </div>
        </details>
      </form>

      <RightRailDrawer
        open={showSavedScenarios}
        onClose={() => setShowSavedScenarios(false)}
        title={accountantMode ? "Saved Review Packs" : "Saved Tax Scenarios"}
        subtitle={accountantMode ? "Reusable accountant-facing estimate states with jurisdiction context, notes, and stored outputs." : "Reusable estimate states with jurisdiction, context, and stored outputs."}
      >
        <div className="tax-workbench-saved-list">
          {savedEstimates.length ? (
            savedEstimates.map((entry) => {
              const savedTax =
                Array.isArray(entry.results) && entry.results.length
                  ? entry.results.reduce((sum, row) => sum + Number(row.liabilityUSD || 0), 0)
                  : 0;
              return (
                <div key={entry.id} className="tax-workbench-saved-row">
                  <div className="tax-workbench-saved-main">
                    <strong>{entry.label || "Saved scenario"}</strong>
                    <span>
                      {Array.isArray(entry.jurisdictions) && entry.jurisdictions.length
                        ? entry.jurisdictions.join(", ")
                        : "No jurisdictions recorded"}
                    </span>
                  </div>
                  <div className="tax-workbench-saved-meta">
                    <span>{formatSavedTimestamp(entry.savedAt)}</span>
                    <strong>{formatMoney(savedTax, "USD")}</strong>
                    <span>
                      {Array.isArray(entry.results) ? `${entry.results.length} result${entry.results.length === 1 ? "" : "s"}` : "0 results"}
                    </span>
                  </div>
                  <InlineControlGroup className="tax-workbench-saved-actions">
                    <button type="button" className="tax-workbench-btn" onClick={() => handleLoadSavedScenario(entry)}>
                      Load
                    </button>
                    <button type="button" className="tax-workbench-btn danger" onClick={() => handleDeleteSavedScenario(entry.id)}>
                      Delete
                    </button>
                  </InlineControlGroup>
                </div>
              );
            })
          ) : (
            <GuidedEmptyState
              eyebrow="Scenario library"
              title="No saved scenarios yet"
              description="Save the scenarios you want to compare or share with an accountant after you run the first estimate."
              steps={[
                "Run a calculation once the ledger and jurisdictions are ready.",
                "Save the scenario so it can be reloaded, compared, or exported later.",
              ]}
              tone="subtle"
              className="tax-guided-empty"
            />
          )}
        </div>
      </RightRailDrawer>
    </div>
  );
}

function LedgerInput({ label, value, onChange, disabled = false, tone = "", invalid = false, message = "" }) {
  const describedById = useId();
  return (
    <label className={`tax-workbench-ledger-input ${tone} ${invalid ? "is-invalid" : ""}`.trim()}>
      <span className="sr-only">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={Number.isFinite(Number(value)) ? String(value) : ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={message ? describedById : undefined}
        spellCheck={false}
      />
      {message ? <span id={describedById} className="tax-workbench-inline-message">{message}</span> : null}
    </label>
  );
}

function TaxField({ label, children, className = "", invalid = false, message = "", tone = "default" }) {
  const describedById = useId();
  const child = React.isValidElement(children)
    ? React.cloneElement(children, {
        "aria-invalid": invalid || undefined,
        "aria-describedby": message ? describedById : undefined,
      })
    : children;
  return (
    <label className={`tax-workbench-field ${className} ${invalid ? "has-error" : ""} ${tone === "warning" ? "has-warning" : ""}`.trim()}>
      <span>{label}</span>
      {child}
      {message ? <span id={describedById} className={`tax-workbench-inline-message ${tone}`.trim()}>{message}</span> : null}
    </label>
  );
}
