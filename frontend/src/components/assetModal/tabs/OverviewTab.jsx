import { getCommodityRelations } from "../../../utils/assetGraph.js";

export function OverviewTab({
  earnings,
  earningsLoading,
  finvizData,
  asset,
  assetSymbol,
  isStockResearchEligible,
  assetKind,
  onViewCompanyProfile,
  formatCompactMoney,
  formatMultiple,
  formatRatioPercent
}) {
  const isCommodity = assetKind === "commodity";
  const isEtf = assetKind === "etf";
  const profile = earnings?.profile || {};
  const summary = asset?.summary || asset?.description ||
    (isCommodity ? "Commodity research surface. Open the Research Workspace for thesis, inventory, curve, and transmission."
      : isEtf ? "No ETF mandate summary is available yet."
      : "No company summary available.");
  const valuation = earnings?.valuation || {};

  // Phase 3 — commodity-first: surface contract metadata instead of equity stats.
  const commodityMeta = isCommodity ? getCommodityRelations(assetSymbol) : {};
  const commodityStats = [
    { label: "Category", value: commodityMeta?.category || "—", mono: false },
    { label: "Exchange", value: commodityMeta?.exchange || "—", mono: true },
    { label: "Unit", value: commodityMeta?.unit || "—", mono: true },
    { label: "Settlement", value: commodityMeta?.settlement || "—", mono: false },
    { label: "Top Companies", value: (commodityMeta?.companies || []).join(", ") || "—", mono: false },
    { label: "ETFs", value: (commodityMeta?.etfs || []).join(", ") || "—", mono: false },
    { label: "Countries", value: (commodityMeta?.countries || []).join(", ") || "—", mono: false },
    { label: "Indexes", value: (commodityMeta?.indexes || []).join(", ") || "—", mono: false },
  ];

  // Spec §3 (ETF plan): ETFs use fund-reference fields, never equity metrics.
  const etfMeta = isEtf ? {
    issuer: asset?.issuer || "—",
    benchmark: asset?.benchmark || "—",
    category: asset?.category || "—",
    assetClass: /bond|fixed income|treasury|agg/i.test(asset?.category || "") ? "Fixed Income" : /commodity/i.test(asset?.category || "") ? "Commodity" : "Equity",
    primaryExposure: Array.isArray(asset?.exposure) && asset.exposure.length ? asset.exposure.join(", ") : "—",
    expenseRatio: "—",
    distributionPolicy: "—",
    topHolding: "—",
  } : null;

  const stats = isCommodity ? commodityStats : isEtf ? [
    { label: "Issuer", value: etfMeta.issuer, mono: false },
    { label: "Benchmark", value: etfMeta.benchmark, mono: false },
    { label: "Category", value: etfMeta.category, mono: false },
    { label: "Asset Class", value: etfMeta.assetClass, mono: false },
    { label: "Primary Exposure", value: etfMeta.primaryExposure, mono: false },
    { label: "Expense Ratio", value: etfMeta.expenseRatio, mono: true },
    { label: "Distribution Policy", value: etfMeta.distributionPolicy, mono: false },
    { label: "Top Holding", value: etfMeta.topHolding, mono: false },
  ] : [
    { label: "Market Cap", value: finvizData?.summary?.["Market Cap"] || (earnings?.marketCap != null ? formatCompactMoney(earnings.marketCap) : "—"), mono: true },
    { label: "Sector", value: asset?.sector || profile?.sector || "—", mono: false },
    { label: "Industry", value: asset?.industry || profile?.industry || "—", mono: false },
    { label: "Country", value: asset?.country || "—", mono: false },
    { label: "Dividend Yield", value: formatRatioPercent(profile?.dividendYield), mono: true },
    { label: "52W Range", value: Number.isFinite(Number(profile?.fiftyTwoWeekLow)) && Number.isFinite(Number(profile?.fiftyTwoWeekHigh)) ? `$${Number(profile.fiftyTwoWeekLow).toFixed(2)} - $${Number(profile.fiftyTwoWeekHigh).toFixed(2)}` : "—", mono: true },
    { label: "Trailing P/E", value: formatMultiple(valuation?.trailingPe), mono: true },
    { label: "Forward P/E", value: formatMultiple(valuation?.forwardPe), mono: true },
    { label: "Analyst Target", value: finvizData?.summary?.["Target Price"] || (earnings?.targetPrice != null ? `$${Number(earnings.targetPrice).toFixed(2)}` : "—"), mono: true }
  ];

  return (
    <div className="am-tab-content">
      <div className="am-summary">
        <p>{summary}</p>
        {isStockResearchEligible && !isEtf && (
          <button className="am-link-btn" onClick={() => onViewCompanyProfile?.(asset)}>
            Open Company Profile →
          </button>
        )}
        {isEtf && (
          <button className="am-link-btn" onClick={() => onViewCompanyProfile?.(asset)}>
            Open ETF Profile →
          </button>
        )}
      </div>
      <div className="am-stat-grid">
        {stats.map((s) => (
          <div className="am-stat" key={s.label}>
            <span className="am-stat-label">{s.label}</span>
            <strong className={`am-stat-value ${s.mono ? "font-mono" : ""} ${s.value === "—" ? "am-na" : ""}`}>{s.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
