const { Pool } = require('pg');
require('dotenv').config();
const { fetchFarsideEtfFlows } = require('../farsideEtf');

const connectionString = process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL || process.env.POSTGRES_URL || "";

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }
});

async function syncFarsideETF() {
  console.log(`[ETF Sync] Starting sync at ${new Date().toISOString()}`);

  const flows = await fetchFarsideEtfFlows(fetch);
  if (!Array.isArray(flows) || flows.length === 0) {
    throw new Error("No Farside ETF rows were parsed");
  }

  for (const flow of flows) {
    await pool.query(`
      INSERT INTO etf_inflows (date, asset, manager, ticker, net_usd, source)
      VALUES ($1, $2, $3, $4, $5, 'Farside')
      ON CONFLICT (date, asset, ticker)
      DO UPDATE SET
        manager = EXCLUDED.manager,
        net_usd = EXCLUDED.net_usd,
        source = EXCLUDED.source,
        created_at = CURRENT_TIMESTAMP
    `, [flow.date, flow.asset, flow.manager, flow.ticker, flow.netUsd]);
  }

  const byAsset = flows.reduce((acc, row) => {
    acc[row.asset] = (acc[row.asset] || 0) + 1;
    return acc;
  }, {});

  console.log(`[ETF Sync] Synced ${flows.length} rows: ${JSON.stringify(byAsset)}`);

  await pool.end();
  console.log(`[ETF Sync] Sync completed at ${new Date().toISOString()}`);
}

syncFarsideETF().catch(console.error);
