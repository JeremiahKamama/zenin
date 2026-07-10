import { ComparisonMetricTable } from "../ComparisonMetricTable";
import { ComparisonChart } from "../ComparisonChart";
import { COMPARISON_WINDOWS, fmtPct, metricWinner } from "../comparisonUtils";

export function ComparisonPerformance({ assetA, assetB, loadingA, loadingB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const ra = assetA.returns || {};
  const rb = assetB.returns || {};
  const rows = COMPARISON_WINDOWS.map((w) => ({
    label: w.label,
    a: ra[w.key],
    b: rb[w.key],
    format: "pct",
    winner: metricWinner(ra[w.key], rb[w.key])
  }));
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Performance</h2>
      <ComparisonChart assetA={assetA} assetB={assetB} loading={loadingA || loadingB} />
      <ComparisonMetricTable rows={rows} caption="Trailing returns by window" />
    </div>
  );
}
