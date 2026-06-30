/**
 * Brokerage Module Barrel
 * =======================
 *
 * Provider-agnostic entry point for the brokerage abstraction layer.
 * Application code should import from here — never from providers/* directly.
 */

"use strict";

const domain = {
  ...require("./domain/BrokerageProvider"),
  ...require("./domain/capabilities"),
  ...require("./domain/models"),
  ...require("./domain/errors")
};

const infrastructure = {
  ...require("./infrastructure/BrokerageRegistry"),
  ...require("./infrastructure/bootstrap")
};

const application = {
  ...require("./application/BrokerageService"),
  ...require("./application/SyncEngine"),
  ...require("./application/persistenceMappers"),
  ...require("./application/credentials"),
  ...require("./application/retry"),
  ...require("./application/rateLimiter")
};

module.exports = {
  ...domain,
  ...infrastructure,
  ...application
};
