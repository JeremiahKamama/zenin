/**
 * Brokerage Domain Errors
 * =======================
 *
 * Provider-independent error hierarchy. The application layer catches THESE,
 * never raw provider exceptions. Provider adapters translate their own errors
 * (see providers/snaptrade/errors.js) into these classes.
 *
 * Every error carries:
 *   - a stable `code` (for API responses / client branching)
 *   - `retryable` (guides SyncEngine retry policy)
 *   - an optional `cause` (the original error, kept for logs but never serialized
 *     to clients — see scrubError)
 */

"use strict";

/**
 * Base class for all brokerage errors.
 * @property {string} code           Stable machine code, e.g. "BROKERAGE_AUTH_ERROR".
 * @property {boolean} retryable     Whether the operation may succeed if retried.
 * @property {number} [statusCode]   Suggested HTTP status for API translation.
 * @property {*} [cause]             Original provider error (for internal logs only).
 */
class BrokerageError extends Error {
  constructor(message, { code = "BROKERAGE_ERROR", retryable = false, statusCode = 500, cause = null } = {}) {
    super(message);
    this.name = "BrokerageError";
    this.code = code;
    this.retryable = Boolean(retryable);
    this.statusCode = Number(statusCode) || 500;
    if (cause !== null && cause !== undefined) this.cause = cause;
  }

  /** Safe, provider-scrubbed representation for API responses / logs. */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable
    };
  }
}

/** Authentication / credential failure (expired, invalid, revoked). */
class BrokerageAuthenticationError extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_AUTH_ERROR", retryable: false, statusCode: 401, ...opts });
    this.name = "BrokerageAuthenticationError";
  }
}

/** Provider rate-limited the request (HTTP 429). Retryable with backoff. */
class BrokerageRateLimitError extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_RATE_LIMIT", retryable: true, statusCode: 429, ...opts });
    this.name = "BrokerageRateLimitError";
    if (opts.retryAfter != null) this.retryAfterMs = Number(opts.retryAfter) || undefined;
  }
}

/** Provider is down / returning 5xx / network unreachable. Retryable. */
class BrokerageUnavailableError extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_UNAVAILABLE", retryable: true, statusCode: 503, ...opts });
    this.name = "BrokerageUnavailableError";
  }
}

/** Request exceeded a timeout. Retryable. */
class BrokerageTimeoutError extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_TIMEOUT", retryable: true, statusCode: 504, ...opts });
    this.name = "BrokerageTimeoutError";
  }
}

/** Referenced account does not exist at the provider. */
class BrokerageAccountNotFound extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_ACCOUNT_NOT_FOUND", retryable: false, statusCode: 404, ...opts });
    this.name = "BrokerageAccountNotFound";
  }
}

/** Provider denied permission for the requested scope/operation. */
class BrokeragePermissionDenied extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_PERMISSION_DENIED", retryable: false, statusCode: 403, ...opts });
    this.name = "BrokeragePermissionDenied";
  }
}

/** A synchronization failed (partial data, conflict, unexpected provider state). */
class BrokerageSynchronizationError extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_SYNC_ERROR", retryable: true, statusCode: 502, ...opts });
    this.name = "BrokerageSynchronizationError";
  }
}

/** Requested provider key is not registered in the BrokerageRegistry. */
class BrokerageProviderNotFound extends BrokerageError {
  constructor(message, opts = {}) {
    super(message, { code: "BROKERAGE_PROVIDER_NOT_FOUND", retryable: false, statusCode: 404, ...opts });
    this.name = "BrokerageProviderNotFound";
    if (opts.providerKey != null) this.providerKey = String(opts.providerKey);
  }
}

/**
 * Strips any provider-specific detail from an error before exposing it to the
 * application layer. Guarantees no raw provider payload leaks in API responses.
 *
 * @param {unknown} err
 * @returns {BrokerageError}
 */
function toBrokerageError(err) {
  if (err instanceof BrokerageError) return err;
  // Preserve the original for diagnostics without leaking it.
  return new BrokerageError(
    "An unexpected brokerage error occurred.",
    { code: "BROKERAGE_ERROR", retryable: false, statusCode: 500, cause: err }
  );
}

module.exports = {
  BrokerageError,
  BrokerageAuthenticationError,
  BrokerageRateLimitError,
  BrokerageUnavailableError,
  BrokerageTimeoutError,
  BrokerageAccountNotFound,
  BrokeragePermissionDenied,
  BrokerageSynchronizationError,
  BrokerageProviderNotFound,
  toBrokerageError
};
