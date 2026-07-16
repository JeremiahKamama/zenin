/**
 * Brokerage Feature Flags
 * =======================
 *
 * Controls pilot rollout of brokerage integrations (initially SnapTrade) without
 * code changes. A brokerage integration is eligible only when ALL of:
 *   1. The provider is configured (credentials present) — checked by the provider.
 *   2. The feature flag is enabled (SNAPTRADE_ENABLED=true).
 *   3. The workspace is on the pilot allow-list (SNAPTRADE_PILOT_WORKSPACES),
 *      OR no allow-list is configured (open pilot).
 *
 * All checks are pure and environment-driven so they can be unit-tested without
 * a running server. No provider SDK is touched here.
 */

"use strict";

const PROVIDER_KEY = "snaptrade";

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether the brokerage pilot flag is explicitly enabled.
 */
function isBrokerageEnabled(env = process.env) {
  const raw = (env.SNAPTRADE_ENABLED || "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * Parses the pilot allow-list. Accepts a comma/space/newline separated list of
 * workspace ids. An empty/undefined value means "no allow-list" (open pilot).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Set<string>|null} null when no allow-list is configured.
 */
function parsePilotAllowList(env = process.env) {
  const raw = (env.SNAPTRADE_PILOT_WORKSPACES || "").trim();
  if (!raw) return null;
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(ids);
}

/**
 * @param {string|number} [workspaceId]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether the workspace may use brokerage integrations.
 */
function isWorkspaceEligible(workspaceId, env = process.env) {
  if (!isBrokerageEnabled(env)) return false;
  const allowList = parsePilotAllowList(env);
  if (!allowList) return true; // open pilot
  const id = String(workspaceId || "").trim();
  return allowList.has(id);
}

/**
 * Resolves the availability of a specific provider for a workspace.
 *
 * @param {string} providerKey
 * @param {string|number} [workspaceId]
 * @param {{ configured: boolean, env?: NodeJS.ProcessEnv }} context
 *   `configured` comes from the provider adapter's isConfigured() check.
 * @returns {{ available: boolean, reason?: string, code?: string }}
 */
function resolveProviderAvailability(providerKey, workspaceId, context = {}) {
  const env = context.env || process.env;
  const key = String(providerKey || "").trim().toLowerCase();

  if (key !== PROVIDER_KEY) {
    return { available: false, reason: "Unknown brokerage provider.", code: "BROKERAGE_PROVIDER_UNKNOWN" };
  }
  if (!context.configured) {
    return {
      available: false,
      reason: "Brokerage integration is not configured on this server.",
      code: "BROKERAGE_UNAVAILABLE"
    };
  }
  if (!isBrokerageEnabled(env)) {
    return {
      available: false,
      reason: "Brokerage integration is not enabled.",
      code: "BROKERAGE_DISABLED"
    };
  }
  if (!isWorkspaceEligible(workspaceId, env)) {
    return {
      available: false,
      reason: "Your workspace is not on the brokerage pilot.",
      code: "BROKERAGE_PILOT_RESTRICTED"
    };
  }
  return { available: true };
}

module.exports = {
  PROVIDER_KEY,
  isBrokerageEnabled,
  parsePilotAllowList,
  isWorkspaceEligible,
  resolveProviderAvailability
};
