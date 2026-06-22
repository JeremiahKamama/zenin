/**
 * Shared cookie utilities for Zenin.
 *
 * Consolidates the identical readCookie helper previously duplicated
 * in zeninFetch.js and admin/utils/adminFetch.js.
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
