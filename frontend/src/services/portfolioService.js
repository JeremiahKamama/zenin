// services/portfolioService.js
// Frontend client for the Unified Multi-Source Portfolio API (Phase A/B backend).
// All calls degrade gracefully: callers must handle null/error when the backend
// endpoint is unavailable (e.g. older backend, offline, 401).

import { zeninFetchJson } from "@/utils/zeninFetch";

// GET /api/portfolio/unified/summary
// Backend returns the summary object directly (no wrapper). Accept both shapes
// so callers get the summary whether or not a future version wraps it.
export async function fetchUnifiedSummary({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/unified/summary", { signal, timeoutMs: 8000 });
  if (!data) return null;
  return data.summary && typeof data.summary === "object" ? data.summary : data;
}

// GET /api/portfolio/unified/positions
export async function fetchUnifiedPositions({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/unified/positions", { signal, timeoutMs: 8000 });
  return data && Array.isArray(data.positions) ? data.positions : [];
}

// GET /api/portfolio/unified/sources
export async function fetchUnifiedSources({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/unified/sources", { signal, timeoutMs: 8000 });
  return data && Array.isArray(data.sources) ? data.sources : [];
}

// GET /api/portfolio/unified/equity-curve
// Approximate equity curve reconstructed from synced fills (fresh wallets w/o EOD snapshots).
export async function fetchUnifiedEquityCurve({ signal, limit = 180, from = null, to = null } = {}) {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const data = await zeninFetchJson(`/portfolio/unified/equity-curve?${qs.toString()}`, { signal, timeoutMs: 8000 });
  const curve = data && Array.isArray(data.curve) ? data.curve : [];
  return curve
    .filter((p) => Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.equity)))
    .map((p) => ({ t: Number(p.t), equity: Number(p.equity), benchmark: p.benchmark != null ? Number(p.benchmark) : null }));
}

// POST /api/portfolio/prediction-wallet/sync
// Records a connected prediction-market wallet/account as a canonical source.
export async function syncPredictionWalletSource(payload, { signal } = {}) {
  const data = await zeninFetchJson("/portfolio/prediction-wallet/sync", {
    method: "POST",
    body: JSON.stringify(payload || {}),
    signal,
    timeoutMs: 30000
  });
  return data || null;
}

// DELETE /api/portfolio/prediction-wallet/:connectionId
export async function disconnectPredictionWalletSource(connectionId, { signal } = {}) {
  const data = await zeninFetchJson(`/portfolio/prediction-wallet/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
    signal,
    timeoutMs: 10000
  });
  return data || null;
}

// POST /api/portfolio/sync  -> triggers real connected-source syncs + recompute.
export async function triggerUnifiedSync({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/sync", {
    method: "POST",
    signal,
    timeoutMs: 30000
  });
  return data || null;
}

// GET /api/portfolio/unified/sync-status
export async function fetchUnifiedSyncStatus({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/unified/sync-status", { signal, timeoutMs: 8000 });
  return data || null;
}

// GET /api/portfolio/unified/transactions
export async function fetchUnifiedTransactions({ signal, limit } = {}) {
  const qs = limit ? `?limit=${limit}` : "";
  const data = await zeninFetchJson(`/portfolio/unified/transactions${qs}`, { signal, timeoutMs: 8000 });
  return data && Array.isArray(data.transactions) ? data.transactions : [];
}

// GET /api/portfolio/unified/reconciliation
export async function fetchUnifiedReconciliation({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/unified/reconciliation", { signal, timeoutMs: 8000 });
  return data || null;
}

// GET /api/portfolio/unified/fx-rates
export async function fetchUnifiedFxRates({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/unified/fx-rates", { signal, timeoutMs: 8000 });
  return data || null;
}

// GET /api/portfolio/unified/snapshots (immutable EOD unified history)
export async function fetchUnifiedSnapshots({ signal, limit } = {}) {
  const qs = limit ? `?limit=${limit}` : "";
  const data = await zeninFetchJson(`/portfolio/unified/snapshots${qs}`, { signal, timeoutMs: 8000 });
  return data && Array.isArray(data.snapshots) ? data.snapshots : [];
}

// POST /api/portfolio/unified/backfill — triggers historical snapshot backfill.
// Replays transactions up to each historical date at historical close prices.
// Idempotent (ON CONFLICT DO NOTHING). Returns async status; backend runs in
// background via setImmediate — frontend should poll snapshots after triggering.
export async function triggerHistoricalBackfill({ from, through, maxDays, batchSize, signal } = {}) {
  const body = JSON.stringify({
    ...(from && { from }),
    ...(through && { through }),
    ...(maxDays && { maxDays }),
    ...(batchSize && { batchSize }),
  });
  const data = await zeninFetchJson("/portfolio/unified/backfill", {
    method: "POST",
    body,
    signal,
    timeoutMs: 10000,
  });
  return data || null;
}

// GET /api/portfolio/unified/sync-status
// legacy manual book vs unified manual slice + expected connected-book divergence).
export async function fetchUnifiedShadowComparison({ signal } = {}) {
  const data = await zeninFetchJson("/portfolio/unified/shadow-compare", { signal, timeoutMs: 8000 });
  return data || null;
}
