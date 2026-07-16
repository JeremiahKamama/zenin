/**
 * Zenin V2 — Macro & Commodities Desk information-architecture layer.
 *
 * Pure presentational components only. They render DECISIONS, not raw data.
 * Every panel justifies its existence; nothing fabricates: when a tile has no
 * reading it shows an honest "—" / "n/a", never a fake number.
 *
 * Density rules (BrandV2): monochrome, desktop-first, no gradients, no
 * glassmorphism, no rounded marketing cards, green/red only for market meaning.
 */
import React from "react";

/* ---------- Signal tile (dense, no chart) ---------- */
function SignalTile({ label, reading, direction = "flat", confidence = null, tone = "neutral" }) {
  const dirGlyph = direction === "up" ? "▲" : direction === "down" ? "▼" : "■";
  const dirColor =
    direction === "up" ? "var(--color-data-up)" : direction === "down" ? "var(--color-data-down)" : "var(--color-data-slate-dim)";
  return (
    <div className={`deskv2-tile deskv2-tile-${tone}`} style={{ minWidth: 132 }}>
      <div className="deskv2-tile-label">{label}</div>
      <div className="deskv2-tile-reading">
        <span style={{ color: dirColor }}>{dirGlyph}</span>
        <span>{reading || "—"}</span>
      </div>
      <div className="deskv2-tile-meta">
        {confidence != null ? <span>Conf {confidence}%</span> : <span>&nbsp;</span>}
      </div>
    </div>
  );
}

/* ---------- Executive Signal Strip (Phase 1 Global) ---------- */
export const ExecutiveSignalStrip = React.memo(function ExecutiveSignalStrip({ tiles = [] }) {
  if (!tiles.length) return null;
  return (
    <div className="deskv2-signal-strip" role="list" aria-label="Executive signal strip">
      {tiles.map((t, i) => (
        <div role="listitem" key={t.label || i}>
          <SignalTile {...t} />
        </div>
      ))}
    </div>
  );
});

/* ---------- Decision Banner (Phase 1 Global) ---------- */
export const DecisionBanner = React.memo(function DecisionBanner({ text }) {
  if (!text) return null;
  return (
    <div className="deskv2-decision-banner" role="status">
      <span className="deskv2-decision-glyph">▸</span>
      <span className="deskv2-decision-text">{text}</span>
    </div>
  );
});

/* ---------- Data Quality Indicator (Phase 4 Shared) ---------- */
export function DataQualityIndicator({ source, updatedAt, confidence = null, coverage = null }) {
  return (
    <div className="deskv2-quality" aria-label="Data quality">
      {source ? <span className="deskv2-quality-src">{source}</span> : null}
      {updatedAt ? <span>Updated {updatedAt}</span> : null}
      {coverage ? <span>{coverage}</span> : null}
      {confidence != null ? <span>Confidence {confidence}%</span> : null}
    </div>
  );
}

/*
 * Tile builders — pure, derive 5 dense tiles from REAL desk state.
 * Returns honest "—" when the underlying indicator is missing.
 */

export function buildMacroSignalTiles({ macroRows = [], riskRows = [], fxRates = [], exec = null }) {
  const norm = (s) => String(s || "").toLowerCase();
  const find = (...keys) =>
    (macroRows || []).find((r) => {
      const hay = `${norm(r?.indicator)} ${norm(r?.indicatorCode)} ${norm(r?.name)} ${norm(r?.label)}`;
      return keys.some((k) => hay.includes(k));
    });
  const read = (r) => (r ? `${r.value ?? r.primary ?? r.secondary ?? "—"}${r.unit && r.unit !== "%" ? "" : ""}` : "—");
  const toneOf = (v) => (v > 0 ? "positive" : v < 0 ? "negative" : "neutral");

  // Liquidity: no direct WB series; fall back to growth proxy when present.
  const liq = find("net liquidity", "balance sheet", "liquidity", "m2", "gdp");
  // Yield curve: treasury tenors.
  const yc = find("10y", "treasury", "yield", "2s10s", "bond");
  // Inflation.
  const infl = find("inflation", "cpi", "pce", "price");
  // Credit stress from risk indicators.
  const credit = (riskRows || []).find((r) => /credit|hyg|spread|high yield/i.test(`${r?.indicator || r?.name || ""}`));
  // Dollar trend.
  const dxy = (riskRows || []).find((r) => /dxy|dollar/i.test(`${r?.indicator || r?.name || ""}`))
    || (fxRates || []).find((r) => /dxy|dollar/i.test(`${r?.label || r?.symbol || ""}`));

  return [
    { label: "Liquidity", reading: liq ? read(liq) : "—", direction: toneOf(Number(liq?.change ?? liq?.daily ?? 0)), confidence: exec?.confidence },
    { label: "Yield Curve", reading: yc ? read(yc) : "—", direction: toneOf(Number(yc?.change ?? yc?.daily ?? 0)), confidence: exec?.confidence },
    { label: "Inflation Trend", reading: infl ? read(infl) : "—", direction: toneOf(-Number(infl?.change ?? infl?.daily ?? 0)), confidence: exec?.confidence },
    { label: "Credit Stress", reading: credit ? (credit.status || credit.value || "Monitor") : "—", direction: /tight|elevated|watch/i.test(String(credit?.status || "")) ? "down" : "flat", confidence: exec?.confidence },
    { label: "Dollar Trend", reading: dxy ? (dxy.value ?? dxy.change ?? "—") : "—", direction: toneOf(Number(dxy?.change ?? dxy?.daily ?? 0)), confidence: exec?.confidence },
  ];
}

export function buildCommoditySignalTiles({ rows = [], exec = null }) {
  const byGroup = {};
  for (const r of rows || []) {
    const g = String(r?.group || "other").toLowerCase();
    const v = Number(r?.dailyChangePct);
    if (!byGroup[g]) byGroup[g] = { sum: 0, n: 0 };
    byGroup[g].sum += Number.isFinite(v) ? v : 0;
    byGroup[g].n += 1;
  }
  const avg = (g) => (byGroup[g] ? byGroup[g].sum / byGroup[g].n : 0);
  const toneOf = (v) => (v > 0.3 ? "positive" : v < -0.3 ? "negative" : "neutral");
  const fmt = (v) => (byGroup[g] ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—");

  const energy = avg("energy"), metals = avg("metals"), industrial = avg("industrial"), ag = avg("agriculture");
  const ranking = [
    ["Energy", energy], ["Metals", metals], ["Industrial", industrial], ["Agriculture", ag],
  ].sort((a, b) => b[1] - a[1]);
  const strongest = ranking[0], weakest = ranking[ranking.length - 1];

  return [
    { label: "Strongest Sector", reading: strongest[1] !== 0 ? `${strongest[0]} ${fmt(strongest[1])}` : "—", direction: toneOf(strongest[1]), confidence: exec?.confidence },
    { label: "Weakest Sector", reading: weakest[1] !== 0 ? `${weakest[0]} ${fmt(weakest[1])}` : "—", direction: toneOf(weakest[1]), confidence: exec?.confidence },
    { label: "Inventory Trend", reading: "—", direction: "flat", confidence: null },
    { label: "Curve State", reading: "Unavailable", direction: "flat", confidence: null },
    { label: "Weather Risk", reading: "—", direction: "flat", confidence: null },
  ];
}

/* ---------- Decision banner text from REAL state ---------- */
export function buildMacroDecisionText({ regimeLabel, exec = null }) {
  const r = String(regimeLabel || exec?.regime || "").toLowerCase();
  if (r.includes("expansion") || r.includes("recovery") || r.includes("goldilocks"))
    return "Current regime favors cyclicals over defensives.";
  if (r.includes("inflation") || r.includes("stagflation"))
    return "Inflationary pressure dominates; favor real assets over duration.";
  if (r.includes("slowdown") || r.includes("recession") || r.includes("risk"))
    return "Growth deteriorating; de-risk equities, extend duration.";
  return exec?.explain ? exec.explain : "Mixed signals; maintain neutral positioning.";
}

export function buildCommodityDecisionText({ rows = [] }) {
  const energy = (rows || []).filter((r) => String(r?.group || "").toLowerCase() === "energy");
  const avg = (arr) => (arr.length ? arr.reduce((s, r) => s + Number(r?.dailyChangePct || 0), 0) / arr.length : 0);
  const e = avg(energy);
  if (e > 0.5) return "Energy complex leading; inflation pass-through risk rising.";
  if (e < -0.5) return "Energy softening; disinflationary impulse building.";
  return "Commodity groups broadly balanced; no dominant rotation signal.";
}
