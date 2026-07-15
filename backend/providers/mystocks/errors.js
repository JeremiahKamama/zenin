"use strict";

/**
 * MyStocks Africa — structured provider errors.
 *
 * Maps upstream HTTP status codes + MyStocks `{"error":{"code","message"}}`
 * payloads into a uniform error shape the rest of Zenin can branch on. The
 * `code` is a stable string (e.g. "mystocks_401") so callers and the routing
 * layer can decide fallback vs. hard-fail without parsing upstream text.
 */

class MyStocksError extends Error {
  constructor(code, status, message, opts = {}) {
    super(message);
    this.name = "MyStocksError";
    this.code = code;            // stable machine code, e.g. "mystocks_429"
    this.status = status;        // upstream HTTP status, or 0 if local
    this.retryable = opts.retryable !== undefined ? opts.retryable : false;
    this.retryAfterMs = opts.retryAfterMs || null;
    this.upstreamCode = opts.upstreamCode || null; // MyStocks `error.code`
    this.requestId = opts.requestId || null;
    this.isConfigError = opts.isConfigError || false;
  }
}

function isMyStocksError(err) {
  return err instanceof MyStocksError;
}

/**
 * Build a MyStocksError from an Axios-style error (or any error with a
 * `response` carrying status + JSON body). Falls back to a generic error.
 * @param {Error} err
 * @param {{ timeout?: boolean, requestId?: string }} ctx
 */
function fromHttpError(err, ctx = {}) {
  const response = err && err.response;
  const status = (response && response.status) || 0;
  const body = response && response.data;
  const upstreamCode = body && body.error && body.error.code ? body.error.code : null;
  const upstreamMessage =
    (body && body.error && body.error.message) ||
    (err && err.message) ||
    "MyStocks request failed";

  switch (status) {
    case 401:
      return new MyStocksError("mystocks_401", 401, "MyStocks API key invalid or missing.", {
        isConfigError: true,
        upstreamCode,
        requestId: ctx.requestId || (body && body.requestId) || null,
      });
    case 403:
      return new MyStocksError("mystocks_403", 403, "MyStocks key forbidden for this scope.", {
        isConfigError: true,
        upstreamCode,
        requestId: ctx.requestId || (body && body.requestId) || null,
      });
    case 404:
      return new MyStocksError("mystocks_404", 404, "MyStocks resource not found.", {
        retryable: false,
        upstreamCode,
        requestId: ctx.requestId || (body && body.requestId) || null,
      });
    case 429: {
      let retryAfterMs = null;
      const ra = response && response.headers && (response.headers["retry-after"] || response.headers["Retry-After"]);
      if (ra) {
        const secs = Number(ra);
        retryAfterMs = Number.isFinite(secs) ? secs * 1000 : Date.parse(ra) - Date.now();
      }
      return new MyStocksError("mystocks_429", 429, "MyStocks rate limit exceeded.", {
        retryable: true,
        retryAfterMs,
        upstreamCode,
        requestId: ctx.requestId || (body && body.requestId) || null,
      });
    }
    default:
      break;
  }

  if (status >= 500) {
    return new MyStocksError("mystocks_5xx", status, `MyStocks server error (${status}).`, {
      retryable: true,
      upstreamCode,
      requestId: ctx.requestId || (body && body.requestId) || null,
    });
  }

  if (err && err.code === "ECONNABORTED") {
    return new MyStocksError("mystocks_timeout", 0, "MyStocks request timed out.", {
      retryable: true,
      requestId: ctx.requestId || null,
    });
  }
  if (err && (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "ETIMEDOUT")) {
    return new MyStocksError("mystocks_network", 0, `MyStocks network error (${err.code}).`, {
      retryable: true,
      requestId: ctx.requestId || null,
    });
  }

  return new MyStocksError(
    "mystocks_unknown",
    status,
    upstreamMessage,
    { retryable: false, upstreamCode, requestId: ctx.requestId || null }
  );
}

/** Config/setup error thrown before any request (e.g. provider disabled). */
function configError(message) {
  return new MyStocksError("mystocks_unconfigured", 0, message, { isConfigError: true });
}

module.exports = { MyStocksError, isMyStocksError, fromHttpError, configError };
