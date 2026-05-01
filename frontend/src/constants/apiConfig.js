/**
 * Centralized API configuration to prevent initialization order issues.
 */

const HOSTED_BACKEND_URL = "https://zenin-mx6w.onrender.com/api";
function resolveDefaultBackendUrl() {
  if (typeof window === "undefined") return HOSTED_BACKEND_URL;
  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  const isPrivateIP = hostname.startsWith("192.168.") || hostname.startsWith("10.") || hostname.startsWith("172.16.") || hostname.endsWith(".local");
  const resolvedLocalHost = hostname === "::1" ? "[::1]" : hostname;

  if (isLocalHost || isPrivateIP) return `http://${resolvedLocalHost}:4000/api`;
  return HOSTED_BACKEND_URL;
}

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || resolveDefaultBackendUrl();
export const ZENIN_API_BASE_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
