// =============================================================================
// Portfolio Intelligence — Normalized Domain Models
// -----------------------------------------------------------------------------
// ALL broker/exchange/venue payloads MUST be mapped into these shared models
// before any UI component sees them. UI components must never receive
// provider-specific schemas directly. This is the single contract between the
// normalization services (ExecutionService, OrderNormalizationService) and the
// feature modules (OrdersModule, ExecutionModule, IntelligenceRail, AlertEngine).
//
// These are plain data shapes plus small pure helpers. No React, no DOM, no
// localStorage here — keep the data layer portable and testable.
// =============================================================================

/**
 * Canonical order lifecycle states. Every broker's native status string is
 * mapped to one of these by OrderNormalizationService. The Order Desk groups
 * rows by these categories.
 */
export const ORDER_STATUS = Object.freeze({
  WORKING: "working", // resting in the book, not (fully) filled
  PENDING: "pending", // accepted but not yet active in the book
  PARTIALLY_FILLED: "partially_filled",
  FILLED: "filled",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  REJECTED: "rejected",
});

export const ORDER_STATUS_LABEL = Object.freeze({
  [ORDER_STATUS.WORKING]: "Working",
  [ORDER_STATUS.PENDING]: "Pending",
  [ORDER_STATUS.PARTIALLY_FILLED]: "Partially Filled",
  [ORDER_STATUS.FILLED]: "Filled",
  [ORDER_STATUS.CANCELLED]: "Cancelled",
  [ORDER_STATUS.EXPIRED]: "Expired",
  [ORDER_STATUS.REJECTED]: "Rejected",
});

/** Order sides. */
export const ORDER_SIDE = Object.freeze({
  BUY: "buy",
  SELL: "sell",
});

/** Order time-in-force conventions shared across venues. */
export const TIME_IN_FORCE = Object.freeze({
  GTC: "gtc", // good till cancelled
  IOC: "ioc", // immediate or cancel
  FOK: "fok", // fill or kill
  DAY: "day", // day order
  GTD: "gtd", // good till date
});

// -----------------------------------------------------------------------------
// Venue — a normalized trading venue (exchange/ECN/dark pool).
// -----------------------------------------------------------------------------
export function createVenue(raw = {}) {
  return {
    id: String(raw.id || raw.venue || raw.platform || "unknown").trim().toLowerCase(),
    name: String(raw.name || raw.venue || raw.platform || "Unknown Venue").trim(),
    assetClass: String(raw.assetClass || raw.marketType || raw.asset_class || "unknown")
      .trim()
      .toLowerCase(),
    isDarkPool: Boolean(raw.isDarkPool ?? raw.dark_pool ?? false),
    makerRebate: Number.isFinite(Number(raw.makerRebate ?? raw.maker_rebate))
      ? Number(raw.makerRebate ?? raw.maker_rebate)
      : 0,
    takerFee: Number.isFinite(Number(raw.takerFee ?? raw.taker_fee))
      ? Number(raw.takerFee ?? raw.taker_fee)
      : 0,
  };
}

// -----------------------------------------------------------------------------
// Broker — a normalized connected broker / exchange account.
// -----------------------------------------------------------------------------
export function createBroker(raw = {}) {
  return {
    id: String(raw.id || raw.broker || raw.provider || raw.exchange || "unknown").trim().toLowerCase(),
    name: String(raw.name || raw.broker || raw.provider || raw.exchange || "Unknown Broker").trim(),
    isConnected: Boolean(raw.isConnected ?? raw.connected ?? raw.is_connected ?? false),
    lastSyncAt: raw.lastSyncAt || raw.last_sync_at || null,
    connectivity: String(raw.connectivity || raw.status || (raw.isConnected ? "ok" : "unknown"))
      .trim()
      .toLowerCase(), // ok | degraded | down | unknown
    venueType: String(raw.venueType || raw.venue_type || "cex").trim().toLowerCase(),
    cannotTrade: raw.cannotTrade ?? raw.cannot_trade ?? true,
    cannotWithdraw: raw.cannotWithdraw ?? raw.cannot_withdraw ?? true,
    raw: raw,
  };
}

// -----------------------------------------------------------------------------
// Execution — normalized fill record (used by both Execution history and Order
// fill progress). Extends the existing apiTradeExecutions shape so the
// ExecutionService can wrap the live records without losing fields.
// -----------------------------------------------------------------------------
export function createExecution(raw = {}) {
  const quantity = Number(raw.quantity);
  const price = Number(raw.price);
  const notional = Number(raw.notional);
  const feeAmount = Number(raw.feeAmount ?? raw.fee_amount ?? 0);
  const side = String(raw.side || "").toLowerCase() === "sell" ? ORDER_SIDE.SELL : ORDER_SIDE.BUY;
  const platform = String(raw.platform || raw.venue || raw.exchange || "").trim().toLowerCase();
  return {
    id: Number.isFinite(Number(raw.id)) ? Number(raw.id) : `exec-${String(raw.platformFillId || raw.id || "")}`,
    source: raw.source || "api_connection",
    platform,
    platformTradeId: raw.platformTradeId || raw.platform_trade_id || null,
    platformFillId: raw.platformFillId || raw.platform_fill_id || null,
    symbol: String(raw.symbol || raw.asset || "UNKNOWN").trim().toUpperCase(),
    side,
    marketType: String(raw.marketType || raw.market_type || "spot").trim().toLowerCase(),
    quantity: Number.isFinite(quantity) ? Math.abs(quantity) : 0,
    price: Number.isFinite(price) ? price : 0,
    notional: Number.isFinite(notional) ? Math.abs(notional) : 0,
    feeAmount: Number.isFinite(feeAmount) ? Math.abs(feeAmount) : 0,
    feeCurrency: String(raw.feeCurrency || raw.fee_currency || "USD").trim().toUpperCase(),
    feeSource: raw.feeSource || raw.fee_source || "exchange_reported",
    liquidityRole: raw.liquidityRole || raw.liquidity_role || null, // maker | taker
    executedAt: raw.executedAt || raw.executed_at || null,
    referencePrice: Number.isFinite(Number(raw.referencePrice ?? raw.reference_price))
      ? Number(raw.referencePrice ?? raw.reference_price)
      : null,
    raw: raw,
  };
}

// -----------------------------------------------------------------------------
// Order — normalized order/working-order record.
// `fillProgress` (0..1) and `remainingQuantity` are derived, never trusted from
// the provider.
// -----------------------------------------------------------------------------
export function createOrder(raw = {}) {
  const orderedQuantity = Number(raw.orderedQuantity ?? raw.quantity ?? raw.order_quantity ?? 0);
  const filledQuantity = Number(raw.filledQuantity ?? raw.filled_quantity ?? 0);
  const side = String(raw.side || "").toLowerCase() === "sell" ? ORDER_SIDE.SELL : ORDER_SIDE.BUY;
  const status = normalizeOrderStatus(raw.status ?? raw.orderStatus ?? raw.order_status);
  const safeOrdered = Math.abs(orderedQuantity);
  const safeFilled = Math.min(Math.abs(filledQuantity), safeOrdered || Math.abs(filledQuantity));
  const orderedAt = raw.orderedAt || raw.createdAt || raw.openedAt || raw.timestamp || raw.transactTime || null;
  const updatedAt = raw.updatedAt || raw.lastUpdatedAt || raw.eventAt || raw.time || orderedAt;
  const avgFillPrice = Number.isFinite(Number(raw.avgFillPrice ?? raw.avg_fill_price))
    ? Number(raw.avgFillPrice ?? raw.avg_fill_price)
    : null;
  const limitPrice = Number.isFinite(Number(raw.limitPrice ?? raw.limit_price))
    ? Number(raw.limitPrice ?? raw.limit_price)
    : null;
  const stopPrice = Number.isFinite(Number(raw.stopPrice ?? raw.stop_price))
    ? Number(raw.stopPrice ?? raw.stop_price)
    : null;
  const brokerId = String(raw.broker || raw.provider || raw.exchange || "").trim().toLowerCase();
  const venueId = String(raw.venue || raw.platform || raw.exchange || brokerId || "").trim().toLowerCase();

  const fillProgress = safeOrdered > 0 ? safeFilled / safeOrdered : status === ORDER_STATUS.FILLED ? 1 : 0;
  const remainingQuantity = Math.max(0, safeOrdered - safeFilled);

  // Estimated fees / slippage are read-only heuristics derived from executions
  // when a provider does not report them. They are NEVER presented as live
  // market data and are labelled as estimates in the UI.
  const estFees = Number.isFinite(Number(raw.estimatedFees ?? raw.estimated_fees))
    ? Number(raw.estimatedFees ?? raw.estimated_fees)
    : null;
  const slippageBps = Number.isFinite(Number(raw.slippageBps ?? raw.slippage_bps ?? raw.slippage))
    ? Number(raw.slippageBps ?? raw.slippage_bps ?? raw.slippage)
    : null;

  return {
    id: String(raw.id || raw.clientOrderId || raw.platformOrderId || raw.orderId || `${brokerId}-${raw.symbol}-${orderedAt}`),
    brokerId,
    brokerName: String(raw.brokerName || raw.broker || raw.provider || brokerId || "Unknown").trim(),
    venueId,
    venueName: String(raw.venueName || raw.venue || raw.platform || venueId || "Connected platform").trim(),
    symbol: String(raw.symbol || raw.asset || "UNKNOWN").trim().toUpperCase(),
    side,
    orderType: String(raw.orderType || raw.type || "market").trim().toLowerCase(), // market | limit | stop | stop_limit | trailing
    status,
    timeInForce: String(raw.timeInForce || raw.tif || raw.time_in_force || TIME_IN_FORCE.GTC)
      .trim()
      .toLowerCase(),
    orderedQuantity: safeOrdered,
    filledQuantity: safeFilled,
    remainingQuantity,
    fillProgress: Math.max(0, Math.min(1, fillProgress)),
    limitPrice,
    stopPrice,
    avgFillPrice,
    estimatedFees: estFees,
    slippageBps,
    executionScore: Number.isFinite(Number(raw.executionScore ?? raw.execution_score))
      ? Number(raw.executionScore ?? raw.execution_score)
      : null,
    orderedAt,
    updatedAt,
    raw: raw,
  };
}

// -----------------------------------------------------------------------------
// Alert — severity-ranked intelligence item for the Intelligence Rail.
// -----------------------------------------------------------------------------
export const ALERT_SEVERITY = Object.freeze({
  CRITICAL: "critical",
  WARNING: "warning",
  INFO: "info",
  POSITIVE: "positive",
});

export const ALERT_SEVERITY_RANK = Object.freeze({
  [ALERT_SEVERITY.CRITICAL]: 0,
  [ALERT_SEVERITY.WARNING]: 1,
  [ALERT_SEVERITY.INFO]: 2,
  [ALERT_SEVERITY.POSITIVE]: 3,
});

export const ALERT_CATEGORY = Object.freeze({
  ORDER: "order",
  EXECUTION: "execution",
  BROKER_CONNECTIVITY: "broker_connectivity",
  PORTFOLIO_DRIFT: "portfolio_drift",
  RISK: "risk",
  MARKET_EVENT: "market_event",
  API_HEALTH: "api_health",
});

export function createAlert(raw = {}) {
  const severity = ALERT_SEVERITY[String(raw.severity || "").toUpperCase()]
    ? raw.severity
    : ALERT_SEVERITY.INFO;
  return {
    id: String(raw.id || `${raw.category}-${raw.source}-${raw.timestamp || Date.now()}`),
    category: raw.category || ALERT_CATEGORY.INFO,
    severity,
    source: String(raw.source || "system").trim(),
    title: String(raw.title || raw.message || "Intelligence update").trim(),
    message: String(raw.message || raw.detail || "").trim(),
    timestamp: raw.timestamp || raw.createdAt || Date.now(),
    impact: String(raw.impact || "").trim(),
    recommendedAction: String(raw.recommendedAction || raw.recommended_action || "").trim(),
    entityRef: raw.entityRef || raw.entity_ref || null, // order id / symbol / venue
    metadata: raw.metadata || {},
  };
}

// -----------------------------------------------------------------------------
// PortfolioHealth — roll-up used by the Overview + drift alerts.
// -----------------------------------------------------------------------------
export function createPortfolioHealth(raw = {}) {
  return {
    totalValue: Number(raw.totalValue ?? raw.total_value ?? 0),
    dayChangePct: Number.isFinite(Number(raw.dayChangePct ?? raw.day_change_pct))
      ? Number(raw.dayChangePct ?? raw.day_change_pct)
      : null,
    driftPct: Number.isFinite(Number(raw.driftPct ?? raw.drift_pct)) ? Number(raw.driftPct ?? raw.drift_pct) : 0,
    concentrationPct: Number.isFinite(Number(raw.concentrationPct ?? raw.concentration_pct))
      ? Number(raw.concentrationPct ?? raw.concentration_pct)
      : 0,
    topMoverSymbol: String(raw.topMoverSymbol || raw.top_mover_symbol || "").trim().toUpperCase() || null,
    healthScore: Number.isFinite(Number(raw.healthScore ?? raw.health_score))
      ? Number(raw.healthScore ?? raw.health_score)
      : null,
    riskLevel: String(raw.riskLevel || raw.risk_level || "normal").trim().toLowerCase(),
    metadata: raw.metadata || {},
  };
}

// -----------------------------------------------------------------------------
// Status normalization helpers (used by OrderNormalizationService + others).
// -----------------------------------------------------------------------------
const STATUS_ALIASES = [
  // [regex test, canonical status]
  [/new|accepted|received|queued/i, ORDER_STATUS.PENDING],
  [/pending/i, ORDER_STATUS.PENDING],
  [/work|resting|open|active|live|booked/i, ORDER_STATUS.WORKING],
  [/partial/i, ORDER_STATUS.PARTIALLY_FILLED],
  [/fill|done|complete|settled|closed_filled/i, ORDER_STATUS.FILLED],
  [/cancel/i, ORDER_STATUS.CANCELLED],
  [/expir/i, ORDER_STATUS.EXPIRED],
  [/reject/i, ORDER_STATUS.REJECTED],
];

export function normalizeOrderStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return ORDER_STATUS.WORKING;
  for (const [pattern, status] of STATUS_ALIASES) {
    if (pattern.test(raw)) return status;
  }
  // Already-canonical passthrough
  if (Object.values(ORDER_STATUS).includes(raw)) return raw;
  return ORDER_STATUS.WORKING;
}

export function isOpenOrder(status) {
  return status === ORDER_STATUS.WORKING || status === ORDER_STATUS.PENDING || status === ORDER_STATUS.PARTIALLY_FILLED;
}

export function isTerminalOrder(status) {
  return !isOpenOrder(status);
}
