const test = require("node:test");
const assert = require("node:assert/strict");

const { REQUIRED_METHODS } = require("../../../brokerage/domain/BrokerageProvider");
const { BrokerageRateLimitError } = require("../../../brokerage/domain/errors");
const { createSyncEngine } = require("../../../brokerage/application/SyncEngine");
const { withRetry } = require("../../../brokerage/application/retry");
const { resetRateLimiters } = require("../../../brokerage/application/rateLimiter");

function makeValidProvider(overrides = {}) {
  const provider = {
    providerKey: "mock",
    displayName: "Mock Provider",
    capabilities: { supportsWebhooks: true },
  };
  for (const m of REQUIRED_METHODS) {
    provider[m] = async () => ({ success: true });
  }
  return { ...provider, ...overrides };
}

function makeMockRepository() {
  const state = {
    connections: new Map([[1, {
      id: 1,
      userId: 10,
      workspaceId: 20,
      provider: "mock",
      providerUserRef: "w20-u10",
      status: "pending",
      capabilities: {},
      lastSyncMeta: {},
      providerMeta: { userSecretEncrypted: "enc:secret" }
    }]]),
    accounts: [],
    holdings: [],
    transactions: []
  };

  return {
    connections: {
      updateSync: async (id, patch) => {
        const row = state.connections.get(id);
        if (!row) return null;
        if (patch.status) row.status = patch.status;
        if (patch.syncedAt) row.lastSyncedAt = patch.syncedAt;
        if (patch.meta) row.lastSyncMeta = { ...row.lastSyncMeta, ...patch.meta };
        return row;
      },
      listDueForSync: async () => Array.from(state.connections.values())
    },
    accounts: {
      list: async (connectionId) => state.accounts.filter((a) => a.connection_id === connectionId),
      upsert: async (payload) => {
        const existing = state.accounts.find(
          (a) => a.connection_id === payload.connectionId && a.provider_account_id === payload.providerAccountId
        );
        if (existing) return existing;
        const row = {
          id: state.accounts.length + 1,
          connection_id: payload.connectionId,
          provider_account_id: payload.providerAccountId,
          name: payload.name
        };
        state.accounts.push(row);
        return row;
      }
    },
    holdings: {
      removeAll: async (accountId) => {
        state.holdings = state.holdings.filter((h) => h.account_id !== accountId);
      },
      sync: async (accountId, holdings) => ({ upserted: holdings.length })
    },
    transactions: {
      sync: async (accountId, txs) => ({ inserted: txs.length, skipped: 0 })
    },
    _state: state
  };
}

test("withRetry retries retryable errors", async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 2) throw new BrokerageRateLimitError("slow down");
    return "ok";
  }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("syncConnection persists accounts, holdings, and transactions", async () => {
  resetRateLimiters();
  const repository = makeMockRepository();
  const engine = createSyncEngine({ repository, rateLimit: { maxRequests: 100, intervalMs: 100 } });

  const provider = makeValidProvider({
    async refresh() {
      return {
        providerUserRef: "w20-u10",
        status: "connected",
        providerMeta: { authorizationCount: 1 }
      };
    },
    async listAccounts() {
      return [{
        id: "acct-1",
        connectionId: "w20-u10",
        name: "Primary",
        institutionName: "Mock Bank",
        accountType: "cash"
      }];
    },
    async getHoldings(_ref, accountId) {
      return [{
        accountId,
        symbol: "AAPL",
        assetType: "equity",
        quantity: 5,
        averageEntryPrice: { amount: 100, currency: "USD" }
      }];
    },
    async getTransactions(_ref, accountId) {
      return [{
        id: "tx-1",
        accountId,
        type: "buy",
        side: "buy",
        symbol: "AAPL",
        quantity: 5,
        executedAt: "2026-06-01T00:00:00.000Z"
      }];
    }
  });

  const connection = repository._state.connections.get(1);
  const result = await engine.syncConnection(connection, provider, { credentials: { userSecret: "secret" } });

  assert.equal(result.success, true);
  assert.equal(result.accountsCount, 1);
  assert.equal(result.holdingsCount, 1);
  assert.equal(result.insertedCount, 1);
  assert.equal(connection.status, "connected");
  assert.equal(connection.lastSyncMeta.transactionCursor, "2026-06-01T00:00:00.000Z");
});

test("syncConnection marks connection error on provider failure", async () => {
  resetRateLimiters();
  const repository = makeMockRepository();
  const engine = createSyncEngine({ repository });

  const provider = makeValidProvider({
    async refresh() {
      throw new BrokerageRateLimitError("rate limited");
    }
  });

  const connection = repository._state.connections.get(1);
  await assert.rejects(
    () => engine.syncConnection(connection, provider, { credentials: { userSecret: "secret" } }),
    BrokerageRateLimitError
  );
  assert.equal(connection.status, "error");
  assert.equal(connection.lastSyncMeta.retryable, true);
});
