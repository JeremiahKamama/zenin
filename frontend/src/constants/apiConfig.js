/**
 * Centralized API configuration to prevent initialization order issues.
 */

export const HOSTED_BACKEND_URL = "https://zenin-mx6w.onrender.com/api";
function resolveDefaultBackendUrl() {
  return HOSTED_BACKEND_URL;
}

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || resolveDefaultBackendUrl();
export const ZENIN_API_BASE_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
