import { AssetSummaryCard } from "../../CompactWorkspaceUI";
import { fmtNum, fmtPct, fmtMultiple } from "../comparisonUtils";

// Build a 6-cell mini-metric grid for one asset. Missing values render as a
// neutral "—" inside the card (the AssetSummaryCard is the honest placeholder;
// we never fabricate numbers).
function summaryMetrics(asset) {
  if (!asset) return [];
  const g = asset.earnings?.growth?.revenueGrowth ?? asset.finviz?.revenueGrowth ?? null;
  const m = asset.earnings?.profitability?.operatingMargin ?? asset.finviz?.operatingMargin ?? null;
  const pe = asset.earnings?.valuation?.trailingPe ?? asset.finviz?.pe ?? null;
  const mc = asset.marketCap ?? null;
  const beta = asset.beta ?? asset.finviz?.beta ?? null;
  const roe = asset.earnings?.quality?.roe ?? asset.finviz?.roe ?? null;
  return [
    { label: "Revenue Growth", value: g != null ? fmtPct(g) : "—" },
    { label: "Operating Margin", value: m != null ? fmtPct(m) : "—" },
    { label: "Trailing P/E", value: pe != null ? fmtMultiple(pe) : "—" },
    { label: "Market Cap", value: mc != null ? fmtNum(mc, { currency: "USD", maxFrac: 0 }) : "—" },
    { label: "ROE", value: roe != null ? fmtPct(roe) : "—" },
    { label: "Beta", value: beta != null ? Number(beta).toFixed(2) : "—" },
  ];
}

// Overview: two synchronized Asset Summary Cards — the brief's "two
// synchronized summary cards" for the Compare decision workspace.
export function ComparisonOverview({ assetA, assetB, onViewResearch }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  return (
    <div className="cmp-section cmp-overview">
      <h2 className="cmp-section-title">Overview — two synchronized summaries</h2>
      <div className="cmp-overview-cards">
        <AssetSummaryCard
          asset={assetA}
          score={assetA.researchScore}
          metrics={summaryMetrics(assetA)}
          onViewResearch={() => onViewResearch?.(assetA.symbol)}
        />
        <AssetSummaryCard
          asset={assetB}
          score={assetB.researchScore}
          metrics={summaryMetrics(assetB)}
          onViewResearch={() => onViewResearch?.(assetB.symbol)}
        />
      </div>
    </div>
  );
}
