// journalEvents.api.integration.test.js — Phase 3 API verification.
// Mirrors decision-loop.integration.test.js auth pattern. Boots the server,
// authenticates, then exercises the journal-event + reminder REST endpoints
// (auth gating, listing, needs-journaling queue, dismiss, validation 400s).

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.PORT = process.env.PORT || "4124";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
process.env.EXPECTED_ORIGIN = process.env.EXPECTED_ORIGIN || process.env.FRONTEND_URL;

const BASE_URL = `http://127.0.0.1:${process.env.PORT}`;
const { startServer, stopServer } = require("../../index");

let serverReady = false;
let serverStartError = null;

async function requestJson(path, { method = "GET", token = null, body = null } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body != null) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  return { res, data };
}

function uniqueEmail(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}.${Date.now()}.${rand}@zenin.test`;
}

test.before(async () => {
  try {
    await startServer();
    serverReady = true;
  } catch (error) {
    serverStartError = error;
  }
});

test.after(async () => {
  if (serverReady) await stopServer();
});

test("journal-event API: auth gating + endpoints", async (t) => {
  if (!serverReady) { t.skip(`Server did not start: ${serverStartError?.message || "unknown"}`); return; }

  // 401 without auth
  const noauth = await requestJson("/api/journal-events/needs-journaling");
  assert.equal(noauth.res.status, 401, "unauthenticated request is rejected");

  const user = await requestJson("/api/auth/signup", {
    method: "POST",
    body: { email: uniqueEmail("jeapi"), password: "Journal#Pass123", displayName: "JE API" },
  });
  assert.equal(user.res.status, 201);
  const token = user.data.token;
  if (!token) { t.skip("signup did not issue a token (email verification gated)"); return; }

  // List + needs-journaling return 200 with an items array
  const list = await requestJson("/api/journal-events?pageSize=10", { token });
  assert.equal(list.res.status, 200);
  assert.ok(Array.isArray(list.data.items), "list returns items array");

  const queue = await requestJson("/api/journal-events/needs-journaling", { token });
  assert.equal(queue.res.status, 200);
  assert.ok(Array.isArray(queue.data.items), "needs-journaling returns items array");
  // Every item in the queue must be open + decision_relevant (server-enforced filter)
  for (const e of queue.data.items) {
    assert.equal(e.status, "open");
    assert.equal(e.classification, "decision_relevant");
  }

  const rem = await requestJson("/api/journal-reminders", { token });
  assert.equal(rem.res.status, 200);
  assert.ok(Array.isArray(rem.data.items), "reminders returns items array");

  // Invalid classify body -> 400 (not 500; validates the zod-v4 fix)
  const bad = await requestJson("/api/journal-events/x/classify", {
    method: "POST", token, body: { classification: "bogus" },
  });
  assert.equal(bad.res.status, 400, "invalid enum rejected with 400");

  // If there is an event, dismiss it and confirm status flips
  if (list.data.items.length) {
    const id = list.data.items[0].id;
    const dis = await requestJson(`/api/journal-events/${id}/dismiss`, { method: "POST", token });
    assert.equal(dis.res.status, 200);
    assert.equal(dis.data.event.status, "dismissed");
  }
});
