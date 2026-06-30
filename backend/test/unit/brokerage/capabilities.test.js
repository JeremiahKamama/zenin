const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BrokerageCapability,
  ALL_CAPABILITY_KEYS,
  normalizeCapabilities,
  supports,
  describeCapabilities,
  hasAnyCapability
} = require("../../../brokerage/domain/capabilities");

// ── BrokerageCapability enum ──────────────────────────────────────────────────

test("BrokerageCapability is a frozen enum of known capability keys", () => {
  assert.ok(Object.isFrozen(BrokerageCapability));
  assert.equal(BrokerageCapability.ORDER_EXECUTION, "supportsOrderExecution");
  assert.equal(BrokerageCapability.WEBHOOKS, "supportsWebhooks");
});

test("ALL_CAPABILITY_KEYS matches the enum values", () => {
  assert.deepEqual([...ALL_CAPABILITY_KEYS].sort(), [...Object.values(BrokerageCapability)].sort());
});

// ── normalizeCapabilities ─────────────────────────────────────────────────────

test("normalizeCapabilities defaults every key to false", () => {
  const { capabilities, warnings } = normalizeCapabilities({});
  for (const key of ALL_CAPABILITY_KEYS) {
    assert.equal(capabilities[key], false);
  }
  assert.deepEqual(warnings, []);
});

test("normalizeCapabilities keeps only true flags and drops falsey ones", () => {
  const { capabilities } = normalizeCapabilities({
    supportsCrypto: true,
    supportsOptions: false,
    supportsMargin: "yes" // truthy non-boolean -> must collapse to false
  });
  assert.equal(capabilities.supportsCrypto, true);
  assert.equal(capabilities.supportsOptions, false);
  assert.equal(capabilities.supportsMargin, false);
});

test("normalizeCapabilities warns on unknown capability keys (no silent typos)", () => {
  const { warnings } = normalizeCapabilities({ supportsTrading: true });
  assert.ok(warnings.some((w) => w.includes("supportsTrading")));
});

test("normalizeCapabilities tolerates null/undefined input", () => {
  const { capabilities } = normalizeCapabilities(null);
  assert.equal(capabilities.supportsOrderExecution, false);
});

// ── supports / describeCapabilities / hasAnyCapability ─────────────────────────

test("supports returns strict boolean for a key", () => {
  const caps = { supportsCrypto: true };
  assert.equal(supports(caps, BrokerageCapability.CRYPTO), true);
  assert.equal(supports(caps, BrokerageCapability.OPTIONS), false);
  assert.equal(supports(null, BrokerageCapability.CRYPTO), false);
});

test("describeCapabilities lists only enabled capabilities", () => {
  const caps = { supportsCrypto: true, supportsMargin: true };
  const desc = describeCapabilities(caps);
  assert.ok(desc.includes("supportsCrypto"));
  assert.ok(desc.includes("supportsMargin"));
  assert.equal(desc.length, 2);
});

test("hasAnyCapability distinguishes active from read-only providers", () => {
  assert.equal(hasAnyCapability({ supportsStatements: true }), true);
  assert.equal(hasAnyCapability({}), false);
  assert.equal(hasAnyCapability(null), false);
});
