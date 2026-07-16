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

// Derive a lightweight kind from the asset shape (mirrors AssetModal.normalizeAssetKind).
const kindOf = (asset) => {
  const rawType = String(asset?.type || "").trim().toLowerCase();
  const rawCategory = String(asset?.category || "").trim().toLowerCase();
  const marketType = String(asset?.marketType || "").trim().toLowerCase();
  if (["stock", "stocks", "equity"].includes(rawType) || marketType === "equity") return "stock";
  if (["etf", "etfs"].includes(rawType)) return "etf";
  if (rawType === "forex" || rawType === "fx" || marketType === "forex" || rawCategory === "fx") return "forex";
  if (rawType === "currency" || rawCategory === "currencies" || marketType === "macro") return "currency";
  if (rawType === "crypto" || marketType === "spot" || marketType === "perp") return "crypto";
  if (["commodity", "commodities", "metal", "metals"].includes(rawType)) return "commodity";
  return rawType || "stock";
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
  const kind = kindOf(asset);
  const sym = String(asset?.symbol || "").toUpperCase();

  const holding = useMemo(() => {
    const mt = asset?.marketType || (kind === "etf" ? "etf" : "spot");
    return (portfolio || []).find(
      (p) => String(p.symbol || "").toUpperCase() === sym && (p.marketType || (kind === "etf" ? "etf" : "spot")) === mt
    ) || null;
  }, [asset, portfolio, sym, kind]);

  const quantity = holding?.quantity || 0;
  const hasHolding = quantity > 0;
  const marketValue = displayedPrice * quantity;
  const avgCost = averageEntryPrice ?? holding?.avgCost ?? holding?.averageCost ?? null;
  const costBasis = hasHolding && Number.isFinite(avgCost) ? avgCost * quantity : null;
  const totalReturnValue = costBasis != null ? marketValue - costBasis : null;
  const totalReturnPct = costBasis && costBasis > 0 ? (totalReturnValue / costBasis) * 100 : null;
  const todayReturnValue = hasHolding ? (marketValue * (Number(asset?.priceChangePercent) || 0)) / (100 + (Number(asset?.priceChangePercent) || 0)) : null;

  const totalPortfolioValue = useMemo(() => {
    if (!Array.isArray(portfolio) || portfolio.length === 0) return 0;
    return portfolio.reduce((sum, p) => {
      const q = Number(p.quantity || 0);
      const px = Number(p.price ?? p.currentPrice ?? 0);
      return sum + (q * px || 0);
    }, 0);
  }, [portfolio]);
  const allocationPct = totalPortfolioValue > 0 ? (marketValue / totalPortfolioValue) * 100 : null;
  const isWatched = Boolean(isInWatchlist?.(asset, undefined, { strictStockMeta: true }));
  const researchStatus = holding?.researchLinked || asset?.researchLinked ? "Linked" : "None";

  // ── Position group is universal; Exposure group is kind-specific ──
  const positionGroup = {
    title: "Position",
    rows: [
      { label: "Holding Status", value: hasHolding ? `${quantity} ${sym}` : "Not held", mono: true },
      { label: "Quantity", value: quantity > 0 ? quantity : "—", mono: true },
      { label: "Average Cost", value: avgCost != null ? fmtMoney(avgCost, currencySymbol) : "—", mono: true },
      { label: "Market Value", value: hasHolding ? fmtMoney(marketValue, currencySymbol) : "—", mono: true },
      { label: "Allocation", value: allocationPct != null ? `${allocationPct.toFixed(2)}%` : (hasHolding ? "—" : "Not held"), mono: true, emphasize: true },
    ],
  };

  const returnsGroup = {
    title: "Returns",
    rows: [
      { label: "Total Return", value: hasHolding && totalReturnValue != null ? `${fmtMoney(totalReturnValue, currencySymbol)} (${fmtPct(totalReturnPct)})` : "—", mono: true, tone: hasHolding && totalReturnValue != null ? (totalReturnValue >= 0 ? "pos" : "neg") : null, emphasize: true },
      { label: "Today's Return", value: hasHolding && todayReturnValue != null ? fmtMoney(todayReturnValue, currencySymbol) : "—", mono: true, tone: hasHolding && todayReturnValue != null ? (todayReturnValue >= 0 ? "pos" : "neg") : null, emphasize: true },
    ],
  };

  let exposureGroup;
  if (kind === "forex") {
    const [b, q] = sym.includes("/") ? sym.split("/") : [asset?.baseCurrency || "—", asset?.quoteCurrency || "—"];
    exposureGroup = {
      title: "FX Exposure",
      rows: [
        { label: "Base Currency", value: b, mono: true },
        { label: "Quote Currency", value: q, mono: true },
        { label: "Cash-Balance Exposure", value: activeCurrency || "—", mono: true },
        { label: "Watchlist Status", value: isWatched ? "Watching" : "Not watching", mono: false },
        { label: "Research Status", value: researchStatus, mono: false },
      ],
    };
  } else if (kind === "currency") {
    exposureGroup = {
      title: "Cash & Conversion Exposure",
      rows: [
        { label: "Cash Balance", value: activeCurrency === sym ? (activeCurrency || "—") : "—", mono: true },
        { label: "Share of Cash", value: "—", mono: true },
        { label: "Exposed Assets", value: "See Research Workspace", mono: false },
        { label: "Watchlist Status", value: isWatched ? "Watching" : "Not watching", mono: false },
        { label: "Research Status", value: researchStatus, mono: false },
      ],
    };
  } else if (kind === "etf") {
    exposureGroup = {
      title: "ETF Exposure",
      rows: [
        { label: "Issuer", value: asset?.issuer || "—", mono: false },
        { label: "Benchmark", value: asset?.benchmark || "—", mono: false },
        { label: "Category", value: asset?.category || "—", mono: false },
        { label: "Primary Exposure", value: Array.isArray(asset?.exposure) && asset.exposure.length ? asset.exposure.join(", ") : "—", mono: false },
        { label: "Portfolio Overlap", value: asset?.issuer ? "See Research Workspace" : "No comparable exposure", mono: false },
        { label: "Watchlist Status", value: isWatched ? "Watching" : "Not watching", mono: false },
        { label: "Research Status", value: researchStatus, mono: false },
      ],
    };
  } else {
    // stock / crypto / commodity / indicator — original behavior
    const sector = holding?.sector || asset?.sector || "—";
    exposureGroup = {
      title: "Exposure",
      rows: [
        { label: "Sector Exposure", value: sector, mono: false },
        { label: "Currency Exposure", value: activeCurrency || "—", mono: true },
        { label: "Watchlist Status", value: isWatched ? "Watching" : "Not watching", mono: false },
        { label: "Research Status", value: researchStatus, mono: false },
      ],
    };
  }

  const groups = [positionGroup, returnsGroup, exposureGroup];

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
