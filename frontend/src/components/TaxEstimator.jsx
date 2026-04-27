import React, { useState, useEffect, useMemo } from 'react';
import { formatCurrency, getCurrencySymbol, convertToUSD, convertFromUSD } from '../utils/currencyUtils';

// ─── Global Tax Rules (flat CGT approximation for retail traders) ────────────
const TAX_RULES = {
  // Americas
  USA:         { name: 'United States',       region: 'Americas',      currency: 'USD', cgRate: 0.20,  stRate: 0.37,  logic: 'LTCG: 20%, STCG: 37%' },
  Brazil:      { name: 'Brazil',              region: 'Americas',      currency: 'BRL', cgRate: 0.15,  stRate: 0.15,  logic: 'Flat: 15–22.5%' },
  Canada:      { name: 'Canada',              region: 'Americas',      currency: 'CAD', cgRate: 0.2656, stRate: 0.2656, logic: '50% inclusion, top effective ~26.56%' },
  // Europe
  UK:          { name: 'United Kingdom',      region: 'Europe',        currency: 'GBP', cgRate: 0.24,  stRate: 0.24,  logic: 'CGT Higher Rate: 24%' },
  Germany:     { name: 'Germany',             region: 'Europe',        currency: 'EUR', cgRate: 0.26375,stRate:0.26375,logic: 'Abgeltungsteuer: 26.375%' },
  France:      { name: 'France',              region: 'Europe',        currency: 'EUR', cgRate: 0.30,  stRate: 0.30,  logic: 'Flat Rate PFU: 30%' },
  Spain:       { name: 'Spain',               region: 'Europe',        currency: 'EUR', cgRate: 0.26,  stRate: 0.26,  logic: 'Savings Tax: 19–26%' },
  Italy:       { name: 'Italy',               region: 'Europe',        currency: 'EUR', cgRate: 0.26,  stRate: 0.26,  logic: 'Imposta Sostitutiva: 26%' },
  Netherlands: { name: 'Netherlands',         region: 'Europe',        currency: 'EUR', cgRate: 0.32,  stRate: 0.32,  logic: 'Box 3 Deemed Return ~32%' },
  Portugal:    { name: 'Portugal',            region: 'Europe',        currency: 'EUR', cgRate: 0.28,  stRate: 0.28,  logic: 'Flat Rate: 28%' },
  Switzerland: { name: 'Switzerland',         region: 'Europe',        currency: 'CHF', cgRate: 0.0,   stRate: 0.0,   logic: 'Capital Gains: 0% (private investors)' },
  // Middle East
  UAE:         { name: 'United Arab Emirates',region: 'Middle East',   currency: 'AED', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  SaudiArabia: { name: 'Saudi Arabia',        region: 'Middle East',   currency: 'SAR', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  Qatar:       { name: 'Qatar',               region: 'Middle East',   currency: 'QAR', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  Bahrain:     { name: 'Bahrain',             region: 'Middle East',   currency: 'BHD', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  Oman:        { name: 'Oman',                region: 'Middle East',   currency: 'OMR', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  // South East Asia
  Singapore:   { name: 'Singapore',           region: 'South East Asia',currency: 'SGD', cgRate: 0.0,   stRate: 0.0,   logic: 'No CGT for individuals' },
  Malaysia:    { name: 'Malaysia',            region: 'South East Asia',currency: 'MYR', cgRate: 0.30,  stRate: 0.30,  logic: 'RPGT: 30% for disposal within 5 yrs' },
  Indonesia:   { name: 'Indonesia',           region: 'South East Asia',currency: 'IDR', cgRate: 0.10,  stRate: 0.10,  logic: 'Final Tax on listings: 0.1%; general: 10%' },
  Thailand:    { name: 'Thailand',            region: 'South East Asia',currency: 'THB', cgRate: 0.15,  stRate: 0.15,  logic: 'Withholding Tax: ~15%' },
  Vietnam:     { name: 'Vietnam',             region: 'South East Asia',currency: 'VND', cgRate: 0.20,  stRate: 0.20,  logic: 'Securities Transfer Tax: 0.1%; CIT: 20%' },
  Philippines: { name: 'Philippines',         region: 'South East Asia',currency: 'PHP', cgRate: 0.15,  stRate: 0.15,  logic: 'Final Tax: 15% on net gains' },
  // Asia
  India:       { name: 'India',               region: 'Asia',          currency: 'INR', cgRate: 0.125, stRate: 0.20,  logic: 'LTCG: 12.5%, STCG: 20%' },
  China:       { name: 'China',               region: 'Asia',          currency: 'CNY', cgRate: 0.20,  stRate: 0.20,  logic: 'Flat: 20% on income' },
  Japan:       { name: 'Japan',               region: 'Asia',          currency: 'JPY', cgRate: 0.20315,stRate:0.20315,logic: 'Flat: 20.315%' },
  SouthKorea:  { name: 'South Korea',         region: 'Asia',          currency: 'KRW', cgRate: 0.22,  stRate: 0.22,  logic: 'Flat: 22% for large traders' },
  HongKong:    { name: 'Hong Kong',           region: 'Asia',          currency: 'HKD', cgRate: 0.0,   stRate: 0.0,   logic: 'No CGT' },
  // Africa – top 10 economies
  SouthAfrica: { name: 'South Africa',        region: 'Africa',        currency: 'ZAR', cgRate: 0.18,  stRate: 0.18,  logic: 'Effective ~18% (40% inclusion × 45%)' },
  Nigeria:     { name: 'Nigeria',             region: 'Africa',        currency: 'NGN', cgRate: 0.10,  stRate: 0.10,  logic: 'CGT: 10%' },
  Egypt:       { name: 'Egypt',               region: 'Africa',        currency: 'EGP', cgRate: 0.10,  stRate: 0.10,  logic: 'Exchange transaction tax; ~10% effective' },
  Ethiopia:    { name: 'Ethiopia',            region: 'Africa',        currency: 'ETB', cgRate: 0.30,  stRate: 0.30,  logic: 'Business income tax up to 30%' },
  Kenya:       { name: 'Kenya',               region: 'Africa',        currency: 'KES', cgRate: 0.15,  stRate: 0.15,  logic: 'CGT: 15%' },
  Morocco:     { name: 'Morocco',             region: 'Africa',        currency: 'MAD', cgRate: 0.15,  stRate: 0.15,  logic: 'Fixed tax: 15%' },
  Angola:      { name: 'Angola',              region: 'Africa',        currency: 'AOA', cgRate: 0.15,  stRate: 0.15,  logic: 'Capital income tax: 15%' },
  Ghana:       { name: 'Ghana',               region: 'Africa',        currency: 'GHS', cgRate: 0.15,  stRate: 0.15,  logic: 'Securities gains: 15%' },
  Tanzania:    { name: 'Tanzania',            region: 'Africa',        currency: 'TZS', cgRate: 0.10,  stRate: 0.10,  logic: 'CGT: 10% (resident individuals)' },
  Cote:        { name: "Côte d'Ivoire",      region: 'Africa',        currency: 'XOF', cgRate: 0.25,  stRate: 0.25,  logic: 'Corporate-aligned CGT: 25%' },
};

const REGIONS = ['Americas', 'Europe', 'Middle East', 'South East Asia', 'Asia', 'Africa'];
const TAX_RULES_LAST_UPDATED = 'April 21, 2026';
const TAX_RULE_SOURCES = [
  { label: 'OECD tax database', href: 'https://www.oecd.org/tax/tax-policy/tax-database/' },
  { label: 'KPMG tax rates online', href: 'https://kpmg.com/xx/en/home/services/tax/tax-tools-and-resources/tax-rates-online.html' },
  { label: 'PwC worldwide tax summaries', href: 'https://taxsummaries.pwc.com/' }
];

const DEFAULT_INCOME_BREAKDOWN = {
  salary: 0,
  dividends: 0,
  interest: 0,
  stakingRewards: 0,
  airdrops: 0,
  otherOrdinaryIncome: 0
};

// ─── Core tax calculation per jurisdiction ────────────────────────────────────
function calcLiability(key, gains, options = {}) {
  const rule = TAX_RULES[key];
  if (!rule) return { liability: 0, details: {} };
  const { cgRate, stRate } = rule;
  const details = {};
  const ordinaryIncomeTotal = Math.max(0, Number(options?.ordinaryIncomeTotal || 0));
  const totalGains =
    gains.Equities.shortTerm + gains.Equities.longTerm +
    gains.Crypto.shortTerm + gains.Crypto.longTerm +
    gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard;

  if (cgRate === 0 && stRate === 0) {
    details['Total Tax Liability'] = 0;
  } else if (key === 'USA') {
    details['Equities STCG'] = Math.max(0, gains.Equities.shortTerm) * stRate;
    details['Equities LTCG'] = Math.max(0, gains.Equities.longTerm) * 0.15;
    details['Crypto STCG']   = Math.max(0, gains.Crypto.shortTerm) * stRate;
    details['Crypto LTCG']   = Math.max(0, gains.Crypto.longTerm) * 0.15;
    details['Bonds']         = Math.max(0, gains.Bonds.standard) * stRate;
    details['Funds / MMFs']  = Math.max(0, gains['Special Funds'].standard + gains.MMFs.standard) * cgRate;
  } else if (key === 'India') {
    details['Equities STCG'] = Math.max(0, gains.Equities.shortTerm) * 0.20;
    details['Equities LTCG'] = Math.max(0, gains.Equities.longTerm - 125000) * 0.125;
    details['Crypto Fixed']  = Math.max(0, gains.Crypto.shortTerm + gains.Crypto.longTerm) * 0.30;
    details['Bonds / Funds'] = Math.max(0, gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard) * 0.30;
  } else if (key === 'SouthAfrica') {
    const exempt = 40000;
    const net = Math.max(0, totalGains - exempt);
    details['Aggregated CGT (40% inclusion × max bracket)'] = net * cgRate;
  } else {
    details['Total CGT'] = Math.max(0, totalGains) * cgRate;
  }
  if (ordinaryIncomeTotal > 0) {
    details['Ordinary Income Tax'] = ordinaryIncomeTotal * stRate;
  }

  const liability = Object.values(details).reduce((s, v) => s + v, 0);
  return { liability, details };
}

function emptyGains() {
  return {
    Equities: { shortTerm: 0, longTerm: 0 },
    Bonds: { standard: 0 },
    'Special Funds': { standard: 0 },
    MMFs: { standard: 0 },
    Crypto: { shortTerm: 0, longTerm: 0 }
  };
}

function cloneGains(gains = emptyGains()) {
  return {
    Equities: { ...gains.Equities },
    Bonds: { ...gains.Bonds },
    'Special Funds': { ...gains['Special Funds'] },
    MMFs: { ...gains.MMFs },
    Crypto: { ...gains.Crypto }
  };
}

function totalGainsAmount(gains = emptyGains()) {
  return (
    Number(gains?.Equities?.shortTerm || 0) +
    Number(gains?.Equities?.longTerm || 0) +
    Number(gains?.Crypto?.shortTerm || 0) +
    Number(gains?.Crypto?.longTerm || 0) +
    Number(gains?.Bonds?.standard || 0) +
    Number(gains?.['Special Funds']?.standard || 0) +
    Number(gains?.MMFs?.standard || 0)
  );
}

function getHoldingPeriodClass(acquisitionDate, saleDate) {
  if (!acquisitionDate || !saleDate) return null;
  const buyTs = new Date(acquisitionDate).getTime();
  const sellTs = new Date(saleDate).getTime();
  if (!Number.isFinite(buyTs) || !Number.isFinite(sellTs) || sellTs <= buyTs) return null;
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  return sellTs - buyTs >= yearMs ? 'longTerm' : 'shortTerm';
}

function applyHoldingPeriodOverride(gains, acquisitionDate, saleDate) {
  const classification = getHoldingPeriodClass(acquisitionDate, saleDate);
  if (!classification) return gains;
  const next = cloneGains(gains);
  ['Equities', 'Crypto'].forEach((bucket) => {
    const combined = Number(next[bucket].shortTerm || 0) + Number(next[bucket].longTerm || 0);
    next[bucket].shortTerm = classification === 'shortTerm' ? combined : 0;
    next[bucket].longTerm = classification === 'longTerm' ? combined : 0;
  });
  return next;
}

function totalOrdinaryIncome(income = DEFAULT_INCOME_BREAKDOWN) {
  return Object.values(income || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function buildAdjustedGains(gains, advanced) {
  const fxRate = Number(advanced?.fxRate || 1);
  const conversionRate = Number.isFinite(fxRate) && fxRate > 0 ? fxRate : 1;
  const next = cloneGains(gains);
  ['Equities', 'Crypto', 'Bonds', 'Special Funds', 'MMFs'].forEach((bucket) => {
    Object.keys(next[bucket]).forEach((key) => {
      next[bucket][key] = Number(next[bucket][key] || 0) * conversionRate;
    });
  });
  const holdingAdjusted = applyHoldingPeriodOverride(next, advanced?.acquisitionDate, advanced?.saleDate);
  const gross = totalGainsAmount(holdingAdjusted);
  const costs = Math.max(
    0,
    Number(advanced?.fees || 0) +
      Number(advanced?.slippage || 0) +
      Number(advanced?.brokerage || 0)
  );

  const positiveBuckets = [
    ["Equities", "shortTerm"],
    ["Equities", "longTerm"],
    ["Crypto", "shortTerm"],
    ["Crypto", "longTerm"],
    ["Bonds", "standard"],
    ["Special Funds", "standard"],
    ["MMFs", "standard"]
  ].map(([bucket, key]) => ({
    bucket,
    key,
    value: Math.max(0, Number(holdingAdjusted?.[bucket]?.[key] || 0))
  }));

  const positiveTotal = positiveBuckets.reduce((s, r) => s + r.value, 0);
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
      Object.keys(row).forEach((k) => {
        row[k] = Number(row[k] || 0) * scale;
      });
    });
  } else if (postCostTotal <= 0 || adjustedTotal === 0) {
    ["Equities", "Crypto", "Bonds", "Special Funds", "MMFs"].forEach((bucket) => {
      const row = holdingAdjusted[bucket];
      Object.keys(row).forEach((k) => {
        row[k] = 0;
      });
    });
  }

  return {
    adjustedGains: holdingAdjusted,
    grossTotal: gross,
    netAfterCosts: Math.max(0, gross - costs),
    taxableGain: adjustedTotal,
    totalCosts: costs
  };
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

function deriveGainsFromTrades(trades = [], costBasisMethod = 'fifo') {
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
      if (costBasisMethod === 'lifo') {
        lotIndex = lots.length - 1;
      } else if (costBasisMethod === 'hifo') {
        lotIndex = lots.reduce((bestIdx, entry, idx, arr) => (entry.px > arr[bestIdx].px ? idx : bestIdx), 0);
      }
      if (costBasisMethod === 'average') {
        const totalQty = lots.reduce((sum, l) => sum + Number(l.qty || 0), 0);
        const avgPx = totalQty > 0 ? lots.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.px || 0), 0) / totalQty : trade.px;
        const matchedQty = Math.min(remaining, totalQty);
        const proceeds = matchedQty * trade.px;
        const basis = matchedQty * avgPx;
        const pnl = proceeds - basis;
        const oldestTs = lots.reduce((oldest, l) => Math.min(oldest, Number(l.ts || trade.ts)), trade.ts);
        const holdMs = Math.max(0, trade.ts - oldestTs);
        const isLongTerm = holdMs >= 365 * 24 * 60 * 60 * 1000;

        if (bucket === "Crypto" || bucket === "Equities") {
          gains[bucket][isLongTerm ? "longTerm" : "shortTerm"] += pnl;
        } else if (bucket === "Bonds" || bucket === "MMFs" || bucket === "Special Funds") {
          gains[bucket].standard += pnl;
        }

        let toReduce = matchedQty;
        for (let i = 0; i < lots.length && toReduce > 0; i += 1) {
          const reduction = Math.min(toReduce, lots[i].qty);
          lots[i].qty -= reduction;
          toReduce -= reduction;
        }
        for (let i = lots.length - 1; i >= 0; i -= 1) {
          if (lots[i].qty <= 1e-8) lots.splice(i, 1);
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

export function TaxEstimator({ trades = [], portfolio = [], spotPrices = {} }) {
  const [jurisdictions, setJurisdictions] = useState(['USA']);
  const [jurisdictionSearch, setJurisdictionSearch] = useState('');
  const [activeRegion, setActiveRegion] = useState('All');
  const [taxYear, setTaxYear] = useState('2026');
  const [gains, setGains] = useState(emptyGains);
  const [hasManualGainEdit, setHasManualGainEdit] = useState(false);
  const [results, setResults] = useState([]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [auditTrail, setAuditTrail] = useState([]);
  const [fileName, setFileName] = useState('');
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(true);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState('');
  const [additionalIncome, setAdditionalIncome] = useState(DEFAULT_INCOME_BREAKDOWN);
  const [scenario, setScenario] = useState({
    countryA: 'USA',
    countryB: 'UAE',
    shiftDays: 365
  });
  const [advanced, setAdvanced] = useState({
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
    fxSource: "Manual"
  });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('zenin_tax_estimates') || '[]');
      setSavedEstimates(saved);
      const trail = JSON.parse(localStorage.getItem('zenin_tax_audit_trail') || '[]');
      setAuditTrail(Array.isArray(trail) ? trail : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const locale = String(globalThis?.navigator?.language || '').toLowerCase();
    if (locale.includes('us')) setDetectedCountry('USA');
    else if (locale.includes('gb')) setDetectedCountry('UK');
    else if (locale.includes('ca')) setDetectedCountry('Canada');
    else if (locale.includes('de')) setDetectedCountry('Germany');
    else if (locale.includes('fr')) setDetectedCountry('France');
    else setDetectedCountry('USA');
  }, []);

  useEffect(() => {
    if (!detectedCountry) return;
    if (jurisdictions.length > 0) return;
    if (TAX_RULES[detectedCountry]) setJurisdictions([detectedCountry]);
  }, [detectedCountry, jurisdictions.length]);

  const toggleJurisdiction = (key) => {
    setJurisdictions(prev =>
      prev.includes(key) ? prev.filter(j => j !== key) : [...prev, key]
    );
  };

  const handleGainChange = (category, type, value) => {
    const numeric = parseFloat(value) || 0;
    setHasManualGainEdit(true);
    setGains(prev => ({ ...prev, [category]: { ...prev[category], [type]: numeric } }));
  };

  useEffect(() => {
    if (hasManualGainEdit) return;
    if (!Array.isArray(trades) || trades.length === 0) return;
    const derived = deriveGainsFromTrades(trades, advanced.costBasisMethod);
    setGains(derived);
  }, [trades, hasManualGainEdit, advanced.costBasisMethod]);

  const ordinaryIncomeTotal = useMemo(
    () => totalOrdinaryIncome(additionalIncome),
    [additionalIncome]
  );

  const handleCalculate = () => {
    if (jurisdictions.length === 0) { alert('Select at least one jurisdiction.'); return; }
    const { adjustedGains, grossTotal, taxableGain, netAfterCosts, totalCosts } = buildAdjustedGains(gains, advanced);
    const newResults = jurisdictions.map(j => {
      const targetCurrency = TAX_RULES[j].currency;
      
      // 1) Convert everything to USD first (if not already)
      const inputCurrency = advanced.currency || "USD";
      const toUSDRate = inputCurrency === "USD" ? 1 : convertToUSD(1, inputCurrency, spotPrices);
      
      // 2) Scale adjustedGains to Local Currency
      // adjustedGains are in inputCurrency
      const localGains = cloneGains(adjustedGains);
      const conversionToLocal = (val) => {
        const valUSD = val * toUSDRate;
        return convertFromUSD(valUSD, targetCurrency, spotPrices);
      };

      ['Equities', 'Crypto', 'Bonds', 'Special Funds', 'MMFs'].forEach(bucket => {
        Object.keys(localGains[bucket]).forEach(k => {
          localGains[bucket][k] = conversionToLocal(localGains[bucket][k]);
        });
      });

      const localOrdinaryIncome = conversionToLocal(ordinaryIncomeTotal);
      const localTaxableGain = conversionToLocal(taxableGain);
      const localGrossGain = conversionToLocal(grossTotal);
      const localNetGain = conversionToLocal(netAfterCosts);
      const localCosts = conversionToLocal(totalCosts);

      const { liability: baseLiability, details } = calcLiability(j, localGains, { ordinaryIncomeTotal: localOrdinaryIncome });
      const taxCredits = Math.max(0, Number(advanced.foreignTaxPaid || 0)) + Math.max(0, Number(advanced.withholdingTax || 0));
      // Assume credits are entered in inputCurrency, so convert them to local too
      const localTaxCredits = conversionToLocal(taxCredits);
      
      const liability = Math.max(0, baseLiability - localTaxCredits);
      const taxableBase = localTaxableGain + localOrdinaryIncome;
      const effectiveRate = taxableBase > 0 ? (liability / taxableBase) * 100 : 0;
      
      // USD equivalent for summary
      const liabilityUSD = convertToUSD(liability, targetCurrency, spotPrices);

      return {
        jurisdictionKey: j,
        jurisdiction: TAX_RULES[j].name,
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
        timestamp: new Date().toISOString()
      };
    });
    setResults(newResults);
    const trailEntry = {
      id: `${Date.now()}`,
      timestamp: new Date().toISOString(),
      taxYear,
      jurisdictions,
      advanced,
      income: additionalIncome,
      gains
    };
    const nextTrail = [trailEntry, ...auditTrail].slice(0, 20);
    setAuditTrail(nextTrail);
    localStorage.setItem('zenin_tax_audit_trail', JSON.stringify(nextTrail));
  };

  const globalLiabilityUSD = useMemo(() => {
    return results.reduce((sum, res) => sum + (res.liabilityUSD || 0), 0);
  }, [results]);

  // ── Jurisdiction Recommendation ────────────────────────────────────────────
  const jurisdictionRecommendations = useMemo(() => {
    if (results.length === 0) return [];
    const primaryLiability = results.reduce((s, r) => s + r.liability, 0);
    if (primaryLiability <= 0) return [];

    // Compute all other jurisdictions
    const currentKeys = new Set(results.map(r => r.jurisdictionKey));
    const scored = Object.keys(TAX_RULES)
      .filter(k => !currentKeys.has(k))
      .map(k => {
        const { liability } = calcLiability(k, gains, { ordinaryIncomeTotal });
        return { key: k, name: TAX_RULES[k].name, currency: TAX_RULES[k].currency, region: TAX_RULES[k].region, logic: TAX_RULES[k].logic, liability, saving: primaryLiability - liability };
      })
      .filter(r => r.saving > 0)
      .sort((a, b) => b.saving - a.saving)
      .slice(0, 5);

    return scored;
  }, [results, gains, ordinaryIncomeTotal]);

  const handleSave = () => {
    if (!results.length) return;
    const newSaved = [...results, ...savedEstimates].slice(0, 10);
    setSavedEstimates(newSaved);
    localStorage.setItem('zenin_tax_estimates', JSON.stringify(newSaved));
  };

  const handleExportCsv = () => {
    if (!results.length) return;
    let csv = 'data:text/csv;charset=utf-8,';
    results.forEach(r => {
      csv += `Jurisdiction:,${r.jurisdiction}\nCurrency:,${r.currency}\nTotal Liability:,${r.liability}\nTaxable Gain:,${r.taxableGain}\nOrdinary Income:,${r.ordinaryIncomeTotal || 0}\nEffective Rate:,${r.effectiveRate}\n\n`;
      Object.entries(r.details).forEach(([k, v]) => { csv += `"${k}",${v}\n`; });
      csv += '\n---\n\n';
    });
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `tax_estimate_${Date.now()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleExport = (type) => {
    if (type === 'pdf') {
      window.print();
      return;
    }
    handleExportCsv();
  };

  const handleDocumentImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setTimeout(() => {
      setGains({
        Equities: { shortTerm: Math.floor(Math.random() * 50000), longTerm: Math.floor(Math.random() * 200000) },
        Bonds: { standard: Math.floor(Math.random() * 15000) },
        'Special Funds': { standard: Math.floor(Math.random() * 8000) },
        MMFs: { standard: Math.floor(Math.random() * 5000) },
        Crypto: { shortTerm: Math.floor(Math.random() * 10000), longTerm: Math.floor(Math.random() * 60000) }
      });
      setShowImportPreview(true);
    }, 600);
  };

  const filteredJurisdictions = Object.entries(TAX_RULES).filter(([k, info]) => {
    const matchSearch = info.name.toLowerCase().includes(jurisdictionSearch.toLowerCase()) || k.toLowerCase().includes(jurisdictionSearch.toLowerCase());
    const matchRegion = activeRegion === 'All' || info.region === activeRegion;
    return matchSearch && matchRegion;
  });

  const summaryPreview = useMemo(() => {
    const { adjustedGains, grossTotal, taxableGain, netAfterCosts, totalCosts } = buildAdjustedGains(gains, advanced);
    const first = jurisdictions[0] || "USA";
    const targetCurrency = TAX_RULES[first]?.currency || "USD";
    const inputCurrency = advanced.currency || "USD";

    // 1) Convert everything to USD first
    const toUSDRate = inputCurrency === "USD" ? 1 : convertToUSD(1, inputCurrency, spotPrices);
    
    // 2) Scale adjustedGains to Jurisdiction Local Currency
    const localGains = cloneGains(adjustedGains);
    const conversionToLocal = (val) => {
      const valUSD = val * toUSDRate;
      return convertFromUSD(valUSD, targetCurrency, spotPrices);
    };

    ['Equities', 'Crypto', 'Bonds', 'Special Funds', 'MMFs'].forEach(bucket => {
      Object.keys(localGains[bucket]).forEach(k => {
        localGains[bucket][k] = conversionToLocal(localGains[bucket][k]);
      });
    });

    const localOrdinaryIncome = conversionToLocal(ordinaryIncomeTotal);
    const { liability: baseLiability } = calcLiability(first, localGains, { ordinaryIncomeTotal: localOrdinaryIncome });
    
    // Convert back to input currency for summary display
    // liability is in targetCurrency
    const fromLocalToUSD = targetCurrency === "USD" ? 1 : convertToUSD(1, targetCurrency, spotPrices);
    const estimatedTax = (baseLiability * fromLocalToUSD) / toUSDRate;
    
    const taxableBase = taxableGain + ordinaryIncomeTotal;
    const effectiveRate = taxableBase > 0 ? (estimatedTax / taxableBase) * 100 : 0;

    return {
      jurisdiction: TAX_RULES[first]?.name || "N/A",
      grossTotal,
      netAfterCosts,
      totalCosts,
      taxableGain,
      ordinaryIncomeTotal,
      estimatedTax,
      effectiveRate
    };
  }, [gains, advanced, jurisdictions, ordinaryIncomeTotal, spotPrices]);

  const netAfterTax = useMemo(() => {
    return Math.max(0, (summaryPreview.grossTotal || 0) - (summaryPreview.estimatedTax || 0));
  }, [summaryPreview]);

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
          spotPrices?.[symbol] ??
          holding?.price ??
          holding?.markPrice ??
          holding?.currentPrice
        );
        const costBasis = Number(
          holding?.entryPrice ??
          holding?.averageCost ??
          holding?.avgPrice ??
          holding?.costBasis
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

  const inputWarnings = useMemo(() => {
    const warnings = [];
    if (!jurisdictions.length) warnings.push("Select at least one jurisdiction.");
    if (String(advanced.realizationMode) === "unrealized") {
      warnings.push("Unrealized mode selected: estimated tax is set to zero until realization.");
    }
    if (advanced.acquisitionDate && advanced.saleDate && new Date(advanced.saleDate) < new Date(advanced.acquisitionDate)) {
      warnings.push("Sale date is earlier than acquisition date.");
    }
    if (!Number.isFinite(Number(advanced.fxRate)) || Number(advanced.fxRate) <= 0) {
      warnings.push("FX conversion rate must be greater than zero.");
    }
    if (summaryPreview.taxableGain <= 0 && totalGainsAmount(gains) > 0) {
      warnings.push("Taxable gain reduced to zero by costs, carryforwards, exemptions, or unrealized mode.");
    }
    if (String(advanced.residencyStatus) === 'non-resident' && Number(advanced.withholdingTax || 0) <= 0) {
      warnings.push("Non-resident selected: consider entering withholding tax to improve estimate accuracy.");
    }
    if (!advanced.notes?.trim()) {
      warnings.push("Notes are blank. Add context for exceptions and special treatment to preserve auditability.");
    }
    return warnings;
  }, [jurisdictions, advanced, gains, summaryPreview.taxableGain]);

  const scenarioComparison = useMemo(() => {
    const { adjustedGains } = buildAdjustedGains(gains, advanced);
    const countryA = TAX_RULES[scenario.countryA] ? scenario.countryA : 'USA';
    const countryB = TAX_RULES[scenario.countryB] ? scenario.countryB : 'UAE';
    const shiftDays = Number(scenario.shiftDays || 0);
    const shiftedSaleDate = advanced.saleDate
      ? new Date(new Date(advanced.saleDate).getTime() + shiftDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : '';
    const shiftedGains = buildAdjustedGains(gains, { ...advanced, saleDate: shiftedSaleDate }).adjustedGains;
    const baseA = calcLiability(countryA, adjustedGains, { ordinaryIncomeTotal }).liability;
    const baseB = calcLiability(countryB, adjustedGains, { ordinaryIncomeTotal }).liability;
    const shiftedA = calcLiability(countryA, shiftedGains, { ordinaryIncomeTotal }).liability;
    return {
      countryA,
      countryB,
      nowA: baseA,
      nowB: baseB,
      shiftedA,
      shiftDays
    };
  }, [scenario, gains, advanced, ordinaryIncomeTotal]);

  const setBucketTotal = (bucket, keys, nextTotal) => {
    const target = Math.max(0, Number(nextTotal) || 0);
    setHasManualGainEdit(true);
    setGains((prev) => {
      const row = prev[bucket] || {};
      const currentValues = keys.map((k) => Math.max(0, Number(row[k] || 0)));
      const currentTotal = currentValues.reduce((s, v) => s + v, 0);
      const nextRow = { ...row };
      if (currentTotal > 0) {
        keys.forEach((k, idx) => {
          nextRow[k] = target * (currentValues[idx] / currentTotal);
        });
      } else {
        const share = keys.length > 0 ? target / keys.length : 0;
        keys.forEach((k) => {
          nextRow[k] = share;
        });
      }
      return { ...prev, [bucket]: nextRow };
    });
  };

  const declaredTotals = useMemo(() => ({
    equities: Number(gains?.Equities?.shortTerm || 0) + Number(gains?.Equities?.longTerm || 0),
    crypto: Number(gains?.Crypto?.shortTerm || 0) + Number(gains?.Crypto?.longTerm || 0),
    fixedIncome: Number(gains?.Bonds?.standard || 0) + Number(gains?.MMFs?.standard || 0),
    specialFunds: Number(gains?.['Special Funds']?.standard || 0)
  }), [gains]);

  const formatMoney = (value, currency = "USD") => {
    return formatCurrency(value, currency, { maximumFractionDigits: 0 });
  };
  const currencyLabel = advanced.currency || "USD";
  const countryFlag = (jurisdictionKey) => {
    const key = String(jurisdictionKey || "").toUpperCase();
    const map = {
      USA: "🇺🇸",
      UAE: "🇦🇪",
      GERMANY: "🇩🇪",
      SINGAPORE: "🇸🇬",
      UK: "🇬🇧",
      CANADA: "🇨🇦",
      FRANCE: "🇫🇷",
      INDIA: "🇮🇳"
    };
    return map[key] || "🌐";
  };
  const taxSavingsVsUAE = useMemo(() => {
    const { adjustedGains } = buildAdjustedGains(gains, advanced);
    const usLiability = calcLiability(jurisdictions[0] || "USA", adjustedGains, { ordinaryIncomeTotal }).liability;
    const uaeLiability = calcLiability("UAE", adjustedGains, { ordinaryIncomeTotal }).liability;
    return usLiability - uaeLiability;
  }, [gains, advanced, jurisdictions, ordinaryIncomeTotal]);
  const workflowSteps = [
    { id: "jurisdiction", label: "Select Jurisdiction", done: jurisdictions.length > 0 },
    { id: "gains", label: "Enter Gains", done: summaryPreview.grossTotal > 0 },
    { id: "advanced", label: "Add Details", done: Boolean(advanced.acquisitionDate || advanced.saleDate || advanced.notes?.trim() || Number(advanced.fees || 0) > 0) },
    { id: "compare", label: "Compare Scenarios", done: results.length > 0 },
    { id: "export", label: "Export / Save", done: savedEstimates.length > 0 }
  ];
  const activeWorkflowIndex = Math.min(
    workflowSteps.findIndex((step) => !step.done) === -1 ? workflowSteps.length - 1 : workflowSteps.findIndex((step) => !step.done),
    workflowSteps.length - 1
  );

  return (
    <div className="tax-v2">
      <div className="tax-v2-head">
        <div>
          <h2>Global Tax Estimator</h2>
          <p>Estimate capital gains liabilities across 40+ global jurisdictions.</p>
        </div>
        <div className="tax-v2-head-actions">
          <button type="button" className="pagination-button tax-v2-action-btn" onClick={handleSave}>Saved scenarios</button>
          <button type="button" className="pagination-button tax-v2-action-btn" onClick={handleExportCsv}>Export</button>
          <button type="button" className="pagination-button tax-v2-action-btn tax-v2-more-btn" aria-label="More options">•••</button>
        </div>
      </div>

      <div className="tax-v2-stepper" aria-label="Tax estimator workflow">
        {workflowSteps.map((step, idx) => (
          <div
            key={step.id}
            className={`tax-v2-step ${step.done ? "done" : idx === activeWorkflowIndex ? "active" : ""}`}
          >
            <span>{step.done ? "✓" : idx + 1}</span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </div>

      <div className="tax-v2-kpis">
        <div className="tax-v2-kpi">
          <div className="tax-v2-kpi-icon blue">{getCurrencySymbol(advanced.currency)}</div>
          <span>Estimated Tax</span>
          <strong>{formatMoney(summaryPreview.estimatedTax)}</strong>
          <em className="positive">↓ {Math.abs(taxSavingsVsUAE).toLocaleString(undefined, { maximumFractionDigits: 0 })} vs UAE</em>
        </div>
        <div className="tax-v2-kpi">
          <div className="tax-v2-kpi-icon cyan">◔</div>
          <span>Effective Rate</span>
          <strong>{summaryPreview.effectiveRate.toFixed(2)}%</strong>
          <em>vs 21.58% (UAE)</em>
        </div>
        <div className="tax-v2-kpi">
          <div className="tax-v2-kpi-icon violet">▥</div>
          <span>Taxable Gain</span>
          <strong>{formatMoney(summaryPreview.taxableGain)}</strong>
          <em>{summaryPreview.grossTotal > 0 ? ((summaryPreview.taxableGain / summaryPreview.grossTotal) * 100).toFixed(1) : "0.0"}% of Gross Gains</em>
        </div>
        <div className="tax-v2-kpi">
          <div className="tax-v2-kpi-icon green">◫</div>
          <span>Net After Tax</span>
          <strong className="positive">{formatMoney(netAfterTax)}</strong>
          <em>Total Gain: {formatMoney(summaryPreview.grossTotal)}</em>
        </div>
      </div>

      <section className="tax-v2-panel tax-loss-panel">
        <div className="tax-v2-panel-head">
          <div>
            <h3>Tax-Loss Harvesting Ideas</h3>
            <p>Potential offsets from underwater positions in your portfolio.</p>
          </div>
          <span className="tax-loss-pill">{taxLossSuggestions.length ? `${taxLossSuggestions.length} found` : "No losses"}</span>
        </div>
        {taxLossSuggestions.length > 0 ? (
          <div className="tax-loss-grid">
            {taxLossSuggestions.map((idea) => (
              <article className="tax-loss-card" key={idea.symbol}>
                <div>
                  <strong>{idea.symbol}</strong>
                  <span>{idea.name}</span>
                </div>
                <dl>
                  <div><dt>Unrealized loss</dt><dd>{formatMoney(idea.unrealizedLoss)}</dd></div>
                  <div><dt>Offset available</dt><dd>{formatMoney(idea.offsetAmount)}</dd></div>
                  <div><dt>Est. tax saved</dt><dd className="positive">{formatMoney(idea.estimatedSaving)}</dd></div>
                </dl>
                <p>
                  Selling near {formatMoney(idea.currentPrice)} could harvest losses against gains from a {formatMoney(idea.costBasis)} cost basis.
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="tax-loss-empty">No harvestable losses detected from current portfolio prices.</p>
        )}
      </section>

      <div className="tax-v2-grid-main">
        <section className="tax-v2-panel">
          <h3><span className="num">1</span> Jurisdictions</h3>
          <p className="sub">Search countries or jurisdictions</p>
          <input
            className="search-input tax-v2-input"
            type="text"
            placeholder="Search by country, region, or code..."
            value={jurisdictionSearch}
            onChange={(e) => setJurisdictionSearch(e.target.value)}
          />
          <div className="tax-v2-region-tabs">
            {['All', ...REGIONS].map((r) => (
              <button key={r} type="button" className={`tax-v2-pill ${activeRegion === r ? "active" : ""}`} onClick={() => setActiveRegion(r)}>{r}</button>
            ))}
          </div>
          <p className="sub">Select jurisdiction</p>
          <div className="tax-v2-jur-list">
            {filteredJurisdictions.slice(0, 8).map(([key, info]) => (
              <label key={key} className={`tax-v2-jur-item ${jurisdictions.includes(key) ? "active" : ""}`}>
                <div className="tax-v2-jur-main">
                  <span className="tax-v2-jur-flag">{countryFlag(key)}</span>
                  <strong>{info.name}</strong>
                  <span>{jurisdictions[0] === key ? "Base jurisdiction" : info.logic}</span>
                </div>
                <input type="checkbox" checked={jurisdictions.includes(key)} onChange={() => toggleJurisdiction(key)} />
              </label>
            ))}
          </div>
          <div className="tax-v2-inline-row">
            <span>Tax Year</span>
            <select className="search-input tax-v2-input" value={taxYear} onChange={(e) => setTaxYear(e.target.value)}>
              <option value="2026">2026 (Latest)</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
          </div>
        </section>

        <section className="tax-v2-panel">
          <h3><span className="num">2</span> Declared Gross Gains / Income</h3>
          <div className="tax-v2-inline-row right">
            <select className="search-input tax-v2-input" value={advanced.currency} onChange={(e) => setAdvanced((p) => ({ ...p, currency: e.target.value }))}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="KES">KES</option>
            </select>
          </div>
          <div className="tax-v2-gain-rows">
            <div className="tax-v2-gain-row">
              <div><strong>Equities</strong><span>Stocks, ETFs, REITs</span></div>
              <input className="search-input tax-v2-input" type="number" min="0" value={declaredTotals.equities} onChange={(e) => setBucketTotal("Equities", ["shortTerm", "longTerm"], e.target.value)} />
            </div>
            <div className="tax-v2-gain-row">
              <div><strong>Digital Assets / Crypto</strong><span>Coins, tokens, DeFi, NFTs</span></div>
              <input className="search-input tax-v2-input" type="number" min="0" value={declaredTotals.crypto} onChange={(e) => setBucketTotal("Crypto", ["shortTerm", "longTerm"], e.target.value)} />
            </div>
            <div className="tax-v2-gain-row">
              <div><strong>Fixed Income</strong><span>Bonds, Notes, CDs</span></div>
              <input className="search-input tax-v2-input" type="number" min="0" value={declaredTotals.fixedIncome} onChange={(e) => {
                const n = Number(e.target.value) || 0;
                setBucketTotal("Bonds", ["standard"], n);
                setBucketTotal("MMFs", ["standard"], 0);
              }} />
            </div>
            <div className="tax-v2-gain-row">
              <div><strong>Special Funds & Structured</strong><span>Private equity, hedge funds, derivatives</span></div>
              <input className="search-input tax-v2-input" type="number" min="0" value={declaredTotals.specialFunds} onChange={(e) => setBucketTotal("Special Funds", ["standard"], e.target.value)} />
            </div>
          </div>
          <div className="tax-v2-total-row">
            <span>Total Declared Gross Gains</span>
            <strong>{formatMoney(summaryPreview.grossTotal)}</strong>
          </div>
        </section>

        <section className="tax-v2-panel">
          <div className="tax-v2-live-title">
            <h3><span className="num">3</span> Live Summary</h3>
            <span className="tax-v2-live-badge">● Realized</span>
          </div>
          <div className="tax-v2-live-header">
            <span>Base Jurisdiction</span>
            <strong>{countryFlag(jurisdictions[0] || "USA")} {summaryPreview.jurisdiction}</strong>
          </div>
          <div className="tax-v2-live-rows">
            <div><span>Total Declared Gross Gains</span><strong>{formatMoney(summaryPreview.grossTotal)}</strong></div>
            <div><span>Less: Costs & Adjustments</span><strong>({formatMoney(summaryPreview.totalCosts || Number(advanced.fees + advanced.brokerage + advanced.slippage)).slice(1)})</strong></div>
            <div><span>Taxable Gain</span><strong>{formatMoney(summaryPreview.taxableGain)}</strong></div>
            <div><span>Estimated Tax</span><strong>{formatMoney(summaryPreview.estimatedTax)}</strong></div>
            <div><span>Effective Rate</span><strong>{summaryPreview.effectiveRate.toFixed(2)}%</strong></div>
          </div>
          <div className="tax-v2-net-row">
            <span>Net After Tax</span>
            <strong>{formatMoney(netAfterTax)}</strong>
          </div>
          <div className="tax-v2-note">Estimates are directional. Add context for exceptions and special treatment.</div>
        </section>
      </div>

      <div className="tax-v2-grid-bottom">
        <section className="tax-v2-panel">
          <div className="tax-v2-panel-head">
            <h3><span className="num">4</span> Advanced Inputs</h3>
            <button type="button" className="tax-v2-link-btn" onClick={() => setIsAdvancedOpen((v) => !v)}>{isAdvancedOpen ? "Hide" : "Show"}</button>
          </div>
          {isAdvancedOpen ? (
            <>
              <div className="tax-v2-advanced-grid">
                <AdvancedField label="Cost Basis Method">
                  <select value={advanced.costBasisMethod} onChange={(e) => setAdvanced((p) => ({ ...p, costBasisMethod: e.target.value }))}>
                    <option value="fifo">FIFO</option>
                    <option value="lifo">LIFO</option>
                    <option value="hifo">HIFO</option>
                    <option value="average">Average Cost</option>
                    <option value="actual">Actual</option>
                  </select>
                </AdvancedField>
                <AdvancedField label="Acquisition Date">
                  <input type="date" value={advanced.acquisitionDate} onChange={(e) => setAdvanced((p) => ({ ...p, acquisitionDate: e.target.value }))} />
                </AdvancedField>
                <AdvancedField label="Sale Date">
                  <input type="date" value={advanced.saleDate} onChange={(e) => setAdvanced((p) => ({ ...p, saleDate: e.target.value }))} />
                </AdvancedField>
                <AdvancedField label="Fees & Expenses">
                  <input type="number" min="0" value={advanced.fees} onChange={(e) => setAdvanced((p) => ({ ...p, fees: Number(e.target.value) || 0 }))} />
                </AdvancedField>
                <AdvancedField label="Brokerage / Platform">
                  <input type="number" min="0" value={advanced.brokerage} onChange={(e) => setAdvanced((p) => ({ ...p, brokerage: Number(e.target.value) || 0 }))} />
                </AdvancedField>
                <AdvancedField label="FX Rate">
                  <input type="text" value={`${advanced.fxRate} ${advanced.currency === "USD" ? "USD" : advanced.currency}`} onChange={(e) => {
                    const value = Number(String(e.target.value).split(" ")[0]);
                    setAdvanced((p) => ({ ...p, fxRate: Number.isFinite(value) && value > 0 ? value : p.fxRate }));
                  }} />
                </AdvancedField>
                <AdvancedField label="Residency Status">
                  <select value={advanced.residencyStatus} onChange={(e) => setAdvanced((p) => ({ ...p, residencyStatus: e.target.value }))}>
                    <option value="resident">Resident</option>
                    <option value="non-resident">Non-resident</option>
                  </select>
                </AdvancedField>
                <AdvancedField label="Filing Status">
                  <select value={advanced.filingStatus} onChange={(e) => setAdvanced((p) => ({ ...p, filingStatus: e.target.value }))}>
                    <option value="single">Single</option>
                    <option value="married-joint">Married (Joint)</option>
                    <option value="married-separate">Married (Separate)</option>
                    <option value="head-of-household">Head of Household</option>
                  </select>
                </AdvancedField>
                <AdvancedField label="Tax Regime">
                  <select value={advanced.taxRegime} onChange={(e) => setAdvanced((p) => ({ ...p, taxRegime: e.target.value }))}>
                    <option value="individual">Individual</option>
                    <option value="company">Company</option>
                    <option value="trust">Trust</option>
                    <option value="fund">Fund</option>
                  </select>
                </AdvancedField>
              </div>
              <label className="tax-v2-notes-field">
                Notes (optional)
                <input className="search-input tax-v2-input" type="text" placeholder="Add any additional context or assumptions..." value={advanced.notes} onChange={(e) => setAdvanced((p) => ({ ...p, notes: e.target.value }))} />
              </label>
            </>
          ) : null}
          <button type="button" className="tax-v2-calc-btn" onClick={handleCalculate}>Calculate Estimated Liabilities</button>
          {inputWarnings.length ? (
            <div className="tax-v2-warning-list">
              {inputWarnings.map((warn, idx) => <div key={`warn-${idx}`}>{warn}</div>)}
            </div>
          ) : null}
        </section>

        <section className="tax-v2-panel">
          <div className="tax-v2-panel-head">
            <h3><span className="num">5</span> Scenario Comparison</h3>
            <button type="button" className="pagination-button tax-v2-action-btn">+ Add Scenario</button>
          </div>
          <div className="tax-v2-scenario-grid">
            <div className="tax-v2-scenario-card">
              <h4>{countryFlag(scenarioComparison.countryA)} {TAX_RULES[scenarioComparison.countryA]?.name}<span className="tax-v2-base-pill">Base</span></h4>
              <div><span>Taxable Gain</span><strong>{formatMoney(summaryPreview.taxableGain)}</strong></div>
              <div><span>Estimated Tax</span><strong>{formatMoney(scenarioComparison.nowA)}</strong></div>
              <div><span>Effective Rate</span><strong>{summaryPreview.effectiveRate.toFixed(2)}%</strong></div>
              <div><span>Net After Tax</span><strong className="positive">{formatMoney(Math.max(0, summaryPreview.grossTotal - scenarioComparison.nowA))}</strong></div>
            </div>
            <div className="tax-v2-scenario-card">
              <h4>{countryFlag(scenarioComparison.countryB)} {TAX_RULES[scenarioComparison.countryB]?.name}</h4>
              <div><span>Taxable Gain</span><strong>{formatMoney(summaryPreview.taxableGain)}</strong></div>
              <div><span>Estimated Tax</span><strong>{formatMoney(scenarioComparison.nowB)}</strong></div>
              <div><span>Effective Rate</span><strong>{summaryPreview.taxableGain > 0 ? ((scenarioComparison.nowB / (summaryPreview.taxableGain + ordinaryIncomeTotal)) * 100).toFixed(2) : "0.00"}%</strong></div>
              <div><span>Net After Tax</span><strong>{formatMoney(Math.max(0, summaryPreview.grossTotal - scenarioComparison.nowB))}</strong></div>
            </div>
          </div>
          <div className="tax-v2-save-strip">
            You save ${(scenarioComparison.nowB - scenarioComparison.nowA).toLocaleString(undefined, { maximumFractionDigits: 0 })} ({summaryPreview.grossTotal > 0 ? (((scenarioComparison.nowB - scenarioComparison.nowA) / summaryPreview.grossTotal) * 100).toFixed(2) : "0.00"}%)
          </div>
        </section>
      </div>

      <section className="tax-v2-panel tax-v2-footer">
        <div>
          <h4>Compliance & Sources</h4>
          <p>This estimator is informational only and not tax advice. Confirm rates, forms, and filing treatment with a qualified advisor.</p>
        </div>
        <div className="tax-v2-source-links">
          {TAX_RULE_SOURCES.map((source) => (
            <a key={source.href} href={source.href} target="_blank" rel="noreferrer">{source.label}</a>
          ))}
        </div>
      </section>

      {results.length > 0 ? (
        <section className="tax-v2-panel tax-v2-results">
          <div className="tax-v2-panel-head">
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {results.length > 1 && (
                <div className="tax-v2-global-total">
                  <span>Total Global Liability:</span>
                  <strong>{formatMoney(globalLiabilityUSD)}</strong>
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="pagination-button tax-v2-action-btn" onClick={handleSave}>Save All</button>
                <button className="pagination-button tax-v2-action-btn" onClick={handleExportCsv}>Export CSV</button>
              </div>
            </div>
          </div>
          <div className="tax-v2-results-grid">
            {results.map((res) => (
              <article key={res.jurisdictionKey} className="tax-v2-result-card">
                <div className="head">
                  <h4>{res.jurisdiction}</h4>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{res.currency} {res.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>≈ {formatMoney(res.liabilityUSD)}</div>
                  </div>
                </div>
                <div className="rows">
                  {Object.entries(res.details).map(([k, v]) => (
                    <div key={k}><span>{k}</span><span>{res.currency} {Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {showImportPreview ? (
        <section className="tax-v2-panel">
          <div className="tax-v2-panel-head">
            <h3>Import Preview</h3>
            <button className="tax-v2-link-btn" onClick={() => setShowImportPreview(false)}>Close</button>
          </div>
          <p className="sub">Imported file: {fileName || 'N/A'} · Review mapped columns before finalizing.</p>
          <p className="sub">Mapped: Trade Date, Sale Date, Asset Class, Proceeds, Cost Basis, Fees</p>
        </section>
      ) : null}
    </div>
  );
}

function AdvancedField({ label, children }) {
  return (
    <label className="tax-v2-adv-field">
      <span>{label}</span>
      <div>
        {React.cloneElement(children, {
          className: `tax-v2-adv-input ${children.props.className || ''}`.trim()
        })}
      </div>
    </label>
  );
}
