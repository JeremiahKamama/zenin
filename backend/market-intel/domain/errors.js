/**
 * Market Intelligence Domain Errors
 * =================================
 *
 * Provider-independent error classes for the market intelligence domain.
 * No vendor terminology. These are what the application layer catches.
 *
 * @module market-intel/domain/errors
 */

"use strict";

class MarketIntelligenceError extends Error {
  /**
   * @param {string} message
   * @param {Object} [context]
   */
  constructor(message, context = {}) {
    super(message);
    this.name = "MarketIntelligenceError";
    this.code = context.code || "MARKET_INTEL_ERROR";
    this.statusCode = context.statusCode || 500;
    this.context = context;
  }
}

class MarketDataProviderError extends MarketIntelligenceError {
  constructor(message, context = {}) {
    super(message, { ...context, code: context.code || "MARKET_PROVIDER_ERROR" });
    this.name = "MarketDataProviderError";
    this.statusCode = context.statusCode || 502;
  }
}

class MarketDataNotAvailableError extends MarketDataProviderError {
  constructor(symbol, context = {}) {
    super(`Market data not available for symbol: ${symbol}`, {
      ...context,
      code: "MARKET_DATA_NOT_AVAILABLE",
      statusCode: 404
    });
    this.name = "MarketDataNotAvailableError";
  }
}

class ProviderAuthenticationError extends MarketDataProviderError {
  constructor(message, context = {}) {
    super(message || "Provider authentication failed", {
      ...context,
      code: context.code || "PROVIDER_AUTH_ERROR",
      statusCode: 401
    });
    this.name = "ProviderAuthenticationError";
  }
}

class ProviderRateLimitError extends MarketDataProviderError {
  constructor(message, context = {}) {
    super(message || "Provider rate limit exceeded", {
      ...context,
      code: "PROVIDER_RATE_LIMIT",
      statusCode: 429
    });
    this.name = "ProviderRateLimitError";
  }
}

class ProviderUnavailableError extends MarketDataProviderError {
  constructor(message, context = {}) {
    super(message || "Provider is currently unavailable", {
      ...context,
      code: "PROVIDER_UNAVAILABLE",
      statusCode: 503
    });
    this.name = "ProviderUnavailableError";
  }
}

class ProviderNotFoundError extends MarketIntelligenceError {
  constructor(providerKey, context = {}) {
    super(`Market data provider "${providerKey}" is not registered.`, {
      ...context,
      code: "PROVIDER_NOT_FOUND",
      statusCode: 400
    });
    this.name = "ProviderNotFoundError";
  }
}

class CacheError extends MarketIntelligenceError {
  constructor(message, context = {}) {
    super(message || "Cache operation failed", {
      ...context,
      code: "CACHE_ERROR",
      statusCode: 500
    });
    this.name = "CacheError";
  }
}

class AlertRuleNotFoundError extends MarketIntelligenceError {
  constructor(ruleId, context = {}) {
    super(`Alert rule "${ruleId}" not found.`, {
      ...context,
      code: "ALERT_RULE_NOT_FOUND",
      statusCode: 404
    });
    this.name = "AlertRuleNotFoundError";
  }
}

class NotificationDeliveryError extends MarketIntelligenceError {
  constructor(message, context = {}) {
    super(message || "Notification delivery failed", {
      ...context,
      code: "NOTIFICATION_DELIVERY_ERROR",
      statusCode: 500
    });
    this.name = "NotificationDeliveryError";
  }
}

module.exports = {
  MarketIntelligenceError,
  MarketDataProviderError,
  MarketDataNotAvailableError,
  ProviderAuthenticationError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  ProviderNotFoundError,
  CacheError,
  AlertRuleNotFoundError,
  NotificationDeliveryError
};
