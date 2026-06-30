/**
 * SnapTrade Provider Adapter
 * ==========================
 *
 * The first (and currently only) implementation of the BrokerageProvider
 * interface. It is the SINGLE point where SnapTrade SDK calls are made and where
 * SnapTrade DTOs are turned into Zenin domain models.
 *
 * Contract responsibilities:
 *   - Implement every BrokerageProvider method with provider-independent I/O.
 *   - Wrap every SDK call in withSnapTradeErrors() so no vendor exception leaks.
 *   - Map every SDK response via mappers.js so no raw DTO escapes.
 *   - Advertise capabilities honestly (read-only today; order execution off).
 *
 * Connection model: SnapTrade registers a per-user reference, then the user
 * authorizes via a hosted portal URL. We expose that as BrokerageConnection with
 * a `connectionUrl`. The `providerUserRef` is the SnapTrade user id.
 */

"use strict";

const {
  normalizeCapabilities
} = require("../../domain/capabilities");
const { toConnectionStatus } = require("../../domain/models");
const {
  BrokerageError,
  BrokerageAuthenticationError,
  BrokerageSynchronizationError
} = require("../../domain/errors");

const clientModule = require("./client");
const { createSnapTradeClient, getConfig } = clientModule;
const { withSnapTradeErrors } = require("./errors");
const mappers = require("./mappers");

const CAPABILITIES = normalizeCapabilities({
  supportsRealtimeBalances: true,
  supportsFractionalShares: true,
  supportsOptions: true,
  supportsCrypto: false,
  supportsMargin: true,
  supportsWebhooks: false,
  supportsOrderExecution: false,
  supportsTransfers: false,
  supportsStatements: true,
  supportsTaxDocuments: true
}).capabilities;

function isConfigured(env = process.env) {
  return Boolean(clientModule.resolveConfig(env));
}

/** @param {unknown} response */
function unwrap(response) {
  if (response == null) return response;
  if (typeof response === "object" && "data" in response) return response.data;
  return response;
}

/**
 * @param {string} connectionId
 * @param {{ credentials?: { userSecret?: string } }} [context]
 */
function resolveAuth(connectionId, context = {}) {
  const userId = String(connectionId || "").trim();
  const userSecret = String(context?.credentials?.userSecret || "").trim();
  if (!userId) {
    throw new BrokerageError("A connection reference is required.", { statusCode: 400 });
  }
  if (!userSecret) {
    throw new BrokerageAuthenticationError("Brokerage credentials are missing for this connection.");
  }
  return { userId, userSecret };
}

function createSnapTradeProvider(options = {}) {
  const getClient = () => options.client || createSnapTradeClient();
  const providerConfig = options.config || getConfig() || {};

  return {
    providerKey: "snaptrade",
    displayName: "SnapTrade",
    capabilities: CAPABILITIES,

    async connect(context = {}) {
      const client = getClient();
      const userId = String(context.userId || "").trim();
      if (!userId) {
        throw new BrokerageError("connect() requires a userId.", { statusCode: 400 });
      }

      let userSecret = String(context.credentials?.userSecret || "").trim();

      if (!userSecret) {
        const registered = await withSnapTradeErrors(
          () => client.authentication.registerSnapTradeUser({ userId }),
          "register SnapTrade user"
        ).catch((err) => {
          if (err instanceof BrokerageSynchronizationError) return null;
          throw err;
        });

        const payload = unwrap(registered);
        userSecret = String(payload?.userSecret || payload?.user_secret || "").trim();
      }

      if (!userSecret) {
        throw new BrokerageAuthenticationError(
          "Unable to obtain brokerage credentials. Reconnect or contact support."
        );
      }

      const loginBody = {};
      const callback = providerConfig.callbackUrl || context.redirectUrl;
      if (callback) {
        loginBody.connectionType = "read";
        loginBody.customRedirect = callback;
      }

      const login = await withSnapTradeErrors(
        () => client.authentication.loginSnapTradeUser({ userId, userSecret, ...loginBody }),
        "create SnapTrade connection portal URL"
      );

      const loginPayload = unwrap(login);
      const redirectUri =
        loginPayload?.redirectURI ||
        loginPayload?.redirectUri ||
        login?.redirectURI ||
        login?.redirectUri ||
        null;

      return {
        id: userId,
        provider: "snaptrade",
        providerUserRef: userId,
        status: toConnectionStatus(redirectUri ? "pending" : "error"),
        connectionUrl: redirectUri || undefined,
        capabilities: CAPABILITIES,
        providerMeta: { userSecret }
      };
    },

    async disconnect(connectionId, context = {}) {
      const client = getClient();
      const { userId } = resolveAuth(connectionId, context);
      await withSnapTradeErrors(
        () => client.authentication.deleteSnapTradeUser({ userId }),
        "delete SnapTrade user"
      );
      return { success: true };
    },

    async refresh(connectionId, context = {}) {
      const client = getClient();
      const { userId, userSecret } = resolveAuth(connectionId, context);
      const authorizations = await withSnapTradeErrors(
        () => client.connections.listBrokerageAuthorizations({ userId, userSecret }),
        "refresh SnapTrade connection"
      );
      const list = Array.isArray(authorizations) ? authorizations : unwrap(authorizations) || [];
      const status = list.length ? "connected" : "pending";
      return {
        id: userId,
        provider: "snaptrade",
        providerUserRef: userId,
        status: toConnectionStatus(status),
        capabilities: CAPABILITIES,
        providerMeta: { authorizationCount: list.length }
      };
    },

    async getConnectionStatus(connectionId, context = {}) {
      return this.refresh(connectionId, context);
    },

    async listAccounts(connectionId, context = {}) {
      const client = getClient();
      const { userId, userSecret } = resolveAuth(connectionId, context);
      const accounts = await withSnapTradeErrors(
        () => client.accountInformation.listUserAccounts({ userId, userSecret }),
        "list SnapTrade accounts"
      );
      const list = Array.isArray(accounts) ? accounts : unwrap(accounts) || [];
      return list.map((a) => mappers.mapAccount(a, connectionId));
    },

    async getAccount(connectionId, accountId, context = {}) {
      const client = getClient();
      const { userId, userSecret } = resolveAuth(connectionId, context);
      const accounts = await withSnapTradeErrors(
        () => client.accountInformation.listUserAccounts({ userId, userSecret }),
        "get SnapTrade account"
      );
      const list = Array.isArray(accounts) ? accounts : unwrap(accounts) || [];
      const match = list.find((a) => String(a.id) === String(accountId));
      if (!match) {
        const { BrokerageAccountNotFound } = require("../../domain/errors");
        throw new BrokerageAccountNotFound(`Account ${accountId} was not found.`);
      }
      return mappers.mapAccount(match, connectionId);
    },

    async getBalances(connectionId, accountId, context = {}) {
      const client = getClient();
      const { userId, userSecret } = resolveAuth(connectionId, context);
      const accounts = accountId
        ? [{ id: accountId }]
        : await withSnapTradeErrors(
            () => client.accountInformation.listUserAccounts({ userId, userSecret }),
            "list SnapTrade accounts for balances"
          ).then((r) => (Array.isArray(r) ? r : unwrap(r) || []));

      const out = [];
      for (const acc of accounts) {
        const balances = await withSnapTradeErrors(
          () => client.accountInformation.getUserAccountBalance({ userId, userSecret, accountId: acc.id }),
          `get SnapTrade balances for ${acc.id}`
        ).catch(() => []);
        const arr = Array.isArray(balances) ? balances : unwrap(balances) || [];
        for (const b of arr) out.push(...mappers.mapBalances(b, String(acc.id)));
      }
      return out;
    },

    async getPositions(connectionId, accountId, context = {}) {
      const client = getClient();
      const { userId, userSecret } = resolveAuth(connectionId, context);

      if (accountId) {
        const raw = await withSnapTradeErrors(
          () => client.accountInformation.getUserAccountPositions({ userId, userSecret, accountId }),
          "get SnapTrade positions"
        );
        const list = Array.isArray(raw) ? raw : unwrap(raw) || [];
        return list.map((p) => mappers.mapPosition(p, accountId));
      }

      const raw = await withSnapTradeErrors(
        () => client.accountInformation.getAllUserHoldings({ userId, userSecret }),
        "get all SnapTrade positions"
      );
      const tuples = Array.isArray(raw) ? raw : unwrap(raw) || [];
      const out = [];
      for (const tuple of tuples) {
        const acctId = String(tuple?.account?.id || "");
        for (const p of tuple?.positions || []) {
          out.push(mappers.mapPosition(p, acctId));
        }
      }
      return out;
    },

    async getHoldings(connectionId, accountId, context = {}) {
      const client = getClient();
      const { userId, userSecret } = resolveAuth(connectionId, context);
      const raw = accountId
        ? await withSnapTradeErrors(
            () => client.accountInformation.getUserHoldings({ userId, userSecret, accountId }),
            "get SnapTrade holdings"
          )
        : await withSnapTradeErrors(
            () => client.accountInformation.getAllUserHoldings({ userId, userSecret }),
            "get all SnapTrade holdings"
          );
      const tuples = Array.isArray(raw) ? raw : unwrap(raw) || [];
      const out = [];
      for (const tuple of tuples) {
        const acctId = accountId || String(tuple?.account?.id || "");
        const positions = tuple?.positions || [];
        for (const p of positions) out.push(mappers.mapHolding(p, acctId));
      }
      return out;
    },

    async getTransactions(connectionId, accountId, window = {}, context = {}) {
      const client = getClient();
      const { userId, userSecret } = resolveAuth(connectionId, context);
      const raw = await withSnapTradeErrors(
        () => client.transactionsAndReporting.getActivities({
          userId,
          userSecret,
          startDate: window.startDate,
          endDate: window.endDate,
          accounts: accountId ? String(accountId) : undefined
        }),
        "get SnapTrade transactions"
      );
      const list = Array.isArray(raw) ? raw : unwrap(raw) || [];
      return list.map((a) => mappers.mapTransaction(a, accountId || ""));
    },

    async getInstitutions() {
      const client = getClient();
      const raw = await withSnapTradeErrors(
        () => client.referenceData.listAllBrokerages(),
        "list SnapTrade brokerages"
      );
      const list = Array.isArray(raw) ? raw : unwrap(raw) || [];
      return list.map(mappers.mapInstitution);
    },

    async sync(connectionId, options = {}) {
      const context = { credentials: options.credentials };
      const mode = options.mode || "incremental";
      const [accounts, holdings, transactions] = await Promise.all([
        this.listAccounts(connectionId, context),
        this.getHoldings(connectionId, undefined, context),
        this.getTransactions(connectionId, undefined, {
          startDate: mode === "incremental" && options.sinceCursor ? options.sinceCursor : windowStart(30)
        }, context)
      ]);
      return {
        success: true,
        accountsCount: accounts.length,
        holdingsCount: holdings.length,
        transactionsCount: transactions.length,
        syncedAt: new Date().toISOString(),
        meta: { mode }
      };
    },

    async refreshAccount(connectionId, accountId, context = {}) {
      const [holdings, , transactions] = await Promise.all([
        this.getHoldings(connectionId, accountId, context),
        this.getBalances(connectionId, accountId, context),
        this.getTransactions(connectionId, accountId, { startDate: windowStart(30) }, context)
      ]);
      return {
        success: true,
        holdingsCount: holdings.length,
        transactionsCount: transactions.length,
        syncedAt: new Date().toISOString(),
        meta: { accountId }
      };
    },

    async healthCheck() {
      const start = Date.now();
      try {
        const client = getClient();
        await client.apiStatus.check();
        return { status: "healthy", latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
      } catch (err) {
        return {
          status: "unhealthy",
          latencyMs: Date.now() - start,
          message: err?.message || "Provider unreachable",
          checkedAt: new Date().toISOString()
        };
      }
    }
  };
}

function windowStart(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  createSnapTradeProvider,
  isConfigured,
  CAPABILITIES
};
