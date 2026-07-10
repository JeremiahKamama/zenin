import { ComparisonMetricTable } from "../ComparisonMetricTable";
import { fmtNum, fmtMultiple, metricWinner } from "../comparisonUtils";

// Fundamentals derived from earnings/finviz payloads (revenue, margins, EPS, FCF, ROE, debt).
export function ComparisonFundamentals({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const f = (d) => d?.earnings?.fundamentals ?? d?.finviz ?? {};
  const fa = f(assetA);
  const fb = f(assetB);
  const rows = [
    { label: "Revenue", a: fa.revenue ?? null, b: fb.revenue ?? null, format: "currency", winner: metricWinner(fa.revenue, fb.revenue) },
    { label: "Net Income", a: fa.netIncome ?? null, b: fb.netIncome ?? null, format: "currency", winner: metricWinner(fa.netIncome, fb.netIncome) },
    { label: "EPS", a: fa.eps ?? null, b: fb.eps ?? null, format: "num", winner: metricWinner(fa.eps, fb.eps) },
    { label: "Operating Margin", a: fa.operatingMargin ?? null, b: fb.operatingMargin ?? null, format: "pct", winner: metricWinner(fa.operatingMargin, fb.operatingMargin) },
    { label: "Gross Margin", a: fa.grossMargin ?? null, b: fb.grossMargin ?? null, format: "pct", winner: metricWinner(fa.grossMargin, fb.grossMargin) },
    { label: "ROE", a: fa.roe ?? null, b: fb.roe ?? null, format: "pct", winner: metricWinner(fa.roe, fb.roe) },
    { label: "ROIC", a: fa.roic ?? null, b: fb.roic ?? null, format: "pct", winner: metricWinner(fa.roic, fb.roic) },
    { label: "Total Debt", a: fa.totalDebt ?? null, b: fb.totalDebt ?? null, format: "currency", winner: metricWinner(fa.totalDebt, fb.totalDebt, false) },
    { label: "FCF", a: fa.freeCashFlow ?? null, b: fb.freeCashFlow ?? null, format: "currency", winner: metricWinner(fa.freeCashFlow, fb.freeCashFlow) }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Fundamentals</h2>
      <ComparisonMetricTable rows={rows} caption="Balance sheet & cash generation" />
    </div>
  );
}
