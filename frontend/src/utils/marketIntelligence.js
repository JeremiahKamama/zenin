/**
 * Zenin — Internal Market Intelligence layer (Equities Desk v2, Phase 7).
 *
 * Provider-agnostic calculations. These functions take already-normalized
 * Zenin models and never touch a provider directly — the backend adapter layer
 * (Massive / FMP / Yahoo / MyStocks Africa) is the only place that knows about
 * sources. Everything here works for any region, country, or exchange once the
 * input rows carry the expected normalized fields.
 *
 * All functions are pure and side-effect free so they can be unit-tested and
 * reused by every widget (Market Health, Market Participation, Corporate
 * Activity, Market Concentration, Exchange Health, Country Rotation, etc.).
 */

/** Advance / Decline ratio from a list of { changePct } rows. */
export function advanceDecline(rows = []) {
  let adv = 0;
  let dec = 0;
  let unc = 0;
  for (const r of rows) {
    const v = Number(r?.changePct ?? r?.change ?? NaN);
    if (!Number.isFinite(v)) unc += 1;
    else if (v > 0) adv += 1;
    else if (v < 0) dec += 1;
    else unc += 1;
  }
  const total = adv + dec || 1;
  return {
    advancers: adv,
    decliners: dec,
    unchanged: unc,
    ratio: dec === 0 ? (adv === 0 ? 0 : Infinity) : adv / dec,
    breadthPct: Math.round((adv / total) * 100),
    adLine: adv - dec,
  };
}

/** 52-week highs / lows from rows carrying { weeksHigh, weeksLow } booleans or prices. */
export function weekHighsLows(rows = []) {
  let highs = 0;
  let lows = 0;
  for (const r of rows) {
    if (r?.week52High || r?.newHigh) highs += 1;
    if (r?.week52Low || r?.newLow) lows += 1;
  }
  return { highs, lows, net: highs - lows };
}

/**
 * Relative strength vs a benchmark series.
 * `series` and `bench` are arrays of prices ordered oldest → newest.
 * Returns the ratio of normalized performance (asset / benchmark) - 1, in %.
 */
export function relativeStrength(series = [], bench = []) {
  const a = lastValid(series);
  const b = lastValid(bench);
  if (a == null || b == null) return null;
  const firstA = firstValid(series);
  const firstB = firstValid(bench);
  if (firstA == null || firstB == null || firstA === 0 || firstB === 0) return null;
  const assetRet = a / firstA - 1;
  const benchRet = b / firstB - 1;
  return Math.round(((assetRet - benchRet) * 100) * 100) / 100; // basis points-ish, in %
}

/** Market breadth score 0-100 from advancers/decliners (0.5 = neutral). */
export function breadthScore(rows = []) {
  const { advancers, decliners } = advanceDecline(rows);
  const total = advancers + decliners;
  if (total === 0) return 50;
  return Math.round((advancers / total) * 100);
}

/**
 * Market concentration (HHI-style). `weights` is an array of market-cap weights
 * (already fractional or percent). Returns { hhi, topShare, topName }.
 */
export function marketConcentration(holds = []) {
  const valid = holds
    .map((h) => ({ name: h?.name ?? h?.symbol, w: Number(h?.weight ?? h?.weightPct ?? 0) }))
    .filter((h) => Number.isFinite(h.w) && h.w > 0);
  if (!valid.length) return { hhi: 0, topShare: 0, topName: null };
  let denom = valid.reduce((s, h) => s + h.w, 0) || 1;
  const shares = valid.map((h) => h.w / denom);
  const hhi = shares.reduce((s, x) => s + x * x, 0);
  const top = valid.slice().sort((a, b) => b.w - a.w)[0];
  return {
    hhi: Math.round(hhi * 10000), // 0-10000 scale (classic HHI)
    topShare: Math.round((top.w / denom) * 1000) / 10,
    topName: top.name,
  };
}

/** Simple liquidity score 0-100 from median volume vs a peer median volume. */
export function liquidityScore(volumes = []) {
  const nums = volumes.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length < 2) return nums.length ? 50 : 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1] || 1;
  return Math.round((median / max) * 100);
}

/** Country / region rotation: rank sub-groups by return. */
export function rotationRank(groups = []) {
  return groups
    .map((g) => ({ key: g?.key ?? g?.code ?? g?.name, name: g?.name, ret: Number(g?.returnPct ?? g?.changePct ?? NaN) }))
    .filter((g) => Number.isFinite(g.ret))
    .sort((a, b) => b.ret - a.ret);
}

/** Market momentum: sign + magnitude of an aggregate return series. */
export function marketMomentum(series = []) {
  const first = firstValid(series);
  const last = lastValid(series);
  if (first == null || last == null || first === 0) return { pct: 0, direction: "flat" };
  const pct = Math.round(((last / first - 1) * 100) * 100) / 100;
  return { pct, direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

/** Volatility regime from a series of returns (stdev of periodic returns). */
export function volatilityRegime(returns = []) {
  const nums = returns.map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return { stdev: 0, regime: "low" };
  const mean = nums.reduce((s, n) => s + n, 0) / nums.length;
  const variance = nums.reduce((s, n) => s + (n - mean) ** 2, 0) / nums.length;
  const stdev = Math.sqrt(variance);
  return { stdev: Math.round(stdev * 10000) / 10000, regime: stdev > 0.025 ? "high" : stdev > 0.012 ? "medium" : "low" };
}

/** Institutional flow score: net flow direction normalized to -100..100. */
export function institutionalFlowScore(flows = []) {
  let net = 0;
  let total = 0;
  for (const f of flows) {
    const v = Number(f?.netFlow ?? f?.flow ?? NaN);
    if (!Number.isFinite(v)) continue;
    net += v;
    total += Math.abs(v);
  }
  if (total === 0) return 0;
  return Math.round((net / total) * 100);
}

function firstValid(arr) {
  for (const v of arr) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return arr.length ? Number(arr[0]) : null;
}
function lastValid(arr) {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const n = Number(arr[i]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
