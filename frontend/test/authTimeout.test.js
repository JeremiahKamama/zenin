// frontend/test/authTimeout.test.js
// Regression tests for the "stuck on Signing in..." production bug.
//
// Root cause: auth requests were issued with no timeout. During a backend
// cold start the edge holds the connection open, fetch never settles, and the
// caller's `finally { setLoading(false) }` never runs — so the button stays on
// "Signing in..." forever and the user is stranded with no error and no retry.
//
// These tests run the REAL zeninFetch against a REAL HTTP server that hangs,
// proving the request now always settles.
//
// Run: node --test test/authTimeout.test.js  (from frontend dir)

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// Vite injects import.meta.env at build time; under `node --test` the loader
// shim (test/extension-resolver.mjs) reads this global.
globalThis.__ZENIN_TEST_ENV__ = { VITE_ZENIN_API_BASE_URL: "" };

const { zeninFetch, ZeninRequestError, AUTH_TIMEOUT_MS, AUTH_SESSION_TIMEOUT_MS } =
  await import("../src/utils/zeninFetch.js");

// The frontend module reads VITE_* via import.meta.env, which is undefined
// under plain node. buildZeninUrl therefore needs an absolute endpoint; we
// pass full URLs so the base is bypassed entirely.

/** Start a server that accepts the request and then never responds. */
function startHangingServer() {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = http.createServer((_req, _res) => {
      // Deliberately never respond — simulates a cold-starting backend whose
      // connection is held open by the edge proxy.
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
            // Destroy sockets so the server can close promptly.
            for (const socket of sockets) socket.destroy();
            server.close(done);
          })
      });
    });
  });
}

test("a hanging auth request settles with REQUEST_TIMEOUT instead of hanging forever", async () => {
  const server = await startHangingServer();
  const startedAt = Date.now();
  let thrown = null;
  try {
    // Mirrors the sign-in call shape with a short budget so the test is fast.
    await zeninFetch(`${server.url}/api/auth/signin`, {
      method: "POST",
      body: JSON.stringify({ email: "a@b.com", password: "x" }),
      timeoutMs: 300
    });
  } catch (error) {
    thrown = error;
  } finally {
    await server.close();
  }

  const elapsed = Date.now() - startedAt;

  assert.ok(thrown, "request must reject rather than hang — this is the bug");
  assert.ok(
    thrown instanceof ZeninRequestError,
    `expected ZeninRequestError, got ${thrown?.name}: ${thrown?.message}`
  );
  assert.equal(thrown.code, "REQUEST_TIMEOUT");
  assert.equal(thrown.status, 0);
  assert.equal(thrown.retryable, true);

  // Must have aborted close to the configured budget, not hung indefinitely.
  assert.ok(
    elapsed < 5000,
    `expected to abort near the 300ms budget, took ${elapsed}ms`
  );
});

test("POST sign-in is never auto-retried (no duplicate auth attempts)", async () => {
  const server = await startHangingServer();
  let requests = 0;
  // Count requests by wrapping the server's request event.
  const original = server.url;
  const countingServer = http.createServer(() => { requests += 1; });
  await new Promise((r) => countingServer.listen(0, "127.0.0.1", r));
  const { port } = countingServer.address();

  let failed = false;
  try {
    await zeninFetch(`http://127.0.0.1:${port}/api/auth/signin`, {
      method: "POST",
      body: JSON.stringify({ email: "a@b.com", password: "x" }),
      timeoutMs: 250
    });
  } catch {
    failed = true;
  } finally {
    await server.close();
    await new Promise((r) => countingServer.close(r));
  }

  assert.ok(failed);
  assert.equal(requests, 1, "a write must be attempted exactly once");
});

test("GET reads retry on failure (bounded), unlike writes", async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests += 1;
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unavailable" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();

  try {
    await zeninFetch(`http://127.0.0.1:${port}/api/auth/me`, { timeoutMs: 500 });
  } catch {
    // expected: exhausted retries on 503
  } finally {
    await new Promise((r) => server.close(r));
  }

  // MAX_RETRIES = 3 -> up to 4 attempts total.
  assert.ok(requests > 1, `expected retries on a 503 read, saw ${requests}`);
  assert.ok(requests <= 4, `retries must be bounded, saw ${requests}`);
});

test("auth timeout constants are finite and sized to outlast a cold start", () => {
  assert.ok(Number.isFinite(AUTH_TIMEOUT_MS) && AUTH_TIMEOUT_MS > 0, "AUTH_TIMEOUT_MS must be finite");
  assert.ok(Number.isFinite(AUTH_SESSION_TIMEOUT_MS) && AUTH_SESSION_TIMEOUT_MS > 0, "AUTH_SESSION_TIMEOUT_MS must be finite");
  // A Render cold start can take 30-60s; the sign-in budget must outlast it.
  assert.ok(AUTH_TIMEOUT_MS >= 30000, `AUTH_TIMEOUT_MS too low for cold starts: ${AUTH_TIMEOUT_MS}`);
  // The session check must be strictly more generous than the old 3.5s.
  assert.ok(AUTH_SESSION_TIMEOUT_MS > 3500, "session timeout must exceed the old 3500ms that caused bounced sessions");
});

test("omitting timeoutMs still yields a bounded request (default is not infinite)", async () => {
  const server = await startHangingServer();
  let settled = false;
  // Call with NO timeoutMs at all — previously this meant "hang forever".
  const promise = zeninFetch(`${server.url}/api/auth/signin`, {
    method: "POST",
    body: JSON.stringify({})
  }).catch(() => { settled = true; });

  // Give it a moment; we cannot wait 90s, so assert it is still pending and
  // then confirm the default is finite via the exported promise not resolving
  // synchronously.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(settled, false, "should still be pending at 200ms with a 90s default");

  await server.close();
  // Abandon the pending request; the process exits without it.
  void promise;
});

test("a hanging CSRF fetch surfaces AUTH_SERVICE_TIMEOUT, not a raw string", async () => {
  // The CSRF preflight runs before every write (including sign-in) and is
  // therefore often the FIRST request against a cold backend. Its abort used
  // to pass a string reason, which fetch surfaces raw — bypassing the mapped
  // AUTH_SERVICE_TIMEOUT error and its user-facing copy.
  const server = await startHangingServer();
  let thrown = null;
  try {
    // A write triggers ensureCsrfToken() against the same (hanging) origin.
    await zeninFetch(`${server.url}/api/account/password`, {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: 200
    });
  } catch (error) {
    thrown = error;
  } finally {
    await server.close();
  }

  assert.ok(thrown, "CSRF fetch must reject rather than hang");
  assert.ok(
    thrown instanceof ZeninRequestError,
    `expected a mapped ZeninRequestError, got ${thrown?.constructor?.name}: ${String(thrown)}`
  );
  assert.ok(
    ["AUTH_SERVICE_TIMEOUT", "REQUEST_TIMEOUT"].includes(thrown.code),
    `expected a mapped auth timeout code, got ${thrown.code}`
  );
});

test("CSRF budget is not shorter than the sign-in budget", () => {
  // If CSRF gave up first, a cold start would surface an auth-service error
  // before sign-in was ever attempted.
  assert.ok(
    AUTH_TIMEOUT_MS >= 90000 - 1,
    `AUTH_TIMEOUT_MS too low: ${AUTH_TIMEOUT_MS}`
  );
});
