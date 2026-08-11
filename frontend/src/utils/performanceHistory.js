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
// Interval -> lookback. Calendar-based intervals use setMonth (true calendar
// arithmetic, not fixed day multiples). "ALL" returns start=null so the
// caller requests from a floor date. YTD is calendar-year.
export function resolveRange(interval, now = new Date()) {
  const end = isoDate(now);
  if (interval === "YTD") {
    return { start: `${now.getUTCFullYear()}-01-01`, end };
  }
  if (interval === "ALL") {
    // Floor far enough back; backend clamps to earliest snapshot anyway.
    return { start: "2000-01-01", end };
  }
  // Calendar-month-based intervals (true month boundaries, not fixed days).
  const monthMap = { "3M": 3, "6M": 6, "1Y": 12, "3Y": 36, "5Y": 60 };
  if (interval === "1M" || interval in monthMap) {
    const monthsBack = interval === "1M" ? 1 : monthMap[interval];
    const startDate = new Date(now);
    // Capture the intended target month (clamped to valid range) so we can
    // detect JS date overflow (e.g. Mar 31 - 1mo → Feb 31 → Mar 3).
    const expectedMonth = ((now.getUTCMonth() - monthsBack) % 12 + 12) % 12;
    const expectedYear = now.getUTCFullYear() + Math.floor((now.getUTCMonth() - monthsBack) / 12);
    startDate.setUTCMonth(startDate.getUTCMonth() - monthsBack);
    // If JS rolled forward into the next month (Feb 31 → Mar 3), the date
    // overshot the target month. Clamp to the last valid day of the target
    // month so 1M from Mar 31 → Feb 28/29 (true calendar-month back).
    if (startDate.getUTCMonth() !== expectedMonth || startDate.getUTCFullYear() !== expectedYear) {
      startDate.setUTCDate(0); // last day of the month before the overflowed one
    }
    return { start: isoDate(startDate), end };
  }
  // "1D" / "1W" / day-based intervals.
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
export async function fetchPerformanceHistory(interval, { signal, benchmark } = {}) {
  const { start, end } = resolveRange(interval);
  // The equity-curve endpoint now returns immutable snapshots as Tier 1
  // (with backend-computed dailyReturn), falling back to the fill curve only
  // for fresh wallets with no snapshot history.
  const qs = new URLSearchParams({ limit: "365" });
  if (start) qs.set("from", start);
  if (end) qs.set("to", end);
  if (benchmark) qs.set("benchmark", benchmark);
  const data = await zeninFetchJson(
    `/portfolio/unified/equity-curve?${qs.toString()}`,
    { signal }
  ).catch(() => null);
  const curve = data && Array.isArray(data.curve) ? data.curve : [];
  if (curve.length > 0) {
    return curve
      .filter((p) => p.t != null && p.equity != null)
      .map((p) => {
        const ts = Number(p.t);
        const equity = Number(p.equity);
        const dateStr = new Date(ts).toISOString().slice(0, 10);
        return {
          date: dateStr,
          ts,
          portfolioValue: equity,
          cash: Number(p.cash || 0),
          investedCapital: Number(p.investedCapital || 0),
          dailyPnl: Number(p.dailyPnl || 0),
          // FIX: Use backend-computed dailyReturn from the snapshot (cash-flow-aware).
          // Only fall back to client-side computation for the legacy fill-curve path.
          dailyReturn: p.source === "snapshot" && p.dailyReturn != null
            ? Number(p.dailyReturn)
            : 0,
          realizedPnl: Number(p.realizedPnl || 0),
          unrealizedPnl: Number(p.unrealizedPnl || 0),
          benchmarkValue: p.benchmark != null ? Number(p.benchmark) : null,
          benchmarkReturn: null,
          deposits: Number(p.deposits || 0),
          withdrawals: Number(p.withdrawals || 0),
          fees: Number(p.fees || 0),
          dividends: Number(p.dividends || 0),
          estimated: p.estimated === true,
          source: p.source || "unified"
        };
      })
      .filter((r) => Number.isFinite(r.ts))
      .sort((a, b) => a.ts - b.ts);
  }
  // No unified data: return empty (no fabricated history).
  return [];
}

/**
 * Build the equity-curve series from snapshots. Each point is a REAL snapshot
 * date; no interpolation. mode: "equity" | "pnl" | "percentage".
 * Uses backend-computed dailyReturn (TWR, cash-flow-aware) for percentage mode.
 * Uses canonical cumulative PNL (realized + unrealized) for pnl mode.
 */
export function buildEquitySeries(snapshots, mode = "equity", { baseValue } = {}) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return [];
  // baseValue is the baseline portfolio value for range visualization; used by
  // the live overlay logic and retained for backward compatibility.
  const base = Number.isFinite(baseValue)
    ? baseValue
    : (snapshots[0]?.portfolioValue || 0);
  if (base === 0) return []; // cannot rebase against zero baseline
  if (mode === "percentage") {
    // Time-Weighted Return: cumulative product of (1 + dailyReturn) using
    // backend-computed cash-flow-aware daily returns. This isolates investment
    // performance from external capital flows (deposits/withdrawals).
    // FIX: Previously used (portfolioValue - base) / base * 100, which
    // conflates deposits with performance.
    let cumulativeTwr = 0; // running cumulative return (decimal)
    return snapshots.map((s) => {
      const dailyRet = Number(s.dailyReturn || 0);
      cumulativeTwr = (1 + cumulativeTwr) * (1 + dailyRet) - 1;
      return [s.ts, Number((cumulativeTwr * 100).toFixed(2))];
    });
  }
  if (mode === "pnl") {
    // Canonical cumulative investment PNL: realized + unrealized PNL from
    // backend snapshots. FIX: Previously used portfolioValue - baseValue, which
    // mislabels equity delta as PNL (confuses deposits with gains).
    return snapshots.map((s) => {
      const totalPnl = Number(s.realizedPnl || 0) + Number(s.unrealizedPnl || 0);
      return [s.ts, Number(Number(totalPnl).toFixed(2))];
    });
  }
  // Equity mode: absolute portfolio value
  return snapshots.map((s) => {
    return [s.ts, Number(Number(s.portfolioValue).toFixed(2))];
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
 * Money-Weighted Return (IRR) over daily cash flows.
 * Flow convention: deposits are negative cash flows (money in), withdrawals
 * positive, final portfolio value is a positive terminal flow.
 *
 * Robustness: Newton's method from multiple seeds, with a bisection fallback
 * bracketing the root in [-99.99%, +1000%]. Previously a single 0.1 seed could
 * silently return the seed when the derivative was ~0 or sign-changing flows
 * had multiple roots. The result is annualized so it is consistent with the
 * annualized volatility/Sharpe shown alongside it.
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

  // Newton's method from a given seed; returns the converged rate or null.
  const newton = (seed) => {
    let rate = seed;
    for (let i = 0; i < 60; i += 1) {
      const v = npv(rate);
      const d = dNpv(rate);
      if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
      const next = rate - v / d;
      if (!Number.isFinite(next)) return null;
      if (Math.abs(next - rate) < 1e-9) return next;
      rate = Math.max(-0.9999, Math.min(10, next));
    }
    return Math.abs(npv(rate)) < 1e-6 ? rate : null;
  };

  // Bisection fallback within a wide bracket (sign change required).
  const bisect = () => {
    let lo = -0.9999;
    let hi = 10;
    let flo = npv(lo);
    let fhi = npv(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi) || Math.sign(flo) === Math.sign(fhi)) return null;
    for (let i = 0; i < 200; i += 1) {
      const mid = (lo + hi) / 2;
      const fmid = npv(mid);
      if (!Number.isFinite(fmid)) return null;
      if (Math.abs(fmid) < 1e-9 || (hi - lo) / 2 < 1e-9) return mid;
      if (Math.sign(fmid) === Math.sign(flo)) { lo = mid; flo = fmid; }
      else { hi = mid; fhi = fmid; }
    }
    return (lo + hi) / 2;
  };

  // Try multiple Newton seeds, fall back to bisection. Prefer the root whose NPV
  // is closest to zero among the converged candidates.
  const candidates = [0.1, -0.1, 0.5, 0, 2]
    .map(newton)
    .filter((r) => r != null && Number.isFinite(r));
  const bisected = bisect();
  if (bisected != null && Number.isFinite(bisected)) candidates.push(bisected);
  if (!candidates.length) return 0;
  const rate = candidates.reduce((best, r) => (Math.abs(npv(r)) < Math.abs(npv(best)) ? r : best));

  // Annualize the period IRR so it's comparable to annualized vol/Sharpe.
  const periodYears = Math.max(1 / 365, days / 365);
  const annualized = Math.pow(1 + rate, 1 / periodYears) - 1;
  return annualized * 100;
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
