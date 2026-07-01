"use strict";

class CompanyProfileError extends Error {
  constructor(message, { provider, cause } = {}) {
    super(message);
    this.name = "CompanyProfileError";
    this.provider = provider;
    this.cause = cause;
  }
}

class ProviderUnavailableError extends CompanyProfileError {
  constructor(provider, reason) {
    super(`Provider ${provider} unavailable: ${reason}`, { provider });
    this.name = "ProviderUnavailableError";
  }
}

class RateLimitError extends CompanyProfileError {
  constructor(provider) {
    super(`Provider ${provider} rate limited`, { provider });
    this.name = "RateLimitError";
  }
}

class NotFoundError extends CompanyProfileError {
  constructor(symbol) {
    super(`Company profile not found for ${symbol}`);
    this.name = "NotFoundError";
    this.symbol = symbol;
  }
}

module.exports = {
  CompanyProfileError,
  ProviderUnavailableError,
  RateLimitError,
  NotFoundError
};
