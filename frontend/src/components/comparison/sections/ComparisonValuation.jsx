import { ComparisonMetricTable } from "../ComparisonMetricTable";
import { fmtMultiple, metricWinner } from "../comparisonUtils";

// Valuation derived from earnings.valuation / finviz. Intrinsic value / DCF /
// fair value / margin of safety are NOT available in this environment — shown
// as honest empty states, not fabricated.
export function ComparisonValuation({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const v = (d) => d?.earnings?.valuation ?? d?.finviz ?? {};
  const va = v(assetA);
  const vb = v(assetB);
  const rows = [
    { label: "P/E (Trailing)", a: va.trailingPe ?? null, b: vb.trailingPe ?? null, format: "multiple", winner: metricWinner(va.trailingPe, vb.trailingPe, false) },
    { label: "P/E (Forward)", a: va.forwardPe ?? null, b: vb.forwardPe ?? null, format: "multiple", winner: metricWinner(va.forwardPe, vb.forwardPe, false) },
    { label: "P/S", a: va.priceToSales ?? null, b: vb.priceToSales ?? null, format: "multiple", winner: metricWinner(va.priceToSales, vb.priceToSales, false) },
    { label: "EV/EBITDA", a: va.enterpriseToEbitda ?? null, b: vb.enterpriseToEbitda ?? null, format: "multiple", winner: metricWinner(va.enterpriseToEbitda, vb.enterpriseToEbitda, false) },
    { label: "P/B", a: va.priceToBook ?? null, b: vb.priceToBook ?? null, format: "multiple", winner: metricWinner(va.priceToBook, vb.priceToBook, false) },
    { label: "PEG", a: va.peg ?? null, b: vb.peg ?? null, format: "multiple", winner: metricWinner(va.peg, vb.peg, false) }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Valuation</h2>
      <ComparisonMetricTable rows={rows} caption="Market multiples" />
      <div className="cmp-section-note">
        Intrinsic value, DCF, fair value and margin of safety are not provided by the current data services — left blank rather than estimated.
      </div>
    </div>
  );
}
