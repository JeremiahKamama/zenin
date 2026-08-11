const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCategory,
  normalizeSeverity,
  isEmailDeliveryEnabled
} = require("../../workspaceNotificationDispatcher");

test("notification dispatcher normalizes the public category contract", () => {
  assert.equal(normalizeCategory("risk"), "risk");
  assert.equal(normalizeCategory("market-news"), "market-news");
  assert.equal(normalizeCategory("legacy_alert"), "workspace");
});

test("notification dispatcher normalizes severity to supported values", () => {
  assert.equal(normalizeSeverity("critical"), "critical");
  assert.equal(normalizeSeverity("warning"), "warning");
  assert.equal(normalizeSeverity("review"), "info");
});

test("email delivery remains off unless the server switch is explicitly enabled", () => {
  const original = process.env.NOTIFICATIONS_EMAIL_ENABLED;
  delete process.env.NOTIFICATIONS_EMAIL_ENABLED;
  assert.equal(isEmailDeliveryEnabled(), false);
  process.env.NOTIFICATIONS_EMAIL_ENABLED = "true";
  assert.equal(isEmailDeliveryEnabled(), true);
  if (original == null) delete process.env.NOTIFICATIONS_EMAIL_ENABLED;
  else process.env.NOTIFICATIONS_EMAIL_ENABLED = original;
});
