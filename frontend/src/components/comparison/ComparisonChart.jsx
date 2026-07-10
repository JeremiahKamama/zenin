// Overlaid performance chart. Renders two normalized lines (Asset A vs Asset B)
// so the relative trajectory is comparable regardless of absolute price.
import { useMemo } from "react";
import { TradingViewChart } from "../TradingViewChart";

function normalize(series) {
  if (!Array.isArray(series) || series.length < 2) return [];
  const first = Number(series[0].c);
  if (!Number.isFinite(first) || first === 0) return [];
  return series.map((p) => ({ t: p.t, v: (Number(p.c) / first) * 100 }));
}

export function ComparisonChart({ assetA, assetB, loading }) {
  const merged = useMemo(() => {
    const a = normalize(assetA?.history);
    const b = normalize(assetB?.history);
    const len = Math.min(a.length, b.length);
    if (len < 2) return [];
    const out = [];
    for (let i = 0; i < len; i++) {
      out.push({
        t: a[i].t,
        a: a[i].v,
        b: b[i].v
      });
    }
    return out;
  }, [assetA, assetB]);

  if (loading) {
    return <div className="cmp-chart-empty">Loading performance…</div>;
  }
  if (merged.length < 2) {
    return <div className="cmp-chart-empty">Performance history unavailable for one or both assets in this environment.</div>;
  }

  // TradingViewChart expects a series; we pass a combined multi-line payload is
  // not supported, so render a lightweight inline SVG overlay instead.
  const W = 720;
  const H = 260;
  const pad = 8;
  const allV = merged.flatMap((m) => [m.a, m.b]);
  const min = Math.min(...allV);
  const max = Math.max(...allV);
  const span = max - min || 1;
  const x = (i) => pad + (i / (merged.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const pathA = merged.map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(m.a).toFixed(1)}`).join(" ");
  const pathB = merged.map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(m.b).toFixed(1)}`).join(" ");

  return (
    <div className="cmp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="cmp-chart-svg" preserveAspectRatio="none" role="img" aria-label="Normalized performance overlay">
        <path d={pathA} fill="none" stroke="var(--color-data-up)" strokeWidth="2" />
        <path d={pathB} fill="none" stroke="var(--color-data-down)" strokeWidth="2" />
      </svg>
      <div className="cmp-chart-legend">
        <span className="cmp-legend-a">{assetA?.symbol} (100→)</span>
        <span className="cmp-legend-b">{assetB?.symbol} (100→)</span>
      </div>
    </div>
  );
}
