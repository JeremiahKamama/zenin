/**
 * Sentry Integration — Unit Tests
 * ===============================
 *
 * Verifies the privacy guarantees and no-op behavior of the backend Sentry
 * module WITHOUT sending real events to Sentry. The module reads its DSN from
 * the environment at require time, so these tests assert behavior against the
 * unconfigured (no-DSN) path and exercise the sanitizer directly.
 *
 * Run: npm test
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// Require fresh so SENTRY_BACKEND_DSN is unset (the default test env).
const sentry = require("../../sentry");
const { sanitizeValue, sanitizePrimitive, IS_CONFIGURED } = sentry;

// ── No-op behavior (no SENTRY_BACKEND_DSN) ──────────────────────────────────

test("IS_CONFIGURED is false without SENTRY_BACKEND_DSN", () => {
  assert.equal(IS_CONFIGURED, false);
});

test("initSentry is a safe no-op without DSN", () => {
  assert.doesNotThrow(() => sentry.initSentry());
});

test("captureException does not throw when unconfigured", () => {
  assert.doesNotThrow(() => sentry.captureException(new Error("boom")));
  assert.doesNotThrow(() => sentry.captureException("string error"));
  assert.doesNotThrow(() => sentry.captureException(null));
});

test("addBreadcrumb does not throw when unconfigured", () => {
  assert.doesNotThrow(() => sentry.addBreadcrumb({ message: "x" }));
  assert.doesNotThrow(() => sentry.addBreadcrumb(null));
});

test("setUser does not throw when unconfigured", () => {
  assert.doesNotThrow(() => sentry.setUser({ id: "1" }));
  assert.doesNotThrow(() => sentry.setUser(null));
});

test("withSpan resolves to the wrapped value when unconfigured", async () => {
  const result = await sentry.withSpan({ op: "test", name: "t" }, async () => 42);
  assert.equal(result, 42);
});

test("withSpan propagates errors when unconfigured", async () => {
  await assert.rejects(
    () => sentry.withSpan({ op: "test", name: "t" }, async () => { throw new Error("fail"); }),
    /fail/
  );
});

test("close resolves when unconfigured", async () => {
  await assert.doesNotReject(() => sentry.close(1000));
});

test("logToSentry does not throw at any level when unconfigured", () => {
  assert.doesNotThrow(() => sentry.logToSentry("error", "msg", { error: new Error("e") }));
  assert.doesNotThrow(() => sentry.logToSentry("fatal", "msg"));
  assert.doesNotThrow(() => sentry.logToSentry("warning", "msg"));
  assert.doesNotThrow(() => sentry.logToSentry("info", "msg"));
  assert.doesNotThrow(() => sentry.logToSentry("debug", "msg"));
});

// ── Privacy sanitizer: sensitive keys ───────────────────────────────────────

test("sanitizeValue redacts password keys", () => {
  const out = sanitizeValue({ password: "hunter2", user: "bob" });
  assert.equal(out.password, "[Filtered]");
  assert.equal(out.user, "bob");
});

test("sanitizeValue redacts token keys", () => {
  const out = sanitizeValue({ accessToken: "abc", refreshToken: "def" });
  assert.equal(out.accessToken, "[Filtered]");
  assert.equal(out.refreshToken, "[Filtered]");
});

test("sanitizeValue redacts authorization headers", () => {
  const out = sanitizeValue({ authorization: "Bearer x", accept: "*/*" });
  assert.equal(out.authorization, "[Filtered]");
  assert.equal(out.accept, "*/*");
});

test("sanitizeValue redacts cookie keys", () => {
  const out = sanitizeValue({ cookie: "session=abc", theme: "dark" });
  assert.equal(out.cookie, "[Filtered]");
  assert.equal(out.theme, "dark");
});

test("sanitizeValue redacts apiKey / api_key keys", () => {
  const out = sanitizeValue({ apiKey: "k1", api_key: "k2", name: "ok" });
  assert.equal(out.apiKey, "[Filtered]");
  assert.equal(out.api_key, "[Filtered]");
  assert.equal(out.name, "ok");
});

test("sanitizeValue redacts secret / credentials keys", () => {
  const out = sanitizeValue({
    clientSecret: "s",
    consumerKey: "k",
    snaptrade_secret: "x",
    credentials: { password: "p" }
  });
  assert.equal(out.clientSecret, "[Filtered]");
  assert.equal(out.consumerKey, "[Filtered]");
  assert.equal(out.snaptrade_secret, "[Filtered]");
  assert.equal(out.credentials, "[Filtered]");
});

test("sanitizeValue recurses into nested objects", () => {
  const out = sanitizeValue({
    outer: { inner: { token: "deep", safe: 1 } },
    list: [{ apiKey: "k" }, { ok: true }]
  });
  assert.equal(out.outer.inner.token, "[Filtered]");
  assert.equal(out.outer.inner.safe, 1);
  assert.equal(out.list[0].apiKey, "[Filtered]");
  assert.equal(out.list[1].ok, true);
});

test("sanitizeValue redacts private_key and bearer keys", () => {
  const out = sanitizeValue({ privateKey: "-----BEGIN...", bearer: "xyz" });
  assert.equal(out.privateKey, "[Filtered]");
  assert.equal(out.bearer, "[Filtered]");
});

// ── Privacy sanitizer: sensitive values in strings ─────────────────────────

test("sanitizePrimitive redacts Postgres connection strings", () => {
  const out = sanitizePrimitive("postgres://user:pass@host:5432/db");
  assert.equal(out, "postgres://[Filtered]@host:5432/db");
  assert.ok(!out.includes("pass"), "password must not survive redaction");
});

test("sanitizePrimitive redacts HTTP basic auth in URLs", () => {
  const out = sanitizePrimitive("https://alice:s3cret@api.example.com/x");
  assert.equal(out, "https://[Filtered]@api.example.com/x");
  assert.ok(!out.includes("s3cret"));
});

test("sanitizePrimitive redacts Bearer tokens", () => {
  const out = sanitizePrimitive("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig");
  assert.ok(out.includes("[Filtered]"));
  assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9.payload.sig"));
});

test("sanitizePrimitive redacts Stripe whsec_ secrets", () => {
  const out = sanitizePrimitive("webhook secret: whsec_abc123def456ghi789");
  assert.ok(out.includes("[Filtered]"));
  assert.ok(!out.includes("whsec_abc123def456ghi789"));
});

test("sanitizePrimitive redacts JWT tokens", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk";
  const out = sanitizePrimitive(`token=${jwt}`);
  assert.ok(out.includes("[Filtered]"));
  assert.ok(!out.includes(jwt), "full JWT must not survive redaction");
});

test("sanitizePrimitive redacts Resend / SendGrid API keys", () => {
  const out1 = sanitizePrimitive("key: re_abc123def456ghijklmnopqrstuv");
  assert.ok(out1.includes("[Filtered]"));
  assert.ok(!out1.includes("re_abc123def456ghijklmnopqrstuv"));

  const out2 = sanitizePrimitive("SG.abcdefghijklmnopqrstuvwx");
  assert.ok(out2.includes("[Filtered]"));
});

test("sanitizePrimitive leaves ordinary strings untouched", () => {
  assert.equal(sanitizePrimitive("hello world"), "hello world");
  assert.equal(sanitizePrimitive("user@example.com"), "user@example.com");
  assert.equal(sanitizePrimitive("GET /api/quote"), "GET /api/quote");
});

test("sanitizePrimitive passes through non-strings unchanged", () => {
  assert.equal(sanitizePrimitive(42), 42);
  assert.equal(sanitizePrimitive(null), null);
  assert.equal(sanitizePrimitive(true), true);
  assert.equal(sanitizePrimitive(undefined), undefined);
});

// ── Edge cases ───────────────────────────────────────────────────────────────

test("sanitizeValue handles circular references", () => {
  const obj = { name: "x" };
  obj.self = obj;
  const out = sanitizeValue(obj);
  assert.equal(out.name, "x");
  assert.equal(out.self, "[Circular]");
});

test("sanitizeValue bounds large arrays and objects", () => {
  const largeArr = Array.from({ length: 500 }, (_, i) => i);
  const out = sanitizeValue(largeArr);
  assert.equal(out.length, 200, "array truncated to 200 entries");

  const largeObj = {};
  for (let i = 0; i < 300; i++) largeObj[`k${i}`] = i;
  const outObj = sanitizeValue(largeObj);
  assert.ok(Object.keys(outObj).length <= 201, "object bounded at ~200 keys");
});

test("sanitizeValue preserves primitive values inside containers", () => {
  const out = sanitizeValue({ n: 42, b: true, s: "ok", nil: null });
  assert.equal(out.n, 42);
  assert.equal(out.b, true);
  assert.equal(out.s, "ok");
  assert.equal(out.nil, null);
});
