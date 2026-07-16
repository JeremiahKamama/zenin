/**
 * Brokerage API client (frontend)
 * ================================
 *
 * Thin, typed-ish wrapper over the brokerage backend endpoints. Every call goes
 * through zeninFetchJson (cookie auth + CSRF + resilient retry), so this module
 * only encodes paths, shapes, and the SnapTrade portal-return flow state.
 *
 * The backend gates these endpoints behind SNAPTRADE_ENABLED + a pilot allow-list.
 * When unavailable, the endpoints return `{ available: false, code, reason }`
 * (providers) or 403/503 (others). Callers must surface those states honestly —
 * never fabricate a connection.
 */

import { zeninFetchJson } from "./zeninFetch.js";

const PROVIDER_KEY = "snaptrade";

/** Returns the callback URL SnapTrade's portal should return to. */
export function getBrokerageCallbackUrl() {
  const configured = import.meta.env?.VITE_SNAPTRADE_CALLBACK_URL;
  if (configured && String(configured).trim()) return String(configured).trim();
  if (typeof window !== "undefined") {
    return `${window.location.origin}/app/settings/connections?brokerage=snaptrade`;
  }
  return "/app/settings/connections?brokerage=snaptrade";
}

// ── Session-storage pending-flow helpers ──────────────────────────────────────
// The portal opens in a new tab; on return we restore the pending connection id
// so the flow can run the first sync and show success/denied/error states.
const PENDING_FLOW_KEY = "zenin_brokerage_pending_flow";

export function savePendingBrokerageFlow({ connectionId, providerKey = PROVIDER_KEY, startedAt = Date.now() }) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_FLOW_KEY, JSON.stringify({ connectionId, providerKey, startedAt }));
  } catch {
    /* sessionStorage may be unavailable (private mode) — non-fatal */
  }
}

export function readPendingBrokerageFlow() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_FLOW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPendingBrokerageFlow() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(PENDING_FLOW_KEY);
  } catch {
    /* noop */
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export async function fetchBrokerageProviders() {
  const data = await zeninFetchJson("/api/brokerage/providers", { method: "GET" });
  // Honest unavailable state: { available:false, code, reason } (HTTP 200) or
  // a thrown ZeninRequestError for 403/503.
  return {
    available: Boolean(data?.available),
    providers: Array.isArray(data?.providers) ? data.providers : [],
    code: data?.code || null,
    reason: data?.reason || null
  };
}

export async function createBrokerageConnection({ providerKey = PROVIDER_KEY, redirectUrl } = {}) {
  const data = await zeninFetchJson("/api/brokerage/connections", {
    method: "POST",
    body: JSON.stringify({ providerKey, redirectUrl: redirectUrl || getBrokerageCallbackUrl() })
  });
  return data;
}

export async function listBrokerageConnections() {
  const data = await zeninFetchJson("/api/brokerage/connections", { method: "GET" });
  return Array.isArray(data?.connections) ? data.connections : [];
}

export async function getBrokerageConnection(connectionId) {
  const data = await zeninFetchJson(`/api/brokerage/connections/${connectionId}`, { method: "GET" });
  return data?.connection || null;
}

export async function refreshBrokerageConnectionStatus(connectionId) {
  const data = await zeninFetchJson(`/api/brokerage/connections/${connectionId}/status`, { method: "POST" });
  return data?.connection || null;
}

export async function syncBrokerageConnection(connectionId, { mode = "full" } = {}) {
  const data = await zeninFetchJson(`/api/brokerage/connections/${connectionId}/sync`, {
    method: "POST",
    body: JSON.stringify({ mode })
  });
  return data;
}

export async function deleteBrokerageConnection(connectionId) {
  const data = await zeninFetchJson(`/api/brokerage/connections/${connectionId}`, { method: "DELETE" });
  return data;
}

export async function fetchBrokerageWorkspaceSummary() {
  const data = await zeninFetchJson("/api/brokerage/workspace-summary", { method: "GET" });
  return data || null;
}

export async function fetchBrokerageAccounts(connectionId) {
  const data = await zeninFetchJson(`/api/brokerage/connections/${connectionId}/accounts`, { method: "GET" });
  return Array.isArray(data?.accounts) ? data.accounts : [];
}

export async function fetchBrokerageHoldings(connectionId, accountId) {
  const path = accountId
    ? `/api/brokerage/connections/${connectionId}/accounts/${accountId}/holdings`
    : `/api/brokerage/connections/${connectionId}/accounts/__all__/holdings`;
  const data = await zeninFetchJson(path, { method: "GET" });
  return Array.isArray(data?.holdings) ? data.holdings : [];
}
