const { Pool } = require("pg");
const { watchlistData } = require("./data");
const crypto = require("crypto");

const QTY_EPSILON = 1e-8;
const DEFAULT_BALANCE = 10000;
const FEE_SOURCE_EXCHANGE_REPORTED = "exchange_reported";
const FEE_SOURCE_CHEAPEST_AVENUE = "cheapest_avenue";

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
  const platform = normalizePlatformValue(row.platform || row.exchange, "zenin");
  const feeSourceFallback = platform === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED;
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
    platform,
    fee: row.fee == null ? 0 : toNumber(row.fee),
    feeCurrency: row.feeCurrency || row.fee_currency || "USD",
    feeSource: normalizeFeeSourceValue(row.feeSource || row.fee_source, feeSourceFallback),
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

function mapTradeFillRow(row) {
  const platform = normalizePlatformValue(row.platform, "zenin");
  const feeSourceFallback = platform === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED;
  return {
    id: row.id,
    tradeClientId: row.tradeClientId || row.trade_client_id || null,
    platform,
    platformTradeId: row.platformTradeId || row.platform_trade_id || null,
    platformFillId: row.platformFillId || row.platform_fill_id || null,
    symbol: String(row.symbol || "").trim().toUpperCase(),
    side: String(row.side || "").trim().toLowerCase(),
    marketType: String(row.marketType || row.market_type || "spot").trim().toLowerCase(),
    quantity: toNumber(row.quantity),
    price: toNumber(row.price),
    notional: toNumber(row.notional),
    feeAmount: toNumber(row.feeAmount ?? row.fee_amount),
    feeCurrency: String(row.feeCurrency || row.fee_currency || "USD").trim().toUpperCase() || "USD",
    feeSource: normalizeFeeSourceValue(row.feeSource || row.fee_source, feeSourceFallback),
    liquidityRole: row.liquidityRole || row.liquidity_role || null,
    executedAt: toIsoString(row.executedAt || row.executed_at),
    referencePrice: row.referencePrice == null ? null : toNumber(row.referencePrice),
    rawPayload: parseJsonPayload(row.rawPayload || row.raw_payload_json, {})
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

function roundQuantity(value) {
  return Number(toNumber(value, 0).toFixed(12));
}

function normalizePlatformValue(value, fallback = "zenin") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function normalizeFeeSourceValue(value, fallback = FEE_SOURCE_EXCHANGE_REPORTED) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized) return fallback;
  if ([
    "exchange_reported",
    "exchange",
    "reported",
    "venue_reported",
    "broker_reported"
  ].includes(normalized)) {
    return FEE_SOURCE_EXCHANGE_REPORTED;
  }
  if ([
    "cheapest_avenue",
    "cheapest",
    "best_venue",
    "best_avenue",
    "internal_estimate",
    "internal",
    "estimated",
    "zenin_estimated",
    "zenin"
  ].includes(normalized)) {
    return FEE_SOURCE_CHEAPEST_AVENUE;
  }
  return normalized;
}

function normalizeCurrencyCode(value, fallback = "USD") {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || fallback;
}

function isUsdLikeCurrency(currency) {
  const code = normalizeCurrencyCode(currency, "");
  return ["USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USDE", "USDD"].includes(code);
}

function createFeeSummaryBucket() {
  return {
    tradeKeys: new Set(),
    fillCount: 0,
    feesByCurrency: new Map(),
    lastExecutedAt: null
  };
}

function addFeeToSummaryBucket(bucket, { tradeKey, currency, amount, executedAt }) {
  const safeAmount = roundMoney(Math.abs(toNumber(amount, 0)));
  if (!bucket || !tradeKey || !Number.isFinite(safeAmount) || safeAmount <= 0) return;
  const safeCurrency = normalizeCurrencyCode(currency, "USD");
  bucket.tradeKeys.add(tradeKey);
  bucket.fillCount += 1;
  bucket.feesByCurrency.set(safeCurrency, roundMoney((bucket.feesByCurrency.get(safeCurrency) || 0) + safeAmount));
  if (!bucket.lastExecutedAt || (executedAt && executedAt > bucket.lastExecutedAt)) {
    bucket.lastExecutedAt = executedAt || bucket.lastExecutedAt;
  }
}

function finalizeFeeSummaryBucket(bucket, extra = {}) {
  return {
    tradeCount: bucket?.tradeKeys?.size || 0,
    fillCount: bucket?.fillCount || 0,
    feesByCurrency: [...(bucket?.feesByCurrency?.entries?.() || [])]
      .map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }))
      .sort((a, b) => b.amount - a.amount),
    lastExecutedAt: bucket?.lastExecutedAt || null,
    ...extra
  };
}

function summarizeFeeBreakdown(rows = []) {
  const currencyTotals = new Map();
  const platformTotals = new Map();
  const sourceTotals = new Map();
  const tradeKeys = new Set();
  const exchangeReportedBucket = createFeeSummaryBucket();
  const cheapestAvenueObservedBucket = createFeeSummaryBucket();
  const cheapestAvenueBenchmarkBucket = createFeeSummaryBucket();
  let benchmarkEligibleFillCount = 0;

  (Array.isArray(rows) ? rows : []).forEach((rawRow) => {
    const row = mapTradeFillRow(rawRow);
    const feeAmount = Math.abs(toNumber(row.feeAmount, 0));
    if (!Number.isFinite(feeAmount) || feeAmount <= 0) return;

    const currency = normalizeCurrencyCode(row.feeCurrency, "USD");
    const platform = normalizePlatformValue(row.platform, "zenin");
    const feeSource = normalizeFeeSourceValue(
      row.feeSource,
      platform === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED
    );
    const tradeKey = `${platform}:${row.tradeClientId || row.platformTradeId || row.platformFillId || row.id || "unknown"}`;

    tradeKeys.add(tradeKey);
    currencyTotals.set(currency, roundMoney((currencyTotals.get(currency) || 0) + feeAmount));

    const platformRow = platformTotals.get(platform) || {
      platform,
      tradeKeys: new Set(),
      fillCount: 0,
      feeSources: new Set(),
      feesByCurrency: new Map(),
      lastExecutedAt: null
    };
    platformRow.tradeKeys.add(tradeKey);
    platformRow.fillCount += 1;
    platformRow.feeSources.add(feeSource);
    platformRow.feesByCurrency.set(currency, roundMoney((platformRow.feesByCurrency.get(currency) || 0) + feeAmount));
    if (!platformRow.lastExecutedAt || (row.executedAt && row.executedAt > platformRow.lastExecutedAt)) {
      platformRow.lastExecutedAt = row.executedAt || platformRow.lastExecutedAt;
    }
    platformTotals.set(platform, platformRow);

    const sourceRow = sourceTotals.get(feeSource) || { source: feeSource, bucket: createFeeSummaryBucket() };
    addFeeToSummaryBucket(sourceRow.bucket, {
      tradeKey,
      currency,
      amount: feeAmount,
      executedAt: row.executedAt
    });
    sourceTotals.set(feeSource, sourceRow);

    if (feeSource === FEE_SOURCE_EXCHANGE_REPORTED) {
      addFeeToSummaryBucket(exchangeReportedBucket, {
        tradeKey,
        currency,
        amount: feeAmount,
        executedAt: row.executedAt
      });

      if (row.quantity > QTY_EPSILON && row.price > 0) {
        const cheapestAvenueEstimate = buildExecutionCostEstimate({
          type: row.marketType,
          marketType: row.marketType,
          orderType: row.side,
          quantity: row.quantity,
          price: row.price
        });
        addFeeToSummaryBucket(cheapestAvenueBenchmarkBucket, {
          tradeKey,
          currency: isUsdLikeCurrency(currency) ? currency : "USD",
          amount: cheapestAvenueEstimate.fee,
          executedAt: row.executedAt
        });
        benchmarkEligibleFillCount += 1;
      }
    }

    if (feeSource === FEE_SOURCE_CHEAPEST_AVENUE) {
      addFeeToSummaryBucket(cheapestAvenueObservedBucket, {
        tradeKey,
        currency,
        amount: feeAmount,
        executedAt: row.executedAt
      });
    }
  });

  return {
    tradeCount: tradeKeys.size,
    fillCount: (Array.isArray(rows) ? rows : []).filter((row) => Math.abs(toNumber(row.feeAmount ?? row.fee_amount, 0)) > 0).length,
    totalFeesByCurrency: [...currencyTotals.entries()]
      .map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }))
      .sort((a, b) => b.amount - a.amount),
    platforms: [...platformTotals.values()]
      .map((entry) => ({
        platform: entry.platform,
        tradeCount: entry.tradeKeys.size,
        fillCount: entry.fillCount,
        feeSources: [...entry.feeSources].sort(),
        feesByCurrency: [...entry.feesByCurrency.entries()]
          .map(([currency, amount]) => ({ currency, amount: roundMoney(amount) }))
          .sort((a, b) => b.amount - a.amount),
        lastExecutedAt: entry.lastExecutedAt || null
      }))
      .sort((a, b) => {
        const aAmount = a.feesByCurrency.reduce((sum, row) => sum + Math.abs(toNumber(row.amount, 0)), 0);
        const bAmount = b.feesByCurrency.reduce((sum, row) => sum + Math.abs(toNumber(row.amount, 0)), 0);
        return bAmount - aAmount;
      }),
    sources: [...sourceTotals.values()]
      .map((entry) => finalizeFeeSummaryBucket(entry.bucket, { source: entry.source }))
      .sort((a, b) => b.fillCount - a.fillCount),
    comparison: {
      exchangeReported: finalizeFeeSummaryBucket(exchangeReportedBucket, { source: FEE_SOURCE_EXCHANGE_REPORTED }),
      cheapestAvenueObserved: finalizeFeeSummaryBucket(cheapestAvenueObservedBucket, { source: FEE_SOURCE_CHEAPEST_AVENUE }),
      cheapestAvenueBenchmark: finalizeFeeSummaryBucket(cheapestAvenueBenchmarkBucket, { source: FEE_SOURCE_CHEAPEST_AVENUE }),
      benchmarkEligibleFillCount
    },
    updatedAt: new Date().toISOString()
  };
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

function normalizeAdminRoleValue(role) {
  const value = String(role || "").trim().toLowerCase();
  if (["user", "support_admin", "billing_admin", "ops_admin", "super_admin"].includes(value)) {
    return value;
  }
  return "user";
}

function quoteIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    const error = new Error("Invalid SQL identifier");
    error.code = "INVALID_IDENTIFIER";
    throw error;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function formatUserSession(row) {
  if (!row) return null;
  const userAgent = String(row.userAgent || "").trim();
  const browserLabel = /chrome/i.test(userAgent)
    ? "Chrome"
    : /safari/i.test(userAgent) && !/chrome/i.test(userAgent)
      ? "Safari"
      : /firefox/i.test(userAgent)
        ? "Firefox"
        : /edge/i.test(userAgent)
          ? "Edge"
          : "Browser";
  const deviceLabel = /iphone|ios/i.test(userAgent)
    ? "iPhone"
    : /ipad/i.test(userAgent)
      ? "iPad"
      : /android/i.test(userAgent)
        ? "Android"
        : /macintosh|mac os/i.test(userAgent)
          ? "Mac"
          : /windows/i.test(userAgent)
            ? "Windows"
            : /linux/i.test(userAgent)
              ? "Linux"
              : "Unknown Device";

  return {
    id: row.id,
    userId: row.userId,
    ipAddress: row.ipAddress || null,
    userAgent: userAgent || null,
    browserLabel,
    deviceLabel,
    createdAt: toIsoString(row.createdAt),
    expiresAt: toIsoString(row.expiresAt),
    revokedAt: toIsoString(row.revokedAt),
    isActive: !row.revokedAt && (!row.expiresAt || new Date(row.expiresAt).getTime() > Date.now())
  };
}

function computeLogLevelSummary(level) {
  const value = String(level || "info").trim().toLowerCase();
  if (["critical", "fatal"].includes(value)) return "critical";
  if (["error"].includes(value)) return "error";
  if (["warn", "warning"].includes(value)) return "warning";
  return "info";
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
      ADD COLUMN IF NOT EXISTS admin_role TEXT NOT NULL DEFAULT 'user';
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

    await client.query(`
      ALTER TABLE app_system_logs
      ADD COLUMN IF NOT EXISTS service TEXT,
      ADD COLUMN IF NOT EXISTS endpoint TEXT,
      ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
      ADD COLUMN IF NOT EXISTS status_code INTEGER,
      ADD COLUMN IF NOT EXISTS user_id INTEGER,
      ADD COLUMN IF NOT EXISTS session_id INTEGER,
      ADD COLUMN IF NOT EXISTS actor_type TEXT,
      ADD COLUMN IF NOT EXISTS environment TEXT;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_alert_rules (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        query_text TEXT,
        service TEXT,
        severity TEXT NOT NULL DEFAULT 'warning',
        status TEXT NOT NULL DEFAULT 'active',
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        acknowledged_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        acknowledged_at TIMESTAMPTZ,
        last_triggered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_incidents (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        severity TEXT NOT NULL DEFAULT 'warning',
        request_id TEXT,
        source_log_id INTEGER REFERENCES app_system_logs(id) ON DELETE SET NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Ensure the root admin email is always an admin
    const adminEmail = String(process.env.ADMIN_EMAIL || "admin@zenin.app").trim().toLowerCase();
    await client.query(`
      UPDATE app_users
      SET is_admin = TRUE,
          admin_role = CASE
            WHEN COALESCE(NULLIF(admin_role, ''), 'user') = 'user' THEN 'super_admin'
            ELSE admin_role
          END
      WHERE email = $1;
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
        platform TEXT NOT NULL DEFAULT 'zenin',
        fee DOUBLE PRECISION,
        fee_currency TEXT,
        fee_source TEXT,
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
      ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'zenin',
      ADD COLUMN IF NOT EXISTS fee DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS fee_currency TEXT,
      ADD COLUMN IF NOT EXISTS fee_source TEXT,
      ADD COLUMN IF NOT EXISTS slippage DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS reference_price DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS execution_meta_json JSONB;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_trade_fills (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        trade_client_id TEXT,
        platform TEXT NOT NULL,
        platform_trade_id TEXT,
        platform_fill_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        market_type TEXT NOT NULL DEFAULT 'spot',
        quantity DOUBLE PRECISION NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        notional DOUBLE PRECISION NOT NULL,
        fee_amount DOUBLE PRECISION,
        fee_currency TEXT,
        fee_source TEXT NOT NULL DEFAULT 'exchange_reported',
        liquidity_role TEXT,
        executed_at TIMESTAMPTZ,
        reference_price DOUBLE PRECISION,
        raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, platform, platform_fill_id)
      );
    `);

    await client.query(`
      ALTER TABLE user_workspace_trade_fills
      ADD COLUMN IF NOT EXISTS trade_client_id TEXT,
      ADD COLUMN IF NOT EXISTS platform_trade_id TEXT,
      ADD COLUMN IF NOT EXISTS symbol TEXT,
      ADD COLUMN IF NOT EXISTS side TEXT,
      ADD COLUMN IF NOT EXISTS market_type TEXT NOT NULL DEFAULT 'spot',
      ADD COLUMN IF NOT EXISTS quantity DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS price DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS notional DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS fee_amount DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS fee_currency TEXT,
      ADD COLUMN IF NOT EXISTS fee_source TEXT NOT NULL DEFAULT 'exchange_reported',
      ADD COLUMN IF NOT EXISTS liquidity_role TEXT,
      ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS reference_price DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
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

      CREATE TABLE IF NOT EXISTS etf_inflows (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        asset VARCHAR(10) NOT NULL,
        manager VARCHAR(100) NOT NULL,
        ticker VARCHAR(20) NOT NULL,
        net_usd NUMERIC NOT NULL,
        period VARCHAR(20) DEFAULT 'daily',
        source VARCHAR(50) DEFAULT 'Farside',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, asset, ticker)
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
          platform,
          fee,
          fee_currency AS "feeCurrency",
          fee_source AS "feeSource",
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
          platform,
          fee,
          fee_currency AS "feeCurrency",
          fee_source AS "feeSource",
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

const analytics = {
  getEtfInflows: async (limit = 100) => {
    const res = await pool.query(`
      SELECT date, asset, manager, ticker, net_usd as "netUsd", period, source
      FROM etf_inflows
      ORDER BY date DESC, asset ASC, ticker ASC
      LIMIT $1
    `, [limit]);
    return res.rows.map(row => ({
      ...row,
      date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : toDateString(row.date),
      netUsd: Number(row.netUsd)
    }));
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
        s.id AS "sessionId",
        u.id,
        s.user_id AS "userId",
        s.expires_at AS "expiresAt",
        s.revoked_at AS "revokedAt",
        u.email,
        u.display_name AS "displayName",
        u.auth_provider AS "authProvider",
        u.email_verified AS "emailVerified",
        u.is_admin AS "isAdmin",
        COALESCE(u.admin_role, CASE WHEN u.is_admin THEN 'super_admin' ELSE 'user' END) AS "adminRole",
        u.suspended_at AS "suspendedAt",
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
        u.plan_updated_at AS "planUpdatedAt",
        u.created_at AS "createdAt"
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

  tradeFills: {
    sync: async (userId, fills = []) => {
      const resolvedUserId = toUserId(userId);
      const rows = Array.isArray(fills) ? fills : [];
      for (const fill of rows) {
        const normalized = {
          tradeClientId: fill.tradeClientId || fill.trade_client_id || null,
          platform: normalizePlatformValue(fill.platform, "zenin"),
          platformTradeId: fill.platformTradeId || fill.platform_trade_id || null,
          platformFillId: String(fill.platformFillId || fill.platform_fill_id || fill.id || "").trim(),
          symbol: String(fill.symbol || fill.asset || "").trim().toUpperCase(),
          side: String(fill.side || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy",
          marketType: String(fill.marketType || fill.market_type || "spot").trim().toLowerCase() || "spot",
          quantity: roundQuantity(Math.abs(toNumber(fill.quantity))),
          price: roundMoney(toNumber(fill.price)),
          notional: roundMoney(Math.abs(toNumber(fill.notional))),
          feeAmount: roundMoney(Math.abs(toNumber(fill.feeAmount ?? fill.fee_amount))),
          feeCurrency: normalizeCurrencyCode(fill.feeCurrency || fill.fee_currency, "USD"),
          feeSource: normalizeFeeSourceValue(
            fill.feeSource || fill.fee_source,
            normalizePlatformValue(fill.platform, "zenin") === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED
          ),
          liquidityRole: fill.liquidityRole || fill.liquidity_role || null,
          executedAt: fill.executedAt || fill.executed_at || null,
          referencePrice: Number.isFinite(Number(fill.referencePrice)) ? Number(fill.referencePrice) : null,
          rawPayload: parseJsonPayload(fill.rawPayload || fill.raw_payload_json, {})
        };

        if (!normalized.platformFillId || !normalized.symbol) continue;

        await pool.query(`
          INSERT INTO user_workspace_trade_fills (
            user_id, trade_client_id, platform, platform_trade_id, platform_fill_id, symbol, side, market_type,
            quantity, price, notional, fee_amount, fee_currency, fee_source, liquidity_role, executed_at,
            reference_price, raw_payload_json, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
          ON CONFLICT (user_id, platform, platform_fill_id) DO UPDATE
          SET
            trade_client_id = COALESCE(EXCLUDED.trade_client_id, user_workspace_trade_fills.trade_client_id),
            platform_trade_id = COALESCE(EXCLUDED.platform_trade_id, user_workspace_trade_fills.platform_trade_id),
            symbol = EXCLUDED.symbol,
            side = EXCLUDED.side,
            market_type = EXCLUDED.market_type,
            quantity = EXCLUDED.quantity,
            price = EXCLUDED.price,
            notional = EXCLUDED.notional,
            fee_amount = EXCLUDED.fee_amount,
            fee_currency = EXCLUDED.fee_currency,
            fee_source = EXCLUDED.fee_source,
            liquidity_role = EXCLUDED.liquidity_role,
            executed_at = COALESCE(EXCLUDED.executed_at, user_workspace_trade_fills.executed_at),
            reference_price = COALESCE(EXCLUDED.reference_price, user_workspace_trade_fills.reference_price),
            raw_payload_json = EXCLUDED.raw_payload_json,
            updated_at = NOW();
        `, [
          resolvedUserId,
          normalized.tradeClientId,
          normalized.platform,
          normalized.platformTradeId,
          normalized.platformFillId,
          normalized.symbol,
          normalized.side,
          normalized.marketType,
          normalized.quantity,
          normalized.price,
          normalized.notional,
          normalized.feeAmount,
          normalized.feeCurrency,
          normalized.feeSource,
          normalized.liquidityRole,
          normalized.executedAt,
          normalized.referencePrice,
          JSON.stringify(normalized.rawPayload || {})
        ]);
      }
    },

    getSummary: async (userId) => {
      const resolvedUserId = toUserId(userId);
      const result = await pool.query(`
        SELECT
          id,
          trade_client_id AS "tradeClientId",
          platform,
          platform_trade_id AS "platformTradeId",
          platform_fill_id AS "platformFillId",
          symbol,
          side,
          market_type AS "marketType",
          quantity,
          price,
          notional,
          fee_amount AS "feeAmount",
          fee_currency AS "feeCurrency",
          fee_source AS "feeSource",
          liquidity_role AS "liquidityRole",
          executed_at AS "executedAt",
          reference_price AS "referencePrice",
          raw_payload_json AS "rawPayload"
        FROM user_workspace_trade_fills
        WHERE user_id = $1 AND ABS(COALESCE(fee_amount, 0)) > 0
        ORDER BY COALESCE(executed_at, created_at) DESC, id DESC;
      `, [resolvedUserId]);
      return summarizeFeeBreakdown(result.rows);
    },

    getKnownSymbols: async (userId, platform) => {
      const resolvedUserId = toUserId(userId);
      const normalizedPlatform = normalizePlatformValue(platform, "");
      if (!normalizedPlatform) {
        return { all: [], spot: [], perp: [], options: [] };
      }
      const result = await pool.query(`
        SELECT DISTINCT symbol, market_type AS "marketType"
        FROM user_workspace_trade_fills
        WHERE user_id = $1 AND platform = $2
        UNION
        SELECT DISTINCT asset AS symbol, market_type AS "marketType"
        FROM user_workspace_trades
        WHERE user_id = $1 AND platform = $2;
      `, [resolvedUserId, normalizedPlatform]);

      const buckets = { all: [], spot: [], perp: [], options: [] };
      const seen = new Set();
      result.rows.forEach((row) => {
        const symbol = String(row.symbol || "").trim().toUpperCase();
        const marketType = String(row.marketType || "spot").trim().toLowerCase();
        if (!symbol || seen.has(`${symbol}:${marketType}`)) return;
        seen.add(`${symbol}:${marketType}`);
        buckets.all.push(symbol);
        if (marketType.includes("perp") || marketType.includes("future")) buckets.perp.push(symbol);
        else if (marketType.includes("option")) buckets.options.push(symbol);
        else buckets.spot.push(symbol);
      });
      return buckets;
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
            quantity, price, notional, platform, fee, fee_currency, fee_source, slippage, reference_price, execution_meta_json, strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
          ON CONFLICT (user_id, client_id) DO UPDATE
          SET
            date = EXCLUDED.date,
            executed_at = COALESCE(EXCLUDED.executed_at, user_workspace_trades.executed_at),
            asset = EXCLUDED.asset,
            name = EXCLUDED.name,
            type = EXCLUDED.type,
            side = EXCLUDED.side,
            market_type = EXCLUDED.market_type,
            status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            price = EXCLUDED.price,
            notional = EXCLUDED.notional,
            platform = EXCLUDED.platform,
            fee = COALESCE(EXCLUDED.fee, user_workspace_trades.fee),
            fee_currency = COALESCE(EXCLUDED.fee_currency, user_workspace_trades.fee_currency),
            fee_source = COALESCE(EXCLUDED.fee_source, user_workspace_trades.fee_source),
            slippage = COALESCE(EXCLUDED.slippage, user_workspace_trades.slippage),
            reference_price = COALESCE(EXCLUDED.reference_price, user_workspace_trades.reference_price),
            execution_meta_json = COALESCE(EXCLUDED.execution_meta_json, user_workspace_trades.execution_meta_json),
            strategy_name = COALESCE(EXCLUDED.strategy_name, user_workspace_trades.strategy_name),
            legs_json = COALESCE(EXCLUDED.legs_json, user_workspace_trades.legs_json);
        `, [
          resolvedUserId, t.clientId, t.date, t.executedAt, t.asset, t.name, t.type, t.side,
          t.marketType, t.status, t.quantity, t.price, t.notional,
          normalizePlatformValue(t.platform, "zenin"),
          Number.isFinite(Number(t.fee)) ? Number(t.fee) : null,
          normalizeCurrencyCode(t.feeCurrency || t.currency, "USD"),
          normalizeFeeSourceValue(
            t.feeSource,
            normalizePlatformValue(t.platform, "zenin") === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED
          ),
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
        platform: normalizePlatformValue(trade.platform, "zenin"),
        fee: Number.isFinite(Number(trade.fee)) ? Number(trade.fee) : 0,
        fee_currency: normalizeCurrencyCode(trade.feeCurrency || trade.currency, "USD"),
        fee_source: normalizeFeeSourceValue(
          trade.feeSource,
          normalizePlatformValue(trade.platform, "zenin") === "zenin"
            ? FEE_SOURCE_CHEAPEST_AVENUE
            : (trade.fee != null ? FEE_SOURCE_EXCHANGE_REPORTED : FEE_SOURCE_CHEAPEST_AVENUE)
        ),
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
            quantity, price, notional, platform, fee, fee_currency, fee_source, slippage, reference_price, execution_meta_json,
            balance_after, portfolio_value_after, account_equity_after, position_after,
            strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
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
            platform,
            fee,
            fee_currency AS "feeCurrency",
            fee_source AS "feeSource",
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
          normalized.platform,
          normalized.fee,
          normalized.fee_currency,
          normalized.fee_source,
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
        const savedTrade = mapTradeRow(result.rows[0]);
        if (Math.abs(normalized.fee) > 0) {
          await userWorkspace.tradeFills.sync(resolvedUserId, [{
            tradeClientId: normalized.client_id || savedTrade.clientId || null,
            platform: normalized.platform,
            platformTradeId: normalized.client_id || savedTrade.clientId || `manual-${savedTrade.id}`,
            platformFillId: normalized.client_id || savedTrade.clientId || `manual-${savedTrade.id}`,
            symbol: normalized.asset,
            side: normalized.side,
            marketType: normalized.marketType,
            quantity: normalized.quantity,
            price: normalized.price,
            notional: normalized.notional,
            feeAmount: normalized.fee,
            feeCurrency: normalized.fee_currency,
            feeSource: normalized.fee_source,
            executedAt: normalized.executed_at || savedTrade.executedAt || `${normalized.date}T00:00:00.000Z`,
            referencePrice: normalized.reference_price,
            rawPayload: normalized.execution_meta_json || {}
          }]);
        }
        return savedTrade;
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
              platform,
              fee,
              fee_currency AS "feeCurrency",
              fee_source AS "feeSource",
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
      const platform = "zenin";

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
            platform,
            fee,
            fee_currency AS "feeCurrency",
            fee_source AS "feeSource",
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
              feeCurrency: existingTradeResult.rows[0]?.feeCurrency || "USD",
              feeSource: normalizeFeeSourceValue(existingTradeResult.rows[0]?.feeSource, FEE_SOURCE_CHEAPEST_AVENUE),
              slippage: toNumber(existingTradeResult.rows[0]?.slippage, 0),
              referencePrice: existingTradeResult.rows[0]?.referencePrice == null ? null : toNumber(existingTradeResult.rows[0]?.referencePrice),
              executionMeta: parseJsonPayload(existingTradeResult.rows[0]?.executionMeta, {})
            },
            idempotentReplay: true
          };
        }

        const buyCurrency = String(payload.buyCurrency || "USD").toUpperCase();
        const feeCurrency = buyCurrency;
        const feeSource = FEE_SOURCE_CHEAPEST_AVENUE;
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
            quantity, price, notional, platform, fee, fee_currency, fee_source, slippage, reference_price, execution_meta_json,
            balance_after, portfolio_value_after, account_equity_after, position_after,
            strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
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
            platform,
            fee,
            fee_currency AS "feeCurrency",
            fee_source AS "feeSource",
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
          platform,
          fee,
          feeCurrency,
          feeSource,
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

        await client.query(`
          INSERT INTO user_workspace_trade_fills (
            user_id, trade_client_id, platform, platform_trade_id, platform_fill_id, symbol, side, market_type,
            quantity, price, notional, fee_amount, fee_currency, fee_source, liquidity_role, executed_at,
            reference_price, raw_payload_json, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
          ON CONFLICT (user_id, platform, platform_fill_id) DO UPDATE
          SET
            trade_client_id = EXCLUDED.trade_client_id,
            platform_trade_id = EXCLUDED.platform_trade_id,
            symbol = EXCLUDED.symbol,
            side = EXCLUDED.side,
            market_type = EXCLUDED.market_type,
            quantity = EXCLUDED.quantity,
            price = EXCLUDED.price,
            notional = EXCLUDED.notional,
            fee_amount = EXCLUDED.fee_amount,
            fee_currency = EXCLUDED.fee_currency,
            fee_source = EXCLUDED.fee_source,
            liquidity_role = EXCLUDED.liquidity_role,
            executed_at = EXCLUDED.executed_at,
            reference_price = EXCLUDED.reference_price,
            raw_payload_json = EXCLUDED.raw_payload_json,
            updated_at = NOW();
        `, [
          resolvedUserId,
          clientId,
          platform,
          clientId,
          clientId,
          symbol,
          orderType,
          marketType,
          roundQuantity(quantity),
          executedPrice,
          Math.abs(notional),
          fee,
          feeCurrency,
          feeSource,
          "taker",
          executionTimestamp,
          referencePrice,
          JSON.stringify({
            platform,
            feeCurrency,
            feeSource,
            orderType,
            executionMeta
          })
        ]);

        await client.query("COMMIT");
        return {
          balance: nextCashBalance,
          holdings,
          trade: mapTradeRow(tradeResult.rows[0]),
          executionCost: {
            fee,
            feeCurrency,
            feeSource,
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
  getUserSummary: async (userId) => {
    const result = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.display_name AS name,
        u.current_plan AS plan,
        u.current_billing_cycle AS "billingCycle",
        u.is_admin AS "isAdmin",
        COALESCE(u.admin_role, CASE WHEN u.is_admin THEN 'super_admin' ELSE 'user' END) AS "adminRole",
        u.email_verified AS "emailVerified",
        u.auth_provider AS "authProvider",
        u.pending_email AS "pendingEmail",
        u.password_changed_at AS "passwordChangedAt",
        u.two_factor_enabled AS "twoFactorEnabled",
        u.two_factor_method AS "twoFactorMethod",
        u.suspended_at AS "suspendedAt",
        u.plan_updated_at AS "planUpdatedAt",
        u.created_at AS joined,
        MAX(s.created_at) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > NOW()) AS "lastSeenAt",
        COUNT(s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > NOW())::int AS "activeSessionCount"
      FROM app_users u
      LEFT JOIN auth_sessions s ON s.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id
      LIMIT 1
    `, [toUserId(userId)]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...row,
      joined: toIsoString(row.joined),
      lastSeenAt: toIsoString(row.lastSeenAt),
      suspendedAt: toIsoString(row.suspendedAt),
      passwordChangedAt: toIsoString(row.passwordChangedAt),
      planUpdatedAt: toIsoString(row.planUpdatedAt)
    };
  },

  listAllUsers: async (filters = {}) => {
    const values = [];
    const conditions = [];

    if (filters.query) {
      values.push(`%${String(filters.query).trim()}%`);
      conditions.push(`(u.email ILIKE $${values.length} OR COALESCE(u.display_name, '') ILIKE $${values.length} OR CAST(u.id AS TEXT) ILIKE $${values.length})`);
    }

    if (filters.plan) {
      values.push(normalizePlanValue(filters.plan));
      conditions.push(`u.current_plan = $${values.length}`);
    }

    if (filters.status === "active") {
      conditions.push(`u.suspended_at IS NULL`);
    } else if (filters.status === "suspended") {
      conditions.push(`u.suspended_at IS NOT NULL`);
    }

    if (filters.role) {
      const normalizedRole = normalizeAdminRoleValue(filters.role);
      values.push(normalizedRole);
      if (normalizedRole === "user") {
        conditions.push(`COALESCE(u.admin_role, CASE WHEN u.is_admin THEN 'super_admin' ELSE 'user' END) = $${values.length}`);
      } else {
        conditions.push(`COALESCE(u.admin_role, CASE WHEN u.is_admin THEN 'super_admin' ELSE 'user' END) = $${values.length}`);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`
      SELECT
        u.id,
        u.email,
        u.display_name AS name,
        u.current_plan AS plan,
        u.current_billing_cycle AS "billingCycle",
        u.is_admin AS "isAdmin",
        COALESCE(u.admin_role, CASE WHEN u.is_admin THEN 'super_admin' ELSE 'user' END) AS "adminRole",
        u.suspended_at AS "suspendedAt",
        u.plan_updated_at AS "planUpdatedAt",
        u.created_at AS joined,
        MAX(s.created_at) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > NOW()) AS "lastSeenAt",
        COUNT(s.id) FILTER (WHERE s.revoked_at IS NULL AND s.expires_at > NOW())::int AS "activeSessionCount"
      FROM app_users u
      LEFT JOIN auth_sessions s ON s.user_id = u.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `, values);

    return result.rows.map((row) => ({
      ...row,
      joined: toIsoString(row.joined),
      suspendedAt: toIsoString(row.suspendedAt),
      planUpdatedAt: toIsoString(row.planUpdatedAt),
      lastSeenAt: toIsoString(row.lastSeenAt)
    }));
  },

  getUserById: async (userId) => {
    const summary = await admin.getUserSummary(userId);
    if (!summary) return null;

    const sessionsResult = await pool.query(`
      SELECT
        id,
        user_id AS "userId",
        ip_address AS "ipAddress",
        user_agent AS "userAgent",
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt"
      FROM auth_sessions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [toUserId(userId)]);

    const auditResult = await pool.query(`
      SELECT
        l.id,
        l.action,
        l.details,
        l.ip_address AS "ipAddress",
        l.created_at AS "createdAt",
        u.email AS "adminEmail",
        COALESCE(u.display_name, u.email, 'System') AS actor,
        COALESCE(u.admin_role, CASE WHEN u.is_admin THEN 'super_admin' ELSE 'user' END) AS "actorRole"
      FROM admin_audit_logs l
      LEFT JOIN app_users u ON l.admin_user_id = u.id
      WHERE l.target_user_id = $1
      ORDER BY l.created_at DESC
      LIMIT 10
    `, [toUserId(userId)]);

    const activityResult = await pool.query(`
      SELECT
        id,
        level,
        service,
        endpoint,
        message,
        request_id AS "requestId",
        status_code AS "statusCode",
        duration_ms AS "durationMs",
        created_at AS "createdAt"
      FROM app_system_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [toUserId(userId)]);

    return {
      user: summary,
      sessions: sessionsResult.rows.map((row) => formatUserSession(row)),
      recentAudit: auditResult.rows.map((row) => ({
        ...row,
        details: parseJsonPayload(row.details, {}),
        createdAt: toIsoString(row.createdAt)
      })),
      recentActivity: activityResult.rows.map((row) => ({
        ...row,
        createdAt: toIsoString(row.createdAt)
      }))
    };
  },

  createUser: async ({ email, displayName = null, plan = "starter", adminRole = "user", passwordHash = "" }) => {
    const created = await userAuth.createUser({
      email,
      passwordHash,
      displayName,
      authProvider: "email",
      emailVerified: true
    });

    await admin.updateUserPlan(created.id, plan);
    await admin.updateUserAdminStatus(created.id, adminRole);
    return admin.getUserSummary(created.id);
  },

  updateUserPlan: async (userId, plan) => {
    const validPlan = normalizePlanValue(plan);
    await pool.query(`
      UPDATE app_users
      SET current_plan = $2, plan_updated_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [toUserId(userId), validPlan]);
    return admin.getUserSummary(userId);
  },

  updateUserAdminStatus: async (userId, adminRole) => {
    const normalizedRole = normalizeAdminRoleValue(adminRole);
    await pool.query(`
      UPDATE app_users
      SET is_admin = $2, admin_role = $3, updated_at = NOW()
      WHERE id = $1
    `, [toUserId(userId), normalizedRole !== "user", normalizedRole]);
    return admin.getUserSummary(userId);
  },

  suspendUser: async (userId, isSuspended) => {
    const suspendedAt = isSuspended ? new Date() : null;
    await pool.query(`
      UPDATE app_users
      SET suspended_at = $2, updated_at = NOW()
      WHERE id = $1
    `, [toUserId(userId), suspendedAt]);
    return admin.getUserSummary(userId);
  },

  deleteUser: async (userId) => {
    const resolvedId = toUserId(userId);
    const existing = await admin.getUserSummary(resolvedId);
    const result = await pool.query(`
      DELETE FROM app_users
      WHERE id = $1
      RETURNING id, email
    `, [resolvedId]);
    if (!result.rows[0]) return null;
    return existing || result.rows[0];
  },

  revokeUserSessions: async (userId) => {
    const result = await pool.query(`
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL
      RETURNING id
    `, [toUserId(userId)]);
    return { revokedCount: result.rowCount || 0 };
  },

  revokeAllSessions: async ({ excludeUserId = null } = {}) => {
    const values = [];
    const conditions = ["revoked_at IS NULL"];
    if (excludeUserId) {
      values.push(toUserId(excludeUserId));
      conditions.push(`user_id <> $${values.length}`);
    }
    const result = await pool.query(`
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE ${conditions.join(" AND ")}
      RETURNING id
    `, values);
    return { revokedCount: result.rowCount || 0 };
  },

  bulkUpdateUsers: async ({ userIds = [], action, value = null }) => {
    const ids = Array.from(new Set((userIds || []).map((entry) => toUserId(entry))));
    const results = [];
    for (const userId of ids) {
      if (action === "suspend") {
        results.push(await admin.suspendUser(userId, true));
      } else if (action === "reactivate") {
        results.push(await admin.suspendUser(userId, false));
      } else if (action === "plan") {
        results.push(await admin.updateUserPlan(userId, value));
      } else if (action === "role") {
        results.push(await admin.updateUserAdminStatus(userId, value));
      } else if (action === "revoke_sessions") {
        await admin.revokeUserSessions(userId);
        results.push(await admin.getUserSummary(userId));
      }
    }
    return results.filter(Boolean);
  },

  createPasswordResetToken: async (userId) => {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 3600000);

    await pool.query(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
    `, [toUserId(userId), tokenHash, expiresAt]);

    return token;
  },

  getSystemStats: async () => {
    const planPriceMap = { starter: 0, pro: 29, desk: 99 };
    const [userCount, sessionCount, tradeCount, planBreakdown, recentActivity, errorMetrics, alertSummary, incidentSummary, recentDeployments] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM app_users"),
      pool.query("SELECT COUNT(*)::int AS count FROM auth_sessions WHERE expires_at > NOW() AND revoked_at IS NULL"),
      pool.query("SELECT COUNT(*)::int AS count FROM user_workspace_trades"),
      pool.query(`
        SELECT current_plan AS plan, COUNT(*)::int AS count
        FROM app_users
        GROUP BY current_plan
      `),
      pool.query(`
        SELECT
          COALESCE(t.email, u.email, 'system@zenin.app') AS email,
          COALESCE(l.action, 'USER_CREATED') AS action,
          COALESCE(l.created_at, t.created_at, u.created_at) AS time
        FROM admin_audit_logs l
        LEFT JOIN app_users u ON l.admin_user_id = u.id
        LEFT JOIN app_users t ON l.target_user_id = t.id
        ORDER BY COALESCE(l.created_at, t.created_at, u.created_at) DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status_code >= 500)::int AS server_errors,
          COUNT(*) FILTER (WHERE status_code >= 400)::int AS failed_requests,
          COUNT(*)::int AS total_requests
        FROM app_system_logs
        WHERE created_at >= NOW() - INTERVAL '7 days'
      `),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active_alerts
        FROM admin_alert_rules
      `),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open_incidents
        FROM admin_incidents
      `),
      pool.query(`
        SELECT
          l.created_at AS "createdAt",
          COALESCE(u.display_name, u.email, 'System') AS actor,
          COALESCE(l.details->>'reason', 'Admin workspace migration') AS reason,
          COALESCE((l.details->'migration'->>'force')::boolean, false) AS force
        FROM admin_audit_logs l
        LEFT JOIN app_users u ON l.admin_user_id = u.id
        WHERE l.action = 'RUN_ADMIN_MIGRATION'
        ORDER BY l.created_at DESC
        LIMIT 5
      `)
    ]);

    const plans = planBreakdown.rows.reduce((acc, row) => {
      acc[String(row.plan || "starter").toLowerCase()] = Number(row.count || 0);
      return acc;
    }, {});

    const mrr = Object.entries(plans).reduce((total, [plan, count]) => total + ((planPriceMap[plan] || 0) * Number(count || 0)), 0);
    const totalRequests = Number(errorMetrics.rows[0]?.total_requests || 0);
    const failedRequests = Number(errorMetrics.rows[0]?.failed_requests || 0);
    const serverErrors = Number(errorMetrics.rows[0]?.server_errors || 0);

    return {
      totalUsers: Number(userCount.rows[0]?.count || 0),
      activeSessions: Number(sessionCount.rows[0]?.count || 0),
      totalTrades: Number(tradeCount.rows[0]?.count || 0),
      planBreakdown: plans,
      mrr,
      activeAlerts: Number(alertSummary.rows[0]?.active_alerts || 0),
      openIncidents: Number(incidentSummary.rows[0]?.open_incidents || 0),
      recentActivity: recentActivity.rows.map((row) => ({
        ...row,
        time: toIsoString(row.time) || new Date().toISOString()
      })),
      recentDeployments: recentDeployments.rows.map((row) => ({
        ...row,
        createdAt: toIsoString(row.createdAt) || new Date().toISOString()
      })),
      systemHealth: {
        api: totalRequests ? Number(((1 - (serverErrors / totalRequests)) * 100).toFixed(2)) : 100,
        web: totalRequests ? Number(((1 - (failedRequests / totalRequests)) * 100).toFixed(2)) : 100,
        db: 99.96
      }
    };
  },

  logAdminAction: async ({ adminId, targetUserId, action, details, ipAddress }) => {
    await pool.query(`
      INSERT INTO admin_audit_logs (admin_user_id, target_user_id, action, details, ip_address)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      adminId ? toUserId(adminId) : null,
      targetUserId ? toUserId(targetUserId) : null,
      String(action || "").trim().toUpperCase(),
      details ? JSON.stringify(details) : null,
      ipAddress || null
    ]);
  },

  recordSystemLog: async ({
    level = "info",
    message,
    context = null,
    requestId = null,
    ipAddress = null,
    service = null,
    endpoint = null,
    durationMs = null,
    statusCode = null,
    userId = null,
    sessionId = null,
    actorType = null,
    environment = process.env.NODE_ENV || "development"
  }) => {
    if (!message) return null;
    const result = await pool.query(`
      INSERT INTO app_system_logs (
        level,
        message,
        context_json,
        request_id,
        ip_address,
        service,
        endpoint,
        duration_ms,
        status_code,
        user_id,
        session_id,
        actor_type,
        environment
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      computeLogLevelSummary(level).toUpperCase(),
      String(message).slice(0, 600),
      context ? JSON.stringify(context) : null,
      requestId || null,
      ipAddress || null,
      service || null,
      endpoint || null,
      durationMs == null ? null : Math.max(0, Math.round(Number(durationMs) || 0)),
      statusCode == null ? null : Number(statusCode),
      userId ? toUserId(userId) : null,
      sessionId ? Number(sessionId) : null,
      actorType || null,
      environment || null
    ]);
    return result.rows[0] || null;
  },

  getDatabaseStats: async ({ table: requestedTable = null, page = 1, pageSize = 10 } = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(50, Math.max(5, Number(pageSize) || 10));
    const offset = (safePage - 1) * safePageSize;

    const [tableStats, dbSize, connections, latencyMetrics, migrationHistoryResult] = await Promise.all([
      pool.query(`
        SELECT
          relname AS name,
          n_live_tup::bigint AS rows,
          pg_total_relation_size(relid) AS "sizeBytes",
          pg_size_pretty(pg_total_relation_size(relid)) AS "sizePretty",
          last_vacuum AS "lastVacuum",
          last_analyze AS "lastAnalyze"
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
      `),
      pool.query("SELECT pg_database_size(current_database()) AS bytes, pg_size_pretty(pg_database_size(current_database())) AS size"),
      pool.query("SELECT COUNT(*)::int AS count FROM pg_stat_activity"),
      pool.query(`
        SELECT
          COALESCE(AVG(duration_ms), 0)::numeric(10,2) AS avg_latency
        FROM app_system_logs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND duration_ms IS NOT NULL
      `),
      pool.query(`
        SELECT
          l.created_at AS "createdAt",
          COALESCE(u.display_name, u.email, 'System') AS actor,
          COALESCE(l.details->>'reason', 'Admin workspace migration') AS reason,
          COALESCE((l.details->'migration'->>'force')::boolean, false) AS force
        FROM admin_audit_logs l
        LEFT JOIN app_users u ON l.admin_user_id = u.id
        WHERE l.action = 'RUN_ADMIN_MIGRATION'
        ORDER BY l.created_at DESC
        LIMIT 8
      `)
    ]);

    const tables = tableStats.rows.map((row) => ({
      ...row,
      rows: Number(row.rows || 0),
      sizeBytes: Number(row.sizeBytes || 0),
      lastVacuum: toIsoString(row.lastVacuum),
      lastAnalyze: toIsoString(row.lastAnalyze)
    }));

    const selectedTableName = requestedTable && tables.some((entry) => entry.name === requestedTable)
      ? requestedTable
      : (tables[0]?.name || null);

    let selectedTable = null;
    if (selectedTableName) {
      const columnsResult = await pool.query(`
        SELECT
          column_name AS name,
          data_type AS "dataType",
          is_nullable AS "isNullable",
          column_default AS "defaultValue"
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `, [selectedTableName]);

      const indexesResult = await pool.query(`
        SELECT
          indexname AS name,
          indexdef AS definition
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname
      `, [selectedTableName]);

      const primaryKeyResult = await pool.query(`
        SELECT kcu.column_name AS name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = $1
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position
      `, [selectedTableName]);

      const foreignKeysResult = await pool.query(`
        SELECT COUNT(*)::int AS count
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = $1
          AND constraint_type = 'FOREIGN KEY'
      `, [selectedTableName]);

      const previewResult = await pool.query(`
        SELECT *
        FROM ${quoteIdentifier(selectedTableName)}
        LIMIT $1 OFFSET $2
      `, [safePageSize, offset]);

      const rowCountResult = await pool.query(`
        SELECT COUNT(*)::bigint AS count
        FROM ${quoteIdentifier(selectedTableName)}
      `);

      const rowCount = Number(rowCountResult.rows[0]?.count || 0);
      const selectedMeta = tables.find((entry) => entry.name === selectedTableName);
      selectedTable = {
        name: selectedTableName,
        rows: rowCount,
        page: safePage,
        pageSize: safePageSize,
        totalPages: Math.max(1, Math.ceil(rowCount / safePageSize)),
        queryPreview: `SELECT * FROM ${selectedTableName} LIMIT ${safePageSize} OFFSET ${offset};`,
        previewRows: previewResult.rows,
        columns: columnsResult.rows,
        indexes: indexesResult.rows,
        schemaSummary: {
          primaryKey: primaryKeyResult.rows.map((row) => row.name).join(", ") || "None",
          indexCount: indexesResult.rowCount,
          foreignKeys: Number(foreignKeysResult.rows[0]?.count || 0),
          rowCount,
          tableSize: selectedMeta?.sizePretty || "Unknown"
        }
      };
    }

    return {
      summary: {
        totalTables: tables.length,
        totalSize: dbSize.rows[0]?.size || "0 bytes",
        totalSizeBytes: Number(dbSize.rows[0]?.bytes || 0),
        activeConnections: Number(connections.rows[0]?.count || 0),
        uptime: "99.99%",
        avgQueryLatencyMs: Number(latencyMetrics.rows[0]?.avg_latency || 0),
        lastBackup: new Date(Date.now() - (4 * 60 * 60 * 1000)).toISOString(),
        nextBackup: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString()
      },
      tables,
      selectedTable,
      replication: [
        { label: "Primary", value: "current-region", status: "Primary" },
        { label: "Replica", value: process.env.DATABASE_READ_REPLICA_URL ? "configured" : "not configured", status: process.env.DATABASE_READ_REPLICA_URL ? "Healthy" : "Unavailable" }
      ],
      maintenance: tables.slice(0, 5).map((entry) => ({
        task: `Analyze ${entry.name}`,
        time: entry.lastAnalyze || entry.lastVacuum || new Date().toISOString(),
        status: "Completed"
      })),
      migrationHistory: migrationHistoryResult.rows.map((row) => ({
        ...row,
        createdAt: toIsoString(row.createdAt) || new Date().toISOString()
      }))
    };
  },

  getBillingStats: async () => {
    const planPriceMap = { starter: 0, pro: 29, desk: 99 };
    const [planBreakdown, billingUsers, subscriptionChangesResult] = await Promise.all([
      pool.query(`
        SELECT current_plan AS plan, COUNT(*)::int AS count
        FROM app_users
        GROUP BY current_plan
      `),
      pool.query(`
        SELECT
          id,
          email,
          display_name AS name,
          current_plan AS plan,
          current_billing_cycle AS "billingCycle",
          plan_updated_at AS "planUpdatedAt",
          suspended_at AS "suspendedAt",
          created_at AS "createdAt"
        FROM app_users
        ORDER BY plan_updated_at DESC NULLS LAST, created_at DESC
        LIMIT 24
      `),
      pool.query(`
        SELECT
          l.id,
          l.created_at AS "createdAt",
          COALESCE(t.display_name, t.email, CAST(l.target_user_id AS TEXT), 'Workspace') AS customer,
          COALESCE(l.details->>'oldPlan', 'starter') AS "oldPlan",
          COALESCE(l.details->>'newPlan', 'starter') AS "newPlan",
          COALESCE(u.display_name, u.email, 'System') AS actor,
          COALESCE(l.details->>'reason', '') AS reason
        FROM admin_audit_logs l
        LEFT JOIN app_users u ON l.admin_user_id = u.id
        LEFT JOIN app_users t ON l.target_user_id = t.id
        WHERE l.action = 'UPDATE_PLAN'
        ORDER BY l.created_at DESC
        LIMIT 10
      `)
    ]);

    const plans = planBreakdown.rows.reduce((acc, row) => {
      acc[String(row.plan || "starter").toLowerCase()] = Number(row.count || 0);
      return acc;
    }, {});

    const totalCustomers = Object.values(plans).reduce((sum, count) => sum + Number(count || 0), 0);
    const mrr = Object.entries(plans).reduce((sum, [plan, count]) => sum + ((planPriceMap[plan] || 0) * Number(count || 0)), 0);
    const activeSubscriptions = totalCustomers - (plans.starter || 0);

    const invoices = billingUsers.rows
      .filter((row) => (planPriceMap[row.plan] || 0) > 0)
      .slice(0, 12)
      .map((row, index) => {
        const amount = planPriceMap[row.plan] || 0;
        const status = row.suspendedAt ? "failed" : index < 2 ? "pending" : "paid";
        const issueDate = row.planUpdatedAt || row.createdAt || new Date().toISOString();
        return {
          id: `INV-${String(row.id).padStart(5, "0")}-${String(index + 1).padStart(2, "0")}`,
          customer: row.name || row.email,
          email: row.email,
          plan: row.plan,
          amount,
          status,
          issuedAt: toIsoString(issueDate),
          dueAt: new Date(new Date(issueDate).getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString()
        };
      });

    const transactions = invoices.slice(0, 8).map((invoice) => ({
      id: `TX-${invoice.id}`,
      invoiceId: invoice.id,
      customer: invoice.customer,
      amount: invoice.amount,
      status: invoice.status === "paid" ? "received" : invoice.status,
      createdAt: invoice.issuedAt
    }));

    const failedPayments = invoices.filter((invoice) => invoice.status === "failed").length;
    const outstandingAmount = invoices
      .filter((invoice) => invoice.status !== "paid")
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);

    const revenueTrend = Array.from({ length: 6 }).map((_, index) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - index));
      const multiplier = 0.82 + (index * 0.04);
      return {
        month: date.toLocaleString("en-US", { month: "short" }),
        revenue: Math.round(mrr * multiplier)
      };
    });

    return {
      summary: {
        mrr,
        totalCustomers,
        activeSubscriptions,
        avgRevenuePerUser: totalCustomers ? Number((mrr / totalCustomers).toFixed(2)) : 0,
        failedPayments,
        outstandingAmount
      },
      plans,
      revenueTrend,
      invoices,
      transactions,
      subscriptionChanges: subscriptionChangesResult.rows.map((row) => ({
        ...row,
        createdAt: toIsoString(row.createdAt) || new Date().toISOString()
      })),
      dunningAlerts: invoices
        .filter((invoice) => invoice.status !== "paid")
        .map((invoice) => ({
          invoiceId: invoice.id,
          customer: invoice.customer,
          amount: invoice.amount,
          status: invoice.status
        })),
      providerStatus: {
        name: process.env.STRIPE_SECRET_KEY ? "Stripe" : "Internal Plan Ledger",
        status: process.env.STRIPE_SECRET_KEY ? "connected" : "degraded",
        lastSyncAt: new Date().toISOString(),
        note: process.env.STRIPE_SECRET_KEY
          ? "Stripe credentials detected."
          : "No Stripe key detected. Billing views are derived from current user plans."
      }
    };
  },

  getAdminLogs: async (filters = {}) => {
    const safePage = Math.max(1, Number(filters.page) || 1);
    const safePageSize = Math.min(100, Math.max(10, Number(filters.pageSize) || 25));
    const offset = (safePage - 1) * safePageSize;
    const values = [];
    const conditions = [];

    if (filters.query) {
      values.push(`%${String(filters.query).trim()}%`);
      conditions.push(`(
        l.action ILIKE $${values.length}
        OR COALESCE(u.email, '') ILIKE $${values.length}
        OR COALESCE(t.email, '') ILIKE $${values.length}
        OR COALESCE(CAST(l.details AS TEXT), '') ILIKE $${values.length}
      )`);
    }

    if (filters.targetUserId) {
      values.push(toUserId(filters.targetUserId));
      conditions.push(`l.target_user_id = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalQuery = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM admin_audit_logs l
      LEFT JOIN app_users u ON l.admin_user_id = u.id
      LEFT JOIN app_users t ON l.target_user_id = t.id
      ${whereClause}
    `, values);

    values.push(safePageSize, offset);
    const result = await pool.query(`
      SELECT
        l.id,
        l.action,
        l.details,
        l.ip_address AS "ipAddress",
        l.created_at AS "createdAt",
        u.id AS "actorId",
        u.email AS "adminEmail",
        COALESCE(u.display_name, u.email, 'System') AS actor,
        COALESCE(u.admin_role, CASE WHEN u.is_admin THEN 'super_admin' ELSE 'user' END) AS "actorRole",
        t.id AS "targetUserId",
        t.email AS "targetEmail",
        COALESCE(t.display_name, t.email, CAST(l.target_user_id AS TEXT), 'Workspace') AS target
      FROM admin_audit_logs l
      LEFT JOIN app_users u ON l.admin_user_id = u.id
      LEFT JOIN app_users t ON l.target_user_id = t.id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);

    const rows = result.rows.map((row) => {
      const details = parseJsonPayload(row.details, {}) || {};
      const severity = /DELETE|SUSPEND/.test(row.action)
        ? "critical"
        : /ROLE|MIGRATION|REVOKE/.test(row.action)
          ? "high"
          : /PLAN|RECOVER/.test(row.action)
            ? "medium"
            : "low";
      return {
        ...row,
        details,
        createdAt: toIsoString(row.createdAt),
        severity,
        status: "success",
        reason: details.reason || null,
        diff: details.diff || details.changes || null,
        requestId: details.requestId || null,
        summary: details.summary || null
      };
    });

    return {
      rows,
      total: Number(totalQuery.rows[0]?.count || 0)
    };
  },

  getSystemLogs: async (filters = {}) => {
    const safePage = Math.max(1, Number(filters.page) || 1);
    const safePageSize = Math.min(100, Math.max(10, Number(filters.pageSize) || 25));
    const offset = (safePage - 1) * safePageSize;
    const values = [];
    const conditions = [];

    if (filters.query) {
      values.push(`%${String(filters.query).trim()}%`);
      conditions.push(`(
        message ILIKE $${values.length}
        OR COALESCE(service, '') ILIKE $${values.length}
        OR COALESCE(endpoint, '') ILIKE $${values.length}
        OR COALESCE(request_id, '') ILIKE $${values.length}
      )`);
    }

    if (filters.level) {
      values.push(String(filters.level).trim().toUpperCase());
      conditions.push(`level = $${values.length}`);
    }

    if (filters.service) {
      values.push(String(filters.service).trim());
      conditions.push(`service = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalQuery = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM app_system_logs
      ${whereClause}
    `, values);

    values.push(safePageSize, offset);
    const rowsResult = await pool.query(`
      SELECT
        id,
        level,
        service,
        endpoint,
        message,
        context_json AS context,
        request_id AS "requestId",
        ip_address AS "ipAddress",
        duration_ms AS "durationMs",
        status_code AS "statusCode",
        user_id AS "userId",
        session_id AS "sessionId",
        actor_type AS "actorType",
        environment,
        created_at AS "createdAt"
      FROM app_system_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);

    const [metricsQuery, slowEndpointsQuery, errorTrendQuery, deployMarkersQuery, alertRules, incidents] = await Promise.all([
      pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE level IN ('ERROR', 'CRITICAL'))::int AS error_count,
        COUNT(*) FILTER (WHERE status_code >= 400)::int AS failed_requests,
        COUNT(*) FILTER (WHERE service = 'Auth')::int AS auth_requests,
        COUNT(*) FILTER (WHERE service = 'Auth' AND status_code >= 400)::int AS auth_failures,
        COUNT(*)::int AS total_requests,
        COALESCE(AVG(duration_ms), 0)::numeric(10,2) AS avg_latency,
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::numeric(10,2) AS p95_latency
      FROM app_system_logs
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `),
      pool.query(`
      SELECT
        COALESCE(endpoint, 'Unknown') AS endpoint,
        ROUND(COALESCE(AVG(duration_ms), 0))::int AS avg_ms,
        ROUND(COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0))::int AS p95_ms,
        COUNT(*)::int AS request_count
      FROM app_system_logs
      WHERE duration_ms IS NOT NULL
        AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY COALESCE(endpoint, 'Unknown')
      HAVING COUNT(*) > 0
      ORDER BY p95_ms DESC, avg_ms DESC
      LIMIT 5
    `),
      pool.query(`
        SELECT
          TO_CHAR(day_bucket, 'Mon DD') AS label,
          total_count::int AS "totalCount",
          error_count::int AS "errorCount"
        FROM (
          SELECT
            date_trunc('day', created_at) AS day_bucket,
            COUNT(*) AS total_count,
            COUNT(*) FILTER (WHERE level IN ('ERROR', 'CRITICAL')) AS error_count
          FROM app_system_logs
          WHERE created_at >= NOW() - INTERVAL '7 days'
          GROUP BY date_trunc('day', created_at)
        ) daily
        ORDER BY day_bucket ASC
      `),
      pool.query(`
        SELECT
          l.created_at AS "createdAt",
          COALESCE(u.display_name, u.email, 'System') AS actor,
          COALESCE(l.details->>'reason', 'Admin workspace migration') AS reason
        FROM admin_audit_logs l
        LEFT JOIN app_users u ON l.admin_user_id = u.id
        WHERE l.action = 'RUN_ADMIN_MIGRATION'
        ORDER BY l.created_at DESC
        LIMIT 5
      `),
      admin.listAlertRules({ status: "active", limit: 10 }),
      admin.listIncidents({ status: "open", limit: 10 })
    ]);

    const rows = rowsResult.rows.map((row) => ({
      ...row,
      level: String(row.level || "INFO").toLowerCase(),
      createdAt: toIsoString(row.createdAt),
      context: parseJsonPayload(row.context, {}),
      durationMs: row.durationMs == null ? null : Number(row.durationMs),
      statusCode: row.statusCode == null ? null : Number(row.statusCode)
    }));

    const metricRow = metricsQuery.rows[0] || {};
    const totalRequests = Number(metricRow.total_requests || 0);
    const errorCount = Number(metricRow.error_count || 0);
    const failedRequests = Number(metricRow.failed_requests || 0);
    const authRequests = Number(metricRow.auth_requests || 0);
    const authFailures = Number(metricRow.auth_failures || 0);

    return {
      rows,
      total: Number(totalQuery.rows[0]?.count || 0),
      metrics: {
        errorRate: totalRequests ? Number(((errorCount / totalRequests) * 100).toFixed(2)) : 0,
        failedRequests,
        authFailures,
        avgLatencyMs: Number(metricRow.avg_latency || 0),
        p95LatencyMs: Number(metricRow.p95_latency || 0)
      },
      slowEndpoints: slowEndpointsQuery.rows.map((row) => ({
        endpoint: row.endpoint,
        avgMs: Number(row.avg_ms || 0),
        p95Ms: Number(row.p95_ms || 0),
        requestCount: Number(row.request_count || 0),
        pct: Math.min(100, Math.round((Number(row.p95_ms || 0) / 5000) * 100))
      })),
      errorTrend: errorTrendQuery.rows.map((row) => ({
        label: row.label,
        totalCount: Number(row.totalCount || 0),
        errorCount: Number(row.errorCount || 0)
      })),
      deployMarkers: deployMarkersQuery.rows.map((row) => ({
        ...row,
        createdAt: toIsoString(row.createdAt) || new Date().toISOString()
      })),
      alerts: alertRules,
      incidents,
      services: Array.from(new Set(rows.map((row) => row.service).filter(Boolean))),
      authRequestCount: authRequests
    };
  },

  getIntegrationsStatus: async () => {
    const now = new Date().toISOString();
    const recentSyncs = await pool.query(`
      SELECT
        service,
        MAX(created_at) AS "lastSeenAt",
        COUNT(*) FILTER (WHERE status_code >= 400 AND created_at >= NOW() - INTERVAL '24 hours')::int AS failures24h
      FROM app_system_logs
      GROUP BY service
    `);
    const serviceSnapshot = new Map(recentSyncs.rows.map((row) => [String(row.service || ""), row]));
    const getServiceHealth = (serviceName) => {
      const row = serviceSnapshot.get(serviceName) || {};
      const lastSeenAt = toIsoString(row.lastSeenAt) || now;
      const lagMinutes = Math.max(0, Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60000));
      return {
        lastSeenAt,
        lagMinutes,
        failures24h: Number(row.failures24h || 0)
      };
    };

    const marketDataHealth = getServiceHealth("Market Data");
    const authHealth = getServiceHealth("Auth");
    const webhookHealth = getServiceHealth("Web API");

    const items = [
      {
        name: "Stripe",
        category: "Payments",
        status: process.env.STRIPE_SECRET_KEY ? "active" : "degraded",
        note: process.env.STRIPE_SECRET_KEY ? "Secret key configured." : "Missing STRIPE_SECRET_KEY.",
        lastSyncAt: now,
        actionLabel: process.env.STRIPE_SECRET_KEY ? "Inspect" : "Configure",
        credentialStatus: process.env.STRIPE_SECRET_KEY ? "configured" : "missing",
        syncLagMinutes: 0,
        webhookFailures: 0,
        retryable: false
      },
      {
        name: "Google OAuth",
        category: "Authentication",
        status: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "active" : "degraded",
        note: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "Google OAuth ready." : "Google OAuth credentials missing.",
        lastSyncAt: authHealth.lastSeenAt,
        actionLabel: "Inspect",
        credentialStatus: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "configured" : "missing",
        syncLagMinutes: authHealth.lagMinutes,
        webhookFailures: authHealth.failures24h,
        retryable: false
      },
      {
        name: "Apple OAuth",
        category: "Authentication",
        status: process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID ? "active" : "degraded",
        note: process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID ? "Apple Sign In ready." : "Apple Sign In credentials missing.",
        lastSyncAt: authHealth.lastSeenAt,
        actionLabel: "Inspect",
        credentialStatus: process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID ? "configured" : "missing",
        syncLagMinutes: authHealth.lagMinutes,
        webhookFailures: authHealth.failures24h,
        retryable: false
      },
      {
        name: "Email Delivery",
        category: "Messaging",
        status: process.env.RESEND_API_KEY || process.env.SMTP_HOST ? "active" : "inactive",
        note: process.env.RESEND_API_KEY ? "Resend detected." : process.env.SMTP_HOST ? "SMTP detected." : "No email provider configured.",
        lastSyncAt: now,
        actionLabel: "Inspect",
        credentialStatus: process.env.RESEND_API_KEY || process.env.SMTP_HOST ? "configured" : "missing",
        syncLagMinutes: 0,
        webhookFailures: 0,
        retryable: false
      },
      {
        name: "Market Data",
        category: "Data",
        status: process.env.EODHD_API_TOKEN ? "active" : "degraded",
        note: process.env.EODHD_API_TOKEN ? "EODHD token configured." : "Missing EODHD token.",
        lastSyncAt: marketDataHealth.lastSeenAt,
        actionLabel: "Retry",
        credentialStatus: process.env.EODHD_API_TOKEN ? "configured" : "missing",
        syncLagMinutes: marketDataHealth.lagMinutes,
        webhookFailures: marketDataHealth.failures24h,
        retryable: true
      },
      {
        name: "Webhook Relay",
        category: "Developer",
        status: process.env.WEBHOOK_SECRET ? "active" : "inactive",
        note: process.env.WEBHOOK_SECRET ? "Webhook secret configured." : "Webhook secret missing.",
        lastSyncAt: webhookHealth.lastSeenAt,
        actionLabel: process.env.WEBHOOK_SECRET ? "Retry" : "Configure",
        credentialStatus: process.env.WEBHOOK_SECRET ? "configured" : "missing",
        syncLagMinutes: webhookHealth.lagMinutes,
        webhookFailures: webhookHealth.failures24h,
        retryable: Boolean(process.env.WEBHOOK_SECRET)
      }
    ];

    const connectedApps = items.filter((item) => item.status === "active").length;
    const failedSyncs = items.filter((item) => item.status !== "active").length;

    return {
      summary: {
        connectedApps,
        syncHealth: Number((((items.length - failedSyncs) / Math.max(items.length, 1)) * 100).toFixed(1)),
        webhooksActive: items.filter((item) => item.category === "Developer" && item.status === "active").length,
        failedSyncs
      },
      items
    };
  },

  listAlertRules: async ({ status = null, limit = 20 } = {}) => {
    const values = [];
    const conditions = [];
    if (status) {
      values.push(String(status).trim().toLowerCase());
      conditions.push(`a.status = $${values.length}`);
    }
    values.push(Math.max(1, Math.min(100, Number(limit) || 20)));
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`
      SELECT
        a.id,
        a.title,
        a.query_text AS query,
        a.service,
        a.severity,
        a.status,
        a.details,
        a.last_triggered_at AS "lastTriggeredAt",
        a.acknowledged_at AS "acknowledgedAt",
        a.created_at AS "createdAt",
        COALESCE(c.display_name, c.email, 'System') AS "createdBy",
        COALESCE(ack.display_name, ack.email, NULL) AS "acknowledgedBy"
      FROM admin_alert_rules a
      LEFT JOIN app_users c ON a.created_by_user_id = c.id
      LEFT JOIN app_users ack ON a.acknowledged_by_user_id = ack.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${values.length}
    `, values);
    return result.rows.map((row) => ({
      ...row,
      details: parseJsonPayload(row.details, {}),
      createdAt: toIsoString(row.createdAt),
      acknowledgedAt: toIsoString(row.acknowledgedAt),
      lastTriggeredAt: toIsoString(row.lastTriggeredAt)
    }));
  },

  createAlertRule: async ({ title, query = "", service = "", severity = "warning", details = {}, createdByUserId = null }) => {
    const result = await pool.query(`
      INSERT INTO admin_alert_rules (
        title,
        query_text,
        service,
        severity,
        details,
        created_by_user_id,
        last_triggered_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING
        id,
        title,
        query_text AS query,
        service,
        severity,
        status,
        details,
        last_triggered_at AS "lastTriggeredAt",
        created_at AS "createdAt"
    `, [
      String(title || "Admin alert").trim(),
      String(query || "").trim(),
      String(service || "").trim() || null,
      computeLogLevelSummary(severity),
      JSON.stringify(details || {}),
      createdByUserId ? toUserId(createdByUserId) : null
    ]);
    const row = result.rows[0];
    return {
      ...row,
      details: parseJsonPayload(row.details, {}),
      createdAt: toIsoString(row.createdAt),
      lastTriggeredAt: toIsoString(row.lastTriggeredAt)
    };
  },

  updateAlertRuleStatus: async ({ alertId, status, acknowledgedByUserId = null }) => {
    const normalizedStatus = String(status || "active").trim().toLowerCase();
    const result = await pool.query(`
      UPDATE admin_alert_rules
      SET
        status = $2,
        acknowledged_by_user_id = CASE WHEN $2 = 'resolved' THEN $3 ELSE NULL END,
        acknowledged_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE NULL END
      WHERE id = $1
      RETURNING
        id,
        title,
        query_text AS query,
        service,
        severity,
        status,
        details,
        last_triggered_at AS "lastTriggeredAt",
        acknowledged_at AS "acknowledgedAt",
        created_at AS "createdAt"
    `, [Number(alertId), normalizedStatus, acknowledgedByUserId ? toUserId(acknowledgedByUserId) : null]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      ...row,
      details: parseJsonPayload(row.details, {}),
      createdAt: toIsoString(row.createdAt),
      acknowledgedAt: toIsoString(row.acknowledgedAt),
      lastTriggeredAt: toIsoString(row.lastTriggeredAt)
    };
  },

  listIncidents: async ({ status = null, limit = 20 } = {}) => {
    const values = [];
    const conditions = [];
    if (status) {
      values.push(String(status).trim().toLowerCase());
      conditions.push(`i.status = $${values.length}`);
    }
    values.push(Math.max(1, Math.min(100, Number(limit) || 20)));
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`
      SELECT
        i.id,
        i.title,
        i.status,
        i.severity,
        i.request_id AS "requestId",
        i.source_log_id AS "sourceLogId",
        i.details,
        i.resolved_at AS "resolvedAt",
        i.created_at AS "createdAt",
        COALESCE(u.display_name, u.email, 'System') AS "createdBy"
      FROM admin_incidents i
      LEFT JOIN app_users u ON i.created_by_user_id = u.id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT $${values.length}
    `, values);
    return result.rows.map((row) => ({
      ...row,
      details: parseJsonPayload(row.details, {}),
      createdAt: toIsoString(row.createdAt),
      resolvedAt: toIsoString(row.resolvedAt)
    }));
  },

  createIncident: async ({ title, severity = "warning", requestId = null, sourceLogId = null, details = {}, createdByUserId = null }) => {
    const result = await pool.query(`
      INSERT INTO admin_incidents (
        title,
        severity,
        request_id,
        source_log_id,
        details,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        title,
        status,
        severity,
        request_id AS "requestId",
        source_log_id AS "sourceLogId",
        details,
        created_at AS "createdAt"
    `, [
      String(title || "Incident").trim(),
      computeLogLevelSummary(severity),
      requestId || null,
      sourceLogId == null ? null : Number(sourceLogId),
      JSON.stringify(details || {}),
      createdByUserId ? toUserId(createdByUserId) : null
    ]);
    const row = result.rows[0];
    return {
      ...row,
      details: parseJsonPayload(row.details, {}),
      createdAt: toIsoString(row.createdAt)
    };
  },

  searchAdminWorkspace: async (query) => {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      return { users: [], audit: [], logs: [], tables: [] };
    }

    const [users, audit, logs, tables] = await Promise.all([
      admin.listAllUsers({ query: trimmed }),
      admin.getAdminLogs({ query: trimmed, page: 1, pageSize: 5 }),
      admin.getSystemLogs({ query: trimmed, page: 1, pageSize: 5 }),
      pool.query(`
        SELECT relname AS name, n_live_tup::bigint AS rows
        FROM pg_stat_user_tables
        WHERE relname ILIKE $1
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 5
      `, [`%${trimmed}%`])
    ]);

    return {
      users: users.slice(0, 5),
      audit: audit.rows.slice(0, 5),
      logs: logs.rows.slice(0, 5),
      tables: tables.rows.map((row) => ({ name: row.name, rows: Number(row.rows || 0) }))
    };
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
  analytics,
  clearAllData,
  closeDatabase
};
