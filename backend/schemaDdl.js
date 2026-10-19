/**
 * Safe schema DDL helpers.
 * =========================
 *
 * WHY THIS EXISTS
 * ---------------
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` takes an **AccessExclusiveLock on
 * the table even when every column already exists**. This was verified
 * empirically against PostgreSQL 17 (a concurrent session observes
 * `AccessExclusiveLock` on an idle-in-transaction connection immediately after
 * a no-op ALTER).
 *
 * Our schema bootstrap runs ~111 such statements on EVERY boot. On a
 * fully-migrated database every one of them still took an exclusive lock on a
 * live table. That produced this production deadlock:
 *
 *   Process 1460 (migration) waits for AccessExclusiveLock on auth_sessions;
 *                            blocked by process 1423
 *   Process 1423 (user query) waits for AccessShareLock on app_users;
 *                            blocked by process 1460
 *
 * The cycle is a lock-ORDER INVERSION. The migration locks auth_sessions then
 * app_users; `findUserById` reads `app_users u JOIN auth_sessions s`, taking
 * app_users then auth_sessions. Opposite order + both willing to wait forever
 * = deadlock. Postgres killed the migration, so the app failed to boot.
 *
 * Note: `lock_timeout` CANNOT fix this. A `lock_timeout` cancels a plain
 * blocking wait (SQLSTATE 55P03), but a genuine circular wait is broken by the
 * deadlock detector (SQLSTATE 40P01) before the timeout elapses. Verified: a
 * cycle with `lock_timeout=2000` still produced "deadlock detected". The only
 * reliable fix is to STOP TAKING THE EXCLUSIVE LOCK when it is not needed.
 *
 * WHAT THIS DOES
 * --------------
 * `skipRedundantAddColumns` parses an `ALTER TABLE <t> ADD COLUMN IF NOT
 * EXISTS ...` statement, checks which of the named columns are already present
 * in the catalog, and:
 *
 *   - ALL present  -> returns true (caller skips the statement entirely, so no
 *                     AccessExclusiveLock is ever requested)
 *   - SOME missing -> returns a rewritten statement adding ONLY the missing
 *                     columns, so genuinely new columns still get applied
 *   - not a match  -> returns null (caller runs the statement unchanged)
 *
 * Reads are catalog-only and cheap, and they are exactly the locks the
 * migration already needs, so this cannot itself introduce a cycle.
 */

"use strict";

// Matches: ALTER TABLE [IF EXISTS] [ONLY] <name> ADD COLUMN [IF NOT EXISTS] ...
const ADD_COLUMN_RE = /^\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s+([\s\S]*)$/i;

/** A column name at the start of an ADD COLUMN clause. */
const COLUMN_NAME_RE = /^\s*ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w$]*)\s+([\s\S]*)$/i;

/** Strip a leading schema qualifier so catalog lookups use bare identifiers. */
function splitQualifiedName(rawName) {
  const parts = String(rawName || "").split(".");
  if (parts.length === 2) {
    return { schema: parts[0], table: parts[1] };
  }
  return { schema: null, table: parts[0] };
}

/** Strip surrounding quotes/whitespace from an identifier. */
function unquote(identifier) {
  return String(identifier || "").trim().replace(/^"|"$/g, "");
}

/** Split the ADD COLUMN clauses of an ALTER body on top-level commas. */
function splitAddColumnClauses(body) {
  const clauses = [];
  let depth = 0;
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    const prev = i > 0 ? body[i - 1] : "";

    // Track quoting so commas inside default values / type names don't split.
    if (ch === "'" && !inDouble && prev !== "\\") inSingle = !inSingle;
    else if (ch === '"' && !inSingle && prev !== "\\") inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === "," && depth === 0) {
        clauses.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) clauses.push(current);
  return clauses;
}

/**
 * Split a column clause into its name and the remainder.
 * Handles an inline column constraint, e.g.
 *   "workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE"
 * @returns {{name: string, rest: string}|null}
 */
function parseColumnClause(clause) {
  const match = COLUMN_NAME_RE.exec(clause);
  if (!match) return null;
  return { name: unquote(match[1]), rest: match[2] };
}

/**
 * Determine whether an ALTER TABLE ... ADD COLUMN IF NOT EXISTS statement can be
 * skipped (or narrowed) because its columns already exist.
 *
 * @param {string} sql The statement text.
 * @param {(schema: string|null, table: string, columns: string[]) => Promise<Set<string>>} fetchExisting
 *        Resolver returning the subset of `columns` already present.
 * @returns {Promise<{action: "skip"}|{action: "rewrite", sql: string}|{action: "run"}>}
 */
async function planAddColumns(sql, fetchExisting) {
  const text = String(sql || "");
  const alterMatch = ADD_COLUMN_RE.exec(text);
  if (!alterMatch) return { action: "run" };

  const [, rawTable, rawBody] = alterMatch;
  // Drop a trailing semicolon so the rebuilt statement we emit does not double
  // it up (the source text already ends with one).
  const body = String(rawBody).replace(/;\s*$/, "");
  // Only handle pure ADD COLUMN lists. Anything else (DROP, TYPE changes,
  // constraints) must run verbatim — those genuinely need the exclusive lock.
  const clauses = splitAddColumnClauses(body);
  if (clauses.length === 0) return { action: "run" };

  const parsed = [];
  for (const clause of clauses) {
    // Tolerate a leading comma from a trailing comma in the source.
    const cleaned = clause.replace(/^\s*,/, "").trim();
    if (!cleaned) continue;
    const column = parseColumnClause(cleaned);
    if (!column) return { action: "run" };
    parsed.push(column);
  }
  if (parsed.length === 0) return { action: "run" };

  const { schema, table } = splitQualifiedName(rawTable);
  const existing = await fetchExisting(schema, table, parsed.map((c) => c.name));

  const missing = parsed.filter((c) => !existing.has(c.name.toLowerCase()));
  if (missing.length === 0) return { action: "skip" };
  if (missing.length === parsed.length) return { action: "run" };

  // Narrow the statement to only the genuinely missing columns.
  const rebuilt = missing.map((c) => `ADD COLUMN IF NOT EXISTS ${c.name} ${c.rest.trim()}`).join(",\n      ");
  return { action: "rewrite", sql: `ALTER TABLE ${rawTable}\n      ${rebuilt};` };}

module.exports = {
  planAddColumns,
  splitAddColumnClauses,
  parseColumnClause,
  splitQualifiedName
};
