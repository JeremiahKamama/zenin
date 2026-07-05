/**
 * Sentry Release Creator
 * ======================
 *
 * Creates a Sentry release for the backend, linked to the current git commit.
 * Intended to run as part of the deploy pipeline (e.g. Render's build step)
 * after dependencies are installed. Safe to run unconditionally — it no-ops
 * when SENTRY_BACKEND_AUTH_TOKEN is unset, so local builds and CI without
 * Sentry credentials are unaffected.
 *
 * Usage:
 *   node scripts/sentry-release.mjs
 *
 * Required env (when enabled):
 *   SENTRY_BACKEND_AUTH_TOKEN  Sentry auth token (project:releases + project:write)
 *   SENTRY_ORG                 Sentry org slug
 *   SENTRY_BACKEND_PROJECT     Sentry project slug
 *   SENTRY_ENVIRONMENT         Deployment environment (production/staging/dev)
 *
 * Optional:
 *   SENTRY_RELEASE             Explicit release name (defaults to git SHA)
 */

import { execSync } from "node:child_process";

const AUTH_TOKEN = process.env.SENTRY_BACKEND_AUTH_TOKEN;
const ORG = process.env.SENTRY_ORG;
const PROJECT = process.env.SENTRY_BACKEND_PROJECT;
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production";

function gitSha() {
  try {
    return String(execSync("git rev-parse --short HEAD", { encoding: "utf8" })).trim();
  } catch {
    return null;
  }
}

function run(cmd, label) {
  try {
    console.log(`[sentry-release] ${label}...`);
    execSync(cmd, { encoding: "utf8", stdio: "pipe" });
    console.log(`[sentry-release] ${label} OK`);
    return true;
  } catch (err) {
    const stderr = String(err.stderr || err.message || "").trim();
    // A release already existing is not a failure.
    if (/already exists|duplicate/i.test(stderr)) {
      console.log(`[sentry-release] ${label}: already exists (skipped)`);
      return true;
    }
    console.error(`[sentry-release] ${label} FAILED:`, stderr);
    return false;
  }
}

function main() {
  if (!AUTH_TOKEN) {
    console.log("[sentry-release] SENTRY_BACKEND_AUTH_TOKEN unset — skipping release creation.");
    return;
  }
  if (!ORG || !PROJECT) {
    console.error("[sentry-release] SENTRY_ORG and SENTRY_BACKEND_PROJECT must be set.");
    process.exit(0); // non-fatal: don't break the deploy
  }

  const release = process.env.SENTRY_RELEASE || gitSha();
  if (!release) {
    console.error("[sentry-release] Could not determine release name (no SENTRY_RELEASE and git unavailable).");
    process.exit(0);
  }

  const cli = `npx --no-install @sentry/cli --auth-token "${AUTH_TOKEN}" --org "${ORG}" --project "${PROJECT}"`;
  const envFlag = `--release "${release}"`;

  // 1. Create the new release.
  if (!run(`${cli} releases new ${envFlag}`, "create release")) {
    process.exit(0);
  }

  // 2. Associate the git commits so Sentry can track which changes shipped.
  run(`${cli} releases set-commits ${envFlag} --auto`, "set commits");

  // 3. Mark the release as deployed to this environment.
  run(`${cli} releases deploys ${envFlag} new --env "${ENVIRONMENT}"`, `mark deployed (${ENVIRONMENT})`);

  console.log(`[sentry-release] Release ${release} created for ${PROJECT} (${ENVIRONMENT}).`);
}

main();
