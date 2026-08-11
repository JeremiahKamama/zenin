// utils/portfolioHeadline.js
// Single source of truth for unified-vs-legacy resolution across Home, Portfolio,
// and any other surface. The backend (getUnifiedSummary) is authoritative for
// what "unified" means; these selectors only decide WHICH value a surface shows
// and never recompute the combine/offset/exclude logic.
//
// Contract: when unifiedPortfolio.isUnified is true, EVERY headline, positions
// list, and P&L figure reads from the unified hook. The legacy portfolio/balance/
// accountMetrics props are fallbacks for when unified is off — never a parallel
// source layered on top.

/**
 * Headline account value.
 * Rule: prefer the unified total when unified is active and finite; else the
 * legacy equity. One rule, one fallback — both surfaces call this identically.
 */
export function resolveHeadlineValue({ unified, legacyEquity }) {
  if (unified && unified.isUnified && Number.isFinite(Number(unified.totalValue))) {
    return Number(unified.totalValue);
  }
  return Number.isFinite(Number(legacyEquity)) ? Number(legacyEquity) : 0;
}

/**
 * Whether connected (non-manual) sources are contributing. The backend already
 * strips manual rows from unified.positions when connected sources exist, so the
 * frontend predicate is a thin guard, not the rule. Used by both surfaces to
 * suppress stale legacy manual holdings consistently.
 */
export function hasConnectedSources(unified) {
  if (!unified || !unified.isUnified) return false;
  const sources = Array.isArray(unified.sources) ? unified.sources : [];
  return sources.some((s) => s.sourceType !== "manual" && Number(s.positionCount || 0) > 0);
}

/**
 * Positions to display: when unified is active, use the canonical unified.positions
 * (manual already excluded server-side), mapped to a legacy-compatible shape so
 * every downstream consumer (Holdings, Exposure, Attribution, allocation, etc.)
 * works without individual edits.
 */
export function resolveDisplayPositions({ unified, legacyPortfolio = [] }) {
  if (unified && unified.isUnified && Array.isArray(unified.positions)) {
    return unified.positions.map((p) => {
      const qty = Number(p.quantity || 0);
      const mv = Number(p.marketValue || p.portfolioValue || 0);
      return {
        ...p,
        price: qty > 0 ? mv / qty : 0,
        type: p.assetType || (p.instrumentType === "perpetual" ? "crypto" : p.instrumentType),
        marketType: p.instrumentType || "spot",
        entryPrice: p.collateralValue != null ? Number(p.collateralValue) / Math.max(1, qty) : (p.averageEntryPrice != null ? Number(p.averageEntryPrice) : 0),
        currentPrice: p.currentPrice != null ? Number(p.currentPrice) : null
      };
    });
  }
  return Array.isArray(legacyPortfolio) ? legacyPortfolio : [];
}

/**
 * Which timeline the performance chart uses. Precedence:
 *   1. Unified daily snapshots (EOD, immutable) when present;
 *   2. Else the fill-reconstructed curve (backfills fresh wallets);
 *   3. Else the legacy timeline.
 * Both Home and Portfolio call this with their own legacy source so they agree.
 */
export function resolvePerformanceTimeline({ unified, legacyTimeline = [] }) {
  const snapshotTimeline = unified?.snapshotTimeline;
  const fillCurve = unified?.fillEquityCurve;
  if (unified?.isUnified) {
    if (Array.isArray(snapshotTimeline) && snapshotTimeline.length > 1) return snapshotTimeline;
    if (Array.isArray(fillCurve) && fillCurve.length > 1) return fillCurve;
  }
  return Array.isArray(legacyTimeline) ? legacyTimeline : [];
}
