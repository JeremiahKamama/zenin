// backend/unifiedNotifications.js
// Pure event-builder for Unified Portfolio sync notifications (Tier 2).
//
// Maps unified sync status -> notification events. This module is PURE + UNIT
// TESTABLE: it performs no DB/network calls and has no side effects. The caller
// (index.js) supplies dispatch via dispatchWorkspaceNotification.
//
// Events (per the revision spec):
//   * auth_failure       — source errored with an auth/credential/scope error
//   * repeated_failure   — source still erroring after a previous failure
//   * stale              — source "synced" but last success is older than threshold
//   * recovered          — source moved error/stale -> synced
//   * material_change    — workspace total value moved >= threshold vs last sync
//
// Dedupe keys keep these from spamming: per-source for sync health, per-day for
// value changes. dispatchWorkspaceNotification upserts on dedupe_key.

const AUTH_RE = /auth|unauthor|401|403|token|credential|scope|permission|invalid (api )?key|api[_ ]?key/i;

function isAuthError(msg) {
  return AUTH_RE.test(String(msg || ""));
}

// staleAfterMs: how old a "synced" source's last success can be before "stale".
function buildUnifiedNotifications({
  sources = [],
  prevSources = [],
  prevTotal = null,
  newTotal = null,
  staleAfterMs = 6 * 60 * 60 * 1000,
  valueChangeThreshold = 0.1
} = {}) {
  const events = [];
  const prevById = new Map();
  for (const s of prevSources || []) prevById.set(`${s.provider}:${s.connectionId}`, s);

  for (const s of sources) {
    const key = `${s.provider}:${s.connectionId}`;
    const prev = prevById.get(key);
    const isError = s.status === "error";
    const isSynced = s.status === "synced" || s.status === "partial";
    const wasError = prev && prev.status === "error";
    const wasStale = prev && prev.stale;
    const errMsg = s.lastError || "";

    if (isError && isAuthError(errMsg)) {
      events.push({
        type: "unified.sync.auth_failure",
        category: "portfolio-sync",
        severity: "error",
        title: `${labelFor(s)} connection auth failed`,
        body: errMsg,
        dedupeKey: `unified-auth:${key}`
      });
      continue;
    }
    if (isError) {
      const attemptedRecently =
        s.lastAttemptedSyncAt && Date.now() - new Date(s.lastAttemptedSyncAt).getTime() < staleAfterMs;
      if (wasError && attemptedRecently) {
        events.push({
          type: "unified.sync.repeated_failure",
          category: "portfolio-sync",
          severity: "warning",
          title: `${labelFor(s)} sync keeps failing`,
          body: errMsg || "Repeated sync failures.",
          dedupeKey: `unified-fail:${key}:${new Date().toISOString().slice(0, 10)}`
        });
      }
      continue;
    }
    if (isSynced && s.stale) {
      events.push({
        type: "unified.sync.stale",
        category: "portfolio-sync",
        severity: "warning",
        title: `${labelFor(s)} data is stale`,
        body: "Last successful sync was a while ago.",
        dedupeKey: `unified-stale:${key}`
      });
    }
    if (isSynced && (wasError || wasStale)) {
      events.push({
        type: "unified.sync.recovered",
        category: "portfolio-sync",
        severity: "success",
        title: `${labelFor(s)} sync recovered`,
        body: "Connected source is syncing normally again.",
        dedupeKey: `unified-recovered:${key}`
      });
    }
  }

  if (prevTotal != null && newTotal != null && Number.isFinite(prevTotal) && Number.isFinite(newTotal)) {
    const delta = newTotal - prevTotal;
    const pct = prevTotal !== 0 ? Math.abs(delta / prevTotal) : newTotal !== 0 ? 1 : 0;
    if (pct >= valueChangeThreshold) {
      events.push({
        type: "unified.value.material_change",
        category: "portfolio",
        severity: delta < 0 ? "warning" : "info",
        title: `Portfolio value moved ${Math.round(pct * 100)}%`,
        body: `${delta < 0 ? "Down" : "Up"} ${Math.round(pct * 100)}% since last sync.`,
        dedupeKey: `unified-value:${new Date().toISOString().slice(0, 10)}`
      });
    }
  }

  return events;
}

function labelFor(s) {
  const p = String(s.provider || "source").charAt(0).toUpperCase() + String(s.provider || "source").slice(1);
  return p;
}

module.exports = { buildUnifiedNotifications, isAuthError };
