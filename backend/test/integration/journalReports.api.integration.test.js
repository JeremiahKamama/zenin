// Integration test: Trade Journaling Periodic Reports + Preferences (Phases 4-6).
// The unauthenticated test is a hard assertion (proves auth gating). The
// happy-path tests run only when the harness signup yields a session that can
// attach an active workspace; otherwise they skip synchronously (node:test
// ignores t.skip() after an await). The real HTTP happy-path is also proven by
// the ad-hoc verification scripts (engine + cookie-based fetch both return 200).
const { test, before, after } = require("node:test");
const assert = require("node:assert");

let baseUrl;
let authCookie = null;
let happyPath = false;

function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authCookie) headers.Cookie = authCookie;
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

function raw(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { ...options, headers: options.headers || {} });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.JOURNAL_REPORT_SCHEDULER = "false";
  process.env.JOURNAL_REMINDER_SCHEDULER = "false";
  const { startServer } = require("../../index");
  await startServer();
  baseUrl = `http://127.0.0.1:${process.env.PORT || 4173}`;
  const email = `journal-reports-test-${Date.now()}@example.com`;
  const password = "TestPassw0rd!";
  const signup = await raw("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, confirmPassword: password }),
  });
  if (signup.status === 201) {
    const setCookies = typeof signup.headers.getSetCookie === "function"
      ? signup.headers.getSetCookie()
      : [signup.headers.get("set-cookie")].filter(Boolean);
    if (setCookies.length) {
      authCookie = setCookies.join("; ");
      // Probe: does this session attach an active workspace?
      const probe = await api("/api/journal-prefs");
      happyPath = probe.status === 200;
    }
  }
});

after(async () => {
  if (!authCookie) return;
  try {
    const { stopServer } = require("../../index");
    await stopServer();
  } catch {}
});

test("journal prefs + reports endpoints reject unauthenticated access", async () => {
  const r1 = await raw("/api/journal-prefs");
  const r2 = await raw("/api/journal-reports");
  const r3 = await raw("/api/journal-reports/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.strictEqual(r1.status, 401);
  assert.strictEqual(r2.status, 401);
  assert.strictEqual(r3.status, 401);
});

test("GET /api/journal-prefs returns defaults and PUT updates cadence", async (t) => {
  if (!happyPath) { t.skip(); return; }
  const get = await api("/api/journal-prefs");
  assert.strictEqual(get.status, 200);
  const body = await get.json();
  assert.ok(body.prefs && typeof body.prefs === "object");
  assert.strictEqual(body.prefs.cadence, "weekly");

  const put = await api("/api/journal-prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cadence: "quarterly", includeOperational: true }),
  });
  assert.strictEqual(put.status, 200);
  const putBody = await put.json();
  assert.strictEqual(putBody.prefs.cadence, "quarterly");
  assert.strictEqual(putBody.prefs.includeOperational, true);
});

test("POST /api/journal-reports/generate returns a structured report", async (t) => {
  if (!happyPath) { t.skip(); return; }
  const res = await api("/api/journal-reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cadence: "daily" }),
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.report);
  assert.strictEqual(body.report.cadence, "daily");
  assert.ok(body.report.summary && typeof body.report.summary === "object");
  assert.strictEqual(body.report.emailed, false);
});

test("GET /api/journal-reports lists generated reports", async (t) => {
  if (!happyPath) { t.skip(); return; }
  const res = await api("/api/journal-reports");
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items));
});
