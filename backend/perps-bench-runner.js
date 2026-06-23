// backend/perps-bench-runner.js
// Entry point for the Render Background Worker service.
// Run with: node perps-bench-runner.js
// Requires: PERPS_BENCH_ENABLED=true, DATABASE_URL set

const { initializeDatabase } = require("./database");
const { runContinuousLoop } = require("./perpsRunner");

const RATE_MS = Number(process.env.PERPS_BENCH_RATE_MS) || 60000;
const MODE = String(process.env.PERPS_BENCH_MODE || "dry_run").toLowerCase();

async function main() {
  console.log("[PerpsBench] Initializing database...");
  await initializeDatabase();
  console.log("[PerpsBench] Database ready. Starting continuous loop...");
  await runContinuousLoop({ rateMs: RATE_MS, mode: MODE });
}

main().catch((err) => {
  console.error("[PerpsBench] Fatal error:", err);
  process.exit(1);
});
