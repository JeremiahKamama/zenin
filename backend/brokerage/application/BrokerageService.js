/**
 * Brokerage Service (Application Layer)
 * =====================================
 *
 * Provider-agnostic façade used by the API layer. Depends on BrokerageRegistry
 * (not concrete adapters) and delegates synchronization to SyncEngine.
 *
 * No SnapTrade (or any provider) types, SDKs, or terminology appear here.
 */

"use strict";

const { BrokerageError, BrokerageProviderNotFound, toBrokerageError } = require("../domain/errors");
const { sanitizeConnection, extractCredentials, sealProviderMeta, buildProviderUserRef } = require("./credentials");
const { mapConnectionFromDb } = require("./persistenceMappers");

/**
 * @typedef {Object} BrokerageServiceDeps
 * @property {import("../infrastructure/BrokerageRegistry").BrokerageRegistry} registry
 * @property {import("../../database").brokerage} repository
 * @property {ReturnType<import("./SyncEngine").createSyncEngine>} syncEngine
 * @property {{ encryptSecret: Function, decryptSecret: Function }} secretProvider
 */

/**
 * @param {BrokerageServiceDeps} deps
 */
function createBrokerageService(deps) {
  const { registry, repository, syncEngine, secretProvider } = deps;
  if (!registry || !repository || !syncEngine || !secretProvider) {
    throw new TypeError("createBrokerageService requires registry, repository, syncEngine, and secretProvider.");
  }

  function resolveProvider(providerKey) {
    try {
      return registry.getProvider(providerKey);
    } catch (error) {
      if (error instanceof BrokerageProviderNotFound) {
        throw new BrokerageError("Brokerage provider is not available.", {
          code: "BROKERAGE_PROVIDER_UNAVAILABLE",
          statusCode: 503,
          cause: error
        });
      }
      throw error;
    }
  }

  async function loadConnection(connectionId, workspaceId) {
    const row = await repository.connections.getById(connectionId, workspaceId);
    if (!row) {
      throw new BrokerageError("Brokerage connection not found.", {
        code: "BROKERAGE_CONNECTION_NOT_FOUND",
        statusCode: 404
      });
    }
    return row;
  }

  function buildProviderContext(connection) {
    return {
      credentials: extractCredentials(connection.providerMeta, secretProvider)
    };
  }

  function defaultProviderKey(explicit) {
    if (explicit) return String(explicit).trim().toLowerCase();
    try {
      return registry.defaultProvider().providerKey;
    } catch (error) {
      if (error instanceof BrokerageProviderNotFound) {
        throw new BrokerageError("No brokerage providers are configured.", {
          code: "BROKERAGE_UNAVAILABLE",
          statusCode: 503,
          cause: error
        });
      }
      throw error;
    }
  }

  return {
    listProviders() {
      return registry.listProviders();
    },

    providerCapabilities(providerKey) {
      return registry.providerCapabilities(defaultProviderKey(providerKey));
    },

    async healthCheck(providerKey) {
      const provider = resolveProvider(defaultProviderKey(providerKey));
      return provider.healthCheck();
    },

    /**
     * Starts (or resumes) a brokerage connection for a workspace member.
     */
    async connect({ userId, workspaceId, providerKey, redirectUrl }) {
      const key = defaultProviderKey(providerKey);
      const provider = resolveProvider(key);
      const providerUserRef = buildProviderUserRef(workspaceId, userId);

      const existing = await repository.connections.list(workspaceId);
      const match = existing.find(
        (row) => row.provider === key && row.providerUserRef === providerUserRef
      );

      const connectContext = {
        userId: providerUserRef,
        workspaceId: String(workspaceId),
        redirectUrl,
        credentials: match ? extractCredentials(match.providerMeta, secretProvider) : undefined
      };

      const connection = await provider.connect(connectContext);
      const providerMeta = sealProviderMeta(
        {
          ...(match?.providerMeta || {}),
          ...(connection.providerMeta || {})
        },
        {
          userSecret:
            connection.providerMeta?.userSecret ||
            connectContext.credentials?.userSecret
        },
        secretProvider
      );

      const saved = await repository.connections.upsert({
        userId,
        workspaceId,
        provider: key,
        providerUserRef,
        status: connection.status || "pending",
        capabilities: connection.capabilities || provider.capabilities,
        providerMeta
      });

      return {
        ...sanitizeConnection(saved),
        connectionUrl: connection.connectionUrl || null
      };
    },

    async disconnect({ connectionId, workspaceId }) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      const context = buildProviderContext(row);

      await provider.disconnect(row.providerUserRef, context);
      await repository.connections.remove(connectionId);
      return { success: true };
    },

    async refreshConnection({ connectionId, workspaceId }) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      const refreshed = await provider.refresh(row.providerUserRef, buildProviderContext(row));

      const saved = await repository.connections.upsert({
        userId: row.userId,
        workspaceId,
        provider: row.provider,
        providerUserRef: row.providerUserRef,
        status: refreshed.status || row.status,
        capabilities: refreshed.capabilities || row.capabilities,
        providerMeta: {
          ...row.providerMeta,
          ...(refreshed.providerMeta || {})
        }
      });

      return sanitizeConnection(saved);
    },

    async listConnections(workspaceId) {
      const rows = await repository.connections.list(workspaceId);
      return rows.map(sanitizeConnection);
    },

    async getConnection(connectionId, workspaceId) {
      const row = await loadConnection(connectionId, workspaceId);
      return sanitizeConnection(row);
    },

    async listAccounts(connectionId, workspaceId) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      return provider.listAccounts(row.providerUserRef, buildProviderContext(row));
    },

    async getAccount(connectionId, accountId, workspaceId) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      return provider.getAccount(row.providerUserRef, accountId, buildProviderContext(row));
    },

    async getBalances(connectionId, workspaceId, accountId) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      return provider.getBalances(row.providerUserRef, accountId, buildProviderContext(row));
    },

    async getPositions(connectionId, workspaceId, accountId) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      return provider.getPositions(row.providerUserRef, accountId, buildProviderContext(row));
    },

    async getHoldings(connectionId, workspaceId, accountId) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      return provider.getHoldings(row.providerUserRef, accountId, buildProviderContext(row));
    },

    async getTransactions(connectionId, workspaceId, { accountId, startDate, endDate } = {}) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      return provider.getTransactions(
        row.providerUserRef,
        accountId,
        { startDate, endDate },
        buildProviderContext(row)
      );
    },

    async getInstitutions(providerKey) {
      const provider = resolveProvider(defaultProviderKey(providerKey));
      return provider.getInstitutions();
    },

    async syncConnection(connectionId, workspaceId, options = {}) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      const context = buildProviderContext(row);

      if (!context.credentials?.userSecret) {
        throw new BrokerageError("Connection credentials are missing. Reconnect the brokerage.", {
          code: "BROKERAGE_AUTH_ERROR",
          statusCode: 401
        });
      }

      try {
        return await syncEngine.syncConnection(row, provider, context, options);
      } catch (error) {
        throw toBrokerageError(error);
      }
    },

    async refreshAccount(connectionId, accountId, workspaceId) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(row.provider);
      const context = buildProviderContext(row);

      try {
        return await syncEngine.refreshAccount(row, provider, accountId, context);
      } catch (error) {
        throw toBrokerageError(error);
      }
    },

    async handleWebhook(providerKey, connectionId, workspaceId, payload) {
      const row = await loadConnection(connectionId, workspaceId);
      const provider = resolveProvider(defaultProviderKey(providerKey || row.provider));
      return syncEngine.handleWebhook({
        provider,
        connection: row,
        providerContext: buildProviderContext(row),
        payload
      });
    },

    /** Maps a DB row to the domain connection shape (for internal consumers). */
    toDomainConnection(row) {
      return mapConnectionFromDb(row);
    }
  };
}

module.exports = {
  createBrokerageService
};
