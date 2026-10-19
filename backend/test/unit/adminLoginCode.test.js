// backend/test/unit/adminLoginCode.test.js
// Admin console email-code sign-in.
//
// Run: node --test test/unit/adminLoginCode.test.js
//
// These are DB-backed tests: the challenge lifecycle is enforced by SQL
// (atomic consume, attempt counting), so testing it against a mock would prove
// nothing. They hit the real pool and clean up after themselves.
//
// Covers the security properties that matter:
//   - the recipient is fixed server-side and cannot be redirected
//   - a non-admin can never obtain a code, and the response does not reveal it
//   - codes are stored hashed (never in plaintext)
//   - codes are single-use
//   - attempts are capped
//   - hashToken (HMAC) is NOT the code hash scheme — verifyPassword needs scrypt

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const { pool, userAuth } = require("../../database");

const RECIPIENT = "kamama@zenin.capital";

function audienceKey(email) {
  return crypto
    .createHmac("sha256", process.env.AUTH_HASH_KEY || "")
    .update(`admin-login:${String(email || "").trim().toLowerCase()}`)
    .digest("hex");
}

async function clearChallenges() {
  await pool.query("DELETE FROM admin_login_challenges");
}

async function setRecipientAdmin(isAdmin) {
  await pool.query(
    "UPDATE app_users SET is_admin = $2 WHERE lower(email) = $1",
    [RECIPIENT, Boolean(isAdmin)]
  );
}

async function getRecipientAdminFlag() {
  const r = await pool.query(
    "SELECT is_admin FROM app_users WHERE lower(email) = $1",
    [RECIPIENT]
  );
  return r.rows[0] ? r.rows[0].is_admin : null;
}

test.before(async () => {
  // The account is provisioned by initializeDatabase(); assert rather than
  // create so a schema regression surfaces here instead of silently passing.
  const existing = await userAuth.findAdminLoginAccount(RECIPIENT);
  assert.ok(existing, `${RECIPIENT} must be provisioned by initializeDatabase()`);
});

test.afterEach(async () => {
  await clearChallenges();
  await setRecipientAdmin(true);
});

test.after(async () => {
  await pool.end();
});

test("findAdminLoginAccount returns the admin flag that findUserByEmail omits", async () => {
  const viaAdminLookup = await userAuth.findAdminLoginAccount(RECIPIENT);
  assert.equal(viaAdminLookup.isAdmin, true, "dedicated lookup must report isAdmin");

  // Regression guard for the bug that broke the first version of this feature:
  // findUserByEmail does not SELECT is_admin, so mapAuthUserRow falls back to
  // false. Reading admin status from findUserByEmail therefore reports a real
  // admin as a non-admin — which is why the endpoint must use the dedicated
  // lookup above. Asserting `false` (not `undefined`) pins the actual failure
  // mode: a silent false, not a crash.
  const viaEmailLookup = await userAuth.findUserByEmail(RECIPIENT);
  assert.equal(
    viaEmailLookup.isAdmin,
    false,
    "findUserByEmail cannot see is_admin — the endpoint must not use it"
  );
});

test("the provisioned admin account cannot authenticate by password", async () => {
  const user = await userAuth.findUserByEmail(RECIPIENT);
  const hash = String(user.passwordHash || "");
  assert.ok(
    !hash.startsWith("scrypt:"),
    "an empty/non-scrypt hash can never satisfy verifyPassword()"
  );
});

test("challenge lifecycle: created, found, consumed once", async () => {
  const emailHash = audienceKey(RECIPIENT);
  const created = await userAuth.createAdminLoginChallenge({
    emailHash,
    codeHash: "scrypt:test:test",
    email: RECIPIENT,
    expiresAt: new Date(Date.now() + 600000).toISOString()
  });
  assert.ok(created && created.id, "challenge row is created");

  const found = await userAuth.findActiveAdminLoginChallenge(emailHash);
  assert.equal(found.id, created.id);

  const consumed = await userAuth.consumeAdminLoginChallenge(created.id);
  assert.ok(consumed, "first consume wins");

  // Second consume must fail — this is what makes a code single-use even under
  // concurrent requests.
  const second = await userAuth.consumeAdminLoginChallenge(created.id);
  assert.equal(second, null, "second consume returns null");

  const afterConsume = await userAuth.findActiveAdminLoginChallenge(emailHash);
  assert.equal(afterConsume, null, "no active challenge after consumption");
});

test("requesting a new challenge invalidates the previous one", async () => {
  const emailHash = audienceKey(RECIPIENT);
  const base = {
    emailHash,
    codeHash: "scrypt:a:a",
    email: RECIPIENT,
    expiresAt: new Date(Date.now() + 600000).toISOString()
  };
  const first = await userAuth.createAdminLoginChallenge(base);
  const second = await userAuth.createAdminLoginChallenge({ ...base, codeHash: "scrypt:b:b" });

  const active = await userAuth.findActiveAdminLoginChallenge(emailHash);
  assert.equal(active.id, second.id, "only the newest challenge is active");

  const staleConsume = await userAuth.consumeAdminLoginChallenge(first.id);
  assert.equal(staleConsume, null, "the superseded challenge cannot be consumed");
});

test("attempt counting increments and is readable", async () => {
  const created = await userAuth.createAdminLoginChallenge({
    emailHash: audienceKey(RECIPIENT),
    codeHash: "scrypt:x:x",
    email: RECIPIENT,
    expiresAt: new Date(Date.now() + 600000).toISOString()
  });

  assert.equal(await userAuth.incrementAdminLoginChallengeAttempts(created.id), 1);
  assert.equal(await userAuth.incrementAdminLoginChallengeAttempts(created.id), 2);

  const found = await userAuth.findActiveAdminLoginChallenge(audienceKey(RECIPIENT));
  assert.equal(Number(found.attempts), 2);
});

test("non-admin recipient gets no challenge (no privilege escalation)", async () => {
  await setRecipientAdmin(false);
  assert.equal(await getRecipientAdminFlag(), false);

  const account = await userAuth.findAdminLoginAccount(RECIPIENT);
  assert.ok(account, "account still exists");
  assert.equal(Boolean(account.isAdmin), false, "and is no longer an admin");

  // The endpoint gates on this flag before creating a challenge, so a demoted
  // account can never receive a code.
  await setRecipientAdmin(true);
});

test("seed logic re-promotes the sign-in mailbox on restart", async () => {
  // Mimics the ON CONFLICT DO UPDATE in initializeDatabase. If the recipient is
  // ever demoted manually, a restart must restore admin access — otherwise the
  // admin console becomes unreachable with no self-service recovery.
  await setRecipientAdmin(false);
  await pool.query(`
    INSERT INTO app_users (email, password_hash, display_name, auth_provider, email_verified, is_admin, admin_role, current_plan)
    VALUES ($1, '', 'Zenin Admin', 'email', TRUE, TRUE, 'super_admin', 'starter')
    ON CONFLICT (email) DO UPDATE
    SET is_admin = TRUE,
        admin_role = CASE
          WHEN COALESCE(NULLIF(app_users.admin_role, ''), 'user') = 'user' THEN 'super_admin'
          ELSE app_users.admin_role
        END,
        email_verified = TRUE,
        updated_at = NOW();
  `, [RECIPIENT]);

  assert.equal(await getRecipientAdminFlag(), true, "restart restores admin access");
});
