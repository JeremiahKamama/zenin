// frontend/test/abortWithReason.test.js
//
// The console was flooding with:
//
//   Uncaught (in promise) AbortError: signal is aborted without reason
//
// A bare `controller.abort()` aborts with no reason, and that is exactly how
// the browser reports it. The message is unactionable and indistinguishable
// from a real fault. 27 call sites across 18 files did this on effect cleanup,
// which fires on every dependency change — every keystroke in a filtered list,
// every interval tick, every account switch.
//
// The helper is small but its edge cases matter: it runs on hot paths, and a
// throw from effect cleanup would take down the component tree.

import test from "node:test";
import assert from "node:assert/strict";

// AbortController exists natively in Node 18+.
const { abortWithReason, isAbortError } = await import("../src/utils/zeninFetch.js");

test("abortWithReason aborts the controller", () => {
  const controller = new AbortController();
  abortWithReason(controller, "effect-cleanup");
  assert.equal(controller.signal.aborted, true);
});

test("the abort carries the given reason, not 'without reason'", () => {
  // This is the whole point: the reason must be present and self-describing.
  const controller = new AbortController();
  abortWithReason(controller, "portfolio-history-cleanup");
  assert.ok(controller.signal.reason, "a reason must be attached");
  assert.equal(controller.signal.reason.name, "AbortError");
  assert.match(String(controller.signal.reason.message), /portfolio-history-cleanup/);
});

test("requests rejected by it are recognised as aborts", () => {
  // Cleanup aborts are normal outcomes. Effects must be able to swallow them
  // with isAbortError rather than logging a console error.
  const controller = new AbortController();
  abortWithReason(controller, "symbol-changed");
  assert.equal(isAbortError(controller.signal.reason), true);
});

test("a null or undefined controller is a no-op, not a crash", () => {
  // Several call sites use an optional controller:
  //   const controller = typeof AbortController !== "undefined" ? ... : null;
  // Cleanup must not throw when it is null.
  assert.doesNotThrow(() => abortWithReason(null, "x"));
  assert.doesNotThrow(() => abortWithReason(undefined, "x"));
});

test("aborting an already-aborted controller is safe and keeps the first reason", () => {
  // Dependency changes can run cleanup more than once (StrictMode double-invokes
  // effects in development). The original reason is the informative one.
  const controller = new AbortController();
  abortWithReason(controller, "first-reason");
  const first = controller.signal.reason;
  assert.doesNotThrow(() => abortWithReason(controller, "second-reason"));
  assert.equal(controller.signal.reason, first, "the first reason must be preserved");
});

test("an object without abort() does not throw", () => {
  assert.doesNotThrow(() => abortWithReason({}, "x"));
  assert.doesNotThrow(() => abortWithReason({ abort: "not a function" }, "x"));
});

test("the default reason is not empty", () => {
  const controller = new AbortController();
  abortWithReason(controller);
  assert.ok(String(controller.signal.reason?.message || "").length > 0);
});

test("reasons are distinguishable from one another", () => {
  // The value of a reason is being able to tell WHICH effect tore down a
  // request when reading the console.
  const a = new AbortController();
  const b = new AbortController();
  abortWithReason(a, "home-module-cleanup");
  abortWithReason(b, "watchlist-cleanup");
  assert.notEqual(a.signal.reason.message, b.signal.reason.message);
});

test("a real fetch rejects with the attached reason", async () => {
  // End-to-end shape check: the reason survives into the rejection a caller
  // actually handles.
  const controller = new AbortController();
  const pending = fetch("http://127.0.0.1:9/never", { signal: controller.signal })
    .catch((error) => error);
  abortWithReason(controller, "network-cleanup");
  const error = await pending;
  assert.equal(error.name, "AbortError");
  assert.equal(isAbortError(error), true);
});
