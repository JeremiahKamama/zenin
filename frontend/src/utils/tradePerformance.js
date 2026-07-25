// utils/tradePerformance.js
// Shared, pure FIFO realized-P&L analyzer extracted from JournalModule's
// analytics memo. Both Journal and the Portfolio "Performance" tab use this as
// the single source of truth for closed-trade analytics.
//
// Input: unified/exchange transactions shaped like PortfolioModule's
// `displayTransactions` mapping (type BUY/SELL, asset/symbol, quantity, price,
// notional, executedAt/date, platform/provider, sourceAccountId, marketType).
//
// Output:
//   - realizedTrades[]: one entry per closed round-trip lot match
//   - assetReport[]: per-symbol rollup (wins/losses/volume/pnl)
//   - aggregate: { winRate, realizedPnl, largestGain, largestLoss, totalTrades,
//       wins, losses, breakevens, avgHoldDays }

const DAY_MS = 24 * 60 * 60 * 1000;
const EPS = 1e-8;

export const normalizeSymbol = (value) =>
  String(value || "UNKNOWN").trim().toUpperCase();

export const safeNum = (val) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
};

export const parseTradeDate = (dateStr) => {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
};

const normalizeMarketType = (trade) => {
  const mt = String(trade?.marketType || trade?.market_type || "").toLowerCase();
  if (mt.includes("option")) return "options";
  if (mt.includes("perp") || mt.includes("future")) return "perp";
  return "spot";
};

// FIFO key: keep spot/perp/options for the same symbol separate so a perp
// round-trip doesn't net against a spot lot (matches Journal's reportKey split).
const buildLotKey = (asset, trade) => `${asset}::${normalizeMarketType(trade)}`;

const formatCloseDate = (trade, dateObj) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(trade.date || "")) return trade.date;
  if (dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
  }
  return "";
};

export function analyzeTradePerformance({ transactions = [], livePriceBySymbol = {} } = {}) {
  const nowTs = Date.now();

  const sorted = [...transactions].sort((a, b) => {
    const ta = parseTradeDate(a.executedAt || a.date)?.getTime() ?? 0;
    const tb = parseTradeDate(b.executedAt || b.date)?.getTime() ?? 0;
    if (ta !== tb) return ta - tb;
    return (a.id || 0) - (b.id || 0);
  });

  const lotsByKey = new Map(); // lotKey -> array of open lots
  const realized = [];
  let totalHoldQty = 0;
  let totalHoldQtyDays = 0;
  let totalVolume = 0;

  for (const trade of sorted) {
    const type = String(trade.type || trade.side || "").toUpperCase();
    if (type !== "BUY" && type !== "SELL") continue;

    const asset = normalizeSymbol(trade.asset || trade.symbol);
    const lotKey = buildLotKey(asset, trade);
    const qty = Math.max(0, safeNum(trade.quantity));
    const price = safeNum(trade.price);
    const dateObj = parseTradeDate(trade.executedAt || trade.date);
    if (qty <= 0) continue;

    const notionalRaw = safeNum(trade.notional);
    const notional = Math.abs(notionalRaw > 0 ? notionalRaw : price * qty);
    totalVolume += notional;

    // direction we are opening if no opposite lot exists to close
    const openingDirection = type === "BUY" ? "long" : "short";
    // lots of the OPPOSITE direction get closed by this trade
    const oppositeDirection = type === "BUY" ? "short" : "long";

    const lots = lotsByKey.get(lotKey) || [];

    if (type === "BUY") {
      // First, close any open shorts (buy-to-cover).
      let remaining = qty;
      while (remaining > 0 && lots.length > 0 && lots[0].direction === "short") {
        const lot = lots[0];
        const matchedQty = Math.min(remaining, lot.qty);
        const pnl = (lot.price - price) * matchedQty; // short: profit when price falls
        const holdDays = lot.date && dateObj ? Math.max(0, (dateObj.getTime() - lot.date.getTime()) / DAY_MS) : 0;
        realized.push({
          asset,
          symbol: asset,
          side: "Short",
          direction: "short",
          entryPrice: lot.price,
          exitPrice: price,
          entryAt: lot.date ? lot.date.getTime() : null,
          exitAt: dateObj ? dateObj.getTime() : null,
          holdMs: lot.date && dateObj ? Math.max(0, dateObj.getTime() - lot.date.getTime()) : 0,
          holdDays,
          qty: matchedQty,
          volume: price * matchedQty,
          pnl,
          closeDate: formatCloseDate(trade, dateObj),
          platform: trade.platform || trade.provider || "unknown",
          provider: trade.provider || trade.platform || "unknown",
          sourceAccountId: trade.sourceAccountId || "",
          marketType: normalizeMarketType(trade),
        });
        totalHoldQty += matchedQty;
        totalHoldQtyDays += holdDays * matchedQty;
        lot.qty -= matchedQty;
        remaining -= matchedQty;
        if (lot.qty <= 0) lots.shift();
      }
      // Remaining quantity opens a new long lot.
      if (remaining > 0) {
        lots.push({ direction: "long", qty: remaining, price, date: dateObj });
      }
      lotsByKey.set(lotKey, lots);
    } else {
      // SELL: first close open longs (sell-to-close).
      let remaining = qty;
      while (remaining > 0 && lots.length > 0 && lots[0].direction === "long") {
        const lot = lots[0];
        const matchedQty = Math.min(remaining, lot.qty);
        const pnl = (price - lot.price) * matchedQty; // long: profit when price rises
        const holdDays = lot.date && dateObj ? Math.max(0, (dateObj.getTime() - lot.date.getTime()) / DAY_MS) : 0;
        realized.push({
          asset,
          symbol: asset,
          side: "Long",
          direction: "long",
          entryPrice: lot.price,
          exitPrice: price,
          entryAt: lot.date ? lot.date.getTime() : null,
          exitAt: dateObj ? dateObj.getTime() : null,
          holdMs: lot.date && dateObj ? Math.max(0, dateObj.getTime() - lot.date.getTime()) : 0,
          holdDays,
          qty: matchedQty,
          volume: price * matchedQty,
          pnl,
          closeDate: formatCloseDate(trade, dateObj),
          platform: trade.platform || trade.provider || "unknown",
          provider: trade.provider || trade.platform || "unknown",
          sourceAccountId: trade.sourceAccountId || "",
          marketType: normalizeMarketType(trade),
        });
        totalHoldQty += matchedQty;
        totalHoldQtyDays += holdDays * matchedQty;
        lot.qty -= matchedQty;
        remaining -= matchedQty;
        if (lot.qty <= 0) lots.shift();
      }
      // Remaining quantity opens a new short lot.
      if (remaining > 0) {
        lots.push({ direction: "short", qty: remaining, price, date: dateObj });
      }
      lotsByKey.set(lotKey, lots);
    }
  }

  // Aggregate open lots into hold-duration stats (unchanged from Journal).
  for (const lots of lotsByKey.values()) {
    for (const lot of lots) {
      const lotQty = Math.max(0, safeNum(lot.qty));
      if (lotQty <= EPS) continue;
      const holdDays = lot.date ? Math.max(0, (nowTs - lot.date.getTime()) / DAY_MS) : 0;
      totalHoldQty += lotQty;
      totalHoldQtyDays += holdDays * lotQty;
    }
  }

  const wins = realized.filter((r) => r.pnl > EPS);
  const losses = realized.filter((r) => r.pnl < -EPS);
  const breakevens = realized.filter((r) => Math.abs(r.pnl) <= EPS);
  const decisive = wins.length + losses.length;
  const realizedPnl = realized.reduce((acc, r) => acc + r.pnl, 0);
  const largestGain = wins.length ? Math.max(...wins.map((r) => r.pnl)) : 0;
  const largestLoss = losses.length ? Math.min(...losses.map((r) => r.pnl)) : 0;
  const avgHoldDays = totalHoldQty > EPS ? totalHoldQtyDays / totalHoldQty : 0;
  const winRate = decisive ? (wins.length / decisive) * 100 : 0;

  // Per-asset rollup
  const bySymbol = new Map();
  for (const r of realized) {
    const sym = r.symbol;
    const row = bySymbol.get(sym) || {
      symbol: sym,
      asset: sym,
      trades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      volume: 0,
      pnl: 0,
      totalQty: 0,
    };
    row.trades += 1;
    row.volume += r.volume;
    row.pnl += r.pnl;
    row.totalQty += r.qty;
    if (r.pnl > EPS) row.wins += 1;
    else if (r.pnl < -EPS) row.losses += 1;
    else row.breakevens += 1;
    bySymbol.set(sym, row);
  }
  const assetReport = [...bySymbol.values()].map((row) => {
    const decisiveSym = row.wins + row.losses;
    const winRateSym = decisiveSym ? (row.wins / decisiveSym) * 100 : 0;
    return { ...row, winRate: winRateSym, netPosition: row.totalQty };
  });

  return {
    realizedTrades: realized,
    assetReport,
    aggregate: {
      winRate,
      realizedPnl,
      largestGain,
      largestLoss,
      totalTrades: realized.length,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      avgHoldDays,
      totalVolume,
    },
  };
}

export default analyzeTradePerformance;
