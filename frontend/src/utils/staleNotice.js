export function getSnapshotFallbackMessage(payload, fallback = "Showing the last saved snapshot while refresh retries.") {
  if (!payload || typeof payload !== "object") return fallback;
  if (payload?.tryLater || /(^|\b)(429|rate[_\s-]?limit|too many requests)(\b|$)/i.test(String(payload?.stale_reason || ""))) {
    return "Rate limit hit. Showing the last saved snapshot. Try later.";
  }
  return payload?.statusMessage || fallback;
}
