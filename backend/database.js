const { Pool } = require("pg");
const { watchlistData } = require("./data");
const crypto = require("crypto");

const QTY_EPSILON = 1e-8;
const DEFAULT_BALANCE = 10000;

function shouldUseSsl(connectionString) {
  if (process.env.PGSSLMODE === "disable") return false;
  if (!connectionString) return process.env.NODE_ENV === "production";
  return !/localhost|127\.0\.0\.1/i.test(connectionString);
}

function isRenderEnvironment(connectionString) {
  if (process.env.RENDER === "true") return true;
  if (process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL || process.env.RENDER_INSTANCE_ID) return true;
  return /render\.com/i.test(String(connectionString || ""));
}

function resolveRejectUnauthorized(connectionString) {
  const explicit = process.env.PGSSL_REJECT_UNAUTHORIZED;
  if (explicit != null && String(explicit).trim() !== "") {
    return String(explicit).toLowerCase() !== "false";
  }

  // "no-verify" is an explicit request to skip CA/hostname verification.
  if (String(process.env.PGSSLMODE || "").toLowerCase() === "no-verify") {
    return false;
  }

  // In production we always verify TLS certificates unless explicitly overridden.
  if (process.env.NODE_ENV === "production" && !isRenderEnvironment(connectionString)) {
    return true;
  }

  if (isRenderEnvironment(connectionString)) {
    return false;
  }

  return false;
}

function createPoolConfig() {
  const connectionString = (
    process.env.DATABASE_URL ||
    process.env.RENDER_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    null
  );
  const rejectUnauthorized = resolveRejectUnauthorized(connectionString);
  const ssl = shouldUseSsl(connectionString) ? { rejectUnauthorized } : false;

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

function parseJsonPayload(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object" || typeof value === "number" || typeof value === "boolean") return value;
  try {
    return JSON.parse(value);
  } catch {
    return typeof value === "string" ? value : fallback;
  }
}

function mapAuthUserRow(row) {
  if (!row) return null;
  return {
    ...row,
    passkeys: parseJsonPayload(row.passkeys, []),
    backupCodes: parseJsonPayload(row.backupCodes, [])
  };
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
    strategyName: row.strategyName || row.strategy_name || null,
    legsJson: parseJsonPayload(row.legsJson || row.legs_json),
    date_added: toIsoString(row.date_added)
  };
}

function mapWatchlistRow(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    type: row.type,
    category: row.category || null,
    theme: row.theme || null,
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
    fee: row.fee == null ? 0 : toNumber(row.fee),
    slippage: row.slippage == null ? 0 : toNumber(row.slippage),
    referencePrice: row.referencePrice == null ? null : toNumber(row.referencePrice),
    balanceAfter: row.balanceAfter == null ? null : toNumber(row.balanceAfter),
    balance_after: row.balanceAfter == null ? null : toNumber(row.balanceAfter),
    portfolioValueAfter: row.portfolioValueAfter == null ? null : toNumber(row.portfolioValueAfter),
    portfolio_value_after: row.portfolioValueAfter == null ? null : toNumber(row.portfolioValueAfter),
    accountEquityAfter: row.accountEquityAfter == null ? null : toNumber(row.accountEquityAfter),
    account_equity_after: row.accountEquityAfter == null ? null : toNumber(row.accountEquityAfter),
    positionAfter: row.positionAfter == null ? null : toNumber(row.positionAfter),
    position_after: row.positionAfter == null ? null : toNumber(row.positionAfter),
    strategyName: row.strategyName || row.strategy_name || null,
    legsJson: parseJsonPayload(row.legsJson || row.legs_json),
    executionMeta: parseJsonPayload(row.executionMeta || row.execution_meta_json, {})
  };
}

function normalizeMarketType(type, marketType) {
  const cleanType = String(type || "").trim().toLowerCase();
  if (marketType && String(marketType).trim()) {
    return String(marketType).trim().toLowerCase();
  }
  return cleanType === "crypto" ? "spot" : "equity";
}

function roundMoney(value) {
  return Number(toNumber(value, 0).toFixed(8));
}

function getExecutionCostProfile(type, marketType) {
  const resolvedType = String(type || "").trim().toLowerCase();
  const resolvedMarketType = String(marketType || "").trim().toLowerCase();
  const marketKey = resolvedMarketType || resolvedType;

  if (marketKey.includes("option") || resolvedType === "options") {
    return { feeBps: 18, minFee: 1.25, baseSlippageBps: 14, sizeSlippageBps: 4.5, maxExtraSlippageBps: 22, label: "options" };
  }
  if (marketKey.includes("crypto") || marketKey === "spot" || resolvedType === "crypto") {
    return { feeBps: 14, minFee: 0.75, baseSlippageBps: 10, sizeSlippageBps: 3.5, maxExtraSlippageBps: 18, label: "crypto" };
  }
  if (marketKey.includes("commodity") || marketKey.includes("future") || resolvedType === "commodity") {
    return { feeBps: 10, minFee: 1, baseSlippageBps: 8, sizeSlippageBps: 2.5, maxExtraSlippageBps: 14, label: "commodity" };
  }
  if (marketKey.includes("bond") || resolvedType === "bond") {
    return { feeBps: 7, minFee: 1, baseSlippageBps: 5, sizeSlippageBps: 2, maxExtraSlippageBps: 10, label: "bond" };
  }
  return { feeBps: 8, minFee: 0.5, baseSlippageBps: 4, sizeSlippageBps: 1.75, maxExtraSlippageBps: 9, label: "equity" };
}

function buildExecutionCostEstimate({ type, marketType, orderType, quantity, price }) {
  const safeQuantity = Math.abs(toNumber(quantity));
  const referencePrice = toNumber(price);
  const normalizedOrderType = String(orderType || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
  const referenceNotional = roundMoney(referencePrice * safeQuantity);
  const profile = getExecutionCostProfile(type, marketType);
  const extraSlippageBps = Math.min(
    profile.maxExtraSlippageBps,
    Math.log10(Math.max(referenceNotional, 1) + 1) * profile.sizeSlippageBps
  );
  const slippageBps = profile.baseSlippageBps + extraSlippageBps;
  const priceDirection = normalizedOrderType === "buy" ? 1 : -1;
  const executedPrice = roundMoney(referencePrice * (1 + ((slippageBps / 10000) * priceDirection)));
  const executedNotional = roundMoney(executedPrice * safeQuantity);
  const slippage = roundMoney(Math.abs(executedNotional - referenceNotional));
  const fee = roundMoney(Math.max(profile.minFee, executedNotional * (profile.feeBps / 10000)));

  return {
    referencePrice,
    executedPrice,
    executedNotional,
    referenceNotional,
    fee,
    slippage,
    totalCostImpact: roundMoney(fee + slippage),
    executionMeta: {
      profile: profile.label,
      feeBps: profile.feeBps,
      slippageBps: roundMoney(slippageBps),
    }
  };
}

function toUserId(userId) {
  const parsed = Number(userId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error("Invalid user id");
    error.code = "INVALID_USER_ID";
    throw error;
  }
  return parsed;
}

function normalizePlanValue(plan) {
  const value = String(plan || "").trim().toLowerCase();
  if (["starter", "pro", "desk"].includes(value)) return value;
  return "starter";
}

function normalizeBillingCycleValue(billingCycle) {
  const value = String(billingCycle || "").trim().toLowerCase();
  if (["monthly", "yearly"].includes(value)) return value;
  return "monthly";
}

const ADMIN_WORKSPACE_MIGRATION_SNAPSHOT_KEY = "maintenance:admin-workspace-migration-v1";

async function runAdminWorkspaceMigrationTx(client, { force = false, markRun = true } = {}) {
  if (!force) {
    const marker = await client.query(`
      SELECT payload_json AS payload, updated_at AS "updatedAt"
      FROM service_snapshots
      WHERE snapshot_key = $1
      LIMIT 1;
    `, [ADMIN_WORKSPACE_MIGRATION_SNAPSHOT_KEY]);
    if (marker.rows[0]) {
      return {
        skipped: true,
        alreadyRan: true,
        marker: {
          payload: parseJsonPayload(marker.rows[0].payload, {}),
          updatedAt: toIsoString(marker.rows[0].updatedAt)
        }
      };
    }
  }

  const adminEmail = String(process.env.ADMIN_EMAIL || "admin@zenin.app").trim().toLowerCase();
  const adminUserResult = await client.query(`
    WITH upsert AS (
      INSERT INTO app_users (email, password_hash, display_name, auth_provider, email_verified)
      VALUES ($1, '', 'Admin User', 'admin', TRUE)
      ON CONFLICT (email) DO UPDATE
      SET display_name = EXCLUDED.display_name, updated_at = NOW()
      RETURNING id
    )
    SELECT id FROM upsert
    UNION ALL
    SELECT id FROM app_users WHERE email = $1
    LIMIT 1;
  `, [adminEmail]);
  const adminUserId = Number(adminUserResult.rows[0]?.id || 0);
  if (!adminUserId) {
    const err = new Error("Could not resolve admin user id.");
    err.code = "ADMIN_USER_RESOLUTION_FAILED";
    throw err;
  }

  await client.query(`
    INSERT INTO user_workspace_balance (user_id, balance)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO NOTHING;
  `, [adminUserId, DEFAULT_BALANCE]);

  const adminPortfolioCountResult = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM user_workspace_portfolio
    WHERE user_id = $1;
  `, [adminUserId]);
  const adminPortfolioCount = Number(adminPortfolioCountResult.rows[0]?.count || 0);

  let insertedPortfolio = 0;
  let copiedPortfolioFrom = null;
  if (adminPortfolioCount === 0) {
    const portfolioFromGuestResult = await client.query(`
      INSERT INTO user_workspace_portfolio (
        user_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
      )
      SELECT
        $1, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
      FROM user_workspace_portfolio
      WHERE user_id = 1 AND quantity > $2
      ON CONFLICT (user_id, symbol, market_type, strategy_name) DO NOTHING;
    `, [adminUserId, QTY_EPSILON]);
    insertedPortfolio = Number(portfolioFromGuestResult.rowCount || 0);
    copiedPortfolioFrom = insertedPortfolio > 0 ? "guest_workspace" : null;

    if (insertedPortfolio === 0) {
      const portfolioFromLegacyResult = await client.query(`
        INSERT INTO user_workspace_portfolio (
          user_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
        )
        SELECT
          $1, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
        FROM portfolio_holdings
        WHERE quantity > $2
        ON CONFLICT (user_id, symbol, market_type, strategy_name) DO NOTHING;
      `, [adminUserId, QTY_EPSILON]);
      insertedPortfolio = Number(portfolioFromLegacyResult.rowCount || 0);
      copiedPortfolioFrom = insertedPortfolio > 0 ? "legacy_portfolio_holdings" : null;
    }
  }

  const adminWatchlistCountResult = await client.query(`
    SELECT COUNT(*)::int AS count
    FROM user_workspace_watchlist
    WHERE user_id = $1;
  `, [adminUserId]);
  const adminWatchlistCount = Number(adminWatchlistCountResult.rows[0]?.count || 0);

  let insertedWatchlist = 0;
  let copiedWatchlistFrom = null;
  if (adminWatchlistCount === 0) {
    const watchlistFromGuestResult = await client.query(`
      INSERT INTO user_workspace_watchlist (
        user_id, symbol, name, type, category, theme, market_type, date_added
      )
      SELECT
        $1, symbol, name, type, category, theme, market_type, date_added
      FROM user_workspace_watchlist
      WHERE user_id = 1
      ON CONFLICT (user_id, symbol, market_type, category, theme) DO NOTHING;
    `, [adminUserId]);
    insertedWatchlist = Number(watchlistFromGuestResult.rowCount || 0);
    copiedWatchlistFrom = insertedWatchlist > 0 ? "guest_workspace" : null;

    if (insertedWatchlist === 0) {
      const watchlistFromLegacyResult = await client.query(`
        INSERT INTO user_workspace_watchlist (
          user_id, symbol, name, type, category, theme, market_type, date_added
        )
        SELECT
          $1, symbol, name, type, category, theme, market_type, date_added
        FROM watchlist_assets
        ON CONFLICT (user_id, symbol, market_type, category, theme) DO NOTHING;
      `, [adminUserId]);
      insertedWatchlist = Number(watchlistFromLegacyResult.rowCount || 0);
      copiedWatchlistFrom = insertedWatchlist > 0 ? "legacy_watchlist_assets" : null;
    }
  }

  const payload = {
    ranAt: new Date().toISOString(),
    adminEmail,
    adminUserId,
    insertedPortfolio,
    insertedWatchlist,
    copiedPortfolioFrom,
    copiedWatchlistFrom
  };

  if (markRun) {
    await client.query(`
      INSERT INTO service_snapshots (snapshot_key, payload_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (snapshot_key)
      DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = NOW();
    `, [ADMIN_WORKSPACE_MIGRATION_SNAPSHOT_KEY, JSON.stringify(payload)]);
  }

  return {
    skipped: false,
    alreadyRan: false,
    ...payload
  };
}

async function runAdminWorkspaceMigration({ force = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await runAdminWorkspaceMigrationTx(client, { force, markRun: true });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
        strategy_name TEXT,
        legs_json JSONB,
        date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(symbol, market_type, strategy_name)
      );
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      ADD COLUMN IF NOT EXISTS entry_price DOUBLE PRECISION;
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      ADD COLUMN IF NOT EXISTS strategy_name TEXT;
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      ADD COLUMN IF NOT EXISTS legs_json JSONB;
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      DROP CONSTRAINT IF EXISTS portfolio_holdings_symbol_market_type_key;
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      DROP CONSTRAINT IF EXISTS portfolio_holdings_symbol_market_type_strategy_name_key;
    `);

    await client.query(`
      ALTER TABLE portfolio_holdings
      ADD CONSTRAINT portfolio_holdings_symbol_market_type_strategy_name_key
      UNIQUE (symbol, market_type, strategy_name);
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
        category TEXT,
        theme TEXT,
        market_type TEXT NOT NULL,
        date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(symbol, market_type)
      );
    `);

    await client.query(`
      ALTER TABLE watchlist_assets
      ADD COLUMN IF NOT EXISTS category TEXT;
    `);

    await client.query(`
      ALTER TABLE watchlist_assets
      ADD COLUMN IF NOT EXISTS theme TEXT;
    `);

    await client.query(`
      ALTER TABLE watchlist_assets
      DROP CONSTRAINT IF EXISTS watchlist_assets_symbol_market_type_key;
    `);

    await client.query(`
      DROP INDEX IF EXISTS watchlist_assets_symbol_market_type_key;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_watchlist_assets_lookup
      ON watchlist_assets (symbol, market_type, category, theme, date_added DESC);
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
      CREATE TABLE IF NOT EXISTS service_snapshots (
        snapshot_key TEXT PRIMARY KEY,
        payload_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        fee DOUBLE PRECISION,
        slippage DOUBLE PRECISION,
        reference_price DOUBLE PRECISION,
        execution_meta_json JSONB,
        balance_after DOUBLE PRECISION,
        portfolio_value_after DOUBLE PRECISION,
        account_equity_after DOUBLE PRECISION,
        position_after DOUBLE PRECISION,
        strategy_name TEXT,
        legs_json JSONB
      );
    `);

    await client.query(`
      ALTER TABLE trade_executions
      ADD COLUMN IF NOT EXISTS strategy_name TEXT;
    `);

    await client.query(`
      ALTER TABLE trade_executions
      ADD COLUMN IF NOT EXISTS legs_json JSONB;
    `);

    await client.query(`
      ALTER TABLE trade_executions
      ADD COLUMN IF NOT EXISTS fee DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS slippage DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS reference_price DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS execution_meta_json JSONB;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL DEFAULT '',
        display_name TEXT,
        auth_provider TEXT NOT NULL DEFAULT 'email',
        email_verified BOOLEAN NOT NULL DEFAULT FALSE,
        pending_email TEXT,
        pending_email_code_hash TEXT,
        pending_email_requested_at TIMESTAMPTZ,
        password_changed_at TIMESTAMPTZ,
        two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        two_factor_method TEXT,
        two_factor_secret_hash TEXT,
        two_factor_provider TEXT,
        two_factor_target TEXT,
        two_factor_enabled_at TIMESTAMPTZ,
        backup_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        passkeys_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        current_plan TEXT NOT NULL DEFAULT 'starter',
        current_billing_cycle TEXT NOT NULL DEFAULT 'monthly',
        plan_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS pending_email TEXT;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS pending_email_code_hash TEXT;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS pending_email_requested_at TIMESTAMPTZ;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS two_factor_provider TEXT;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS two_factor_target TEXT;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS two_factor_enabled_at TIMESTAMPTZ;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS backup_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS failed_login_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS current_plan TEXT NOT NULL DEFAULT 'starter';
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS current_billing_cycle TEXT NOT NULL DEFAULT 'monthly';
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_system_logs (
        id SERIAL PRIMARY KEY,
        level TEXT NOT NULL, -- 'INFO', 'WARNING', 'ERROR', 'CRITICAL'
        message TEXT NOT NULL,
        context_json JSONB,
        request_id TEXT,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Ensure the root admin email is always an admin
    const adminEmail = String(process.env.ADMIN_EMAIL || "admin@zenin.app").trim().toLowerCase();
    await client.query(`
      UPDATE app_users SET is_admin = TRUE WHERE email = $1;
    `, [adminEmail]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        user_agent TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_balance (
        user_id INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
        balance DOUBLE PRECISION NOT NULL DEFAULT 10000,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_cash (
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        currency TEXT NOT NULL,
        balance DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, currency)
      );
    `);

    // Migrate existing balance to USD cash if not already there
    await client.query(`
      INSERT INTO user_workspace_cash (user_id, currency, balance)
      SELECT user_id, 'USD', balance FROM user_workspace_balance
      ON CONFLICT (user_id, currency) DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_portfolio (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        quantity DOUBLE PRECISION NOT NULL,
        entry_price DOUBLE PRECISION,
        opened_at TIMESTAMPTZ,
        type TEXT NOT NULL,
        market_type TEXT NOT NULL,
        order_type TEXT NOT NULL,
        strategy_name TEXT,
        legs_json JSONB,
        date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, symbol, market_type, strategy_name)
      );
    `);

    await client.query(`
      ALTER TABLE user_workspace_portfolio ADD COLUMN IF NOT EXISTS funding_rate DOUBLE PRECISION;
      ALTER TABLE user_workspace_portfolio ADD COLUMN IF NOT EXISTS open_interest DOUBLE PRECISION;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_watchlist (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT,
        theme TEXT,
        market_type TEXT NOT NULL,
        date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, symbol, market_type, category, theme)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_trades (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        client_id TEXT,
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
        fee DOUBLE PRECISION,
        slippage DOUBLE PRECISION,
        reference_price DOUBLE PRECISION,
        execution_meta_json JSONB,
        balance_after DOUBLE PRECISION,
        portfolio_value_after DOUBLE PRECISION,
        account_equity_after DOUBLE PRECISION,
        position_after DOUBLE PRECISION,
        strategy_name TEXT,
        legs_json JSONB,
        UNIQUE(user_id, client_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_options_calculations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
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
      ALTER TABLE user_workspace_trades
      ADD COLUMN IF NOT EXISTS fee DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS slippage DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS reference_price DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS execution_meta_json JSONB;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_documents (
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, namespace)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_collections (
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, namespace)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id SERIAL PRIMARY KEY,
        admin_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        target_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_exchange_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        exchange TEXT NOT NULL,
        api_key TEXT NOT NULL,
        api_secret TEXT,
        extra_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
      ON auth_sessions (user_id, revoked_at, expires_at);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_active
      ON password_reset_tokens (user_id, expires_at, used_at);
    `);

    await client.query(`
      INSERT INTO app_users (id, email, password_hash, display_name, auth_provider, email_verified, current_plan)
      VALUES (1, 'guest@zenin.app', '', 'Guest User', 'guest', TRUE, 'desk')
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('app_users', 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM app_users), 1),
        true
      );
    `);

    await client.query(`
      INSERT INTO user_workspace_balance (user_id, balance)
      VALUES (1, $1)
      ON CONFLICT (user_id) DO NOTHING;
    `, [DEFAULT_BALANCE]);

    await runAdminWorkspaceMigrationTx(client, { force: false, markRun: true });

    const guestWatchlistCountResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM user_workspace_watchlist
      WHERE user_id = 1;
    `);

    const guestWatchlistCount = Number(guestWatchlistCountResult.rows[0]?.count || 0);
    if (guestWatchlistCount === 0) {
      await client.query(`
        INSERT INTO user_workspace_watchlist (user_id, symbol, name, type, category, theme, market_type, date_added)
        SELECT
          1 AS user_id,
          symbol,
          name,
          type,
          category,
          theme,
          market_type,
          date_added
        FROM watchlist_assets;
      `);
    }

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
          const assetCategory = String(asset.category || category || "").trim().toLowerCase() || null;
          const assetTheme = String(asset.theme || "").trim() || null;

          await client.query(`
            INSERT INTO watchlist_assets (symbol, name, type, category, theme, market_type, date_added)
            SELECT $1, $2, $3, $4, $5, $6, $7
            WHERE NOT EXISTS (
              SELECT 1
              FROM watchlist_assets
              WHERE symbol = $1
                AND market_type = $6
                AND COALESCE(category, '') = COALESCE($4, '')
                AND COALESCE(theme, '') = COALESCE($5, '')
            );
          `, [
            symbol,
            String(asset.name || symbol),
            type,
            assetCategory,
            assetTheme,
            marketType,
            insertedAt
          ]);
        }
      }
    }

    const seededWatchlistMeta = new Map();
    for (const [category, assets] of Object.entries(watchlistData)) {
      for (const asset of assets) {
        const symbol = String(asset.symbol || "").trim().toUpperCase();
        if (!symbol) continue;
        const type = String(asset.type || asset.theme || category || "stock").trim().toLowerCase();
        const marketType = normalizeMarketType(type, asset.marketType);
        const key = `${symbol}::${marketType}`;
        if (seededWatchlistMeta.has(key)) continue;
        seededWatchlistMeta.set(key, {
          category: String(asset.category || category || "").trim().toLowerCase() || null,
          theme: String(asset.theme || "").trim() || null
        });
      }
    }

    for (const [key, meta] of seededWatchlistMeta.entries()) {
      const [symbol, marketType] = key.split("::");
      await client.query(`
        UPDATE watchlist_assets
        SET
          category = COALESCE(category, $3),
          theme = COALESCE(theme, $4)
        WHERE symbol = $1 AND market_type = $2;
      `, [symbol, marketType, meta.category, meta.theme]);
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
        strategy_name AS "strategyName",
        legs_json AS "legsJson",
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
    const strategyName = holding.strategyName || holding.strategy_name || null;
    const legsJson = parseJsonPayload(holding.legsJson || holding.legs_json);
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
        WHERE symbol = $1 AND market_type = $2 AND (strategy_name IS NOT DISTINCT FROM $3)
        FOR UPDATE;
      `, [symbol, marketType, strategyName]);

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
          SET quantity = $1, price = $2, entry_price = $3, opened_at = $4, order_type = $5, date_added = $6, type = $7, name = $8, legs_json = $9
          WHERE id = $10
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
            strategy_name AS "strategyName",
            legs_json AS "legsJson",
            date_added;
        `, [nextQuantity, price, nextEntryPrice, nextOpenedAt, orderType, dateAdded, type, name, JSON.stringify(legsJson), existing.id]);

        await client.query("COMMIT");
        return mapPortfolioRow(updatedResult.rows[0]);
      }

      if (isSell) {
        throw new Error(`No existing position for ${symbol} (${marketType}) to sell`);
      }

      const insertedResult = await client.query(`
        INSERT INTO portfolio_holdings (symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
          strategy_name AS "strategyName",
          legs_json AS "legsJson",
          date_added;
      `, [symbol, name, price, quantity, price, dateAdded, type, marketType, orderType, strategyName, JSON.stringify(legsJson), dateAdded]);

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
      WHERE symbol = $1 AND market_type = $2 AND (strategy_name IS NOT DISTINCT FROM $3)
      ORDER BY date_added DESC;
    `, [cleanSymbol, cleanMarketType, (holding?.strategyName || holding?.strategy_name || null)]);
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
        position_after AS "positionAfter",
        strategy_name AS "strategyName",
        legs_json AS "legsJson"
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
      position_after: Number.isFinite(Number(trade.positionAfter)) ? Number(trade.positionAfter) : null,
      strategy_name: trade.strategyName || trade.strategy_name || null,
      legs_json: parseJsonPayload(trade.legsJson || trade.legs_json)
    };

    try {
      const result = await pool.query(`
        INSERT INTO trade_executions (
          client_id, date, executed_at, asset, name, type, side, market_type, status,
          quantity, price, notional, balance_after, portfolio_value_after, account_equity_after, position_after,
          strategy_name, legs_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
          fee,
          slippage,
          reference_price AS "referencePrice",
          execution_meta_json AS "executionMeta",
          balance_after AS "balanceAfter",
          portfolio_value_after AS "portfolioValueAfter",
          account_equity_after AS "accountEquityAfter",
          position_after AS "positionAfter",
          strategy_name AS "strategyName",
          legs_json AS "legsJson";
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
        normalized.position_after,
        normalized.strategy_name,
        JSON.stringify(normalized.legs_json)
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

const trading = {
  executeTrade: async (payload) => {
    const symbol = String(payload.symbol || "").trim().toUpperCase();
    const name = String(payload.name || symbol || "UNKNOWN");
    const type = String(payload.type || "stock").trim().toLowerCase();
    const marketType = normalizeMarketType(type, payload.marketType);
    const orderType = String(payload.orderType || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
    const quantity = Math.abs(toNumber(payload.quantity));
    const price = toNumber(payload.price);
    const notional = Number((price * quantity).toFixed(8));
    const dateAdded = payload.date_added || new Date().toISOString();
    const executionTimestamp = payload.executedAt || new Date().toISOString();
    const executionDate = toDateString(payload.date || executionTimestamp) || new Date().toISOString().slice(0, 10);
    const clientId = payload.clientId || null;
    const strategyName = payload.strategyName || payload.strategy_name || null;
    const legsJson = parseJsonPayload(payload.legsJson || payload.legs_json);

    if (!symbol) throw new Error("Invalid symbol");
    if (!Number.isFinite(quantity) || quantity <= QTY_EPSILON) throw new Error("Invalid quantity");
    if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const balanceRow = await client.query("SELECT balance FROM user_balance WHERE id = 1 FOR UPDATE");
      let currentBalance = balanceRow.rows[0]?.balance;
      if (currentBalance == null) {
        currentBalance = DEFAULT_BALANCE;
        await client.query(`
          INSERT INTO user_balance (id, balance)
          VALUES (1, $1)
          ON CONFLICT (id) DO NOTHING;
        `, [DEFAULT_BALANCE]);
      }
      const current = toNumber(currentBalance, DEFAULT_BALANCE);
      const nextBalance = orderType === "buy" ? current - notional : current + notional;
      if (nextBalance < 0) {
        const err = new Error("Insufficient balance");
        err.code = "INSUFFICIENT_BALANCE";
        throw err;
      }

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
        WHERE symbol = $1 AND market_type = $2 AND (strategy_name IS NOT DISTINCT FROM $3)
        FOR UPDATE;
      `, [symbol, marketType, strategyName]);

      const existing = existingResult.rows[0] ? mapPortfolioRow(existingResult.rows[0]) : null;
      let positionAfter = 0;

      if (existing) {
        if (orderType === "sell" && quantity > existing.quantity + QTY_EPSILON) {
          const err = new Error(`You can only sell up to ${existing.quantity} ${symbol}.`);
          err.code = "INSUFFICIENT_POSITION";
          throw err;
        }

        const nextQuantity = orderType === "sell"
          ? existing.quantity - quantity
          : existing.quantity + quantity;

        if (nextQuantity <= QTY_EPSILON) {
          await client.query("DELETE FROM portfolio_holdings WHERE id = $1", [existing.id]);
          positionAfter = 0;
        } else {
          const existingEntry = Number.isFinite(Number(existing.entryPrice))
            ? Number(existing.entryPrice)
            : Number(existing.price);
          const nextEntryPrice = orderType === "sell"
            ? existingEntry
            : ((existingEntry * existing.quantity) + (price * quantity)) / Math.max(nextQuantity, QTY_EPSILON);
          const nextOpenedAt = existing.openedAt || executionTimestamp || dateAdded;

          const updated = await client.query(`
            UPDATE portfolio_holdings
            SET quantity = $1, price = $2, entry_price = $3, opened_at = $4, order_type = $5, date_added = $6, type = $7, name = $8, legs_json = $9
            WHERE id = $10
            RETURNING quantity;
          `, [nextQuantity, price, nextEntryPrice, nextOpenedAt, orderType, dateAdded, type, name, JSON.stringify(legsJson), existing.id]);
          positionAfter = toNumber(updated.rows[0]?.quantity, 0);
        }
      } else {
        if (orderType === "sell") {
          const err = new Error(`No existing position for ${symbol} (${marketType}) to sell`);
          err.code = "NO_POSITION";
          throw err;
        }
        const inserted = await client.query(`
          INSERT INTO portfolio_holdings (symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING quantity;
        `, [symbol, name, price, quantity, price, executionTimestamp, type, marketType, orderType, strategyName, JSON.stringify(legsJson), dateAdded]);
        positionAfter = toNumber(inserted.rows[0]?.quantity, 0);
      }

      await client.query("UPDATE user_balance SET balance = $1 WHERE id = 1", [nextBalance]);

      const holdingsResult = await client.query(`
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
      const holdings = holdingsResult.rows.map(mapPortfolioRow);
      const portfolioValueAfter = holdings.reduce((total, h) => total + (toNumber(h.price) * toNumber(h.quantity)), 0);

      const tradeResult = await client.query(`
        INSERT INTO trade_executions (
          client_id, date, executed_at, asset, name, type, side, market_type, status,
          quantity, price, notional, balance_after, portfolio_value_after, account_equity_after, position_after,
          strategy_name, legs_json
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
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
          fee,
          slippage,
          reference_price AS "referencePrice",
          execution_meta_json AS "executionMeta",
          balance_after AS "balanceAfter",
          portfolio_value_after AS "portfolioValueAfter",
          account_equity_after AS "accountEquityAfter",
          position_after AS "positionAfter",
          strategy_name AS "strategyName",
          legs_json AS "legsJson";
      `, [
        clientId,
        executionDate,
        executionTimestamp,
        symbol,
        name,
        orderType === "sell" ? "SELL" : "BUY",
        orderType,
        marketType,
        "Filled",
        quantity,
        price,
        Math.abs(notional),
        nextBalance,
        portfolioValueAfter,
        nextBalance + portfolioValueAfter,
        positionAfter,
        strategyName,
        JSON.stringify(legsJson)
      ]);

      await client.query("COMMIT");
      return {
        balance: nextBalance,
        holdings,
        trade: mapTradeRow(tradeResult.rows[0])
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
        category,
        theme,
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
    const category = String(asset.category || "").trim().toLowerCase() || null;
    const theme = String(asset.theme || "").trim() || null;
    const marketType = normalizeMarketType(type, asset.marketType);
    const dateAdded = asset.date_added || new Date().toISOString();

    const updateResult = await pool.query(`
      UPDATE watchlist_assets
      SET
        name = $2,
        type = $3,
        category = $4,
        theme = $5,
        date_added = $7
      WHERE symbol = $1
        AND market_type = $6
        AND COALESCE(category, '') = COALESCE($4, '')
        AND COALESCE(theme, '') = COALESCE($5, '')
      RETURNING
        id,
        symbol,
        name,
        type,
        category,
        theme,
        market_type AS "marketType",
        date_added;
    `, [symbol, String(asset.name || symbol), type, category, theme, marketType, dateAdded]);

    if (updateResult.rows[0]) {
      return mapWatchlistRow(updateResult.rows[0]);
    }

    const insertResult = await pool.query(`
      INSERT INTO watchlist_assets (symbol, name, type, category, theme, market_type, date_added)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        symbol,
        name,
        type,
        category,
        theme,
        market_type AS "marketType",
        date_added;
    `, [symbol, String(asset.name || symbol), type, category, theme, marketType, dateAdded]);

    return mapWatchlistRow(insertResult.rows[0]);
  },

  delete: async (symbol, marketType, category = null, theme = null) => {
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
    const cleanCategory = String(category || "").trim().toLowerCase() || null;
    const cleanTheme = String(theme || "").trim() || null;

    if (cleanCategory || cleanTheme) {
      await pool.query(`
        DELETE FROM watchlist_assets
        WHERE symbol = $1
          AND market_type = $2
          AND COALESCE(category, '') = COALESCE($3, '')
          AND COALESCE(theme, '') = COALESCE($4, '');
      `, [cleanSymbol, cleanMarketType, cleanCategory, cleanTheme]);
      return {
        success: true,
        symbol: cleanSymbol,
        marketType: cleanMarketType,
        category: cleanCategory,
        theme: cleanTheme
      };
    }

    await pool.query("DELETE FROM watchlist_assets WHERE symbol = $1 AND market_type = $2", [cleanSymbol, cleanMarketType]);
    return { success: true, symbol: cleanSymbol, marketType: cleanMarketType, category: null, theme: null };
  },

  exists: async (symbol, marketType, category = null, theme = null) => {
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
    const cleanCategory = String(category || "").trim().toLowerCase() || null;
    const cleanTheme = String(theme || "").trim() || null;
    const result = cleanCategory || cleanTheme
      ? await pool.query(`
          SELECT id
          FROM watchlist_assets
          WHERE symbol = $1
            AND market_type = $2
            AND COALESCE(category, '') = COALESCE($3, '')
            AND COALESCE(theme, '') = COALESCE($4, '')
          LIMIT 1
        `, [cleanSymbol, cleanMarketType, cleanCategory, cleanTheme])
      : await pool.query(
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

const serviceSnapshots = {
  get: async (snapshotKey) => {
    const key = String(snapshotKey || "").trim();
    if (!key) return null;
    const result = await pool.query(`
      SELECT
        snapshot_key AS "snapshotKey",
        payload_json AS payload,
        updated_at AS "updatedAt"
      FROM service_snapshots
      WHERE snapshot_key = $1
      LIMIT 1;
    `, [key]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      snapshotKey: row.snapshotKey,
      payload: parseJsonPayload(row.payload, null),
      updatedAt: toIsoString(row.updatedAt)
    };
  },

  set: async (snapshotKey, payload) => {
    const key = String(snapshotKey || "").trim();
    if (!key) throw new Error("snapshotKey is required");
    const payloadJson = JSON.stringify(payload ?? {});
    const result = await pool.query(`
      INSERT INTO service_snapshots (snapshot_key, payload_json, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (snapshot_key)
      DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = NOW()
      RETURNING
        snapshot_key AS "snapshotKey",
        payload_json AS payload,
        updated_at AS "updatedAt";
    `, [key, payloadJson]);
    const row = result.rows[0];
    return {
      snapshotKey: row.snapshotKey,
      payload: parseJsonPayload(row.payload, null),
      updatedAt: toIsoString(row.updatedAt)
    };
  },

  delete: async (snapshotKey) => {
    const key = String(snapshotKey || "").trim();
    if (!key) return null;
    const result = await pool.query(`
      DELETE FROM service_snapshots
      WHERE snapshot_key = $1
      RETURNING
        snapshot_key AS "snapshotKey",
        payload_json AS payload,
        updated_at AS "updatedAt";
    `, [key]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      snapshotKey: row.snapshotKey,
      payload: parseJsonPayload(row.payload, null),
      updatedAt: toIsoString(row.updatedAt)
    };
  }
};

const userAuth = {
  createUser: async ({ email, passwordHash, displayName = null, authProvider = "email", emailVerified = false }) => {
    const result = await pool.query(`
      INSERT INTO app_users (email, password_hash, display_name, auth_provider, email_verified)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        email,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        auth_provider AS "authProvider",
        email_verified AS "emailVerified",
        pending_email AS "pendingEmail",
        pending_email_code_hash AS "pendingEmailCodeHash",
        pending_email_requested_at AS "pendingEmailRequestedAt",
        password_changed_at AS "passwordChangedAt",
        two_factor_enabled AS "twoFactorEnabled",
        two_factor_method AS "twoFactorMethod",
        two_factor_secret_hash AS "twoFactorSecretHash",
        two_factor_provider AS "twoFactorProvider",
        two_factor_target AS "twoFactorTarget",
        two_factor_enabled_at AS "twoFactorEnabledAt",
        backup_codes_json AS "backupCodes",
        passkeys_json AS passkeys,
        current_plan AS "currentPlan",
        current_billing_cycle AS "currentBillingCycle",
        plan_updated_at AS "planUpdatedAt",
        created_at AS "createdAt";
    `, [
      String(email || "").trim().toLowerCase(),
      String(passwordHash || ""),
      displayName ? String(displayName) : null,
      String(authProvider || "email"),
      Boolean(emailVerified)
    ]);

    await pool.query(`
      INSERT INTO user_workspace_balance (user_id, balance)
      VALUES ($1, $2)
      ON CONFLICT (user_id) DO NOTHING;
    `, [result.rows[0].id, DEFAULT_BALANCE]);

    return mapAuthUserRow(result.rows[0]);
  },

  upsertOAuthUser: async ({ email, displayName, authProvider }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const existingResult = await pool.query(`SELECT id FROM app_users WHERE email = $1`, [normalizedEmail]);

    if (existingResult.rows[0]) {
      const updateResult = await pool.query(`
        UPDATE app_users
        SET 
          auth_provider = $2,
          display_name = COALESCE(display_name, $3),
          email_verified = TRUE,
          updated_at = NOW()
        WHERE email = $1
        RETURNING
          id, email, password_hash AS "passwordHash", display_name AS "displayName",
          auth_provider AS "authProvider", email_verified AS "emailVerified",
          pending_email AS "pendingEmail", pending_email_code_hash AS "pendingEmailCodeHash",
          pending_email_requested_at AS "pendingEmailRequestedAt", password_changed_at AS "passwordChangedAt",
          two_factor_enabled AS "twoFactorEnabled", two_factor_method AS "twoFactorMethod",
          two_factor_secret_hash AS "twoFactorSecretHash", two_factor_provider AS "twoFactorProvider",
          two_factor_target AS "twoFactorTarget", two_factor_enabled_at AS "twoFactorEnabledAt",
          backup_codes_json AS "backupCodes", passkeys_json AS passkeys,
          current_plan AS "currentPlan", current_billing_cycle AS "currentBillingCycle",
          plan_updated_at AS "planUpdatedAt", created_at AS "createdAt";
      `, [normalizedEmail, authProvider, displayName]);
      return mapAuthUserRow(updateResult.rows[0]);
    } else {
      return await userAuth.createUser({
        email: normalizedEmail,
        passwordHash: "",
        displayName,
        authProvider,
        emailVerified: true
      });
    }
  },

  findUserByEmail: async (email) => {
    const result = await pool.query(`
      SELECT
        id,
        email,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        auth_provider AS "authProvider",
        email_verified AS "emailVerified",
        pending_email AS "pendingEmail",
        pending_email_code_hash AS "pendingEmailCodeHash",
        pending_email_requested_at AS "pendingEmailRequestedAt",
        password_changed_at AS "passwordChangedAt",
        two_factor_enabled AS "twoFactorEnabled",
        two_factor_method AS "twoFactorMethod",
        two_factor_secret_hash AS "twoFactorSecretHash",
        two_factor_provider AS "twoFactorProvider",
        two_factor_target AS "twoFactorTarget",
        two_factor_enabled_at AS "twoFactorEnabledAt",
        backup_codes_json AS "backupCodes",
        passkeys_json AS passkeys,
        current_plan AS "currentPlan",
        current_billing_cycle AS "currentBillingCycle",
        plan_updated_at AS "planUpdatedAt",
        failed_login_count AS "failedLoginCount",
        locked_until AS "lockedUntil",
        created_at AS "createdAt"
      FROM app_users
      WHERE email = $1
      LIMIT 1;
    `, [String(email || "").trim().toLowerCase()]);
    const row = result.rows[0];
    if (!row) return null;
    return mapAuthUserRow(row);
  },

  findUserById: async (userId) => {
    const result = await pool.query(`
      SELECT
        id,
        email,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        auth_provider AS "authProvider",
        email_verified AS "emailVerified",
        pending_email AS "pendingEmail",
        pending_email_code_hash AS "pendingEmailCodeHash",
        pending_email_requested_at AS "pendingEmailRequestedAt",
        password_changed_at AS "passwordChangedAt",
        two_factor_enabled AS "twoFactorEnabled",
        two_factor_method AS "twoFactorMethod",
        two_factor_provider AS "twoFactorProvider",
        two_factor_target AS "twoFactorTarget",
        two_factor_enabled_at AS "twoFactorEnabledAt",
        backup_codes_json AS "backupCodes",
        passkeys_json AS passkeys,
        current_plan AS "currentPlan",
        current_billing_cycle AS "currentBillingCycle",
        plan_updated_at AS "planUpdatedAt",
        failed_login_count AS "failedLoginCount",
        locked_until AS "lockedUntil",
        created_at AS "createdAt"
      FROM app_users
      WHERE id = $1
      LIMIT 1;
    `, [toUserId(userId)]);
    const row = result.rows[0];
    if (!row) return null;
    return mapAuthUserRow(row);
  },

  createSession: async ({ userId, tokenHash, expiresAt, ipAddress = null, userAgent = null }) => {
    const result = await pool.query(`
      INSERT INTO auth_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, user_id AS "userId", expires_at AS "expiresAt", created_at AS "createdAt";
    `, [
      toUserId(userId),
      String(tokenHash || ""),
      ipAddress ? String(ipAddress) : null,
      userAgent ? String(userAgent).slice(0, 512) : null,
      expiresAt
    ]);
    return result.rows[0];
  },

  findSessionByTokenHash: async (tokenHash) => {
    const result = await pool.query(`
      SELECT
        s.id,
        s.user_id AS "userId",
        s.expires_at AS "expiresAt",
        s.revoked_at AS "revokedAt",
        u.email,
        u.display_name AS "displayName",
        u.auth_provider AS "authProvider",
        u.email_verified AS "emailVerified",
        u.is_admin AS "isAdmin",
        u.pending_email AS "pendingEmail",
        u.pending_email_requested_at AS "pendingEmailRequestedAt",
        u.password_changed_at AS "passwordChangedAt",
        u.two_factor_enabled AS "twoFactorEnabled",
        u.two_factor_method AS "twoFactorMethod",
        u.two_factor_provider AS "twoFactorProvider",
        u.two_factor_target AS "twoFactorTarget",
        u.two_factor_enabled_at AS "twoFactorEnabledAt",
        u.backup_codes_json AS "backupCodes",
        u.passkeys_json AS passkeys,
        u.current_plan AS "currentPlan",
        u.current_billing_cycle AS "currentBillingCycle",
        u.plan_updated_at AS "planUpdatedAt"
      FROM auth_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
      LIMIT 1;
    `, [String(tokenHash || "")]);
    const row = result.rows[0];
    if (!row) return null;
    return mapAuthUserRow(row);
  },

  revokeSessionByTokenHash: async (tokenHash) => {
    await pool.query(`
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL;
    `, [String(tokenHash || "")]);
  },

  revokeSessionsByUserId: async (userId) => {
    await pool.query(`
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL;
    `, [toUserId(userId)]);
  },

  updatePassword: async (userId, passwordHash) => {
    const result = await pool.query(`
      UPDATE app_users
      SET password_hash = $2, password_changed_at = NOW(), updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId), String(passwordHash || "")]);
    return result.rowCount > 0;
  },

  requestEmailChange: async ({ userId, nextEmail, codeHash }) => {
    const result = await pool.query(`
      UPDATE app_users
      SET
        pending_email = $2,
        pending_email_code_hash = $3,
        pending_email_requested_at = NOW(),
        email_verified = FALSE,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        email,
        password_hash AS "passwordHash",
        display_name AS "displayName",
        auth_provider AS "authProvider",
        email_verified AS "emailVerified",
        pending_email AS "pendingEmail",
        pending_email_code_hash AS "pendingEmailCodeHash",
        pending_email_requested_at AS "pendingEmailRequestedAt",
        password_changed_at AS "passwordChangedAt",
        two_factor_enabled AS "twoFactorEnabled",
        two_factor_method AS "twoFactorMethod",
        two_factor_secret_hash AS "twoFactorSecretHash",
        two_factor_provider AS "twoFactorProvider",
        two_factor_target AS "twoFactorTarget",
        two_factor_enabled_at AS "twoFactorEnabledAt",
        backup_codes_json AS "backupCodes",
        passkeys_json AS passkeys,
        current_plan AS "currentPlan",
        current_billing_cycle AS "currentBillingCycle",
        plan_updated_at AS "planUpdatedAt",
        created_at AS "createdAt";
    `, [toUserId(userId), String(nextEmail || "").trim().toLowerCase(), String(codeHash || "")]);
    return mapAuthUserRow(result.rows[0]);
  },

  confirmEmailChange: async ({ userId, expectedCodeHash }) => {
    const resolvedUserId = toUserId(userId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(`
        SELECT
          id,
          email,
          password_hash AS "passwordHash",
          display_name AS "displayName",
          auth_provider AS "authProvider",
          email_verified AS "emailVerified",
          pending_email AS "pendingEmail",
          pending_email_code_hash AS "pendingEmailCodeHash",
          pending_email_requested_at AS "pendingEmailRequestedAt",
          password_changed_at AS "passwordChangedAt",
          two_factor_enabled AS "twoFactorEnabled",
          two_factor_method AS "twoFactorMethod",
          two_factor_secret_hash AS "twoFactorSecretHash",
          two_factor_provider AS "twoFactorProvider",
          two_factor_target AS "twoFactorTarget",
          two_factor_enabled_at AS "twoFactorEnabledAt",
          backup_codes_json AS "backupCodes",
          passkeys_json AS passkeys,
          current_plan AS "currentPlan",
          current_billing_cycle AS "currentBillingCycle",
          plan_updated_at AS "planUpdatedAt",
          created_at AS "createdAt"
        FROM app_users
        WHERE id = $1
        LIMIT 1
        FOR UPDATE;
      `, [resolvedUserId]);
      const row = mapAuthUserRow(found.rows[0]);
      if (!row || !row.pendingEmail || !row.pendingEmailCodeHash) {
        await client.query("ROLLBACK");
        return null;
      }
      if (String(row.pendingEmailCodeHash || "") !== String(expectedCodeHash || "")) {
        await client.query("ROLLBACK");
        return false;
      }
      const updated = await client.query(`
        UPDATE app_users
        SET
          email = pending_email,
          pending_email = NULL,
          pending_email_code_hash = NULL,
          pending_email_requested_at = NULL,
          email_verified = TRUE,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          email,
          password_hash AS "passwordHash",
          display_name AS "displayName",
          auth_provider AS "authProvider",
          email_verified AS "emailVerified",
          pending_email AS "pendingEmail",
          pending_email_code_hash AS "pendingEmailCodeHash",
          pending_email_requested_at AS "pendingEmailRequestedAt",
          password_changed_at AS "passwordChangedAt",
          two_factor_enabled AS "twoFactorEnabled",
          two_factor_method AS "twoFactorMethod",
          two_factor_secret_hash AS "twoFactorSecretHash",
          two_factor_provider AS "twoFactorProvider",
          two_factor_target AS "twoFactorTarget",
          two_factor_enabled_at AS "twoFactorEnabledAt",
          backup_codes_json AS "backupCodes",
          passkeys_json AS passkeys,
          current_plan AS "currentPlan",
          current_billing_cycle AS "currentBillingCycle",
          plan_updated_at AS "planUpdatedAt",
          created_at AS "createdAt";
      `, [resolvedUserId]);
      await client.query("COMMIT");
      return mapAuthUserRow(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  clearPendingEmailChange: async (userId) => {
    await pool.query(`
      UPDATE app_users
      SET
        pending_email = NULL,
        pending_email_code_hash = NULL,
        pending_email_requested_at = NULL,
        updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId)]);
  },

  createPasswordResetToken: async ({ userId, tokenHash, expiresAt }) => {
    await pool.query(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3);
    `, [toUserId(userId), String(tokenHash || ""), expiresAt]);
  },

  consumePasswordResetToken: async (tokenHash) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(`
        SELECT id, user_id AS "userId", expires_at AS "expiresAt", used_at AS "usedAt"
        FROM password_reset_tokens
        WHERE token_hash = $1
        LIMIT 1
        FOR UPDATE;
      `, [String(tokenHash || "")]);
      const row = found.rows[0];
      if (!row || row.usedAt) {
        await client.query("ROLLBACK");
        return null;
      }
      if (new Date(row.expiresAt).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(`
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE id = $1;
      `, [row.id]);
      await client.query("COMMIT");
      return row;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  upsertTwoFactor: async ({ userId, enabled, method = null, secretHash = null, provider = null, target = null, backupCodes = null }) => {
    await pool.query(`
      UPDATE app_users
      SET
        two_factor_enabled = $2,
        two_factor_method = $3,
        two_factor_secret_hash = $4,
        two_factor_provider = $5,
        two_factor_target = $6,
        two_factor_enabled_at = CASE WHEN $2 THEN COALESCE(two_factor_enabled_at, NOW()) ELSE NULL END,
        backup_codes_json = COALESCE($7::jsonb, backup_codes_json),
        updated_at = NOW()
      WHERE id = $1;
    `, [
      toUserId(userId),
      Boolean(enabled),
      method,
      secretHash,
      provider,
      target,
      backupCodes == null ? null : JSON.stringify(Array.isArray(backupCodes) ? backupCodes : [])
    ]);
  },

  regenerateBackupCodes: async ({ userId, backupCodes }) => {
    await pool.query(`
      UPDATE app_users
      SET backup_codes_json = $2::jsonb, updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId), JSON.stringify(Array.isArray(backupCodes) ? backupCodes : [])]);
  },

  addPasskey: async ({ userId, passkey, backupCodes = null }) => {
    const user = await userAuth.findUserById(userId);
    const current = Array.isArray(user?.passkeys) ? user.passkeys : [];
    const next = [passkey, ...current].slice(0, 20);
    await pool.query(`
      UPDATE app_users
      SET
        passkeys_json = $2::jsonb,
        two_factor_enabled = TRUE,
        two_factor_method = 'passkey',
        two_factor_provider = $3,
        two_factor_target = $4,
        two_factor_enabled_at = COALESCE(two_factor_enabled_at, NOW()),
        backup_codes_json = COALESCE($5::jsonb, backup_codes_json),
        updated_at = NOW()
      WHERE id = $1;
    `, [
      toUserId(userId),
      JSON.stringify(next),
      passkey?.provider || null,
      passkey?.name || null,
      backupCodes == null ? null : JSON.stringify(Array.isArray(backupCodes) ? backupCodes : [])
    ]);
  },

  updateCurrentPlan: async (userId, plan, billingCycle = "monthly") => {
    const normalizedPlan = normalizePlanValue(plan);
    const normalizedBillingCycle = normalizeBillingCycleValue(billingCycle);
    const result = await pool.query(`
      UPDATE app_users
      SET
        current_plan = $2,
        current_billing_cycle = $3,
        plan_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        email,
        display_name AS "displayName",
        auth_provider AS "authProvider",
        email_verified AS "emailVerified",
        two_factor_enabled AS "twoFactorEnabled",
        two_factor_method AS "twoFactorMethod",
        passkeys_json AS passkeys,
        current_plan AS "currentPlan",
        current_billing_cycle AS "currentBillingCycle",
        plan_updated_at AS "planUpdatedAt",
        created_at AS "createdAt";
    `, [toUserId(userId), normalizedPlan, normalizedBillingCycle]);
    const row = result.rows[0];
    if (!row) return null;
    return mapAuthUserRow(row);
  },

  incrementFailedLogin: async (userId) => {
    await pool.query(`
      UPDATE app_users
      SET failed_login_count = failed_login_count + 1,
          updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId)]);
  },

  resetFailedLogin: async (userId) => {
    await pool.query(`
      UPDATE app_users
      SET failed_login_count = 0,
          locked_until = NULL,
          updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId)]);
  },

  lockAccountUntil: async (userId, lockedUntil) => {
    await pool.query(`
      UPDATE app_users
      SET locked_until = $2,
          updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId), lockedUntil]);
  }
};

const userWorkspace = {
  exchangeKeys: {
    list: async (userId) => {
      const result = await pool.query(`
        SELECT id, exchange, api_key AS "apiKey", extra_data AS "extraData", created_at AS "createdAt"
        FROM user_exchange_keys
        WHERE user_id = $1
        ORDER BY created_at DESC;
      `, [toUserId(userId)]);
      return result.rows;
    },
    add: async (userId, payload) => {
      const { exchange, apiKey, apiSecret, extraData } = payload;
      const result = await pool.query(`
        INSERT INTO user_exchange_keys (user_id, exchange, api_key, api_secret, extra_data)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, exchange, api_key AS "apiKey", extra_data AS "extraData";
      `, [toUserId(userId), exchange, apiKey, apiSecret, extraData || {}]);
      return result.rows[0];
    },
    remove: async (userId, id) => {
      await pool.query(`
        DELETE FROM user_exchange_keys
        WHERE id = $1 AND user_id = $2;
      `, [id, toUserId(userId)]);
    },
    getById: async (userId, id) => {
      const result = await pool.query(`
        SELECT id, exchange, api_key AS "apiKey", api_secret AS "apiSecret", extra_data AS "extraData"
        FROM user_exchange_keys
        WHERE id = $1 AND user_id = $2;
      `, [id, toUserId(userId)]);
      return result.rows[0];
    }
  },

  balance: {
    get: async (userId) => {
      const resolvedUserId = toUserId(userId);
      const result = await pool.query(`
        SELECT balance FROM user_workspace_balance WHERE user_id = $1 LIMIT 1;
      `, [resolvedUserId]);
      const current = result.rows[0]?.balance;
      if (current == null) {
        await pool.query(`
          INSERT INTO user_workspace_balance (user_id, balance)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO NOTHING;
        `, [resolvedUserId, DEFAULT_BALANCE]);
        return DEFAULT_BALANCE;
      }
      return toNumber(current, DEFAULT_BALANCE);
    },

    applyChange: async (userId, amount, type) => {
      const resolvedUserId = toUserId(userId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(`
          SELECT balance FROM user_workspace_balance WHERE user_id = $1 FOR UPDATE;
        `, [resolvedUserId]);
        let currentBalance = result.rows[0]?.balance;
        if (currentBalance == null) {
          currentBalance = DEFAULT_BALANCE;
          await client.query(`
            INSERT INTO user_workspace_balance (user_id, balance)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO NOTHING;
          `, [resolvedUserId, DEFAULT_BALANCE]);
        }
        const current = toNumber(currentBalance, DEFAULT_BALANCE);
        const next = type === "deposit" ? current + amount : current - amount;
        if (next < 0) {
          const err = new Error("Insufficient balance");
          err.code = "INSUFFICIENT_BALANCE";
          throw err;
        }
        await client.query(`
          UPDATE user_workspace_balance
          SET balance = $2, updated_at = NOW()
          WHERE user_id = $1;
        `, [resolvedUserId, next]);
        await client.query("COMMIT");
        return next;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  },

  portfolio: {
    getAll: async (userId) => {
      const resolvedUserId = toUserId(userId);
      await pool.query(`
        DELETE FROM user_workspace_portfolio
        WHERE user_id = $1 AND ABS(quantity) <= $2;
      `, [resolvedUserId, QTY_EPSILON]);
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
          strategy_name AS "strategyName",
          legs_json AS "legsJson",
          date_added
        FROM user_workspace_portfolio
        WHERE user_id = $1 AND quantity > $2
        ORDER BY date_added DESC;
      `, [resolvedUserId, QTY_EPSILON]);
      return result.rows.map(mapPortfolioRow);
    },
    sync: async (userId, exchange, holdings) => {
      const resolvedUserId = toUserId(userId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const strategyPrefix = `${exchange}%`;
        await client.query(`
          DELETE FROM user_workspace_portfolio
          WHERE user_id = $1 AND strategy_name LIKE $2;
        `, [resolvedUserId, strategyPrefix]);
        for (const h of holdings) {
          await client.query(`
            INSERT INTO user_workspace_portfolio (
              user_id, symbol, name, price, quantity, entry_price, opened_at, type,
              market_type, order_type, strategy_name, legs_json, date_added, funding_rate, open_interest
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            ON CONFLICT (user_id, symbol, market_type, strategy_name) DO UPDATE
            SET quantity = EXCLUDED.quantity, price = EXCLUDED.price, entry_price = EXCLUDED.entry_price,
                funding_rate = EXCLUDED.funding_rate, open_interest = EXCLUDED.open_interest, updated_at = NOW();
          `, [
            resolvedUserId, h.symbol, h.name, h.price || 0, h.quantity, h.entry_price || h.price || 0,
            h.opened_at || new Date().toISOString(), h.type, h.market_type, h.order_type, h.strategyName,
            JSON.stringify(h.legs_json || {}), h.date_added || new Date().toISOString(),
            h.fundingRate || null, h.openInterest || null
          ]);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    add: async (userId, holding) => {
      const resolvedUserId = toUserId(userId);
      const symbol = String(holding.symbol || "").trim().toUpperCase();
      const type = String(holding.type || "stock").trim().toLowerCase();
      const marketType = normalizeMarketType(type, holding.marketType);
      const orderType = String(holding.orderType || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
      const quantity = Math.abs(toNumber(holding.quantity));
      const price = toNumber(holding.price);
      const dateAdded = holding.date_added || new Date().toISOString();
      const name = String(holding.name || symbol || "Unknown");
      const strategyName = holding.strategyName || holding.strategy_name || null;
      const legsJson = parseJsonPayload(holding.legsJson || holding.legs_json);
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
            strategy_name AS "strategyName",
            legs_json AS "legsJson",
            date_added
          FROM user_workspace_portfolio
          WHERE user_id = $1
            AND symbol = $2
            AND market_type = $3
            AND (strategy_name IS NOT DISTINCT FROM $4)
          FOR UPDATE;
        `, [resolvedUserId, symbol, marketType, strategyName]);

        const existing = existingResult.rows[0] ? mapPortfolioRow(existingResult.rows[0]) : null;
        if (existing) {
          const nextQuantity = isSell ? existing.quantity - quantity : existing.quantity + quantity;
          if (nextQuantity <= QTY_EPSILON) {
            await client.query(`
              DELETE FROM user_workspace_portfolio
              WHERE id = $1 AND user_id = $2;
            `, [existing.id, resolvedUserId]);
            await client.query("COMMIT");
            return { id: existing.id, symbol, marketType, quantity: 0, closed: true };
          }

          const existingEntry = Number.isFinite(Number(existing.entryPrice))
            ? Number(existing.entryPrice)
            : Number(existing.price);
          const nextEntryPrice = isSell
            ? existingEntry
            : ((existingEntry * existing.quantity) + (price * quantity)) / Math.max(nextQuantity, QTY_EPSILON);
          const nextOpenedAt = existing.openedAt || dateAdded;
          const updatedResult = await client.query(`
            UPDATE user_workspace_portfolio
            SET quantity = $1, price = $2, entry_price = $3, opened_at = $4, order_type = $5, date_added = $6, type = $7, name = $8, legs_json = $9
            WHERE id = $10 AND user_id = $11
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
              strategy_name AS "strategyName",
              legs_json AS "legsJson",
              date_added;
          `, [nextQuantity, price, nextEntryPrice, nextOpenedAt, orderType, dateAdded, type, name, JSON.stringify(legsJson), existing.id, resolvedUserId]);
          await client.query("COMMIT");
          return mapPortfolioRow(updatedResult.rows[0]);
        }

        if (isSell) {
          throw new Error(`No existing position for ${symbol} (${marketType}) to sell`);
        }

        const insertedResult = await client.query(`
          INSERT INTO user_workspace_portfolio (user_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
            strategy_name AS "strategyName",
            legs_json AS "legsJson",
            date_added;
        `, [resolvedUserId, symbol, name, price, quantity, price, dateAdded, type, marketType, orderType, strategyName, JSON.stringify(legsJson), dateAdded]);
        await client.query("COMMIT");
        return mapPortfolioRow(insertedResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    update: async (userId, id, holding) => {
      const resolvedUserId = toUserId(userId);
      const price = toNumber(holding.price);
      const quantity = toNumber(holding.quantity);
      const result = await pool.query(`
        UPDATE user_workspace_portfolio
        SET price = $1, quantity = $2
        WHERE id = $3 AND user_id = $4
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
          strategy_name AS "strategyName",
          legs_json AS "legsJson",
          date_added;
      `, [price, quantity, id, resolvedUserId]);
      if (result.rows.length === 0) throw new Error("Holding not found");
      return mapPortfolioRow(result.rows[0]);
    },

    delete: async (userId, id) => {
      await pool.query(`
        DELETE FROM user_workspace_portfolio
        WHERE id = $1 AND user_id = $2;
      `, [id, toUserId(userId)]);
      return { success: true, id: Number(id) };
    },

    findBySymbol: async (userId, symbol, marketType) => {
      const resolvedUserId = toUserId(userId);
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
          strategy_name AS "strategyName",
          legs_json AS "legsJson",
          date_added
        FROM user_workspace_portfolio
        WHERE user_id = $1 AND symbol = $2 AND market_type = $3
        ORDER BY date_added DESC;
      `, [resolvedUserId, cleanSymbol, cleanMarketType]);
      return result.rows.map(mapPortfolioRow);
    }
  },

  cash: {
    getAll: async (userId) => {
      const resolvedUserId = toUserId(userId);
      const result = await pool.query(`
        SELECT currency, balance, updated_at AS "updatedAt"
        FROM user_workspace_cash
        WHERE user_id = $1
        ORDER BY currency ASC;
      `, [resolvedUserId]);
      return result.rows.map(row => ({
        currency: row.currency,
        balance: toNumber(row.balance),
        updatedAt: toIsoString(row.updatedAt)
      }));
    },

    applyChange: async (userId, currency, amount, type = "deposit") => {
      const resolvedUserId = toUserId(userId);
      const cur = String(currency || "USD").toUpperCase();
      const val = Math.abs(toNumber(amount));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query(`
          SELECT balance FROM user_workspace_cash
          WHERE user_id = $1 AND currency = $2
          FOR UPDATE;
        `, [resolvedUserId, cur]);

        let current = row.rows[0] ? toNumber(row.rows[0].balance) : 0;
        const next = type === "deposit" ? current + val : current - val;
        if (next < 0) {
          const err = new Error(`Insufficient ${cur} balance`);
          err.code = "INSUFFICIENT_BALANCE";
          throw err;
        }

        await client.query(`
          INSERT INTO user_workspace_cash (user_id, currency, balance)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, currency) DO UPDATE
          SET balance = EXCLUDED.balance, updated_at = NOW();
        `, [resolvedUserId, cur, next]);

        if (cur === "USD") {
          await client.query(`UPDATE user_workspace_balance SET balance = $2 WHERE user_id = $1`, [resolvedUserId, next]);
        }

        await client.query("COMMIT");
        return next;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },

    set: async (userId, currency, balance) => {
      const resolvedUserId = toUserId(userId);
      const cur = String(currency || "USD").toUpperCase();
      const val = toNumber(balance);
      await pool.query(`
        INSERT INTO user_workspace_cash (user_id, currency, balance)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, currency) DO UPDATE
        SET balance = EXCLUDED.balance, updated_at = NOW();
      `, [resolvedUserId, cur, val]);
      if (cur === "USD" || cur === "USDT" || cur === "USDC") {
        // Update legacy balance if it's a USD-peg
        await pool.query(`UPDATE user_workspace_balance SET balance = $2 WHERE user_id = $1`, [resolvedUserId, val]);
      }
      return val;
    }
  },

  trades: {
    getAll: async (userId, limit = 1000) => {
      const resolvedUserId = toUserId(userId);
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
          fee,
          slippage,
          reference_price AS "referencePrice",
          execution_meta_json AS "executionMeta",
          balance_after AS "balanceAfter",
          portfolio_value_after AS "portfolioValueAfter",
          account_equity_after AS "accountEquityAfter",
          position_after AS "positionAfter",
          strategy_name AS "strategyName",
          legs_json AS "legsJson"
        FROM user_workspace_trades
        WHERE user_id = $1
        ORDER BY COALESCE(executed_at, date::timestamptz) DESC, id DESC
        LIMIT $2;
      `, [resolvedUserId, safeLimit]);
      return result.rows.map(mapTradeRow);
    },
    sync: async (userId, trades) => {
      const resolvedUserId = toUserId(userId);
      for (const t of trades) {
        await pool.query(`
          INSERT INTO user_workspace_trades (
            user_id, client_id, date, executed_at, asset, name, type, side, market_type, status,
            quantity, price, notional, fee, slippage, reference_price, execution_meta_json, strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (user_id, client_id) DO NOTHING;
        `, [
          resolvedUserId, t.clientId, t.date, t.executedAt, t.asset, t.name, t.type, t.side,
          t.marketType, t.status, t.quantity, t.price, t.notional,
          Number.isFinite(Number(t.fee)) ? Number(t.fee) : null,
          Number.isFinite(Number(t.slippage)) ? Number(t.slippage) : null,
          Number.isFinite(Number(t.referencePrice)) ? Number(t.referencePrice) : null,
          JSON.stringify(t.executionMeta || {}),
          t.strategyName,
          JSON.stringify(t.legsJson || {})
        ]);
      }
    },

    add: async (userId, trade) => {
      const resolvedUserId = toUserId(userId);
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
        fee: Number.isFinite(Number(trade.fee)) ? Number(trade.fee) : 0,
        slippage: Number.isFinite(Number(trade.slippage)) ? Number(trade.slippage) : 0,
        reference_price: Number.isFinite(Number(trade.referencePrice)) ? Number(trade.referencePrice) : null,
        execution_meta_json: parseJsonPayload(trade.executionMeta || trade.execution_meta_json, {}),
        balance_after: Number.isFinite(Number(trade.balanceAfter)) ? Number(trade.balanceAfter) : null,
        portfolio_value_after: Number.isFinite(Number(trade.portfolioValueAfter)) ? Number(trade.portfolioValueAfter) : null,
        account_equity_after: Number.isFinite(Number(trade.accountEquityAfter)) ? Number(trade.accountEquityAfter) : null,
        position_after: Number.isFinite(Number(trade.positionAfter)) ? Number(trade.positionAfter) : null,
        strategy_name: trade.strategyName || trade.strategy_name || null,
        legs_json: parseJsonPayload(trade.legsJson || trade.legs_json)
      };

      try {
        const result = await pool.query(`
          INSERT INTO user_workspace_trades (
            user_id, client_id, date, executed_at, asset, name, type, side, market_type, status,
            quantity, price, notional, fee, slippage, reference_price, execution_meta_json,
            balance_after, portfolio_value_after, account_equity_after, position_after,
            strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
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
            fee,
            slippage,
            reference_price AS "referencePrice",
            execution_meta_json AS "executionMeta",
            balance_after AS "balanceAfter",
            portfolio_value_after AS "portfolioValueAfter",
            account_equity_after AS "accountEquityAfter",
            position_after AS "positionAfter",
            strategy_name AS "strategyName",
            legs_json AS "legsJson";
        `, [
          resolvedUserId,
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
          normalized.fee,
          normalized.slippage,
          normalized.reference_price,
          JSON.stringify(normalized.execution_meta_json || {}),
          normalized.balance_after,
          normalized.portfolio_value_after,
          normalized.account_equity_after,
          normalized.position_after,
          normalized.strategy_name,
          JSON.stringify(normalized.legs_json)
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
              fee,
              slippage,
              reference_price AS "referencePrice",
              execution_meta_json AS "executionMeta",
              balance_after AS "balanceAfter",
              portfolio_value_after AS "portfolioValueAfter",
              account_equity_after AS "accountEquityAfter",
              position_after AS "positionAfter",
              strategy_name AS "strategyName",
              legs_json AS "legsJson"
            FROM user_workspace_trades
            WHERE user_id = $1 AND client_id = $2
            LIMIT 1;
          `, [resolvedUserId, normalized.client_id]);
          if (existing.rows[0]) return mapTradeRow(existing.rows[0]);
        }
        throw error;
      }
    }
  },

  watchlist: {
    getAll: async (userId) => {
      const result = await pool.query(`
        SELECT
          id,
          symbol,
          name,
          type,
          category,
          theme,
          market_type AS "marketType",
          date_added
        FROM user_workspace_watchlist
        WHERE user_id = $1
        ORDER BY date_added DESC;
      `, [toUserId(userId)]);
      return result.rows.map(mapWatchlistRow);
    },

    add: async (userId, asset) => {
      const resolvedUserId = toUserId(userId);
      const symbol = String(asset.symbol || "").trim().toUpperCase();
      const type = String(asset.type || "stock").trim().toLowerCase();
      const category = String(asset.category || "").trim().toLowerCase() || null;
      const theme = String(asset.theme || "").trim() || null;
      const marketType = normalizeMarketType(type, asset.marketType);
      const dateAdded = asset.date_added || new Date().toISOString();
      const updateResult = await pool.query(`
        UPDATE user_workspace_watchlist
        SET
          name = $3,
          type = $4,
          category = $5,
          theme = $6,
          date_added = $8
        WHERE user_id = $1
          AND symbol = $2
          AND market_type = $7
          AND COALESCE(category, '') = COALESCE($5, '')
          AND COALESCE(theme, '') = COALESCE($6, '')
        RETURNING
          id,
          symbol,
          name,
          type,
          category,
          theme,
          market_type AS "marketType",
          date_added;
      `, [resolvedUserId, symbol, String(asset.name || symbol), type, category, theme, marketType, dateAdded]);
      if (updateResult.rows[0]) return mapWatchlistRow(updateResult.rows[0]);

      const insertResult = await pool.query(`
        INSERT INTO user_workspace_watchlist (user_id, symbol, name, type, category, theme, market_type, date_added)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, symbol, market_type, category, theme)
        DO UPDATE SET
          name = EXCLUDED.name,
          type = EXCLUDED.type,
          date_added = EXCLUDED.date_added
        RETURNING
          id,
          symbol,
          name,
          type,
          category,
          theme,
          market_type AS "marketType",
          date_added;
      `, [resolvedUserId, symbol, String(asset.name || symbol), type, category, theme, marketType, dateAdded]);
      return mapWatchlistRow(insertResult.rows[0]);
    },

    delete: async (userId, symbol, marketType, category = null, theme = null) => {
      const resolvedUserId = toUserId(userId);
      const cleanSymbol = String(symbol || "").trim().toUpperCase();
      const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
      const cleanCategory = String(category || "").trim().toLowerCase() || null;
      const cleanTheme = String(theme || "").trim() || null;
      if (cleanCategory || cleanTheme) {
        await pool.query(`
          DELETE FROM user_workspace_watchlist
          WHERE user_id = $1
            AND symbol = $2
            AND market_type = $3
            AND COALESCE(category, '') = COALESCE($4, '')
            AND COALESCE(theme, '') = COALESCE($5, '');
        `, [resolvedUserId, cleanSymbol, cleanMarketType, cleanCategory, cleanTheme]);
        return { success: true, symbol: cleanSymbol, marketType: cleanMarketType, category: cleanCategory, theme: cleanTheme };
      }
      await pool.query(`
        DELETE FROM user_workspace_watchlist
        WHERE user_id = $1 AND symbol = $2 AND market_type = $3;
      `, [resolvedUserId, cleanSymbol, cleanMarketType]);
      return { success: true, symbol: cleanSymbol, marketType: cleanMarketType, category: null, theme: null };
    },

    exists: async (userId, symbol, marketType, category = null, theme = null) => {
      const resolvedUserId = toUserId(userId);
      const cleanSymbol = String(symbol || "").trim().toUpperCase();
      const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
      const cleanCategory = String(category || "").trim().toLowerCase() || null;
      const cleanTheme = String(theme || "").trim() || null;
      const result = cleanCategory || cleanTheme
        ? await pool.query(`
            SELECT id
            FROM user_workspace_watchlist
            WHERE user_id = $1
              AND symbol = $2
              AND market_type = $3
              AND COALESCE(category, '') = COALESCE($4, '')
              AND COALESCE(theme, '') = COALESCE($5, '')
            LIMIT 1
          `, [resolvedUserId, cleanSymbol, cleanMarketType, cleanCategory, cleanTheme])
        : await pool.query(`
            SELECT id
            FROM user_workspace_watchlist
            WHERE user_id = $1 AND symbol = $2 AND market_type = $3
            LIMIT 1;
          `, [resolvedUserId, cleanSymbol, cleanMarketType]);
      return result.rows.length > 0;
    }
  },

  options: {
    add: async (userId, payload) => {
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
        INSERT INTO user_workspace_options_calculations (
          user_id, symbol, strategy, net_pnl, delta, gamma, theta, vega, max_profit, max_loss, breakevens, legs_json, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *;
      `, [
        toUserId(userId),
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
      return { ...row, created_at: toIsoString(row.created_at) };
    },

    getRecent: async (userId, limit = 20, symbol = null) => {
      const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
      const resolvedUserId = toUserId(userId);
      if (symbol) {
        const result = await pool.query(`
          SELECT * FROM user_workspace_options_calculations
          WHERE user_id = $1 AND symbol = $2
          ORDER BY created_at DESC, id DESC
          LIMIT $3;
        `, [resolvedUserId, String(symbol).trim().toUpperCase(), safeLimit]);
        return result.rows.map((row) => ({ ...row, created_at: toIsoString(row.created_at) }));
      }
      const result = await pool.query(`
        SELECT * FROM user_workspace_options_calculations
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2;
      `, [resolvedUserId, safeLimit]);
      return result.rows.map((row) => ({ ...row, created_at: toIsoString(row.created_at) }));
    }
  },

  docs: {
    get: async (userId, namespace, fallback = null) => {
      const result = await pool.query(`
        SELECT payload_json AS payload, updated_at AS "updatedAt"
        FROM user_workspace_documents
        WHERE user_id = $1 AND namespace = $2
        LIMIT 1;
      `, [toUserId(userId), String(namespace || "").trim()]);
      if (!result.rows[0]) {
        return { namespace: String(namespace || "").trim(), document: fallback, updatedAt: null };
      }
      return {
        namespace: String(namespace || "").trim(),
        document: parseJsonPayload(result.rows[0].payload, fallback),
        updatedAt: toIsoString(result.rows[0].updatedAt)
      };
    },

    set: async (userId, namespace, document) => {
      const resolvedNamespace = String(namespace || "").trim();
      const result = await pool.query(`
        INSERT INTO user_workspace_documents (user_id, namespace, payload_json, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (user_id, namespace) DO UPDATE
        SET payload_json = EXCLUDED.payload_json, updated_at = NOW()
        RETURNING payload_json AS payload, updated_at AS "updatedAt";
      `, [toUserId(userId), resolvedNamespace, JSON.stringify(document ?? null)]);
      return {
        namespace: resolvedNamespace,
        document: parseJsonPayload(result.rows[0]?.payload, document ?? null),
        updatedAt: toIsoString(result.rows[0]?.updatedAt)
      };
    }
  },

  collections: {
    get: async (userId, namespace, fallback = []) => {
      const result = await pool.query(`
        SELECT items_json AS items, updated_at AS "updatedAt"
        FROM user_workspace_collections
        WHERE user_id = $1 AND namespace = $2
        LIMIT 1;
      `, [toUserId(userId), String(namespace || "").trim()]);
      if (!result.rows[0]) {
        return { namespace: String(namespace || "").trim(), items: Array.isArray(fallback) ? fallback : [], updatedAt: null };
      }
      const items = parseJsonPayload(result.rows[0].items, fallback);
      return {
        namespace: String(namespace || "").trim(),
        items: Array.isArray(items) ? items : [],
        updatedAt: toIsoString(result.rows[0].updatedAt)
      };
    },

    set: async (userId, namespace, items, limit = 500) => {
      const resolvedNamespace = String(namespace || "").trim();
      const normalizedItems = Array.isArray(items) ? items.slice(0, Math.max(1, Math.min(2000, Number(limit) || 500))) : [];
      const result = await pool.query(`
        INSERT INTO user_workspace_collections (user_id, namespace, items_json, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (user_id, namespace) DO UPDATE
        SET items_json = EXCLUDED.items_json, updated_at = NOW()
        RETURNING items_json AS items, updated_at AS "updatedAt";
      `, [toUserId(userId), resolvedNamespace, JSON.stringify(normalizedItems)]);
      return {
        namespace: resolvedNamespace,
        items: parseJsonPayload(result.rows[0]?.items, normalizedItems),
        updatedAt: toIsoString(result.rows[0]?.updatedAt)
      };
    }
  },

  trading: {
    estimateTrade: async (payload) => {
      const symbol = String(payload.symbol || "").trim().toUpperCase();
      const name = String(payload.name || symbol || "UNKNOWN");
      const type = String(payload.type || "stock").trim().toLowerCase();
      const marketType = normalizeMarketType(type, payload.marketType);
      const orderType = String(payload.orderType || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
      const quantity = Math.abs(toNumber(payload.quantity));
      const price = toNumber(payload.price);

      if (!symbol) throw new Error("Invalid symbol");
      if (!Number.isFinite(quantity) || quantity <= QTY_EPSILON) throw new Error("Invalid quantity");
      if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");

      return {
        symbol,
        name,
        type,
        marketType,
        orderType,
        quantity,
        ...buildExecutionCostEstimate({ type, marketType, orderType, quantity, price })
      };
    },

    estimateTrades: async (payloads = []) => {
      const estimates = (Array.isArray(payloads) ? payloads : []).map((payload) => userWorkspace.trading.estimateTrade(payload));
      const resolvedEstimates = await Promise.all(estimates);
      const summary = resolvedEstimates.reduce((acc, estimate) => {
        acc.tradeCount += 1;
        acc.referenceNotional = roundMoney(acc.referenceNotional + toNumber(estimate.referenceNotional));
        acc.executedNotional = roundMoney(acc.executedNotional + toNumber(estimate.executedNotional));
        acc.fees = roundMoney(acc.fees + toNumber(estimate.fee));
        acc.slippage = roundMoney(acc.slippage + toNumber(estimate.slippage));
        acc.totalCostImpact = roundMoney(acc.totalCostImpact + toNumber(estimate.totalCostImpact));
        return acc;
      }, {
        tradeCount: 0,
        referenceNotional: 0,
        executedNotional: 0,
        fees: 0,
        slippage: 0,
        totalCostImpact: 0
      });
      return { estimates: resolvedEstimates, summary };
    },

    executeTrade: async (userId, payload) => {
      const resolvedUserId = toUserId(userId);
      const symbol = String(payload.symbol || "").trim().toUpperCase();
      const name = String(payload.name || symbol || "UNKNOWN");
      const type = String(payload.type || "stock").trim().toLowerCase();
      const marketType = normalizeMarketType(type, payload.marketType);
      const orderType = String(payload.orderType || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
      const quantity = Math.abs(toNumber(payload.quantity));
      const quotedPrice = toNumber(payload.price);
      const dateAdded = payload.date_added || new Date().toISOString();
      const executionTimestamp = payload.executedAt || new Date().toISOString();
      const executionDate = toDateString(payload.date || executionTimestamp) || new Date().toISOString().slice(0, 10);
      const clientId = String(payload.clientId || "").trim() || null;
      const strategyName = payload.strategyName || payload.strategy_name || null;
      const legsJson = parseJsonPayload(payload.legsJson || payload.legs_json);

      if (!symbol) throw new Error("Invalid symbol");
      if (!Number.isFinite(quantity) || quantity <= QTY_EPSILON) throw new Error("Invalid quantity");
      if (!Number.isFinite(quotedPrice) || quotedPrice < 0) throw new Error("Invalid price");
      if (!clientId) {
        const err = new Error("clientId is required");
        err.code = "INVALID_CLIENT_ID";
        throw err;
      }

      const executionEstimate = buildExecutionCostEstimate({
        type,
        marketType,
        orderType,
        quantity,
        price: quotedPrice
      });
      const executedPrice = executionEstimate.executedPrice;
      const notional = executionEstimate.executedNotional;
      const fee = executionEstimate.fee;
      const slippage = executionEstimate.slippage;
      const referencePrice = executionEstimate.referencePrice;
      const executionMeta = executionEstimate.executionMeta;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const existingTradeResult = await client.query(`
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
            fee,
            slippage,
            reference_price AS "referencePrice",
            execution_meta_json AS "executionMeta",
            balance_after AS "balanceAfter",
            portfolio_value_after AS "portfolioValueAfter",
            account_equity_after AS "accountEquityAfter",
            position_after AS "positionAfter",
            strategy_name AS "strategyName",
            legs_json AS "legsJson"
          FROM user_workspace_trades
          WHERE user_id = $1 AND client_id = $2
          LIMIT 1
          FOR UPDATE;
        `, [resolvedUserId, clientId]);

        if (existingTradeResult.rows[0]) {
          const balanceSnapshot = await client.query(`
            SELECT balance
            FROM user_workspace_balance
            WHERE user_id = $1
            LIMIT 1;
          `, [resolvedUserId]);
          const holdingsSnapshot = await client.query(`
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
              strategy_name AS "strategyName",
              legs_json AS "legsJson",
              date_added
            FROM user_workspace_portfolio
            WHERE user_id = $1 AND quantity > $2
            ORDER BY date_added DESC;
          `, [resolvedUserId, QTY_EPSILON]);
          await client.query("COMMIT");
          return {
            balance: toNumber(balanceSnapshot.rows[0]?.balance, DEFAULT_BALANCE),
            holdings: holdingsSnapshot.rows.map(mapPortfolioRow),
            trade: mapTradeRow(existingTradeResult.rows[0]),
            executionCost: {
              fee: toNumber(existingTradeResult.rows[0]?.fee, 0),
              slippage: toNumber(existingTradeResult.rows[0]?.slippage, 0),
              referencePrice: existingTradeResult.rows[0]?.referencePrice == null ? null : toNumber(existingTradeResult.rows[0]?.referencePrice),
              executionMeta: parseJsonPayload(existingTradeResult.rows[0]?.executionMeta, {})
            },
            idempotentReplay: true
          };
        }

        const buyCurrency = String(payload.buyCurrency || "USD").toUpperCase();
        const cashRow = await client.query(`
          SELECT balance
          FROM user_workspace_cash
          WHERE user_id = $1 AND currency = $2
          FOR UPDATE;
        `, [resolvedUserId, buyCurrency]);

        let currentCashBalance = cashRow.rows[0]?.balance;
        if (currentCashBalance == null) {
          // If no balance and it's USD, use the legacy balance or default
          if (buyCurrency === "USD") {
             const legacyRow = await client.query(`SELECT balance FROM user_workspace_balance WHERE user_id = $1`, [resolvedUserId]);
             currentCashBalance = legacyRow.rows[0]?.balance ?? DEFAULT_BALANCE;
             await client.query(`INSERT INTO user_workspace_cash (user_id, currency, balance) VALUES ($1, 'USD', $2) ON CONFLICT DO NOTHING`, [resolvedUserId, currentCashBalance]);
          } else {
             currentCashBalance = 0;
             await client.query(`INSERT INTO user_workspace_cash (user_id, currency, balance) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`, [resolvedUserId, buyCurrency]);
          }
        }

        const current = toNumber(currentCashBalance, 0);
        // If buying in a currency that is NOT the asset currency, we need to convert notional.
        // But usually buyCurrency will match price currency if user wants "native" buy.
        // For now, assume price is in asset currency.
        // We need the rate from buyCurrency to asset price currency.
        // This is getting complex. Let's simplify:
        // 1. Calculate notional in Buy Currency.
        const assetCurrency = String(payload.currency || "USD").toUpperCase();
        let notionalInBuyCurrency = notional;
        if (buyCurrency !== assetCurrency) {
           // We need FX rates here. Backend usually doesn't have live FX in this JS file.
           // For now, let's assume if they select a currency, we use that directly.
           // Actually, the Frontend should send the notional in the Buy Currency.
           notionalInBuyCurrency = toNumber(payload.notionalInBuyCurrency, notional);
        }

        const feeInBuyCurrency = fee;
        const nextCashBalance = orderType === "buy"
          ? current - notionalInBuyCurrency - feeInBuyCurrency
          : current + notionalInBuyCurrency - feeInBuyCurrency;

        if (nextCashBalance < 0) {
          const err = new Error(`Insufficient ${buyCurrency} balance`);
          err.code = "INSUFFICIENT_BALANCE";
          throw err;
        }

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
            strategy_name AS "strategyName",
            legs_json AS "legsJson",
            date_added
          FROM user_workspace_portfolio
          WHERE user_id = $1
            AND symbol = $2
            AND market_type = $3
            AND (strategy_name IS NOT DISTINCT FROM $4)
          FOR UPDATE;
        `, [resolvedUserId, symbol, marketType, strategyName]);

        const existing = existingResult.rows[0] ? mapPortfolioRow(existingResult.rows[0]) : null;
        let positionAfter = 0;
        if (existing) {
          if (orderType === "sell" && quantity > existing.quantity + QTY_EPSILON) {
            const err = new Error(`You can only sell up to ${existing.quantity} ${symbol}.`);
            err.code = "INSUFFICIENT_POSITION";
            throw err;
          }
          const nextQuantity = orderType === "sell" ? existing.quantity - quantity : existing.quantity + quantity;
          if (nextQuantity <= QTY_EPSILON) {
            await client.query(`
              DELETE FROM user_workspace_portfolio
              WHERE id = $1 AND user_id = $2;
            `, [existing.id, resolvedUserId]);
            positionAfter = 0;
          } else {
            const existingEntry = Number.isFinite(Number(existing.entryPrice))
              ? Number(existing.entryPrice)
              : Number(existing.price);
            const nextEntryPrice = orderType === "sell"
              ? existingEntry
              : ((existingEntry * existing.quantity) + (executedPrice * quantity)) / Math.max(nextQuantity, QTY_EPSILON);
            const nextOpenedAt = existing.openedAt || executionTimestamp || dateAdded;
            const updated = await client.query(`
              UPDATE user_workspace_portfolio
              SET quantity = $1, price = $2, entry_price = $3, opened_at = $4, order_type = $5, date_added = $6, type = $7, name = $8, legs_json = $9
              WHERE id = $10 AND user_id = $11
              RETURNING quantity;
            `, [nextQuantity, executedPrice, nextEntryPrice, nextOpenedAt, orderType, dateAdded, type, name, JSON.stringify(legsJson), existing.id, resolvedUserId]);
            positionAfter = toNumber(updated.rows[0]?.quantity, 0);
          }
        } else {
          if (orderType === "sell") {
            const err = new Error(`No existing position for ${symbol} (${marketType}) to sell`);
            err.code = "NO_POSITION";
            throw err;
          }
          const inserted = await client.query(`
            INSERT INTO user_workspace_portfolio (user_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING quantity;
          `, [resolvedUserId, symbol, name, executedPrice, quantity, executedPrice, executionTimestamp, type, marketType, orderType, strategyName, JSON.stringify(legsJson), dateAdded]);
          positionAfter = toNumber(inserted.rows[0]?.quantity, 0);
        }

        await client.query(`
          UPDATE user_workspace_cash
          SET balance = $3, updated_at = NOW()
          WHERE user_id = $1 AND currency = $2;
        `, [resolvedUserId, buyCurrency, nextCashBalance]);

        // Also update legacy balance for compatibility (USD total equivalent maybe? No, just keep it synced for now if USD)
        if (buyCurrency === "USD") {
           await client.query(`UPDATE user_workspace_balance SET balance = $2, updated_at = NOW() WHERE user_id = $1`, [resolvedUserId, nextCashBalance]);
        }

        const holdingsResult = await client.query(`
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
            strategy_name AS "strategyName",
            legs_json AS "legsJson",
            date_added
          FROM user_workspace_portfolio
          WHERE user_id = $1 AND quantity > $2
          ORDER BY date_added DESC;
        `, [resolvedUserId, QTY_EPSILON]);
        const holdings = holdingsResult.rows.map(mapPortfolioRow);
        const portfolioValueAfter = holdings.reduce((total, h) => total + (toNumber(h.price) * toNumber(h.quantity)), 0);

        const tradeResult = await client.query(`
          INSERT INTO user_workspace_trades (
            user_id, client_id, date, executed_at, asset, name, type, side, market_type, status,
            quantity, price, notional, fee, slippage, reference_price, execution_meta_json,
            balance_after, portfolio_value_after, account_equity_after, position_after,
            strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
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
            fee,
            slippage,
            reference_price AS "referencePrice",
            execution_meta_json AS "executionMeta",
            balance_after AS "balanceAfter",
            portfolio_value_after AS "portfolioValueAfter",
            account_equity_after AS "accountEquityAfter",
            position_after AS "positionAfter",
            strategy_name AS "strategyName",
            legs_json AS "legsJson";
        `, [
          resolvedUserId,
          clientId,
          executionDate,
          executionTimestamp,
          symbol,
          name,
          orderType === "sell" ? "SELL" : "BUY",
          orderType,
          marketType,
          "Filled",
          quantity,
          executedPrice,
          Math.abs(notional),
          fee,
          slippage,
          referencePrice,
          JSON.stringify(executionMeta || {}),
          nextCashBalance,
          portfolioValueAfter,
          nextCashBalance + portfolioValueAfter,
          positionAfter,
          strategyName,
          JSON.stringify(legsJson)
        ]);

        await client.query("COMMIT");
        return {
          balance: nextCashBalance,
          holdings,
          trade: mapTradeRow(tradeResult.rows[0]),
          executionCost: {
            fee,
            slippage,
            referencePrice,
            executionMeta
          }
        };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
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

const admin = {
  listAllUsers: async () => {
    const result = await pool.query(`
      SELECT
        id,
        email,
        display_name AS name,
        current_plan AS plan,
        is_admin AS "isAdmin",
        suspended_at AS "suspendedAt",
        created_at AS joined
      FROM app_users
      ORDER BY created_at DESC
    `);
    return result.rows.map(r => ({
      ...r,
      joined: toIsoString(r.joined),
      suspendedAt: toIsoString(r.suspendedAt)
    }));
  },
  createUser: async ({ email, displayName = null, plan = "starter", isAdmin = false, passwordHash = "" }) => {
    const created = await userAuth.createUser({
      email,
      passwordHash,
      displayName,
      authProvider: "email",
      emailVerified: true
    });

    await admin.updateUserPlan(created.id, plan);
    await admin.updateUserAdminStatus(created.id, isAdmin);

    const result = await pool.query(`
      SELECT
        id,
        email,
        display_name AS name,
        current_plan AS plan,
        is_admin AS "isAdmin",
        suspended_at AS "suspendedAt",
        created_at AS joined
      FROM app_users
      WHERE id = $1
      LIMIT 1
    `, [toUserId(created.id)]);

    const row = result.rows[0];
    if (!row) return null;

    return {
      ...row,
      joined: toIsoString(row.joined),
      suspendedAt: toIsoString(row.suspendedAt)
    };
  },
  updateUserPlan: async (userId, plan) => {
    const validPlan = normalizePlanValue(plan);
    const result = await pool.query(`
      UPDATE app_users 
      SET current_plan = $2, plan_updated_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, current_plan AS plan;
    `, [toUserId(userId), validPlan]);
    return result.rows[0] || null;
  },
  updateUserAdminStatus: async (userId, isAdmin) => {
    const result = await pool.query(`
      UPDATE app_users 
      SET is_admin = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, is_admin AS "isAdmin";
    `, [toUserId(userId), Boolean(isAdmin)]);
    return result.rows[0] || null;
  },
  suspendUser: async (userId, isSuspended) => {
    const suspendedAt = isSuspended ? new Date() : null;
    const result = await pool.query(`
      UPDATE app_users 
      SET suspended_at = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, suspended_at AS "suspendedAt";
    `, [toUserId(userId), suspendedAt]);
    return result.rows[0] || null;
  },
  deleteUser: async (userId) => {
    const resolvedId = toUserId(userId);
    // Note: In a real app, you might want to delete their workspace data too
    const result = await pool.query(`
      DELETE FROM app_users 
      WHERE id = $1
      RETURNING id, email;
    `, [resolvedId]);
    return result.rows[0] || null;
  },
  createPasswordResetToken: async (userId) => {
    // Reusing the existing userAuth logic if available, or implementing here
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    await pool.query(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `, [toUserId(userId), tokenHash, expiresAt]);

    return token;
  },
  getSystemStats: async () => {
    const userCount = await pool.query("SELECT COUNT(*)::int AS count FROM app_users");
    const sessionCount = await pool.query("SELECT COUNT(*)::int AS count FROM auth_sessions WHERE expires_at > NOW() AND revoked_at IS NULL");
    const tradeCount = await pool.query("SELECT COUNT(*)::int AS count FROM user_workspace_trades");
    const planBreakdown = await pool.query(`
      SELECT current_plan AS plan, COUNT(*)::int AS count 
      FROM app_users 
      GROUP BY current_plan
    `);
    
    const recentActivity = await pool.query(`
      SELECT 
        u.email, 
        COALESCE(l.action, 'User Sync') as action, 
        COALESCE(l.created_at, u.created_at) as time
      FROM app_users u
      LEFT JOIN admin_audit_logs l ON l.target_user_id = u.id
      ORDER BY time DESC
      LIMIT 10
    `);

    const plans = planBreakdown.rows.reduce((acc, r) => ({ ...acc, [r.plan.toLowerCase()]: r.count }), {});
    // Real MRR calculation: starter=$29, pro=$99, desk=$299
    const mrr = (plans.starter || 0) * 29 + (plans.pro || 0) * 99 + (plans.desk || 0) * 299;

    return {
      totalUsers: userCount.rows[0].count,
      activeSessions: sessionCount.rows[0].count,
      totalTrades: tradeCount.rows[0].count,
      planBreakdown: plans,
      mrr: mrr,
      recentActivity: recentActivity.rows.map(r => ({
        ...r,
        time: r.time ? new Date(r.time).toISOString() : new Date().toISOString()
      })),
      systemHealth: {
        api: 99.98,
        web: 99.97,
        db: 99.96
      }
    };
  },
  logAdminAction: async ({ adminId, targetUserId, action, details, ipAddress }) => {
    await pool.query(`
      INSERT INTO admin_audit_logs (admin_user_id, target_user_id, action, details, ip_address)
      VALUES ($1, $2, $3, $4, $5)
    `, [adminId, targetUserId, action, details ? JSON.stringify(details) : null, ipAddress]);
  },
  getDatabaseStats: async () => {
    const tableStats = await pool.query(`
      SELECT 
        relname AS "name", 
        n_live_tup::int AS "rows", 
        pg_total_relation_size(relid) AS "sizeBytes",
        pg_size_pretty(pg_total_relation_size(relid)) AS "sizePretty"
      FROM pg_stat_user_tables 
      ORDER BY pg_total_relation_size(relid) DESC;
    `);
    
    const dbSize = await pool.query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");
    const connections = await pool.query("SELECT count(*)::int FROM pg_stat_activity");

    return {
      tables: tableStats.rows,
      totalSize: dbSize.rows[0].size,
      activeConnections: connections.rows[0].count,
      uptime: '99.99%', // Placeholder or calculate from system
      lastBackup: new Date(Date.now() - 3600000 * 4).toISOString() // Simulated
    };
  },
  getBillingStats: async () => {
    const planBreakdown = await pool.query(`
      SELECT current_plan AS plan, COUNT(*)::int AS count 
      FROM app_users 
      GROUP BY current_plan
    `);

    const plans = planBreakdown.rows.reduce((acc, r) => ({ ...acc, [r.plan]: r.count }), {});
    const mrr = (plans.starter || 0) * 29 + (plans.pro || 0) * 99 + (plans.desk || 0) * 299;

    // Simulated revenue trend (last 6 months)
    const revenueTrend = [
      { month: 'Jan', revenue: mrr * 0.85 },
      { month: 'Feb', revenue: mrr * 0.88 },
      { month: 'Mar', revenue: mrr * 0.92 },
      { month: 'Apr', revenue: mrr * 0.95 },
      { month: 'May', revenue: mrr * 0.98 },
      { month: 'Jun', revenue: mrr }
    ];

    return {
      mrr,
      plans,
      revenueTrend,
      totalCustomers: Object.values(plans).reduce((a, b) => a + b, 0),
      avgRevenuePerUser: mrr / (Object.values(plans).reduce((a, b) => a + b, 0) || 1),
      recentTransactions: [
        { id: 'TX-9012', user: 'sarah.chen@example.com', amount: 99.00, status: 'Completed', date: new Date().toISOString() },
        { id: 'TX-9011', user: 'mike.ross@example.com', amount: 29.00, status: 'Completed', date: new Date(Date.now() - 86400000).toISOString() },
        { id: 'TX-9010', user: 'jane.doe@example.com', amount: 299.00, status: 'Processing', date: new Date(Date.now() - 172800000).toISOString() }
      ]
    };
  },
  getAdminLogs: async () => {
    const result = await pool.query(`
      SELECT 
        l.id,
        l.action,
        l.details,
        l.ip_address as "ipAddress",
        l.created_at as "createdAt",
        u.email as "adminEmail",
        t.email as "targetEmail"
      FROM admin_audit_logs l
      LEFT JOIN app_users u ON l.admin_user_id = u.id
      LEFT JOIN app_users t ON l.target_user_id = t.id
      ORDER BY l.created_at DESC
      LIMIT 50
    `);
    return result.rows;
  },
  getSystemLogs: async () => {
    const result = await pool.query(`
      SELECT 
        id, level, message, context_json AS context, 
        request_id AS "requestId", ip_address AS "ipAddress", 
        created_at AS "createdAt"
      FROM app_system_logs
      ORDER BY created_at DESC
      LIMIT 200
    `);
    return result.rows;
  }
};

module.exports = {
  pool,
  initializeDatabase,
  runAdminWorkspaceMigration,
  balance,
  portfolio,
  watchlist,
  optionsCalculations,
  userAuth,
  userWorkspace,
  serviceSnapshots,
  tradeExecutions,
  trading,
  admin,
  clearAllData,
  closeDatabase
};
