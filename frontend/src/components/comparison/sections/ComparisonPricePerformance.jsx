import React from "react";
import { ComparisonChart } from "../ComparisonChart";

// Merged "Price & Performance" (C): Price/change/marketCap from ref data +
// the returns table + the comparison chart from Performance. One view, the
// data is already loaded by useComparisonAsset (no extra fetch).
function Row({ label, a, b }) {
  return (
    <div className="cmp-fund-row">
      <span className="cmp-fund-label">{label}</span>
      <span className="cmp-fund-a font-mono">{a}</span>
      <span className="cmp-fund-b font-mono">{b}</span>
    </div>
  );
}

export function ComparisonPricePerformance({ assetA, assetB, loadingA, loadingB }) {
  const A = assetA || {};
  const B = assetB || {};
  const fmt = (v) => (v == null ? "—" : v);
  const pct = (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
  const returnsA = A.returns || {};
  const returnsB = B.returns || {};
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Price &amp; Performance</h2>
      <div className="cmp-two-col">
        <div>
          <Row label="Last Price" a={A.price != null ? `$${A.price.toFixed(2)}` : "—"} b={B.price != null ? `$${B.price.toFixed(2)}` : "—"} />
          <Row label="Change %" a={pct(A.changePct)} b={pct(B.changePct)} />
          <Row label="Market Cap" a={A.marketCap != null ? `$${fmt(A.marketCap)}` : "—"} b={B.marketCap != null ? `$${fmt(B.marketCap)}` : "—"} />
          <Row label="Volume" a={A.volume != null ? fmt(A.volume) : "—"} b={B.volume != null ? fmt(B.volume) : "—"} />
        </div>
        <div>
          <Row label="1D Return" a={pct(returnsA.d)} b={pct(returnsB.d)} />
          <Row label="1W Return" a={pct(returnsA.w)} b={pct(returnsB.w)} />
          <Row label="1M Return" a={pct(returnsA.m)} b={pct(returnsB.m)} />
          <Row label="1Y Return" a={pct(returnsA.y)} b={pct(returnsB.y)} />
        </div>
      </div>
      <div className="cmp-chart-wrap">
        <ComparisonChart assetA={A} assetB={B} loadingA={loadingA} loadingB={loadingB} />
      </div>
    </div>
  );
}
