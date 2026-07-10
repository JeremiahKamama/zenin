import { ComparisonMetricTable } from "../ComparisonMetricTable";
import { fmtNum, fmtPct, metricWinner } from "../comparisonUtils";

export function ComparisonPrice({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const rows = [
    { label: "Price", a: assetA.price, b: assetB.price, format: "currency", winner: metricWinner(assetA.price, assetB.price) },
    { label: "Day Change", a: assetA.changePct, b: assetB.changePct, format: "pct", winner: metricWinner(assetA.changePct, assetB.changePct) },
    { label: "Market Cap", a: assetA.marketCap, b: assetB.marketCap, format: "currency", winner: metricWinner(assetA.marketCap, assetB.marketCap) },
    { label: "52W High", a: assetA.high52, b: assetB.high52, format: "currency", winner: metricWinner(assetA.high52, assetB.high52) },
    { label: "52W Low", a: assetA.low52, b: assetB.low52, format: "currency", winner: metricWinner(assetA.low52, assetB.low52, false) },
    { label: "Beta", a: assetA.beta, b: assetB.beta, format: "num", winner: metricWinner(assetA.beta, assetB.beta, false) }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Price</h2>
      <ComparisonMetricTable rows={rows} caption="Price & market context" />
    </div>
  );
}
