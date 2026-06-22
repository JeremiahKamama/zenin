const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RevenueCatApiError,
  buildRevenueCatProviderStatus,
  buildRevenueCatIntegrationItem,
  isRevenueCatConfigured,
} = require("../../revenuecat");

// ── isRevenueCatConfigured ────────────────────────────────────────────────────

test("isRevenueCatConfigured returns false without env vars", () => {
  assert.equal(isRevenueCatConfigured(), false);
});

// ── RevenueCatApiError ────────────────────────────────────────────────────────

test("RevenueCatApiError is an Error subclass", () => {
  const err = new RevenueCatApiError("test message", 404, { foo: "bar" });
  assert.ok(err instanceof Error);
  assert.equal(err.name, "RevenueCatApiError");
  assert.equal(err.message, "test message");
  assert.equal(err.status, 404);
  assert.deepEqual(err.details, { foo: "bar" });
});

test("RevenueCatApiError defaults status to 500", () => {
  const err = new RevenueCatApiError("oops");
  assert.equal(err.status, 500);
  assert.equal(err.details, null);
});

// ── buildRevenueCatProviderStatus ─────────────────────────────────────────────

test("buildRevenueCatProviderStatus returns expected shape", () => {
  const status = buildRevenueCatProviderStatus();
  assert.equal(typeof status, "object");
  assert.equal(typeof status.configured, "boolean");
  assert.equal(status.name, "RevenueCat");
  assert.ok(["active", "degraded"].includes(status.status));
  assert.equal(typeof status.note, "string");
  assert.ok(status.lastSyncAt);
});

test("buildRevenueCatProviderStatus reports degraded without env vars", () => {
  const status = buildRevenueCatProviderStatus();
  assert.equal(status.configured, false);
  assert.equal(status.status, "degraded");
});

test("buildRevenueCatProviderStatus includes preview fields", () => {
  const status = buildRevenueCatProviderStatus();
  assert.ok("secretKeyPreview" in status);
  assert.ok("projectIdPreview" in status);
});

// ── buildRevenueCatIntegrationItem ────────────────────────────────────────────

test("buildRevenueCatIntegrationItem returns expected shape", () => {
  const item = buildRevenueCatIntegrationItem();
  assert.equal(item.name, "RevenueCat");
  assert.equal(item.category, "Payments");
  assert.ok(["active", "degraded"].includes(item.status));
  assert.equal(typeof item.note, "string");
  assert.equal(typeof item.actionLabel, "string");
  assert.equal(typeof item.credentialStatus, "string");
  assert.equal(typeof item.syncLagMinutes, "number");
  assert.equal(typeof item.webhookFailures, "number");
  assert.ok("metadata" in item);
});

test("buildRevenueCatIntegrationItem without config reports missing credentials", () => {
  const item = buildRevenueCatIntegrationItem();
  assert.equal(item.status, "degraded");
  assert.equal(item.credentialStatus, "missing");
  assert.equal(item.actionLabel, "Configure");
});

test("buildRevenueCatIntegrationItem accepts pre-built summary", () => {
  const summary = {
    providerStatus: {
      configured: true,
      status: "active",
      note: "OK",
      lastSyncAt: new Date().toISOString(),
      secretKeyPreview: "sk_...abcd",
      projectIdPreview: "proj_1",
    },
  };
  const item = buildRevenueCatIntegrationItem(summary);
  assert.equal(item.status, "active");
  assert.equal(item.credentialStatus, "configured");
  assert.equal(item.actionLabel, "Inspect");
});
