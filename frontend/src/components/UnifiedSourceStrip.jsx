// components/UnifiedSourceStrip.jsx
// Compact, monochrome source-coverage strip for the unified portfolio read model.
// Surfaces which sources (Manual / SnapTrade / Hyperliquid / Exchange) contribute
// to the headline value, plus a sync action + partial-coverage notice. Reuses the
// existing design-system primitives — no page-specific CSS or color.

import React from "react";

const SOURCE_LABELS = {
  manual: "Manual",
  brokerage: "SnapTrade",
  wallet: "Hyperliquid",
  exchange: "Exchange"
};

// Provider-specific display names (a wallet/exchange sourceType can map to
// several providers — e.g. both Hyperliquid and Lighter are sourceType "wallet").
const PROVIDER_LABELS = {
  hyperliquid: "Hyperliquid",
  lighter: "Lighter"
};

// Staleness threshold (mirrors the backend UNIFIED_STALE_AFTER_MS default of 6h).
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
function isStale(lastSyncAt) {
  if (!lastSyncAt) return false;
  const age = Date.now() - new Date(lastSyncAt).getTime();
  return age > STALE_AFTER_MS;
}

export function UnifiedSourceStrip({ sources = [], isPartial = false, hasManualExcluded = false, onRefresh, onSync, syncing = false }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  // Dedup by source identity (provider + sourceType + connectionId) — the
  // backend already DISTINCTs, but guard against any residual duplicate rows
  // (e.g. pre-migration leftovers) so we never render 11 identical chips.
  const seen = new Set();
  const chips = [];
  sources.forEach((s, idx) => {
    const identity = `${s.sourceType}-${s.provider}-${s.connectionId || ""}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const label = PROVIDER_LABELS[s.provider] || SOURCE_LABELS[s.sourceType] || s.provider || s.sourceType;
    const count = Number(s.positionCount) || 0;
    const stale = isStale(s.lastSyncAt);
    chips.push(
      <span key={`${identity}-${idx}`} className={`unified-source-chip${stale ? " is-stale" : ""}`} title={`${label}: ${count} positions${stale ? " · sync is stale" : ""}`}>
        <span className="unified-source-dot" aria-hidden="true" />
        {label}
        <em>{count}</em>
        {stale && <span className="unified-source-stale" aria-label="sync stale">stale</span>}
      </span>
    );
  });
  if (!chips.length) return null;

  return (
    <div className="unified-source-strip" role="group" aria-label="Portfolio data sources">
      <span className="unified-source-label">Sources</span>
      <div className="unified-source-chips">{chips}</div>
      {isPartial && <span className="unified-source-partial" title="Some positions could not be valued">partial</span>}
      {hasManualExcluded && !isPartial && <span className="unified-source-manual-excluded" title="Manual holdings held out — connected sources present">manual excluded</span>}
      <button
        type="button"
        className="unified-source-sync"
        onClick={() => (onSync || onRefresh || (() => {}))()}
        disabled={syncing}
      >
        {syncing ? "Syncing…" : "Sync"}
      </button>
    </div>
  );
}

export default UnifiedSourceStrip;
