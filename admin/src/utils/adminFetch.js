/**
 * Centralized fetch utility for Zenin Admin.
 * Handles base URL resolution and standard headers.
 */

function resolveAdminApiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4000/api/admin';
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:4000/api/admin';
  }
  // Production mapping: admin.zenin.capital -> backend-api/api/admin
  return 'https://zenin-mx6w.onrender.com/api/admin'; 
}

const ADMIN_API_BASE_URL = resolveAdminApiUrl();
const AUTH_API_BASE_URL = ADMIN_API_BASE_URL.replace(/\/admin$/, "");
let adminCsrfTokenCache = null;

/**
 * The admin backend is a single Render instance that spins down when idle and
 * has intermittently returned 502s. Without a timeout, a hung request leaves
 * the operator staring at a disabled button forever; without status mapping,
 * a 502 surfaces as the browser's opaque "Failed to fetch", which reads like a
 * client bug rather than an outage.
 */
const ADMIN_REQUEST_TIMEOUT_MS = 90000;
// Code entry needs the most headroom: the operator reads the email first, and
// the backend may be cold-starting when they submit.
const ADMIN_MUTATION_TIMEOUT_MS = 90000;

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  return String(document.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

async function ensureAdminCsrfToken() {
  if (typeof window === "undefined") return "";
  const fromCookie = readCookie("zenin_csrf");
  if (fromCookie) {
    adminCsrfTokenCache = fromCookie;
    return fromCookie;
  }
  if (adminCsrfTokenCache) return adminCsrfTokenCache;
  // Bounded and failure-tolerant: this runs before every mutation, so a hanging
  // or 502-ing backend here would otherwise block the request before adminFetch
  // can map the error. Returning "" lets the request proceed unauthenticated by
  // CSRF and fail with a proper server message instead.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("csrf-timeout", "AbortError"));
  }, ADMIN_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/auth/csrf`, {
      credentials: "include",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    adminCsrfTokenCache = payload?.csrfToken || readCookie("zenin_csrf") || "";
    return adminCsrfTokenCache;
  } catch (error) {
    console.warn("Admin CSRF token fetch failed:", error?.message || error);
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function describeNetworkFailure(error) {
  // A fetch rejection (TypeError: Failed to fetch) means the request never got
  // a usable response: DNS, connection reset, or a proxy error page with no
  // CORS headers. Render's 502 is exactly this case.
  if (error?.name === "AbortError") {
    return {
      message: "The admin service is taking too long to respond. It may be starting up — please try again.",
      code: "ADMIN_REQUEST_TIMEOUT"
    };
  }
  return {
    message: "Could not reach the admin service. It may be temporarily unavailable — please try again in a moment.",
    code: "ADMIN_NETWORK_ERROR"
  };
}

async function requestAgainstBase(baseUrl, endpoint, options = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
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

  // Bound every request so a hanging backend cannot freeze the UI.
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Number(options.timeoutMs)
    : (['GET', 'HEAD', 'OPTIONS'].includes(method) ? ADMIN_REQUEST_TIMEOUT_MS : ADMIN_MUTATION_TIMEOUT_MS);

  const { timeoutMs: _ignoredTimeout, ...fetchOptions } = options;

  // Read-only requests are safe to retry once: a Render instance waking from a
  // spin-down commonly fails the first request and succeeds seconds later.
  // Writes are NEVER retried — re-sending an admin sign-in code or a
  // destructive action could double-apply.
  const isReadOnly = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  const maxAttempts = isReadOnly ? 2 : 1;
  const retryDelayMs = 1500;

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let didTimeout = false;
    const timer = timeoutMs > 0 ? setTimeout(() => {
      didTimeout = true;
      // A DOMException (not a bare string) so error.name is reliably "AbortError".
      controller.abort(new DOMException("admin-request-timeout", "AbortError"));
    }, timeoutMs) : null;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        credentials: options.credentials || 'include',
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // A gateway error carries no JSON body, so give the operator something
        // actionable instead of "API Error: 502".
        const isGatewayError = [502, 503, 504].includes(response.status);
        const error = new Error(
          errorData.message ||
          errorData.error ||
          (isGatewayError
            ? "The admin service is currently unavailable. It may be starting up — please try again in a moment."
            : `API Error: ${response.status}`)
        );
        error.status = response.status;
        error.code = errorData.code || `HTTP_${response.status}`;
        error.details = errorData.details || null;
        // Retry only transient gateway errors, and only for safe methods.
        if (isGatewayError && attempt < maxAttempts) {
          lastError = error;
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        throw error;
      }

      return await response.json();
    } catch (error) {
      // A gateway error already handled above must not be re-wrapped.
      if (error?.status) throw error;

      // A timeout rejection arrives here as an AbortError; map it before the
      // generic network branch so the two stay distinguishable.
      if (didTimeout || error?.name === "AbortError") {
        const described = describeNetworkFailure({ name: "AbortError" });
        const timeoutError = new Error(described.message);
        timeoutError.code = described.code;
        // A cold start often manifests as a timeout on the first attempt.
        if (attempt < maxAttempts) {
          lastError = timeoutError;
          await new Promise((r) => setTimeout(r, retryDelayMs));
          continue;
        }
        console.error(`Admin API Timeout (${endpoint}):`, error);
        throw timeoutError;
      }

      const described = describeNetworkFailure(error);
      const networkError = new Error(described.message);
      networkError.code = described.code;
      if (attempt < maxAttempts) {
        lastError = networkError;
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      console.error(`Admin API Error (${endpoint}):`, error);
      throw networkError;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Unreachable in practice: the loop either returns or throws.
  throw lastError || new Error("Admin request failed");
}

export async function adminFetch(endpoint, options = {}) {
  return requestAgainstBase(ADMIN_API_BASE_URL, endpoint, options);
}

/**
 * Call the shared account/auth API (`/api/auth/*`) from the admin console.
 *
 * Admin MFA enrollment (`/api/auth/2fa/*`, `/api/auth/passkeys/*`) lives on the
 * account API rather than `/api/admin/*`, because the admin gate is satisfied by
 * an ordinary account-level second factor. Reusing `requestAgainstBase` keeps the
 * same CSRF handling, timeouts, and retry rules as every other admin call instead
 * of duplicating them.
 */
export async function authApiFetch(endpoint, options = {}) {
  return requestAgainstBase(AUTH_API_BASE_URL, endpoint, options);
}
