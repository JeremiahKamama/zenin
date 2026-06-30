const test = require("node:test");
const assert = require("node:assert/strict");

const { REQUIRED_METHODS } = require("../../../brokerage/domain/BrokerageProvider");
const { BrokerageProviderNotFound } = require("../../../brokerage/domain/errors");
const {
  BrokerageRegistry,
  normalizeProviderKey,
  summarizeProvider
} = require("../../../brokerage/infrastructure/BrokerageRegistry");
const {
  createBrokerageRegistry,
  resetBrokerageRegistry
} = require("../../../brokerage/infrastructure/bootstrap");

/** Builds a minimal valid provider (all required methods present). */
function makeValidProvider(overrides = {}) {
  const provider = {
    providerKey: "mock",
    displayName: "Mock Provider",
    capabilities: { supportsCrypto: true }
  };
  for (const m of REQUIRED_METHODS) {
    provider[m] = async () => {};
  }
  return { ...provider, ...overrides };
}

// ── normalizeProviderKey ──────────────────────────────────────────────────────

test("normalizeProviderKey lowercases and trims", () => {
  assert.equal(normalizeProviderKey("  SnapTrade  "), "snaptrade");
});

test("normalizeProviderKey rejects empty values", () => {
  assert.throws(() => normalizeProviderKey("  "), /non-empty string/);
});

// ── registerProvider ──────────────────────────────────────────────────────────

test("registerProvider stores provider and returns summary", () => {
  const registry = new BrokerageRegistry();
  const provider = makeValidProvider();

  const summary = registry.registerProvider(provider);

  assert.equal(summary.providerKey, "mock");
  assert.equal(summary.displayName, "Mock Provider");
  assert.equal(summary.capabilities.supportsCrypto, true);
  assert.equal(registry.hasProvider("mock"), true);
});

test("registerProvider normalizes providerKey to lowercase", () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({ providerKey: "Alpaca" }));

  assert.equal(registry.hasProvider("alpaca"), true);
  assert.equal(registry.getProvider("ALPACA").providerKey, "alpaca");
});

test("registerProvider rejects duplicate providerKey", () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({ providerKey: "mock" }));

  assert.throws(
    () => registry.registerProvider(makeValidProvider({ providerKey: "mock" })),
    /already registered/
  );
});

test("registerProvider rejects invalid contract", () => {
  const registry = new BrokerageRegistry();
  const broken = makeValidProvider();
  delete broken.sync;

  assert.throws(() => registry.registerProvider(broken), /missing methods: sync/);
});

// ── getProvider ───────────────────────────────────────────────────────────────

test("getProvider returns registered adapter", () => {
  const registry = new BrokerageRegistry();
  const provider = makeValidProvider();
  registry.registerProvider(provider);

  assert.equal(registry.getProvider("mock"), provider);
});

test("getProvider throws BrokerageProviderNotFound for unknown key", () => {
  const registry = new BrokerageRegistry();

  assert.throws(() => registry.getProvider("unknown"), BrokerageProviderNotFound);
});

// ── defaultProvider ───────────────────────────────────────────────────────────

test("defaultProvider returns first registered when env unset", () => {
  const registry = new BrokerageRegistry();
  const first = makeValidProvider({ providerKey: "alpha", displayName: "Alpha" });
  const second = makeValidProvider({ providerKey: "beta", displayName: "Beta" });
  registry.registerProvider(first);
  registry.registerProvider(second);

  assert.equal(registry.defaultProvider({ env: {} }).providerKey, "alpha");
});

test("defaultProvider honors BROKERAGE_PROVIDER env", () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({ providerKey: "alpha" }));
  registry.registerProvider(makeValidProvider({ providerKey: "beta" }));

  const provider = registry.defaultProvider({ env: { BROKERAGE_PROVIDER: "beta" } });
  assert.equal(provider.providerKey, "beta");
});

test("defaultProvider honors explicit defaultProviderKey option", () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({ providerKey: "alpha" }));
  registry.registerProvider(makeValidProvider({ providerKey: "beta" }));

  const provider = registry.defaultProvider({
    defaultProviderKey: "beta",
    env: { BROKERAGE_PROVIDER: "alpha" }
  });
  assert.equal(provider.providerKey, "beta");
});

test("defaultProvider throws when configured provider is missing", () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({ providerKey: "alpha" }));

  assert.throws(
    () => registry.defaultProvider({ env: { BROKERAGE_PROVIDER: "missing" } }),
    BrokerageProviderNotFound
  );
});

test("defaultProvider throws when registry is empty", () => {
  const registry = new BrokerageRegistry();
  assert.throws(() => registry.defaultProvider({ env: {} }), /No brokerage providers are registered/);
});

// ── providerCapabilities ──────────────────────────────────────────────────────

test("providerCapabilities returns normalized capability set", () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({ capabilities: { supportsCrypto: true } }));

  const caps = registry.providerCapabilities("mock");
  assert.equal(caps.supportsCrypto, true);
  assert.equal(caps.supportsOptions, false);
});

// ── listProviders ─────────────────────────────────────────────────────────────

test("listProviders returns summaries in registration order", () => {
  const registry = new BrokerageRegistry();
  registry.registerProvider(makeValidProvider({ providerKey: "alpha", displayName: "Alpha" }));
  registry.registerProvider(makeValidProvider({ providerKey: "beta", displayName: "Beta" }));

  const list = registry.listProviders();
  assert.deepEqual(
    list.map((p) => p.providerKey),
    ["alpha", "beta"]
  );
});

// ── summarizeProvider ─────────────────────────────────────────────────────────

test("summarizeProvider does not expose adapter methods", () => {
  const provider = makeValidProvider();
  const summary = summarizeProvider(provider);

  assert.equal(typeof summary.connect, "undefined");
  assert.equal(summary.providerKey, "mock");
});

// ── bootstrap ─────────────────────────────────────────────────────────────────

test("createBrokerageRegistry registers extraProviders", () => {
  const registry = createBrokerageRegistry({
    env: {},
    extraProviders: [makeValidProvider({ providerKey: "mock" })]
  });

  assert.equal(registry.hasProvider("mock"), true);
});

test("createBrokerageRegistry skips SnapTrade when credentials absent", () => {
  const registry = createBrokerageRegistry({ env: {} });
  assert.equal(registry.hasProvider("snaptrade"), false);
});

test("createBrokerageRegistry registers SnapTrade when configured", () => {
  const registry = createBrokerageRegistry({
    env: {
      SNAPTRADE_CLIENT_ID: "test-client",
      SNAPTRADE_CONSUMER_KEY: "test-key"
    },
    snaptradeClient: {}
  });

  assert.equal(registry.hasProvider("snaptrade"), true);
  assert.equal(registry.getProvider("snaptrade").displayName, "SnapTrade");
});

test("resetBrokerageRegistry clears singleton", () => {
  resetBrokerageRegistry();
  const registry = createBrokerageRegistry({
    env: {},
    extraProviders: [makeValidProvider({ providerKey: "mock" })]
  });
  assert.equal(registry.hasProvider("mock"), true);
  resetBrokerageRegistry();
});
