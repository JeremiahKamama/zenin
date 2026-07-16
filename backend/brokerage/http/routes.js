"use strict";

function registerBrokerageRoutes(app, deps = {}) {
  const {
    service,
    requireSignedIn,
    attachActiveWorkspace,
    requireWorkspaceMember,
    apiError,
    handleServerError,
    featureFlags,
    env = process.env
  } = deps;

  if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
    throw new TypeError("registerBrokerageRoutes requires an Express-like app with get/post methods.");
  }

  if (!service || typeof service !== "object") {
    throw new TypeError("registerBrokerageRoutes requires a brokerage service instance.");
  }

  // Pilot gating: a workspace may only see/interact with brokerage when the flag
  // is enabled AND the workspace is eligible. Returns the availability result or
  // sends a 403/503 with a safe, non-secret-leaking message.
  function requireBrokerageAvailable(req, res, workspaceId) {
    const availability = featureFlags
      ? featureFlags.resolveProviderAvailability("snaptrade", workspaceId, {
          configured: (service.providerConfigured && service.providerConfigured()) || true,
          env
        })
      : { available: true };
    if (!availability.available) {
      const status = availability.code === "BROKERAGE_PILOT_RESTRICTED" ? 403 : 503;
      apiError(res, status, {
        error: availability.reason || "Brokerage integration is unavailable.",
        message: availability.reason || "Brokerage integration is unavailable.",
        code: availability.code || "BROKERAGE_UNAVAILABLE"
      });
      return null;
    }
    return availability;
  }

  app.get("/api/brokerage/providers", requireSignedIn, async (req, res) => {
    try {
      const availability = featureFlags
        ? featureFlags.resolveProviderAvailability("snaptrade", req.workspace?.workspace?.id, {
            configured: (service.providerConfigured && service.providerConfigured()) || true,
            env
          })
        : { available: true };
      if (!availability.available) {
        // Honest unavailable state — never leak configuration details.
        return res.json({ providers: [], available: false, reason: availability.reason, code: availability.code });
      }
      const providers = await service.listProviders();
      return res.json({ providers, available: true });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage providers", error);
    }
  });

  app.post("/api/brokerage/connections", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const payload = await service.connect({
        userId: req.auth?.userId,
        workspaceId,
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
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const connections = await service.listConnections(workspaceId);
      return res.json({ connections });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage connections", error);
    }
  });

  app.get("/api/brokerage/workspace-summary", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const summary = await service.getWorkspaceSummary(workspaceId, { source: "brokerage" });
      return res.json(summary);
    } catch (error) {
      return handleServerError(res, "Failed to load brokerage workspace summary", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const connection = await service.getConnection(req.params.connectionId, workspaceId);
      if (!connection) {
        return res.status(404).json({ error: "Brokerage connection not found." });
      }
      return res.json({ connection });
    } catch (error) {
      if (error?.statusCode) {
        return apiError(res, error.statusCode, {
          error: error.message || "Brokerage connection not found",
          message: error.message || "Brokerage connection not found",
          code: error.code || "BROKERAGE_CONNECTION_NOT_FOUND"
        });
      }
      return handleServerError(res, "Failed to load brokerage connection", error);
    }
  });

  // Protected connection-status refresh: re-checks authorization state with the
  // provider and persists the result. Gated on pilot availability.
  app.post("/api/brokerage/connections/:connectionId/status", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const connection = await service.refreshConnection({ connectionId: req.params.connectionId, workspaceId });
      return res.json({ connection });
    } catch (error) {
      if (error?.statusCode) {
        return apiError(res, error.statusCode, {
          error: error.message || "Brokerage status refresh failed",
          message: error.message || "Brokerage status refresh failed",
          code: error.code || "BROKERAGE_STATUS_FAILED"
        });
      }
      return handleServerError(res, "Failed to refresh brokerage connection status", error);
    }
  });

  app.post("/api/brokerage/connections/:connectionId/sync", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const result = await service.syncConnection(req.params.connectionId, workspaceId, {
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

  // Disconnect / remove a connection. Gated on pilot availability.
  app.delete("/api/brokerage/connections/:connectionId", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const result = await service.disconnect({ connectionId: req.params.connectionId, workspaceId });
      return res.json({ ...result, connectionId: req.params.connectionId });
    } catch (error) {
      if (error?.statusCode) {
        return apiError(res, error.statusCode, {
          error: error.message || "Brokerage disconnect failed",
          message: error.message || "Brokerage disconnect failed",
          code: error.code || "BROKERAGE_DISCONNECT_FAILED"
        });
      }
      return handleServerError(res, "Failed to disconnect brokerage connection", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const accounts = await service.listAccounts(req.params.connectionId, workspaceId);
      return res.json({ accounts });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage accounts", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const account = await service.getAccount(req.params.connectionId, req.params.accountId, workspaceId);
      return res.json({ account });
    } catch (error) {
      return handleServerError(res, "Failed to load brokerage account", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId/balances", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const balances = await service.getBalances(req.params.connectionId, workspaceId, req.params.accountId);
      return res.json({ balances });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage balances", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId/positions", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const positions = await service.getPositions(req.params.connectionId, workspaceId, req.params.accountId);
      return res.json({ positions });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage positions", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/accounts/:accountId/holdings", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const holdings = await service.getHoldings(req.params.connectionId, workspaceId, req.params.accountId);
      return res.json({ holdings });
    } catch (error) {
      return handleServerError(res, "Failed to list brokerage holdings", error);
    }
  });

  app.get("/api/brokerage/connections/:connectionId/transactions", requireSignedIn, attachActiveWorkspace, requireWorkspaceMember, async (req, res) => {
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const transactions = await service.getTransactions(req.params.connectionId, workspaceId, {
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
    const workspaceId = req.workspace?.workspace?.id;
    if (!requireBrokerageAvailable(req, res, workspaceId)) return;
    try {
      const result = await service.refreshAccount(req.params.connectionId, req.params.accountId, workspaceId);
      return res.json(result);
    } catch (error) {
      return handleServerError(res, "Failed to refresh brokerage account", error);
    }
  });

  // Internal/admin provider-health route. NOT pilot-gated (operators need to see
  // health even when the pilot is off), but protected by an admin gate passed in.
  app.get("/api/admin/brokerage/provider-health", requireSignedIn, async (req, res) => {
    try {
      if (typeof deps.requireAdmin === "function" && !deps.requireAdmin(req)) {
        return apiError(res, 403, { error: "Admin access required.", code: "ADMIN_REQUIRED" });
      }
      const health = await service.healthCheck();
      return res.json({ health });
    } catch (error) {
      return handleServerError(res, "Failed to read brokerage provider health", error);
    }
  });

  return app;
}

module.exports = {
  registerBrokerageRoutes
};
