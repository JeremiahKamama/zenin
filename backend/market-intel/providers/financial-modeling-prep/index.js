/**
 * FMP Provider Barrel
 * ===================
 *
 * Public entry point for the Financial Modeling Prep provider.
 * Only the bootstrap module should import from here.
 *
 * @module market-intel/providers/financial-modeling-prep
 */

"use strict";

const { createFmpProvider } = require("./FmpProvider");
const { isConfigured } = require("./client");

module.exports = {
  createFmpProvider,
  isConfigured
};
