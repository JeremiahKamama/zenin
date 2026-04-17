export function getSnapshotFallbackMessage(payload, fallback = "") {
  const suppressPattern = /(Rate limit hit\. Showing the last saved snapshot\. Try later\.|Showing the last saved snapshot while refresh retries\.)/i;
  const normalizedFallback = String(fallback || "").trim();

  if (!payload || typeof payload !== "object") {
    return suppressPattern.test(normalizedFallback) ? "" : normalizedFallback;
  }

  if (payload?.tryLater || /(^|\b)(429|rate[_\s-]?limit|too many requests)(\b|$)/i.test(String(payload?.stale_reason || ""))) {
    return "";
  }

  const statusMessage = String(payload?.statusMessage || normalizedFallback).trim();
  return suppressPattern.test(statusMessage) ? "" : statusMessage;
}
