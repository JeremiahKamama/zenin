/**
 * Unified Options PnL Calculation Utility
 */

export function calculateOptionPnL(trade, tradeChain, tradeSpot) {
  const isAssetStale = !tradeChain || tradeChain.length === 0 || !tradeSpot;
  
  // Default to stored entry values if live data isn't currently loaded for this asset
  const result = {
    currentMark: isAssetStale ? (trade.netPremiumAtEntry || 0) : 0,
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
      const row = tradeChain.find(r => Math.abs(r.strike - leg.strike) < 0.01);
      if (row) {
        const instr = leg.type === 'call' ? row.call : row.put;
        if (instr) {
          const mark = (Number(instr.bid || 0) + Number(instr.ask || 0)) / 2 || Number(instr.mark) || 0;
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
  result.pnl = (totalMark - (trade.netPremiumAtEntry || 0)) * (trade.qty || 1);
  result.isStale = false;
  
  return result;
}
