"use strict";

const { CompanyProfileService } = require("./application/service");
const { CompanyProfileAggregator } = require("./application/aggregator");
const { ProviderRegistry } = require("./providers/registry");
const { BaseProvider } = require("./providers/base");
const { FmpProvider } = require("./providers/fmp/provider");
const { LegacyProvider } = require("./providers/legacy/provider");
const { registerCompanyProfileRoutes } = require("./http/routes");
const { LayeredCache } = require("./infrastructure/cache");
const { Metrics } = require("./infrastructure/metrics");
const { createRedisClient } = require("./infrastructure/redis");
const { withRetry, CircuitBreaker } = require("./infrastructure/resilience");
const { createEmptyProfile, toLegacyResponse } = require("./domain/models");
const errors = require("./domain/errors");

module.exports = {
  CompanyProfileService,
  CompanyProfileAggregator,
  ProviderRegistry,
  BaseProvider,
  FmpProvider,
  LegacyProvider,
  registerCompanyProfileRoutes,
  LayeredCache,
  Metrics,
  createRedisClient,
  withRetry,
  CircuitBreaker,
  createEmptyProfile,
  toLegacyResponse,
  errors
};
