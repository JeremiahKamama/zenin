/**
 * Unified Options PnL Calculation Utility
 */

export function calculateOptionPnL(trade, tradeChain, tradeSpot) {
  const deriveEntryPremium = () => {
    const explicit = Number(trade?.netPremiumAtEntry);
    if (Number.isFinite(explicit)) return explicit;
    const entry = Number(trade?.entryPrice);
    if (Number.isFinite(entry)) return entry;
    const price = Number(trade?.price);
    if (Number.isFinite(price)) return price;
    if (!Array.isArray(trade?.legs)) return 0;
    const fromLegs = trade.legs.reduce((acc, leg) => {
      const legEntry = Number(leg?.entryPrice);
      if (!Number.isFinite(legEntry)) return acc;
      return acc + (String(leg?.side || "").toLowerCase() === "short" ? -legEntry : legEntry);
    }, 0);
    return Number.isFinite(fromLegs) ? fromLegs : 0;
  };

  const resolveLegMark = (instr = {}) => {
    const bid = Number(instr?.bid);
    const ask = Number(instr?.ask);
    const mark = Number(instr?.mark);
    if (Number.isFinite(bid) && Number.isFinite(ask) && (bid > 0 || ask > 0)) {
      return (bid + ask) / 2;
    }
    if (Number.isFinite(mark) && mark > 0) return mark;
    if (Number.isFinite(bid) && bid > 0) return bid;
    if (Number.isFinite(ask) && ask > 0) return ask;
    return 0;
  };

  const findBestRow = (strikeInput) => {
    const strike = Number(strikeInput);
    if (!Number.isFinite(strike) || !Array.isArray(tradeChain) || tradeChain.length === 0) return null;
    const exact = tradeChain.find((r) => Math.abs(Number(r?.strike) - strike) <= 0.1);
    if (exact) return exact;
    let best = null;
    let dist = Infinity;
    tradeChain.forEach((row) => {
      const rowStrike = Number(row?.strike);
      if (!Number.isFinite(rowStrike)) return;
      const d = Math.abs(rowStrike - strike);
      if (d < dist) {
        dist = d;
        best = row;
      }
    });
    return best;
  };

  const isAssetStale = !tradeChain || tradeChain.length === 0 || !tradeSpot;
  const entryPremium = deriveEntryPremium();
  const quantity = Number(trade?.qty ?? trade?.quantity);
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  
  // Default to stored entry values if live data isn't currently loaded for this asset
  const result = {
    currentMark: isAssetStale ? entryPremium : 0,
    pnl: isAssetStale ? 0 : 0,
    delta: isAssetStale ? (trade.initialDelta || 0) : 0,
    theta: isAssetStale ? (trade.initialTheta || 0) : 0,
    isStale: isAssetStale
  };

  if (isAssetStale) return result;

  let totalMark = 0;
  let totalDelta = 0;
  let totalTheta = 0;

  (trade.legs || []).forEach(leg => {
    if (leg.type === 'spot') {
      const spot = tradeSpot || leg.strike || 0;
      totalMark += leg.side === 'long' ? spot : -spot;
      totalDelta += leg.side === 'long' ? 1 : -1;
    } else {
      const row = findBestRow(leg?.strike);
      if (row) {
        const instr = leg.type === 'call' ? row.call : row.put;
        if (instr) {
          const mark = resolveLegMark(instr);
          const delta = Number(instr.delta) || 0;
          const theta = Number(instr.theta) || 0;
          
          if (leg.side === 'long') {
            totalMark += mark;
            totalDelta += delta;
            totalTheta += theta;
          } else {
            totalMark -= mark;
            totalDelta -= delta;
            totalTheta -= theta;
          }
        }
      }
    }
  });

  result.currentMark = totalMark;
  result.delta = totalDelta;
  result.theta = totalTheta;
  result.pnl = (totalMark - entryPremium) * qty;
  result.isStale = false;
  
  return result;
}
