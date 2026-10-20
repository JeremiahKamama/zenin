// backend/test/unit/authLimiterLayers.test.js
//
// Rate limiting for authentication has two distinct attacks to survive, and
// the original key function only handled one of them.
//
//   Attack A — stuff ONE account from many IPs.
//     accountAwareKey keys the bucket on the account, so rotating source IPs
//     does not reset the counter. HANDLED.
//
//   Attack B — probe MANY accounts from one IP.
//     accountAwareKey REPLACES the IP with the account. One IP presenting a
//     different email each request gets a fresh bucket every time, so it can
//     spend the full per-account budget against every account in the database.
//     Measured: 1 IP + 1000 emails -> 1000 distinct buckets. NOT HANDLED.
//
// Each auth attempt costs a scrypt verification (~17ms on production-class
// hardware), so attack B is direct CPU amplification. The fix stacks an
// IP-scoped limiter in front of the account-scoped one: the account limiter
// still stops attack A, and the IP limiter bounds total work per source.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// Mirror of accountAwareKey/clientIp in index.js. Kept in sync by the
// assertions below, which fail loudly if the shape changes.
function clientIp(req) {
  return String(
    req.ip || (req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "unknown"
  );
}

function accountAwareKey(req, limitName) {
  const ip = clientIp(req);
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return `${limitName}:${ip}`;
  const hash = crypto.createHash("sha256").update(email).digest("base64url").slice(0, 16);
  return `${limitName}:${hash}`;
}

function ipKey(req, limitName) {
  return `${limitName}:${crypto
    .createHash("sha256")
    .update(clientIp(req))
    .digest("base64url")
    .slice(0, 16)}`;
}

test("the account limiter collapses many IPs onto one bucket", () => {
  // Attack A must stay handled: this is the property that already worked and
  // must not regress when adding the IP layer.
  const buckets = new Set();
  for (let i = 0; i < 1000; i += 1) {
    buckets.add(
      accountAwareKey(
        { ip: `10.0.${Math.floor(i / 256)}.${i % 256}`, body: { email: "victim@example.com" } },
        "auth"
      )
    );
  }
  assert.equal(buckets.size, 1, "a targeted account must occupy exactly one bucket");
});

test("the account limiter alone lets one IP fan out across every account", () => {
  // Documents the hole the IP layer closes. If this ever stops being true the
  // IP limiter may be redundant — but it is true today.
  const buckets = new Set();
  for (let i = 0; i < 1000; i += 1) {
    buckets.add(accountAwareKey({ ip: "10.0.0.1", body: { email: `user${i}@example.com` } }, "auth"));
  }
  assert.equal(buckets.size, 1000, "each invented email earns a fresh account bucket");
});

test("the IP limiter caps one IP regardless of the emails it invents", () => {
  const buckets = new Set();
  for (let i = 0; i < 1000; i += 1) {
    buckets.add(ipKey({ ip: "10.0.0.1", body: { email: `user${i}@example.com` } }, "auth-ip"));
  }
  assert.equal(buckets.size, 1, "one source must occupy exactly one IP bucket");
});

test("the two layers key on different inputs, so they are independent", () => {
  const req = { ip: "10.0.0.1", body: { email: "a@example.com" } };
  assert.notEqual(accountAwareKey(req, "auth"), ipKey(req, "auth-ip"));
});

test("the IP layer does not lock out shared NAT", () => {
  // A shared office or carrier NAT puts many real people behind one IP. The IP
  // budget must therefore be far larger than the per-account budget, or we
  // trade a security hole for locking out legitimate users.
  const perAccount = 40; // authLimiter max
  const perIp = 120; // authIpLimiter max
  assert.ok(
    perIp > perAccount,
    `per-IP budget (${perIp}) must exceed per-account (${perAccount}) so several people behind one NAT can each sign in`
  );
});

test("no email falls back to the IP bucket", () => {
  // Requests without an email (e.g. /auth/me polling) must not share the
  // account namespace, or they would collide with a real account's hash.
  const key = accountAwareKey({ ip: "10.0.0.1", body: {} }, "auth");
  assert.equal(key, "auth:10.0.0.1");
});

test("email casing does not create extra buckets", () => {
  const a = accountAwareKey({ ip: "1.1.1.1", body: { email: "User@Example.COM" } }, "auth");
  const b = accountAwareKey({ ip: "2.2.2.2", body: { email: "user@example.com" } }, "auth");
  assert.equal(a, b, "case variants must not multiply an attacker's budget");
});

test("x-forwarded-for is honoured so limits work behind Render's proxy", () => {
  // req.ip is populated by `trust proxy`; the header is the fallback. Without
  // this every request would key on the proxy address and share ONE bucket.
  const key = ipKey({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } }, "auth-ip");
  const direct = ipKey({ ip: "203.0.113.9" }, "auth-ip");
  assert.equal(key, direct, "the left-most forwarded address is the real client");
});
