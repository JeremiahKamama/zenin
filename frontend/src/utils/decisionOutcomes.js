// decisionOutcomes.js — frontend client for the Decision Outcomes API
// (Phase 4). Uses zeninFetch (cookie auth + base URL resolution) like the
// other journal clients. Responses are workspace-scoped server-side.
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

// GET /api/decision-threads/outcomes -> { items, aggregated }
// aggregated = { byResult, totalPnl, winCount, lossCount, total }
export async function fetchDecisionOutcomes(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  const res = await zeninFetch(`/api/decision-threads/outcomes${qs ? `?${qs}` : ""}`);
  const data = await parseOrThrow(res);
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    aggregated: data?.aggregated || {
      byResult: {},
      totalPnl: 0,
      winCount: 0,
      lossCount: 0,
      total: 0,
    },
  };
}
