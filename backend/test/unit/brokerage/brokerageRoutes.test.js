const test = require("node:test");
const assert = require("node:assert/strict");

const { registerBrokerageRoutes } = require("../../../brokerage/http/routes");

test("registerBrokerageRoutes exposes provider-agnostic brokerage endpoints", () => {
  const registered = [];
  const app = {
    get(path, ...handlers) {
      registered.push({ method: "get", path, handlers });
    },
    post(path, ...handlers) {
      registered.push({ method: "post", path, handlers });
    },
    delete(path, ...handlers) {
      registered.push({ method: "delete", path, handlers });
    }
  };

  const service = {
    listProviders() { return []; },
    providerCapabilities() { return null; },
    connect() { return null; },
    listConnections() { return []; },
    getConnection() { return null; },
    disconnect() { return { success: true }; },
    listAccounts() { return []; },
    getAccount() { return null; },
    getBalances() { return []; },
    getPositions() { return []; },
    getHoldings() { return []; },
    getTransactions() { return []; },
    syncConnection() { return { success: true }; },
    refreshAccount() { return { success: true }; }
  };

  registerBrokerageRoutes(app, {
    service,
    requireSignedIn: (req, res, next) => next(),
    attachActiveWorkspace: (req, res, next) => next(),
    requireWorkspaceMember: (req, res, next) => next(),
    apiError: (res, status, payload) => res.status(status).json(payload),
    handleServerError: (res, context, error) => res.status(500).json({ error: String(error?.message || error) })
  });

  const paths = registered.map((entry) => `${entry.method}:${entry.path}`);
  assert(paths.includes("get:/api/brokerage/providers"));
  assert(paths.includes("post:/api/brokerage/connections"));
  assert(paths.includes("get:/api/brokerage/connections"));
  assert(paths.includes("get:/api/brokerage/connections/:connectionId"));
  assert(paths.includes("post:/api/brokerage/connections/:connectionId/sync"));
  assert(paths.includes("get:/api/brokerage/connections/:connectionId/accounts"));
  assert(paths.includes("get:/api/brokerage/connections/:connectionId/accounts/:accountId/holdings"));
});

test("registerBrokerageRoutes exposes the new pilot endpoints", () => {
  const registered = [];
  const app = {
    get(path, ...handlers) { registered.push({ method: "get", path, handlers }); },
    post(path, ...handlers) { registered.push({ method: "post", path, handlers }); },
    delete(path, ...handlers) { registered.push({ method: "delete", path, handlers }); }
  };
  const service = {
    listProviders: () => [], providerCapabilities: () => null, connect: () => null,
    listConnections: () => [], getWorkspaceSummary: () => ({}), getConnection: () => null,
    disconnect: () => ({ success: true }), listAccounts: () => [], getAccount: () => null,
    getBalances: () => [], getPositions: () => [], getHoldings: () => [], getTransactions: () => [],
    syncConnection: () => ({ success: true }), refreshConnection: () => ({}), refreshAccount: () => ({ success: true }),
    healthCheck: () => ({ status: "healthy" })
  };
  const ff = { resolveProviderAvailability: () => ({ available: true }) };
  registerBrokerageRoutes(app, {
    service, featureFlags: ff, env: {},
    requireSignedIn: (req, res, next) => next(),
    attachActiveWorkspace: (req, res, next) => next(),
    requireWorkspaceMember: (req, res, next) => next(),
    apiError: (res, status, payload) => res.status(status).json(payload),
    handleServerError: (res, context, error) => res.status(500).json({ error: String(error?.message || error) })
  });
  const paths = registered.map((e) => `${e.method}:${e.path}`);
  assert(paths.includes("delete:/api/brokerage/connections/:connectionId"));
  assert(paths.includes("post:/api/brokerage/connections/:connectionId/status"));
  assert(paths.includes("get:/api/brokerage/workspace-summary"));
  assert(paths.includes("get:/api/admin/brokerage/provider-health"));
});

test("registerBrokerageRoutes returns available:false (200) for providers when pilot is unavailable", () => {
  const registered = [];
  const app = {
    get(path, ...handlers) { registered.push({ method: "get", path, handlers }); },
    post(path, ...handlers) { registered.push({ method: "post", path, handlers }); },
    delete(path, ...handlers) { registered.push({ method: "delete", path, handlers }); }
  };
  const service = { listProviders: () => [], listConnections: () => [] };
  const ff = { resolveProviderAvailability: () => ({ available: false, reason: "Pilot restricted", code: "BROKERAGE_PILOT_RESTRICTED" }) };
  let captured = null;
  const res = {
    status(code) { captured = { code, body: null }; return this; },
    json(payload) { captured = { code: captured ? captured.code : 200, body: payload }; return this; }
  };
  registerBrokerageRoutes(app, {
    service, featureFlags: ff, env: {},
    requireSignedIn: (req, res, next) => next(),
    attachActiveWorkspace: (req, res, next) => next(),
    requireWorkspaceMember: (req, res, next) => next(),
    apiError: (res, status, payload) => res.status(status).json(payload),
    handleServerError: (res, context, error) => res.status(500).json({ error: String(error?.message || error) })
  });
  const providersRoute = registered.find((r) => r.path === "/api/brokerage/providers");
  providersRoute.handlers[providersRoute.handlers.length - 1]({ workspace: { workspace: { id: "ws-x" } } }, res);
  assert.equal(captured.body.available, false);
  assert.equal(captured.body.code, "BROKERAGE_PILOT_RESTRICTED");
  assert.equal(captured.code, 200);
});

test("registerBrokerageRoutes blocks connections (403) when pilot is unavailable", () => {
  const registered = [];
  const app = {
    get(path, ...handlers) { registered.push({ method: "get", path, handlers }); },
    post(path, ...handlers) { registered.push({ method: "post", path, handlers }); },
    delete(path, ...handlers) { registered.push({ method: "delete", path, handlers }); }
  };
  const service = { listProviders: () => [], listConnections: () => [] };
  const ff = { resolveProviderAvailability: () => ({ available: false, reason: "Pilot restricted", code: "BROKERAGE_PILOT_RESTRICTED" }) };
  let captured = null;
  const res = {
    status(code) { captured = { code, body: null }; return this; },
    json(payload) { captured = { code: captured ? captured.code : 200, body: payload }; return this; }
  };
  registerBrokerageRoutes(app, {
    service, featureFlags: ff, env: {},
    requireSignedIn: (req, res, next) => next(),
    attachActiveWorkspace: (req, res, next) => next(),
    requireWorkspaceMember: (req, res, next) => next(),
    apiError: (res, status, payload) => res.status(status).json(payload),
    handleServerError: (res, context, error) => res.status(500).json({ error: String(error?.message || error) })
  });
  const connectionsRoute = registered.find((r) => r.path === "/api/brokerage/connections");
  connectionsRoute.handlers[connectionsRoute.handlers.length - 1]({ workspace: { workspace: { id: "ws-x" } } }, res);
  assert.equal(captured.code, 403);
  assert.equal(captured.body.code, "BROKERAGE_PILOT_RESTRICTED");
});
