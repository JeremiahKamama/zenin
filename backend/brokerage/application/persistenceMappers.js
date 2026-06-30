/**
 * Domain → Persistence Mappers
 * ==============================
 *
 * Translates provider-independent domain models into the flat payloads expected
 * by database.brokerage.* repository methods. Keeps SQL column knowledge out
 * of BrokerageService and SyncEngine.
 */

"use strict";

/**
 * @param {import("../domain/models").InvestmentAccount} account
 * @param {number} connectionId
 */
function mapAccountToDb(account, connectionId) {
  return {
    connectionId,
    providerAccountId: String(account.id || ""),
    institutionName: account.institutionName || "",
    accountType: account.accountType || "other",
    maskedNumber: account.maskedNumber || null,
    name: account.name || "",
    isMetaOnly: Boolean(account.isMetaOnly),
    providerMeta: account.providerMeta || {}
  };
}

/**
 * @param {import("../domain/models").Holding} holding
 */
function mapHoldingToDb(holding) {
  const currency =
    holding.averageEntryPrice?.currency ||
    holding.currentPrice?.currency ||
    holding.marketValue?.currency ||
    "USD";
  return {
    symbol: holding.symbol || "",
    name: holding.name || null,
    assetType: holding.assetType || "equity",
    quantity: holding.quantity ?? 0,
    averageEntryPrice: holding.averageEntryPrice?.amount ?? null,
    currentPrice: holding.currentPrice?.amount ?? null,
    marketValue: holding.marketValue?.amount ?? null,
    currency,
    openedAt: holding.openedAt || null,
    providerMeta: holding.providerMeta || {},
    asOf: holding.asOf || new Date().toISOString()
  };
}

/**
 * @param {import("../domain/models").Transaction} transaction
 */
function mapTransactionToDb(transaction) {
  const currency =
    transaction.currency ||
    transaction.unitPrice?.currency ||
    transaction.notional?.currency ||
    "USD";
  return {
    id: String(transaction.id || ""),
    type: transaction.type || "other",
    side: transaction.side ?? null,
    symbol: transaction.symbol ?? null,
    quantity: transaction.quantity ?? null,
    unitPrice: transaction.unitPrice?.amount ?? null,
    notional: transaction.notional?.amount ?? null,
    fee: transaction.fee?.amount ?? null,
    currency,
    description: transaction.description ?? null,
    executedAt: transaction.executedAt || new Date().toISOString(),
    providerMeta: transaction.providerMeta || {}
  };
}

/**
 * @param {Object} row  DB connection row (camelCase aliases).
 * @returns {import("../domain/models").BrokerageConnection}
 */
function mapConnectionFromDb(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    provider: row.provider,
    providerUserRef: row.providerUserRef,
    status: row.status,
    capabilities: row.capabilities || {},
    lastSyncedAt: row.lastSyncedAt || null,
    providerMeta: row.providerMeta || {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

module.exports = {
  mapAccountToDb,
  mapHoldingToDb,
  mapTransactionToDb,
  mapConnectionFromDb
};
