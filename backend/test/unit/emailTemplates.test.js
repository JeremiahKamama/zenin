// backend/test/unit/emailTemplates.test.js
//
// Coverage for the Resend template diagnostics.
//
// The failure mode this guards against: Resend renders an unknown
// `{{{VARIABLE}}}` as EMPTY and still returns success. So a template whose
// variable casing does not match what the sender passes produces an email with a
// blank code or link, and nothing anywhere reports an error. These tests pin the
// variable map (so the names stay visible and reviewable) and the refusal paths
// of the test sender (so a missing template id is loud, not silent).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getTemplateVariableMap, sendTemplateTest, getEmailDeliveryConfig } = require("../../email");

test("every template slot reports its id and variables", () => {
  const map = getTemplateVariableMap();
  for (const kind of ["passwordReset", "emailVerification", "emailChange", "adminLogin", "alert"]) {
    assert.ok(map[kind], `missing template slot: ${kind}`);
    assert.ok(Array.isArray(map[kind].variables), `${kind} must expose a variables list`);
    assert.ok(map[kind].variables.length > 0, `${kind} must pass at least one variable`);
  }
});

test("both casings of each variable are offered", () => {
  // Senders pass several casings as a hedge; if that hedge were dropped the
  // template could silently render blank.
  const map = getTemplateVariableMap();
  assert.ok(map.passwordReset.variables.includes("RESET_LINK"));
  assert.ok(map.passwordReset.variables.includes("reset_link"));
  assert.ok(map.emailVerification.variables.includes("CODE"));
  assert.ok(map.emailVerification.variables.includes("code"));
});

test("admin login falls back to the verification template when unset", () => {
  // Admin codes and account verification both render a single CODE variable, so
  // sharing one template is intentional — and must stay non-null in the default
  // configuration or admin sign-in would have no template at all.
  const map = getTemplateVariableMap();
  assert.ok(map.adminLogin.templateId, "adminLogin must resolve to a template id");
});

test("delivery config exposes every template slot", () => {
  const config = getEmailDeliveryConfig();
  for (const key of ["passwordReset", "emailVerification", "emailChange", "adminLogin", "alert"]) {
    assert.ok(key in config.templates, `templates.${key} missing from delivery config`);
  }
});

test("sendTemplateTest rejects an unknown template kind", async () => {
  const result = await sendTemplateTest("does-not-exist", "admin@example.com");
  assert.equal(result.ok, false);
  assert.match(result.error.message, /Unknown template kind/);
  assert.ok(Array.isArray(result.available));
});

test("sendTemplateTest refuses a template with no configured id", async () => {
  // The alert slot has no default id. It must fail loudly rather than silently
  // sending the inline fallback, which would mask a misconfiguration.
  const map = getTemplateVariableMap();
  if (!map.alert.templateId) {
    const result = await sendTemplateTest("alert", "admin@example.com");
    assert.equal(result.ok, false);
    assert.match(result.error.message, /No template id configured/);
  }
});

test("sendTemplateTest reports the resolved template id on failure", async () => {
  // Without a real API key this hits the not-configured guard, but it must still
  // name the template so the response is actionable.
  const result = await sendTemplateTest("passwordReset", "admin@example.com");
  if (!result.ok) {
    assert.ok("templateId" in result, "failure must include templateId");
  }
});
