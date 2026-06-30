/**
 * Brokerage Domain Models
 * =======================
 *
 * Provider-independent value objects for the brokerage domain. These describe
 * WHAT a brokerage connection exposes (accounts, holdings, balances, etc.)
 * without any reference to HOW a specific provider returns it.
 *
 * No provider terminology (no "SnapTrade", "authorization", "user secret",
 * "connection portal") belongs here. Provider adapters translate their own
 * DTOs into these shapes via their mapper layer.
 *
 * Convention: camelCase field names, matching the rest of the Zenin codebase
 * (the repository layer maps snake_case DB columns to these camelCase names).
 *
 * These are JSDoc @typedef contracts plus frozen factory helpers so the rest of
 * the application depends on stable shapes rather than ad-hoc provider payloads.
 */

"use strict";

/**
 * A monetary amount. Always carries its currency so consumers never have to
 * assume a denomination.
 *
 * @typedef {Object} Money
 * @property {number} amount        Numeric value. Use {@link toMoney} to guarantee finite numbers.
 * @property {string} currency      ISO 4217 currency code (USD, EUR, ...) or asset symbol (USDC, ...).
 */

/**
 * A brokerage connection — the abstract link between a Zenin user/workspace and
 * an upstream brokerage provider. Provider-agnostic: it never names a vendor's
 * connection concept (e.g. "authorization").
 *
 * @typedef {Object} BrokerageConnection
 * @property {string} id                Zenin-owned connection identifier.
 * @property {string} provider          Provider key (e.g. "snaptrade", "alpaca"). Stable, lowercase.
 * @property {string} providerUserRef   Opaque provider-side reference for the linked user.
 * @property {("connected"|"disconnected"|"expired"|"error"|"pending")} status  Current connection state.
 * @property {string} [connectionUrl]   Provider-hosted URL the user must visit to authorize (if applicable).
 * @property {string|null} [lastSyncedAt] ISO timestamp of the last successful sync, or null.
 * @property {import("./capabilities").BrokerageCapabilitySet} [capabilities] Capabilities advertised for this connection.
 * @property {Object} [providerMeta]    Provider metadata, kept opaque and isolated from the application layer.
 * @property {string} [createdAt]       ISO timestamp.
 * @property {string} [updatedAt]       ISO timestamp.
 */

/**
 * A brokerage institution (the brokerage firm itself, e.g. a broker/dealer),
 * not the user's account at it.
 *
 * @typedef {Object} Institution
 * @property {string} id            Provider-stable institution identifier.
 * @property {string} name          Display name (e.g. "Fidelity").
 * @property {string} [brokerType]  Category hint (e.g. "brokerage", "crypto").
 * @property {string} [logoUrl]
 * @property {boolean} [supportsMfa]
 */

/**
 * An investment account at a brokerage provider.
 *
 * @typedef {Object} InvestmentAccount
 * @property {string} id                 Provider-stable account identifier.
 * @property {string} connectionId       Zenin connection this account belongs to.
 * @property {string} name               Account display name.
 * @property {string} institutionName    Name of the institution hosting the account.
 * @property {("cash"|"margin"|"crypto"|"ira"|"401k"|"trust"|"other"|string)} accountType
 * @property {string} [maskedNumber]     Partially-redacted account number for display.
 * @property {boolean} [isMetaOnly]      True when the account is stored as metadata only (no live sync).
 * @property {Object} [providerMeta]     Opaque provider metadata, isolated from application layer.
 * @property {string} [syncedAt]         ISO timestamp of the last data refresh.
 */

/**
 * A cash or coin balance held in an investment account.
 *
 * @typedef {Object} Balance
 * @property {string} accountId
 * @property {Money} total               Total cash/value in this currency.
 * @property {Money} [available]         Amount available to trade/withdraw.
 * @property {Money} [buyingPower]       Purchasing power (may differ under margin).
 * @property {string} [source]           Origin hint (e.g. "settled", "unsettled").
 */

/**
 * A held asset position (a security the user owns).
 *
 * @typedef {Object} Holding
 * @property {string} accountId
 * @property {string} symbol             Tradeable symbol (e.g. "AAPL").
 * @property {string} [name]             Human-readable name.
 * @property {("equity"|"etf"|"crypto"|"option"|"mutual_fund"|"bond"|"cash"|"other"|string)} assetType
 * @property {number} quantity           Units held. Negative indicates a short position.
 * @property {Money} [averageEntryPrice] Blended cost basis per unit.
 * @property {Money} [currentPrice]      Latest unit price.
 * @property {Money} [marketValue]       quantity * currentPrice.
 * @property {string} [openedAt]         ISO timestamp the position was opened.
 * @property {Object} [providerMeta]     Opaque provider metadata.
 * @property {string} [asOf]             ISO timestamp the position was reported.
 */

/**
 * Alias for a long/short directional position summary. A Holding already
 * describes a position; this type is used by aggregate views.
 *
 * @typedef {Object} Position
 * @property {string} accountId
 * @property {string} symbol
 * @property {number} quantity
 * @property {("long"|"short"|"flat")} side
 * @property {Money} [unrealizedPnl]
 * @property {number} [unrealizedPnlPct]
 * @property {Object} [providerMeta]
 */

/**
 * A portfolio snapshot: the combined holdings + balances for an account at a
 * point in time.
 *
 * @typedef {Object} Portfolio
 * @property {string} accountId
 * @property {Holding[]} holdings
 * @property {Balance[]} balances
 * @property {Money} [totalValue]        Aggregate market value across holdings + cash.
 * @property {string} [asOf]
 */

/**
 * A brokerage transaction / activity (a trade, dividend, transfer, fee, etc.).
 *
 * @typedef {Object} Transaction
 * @property {string} id                 Provider-stable transaction identifier (used for dedup).
 * @property {string} accountId
 * @property {("buy"|"sell"|"dividend"|"interest"|"transfer"|"fee"|"tax"|"corporate_action"|"other"|string)} type
 * @property {("buy"|"sell"|"in"|"out"|null)} [side]
 * @property {string} [symbol]
 * @property {number} [quantity]
 * @property {Money} [unitPrice]
 * @property {Money} [notional]
 * @property {Money} [fee]
 * @property {string} [currency]
 * @property {string} [description]
 * @property {string} executedAt         ISO timestamp the activity settled/occurred.
 * @property {Object} [providerMeta]
 */

/**
 * Market-level metadata about an instrument (enrichment, not holdings).
 *
 * @typedef {Object} MarketMetadata
 * @property {string} symbol
 * @property {string} [name]
 * @property {string} [assetType]
 * @property {string} [exchange]
 * @property {string} [currency]
 * @property {string} [isin]
 * @property {Object} [providerMeta]
 */

// ---------------------------------------------------------------------------
// Value-object factories
// ---------------------------------------------------------------------------
// Factories normalize/coerce provider values into the contracts above. They are
// intentionally defensive (coerce, never throw on missing optional fields) so a
// single malformed provider field does not fail an entire sync.

/**
 * @param {number|string|null|undefined} amount
 * @param {string} [currency="USD"]
 * @returns {Money}
 */
function toMoney(amount, currency = "USD") {
  const value = Number(amount);
  return {
    amount: Number.isFinite(value) ? value : 0,
    currency: String(currency || "USD").trim().toUpperCase() || "USD"
  };
}

/**
 * Normalizes an arbitrary provider-supplied connection status string into the
 * canonical set. Unknown values collapse to "error" so the UI never shows a
 * misleading "connected" state.
 *
 * @param {string} [raw]
 * @returns {BrokerageConnection["status"]}
 */
function toConnectionStatus(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "connected" || value === "active" || value === "verified") return "connected";
  if (value === "disconnected" || value === "revoked" || value === "removed") return "disconnected";
  if (value === "expired" || value === "stale") return "expired";
  if (value === "pending" || value === "connecting" || value === "unverified") return "pending";
  return "error";
}

/**
 * Coerces a raw quantity into a finite signed number.
 * @param {number|string|null|undefined} raw
 * @returns {number}
 */
function toQuantity(raw) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Classifies the side of a position from a signed quantity.
 * @param {number} quantity
 * @returns {Position["side"]}
 */
function toPositionSide(quantity) {
  const value = toQuantity(quantity);
  if (value > 0) return "long";
  if (value < 0) return "short";
  return "flat";
}

module.exports = {
  // Value factories
  toMoney,
  toConnectionStatus,
  toQuantity,
  toPositionSide,
  // Re-exported for convenience so tests/consumers import from one place.
  // No state is held here; everything is pure.
};
