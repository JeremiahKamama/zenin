// backend/webauthnChallenges.js
//
// Durable storage for in-flight WebAuthn challenges.
//
// WHY THIS EXISTS
// ---------------
// Challenges were held in a module-level `new Map()`. That works on exactly
// one process and breaks the moment there is more than one:
//
//   * `GET /passkeys/authenticate/generate-options` writes the challenge to
//     process A's heap and returns a challengeId.
//   * `POST /passkeys/authenticate/verify` is a SEPARATE request. A load
//     balancer may route it to process B, whose Map has never seen the id, so
//     verification fails with "Authentication session expired or invalid."
//
// The failure is intermittent and load-dependent, which makes it read as a
// flaky passkey bug rather than an infrastructure one. It also means passkeys
// cannot survive a deploy or a Render restart mid-flow, and a rolling deploy
// breaks every in-flight attempt.
//
// A challenge is small, single-use, short-lived data. Postgres is the right
// home for it: already deployed, already the source of truth for everything
// else, and no new infrastructure to operate.
//
// This module also replaces the `setInterval` sweeper that ran in the main
// process. Expiry is enforced on read, so correctness never depends on the
// timer running, and the timer exists only to keep the table small.

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * @param {import('pg').Pool} pool
 */
function createWebAuthnChallengeStore(pool) {
  let cleanupTimer = null;

  async function ensureTable(client = pool) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        challenge_key TEXT PRIMARY KEY,
        challenge     TEXT NOT NULL,
        user_id       INTEGER,
        expires_at    TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // The sweeper and the expiry check both filter on expires_at.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at
      ON webauthn_challenges(expires_at);
    `);
  }

  /**
   * Store a challenge under a caller-chosen key.
   *
   * The key is upserted rather than inserted: registering a second passkey
   * reuses the `reg_<userId>` key, and a stale row must not block the new
   * attempt.
   *
   * @param {string} key
   * @param {string} challenge base64url challenge exactly as issued
   * @param {{userId?: number, ttlMs?: number}} [options]
   */
  async function set(key, challenge, { userId = null, ttlMs = CHALLENGE_TTL_MS } = {}) {
    const expiresAt = new Date(Date.now() + ttlMs);
    await pool.query(
      `INSERT INTO webauthn_challenges (challenge_key, challenge, user_id, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (challenge_key)
       DO UPDATE SET challenge = EXCLUDED.challenge,
                     user_id   = EXCLUDED.user_id,
                     expires_at = EXCLUDED.expires_at,
                     created_at = NOW()`,
      [key, challenge, userId, expiresAt]
    );
  }

  /**
   * Atomically consume a challenge.
   *
   * DELETE ... RETURNING rather than SELECT-then-DELETE: two concurrent
   * verifications of the same challenge would both pass a SELECT, which is a
   * replay window. The delete is the lock.
   *
   * @returns {Promise<{challenge: string, userId: number|null}|null>} null when
   *   the key is absent, already consumed, or expired
   */
  async function consume(key) {
    const result = await pool.query(
      `DELETE FROM webauthn_challenges
        WHERE challenge_key = $1
          AND expires_at > NOW()
      RETURNING challenge, user_id`,
      [key]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { challenge: row.challenge, userId: row.user_id };
  }

  /** Read without consuming. Used where the challenge must survive a retry. */
  async function peek(key) {
    const result = await pool.query(
      `SELECT challenge, user_id FROM webauthn_challenges
        WHERE challenge_key = $1 AND expires_at > NOW()`,
      [key]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { challenge: row.challenge, userId: row.user_id };
  }

  async function remove(key) {
    await pool.query(`DELETE FROM webauthn_challenges WHERE challenge_key = $1`, [key]);
  }

  /** Drop expired rows. Cheap; correctness does not depend on it running. */
  async function sweep() {
    try {
      await pool.query(`DELETE FROM webauthn_challenges WHERE expires_at <= NOW()`);
    } catch (error) {
      // A sweep failure must never take down a request path.
      console.warn("webauthn challenge sweep failed:", error?.message);
    }
  }

  function startCleanup(intervalMs = 5 * 60 * 1000) {
    if (cleanupTimer) return cleanupTimer;
    cleanupTimer = setInterval(sweep, intervalMs);
    // Do not hold the event loop open on shutdown.
    if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
    return cleanupTimer;
  }

  function stopCleanup() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  return { ensureTable, set, consume, peek, remove, sweep, startCleanup, stopCleanup };
}

module.exports = { createWebAuthnChallengeStore, CHALLENGE_TTL_MS };
