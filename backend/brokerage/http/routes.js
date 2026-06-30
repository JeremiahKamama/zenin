"use strict";

function registerBrokerageRoutes(app, deps = {}) {
  const {
    service,
    requireSignedIn,
    attachActiveWorkspace,
    requireWorkspaceMember,
    apiError,
    handleServerError
  } = deps;

  if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
    throw new TypeError("registerBrokerageRoutes requires an Express-like app with get/post methods.");
  }

  if (!service || typeof service !== "object") {
    throw new TypeError("registerBrokerageRoutes requires a brokerage service instance.");
  }

  app.get("/api/brokerage/providers", requireSignedIn, async (req, res) => {
    try {
      const providers = await service.listProviders();
      return res.json({ providers });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage providers", error);
    }
  });

  app.post("/api/brokerage/connections", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const payload = await service.connect({
        userId: req.auth?.userId,
        workspaceId: req.workspace?.workspace?.id,
        providerKey: req.body?.providerKey,
        redirectUrl: req.body?.redirectUrl
      });
      return res.json(payload);
    } catch (error) {
      if (error?.statusCode) {
        return apiError(res, error.statusCode, {
          error: error.message || "Brokerage connection failed",
          message: error.message || "Brokerage connection failed",
          code: error.code || "BROKERAGE_CONNECTION_FAILED"
        });
      }
      return handleServerError(res, "Failed to create brokerage connection", error);
    }
  });

  app.get("/api/brokerage/connections", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const connections = await service.listConnections(req.workspace?.workspace?.id);
      return res.json({ connections });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage connections", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const connection = await service.getConnection(req.params.connectionId, req.workspace?.workspace?.id);
      if (!connection) {
        return res.status(404).json({ error: "Brokerage connection not found." });
      }
      return res.json({ connection });
    } catch (error) {
      return handleServerError(res, "Failed to load brokerage connection", error);
    }
  });

  app.post("/api/brokerage/connections/:connectionId/sync", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const result = await service.syncConnection(req.params.connectionId, req.workspace?.workspace?.id, {
        mode: req.body?.mode || "incremental"
      });
      return res.json(result);
    } catch (error) {
      if (error?.statusCode) {
        return apiError(res, error.statusCode, {
          error: error.message || "Brokerage sync failed",
          message: error.message || "Brokerage sync failed",
          code: error.code || "BROKERAGE_SYNC_FAILED"
        });
      }
      return handleServerError(res, "Failed to sync brokerage connection", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const accounts = await service.listAccounts(req.params.connectionId, req.workspace?.workspace?.id);
      return res.json({ accounts });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage accounts", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const account = await service.getAccount(req.params.connectionId, req.params.accountId, req.workspace?.workspace?.id);
      return res.json({ account });
    } catch (error) {
      return handleServerError(res, "Failed to load brokerage account", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId/balances", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const balances = await service.getBalances(req.params.connectionId, req.workspace?.workspace?.id, req.params.accountId);
      return res.json({ balances });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage balances", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId/positions", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const positions = await service.getPositions(req.params.connectionId, req.workspace?.workspace?.id, req.params.accountId);
      return res.json({ positions });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage positions", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId/holdings", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const holdings = await service.getHoldings(req.params.connectionId, req.workspace?.workspace?.id, req.params.accountId);
      return res.json({ holdings });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage holdings", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/transactions", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const transactions = await service.getTransactions(req.params.connectionId, req.workspace?.workspace?.id, {
        accountId: req.query?.accountId,
        startDate: req.query?.startDate,
        endDate: req.query?.endDate
      });
      return res.json({ transactions });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage transactions", error);
    }
  });

  app.post("/api/brokerage/connections/:connectionId/accounts/:accountId/refresh", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    try {
      const result = await service.refreshAccount(req.params.connectionId, req.params.accountId, req.workspace?.workspace?.id);
      return res.json(result);
    } catch (error) {
      return handleServerError(res, "Failed to refresh brokerage account", error);
    }
  });

  return app;
}

module.exports = {
  registerBrokerageRoutes
};
