const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.RENDER_DATABASE_URL || process.env.POSTGRES_URL,
  ssl: (process.env.DATABASE_URL || "").includes("localhost") ? false : { rejectUnauthorized: false }
});

const data = {
  "date": "2026-05-04",
  "flows": {
    "IBIT": 342.9,
    "FBTC": 188.7,
    "GBTC": -1.5,
    "BTC": 6.4,
    "BITB": 0.0,
    "ARKB": 0.0,
    "HODL": 5.8,
    "BTCO": -0.1,
    "BRRR": 0.0,
    "EZBC": 0.0,
    "MSBT": 12.4,
    "BTCW": 0.0,
    "DEFI": 0.0
  }
};

const managerMap = {
  "IBIT": { manager: "BlackRock", asset: "BTC" },
  "FBTC": { manager: "Fidelity", asset: "BTC" },
  "GBTC": { manager: "Grayscale", asset: "BTC" },
  "BTC": { manager: "Grayscale Mini", asset: "BTC" },
  "BITB": { manager: "Bitwise", asset: "BTC" },
  "ARKB": { manager: "Ark 21Shares", asset: "BTC" },
  "HODL": { manager: "VanEck", asset: "BTC" },
  "BTCO": { manager: "Invesco", asset: "BTC" },
  "BRRR": { manager: "Valkyrie", asset: "BTC" },
  "EZBC": { manager: "Franklin", asset: "BTC" },
  "MSBT": { manager: "WisdomTree", asset: "BTC" },
  "BTCW": { manager: "WisdomTree", asset: "BTC" },
  "DEFI": { manager: "Hashdex", asset: "BTC" }
};

async function seed() {
  for (const [ticker, val] of Object.entries(data.flows)) {
    const info = managerMap[ticker];
    if (!info) continue;
    
    await pool.query(`
      INSERT INTO etf_inflows (date, asset, manager, ticker, net_usd, source)
      VALUES ($1, $2, $3, $4, $5, 'Bitbo')
      ON CONFLICT (date, asset, ticker) 
      DO UPDATE SET net_usd = EXCLUDED.net_usd
    `, [data.date, info.asset, info.manager, ticker, val * 1000000]);
  }
  console.log("Seeded ETF data successfully.");
  await pool.end();
}

seed().catch(console.error);
