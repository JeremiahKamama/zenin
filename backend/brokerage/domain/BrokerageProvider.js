/**
 * BrokerageProvider Interface (Domain Contract)
 * ============================================
 *
 * This is the port that every brokerage provider adapter implements and that
 * the application layer (BrokerageService, SyncEngine) depends on. It is a
 * provider-independent contract: no method takes a provider-specific DTO or
 * parameter, and no method returns a raw provider payload.
 *
 * Since the Zenin backend is plain JavaScript (no TS interfaces), the contract
 * is expressed two ways:
 *   1. This JSDoc @interface documents every method + return type.
 *   2. {@link assertProviderContract} enforces the shape at registration time,
 *      so a malformed adapter is rejected before it can serve traffic.
 *
 * Adapters translate provider responses into the domain models in
 * `./models` and surface provider-independent errors from `./errors`.
 *
 * Connection lifecycle:
 *   connect() -> getConnectionStatus() -> refresh()/sync() -> disconnect()
 *
 * @interface BrokerageProvider
 */

"use strict";

/**
 * @typedef {Object} ConnectContext
 * @property {string} [userId]       Zenin user identifier (for provider-side user registration).
 * @property {string} [workspaceId]  Zenin workspace scope.
 * @property {string} [redirectUrl]  Where the provider should send the user after authorizing.
 * @property {Object} [credentials]  Opaque provider credentials (api keys, secrets). Adapter-defined.
 */

/**
 * @typedef {Object} SyncOptions
 * @property {"incremental"|"full"} [mode="incremental"]
 * @property {string} [sinceCursor]  Provider cursor/token for incremental sync (e.g. last tx date).
 * @property {string[]} [accountIds] Restrict sync to these accounts.
 * @property {AbortSignal} [signal]  Cooperative cancellation.
 */

/**
 * @typedef {Object} SyncResult
 * @property {boolean} success
 * @property {number} [accountsCount]
 * @property {number} [holdingsCount]
 * @property {number} [transactionsCount]
 * @property {number} [insertedCount]
 * @property {number} [updatedCount]
 * @property {string} [nextCursor]   Cursor to persist for the next incremental sync.
 * @property {string} [syncedAt]     ISO timestamp.
 * @property {Object} [meta]         Opaque diagnostics (counts per account, warnings, etc.).
 */

/**
 * @typedef {Object} HealthStatus
 * @property {"healthy"|"degraded"|"unhealthy"} status
 * @property {number} latencyMs
 * @property {string} [message]
 * @property {string} [checkedAt]
 */

/**
 * Each method below is part of the BrokerageProvider interface. Implementations
 * MUST provide all of them. Parameters are provider-independent.
 */
const BrokerageProviderInterface = {
  /**
   * Stable, lowercase, unique provider key (e.g. "snaptrade", "alpaca").
   * @type {string}
   */
  providerKey: "undefined",

  /**
   * Human-readable display name.
   * @type {string}
   */
  displayName: "Undefined Provider",

  /**
   * Capabilities this provider advertises.
   * @type {import("./capabilities").BrokerageCapabilitySet}
   */
  capabilities: {},

  /**
   * Establishes (or resumes) a connection for a user. Returns a connection
   * descriptor that may include a provider-hosted authorization URL.
   * @param {ConnectContext} context
   * @returns {Promise<import("./models").BrokerageConnection>}
   */
  async connect(context) {},

  /**
   * Revokes a connection on the provider side.
   * @param {string} connectionId
   * @returns {Promise<{success: boolean}>}
   */
  async disconnect(connectionId) {},

  /**
   * Forces a refresh of connection metadata (status, capabilities) without a
   * full data sync.
   * @param {string} connectionId
   * @returns {Promise<import("./models").BrokerageConnection>}
   */
  async refresh(connectionId) {},

  /**
   * Lists investment accounts for a connection.
   * @param {string} connectionId
   * @returns {Promise<import("./models").InvestmentAccount[]>}
   */
  async listAccounts(connectionId) {},

  /**
   * Fetches a single investment account.
   * @param {string} connectionId
   * @param {string} accountId
   * @returns {Promise<import("./models").InvestmentAccount>}
   */
  async getAccount(connectionId, accountId) {},

  /**
   * Fetches balances for an account (or all accounts on the connection).
   * @param {string} connectionId
   * @param {string} [accountId]
   * @returns {Promise<import("./models").Balance[]>}
   */
  async getBalances(connectionId, accountId) {},

  /**
   * Fetches open positions for an account.
   * @param {string} connectionId
   * @param {string} [accountId]
   * @returns {Promise<import("./models").Position[]>}
   */
  async getPositions(connectionId, accountId) {},

  /**
   * Fetches held positions (holdings) for an account.
   * @param {string} connectionId
   * @param {string} [accountId]
   * @returns {Promise<import("./models").Holding[]>}
   */
  async getHoldings(connectionId, accountId) {},

  /**
   * Fetches transactions/activities within a window.
   * @param {string} connectionId
   * @param {string} [accountId]
   * @param {{ startDate?: string, endDate?: string }} [window]
   * @returns {Promise<import("./models").Transaction[]>}
   */
  async getTransactions(connectionId, accountId, window) {},

  /**
   * Lists institutions the provider supports (for connection UX).
   * @returns {Promise<import("./models").Institution[]>}
   */
  async getInstitutions() {},

  /**
   * Returns the current connection status as known to the provider.
   * @param {string} connectionId
   * @returns {Promise<import("./models").BrokerageConnection>}
   */
  async getConnectionStatus(connectionId) {},

  /**
   * Performs a data sync (incremental or full). See {@link SyncOptions}.
   * @param {string} connectionId
   * @param {SyncOptions} [options]
   * @returns {Promise<SyncResult>}
   */
  async sync(connectionId, options) {},

  /**
   * Refreshes a single account's data (lighter than a full sync).
   * @param {string} connectionId
   * @param {string} accountId
   * @returns {Promise<SyncResult>}
   */
  async refreshAccount(connectionId, accountId) {},

  /**
   * Lightweight provider reachability/auth check.
   * @returns {Promise<HealthStatus>}
   */
  async healthCheck() {}
};

// Required method names. assertProviderContract checks these exist on an adapter.
const REQUIRED_METHODS = Object.freeze([
  "connect",
  "disconnect",
  "refresh",
  "listAccounts",
  "getAccount",
  "getBalances",
  "getPositions",
  "getHoldings",
  "getTransactions",
  "getInstitutions",
  "getConnectionStatus",
  "sync",
  "refreshAccount",
  "healthCheck"
]);

const REQUIRED_FIELDS = Object.freeze(["providerKey", "displayName", "capabilities"]);

/**
 * Validates that an object satisfies the BrokerageProvider contract.
 * Throws a TypeError listing every missing member. Used by the registry at
 * registration time so a broken adapter fails fast rather than at request time.
 *
 * @param {Object} provider
 * @returns {Object} The same provider, when valid (for chaining).
 * @throws {TypeError} when required fields/methods are missing or not functions.
 */
function assertProviderContract(provider) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("BrokerageProvider must be an object.");
  }

  const missingFields = REQUIRED_FIELDS.filter((f) => provider[f] === undefined || provider[f] === null);
  if (missingFields.length) {
    throw new TypeError(`BrokerageProvider missing required fields: ${missingFields.join(", ")}`);
  }

  if (typeof provider.providerKey !== "string" || !provider.providerKey.trim()) {
    throw new TypeError("BrokerageProvider.providerKey must be a non-empty string.");
  }

  const missingMethods = REQUIRED_METHODS.filter((m) => typeof provider[m] !== "function");
  if (missingMethods.length) {
    throw new TypeError(
      `BrokerageProvider "${provider.providerKey}" missing methods: ${missingMethods.join(", ")}`
    );
  }

  return provider;
}

module.exports = {
  // The interface object is exported for reference/documentation and for tests
  // that want to enumerate expected methods. Adapters do NOT extend it — they
  // satisfy the structural contract, which assertProviderContract enforces.
  BrokerageProviderInterface,
  REQUIRED_METHODS,
  REQUIRED_FIELDS,
  assertProviderContract
};
