// hooks/useUnifiedPortfolio.js
// Source-aware portfolio read model. Pulls the unified summary from the backend
// (which aggregates existing brokerage_*/portfolio_holdings today) and refreshes
// on a 15-minute cadence to match the backend's background refresh contract.
//
// Design: NEVER throws into the host component. On any failure (401, offline,
// older backend without the endpoint) it leaves `summary` null so callers fall
// back to the legacy locally-computed value. This keeps the hook zero-regression:
// when the unified endpoint is unavailable, the app behaves exactly as before.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchUnifiedSummary,
  fetchUnifiedPositions,
  fetchUnifiedSources,
  fetchUnifiedSyncStatus,
  fetchUnifiedReconciliation,
  fetchUnifiedFxRates,
  fetchUnifiedSnapshots,
  fetchUnifiedEquityCurve,
  fetchUnifiedShadowComparison,
  triggerUnifiedSync
} from "@/services/portfolioService";

const REFRESH_MS = 15 * 60 * 1000;

export function useUnifiedPortfolio({ autoRefresh = true } = {}) {
  const [summary, setSummary] = useState(null);
  const [positions, setPositions] = useState([]);
  const [sources, setSources] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [fxRates, setFxRates] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [fillEquityCurve, setFillEquityCurve] = useState([]);
  const [shadow, setShadow] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const mountedRef = useRef(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const [s, p, src, st, rec, fx, snaps, curve, sh] = await Promise.all([
        fetchUnifiedSummary().catch(() => null),
        fetchUnifiedPositions().catch(() => []),
        fetchUnifiedSources().catch(() => []),
        fetchUnifiedSyncStatus().catch(() => null),
        fetchUnifiedReconciliation().catch(() => null),
        fetchUnifiedFxRates().catch(() => null),
        fetchUnifiedSnapshots().catch(() => []),
        fetchUnifiedEquityCurve().catch(() => []),
        fetchUnifiedShadowComparison().catch(() => null)
      ]);
      if (!mountedRef.current) return;
      setSummary(s);
      setPositions(Array.isArray(p) ? p : []);
      setSources(Array.isArray(src) ? src : []);
      setSyncStatus(st);
      setReconciliation(rec);
      setFxRates(fx);
      setSnapshots(Array.isArray(snaps) ? snaps : []);
      setFillEquityCurve(Array.isArray(curve) ? curve : []);
      setShadow(sh);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      // Graceful: keep previous summary, surface a soft error only.
      setError(err && err.message ? err.message : "unified portfolio unavailable");
    } finally {
      if (mountedRef.current) setLoading(false);
      inFlight.current = false;
    }
  }, []);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await triggerUnifiedSync().catch(() => null);
      if (!mountedRef.current) return res;
      setLastSyncedAt(new Date().toISOString());
      // Re-pull the freshest aggregate after the sync completes.
      await refresh();
      return res;
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    let timer = null;
    if (autoRefresh) {
      timer = setInterval(refresh, REFRESH_MS);
    }
    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [refresh, autoRefresh]);

  // isUnified = we successfully received a structured summary from the backend.
  const isUnified = !!summary && typeof summary.totalValue === "number";

  // Derived: warnings + duplicate-exposure for the drill-down.
  const warnings = summary && Array.isArray(summary.warnings) ? summary.warnings : [];
  const duplicateInstruments = reconciliation && Array.isArray(reconciliation.duplicateInstruments)
    ? reconciliation.duplicateInstruments : [];
  const unvaluedTotal = summary ? Number(summary.unvaluedTotal || 0) : 0;

  return {
    summary,
    positions,
    sources,
    syncStatus,
    reconciliation,
    duplicateInstruments,
    fxRates,
    snapshots,
    fillEquityCurve,
    shadow,
    warnings,
    unvaluedTotal,
    loading,
    error,
    syncing,
    lastSyncedAt,
    isUnified,
    // Convenience derived values (USD base).
    totalValue: isUnified ? summary.totalValue : null,
    cashValue: summary ? summary.cashValue : null,
    investedValue: summary ? summary.investedValue : null,
    derivativeGrossExposure: summary ? Number(summary.derivativeGrossExposure || 0) : null,
    derivativeNetExposure: summary ? Number(summary.derivativeNetExposure || 0) : null,
    isPartial: summary ? !!summary.isPartial : false,
    // Unified daily snapshots → tradeTimeline format for the equity chart.
    snapshotTimeline: Array.isArray(snapshots) && snapshots.length > 0
      ? snapshots
          .filter((s) => s.snapshotDate && Number.isFinite(s.portfolioValue))
          .map((s) => ({ t: new Date(s.snapshotDate).getTime(), equity: Number(s.portfolioValue) }))
          .sort((a, b) => a.t - b.t)
      : [],
    refresh,
    triggerSync
  };
}

export default useUnifiedPortfolio;
