import { ComparisonMatrix, ResultBanner, DecisionMatrixEmpty } from "../CompactWorkspaceUI";
import { fmtPct } from "./comparisonUtils";

// Decision Matrix section — the Compare Workspace centerpiece.
// Renders a ResultBanner above the shared ComparisonMatrix. When there is no
// verdict / no scored rows (e.g. backend unavailable), it shows an
// insufficient-data banner + a structured empty-matrix preview instead of a
// dead "Winner Tie 0%".
export function ComparisonDecisionSection({ assetA, assetB, matrixRows, verdict }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;

  const hasMatrix = Array.isArray(matrixRows) && matrixRows.length > 0;
  const insufficient = !verdict || !hasMatrix || verdict.confidence === 0;

  return (
    <div className="cmp-section cmp-decision-section">
      <div className="cmp-decision-head">
        <h2 className="cmp-section-title">Decision Matrix — who wins, why</h2>
      </div>

      {insufficient ? (
        <>
          <ResultBanner
            state="insufficient-data"
            cta="Open Overview"
            secondaryCta="Add to Watchlist"
          />
          <DecisionMatrixEmpty />
        </>
      ) : (
        <>
          <ResultBanner
            state="winner"
            winner={verdict.winner === "tie" ? "Tie" : verdict.winner}
            confidence={verdict.confidence}
            breakdown={verdict.reasons?.[0]}
            cta="Save Decision"
            secondaryCta="Generate Briefing"
          />
          <ComparisonMatrix
            assetA={assetA.symbol}
            assetB={assetB.symbol}
            rows={matrixRows}
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
        </>
      )}
    </div>
  );
}
