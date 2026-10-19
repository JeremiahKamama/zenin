// frontend/test/abortNoise.test.js
// Regression tests for the "alot of AbortErrors" production console noise.
//
// Two distinct causes, both the CLIENT aborting its OWN requests:
//
//  1. `AbortError: request-timeout` — fire-and-forget loaders
//     (refreshWorkspaceNotifications, loadWorkspaceSettings) are invoked from
//     many call sites as `void loader()`. If the loader rejects, nobody is
//     attached to catch it, so the browser reports an unhandled rejection and
//     prints a stack trace to the console.
//
//  2. `AbortError: signal is aborted without reason` — effects clean up with
//     `return () => controller.abort()`. When a dependency changes, React
//     aborts the in-flight request; with no abort reason and no catch, the
//     rejection escapes the same way.
//
// Both are fixed by the same contract: an aborted request is a NORMAL
// outcome, not an error. These tests assert that (a) the aborted rejection is
// recognisable, and (b) it never surfaces as an unhandled rejection.
//
// Run: node --import ./test/loader.mjs --test test/abortNoise.test.js

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

globalThis.__ZENIN_TEST_ENV__ = { VITE_ZENIN_API_BASE_URL: "" };

const { zeninFetch, isAbortError } = await import("../src/utils/zeninFetch.js");

/** Server that accepts a request then never responds, so we can abort it. */
function startHangingServer() {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = http.createServer(() => {
      /* never respond */
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(done);
          })
      });
    });
  });
}

test("isAbortError recognises every abort shape the app produces", () => {
  // Caller-supplied signal with no reason -> "signal is aborted without reason"
  assert.equal(isAbortError(new DOMException("signal is aborted without reason", "AbortError")), true);
  // Our own timeout reason.
  assert.equal(isAbortError(new DOMException("request-timeout", "AbortError")), true);
  // A string abort reason (surfaced raw by some engines).
  assert.equal(isAbortError("request-timeout"), true);
  // A plain Error named AbortError (older engines).
  const named = new Error("aborted");
  named.name = "AbortError";
  assert.equal(isAbortError(named), true);

  // Real errors must NOT be swallowed.
  assert.equal(isAbortError(new Error("boom")), false);
  assert.equal(isAbortError(null), false);
  assert.equal(isAbortError(undefined), false);
  assert.equal(isAbortError(0), false);
});

test("an externally-aborted request rejects with an abort-shaped error", async () => {
  const server = await startHangingServer();
  try {
    const controller = new AbortController();
    const promise = zeninFetch(`${server.url}/api/hang`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);

    let thrown = null;
    try {
      await promise;
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, "expected the request to reject once aborted");
    assert.equal(
      isAbortError(thrown),
      true,
      `aborted request must be recognisable as an abort, got: ${thrown?.name}: ${thrown?.message}`
    );
  } finally {
    await server.close();
  }
});

test("an in-flight request aborted by effect cleanup does not become an unhandled rejection", async () => {
  const server = await startHangingServer();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);

  try {
    // Simulate the effect pattern: start the request, then run cleanup which
    // aborts it — exactly what `return () => controller.abort()` does when a
    // dependency changes mid-flight.
    const controller = new AbortController();
    const guarded = zeninFetch(`${server.url}/api/hang`, { signal: controller.signal }).catch((error) => {
      // The fix: callers that start a request and may be torn down attach this
      // guard, so an abort resolves quietly instead of escaping.
      if (isAbortError(error)) return null;
      throw error;
    });

    controller.abort();
    const result = await guarded;
    assert.equal(result, null, "an aborted request should resolve to null through the guard");

    // Give the microtask/macrotask queues a chance to surface a stray rejection.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(unhandled, [], `no unhandled rejections expected, saw: ${unhandled.map(String).join(", ")}`);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await server.close();
  }
});

test("an unguarded abort IS reported as an unhandled rejection (proves the test is meaningful)", async () => {
  const server = await startHangingServer();
  const unhandled = [];

  try {
    // Deliberately reproduce the pre-fix bug: no guard attached. We attach our
    // own rejection observer rather than relying on a process-level handler,
    // because node's test runner installs its own and would fail this control.
    const controller = new AbortController();
    const unguarded = zeninFetch(`${server.url}/api/hang`, { signal: controller.signal });
    // Observe the rejection the way a browser console would.
    unguarded.then(
      () => unhandled.push("resolved-unexpectedly"),
      (reason) => unhandled.push(reason)
    );
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(unhandled.length, 1, "the unguarded abort should reject");
    assert.equal(
      isAbortError(unguarded && unhandled[0]),
      true,
      "the surfaced rejection should be the abort"
    );
  } finally {
    await server.close();
  }
});
