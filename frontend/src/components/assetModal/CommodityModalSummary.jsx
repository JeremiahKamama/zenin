// CommodityModalSummary — extracted from AssetModal.jsx (P9).
// Renders commodity-native metrics instead of stock-shaped earnings/finviz.
// Brand v2: monochrome, no fabricated data — every field falls back to "—".
import React from "react";

export function CommodityModalSummary({ asset, liveQuote }) {
  const sym = String(asset?.symbol || "").toUpperCase();
  const price = Number.isFinite(Number(asset?.price ?? liveQuote?.price)) ? Number(asset?.price ?? liveQuote?.price) : null;
  const changePct = Number.isFinite(Number(asset?.priceChangePercent ?? liveQuote?.priceChangePercent))
    ? Number(asset?.priceChangePercent ?? liveQuote?.priceChangePercent)
    : null;
  const unit = asset?.unit || asset?.currency || "USD";
  const group = asset?.group || asset?.category || "Commodity";
  const fmt = (v, suffix = "") => (v == null ? "—" : `${typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v}${suffix}`);
  const items = [
    { label: "Spot Price", value: price == null ? "—" : fmt(price), sub: unit },
    { label: "Daily Change", value: changePct == null ? "—" : `${changePct >= 0 ? "+" : ""}${fmt(changePct)}%`, tone: changePct == null ? "neutral" : changePct >= 0 ? "positive" : "negative" },
    { label: "Inventory", value: fmt(asset?.inventory), sub: group },
    { label: "Supply", value: fmt(asset?.supply), sub: asset?.supplyRegion || "" },
    { label: "Demand", value: fmt(asset?.demand), sub: asset?.demandRegion || "" },
    { label: "Macro Drivers", value: Array.isArray(asset?.macroDrivers) && asset.macroDrivers.length ? asset.macroDrivers.join(", ") : "—" },
  ];
  return (
    <section className="commodity-modal-summary" aria-label="Commodity summary">
      <div className="cms-tier cms-tier-1">
        {items.slice(0, 2).map((it) => (
          <div key={it.label} className="cms-metric">
            <span className="cms-label">{it.label}</span>
            <span className={`cms-value cms-tone-${it.tone || "neutral"}`}>{it.value}{it.sub ? <span className="cms-sub"> {it.sub}</span> : null}</span>
          </div>
        ))}
        <div className="cms-metric cms-signal">
          <span className="cms-label">Signal</span>
          <span className="cms-value">{asset?.signal || asset?.tone || "—"}</span>
        </div>
      </div>
      <div className="cms-tier cms-tier-2">
        {items.slice(2).map((it) => (
          <div key={it.label} className="cms-metric">
            <span className="cms-label">{it.label}</span>
            <span className="cms-value">{it.value}{it.sub ? <span className="cms-sub"> {it.sub}</span> : null}</span>
          </div>
        ))}
      </div>
      <div className="cms-tier cms-tier-4">
        <span className="cms-meta">Provider: {asset?.source || liveQuote?.source || "—"}</span>
        <span className="cms-meta">Confidence: {asset?.confidence != null ? `${asset.confidence}%` : "—"}</span>
        <span className="cms-meta">Freshness: {asset?.freshness?.label || (asset?.stale ? "Stale" : "—")}</span>
        <span className="cms-meta">Coverage: {asset?.coverage || group}</span>
      </div>
    </section>
  );
}
