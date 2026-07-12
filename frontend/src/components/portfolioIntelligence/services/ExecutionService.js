// =============================================================================
// ExecutionService
// -----------------------------------------------------------------------------
// Turns raw API executions (apiTradeExecutions) into normalized Executions and
// derives EXECUTION INTELLIGENCE: execution score, average slippage, fill
// efficiency, execution latency, venue comparison, maker/taker ratio, largest
// slippage events, and an execution timeline.
//
// Read-only. All derived metrics are computed locally from the execution
// records; none are presented as live market data.
// =============================================================================

import { createExecution } from "../models/domainModels";

/**
 * Normalize raw API executions into canonical Execution records.
 * @param {Array<any>} rawExecutions
 * @returns {Array<any>}
 */
export function normalizeExecutions(rawExecutions = []) {
  const list = Array.isArray(rawExecutions) ? rawExecutions : [];
  return list
    .map((raw) => createExecution(raw))
    .filter((exec) => exec.platform && exec.quantity > 0);
}

/** Heuristic execution score (0..100) from slippage + fee + latency signals. */
export function computeExecutionScore(metrics) {
  const slippageBps = Number(metrics?.avgSlippageBps ?? metrics?.slippageBps ?? 0);
  const feeBps = Number(metrics?.avgFeeBps ?? 0);
  const fillEfficiency = Number.isFinite(Number(metrics?.fillEfficiency))
    ? Number(metrics.fillEfficiency)
    : 100;
  // Lower slippage/fee => higher score. Latency penalty is mild.
  const slippagePenalty = Math.min(50, Math.abs(slippageBps) * 2);
  const feePenalty = Math.min(25, feeBps * 1.5);
  const efficiencyPenalty = (100 - fillEfficiency) * 0.2;
  const score = Math.max(0, Math.min(100, 100 - slippagePenalty - feePenalty - efficiencyPenalty));
  return Math.round(score);
}

function bps(part, whole) {
  if (!whole) return 0;
  return (part / whole) * 10000;
}

/**
 * Derive execution intelligence from normalized executions.
 * @param {Array<any>} executions - normalized Execution records
 * @returns {{
 *   executionScore: number,
 *   avgSlippageBps: number,
 *   fillEfficiency: number,
 *   avgLatencyMs: number|null,
 *   venueComparison: Array<any>,
 *   makerTakerRatio: { maker: number, taker: number, makerPct: number },
 *   largestSlippageEvents: Array<any>,
 *   timeline: Array<any>
 * }}
 */
export function deriveExecutionIntelligence(executions = []) {
  const list = Array.isArray(executions) ? executions : [];
  const totalNotional = list.reduce((sum, e) => sum + (e.notional || 0), 0);
  const totalFees = list.reduce((sum, e) => sum + (e.feeAmount || 0), 0);
  const weightedSlippage = list.reduce((sum, e) => {
    const ref = Number(e.referencePrice);
    const px = Number(e.price);
    if (!ref || !px) return sum;
    return sum + Math.abs(bps(px - ref, ref)) * (e.notional || 0);
  }, 0);
  const avgSlippageBps = totalNotional ? weightedSlippage / totalNotional : 0;

  const filledQty = list.reduce((sum, e) => sum + (e.quantity || 0), 0);
  // Fill efficiency: share of executions with maker role (passive, cheaper) is
  // treated as a quality signal; taker-heavy books score slightly lower.
  const makerCount = list.filter((e) => e.liquidityRole === "maker").length;
  const takerCount = list.filter((e) => e.liquidityRole === "taker").length;
  const roleKnown = makerCount + takerCount;
  const makerPct = roleKnown ? (makerCount / roleKnown) * 100 : null;
  const fillEfficiency = makerPct == null ? 100 : 60 + (makerPct / 100) * 40;

  // Latency: from executedAt vs an arrival reference if present (best-effort).
  const latencies = list
    .map((e) => Number(e.raw?.latencyMs ?? e.raw?.latency_ms ?? null))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  // Venue comparison
  const byVenue = new Map();
  list.forEach((e) => {
    const key = e.platform;
    const row = byVenue.get(key) || {
      venue: key,
      venueName: String(e.raw?.platformName || e.platform).trim().toUpperCase(),
      fills: 0,
      notional: 0,
      fees: 0,
      slippageWeighted: 0,
    };
    row.fills += 1;
    row.notional += e.notional || 0;
    row.fees += e.feeAmount || 0;
    const ref = Number(e.referencePrice);
    if (ref && e.price) row.slippageWeighted += Math.abs(bps(e.price - ref, ref)) * (e.notional || 0);
    byVenue.set(key, row);
  });
  const venueComparison = [...byVenue.values()]
    .map((row) => ({
      ...row,
      avgFeeBps: row.notional ? bps(row.fees, row.notional) : 0,
      avgSlippageBps: row.notional ? row.slippageWeighted / row.notional : 0,
    }))
    .sort((a, b) => b.notional - a.notional);

  // Largest slippage events
  const largestSlippageEvents = list
    .map((e) => {
      const ref = Number(e.referencePrice);
      const slip = ref && e.price ? bps(e.price - ref, ref) : null;
      return { execution: e, slippageBps: slip };
    })
    .filter((x) => x.slippageBps != null)
    .sort((a, b) => Math.abs(b.slippageBps) - Math.abs(a.slippageBps))
    .slice(0, 8);

  // Timeline (sorted newest first)
  const timeline = [...list]
    .filter((e) => e.executedAt)
    .sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt))
    .slice(0, 50);

  const executionScore = computeExecutionScore({
    avgSlippageBps,
    avgFeeBps: totalNotional ? bps(totalFees, totalNotional) : 0,
    fillEfficiency,
  });

  return {
    executionScore,
    avgSlippageBps: Math.round(avgSlippageBps * 100) / 100,
    fillEfficiency: Math.round(fillEfficiency * 10) / 10,
    avgLatencyMs,
    venueComparison,
    makerTakerRatio: {
      maker: makerCount,
      taker: takerCount,
      makerPct: makerPct == null ? null : Math.round(makerPct * 10) / 10,
    },
    largestSlippageEvents,
    timeline,
  };
}
