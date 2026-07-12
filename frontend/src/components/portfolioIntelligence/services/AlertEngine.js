// =============================================================================
// AlertEngine
// -----------------------------------------------------------------------------
// Builds severity-ranked, category-labelled Smart Alerts for the Portfolio
// Intelligence Rail. Each alert carries: severity, source, timestamp, impact,
// and recommended action. Pure + read-only — it only reads normalized models
// and connected state; it never mutates anything.
//
// Extensible by category: register additional detectors via registerDetector.
// =============================================================================

import {
  createAlert,
  ALERT_SEVERITY,
  ALERT_SEVERITY_RANK,
  ALERT_CATEGORY,
  isOpenOrder,
  ORDER_STATUS,
} from "../models/domainModels";

/** @typedef {function(Object): Array<any>} AlertDetector — (ctx) => Alert[] */

const detectors = new Map();

/**
 * Register a custom alert detector. ctx exposes the full normalized context.
 * @param {string} category
 * @param {AlertDetector} detector
 */
export function registerDetector(category, detector) {
  if (!category || typeof detector !== "function") {
    throw new Error("registerDetector requires (category, detectorFn)");
  }
  detectors.set(category, detector);
}

export function getRegisteredDetectors() {
  return [...detectors.keys()];
}

function makeAlert(partial) {
  return createAlert({ ...partial, category: partial.category || ALERT_CATEGORY.INFO });
}

/**
 * Build the full ranked alert list from the normalized context.
 * @param {Object} ctx - {
 *   orders, executions, brokers, venues, portfolioHealth,
 *   notifications, apiHealth, connectedAccounts
 * }
 * @returns {Array<any>} sorted by severity then timestamp (newest first within severity)
 */
export function buildAlerts(ctx = {}) {
  const alerts = [];

  // ---- Order alerts -------------------------------------------------------
  const orders = Array.isArray(ctx.orders) ? ctx.orders : [];
  const rejected = orders.filter((o) => o.status === ORDER_STATUS.REJECTED);
  rejected.forEach((o) =>
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.ORDER,
        severity: ALERT_SEVERITY.WARNING,
        source: o.brokerName,
        title: `Order rejected: ${o.symbol}`,
        message: `${o.side.toUpperCase()} ${o.orderType} order for ${o.symbol} was rejected by ${o.brokerName}.`,
        timestamp: o.updatedAt || o.orderedAt || Date.now(),
        impact: "Intent not live in the book.",
        recommendedAction: "Review order parameters or broker permissions.",
        entityRef: o.id,
      })
    )
  );
  const expired = orders.filter((o) => o.status === ORDER_STATUS.EXPIRED);
  expired.forEach((o) =>
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.ORDER,
        severity: ALERT_SEVERITY.INFO,
        source: o.brokerName,
        title: `Order expired: ${o.symbol}`,
        message: `${o.side.toUpperCase()} ${o.symbol} order expired without a fill.`,
        timestamp: o.updatedAt || Date.now(),
        impact: "No execution; re-quote if still desired.",
        recommendedAction: "Re-submit with a different time-in-force if still intended.",
        entityRef: o.id,
      })
    )
  );
  const staleOpen = orders.filter(
    (o) => isOpenOrder(o.status) && o.orderedAt && Date.now() - new Date(o.orderedAt).getTime() > 1000 * 60 * 60 * 24
  );
  staleOpen.forEach((o) =>
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.ORDER,
        severity: ALERT_SEVERITY.INFO,
        source: o.brokerName,
        title: `Open order aging: ${o.symbol}`,
        message: `${o.side.toUpperCase()} ${o.symbol} has been working for over 24h.`,
        timestamp: o.updatedAt || Date.now(),
        impact: "Capital tied up; market may have moved.",
        recommendedAction: "Consider repricing or cancelling.",
        entityRef: o.id,
      })
    )
  );

  // ---- Execution alerts ---------------------------------------------------
  const executions = Array.isArray(ctx.executions) ? ctx.executions : [];
  const highSlip = executions
    .map((e) => {
      const ref = Number(e.referencePrice);
      const slip = ref && e.price ? ((e.price - ref) / ref) * 10000 : null;
      return { e, slip };
    })
    .filter((x) => x.slip != null && Math.abs(x.slip) > 25);
  highSlip.slice(0, 5).forEach(({ e, slip }) =>
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.EXECUTION,
        severity: ALERT_SEVERITY.WARNING,
        source: String(e.raw?.platformName || e.platform).toUpperCase(),
        title: `High slippage: ${e.symbol}`,
        message: `${e.side.toUpperCase()} ${e.symbol} filled ${slip > 0 ? "above" : "below"} reference by ${Math.abs(slip).toFixed(1)} bps.`,
        timestamp: e.executedAt || Date.now(),
        impact: `Adverse price ~${Math.abs(slip).toFixed(1)} bps vs reference.`,
        recommendedAction: "Review venue routing or size for next fill.",
        entityRef: e.platformFillId,
      })
    )
  );

  // ---- Broker connectivity ------------------------------------------------
  const brokers = Array.isArray(ctx.brokers) ? ctx.brokers : [];
  brokers
    .filter((b) => b.connectivity === "down" || b.connectivity === "degraded")
    .forEach((b) =>
      alerts.push(
        makeAlert({
          category: ALERT_CATEGORY.BROKER_CONNECTIVITY,
          severity: b.connectivity === "down" ? ALERT_SEVERITY.CRITICAL : ALERT_SEVERITY.WARNING,
          source: b.name,
          title: `${b.name} ${b.connectivity === "down" ? "disconnected" : "degraded"}`,
          message: `${b.name} is ${b.connectivity}. Order/execution sync may be delayed.`,
          timestamp: b.lastSyncAt || Date.now(),
          impact: "Stale order & fill data possible.",
          recommendedAction: "Check connection status and re-sync.",
          entityRef: b.id,
        })
      )
    );
  const disconnected = brokers.filter((b) => !b.isConnected);
  if (brokers.length && disconnected.length === brokers.length) {
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.BROKER_CONNECTIVITY,
        severity: ALERT_SEVERITY.CRITICAL,
        source: "All venues",
        title: "All broker connections down",
        message: "No connected venue is syncing. Order desk reflects last known state only.",
        timestamp: Date.now(),
        impact: "No live order/execution visibility.",
        recommendedAction: "Restore at least one read-only connection.",
      })
    );
  }

  // ---- Portfolio drift ----------------------------------------------------
  const health = ctx.portfolioHealth || null;
  if (health && Number.isFinite(health.driftPct) && Math.abs(health.driftPct) >= 5) {
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.PORTFOLIO_DRIFT,
        severity: Math.abs(health.driftPct) >= 12 ? ALERT_SEVERITY.WARNING : ALERT_SEVERITY.INFO,
        source: "Portfolio model",
        title: `Allocation drift ${health.driftPct.toFixed(1)}%`,
        message: `Current allocation is off-target by ${health.driftPct.toFixed(1)}%.`,
        timestamp: Date.now(),
        impact: "Target weights not maintained.",
        recommendedAction: "Open the Rebalance flow to review restoration trades.",
      })
    );
  }
  if (health && Number.isFinite(health.concentrationPct) && health.concentrationPct >= 35) {
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.PORTFOLIO_DRIFT,
        severity: ALERT_SEVERITY.INFO,
        source: "Portfolio model",
        title: `Concentration ${health.concentrationPct.toFixed(0)}%`,
        message: `Single bucket weighs ${health.concentrationPct.toFixed(0)}% of the book.`,
        timestamp: Date.now(),
        impact: "Idiosyncratic risk elevated.",
        recommendedAction: "Review diversification in Exposure.",
      })
    );
  }

  // ---- Risk alerts --------------------------------------------------------
  if (health && health.riskLevel === "elevated") {
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.RISK,
        severity: ALERT_SEVERITY.WARNING,
        source: "Risk engine",
        title: "Elevated portfolio risk",
        message: "Aggregate risk metrics are above your configured threshold.",
        timestamp: Date.now(),
        impact: "Drawdown sensitivity increased.",
        recommendedAction: "Reduce gross exposure or hedge.",
      })
    );
  }

  // ---- Market events ------------------------------------------------------
  const notifications = Array.isArray(ctx.notifications) ? ctx.notifications : [];
  notifications
    .filter((n) => String(n?.type || "").includes("market") || String(n?.type || "").includes("event"))
    .slice(0, 5)
    .forEach((n) =>
      alerts.push(
        makeAlert({
          category: ALERT_CATEGORY.MARKET_EVENT,
          severity: ALERT_SEVERITY.INFO,
          source: "Market feed",
          title: n.title || "Market event",
          message: n.body || n.message || "Market event relevant to your book.",
          timestamp: n.createdAt || Date.now(),
          impact: "Potential P&L/volatility impact.",
          recommendedAction: "Review affected positions.",
          entityRef: n.id,
        })
      )
    );

  // ---- API health ---------------------------------------------------------
  const apiHealth = ctx.apiHealth || null;
  if (apiHealth && apiHealth.status !== "ok") {
    alerts.push(
      makeAlert({
        category: ALERT_CATEGORY.API_HEALTH,
        severity: apiHealth.status === "error" ? ALERT_SEVERITY.CRITICAL : ALERT_SEVERITY.WARNING,
        source: apiHealth.source || "Backend",
        title: `API ${apiHealth.status === "error" ? "error" : "degraded"}`,
        message: apiHealth.detail || "Backend reachability issue detected.",
        timestamp: apiHealth.checkedAt || Date.now(),
        impact: "Some intelligence panels may be stale.",
        recommendedAction: "Retry sync; escalate if persistent.",
      })
    );
  }

  // ---- Custom/registered detectors ---------------------------------------
  detectors.forEach((detector) => {
    try {
      const extra = detector(ctx) || [];
      extra.forEach((a) => alerts.push(makeAlert(a)));
    } catch {
      // A misbehaving detector must never break the rail.
    }
  });

  return rankAlerts(alerts);
}

/**
 * Sort by severity rank (critical first), then newest timestamp first.
 */
export function rankAlerts(alerts = []) {
  return [...(Array.isArray(alerts) ? alerts : [])].sort((a, b) => {
    const rankDiff = (ALERT_SEVERITY_RANK[a.severity] ?? 99) - (ALERT_SEVERITY_RANK[b.severity] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    const ta = new Date(a.timestamp || 0).getTime();
    const tb = new Date(b.timestamp || 0).getTime();
    return tb - ta;
  });
}

export function summarizeAlerts(alerts = []) {
  const counts = { critical: 0, warning: 0, info: 0, positive: 0 };
  (Array.isArray(alerts) ? alerts : []).forEach((a) => {
    if (counts[a.severity] != null) counts[a.severity] += 1;
  });
  return counts;
}
