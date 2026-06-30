const test = require("node:test");
const assert = require("node:assert/strict");

const { assertProviderContract, REQUIRED_METHODS } = require("../../../brokerage/domain/BrokerageProvider");

/** Builds a minimal valid provider (all required methods present). */
function makeValidProvider(overrides = {}) {
  const provider = {
    providerKey: "mock",
    displayName: "Mock Provider",
    capabilities: {},
  };
  for (const m of REQUIRED_METHODS) {
    provider[m] = async () => {};
  }
  return { ...provider, ...overrides };
}

// ── assertProviderContract: happy path ────────────────────────────────────────

test("assertProviderContract returns the provider when valid", () => {
  const provider = makeValidProvider();
  assert.equal(assertProviderContract(provider), provider);
});

test("assertProviderContract accepts real capabilities + displayName", () => {
  const provider = makeValidProvider({ capabilities: { supportsCrypto: true } });
  assert.doesNotThrow(() => assertProviderContract(provider));
});

// ── failures ─────────────────────────────────────────────────────────────────

test("assertProviderContract rejects non-object", () => {
  assert.throws(() => assertProviderContract(null), /must be an object/);
  assert.throws(() => assertProviderContract("snaptrade"), /must be an object/);
});

test("assertProviderContract rejects missing required fields", () => {
  const provider = makeValidProvider();
  delete provider.displayName;
  delete provider.capabilities;
  assert.throws(() => assertProviderContract(provider), /missing required fields/);
});

test("assertProviderContract rejects empty providerKey", () => {
  const provider = makeValidProvider({ providerKey: "  " });
  assert.throws(() => assertProviderContract(provider), /providerKey must be a non-empty string/);
});

test("assertProviderContract rejects a provider missing methods", () => {
  const provider = makeValidProvider();
  delete provider.sync;
  delete provider.healthCheck;
  assert.throws(() => assertProviderContract(provider), /missing methods: sync, healthCheck/);
});

test("assertProviderContract rejects a method that is not a function", () => {
  const provider = makeValidProvider({ connect: "not-a-fn" });
  assert.throws(() => assertProviderContract(provider), /missing methods: connect/);
});

test("REQUIRED_METHODS lists every interface method from the spec", () => {
  const expected = [
    "connect", "disconnect", "refresh", "listAccounts", "getAccount",
    "getBalances", "getPositions", "getHoldings", "getTransactions",
    "getInstitutions", "getConnectionStatus", "sync", "refreshAccount", "healthCheck"
  ];
  assert.deepEqual([...REQUIRED_METHODS].sort(), [...expected].sort());
});
