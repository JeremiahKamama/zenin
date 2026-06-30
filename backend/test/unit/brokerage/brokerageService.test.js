const test = require("node:test");
const assert = require("node:assert/strict");

const { REQUIRED_METHODS } = require("../../../brokerage/domain/BrokerageProvider");
const { BrokerageRegistry } = require("../../../brokerage/infrastructure/BrokerageRegistry");
const { createSyncEngine } = require("../../../brokerage/application/SyncEngine");
const { createBrokerageService } = require("../../../brokerage/application/BrokerageService");

function makeValidProvider(overrides = {}) {
  const provider = {
    providerKey: "mock",
    displayName: "Mock Provider",
    capabilities: {},
  };
  for (const m of REQUIRED_METHODS) {
    provider[m] = async () => ({ success: true });
  }
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
          (c) =>
            c.workspaceId === payload.workspaceId &&
            c.provider === payload.provider &&
            c.providerUserRef === payload.providerUserRef
        );
        if (existing) {
          Object.assign(existing, payload);
          return existing;
        }
        const row = {
          id: nextId++,
          userId: payload.userId,
          workspaceId: payload.workspaceId,
          provider: payload.provider,
          providerUserRef: payload.providerUserRef,
          status: payload.status,
          capabilities: payload.capabilities || {},
          providerMeta: payload.providerMeta || {},
          lastSyncMeta: {}
        };
        connections.set(row.id, row);
        return row;
      },
      updateSync: async (id, patch) => {
        const row = connections.get(id);
        if (!row) return null;
        if (patch.status) row.status = patch.status;
        if (patch.meta) row.lastSyncMeta = { ...(row.lastSyncMeta || {}), ...patch.meta };
        return row;
      },
      remove: async (id) => connections.delete(id),
      listDueForSync: async () => []
    },
    accounts: { list: async () => [], upsert: async () => ({ id: 1 }) },
    holdings: { removeAll: async () => {}, sync: async () => ({ upserted: 0 }) },
    transactions: { sync: async () => ({ inserted: 0, skipped: 0 }) }
  };
}

test("createBrokerageService encrypts provider secrets on connect", async () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({
    async connect() {
      return {
        id: "w1-u2",
        provider: "mock",
        providerUserRef: "w1-u2",
        status: "pending",
        connectionUrl: "https://example.com/connect",
        capabilities: {},
        providerMeta: { userSecret: "plain-secret" }
      };
    }
  }));

  const repository = makeRepository();
  const service = createBrokerageService({
    registry,
    repository,
    syncEngine: createSyncEngine({ repository }),
    secretProvider
  });

  const connection = await service.connect({ userId: 2, workspaceId: 1 });

  assert.equal(connection.connectionUrl, "https://example.com/connect");
  assert.equal(connection.providerMeta.userSecret, undefined);
  assert.equal(connection.providerMeta.userSecretEncrypted, undefined);

  const stored = await repository.connections.getById(connection.id, 1);
  assert.equal(stored.providerMeta.userSecretEncrypted, "enc:plain-secret");
});

test("createBrokerageService resolves provider via registry, not direct import", async () => {
  const registry = new BrokerageRegistry();
  let listAccountsCalled = false;
  registry.registerProvider(makeValidProvider({
    async listAccounts(ref, context) {
      listAccountsCalled = true;
      assert.equal(ref, "w5-u9");
      assert.equal(context.credentials.userSecret, "stored-secret");
      return [];
    }
  }));

  const repository = makeRepository();
  const saved = await repository.connections.upsert({
    userId: 9,
    workspaceId: 5,
    provider: "mock",
    providerUserRef: "w5-u9",
    status: "connected",
    providerMeta: { userSecretEncrypted: secretProvider.encryptSecret("stored-secret") }
  });

  const service = createBrokerageService({
    registry,
    repository,
    syncEngine: createSyncEngine({ repository }),
    secretProvider
  });

  await service.listAccounts(saved.id, 5);
  assert.equal(listAccountsCalled, true);
});

test("syncConnection requires stored credentials", async () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider());
  const repository = makeRepository();
  const saved = await repository.connections.upsert({
    userId: 1,
    workspaceId: 1,
    provider: "mock",
    providerUserRef: "w1-u1",
    status: "connected",
    providerMeta: {}
  });

  const service = createBrokerageService({
    registry,
    repository,
    syncEngine: createSyncEngine({ repository }),
    secretProvider
  });

  await assert.rejects(
    () => service.syncConnection(saved.id, 1),
    /credentials are missing/i
  );
});
