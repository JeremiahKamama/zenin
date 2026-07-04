/**
 * Centralized fetch utility for Zenin Admin.
 * Handles base URL resolution and standard headers.
 */

import { readCookie } from "./cookieUtils";

function resolveAdminApiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4000/api/admin';
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:4000/api/admin';
  }
  return 'https://zenin-mx6w.onrender.com/api/admin'; 
}

const ADMIN_API_BASE_URL = resolveAdminApiUrl();
const AUTH_API_BASE_URL = ADMIN_API_BASE_URL.replace(/\/admin$/, "");
let adminCsrfTokenCache = null;

async function ensureAdminCsrfToken() {
  if (typeof window === "undefined") return "";
  const fromCookie = readCookie("zenin_csrf");
  if (fromCookie) {
    adminCsrfTokenCache = fromCookie;
    return fromCookie;
  }
  if (adminCsrfTokenCache) return adminCsrfTokenCache;
  const response = await fetch(`${AUTH_API_BASE_URL}/auth/csrf`, {
    credentials: "include"
  });
  const payload = await response.json().catch(() => ({}));
  adminCsrfTokenCache = payload?.csrfToken || readCookie("zenin_csrf") || "";
  return adminCsrfTokenCache;
}

export async function adminFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') 
    ? endpoint 
    : `${ADMIN_API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const method = String(options.method || 'GET').toUpperCase();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfToken = await ensureAdminCsrfToken();
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      credentials: options.credentials || 'include',
      headers
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.message || errorData.error || `API Error: ${response.status}`);
      error.status = response.status;
      error.code = errorData.code || `HTTP_${response.status}`;
      error.details = errorData.details || null;
      throw error;
    }

    return await response.json();
  } catch (error) {
    console.error(`Admin API Error (${endpoint}):`, error);
    throw error;
  }
}
