// backend/perpsCalculator.js
// Perps Calculator — venue metadata, fee schedules, and calc engines
// (basis carry, perp arbitrage, fee comparator). Latency data is wired in Phase 5.

const CRYPTO_VENUES = [
  {
    id: "hyperliquid",
    name: "Hyperliquid",
    kind: "dex",
    orderTransport: "websocket",
    fundingIntervalHours: 8,
    makerBps: 1,
    takerBps: 4,
    withdrawalFeeUsd: 0,
    region: "global",
    enabled: true
  },
  {
    id: "lighter",
    name: "Lighter",
    kind: "dex",
    orderTransport: "websocket",
    fundingIntervalHours: 8,
    makerBps: 0,
    takerBps: 2,
    withdrawalFeeUsd: 0,
    region: "global",
    enabled: true
  },
  {
    id: "binance",
    name: "Binance",
    kind: "cex",
    orderTransport: "https",
    fundingIntervalHours: 8,
    makerBps: 2,
    takerBps: 5,
    withdrawalFeeUsd: 1.5,
    region: "global",
    enabled: true
  },
  {
    id: "bybit",
    name: "Bybit",
    kind: "cex",
    orderTransport: "https",
    fundingIntervalHours: 8,
    makerBps: 2,
    takerBps: 5,
    withdrawalFeeUsd: 1.0,
    region: "global",
    enabled: true
  },
  {
    id: "dydx_v4",
    name: "dYdX v4",
    kind: "dex",
    orderTransport: "https",
    fundingIntervalHours: 1,
    makerBps: 0,
    takerBps: 5,
    withdrawalFeeUsd: 0,
    region: "global",
    enabled: true
  },
  {
    id: "aster",
    name: "Aster",
    kind: "dex",
    orderTransport: "https",
    fundingIntervalHours: 8,
    makerBps: 1,
    takerBps: 6,
    withdrawalFeeUsd: 0,
    region: "global",
    enabled: true
  },
  {
    id: "extended",
    name: "Extended",
    kind: "dex",
    orderTransport: "https",
    fundingIntervalHours: 8,
    makerBps: 1,
    takerBps: 5,
    withdrawalFeeUsd: 0,
    region: "global",
    enabled: false
  },
  {
    id: "pacifica",
    name: "Pacifica",
    kind: "dex",
    orderTransport: "websocket",
    fundingIntervalHours: 8,
    makerBps: 1,
    takerBps: 5,
    withdrawalFeeUsd: 0,
    region: "global",
    enabled: false
  }
];

const STOCK_BROKERS = [
  { id: "robinhood", name: "Robinhood", region: "US", commissionUsd: 0, perShareUsd: 0, fxSpreadPct: 0.02, marginApr: 11.0, optionsPerContract: 0 },
  { id: "schwab", name: "Schwab", region: "US", commissionUsd: 0, perShareUsd: 0, fxSpreadPct: 0.02, marginApr: 13.0, optionsPerContract: 0.65 },
  { id: "fidelity", name: "Fidelity", region: "US", commissionUsd: 0, perShareUsd: 0, fxSpreadPct: 0.02, marginApr: 13.0, optionsPerContract: 0.65 },
  { id: "ibkr_tiered", name: "IBKR Tiered", region: "US", commissionUsd: 0.005, perShareUsd: 0.004, fxSpreadPct: 0.02, marginApr: 5.5, optionsPerContract: 0.65 },
  { id: "ibkr_fixed", name: "IBKR Fixed", region: "US", commissionUsd: 0, perShareUsd: 0.005, fxSpreadPct: 0.02, marginApr: 5.5, optionsPerContract: 0.65 },
  { id: "ibkr_hk", name: "IBKR HK", region: "APAC", commissionUsd: 0, perShareUsd: 0.005, fxSpreadPct: 0.02, marginApr: 5.5, optionsPerContract: 0.65 },
  { id: "ibkr_sg", name: "IBKR SG", region: "APAC", commissionUsd: 0, perShareUsd: 0.005, fxSpreadPct: 0.02, marginApr: 5.5, optionsPerContract: 0.65 },
  { id: "tiger", name: "Tiger", region: "APAC", commissionUsd: 0.018, perShareUsd: 0.005, fxSpreadPct: 0.04, marginApr: 6.8, optionsPerContract: 0.65 },
  { id: "long_bridge", name: "Long Bridge", region: "APAC", commissionUsd: 0.024, perShareUsd: 0.005, fxSpreadPct: 0.04, marginApr: 6.8, optionsPerContract: 0.65 },
  { id: "degiro", name: "Degiro", region: "EU", commissionUsd: 0, perShareUsd: 0.5, fxSpreadPct: 0.10, marginApr: 3.0, optionsPerContract: 0.5 },
  { id: "trading212", name: "Trading212", region: "EU/UK", commissionUsd: 0, perShareUsd: 0, fxSpreadPct: 0.15, marginApr: 4.9, optionsPerContract: 0 },
  { id: "ibkr_eu", name: "IBKR EU", region: "EU", commissionUsd: 0.005, perShareUsd: 0.004, fxSpreadPct: 0.02, marginApr: 5.5, optionsPerContract: 0.65 }
];

function getVenueById(id) {
  return CRYPTO_VENUES.find((v) => v.id === String(id || "").toLowerCase()) || null;
}

function listCryptoVenues({ includeDisabled = false } = {}) {
  return CRYPTO_VENUES.filter((v) => includeDisabled || v.enabled);
}

function listStockBrokers() {
  return STOCK_BROKERS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Basis Carry engine
// Inputs: symbol, spotVenue, perpVenue, sizeUsd, leverage, horizonDays,
//         fundingMode ('current'|'custom'|'avg'), fundingRatePct (per interval),
//         fundingIntervalHours, borrowAprPct, entryFeesPct, slippagePct
// ─────────────────────────────────────────────────────────────────────────────
function computeBasisCarry(inputs, context = {}) {
  const sizeUsd = Number(inputs.sizeUsd) || 0;
  const leverage = Math.max(1, Number(inputs.leverage) || 1);
  const horizonDays = Math.max(1, Number(inputs.horizonDays) || 30);
  const fundingIntervalHours = Number(inputs.fundingIntervalHours) || 8;
  const borrowAprPct = Number(inputs.borrowAprPct) || 0;
  const entryFeesPct = Number(inputs.entryFeesPct) || 0;
  const slippagePct = Number(inputs.slippagePct) || 0;

  // Funding rate per interval (decimal, e.g. 0.000125 for 0.0125%)
  let fundingRatePerInterval;
  if (inputs.fundingMode === "custom" && Number.isFinite(Number(inputs.fundingRatePct))) {
    fundingRatePerInterval = Number(inputs.fundingRatePct) / 100;
  } else if (inputs.fundingMode === "avg" && Number.isFinite(Number(inputs.fundingRate30dAvgPct))) {
    fundingRatePerInterval = Number(inputs.fundingRate30dAvgPct) / 100;
  } else {
    // 'current' — pull from context (live funding data)
    const perpVenueId = String(inputs.perpVenue).toLowerCase();
    const liveFunding = context.fundingByVenue?.[perpVenueId];
    if (!liveFunding || !Number.isFinite(Number(liveFunding.fundingRate))) {
      return { error: "funding_unavailable", message: `No live funding rate for ${inputs.perpVenue}. Switch to Custom mode.` };
    }
    fundingRatePerInterval = Number(liveFunding.fundingRate);
  }

  const intervalsPerDay = 24 / fundingIntervalHours;
  const totalIntervals = Math.max(1, Math.round(horizonDays * intervalsPerDay));

  // Gross funding captured: short perp pays funding when rate > 0
  const grossFundingUsd = sizeUsd * fundingRatePerInterval * totalIntervals;

  // Costs
  const entryFeesUsd = sizeUsd * (entryFeesPct / 100) * 2; // round-trip
  const slippageUsd = sizeUsd * (slippagePct / 100) * 2; // entry + exit
  const borrowUsd = sizeUsd * (borrowAprPct / 100) * (horizonDays / 365);

  const netPnlUsd = grossFundingUsd - entryFeesUsd - slippageUsd - borrowUsd;
  const netPerDayUsd = netPnlUsd / horizonDays;

  // APR
  const carryAprPct = (netPnlUsd / sizeUsd) * (365 / horizonDays) * 100;

  // Break-even funding per interval (covers fees + borrow)
  const breakEvenFundingPct = ((entryFeesUsd + slippageUsd + borrowUsd) / sizeUsd / totalIntervals) * 100;

  // Liquidation distance (approximate, 3x leverage assumed default)
  // Perp short liquidation when spot rises by ~(1/leverage - maintenance margin)
  const maintenanceMarginPct = 0.5; // 50% maintenance margin approximation
  const liquidationDistancePct = ((1 / leverage) - maintenanceMarginPct / 100) * 100;

  // Annualized funding APR for display
  const annualizedFundingAprPct = fundingRatePerInterval * intervalsPerDay * 365 * 100;

  // Verdict
  const marginOfSafety = fundingRatePerInterval / (breakEvenFundingPct / 100);
  const profitable = fundingRatePerInterval > (breakEvenFundingPct / 100);

  // Payoff series (cumulative, per day)
  const payoffSeries = [];
  for (let day = 0; day <= horizonDays; day++) {
    const intervals = Math.round(day * intervalsPerDay);
    const gross = sizeUsd * fundingRatePerInterval * intervals;
    const dailyBorrow = sizeUsd * (borrowAprPct / 100) * (day / 365);
    const dailySlippage = day === 0 ? 0 : slippageUsd;
    const dailyFees = day === 0 ? 0 : entryFeesUsd;
    payoffSeries.push({ day, pnlUsd: gross - dailyFees - dailySlippage - dailyBorrow });
  }

  return {
    calcType: "basis",
    carryAprPct: Number(carryAprPct.toFixed(2)),
    netPnlUsd: Number(netPnlUsd.toFixed(2)),
    netPerDayUsd: Number(netPerDayUsd.toFixed(2)),
    grossFundingUsd: Number(grossFundingUsd.toFixed(2)),
    entryFeesUsd: Number(entryFeesUsd.toFixed(2)),
    slippageUsd: Number(slippageUsd.toFixed(2)),
    borrowUsd: Number(borrowUsd.toFixed(2)),
    breakEvenFundingPct: Number(breakEvenFundingPct.toFixed(4)),
    liquidationDistancePct: Number(liquidationDistancePct.toFixed(1)),
    annualizedFundingAprPct: Number(annualizedFundingAprPct.toFixed(2)),
    marginOfSafety: Number(marginOfSafety.toFixed(2)),
    profitable,
    payoffSeries,
    inputs: {
      symbol: inputs.symbol,
      spotVenue: inputs.spotVenue,
      perpVenue: inputs.perpVenue,
      sizeUsd,
      leverage,
      horizonDays,
      fundingMode: inputs.fundingMode,
      fundingRatePct: Number((fundingRatePerInterval * 100).toFixed(4)),
      fundingIntervalHours,
      borrowAprPct,
      entryFeesPct,
      slippagePct
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Perp Arbitrage engine
// Inputs: symbol, venueA, venueB, sizeUsd, sideA ('short'|'long'), sideB,
//         feeRoleA ('maker'|'taker'), feeRoleB, fundingWindowHours
// ─────────────────────────────────────────────────────────────────────────────
function computePerpArb(inputs, context = {}) {
  const sizeUsd = Number(inputs.sizeUsd) || 0;
  const fundingWindowHours = Number(inputs.fundingWindowHours) || 8;

  const venueA = getVenueById(inputs.venueA);
  const venueB = getVenueById(inputs.venueB);
  if (!venueA || !venueB) {
    return { error: "venue_not_found", message: "One or both venues not configured." };
  }

  const liveA = context.fundingByVenue?.[venueA.id] || {};
  const liveB = context.fundingByVenue?.[venueB.id] || {};
  const markA = Number(liveA.markPrice) || 0;
  const markB = Number(liveB.markPrice) || 0;
  const fundingA = Number(liveA.fundingRate) || 0;
  const fundingB = Number(liveB.fundingRate) || 0;
  const latencyP95A = Number(liveA.latencyP95Ms) || null;
  const latencyP95B = Number(liveB.latencyP95Ms) || null;

  if (!markA || !markB) {
    return { error: "mark_price_unavailable", message: "Missing mark price for one or both venues." };
  }

  // Price basis (A - B)
  const priceBasisUsd = markA - markB;

  // Funding basis (A - B) per interval
  const fundingBasisPct = (fundingA - fundingB) * 100;

  // Gross arb per window: price difference + funding differential
  // If A is short and B is long: A pays funding (receives if negative), B pays funding
  // Net funding capture = (fundingA - fundingB) * size when short A / long B
  const sideA = String(inputs.sideA || "short").toLowerCase();
  const sideB = String(inputs.sideB || "long").toLowerCase();
  const fundingSign = sideA === "short" ? 1 : -1; // short captures positive funding
  const grossFundingUsd = sizeUsd * (fundingA - fundingB) * fundingSign;
  const grossPriceUsd = sizeUsd * (priceBasisUsd / markB) * (sideA === "short" ? 1 : -1);
  const grossArbUsd = grossPriceUsd + grossFundingUsd;

  // Fees (round-trip, both venues)
  const feeBpsA = inputs.feeRoleA === "maker" ? venueA.makerBps : venueA.takerBps;
  const feeBpsB = inputs.feeRoleB === "maker" ? venueB.makerBps : venueB.takerBps;
  const feesUsd = sizeUsd * (feeBpsA / 10000) + sizeUsd * (feeBpsB / 10000);

  // Slippage (latency-implied when available, else 1bp default)
  const slippageBpsA = latencyP95A ? Math.min(10, latencyP95A / 20) : 1;
  const slippageBpsB = latencyP95B ? Math.min(10, latencyP95B / 20) : 1;
  const slippageUsd = sizeUsd * (slippageBpsA / 10000) + sizeUsd * (slippageBpsB / 10000);

  const netPerWindowUsd = grossArbUsd - feesUsd - slippageUsd;
  const windowsPerYear = 365 * 24 / fundingWindowHours;
  const netAprPct = (netPerWindowUsd / sizeUsd) * windowsPerYear * 100;

  // Break-even
  const breakEvenPriceBasisUsd = (feesUsd + slippageUsd) / sizeUsd * markB;
  const profitable = netPerWindowUsd > 0;

  return {
    calcType: "perp_arb",
    priceBasisUsd: Number(priceBasisUsd.toFixed(2)),
    fundingBasisPct: Number(fundingBasisPct.toFixed(4)),
    grossArbUsd: Number(grossArbUsd.toFixed(2)),
    grossFundingUsd: Number(grossFundingUsd.toFixed(2)),
    grossPriceUsd: Number(grossPriceUsd.toFixed(2)),
    feesUsd: Number(feesUsd.toFixed(2)),
    slippageUsd: Number(slippageUsd.toFixed(2)),
    netPerWindowUsd: Number(netPerWindowUsd.toFixed(2)),
    netAprPct: Number(netAprPct.toFixed(2)),
    capitalRequiredUsd: sizeUsd,
    breakEvenPriceBasisUsd: Number(breakEvenPriceBasisUsd.toFixed(2)),
    profitable,
    markPriceA: markA,
    markPriceB: markB,
    fundingRateA: fundingA,
    fundingRateB: fundingB,
    latencyP95A,
    latencyP95B,
    inputs: {
      symbol: inputs.symbol,
      venueA: venueA.id,
      venueB: venueB.id,
      sideA,
      sideB,
      feeRoleA: inputs.feeRoleA,
      feeRoleB: inputs.feeRoleB,
      sizeUsd,
      fundingWindowHours
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee Comparator engine
// Crypto mode: ranked total cost to trade $X of asset Y
// Stock mode: ranked total cost to trade N shares of asset Y
// ─────────────────────────────────────────────────────────────────────────────
function computeCryptoFees(inputs, context = {}) {
  const sizeUsd = Number(inputs.sizeUsd) || 0;
  const role = String(inputs.role || "taker").toLowerCase();
  const asset = String(inputs.asset || "BTC").toUpperCase();

  const rows = listCryptoVenues({ includeDisabled: false }).map((venue) => {
    const feeBps = role === "maker" ? venue.makerBps : venue.takerBps;
    const feeUsd = sizeUsd * (feeBps / 10000);
    const liveFunding = context.fundingByVenue?.[venue.id];
    const fundingPct = liveFunding?.fundingRate ? Number((liveFunding.fundingRate * 100).toFixed(4)) : null;
    // Slippage estimate: from latency when available, else default by venue kind
    const latencyP95 = liveFunding?.latencyP95Ms;
    const slippageUsd = latencyP95
      ? sizeUsd * Math.min(10, latencyP95 / 25) / 10000
      : sizeUsd * (venue.kind === "dex" ? 0.0003 : 0.0002);
    const withdrawalUsd = venue.withdrawalFeeUsd || 0;
    const totalUsd = feeUsd + slippageUsd + withdrawalUsd;
    return {
      venueId: venue.id,
      venue: venue.name,
      kind: venue.kind.toUpperCase(),
      makerBps: venue.makerBps,
      takerBps: venue.takerBps,
      feeUsd: Number(feeUsd.toFixed(2)),
      fundingPct,
      withdrawalUsd: Number(withdrawalUsd.toFixed(2)),
      slippageUsd: Number(slippageUsd.toFixed(2)),
      totalUsd: Number(totalUsd.toFixed(2))
    };
  });

  rows.sort((a, b) => a.totalUsd - b.totalUsd);
  rows.forEach((row, i) => { row.rank = i + 1; });

  const cheapest = rows[0];
  const expensive = rows[rows.length - 1];
  const savingsVsWorst = Number((expensive.totalUsd - cheapest.totalUsd).toFixed(2));

  return {
    calcType: "fees_crypto",
    asset,
    sizeUsd,
    role,
    rows,
    cheapestVenue: cheapest?.venue || null,
    cheapestTotalUsd: cheapest?.totalUsd || 0,
    expensiveVenue: expensive?.venue || null,
    expensiveTotalUsd: expensive?.totalUsd || 0,
    savingsVsWorstUsd: savingsVsWorst
  };
}

function computeStockBrokerFees(inputs) {
  const shares = Math.max(1, Number(inputs.shares) || 1);
  const pricePerShare = Number(inputs.pricePerShare) || 0;
  const notionalUsd = shares * pricePerShare;
  const useMargin = String(inputs.margin || "no").toLowerCase() !== "no";
  const marginPct = useMargin ? (Number(String(inputs.margin).replace(/[^\d.]/g, "")) || 0) / 100 : 0;
  const marginDebitUsd = notionalUsd * marginPct;

  const rows = listStockBrokers().map((broker) => {
    const commissionUsd = broker.commissionUsd * shares;
    const perShareUsd = broker.perShareUsd * shares;
    const fxUsd = notionalUsd * (broker.fxSpreadPct / 100);
    const marginAnnualUsd = marginDebitUsd * (broker.marginApr / 100);
    const totalUsd = commissionUsd + perShareUsd + fxUsd;
    return {
      brokerId: broker.id,
      broker: broker.name,
      region: broker.region,
      commissionUsd: Number(commissionUsd.toFixed(2)),
      perShareUsd: Number(perShareUsd.toFixed(2)),
      fxSpreadPct: broker.fxSpreadPct,
      marginApr: broker.marginApr,
      marginAnnualUsd: Number(marginAnnualUsd.toFixed(2)),
      optionsPerContract: broker.optionsPerContract,
      totalUsd: Number(totalUsd.toFixed(2))
    };
  });

  rows.sort((a, b) => a.totalUsd - b.totalUsd);
  rows.forEach((row, i) => { row.rank = i + 1; });

  const cheapest = rows[0];
  const cheapestMargin = rows.slice().sort((a, b) => a.marginApr - b.marginApr)[0];

  return {
    calcType: "fees_broker",
    asset: inputs.asset,
    shares,
    pricePerShare,
    notionalUsd,
    marginDebitUsd,
    rows,
    cheapestVenue: cheapest?.broker || null,
    cheapestTotalUsd: cheapest?.totalUsd || 0,
    cheapestMarginBroker: cheapestMargin?.broker || null,
    cheapestMarginApr: cheapestMargin?.marginApr || 0
  };
}

module.exports = {
  CRYPTO_VENUES,
  STOCK_BROKERS,
  listCryptoVenues,
  listStockBrokers,
  getVenueById,
  computeBasisCarry,
  computePerpArb,
  computeCryptoFees,
  computeStockBrokerFees
};
