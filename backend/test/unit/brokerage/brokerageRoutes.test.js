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
