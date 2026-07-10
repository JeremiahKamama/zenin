import { useMemo } from "react";

const fmtMoney = (value, currencySymbol = "$") => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${currencySymbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtPct = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
};

export function PortfolioContext({
  asset,
  portfolio = [],
  displayedPrice,
  activeCurrency,
  currencySymbol = "$",
  averageEntryPrice,
  spotPrices = {},
  isInWatchlist,
  onToggleStar
}) {
  const holding = useMemo(() => {
    const sym = String(asset?.symbol || "").toUpperCase();
    const mt = asset?.marketType || "spot";
    return (portfolio || []).find(
      (p) => String(p.symbol || "").toUpperCase() === sym && (p.marketType || "spot") === mt
    ) || null;
  }, [asset, portfolio]);

  const quantity = holding?.quantity || 0;
  const hasHolding = quantity > 0;

  const marketValue = displayedPrice * quantity;
  const avgCost = averageEntryPrice ?? holding?.avgCost ?? holding?.averageCost ?? null;
  const costBasis = hasHolding && Number.isFinite(avgCost) ? avgCost * quantity : null;
  const totalReturnValue = costBasis != null ? marketValue - costBasis : null;
  const totalReturnPct = costBasis && costBasis > 0 ? (totalReturnValue / costBasis) * 100 : null;

  // Today's return estimate from change percent
  const todayReturnValue = hasHolding ? (marketValue * (Number(asset?.priceChangePercent) || 0)) / (100 + (Number(asset?.priceChangePercent) || 0)) : null;

  // Allocation = this position vs total portfolio market value
  const totalPortfolioValue = useMemo(() => {
    if (!Array.isArray(portfolio) || portfolio.length === 0) return 0;
    return portfolio.reduce((sum, p) => {
      const q = Number(p.quantity || 0);
      const px = Number(p.price ?? p.currentPrice ?? 0);
      return sum + (q * px || 0);
    }, 0);
  }, [portfolio]);
  const allocationPct = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : null;

  const sector = holding?.sector || asset?.sector || "—";
  const country = asset?.country || holding?.country || "—";
  const currencyExposure = activeCurrency || "—";
  const isWatched = Boolean(isInWatchlist?.(asset, undefined, { strictStockMeta: true }));
  const researchStatus = holding?.researchLinked || asset?.researchLinked ? "Linked" : "None";

  const groups = [
    {
      title: "Position",
      rows: [
        { label: "Holding Status", value: hasHolding ? `${quantity} ${asset?.symbol}` : "Not held", mono: true },
        { label: "Quantity", value: quantity > 0 ? quantity : "—", mono: true },
        { label: "Average Cost", value: avgCost != null ? fmtMoney(avgCost, currencySymbol) : "—", mono: true },
        { label: "Market Value", value: fmtMoney(marketValue, currencySymbol), mono: true },
        { label: "Current Value", value: fmtMoney(marketValue, currencySymbol), mono: true }
      ]
    },
    {
      title: "Returns",
      rows: [
        { label: "Total Return", value: totalReturnValue != null ? `${fmtMoney(totalReturnValue, currencySymbol)} (${fmtPct(totalReturnPct)})` : "—", mono: true, tone: totalReturnValue != null ? (totalReturnValue >= 0 ? "pos" : "neg") : null, emphasize: true },
        { label: "Today's Return", value: todayReturnValue != null ? fmtMoney(todayReturnValue, currencySymbol) : "—", mono: true, tone: todayReturnValue != null ? (todayReturnValue >= 0 ? "pos" : "neg") : null, emphasize: true },
        { label: "Allocation", value: allocationPct != null ? `${allocationPct.toFixed(2)}%` : "—", mono: true, emphasize: true }
      ]
    },
    {
      title: "Exposure",
      rows: [
        { label: "Sector Exposure", value: sector, mono: false },
        { label: "Currency Exposure", value: currencyExposure, mono: true },
        { label: "Watchlist Status", value: isWatched ? "Watching" : "Not watching", mono: false },
        { label: "Research Status", value: researchStatus, mono: false }
      ]
    }
  ];

  return (
    <aside className="am-context" aria-label="Portfolio context">
      <div className="am-context-head">Portfolio Context</div>
      {groups.map((group) => (
        <div className="am-context-group" key={group.title}>
          <div className="am-context-group-head">{group.title}</div>
          <dl className="am-context-list">
            {group.rows.map((row) => (
              <div className="am-context-row" key={row.label}>
                <dt className="am-context-label">{row.label}</dt>
                <dd className={`am-context-value ${row.mono ? "font-mono" : ""} ${row.emphasize ? "am-context-emphasis" : ""} ${row.value === "—" ? "am-na" : ""} ${row.tone === "pos" ? "am-pos" : row.tone === "neg" ? "am-neg" : ""}`}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </aside>
  );
}
