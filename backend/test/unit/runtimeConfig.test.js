const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPublicRuntimeConfig,
  buildAppRuntimeConfig,
} = require("../../runtimeConfig");

// ── buildPublicRuntimeConfig ──────────────────────────────────────────────────

test("buildPublicRuntimeConfig returns a plain object", () => {
  const config = buildPublicRuntimeConfig();
  assert.equal(typeof config, "object");
  assert.ok(config !== null);
});

test("buildPublicRuntimeConfig includes auth section", () => {
  const config = buildPublicRuntimeConfig();
  assert.ok(config.auth);
  assert.ok(Array.isArray(config.auth.passkeyProviders));
  assert.ok(config.auth.passkeyProviders.length > 0);
});

test("buildPublicRuntimeConfig includes subscription section", () => {
  const config = buildPublicRuntimeConfig();
  assert.ok(config.subscription);
  assert.deepEqual(config.subscription.validPlans, ["starter", "pro", "desk"]);
  assert.deepEqual(config.subscription.validBillingCycles, ["monthly", "yearly"]);
  assert.equal(config.subscription.yearlyDiscountRate, 0.2);
  assert.ok(config.subscription.monthlyPrices);
  assert.equal(config.subscription.monthlyPrices.starter, 0);
  assert.equal(config.subscription.monthlyPrices.pro, 29);
  assert.equal(config.subscription.monthlyPrices.desk, 99);
});

test("buildPublicRuntimeConfig returns a deep clone (mutations do not affect source)", () => {
  const config1 = buildPublicRuntimeConfig();
  config1.subscription.monthlyPrices.pro = 999;
  const config2 = buildPublicRuntimeConfig();
  assert.equal(config2.subscription.monthlyPrices.pro, 29);
});

// ── buildAppRuntimeConfig ─────────────────────────────────────────────────────

test("buildAppRuntimeConfig returns a plain object", () => {
  const config = buildAppRuntimeConfig();
  assert.equal(typeof config, "object");
  assert.ok(config !== null);
});

test("buildAppRuntimeConfig includes subscription with planRank", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.subscription);
  assert.ok(config.subscription.planRank);
  assert.equal(config.subscription.planRank.starter, 0);
  assert.equal(config.subscription.planRank.pro, 1);
  assert.equal(config.subscription.planRank.desk, 2);
});

test("buildAppRuntimeConfig includes sectionMinPlan", () => {
  const config = buildAppRuntimeConfig();
  const smp = config.subscription.sectionMinPlan;
  assert.ok(smp);
  assert.equal(smp.Home, "starter");
  assert.equal(smp.Analytics, "pro");
  assert.equal(smp.Options, "desk");
});

test("buildAppRuntimeConfig includes watchlist fallback data", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.watchlist);
  assert.ok(Array.isArray(config.watchlist.fallbackCategories));
  assert.ok(config.watchlist.fallbackCategories.includes("stocks"));
  assert.ok(config.watchlist.fallbackCategories.includes("crypto"));
  assert.ok(config.watchlist.fallbackAssetsByCategory);
  assert.ok(Array.isArray(config.watchlist.fallbackAssetsByCategory.stocks));
  assert.ok(config.watchlist.fallbackAssetsByCategory.stocks.length > 0);
});

test("buildAppRuntimeConfig includes auth options", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.auth);
  assert.ok(Array.isArray(config.auth.authenticatorOptions));
  assert.ok(Array.isArray(config.auth.passkeyOptions));
});

test("buildAppRuntimeConfig includes connections venues", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.connections);
  assert.ok(config.connections.venues);
  assert.ok(Array.isArray(config.connections.venues.cex));
  assert.ok(Array.isArray(config.connections.venues.dex));
  assert.ok(Array.isArray(config.connections.venues.brokers));
  assert.ok(Array.isArray(config.connections.venues.prediction));
});

test("buildAppRuntimeConfig includes options config", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.options);
  assert.ok(Array.isArray(config.options.supportedAssets));
  assert.ok(config.options.supportedAssets.includes("BTC"));
  assert.ok(Array.isArray(config.options.calculatorStrategies));
  assert.ok(config.options.calculatorStrategies.length > 0);
  assert.ok(config.options.simulator);
  assert.ok(config.options.simulator.strategyLibrary);
});

test("buildAppRuntimeConfig includes marketHours", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.marketHours);
  assert.ok(config.marketHours.US);
  assert.equal(config.marketHours.US.open, 9.5);
  assert.equal(config.marketHours.US.close, 16.0);
  assert.equal(config.marketHours.US.tz, "America/New_York");
});

test("buildAppRuntimeConfig includes tax rules", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.tax);
  assert.ok(config.tax.rules);
  assert.ok(config.tax.rules.USA);
  assert.equal(config.tax.rules.USA.cgRate, 0.20);
  assert.equal(config.tax.rules.UAE.cgRate, 0.0);
  assert.ok(Array.isArray(config.tax.regions));
});

test("buildAppRuntimeConfig includes currency config", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.currency);
  assert.ok(config.currency.symbols);
  assert.equal(config.currency.symbols.USD, "$");
  assert.ok(config.currency.forexQuoteCurrency);
  assert.ok(config.currency.defaultFxRates);
  assert.equal(config.currency.defaultFxRates.USD, 1.0);
});

test("buildAppRuntimeConfig includes UI config", () => {
  const config = buildAppRuntimeConfig();
  assert.ok(config.ui);
  assert.ok(config.ui.moversHorizons);
  assert.ok(Array.isArray(config.ui.homeDisplayIntervals));
  assert.ok(Array.isArray(config.ui.g7Currencies));
});

test("buildAppRuntimeConfig returns a deep clone", () => {
  const config1 = buildAppRuntimeConfig();
  config1.options.supportedAssets.push("DOGE");
  const config2 = buildAppRuntimeConfig();
  assert.ok(!config2.options.supportedAssets.includes("DOGE"));
});
