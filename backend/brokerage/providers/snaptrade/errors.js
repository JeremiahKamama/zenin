/**
 * SnapTrade Error Translation
 * ===========================
 *
 * This is the ONLY module that understands SnapTrade's exception shapes. It
 * converts raw SnapTrade/axios errors into Zenin's provider-independent
 * BrokerageError hierarchy so nothing vendor-specific ever escapes this package.
 *
 * SnapTrade errors arrive via the SDK's `SnaptradeError` or as axios errors with
 * a `response.status` and a JSON body containing `detail` / `message` / `status`.
 */

"use strict";

const {
  BrokerageError,
  BrokerageAuthenticationError,
  BrokerageRateLimitError,
  BrokerageUnavailableError,
  BrokerageTimeoutError,
  BrokerageAccountNotFound,
  BrokeragePermissionDenied,
  BrokerageSynchronizationError,
} = require("../../domain/errors");

/**
 * Extracts the HTTP status and message from any error shape the SDK may throw.
 * @param {unknown} err
 * @returns {{ status: number|null, message: string, detail: unknown }}
 */
function inspectSnapTradeError(err) {
  if (!err || typeof err !== "object") {
    return { status: null, message: String(err || "SnapTrade error"), detail: null };
  }

  const response = /** @type {any} */ (err).response || null;
  const status = Number(response?.status || /** @type {any} */ (err).status) || null;
  const data = response?.data || /** @type {any} */ (err).data || null;

  // SnapTrade JSON error bodies commonly use detail / message / status fields.
  const message =
    (typeof data?.detail === "string" && data.detail) ||
    (typeof data?.message === "string" && data.message) ||
    (typeof /** @type {any} */ (err).message === "string" && /** @type {any} */ (err).message) ||
    "SnapTrade request failed";

  return { status, message, detail: data };
}

/**
 * Maps a SnapTrade/axios error to a provider-independent BrokerageError.
 *
 * @param {unknown} err  The raw error thrown by the SnapTrade SDK.
 * @param {string} [operation]  Human label for the operation (for messages/logs).
 * @returns {import("../../domain/errors").BrokerageError}
 */
function translateSnapTradeError(err, operation = "SnapTrade request") {
  const { status, message, detail } = inspectSnapTradeError(err);

  const base = { cause: err };
  const labeled = (suffix) => (operation ? `${operation}: ${suffix}` : suffix);

  // Network / timeout (no HTTP response)
  if (status === null) {
    const code = String(/** @type {any} */ (err)?.code || "").toLowerCase();
    if (code === "etimedout" || code === "esockettimedout" || /timeout/i.test(message)) {
      return new BrokerageTimeoutError(labeled("request timed out"), base);
    }
    return new BrokerageUnavailableError(labeled("provider unreachable"), base);
  }

  switch (status) {
    case 401:
    case 407:
      return new BrokerageAuthenticationError(labeled("authentication failed"), base);
    case 403:
      return new BrokeragePermissionDenied(labeled("permission denied"), base);
    case 404:
      return new BrokerageAccountNotFound(labeled("account or resource not found"), base);
    case 408:
      return new BrokerageTimeoutError(labeled("request timed out"), base);
    case 429: {
      const retryAfterHeader = detail?.["retry-after"] || /** @type {any} */ (err)?.response?.headers?.["retry-after"];
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      return new BrokerageRateLimitError(labeled("rate limited"), { ...base, retryAfter: retryAfterMs });
    }
    case 400:
    case 409:
    case 422:
      return new BrokerageSynchronizationError(labeled("provider rejected request"), base);
    default:
      if (status >= 500) return new BrokerageUnavailableError(labeled("provider error"), base);
      return new BrokerageError(labeled(message), { ...base, statusCode: status });
  }
}

/**
 * Wraps an async SDK call, translating any thrown error into a BrokerageError.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} [operation]
 * @returns {Promise<T>}
 */
async function withSnapTradeErrors(fn, operation) {
  try {
    return await fn();
  } catch (err) {
    throw translateSnapTradeError(err, operation);
  }
}

module.exports = {
  inspectSnapTradeError,
  translateSnapTradeError,
  withSnapTradeErrors,
};
