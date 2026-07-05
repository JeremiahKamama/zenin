/**
 * Sentry — Backend Observability Layer
 * ====================================
 *
 * Single source of truth for Sentry initialization and safe wrappers on the
 * backend. MUST be required (and `initSentry()` called) before the Express app
 * is constructed so the request/handler integrations can instrument it.
 *
 * Privacy contract:
 *   - `beforeSend` scrubs credentials, tokens, cookies, connection strings and
 *     other secrets from every event (request bodies, breadcrumbs, contexts).
 *   - Health-check and known-noise events are dropped entirely.
 *   - When `SENTRY_BACKEND_DSN` is unset, every export is a safe no-op so local
 *     development and tests are unaffected.
 *
 * @sentry/node v10 + @sentry/profiling-node v10.
 */

"use strict";

const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SENTRY_DSN = String(process.env.SENTRY_BACKEND_DSN || "").trim();
const IS_CONFIGURED = Boolean(SENTRY_DSN);

// Paths that produce no value as Sentry events (health probes, prefetch).
const NOISE_PATH_PATTERNS = [
  /^\/health\/?$/i,
  /^\/healthz\/?$/i,
  /^\/ping\/?$/i,
  /^\/favicon\.ico$/i,
  /^\/robots\.txt$/i
];

// Error messages that originate from browser extensions / ad blockers / render
// loops rather than from Zenin code. Dropped before enqueue.
const IGNORE_ERROR_PATTERNS = [
  /Non-Error exception captured/i,
  /ResizeObserver loop limit exceeded/i,
  /ResizeObserver loop completed with undelivered notifications/i,
  /blocked by the user/i, // ad-blocker aborted fetch
  /Network Error/i, // flaky client-side only; backend sees nothing
  /ABORT_ERR/i
];

// Keys whose values are stripped from any event payload (case-insensitive
// substring match). Recurses into nested objects and arrays.
const SENSITIVE_KEY_PATTERNS = [
  /pass(wor)?d/i,
  /secret/i,
  /\btoken/i,
  /authoriz(ation|ed)/i,
  /\bcookie/i,
  /credential/i,
  /\bapiKey|\bapi[-_]?key/i,
  /\bjwt\b/i,
  /\bsession\b/i,
  /\bprivate[-_]?key\b/i,
  /\bbearer\b/i,
  /refresh[-_]?token/i,
  /access[-_]?token/i,
  /client[-_]?secret/i,
  /consumer[-_]?key/i,
  /snaptrade[-_]?secret/i,
  /whsec_/i
];

// Patterns redacted from string values anywhere in the payload (connection
// strings, bearer tokens, SnapTrade webhook signatures, Stripe whsec_ secrets).
// Each entry is [regex, replacement]; using pairs avoids leaking $1 from
// patterns that have no capture group.
const SENSITIVE_VALUE_PATTERNS = [
  // HTTP basic auth in URLs (postgres://, https://, etc.): keep scheme, redact creds.
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s:@/"']+:[^\s@"'/]+@/gi, "$1[Filtered]@"],
  // Bearer tokens (Authorization header value)
  [/\bBearer\s+[A-Za-z0-9\-._~+\/=]+/g, "Bearer [Filtered]"],
  // Stripe webhook signing secrets
  [/\bwhsec_[A-Za-z0-9]+/g, "[Filtered]"],
  // Resend / SendGrid-style API keys
  [/\b(re_[A-Za-z0-9_]{20,}|SG\.[A-Za-z0-9_\-]{20,})/g, "[Filtered]"],
  // JWTs (three base64url segments)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[Filtered]"]
];

const REDACTED = "[Filtered]";

/**
 * Deep-clones and sanitizes an arbitrary value, stripping sensitive keys and
 * redacting secret-like substrings in strings. Cycles are tolerated via a
 * seen-WeakMap guard.
 */
function sanitizeValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") {
    return sanitizePrimitive(value);
  }
  if (seen.has(value)) return "[Circular]";
  seen.set(value, true);

  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, seen));
  }

  const sanitized = {};
  let count = 0;
  for (const key of Object.keys(value)) {
    if (count++ > 200) break; // bound payload size
    if (SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))) {
      sanitized[key] = REDACTED;
      continue;
    }
    sanitized[key] = sanitizeValue(value[key], seen);
  }
  return sanitized;
}

function sanitizePrimitive(value) {
  if (typeof value !== "string") return value;
  let result = value;
  for (const [re, replacement] of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}

/**
 * `beforeSend` hook applied to every event before it is sent to Sentry.
 * Returns null to drop the event, or a sanitized copy.
 */
function beforeSend(event) {
  try {
    // Drop noise routes.
    const requestUrl = event?.request?.url;
    if (requestUrl) {
      const path = String(requestUrl).replace(/\?.*$/, "").replace(/^https?:\/\/[^/]+/, "");
      if (NOISE_PATH_PATTERNS.some((re) => re.test(path))) {
        return null;
      }
    }

    // Drop ignored error types.
    const errorMessage = event?.exception?.values?.[0]?.value;
    if (errorMessage && IGNORE_ERROR_PATTERNS.some((re) => re.test(String(errorMessage)))) {
      return null;
    }

    // Sanitize every field that could carry user-supplied or secret data.
    if (event.request) {
      event.request = sanitizeValue(event.request);
      // Never send full request bodies — query/headers are enough after redaction.
      delete event.request.data;
    }
    if (event.extra) event.extra = sanitizeValue(event.extra);
    if (event.contexts) event.contexts = sanitizeValue(event.contexts);
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.slice(-50).map((crumb) => {
        const cleaned = sanitizeValue(crumb);
        // Breadcrumb request bodies are especially leaky; drop the body.
        if (cleaned?.data) delete cleaned.data.__obody;
        return cleaned;
      });
    }
    return event;
  } catch (err) {
    // If sanitization itself fails, never leak the raw event. Drop it.
    return null;
  }
}

/**
 * Derives a release identifier from SENTRY_RELEASE or the current git SHA.
 * Returns undefined if neither is available (e.g. non-git deployment).
 */
function resolveRelease() {
  const explicit = String(process.env.SENTRY_RELEASE || "").trim();
  if (explicit) return explicit;
  try {
    return String(execSync("git rev-parse --short HEAD", { encoding: "utf8" })).trim() || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false;

function initSentry() {
  if (initialized || !IS_CONFIGURED) return;
  initialized = true;

  const environment =
    String(process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production").trim() ||
    "production";
  const release = resolveRelease();
  const tracesSampleRate = clampRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1);
  const profilesSampleRate = clampRate(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0.1);

  Sentry.init({
    dsn: SENTRY_DSN,
    environment,
    release,
    tracesSampleRate,
    profilesSampleRate,
    sendDefaultPii: false, // never auto-attach IP/cookies
    attachStacktrace: true,
    maxBreadcrumbs: 50,
    integrations: [
      // Pulls in the profiling integration without enabling auto-instrumentation
      // beyond what tracing already captures.
      nodeProfilingIntegration()
    ],
    beforeSend,
    ignoreErrors: IGNORE_ERROR_PATTERNS.map((re) => re.source)
  });

  // Static tags attached to every subsequent event.
  Sentry.setTags({
    component: "backend",
    runtime: "node"
  });
}

function clampRate(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

// ---------------------------------------------------------------------------
// Express error handler
// ---------------------------------------------------------------------------

/**
 * Returns the Sentry Express error-handling middleware, or a passthrough that
 * delegates to Express's default terminator when Sentry is not configured.
 * Register AFTER all routes and BEFORE the app's own terminal handler so
 * Sentry gets first crack at enriching/capturing the error.
 */
function getSentryRequestHandler() {
  if (IS_CONFIGURED) {
    return Sentry.setupExpressErrorHandler(expressAppRef.app);
  }
  return (err, _req, _res, next) => next(err);
}

// We can't import `app` from index.js (circular). Instead index.js registers
// the handler via `registerExpressErrorHandler(app)` after the app exists.
let expressAppRef = { app: null };
function registerExpressErrorHandler(app) {
  if (!IS_CONFIGURED) return null;
  return Sentry.setupExpressErrorHandler(app);
}

// ---------------------------------------------------------------------------
// Safe wrappers (no-ops when unconfigured)
// ---------------------------------------------------------------------------

function captureException(error, context) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.captureException(error, context);
  } catch {
    // never let telemetry take down a request
  }
}

function captureMessage(message, level, context) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.captureMessage(String(message || ""), level || "info", context);
  } catch {}
}

function addBreadcrumb(breadcrumb) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.addBreadcrumb(breadcrumb);
  } catch {}
}

function setUser(user) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.setUser(user); // pass null to clear
  } catch {}
}

function setTag(key, value) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.setTag(String(key), value);
  } catch {}
}

function setContext(name, context) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.setContext(String(name), context);
  } catch {}
}

/**
 * Wraps an async function in a Sentry span. Falls back to a plain call when
 * unconfigured, so callers always await the same shape.
 */
async function withSpan(options, fn) {
  if (!IS_CONFIGURED || typeof Sentry.startSpan !== "function") {
    return fn();
  }
  return Sentry.startSpan(options, () => fn());
}

/**
 * Flushes the Sentry event queue. Await this before exiting the process so
 * in-flight events are delivered.
 */
async function close(timeoutMs = 2000) {
  if (!IS_CONFIGURED) return;
  try {
    await Sentry.close(timeoutMs);
  } catch {}
}

/**
 * Bridges application log levels into Sentry. Only `error` and `fatal` levels
 * create events; `warning`/`info` become breadcrumbs; `debug` is ignored to
 * avoid burning quota.
 */
function logToSentry(level, message, context) {
  const normalized = String(level || "info").toLowerCase();
  const ctx = context && typeof context === "object" ? context : undefined;
  if (normalized === "error" || normalized === "fatal") {
    const error = ctx?.error instanceof Error ? ctx.error : new Error(String(message));
    captureException(error, { level: normalized === "fatal" ? "fatal" : "error", extra: ctx });
    return;
  }
  if (normalized === "warning" || normalized === "info") {
    addBreadcrumb({
      category: ctx?.category || "log",
      message: String(message || ""),
      level: normalized === "warning" ? "warning" : "info",
      data: ctx ? sanitizeValue(ctx) : undefined
    });
  }
}

module.exports = {
  IS_CONFIGURED,
  sanitizeValue,
  sanitizePrimitive,
  initSentry,
  registerExpressErrorHandler,
  captureException,
  captureMessage,
  addBreadcrumb,
  setUser,
  setTag,
  setContext,
  withSpan,
  close,
  logToSentry
};
