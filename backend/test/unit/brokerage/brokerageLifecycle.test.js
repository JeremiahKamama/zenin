/**
 * Brokerage lifecycle integration test
 * =====================================
 *
 * Exercises the full HTTP route → service → repository → provider stack for the
 * SnapTrade pilot, using a controllable in-memory mock provider (no external
 * network). Drives the end-to-end lifecycle the spec calls for:
 *
 *   unavailable → pilot-gated → create → sync → refresh → reconnect → disconnect
 *   → workspace isolation
 *
 * And asserts the security invariant that survives every step:
 *   NO plaintext secret / userSecret / userSecretEncrypted ever leaves the API,
 *   while the encrypted secret IS persisted server-side.
 *
 * Run: node --test test/unit/brokerage/brokerageLifecycle.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { BrokerageRegistry } = require("../../../brokerage/infrastructure/BrokerageRegistry");
const { createSyncEngine } = require("../../../brokerage/application/SyncEngine");
const { createBrokerageService } = require("../../../brokerage/application/BrokerageService");
const { registerBrokerageRoutes } = require("../../../brokerage/http/routes");
const realFeatureFlags = require("../../../brokerage/application/featureFlags");

// ── Controllable mock provider (models the SnapTrade portal-return lifecycle) ──
function createLifecycleProvider() {
  const state = {
    afterAuthStatus: "connected", // what refresh() reports after the user authorizes
    userSecret: "plain-secret-ABC123",
    connectionUrl: "https://snaptrade.example/portal?t=sess_xyz"
  };
  const provider = {
    providerKey: "snaptrade",
    displayName: "SnapTrade (test)",
    capabilities: {},
    isConfigured: () => true,
    async connect(ctx) {
      return {
        id: ctx.userId,
        provider: "snaptrade",
        providerUserRef: ctx.userId,
        status: "pending", // awaiting authorization at the hosted portal
        capabilities: {},
        connectionUrl: state.connectionUrl,
        providerMeta: { userSecret: state.userSecret }
      };
    },
    async disconnect() {
      return { success: true };
    },
    async refresh(ref) {
      return {
        id: ref,
        provider: "snaptrade",
        providerUserRef: ref,
        status: state.afterAuthStatus,
        capabilities: {},
        providerMeta: {}
      };
    },
    async getConnectionStatus(ref) {
      return this.refresh(ref);
    },
    async listAccounts(ref) {
      return [
        {
          id: "acc_1",
          connectionId: ref,
          name: "Brokerage",
          institutionName: "Fidelity",
          accountType: "cash",
          maskedNumber: "••••5678",
          syncedAt: new Date().toISOString()
        }
      ];
    },
    async getAccount() {
      return { id: "acc_1", name: "Brokerage" };
    },
    async getBalances() {
      return [];
    },
    async getPositions() {
      return [];
    },
    async getHoldings() {
      return [
        {
          accountId: "acc_1",
          symbol: "AAPL",
          name: "Apple Inc.",
          quantity: 10,
          marketValue: 1650.0,
          asOf: new Date().toISOString()
        }
      ];
    },
    async getTransactions() {
      return [];
    },
    async getInstitutions() {
      return [{ id: "inst_1", name: "Fidelity" }];
    },
    async sync() {
      return {
        success: true,
        accountsCount: 1,
        holdingsCount: 1,
        transactionsCount: 0,
        syncedAt: new Date().toISOString()
      };
    },
    async refreshAccount() {
      return { success: true };
    },
    async healthCheck() {
      return { status: "healthy", checkedAt: new Date().toISOString() };
    }
  };
  provider._state = state; // test-only handle to flip behavior
  return provider;
}

// ── In-memory repository (mirrors the production shape used by other tests) ──
function makeRepository() {
  let nextId = 1;
  const connections = new Map();
  return {
    connections: {
      list: async (workspaceId) =>
        Array.from(connections.values()).filter((c) => c.workspaceId === workspaceId),
      getById: async (id, workspaceId) => {
        const row = connections.get(Number(id)) || connections.get(id);
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
      remove: async (id) => { connections.delete(Number(id)); connections.delete(id); },
      listDueForSync: async () => []
    },
    accounts: { list: async () => [], upsert: async () => ({ id: 1 }) },
    holdings: { removeAll: async () => {}, sync: async () => ({ upserted: 0 }) },
    transactions: { sync: async () => ({ inserted: 0, skipped: 0 }) }
  };
}

const secretProvider = {
  encryptSecret: (value) => `enc:${value}`,
  decryptSecret: (value) => String(value).replace(/^enc:/, "")
};

// ── Minimal Express-like dispatcher that runs the REAL handler chain ──
function createApp() {
  const routes = [];
  const app = {
    get: (p, ...h) => routes.push({ method: "get", p, h }),
    post: (p, ...h) => routes.push({ method: "post", p, h }),
    delete: (p, ...h) => routes.push({ method: "delete", p, h })
  };
  app._routes = routes;
  return app;
}

function matchPath(pattern, path) {
  const pp = pattern.split("/");
  const sp = path.split("/");
  if (pp.length !== sp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

function makeDispatcher(app) {
  return async function dispatch(method, path, ctx = {}) {
    const { query = {}, body = {}, userId = 1, workspaceId = 1 } = ctx;
    const route = app._routes.find((r) => r.method === method && matchPath(r.p, path));
    if (!route) return { status: 404, body: { error: "no route matched" } };
    let captured = null;
    const res = {
      _status: 200,
      status(c) {
        this._status = c;
        return this;
      },
      json(b) {
        captured = { status: this._status, body: b };
        return this;
      }
    };
    const req = {
      method,
      path,
      query,
      body,
      params: matchPath(route.p, path) || {},
      auth: { userId },
      workspace: { workspace: { id: workspaceId } }
    };
    let idx = 0;
    const next = () => {
      const h = route.h[idx++];
      if (!h) return undefined;
      return h(req, res, next);
    };
    await next();
    return captured;
  };
}

// Build a fully-wired brokerage stack with a fresh in-memory repository.
function buildStack({ featureFlags, env } = {}) {
  const registry = new BrokerageRegistry();
  const provider = createLifecycleProvider();
  registry.registerProvider(provider);
  const repository = makeRepository();
  const service = createBrokerageService({
    registry,
    repository,
    syncEngine: createSyncEngine({ repository }),
    secretProvider
  });
  const app = createApp();
  registerBrokerageRoutes(app, {
    service,
    featureFlags,
    env,
    requireSignedIn: (req, res, next) => next(),
    attachActiveWorkspace: (req, res, next) => next(),
    requireWorkspaceMember: (req, res, next) => next(),
    requireAdmin: () => true,
    apiError: (res, status, payload) => res.status(status).json(payload),
    handleServerError: (res, context, error) =>
      res.status(500).json({ error: String(error?.message || error) })
  });
  return { dispatch: makeDispatcher(app), repository, service, provider };
}

// Recursively assert a serialized payload contains no secret material.
function assertNoSecretLeak(label, body) {
  const raw = JSON.stringify(body == null ? "" : body);
  assert.ok(
    !/plain-secret-ABC123|userSecret|userSecretEncrypted/.test(raw),
    `secret leaked in ${label}: ${raw.slice(0, 200)}`
  );
}

// ════════════════════════════════════════════════════════════════════════
// 1) UNAVAILABLE — pilot flag off: discovery honest, writes blocked
// ════════════════════════════════════════════════════════════════════════
test("lifecycle: unavailable provider exposes honest discovery and blocks writes", async () => {
  const featureFlags = {
    resolveProviderAvailability: () => ({
      available: false,
      reason: "Brokerage integration is not enabled.",
      code: "BROKERAGE_DISABLED"
    })
  };
  const { dispatch } = buildStack({ featureFlags, env: {} });

  const providers = await dispatch("get", "/api/brokerage/providers", { workspaceId: 1 });
  assert.equal(providers.status, 200);
  assert.equal(providers.body.available, false);
  assert.equal(providers.body.code, "BROKERAGE_DISABLED");
  assert.deepEqual(providers.body.providers, []);

  const created = await dispatch("post", "/api/brokerage/connections", {
    workspaceId: 1,
    body: { providerKey: "snaptrade" }
  });
  assert.equal(created.status, 503);
  assert.equal(created.body.code, "BROKERAGE_DISABLED");

  const summary = await dispatch("get", "/api/brokerage/workspace-summary", { workspaceId: 1 });
  assert.equal(summary.status, 503);
});

// ════════════════════════════════════════════════════════════════════════
// 2) PILOT RESTRICTION — flag on, workspace not on allow-list
// ════════════════════════════════════════════════════════════════════════
test("lifecycle: pilot gating rejects a non-eligible workspace", async () => {
  const env = { SNAPTRADE_ENABLED: "true", SNAPTRADE_PILOT_WORKSPACES: "1" };
  const { dispatch } = buildStack({ featureFlags: realFeatureFlags, env });

  // Workspace 1 is eligible.
  const eligible = await dispatch("get", "/api/brokerage/providers", { workspaceId: 1 });
  assert.equal(eligible.body.available, true);
  assert.ok(Array.isArray(eligible.body.providers));
  assert.ok(eligible.body.providers.some((p) => p.providerKey === "snaptrade"));

  // Workspace 2 is not on the allow-list → 403.
  const blocked = await dispatch("post", "/api/brokerage/connections", {
    workspaceId: 2,
    body: { providerKey: "snaptrade" }
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "BROKERAGE_PILOT_RESTRICTED");

  const blockedSummary = await dispatch("get", "/api/brokerage/workspace-summary", { workspaceId: 2 });
  assert.equal(blockedSummary.status, 403);
});

// ════════════════════════════════════════════════════════════════════════
// 3) FULL LIFECYCLE — create → sync → refresh → reconnect → disconnect
// ════════════════════════════════════════════════════════════════════════
test("lifecycle: create → sync → refresh → reconnect → disconnect (workspace 1, pilot-on)", async () => {
  const env = { SNAPTRADE_ENABLED: "true", SNAPTRADE_PILOT_WORKSPACES: "1,2" };
  const { dispatch, repository, provider } = buildStack({
    featureFlags: realFeatureFlags,
    env
  });

  // ── CREATE (connect) ──
  const createRes = await dispatch("post", "/api/brokerage/connections", {
    workspaceId: 1,
    userId: 7,
    body: { providerKey: "snaptrade", redirectUrl: "https://app.example/return" }
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.status, "pending");
  assert.equal(createRes.body.connectionUrl, "https://snaptrade.example/portal?t=sess_xyz");
  assert.ok(typeof createRes.body.id === "number", "connection id returned");
  const connectionId = createRes.body.id;

  // Security: no secret in the response, but encrypted form IS persisted.
  assertNoSecretLeak("create response", createRes.body);
  const stored = await repository.connections.getById(connectionId, 1);
  assert.equal(stored.providerMeta.userSecretEncrypted, "enc:plain-secret-ABC123");

  // ── REFRESH (portal-return recovery → authorized) ──
  const refreshRes = await dispatch("post", `/api/brokerage/connections/${connectionId}/status`, {
    workspaceId: 1
  });
  assert.equal(refreshRes.status, 200);
  assert.equal(refreshRes.body.connection.status, "connected");
  assertNoSecretLeak("refresh response", refreshRes.body);

  // ── SYNC (first full sync) ──
  const syncRes = await dispatch("post", `/api/brokerage/connections/${connectionId}/sync`, {
    workspaceId: 1,
    body: { mode: "full" }
  });
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.body.success, true);
  assert.equal(syncRes.body.mode || syncRes.body.meta?.mode, "full");
  assertNoSecretLeak("sync response", syncRes.body);

  // ── WORKSPACE SUMMARY reflects accounts + holdings + aggregated value ──
  const summaryRes = await dispatch("get", "/api/brokerage/workspace-summary", { workspaceId: 1 });
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.body.available, true);
  assert.equal(summaryRes.body.connections.length, 1);
  assert.equal(summaryRes.body.accounts.length, 1);
  assert.equal(summaryRes.body.accounts[0].institutionName, "Fidelity");
  assert.equal(summaryRes.body.holdings.length, 1);
  assert.equal(summaryRes.body.holdings[0].symbol, "AAPL");
  assert.equal(summaryRes.body.brokerageValue, 1650);
  assert.equal(summaryRes.body.requiresReconnect, false);
  assert.equal(summaryRes.body.syncFailed, false);
  assertNoSecretLeak("workspace summary", summaryRes.body);

  // Per-account holdings endpoint also works and stays secret-free.
  const holdingsRes = await dispatch(
    "get",
    `/api/brokerage/connections/${connectionId}/accounts/acc_1/holdings`,
    { workspaceId: 1 }
  );
  assert.equal(holdingsRes.status, 200);
  assert.equal(holdingsRes.body.holdings[0].symbol, "AAPL");
  assertNoSecretLeak("account holdings", holdingsRes.body);

  // ── RECONNECT (simulate token expiry → re-authorize) ──
  provider._state.afterAuthStatus = "expired";
  const expiredRes = await dispatch("post", `/api/brokerage/connections/${connectionId}/status`, {
    workspaceId: 1
  });
  assert.equal(expiredRes.body.connection.status, "expired");
  const reconnectSummary = await dispatch("get", "/api/brokerage/workspace-summary", { workspaceId: 1 });
  assert.equal(reconnectSummary.body.requiresReconnect, true);

  // Re-establish: flip back to connected, refresh, then re-create (new portal URL).
  provider._state.afterAuthStatus = "connected";
  const reauthRes = await dispatch("post", `/api/brokerage/connections/${connectionId}/status`, {
    workspaceId: 1
  });
  assert.equal(reauthRes.body.connection.status, "connected");
  // A fresh connect for the same workspace re-issues a portal URL (reconnect path).
  const reconnectRes = await dispatch("post", "/api/brokerage/connections", {
    workspaceId: 1,
    userId: 7,
    body: { providerKey: "snaptrade" }
  });
  assert.equal(reconnectRes.status, 200);
  assert.equal(reconnectRes.body.connectionUrl, "https://snaptrade.example/portal?t=sess_xyz");
  assertNoSecretLeak("reconnect response", reconnectRes.body);

  // ── DISCONNECT ──
  const deleteRes = await dispatch("delete", `/api/brokerage/connections/${connectionId}`, {
    workspaceId: 1
  });
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);
  assertNoSecretLeak("disconnect response", deleteRes.body);

  // Connection is gone: GET → 404.
  const gone = await dispatch("get", `/api/brokerage/connections/${connectionId}`, { workspaceId: 1 });
  assert.equal(gone.status, 404);

  // Summary is empty.
  const after = await dispatch("get", "/api/brokerage/workspace-summary", { workspaceId: 1 });
  assert.equal(after.body.connections.length, 0);
  assert.equal(after.body.accounts.length, 0);
  assert.equal(after.body.brokerageValue, 0);
});

// ════════════════════════════════════════════════════════════════════════
// 4) WORKSPACE ISOLATION — ws2 cannot read/delete ws1's connection
// ════════════════════════════════════════════════════════════════════════
test("lifecycle: workspace isolation — connection owned by ws1 is invisible to ws2", async () => {
  const env = { SNAPTRADE_ENABLED: "true", SNAPTRADE_PILOT_WORKSPACES: "1,2" };
  const { dispatch, repository } = buildStack({ featureFlags: realFeatureFlags, env });

  // Both workspaces are pilot-eligible, so any difference is pure isolation.
  const createRes = await dispatch("post", "/api/brokerage/connections", {
    workspaceId: 1,
    userId: 7,
    body: { providerKey: "snaptrade" }
  });
  const connectionId = createRes.body.id;
  assert.ok(typeof connectionId === "number");

  // ws2 lists connections → empty (cannot see ws1's).
  const ws2List = await dispatch("get", "/api/brokerage/connections", { workspaceId: 2 });
  assert.equal(ws2List.body.connections.length, 0);

  // ws2 reads ws1's connection → 404.
  const ws2Get = await dispatch("get", `/api/brokerage/connections/${connectionId}`, {
    workspaceId: 2
  });
  assert.equal(ws2Get.status, 404);

  // ws2 deletes ws1's connection → 404 (no cross-workspace deletion).
  const ws2Delete = await dispatch("delete", `/api/brokerage/connections/${connectionId}`, {
    workspaceId: 2
  });
  assert.equal(ws2Delete.status, 404);

  // ws1 can still see it.
  const ws1Get = await dispatch("get", `/api/brokerage/connections/${connectionId}`, {
    workspaceId: 1
  });
  assert.equal(ws1Get.status, 200);
  assert.equal(ws1Get.body.connection.id, connectionId);

  // Sanity: the row is still present (ws2's failed delete did nothing).
  const stored = await repository.connections.getById(connectionId, 1);
  assert.ok(stored, "connection still owned by ws1");
});

// ════════════════════════════════════════════════════════════════════════
// 5) ADMIN HEALTH GATE — provider-health is admin-protected
// ════════════════════════════════════════════════════════════════════════
test("lifecycle: admin provider-health route enforces admin gate", async () => {
  const env = { SNAPTRADE_ENABLED: "true", SNAPTRADE_PILOT_WORKSPACES: "1" };
  const registry = new BrokerageRegistry();
  registry.registerProvider(createLifecycleProvider());
  const repository = makeRepository();
  const service = createBrokerageService({
    registry,
    repository,
    syncEngine: createSyncEngine({ repository }),
    secretProvider
  });

  const app = createApp();
  registerBrokerageRoutes(app, {
    service,
    featureFlags: realFeatureFlags,
    env,
    requireSignedIn: (req, res, next) => next(),
    attachActiveWorkspace: (req, res, next) => next(),
    requireWorkspaceMember: (req, res, next) => next(),
    requireAdmin: () => false, // simulate non-admin
    apiError: (res, status, payload) => res.status(status).json(payload),
    handleServerError: (res, context, error) =>
      res.status(500).json({ error: String(error?.message || error) })
  });
  const dispatch = makeDispatcher(app);

  const denied = await dispatch("get", "/api/admin/brokerage/provider-health", { workspaceId: 1 });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "ADMIN_REQUIRED");
});
