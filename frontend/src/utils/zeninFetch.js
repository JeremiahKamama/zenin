/**
 * Centralized fetch utility for Zenin.
 * Automatically injects the 'X-Zenin-Secret' header from LocalStorage 
 * and handles base URL resolution.
 */

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

export async function zeninFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${BACKEND_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  let authToken = "";
  try {
    authToken = String(localStorage.getItem("zenin_auth_token") || "").trim();
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
