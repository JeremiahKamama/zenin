const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getEmailDeliveryConfig,
  isEmailDeliveryProductionReady,
} = require("../../email");

// ── getEmailDeliveryConfig ────────────────────────────────────────────────────

test("getEmailDeliveryConfig returns expected shape", () => {
  const config = getEmailDeliveryConfig();
  assert.equal(typeof config, "object");
  assert.equal(typeof config.resendConfigured, "boolean");
  assert.equal(typeof config.fromConfigured, "boolean");
  assert.equal(typeof config.resendWebhookConfigured, "boolean");
  assert.equal(typeof config.from, "string");
  assert.equal(typeof config.usesResendTestDomain, "boolean");
  assert.ok(config.templates);
  assert.equal(typeof config.productionReady, "boolean");
});

test("getEmailDeliveryConfig templates has expected keys", () => {
  const config = getEmailDeliveryConfig();
  assert.ok("passwordReset" in config.templates);
  assert.ok("emailVerification" in config.templates);
  assert.ok("emailChange" in config.templates);
  assert.ok("alert" in config.templates);
});

test("getEmailDeliveryConfig reports not production-ready without env vars", () => {
  const config = getEmailDeliveryConfig();
  assert.equal(config.productionReady, false);
});

// ── isEmailDeliveryProductionReady ────────────────────────────────────────────

test("isEmailDeliveryProductionReady returns false without env config", () => {
  assert.equal(isEmailDeliveryProductionReady(), false);
});
