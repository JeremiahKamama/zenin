/**
 * SnapTrade Provider Package Barrel
 * =================================
 *
 * The single import surface for the SnapTrade adapter. Consumers outside this
 * package should import ONLY from here (or, preferably, through the
 * BrokerageRegistry / BrokerageService — never directly).
 *
 * The SDK is intentionally NOT re-exported. Nothing SnapTrade-specific (client,
 * mappers internals, raw error shapes) leaves through this file.
 */

"use strict";

const { createSnapTradeProvider, isConfigured, CAPABILITIES } = require("./SnapTradeProvider");

module.exports = {
  createSnapTradeProvider,
  isConfigured,
  CAPABILITIES
};
