const test = require("node:test");
const assert = require("node:assert/strict");

const { REQUIRED_METHODS } = require("../../../brokerage/domain/BrokerageProvider");
const { BrokerageRegistry } = require("../../../brokerage/infrastructure/BrokerageRegistry");
const { createSyncEngine } = require("../../../brokerage/application/SyncEngine");
const { createBrokerageService } = require("../../../brokerage/application/BrokerageService");

function makeValidProvider(overrides = {}) {
  const provider = { providerKey: "mock", displayName: "Mock Provider", capabilities: {} };
  for (const m of REQUIRED_METHODS) provider[m] = async () => ({ success: true });
  return { ...provider, ...overrides };
}

const secretProvider = {
  encryptSecret: (value) => `enc:${value}`,
  decryptSecret: (value) => String(value).replace(/^enc:/, "")
};

function makeRepository() {
  let nextId = 1;
  const connections = new Map();
  return {
    connections: {
      list: async (workspaceId) =>
        Array.from(connections.values()).filter((c) => c.workspaceId === workspaceId),
      getById: async (id, workspaceId) => {
        const row = connections.get(id);
        return row && row.workspaceId === workspaceId ? row : null;
      },
      upsert: async (payload) => {
        const existing = Array.from(connections.values()).find(
          (c) => c.workspaceId === payload.workspaceId && c.provider === payload.provider && c.providerUserRef === payload.providerUserRef
        );
        if (existing) { Object.assign(existing, payload); return existing; }
        const row = { id: nextId++, ...payload, lastSyncMeta: {} };
        connections.set(row.id, row);
        return row;
      },
      updateSync: async (id, patch) => { const row = connections.get(id); if (row) Object.assign(row, patch); return row; },
      remove: async (id) => connections.delete(id)
    },
    accounts: { list: async () => [], upsert: async () => ({ id: 1 }) },
    holdings: { removeAll: async () => {}, sync: async () => ({ upserted: 0 }) },
    transactions: { sync: async () => ({ inserted: 0, skipped: 0 }) }
  };
}

function buildService(providerOverrides = {}) {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider(providerOverrides));
  const repository = makeRepository();
  const service = createBrokerageService({
    registry,
    repository,
    syncEngine: createSyncEngine({ repository }),
    secretProvider
  });
  return { service, repository };
}

test("getWorkspaceSummary returns sanitized connections and no secrets", async () => {
  const { service, repository } = buildService({
    async listAccounts() { return [{ id: "acc-1", name: "Brokerage Acct", number: "****1234" }]; },
    async getHoldings() {
      return [
        { symbol: "AAPL", quantity: 10, marketValue: 1900 },
        { symbol: "MSFT", quantity: 5, marketValue: 2100 }
      ];
    }
  });

  const conn = await repository.connections.upsert({
    userId: 1,
    workspaceId: 7,
    provider: "mock",
    providerUserRef: "w7-u1",
    status: "connected",
    providerMeta: { userSecretEncrypted: "enc:topsecret" },
    lastSyncedAt: "2026-07-15T10:00:00.000Z"
  });

  const summary = await service.getWorkspaceSummary(7, { source: "brokerage" });

  assert.equal(summary.available, true);
  assert.equal(summary.connections.length, 1);
  assert.equal(summary.connections[0].id, conn.id);
  // Never expose the secret / encrypted blob.
  assert.equal(summary.connections[0].providerMeta?.userSecretEncrypted, undefined);
  assert.equal(summary.connections[0].providerMeta?.userSecret, undefined);

  assert.equal(summary.accounts.length, 1);
  assert.equal(summary.accounts[0].sourceKind, "mock");
  assert.equal(summary.holdings.length, 2);
  assert.equal(summary.brokerageValue, 4000);
  assert.equal(summary.lastSyncAt, "2026-07-15T10:00:00.000Z");
  assert.equal(summary.requiresReconnect, false);
  assert.equal(summary.syncFailed, false);
});

test("getWorkspaceSummary flags reconnect when connection expired", async () => {
  const { service, repository } = buildService({
    async listAccounts() { return []; },
    async getHoldings() { return []; }
  });
  await repository.connections.upsert({
    userId: 1, workspaceId: 7, provider: "mock", providerUserRef: "w7-u2",
    status: "expired", providerMeta: {}
  });
  const summary = await service.getWorkspaceSummary(7);
  assert.equal(summary.requiresReconnect, true);
});

test("getWorkspaceSummary isolates provider errors without blanking", async () => {
  const { service, repository } = buildService({
    async listAccounts() { throw new Error("provider down"); },
    async getHoldings() { throw new Error("provider down"); }
  });
  await repository.connections.upsert({
    userId: 1, workspaceId: 7, provider: "mock", providerUserRef: "w7-u3",
    status: "connected", providerMeta: {}
  });
  const summary = await service.getWorkspaceSummary(7);
  assert.equal(summary.connections.length, 1);
  assert.equal(summary.accounts.length, 0);
  assert.equal(summary.holdings.length, 0);
  assert.equal(summary.errors.length, 2);
});

test("getWorkspaceSummary empty workspace returns safe shape", async () => {
  const { service } = buildService();
  const summary = await service.getWorkspaceSummary(99);
  assert.equal(summary.connections.length, 0);
  assert.equal(summary.accounts.length, 0);
  assert.equal(summary.holdings.length, 0);
  assert.equal(summary.brokerageValue, 0);
  assert.equal(summary.lastSyncAt, null);
  assert.equal(summary.requiresReconnect, false);
});

test("providerConfigured reflects provider isConfigured", async () => {
  const { service } = buildService({ isConfigured: () => true });
  assert.equal(service.providerConfigured(), true);
  const { service: svc2 } = buildService(); // no isConfigured → defaults true
  assert.equal(svc2.providerConfigured(), true);
});
