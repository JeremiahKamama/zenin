// journalEvents.js — frontend API client for the Trade Journaling feature
// (Phase 3). Mirrors existing callers: uses zeninFetch (auto CSRF + base URL)
// and parses JSON. All endpoints are workspace-scoped server-side.
import { zeninFetch } from "./zeninFetch";

async function parseOrThrow(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = data?.error || data?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

// The "Needs journaling" queue: open + decision_relevant events.
export async function fetchNeedsJournaling() {
  const res = await zeninFetch("/api/journal-events/needs-journaling");
  const data = await parseOrThrow(res);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchJournalEvents(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  const res = await zeninFetch(`/api/journal-events${qs ? `?${qs}` : ""}`);
  const data = await parseOrThrow(res);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function dismissJournalEvent(id) {
  const res = await zeninFetch(`/api/journal-events/${encodeURIComponent(id)}/dismiss`, {
    method: "POST",
  });
  const data = await parseOrThrow(res);
  return data?.event || null;
}

// Bulk-dismiss journal events. Pass { ids } to dismiss specific events, or {}
// to dismiss all open events (clears a historical reminder flood in one call).
export async function bulkDismissJournalEvents(payload = {}) {
  const res = await zeninFetch(`/api/journal-events/bulk-dismiss`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await parseOrThrow(res);
  return data || { dismissed: 0, ids: [] };
}

export async function snoozeJournalEvent(id, until) {
  const res = await zeninFetch(`/api/journal-events/${encodeURIComponent(id)}/snooze`, {
    method: "POST",
    body: JSON.stringify({ until }),
  });
  const data = await parseOrThrow(res);
  return data?.event || null;
}

// Link the event to a journal entry / decision thread (marks it journaled).
export async function linkJournalEvent(id, payload = {}) {
  const res = await zeninFetch(`/api/journal-events/${encodeURIComponent(id)}/link`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = await parseOrThrow(res);
  return data?.event || null;
}

export async function fetchJournalReminders() {
  const res = await zeninFetch("/api/journal-reminders");
  const data = await parseOrThrow(res);
  return Array.isArray(data?.items) ? data.items : [];
}

// ── Phase 4: periodic reports ──────────────────────────────────────────────
export async function fetchJournalReports(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  const res = await zeninFetch(`/api/journal-reports${qs ? `?${qs}` : ""}`);
  const data = await parseOrThrow(res);
  return Array.isArray(data?.items) ? data.items : [];
}

export async function fetchJournalReportLatest(cadence) {
  const res = await zeninFetch(`/api/journal-reports/${encodeURIComponent(cadence)}`);
  const data = await parseOrThrow(res);
  return data?.report || null;
}

export async function generateJournalReport(payload = {}, { email = false } = {}) {
  const res = await zeninFetch("/api/journal-reports/generate", {
    method: "POST",
    body: JSON.stringify({ ...payload, email }),
  });
  const data = await parseOrThrow(res);
  return data?.report || null;
}

// ── Phase 3: event detail + classification ─────────────────────────────────
export async function fetchJournalEvent(id) {
  if (!id) throw new Error("Event id is required");
  const res = await zeninFetch(`/api/journal-events/${encodeURIComponent(id)}`);
  const data = await parseOrThrow(res);
  return data?.event || null;
}

export async function classifyJournalEvent(id, classification, reason = "") {
  if (!id) throw new Error("Event id is required");
  const normalized = String(classification || "").trim().toLowerCase();
  if (!["decision_relevant", "informational", "noise"].includes(normalized)) {
    throw new Error("Classification must be decision_relevant, informational, or noise");
  }
  const res = await zeninFetch(`/api/journal-events/${encodeURIComponent(id)}/classify`, {
    method: "POST",
    body: JSON.stringify({ classification: normalized, reason: String(reason || "").slice(0, 500) }),
  });
  const data = await parseOrThrow(res);
  return data?.event || null;
}

// ── Phase 6: preferences ───────────────────────────────────────────────────
export async function fetchJournalPrefs() {
  const res = await zeninFetch("/api/journal-prefs");
  const data = await parseOrThrow(res);
  return data?.prefs || { email: true, includeOperational: false, cadence: "weekly" };
}

export async function saveJournalPrefs(patch = {}) {
  const res = await zeninFetch("/api/journal-prefs", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  const data = await parseOrThrow(res);
  return data?.prefs || null;
}
