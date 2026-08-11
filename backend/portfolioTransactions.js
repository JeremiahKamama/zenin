// backend/portfolioTransactions.js
// Provider-neutral transaction notification service (Tier 2 / spec: "Provider-Neutral
// Transaction Notifications and Real-Time Delivery").
//
// One canonical service produces inbox events for EVERY connected-source
// transaction import (SnapTrade brokerages, Binance, Bybit, Hyperliquid wallet/API,
// and future adapters). It replaces the exchange-specific createTradeExecutionNotifications.
//
// Pure + unit-testable: persistence goes through dispatchWorkspaceNotification
// (injected/imported), never directly through the DB. No fabricates — events are
// emitted only for transactions the caller passes (already-inserted rows).
//
// Popup policy (from the spec table):
//   single buy/sell/fill      -> popup off by default (user preference)
//   grouped historical import -> no popup
//   deposit/withdrawal/transfer -> popup ON
//   large tx above threshold  -> popup ON
//   failed/stale/revoked source -> popup ON (handled by unifiedNotifications)
//   source recovery           -> popup ON, once (handled by unifiedNotifications)
//   dividend/interest/fee/adjustment -> popup off by default

const TRANSACTION_TYPES = new Set([
  "buy", "sell", "fill", "dividend", "interest", "fee",
  "deposit", "withdrawal", "transfer", "adjustment", "unknown"
]);

const POPUP_ON_TYPES = new Set(["deposit", "withdrawal", "transfer"]);

// Normalize any provider's raw transaction into the shared shape.
// `source` = { provider, connectionId, sourceAccountId, label? }
function normalizeTransaction(raw, source, opts = {}) {
  const t = raw || {};
  const typeRaw = String(t.type || t.side || t.kind || "unknown").toLowerCase().trim();
  const type = TRANSACTION_TYPES.has(typeRaw) ? typeRaw : "unknown";
  const symbol = t.symbol || t.instrument || t.asset || t.ticker || null;
  const provider = source && source.provider ? String(source.provider) : "unknown";
  const sourceAccountId = source && source.sourceAccountId != null
    ? String(source.sourceAccountId)
    : (source && source.connectionId != null ? String(source.connectionId) : null);
  const externalTransactionId = t.externalTransactionId || t.id || t.platformFillId || t.txId || t.orderId || null;

  const normalized = {
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    provider,
    connectionId: source && source.connectionId != null ? String(source.connectionId) : null,
    sourceAccountId,
    externalTransactionId,
    type,
    symbol: symbol ? String(symbol) : null,
    quantity: t.quantity != null ? Number(t.quantity) : null,
    unitPrice: t.price != null ? Number(t.price) : null,
    notional: t.notional != null ? Number(t.notional) : (t.quantity != null && t.price != null ? Number(t.quantity) * Number(t.price) : null),
    fee: t.fee != null ? Number(t.fee) : (t.feeAmount != null ? Number(t.feeAmount) : null),
    currency: t.currency || t.nativeCurrency || t.quoteCurrency || null,
    executedAt: t.executedAt || t.timestamp || t.time || null,
    raw: t
  };
  return normalized;
}

// Stable idempotency key (spec: workspaceId + provider + sourceAccountId + externalTransactionId)
function idempotencyKey(n) {
  const acct = n.sourceAccountId != null ? n.sourceAccountId : (n.connectionId != null ? n.connectionId : "na");
  const ext = n.externalTransactionId != null ? n.externalTransactionId : "na";
  return `txn:${n.workspaceId}:${n.provider}:${acct}:${ext}`;
}

function popupPolicy(type, { large = false } = {}) {
  // inbox is always persisted; popup depends on type + large flag
  if (large) return true;
  if (POPUP_ON_TYPES.has(type)) return true;
  return false; // single buy/sell/fill, dividend/interest/fee/adjustment, grouped imports -> off by default
}

function buildActivityUrl(opts, source, type, extId) {
  const base = (opts && typeof opts.buildActivityUrl === "function")
    ? opts.buildActivityUrl("/app?section=portfolio&tab=activity")
    : "/app?section=portfolio&tab=activity";
  const params = new URLSearchParams();
  if (source && source.provider) params.set("source", source.provider);
  if (source && source.sourceAccountId != null) params.set("account", String(source.sourceAccountId));
  if (type) params.set("type", String(type));
  if (extId) params.set("tx", String(extId));
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params.toString()}`;
}

function titleFor(n) {
  const sym = n.symbol || "asset";
  const labelMap = {
    buy: "Bought", sell: "Sold", fill: "Filled", dividend: "Dividend",
    interest: "Interest", fee: "Fee", deposit: "Deposit", withdrawal: "Withdrawal",
    transfer: "Transfer", adjustment: "Adjustment", unknown: "Transaction"
  };
  const verb = labelMap[n.type] || "Transaction";
  return `${verb}: ${sym}`;
}

function bodyFor(n) {
  const parts = [];
  if (n.quantity != null && n.symbol) parts.push(`${n.quantity} ${n.symbol}`);
  if (n.unitPrice != null) parts.push(`@ ${n.unitPrice}${n.currency ? " " + n.currency : ""}`);
  if (n.fee != null) parts.push(`fee ${n.fee}${n.currency ? " " + n.currency : ""}`);
  return parts.join(" · ") || `${n.type} on ${n.provider}`;
}

/**
 * Create canonical inbox events for newly-inserted connected-source transactions.
 * @param {object} args
 * @param {string|number} args.userId
 * @param {string|number} args.workspaceId
 * @param {object} args.source { provider, connectionId, sourceAccountId?, label? }
 * @param {Array} args.transactions raw provider transactions (already inserted)
 * @param {object} [args.opts] { largeThreshold?, baseCurrency?, buildActivityUrl? }
 * @param {Function} dispatch the dispatchWorkspaceNotification fn (injected for testability)
 * @returns {Promise<Array>} created notification records
 */
async function createPortfolioTransactionNotifications(args, dispatch) {
  const dispatchFn = dispatch || require("./workspaceNotificationDispatcher").dispatchWorkspaceNotification;
  const { userId, workspaceId, source } = args || {};
  const raws = Array.isArray(args && args.transactions) ? args.transactions.filter(Boolean) : [];
  if (!raws.length || !dispatchFn) return [];

  const opts = (args && args.opts) || {};
  const largeThreshold = Number.isFinite(Number(opts.largeThreshold)) ? Number(opts.largeThreshold) : Infinity;
  const baseCurrency = opts.baseCurrency || "USD";

  const normalized = raws.map((r) => normalizeTransaction(r, source, { userId, workspaceId }));

  // Grouped/historical import (more than 5) -> suppressed by design.
  // Product rule: do NOT announce bulk/historical fills on sync. Users only
  // want (1) genuinely new trades and (2) account sync success (dispatched
  // separately by the sync handler). The sync-success notification already
  // covers "synced N transactions", so a duplicate batch event is noise.
  if (normalized.length > 5) return [];

  // One event per transaction (<=5), popup by policy.
  const created = [];
  for (const n of normalized) {
    const large = Number.isFinite(n.notional) && n.notional >= largeThreshold;
    const popup = popupPolicy(n.type, { large });
    const evt = await dispatchFn({
      userId, workspaceId, event: {
        type: "portfolio_transaction.created",
        category: "execution",
        severity: "success",
        title: titleFor(n),
        body: bodyFor(n),
        entityType: "portfolio_transaction",
        entityId: idempotencyKey(n),
        metadata: {
          provider: n.provider,
          connectionId: n.connectionId,
          sourceAccountId: n.sourceAccountId,
          externalTransactionId: n.externalTransactionId,
          transactionType: n.type,
          symbol: n.symbol,
          quantity: n.quantity,
          unitPrice: n.unitPrice,
          notional: n.notional,
          currency: n.currency,
          executedAt: n.executedAt,
          large,
          popup
        },
        action: { label: "Open activity", actionUrl: buildActivityUrl(opts, source, n.type, n.externalTransactionId) },
        dedupeKey: idempotencyKey(n)
      }
    });
    created.push(evt);
  }
  return created;
}

module.exports = {
  TRANSACTION_TYPES,
  POPUP_ON_TYPES,
  normalizeTransaction,
  idempotencyKey,
  popupPolicy,
  createPortfolioTransactionNotifications
};
