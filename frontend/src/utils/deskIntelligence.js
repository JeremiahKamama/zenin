/**
 * Zenin — Desk Intelligence layer (Macro & Commodities Desk institutional upgrade).
 *
 * Pure, provider-agnostic derivations. These functions take ALREADY-NORMALIZED
 * desk state (regime label/score, macro indicator rows, risk indicators,
 * commodity rows) and produce the Executive Decision Layer + reusable
 * MarketSignal objects. They never fetch and never fabricate: when the inputs
 * are missing, they return honest "unavailable" shapes so the UI can hide the
 * panel (Phase 12/13 data-integrity rules).
 *
 * MarketSignal schema (Phase 5) — the shared unit of intelligence that flows to
 * Portfolio, Briefing, Predictions, Smart Alerts, Watchlists, Decision Engine:
 *   { id, title, category, severity, confidence, drivers, conflictingDrivers,
 *     affectedAssets, generatedAt, expiresAt, sourceCount, freshness }
 */

import { COMMODITY_GROUP_DEFS, COMMODITY_GROUP_ORDER } from "./commodityGroups";

const MACRO_SEVERITY = { expansion: "positive", goldilocks: "positive", recovery: "positive", slowdown: "warning", contraction: "negative", recession: "negative", inflationary: "warning", stagflation: "negative", "risk-off": "negative", "risk off": "negative" };

/** Normalize a freshness timestamp into a compact label + minutes-old number. */
export function freshnessFrom(updatedAt) {
  if (!updatedAt) return { label: "Unknown", minutes: null, stale: true };
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return { label: "Unknown", minutes: null, stale: true };
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  const stale = mins > 180;
  if (mins < 1) return { label: "Just now", minutes: mins, stale };
  if (mins < 60) return { label: `${mins} min ago`, minutes: mins, stale };
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return { label: `${hrs}h ago`, minutes: mins, stale };
  return { label: `${Math.round(hrs / 24)}d ago`, minutes: mins, stale };
}

/** Tone token for a macro regime label. */
export function regimeTone(label) {
  return MACRO_SEVERITY[String(label || "").toLowerCase()] || "neutral";
}

/**
 * Derive the Macro Executive Decision from existing state.
 * Returns null when there is not enough real data to state a decision.
 */
export function deriveMacroExecutive({ regimeLabel, regimeScore, regimeExplain, macroRows = [], riskRows = [], updatedAt } = {}) {
  const hasRegime = Boolean(regimeLabel);
  const hasRows = Array.isArray(macroRows) && macroRows.length > 0;
  if (!hasRegime && !hasRows) return null;

  const drivers = buildMacroDrivers(macroRows, riskRows);
  const confidence = computeConfidence({
    signalCount: drivers.length,
    scoreKnown: Number.isFinite(Number(regimeScore)),
    rowCount: macroRows.length,
    freshness: freshnessFrom(updatedAt),
  });
  const tone = regimeTone(regimeLabel);
  const tilt = macroTilt(regimeLabel);
  const risk = macroRiskLevel(riskRows, regimeLabel);

  return {
    regime: regimeLabel ? capitalize(regimeLabel) : "Unavailable",
    tone,
    confidence,
    tilt,
    risk,
    drivers,
    explain: regimeExplain || "",
    sourceCount: countSources(macroRows),
    freshness: freshnessFrom(updatedAt),
  };
}

/** Portfolio tilt suggestions keyed off regime (directional, not advice). */
function macroTilt(regimeLabel) {
  const r = String(regimeLabel || "").toLowerCase();
  if (r === "expansion" || r === "recovery" || r === "goldilocks") {
    return [{ dir: "up", label: "Equities (cyclical)" }, { dir: "down", label: "Long-duration bonds" }, { dir: "up", label: "Credit / risk" }];
  }
  if (r === "inflationary" || r === "stagflation") {
    return [{ dir: "up", label: "Commodities / real assets" }, { dir: "down", label: "Long-duration bonds" }, { dir: "up", label: "Value over growth" }];
  }
  if (r === "slowdown" || r === "contraction" || r === "recession" || r.includes("risk")) {
    return [{ dir: "down", label: "Equities (cyclical)" }, { dir: "up", label: "Long-duration bonds" }, { dir: "up", label: "Defensives / cash" }];
  }
  return [{ dir: "flat", label: "Neutral positioning" }];
}

function macroRiskLevel(riskRows = [], regimeLabel) {
  const elevated = (riskRows || []).filter((r) => /elevated|watch|tight/i.test(String(r?.status || r?.riskStatus || ""))).length;
  const r = String(regimeLabel || "").toLowerCase();
  if (elevated >= 2 || r.includes("risk") || r === "recession" || r === "stagflation") return "High";
  if (elevated === 1 || r === "slowdown" || r === "inflationary") return "Medium";
  return "Low";
}

/** Build driver checklist from macro rows: trend direction becomes a driver line. */
function buildMacroDrivers(macroRows = [], riskRows = []) {
  const drivers = [];
  for (const row of macroRows.slice(0, 8)) {
    const label = row?.indicator || row?.name;
    const trend = String(row?.trend || "").toLowerCase();
    if (!label || !trend) continue;
    const up = /up|rising|expan|accel|steep/.test(trend);
    const down = /down|falling|contract|decel|invert/.test(trend);
    if (!up && !down) continue;
    drivers.push({ label: `${label} ${up ? "improving" : "weakening"}`, positive: up });
  }
  return drivers.slice(0, 6);
}

/**
 * Derive the Commodities Executive Overview from existing commodity rows.
 * Returns null when no real rows exist.
 */
export function deriveCommoditiesExecutive({ rows = [], updatedAt } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const byGroup = groupReturns(rows);
  const ranked = Object.entries(byGroup).sort((a, b) => b[1].avg - a[1].avg);
  const leader = ranked[0];
  const theme = leader ? `${capitalize(leader[0])} leadership` : "Mixed";
  const states = ranked.map(([group, v]) => ({
    group: capitalize(group),
    state: v.avg > 0.5 ? "Strong" : v.avg < -0.5 ? "Weak" : "Neutral",
    tone: v.avg > 0.5 ? "positive" : v.avg < -0.5 ? "negative" : "neutral",
    avg: v.avg,
  }));
  const tilt = commodityTilt(states);
  const confidence = computeConfidence({ signalCount: states.length, scoreKnown: true, rowCount: rows.length, freshness: freshnessFrom(updatedAt) });
  return { theme, states, tilt, confidence, sourceCount: countSources(rows), freshness: freshnessFrom(updatedAt) };
}

function commodityTilt(states = []) {
  return states.slice(0, 3).map((s) => ({
    dir: s.tone === "positive" ? "up" : s.tone === "negative" ? "down" : "flat",
    label: `${s.tone === "positive" ? "Overweight" : s.tone === "negative" ? "Reduce" : "Monitor"} ${s.group}`,
  }));
}

function groupReturns(rows = []) {
  const acc = {};
  for (const row of rows) {
    const g = String(row?.group || "other").toLowerCase();
    const v = Number(row?.dailyChangePct);
    if (!Number.isFinite(v)) continue;
    if (!acc[g]) acc[g] = { sum: 0, n: 0, avg: 0 };
    acc[g].sum += v;
    acc[g].n += 1;
  }
  for (const g of Object.keys(acc)) acc[g].avg = acc[g].n ? acc[g].sum / acc[g].n : 0;
  return acc;
}

/** Confidence 0-100 from evidence breadth + freshness. Never claims certainty. */
export function computeConfidence({ signalCount = 0, scoreKnown = false, rowCount = 0, freshness } = {}) {
  let score = 30;
  score += Math.min(signalCount * 8, 32);
  score += Math.min(rowCount * 2, 20);
  if (scoreKnown) score += 8;
  if (freshness && !freshness.stale) score += 10;
  if (freshness && freshness.stale) score -= 15;
  return Math.max(5, Math.min(95, Math.round(score)));
}

function countSources(rows = []) {
  const s = new Set();
  for (const r of rows) if (r?.source) s.add(String(r.source));
  return s.size || 1;
}

function capitalize(s) {
  const str = String(s || "");
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Build a reusable MarketSignal (Phase 5 schema) from a derived executive object.
 * `kind` is "macro" | "commodities". Pure — safe to call in render/useMemo.
 */
export function buildMarketSignal(kind, exec) {
  if (!exec) return null;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (kind === "macro" ? 3 : 1) * 24 * 3600 * 1000);
  const drivers = kind === "macro"
    ? (exec.drivers || []).filter((d) => d.positive).map((d) => d.label)
    : (exec.states || []).filter((s) => s.tone === "positive").map((s) => `${s.group} strong`);
  const conflicting = kind === "macro"
    ? (exec.drivers || []).filter((d) => !d.positive).map((d) => d.label)
    : (exec.states || []).filter((s) => s.tone === "negative").map((s) => `${s.group} weak`);
  const affectedAssets = (exec.tilt || []).map((t) => ({ label: t.label, direction: t.dir }));
  return {
    id: `${kind}-signal-${now.toISOString().slice(0, 10)}`,
    title: kind === "macro" ? `Macro regime: ${exec.regime}` : `Commodity theme: ${exec.theme}`,
    category: kind,
    severity: kind === "macro" ? (exec.tone || "neutral") : "info",
    confidence: exec.confidence,
    drivers,
    conflictingDrivers: conflicting,
    affectedAssets,
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sourceCount: exec.sourceCount || 1,
    freshness: exec.freshness?.label || "Unknown",
  };
}

/* ============================================================
 * Commodity Allocation Guidance — dynamic recommendations.
 *
 * PURE derivation from real commodity rows (terminalRows). No backend
 * allocation endpoint exists, so we generate from normalized signals:
 *   dailyChangePct, ytdChangePct, slope (curve), inventory/demand strings.
 * Never hardcoded; when rows are empty we return [] so the UI shows the
 * honest "No high-conviction changes detected" empty state.
 *
 * Each recommendation carries enough metadata to render a full drawer:
 *   title, dir (increase|reduce|monitor|watch|review), confidence (with
 *   band High/Med/Low), signal, horizon, groups (filter keys), commodities,
 *   supportingAssets, drivers (evidence bullets), catalysts, events,
 *   updatedAt, sourceCount.
 * ============================================================ */

const REGISTRY_GROUPS = COMMODITY_GROUP_ORDER.filter((g) => g !== "all");

function signConfidence(score) {
  if (score >= 80) return "High";
  if (score >= 60) return "Medium";
  return "Low";
}

/**
 * Build a recommendation for one commodity group from its rows.
 * Returns null when there is no conviction (mixed/flat signal).
 * Group matching is registry-driven: rows carry lowercase keys
 * (e.g. "industrial") that map to COMMODITY_GROUP_DEFS.
 */
function buildGroupRecommendation(groupKey, rows, regime) {
  const inGroup = (rows || []).filter((r) => String(r.group || r.category || "").toLowerCase() === groupKey.toLowerCase());
  if (!inGroup.length) return null;
  const groupLabel = (COMMODITY_GROUP_DEFS[groupKey] && COMMODITY_GROUP_DEFS[groupKey].label) || groupKey;

  const dailies = inGroup.map((r) => Number(r.dailyChangePct)).filter((n) => Number.isFinite(n));
  const ytd = inGroup.map((r) => Number(r.ytdChangePct)).filter((n) => Number.isFinite(n));
  const slopes = inGroup.map((r) => Number(r.slope)).filter((n) => Number.isFinite(n));
  const avgDaily = dailies.length ? dailies.reduce((a, b) => a + b, 0) / dailies.length : 0;
  const avgYtd = ytd.length ? ytd.reduce((a, b) => a + b, 0) / ytd.length : 0;
  const avgSlope = slopes.length ? slopes.reduce((a, b) => a + b, 0) / slopes.length : 0;

  // Inventory / demand strings (real fields from terminalRows)
  const invBull = inGroup.some((r) => /draw|tight|low|deficit|decline/i.test(String(r.inventory || "")));
  const invBear = inGroup.some((r) => /build|surplus|high|rising|abundant/i.test(String(r.inventory || "")));
  const demBull = inGroup.some((r) => /strong|improving|firm|recovering|stabil/i.test(String(r.demand || "")));

  // Conviction score: blend momentum + curve + inventory/regime
  let score = 50;
  score += avgYtd * 4;            // trend
  score += avgDaily * 8;          // recent momentum
  score += avgSlope * 3;          // curve slope (backwardation = +)
  if (invBull) score += 8;
  if (invBear) score -= 8;
  if (demBull) score += 6;
  if (/expansion|recovery|goldilocks/i.test(String(regime || ""))) score += 6;
  if (/slowdown|contraction|recession|stagflation/i.test(String(regime || ""))) score -= 6;
  score = Math.max(35, Math.min(95, Math.round(score)));

  // Direction
  let dir = "monitor";
  if (score >= 75 && (avgYtd > 2 || avgSlope > 0)) dir = "increase";
  else if (score >= 70 && avgYtd > 0) dir = "monitor";
  else if (score <= 55 && (avgYtd < -2 || avgSlope < 0)) dir = "reduce";
  else if (avgYtd < 0 && score < 65) dir = "watch";

  // Only surface high-conviction actions; weak ones stay "monitor" (not shown as cards)
  const isAction = dir === "increase" || dir === "reduce";
  if (!isAction && score < 72) return null;

  const signal = dir === "increase" ? "Bullish" : dir === "reduce" ? "Bearish" : dir === "monitor" ? "Neutral" : "Watch";
  const horizon = dir === "increase" || dir === "reduce" ? "1–3 months" : "Monitoring";
  const commodities = inGroup.map((r) => r.symbol || r.asset).filter(Boolean).slice(0, 6);

  const drivers = [];
  if (Number.isFinite(avgYtd) && Math.abs(avgYtd) >= 1) drivers.push(`${avgYtd >= 0 ? "Positive" : "Negative"} YTD trend (${avgYtd.toFixed(1)}%)`);
  if (Number.isFinite(avgSlope) && avgSlope !== 0) drivers.push(`${avgSlope > 0 ? "Backwardation" : "Contango"} curve structure`);
  if (invBull) drivers.push("Falling / tight inventories");
  if (invBear) drivers.push("Rising inventories");
  if (demBull) drivers.push("Improving demand signal");
  if (drivers.length === 0) drivers.push("Mixed momentum, no clear catalyst");

  return {
    id: `alloc-${groupKey.toLowerCase().replace(/\s+/g, "-")}`,
    title: dir === "increase" ? `Increase ${groupLabel} Exposure`
      : dir === "reduce" ? `Reduce ${groupLabel} Exposure`
      : `Monitor ${groupLabel}`,
    dir,
    group: groupLabel,
    groupKey,
    groups: [groupKey],
    confidence: score,
    confidenceBand: signConfidence(score),
    signal,
    horizon,
    commodities,
    supportingAssets: [], // populated by desk where known (XLE etc.) — omitted if unknown
    drivers,
    catalysts: [],
    events: [],
    updatedAt: inGroup[0]?.asOf || null,
    sourceCount: inGroup.length,
    suggestedExposureDelta: dir === "increase" ? 3 : dir === "reduce" ? -2 : 0,
    currentExposurePct: null, // not known client-side; drawer shows "—" honestly
  };
}

/**
 * Generate the full allocation-guidance list from commodity rows.
 * Dynamic + memoizable (pure). Empty rows -> [].
 */
export function buildCommodityAllocation(rows = [], regime = null) {
  const list = REGISTRY_GROUPS
    .map((g) => buildGroupRecommendation(g, rows, regime))
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
  return list;
}
