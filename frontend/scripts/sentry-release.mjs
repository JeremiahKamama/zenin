#!/usr/bin/env node
/**
 * sentry-release — Creates a Sentry release for the frontend build.
 *
 * Usage:
 *   node scripts/sentry-release.mjs          # creates + deploys a release
 *   node scripts/sentry-release.mjs --dry-run  # prints what would happen
 *
 * Requires: VITE_SENTRY_ORG, VITE_SENTRY_FRONTEND_PROJECT, VITE_SENTRY_AUTH_TOKEN
 * Optional:  VITE_SENTRY_RELEASE (falls back to git SHA), VITE_SENTRY_ENVIRONMENT
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const distDir = resolve(root, "dist");

const env = { ...process.env };

function envVar(key) {
  const val = String(env[key] || "").trim();
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function tryEnvVar(key) {
  return String(env[key] || "").trim() || undefined;
}

function resolveRelease() {
  const explicit = tryEnvVar("VITE_SENTRY_RELEASE");
  if (explicit) return explicit;
  try {
    return String(execSync("git rev-parse --short HEAD", { encoding: "utf8" })).trim();
  } catch {
    return "unknown";
  }
}

function isDryRun() {
  return process.argv.includes("--dry-run");
}

async function main() {
  const org = envVar("VITE_SENTRY_ORG");
  const project = tryEnvVar("VITE_SENTRY_FRONTEND_PROJECT") || "zenin-frontend";
  const authToken = envVar("VITE_SENTRY_AUTH_TOKEN");
  const release = resolveRelease();
  const environment = tryEnvVar("VITE_SENTRY_ENVIRONMENT") || "production";

  const sentryCli = (args) => {
    const fullArgs = [
      "sentry-cli",
      "releases",
      ...args,
      "--org", org,
      "--project", project,
      "--auth-token", authToken,
    ];
    const cmd = fullArgs.join(" ");
    if (isDryRun()) {
      console.log(`[dry-run] ${cmd}`);
      return "";
    }
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" });
  };

  // 1. Create release
  try {
    sentryCli(["new", release]);
    console.log(`✓ Release ${release} created`);
  } catch (err) {
    // Release may already exist in Sentry — that's fine, continue.
    if (!String(err.stderr || "").includes("already")) throw err;
    console.log(`✓ Release ${release} already exists (reusing)`);
  }

  // 2. Set commits
  try {
    sentryCli(["set-commits", "--auto", release]);
    console.log("✓ Commits associated");
  } catch (err) {
    console.warn(`⚠ Could not associate commits: ${err.message}`);
  }

  // 3. Upload source maps if dist/ exists
  if (existsSync(distDir)) {
    try {
      sentryCli([
        "files", release,
        "upload-sourcemaps",
        distDir,
        "--url-prefix", "~/assets",
        "--validate",
        "--strip-prefix", distDir,
      ]);
      console.log("✓ Source maps uploaded");
    } catch (err) {
      console.warn(`⚠ Source map upload failed: ${err.message}`);
    }
  } else {
    console.log("ℹ dist/ not found — skipping source map upload (build first)");
  }

  // 4. Deploy
  try {
    sentryCli(["deploys", release, "new", "--env", environment]);
    console.log(`✓ Deploy recorded for ${environment}`);
  } catch (err) {
    console.warn(`⚠ Deploy record failed: ${err.message}`);
  }

  console.log(`\nAll done. Release: ${release}  Environment: ${environment}`);
}

main().catch((err) => {
  console.error("\n✕ Sentry release failed:", err.message);
  if (isDryRun()) console.log("(This was a dry run — no changes were made.)");
  process.exitCode = 1;
});
