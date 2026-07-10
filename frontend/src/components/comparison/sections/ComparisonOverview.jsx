import { ComparisonMetricTable } from "../ComparisonMetricTable";
import { fmtNum, fmtPct, fmtMultiple, metricWinner, metricDiff } from "../comparisonUtils";

// Overview: answers "who wins, why, confidence" from available fundamentals.
export function ComparisonOverview({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;

  const gA = assetA.earnings?.growth?.revenueGrowth ?? assetA.finviz?.revenueGrowth ?? null;
  const gB = assetB.earnings?.growth?.revenueGrowth ?? assetB.finviz?.revenueGrowth ?? null;
  const mAA = assetA.earnings?.profitability?.operatingMargin ?? assetA.finviz?.operatingMargin ?? null;
  const mAB = assetB.earnings?.profitability?.operatingMargin ?? assetB.finviz?.operatingMargin ?? null;
  const peA = assetA.earnings?.valuation?.trailingPe ?? assetA.finviz?.pe ?? null;
  const peB = assetB.earnings?.valuation?.trailingPe ?? assetB.finviz?.pe ?? null;

  const rows = [
    { label: "Revenue Growth", a: gA, b: gB, format: "pct", winner: metricWinner(gA, gB), diffKind: "pct" },
    { label: "Operating Margin", a: mAA, b: mAB, format: "pct", winner: metricWinner(mAA, mAB) },
    { label: "Trailing P/E", a: peA, b: peB, format: "multiple", winner: metricWinner(peA, peB, false) }
  ];

  const reasons = [];
  if (gA != null && gB != null) reasons.push(`${gA >= gB ? assetA.symbol : assetB.symbol} higher growth (${fmtPct(Math.max(gA, gB))})`);
  if (mAA != null && mAB != null) reasons.push(`${mAA >= mAB ? assetA.symbol : assetB.symbol} better margins (${fmtPct(Math.max(mAA, mAB))})`);
  const winner = reasons.length ? (reasons[0].startsWith(assetA.symbol) ? assetA.symbol : assetB.symbol) : "—";
  const confidence = reasons.length ? 65 + reasons.length * 8 : 50;

  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Overview — Who wins?</h2>
      <div className="cmp-overview-verdict">
        <div className="cmp-overview-winner">Winner <strong>{winner}</strong></div>
        <div className="cmp-overview-confidence">Confidence {confidence}%</div>
      </div>
      {reasons.length ? (
        <ul className="cmp-overview-reasons">
          {reasons.map((r, i) => <li key={i}>✓ {r}</li>)}
        </ul>
      ) : (
        <div className="cmp-section-empty">No fundamental data available for this pair in this environment.</div>
      )}
      <ComparisonMetricTable rows={rows} caption="Headline fundamentals" />
    </div>
  );
}
