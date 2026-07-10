import { ComparisonMetricTable } from "../ComparisonMetricTable";
import { fmtNum, fmtPct, metricWinner } from "../comparisonUtils";

// Financials: quarterly/annual income-statement lines where available.
export function ComparisonFinancials({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const fin = (d) => d?.earnings?.financials ?? d?.earnings?.fundamentals ?? d?.finviz ?? {};
  const fa = fin(assetA);
  const fb = fin(assetB);
  const rows = [
    { label: "Revenue", a: fa.revenue ?? null, b: fb.revenue ?? null, format: "currency", winner: metricWinner(fa.revenue, fb.revenue) },
    { label: "Revenue Growth", a: fa.revenueGrowth ?? null, b: fb.revenueGrowth ?? null, format: "pct", winner: metricWinner(fa.revenueGrowth, fb.revenueGrowth) },
    { label: "Gross Profit", a: fa.grossProfit ?? null, b: fb.grossProfit ?? null, format: "currency", winner: metricWinner(fa.grossProfit, fb.grossProfit) },
    { label: "Operating Income", a: fa.operatingIncome ?? null, b: fb.operatingIncome ?? null, format: "currency", winner: metricWinner(fa.operatingIncome, fb.operatingIncome) },
    { label: "Net Income", a: fa.netIncome ?? null, b: fb.netIncome ?? null, format: "currency", winner: metricWinner(fa.netIncome, fb.netIncome) },
    { label: "Operating Cash Flow", a: fa.operatingCashFlow ?? null, b: fb.operatingCashFlow ?? null, format: "currency", winner: metricWinner(fa.operatingCashFlow, fb.operatingCashFlow) }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Financials</h2>
      <ComparisonMetricTable rows={rows} caption="Income statement" />
    </div>
  );
}
