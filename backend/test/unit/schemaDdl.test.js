// backend/test/unit/schemaDdl.test.js
//
// Regression tests for the boot deadlock fix.
//
// `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` takes an AccessExclusiveLock on the
// table EVEN WHEN THE COLUMN ALREADY EXISTS (verified empirically against
// PostgreSQL 17). The schema bootstrap runs ~111 of these on every boot, so on a
// fully-migrated database it still requested an exclusive lock on every table
// while live user queries held shared locks in the opposite order — a lock-order
// inversion that Postgres resolved by killing the migration with
// "deadlock detected" (40P01), failing boot.
//
// planAddColumns() lets the migration SKIP those no-op statements so the
// exclusive lock is never requested. These tests pin that behaviour, and pin the
// safety property that genuinely-missing columns are still added.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { planAddColumns, splitAddColumnClauses, parseColumnClause } = require("../../schemaDdl");

/** Resolver that reports the given columns as already present. */
const present = (...columns) => async () => new Set(columns.map((c) => c.toLowerCase()));

const TWO_COLUMNS = `
  ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS session_reauthenticated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_reauthenticated_at TIMESTAMPTZ;
`;

test("skips the ALTER entirely when every column already exists", async () => {
  // This is the fix: no AccessExclusiveLock is ever requested on a migrated db.
  const plan = await planAddColumns(TWO_COLUMNS, present("session_reauthenticated_at", "admin_reauthenticated_at"));
  assert.equal(plan.action, "skip");
});

test("runs the statement unchanged when every column is missing", async () => {
  // First boot must still create the columns.
  const plan = await planAddColumns(TWO_COLUMNS, present());
  assert.equal(plan.action, "run");
});

test("narrowly rewrites when only some columns are missing", async () => {
  const plan = await planAddColumns(TWO_COLUMNS, present("session_reauthenticated_at"));
  assert.equal(plan.action, "rewrite");
  assert.match(plan.sql, /admin_reauthenticated_at/);
  assert.doesNotMatch(plan.sql, /session_reauthenticated_at/);
  // Exactly one statement terminator, so the emitted SQL stays valid.
  assert.equal(plan.sql.trim().endsWith(";"), true);
  assert.equal(plan.sql.includes(";;"), false);
});

test("matches catalog column names case-insensitively", async () => {
  const plan = await planAddColumns("ALTER TABLE X ADD COLUMN IF NOT EXISTS Foo TEXT;", present("foo"));
  assert.equal(plan.action, "skip");
});

test("handles a comma inside a DEFAULT expression without mis-splitting", async () => {
  const sql = "ALTER TABLE x ADD COLUMN IF NOT EXISTS a TEXT DEFAULT 'has, comma', ADD COLUMN IF NOT EXISTS b INT;";
  const plan = await planAddColumns(sql, present("a"));
  assert.equal(plan.action, "rewrite");
  assert.match(plan.sql, /ADD COLUMN IF NOT EXISTS b INT/);
  assert.doesNotMatch(plan.sql, /has, comma/);
});

test("passes non-ADD-COLUMN statements through untouched", async () => {
  // DROP / type changes / constraints genuinely need the exclusive lock and
  // must never be silently skipped.
  const statements = [
    "CREATE TABLE IF NOT EXISTS t (id SERIAL);",
    "ALTER TABLE t DROP COLUMN IF EXISTS x;",
    "ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);",
    "ALTER TABLE t ALTER COLUMN x TYPE BIGINT;",
    "CREATE INDEX IF NOT EXISTS i ON t(x);",
  ];
  for (const sql of statements) {
    const plan = await planAddColumns(sql, present("x", "id"));
    assert.equal(plan.action, "run", `expected passthrough for: ${sql}`);
  }
});

test("only treats the statement as skippable when it is purely ADD COLUMN", async () => {
  // A mixed statement (ADD COLUMN plus something else) must run verbatim.
  const mixed = "ALTER TABLE t ADD COLUMN IF NOT EXISTS a INT, DROP COLUMN IF EXISTS b;";
  const plan = await planAddColumns(mixed, present("a"));
  assert.equal(plan.action, "run");
});

test("splitAddColumnClauses ignores commas nested in parentheses", () => {
  const clauses = splitAddColumnClauses("ADD COLUMN a INTEGER REFERENCES t(id) ON DELETE CASCADE, ADD COLUMN b TEXT");
  assert.equal(clauses.length, 2);
});

test("parseColumnClause extracts the bare column name", () => {
  const parsed = parseColumnClause("  ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE");
  assert.equal(parsed.name, "workspace_id");
  assert.match(parsed.rest, /INTEGER REFERENCES/);
});
