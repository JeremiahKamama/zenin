// backend/adminRedaction.js
//
// Column-level redaction for the admin Database browser.
//
// WHY THIS EXISTS
// ---------------
// `getDatabaseStats` previewed rows with `SELECT * FROM <table>`, with no column
// filtering. On `app_users` that returned 32 columns, six of which are
// authentication material an operator must never read:
//
//   password_hash                  scrypt hash — offline crackable
//   two_factor_secret_hash         AES-256-GCM TOTP seed — forges any future code
//   backup_codes_json              SHA-256 of each backup code — replayable
//   passkeys_json                  WebAuthn credential metadata
//   email_verification_code_hash   confirms a guessed emailed code offline
//   pending_email_code_hash        same, for the email-change flow
//
// It was proven against a live instance: one authenticated GET returned all six.
//
// `SELECT *` is also the wrong default for a support tool on principle — a column
// added to a table later is exposed automatically, without anyone deciding it
// should be. So the rule is: name the columns you are willing to show, and treat
// everything else as withheld until someone opts it in.
//
// WHAT THIS DOES NOT DO
// ---------------------
// This is a display-layer control, not an access-control boundary. It stops the
// dashboard from READING credential material into a response. It does not stop a
// database operator with direct SQL access, which is a separate and unavoidable
// trust boundary (see the operational note in the accompanying summary).

"use strict";

/**
 * Column names that are NEVER previewed, matched case-insensitively.
 *
 * Kept as substrings-with-suffix matching rather than an exact list so that
 * variants (`password_hash`, `passwordHash`, `hashed_password`) are covered —
 * a new column following the same naming convention is withheld by default
 * rather than leaking.
 */
const NEVER_PREVIEW_PATTERNS = [
  // Passwords and password history. `password_changed_at` is deliberately
  // EXEMPT below: it is a timestamp support genuinely uses ("when did they last
  // change it?") and revealing it does not help anyone authenticate.
  /(^|_)password(_|$)/,
  /passwd/,
  /pass_hash/,
  // Second factors and recovery material
  /two_factor_secret/,
  /totp_secret/,
  /mfa_secret/,
  /otp_secret/,
  /backup_codes?/,
  /recovery_codes?/,
  /passkeys?(_|$)/,
  /webauthn/,
  // One-time and session credentials
  /verification_code/,
  /_code_hash/,
  /reset_token/,
  /_token(_|$)/,
  /^token_hash$/,
  /session_token/,
  /csrf/,
  /api_key/,
  /secret/,
  // Financial account identifiers that are not needed for support
  /account_number/,
  /routing_number/,
  /iban/,
  /ssn/,
  /social_security/,
  /tax_id/,
  /card_number/,
  /cvv/,
  /_pin$/
];

/**
 * Columns that are shown but masked in the preview, so an operator can confirm a
 * value exists or matches a support ticket without reading the whole thing.
 */
const MASK_PATTERNS = [
  /^ip_address$/,
  /_ip$/,
  /user_agent/,
  /device_id/,
  /fingerprint/
];

/**
 * Tables whose previews are withheld entirely.
 *
 * These hold nothing an operator can act on from a grid, and paginating them is
 * an invitation to exfiltrate in bulk.
 */
const NEVER_PREVIEW_TABLES = new Set([
  "auth_sessions",
  "admin_login_challenges",
  "email_verification_tokens",
  "password_reset_tokens",
  "auth_audit_logs",
  "webauthn_challenges"
]);

/**
 * Columns that match a NEVER pattern but are safe and useful for support.
 * Checked BEFORE the deny patterns, and kept deliberately tiny.
 */
const ALLOWED_DESPITE_PATTERN = new Set([
  // A timestamp, not a credential — and a routine support question.
  "password_changed_at",
  // Counters/flags that reveal only that a control is on, never its value.
  "two_factor_enabled",
  "two_factor_method",
  "two_factor_provider",
  "two_factor_enabled_at",
  "two_factor_target",
  "failed_login_count",
  "locked_until"
]);

function isNeverPreviewColumn(columnName) {
  const name = String(columnName || "").trim();
  if (!name) return true;
  // Match against BOTH the raw name and a snake_cased form, so camelCase
  // spellings (`passwordHash`, `twoFactorSecret`) are caught by the same
  // patterns as their snake_case equivalents.
  const lower = name.toLowerCase();
  const snake = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  if (ALLOWED_DESPITE_PATTERN.has(lower) || ALLOWED_DESPITE_PATTERN.has(snake)) return false;
  return NEVER_PREVIEW_PATTERNS.some((pattern) => pattern.test(lower) || pattern.test(snake));
}

function isMaskedColumn(columnName) {
  const name = String(columnName || "").trim();
  const lower = name.toLowerCase();
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return MASK_PATTERNS.some((pattern) => pattern.test(lower) || pattern.test(snake));
}

function isNeverPreviewTable(tableName) {
  return NEVER_PREVIEW_TABLES.has(String(tableName || "").trim().toLowerCase());
}

/**
 * Decide which of a table's columns may be previewed.
 *
 * @param {string} tableName
 * @param {string[]} columnNames  every column on the table, in ordinal order
 * @returns {{previewable: string[], withheld: string[]}}
 */
function partitionColumns(tableName, columnNames = []) {
  const columns = Array.isArray(columnNames) ? columnNames.filter(Boolean) : [];
  if (isNeverPreviewTable(tableName)) {
    return { previewable: [], withheld: columns };
  }
  const previewable = [];
  const withheld = [];
  for (const column of columns) {
    if (isNeverPreviewColumn(column)) withheld.push(column);
    else previewable.push(column);
  }
  return { previewable, withheld };
}

/**
 * Replace a masked value with a short, non-reversible hint.
 *
 * Shows enough to correlate ("is this the same IP as the ticket?") without
 * disclosing the whole value. IPv4 keeps its first two octets.
 */
function maskValue(columnName, value) {
  if (value == null) return value;
  const text = String(value);
  const name = String(columnName || "").trim().toLowerCase();

  if (name.includes("ip") && /^\d{1,3}(\.\d{1,3}){3}$/.test(text)) {
    // Keep the first octet only: enough to correlate with a region or a support
    // ticket, not enough to single out a subscriber.
    const parts = text.split(".");
    return `${parts[0]}.x.x.x`;
  }
  if (name.includes("ip") && text.includes(":")) {
    // IPv6: keep the routing prefix, drop the interface identifier.
    return `${text.split(":").slice(0, 2).join(":")}::x`;
  }
  if (text.length <= 8) return "•••";
  return `${text.slice(0, 4)}…${text.slice(-2)} (masked)`;
}

/**
 * Apply redaction to a raw preview row. Withheld columns are REMOVED entirely
 * rather than returned as null, so the response does not even disclose whether
 * they are populated. Masked columns keep a placeholder.
 *
 * @param {string} tableName
 * @param {object} row
 * @param {{previewable: string[], withheld: string[]}} partition
 */
function redactRow(tableName, row, partition) {
  if (!row || typeof row !== "object") return row;
  if (isNeverPreviewTable(tableName)) return {};
  const allowed = new Set(partition.previewable.map((c) => String(c).toLowerCase()));
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const lower = key.toLowerCase();
    if (!allowed.has(lower)) continue; // withheld: omit the key entirely
    out[key] = isMaskedColumn(lower) ? maskValue(lower, value) : value;
  }
  return out;
}

module.exports = {
  NEVER_PREVIEW_PATTERNS,
  MASK_PATTERNS,
  NEVER_PREVIEW_TABLES,
  isNeverPreviewColumn,
  isMaskedColumn,
  isNeverPreviewTable,
  partitionColumns,
  maskValue,
  redactRow
};
