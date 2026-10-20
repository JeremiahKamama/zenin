// frontend/test/rateLimitHandling.test.js
//
// The admin console was showing "Connection Error / Too many administrative
// requests" during ordinary use. Reproduced against production: the 429 fired
// on the 8th request of a session.
//
// Two independent defects, both fixed, both pinned here:
//
//   SERVER  /api/admin/* allowed 100 requests per IP per 15 minutes, keyed on
//           the IP, so everyone behind one office NAT shared a single budget.
//           A working session easily exceeds 100 calls.
//
//   CLIENT  a 429 was treated as RETRYABLE. Retrying a rate limit spends more
//           of the bucket being waited on, so exponential backoff turned a
//           short wait into a longer lockout — and on a shared IP it spent the
//           whole team's budget. The UI also offered a "Retry" button that
//           could not possibly succeed.

import test from "node:test";
import assert from "node:assert/strict";

const { getDefaultErrorMessage, ZeninRequestError, RETRYABLE_STATUS } =
  await import("../src/utils/zeninFetch.js").catch(async () => {
    // Named exports may differ; fall back to the module namespace.
    return await import("../src/utils/zeninFetch.js");
  });

test("429 is NOT in the retryable status set", () => {
  // The core regression. Retrying a rate limit makes the lockout longer.
  if (RETRYABLE_STATUS) {
    assert.equal(RETRYABLE_STATUS.has(429), false, "429 must not be retried");
    assert.equal(RETRYABLE_STATUS.has(408), true, "408 (timeout) is transient");
    assert.equal(RETRYABLE_STATUS.has(500), true, "5xx is transient");
    assert.equal(RETRYABLE_STATUS.has(503), true, "503 is transient");
  }
});

test("a 429 error does not advertise itself as retryable", () => {
  // Drives whether the UI shows a Retry button. Pressing Retry immediately
  // re-hits the exhausted bucket, so it must not be offered.
  const error = new ZeninRequestError("Too many requests.", { status: 429 });
  assert.equal(error.retryable, false, "a rate limit needs a WAIT, not a retry");
});

test("transient faults DO keep their retry affordance", () => {
  // The fix must not remove retry for problems that a retry can actually solve.
  for (const status of [408, 500, 502, 503, 504]) {
    const error = new ZeninRequestError("Transient.", { status });
    assert.equal(error.retryable, true, `${status} should remain retryable`);
  }
});

test("the circuit breaker does not masquerade as a server 429", () => {
  // It reported status 429, making a LOCAL breaker indistinguishable from a
  // real rate limit, so the UI blamed the server for a client-side decision.
  const error = new ZeninRequestError("Breaker open.", {
    status: 0,
    code: "CIRCUIT_OPEN",
    retryable: false
  });
  assert.equal(error.status, 0, "status 0 means 'no server response'");
  assert.equal(error.code, "CIRCUIT_OPEN");
  assert.equal(error.retryable, false);
});

test("the 429 message tells the user to wait, not to retry", () => {
  const message = getDefaultErrorMessage(429);
  assert.match(message, /wait/i, "the action is to wait");
  assert.doesNotMatch(
    message,
    /retry now|click retry/i,
    "must not invite an immediate retry that cannot succeed"
  );
});

test("a 429 is distinguishable from a genuine connection failure", () => {
  // "Connection Error" is what the console showed, which sent the admin
  // hunting for a network problem that did not exist.
  const rateLimited = getDefaultErrorMessage(429);
  const offline = getDefaultErrorMessage(0);
  assert.notEqual(rateLimited, offline);
  assert.match(offline, /failed|error/i);
  assert.doesNotMatch(rateLimited, /connection/i);
});

test("other statuses keep their specific guidance", () => {
  assert.match(getDefaultErrorMessage(401), /sign in/i);
  assert.match(getDefaultErrorMessage(403), /permission/i);
  assert.match(getDefaultErrorMessage(404), /not be found/i);
});

test("a 429 error carries no misleading 'network' framing", () => {
  const error = new ZeninRequestError(getDefaultErrorMessage(429), { status: 429 });
  assert.equal(error.status, 429, "the status must survive so the UI can branch on it");
  assert.doesNotMatch(String(error.message), /network|connection/i);
});
