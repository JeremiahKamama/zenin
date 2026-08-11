// Source-aware portfolio read model. Pulls the unified summary from the backend
// and refreshes on a 60-second cadence so the portfolio value, P&L, exposures,
// and connected sources stay live without a manual page refresh. The hook never
// throws (all fetches are error-caught) and an inFlight guard prevents overlap
// if a refresh is still in flight when the timer fires.

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
  fetchUnifiedTransactions,
  fetchUnifiedShadowComparison,
  triggerUnifiedSync
} from "@/services/portfolioService";

const REFRESH_MS = 60 * 1000;

export function useUnifiedPortfolio({ autoRefresh = true } = {}) {
  const [summary, setSummary] = useState(null);
  const [positions, setPositions] = useState([]);
  const [sources, setSources] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [fxRates, setFxRates] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [fillEquityCurve, setFillEquityCurve] = useState([]);
  const [transactions, setTransactions] = useState([]);
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
      const [s, p, src, st, rec, fx, snaps, curve, txns, sh] = await Promise.all([
        fetchUnifiedSummary().catch(() => null),
        fetchUnifiedPositions().catch(() => []),
        fetchUnifiedSources().catch(() => []),
        fetchUnifiedSyncStatus().catch(() => null),
        fetchUnifiedReconciliation().catch(() => null),
        fetchUnifiedFxRates().catch(() => null),
        fetchUnifiedSnapshots().catch(() => []),
        fetchUnifiedEquityCurve().catch(() => []),
        fetchUnifiedTransactions().catch(() => []),
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
      setTransactions(Array.isArray(txns) ? txns : []);
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
    transactions,
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
    hasManualExcluded: summary ? !!summary.hasManualExcluded : false,
    // Unified daily snapshots → tradeTimeline format for the equity chart.
    // Includes dailyReturn (backend-computed, cash-flow-aware TWR) so the chart
    // can use it directly without client-side recalculation.
    snapshotTimeline: Array.isArray(snapshots) && snapshots.length > 0
      ? snapshots
          .filter((s) => (s.snapshotDate || s.snapshot_date) && Number.isFinite(Number(s.portfolioValue != null ? s.portfolioValue : s.portfolio_value)))
          .map((s) => ({
            t: new Date(s.snapshotDate || s.snapshot_date).getTime(),
            equity: Number(s.portfolioValue != null ? s.portfolioValue : s.portfolio_value),
            // Backend-computed daily return (TWR, cash-flow aware) — no client override.
            dailyReturn: s.dailyReturn != null ? Number(s.dailyReturn) : undefined,
            portReturn: s.dailyReturn != null ? Number(s.dailyReturn) : undefined,
            realizedPnl: s.realizedPnl != null ? Number(s.realizedPnl) : 0,
            unrealizedPnl: s.unrealizedPnl != null ? Number(s.unrealizedPnl) : 0,
            deposits: s.deposits != null ? Number(s.deposits) : 0,
            withdrawals: s.withdrawals != null ? Number(s.withdrawals) : 0,
            cash: s.cash != null ? Number(s.cash) : 0,
            estimated: s.estimated === true,
            baseCurrency: s.baseCurrency
          }))
          .sort((a, b) => a.t - b.t)
      : [],
    refresh,
    triggerSync
  };
}

export default useUnifiedPortfolio;
