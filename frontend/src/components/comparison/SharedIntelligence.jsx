import { MetricStrip, GuidedEmptyState } from "../CompactWorkspaceUI";

// Shared Intelligence — cross-asset relationship view.
// Real correlation / shared-ETF / earnings-calendar needs the portfolio or
// market services (not available in this environment), so we surface what IS
// derivable from reference data (sector/country/beta/size proximity) and label
// the rest as unavailable — no fabricated coefficients.
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

      <div className="cmp-shared-grid">
        <GuidedEmptyState
          eyebrow="Shared ETFs"
          title="No shared-ETF overlap"
          description="Requires the portfolio/holdings service, which is not available in this environment."
        />
        <GuidedEmptyState
          eyebrow="Shared News"
          title="No shared headlines"
          description="Cross-asset news clustering needs the news service feed."
        />
        <GuidedEmptyState
          eyebrow="Correlation"
          title="No correlation estimate"
          description="Pair correlation requires the correlation service."
        />
        <GuidedEmptyState
          eyebrow="Earnings Calendar"
          title="No shared earnings dates"
          description="Earnings-calendar overlap needs the earnings service."
        />
      </div>

      <div className="cmp-section-note">
        Sector / beta / size proximity above is derived from reference data only. Shared ETFs,
        correlation, shared news, and earnings-calendar overlap require backend services not
        available in this environment — they are surfaced honestly, not fabricated.
      </div>
    </div>
  );
}
