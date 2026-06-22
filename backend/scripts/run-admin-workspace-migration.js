#!/usr/bin/env node
const { runAdminWorkspaceMigration, closeDatabase } = require("../database");

async function main() {
  const force = process.argv.includes("--force");
  const result = await runAdminWorkspaceMigration({ force });
  console.log(JSON.stringify({ success: true, force, migration: result }, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      success: false,
      error: error?.message || String(error)
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDatabase();
    } catch (error) {
      console.warn("[Migration] Database close failed:", error?.message || error);
    }
  });
