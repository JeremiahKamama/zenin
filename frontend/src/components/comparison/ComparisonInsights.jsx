// Right rail: highlights and decision shortcuts. Surfaces the Overview verdict
// and quick actions that feed into Decisions / Journal / Briefing.
export function ComparisonInsights({ assetA, assetB, verdict, onDecision }) {
  return (
    <aside className="cmp-insights" aria-label="Comparison insights">
      <div className="cmp-insights-title">Insights</div>
      {verdict ? (
        <div className="cmp-insights-verdict">
          <div className="cmp-insights-winner">Winner · <strong>{verdict.winner}</strong></div>
          <div className="cmp-insights-confidence">Confidence {verdict.confidence}%</div>
          <ul className="cmp-insights-reasons">
            {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      ) : (
        <div className="cmp-insights-empty">Open the Overview tab to see who wins and why.</div>
      )}
      <div className="cmp-insights-actions">
        <button className="cmp-insights-btn" onClick={() => onDecision("Save Decision")}>Save Decision</button>
        <button className="cmp-insights-btn" onClick={() => onDecision("Add to Watchlist")}>Add to Watchlist</button>
        <button className="cmp-insights-btn" onClick={() => onDecision("Generate Briefing")}>Generate Briefing</button>
        <button className="cmp-insights-btn" onClick={() => onDecision("Journal Note")}>Journal Note</button>
      </div>
    </aside>
  );
}
