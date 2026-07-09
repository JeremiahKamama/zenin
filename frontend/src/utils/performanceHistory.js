/**
 * performanceHistory.js
 *
 * Single source of truth on the frontend for the Performance Curve.
 *
 * The Performance Curve reads IMMUTABLE daily snapshots from
 * `portfolio_daily_snapshots` via GET /api/history/range. It NEVER reconstructs
 * history from trades, never interpolates fake buckets, and never fabricates a
 * benchmark. Today's live equity is shown as a SEPARATE overlay point and does
 * not overwrite the immutable snapshot for the day.
 *
 * See docs/performance-curve-audit.md for the architecture rationale.
 */

import { zeninFetchJson } from "./zeninFetch";

// Interval -> lookback window (calendar days). "ALL"/"YTD" handled specially.
const INTERVAL_DAYS = {
  "1D": 1,
  "1W": 7,
  "1M": 31,
  "3M": 93,
  "6M": 186,
  YTD: null, // computed to Jan 1 of current year
  "1Y": 366,
  "3Y": 1096,
  "5Y": 1827,
  ALL: null // no lower bound (uses earliest snapshot)
};

function isoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resolve the [start,end] ISO date window for a given interval.
 * ALL returns start=null so the caller requests from a floor date.
 */
export function resolveRange(interval, now = new Date()) {
  const end = isoDate(now);
  if (interval === "YTD") {
    return { start: `${now.getUTCFullYear()}-01-01`, end };
  }
  if (interval === "ALL") {
    // Floor far enough back; backend clamps to earliest snapshot anyway.
    return { start: "2000-01-01", end };
  }
  const days = INTERVAL_DAYS[interval] ?? 31;
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: isoDate(startDate), end };
}

/**
 * Fetch immutable daily snapshots for the interval. Returns a normalized array:
 *   { date, ts, portfolioValue, cash, investedCapital, dailyPnl, dailyReturn,
 *     benchmarkValue, benchmarkReturn, deposits, withdrawals, estimated }
 * Weekends/holidays are carried-forward rows (estimated=true) from the engine.
 */
export async function fetchPerformanceHistory(interval, { signal } = {}) {
  const { start, end } = resolveRange(interval);
  const data = await zeninFetchJson(
    `/api/history/range?start=${start}&end=${end}`,
    { signal }
  );
  const rows = (data && Array.isArray(data.snapshots)) ? data.snapshots : [];
  return rows
    .map((r) => ({
      date: r.date,
      ts: new Date(`${r.date}T00:00:00Z`).getTime(),
      portfolioValue: Number(r.portfolioValue) || 0,
      cash: Number(r.cash) || 0,
      investedCapital: Number(r.investedCapital) || 0,
      dailyPnl: Number(r.dailyPnl) || 0,
      dailyReturn: Number(r.dailyReturn) || 0,
      benchmarkValue: r.benchmarkValue == null ? null : Number(r.benchmarkValue),
      benchmarkReturn: r.benchmarkReturn == null ? null : Number(r.benchmarkReturn),
      deposits: Number(r.deposits) || 0,
      withdrawals: Number(r.withdrawals) || 0,
      estimated: Boolean(r.estimated),
      source: r.source || "portfolio_daily_snapshots"
    }))
    .filter((r) => Number.isFinite(r.ts))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Build the equity-curve series from snapshots. Each point is a REAL snapshot
 * date; no interpolation. mode: "equity" | "pnl" | "percentage".
 * `liveEquity` (optional) appends a distinct trailing point for "today live"
 * WITHOUT mutating the last immutable snapshot.
 */
export function buildEquitySeries(snapshots, mode = "equity", { baseValue } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return [];
  const base = Number.isFinite(baseValue)
    ? baseValue
    : (snapshots[0]?.portfolioValue || 0);
  return snapshots.map((s) => {
    let value;
    if (mode === "percentage") value = base ? ((s.portfolioValue - base) / base) * 100 : 0;
    else if (mode === "pnl") value = s.portfolioValue - base;
    else value = s.portfolioValue;
    return [s.ts, Number(Number(value).toFixed(2))];
  });
}

/**
 * Build the benchmark series from REAL stored benchmark closes. Rebased so the
 * benchmark starts at the same base as the portfolio (equity mode) or 0
 * (pnl/percentage). Points with a null benchmarkValue are skipped — the curve
 * shows a gap rather than a fabricated value.
 */
export function buildBenchmarkSeries(snapshots, mode = "equity", { baseValue } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return [];
  const priced = snapshots.filter((s) => s.benchmarkValue != null);
  if (priced.length === 0) return [];
  const benchBase = priced[0].benchmarkValue;
  const portBase = Number.isFinite(baseValue) ? baseValue : (snapshots[0]?.portfolioValue || 0);
  return priced.map((s) => {
    const growth = benchBase ? s.benchmarkValue / benchBase : 1;
    let value;
    if (mode === "percentage") value = (growth - 1) * 100;
    else if (mode === "pnl") value = portBase * (growth - 1);
    else value = portBase * growth;
    return [s.ts, Number(Number(value).toFixed(2))];
  });
}

// ---------------------------------------------------------------------------
// Performance metrics derived from immutable snapshots (never from trades).
// ---------------------------------------------------------------------------

/** Time-Weighted Return: geometric link of daily returns, neutralizes flows. */
export function timeWeightedReturn(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return 0;
  let product = 1;
  for (const s of snapshots) {
    // Reconstruct flow-neutral daily return: (V_end - flow) / V_start - 1.
    // dailyReturn stored already excludes intraday flows in this engine, but we
    // guard against deposits distorting it by recomputing when flows exist.
    const flow = (s.deposits || 0) - (s.withdrawals || 0);
    if (flow !== 0 && s.portfolioValue) {
      const start = s.portfolioValue - s.dailyPnl;
      const r = start ? (s.portfolioValue - flow - start) / start : 0;
      product *= 1 + r;
    } else {
      product *= 1 + (s.dailyReturn || 0);
    }
  }
  return (product - 1) * 100;
}

/**
 * Money-Weighted Return (approx. IRR) via Newton's method over daily cash flows.
 * Flow convention: deposits are negative cash flows (money in), withdrawals
 * positive, final portfolio value is a positive terminal flow.
 */
export function moneyWeightedReturn(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return 0;
  const start = snapshots[0];
  const end = snapshots[snapshots.length - 1];
  const days = Math.max(1, (end.ts - start.ts) / (24 * 60 * 60 * 1000));
  // Cash flows as {t (years), amount}. Initial investment = starting value.
  const flows = [{ t: 0, amount: -start.portfolioValue }];
  for (const s of snapshots) {
    const flow = (s.deposits || 0) - (s.withdrawals || 0);
    if (flow !== 0) {
      const t = (s.ts - start.ts) / (365 * 24 * 60 * 60 * 1000);
      flows.push({ t, amount: -flow });
    }
  }
  flows.push({ t: days / 365, amount: end.portfolioValue });

  const npv = (rate) => flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + rate, f.t), 0);
  const dNpv = (rate) => flows.reduce((sum, f) => sum - (f.t * f.amount) / Math.pow(1 + rate, f.t + 1), 0);

  let rate = 0.1;
  for (let i = 0; i < 60; i += 1) {
    const v = npv(rate);
    const d = dNpv(rate);
    if (!Number.isFinite(d) || d === 0) break;
    const next = rate - v / d;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) { rate = next; break; }
    rate = Math.max(-0.9999, next);
  }
  return rate * 100;
}

/** Max drawdown (%) from the equity path. */
export function maxDrawdown(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return 0;
  let peak = -Infinity;
  let maxDd = 0;
  for (const s of snapshots) {
    if (s.portfolioValue > peak) peak = s.portfolioValue;
    if (peak > 0) {
      const dd = (s.portfolioValue - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return maxDd * 100;
}

/** Annualized volatility (%) from daily returns. */
export function volatility(snapshots) {
  const rets = (snapshots || []).map((s) => s.dailyReturn || 0);
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Annualized Sharpe (rf=0). */
export function sharpeRatio(snapshots) {
  const rets = (snapshots || []).map((s) => s.dailyReturn || 0);
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  return sd ? (mean / sd) * Math.sqrt(252) : 0;
}

/** Sortino (downside deviation only, rf=0). */
export function sortinoRatio(snapshots) {
  const rets = (snapshots || []).map((s) => s.dailyReturn || 0);
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const downside = rets.filter((r) => r < 0);
  if (downside.length === 0) return 0;
  const dd = Math.sqrt(downside.reduce((a, b) => a + b ** 2, 0) / downside.length);
  return dd ? (mean / dd) * Math.sqrt(252) : 0;
}

/** Full metrics bundle from snapshots. */
export function computePerformanceMetrics(snapshots) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const rets = list.map((s) => s.dailyReturn || 0);
  const winDays = rets.filter((r) => r > 0).length;
  const best = list.reduce((m, s) => (s.dailyReturn > (m?.dailyReturn ?? -Infinity) ? s : m), null);
  const worst = list.reduce((m, s) => (s.dailyReturn < (m?.dailyReturn ?? Infinity) ? s : m), null);
  const mdd = maxDrawdown(list);
  const twr = timeWeightedReturn(list);
  const netDeposits = list.reduce((a, s) => a + (s.deposits || 0) - (s.withdrawals || 0), 0);
  const calmar = mdd ? twr / Math.abs(mdd) : 0;
  return {
    twr,
    mwr: moneyWeightedReturn(list),
    maxDrawdown: mdd,
    volatility: volatility(list),
    sharpe: sharpeRatio(list),
    sortino: sortinoRatio(list),
    calmar,
    winRate: rets.length ? (winDays / rets.length) * 100 : 0,
    bestDay: best ? { date: best.date, return: best.dailyReturn * 100 } : null,
    worstDay: worst ? { date: worst.date, return: worst.dailyReturn * 100 } : null,
    netContributions: netDeposits,
    tradingDays: list.filter((s) => !s.estimated).length,
    totalDays: list.length
  };
}
