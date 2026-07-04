/**
 * Shared cookie utilities for Zenin.
 *
 * Identical to frontend/src/utils/cookieUtils.js — kept as a local copy
 * because admin has its own independent build.
 */

export function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  return String(document.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}
