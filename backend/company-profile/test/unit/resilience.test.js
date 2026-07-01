"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { withRetry, CircuitBreaker } = require("../../infrastructure/resilience");

test("withRetry succeeds on first attempt", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return "ok";
  });
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 1);
});

test("withRetry retries then succeeds", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) {
      const err = new Error("transient");
      err.status = 503;
      throw err;
    }
    return "ok";
  }, { maxAttempts: 3, baseDelayMs: 10 });
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 3);
});

test("withRetry does not retry non-retryable errors", async () => {
  let calls = 0;
  await assert.rejects(() => withRetry(async () => {
    calls++;
    const err = new Error("bad request");
    err.status = 400;
    throw err;
  }, { maxAttempts: 3 }), /bad request/);
  assert.strictEqual(calls, 1);
});

test("CircuitBreaker opens after threshold", async () => {
  const breaker = new CircuitBreaker({ name: "test", failureThreshold: 2, cooldownMs: 60_000 });
  let calls = 0;
  const failing = () => breaker.execute(async () => {
    calls++;
    throw new Error("boom");
  });

  await assert.rejects(failing);
  await assert.rejects(failing);
  await assert.rejects(failing, /OPEN/);
  assert.strictEqual(calls, 2);
});

test("CircuitBreaker closes after half-open successes", async () => {
  const breaker = new CircuitBreaker({ name: "test", failureThreshold: 1, cooldownMs: 10, halfOpenMaxCalls: 2 });
  await assert.rejects(() => breaker.execute(async () => { throw new Error("boom"); }));
  await new Promise((r) => setTimeout(r, 20));
  await breaker.execute(async () => "ok");
  await breaker.execute(async () => "ok");
  assert.strictEqual(breaker.state().state, "CLOSED");
});
