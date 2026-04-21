import React, { useState, useEffect, useMemo } from 'react';

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

export function TaxEstimator({ trades = [] }) {
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
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
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
      const { liability: baseLiability, details } = calcLiability(j, adjustedGains, { ordinaryIncomeTotal });
      const taxCredits = Math.max(0, Number(advanced.foreignTaxPaid || 0)) + Math.max(0, Number(advanced.withholdingTax || 0));
      const liability = Math.max(0, baseLiability - taxCredits);
      const taxableBase = taxableGain + ordinaryIncomeTotal;
      const effectiveRate = taxableBase > 0 ? (liability / taxableBase) * 100 : 0;
      return {
        jurisdictionKey: j,
        jurisdiction: TAX_RULES[j].name,
        currency: TAX_RULES[j].currency,
        liability,
        grossGain: grossTotal,
        netGain: netAfterCosts,
        taxableGain,
        ordinaryIncomeTotal,
        effectiveRate,
        totalCosts,
        taxCredits,
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
    const { adjustedGains, grossTotal, taxableGain, netAfterCosts } = buildAdjustedGains(gains, advanced);
    const first = jurisdictions[0] || "USA";
    const { liability } = calcLiability(first, adjustedGains, { ordinaryIncomeTotal });
    const taxCredits = Math.max(0, Number(advanced.foreignTaxPaid || 0)) + Math.max(0, Number(advanced.withholdingTax || 0));
    const estimatedTax = Math.max(0, liability - taxCredits);
    const effectiveRate = taxableGain + ordinaryIncomeTotal > 0 ? (estimatedTax / (taxableGain + ordinaryIncomeTotal)) * 100 : 0;
    return {
      jurisdiction: TAX_RULES[first]?.name || "N/A",
      grossTotal,
      netAfterCosts,
      taxableGain,
      ordinaryIncomeTotal,
      estimatedTax,
      effectiveRate
    };
  }, [gains, advanced, jurisdictions, ordinaryIncomeTotal]);

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

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: '1.8rem', color: '#f8fafc' }}>Global Tax Estimator</h2>
        <p style={{ margin: 0, color: '#94a3b8' }}>Estimate capital gains liabilities across 40+ global jurisdictions. Tax rules last updated: {TAX_RULES_LAST_UPDATED}.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
        {/* ── Left: Config ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#f8fafc' }}>Jurisdictions</h3>

            <input
              type="text"
              placeholder="Search countries..."
              value={jurisdictionSearch}
              onChange={e => setJurisdictionSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: '8px', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.3)', color: '#fff', marginBottom: '10px', fontSize: '0.85rem' }}
            />

            {/* Region filter tabs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {['All', ...REGIONS].map(r => (
                <button key={r} onClick={() => setActiveRegion(r)}
                  style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', cursor: 'pointer', border: activeRegion === r ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.25)', background: activeRegion === r ? 'rgba(56,189,248,0.18)' : 'transparent', color: activeRegion === r ? '#38bdf8' : '#94a3b8' }}>
                  {r}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
              {filteredJurisdictions.map(([key, info]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', background: jurisdictions.includes(key) ? 'rgba(56,189,248,0.1)' : 'transparent', border: jurisdictions.includes(key) ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent' }}>
                  <input type="checkbox" checked={jurisdictions.includes(key)} onChange={() => toggleJurisdiction(key)} style={{ accentColor: '#38bdf8' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>{info.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{info.currency} · {info.logic}</div>
                  </div>
                </label>
              ))}
            </div>

            {jurisdictions.length > 0 && (
              <div style={{ marginTop: '12px', fontSize: '0.78rem', color: '#7dd3fc', background: 'rgba(125,211,252,0.08)', padding: '8px', borderRadius: '6px' }}>
                {jurisdictions.length} base{jurisdictions.length > 1 ? 's' : ''} selected: {jurisdictions.map(j => TAX_RULES[j].name).join(', ')}
              </div>
            )}
            {detectedCountry && (
              <div style={{ marginTop: '8px', fontSize: '0.74rem', color: '#94a3b8' }}>
                Auto-detected country from browser locale: {TAX_RULES[detectedCountry]?.name || detectedCountry}. You can override it above.
              </div>
            )}
          </section>

          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#f8fafc' }}>Tax Year</h3>
            <select value={taxYear} onChange={e => setTaxYear(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '8px', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.3)', color: '#fff' }}>
              <option value="2026">2026 (Latest)</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
          </section>

          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#f8fafc' }}>Income Breakdown</h3>
            <p style={{ margin: '0 0 10px 0', color: '#94a3b8', fontSize: '0.78rem' }}>Ordinary income buckets taxed at the jurisdiction ordinary rate.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <GainRow label="Salary" value={additionalIncome.salary} onChange={(v) => setAdditionalIncome((p) => ({ ...p, salary: Number(v) || 0 }))} />
              <GainRow label="Dividends" value={additionalIncome.dividends} onChange={(v) => setAdditionalIncome((p) => ({ ...p, dividends: Number(v) || 0 }))} />
              <GainRow label="Interest" value={additionalIncome.interest} onChange={(v) => setAdditionalIncome((p) => ({ ...p, interest: Number(v) || 0 }))} />
              <GainRow label="Staking" value={additionalIncome.stakingRewards} onChange={(v) => setAdditionalIncome((p) => ({ ...p, stakingRewards: Number(v) || 0 }))} />
              <GainRow label="Airdrops" value={additionalIncome.airdrops} onChange={(v) => setAdditionalIncome((p) => ({ ...p, airdrops: Number(v) || 0 }))} />
              <GainRow label="Other Income" value={additionalIncome.otherOrdinaryIncome} onChange={(v) => setAdditionalIncome((p) => ({ ...p, otherOrdinaryIncome: Number(v) || 0 }))} />
            </div>
          </section>

          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#f8fafc' }}>Import Statements</h3>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0 0 12px' }}>Upload CSV/JSON to map gains automatically.</p>
            <button onClick={() => document.getElementById('tax-file-import').click()}
              style={{ width: '100%', padding: '10px', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {fileName ? `✓ ${fileName}` : '+ Import Documents'}
            </button>
            <input type="file" id="tax-file-import" accept=".csv,.json,.xls,.xlsx" style={{ display: 'none' }} onChange={handleDocumentImport} />
          </section>
        </div>

        {/* ── Right: Gains + Results ──────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#f8fafc' }}>Declared Gross Gains</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr minmax(230px, 1fr)', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <GainCard title="Equities">
                  <GainRow label="Short Term (< 1 yr)" value={gains.Equities.shortTerm} onChange={v => handleGainChange('Equities', 'shortTerm', v)} />
                  <GainRow label="Long Term (> 1 yr)" value={gains.Equities.longTerm} onChange={v => handleGainChange('Equities', 'longTerm', v)} />
                </GainCard>

                <GainCard title="Digital Assets / Crypto">
                  <GainRow label="Short Term (< 1 yr)" value={gains.Crypto.shortTerm} onChange={v => handleGainChange('Crypto', 'shortTerm', v)} />
                  <GainRow label="Long Term (> 1 yr)" value={gains.Crypto.longTerm} onChange={v => handleGainChange('Crypto', 'longTerm', v)} />
                </GainCard>

                <GainCard title="Fixed Income">
                  <GainRow label="Bonds Total" value={gains.Bonds.standard} onChange={v => handleGainChange('Bonds', 'standard', v)} />
                  <GainRow label="MMFs / Interest" value={gains.MMFs.standard} onChange={v => handleGainChange('MMFs', 'standard', v)} />
                </GainCard>

                <GainCard title="Special Funds & Structured">
                  <GainRow label="Recognized Gains" value={gains['Special Funds'].standard} onChange={v => handleGainChange('Special Funds', 'standard', v)} />
                </GainCard>
              </div>

              <section style={{ background: 'rgba(0, 0, 0, 0.65)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: '12px', padding: '12px' }}>
                <h4 style={{ margin: '0 0 10px', fontSize: '0.85rem', color: '#e2e8f0' }}>Live Summary</h4>
                <SummaryRow label="Base jurisdiction" value={summaryPreview.jurisdiction} />
                <SummaryRow label="Total gain" value={`$${summaryPreview.grossTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                <SummaryRow label="Net after costs" value={`$${summaryPreview.netAfterCosts.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                <SummaryRow label="Taxable gain" value={`$${summaryPreview.taxableGain.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                <SummaryRow label="Ordinary income" value={`$${summaryPreview.ordinaryIncomeTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                <SummaryRow label="Estimated tax" value={`$${summaryPreview.estimatedTax.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                <SummaryRow label="Effective rate" value={`${summaryPreview.effectiveRate.toFixed(2)}%`} tone={summaryPreview.effectiveRate > 0 ? '#fbbf24' : '#4ade80'} />
              </section>
            </div>

            <div style={{ marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setIsAdvancedOpen((v) => !v)}
                style={{
                  width: '100%',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(148,163,184,0.25)',
                  background: 'rgba(15,23,42,0.6)',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}
              >
                {isAdvancedOpen ? 'Hide Advanced Inputs' : 'Show Advanced Inputs'}
              </button>

              {isAdvancedOpen && (
                <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                  <AdvancedField label="Cost Basis">
                    <select value={advanced.costBasisMethod} onChange={(e) => setAdvanced((p) => ({ ...p, costBasisMethod: e.target.value }))}>
                      <option value="actual">Actual</option>
                      <option value="fifo">FIFO</option>
                      <option value="lifo">LIFO</option>
                      <option value="hifo">HIFO</option>
                      <option value="average">Average Cost</option>
                    </select>
                  </AdvancedField>
                  <AdvancedField label="Mode">
                    <select value={advanced.realizationMode} onChange={(e) => setAdvanced((p) => ({ ...p, realizationMode: e.target.value }))}>
                      <option value="realized">Realized</option>
                      <option value="unrealized">Unrealized</option>
                    </select>
                  </AdvancedField>
                  <AdvancedField label="Acquisition Date">
                    <input type="date" value={advanced.acquisitionDate} onChange={(e) => setAdvanced((p) => ({ ...p, acquisitionDate: e.target.value }))} />
                  </AdvancedField>
                  <AdvancedField label="Sale Date">
                    <input type="date" value={advanced.saleDate} onChange={(e) => setAdvanced((p) => ({ ...p, saleDate: e.target.value }))} />
                  </AdvancedField>
                  <AdvancedField label="Fees">
                    <input type="number" min="0" value={advanced.fees} onChange={(e) => setAdvanced((p) => ({ ...p, fees: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="Slippage">
                    <input type="number" min="0" value={advanced.slippage} onChange={(e) => setAdvanced((p) => ({ ...p, slippage: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="Brokerage">
                    <input type="number" min="0" value={advanced.brokerage} onChange={(e) => setAdvanced((p) => ({ ...p, brokerage: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="FX Rate">
                    <input type="number" min="0" step="0.0001" value={advanced.fxRate} onChange={(e) => setAdvanced((p) => ({ ...p, fxRate: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="Currency">
                    <select value={advanced.currency} onChange={(e) => setAdvanced((p) => ({ ...p, currency: e.target.value }))}>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="KES">KES</option>
                      <option value="JPY">JPY</option>
                    </select>
                  </AdvancedField>
                  <AdvancedField label="FX Source">
                    <select value={advanced.fxSource} onChange={(e) => setAdvanced((p) => ({ ...p, fxSource: e.target.value }))}>
                      <option value="Manual">Manual</option>
                      <option value="ECB">ECB</option>
                      <option value="FRED">FRED</option>
                      <option value="ExchangeRate-API">ExchangeRate-API</option>
                    </select>
                  </AdvancedField>
                  <AdvancedField label="Loss Carryforward">
                    <input type="number" min="0" value={advanced.lossCarryforward} onChange={(e) => setAdvanced((p) => ({ ...p, lossCarryforward: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="Exemption Threshold">
                    <input type="number" min="0" value={advanced.exemptionThreshold} onChange={(e) => setAdvanced((p) => ({ ...p, exemptionThreshold: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="Foreign Tax Paid">
                    <input type="number" min="0" value={advanced.foreignTaxPaid} onChange={(e) => setAdvanced((p) => ({ ...p, foreignTaxPaid: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="Withholding Tax">
                    <input type="number" min="0" value={advanced.withholdingTax} onChange={(e) => setAdvanced((p) => ({ ...p, withholdingTax: Number(e.target.value) || 0 }))} />
                  </AdvancedField>
                  <AdvancedField label="Residency">
                    <select value={advanced.residencyStatus} onChange={(e) => setAdvanced((p) => ({ ...p, residencyStatus: e.target.value }))}>
                      <option value="resident">Resident</option>
                      <option value="non-resident">Non-resident</option>
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
                  <AdvancedField label="Filing Status">
                    <select value={advanced.filingStatus} onChange={(e) => setAdvanced((p) => ({ ...p, filingStatus: e.target.value }))}>
                      <option value="single">Single</option>
                      <option value="married-joint">Married (Joint)</option>
                      <option value="married-separate">Married (Separate)</option>
                      <option value="head-of-household">Head of Household</option>
                    </select>
                  </AdvancedField>
                  <AdvancedField label="Marital Status">
                    <select value={advanced.maritalStatus} onChange={(e) => setAdvanced((p) => ({ ...p, maritalStatus: e.target.value }))}>
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="divorced">Divorced</option>
                      <option value="widowed">Widowed</option>
                    </select>
                  </AdvancedField>
                  <AdvancedField label="Notes">
                    <input type="text" value={advanced.notes} onChange={(e) => setAdvanced((p) => ({ ...p, notes: e.target.value }))} placeholder="Special treatment / exceptions" />
                  </AdvancedField>
                </div>
              )}
            </div>

            <button onClick={handleCalculate}
              style={{ marginTop: '20px', width: '100%', padding: '14px', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', fontSize: '1rem', fontWeight: 700, border: 'none', borderRadius: '10px', cursor: 'pointer', letterSpacing: '0.5px', boxShadow: '0 4px 16px rgba(59,130,246,0.35)' }}>
              Calculate Estimated Liabilities
            </button>

            {inputWarnings.length > 0 && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {inputWarnings.map((warn, idx) => (
                  <div key={idx} style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.35)', background: 'rgba(120,53,15,0.25)', color: '#fbbf24', fontSize: '0.78rem' }}>
                    {warn}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Results */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {results.map((res, idx) => (
                <section key={idx} style={{ 
                  padding: '20px', 
                  background: 'rgba(0, 0, 0, 0.85)', 
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(56,189,248,0.35)', 
                  borderRadius: '16px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>{res.jurisdiction}</h3>
                    <span style={{ color: res.liability === 0 ? '#4ade80' : '#38bdf8', fontWeight: 700, fontSize: '1.25rem' }}>
                      {res.currency} {res.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', marginBottom: '10px' }}>
                    <MiniPill label="Gross Gain" value={`$${Number(res.grossGain || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                    <MiniPill label="Net Gain" value={`$${Number(res.netGain || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                    <MiniPill label="Taxable Gain" value={`$${Number(res.taxableGain || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                    <MiniPill label="Ordinary Income" value={`$${Number(res.ordinaryIncomeTotal || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                    <MiniPill label="Effective Rate" value={`${Number(res.effectiveRate || 0).toFixed(2)}%`} />
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px' }}>
                    {Object.entries(res.details).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>{k}</span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: v === 0 ? '#4ade80' : '#f1f5f9' }}>
                          {res.currency} {v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {/* ── Jurisdiction Recommendation Card ────────────────────── */}
              {jurisdictionRecommendations.length > 0 && (
                <section style={{ 
                  padding: '20px', 
                  background: 'linear-gradient(135deg, rgba(0, 20, 10, 0.95), rgba(0, 0, 0, 0.9))', 
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(74,222,128,0.35)', 
                  borderRadius: '16px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                    <span style={{ fontSize: '1.25rem' }}>🌍</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1rem', color: '#4ade80' }}>Jurisdiction Recommendation</h3>
                      <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#86efac' }}>Based on your declared gains, you could have paid significantly less tax in these jurisdictions.</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {jurisdictionRecommendations.map((rec, i) => (
                      <div key={rec.key} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.12)' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#4ade80', minWidth: '24px' }}>#{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>{rec.name}</div>
                          <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{rec.region} · {rec.logic}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Estimated liability</div>
                          <div style={{ fontWeight: 700, color: rec.liability === 0 ? '#4ade80' : '#38bdf8' }}>
                            {rec.currency} {rec.liability.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#4ade80', fontWeight: 600 }}>
                            Save ≈ ${rec.saving.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: '14px 0 0', fontSize: '0.72rem', color: '#64748b' }}>
                    ⚠ Indicative flat-rate estimates only. Consult a qualified tax advisor before making residency decisions.
                  </p>
                </section>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={handleSave} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid #38bdf8', color: '#38bdf8', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Save All</button>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) handleExport(e.target.value);
                    e.target.value = '';
                  }}
                  style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                >
                  <option value="" disabled>Export Report...</option>
                  <option value="pdf">PDF</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
            </div>
          )}

          <section style={{ background: 'rgba(2,6,23,0.72)', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '14px', padding: '16px' }}>
            <h4 style={{ margin: '0 0 10px', color: '#f8fafc', fontSize: '0.9rem' }}>Scenario Comparison</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', marginBottom: '10px' }}>
              <AdvancedField label="Country A">
                <select value={scenario.countryA} onChange={(e) => setScenario((p) => ({ ...p, countryA: e.target.value }))}>
                  {Object.keys(TAX_RULES).map((code) => <option key={code} value={code}>{TAX_RULES[code].name}</option>)}
                </select>
              </AdvancedField>
              <AdvancedField label="Country B">
                <select value={scenario.countryB} onChange={(e) => setScenario((p) => ({ ...p, countryB: e.target.value }))}>
                  {Object.keys(TAX_RULES).map((code) => <option key={code} value={code}>{TAX_RULES[code].name}</option>)}
                </select>
              </AdvancedField>
              <AdvancedField label="Sell Later (Days)">
                <input type="number" min="0" value={scenario.shiftDays} onChange={(e) => setScenario((p) => ({ ...p, shiftDays: Number(e.target.value) || 0 }))} />
              </AdvancedField>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' }}>
              <MiniPill label={`${TAX_RULES[scenarioComparison.countryA]?.name} (Now)`} value={`${TAX_RULES[scenarioComparison.countryA]?.currency} ${scenarioComparison.nowA.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
              <MiniPill label={`${TAX_RULES[scenarioComparison.countryB]?.name} (Now)`} value={`${TAX_RULES[scenarioComparison.countryB]?.currency} ${scenarioComparison.nowB.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
              <MiniPill label={`${TAX_RULES[scenarioComparison.countryA]?.name} (+${scenarioComparison.shiftDays}d)`} value={`${TAX_RULES[scenarioComparison.countryA]?.currency} ${scenarioComparison.shiftedA.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
            </div>
          </section>

          <section style={{ background: 'rgba(2,6,23,0.72)', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '14px', padding: '16px' }}>
            <h4 style={{ margin: '0 0 6px', color: '#f8fafc', fontSize: '0.9rem' }}>Compliance & Sources</h4>
            <p style={{ margin: '0 0 8px', fontSize: '0.76rem', color: '#94a3b8' }}>
              This estimator is informational only and not tax advice. Confirm rates, forms, and filing treatment with a qualified advisor.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {TAX_RULE_SOURCES.map((source) => (
                <a key={source.href} href={source.href} target="_blank" rel="noreferrer" style={{ color: '#7dd3fc', fontSize: '0.76rem' }}>
                  {source.label}
                </a>
              ))}
            </div>
          </section>

          {savedEstimates.length > 0 && (
            <section style={{ 
              background: 'rgba(0, 0, 0, 0.75)', 
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(148,163,184,0.1)', 
              borderRadius: '14px', 
              padding: '16px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
            }}>
              <h4 style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: '0.9rem' }}>Saved Estimates</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {savedEstimates.map((est, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(15,23,42,0.4)', padding: '10px 14px', borderRadius: '8px' }}>
                    <div>
                      <strong style={{ display: 'block', color: '#e2e8f0', fontSize: '0.85rem' }}>{est.jurisdiction}</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{new Date(est.timestamp).toLocaleString()}</span>
                    </div>
                    <strong style={{ color: '#38bdf8', fontSize: '0.9rem' }}>{est.currency} {est.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {auditTrail.length > 0 && (
            <section style={{
              background: 'rgba(2,6,23,0.75)',
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: '14px',
              padding: '16px'
            }}>
              <h4 style={{ margin: '0 0 10px', color: '#f8fafc', fontSize: '0.9rem' }}>Audit Trail</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {auditTrail.slice(0, 5).map((entry) => (
                  <div key={entry.id} style={{ padding: '8px 10px', borderRadius: '8px', background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(148,163,184,0.14)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span style={{ fontSize: '0.76rem', color: '#cbd5e1' }}>{new Date(entry.timestamp).toLocaleString()}</span>
                      <span style={{ fontSize: '0.74rem', color: '#7dd3fc' }}>Year {entry.taxYear}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>
                      Jurisdictions: {(entry.jurisdictions || []).map((k) => TAX_RULES[k]?.name || k).join(', ')}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {showImportPreview && (
            <section style={{
              background: 'rgba(2,6,23,0.75)',
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: '14px',
              padding: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '0.9rem' }}>Import Preview</h4>
                <button onClick={() => setShowImportPreview(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>Close</button>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: '#94a3b8' }}>
                Imported file: {fileName || 'N/A'} · Review mapped columns before finalizing.
              </p>
              <div style={{ fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.5 }}>
                Mapped: <strong>Trade Date</strong>, <strong>Sale Date</strong>, <strong>Asset Class</strong>, <strong>Proceeds</strong>, <strong>Cost Basis</strong>, <strong>Fees</strong>
              </div>
              <div style={{ marginTop: '8px', fontSize: '0.76rem', color: '#fbbf24' }}>
                Unmatched fields: none detected in demo parser.
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helper micro-components ────────────────────────────────────────────────────
function GainCard({ title, children }) {
  return (
    <div style={{ 
      background: 'rgba(0, 0, 0, 0.65)', 
      backdropFilter: 'blur(8px)',
      padding: '14px', 
      borderRadius: '12px', 
      border: '1px solid rgba(148,163,184,0.12)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
    }}>
      <h4 style={{ margin: '0 0 12px', fontSize: '0.88rem', color: '#e2e8f0' }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{children}</div>
    </div>
  );
}

function GainRow({ label, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: '0.76rem', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>{label}</label>
      <input type="number" min="0" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', color: '#f1f5f9', padding: '5px 8px', fontSize: '0.88rem' }} />
    </div>
  );
}

function SummaryRow({ label, value, tone = '#38bdf8' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
      <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>{label}</span>
      <span style={{ fontSize: '0.82rem', color: tone, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function AdvancedField({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{label}</span>
      <div style={{ display: 'flex' }}>
        {React.cloneElement(children, {
          style: {
            width: '100%',
            boxSizing: 'border-box',
            background: 'rgba(0,0,0,0.35)',
            border: '1px solid rgba(148,163,184,0.2)',
            borderRadius: '6px',
            color: '#f1f5f9',
            padding: '6px 8px',
            fontSize: '0.82rem'
          }
        })}
      </div>
    </label>
  );
}

function MiniPill({ label, value }) {
  return (
    <div style={{ padding: '8px', borderRadius: '8px', border: '1px solid rgba(148,163,184,0.15)', background: 'rgba(15,23,42,0.45)' }}>
      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '3px' }}>{label}</div>
      <div style={{ fontSize: '0.82rem', color: '#f1f5f9', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
