// utils/macro/fetchMacro.js — base-URL resolution + candidate fallback for the
// macro Tier-1 adapters. Mirrors AnalyticsModule.fetchApiJson's resilience
// (primary base + hosted fallback, retry circuit) so the Tier-1 rail uses the
// SAME working backend as the rest of the desk. Components never call this
// directly — only adapters.js does.
import { zeninFetchJson } from "../zeninFetch.js";
import { HOSTED_BACKEND_URL } from "../../constants/apiConfig.js";

function normalizeApiBaseUrl(u) {
  if (!u) return "";
  return String(u).replace(/\/+$/, "");
}

export function getApiBaseCandidates(baseUrl) {
  const primary = normalizeApiBaseUrl(baseUrl);
  const hosted = normalizeApiBaseUrl(HOSTED_BACKEND_URL);
  const candidates = [];
  if (primary) candidates.push(primary);
  if (hosted && hosted !== primary) candidates.push(hosted);
  return candidates.length ? candidates : [hosted];
}

// Fetch JSON trying each candidate base. Throws the last error if all fail.
export async function fetchJsonViaCandidates(baseUrl, path, options = {}) {
  const candidates = getApiBaseCandidates(baseUrl);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await zeninFetchJson(`${candidate}${path}`, options);
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "REQUEST_ABORTED") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error(`Failed to fetch ${path}`);
}
