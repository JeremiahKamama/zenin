// MacroTierModule — reusable Tier-1 macro intelligence module.
//
// One component, many themes (Liquidity, Rates, Growth, Inflation, Risk). Driven by
// a `definition` (title + metric specs) and a `series` map (seriesCode -> {points, meta}).
// Computes Current / 1W / 1M / Trend / Signal from the points. Renders monochrome
// analytics cards. No provider logic — series already resolved by macro/adapters.
//
// Honest states: missing series or empty points render "Unavailable", never fake.

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";

function lastValue(points) {
  if (!Array.isArray(points) || !points.length) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (Number.isFinite(Number(points[i]?.v))) return Number(points[i].v);
  }
  return null;
}

function valueAtOffset(points, n) {
  if (!Array.isArray(points) || points.length < n + 1) return null;
  for (let i = points.length - 1 - n; i >= 0; i--) {
    if (Number.isFinite(Number(points[i]?.v))) return Number(points[i].v);
  }
  return null;
}

function pctChange(curr, prev) {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// Derive a simple directional signal from trend + level.
function deriveSignal({ curr, change1w, change1m, higherIsBullish = true }) {
  const move = change1w != null ? change1w : change1m;
  if (move == null) return { label: "Unavailable", tone: "neutral" };
  const positive = move > 0;
  const bullish = higherIsBullish ? positive : !positive;
  if (Math.abs(move) < 0.05) return { label: "Neutral", tone: "neutral" };
  return bullish
    ? { label: "Bullish", tone: "positive" }
    : { label: "Bearish", tone: "negative" };
}

function MetricRow({ label, series, unit, higherIsBullish, format }) {
  const points = series?.points;
  const curr = lastValue(points);
  const prev1w = valueAtOffset(points, 5);
  const prev1m = valueAtOffset(points, 21);
  const change1w = pctChange(curr, prev1w);
  const change1m = pctChange(curr, prev1m);
  const signal = deriveSignal({ curr, change1w, change1m, higherIsBullish });
  const fmt = format || ((v) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 })));

  return (
    <div className="macro-tier-metric" role="row">
      <div className="macro-tier-metric-label">{label}</div>
      <div className="macro-tier-metric-value">{fmt(curr)}{unit ? <span className="macro-tier-unit"> {unit}</span> : null}</div>
      <div className="macro-tier-metric-sub">
        <span>1W {change1w == null ? "—" : `${change1w >= 0 ? "+" : ""}${change1w.toFixed(2)}%`}</span>
        <span>1M {change1m == null ? "—" : `${change1m >= 0 ? "+" : ""}${change1m.toFixed(2)}%`}</span>
      </div>
      <StatusPill tone={signal.tone}>{signal.label}</StatusPill>
    </div>
  );
}

export function MacroTierModule({ title, subtitle, regimeLabel, regimeTone = "neutral", metrics = [], source, children }) {
  return (
    <section className="analytics-card macro-tier-module" aria-label={title}>
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">{title}</div>
          {subtitle ? <div className="analytics-card-subtitle">{subtitle}</div> : null}
        </div>
        <div className="analytics-pill-group">
          {regimeLabel ? <StatusPill tone={regimeTone}>{regimeLabel}</StatusPill> : null}
          {source ? <StatusPill tone="neutral">{source}</StatusPill> : null}
        </div>
      </div>
      <div className="macro-tier-grid">
        {metrics.length === 0 ? (
          <div className="macro-tier-empty">Unavailable — no series loaded for this theme.</div>
        ) : (
          metrics.map((m) => (
            <MetricRow
              key={m.label}
              label={m.label}
              series={m.series}
              unit={m.unit}
              higherIsBullish={m.higherIsBullish}
              format={m.format}
            />
          ))
        )}
      </div>
      {children}
    </section>
  );
}

export default MacroTierModule;
