const test = require("node:test");
const assert = require("node:assert/strict");
const ff = require("../../../brokerage/application/featureFlags");

test("isBrokerageEnabled parses the SNAPTRADE_ENABLED flag", () => {
  assert.equal(ff.isBrokerageEnabled({ SNAPTRADE_ENABLED: "true" }), true);
  assert.equal(ff.isBrokerageEnabled({ SNAPTRADE_ENABLED: "1" }), true);
  assert.equal(ff.isBrokerageEnabled({ SNAPTRADE_ENABLED: "yes" }), true);
  assert.equal(ff.isBrokerageEnabled({ SNAPTRADE_ENABLED: "false" }), false);
  assert.equal(ff.isBrokerageEnabled({}), false);
  assert.equal(ff.isBrokerageEnabled(undefined), false);
});

test("parsePilotAllowList returns null when unset (open pilot)", () => {
  assert.equal(ff.parsePilotAllowList({}), null);
  assert.equal(ff.parsePilotAllowList({ SNAPTRADE_PILOT_WORKSPACES: "  " }), null);
});

test("parsePilotAllowList parses comma/space separated ids", () => {
  const set = ff.parsePilotAllowList({ SNAPTRADE_PILOT_WORKSPACES: "ws-1, ws-2 ws-3\nws-4" });
  assert.deepEqual([...set].sort(), ["ws-1", "ws-2", "ws-3", "ws-4"]);
});

test("isWorkspaceEligible requires flag + allow-list membership", () => {
  const env = { SNAPTRADE_ENABLED: "true", SNAPTRADE_PILOT_WORKSPACES: "ws-1,ws-2" };
  assert.equal(ff.isWorkspaceEligible("ws-1", env), true);
  assert.equal(ff.isWorkspaceEligible("ws-9", env), false);
  assert.equal(ff.isWorkspaceEligible("ws-1", { SNAPTRADE_ENABLED: "false" }), false);
  // open pilot (no allow-list) → any workspace eligible when flag on
  assert.equal(ff.isWorkspaceEligible("ws-9", { SNAPTRADE_ENABLED: "true" }), true);
});

test("resolveProviderAvailability returns unavailable when not configured", () => {
  const r = ff.resolveProviderAvailability("snaptrade", "ws-1", { configured: false, env: { SNAPTRADE_ENABLED: "true" } });
  assert.equal(r.available, false);
  assert.equal(r.code, "BROKERAGE_UNAVAILABLE");
});

test("resolveProviderAvailability returns disabled when flag off", () => {
  const r = ff.resolveProviderAvailability("snaptrade", "ws-1", { configured: true, env: { SNAPTRADE_ENABLED: "false" } });
  assert.equal(r.available, false);
  assert.equal(r.code, "BROKERAGE_DISABLED");
});

test("resolveProviderAvailability returns pilot-restricted for non-listed workspace", () => {
  const env = { SNAPTRADE_ENABLED: "true", SNAPTRADE_PILOT_WORKSPACES: "ws-1" };
  const r = ff.resolveProviderAvailability("snaptrade", "ws-9", { configured: true, env });
  assert.equal(r.available, false);
  assert.equal(r.code, "BROKERAGE_PILOT_RESTRICTED");
});

test("resolveProviderAvailability is available for eligible workspace", () => {
  const env = { SNAPTRADE_ENABLED: "true", SNAPTRADE_PILOT_WORKSPACES: "ws-1" };
  const r = ff.resolveProviderAvailability("snaptrade", "ws-1", { configured: true, env });
  assert.equal(r.available, true);
});

test("resolveProviderAvailability rejects unknown provider", () => {
  const r = ff.resolveProviderAvailability("other", "ws-1", { configured: true, env: { SNAPTRADE_ENABLED: "true" } });
  assert.equal(r.available, false);
  assert.equal(r.code, "BROKERAGE_PROVIDER_UNKNOWN");
});
