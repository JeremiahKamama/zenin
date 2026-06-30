/**
 * Market Intelligence Module Barrel
 * =================================
 *
 * Provider-agnostic entry point for the market intelligence domain.
 * Application code should import from here — never from providers/* directly.
 *
 * @module market-intel
 */

"use strict";

const domain = {
  ...require("./domain/MarketDataProvider"),
  ...require("./domain/models"),
  ...require("./domain/errors")
};

const infrastructure = {
  ...require("./infrastructure/ProviderRegistry"),
  ...require("./infrastructure/bootstrap"),
  ...require("./infrastructure/cache")
};

const application = {
  ...require("./application/MarketIntelligenceService"),
  ...require("./application/MarketEventEngine"),
  ...require("./application/PortfolioIntelligenceEngine"),
  ...require("./application/NotificationService"),
  ...require("./application/AlertRulesEngine")
};

module.exports = {
  ...domain,
  ...infrastructure,
  ...application
};
