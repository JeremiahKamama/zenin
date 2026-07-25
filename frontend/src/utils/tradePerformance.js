// utils/tradePerformance.js
// Shared, pure FIFO realized-P&L analyzer extracted from JournalModule's
// analytics memo. Both Journal and the Portfolio "Performance" tab use this as
// the single source of truth for closed-trade analytics.
//
// Input transactions: shaped like PortfolioModule's `displayTransactions`
// mapping (type BUY/SELL, asset/symbol, quantity, price, notional,
// executedAt/date, platform/provider, sourceAccountId, marketType).
//
// Output:
//   - realizedTrades[]: one entry per closed round-trip lot match, with
//     connection attribution + asset-class classification.
//   - assetReport[]: per-symbol rollup, including byConnection breakdown.
//   - aggregate: winRate, realizedPnl, largestGain, largestLoss, totalTrades,
//       wins, losses, breakevens, avgHoldDays.

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

const OCC_RE = /^[A-Z]{1,6}\s+\d{6}[CP]\d{8}$/;

// Asset-class detection (fixes the unified mapper's "everything non-wallet = spot").
// `ctx` carries the resolved connection type/provider so we can tell stocks apart.
export function detectAssetClass(symbol, marketType, ctx = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (OCC_RE.test(sym)) return "OPTIONS";
  if (ctx?.hasLegs) return "OPTIONS";
  if (sym.includes("/")) return "FX";
  const mt = normalizeMarketType({ marketType });
  if (mt === "perp") return "PERP";
  if (ctx?.connectionType === "broker" || ctx?.isBrokerage) return "STOCKS";
  if (mt === "options") return "OPTIONS";
  // alpha-only, no slash, not perp, not a broker -> treat as equities
  if (/^[A-Z]{1,6}$/.test(sym) && !ctx?.isCrypto) return "STOCKS";
  return "SPOT";
}

// Build a connection registry from connectedAccounts + brokerageAccounts so
// each trade can be attributed to a stable { id, label }.
export function buildConnectionRegistry({ connectedAccounts = [], brokerageAccounts = [] } = {}) {
  const map = new Map();
  const add = (id, label, type, provider) => {
    if (!id) return;
    if (map.has(id)) return;
    map.set(String(id), { id: String(id), label: String(label || id), type, provider: String(provider || id) });
  };
  for (const a of connectedAccounts || []) {
    const id = a.sourceAccountId || a.provider || a.exchange || a.id;
    add(id, a.label || a.provider || a.exchange || id, a.venueType || a.type, a.provider || a.exchange);
  }
  for (const b of brokerageAccounts || []) {
    const id = b.id || b.sourceAccountId || b.provider || b.accountId;
    add(id, b.name || b.label || b.provider || id, "broker", b.provider || b.brokerage);
  }
  // Resolver: match a trade to a registry entry by sourceAccountId, then provider.
  const resolve = (trade) => {
    if (!trade) return null;
    const ids = [trade.sourceAccountId, trade.provider, trade.platform].filter(Boolean).map(String);
    for (const id of ids) {
      if (map.has(id)) return map.get(id);
    }
    return null;
  };
  return { map, resolve, list: [...map.values()] };
}

const buildLotKey = (asset, trade) => `${asset}::${normalizeMarketType(trade)}`;

const formatCloseDate = (trade, dateObj) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(trade.date || "")) return trade.date;
  if (dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
  }
  return "";
};

export function analyzeTradePerformance({ transactions = [], livePriceBySymbol = {}, connections = null } = {}) {
  const nowTs = Date.now();
  const registry = connections || { map: new Map(), resolve: () => null, list: [] };

  const sorted = [...transactions].sort((a, b) => {
    const ta = parseTradeDate(a.executedAt || a.date)?.getTime() ?? 0;
    const tb = parseTradeDate(b.executedAt || b.date)?.getTime() ?? 0;
    if (ta !== tb) return ta - tb;
    return (a.id || 0) - (b.id || 0);
  });

  const lotsByKey = new Map();
  const realized = [];
  let totalHoldQty = 0;
  let totalHoldQtyDays = 0;
  let totalVolume = 0;

  for (const trade of sorted) {
    // Normalize direction from type OR side (unified mapper yields lowercase
    // "buy"/"sell"/"trade"/"fill", so accept any casing + B/S/LONG/SHORT).
    const rawType = String(trade.type || "").toUpperCase();
    const rawSide = String(trade.side || "").toUpperCase();
    let direction;
    if (["BUY", "B", "LONG"].includes(rawType)) direction = "BUY";
    else if (["SELL", "S", "SHORT"].includes(rawType)) direction = "SELL";
    else if (["SELL", "S", "SHORT"].includes(rawSide)) direction = "SELL";
    else if (["BUY", "B", "LONG"].includes(rawSide)) direction = "BUY";
    if (!direction) continue;

    const asset = normalizeSymbol(trade.asset || trade.symbol);
    const lotKey = buildLotKey(asset, trade);
    const qty = Math.max(0, safeNum(trade.quantity));
    const price = safeNum(trade.price);
    const dateObj = parseTradeDate(trade.executedAt || trade.date);
    if (qty <= 0) continue;

    const notionalRaw = safeNum(trade.notional);
    const notional = Math.abs(notionalRaw > 0 ? notionalRaw : price * qty);
    totalVolume += notional;

    const conn = registry.resolve(trade) || null;
    const connectionId = conn ? conn.id : String(trade.platform || trade.provider || "unknown");
    const connectionLabel = conn ? conn.label : String(trade.platform || trade.provider || "unknown");
    const assetClass = detectAssetClass(asset, trade.marketType, {
      hasLegs: !!trade.legs && typeof trade.legs === "object",
      connectionType: conn?.type,
      isBrokerage: conn?.type === "broker",
      isCrypto: conn?.provider === "hyperliquid" || conn?.provider === "lighter" || conn?.type === "dex" || conn?.type === "cex",
    });

    const lots = lotsByKey.get(lotKey) || [];

    if (direction === "BUY") {
      let remaining = qty;
      while (remaining > 0 && lots.length > 0 && lots[0].direction === "short") {
        const lot = lots[0];
        const matchedQty = Math.min(remaining, lot.qty);
        const pnl = (lot.price - price) * matchedQty;
        const holdDays = lot.date && dateObj ? Math.max(0, (dateObj.getTime() - lot.date.getTime()) / DAY_MS) : 0;
        realized.push(mkTrade({ asset, side: "Short", direction: "short", lot, price, dateObj, matchedQty, pnl, trade, connectionId, connectionLabel, assetClass }));
        totalHoldQty += matchedQty;
        totalHoldQtyDays += holdDays * matchedQty;
        lot.qty -= matchedQty;
        remaining -= matchedQty;
        if (lot.qty <= 0) lots.shift();
      }
      if (remaining > 0) lots.push({ direction: "long", qty: remaining, price, date: dateObj });
      lotsByKey.set(lotKey, lots);
    } else {
      let remaining = qty;
      while (remaining > 0 && lots.length > 0 && lots[0].direction === "long") {
        const lot = lots[0];
        const matchedQty = Math.min(remaining, lot.qty);
        const pnl = (price - lot.price) * matchedQty;
        const holdDays = lot.date && dateObj ? Math.max(0, (dateObj.getTime() - lot.date.getTime()) / DAY_MS) : 0;
        realized.push(mkTrade({ asset, side: "Long", direction: "long", lot, price, dateObj, matchedQty, pnl, trade, connectionId, connectionLabel, assetClass }));
        totalHoldQty += matchedQty;
        totalHoldQtyDays += holdDays * matchedQty;
        lot.qty -= matchedQty;
        remaining -= matchedQty;
        if (lot.qty <= 0) lots.shift();
      }
      if (remaining > 0) lots.push({ direction: "short", qty: remaining, price, date: dateObj });
      lotsByKey.set(lotKey, lots);
    }
  }

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

  // Per-symbol + per-symbol×connection rollup.
  const bySymbol = new Map();
  const bySymbolConn = new Map();
  for (const r of realized) {
    const symKey = r.symbol;
    let row = bySymbol.get(symKey) || {
      symbol: symKey, asset: symKey, assetClass: r.assetClass,
      trades: 0, wins: 0, losses: 0, breakevens: 0, volume: 0, pnl: 0,
    };
    row.trades += 1;
    row.volume += r.volume;
    row.pnl += r.pnl;
    if (r.pnl > EPS) row.wins += 1;
    else if (r.pnl < -EPS) row.losses += 1;
    else row.breakevens += 1;
    if (!row.assetClass || row.assetClass === "SPOT") row.assetClass = r.assetClass;
    bySymbol.set(symKey, row);

    const scKey = `${symKey}::${r.connectionId}`;
    let sc = bySymbolConn.get(scKey) || {
      connectionId: r.connectionId, connectionLabel: r.connectionLabel, symbol: symKey,
      trades: 0, wins: 0, losses: 0, breakevens: 0, volume: 0, pnl: 0,
    };
    sc.trades += 1;
    sc.volume += r.volume;
    sc.pnl += r.pnl;
    if (r.pnl > EPS) sc.wins += 1;
    else if (r.pnl < -EPS) sc.losses += 1;
    else sc.breakevens += 1;
    bySymbolConn.set(scKey, sc);
  }

  const assetReport = [...bySymbol.values()].map((row) => {
    const decisiveSym = row.wins + row.losses;
    const winRateSym = decisiveSym ? (row.wins / decisiveSym) * 100 : 0;
    const byConnection = [...bySymbolConn.values()]
      .filter((sc) => sc.symbol === row.symbol)
      .map((sc) => {
        const d = sc.wins + sc.losses;
        return {
          connectionId: sc.connectionId,
          connectionLabel: sc.connectionLabel,
          trades: sc.trades,
          wins: sc.wins,
          losses: sc.losses,
          winRate: d ? (sc.wins / d) * 100 : 0,
          volume: sc.volume,
          pnl: sc.pnl,
        };
      });
    return { ...row, winRate: winRateSym, netPosition: row.volume, byConnection };
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

function mkTrade({ asset, side, direction, lot, price, dateObj, matchedQty, pnl, trade, connectionId, connectionLabel, assetClass }) {
  return {
    asset,
    symbol: asset,
    assetClass,
    connectionId,
    connectionLabel,
    side,
    direction,
    entryPrice: lot.price,
    exitPrice: price,
    entryAt: lot.date ? lot.date.getTime() : null,
    exitAt: dateObj ? dateObj.getTime() : null,
    holdMs: lot.date && dateObj ? Math.max(0, dateObj.getTime() - lot.date.getTime()) : 0,
    holdDays: lot.date && dateObj ? Math.max(0, (dateObj.getTime() - lot.date.getTime()) / DAY_MS) : 0,
    qty: matchedQty,
    volume: price * matchedQty,
    pnl,
    closeDate: formatCloseDate(trade, dateObj),
    platform: trade.platform || trade.provider || "unknown",
    provider: trade.provider || trade.platform || "unknown",
    sourceAccountId: trade.sourceAccountId || "",
    marketType: normalizeMarketType(trade),
  };
}

export default analyzeTradePerformance;
