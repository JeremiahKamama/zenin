/**
 * Centralized fetch utility for Zenin.
 * Uses cookie-based auth and handles base URL resolution.
 */

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

// Accept new tier ids (plus/premium) and legacy ids (pro/desk) for the dev
// "simulate plan" override during the rename rollout.
const SIMULATED_PLAN_VALUES = new Set(["starter", "plus", "premium", "pro", "desk"]);
const CSRF_FETCH_TIMEOUT_MS = 12000;
const CSRF_FETCH_ATTEMPTS = 1;
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
  if (endpoint.startsWith("http")) return endpoint;

  // Normalize to avoid duplicate `/api` segments in resulting URLs.
  // Examples to handle:
  // - ZENIN_API_BASE_URL = "/api" and endpoint = "/api/auth" -> "/api/auth"
  // - ZENIN_API_BASE_URL = "http://host/api" and endpoint = "/api/auth" -> "http://host/api/auth"
  // - ZENIN_API_BASE_URL = "http://host/api" and endpoint = "/auth" -> "http://host/api/auth"
  let normalizedEndpoint = String(endpoint || "");

  // If base ends with '/api', strip a leading '/api' from endpoint to avoid duplication.
  if (ZENIN_API_BASE_URL.endsWith("/api")) {
    normalizedEndpoint = normalizedEndpoint.replace(/^\/+api/, "");
  }

  // Ensure the final concatenation has exactly one slash between base and endpoint.
  return `${ZENIN_API_BASE_URL}${normalizedEndpoint.startsWith("/") ? "" : "/"}${normalizedEndpoint}`;
}

async function ensureCsrfToken() {
  if (typeof window === "undefined") return "";
  const fromCookie = readCookie("zenin_csrf");
  if (fromCookie) {
    csrfTokenCache = fromCookie;
    return fromCookie;
  }
  if (csrfTokenCache) return csrfTokenCache;

  let response;
  let lastError = null;
  for (let attempt = 1; attempt <= CSRF_FETCH_ATTEMPTS; attempt += 1) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort("csrf-timeout"), CSRF_FETCH_TIMEOUT_MS) : null;
    try {
      response = await fetch(buildZeninUrl("/auth/csrf"), {
        credentials: "include",
        signal: controller?.signal
      });
      break;
    } catch (error) {
      lastError = error;
      if (error?.name !== "AbortError" || attempt === CSRF_FETCH_ATTEMPTS) {
        if (error?.name === "AbortError") {
          throw new ZeninRequestError("Zenin's auth service is taking too long to respond. Please wait a moment and try again.", {
            status: 0,
            code: "AUTH_SERVICE_TIMEOUT",
            error: "Auth service timeout",
            retryable: true,
            endpoint: buildZeninUrl("/auth/csrf"),
            cause: error,
          });
        }
        throw error;
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  if (!response && lastError) {
    throw lastError;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const normalized = normalizeErrorPayload(payload, response.status);
    throw new ZeninRequestError(
      response.status >= 500
        ? "Zenin's auth service is temporarily unavailable. Please wait a moment and try again."
        : normalized.message,
      {
        ...normalized,
        status: response.status,
        data: payload,
        endpoint: buildZeninUrl("/auth/csrf"),
      }
    );
  }
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

// ---------------------------------------------------------------------------
// Resilient fetch layer: exponential backoff + retry limit + circuit breaker.
// Only idempotent reads (GET/HEAD/OPTIONS) are auto-retried; writes never are,
// to avoid duplicate side effects. This prevents the "429 storm" / infinite
// loading where many modules each hammer a rate-limited backend.
// ---------------------------------------------------------------------------
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;            // up to 4 attempts total
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 20000;

const circuit = { failures: 0, openedAt: 0 };
function circuitAllow() {
  if (circuit.failures < CIRCUIT_FAILURE_THRESHOLD) return true;
  if (Date.now() >= circuit.openedAt) {
    circuit.failures = 0;
    circuit.openedAt = 0;
    return true;
  }
  return false;
}
function circuitRecordFailure() {
  circuit.failures += 1;
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.openedAt = Date.now() + CIRCUIT_OPEN_MS;
  }
}
function circuitRecordSuccess() {
  circuit.failures = 0;
  circuit.openedAt = 0;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener?.("abort", onAbort);
  });
}

export async function zeninFetch(endpoint, options = {}) {
  const { skipSimulationHeaders = false, timeoutMs = 0, ...fetchOptions } = options;
  const url = buildZeninUrl(endpoint);
  const method = String(fetchOptions.method || "GET").toUpperCase();

  const headers = {
    ...fetchOptions.headers,
  };

  // Ensure JSON requests have correct content-type
  if (fetchOptions.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const simulatePlan = skipSimulationHeaders ? null : getSimulationPlanHeaderValue(endpoint);
  if (simulatePlan) {
    headers["x-zenin-simulate-plan"] = simulatePlan;
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = await ensureCsrfToken();
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
  }

  // Only idempotent reads are safe to retry. Writes (POST/PUT/DELETE) are
  // never auto-retried to avoid duplicate side effects.
  const isRead = ["GET", "HEAD", "OPTIONS"].includes(method);
  const maxAttempts = isRead ? MAX_RETRIES + 1 : 1;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Circuit breaker: after repeated failures, fail fast instead of hammering
    // a rate-limited backend (prevents the 429 storm / infinite loading).
    if (isRead && !circuitAllow()) {
      throw new ZeninRequestError(
        "Zenin is rate-limiting requests right now. Showing cached data.",
        { status: 429, code: "CIRCUIT_OPEN", retryable: false, endpoint: url }
      );
    }

    let timeoutId = null;
    let didTimeout = false;
    let signal = fetchOptions.signal;
    if (!signal && Number(timeoutMs) > 0 && typeof AbortController !== "undefined") {
      const controller = new AbortController();
      signal = controller.signal;
      timeoutId = setTimeout(() => {
        didTimeout = true;
        controller.abort("request-timeout");
      }, Number(timeoutMs));
    }

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        credentials: fetchOptions.credentials || "include",
        headers,
        signal,
      });

      if (timeoutId) clearTimeout(timeoutId);
      if (response.ok) {
        circuitRecordSuccess();
        return response;
      }

      const status = response.status;
      // Retryable status (429/5xx) -> back off and retry (GET only).
      if (isRead && RETRYABLE_STATUS.has(status) && attempt < maxAttempts) {
        circuitRecordFailure();
        const backoff = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
        await sleep(backoff, fetchOptions.signal);
        continue;
      }
      circuitRecordFailure();
      return response; // non-retryable or exhausted -> caller handles
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        // Timeout or external abort: do not retry silently.
        if (didTimeout) {
          throw new ZeninRequestError(
            "Zenin's backend is taking too long to respond. Please wait a moment and try again.",
            { status: 0, code: "REQUEST_TIMEOUT", error: "Request timeout", retryable: true, endpoint: url, cause: error }
          );
        }
        throw error;
      }
      lastErr = error;
      if (isRead && attempt < maxAttempts) {
        await sleep(BACKOFF_BASE_MS, fetchOptions.signal);
        continue;
      }
      throw error;
    }
  }
  throw lastErr || new Error("Request failed");
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
      throw new ZeninRequestError("Zenin's backend did not respond before the request was cancelled. Please wait a moment and try again.", {
        status: 0,
        code: "REQUEST_ABORTED",
        error: "Request aborted",
        retryable: true,
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
