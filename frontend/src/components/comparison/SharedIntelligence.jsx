import { MetricStrip } from "../CompactWorkspaceUI";
import { fmtNum } from "./comparisonUtils";

// Shared Intelligence — cross-asset relationship view.
// Real correlation/diversification needs the portfolio/correlation service
// (not available in this environment), so we surface what IS derivable from
// reference data (sector overlap, beta proximity, market-cap ratio) and label
// the rest as unavailable — no fabricated correlation coefficients.
export function SharedIntelligence({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;

  const sameSector = assetA.sector && assetB.sector && assetA.sector === assetB.sector;
  const sameCountry = assetA.country && assetB.country && assetA.country === assetB.country;
  const betaProximity = (assetA.beta != null && assetB.beta != null)
    ? Math.abs(assetA.beta - assetB.beta).toFixed(2)
    : "—";
  const capRatio = (assetA.marketCap && assetB.marketCap)
    ? (Math.max(assetA.marketCap, assetB.marketCap) / Math.min(assetA.marketCap, assetB.marketCap))
    : null;

  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Shared Intelligence</h2>
      <MetricStrip items={[
        { label: "Same Sector", value: sameSector ? "Yes" : "No", tone: sameSector ? "positive" : "neutral" },
        { label: "Same Country", value: sameCountry ? "Yes" : "No", tone: sameCountry ? "positive" : "neutral" },
        { label: "Beta Gap", value: betaProximity, tone: "neutral" },
        { label: "Size Ratio (A:B)", value: capRatio != null ? `${capRatio.toFixed(1)}x` : "—", tone: "neutral" },
      ]} />
      <div className="cmp-section-note">
        Correlation, shared ETF ownership, and factor-overlap require the portfolio/correlation
        service, which is not available in this environment. Sector/beta/size proximity above is
        derived from reference data only.
      </div>
    </div>
  );
}
