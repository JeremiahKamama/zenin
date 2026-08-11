// PerformanceData.js
// Centralized Performance data orchestrator (spec §6, §38).
//
// Owns the full lifecycle: Timeline → View → Account/Source → fetch snapshots
// → filter by provenance → calculate metric → downsample for display →
// return series with explicit data states (loading/empty/error/sync/partial).
//
// Architecture:
//   Connected Accounts → Source Sync → Unified Snapshots (Tier 1, immutable)
//       + Fill Curve (Tier 2, supplemental intraday for fresh wallets)
//           ↓
//   resolveTimeline() → { start, end, intervalKey }
//   resolveView()     → { metric, mode, label }
//   loadHistoricalData() → fetchUnifiedSnapshots + fetchUnifiedSyncStatus
//   applyAccountFilter / applySourceFilter → provenance filtering
//   calculateMetric() → buildEquitySeries(chartMode)  [no interpolation]
//   downsample() → real-observation downsampling for display (LTTB/largest-triangle)
//   returnSeries() → { series, benchmarkSeries, status, meta }
//
// NO synthetic point generation. NO trade-anchor interpolation. NO current-
// equity historical reconstruction. Missing data → unavailable, not fabricated.

import { fetchUnifiedSnapshots, fetchUnifiedEquityCurve, fetchUnifiedSyncStatus } from "@/services/portfolioService";
import { resolveRange, buildEquitySeries, buildBenchmarkSeries, computePerformanceMetrics } from "@/utils/performanceHistory";

// ---- Timeline definitions (spec §7, §8) ----
// Each Timeline maps to a calendar-aware date range. Point-count targets are
// DISPLAY limits only — they never define data availability (spec §23).
export const TIMELINE_OPTIONS = [
  { key: "1D",  label: "1D",  displayName: "1D",   ms: 1 * 24 * 60 * 60 * 1000 },
  { key: "1W",  label: "1W",  displayName: "1W",   ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1M",  label: "1M",  displayName: "1M",   ms: null }, // calendar-month (resolveRange handles)
  { key: "3M",  label: "3M",  displayName: "3M",   ms: null },
  { key: "1Y",  label: "1Y",  displayName: "1Y",   ms: null },
  { key: "YTD", label: "YTD", displayName: "YTD", ms: null },
  { key: "ALL", label: "ALL", displayName: "ALL", ms: null },
];

// Maximum DISPLAY points per Timeline. Downsampling targets these; the
// underlying observation count may be larger (e.g. ALL with 365 daily
// snapshots → downsample to ≤240 points for rendering performance).
const DISPLAY_POINT_CAPS = {
  "1D": 288,   // up to 24h of intraday (hourly) — but ONLY if intraday data exists
  "1W": 56,    // 7 days × 8 (3-hour sampling for dense periods)
  "1M": 60,    // 30 days × 2
  "3M": 90,    // 90 days × 1
  "1Y": 126,   // ~2.5 months sampling (largest-triangle preserves shape)
  YTD: 126,
  ALL: 240,    // cap rendering at 240 points max; 365+ days downsampled
};

// ---- View definitions (spec §12, §13) ----
// Each View maps to a metric mode consumed by buildEquitySeries.
export const VIEW_OPTIONS = [
  { key: "equity",      label: "Equity",      mode: "equity",      displayName: "Equity Curve", tooltipMetric: "Equity" },
  { key: "percentage",  label: "% Gain",      mode: "percentage",  displayName: "% Gain", tooltipMetric: "Return" },
  { key: "pnl",         label: "Cash PnL",    mode: "pnl",         displayName: "Cash PnL", tooltipMetric: "P&L" },
];

// Cache key incorporates ALL axes that affect the dataset (spec §42):
// workspace + account + source + timeline/date-range + view + currency + benchmark.
export function makeCacheKey(params) {
  const { workspace, accounts, sources, interval, view, currency, benchmark } = params;
  return [
    "perf", workspace || "default",
    "accs:" + (Array.isArray(accounts) ? accounts.join(",") : accounts || "all"),
    "src:" + (Array.isArray(sources) ? sources.join(",") : sources || "all"),
    "t:" + interval, "v:" + view, "c:" + currency,
    "b:" + (benchmark || "none"),
  ].join("|");
}

// ---- TimelineResolver (spec §7) ----
// Returns a precise { start, end } ISO date window. Calendar-aware for
// month-based intervals. `customRange` overrides start/end if supplied.
export function resolveTimeline(interval, now = new Date(), customRange = null) {
  if (customRange && customRange.start && customRange.end) {
    return { start: customRange.start, end: customRange.end, intervalKey: interval };
  }
  const { start, end } = resolveRange(interval, now);
  return { start, end, intervalKey: interval };
}

// ---- Data-level provenance filtering (spec §27, §28) ----
// Filters raw snapshots (Tier 1) or fill-curve points (Tier 2) by the
// selected account(s) and source(s). The backend returns per-source records
// with a `source_id` / `connection_id` field when available.
export function applyProvenanceFilter(rows, { accounts, sources }) {
  if (!Array.isArray(rows)) return [];
  const acctSet = Array.isArray(accounts) && accounts.length > 0 ? new Set(accounts.map(String)) : null;
  const srcSet = Array.isArray(sources) && sources.length > 0 ? new Set(sources.map(String)) : null;
  if (!acctSet && !srcSet) return rows;
  return rows.filter((r) => {
    const acctMatch = !acctSet || acctSet.has(String(r.accountId || r.account_id || r.account || ""));
    const srcMatch = !srcSet || srcSet.has(String(r.sourceId || r.source_id || r.source || r.connectionId || r.connection));
    return acctMatch && srcMatch;
  });
}

// ---- Downsampling (spec §22) ----
// Two-phase: (1) greedily preserve ALL local extrema (peaks/troughs) + start/end,
// so meaningful performance events are never destroyed; (2) if the result still
// exceeds the display cap, apply Largest-Triangle-Three-Points (LTTB) on the
// extrema set to pick the most visually representative subset.
//
// Operates on REAL observations only — never inserts synthetic points.
export function downsample(points, threshold) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (threshold == null || points.length <= threshold) return points.slice();

  // Phase 1: extract local extrema (direction changes in value slope).
  // Handles plateaus: a point is an extremum when the slope sign changes,
  // including the last point of a flat run before a reversal.
  const extrema = [points[0]];
  let lastDir = 0; // -1 declining, +1 rising, 0 neutral
  for (let i = 1; i < points.length; i++) {
    const diff = points[i][1] - points[i - 1][1];
    const dir = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (dir !== 0 && lastDir !== 0 && dir !== lastDir) {
      // Direction reversal → the previous point (end of the prior run) is an extremum.
      extrema.push(points[i - 1]);
    }
    if (dir !== 0) lastDir = dir;
  }
  extrema.push(points[points.length - 1]);
  if (extrema.length <= threshold) return extrema;

  // Phase 2: LTTB on the extrema set.
  const sampled = [extrema[0]];
  const samplingInterval = extrema.length / threshold;
  let a = 0;
  let b = Math.floor(samplingInterval);
  while (b < extrema.length - 1) {
    const nextA = b;
    const nextB = Math.floor((b + 1) * samplingInterval);
    let maxArea = -1;
    let maxAreaIndex = a + 1;
    const aPt = extrema[a];
    const bPt = extrema[b];
    for (let i = a + 1; i < b; i++) {
      const area = triangleArea(aPt, bPt, extrema[i]);
      if (area > maxArea) {
        maxArea = area;
        maxAreaIndex = i;
      }
    }
    sampled.push(extrema[maxAreaIndex]);
    a = nextA;
    b = Math.min(nextB, extrema.length - 1);
  }
  sampled.push(extrema[extrema.length - 1]);
  // Deduplicate consecutive identical timestamps.
  return sampled.filter((p, i) => i === 0 || p[0] !== sampled[i - 1][0]);
}

function triangleArea(a, b, c) {
  // 2D triangle area (×2). Points are [ts, value] pairs.
  return Math.abs((a[1] - c[1]) * (b[0] - a[0]) - (a[0] - c[0]) * (b[1] - a[1]));
}

// ---- PerformanceData Orchestrator (spec §6, §38) ----
//
// Usage:
//   const svc = new PerformanceData({ workspace, accounts, sources, currency, benchmarkSymbol });
//   const result = await svc.load({ interval, view });
//   // → { series, benchmarkSeries, status, metrics, snapshots, meta }
//
export class PerformanceData {
  /**
   * @param {object} ctx
   * @param {string} ctx.workspace
   * @param {string[]} ctx.accounts  selected account IDs (empty = all)
   * @param {string[]} ctx.sources    selected source IDs (empty = all)
   * @param {string} ctx.currency     display currency
   * @param {string|null} ctx.benchmarkSymbol  e.g. "SPY", null = none
   */
  constructor(ctx = {}) {
    this.workspace = ctx.workspace || "default";
    this.accounts = Array.isArray(ctx.accounts) ? ctx.accounts : [];
    this.sources = Array.isArray(ctx.sources) ? ctx.sources : [];
    this.currency = ctx.currency || "USD";
    this.benchmarkSymbol = ctx.benchmarkSymbol || null;
    this._cache = new Map();
  }

  /** Resolve Timeline → { start, end, intervalKey, displayCap } (spec §7). */
  resolveTimeline(interval, now = new Date()) {
    const { start, end, intervalKey } = resolveTimeline(interval, now);
    const displayCap = DISPLAY_POINT_CAPS[interval] || DISPLAY_POINT_CAPS.ALL;
    return { start, end, intervalKey, displayCap };
  }

  /** Resolve View → { mode, label, tooltipMetric } (spec §12, §13). */
  resolveView(viewKey) {
    const v = VIEW_OPTIONS.find((v) => v.key === viewKey) || VIEW_OPTIONS[0];
    return { mode: v.mode, label: v.displayName, tooltipMetric: v.tooltipMetric };
  }

  /**
   * Load historical data for the given Timeline + View + provenance.
   * Returns an explicit status (spec §24, §41, §56).
   *
   * Status values:
   *   "loading"  — in flight
   *   "ready"    — real observations available (may be partial)
   *   "empty"    — selected range has no real historical observations
   *   "syncing"  — source is connected but sync in progress (no snapshots yet)
   *   "unavailable" — source does not support historical data (e.g. Polymarket
   *                   wallet with no EOD snapshot history)
   *   "error"    — API/retrieval failure
   *   "partial"  — data exists but is incomplete (fewer points than expected)
   */
  async load({ interval, view, signal } = {}) {
    const cacheKey = makeCacheKey({
      workspace: this.workspace,
      accounts: this.accounts,
      sources: this.sources,
      interval, view,
      currency: this.currency,
      benchmark: this.benchmarkSymbol,
    });

    // Cache check (spec §42) — key incorporates ALL axes.
    const cached = this._cache.get(cacheKey);
    if (cached && signal?.aborted === false) {
      return { ...cached, fromCache: true };
    }

    // --- Load with explicit status transitions ---
    const ctx = { signal, view, interval, cacheKey };
    const result = await this._loadInternal(ctx);
    if (result.status !== "error" && result.status !== "loading") {
      this._cache.set(cacheKey, result);
    }
    return result;
  }

  async _loadInternal({ signal, view, interval }) {
    const tl = this.resolveTimeline(interval);
    const { mode } = this.resolveView(view);

    // Parallel fetch: snapshots (Tier 1) + sync status (for "syncing" state).
    const [snapshotRows, syncStatus, fallbackCurve] = await Promise.allSettled([
      this._loadSnapshots(tl, signal),
      this._loadSyncStatus(signal),
      this._loadFallbackCurve(tl, signal),
    ]);

    // --- Error handling (spec §41) ---
    if (snapshotRows.status === "rejected") {
      // Distinguish auth failure from API failure from rate-limit (spec §41).
      const err = snapshotRows.reason;
      return this._classifyError(err);
    }

    const snapshots = snapshotRows.value || [];
    const sync = syncStatus.status === "fulfilled" ? syncStatus.value : null;

    // --- Provenance filtering (spec §27, §28) ---
    const filtered = applyProvenanceFilter(snapshots, {
      accounts: this.accounts, sources: this.sources,
    });

    // --- Data state classification (spec §24, §56) ---
    if (filtered.length === 0) {
      // No snapshots in range. Determine why:
      if (sync?.syncStatus === "in_progress" || sync?.isSyncing) {
        return { status: "syncing", series: [], benchmarkSeries: [], meta: { ...tl, observationCount: 0, syncStatus: sync }, cacheKey };
      }
      if (sync?.capabilities?.historicalPerformance === false) {
        return { status: "unavailable", series: [], benchmarkSeries: [], meta: { ...tl, observationCount: 0, reason: "source does not support historical performance" }, cacheKey };
      }
      return { status: "empty", series: [], benchmarkSeries: [], meta: { ...tl, observationCount: 0 }, cacheKey };
    }

    // --- Calculate metric (spec §14-17) — pure function, no interpolation ---
    const chartData = buildEquitySeries(filtered, mode, { baseValue: filtered[0]?.portfolioValue || 0 });

    // --- Benchmark series (spec §29, §30) — same range, null gaps = gaps ---
    const benchmarkSeries = buildBenchmarkSeries(filtered, mode, { baseValue: filtered[0]?.portfolioValue || 0 });

    // --- Downsample for display (spec §22) — real observations only ---
    const displayCap = tl.displayCap;
    const displaySeries = chartData.length > displayCap ? downsample(chartData, displayCap) : chartData;
    const displayBench = benchmarkSeries.length > displayCap ? downsample(benchmarkSeries, displayCap) : benchmarkSeries;

    // --- Metrics (spec §43 summary cards) — from the SAME filtered data ---
    const metrics = computePerformanceMetrics(filtered);

    // --- Partial detection (spec §25, §56): compare expected vs available ---
    const expectedDays = this._expectedDayCount(tl.intervalKey, tl);
    const actualPoints = filtered.length;
    const isPartial = expectedDays > 0 && actualPoints < expectedDays * 0.8; // <80% of expected
    const status = isPartial ? "partial" : "ready";

    return {
      status,
      series: displaySeries,
      benchmarkSeries: displayBench,
      snapshots: filtered,  // raw observations (for cross-feature consistency §62)
      metrics,
      meta: {
        ...tl,
        viewMode: mode,
        observationCount: actualPoints,
        displayPointCount: displaySeries.length,
        downsampled: chartData.length > displayCap,
        expectedDayCount: expectedDays,
        isPartial,
        hasBenchmark: benchmarkSeries.length > 0,
        benchmarkSymbol: this.benchmarkSymbol,
      },
      cacheKey,
    };
  }

  /** Fetch Tier 1 immutable snapshots (spec §8, §34). */
  async _loadSnapshots({ start, end }, signal) {
    const snapshots = await fetchUnifiedSnapshots({ signal });
    if (!Array.isArray(snapshots)) return [];
    // The backend returns records: { date, portfolioValue, cash, ..., source_id,
    //   realizedPnl, unrealizedPnl, dailyReturn, deposits, withdrawals, fees,
    //   estimated, benchmarkValue }. Filter to [start, end) ISO dates.
    const startNorm = (start || "").slice(0, 10);
    const endNorm = (end || "").slice(0, 10);
    return snapshots
      .filter((s) => {
        const d = (s.snapshotDate || s.date || "").slice(0, 10);
        if (!d) return false;
        // Inclusive start, inclusive end (spec §33: explicit boundary semantics).
        return (!startNorm || d >= startNorm) && (!endNorm || d <= endNorm);
      });
  }

  /** Fetch sync status for "syncing" / "unavailable" discrimination (spec §41). */
  async _loadSyncStatus(signal) {
    try {
      return await fetchUnifiedSyncStatus({ signal });
    } catch {
      return null;
    }
  }

  /** Tier 2 fallback: fill-reconstructed curve for fresh wallets (spec §20).
   * Only used when Tier 1 snapshots are absent. NEVER synthesizes historical
   * points before the earliest fill. */
  async _loadFallbackCurve({ start, end }, signal) {
    const curve = await fetchUnifiedEquityCurve({ signal, from: start, to: end, limit: 365 });
    return Array.isArray(curve) ? curve : [];
  }

  /** Resolve in-memory unified snapshots (Tier 1) into canonical PerformancePoint
   * rows within [start, end]. Synchronous — PortfolioModule passes already-fetched
   * snapshots. (spec §8, §34) No fabrication; filters by real snapshot dates only. */
  resolveSnapshots(snapshots, start, end) {
    if (!Array.isArray(snapshots)) return [];
    const startNorm = (start || "").slice(0, 10);
    const endNorm = (end || "").slice(0, 10);
    return snapshots
      .filter((s) => {
        const d = s.snapshotDate || s.snapshot_date;
        if (!d) return false;
        const pv = s.portfolioValue != null ? s.portfolioValue : s.portfolio_value;
        return Number.isFinite(Number(pv));
      })
      .map((s) => ({
        date: s.snapshotDate || s.snapshot_date,
        ts: new Date(`${s.snapshotDate || s.snapshot_date}T00:00:00Z`).getTime(),
        portfolioValue: Number(s.portfolioValue != null ? s.portfolioValue : s.portfolio_value),
        cash: Number(s.cash || 0),
        investedCapital: Number(s.investedCapital || 0),
        realizedPnl: Number(s.realizedPnl || 0),
        unrealizedPnl: Number(s.unrealizedPnl || 0),
        dailyPnl: Number(s.dailyPnl || 0),
        dailyReturn: Number(s.dailyReturn || 0),
        benchmarkValue: s.benchmarkValue != null ? Number(s.benchmarkValue) : null,
        benchmarkReturn: s.benchmarkReturn != null ? Number(s.benchmarkReturn) : null,
        deposits: Number(s.deposits || 0),
        withdrawals: Number(s.withdrawals || 0),
        fees: Number(s.fees || 0),
        dividends: Number(s.dividends || 0),
        estimated: s.estimated === true,
        source: "unified",
      }))
      .filter((r) => Number.isFinite(r.ts))
      .sort((a, b) => a.ts - b.ts)
      .filter((r) => (!startNorm || r.date >= startNorm) && (!endNorm || r.date <= endNorm));
  }

  /** Resolve in-memory fill-equity curve (Tier 2) into canonical rows.
   * Used ONLY when no immutable snapshots exist (fresh wallets). Backward-
   * subtracts future realized PNL from current equity — approximate, labelled
   * estimated. (spec §20) */
  resolveFillCurve(fillCurve, start, end) {
    if (!Array.isArray(fillCurve)) return [];
    const startNorm = (start || "").slice(0, 10);
    const endNorm = (end || "").slice(0, 10);
    return fillCurve
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.equity))
      .map((p) => ({
        date: new Date(p.t).toISOString().slice(0, 10),
        ts: Number(p.t),
        portfolioValue: Number(p.equity),
        cash: 0, investedCapital: 0, dailyPnl: 0, dailyReturn: 0,
        realizedPnl: 0, unrealizedPnl: 0,
        benchmarkValue: p.benchmark != null ? Number(p.benchmark) : null,
        benchmarkReturn: null,
        deposits: 0, withdrawals: 0, fees: 0, dividends: 0,
        estimated: p.estimated === true,
        source: "fill_curve",
      }))
      .sort((a, b) => a.ts - b.ts)
      .filter((r) => (!startNorm || r.date >= startNorm) && (!endNorm || r.date <= endNorm))
      .map((r, i, arr) => {
        if (i === 0) return { ...r, dailyReturn: 0 };
        const prev = arr[i - 1].portfolioValue;
        const ret = prev ? (r.portfolioValue - prev) / prev : 0;
        return { ...r, dailyReturn: ret };
      });
  }

  /** Classify API errors into distinct statuses (spec §41). */
  _classifyError(err) {
    const status = err?.status || err?.response?.status;
    if (status === 401 || status === 403) return { status: "error", series: [], error: "auth", meta: { error: "Authentication required" } };
    if (status === 429) return { status: "error", series: [], error: "rate_limit", meta: { errorRateLimit: true, retryAfter: err?.retryAfter } };
    return { status: "error", series: [], error: "api_failure", meta: { error: String(err?.message || "Unable to load performance history") } };
  }

  /** Expected observation count for partial detection (rough day count). */
  _expectedDayCount(intervalKey, { start, end }) {
    if (!start || !end) return 0;
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const days = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)) + 1);
    // 1D may have intraday points, scale up
    if (intervalKey === "1D") return days * 6;
    return days;
  }

  /** Invalidate cache for current context (spec §42). */
  invalidate() {
    this._cache.clear();
  }
}

export default PerformanceData;
