/**
 * Shared account metric calculators for Zenin.
 * 
 * NOTE: This module is decoupled from currencyUtils to prevent 
 * Temporal Dead Zone (TDZ) initialization cycles. 
 * Pass conversion functions as arguments where needed.
 */

export const INITIAL_ACCOUNT_BALANCE = 10000;

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Calculates the total market value of a portfolio.
 * @param {Array} portfolio 
 * @param {Object} fxRates 
 * @param {Function} converter - The convertToUSD function from currencyUtils.
 */
export function calculatePortfolioMarketValue(portfolio = [], fxRates = {}, converter) {
  return (Array.isArray(portfolio) ? portfolio : []).reduce((total, item) => {
    const price = toFiniteNumber(item?.price, 0);
    const quantity = toFiniteNumber(item?.quantity, 0);
    const currency = item?.currency || item?.quotedCurrency || "USD";
    
    // If no converter is provided, assume USD (identity)
    const valueInUSD = typeof converter === "function" 
      ? converter(price * quantity, currency, fxRates)
      : (price * quantity);
      
    return total + valueInUSD;
  }, 0);
}

export function buildTradeTimeline(trades = []) {
  return (Array.isArray(trades) ? trades : [])
    .map((trade, idx) => {
      const timestamp = new Date(trade?.executedAt || trade?.date || 0).getTime();
      if (!Number.isFinite(timestamp)) return null;

      const accountEquityAfter = toFiniteNumber(trade?.accountEquityAfter ?? trade?.account_equity_after);
      const balanceAfter = toFiniteNumber(trade?.balanceAfter ?? trade?.balance_after);
      const portfolioValueAfter = toFiniteNumber(trade?.portfolioValueAfter ?? trade?.portfolio_value_after);
      const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
      const notional = toFiniteNumber(trade?.notional);
      const fallbackNotional = toFiniteNumber(trade?.price, 0) * Math.abs(toFiniteNumber(trade?.quantity, 0));

      return {
        id: trade?.id ?? `trade-${idx}`,
        t: timestamp,
        side,
        notional: Number.isFinite(notional) ? Math.abs(notional) : Math.abs(fallbackNotional),
        equity: Number.isFinite(accountEquityAfter)
          ? accountEquityAfter
          : Number.isFinite(balanceAfter) && Number.isFinite(portfolioValueAfter)
            ? balanceAfter + portfolioValueAfter
            : null,
        balanceAfter: Number.isFinite(balanceAfter) ? balanceAfter : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

export function inferCashBalanceFromTradeTimeline(tradeTimeline = [], initialBalance = INITIAL_ACCOUNT_BALANCE) {
  const timeline = Array.isArray(tradeTimeline) ? tradeTimeline : [];
  const latestWithBalance = [...timeline].reverse().find((trade) => Number.isFinite(trade?.balanceAfter));
  if (latestWithBalance) return latestWithBalance.balanceAfter;

  return timeline.reduce((cash, trade) => {
    if (!Number.isFinite(trade?.notional)) return cash;
    return trade.side === "sell" ? cash + trade.notional : cash - trade.notional;
  }, initialBalance);
}

export function calculateAccountSnapshot({
  trades = [],
  portfolioValue = 0,
  optionsUnrealizedPnL = 0,
  balance = null,
  initialBalance = INITIAL_ACCOUNT_BALANCE
} = {}) {
  const tradeTimeline = buildTradeTimeline(trades);
  const inferredCashBalance = inferCashBalanceFromTradeTimeline(tradeTimeline, initialBalance);
  const normalizedBalance = toFiniteNumber(balance);
  const liveAvailableBalance = Number.isFinite(normalizedBalance) ? normalizedBalance : inferredCashBalance;
  const normalizedPortfolioValue = toFiniteNumber(portfolioValue, 0);
  const normalizedOptionsPnL = toFiniteNumber(optionsUnrealizedPnL, 0);

  return {
    initialBalance,
    tradeTimeline,
    inferredCashBalance,
    liveAvailableBalance,
    optionsUnrealizedPnL: normalizedOptionsPnL,
    totalAccountEquity: liveAvailableBalance + normalizedPortfolioValue + normalizedOptionsPnL
  };
}
