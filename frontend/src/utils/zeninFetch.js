/**
 * Centralized fetch utility for Zenin.
 * Automatically injects the 'X-Zenin-Secret' header from LocalStorage 
 * and handles base URL resolution.
 */

const HOSTED_BACKEND_URL = "https://zenin-mx6w.onrender.com/api";
const LOCAL_BACKEND_URL = "http://127.0.0.1:4000/api";

function resolveDefaultBackendUrl() {
  if (typeof window === "undefined") return HOSTED_BACKEND_URL;
  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return isLocalHost ? LOCAL_BACKEND_URL : HOSTED_BACKEND_URL;
}

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || resolveDefaultBackendUrl();
export const ZENIN_API_BASE_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

export async function zeninFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${ZENIN_API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  let authToken = "";
  try {
    authToken = String(sessionStorage.getItem("zenin_auth_token") || localStorage.getItem("zenin_auth_token") || "").trim();
  } catch {
    authToken = "";
  }

  const headers = {
    ...options.headers,
  };

  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  // Ensure JSON requests have correct content-type
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  return response;
}
