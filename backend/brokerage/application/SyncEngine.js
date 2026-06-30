/**
 * Brokerage Sync Engine
 * =====================
 *
 * Orchestrates provider data fetches and persists normalized records through
 * the brokerage repository. Responsibilities:
 *   - Incremental and full sync modes
 *   - Retry with backoff on retryable provider errors
 *   - Per-provider rate limiting
 *   - Deduplication (delegated to repository ON CONFLICT rules)
 *   - Cursor persistence for incremental transaction windows
 *   - Background refresh scheduling (via startBackgroundSync)
 *   - Webhook-triggered sync (via handleWebhook)
 */

"use strict";

const { supports } = require("../domain/capabilities");
const {
  BrokerageError,
  BrokerageSynchronizationError,
  toBrokerageError
} = require("../domain/errors");
const {
  mapAccountToDb,
  mapHoldingToDb,
  mapTransactionToDb
} = require("./persistenceMappers");
const { withRetry } = require("./retry");
const { getRateLimiter } = require("./rateLimiter");

const DEFAULT_TX_LOOKBACK_DAYS = 90;

/**
 * @typedef {Object} ProviderContext
 * @property {Object} [credentials]  Opaque credentials for the provider adapter.
 */

/**
 * @typedef {Object} SyncEngineOptions
 * @property {import("../../database").brokerage} repository
 * @property {{ maxRequests?: number, intervalMs?: number }} [rateLimit]
 * @property {{ maxAttempts?: number, baseDelayMs?: number }} [retry]
 */

/**
 * @param {SyncEngineOptions} options
 */
function createSyncEngine(options) {
  const repository = options.repository;
  if (!repository) {
    throw new TypeError("createSyncEngine requires a brokerage repository.");
  }

  const retryOptions = options.retry || {};
  const rateLimitDefaults = options.rateLimit || {};

  /**
   * @param {Object} connection  DB connection row.
   * @param {import("../domain/BrokerageProvider").BrokerageProvider} provider
   * @param {ProviderContext} [providerContext]
   * @param {import("../domain/BrokerageProvider").SyncOptions} [syncOptions]
   */
  async function syncConnection(connection, provider, providerContext = {}, syncOptions = {}) {
    if (!connection?.id || !connection?.providerUserRef) {
      throw new BrokerageSynchronizationError("Invalid connection for sync.");
    }

    const mode = syncOptions.mode || "incremental";
    const signal = syncOptions.signal;
    const lastMeta = connection.lastSyncMeta && typeof connection.lastSyncMeta === "object"
      ? connection.lastSyncMeta
      : {};
    const sinceCursor =
      syncOptions.sinceCursor ||
      lastMeta.transactionCursor ||
      null;

    const limiter = getRateLimiter(provider.providerKey, rateLimitDefaults);
    const context = { credentials: providerContext.credentials };

    const callProvider = async (label, fn) => {
      await limiter.acquire();
      return withRetry(fn, { ...retryOptions, signal });
    };

    let accountsCount = 0;
    let holdingsCount = 0;
    let transactionsInserted = 0;
    let transactionsSkipped = 0;
    let latestExecutedAt = sinceCursor;

    try {
      const refreshed = await callProvider("refresh", () =>
        provider.refresh(connection.providerUserRef, context)
      );

      await repository.connections.updateSync(connection.id, {
        status: refreshed.status || connection.status,
        meta: {
          ...lastMeta,
          lastRefreshAt: new Date().toISOString(),
          authorizationCount: refreshed.providerMeta?.authorizationCount
        }
      });

      const accounts = await callProvider("listAccounts", () =>
        provider.listAccounts(connection.providerUserRef, context)
      );

      const accountFilter = Array.isArray(syncOptions.accountIds)
        ? new Set(syncOptions.accountIds.map(String))
        : null;

      /** @type {Map<string, number>} providerAccountId -> db id */
      const accountIdMap = new Map();

      for (const account of accounts) {
        if (accountFilter && !accountFilter.has(String(account.id))) continue;

        const saved = await repository.accounts.upsert(
          mapAccountToDb(account, connection.id)
        );
        accountIdMap.set(String(account.id), saved.id);
        accountsCount += 1;
      }

      for (const account of accounts) {
        if (accountFilter && !accountFilter.has(String(account.id))) continue;

        const dbAccountId = accountIdMap.get(String(account.id));
        if (!dbAccountId) continue;

        const holdings = await callProvider(`holdings:${account.id}`, () =>
          provider.getHoldings(connection.providerUserRef, account.id, context)
        );

        if (mode === "full") {
          await repository.holdings.removeAll(dbAccountId);
        }

        const holdingRows = holdings.map(mapHoldingToDb);
        const holdingResult = await repository.holdings.sync(dbAccountId, holdingRows);
        holdingsCount += holdingResult.upserted || holdingRows.length;

        const txWindow = buildTransactionWindow(mode, sinceCursor);
        const transactions = await callProvider(`transactions:${account.id}`, () =>
          provider.getTransactions(
            connection.providerUserRef,
            account.id,
            txWindow,
            context
          )
        );

        const txResult = await repository.transactions.sync(
          dbAccountId,
          transactions.map(mapTransactionToDb)
        );
        transactionsInserted += txResult.inserted || 0;
        transactionsSkipped += txResult.skipped || 0;

        for (const tx of transactions) {
          if (tx.executedAt && (!latestExecutedAt || tx.executedAt > latestExecutedAt)) {
            latestExecutedAt = tx.executedAt;
          }
        }
      }

      const syncedAt = new Date().toISOString();
      const nextMeta = {
        ...lastMeta,
        mode,
        accountsCount,
        holdingsCount,
        transactionsInserted,
        transactionsSkipped,
        transactionCursor: latestExecutedAt || sinceCursor || null,
        syncedAt
      };

      await repository.connections.updateSync(connection.id, {
        status: refreshed.status === "pending" ? "pending" : "connected",
        syncedAt,
        meta: nextMeta
      });

      return {
        success: true,
        accountsCount,
        holdingsCount,
        transactionsCount: transactionsInserted + transactionsSkipped,
        insertedCount: transactionsInserted,
        updatedCount: 0,
        skippedCount: transactionsSkipped,
        nextCursor: nextMeta.transactionCursor,
        syncedAt,
        meta: nextMeta
      };
    } catch (error) {
      const brokerageError = toBrokerageError(error);
      await repository.connections.updateSync(connection.id, {
        status: "error",
        syncedAt: new Date().toISOString(),
        meta: {
          ...lastMeta,
          lastError: brokerageError.message,
          lastErrorCode: brokerageError.code,
          retryable: brokerageError.retryable
        }
      }).catch(() => {});

      throw brokerageError;
    }
  }

  /**
   * Lighter single-account refresh used by BrokerageService.refreshAccount.
   */
  async function refreshAccount(connection, provider, accountId, providerContext = {}) {
    const context = { credentials: providerContext.credentials };
    const limiter = getRateLimiter(provider.providerKey, rateLimitDefaults);

    const callProvider = async (fn) => {
      await limiter.acquire();
      return withRetry(fn, retryOptions);
    };

    const dbAccounts = await repository.accounts.list(connection.id);
    const dbAccount = dbAccounts.find((row) => String(row.provider_account_id) === String(accountId));
    if (!dbAccount) {
      throw new BrokerageSynchronizationError("Account not found for refresh.");
    }

    const holdings = await callProvider(() =>
      provider.getHoldings(connection.providerUserRef, accountId, context)
    );
    await repository.holdings.removeAll(dbAccount.id);
    const holdingRows = holdings.map(mapHoldingToDb);
    await repository.holdings.sync(dbAccount.id, holdingRows);

    const transactions = await callProvider(() =>
      provider.getTransactions(
        connection.providerUserRef,
        accountId,
        { startDate: windowStart(DEFAULT_TX_LOOKBACK_DAYS) },
        context
      )
    );
    const txResult = await repository.transactions.sync(
      dbAccount.id,
      transactions.map(mapTransactionToDb)
    );

    const syncedAt = new Date().toISOString();
    return {
      success: true,
      holdingsCount: holdingRows.length,
      transactionsCount: (txResult.inserted || 0) + (txResult.skipped || 0),
      insertedCount: txResult.inserted || 0,
      skippedCount: txResult.skipped || 0,
      syncedAt,
      meta: { accountId }
    };
  }

  /**
   * Processes a provider webhook and schedules sync when supported.
   *
   * @param {Object} params
   * @param {string} params.providerKey
   * @param {import("../domain/BrokerageProvider").BrokerageProvider} params.provider
   * @param {Object} params.payload
   * @param {Object} params.connection
   * @param {ProviderContext} params.providerContext
   */
  async function handleWebhook({ provider, connection, providerContext, payload }) {
    if (!supports(provider.capabilities, "supportsWebhooks")) {
      throw new BrokerageError("Provider does not support webhooks.", { statusCode: 501 });
    }

    const eventType = String(payload?.type || payload?.event || "sync").toLowerCase();
    if (eventType.includes("disconnect") || eventType.includes("revoke")) {
      await repository.connections.updateSync(connection.id, {
        status: "disconnected",
        meta: { webhookEvent: eventType, receivedAt: new Date().toISOString() }
      });
      return { action: "disconnected" };
    }

    const result = await syncConnection(connection, provider, providerContext, { mode: "incremental" });
    return { action: "synced", result };
  }

  return {
    syncConnection,
    refreshAccount,
    handleWebhook
  };
}

/** @type {NodeJS.Timeout|null} */
let backgroundTimer = null;

/**
 * Periodically syncs stale brokerage connections across all workspaces.
 *
 * @param {Object} options
 * @param {(connectionId: number, workspaceId: number) => Promise<unknown>} options.syncFn
 * @param {import("../../database").brokerage} options.repository
 * @param {number} [options.intervalMs=900000]   15 minutes
 * @param {number} [options.staleAfterMs=3600000] 1 hour
 * @param {number} [options.batchSize=10]
 */
function startBackgroundSync(options) {
  stopBackgroundSync();

  const intervalMs = Number(options.intervalMs) || 15 * 60 * 1000;
  const staleAfterMs = Number(options.staleAfterMs) || 60 * 60 * 1000;
  const batchSize = Number(options.batchSize) || 10;
  const repository = options.repository;
  const syncFn = options.syncFn;

  if (!repository || typeof syncFn !== "function") {
    throw new TypeError("startBackgroundSync requires repository and syncFn.");
  }

  const tick = async () => {
    try {
      const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
      const due = await repository.connections.listDueForSync(staleBefore, batchSize);
      for (const connection of due) {
        try {
          await syncFn(connection.id, connection.workspaceId);
        } catch (error) {
          console.warn(
            `[Brokerage] Background sync failed for connection ${connection.id}:`,
            error?.message || error
          );
        }
      }
    } catch (error) {
      console.warn("[Brokerage] Background sync tick failed:", error?.message || error);
    }
  };

  backgroundTimer = setInterval(tick, intervalMs);
  if (typeof backgroundTimer.unref === "function") backgroundTimer.unref();
  tick().catch(() => {});
}

function stopBackgroundSync() {
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
    backgroundTimer = null;
  }
}

function buildTransactionWindow(mode, sinceCursor) {
  if (mode === "incremental" && sinceCursor) {
    return { startDate: String(sinceCursor).slice(0, 10) };
  }
  return { startDate: windowStart(DEFAULT_TX_LOOKBACK_DAYS) };
}

function windowStart(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  createSyncEngine,
  startBackgroundSync,
  stopBackgroundSync
};
