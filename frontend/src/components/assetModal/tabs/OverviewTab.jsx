export function OverviewTab({
  earnings,
  earningsLoading,
  finvizData,
  asset,
  assetSymbol,
  isStockResearchEligible,
  onViewCompanyProfile,
  formatCompactMoney,
  formatMultiple,
  formatRatioPercent
}) {
  const profile = earnings?.profile || {};
  const summary = asset?.summary || asset?.description || "No company summary available.";
  const valuation = earnings?.valuation || {};

  const stats = [
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
        {isStockResearchEligible && (
          <button className="am-link-btn" onClick={() => onViewCompanyProfile?.(asset)}>
            Open Company Profile →
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
