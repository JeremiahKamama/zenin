/**
 * Brokerage connection status presentation
 * ========================================
 *
 * Maps the backend's canonical connection status (connected / disconnected /
 * expired / error / pending) plus live sync metadata to the five user-facing
 * badge states the spec requires:
 *   Connected · Syncing · Needs reconnection · Sync failed · Unavailable
 *
 * Pure, dependency-free, and shared by the connection flow, the Connected
 * Accounts drawer, and Home — so the same label is never computed in three
 * places.
 */

export const BROKERAGE_BADGE = Object.freeze({
  CONNECTED: "Connected",
  SYNCING: "Syncing",
  RECONNECT: "Needs reconnection",
  FAILED: "Sync failed",
  UNAVAILABLE: "Unavailable"
});

/**
 * @param {object} connection  sanitized brokerage connection from the API.
 * @param {{ syncing?: boolean }} [opts]  live UI hint (e.g. a sync is in flight).
 * @returns {{ state: string, label: string, tone: string }}
 *   tone is one of: ok | warn | danger | idle (for CSS, not hue alone).
 */
export function deriveBrokerageBadge(connection, opts = {}) {
  if (!connection) return { state: "unavailable", label: BROKERAGE_BADGE.UNAVAILABLE, tone: "idle" };

  const status = String(connection.status || "pending").toLowerCase();
  const syncFailed = Boolean(connection.syncError) || status === "error";
  const needsReconnect = status === "expired" || status === "revoked" || status === "disconnected";

  if (opts.syncing) return { state: "syncing", label: BROKERAGE_BADGE.SYNCING, tone: "warn" };
  if (needsReconnect) return { state: "reconnect", label: BROKERAGE_BADGE.RECONNECT, tone: "warn" };
  if (syncFailed) return { state: "failed", label: BROKERAGE_BADGE.FAILED, tone: "danger" };
  if (status === "connected" || status === "active" || status === "verified") {
    return { state: "connected", label: BROKERAGE_BADGE.CONNECTED, tone: "ok" };
  }
  if (status === "pending") return { state: "pending", label: "Awaiting authorization", tone: "idle" };
  return { state: "unavailable", label: BROKERAGE_BADGE.UNAVAILABLE, tone: "idle" };
}

/**
 * Masks an account number for display: keeps the last 4 characters, hides the
 * rest. Returns an empty string when no number is available (never "undefined").
 */
export function maskAccountNumber(number) {
  const raw = String(number || "").trim();
  if (!raw) return "";
  const last4 = raw.slice(-4);
  if (raw.length <= 4) return `••••${last4}`;
  return `••••${last4}`;
}

/**
 * Human-readable "last synced" relative label. Falls back to an honest
 * "Never synced" rather than a fabricated timestamp.
 */
export function formatLastSync(lastSyncedAt) {
  if (!lastSyncedAt) return "Never synced";
  const ts = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(ts)) return "Never synced";
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `Synced ${days}d ago`;
}

/**
 * Detects duplicate symbols across manual and brokerage holdings without
 * merging them. Returns the set of symbols present in BOTH sources.
 */
export function findDuplicateSymbols(manualHoldings = [], brokerageHoldings = []) {
  const manualSymbols = new Set(
    (manualHoldings || []).map((h) => String(h?.symbol || h?.assetSymbol || "").toUpperCase()).filter(Boolean)
  );
  const duplicates = new Set();
  for (const h of brokerageHoldings || []) {
    const sym = String(h?.symbol || h?.assetSymbol || "").toUpperCase();
    if (sym && manualSymbols.has(sym)) duplicates.add(sym);
  }
  return [...duplicates];
}
