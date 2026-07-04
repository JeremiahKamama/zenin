import { numberOrZero } from "./formatNumbers";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const TAX_LEDGER_BUCKETS = [
  {
    key: "Equities",
    title: "Equities",
    description: "Stocks, ETFs, REITs",
    fallbackSymbol: "EQ-BOOK",
  },
  {
    key: "Crypto",
    title: "Digital Assets",
    description: "Coins, tokens, DeFi, NFTs",
    fallbackSymbol: "CRYPTO-BOOK",
  },
  {
    key: "Bonds",
    title: "Fixed Income",
    description: "Bonds, notes, CDs",
    fallbackSymbol: "FI-BOOK",
  },
  {
    key: "MMFs",
    title: "Cash Funds",
    description: "Money market funds",
    fallbackSymbol: "MMF-BOOK",
  },
  {
    key: "Special Funds",
    title: "Special Funds",
    description: "Private equity, hedge funds, structured products",
    fallbackSymbol: "ALT-BOOK",
  },
];

function roundAmount(value) {
  return Math.round(numberOrZero(value) * 100) / 100;
}

function createEmptyGains() {
  return {
    Equities: { shortTerm: 0, longTerm: 0 },
    Bonds: { standard: 0 },
    "Special Funds": { standard: 0 },
    MMFs: { standard: 0 },
    Crypto: { shortTerm: 0, longTerm: 0 },
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

function buildTradeRows(trades = [], portfolio = [], spotPrices = {}, advanced = {}) {
  const grouped = new Map();
  const rows = Array.isArray(trades) ? trades : [];
  rows.forEach((trade) => {
    const symbol = String(trade?.asset || trade?.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    const qty = Math.abs(numberOrZero(trade?.quantity));
    const px = numberOrZero(trade?.price);
    const executedAt = new Date(trade?.executedAt || trade?.executed_at || trade?.date || 0).getTime();
    if (!qty || !px || !Number.isFinite(executedAt)) return;

    const key = `${normalizeMarketBucket(trade)}:${symbol}`;
    const current = grouped.get(key) || {
      id: `trade-${key}`,
      bucket: normalizeMarketBucket(trade),
      symbol,
      instrument: symbol,
      subtitle: String(trade?.name || symbol),
      quantity: 0,
      buyQty: 0,
      sellQty: 0,
      buyNotional: 0,
      sellNotional: 0,
      fees: 0,
      firstBuyTs: null,
      lastSellTs: null,
      latestTs: executedAt,
    };

    const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
    if (side === "buy") {
      current.buyQty += qty;
      current.buyNotional += qty * px;
      current.quantity += qty;
      current.firstBuyTs = current.firstBuyTs ? Math.min(current.firstBuyTs, executedAt) : executedAt;
    } else {
      current.sellQty += qty;
      current.sellNotional += qty * px;
      current.quantity = Math.max(0, current.quantity - qty);
      current.lastSellTs = current.lastSellTs ? Math.max(current.lastSellTs, executedAt) : executedAt;
    }

    current.fees += numberOrZero(trade?.fee || trade?.fees || trade?.commission);
    current.latestTs = Math.max(current.latestTs, executedAt);
    grouped.set(key, current);
  });

  const portfolioRows = Array.isArray(portfolio) ? portfolio : [];
  portfolioRows.forEach((holding) => {
    const symbol = String(holding?.symbol || holding?.asset || "").trim().toUpperCase();
    if (!symbol) return;
    const existingKey = [...grouped.keys()].find((key) => key.endsWith(`:${symbol}`));
    if (existingKey) {
      const current = grouped.get(existingKey);
      current.quantity = Math.max(current.quantity, numberOrZero(holding?.quantity));
      if (!current.subtitle || current.subtitle === current.instrument) {
        current.subtitle = String(holding?.name || current.subtitle || current.instrument);
      }
      grouped.set(existingKey, current);
      return;
    }

    const bucket = normalizeMarketBucket(holding);
    grouped.set(`${bucket}:${symbol}`, {
      id: `portfolio-${bucket}:${symbol}`,
      bucket,
      symbol,
      instrument: symbol,
      subtitle: String(holding?.name || symbol),
      quantity: numberOrZero(holding?.quantity),
      buyQty: numberOrZero(holding?.quantity),
      sellQty: 0,
      buyNotional: numberOrZero(holding?.averageCost || holding?.costBasis || holding?.entryPrice || holding?.price) * numberOrZero(holding?.quantity),
      sellNotional: 0,
      fees: 0,
      firstBuyTs: Date.now() - 45 * 24 * 60 * 60 * 1000,
      lastSellTs: null,
      latestTs: Date.now(),
    });
  });

  return Array.from(grouped.values()).map((row) => {
    const avgBuyPrice = row.buyQty > 0 ? row.buyNotional / row.buyQty : 0;
    const avgSellPrice = row.sellQty > 0 ? row.sellNotional / row.sellQty : avgBuyPrice;
    const matchedQty = row.sellQty > 0 ? row.sellQty : Math.min(row.buyQty, row.quantity);
    const proceeds = matchedQty * avgSellPrice;
    const costBasis = matchedQty * avgBuyPrice;
    const pnl = roundAmount(proceeds - costBasis);
    const holdingMs =
      row.firstBuyTs && row.lastSellTs ? Math.max(0, row.lastSellTs - row.firstBuyTs) : 0;
    const isLongTerm = holdingMs >= YEAR_MS;
    const marketValue =
      numberOrZero(spotPrices?.[row.symbol]) > 0
        ? numberOrZero(spotPrices[row.symbol]) * Math.max(row.quantity, row.sellQty)
        : avgSellPrice * Math.max(row.quantity, row.sellQty);
    const fxRate = Math.max(0.0001, numberOrZero(advanced?.fxRate) || 1);

    return {
      id: row.id,
      bucket: row.bucket,
      symbol: row.symbol,
      instrument: row.instrument,
      subtitle: row.subtitle,
      quantity: roundAmount(Math.max(row.sellQty, row.quantity)),
      marketValue: roundAmount(marketValue),
      costBasis: roundAmount(costBasis),
      fees: roundAmount(row.fees),
      fxRate,
      shortTermGain:
        row.bucket === "Equities" || row.bucket === "Crypto"
          ? roundAmount(isLongTerm ? 0 : pnl)
          : 0,
      longTermGain:
        row.bucket === "Equities" || row.bucket === "Crypto"
          ? roundAmount(isLongTerm ? pnl : 0)
          : 0,
      standardGain:
        row.bucket !== "Equities" && row.bucket !== "Crypto" ? roundAmount(pnl) : 0,
      classification:
        row.bucket === "Equities" || row.bucket === "Crypto"
          ? isLongTerm
            ? "Long-term"
            : "Short-term"
          : "Standard",
      source: row.sellQty > 0 ? "Derived from trades" : "Portfolio carryover",
      updatedAt: row.latestTs,
    };
  });
}

function createFallbackRows(gains = createEmptyGains(), advanced = {}) {
  const fxRate = Math.max(0.0001, numberOrZero(advanced?.fxRate) || 1);
  const rows = [];
  TAX_LEDGER_BUCKETS.forEach((bucket) => {
    if (bucket.key === "Equities" || bucket.key === "Crypto") {
      const shortTermGain = roundAmount(gains?.[bucket.key]?.shortTerm);
      const longTermGain = roundAmount(gains?.[bucket.key]?.longTerm);
      if (!shortTermGain && !longTermGain) return;
      rows.push({
        id: `fallback-${bucket.key}`,
        bucket: bucket.key,
        symbol: bucket.fallbackSymbol,
        instrument: bucket.title,
        subtitle: bucket.description,
        quantity: 0,
        marketValue: roundAmount(shortTermGain + longTermGain),
        costBasis: 0,
        fees: 0,
        fxRate,
        shortTermGain,
        longTermGain,
        standardGain: 0,
        classification: longTermGain > shortTermGain ? "Long-term" : "Short-term",
        source: "Declared totals",
        updatedAt: Date.now(),
      });
      return;
    }

    const standardGain = roundAmount(gains?.[bucket.key]?.standard);
    if (!standardGain) return;
    rows.push({
      id: `fallback-${bucket.key}`,
      bucket: bucket.key,
      symbol: bucket.fallbackSymbol,
      instrument: bucket.title,
      subtitle: bucket.description,
      quantity: 0,
      marketValue: standardGain,
      costBasis: 0,
      fees: 0,
      fxRate,
      shortTermGain: 0,
      longTermGain: 0,
      standardGain,
      classification: "Standard",
      source: "Declared totals",
      updatedAt: Date.now(),
    });
  });
  return rows;
}

function applyOverrides(row, overrides = {}) {
  if (!overrides || typeof overrides !== "object") return row;
  return {
    ...row,
    quantity: overrides.quantity !== undefined ? roundAmount(overrides.quantity) : row.quantity,
    marketValue: overrides.marketValue !== undefined ? roundAmount(overrides.marketValue) : row.marketValue,
    costBasis: overrides.costBasis !== undefined ? roundAmount(overrides.costBasis) : row.costBasis,
    fees: overrides.fees !== undefined ? roundAmount(overrides.fees) : row.fees,
    fxRate: overrides.fxRate !== undefined ? Math.max(0.0001, numberOrZero(overrides.fxRate)) : row.fxRate,
    shortTermGain:
      overrides.shortTermGain !== undefined ? roundAmount(overrides.shortTermGain) : row.shortTermGain,
    longTermGain:
      overrides.longTermGain !== undefined ? roundAmount(overrides.longTermGain) : row.longTermGain,
    standardGain:
      overrides.standardGain !== undefined ? roundAmount(overrides.standardGain) : row.standardGain,
  };
}

function summarizeRowsToGains(rows = []) {
  const gains = createEmptyGains();
  rows.forEach((row) => {
    if (row.bucket === "Equities" || row.bucket === "Crypto") {
      gains[row.bucket].shortTerm += numberOrZero(row.shortTermGain);
      gains[row.bucket].longTerm += numberOrZero(row.longTermGain);
      return;
    }
    gains[row.bucket].standard += numberOrZero(row.standardGain);
  });

  return {
    Equities: {
      shortTerm: roundAmount(gains.Equities.shortTerm),
      longTerm: roundAmount(gains.Equities.longTerm),
    },
    Bonds: { standard: roundAmount(gains.Bonds.standard) },
    "Special Funds": { standard: roundAmount(gains["Special Funds"].standard) },
    MMFs: { standard: roundAmount(gains.MMFs.standard) },
    Crypto: {
      shortTerm: roundAmount(gains.Crypto.shortTerm),
      longTerm: roundAmount(gains.Crypto.longTerm),
    },
  };
}

function bucketTargetGain(bucketKey, gains = createEmptyGains()) {
  if (bucketKey === "Equities" || bucketKey === "Crypto") {
    return roundAmount(numberOrZero(gains?.[bucketKey]?.shortTerm) + numberOrZero(gains?.[bucketKey]?.longTerm));
  }
  return roundAmount(numberOrZero(gains?.[bucketKey]?.standard));
}

function bucketActualGain(bucketRows = [], bucketKey) {
  if (bucketKey === "Equities" || bucketKey === "Crypto") {
    return roundAmount(
      bucketRows.reduce(
        (sum, row) => sum + numberOrZero(row.shortTermGain) + numberOrZero(row.longTermGain),
        0
      )
    );
  }
  return roundAmount(bucketRows.reduce((sum, row) => sum + numberOrZero(row.standardGain), 0));
}

export function buildTaxEstimatorLedger({
  trades = [],
  portfolio = [],
  spotPrices = {},
  gains = createEmptyGains(),
  advanced = {},
  overrides = {},
}) {
  const tradeRows = buildTradeRows(trades, portfolio, spotPrices, advanced);
  const baseRows = tradeRows.length > 0 ? tradeRows : createFallbackRows(gains, advanced);
  const rowsWithOverrides = baseRows.map((row) => applyOverrides(row, overrides[row.id]));

  return TAX_LEDGER_BUCKETS.map((bucket) => {
    const bucketRows = rowsWithOverrides
      .filter((row) => row.bucket === bucket.key)
      .sort((a, b) => bucketActualGain([b], bucket.key) - bucketActualGain([a], bucket.key));

    const targetGain = bucketTargetGain(bucket.key, gains);
    const actualGain = bucketActualGain(bucketRows, bucket.key);
    if (Math.abs(targetGain - actualGain) > 0.5) {
      bucketRows.push({
        id: `adjustment-${bucket.key}`,
        bucket: bucket.key,
        symbol: "ADJ",
        instrument: "Declared adjustment",
        subtitle: "Reconciles imported ledger with declared totals",
        quantity: 0,
        marketValue: Math.abs(targetGain - actualGain),
        costBasis: 0,
        fees: 0,
        fxRate: Math.max(0.0001, numberOrZero(advanced?.fxRate) || 1),
        shortTermGain: bucket.key === "Equities" || bucket.key === "Crypto" ? roundAmount(targetGain - actualGain) : 0,
        longTermGain: 0,
        standardGain: bucket.key !== "Equities" && bucket.key !== "Crypto" ? roundAmount(targetGain - actualGain) : 0,
        classification: "Adjustment",
        source: "Declared totals",
        updatedAt: Date.now(),
      });
    }

    const totals = bucketRows.reduce(
      (sum, row) => {
        sum.quantity += numberOrZero(row.quantity);
        sum.marketValue += numberOrZero(row.marketValue);
        sum.costBasis += numberOrZero(row.costBasis);
        sum.fees += numberOrZero(row.fees);
        sum.shortTermGain += numberOrZero(row.shortTermGain);
        sum.longTermGain += numberOrZero(row.longTermGain);
        sum.standardGain += numberOrZero(row.standardGain);
        return sum;
      },
      {
        quantity: 0,
        marketValue: 0,
        costBasis: 0,
        fees: 0,
        shortTermGain: 0,
        longTermGain: 0,
        standardGain: 0,
      }
    );

    return {
      ...bucket,
      rows: bucketRows,
      totals: {
        quantity: roundAmount(totals.quantity),
        marketValue: roundAmount(totals.marketValue),
        costBasis: roundAmount(totals.costBasis),
        fees: roundAmount(totals.fees),
        shortTermGain: roundAmount(totals.shortTermGain),
        longTermGain: roundAmount(totals.longTermGain),
        standardGain: roundAmount(totals.standardGain),
      },
    };
  });
}

export function summarizeLedgerToGains(sections = []) {
  const rows = Array.isArray(sections)
    ? sections.flatMap((section) => (Array.isArray(section?.rows) ? section.rows : []))
    : [];
  return summarizeRowsToGains(rows);
}
