/**
 * Centralized fetch utility for Zenin.
 * Uses cookie-based auth and handles base URL resolution.
 */

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";


export async function zeninFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${ZENIN_API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = {
    ...options.headers,
  };

  // Ensure JSON requests have correct content-type
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    credentials: options.credentials || "include",
    headers
  });

  return response;
}
