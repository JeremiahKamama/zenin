// backend/test/unit/webauthnChallengeStore.test.js
//
// Passkey verification used to read the challenge from a module-level
// `new Map()`. That only works on one process. The generate-options request
// writes the challenge into one instance's heap, and the verify request is a
// SEPARATE HTTP call that a load balancer may send to a different instance,
// which has never seen the challenge id — producing an intermittent
// "Authentication session expired or invalid."
//
// These tests pin the properties that make the durable store correct:
// cross-instance visibility, expiry, single-use consumption, and the
// read-without-consume behaviour the auth retry path depends on.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createWebAuthnChallengeStore } = require("../../webauthnChallenges");

/**
 * Minimal in-memory stand-in for the Postgres queries the store issues, so the
 * store's LOGIC can be tested without a database. It implements exactly the
 * statements the module uses, including DELETE ... RETURNING and the
 * `expires_at > NOW()` guard.
 */
function createFakePool() {
  const rows = new Map(); // key -> { challenge_key, challenge, user_id, expires_at }
  return {
    rows,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();

      if (/CREATE TABLE|CREATE INDEX/i.test(text)) return { rows: [] };

      if (/^INSERT INTO webauthn_challenges/i.test(text)) {
        const [key, challenge, userId, expiresAt] = params;
        rows.set(key, {
          challenge_key: key,
          challenge,
          user_id: userId,
          expires_at: expiresAt
        });
        return { rows: [] };
      }

      if (/^DELETE FROM webauthn_challenges WHERE challenge_key = \$1 AND expires_at > NOW\(\)/i.test(text)) {
        const [key] = params;
        const row = rows.get(key);
        if (!row) return { rows: [] };
        if (row.expires_at.getTime() <= Date.now()) return { rows: [] };
        rows.delete(key); // atomic consume
        return { rows: [{ challenge: row.challenge, user_id: row.user_id }] };
      }

      if (/^SELECT challenge, user_id FROM webauthn_challenges/i.test(text)) {
        const [key] = params;
        const row = rows.get(key);
        if (!row || row.expires_at.getTime() <= Date.now()) return { rows: [] };
        return { rows: [{ challenge: row.challenge, user_id: row.user_id }] };
      }

      if (/^DELETE FROM webauthn_challenges WHERE challenge_key = \$1/i.test(text)) {
        rows.delete(params[0]);
        return { rows: [] };
      }

      if (/^DELETE FROM webauthn_challenges WHERE expires_at <= NOW\(\)/i.test(text)) {
        for (const [k, v] of rows) if (v.expires_at.getTime() <= Date.now()) rows.delete(k);
        return { rows: [] };
      }

      throw new Error(`unexpected query in fake pool: ${text.slice(0, 80)}`);
    }
  };
}

test("a challenge written by one instance is visible to another", async () => {
  // Two stores over the SAME backing table model two app instances behind a
  // load balancer. Under the old Map implementation these were separate heaps
  // and this test was impossible to pass.
  const pool = createFakePool();
  const instanceA = createWebAuthnChallengeStore(pool);
  const instanceB = createWebAuthnChallengeStore(pool);

  await instanceA.set("auth_abc", "challenge-from-A");
  const seenByB = await instanceB.peek("auth_abc");

  assert.ok(seenByB, "instance B must see the challenge instance A wrote");
  assert.equal(seenByB.challenge, "challenge-from-A");
});

test("peek does not consume, so a failed attempt can retry", async () => {
  const store = createWebAuthnChallengeStore(createFakePool());
  await store.set("auth_retry", "c1");

  const first = await store.peek("auth_retry");
  const second = await store.peek("auth_retry");

  assert.equal(first.challenge, "c1");
  assert.equal(second.challenge, "c1", "the challenge must survive a retry");
});

test("consume is single-use", async () => {
  const store = createWebAuthnChallengeStore(createFakePool());
  await store.set("reg_7", "c2", { userId: 7 });

  const consumed = await store.consume("reg_7");
  assert.equal(consumed.challenge, "c2");
  assert.equal(consumed.userId, 7);

  const again = await store.consume("reg_7");
  assert.equal(again, null, "a consumed challenge must not verify twice");
});

test("concurrent consumes yield exactly one winner", async () => {
  // The replay guard. A SELECT-then-DELETE implementation would let both
  // pass; the delete itself has to be the lock.
  const store = createWebAuthnChallengeStore(createFakePool());
  await store.set("auth_race", "c3");

  const results = await Promise.all([
    store.consume("auth_race"),
    store.consume("auth_race"),
    store.consume("auth_race")
  ]);

  const winners = results.filter(Boolean);
  assert.equal(winners.length, 1, "exactly one consumer may win");
});

test("an expired challenge is not returned", async () => {
  const store = createWebAuthnChallengeStore(createFakePool());
  await store.set("auth_old", "c4", { ttlMs: -1 }); // already in the past

  assert.equal(await store.peek("auth_old"), null);
  assert.equal(await store.consume("auth_old"), null);
});

test("setting the same key twice replaces the challenge", async () => {
  // Registering a second passkey reuses reg_<userId>; a stale row must not
  // block the new attempt.
  const store = createWebAuthnChallengeStore(createFakePool());
  await store.set("reg_9", "old", { userId: 9 });
  await store.set("reg_9", "new", { userId: 9 });

  const current = await store.peek("reg_9");
  assert.equal(current.challenge, "new");
});

test("sweep removes expired rows and keeps live ones", async () => {
  const pool = createFakePool();
  const store = createWebAuthnChallengeStore(pool);
  await store.set("live", "c5", { ttlMs: 60_000 });
  await store.set("dead", "c6", { ttlMs: -1 });

  await store.sweep();

  assert.ok(pool.rows.has("live"));
  assert.equal(pool.rows.has("dead"), false);
});

test("a sweep failure never throws into the request path", async () => {
  const store = createWebAuthnChallengeStore({
    async query() {
      throw new Error("database is on fire");
    }
  });
  await assert.doesNotReject(() => store.sweep());
});

test("the challenge TTL allows a real device prompt to complete", async () => {
  // The old TTL was 2 minutes. A user registering a passkey on a phone has to
  // unlock with biometrics, and a platform prompt alone can occupy most of
  // that window — timeouts were being reported as "session expired".
  const { CHALLENGE_TTL_MS } = require("../../webauthnChallenges");
  assert.ok(
    CHALLENGE_TTL_MS >= 5 * 60 * 1000,
    `challenge TTL is ${CHALLENGE_TTL_MS}ms; needs to be at least 5 minutes`
  );
});
