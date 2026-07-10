import { ConfidenceBadge } from "../CompactWorkspaceUI";

// Right rail: sticky, grouped (Decision / Context / Tools). Surfaces the
// verdict with a confidence meter when present; otherwise a contextual prompt
// to run the decision matrix — never a dead empty panel.
export function ComparisonInsights({ assetA, assetB, verdict, onDecision }) {
  return (
    <aside className="cmp-insights" aria-label="Comparison insights">
      <div className="cmp-insights-group">
        <div className="cmp-insights-title">Decision</div>
        {verdict ? (
          <div className="cmp-insights-verdict">
            <div className="cmp-insights-winner">Winner · <strong>{verdict.winner}</strong></div>
            <ConfidenceBadge value={verdict.confidence} />
          </div>
        ) : (
          <div className="cmp-insights-empty">
            No decision yet. Open the Decision Matrix to score both assets.
          </div>
        )}
      </div>

      <div className="cmp-insights-group">
        <div className="cmp-insights-title">Context</div>
        {verdict?.reasons?.length ? (
          <ul className="cmp-insights-reasons">
            {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        ) : (
          <div className="cmp-insights-empty">Run the decision matrix to surface key reasons.</div>
        )}
      </div>

      <div className="cmp-insights-group">
        <div className="cmp-insights-title">Tools</div>
        <div className="cmp-insights-actions">
          <button className="cmp-insights-btn" onClick={() => onDecision("Save Decision")}>Save Decision</button>
          <button className="cmp-insights-btn" onClick={() => onDecision("Add to Watchlist")}>Add to Watchlist</button>
          <button className="cmp-insights-btn" onClick={() => onDecision("Generate Briefing")}>Generate Briefing</button>
          <button className="cmp-insights-btn" onClick={() => onDecision("Journal Note")}>Journal Note</button>
        </div>
      </div>
    </aside>
  );
}
