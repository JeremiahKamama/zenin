import { ComparisonMatrix } from "../CompactWorkspaceUI";
import { fmtPct } from "./comparisonUtils";

// Decision Matrix section — the Compare Workspace centerpiece.
// Renders the shared ComparisonMatrix primitive: Asset A | Winner | Asset B
// with derived winners, evidence, confidence, weight, and explanations.
export function ComparisonDecisionSection({ assetA, assetB, matrixRows, verdict }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  return (
    <div className="cmp-section cmp-decision-section">
      <div className="cmp-decision-head">
        <h2 className="cmp-section-title">Decision Matrix — who wins, why</h2>
        {verdict ? (
          <div className="cmp-decision-verdict" role="status">
            <span className="cmp-decision-winner">
              Winner <strong>{verdict.winner === "tie" ? "Tie" : verdict.winner}</strong>
            </span>
            <span className="cmp-decision-confidence">Confidence {verdict.confidence}%</span>
          </div>
        ) : (
          <div className="cmp-decision-verdict cmp-decision-verdict--muted">Building matrix…</div>
        )}
      </div>
      <ComparisonMatrix
        assetA={assetA.symbol}
        assetB={assetB.symbol}
        rows={matrixRows || []}
        showEvidence
      />
      {verdict?.reasons?.length ? (
        <div className="cmp-decision-reasons">
          <h3>Why</h3>
          <ul>
            {verdict.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
