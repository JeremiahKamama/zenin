/**
 * Centralized fetch utility for Zenin.
 * Automatically injects the 'X-Zenin-Secret' header from LocalStorage
 * and handles base URL resolution.
 */

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";


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
