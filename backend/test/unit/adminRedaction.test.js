// backend/test/unit/adminRedaction.test.js
//
// Regression tests for the admin Database browser leaking credential material.
//
// The browser previewed rows with `SELECT * FROM <table>`. On `app_users` that
// returned 32 columns including password_hash, the AES-encrypted TOTP seed,
// backup-code hashes, passkey metadata and both verification-code hashes. This
// was proven against a live instance: one authenticated GET returned all six.
//
// The policy is now allowlist-based — name the columns you are willing to show —
// so a column added later is withheld until someone opts it in.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isNeverPreviewColumn,
  isMaskedColumn,
  isNeverPreviewTable,
  partitionColumns,
  redactRow
} = require("../../adminRedaction");

// The real app_users columns, as confirmed against a live database.
const APP_USER_COLUMNS = [
  "id", "email", "supabase_user_id", "password_hash", "display_name",
  "auth_provider", "email_verified", "pending_email", "pending_email_code_hash",
  "pending_email_requested_at", "password_changed_at", "two_factor_enabled",
  "two_factor_method", "two_factor_secret_hash", "two_factor_provider",
  "two_factor_target", "two_factor_enabled_at", "backup_codes_json",
  "passkeys_json", "email_verification_code_hash",
  "email_verification_requested_at", "current_plan", "current_billing_cycle",
  "plan_updated_at", "created_at", "updated_at", "failed_login_count",
  "locked_until", "is_admin", "admin_role", "active_workspace_id", "suspended_at"
];

test("every credential column on app_users is withheld", () => {
  const { previewable, withheld } = partitionColumns("app_users", APP_USER_COLUMNS);
  const mustWithhold = [
    "password_hash",
    "two_factor_secret_hash",
    "backup_codes_json",
    "passkeys_json",
    "email_verification_code_hash",
    "pending_email_code_hash"
  ];
  for (const column of mustWithhold) {
    assert.ok(withheld.includes(column), `${column} must be withheld`);
    assert.ok(!previewable.includes(column), `${column} must not be previewable`);
  }
});

test("ordinary support columns remain previewable", () => {
  const { previewable } = partitionColumns("app_users", APP_USER_COLUMNS);
  for (const column of ["id", "email", "display_name", "current_plan", "created_at", "suspended_at"]) {
    assert.ok(previewable.includes(column), `${column} should stay previewable for support`);
  }
});

test("redactRow removes withheld keys entirely rather than nulling them", () => {
  const partition = partitionColumns("app_users", APP_USER_COLUMNS);
  const redacted = redactRow("app_users", {
    id: 7,
    email: "user@example.com",
    password_hash: "scrypt:deadbeef:cafe",
    two_factor_secret_hash: "enc:aa:bb:cc",
    backup_codes_json: ["abc123"],
    passkeys_json: [{ id: "x" }],
    email_verification_code_hash: "ffff",
    pending_email_code_hash: "eeee"
  }, partition);

  assert.equal(redacted.id, 7);
  assert.equal(redacted.email, "user@example.com");
  // The key must be ABSENT (not null) so the response does not even reveal
  // whether the column is populated.
  for (const key of ["password_hash", "two_factor_secret_hash", "backup_codes_json",
    "passkeys_json", "email_verification_code_hash", "pending_email_code_hash"]) {
    assert.ok(!(key in redacted), `${key} must not appear in a preview row`);
  }
});

test("unknown columns added later are withheld by default", () => {
  // The allowlist direction matters: a new column must not leak automatically.
  const { previewable, withheld } = partitionColumns("app_users", [
    ...APP_USER_COLUMNS,
    "newly_added_oauth_refresh_token"
  ]);
  assert.ok(withheld.includes("newly_added_oauth_refresh_token"));
  assert.ok(!previewable.includes("newly_added_oauth_refresh_token"));
});

test("naming variants of secrets are caught", () => {
  for (const name of [
    "passwordHash", "hashed_password", "user_password", "passwd",
    "totp_secret", "mfa_secret", "otp_secret",
    "backup_code", "recovery_codes", "webauthn_credentials",
    "session_token", "reset_token", "api_key", "webhook_secret",
    "card_number", "cvv", "ssn", "tax_id", "iban"
  ]) {
    assert.ok(isNeverPreviewColumn(name), `${name} must be treated as credential material`);
  }
});

test("credential-bearing tables have previews withheld entirely", () => {
  for (const table of ["auth_sessions", "password_reset_tokens", "email_verification_tokens"]) {
    assert.ok(isNeverPreviewTable(table));
    const { previewable } = partitionColumns(table, ["id", "token_hash", "user_id"]);
    assert.deepEqual(previewable, [], `${table} must not be previewable`);
    assert.deepEqual(redactRow(table, { id: 1, token_hash: "abc" }, { previewable: [], withheld: [] }), {});
  }
});

test("IP and device columns are masked, not removed", () => {
  assert.ok(isMaskedColumn("ip_address"));
  assert.ok(isMaskedColumn("last_login_ip"));
  assert.ok(isMaskedColumn("user_agent"));
  const partition = partitionColumns("sessions", ["id", "ip_address", "device_id"]);
  const redacted = redactRow("sessions", {
    id: 3,
    ip_address: "203.0.113.42",
    device_id: "abcdef1234567890"
  }, partition);
  assert.equal(redacted.id, 3);
  assert.equal(redacted.ip_address, "203.x.x.x");
  // A masked value must not contain the original in full.
  assert.ok(!String(redacted.device_id).includes("abcdef1234567890"));
});

test("a valid support table previews normally", () => {
  const partition = partitionColumns("portfolios", ["id", "user_id", "name", "created_at"]);
  assert.deepEqual(partition.withheld, []);
  const redacted = redactRow("portfolios", { id: 1, user_id: 2, name: "Main" }, partition);
  assert.equal(redacted.name, "Main");
});
