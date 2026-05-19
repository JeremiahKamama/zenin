/**
 * Centralized fetch utility for Zenin.
 * Uses cookie-based auth and handles base URL resolution.
 */

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

const SIMULATED_PLAN_VALUES = new Set(["starter", "pro", "desk"]);
let csrfTokenCache = null;

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  return String(document.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

function getSimulationPlanHeaderValue(endpoint) {
  if (typeof window === "undefined") return null;

  const normalizedEndpoint = String(endpoint || "");
  const pathname = String(window.location.pathname || "").toLowerCase();

  // Keep simulation scoped to the signed-in app so public/auth requests don't
  // trigger unnecessary CORS preflights in production.
  if (!pathname.startsWith("/app")) return null;
  if (normalizedEndpoint === "/auth" || normalizedEndpoint.startsWith("/auth/")) return null;

  try {
    const authUser = window.localStorage.getItem("zenin_auth_user");
    const simulatePlan = String(window.localStorage.getItem("zenin_simulate_plan") || "")
      .trim()
      .toLowerCase();

    if (!authUser || !SIMULATED_PLAN_VALUES.has(simulatePlan)) {
      return null;
    }

    return simulatePlan;
  } catch {
    return null;
  }
}

function buildZeninUrl(endpoint) {
  return endpoint.startsWith("http")
    ? endpoint
    : `${ZENIN_API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
}

async function ensureCsrfToken() {
  if (typeof window === "undefined") return "";
  const fromCookie = readCookie("zenin_csrf");
  if (fromCookie) {
    csrfTokenCache = fromCookie;
    return fromCookie;
  }
  if (csrfTokenCache) return csrfTokenCache;
  const response = await fetch(buildZeninUrl("/auth/csrf"), {
    credentials: "include"
  });
  const payload = await response.json().catch(() => ({}));
  csrfTokenCache = payload?.csrfToken || readCookie("zenin_csrf") || "";
  return csrfTokenCache;
}

function getDefaultErrorMessage(status) {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "The requested resource could not be found.";
  if (status === 408) return "The request timed out. Please try again.";
  if (status === 429) return "Too many requests. Please wait a moment and retry.";
  if (status >= 500) return "The server could not complete this request. Please try again.";
  return `Request failed (${status || 0}).`;
}

async function parseResponseBody(response) {
  if (!response || response.status === 204 || response.status === 205) {
    return {};
  }

  const contentType = String(response.headers?.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    return response.json().catch(() => ({}));
  }

  const text = await response.text().catch(() => "");
  return text ? { message: text, raw: text } : {};
}

function normalizeErrorPayload(payload, status) {
  const message = String(
    payload?.message ||
      payload?.error ||
      payload?.raw ||
      getDefaultErrorMessage(status)
  ).trim() || getDefaultErrorMessage(status);

  return {
    error: String(payload?.error || "Request failed").trim() || "Request failed",
    message,
    code: String(payload?.code || (status ? `HTTP_${status}` : "REQUEST_FAILED")).trim() || "REQUEST_FAILED",
    details: payload?.details ?? null,
    retryable: typeof payload?.retryable === "boolean" ? payload.retryable : (status === 408 || status === 429 || status >= 500),
  };
}

export class ZeninRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ZeninRequestError";
    this.status = Number(options.status || 0);
    this.code = options.code || "REQUEST_FAILED";
    this.error = options.error || "Request failed";
    this.details = options.details ?? null;
    this.retryable = Boolean(options.retryable);
    this.data = options.data ?? null;
    this.endpoint = options.endpoint || "";
    this.cause = options.cause;
  }
}

export async function zeninFetch(endpoint, options = {}) {
  const url = buildZeninUrl(endpoint);
  const method = String(options.method || "GET").toUpperCase();

  const headers = {
    ...options.headers,
  };

  // Ensure JSON requests have correct content-type
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const simulatePlan = getSimulationPlanHeaderValue(endpoint);
  if (simulatePlan) {
    headers["x-zenin-simulate-plan"] = simulatePlan;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
  }

  const response = await fetch(url, {
    ...options,
    credentials: options.credentials || "include",
    headers
  });

  return response;
}

export async function zeninFetchJson(endpoint, options = {}) {
  try {
    const response = await zeninFetch(endpoint, options);
    const data = await parseResponseBody(response);

    if (!response.ok) {
      const normalized = normalizeErrorPayload(data, response.status);
      throw new ZeninRequestError(normalized.message, {
        ...normalized,
        status: response.status,
        data,
        endpoint: buildZeninUrl(endpoint),
      });
    }

    return data;
  } catch (error) {
    if (error instanceof ZeninRequestError) {
      throw error;
    }

    if (error?.name === "AbortError") {
      throw new ZeninRequestError("Request was cancelled before it completed.", {
        status: 0,
        code: "REQUEST_ABORTED",
        error: "Request aborted",
        retryable: false,
        details: null,
        endpoint: buildZeninUrl(endpoint),
        cause: error,
      });
    }

    throw new ZeninRequestError("Unable to reach the service right now. Please try again.", {
      status: 0,
      code: "NETWORK_ERROR",
      error: "Network error",
      retryable: true,
      details: null,
      endpoint: buildZeninUrl(endpoint),
      cause: error,
    });
  }
}
