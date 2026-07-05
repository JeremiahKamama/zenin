/**
 * Sentry — Frontend Observability Layer
 * =====================================
 *
 * Single source of truth for Sentry initialization on the SPA. Imported — and
 * therefore initialized — as the first side-effecting module in main.jsx,
 * BEFORE React renders, so the React error handler and tracing integrations
 * attach correctly.
 *
 * Privacy contract:
 *   - `beforeSend` scrubs credentials, tokens, cookies from every event.
 *   - Session Replay masks all inputs by default and blocks known financial
 *     fields via CSS selectors (`data-sentry-block`). Network bodies are only
 *     captured for the Zenin API origin; Stripe/RevenueCat/SnapTrade are denied.
 *   - When VITE_SENTRY_FRONTEND_DSN is unset, every export is a no-op.
 *
 * @sentry/react v10.
 */

import * as Sentry from "@sentry/react";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SENTRY_DSN = String(import.meta.env.VITE_SENTRY_FRONTEND_DSN || "").trim();
export const IS_CONFIGURED = Boolean(SENTRY_DSN);

// Error messages dropped before enqueue (browser extensions / render loops).
const IGNORE_ERROR_PATTERNS = [
  /Non-Error exception captured/i,
  /ResizeObserver loop limit exceeded/i,
  /ResizeObserver loop completed with undelivered notifications/i,
  // Chunk-load failures are handled separately (with a reload prompt) — we
  // don't want them flooding Sentry as top-level errors.
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Load failed/i // Safari chunk-load variant
];

// Keys stripped from any event payload (case-insensitive substring match).
const SENSITIVE_KEY_PATTERNS = [
  /pass(wor)?d/i,
  /secret/i,
  /\btoken/i,
  /authoriz(ation|ed)/i,
  /\bcookie/i,
  /credential/i,
  /\bapiKey|\bapi[-_]?key/i,
  /\bjwt\b/i,
  /\bprivate[-_]?key\b/i,
  /\bbearer\b/i,
  /refresh[-_]?token/i,
  /access[-_]?token/i,
  /client[-_]?secret/i,
  /consumer[-_]?key/i,
  /snaptrade[-_]?secret/i,
  /whsec_/i,
  /account[-_]?number/i,
  /\bcard[-_]?number/i,
  /\bcvv\b/i,
  /\bsort[-_]?code/i
];

// [regex, replacement] pairs for redacting secret-like substrings in strings.
const SENSITIVE_VALUE_PATTERNS = [
  [/(https?:\/\/)[^\s:@/"']+:[^\s@"'/]+@/gi, "$1[Filtered]@"],
  [/\bBearer\s+[A-Za-z0-9\-._~+\/=]+/g, "Bearer [Filtered]"],
  [/\bwhsec_[A-Za-z0-9]+/g, "[Filtered]"],
  [/\b(re_[A-Za-z0-9_]{20,}|SG\.[A-Za-z0-9_\-]{20,})/g, "[Filtered]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[Filtered]"]
];

const REDACTED = "[Filtered]";

function sanitizePrimitive(value) {
  if (typeof value !== "string") return value;
  let result = value;
  for (const [re, replacement] of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}

function sanitizeValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return sanitizePrimitive(value);
  if (seen.has(value)) return "[Circular]";
  seen.set(value, true);
  if (Array.isArray(value)) {
    return value.slice(0, 200).map((item) => sanitizeValue(item, seen));
  }
  const sanitized = {};
  let count = 0;
  for (const key of Object.keys(value)) {
    if (count++ > 200) break;
    if (SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))) {
      sanitized[key] = REDACTED;
      continue;
    }
    sanitized[key] = sanitizeValue(value[key], seen);
  }
  return sanitized;
}

/**
 * `beforeSend` — drop noise and scrub secrets from every outbound event.
 */
function beforeSend(event) {
  try {
    const errorMessage = event?.exception?.values?.[0]?.value;
    if (errorMessage && IGNORE_ERROR_PATTERNS.some((re) => re.test(String(errorMessage)))) {
      return null;
    }
    if (event.request) event.request = sanitizeValue(event.request);
    if (event.extra) event.extra = sanitizeValue(event.extra);
    if (event.contexts) event.contexts = sanitizeValue(event.contexts);
    if (Array.isArray(event.breadcrumbs)) {
      event.breadcrumbs = event.breadcrumbs.slice(-50).map((crumb) => sanitizeValue(crumb));
    }
    return event;
  } catch {
    return null; // never leak a raw event
  }
}

function clampRate(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

/**
 * Resolves the Sentry release from the injected build-time value (set by
 * @sentry/vite-plugin when configured) or falls back to undefined.
 */
function resolveRelease() {
  return String(import.meta.env.VITE_SENTRY_RELEASE || "").trim() || undefined;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false;

function initSentry() {
  if (initialized || !IS_CONFIGURED) return;
  initialized = true;

  const environment =
    String(import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || "production").trim() ||
    "production";

  const tracesSampleRate = clampRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.1);
  const replaysSessionSampleRate = clampRate(
    import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
    0.1
  );
  const replaysOnErrorSampleRate = clampRate(
    import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
    1.0
  );

  Sentry.init({
    dsn: SENTRY_DSN,
    environment,
    release: resolveRelease(),
    tracesSampleRate,
    sendDefaultPii: false, // never auto-attach IP
    attachStacktrace: true,
    integrations: [
      Sentry.browserTracingIntegration({
        // Capture route transitions for Zenin's history-based entry routing.
        enableInp: true
      }),
      Sentry.replayIntegration({
        // Mask all form inputs by default; specific fields are un/masked via
        // data-sentry-mask / data-sentry-block attributes in the UI.
        maskAllInputs: true,
        maskAllText: false,
        blockAllMedia: false,
        // Network capture: allow the Zenin API so fetch bodies aid debugging,
        // but deny Stripe / RevenueCat / SnapTrade to avoid leaking payloads.
        networkDetailAllowUrls: [window.location.origin],
        networkDetailDenyUrls: [
          /api\.stripe\.com/i,
          /r\.stripe\.com/i,
          /m\.stripe\.network/i,
          /api\.revenuecat\.com/i,
          /e\.revenue\.cat/i,
          /snaptrade\.com/i
        ]
      })
    ],
    replaysSessionSampleRate,
    replaysOnErrorSampleRate,
    beforeSend,
    ignoreErrors: IGNORE_ERROR_PATTERNS.map((re) => re.source)
  });

  Sentry.setTags({ component: "frontend", runtime: "browser" });
}

// Initialize immediately on module import (main.jsx imports this first).
initSentry();

// ---------------------------------------------------------------------------
// Safe wrappers (no-ops when unconfigured)
// ---------------------------------------------------------------------------

export function captureException(error, context) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.captureException(error, context);
  } catch {}
}

export function captureMessage(message, level, context) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.captureMessage(String(message || ""), level || "info", context);
  } catch {}
}

export function addBreadcrumb(breadcrumb) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.addBreadcrumb(breadcrumb);
  } catch {}
}

export function setUser(user) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.setUser(user); // pass null to clear
  } catch {}
}

export function setTag(key, value) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.setTag(String(key), value);
  } catch {}
}

/**
 * Detects a chunk/dynamic-import load failure. These usually mean a new deploy
 * invalidated the cached chunk; a reload fetches the fresh bundle.
 */
export function isChunkLoadError(error) {
  const message = String(error?.message || error || "");
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /Load failed/i.test(message) // Safari
  );
}

/**
 * Reports a chunk-load failure with a tag that can drive a reload prompt in the
 * UI rather than surfacing as a generic crash.
 */
export function reportChunkLoadFailure(error, entry) {
  if (!IS_CONFIGURED) return;
  try {
    Sentry.captureException(error, {
      tags: { kind: "chunk_load", entry: String(entry || "unknown") }
    });
  } catch {}
}

export { sanitizeValue, sanitizePrimitive };
export default Sentry;
