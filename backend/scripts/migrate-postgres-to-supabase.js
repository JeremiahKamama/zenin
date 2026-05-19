#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { Client } = require("pg");

const args = new Set(process.argv.slice(2));

function hasFlag(flag) {
  return args.has(flag);
}

function resolveSource() {
  const candidates = [
    ["MIGRATION_SOURCE_DATABASE_URL", process.env.MIGRATION_SOURCE_DATABASE_URL],
    ["RENDER_DATABASE_URL", process.env.RENDER_DATABASE_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
    ["DATABASE_URL", process.env.DATABASE_URL]
  ];
  const match = candidates.find(([, value]) => String(value || "").trim());
  return {
    name: match?.[0] || null,
    value: match ? String(match[1]).trim() : null
  };
}

function resolveTarget() {
  const candidates = [
    ["MIGRATION_TARGET_DATABASE_URL", process.env.MIGRATION_TARGET_DATABASE_URL],
    ["SUPABASE_DIRECT_URL", process.env.SUPABASE_DIRECT_URL],
    ["SUPABASE_DB_URL", process.env.SUPABASE_DB_URL],
    ["SUPABASE_DATABASE_URL", process.env.SUPABASE_DATABASE_URL]
  ];
  const match = candidates.find(([, value]) => String(value || "").trim());
  return {
    name: match?.[0] || null,
    value: match ? String(match[1]).trim() : null
  };
}

function redactConnectionString(connectionString) {
  if (!connectionString) return "(missing)";
  try {
    const parsed = new URL(connectionString);
    if (parsed.password) {
      parsed.password = "***";
    }
    if (parsed.username) {
      parsed.username = "***";
    }
    return parsed.toString();
  } catch {
    return "(invalid connection string)";
  }
}

function fingerprintConnectionString(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return [
      parsed.protocol,
      parsed.hostname.toLowerCase(),
      parsed.port || "5432",
      parsed.pathname.replace(/^\//, "").toLowerCase(),
      parsed.username.toLowerCase()
    ].join("|");
  } catch {
    return String(connectionString || "").trim();
  }
}

function describeConnection(connectionString) {
  try {
    const parsed = new URL(connectionString);
    return {
      host: parsed.hostname || null,
      port: parsed.port || "5432",
      database: parsed.pathname ? parsed.pathname.replace(/^\//, "") : null,
      user: parsed.username || null,
    };
  } catch {
    return {
      host: null,
      port: null,
      database: null,
      user: null,
    };
  }
}

function shouldUseSsl(connectionString) {
  if (String(process.env.PGSSLMODE || "").toLowerCase() === "disable") return false;
  if (!connectionString) return false;
  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}

function resolveRejectUnauthorized() {
  const explicit = process.env.PGSSL_REJECT_UNAUTHORIZED;
  if (explicit != null && String(explicit).trim() !== "") {
    return String(explicit).toLowerCase() !== "false";
  }
  if (String(process.env.PGSSLMODE || "").toLowerCase() === "no-verify") {
    return false;
  }
  return true;
}

function ensureBinary(binary) {
  const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        `Missing required PostgreSQL client binary: ${binary}. Install PostgreSQL client tools so pg_dump and pg_restore are available.`
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Unable to execute ${binary} --version.`);
  }
}

function runProcess(command, commandArgs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      env: process.env
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}.`));
    });
  });
}

async function preflightConnection(label, connectionString) {
  const client = new Client({
    connectionString,
    ssl: shouldUseSsl(connectionString)
      ? { rejectUnauthorized: resolveRejectUnauthorized() }
      : false
  });
  try {
    await client.connect();
    const result = await client.query(
      "select current_database() as database, current_user as user, inet_server_addr()::text as host"
    );
    return result.rows[0] || {};
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const source = resolveSource();
  const target = resolveTarget();

  if (!source.value) {
    throw new Error(
      "Missing source database URL. Set MIGRATION_SOURCE_DATABASE_URL or keep RENDER_DATABASE_URL available."
    );
  }
  if (!target.value) {
    throw new Error(
      "Missing target database URL. Set MIGRATION_TARGET_DATABASE_URL or SUPABASE_DIRECT_URL."
    );
  }

  if (fingerprintConnectionString(source.value) === fingerprintConnectionString(target.value)) {
    throw new Error("Source and target databases resolve to the same connection. Refusing to continue.");
  }

  ensureBinary("pg_dump");
  ensureBinary("pg_restore");

  const sourceDetails = describeConnection(source.value);
  const targetDetails = describeConnection(target.value);

  console.log("Zenin Postgres -> Supabase migration");
  console.log("------------------------------------");
  console.log(`Source env : ${source.name || "(unknown)"}`);
  console.log(`Source DB  : ${redactConnectionString(source.value)}`);
  console.log(`Target env : ${target.name || "(unknown)"}`);
  console.log(`Target DB  : ${redactConnectionString(target.value)}`);
  console.log("");

  const [sourceProbe, targetProbe] = await Promise.all([
    preflightConnection("source", source.value),
    preflightConnection("target", target.value)
  ]);

  console.log("Preflight checks passed.");
  console.log(
    `Source confirmed as ${sourceProbe.database || sourceDetails.database} on ${sourceProbe.host || sourceDetails.host}`
  );
  console.log(
    `Target confirmed as ${targetProbe.database || targetDetails.database} on ${targetProbe.host || targetDetails.host}`
  );

  if (!hasFlag("--yes")) {
    console.log("");
    console.log("Dry run only. Re-run with --yes to dump the Render/public schema and restore it into Supabase.");
    console.log("Optional flags:");
    console.log("  --keep-dump   Keep the generated dump file instead of deleting it.");
    return;
  }

  const dumpFilePath = path.join(
    os.tmpdir(),
    `zenin-render-to-supabase-${Date.now()}.dump`
  );

  console.log("");
  console.log(`Creating public-schema dump at ${dumpFilePath}`);
  await runProcess(
    "pg_dump",
    [
      "--format=custom",
      "--verbose",
      "--no-owner",
      "--no-privileges",
      "--schema=public",
      "--file",
      dumpFilePath,
      source.value
    ],
    "pg_dump"
  );

  console.log("");
  console.log("Restoring dump into Supabase target...");
  try {
    await runProcess(
      "pg_restore",
      [
        "--verbose",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--single-transaction",
        "--schema=public",
        "--dbname",
        target.value,
        dumpFilePath
      ],
      "pg_restore"
    );
  } finally {
    if (!hasFlag("--keep-dump")) {
      fs.rmSync(dumpFilePath, { force: true });
    }
  }

  console.log("");
  console.log("Migration complete.");
  console.log("Next steps:");
  console.log("1. Point backend DATABASE_URL at the Supabase runtime connection string.");
  console.log("2. Keep SUPABASE_DIRECT_URL available for admin scripts and future maintenance.");
  console.log("3. Restart the backend and verify /health plus core authenticated flows.");
}

main().catch((error) => {
  console.error("");
  console.error("Migration aborted.");
  console.error(error.message || error);
  process.exitCode = 1;
});
