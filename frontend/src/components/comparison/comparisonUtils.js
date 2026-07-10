// Pure helpers for the Asset Comparison workspace.
// No fabricated data: every formatter returns "—" when the source is missing.

export const COMPARISON_WINDOWS = [
  { key: "1D", label: "1 Day", days: 1 },
  { key: "1W", label: "1 Week", days: 7 },
  { key: "1M", label: "1 Month", days: 30 },
  { key: "3M", label: "3 Months", days: 91 },
  { key: "YTD", label: "YTD", days: null },
  { key: "1Y", label: "1 Year", days: 365 },
  { key: "3Y", label: "3 Years", days: 1095 },
  { key: "5Y", label: "5 Years", days: 1825 },
  { key: "MAX", label: "Maximum", days: null }
];

export function fmtNum(value, opts = {}) {
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (opts.currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: opts.currency, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    }
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: opts.maxFrac ?? 2 });
}

export function fmtPct(value, withSign = true) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const sign = withSign && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtMultiple(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(2)}x`;
}

// history: [{ t: epochMs, c: close }] sorted ascending
function valueAt(history, targetTime) {
  if (!Array.isArray(history) || history.length === 0) return null;
  let lo = 0;
  let hi = history.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (history[mid].t < targetTime) lo = mid + 1;
    else hi = mid;
  }
  // pick nearest
  const cand = history[lo];
  if (!cand) return null;
  return Number(cand.c);
}

function ytdStart() {
  const now = new Date();
  return new Date(now.getFullYear(), 0, 1).getTime();
}

// Compute pct change for each window from a history series.
export function computeReturns(history) {
  const out = {};
  if (!Array.isArray(history) || history.length < 2) {
    for (const w of COMPARISON_WINDOWS) out[w.key] = null;
    return out;
  }
  const last = history[history.length - 1];
  const lastTime = last.t;
  const lastVal = Number(last.c);
  if (!Number.isFinite(lastVal) || lastVal === 0) {
    for (const w of COMPARISON_WINDOWS) out[w.key] = null;
    return out;
  }
  for (const w of COMPARISON_WINDOWS) {
    let refTime;
    if (w.key === "YTD") refTime = ytdStart();
    else if (w.key === "MAX") refTime = history[0].t;
    else refTime = lastTime - w.days * 86400000;
    const refVal = valueAt(history, refTime);
    if (refVal === null || !Number.isFinite(refVal) || refVal === 0) {
      out[w.key] = null;
      continue;
    }
    out[w.key] = ((lastVal - refVal) / Math.abs(refVal)) * 100;
  }
  return out;
}

// Given two numeric values, decide a winner for a "higher is better" metric.
// Returns "A" | "B" | "tie" | null (null when either is missing).
export function metricWinner(a, b, higherIsBetter = true) {
  const na = a === null || a === undefined || !Number.isFinite(Number(a));
  const nb = b === null || b === undefined || !Number.isFinite(Number(b));
  if (na || nb) return null;
  const av = Number(a);
  const bv = Number(b);
  if (av === bv) return "tie";
  const aWins = higherIsBetter ? av > bv : av < bv;
  return aWins ? "A" : "B";
}

// Diff string for a metric (how much A beats B). From A's perspective.
export function metricDiff(a, b, kind = "pct") {
  const na = a === null || a === undefined || !Number.isFinite(Number(a));
  const nb = b === null || b === undefined || !Number.isFinite(Number(b));
  if (na || nb) return "—";
  const d = Number(a) - Number(b);
  if (kind === "pct") return fmtPct(d);
  if (kind === "multiple") return `${d >= 0 ? "+" : ""}${d.toFixed(2)}x`;
  return `${d >= 0 ? "+" : ""}${d.toFixed(2)}`;
}

export function gradeForScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s >= 85) return "A";
  if (s >= 70) return "B";
  if (s >= 50) return "C";
  return "D";
}

export function riskLevel(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s < 34) return "Low";
  if (s < 67) return "Medium";
  return "High";
}

// Build the vNext Decision Matrix from two comparison-asset payloads.
// Each row's `winner` is DERIVED from the data (never asserted), with an
// evidence string and confidence. Rows are ordered by spec weight.
// Returns rows consumable by ComparisonMatrix: { id, label, weight, winner,
// confidence, a:{display,evidence}, b:{display,evidence}, explanation }.
export function buildDecisionMatrix(a, b) {
  if (!a || !b) return [];
  const defs = [
    { id: "valuation", label: "Valuation", weight: 3, higher: false,
      a: (x) => x.earnings?.valuation?.trailingPe ?? x.finviz?.pe ?? null,
      b: (x) => x.earnings?.valuation?.fwdPe ?? x.finviz?.forwardPe ?? null,
      fmt: fmtMultiple, ev: (v) => (v != null ? `${fmtMultiple(v)} P/E` : "no P/E") },
    { id: "growth", label: "Growth", weight: 4, higher: true,
      a: (x) => x.earnings?.growth?.revenueGrowth ?? x.finviz?.revenueGrowth ?? null,
      b: (x) => x.earnings?.growth?.earningsGrowth ?? x.finviz?.earningsGrowth ?? null,
      fmt: fmtPct, ev: (v) => (v != null ? `rev growth ${fmtPct(v)}` : "no growth") },
    { id: "profitability", label: "Profitability", weight: 4, higher: true,
      a: (x) => x.earnings?.profitability?.operatingMargin ?? x.finviz?.operatingMargin ?? null,
      b: (x) => x.earnings?.profitability?.netMargin ?? x.finviz?.netMargin ?? null,
      fmt: fmtPct, ev: (v) => (v != null ? `margin ${fmtPct(v)}` : "no margin") },
    { id: "moat", label: "Moat", weight: 5, higher: true,
      a: (x) => x.finviz?.moatScore ?? x.earnings?.quality?.moatScore ?? null,
      b: (x) => x.finviz?.moatScore ?? x.earnings?.quality?.moatScore ?? null,
      fmt: (v) => (v == null ? "—" : `${v}/100`),
      ev: (v) => (v != null ? `moat ${v}/100` : "no moat score") },
    { id: "execution", label: "Execution", weight: 4, higher: true,
      a: (x) => x.earnings?.quality?.roe ?? x.finviz?.roe ?? null,
      b: (x) => x.earnings?.quality?.roe ?? x.finviz?.roe ?? null,
      fmt: fmtPct, ev: (v) => (v != null ? `ROE ${fmtPct(v)}` : "no ROE") },
    { id: "risk", label: "Risk", weight: 3, higher: false,
      a: (x) => x.beta ?? x.finviz?.beta ?? null,
      b: (x) => x.beta ?? x.finviz?.beta ?? null,
      fmt: (v) => (v == null ? "—" : v.toFixed(2)),
      ev: (v) => (v != null ? `beta ${v.toFixed(2)}` : "no beta") },
    { id: "volatility", label: "Volatility", weight: 2, higher: false,
      a: (x) => (x.returns?.YTD != null ? Math.abs(x.returns.YTD) : null),
      b: (x) => (x.returns?.YTD != null ? Math.abs(x.returns.YTD) : null),
      fmt: (v) => (v == null ? "—" : `${(v).toFixed(1)}%`),
      ev: (v) => (v != null ? `YTD move ${v.toFixed(1)}%` : "no history") },
    { id: "liquidity", label: "Liquidity", weight: 2, higher: true,
      a: (x) => x.marketCap ?? null, b: (x) => x.marketCap ?? null,
      fmt: (v) => (v == null ? "—" : fmtNum(v, { currency: "USD", maxFrac: 0 })),
      ev: (v) => (v != null ? `mkt cap ${fmtNum(v / 1e9, { maxFrac: 0 })}B` : "no cap") },
  ];
  return defs.map((d) => {
    const av = d.a(a);
    const bv = d.b(b);
    const winner = metricWinner(av, bv, d.higher);
    const evidenceA = d.ev(av);
    const evidenceB = d.ev(bv);
    let explanation = "Insufficient data for this dimension.";
    if (winner === "A") explanation = `${a.symbol}: ${evidenceA} vs ${b.symbol}: ${evidenceB} — ${a.symbol} leads on ${d.label.toLowerCase()}.`;
    else if (winner === "B") explanation = `${b.symbol}: ${evidenceB} vs ${a.symbol}: ${evidenceA} — ${b.symbol} leads on ${d.label.toLowerCase()}.`;
    else if (winner === "tie") explanation = `Comparable ${d.label.toLowerCase()} (${evidenceA} ≈ ${evidenceB}).`;
    const confidence = winner && winner !== "tie" ? Math.min(95, 55 + d.weight * 5) : 50;
    return {
      id: d.id, label: d.label, weight: d.weight, winner, confidence,
      a: { display: d.fmt(av), evidence: evidenceA },
      b: { display: d.fmt(bv), evidence: evidenceB },
      explanation,
    };
  });
}

// Aggregate a weighted verdict from the matrix rows. Returns
// { winner: symbol|"tie", confidence: number, reasons: string[] } or null.
export function aggregateVerdict(rows, symbolA, symbolB) {
  if (!rows.length) return null;
  let scoreA = 0, scoreB = 0, weightTotal = 0;
  const reasons = [];
  for (const r of rows) {
    const w = Number(r.weight) || 1;
    weightTotal += w;
    if (r.winner === "A") { scoreA += w; reasons.push(`${r.label}: ${symbolA} (${r.confidence}% conf)`); }
    else if (r.winner === "B") { scoreB += w; reasons.push(`${r.label}: ${symbolB} (${r.confidence}% conf)`); }
  }
  if (!weightTotal) return null;
  const winner = scoreA === scoreB ? "tie" : scoreA > scoreB ? symbolA : symbolB;
  const confidence = Math.round((Math.max(scoreA, scoreB) / weightTotal) * 100);
  return { winner, confidence, reasons };
}
