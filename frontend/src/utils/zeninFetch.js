/**
 * Centralized fetch utility for Zenin.
 * Automatically injects the 'X-Zenin-Secret' header from LocalStorage 
 * and handles base URL resolution.
 */

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

export async function zeninFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${BACKEND_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  
  const secret = localStorage.getItem("zenin_app_secret");
  
  const headers = {
    ...options.headers,
  };

  if (secret) {
    headers["X-Zenin-Secret"] = secret;
  }

  // Ensure JSON requests have correct content-type
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  // Handle unauthorized globally
  if (response.status === 401) {
    // If the backend says unauthorized, it means the secret is wrong or missing.
    // We should probably clear the local storage so the Gatekeeper prompts again.
    localStorage.removeItem("zenin_app_secret");
    
    // We can't easily force a refresh here without side effects, 
    // but the Gatekeeper will catch it on the next poll/interaction.
    // For now, let the component handle the error or trigger a refresh if critical.
  }

  return response;
}
