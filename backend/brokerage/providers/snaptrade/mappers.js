/**
 * SnapTrade DTO → Domain Model Mappers
 * ====================================
 *
 * Converts raw SnapTrade response shapes into Zenin's provider-independent
 * domain models (domain/models.js). This is the ONLY place that reads SnapTrade
 * field names. Nothing outside this package should ever see a SnapTrade DTO.
 *
 * All mappers are defensive: missing/odd fields collapse to safe defaults rather
 * than throwing, so one malformed account doesn't fail an entire sync.
 *
 * SnapTrade DTO field references come from the SDK's documented response shapes
 * (https://docs.snaptrade.com/). Field names are intentionally not abstracted.
 */

"use strict";

const { toMoney, toConnectionStatus, toQuantity, toPositionSide } = require("../../domain/models");

/**
 * @param {string|number|undefined} value
 * @returns {number} Finite number, or 0.
 */
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string|number|Date|undefined} value
 * @returns {string|null} ISO string or null if unparseable.
 */
function toIso(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Maps a SnapTrade account object to a domain InvestmentAccount.
 *
 * SnapTrade `Account` exposes: id, name, number, institution_name,
 * sync_status, balance, positions, meta, raw_activities_flags, etc.
 *
 * @param {any} account
 * @param {string} [connectionId]
 * @returns {import("../../domain/models").InvestmentAccount}
 */
function mapAccount(account, connectionId) {
  const a = account || {};
  const institution = a.institution_name || a.brokerage?.name || a.meta?.institution_name || "Unknown";
  const accountType = normalizeAccountType(a);
  return {
    id: String(a.id ?? ""),
    connectionId: connectionId || null,
    name: String(a.name || institution),
    institutionName: String(institution),
    accountType,
    maskedNumber: a.number ? maskNumber(a.number) : undefined,
    isMetaOnly: normalizeSynced(a) === false,
    providerMeta: {
      syncStatus: a.sync_status || null,
      type: a.meta?.type || null
    },
    syncedAt: toIso(a.synced_at || a.meta?.synced_at) || undefined
  };
}

/**
 * Derives a normalized accountType from SnapTrade meta.
 * @param {any} account
 * @returns {string}
 */
function normalizeAccountType(account) {
  const raw = String(account?.meta?.type || account?.account_type || "").trim().toLowerCase();
  if (!raw) return "other";
  if (raw.includes("margin")) return "margin";
  if (raw.includes("crypto")) return "crypto";
  if (raw.includes("ira") || raw.includes("roth") || raw.includes("retire")) return "ira";
  if (raw.includes("401")) return "401k";
  if (raw.includes("trust")) return "trust";
  if (raw.includes("cash") || raw.includes("indiv")) return "cash";
  return raw;
}

function maskNumber(num) {
  const s = String(num).replace(/\s+/g, "");
  if (s.length <= 4) return `••••${s}`;
  return `••••${s.slice(-4)}`;
}

/** SnapTrade sync_status -> boolean (data is live-synchronized). */
function normalizeSynced(account) {
  const status = String(account?.sync_status || "").toLowerCase();
  if (status === "ok" || status === "synced" || status === "complete") return true;
  if (status === "error" || status === "failed") return false;
  // Absent sync_status: assume synced if the account carries balance/position data.
  return account?.balance != null || (Array.isArray(account?.positions) && account.positions.length > 0);
}

/**
 * Maps a SnapTrade balance object to domain Balance[] (one per currency).
 *
 * SnapTrade returns { total, cash, buying_power, ... } with amounts keyed by
 * currency, or a flat object when single-currency. We normalize to per-currency
 * Money values.
 *
 * @param {any} balance
 * @param {string} accountId
 * @returns {import("../../domain/models").Balance[]}
 */
function mapBalances(balance, accountId) {
  const b = balance || {};
  const currency = String(b.currency || "USD").toUpperCase();
  const total = toMoney(b.total ?? b.cash ?? 0, currency);
  const available = b.available != null ? toMoney(b.available, currency) : undefined;
  const buyingPower = b.buying_power != null ? toMoney(b.buying_power, currency) : undefined;
  /** @type {import("../../domain/models").Balance} */
  const out = { accountId, total, source: "settled" };
  if (available) out.available = available;
  if (buyingPower) out.buyingPower = buyingPower;
  return [out];
}

/**
 * Maps a SnapTrade position to a domain Holding.
 *
 * SnapTrade `Position`: { symbol, security, units/quantity, average_purchase_price,
 * last_quote_price, market_value, ... }
 *
 * @param {any} position
 * @param {string} accountId
 * @returns {import("../../domain/models").Holding}
 */
function mapHolding(position, accountId) {
  const p = position || {};
  const currency = String(p.currency || p.security?.currency || "USD").toUpperCase();
  const units = toQuantity(p.units ?? p.quantity ?? p.amount);
  return {
    accountId,
    symbol: String(p.symbol || p.security?.symbol || ""),
    name: String(p.security?.name || p.description || p.symbol || ""),
    assetType: normalizeAssetType(p.security || p),
    quantity: units,
    averageEntryPrice: p.average_purchase_price != null || p.average_purchase_price === 0
      ? toMoney(p.average_purchase_price, currency)
      : undefined,
    currentPrice: p.last_quote_price != null || p.last_quote_price === 0
      ? toMoney(p.last_quote_price, currency)
      : undefined,
    marketValue: p.market_value != null || p.market_value === 0
      ? toMoney(p.market_value, currency)
      : undefined,
    openedAt: toIso(p.opened_at || p.acquisition_date) || undefined,
    providerMeta: {
      optionSymbol: p.option_symbol || null,
      units: p.units != null ? Number(p.units) : undefined
    },
    asOf: toIso(p.last_updated || p.price_as_of) || new Date().toISOString()
  };
}

/**
 * SnapTrade security types -> domain assetType.
 * @param {any} security
 * @returns {string}
 */
function normalizeAssetType(security) {
  const s = security || {};
  const type = String(s.type || s.security_type || "").toLowerCase();
  if (type.includes("equity") || type.includes("stock")) return "equity";
  if (type.includes("etf")) return "etf";
  if (type.includes("crypto")) return "crypto";
  if (type.includes("option")) return "option";
  if (type.includes("mutual") || type.includes("mf")) return "mutual_fund";
  if (type.includes("bond") || type.includes("fixed")) return "bond";
  if (type.includes("cash") || type.includes("currency")) return "cash";
  return type || "other";
}

/**
 * Maps a SnapTrade holding's position summary to a domain Position (PnL view).
 * @param {any} position
 * @param {string} accountId
 * @returns {import("../../domain/models").Position}
 */
function mapPosition(position, accountId) {
  const p = position || {};
  const currency = String(p.currency || "USD").toUpperCase();
  const qty = toQuantity(p.units ?? p.quantity ?? p.amount);
  /** @type {import("../../domain/models").Position} */
  const out = {
    accountId,
    symbol: String(p.symbol || p.security?.symbol || ""),
    quantity: qty,
    side: toPositionSide(qttrSafe(p, qty))
  };
  if (p.unrealized_investment_profit != null) {
    out.unrealizedPnl = toMoney(p.unrealized_investment_profit, currency);
  }
  return out;
}

// SnapTrade expresses short positions via negative units in some payloads;
// `units` may be null while a separate field carries the signed amount.
function qttrSafe(p, fallbackQty) {
  if (p.units != null) return p.units;
  return fallbackQty;
}

/**
 * Maps a SnapTrade activity/transaction to a domain Transaction.
 *
 * SnapTrade `Activity`: { id, type, description, symbol, units/quantity, price,
 * currency, fee, date, ... }. Activity type taxonomy (BUY, SELL, DIVIDEND, etc.)
 * is normalized into Zenin's domain transaction type.
 *
 * @param {any} activity
 * @param {string} accountId
 * @returns {import("../../domain/models").Transaction}
 */
function mapTransaction(activity, accountId) {
  const a = activity || {};
  const currency = String(a.currency || "USD").toUpperCase();
  const { type, side } = normalizeTransactionType(a.type, a.action);
  const price = a.price != null ? toNumber(a.price) : null;
  const qty = a.units != null || a.quantity != null ? toQuantity(a.units ?? a.quantity) : null;
  return {
    id: String(a.id ?? ""),
    accountId,
    type,
    side,
    symbol: String(a.symbol || a.security?.symbol || "") || undefined,
    quantity: qty ?? undefined,
    unitPrice: price != null ? toMoney(price, currency) : undefined,
    notional: price != null && qty != null ? toMoney(price * Math.abs(qty), currency) : undefined,
    fee: a.fee != null && toNumber(a.fee) !== 0 ? toMoney(a.fee, currency) : undefined,
    currency,
    description: a.description || undefined,
    executedAt: toIso(a.date || a.trade_date || a.settlement_date) || new Date().toISOString(),
    providerMeta: { rawType: a.type || null }
  };
}

/**
 * Normalizes SnapTrade activity types to domain transaction type + side.
 * @param {string} rawType
 * @param {string} [action]
 * @returns {{ type: string, side: ("buy"|"sell"|"in"|"out"|null) }}
 */
function normalizeTransactionType(rawType, action) {
  const t = String(rawType || action || "").toUpperCase();
  if (t.includes("BUY")) return { type: "buy", side: "buy" };
  if (t.includes("SELL")) return { type: "sell", side: "sell" };
  if (t.includes("DIVIDEND")) return { type: "dividend", side: "in" };
  if (t.includes("INTEREST")) return { type: "interest", side: "in" };
  if (t.includes("FEE") || t.includes("CHARGE")) return { type: "fee", side: "out" };
  if (t.includes("TAX")) return { type: "tax", side: "out" };
  if (t.includes("TRANSFER") || t.includes("JOURNAL")) {
    const inBound = /in|credit|receive/i.test(t);
    return { type: "transfer", side: inBound ? "in" : "out" };
  }
  if (t.includes("CORP") || t.includes("SPLIT") || t.includes("MERGER")) {
    return { type: "corporate_action", side: null };
  }
  return { type: t ? t.toLowerCase() : "other", side: null };
}

/**
 * Maps a SnapTrade brokerage (institution) to a domain Institution.
 * @param {any} brokerage
 * @returns {import("../../domain/models").Institution}
 */
function mapInstitution(brokerage) {
  const b = brokerage || {};
  return {
    id: String(b.id ?? b.brokerage_id ?? b.slug ?? ""),
    name: String(b.name || b.display_name || "Unknown Brokerage"),
    brokerType: b.type || (b.has_reportable_positions ? "brokerage" : undefined),
    logoUrl: b.logo_url || undefined,
    supportsMfa: Boolean(b.supports_mfa || b.has_mfa)
  };
}

/**
 * Maps a SnapTrade connection/authorization status to a domain connection
 * status string (then toConnectionStatus canonicalizes it).
 * @param {any} connection
 * @returns {import("../../domain/models").BrokerageConnection["status"]}
 */
function mapConnectionStatus(connection) {
  const c = connection || {};
  const status = String(c.status || c.state || "").toLowerCase();
  if (status === "active" || status === "connected") return "connected";
  if (status === "disabled" || status === "revoked" || status === "removed") return "disconnected";
  if (status === "expired" || status === "stale") return "expired";
  if (status === "pending" || status === "in_progress") return "pending";
  return toConnectionStatus(status);
}

module.exports = {
  mapAccount,
  mapBalances,
  mapHolding,
  mapPosition,
  mapTransaction,
  mapInstitution,
  mapConnectionStatus,
  _internals: {
    toNumber,
    toIso,
    normalizeAccountType,
    normalizeAssetType,
    normalizeTransactionType,
    maskNumber,
    normalizeSynced
  }
};
