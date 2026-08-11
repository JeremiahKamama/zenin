const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validate,
  signupSchema,
  signinSchema,
  forgotPasswordRequestSchema,
  forgotPasswordConfirmSchema,
  executeTradeSchema,
  tradeEstimateBatchSchema,
  portfolioUpdateSchema,
  watchlistAssetSchema,
  workspaceDocSchema,
  workspaceCollectionSchema,
  optionsCalculationSchema,
  historyQuerySchema,
  pricesQuerySchema,
  searchQuerySchema,
  emailRequestSchema,
  emailConfirmSchema,
  passwordUpdateSchema,
  accountDeleteSchema,
  planUpdateSchema,
  workspaceUpdateSchema,
  workspaceInviteSchema,
  workspaceMemberRoleSchema,
  balanceChangeSchema,
  cashChangeSchema,
  twoFactorEnableSchema,
  passkeyRegisterSchema,
  cryptoOptionsSchema,
  equityOptionsQuerySchema,
  exchangeKeySchema,
  watchlistBulkSchema,
  alertDispatchSchema,
} = require("../../validation");

// ── signupSchema ──────────────────────────────────────────────────────────────

test("signupSchema accepts valid input", () => {
  const result = signupSchema.safeParse({
    email: "Test@Example.com",
    password: "Str0ng!Pass",
    displayName: "Alice",
  });
  assert.ok(result.success);
  assert.equal(result.data.email, "test@example.com");
  assert.equal(result.data.displayName, "Alice");
});

test("signupSchema rejects invalid email", () => {
  const result = signupSchema.safeParse({ email: "bad", password: "Str0ng!Pass" });
  assert.ok(!result.success);
});

test("signupSchema rejects weak password (no digit)", () => {
  const result = signupSchema.safeParse({ email: "a@b.com", password: "NoDigitHere!" });
  assert.ok(!result.success);
});

test("signupSchema rejects weak password (no special char)", () => {
  const result = signupSchema.safeParse({ email: "a@b.com", password: "NoSpecial1abc" });
  assert.ok(!result.success);
});

test("signupSchema rejects short password", () => {
  const result = signupSchema.safeParse({ email: "a@b.com", password: "Sh0rt!" });
  assert.ok(!result.success);
});

test("signupSchema displayName is optional", () => {
  const result = signupSchema.safeParse({ email: "a@b.com", password: "ValidPass1!" });
  assert.ok(result.success);
  assert.equal(result.data.displayName, undefined);
});

// ── signinSchema ──────────────────────────────────────────────────────────────

test("signinSchema accepts valid input", () => {
  const result = signinSchema.safeParse({ email: "A@B.COM", password: "x" });
  assert.ok(result.success);
  assert.equal(result.data.email, "a@b.com");
});

test("signinSchema rejects empty password", () => {
  const result = signinSchema.safeParse({ email: "a@b.com", password: "" });
  assert.ok(!result.success);
});

// ── forgotPasswordRequestSchema ───────────────────────────────────────────────

test("forgotPasswordRequestSchema accepts valid email", () => {
  const result = forgotPasswordRequestSchema.safeParse({ email: "me@test.com" });
  assert.ok(result.success);
});

// ── forgotPasswordConfirmSchema ───────────────────────────────────────────────

test("forgotPasswordConfirmSchema transforms data correctly", () => {
  const result = forgotPasswordConfirmSchema.safeParse({
    token: "abc123",
    password: "NewSecure1!",
  });
  assert.ok(result.success);
  assert.equal(result.data.token, "abc123");
  assert.equal(result.data.newPassword, "NewSecure1!");
});

test("forgotPasswordConfirmSchema prefers newPassword over password", () => {
  const result = forgotPasswordConfirmSchema.safeParse({
    token: "abc",
    newPassword: "Primary1!xx",
    password: "Fallback1!xx",
  });
  assert.ok(result.success);
  assert.equal(result.data.newPassword, "Primary1!xx");
});

test("forgotPasswordConfirmSchema fails without any password", () => {
  const result = forgotPasswordConfirmSchema.safeParse({ token: "abc" });
  assert.ok(!result.success);
});

// ── executeTradeSchema ────────────────────────────────────────────────────────

test("executeTradeSchema accepts a valid trade", () => {
  const result = executeTradeSchema.safeParse({
    symbol: "aapl",
    name: "Apple Inc",
    price: 150.5,
    quantity: 10,
    type: "stock",
    orderType: "buy",
    clientId: "client-001",
  });
  assert.ok(result.success);
  assert.equal(result.data.symbol, "AAPL");
});

test("executeTradeSchema rejects non-finite price", () => {
  const result = executeTradeSchema.safeParse({
    symbol: "BTC",
    name: "Bitcoin",
    price: Infinity,
    quantity: 1,
    type: "crypto",
    orderType: "buy",
    clientId: "c1",
  });
  assert.ok(!result.success);
});

test("executeTradeSchema rejects invalid type", () => {
  const result = executeTradeSchema.safeParse({
    symbol: "X",
    name: "X",
    price: 1,
    quantity: 1,
    type: "invalid_type",
    orderType: "buy",
    clientId: "c1",
  });
  assert.ok(!result.success);
});

test("executeTradeSchema rejects invalid orderType", () => {
  const result = executeTradeSchema.safeParse({
    symbol: "X",
    name: "X",
    price: 1,
    quantity: 1,
    type: "stock",
    orderType: "hold",
    clientId: "c1",
  });
  assert.ok(!result.success);
});

// ── tradeEstimateBatchSchema ──────────────────────────────────────────────────

test("tradeEstimateBatchSchema accepts batch of trades", () => {
  const result = tradeEstimateBatchSchema.safeParse({
    trades: [
      { symbol: "BTC", name: "Bitcoin", price: 60000, quantity: 0.5, type: "crypto", orderType: "buy" },
    ],
  });
  assert.ok(result.success);
  assert.equal(result.data.trades.length, 1);
});

test("tradeEstimateBatchSchema rejects empty array", () => {
  const result = tradeEstimateBatchSchema.safeParse({ trades: [] });
  assert.ok(!result.success);
});

// ── portfolioUpdateSchema ─────────────────────────────────────────────────────

test("portfolioUpdateSchema accepts valid update", () => {
  const result = portfolioUpdateSchema.safeParse({ price: 100, quantity: 5 });
  assert.ok(result.success);
});

test("portfolioUpdateSchema rejects negative price", () => {
  const result = portfolioUpdateSchema.safeParse({ price: -10, quantity: 5 });
  assert.ok(!result.success);
});

// ── watchlistAssetSchema ──────────────────────────────────────────────────────

test("watchlistAssetSchema accepts valid asset", () => {
  const result = watchlistAssetSchema.safeParse({
    symbol: "eth",
    name: "Ethereum",
    type: "Crypto",
  });
  assert.ok(result.success);
  assert.equal(result.data.symbol, "ETH");
  assert.equal(result.data.type, "crypto");
});

test("watchlistAssetSchema rejects empty symbol", () => {
  const result = watchlistAssetSchema.safeParse({ symbol: "", name: "X", type: "stock" });
  assert.ok(!result.success);
});

// ── workspaceDocSchema ────────────────────────────────────────────────────────

test("workspaceDocSchema accepts document field", () => {
  const result = workspaceDocSchema.safeParse({ document: { foo: "bar" } });
  assert.ok(result.success);
  assert.deepEqual(result.data.document, { foo: "bar" });
});

test("workspaceDocSchema accepts payloadJson and transforms", () => {
  const result = workspaceDocSchema.safeParse({ payloadJson: [1, 2, 3] });
  assert.ok(result.success);
  assert.deepEqual(result.data.document, [1, 2, 3]);
});

test("workspaceDocSchema rejects empty object", () => {
  const result = workspaceDocSchema.safeParse({});
  assert.ok(!result.success);
});

// ── workspaceCollectionSchema ─────────────────────────────────────────────────

test("workspaceCollectionSchema accepts items", () => {
  const result = workspaceCollectionSchema.safeParse({ items: [{ a: 1 }] });
  assert.ok(result.success);
  assert.deepEqual(result.data.items, [{ a: 1 }]);
});

test("workspaceCollectionSchema accepts itemsJson", () => {
  const result = workspaceCollectionSchema.safeParse({ itemsJson: [1, 2] });
  assert.ok(result.success);
  assert.deepEqual(result.data.items, [1, 2]);
});

test("workspaceCollectionSchema rejects missing items", () => {
  const result = workspaceCollectionSchema.safeParse({});
  assert.ok(!result.success);
});

// ── optionsCalculationSchema ──────────────────────────────────────────────────

test("optionsCalculationSchema accepts valid input", () => {
  const result = optionsCalculationSchema.safeParse({
    symbol: "btc",
    legs: [{ strike: 100 }],
    breakevens: [95],
  });
  assert.ok(result.success);
  assert.equal(result.data.symbol, "BTC");
});

// ── historyQuerySchema ────────────────────────────────────────────────────────

test("historyQuerySchema applies defaults", () => {
  const result = historyQuerySchema.safeParse({ symbol: "aapl" });
  assert.ok(result.success);
  assert.equal(result.data.interval, "1D");
  assert.equal(result.data.range, "1mo");
  assert.equal(result.data.marketType, "equity");
});

test("historyQuerySchema accepts Display intervals (4H/1D/1W/1M/3M/1Y/YTD/MAX)", () => {
  for (const iv of ["4H", "1D", "1W", "1M", "3M", "1Y", "YTD", "MAX"]) {
    const result = historyQuerySchema.safeParse({ symbol: "AAPL", interval: iv });
    assert.ok(result.success, `expected ${iv} to parse`);
    assert.equal(result.data.interval, iv);
  }
});

test("historyQuerySchema rejects invalid interval", () => {
  const result = historyQuerySchema.safeParse({ symbol: "AAPL", interval: "7d" });
  assert.ok(!result.success);
});

// ── pricesQuerySchema ─────────────────────────────────────────────────────────

test("pricesQuerySchema applies defaults", () => {
  const result = pricesQuerySchema.safeParse({});
  assert.ok(result.success);
  assert.equal(result.data.quoteType, "tradfi");
});

// ── searchQuerySchema ─────────────────────────────────────────────────────────

test("searchQuerySchema accepts valid query", () => {
  const result = searchQuerySchema.safeParse({ q: "apple", type: "tradfi" });
  assert.ok(result.success);
});

test("searchQuerySchema accepts unified and bond discovery queries", () => {
  assert.ok(searchQuerySchema.safeParse({ q: "treasury", type: "all" }).success);
  assert.ok(searchQuerySchema.safeParse({ q: "treasury", type: "bond" }).success);
});

test("searchQuerySchema rejects empty q", () => {
  const result = searchQuerySchema.safeParse({ q: "" });
  assert.ok(!result.success);
});

// ── emailRequestSchema ────────────────────────────────────────────────────────

test("emailRequestSchema accepts valid input", () => {
  const result = emailRequestSchema.safeParse({
    newEmail: "new@test.com",
    currentPassword: "password",
  });
  assert.ok(result.success);
});

// ── emailConfirmSchema ────────────────────────────────────────────────────────

test("emailConfirmSchema accepts 6-char code", () => {
  const result = emailConfirmSchema.safeParse({ verificationCode: "123456" });
  assert.ok(result.success);
});

test("emailConfirmSchema rejects wrong length", () => {
  const result = emailConfirmSchema.safeParse({ verificationCode: "12345" });
  assert.ok(!result.success);
});

// ── passwordUpdateSchema ──────────────────────────────────────────────────────

test("passwordUpdateSchema accepts valid update", () => {
  const result = passwordUpdateSchema.safeParse({
    currentPassword: "old",
    newPassword: "NewSecure1!x",
  });
  assert.ok(result.success);
});

// ── accountDeleteSchema ───────────────────────────────────────────────────────

test("accountDeleteSchema accepts valid deletion", () => {
  const result = accountDeleteSchema.safeParse({
    confirmEmail: "test@test.com",
    confirmationPhrase: "DELETE MY ACCOUNT",
  });
  assert.ok(result.success);
});

test("accountDeleteSchema rejects wrong phrase", () => {
  const result = accountDeleteSchema.safeParse({
    confirmEmail: "test@test.com",
    confirmationPhrase: "delete my account",
  });
  assert.ok(!result.success);
});

// ── planUpdateSchema ──────────────────────────────────────────────────────────

test("planUpdateSchema accepts valid plan", () => {
  const result = planUpdateSchema.safeParse({ plan: "pro", billingCycle: "yearly" });
  assert.ok(result.success);
});

test("planUpdateSchema rejects invalid plan", () => {
  const result = planUpdateSchema.safeParse({ plan: "enterprise", billingCycle: "monthly" });
  assert.ok(!result.success);
});

// ── workspaceUpdateSchema ─────────────────────────────────────────────────────

test("workspaceUpdateSchema accepts name only", () => {
  const result = workspaceUpdateSchema.safeParse({ name: "My Workspace" });
  assert.ok(result.success);
});

test("workspaceUpdateSchema accepts slug only", () => {
  const result = workspaceUpdateSchema.safeParse({ slug: "my-ws" });
  assert.ok(result.success);
});

test("workspaceUpdateSchema rejects slug with spaces", () => {
  const result = workspaceUpdateSchema.safeParse({ slug: "bad slug" });
  assert.ok(!result.success);
});

test("workspaceUpdateSchema rejects empty object", () => {
  const result = workspaceUpdateSchema.safeParse({});
  assert.ok(!result.success);
});

// ── workspaceInviteSchema ─────────────────────────────────────────────────────

test("workspaceInviteSchema defaults role to member", () => {
  const result = workspaceInviteSchema.safeParse({ email: "a@b.com" });
  assert.ok(result.success);
  assert.equal(result.data.role, "member");
});

// ── workspaceMemberRoleSchema ─────────────────────────────────────────────────

test("workspaceMemberRoleSchema accepts admin", () => {
  const result = workspaceMemberRoleSchema.safeParse({ role: "admin" });
  assert.ok(result.success);
});

test("workspaceMemberRoleSchema rejects invalid role", () => {
  const result = workspaceMemberRoleSchema.safeParse({ role: "superadmin" });
  assert.ok(!result.success);
});

// ── balanceChangeSchema ───────────────────────────────────────────────────────

test("balanceChangeSchema accepts deposit", () => {
  const result = balanceChangeSchema.safeParse({ amount: 500, type: "deposit" });
  assert.ok(result.success);
});

test("balanceChangeSchema rejects zero amount", () => {
  const result = balanceChangeSchema.safeParse({ amount: 0, type: "deposit" });
  assert.ok(!result.success);
});

test("balanceChangeSchema rejects negative amount", () => {
  const result = balanceChangeSchema.safeParse({ amount: -100, type: "withdraw" });
  assert.ok(!result.success);
});

// ── cashChangeSchema ──────────────────────────────────────────────────────────

test("cashChangeSchema defaults to USD", () => {
  const result = cashChangeSchema.safeParse({ amount: 100, type: "deposit" });
  assert.ok(result.success);
  assert.equal(result.data.currency, "USD");
});

test("cashChangeSchema uppercases currency", () => {
  const result = cashChangeSchema.safeParse({ amount: 50, type: "withdraw", currency: "eur" });
  assert.ok(result.success);
  assert.equal(result.data.currency, "EUR");
});

// ── twoFactorEnableSchema ─────────────────────────────────────────────────────

test("twoFactorEnableSchema accepts valid input", () => {
  const result = twoFactorEnableSchema.safeParse({
    method: "authenticator",
    verificationCode: "123456",
  });
  assert.ok(result.success);
});

test("twoFactorEnableSchema rejects invalid method", () => {
  const result = twoFactorEnableSchema.safeParse({
    method: "biometric",
    verificationCode: "123456",
  });
  assert.ok(!result.success);
});

// ── passkeyRegisterSchema ─────────────────────────────────────────────────────

test("passkeyRegisterSchema applies default provider", () => {
  const result = passkeyRegisterSchema.safeParse({ name: "My Key" });
  assert.ok(result.success);
  assert.equal(result.data.provider, "Platform Authenticator");
});

// ── cryptoOptionsSchema ───────────────────────────────────────────────────────

test("cryptoOptionsSchema defaults to BTC", () => {
  const result = cryptoOptionsSchema.safeParse({});
  assert.ok(result.success);
  assert.equal(result.data.currency, "BTC");
});

// ── equityOptionsQuerySchema ──────────────────────────────────────────────────

test("equityOptionsQuerySchema applies defaults", () => {
  const result = equityOptionsQuerySchema.safeParse({});
  assert.ok(result.success);
  assert.equal(result.data.underlying, "SPY");
  assert.equal(result.data.limit, 160);
});

test("equityOptionsQuerySchema coerces limit string to number", () => {
  const result = equityOptionsQuerySchema.safeParse({ limit: "50" });
  assert.ok(result.success);
  assert.equal(result.data.limit, 50);
});

// ── exchangeKeySchema ─────────────────────────────────────────────────────────

test("exchangeKeySchema normalizes exchange name", () => {
  const result = exchangeKeySchema.safeParse({
    exchange: "Coinbase Advanced",
    apiKey: "key123",
  });
  assert.ok(result.success);
  assert.equal(result.data.exchange, "coinbase_advanced");
});

test("exchangeKeySchema normalizes ampersand in name", () => {
  const result = exchangeKeySchema.safeParse({
    exchange: "  Binance  ",
    apiKey: "key",
  });
  assert.ok(result.success);
  assert.equal(result.data.exchange, "binance");
});

test("exchangeKeySchema rejects unsupported exchange", () => {
  const result = exchangeKeySchema.safeParse({
    exchange: "unknown_exchange",
    apiKey: "key",
  });
  assert.ok(!result.success);
});

test("exchangeKeySchema defaults optional fields", () => {
  const result = exchangeKeySchema.safeParse({
    exchange: "binance",
    apiKey: "key123",
  });
  assert.ok(result.success);
  assert.equal(result.data.apiSecret, undefined);
  assert.equal(result.data.extraData, undefined);
});

// ── watchlistBulkSchema ───────────────────────────────────────────────────────

test("watchlistBulkSchema accepts array of assets", () => {
  const result = watchlistBulkSchema.safeParse({
    assets: [{ symbol: "BTC", name: "Bitcoin", type: "crypto" }],
  });
  assert.ok(result.success);
  assert.equal(result.data.assets.length, 1);
});

// ── alertDispatchSchema ───────────────────────────────────────────────────────

test("alertDispatchSchema applies defaults", () => {
  const result = alertDispatchSchema.safeParse({
    title: "Price Alert",
    body: "BTC dropped below $60k",
  });
  assert.ok(result.success);
  assert.equal(result.data.type, "market");
  assert.equal(result.data.severity, "review");
});

// ── validate middleware ───────────────────────────────────────────────────────

test("validate middleware sets parsed data on req[source]", (t, done) => {
  const middleware = validate(signinSchema);
  const req = { body: { email: "Test@X.com", password: "pass" } };
  const res = {
    status: () => res,
    json: () => {},
  };
  middleware(req, res, () => {
    assert.equal(req.body.email, "test@x.com");
    done();
  });
});

test("validate middleware calls next(error) on parse failure (Zod 4 issues API)", (t, done) => {
  const middleware = validate(signinSchema);
  const req = { body: { email: "bad", password: "" } };
  const res = {
    status: () => res,
    json: () => {},
  };
  middleware(req, res, (err) => {
    assert.ok(err instanceof Error);
    done();
  });
});

test("validate middleware reads from query when source is query", (t, done) => {
  const middleware = validate(searchQuerySchema, "query");
  const req = { query: { q: "test" } };
  const res = { status: () => res, json: () => {} };
  middleware(req, res, () => {
    assert.equal(req.query.q, "test");
    assert.equal(req.query.type, "tradfi");
    done();
  });
});
