export function NewsTab({ assetSymbol }) {
  // No live news feed is wired into the Asset Modal data layer.
  // Render a structured empty state (no fabricated headlines).
  const sections = [
    "Recent News",
    "Earnings",
    "SEC Filings",
    "Analyst Notes",
    "Macro Events"
  ];
  return (
    <div className="am-tab-content">
      <div className="am-empty-state">
        <p className="am-empty-title">No news synced for {assetSymbol || "this asset"}.</p>
        <p className="am-empty-hint">Recent news, earnings, SEC filings, analyst notes and macro events will appear here once linked to a research feed.</p>
        <ul className="am-empty-list">
          {sections.map((s) => (
            <li key={s} className="am-empty-item">{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
