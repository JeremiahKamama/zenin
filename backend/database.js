const { Pool } = require("pg");
const { watchlistData } = require("./data");

const QTY_EPSILON = 1e-8;
const DEFAULT_BALANCE = 10000;

function shouldUseSsl(connectionString) {
  if (process.env.PGSSLMODE === "disable") return false;
  if (!connectionString) return process.env.NODE_ENV === "production";
  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}

function createPoolConfig() {
  const connectionString = (
    process.env.DATABASE_URL ||
    process.env.RENDER_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
  const ssl = shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false;

  if (connectionString) {
    return {
      connectionString,
      ssl
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing PostgreSQL connection string. Set DATABASE_URL (or RENDER_DATABASE_URL/POSTGRES_URL) in production."
    );
  }

  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "zenin",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    ssl
  };
}

const pool = new Pool(createPoolConfig());

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

function toIsoString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toDateString(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapPortfolioRow(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    price: toNumber(row.price),
    quantity: toNumber(row.quantity),
    entryPrice: row.entryPrice == null ? null : toNumber(row.entryPrice),
    openedAt: toIsoString(row.openedAt || row.opened_at),
    type: row.type,
    marketType: row.marketType || row.market_type || "spot",
    orderType: row.orderType || row.order_type || "buy",
    date_added: toIsoString(row.date_added)
  };
}

function mapWatchlistRow(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    type: row.type,
    marketType: row.marketType || row.market_type || "spot",
    date_added: toIsoString(row.date_added)
  };
}

function mapTradeRow(row) {
  return {
    id: row.id,
    clientId: row.clientId || row.client_id || null,
    client_id: row.clientId || row.client_id || null,
    date: toDateString(row.date),
    executedAt: toIsoString(row.executedAt || row.executed_at),
    executed_at: toIsoString(row.executedAt || row.executed_at),
    asset: row.asset,
    name: row.name,
    type: row.type,
    side: row.side,
    marketType: row.marketType || row.market_type || "spot",
    market_type: row.marketType || row.market_type || "spot",
    status: row.status,
    quantity: toNumber(row.quantity),
    price: toNumber(row.price),
    notional: toNumber(row.notional),
    balanceAfter: row.balanceAfter == null ? null : toNumber(row.balanceAfter),
    balance_after: row.balanceAfter == null ? null : toNumber(row.balanceAfter),
    portfolioValueAfter: row.portfolioValueAfter == null ? null : toNumber(row.portfolioValueAfter),
    portfolio_value_after: row.portfolioValueAfter == null ? null : toNumber(row.portfolioValueAfter),
    accountEquityAfter: row.accountEquityAfter == null ? null : toNumber(row.accountEquityAfter),
    account_equity_after: row.accountEquityAfter == null ? null : toNumber(row.accountEquityAfter),
    positionAfter: row.positionAfter == null ? null : toNumber(row.positionAfter),
    position_after: row.positionAfter == null ? null : toNumber(row.positionAfter)
  };
}

function normalizeMarketType(type, marketType) {
  const cleanType = String(type || "").trim().toLowerCase();
  if (marketType && String(marketType).trim()) {
    return String(marketType).trim().toLowerCase();
  }
  return cleanType === "crypto" ? "spot" : "equity";
}

async function initializeDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS portfolio_holdings (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        entry_price DOUBLE PRECISION,
        opened_at TIMESTAMPTZ,
        type TEXT NOT NULL,
        market_type TEXT NOT NULL,
        order_type TEXT NOT NULL,
        date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(symbol, market_type)
      );
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      ADD COLUMN IF NOT EXISTS entry_price DOUBLE PRECISION;
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS watchlist_assets (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        market_type TEXT NOT NULL,
        date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(symbol, market_type)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_balance (
        id INTEGER PRIMARY KEY,
        balance DOUBLE PRECISION NOT NULL DEFAULT 10000
      );
    `);

    await client.query(`
      INSERT INTO user_balance (id, balance)
      VALUES (1, $1)
      ON CONFLICT (id) DO NOTHING;
    `, [DEFAULT_BALANCE]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS options_calculations (
        id SERIAL PRIMARY KEY,
        symbol TEXT NOT NULL,
        strategy TEXT NOT NULL,
        net_pnl DOUBLE PRECISION NOT NULL,
        delta DOUBLE PRECISION NOT NULL,
        gamma DOUBLE PRECISION NOT NULL,
        theta DOUBLE PRECISION NOT NULL,
        vega DOUBLE PRECISION NOT NULL,
        max_profit DOUBLE PRECISION,
        max_loss DOUBLE PRECISION,
        breakevens TEXT,
        legs_json TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trade_executions (
        id SERIAL PRIMARY KEY,
        client_id TEXT UNIQUE,
        date DATE NOT NULL,
        executed_at TIMESTAMPTZ,
        asset TEXT NOT NULL,
        name TEXT,
        type TEXT NOT NULL,
        side TEXT NOT NULL,
        market_type TEXT NOT NULL,
        status TEXT NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        notional DOUBLE PRECISION NOT NULL,
        balance_after DOUBLE PRECISION,
        portfolio_value_after DOUBLE PRECISION,
        account_equity_after DOUBLE PRECISION,
        position_after DOUBLE PRECISION
      );
    `);

    const countResult = await client.query("SELECT COUNT(*)::int AS count FROM watchlist_assets");
    const watchlistCount = Number(countResult.rows[0]?.count || 0);

    if (watchlistCount === 0) {
      const insertedAt = new Date().toISOString();
      for (const [category, assets] of Object.entries(watchlistData)) {
        for (const asset of assets) {
          const symbol = String(asset.symbol || "").trim().toUpperCase();
          if (!symbol) continue;
          const type = String(asset.type || asset.theme || category || "stock").trim().toLowerCase();
          const marketType = normalizeMarketType(type, asset.marketType);

          await client.query(`
            INSERT INTO watchlist_assets (symbol, name, type, market_type, date_added)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (symbol, market_type) DO NOTHING;
          `, [
            symbol,
            String(asset.name || symbol),
            type,
            marketType,
            insertedAt
          ]);
        }
      }
    }

    const staleHoldings = await client.query(`
      SELECT
        id,
        symbol,
        market_type AS "marketType",
        quantity,
        price,
        date_added
      FROM portfolio_holdings
      WHERE quantity > $1 AND (entry_price IS NULL OR opened_at IS NULL);
    `, [QTY_EPSILON]);

    for (const row of staleHoldings.rows) {
      const symbol = String(row.symbol || "").trim().toUpperCase();
      const marketType = String(row.marketType || "spot").trim().toLowerCase();
      const fallbackEntry = toNumber(row.price);
      const fallbackOpenedAt = row.date_added || new Date().toISOString();

      const tradesResult = await client.query(`
        SELECT
          side,
          quantity,
          price,
          COALESCE(executed_at, date::timestamptz) AS ts
        FROM trade_executions
        WHERE asset = $1 AND market_type = $2
        ORDER BY COALESCE(executed_at, date::timestamptz) ASC, id ASC;
      `, [symbol, marketType]);

      let qty = 0;
      let cost = 0;
      let openedAt = null;

      tradesResult.rows.forEach((trade) => {
        const side = String(trade.side || "").toLowerCase() === "sell" ? "sell" : "buy";
        const tradeQty = Math.abs(toNumber(trade.quantity));
        const tradePrice = toNumber(trade.price);
        const ts = trade.ts || null;
        if (tradeQty <= QTY_EPSILON) return;

        if (side === "buy") {
          if (qty <= QTY_EPSILON) {
            openedAt = ts || openedAt || fallbackOpenedAt;
          }
          qty += tradeQty;
          cost += tradeQty * tradePrice;
          return;
        }

        const closeQty = Math.min(qty, tradeQty);
        const avgCost = qty > QTY_EPSILON ? cost / qty : 0;
        qty -= closeQty;
        cost -= closeQty * avgCost;
        if (qty <= QTY_EPSILON) {
          qty = 0;
          cost = 0;
          openedAt = null;
        }
      });

      const inferredEntry = qty > QTY_EPSILON ? cost / qty : fallbackEntry;
      const finalEntry = Number.isFinite(inferredEntry) ? inferredEntry : fallbackEntry;
      const finalOpenedAt = openedAt || fallbackOpenedAt;

      await client.query(`
        UPDATE portfolio_holdings
        SET
          entry_price = COALESCE(entry_price, $1),
          opened_at = COALESCE(opened_at, $2)
        WHERE id = $3;
      `, [finalEntry, finalOpenedAt, row.id]);
    }

    await client.query("COMMIT");
    console.log("PostgreSQL database initialized.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const balance = {
  get: async () => {
    const result = await pool.query("SELECT balance FROM user_balance WHERE id = 1");
    const current = result.rows[0]?.balance;
    if (current == null) {
      await pool.query(`
        INSERT INTO user_balance (id, balance)
        VALUES (1, $1)
        ON CONFLICT (id) DO NOTHING;
      `, [DEFAULT_BALANCE]);
      return DEFAULT_BALANCE;
    }
    return toNumber(current, DEFAULT_BALANCE);
  },

  applyChange: async (amount, type) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT balance FROM user_balance WHERE id = 1 FOR UPDATE");

      let currentBalance = result.rows[0]?.balance;
      if (currentBalance == null) {
        currentBalance = DEFAULT_BALANCE;
        await client.query(`
          INSERT INTO user_balance (id, balance)
          VALUES (1, $1)
          ON CONFLICT (id) DO NOTHING;
        `, [DEFAULT_BALANCE]);
      }

      const current = toNumber(currentBalance, DEFAULT_BALANCE);
      const next = type === "deposit" ? current + amount : current - amount;
      if (next < 0) {
        const err = new Error("Insufficient balance");
        err.code = "INSUFFICIENT_BALANCE";
        throw err;
      }

      await client.query("UPDATE user_balance SET balance = $1 WHERE id = 1", [next]);
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
};

const portfolio = {
  getAll: async () => {
    await pool.query("DELETE FROM portfolio_holdings WHERE ABS(quantity) <= $1", [QTY_EPSILON]);
    const result = await pool.query(`
      SELECT
        id,
        symbol,
        name,
        price,
        quantity,
        entry_price AS "entryPrice",
        opened_at AS "openedAt",
        type,
        market_type AS "marketType",
        order_type AS "orderType",
        date_added
      FROM portfolio_holdings
      WHERE quantity > $1
      ORDER BY date_added DESC;
    `, [QTY_EPSILON]);
    return result.rows.map(mapPortfolioRow);
  },

  add: async (holding) => {
    const symbol = String(holding.symbol || "").trim().toUpperCase();
    const type = String(holding.type || "").trim().toLowerCase();
    const marketType = normalizeMarketType(type, holding.marketType);
    const orderType = String(holding.orderType || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
    const quantity = Math.abs(toNumber(holding.quantity));
    const price = toNumber(holding.price);
    const dateAdded = holding.date_added || new Date().toISOString();
    const name = String(holding.name || symbol || "Unknown");
    const isSell = orderType === "sell";

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const existingResult = await client.query(`
        SELECT
          id,
          symbol,
          name,
          price,
          quantity,
          entry_price AS "entryPrice",
          opened_at AS "openedAt",
          type,
          market_type AS "marketType",
          order_type AS "orderType",
          date_added
        FROM portfolio_holdings
        WHERE symbol = $1 AND market_type = $2
        FOR UPDATE;
      `, [symbol, marketType]);

      const existing = existingResult.rows[0] ? mapPortfolioRow(existingResult.rows[0]) : null;

      if (existing) {
        const nextQuantity = isSell
          ? existing.quantity - quantity
          : existing.quantity + quantity;

        if (nextQuantity <= QTY_EPSILON) {
          await client.query("DELETE FROM portfolio_holdings WHERE id = $1", [existing.id]);
          await client.query("COMMIT");
          return {
            id: existing.id,
            symbol,
            marketType,
            quantity: 0,
            closed: true
          };
        }

        const existingEntry = Number.isFinite(Number(existing.entryPrice))
          ? Number(existing.entryPrice)
          : Number(existing.price);
        const nextEntryPrice = isSell
          ? existingEntry
          : ((existingEntry * existing.quantity) + (price * quantity)) / Math.max(nextQuantity, QTY_EPSILON);
        const nextOpenedAt = existing.openedAt || dateAdded;

        const updatedResult = await client.query(`
          UPDATE portfolio_holdings
          SET quantity = $1, price = $2, entry_price = $3, opened_at = $4, order_type = $5, date_added = $6, type = $7, name = $8
          WHERE id = $9
          RETURNING
            id,
            symbol,
            name,
            price,
            quantity,
            entry_price AS "entryPrice",
            opened_at AS "openedAt",
            type,
            market_type AS "marketType",
            order_type AS "orderType",
            date_added;
        `, [nextQuantity, price, nextEntryPrice, nextOpenedAt, orderType, dateAdded, type, name, existing.id]);

        await client.query("COMMIT");
        return mapPortfolioRow(updatedResult.rows[0]);
      }

      if (isSell) {
        throw new Error(`No existing position for ${symbol} (${marketType}) to sell`);
      }

      const insertedResult = await client.query(`
        INSERT INTO portfolio_holdings (symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, date_added)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          id,
          symbol,
          name,
          price,
          quantity,
          entry_price AS "entryPrice",
          opened_at AS "openedAt",
          type,
          market_type AS "marketType",
          order_type AS "orderType",
          date_added;
      `, [symbol, name, price, quantity, price, dateAdded, type, marketType, orderType, dateAdded]);

      await client.query("COMMIT");
      return mapPortfolioRow(insertedResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  update: async (id, holding) => {
    const price = toNumber(holding.price);
    const quantity = toNumber(holding.quantity);
    const result = await pool.query(`
      UPDATE portfolio_holdings
      SET price = $1, quantity = $2
      WHERE id = $3
      RETURNING
        id,
        symbol,
        name,
        price,
        quantity,
        entry_price AS "entryPrice",
        opened_at AS "openedAt",
        type,
        market_type AS "marketType",
        order_type AS "orderType",
        date_added;
    `, [price, quantity, id]);

    if (result.rows.length === 0) {
      throw new Error("Holding not found");
    }

    return mapPortfolioRow(result.rows[0]);
  },

  delete: async (id) => {
    await pool.query("DELETE FROM portfolio_holdings WHERE id = $1", [id]);
    return { success: true, id: Number(id) };
  },

  findBySymbol: async (symbol, marketType) => {
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanMarketType = String(marketType || "").trim().toLowerCase();
    const result = await pool.query(`
      SELECT
        id,
        symbol,
        name,
        price,
        quantity,
        entry_price AS "entryPrice",
        opened_at AS "openedAt",
        type,
        market_type AS "marketType",
        order_type AS "orderType",
        date_added
      FROM portfolio_holdings
      WHERE symbol = $1 AND market_type = $2
      ORDER BY date_added DESC;
    `, [cleanSymbol, cleanMarketType]);
    return result.rows.map(mapPortfolioRow);
  }
};

const tradeExecutions = {
  getAll: async (limit = 1000) => {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const result = await pool.query(`
      SELECT
        id,
        client_id AS "clientId",
        date,
        executed_at AS "executedAt",
        asset,
        name,
        type,
        side,
        market_type AS "marketType",
        status,
        quantity,
        price,
        notional,
        balance_after AS "balanceAfter",
        portfolio_value_after AS "portfolioValueAfter",
        account_equity_after AS "accountEquityAfter",
        position_after AS "positionAfter"
      FROM trade_executions
      ORDER BY COALESCE(executed_at, date::timestamptz) DESC, id DESC
      LIMIT $1;
    `, [safeLimit]);
    return result.rows.map(mapTradeRow);
  },

  add: async (trade) => {
    const normalized = {
      client_id: trade.clientId || null,
      date: toDateString(trade.date || new Date().toISOString()) || new Date().toISOString().slice(0, 10),
      executed_at: trade.executedAt || null,
      asset: String(trade.asset || "UNKNOWN").trim().toUpperCase(),
      name: String(trade.name || trade.asset || "UNKNOWN"),
      type: String(trade.type || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
      side: String(trade.side || "buy").toLowerCase() === "sell" ? "sell" : "buy",
      marketType: normalizeMarketType(trade.type || trade.marketType, trade.marketType || "spot"),
      status: String(trade.status || "Filled"),
      quantity: Math.abs(toNumber(trade.quantity)),
      price: toNumber(trade.price),
      notional: Math.abs(toNumber(trade.notional)),
      balance_after: Number.isFinite(Number(trade.balanceAfter)) ? Number(trade.balanceAfter) : null,
      portfolio_value_after: Number.isFinite(Number(trade.portfolioValueAfter)) ? Number(trade.portfolioValueAfter) : null,
      account_equity_after: Number.isFinite(Number(trade.accountEquityAfter)) ? Number(trade.accountEquityAfter) : null,
      position_after: Number.isFinite(Number(trade.positionAfter)) ? Number(trade.positionAfter) : null
    };

    try {
      const result = await pool.query(`
        INSERT INTO trade_executions (
          client_id, date, executed_at, asset, name, type, side, market_type, status,
          quantity, price, notional, balance_after, portfolio_value_after, account_equity_after, position_after
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING
          id,
          client_id AS "clientId",
          date,
          executed_at AS "executedAt",
          asset,
          name,
          type,
          side,
          market_type AS "marketType",
          status,
          quantity,
          price,
          notional,
          balance_after AS "balanceAfter",
          portfolio_value_after AS "portfolioValueAfter",
          account_equity_after AS "accountEquityAfter",
          position_after AS "positionAfter";
      `, [
        normalized.client_id,
        normalized.date,
        normalized.executed_at,
        normalized.asset,
        normalized.name,
        normalized.type,
        normalized.side,
        normalized.marketType,
        normalized.status,
        normalized.quantity,
        normalized.price,
        normalized.notional,
        normalized.balance_after,
        normalized.portfolio_value_after,
        normalized.account_equity_after,
        normalized.position_after
      ]);

      return mapTradeRow(result.rows[0]);
    } catch (error) {
      if (error.code === "23505" && normalized.client_id) {
        const existing = await pool.query(`
          SELECT
            id,
            client_id AS "clientId",
            date,
            executed_at AS "executedAt",
            asset,
            name,
            type,
            side,
            market_type AS "marketType",
            status,
            quantity,
            price,
            notional,
            balance_after AS "balanceAfter",
            portfolio_value_after AS "portfolioValueAfter",
            account_equity_after AS "accountEquityAfter",
            position_after AS "positionAfter"
          FROM trade_executions
          WHERE client_id = $1
          LIMIT 1;
        `, [normalized.client_id]);
        if (existing.rows[0]) return mapTradeRow(existing.rows[0]);
      }
      throw error;
    }
  }
};

const watchlist = {
  getAll: async () => {
    const result = await pool.query(`
      SELECT
        id,
        symbol,
        name,
        type,
        market_type AS "marketType",
        date_added
      FROM watchlist_assets
      ORDER BY date_added DESC;
    `);
    return result.rows.map(mapWatchlistRow);
  },

  add: async (asset) => {
    const symbol = String(asset.symbol || "").trim().toUpperCase();
    const type = String(asset.type || "stock").trim().toLowerCase();
    const marketType = normalizeMarketType(type, asset.marketType);
    const dateAdded = asset.date_added || new Date().toISOString();

    const result = await pool.query(`
      INSERT INTO watchlist_assets (symbol, name, type, market_type, date_added)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (symbol, market_type)
      DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, date_added = EXCLUDED.date_added
      RETURNING
        id,
        symbol,
        name,
        type,
        market_type AS "marketType",
        date_added;
    `, [symbol, String(asset.name || symbol), type, marketType, dateAdded]);

    return mapWatchlistRow(result.rows[0]);
  },

  delete: async (symbol, marketType) => {
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
    await pool.query("DELETE FROM watchlist_assets WHERE symbol = $1 AND market_type = $2", [
      cleanSymbol,
      cleanMarketType
    ]);
    return { success: true, symbol: cleanSymbol, marketType: cleanMarketType };
  },

  exists: async (symbol, marketType) => {
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
    const result = await pool.query(
      "SELECT id FROM watchlist_assets WHERE symbol = $1 AND market_type = $2 LIMIT 1",
      [cleanSymbol, cleanMarketType]
    );
    return result.rows.length > 0;
  }
};

const optionsCalculations = {
  add: async (payload) => {
    const {
      symbol,
      strategy = "Custom",
      netPnl = 0,
      delta = 0,
      gamma = 0,
      theta = 0,
      vega = 0,
      maxProfit = null,
      maxLoss = null,
      breakevens = [],
      legs = [],
      createdAt = new Date().toISOString()
    } = payload;

    const result = await pool.query(`
      INSERT INTO options_calculations (
        symbol, strategy, net_pnl, delta, gamma, theta, vega, max_profit, max_loss, breakevens, legs_json, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `, [
      String(symbol || "").trim().toUpperCase(),
      strategy,
      toNumber(netPnl),
      toNumber(delta),
      toNumber(gamma),
      toNumber(theta),
      toNumber(vega),
      Number.isFinite(Number(maxProfit)) ? Number(maxProfit) : null,
      Number.isFinite(Number(maxLoss)) ? Number(maxLoss) : null,
      JSON.stringify(Array.isArray(breakevens) ? breakevens : []),
      JSON.stringify(Array.isArray(legs) ? legs : []),
      createdAt
    ]);

    const row = result.rows[0];
    return {
      ...row,
      created_at: toIsoString(row.created_at)
    };
  },

  getRecent: async (limit = 20, symbol = null) => {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
    if (symbol) {
      const result = await pool.query(`
        SELECT * FROM options_calculations
        WHERE symbol = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2;
      `, [String(symbol).trim().toUpperCase(), safeLimit]);

      return result.rows.map((row) => ({
        ...row,
        created_at: toIsoString(row.created_at)
      }));
    }

    const result = await pool.query(`
      SELECT * FROM options_calculations
      ORDER BY created_at DESC, id DESC
      LIMIT $1;
    `, [safeLimit]);

    return result.rows.map((row) => ({
      ...row,
      created_at: toIsoString(row.created_at)
    }));
  }
};

async function clearAllData() {
  await pool.query("DELETE FROM portfolio_holdings");
  await pool.query("DELETE FROM watchlist_assets");
  await pool.query("DELETE FROM trade_executions");
}

async function closeDatabase() {
  await pool.end();
}

module.exports = {
  pool,
  initializeDatabase,
  balance,
  portfolio,
  watchlist,
  optionsCalculations,
  tradeExecutions,
  clearAllData,
  closeDatabase
};
