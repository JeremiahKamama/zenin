const { Pool } = require("pg");
const { watchlistData } = require("./data");
const crypto = require("crypto");
const portfolioSnapshots = require("./portfolioSnapshots");
const { ensureUnifiedPortfolioSchema } = require("./unifiedPortfolio");
const { tagsForExchange } = require("./exchangeSync");

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

// Database hosting is explicit: Render runs the backend and Railway provides Postgres via DATABASE_URL.

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
  if (process.env.NODE_ENV === "production") {
    return true;
  }

  // Local Render-like development tunnels sometimes need relaxed verification.
  if (isRenderEnvironment(connectionString)) {
    return false;
  }

  return false;
}

function createPoolConfig() {
  const connectionEnv = resolveConnectionEnv();
  const connectionString = connectionEnv.value;
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
      "Missing PostgreSQL connection string. Set DATABASE_URL (or RAILWAY_DATABASE_URL / RENDER_DATABASE_URL / POSTGRES_URL) in production."
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

function resolveConnectionEnv() {
  const candidates = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["RAILWAY_DATABASE_URL", process.env.RAILWAY_DATABASE_URL],
    ["RENDER_DATABASE_URL", process.env.RENDER_DATABASE_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
    ["POSTGRES_PRISMA_URL", process.env.POSTGRES_PRISMA_URL]
  ];
  const match = candidates.find(([, value]) => String(value || "").trim());
  return {
    name: match?.[0] || null,
    value: match ? String(match[1]).trim() : null
  };
}

function describeDatabaseConfig() {
  const connectionEnv = resolveConnectionEnv();
  if (connectionEnv.value) {
    try {
      const parsed = new URL(connectionEnv.value);
      return {
        source: connectionEnv.name,
        provider: isRenderEnvironment(connectionEnv.value) ? "render" : "postgresql",
        host: parsed.hostname || null,
        database: parsed.pathname ? parsed.pathname.replace(/^\//, "") : null,
        ssl: shouldUseSsl(connectionEnv.value)
      };
    } catch {
      return {
        source: connectionEnv.name,
        provider: isRenderEnvironment(connectionEnv.value) ? "render" : "postgresql",
        host: "invalid connection string",
        database: null,
        ssl: shouldUseSsl(connectionEnv.value)
      };
    }
  }

  return {
    source: process.env.NODE_ENV === "production" ? null : "PGHOST/PGDATABASE",
    provider: "postgresql",
    host: process.env.NODE_ENV === "production" ? null : (process.env.PGHOST || "127.0.0.1"),
    database: process.env.NODE_ENV === "production" ? null : (process.env.PGDATABASE || "zenin"),
    ssl: shouldUseSsl(null)
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
    supabaseUserId: row.supabaseUserId || row.supabase_user_id || null,
    passkeys: parseJsonPayload(row.passkeys, []),
    backupCodes: parseJsonPayload(row.backupCodes, []),
    emailVerificationCodeHash: row.emailVerificationCodeHash || row.email_verification_code_hash || null,
    emailVerificationRequestedAt: row.emailVerificationRequestedAt || row.email_verification_requested_at || null,
    activeWorkspaceId: row.activeWorkspaceId || row.active_workspace_id || null,
    sessionReauthenticatedAt: row.sessionReauthenticatedAt || row.session_reauthenticated_at || null,
    adminReauthenticatedAt: row.adminReauthenticatedAt || row.admin_reauthenticated_at || null
  };
}

function mapExchangeKeyRow(row) {
  if (!row) return null;
  return {
    ...row,
    canTrade: Boolean(row.canTrade ?? row.can_trade),
    permissionScope: String(row.permissionScope || row.permission_scope || "unknown").trim().toLowerCase(),
    lastVerifiedScope: String(row.lastVerifiedScope || row.last_verified_scope || "unknown").trim().toLowerCase(),
    riskLevel: String(row.riskLevel || row.risk_level || "standard").trim().toLowerCase(),
    scopeVerificationStatus: String(row.scopeVerificationStatus || row.scope_verification_status || "provider_unverified").trim().toLowerCase(),
    scopeVerifiedAt: row.scopeVerifiedAt || row.scope_verified_at || null,
    detectedPermissions: parseJsonPayload(row.detectedPermissions ?? row.detected_permissions, {}),
    scopeVerificationMessage: row.scopeVerificationMessage || row.scope_verification_message || null
  };
}

function mapWorkspaceRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    slug: String(row.slug || "").trim(),
    name: String(row.name || "").trim(),
    plan: normalizePlanValue(row.plan),
    billingCycle: normalizeBillingCycleValue(row.billingCycle || row.billing_cycle),
    seatLimit: Number(row.seatLimit || row.seat_limit || 1),
    seatCount: Number(row.seatCount || row.seat_count || 1),
    status: String(row.status || "active").trim().toLowerCase(),
    ownerUserId: row.ownerUserId == null ? null : Number(row.ownerUserId || row.owner_user_id),
    createdAt: toIsoString(row.createdAt || row.created_at),
    updatedAt: toIsoString(row.updatedAt || row.updated_at),
  };
}

function mapWorkspaceMemberRow(row) {
  if (!row) return null;
  return {
    workspaceId: Number(row.workspaceId || row.workspace_id),
    userId: Number(row.userId || row.user_id),
    role: String(row.role || "member").trim().toLowerCase(),
    status: String(row.status || "active").trim().toLowerCase(),
    invitedByUserId: row.invitedByUserId == null ? null : Number(row.invitedByUserId || row.invited_by_user_id),
    invitedAt: toIsoString(row.invitedAt || row.invited_at),
    joinedAt: toIsoString(row.joinedAt || row.joined_at),
    email: row.email || null,
    displayName: row.displayName || row.display_name || null,
  };
}

function mapWorkspaceInviteRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspaceId || row.workspace_id),
    email: String(row.email || "").trim().toLowerCase(),
    role: String(row.role || "member").trim().toLowerCase(),
    status: row.acceptedAt || row.accepted_at ? "accepted" : row.revokedAt || row.revoked_at ? "revoked" : "pending",
    expiresAt: toIsoString(row.expiresAt || row.expires_at),
    acceptedAt: toIsoString(row.acceptedAt || row.accepted_at),
    revokedAt: toIsoString(row.revokedAt || row.revoked_at),
    createdByUserId: row.createdByUserId == null ? null : Number(row.createdByUserId || row.created_by_user_id),
    createdAt: toIsoString(row.createdAt || row.created_at),
  };
}

function mapWorkspaceActivityRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspaceId || row.workspace_id),
    actorUserId: row.actorUserId == null ? null : Number(row.actorUserId || row.actor_user_id),
    actorEmail: row.actorEmail || null,
    actorDisplayName: row.actorDisplayName || row.actor_display_name || null,
    eventType: String(row.eventType || row.event_type || "").trim(),
    entityType: String(row.entityType || row.entity_type || "").trim(),
    entityId: row.entityId || row.entity_id || null,
    details: parseJsonPayload(row.details || row.details_json, {}),
    createdAt: toIsoString(row.createdAt || row.created_at),
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

function mapNotificationEventRow(row) {
  return {
    id: Number(row.id),
    userId: row.userId == null ? null : Number(row.userId || row.user_id),
    workspaceId: row.workspaceId == null ? null : Number(row.workspaceId || row.workspace_id),
    type: String(row.type || "").trim(),
    title: String(row.title || "").trim(),
    body: String(row.body || "").trim(),
    entityType: row.entityType || row.entity_type || null,
    entityId: row.entityId || row.entity_id || null,
    metadata: parseJsonPayload(row.metadata || row.metadata_json, {}),
    category: String(row.category || "workspace").trim() || "workspace",
    severity: String(row.severity || "info").trim() || "info",
    action: parseJsonPayload(row.action || row.action_json, {}),
    actionUrl: parseJsonPayload(row.action || row.action_json, {})?.actionUrl || parseJsonPayload(row.metadata || row.metadata_json, {})?.actionUrl || null,
    requestedChannels: parseJsonPayload(row.requestedChannels || row.requested_channels_json, ["inApp"]),
    deliveryResults: parseJsonPayload(row.deliveryResults || row.delivery_results_json, {}),
    inAppDeliveredAt: toIsoString(row.inAppDeliveredAt || row.in_app_delivered_at),
    emailDeliveredAt: toIsoString(row.emailDeliveredAt || row.email_delivered_at),
    lastOccurredAt: toIsoString(row.lastOccurredAt || row.last_occurred_at),
    dedupeKey: row.dedupeKey || row.dedupe_key || null,
    occurrenceCount: Number(row.occurrenceCount || row.occurrence_count || 1),
    createdAt: toIsoString(row.createdAt || row.created_at),
    readAt: toIsoString(row.readAt || row.read_at),
    updatedAt: toIsoString(row.updatedAt || row.updated_at)
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

function slugifyWorkspaceName(value, fallback = "desk") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
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
        user_id, workspace_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
      )
      SELECT
        $1,
        (SELECT active_workspace_id FROM app_users WHERE id = $1),
        symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
      FROM user_workspace_portfolio
      WHERE user_id = 1 AND quantity > $2
      ON CONFLICT (workspace_id, symbol, market_type, strategy_name) DO NOTHING;
    `, [adminUserId, QTY_EPSILON]);
    insertedPortfolio = Number(portfolioFromGuestResult.rowCount || 0);
    copiedPortfolioFrom = insertedPortfolio > 0 ? "guest_workspace" : null;

    if (insertedPortfolio === 0) {
      const portfolioFromLegacyResult = await client.query(`
        INSERT INTO user_workspace_portfolio (
          user_id, workspace_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
        )
        SELECT
          $1,
          (SELECT active_workspace_id FROM app_users WHERE id = $1),
          symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added
        FROM portfolio_holdings
        WHERE quantity > $2
        ON CONFLICT (workspace_id, symbol, market_type, strategy_name) DO NOTHING;
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
        user_id, workspace_id, symbol, name, type, category, theme, market_type, date_added
      )
      SELECT
        $1,
        (SELECT active_workspace_id FROM app_users WHERE id = $1),
        symbol, name, type, category, theme, market_type, date_added
      FROM user_workspace_watchlist
      WHERE user_id = 1
      ON CONFLICT (workspace_id, symbol, market_type, category, theme) DO NOTHING;
    `, [adminUserId]);
    insertedWatchlist = Number(watchlistFromGuestResult.rowCount || 0);
    copiedWatchlistFrom = insertedWatchlist > 0 ? "guest_workspace" : null;

    if (insertedWatchlist === 0) {
      const watchlistFromLegacyResult = await client.query(`
        INSERT INTO user_workspace_watchlist (
          user_id, workspace_id, symbol, name, type, category, theme, market_type, date_added
        )
        SELECT
          $1,
          (SELECT active_workspace_id FROM app_users WHERE id = $1),
          symbol, name, type, category, theme, market_type, date_added
        FROM watchlist_assets
        ON CONFLICT (workspace_id, symbol, market_type, category, theme) DO NOTHING;
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

    // Ensure pgcrypto is available for gen_random_uuid(), which is used by
    // decision_threads and daily_briefings. Idempotent and safe on all
    // supported Postgres versions (pgcrypto ships with Postgres 9.4+).
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

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
        supabase_user_id TEXT UNIQUE,
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
        email_verification_code_hash TEXT,
        email_verification_requested_at TIMESTAMPTZ,
        current_plan TEXT NOT NULL DEFAULT 'starter',
        current_billing_cycle TEXT NOT NULL DEFAULT 'monthly',
        plan_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS supabase_user_id TEXT;
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
      ADD COLUMN IF NOT EXISTS active_workspace_id INTEGER;
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        owner_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        plan TEXT NOT NULL DEFAULT 'starter',
        billing_cycle TEXT NOT NULL DEFAULT 'monthly',
        seat_limit INTEGER NOT NULL DEFAULT 1,
        seat_count INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        invited_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        invited_at TIMESTAMPTZ,
        joined_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_invites (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_activity_log (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Admin dashboards filter activity by workspace and recency; index the hot path.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workspace_activity_log_workspace_created
      ON workspace_activity_log (workspace_id, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workspace_activity_log_actor_created
      ON workspace_activity_log (actor_user_id, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_alert_assignments (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        alert_key TEXT NOT NULL,
        assigned_to_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'open',
        snoozed_until TIMESTAMPTZ,
        archived_at TIMESTAMPTZ,
        archived_by_user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        notes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, alert_key)
      );
    `);

    await client.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS email_verification_code_hash TEXT,
      ADD COLUMN IF NOT EXISTS email_verification_requested_at TIMESTAMPTZ;
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

    // Log dashboards filter by level/service and recency; these keep them fast
    // as the append-only table grows.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_system_logs_level_created
      ON app_system_logs (level, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_system_logs_service_created
      ON app_system_logs (service, created_at DESC);
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
        session_reauthenticated_at TIMESTAMPTZ,
        admin_reauthenticated_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE auth_sessions
      ADD COLUMN IF NOT EXISTS session_reauthenticated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS admin_reauthenticated_at TIMESTAMPTZ;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        email_provider TEXT,
        email_provider_message_id TEXT,
        email_sent_at TIMESTAMPTZ,
        email_error JSONB,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE password_reset_tokens
      ADD COLUMN IF NOT EXISTS email_provider TEXT,
      ADD COLUMN IF NOT EXISTS email_provider_message_id TEXT,
      ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS email_error JSONB;
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
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
        currency TEXT NOT NULL,
        balance DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, currency)
      );
    `);

    // Migrate existing balance to USD cash if not already there
    await client.query(`
      INSERT INTO user_workspace_cash (user_id, currency, balance)
      SELECT b.user_id, 'USD', b.balance
      FROM user_workspace_balance b
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_workspace_cash c
        WHERE c.user_id = b.user_id
          AND c.currency = 'USD'
      );
    `);

    await client.query(`
      ALTER TABLE user_workspace_cash
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_portfolio (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
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
      ALTER TABLE user_workspace_portfolio ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
      ALTER TABLE user_workspace_portfolio ADD COLUMN IF NOT EXISTS funding_rate DOUBLE PRECISION;
      ALTER TABLE user_workspace_portfolio ADD COLUMN IF NOT EXISTS open_interest DOUBLE PRECISION;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_watchlist (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
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
      ALTER TABLE user_workspace_watchlist
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_trades (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
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
      CREATE TABLE IF NOT EXISTS user_workspace_perps_calculations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        calc_type TEXT NOT NULL,
        label TEXT,
        inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_workspace_perps_calculations_user
      ON user_workspace_perps_calculations(user_id, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS perps_latency_samples (
        id SERIAL PRIMARY KEY,
        venue_id TEXT NOT NULL,
        scenario TEXT NOT NULL DEFAULT 'post_only',
        run_id TEXT NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        confirm_ms DOUBLE PRECISION,
        cancel_ms DOUBLE PRECISION,
        network_floor_ms DOUBLE PRECISION,
        error TEXT,
        mode TEXT NOT NULL DEFAULT 'dry_run',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_perps_latency_samples_venue_time
      ON perps_latency_samples(venue_id, scenario, submitted_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS perps_runner_state (
        venue_id TEXT PRIMARY KEY,
        is_running BOOLEAN NOT NULL DEFAULT false,
        is_enabled BOOLEAN NOT NULL DEFAULT false,
        orders_today INTEGER NOT NULL DEFAULT 0,
        daily_order_budget INTEGER NOT NULL DEFAULT 100,
        last_sample_at TIMESTAMPTZ,
        last_error TEXT,
        last_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE user_workspace_trades
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
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
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
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
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
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
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, namespace)
      );
    `);

    await client.query(`
      ALTER TABLE user_workspace_documents
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_collections (
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, namespace)
      );
    `);

    await client.query(`
      ALTER TABLE user_workspace_collections
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_documents (
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, namespace)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_collections (
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL,
        items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, namespace)
      );
    `);

    await client.query(`
      INSERT INTO workspaces (slug, name, owner_user_id, plan, billing_cycle, seat_limit, seat_count, status)
      SELECT
        'workspace-' || u.id::text,
        COALESCE(NULLIF(u.display_name, ''), split_part(u.email, '@', 1) || ' Workspace'),
        u.id,
        COALESCE(NULLIF(u.current_plan, ''), 'starter'),
        COALESCE(NULLIF(u.current_billing_cycle, ''), 'monthly'),
        CASE WHEN COALESCE(NULLIF(u.current_plan, ''), 'starter') = 'desk' THEN 5 ELSE 1 END,
        1,
        'active'
      FROM app_users u
      WHERE NOT EXISTS (
        SELECT 1
        FROM workspaces w
        WHERE w.owner_user_id = u.id
      );
    `);

    await client.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role, status, invited_by_user_id, invited_at, joined_at)
      SELECT w.id, w.owner_user_id, 'owner', 'active', w.owner_user_id, w.created_at, w.created_at
      FROM workspaces w
      ON CONFLICT (workspace_id, user_id) DO NOTHING;
    `);

    await client.query(`
      UPDATE app_users u
      SET active_workspace_id = w.id
      FROM workspaces w
      WHERE w.owner_user_id = u.id
        AND u.active_workspace_id IS NULL;
    `);

    await client.query(`
      UPDATE workspaces w
      SET
        plan = u.current_plan,
        billing_cycle = u.current_billing_cycle,
        seat_limit = CASE WHEN u.current_plan = 'desk' THEN 5 ELSE 1 END,
        updated_at = NOW()
      FROM app_users u
      WHERE w.owner_user_id = u.id;
    `);

    await assignWorkspaceCashRows(client);

    await client.query(`
      UPDATE user_workspace_portfolio p
      SET workspace_id = u.active_workspace_id
      FROM app_users u
      WHERE p.user_id = u.id
        AND u.active_workspace_id IS NOT NULL
        AND p.workspace_id IS NULL;
    `);

    await client.query(`
      UPDATE user_workspace_watchlist wv
      SET workspace_id = u.active_workspace_id
      FROM app_users u
      WHERE wv.user_id = u.id
        AND u.active_workspace_id IS NOT NULL
        AND wv.workspace_id IS NULL;
    `);

    await client.query(`
      UPDATE user_workspace_trades t
      SET workspace_id = u.active_workspace_id
      FROM app_users u
      WHERE t.user_id = u.id
        AND u.active_workspace_id IS NOT NULL
        AND t.workspace_id IS NULL;
    `);

    await client.query(`
      UPDATE user_workspace_trade_fills tf
      SET workspace_id = u.active_workspace_id
      FROM app_users u
      WHERE tf.user_id = u.id
        AND u.active_workspace_id IS NOT NULL
        AND tf.workspace_id IS NULL;
    `);

    await mergeWorkspaceCashDuplicates(client);
    await mergeWorkspacePortfolioDuplicates(client);
    await mergeWorkspaceWatchlistDuplicates(client);
    await mergeWorkspaceTradeDuplicates(client);
    await mergeWorkspaceTradeFillDuplicates(client);

    await client.query(`
      ALTER TABLE user_workspace_cash
      DROP CONSTRAINT IF EXISTS user_workspace_cash_pkey;
    `);

    await client.query(`
      ALTER TABLE user_workspace_portfolio
      DROP CONSTRAINT IF EXISTS user_workspace_portfolio_user_id_symbol_market_type_strategy_name_key;
    `);

    await client.query(`
      ALTER TABLE user_workspace_watchlist
      DROP CONSTRAINT IF EXISTS user_workspace_watchlist_user_id_symbol_market_type_category_theme_key;
    `);

    await client.query(`
      ALTER TABLE user_workspace_trades
      DROP CONSTRAINT IF EXISTS user_workspace_trades_user_id_client_id_key;
    `);

    await client.query(`
      ALTER TABLE user_workspace_trade_fills
      DROP CONSTRAINT IF EXISTS user_workspace_trade_fills_user_id_platform_platform_fill_id_key;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_workspace_cash_workspace_currency
      ON user_workspace_cash (workspace_id, currency);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_workspace_portfolio_workspace_symbol_market_strategy
      ON user_workspace_portfolio (workspace_id, symbol, market_type, strategy_name);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_workspace_watchlist_workspace_symbol_market_category_theme
      ON user_workspace_watchlist (workspace_id, symbol, market_type, category, theme);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_workspace_trades_workspace_client
      ON user_workspace_trades (workspace_id, client_id)
      WHERE client_id IS NOT NULL;
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_workspace_trade_fills_workspace_platform_fill
      ON user_workspace_trade_fills (workspace_id, platform, platform_fill_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_workspace_portfolio_workspace_lookup
      ON user_workspace_portfolio (workspace_id, date_added DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_workspace_watchlist_workspace_lookup
      ON user_workspace_watchlist (workspace_id, date_added DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_workspace_trades_workspace_lookup
      ON user_workspace_trades (workspace_id, executed_at DESC, id DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_workspace_trade_fills_workspace_lookup
      ON user_workspace_trade_fills (workspace_id, executed_at DESC, id DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_workspace_notification_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        category TEXT NOT NULL DEFAULT 'workspace',
        severity TEXT NOT NULL DEFAULT 'info',
        action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        requested_channels_json JSONB NOT NULL DEFAULT '["inApp"]'::jsonb,
        delivery_results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        in_app_delivered_at TIMESTAMPTZ,
        email_delivered_at TIMESTAMPTZ,
        last_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        dedupe_key TEXT,
        occurrence_count INTEGER NOT NULL DEFAULT 1,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE user_workspace_notification_events
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS type TEXT,
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS body TEXT,
      ADD COLUMN IF NOT EXISTS entity_type TEXT,
      ADD COLUMN IF NOT EXISTS entity_id TEXT,
      ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'workspace',
      ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info',
      ADD COLUMN IF NOT EXISTS action_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS requested_channels_json JSONB NOT NULL DEFAULT '["inApp"]'::jsonb,
      ADD COLUMN IF NOT EXISTS delivery_results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS in_app_delivered_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS email_delivered_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
      ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_workspace_notifications_workspace_lookup
      ON user_workspace_notification_events (workspace_id, created_at DESC, id DESC);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_workspace_notifications_dedupe
      ON user_workspace_notification_events (workspace_id, user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL;
    `);

    await client.query(`
      INSERT INTO workspace_documents (workspace_id, namespace, payload_json, updated_at)
      SELECT u.active_workspace_id, d.namespace, d.payload_json, d.updated_at
      FROM user_workspace_documents d
      JOIN app_users u ON u.id = d.user_id
      WHERE u.active_workspace_id IS NOT NULL
      ON CONFLICT (workspace_id, namespace) DO UPDATE
      SET payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at;
    `);

    await client.query(`
      INSERT INTO workspace_collections (workspace_id, namespace, items_json, updated_at)
      SELECT u.active_workspace_id, c.namespace, c.items_json, c.updated_at
      FROM user_workspace_collections c
      JOIN app_users u ON u.id = c.user_id
      WHERE u.active_workspace_id IS NOT NULL
      ON CONFLICT (workspace_id, namespace) DO UPDATE
      SET items_json = EXCLUDED.items_json, updated_at = EXCLUDED.updated_at;
    `);

    await client.query(`
      UPDATE workspaces w
      SET seat_count = members.count,
          updated_at = NOW()
      FROM (
        SELECT workspace_id, COUNT(*)::int AS count
        FROM workspace_members
        WHERE status = 'active'
        GROUP BY workspace_id
      ) members
      WHERE members.workspace_id = w.id;
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

    // Audit-log lookups are almost always scoped to an admin or target user,
    // ordered by recency.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_created
      ON admin_audit_logs (admin_user_id, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_created
      ON admin_audit_logs (target_user_id, created_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_exchange_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
        exchange TEXT NOT NULL,
        api_key TEXT NOT NULL,
        api_secret TEXT,
        extra_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_sync_at TIMESTAMPTZ,
        last_sync_status TEXT,
        last_sync_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
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
      ALTER TABLE user_exchange_keys
      ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_sync_status TEXT,
      ADD COLUMN IF NOT EXISTS last_sync_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS permission_scope TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS can_trade BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS last_verified_scope TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'standard',
      ADD COLUMN IF NOT EXISTS scope_verification_status TEXT NOT NULL DEFAULT 'provider_unverified',
      ADD COLUMN IF NOT EXISTS scope_verified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS detected_permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS scope_verification_message TEXT;
    `);

    // One-time backfill: lift scope verification metadata out of extra_data JSONB
    // into the new top-level columns for rows that already have them.
    // We intentionally do NOT fabricate scope_verified_at from updated_at;
    // a row is only "verified" when the verify-scope endpoint actually probes it.
    await client.query(`
      UPDATE user_exchange_keys
      SET scope_verification_status = COALESCE(NULLIF(extra_data->>'scopeVerificationStatus', ''), 'provider_unverified'),
          scope_verification_message = extra_data->>'scopeVerificationMessage',
          detected_permissions = COALESCE(extra_data->'providerScopeMeta', '{}'::jsonb)
      WHERE extra_data ? 'scopeVerificationStatus';
    `);

    await client.query(`
      UPDATE user_exchange_keys k
      SET workspace_id = u.active_workspace_id
      FROM app_users u
      WHERE k.user_id = u.id
        AND u.active_workspace_id IS NOT NULL
        AND k.workspace_id IS NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_briefings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        briefing_date DATE NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        summary TEXT,
        market_regime TEXT,
        risk_level TEXT,
        sections JSONB NOT NULL DEFAULT '[]'::jsonb,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        read_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        UNIQUE (workspace_id, user_id, briefing_date)
      );

      CREATE TABLE IF NOT EXISTS portfolio_daily_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        snapshot_date DATE NOT NULL,
        portfolio_value DOUBLE PRECISION NOT NULL,
        cash DOUBLE PRECISION NOT NULL DEFAULT 0,
        invested_capital DOUBLE PRECISION NOT NULL DEFAULT 0,
        daily_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
        daily_return DOUBLE PRECISION NOT NULL DEFAULT 0,
        realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
        unrealized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
        benchmark_value DOUBLE PRECISION,
        benchmark_return DOUBLE PRECISION,
        benchmark_relative_return DOUBLE PRECISION,
        holdings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        allocation_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        sector_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        country_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        asset_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        fees DOUBLE PRECISION NOT NULL DEFAULT 0,
        tax_estimate DOUBLE PRECISION NOT NULL DEFAULT 0,
        dividends DOUBLE PRECISION NOT NULL DEFAULT 0,
        deposits DOUBLE PRECISION NOT NULL DEFAULT 0,
        withdrawals DOUBLE PRECISION NOT NULL DEFAULT 0,
        decision_count INTEGER NOT NULL DEFAULT 0,
        journal_count INTEGER NOT NULL DEFAULT 0,
        research_count INTEGER NOT NULL DEFAULT 0,
        prediction_count INTEGER NOT NULL DEFAULT 0,
        snapshot_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        estimated BOOLEAN NOT NULL DEFAULT FALSE,
        source TEXT NOT NULL DEFAULT 'eod-job',
        UNIQUE (workspace_id, snapshot_date)
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_date
        ON portfolio_daily_snapshots (workspace_id, snapshot_date DESC);

      CREATE TABLE IF NOT EXISTS decision_threads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        symbol TEXT,
        asset_type TEXT,
        source_type TEXT NOT NULL,
        source_id TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        priority TEXT NOT NULL DEFAULT 'medium',
        due_at TIMESTAMPTZ,
        linked_alert_key TEXT,
        linked_research_id TEXT,
        linked_journal_id TEXT,
        linked_trade_execution_id TEXT,
        outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_decision_threads_workspace_user
      ON decision_threads (workspace_id, user_id, status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_daily_briefings_workspace_user_date
      ON daily_briefings (workspace_id, user_id, briefing_date DESC);
    `);

    // ── Trade journaling: normalized events + reminder tasks ──────────────
    // Each meaningful trade/position change becomes ONE deduplicated event
    // keyed by (workspace_id, event_key). Reminder tasks are one-per-phase
    // (initial / follow_up) and idempotent via dedupe_key.
    await client.query(`
      CREATE TABLE IF NOT EXISTS journal_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        event_key TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        symbol TEXT,
        asset_type TEXT,
        market_type TEXT,
        platform TEXT,
        account_id TEXT,
        side TEXT,
        quantity DOUBLE PRECISION,
        price DOUBLE PRECISION,
        notional DOUBLE PRECISION,
        fee DOUBLE PRECISION,
        currency TEXT,
        occurred_at TIMESTAMPTZ,
        position_before DOUBLE PRECISION,
        position_after DOUBLE PRECISION,
        position_delta DOUBLE PRECISION,
        classification TEXT NOT NULL DEFAULT 'unknown',
        status TEXT NOT NULL DEFAULT 'open',
        journal_entry_id TEXT,
        decision_thread_id TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, event_key)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_journal_events_workspace_status
      ON journal_events (workspace_id, status, occurred_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS journal_reminder_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id UUID NOT NULL REFERENCES journal_events(id) ON DELETE CASCADE,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        reminder_type TEXT NOT NULL,
        due_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sent_at TIMESTAMPTZ,
        channel_results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        dedupe_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, dedupe_key)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_journal_reminder_tasks_due
      ON journal_reminder_tasks (workspace_id, status, due_at ASC);
    `);

    // Phase 4: periodic trade-journaling reports (daily/weekly/quarterly/
    // half-year/yearly). One row per (workspace, cadence, period_key) keeps
    // generation idempotent — re-running the same period upserts, never dupes.
    await client.query(`
      CREATE TABLE IF NOT EXISTS journal_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        cadence TEXT NOT NULL,
        period_key TEXT NOT NULL,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, cadence, period_key)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_journal_reports_cadence
      ON journal_reports (workspace_id, cadence, period_start DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
      ON auth_sessions (user_id, revoked_at, expires_at);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_supabase_user_id_unique
      ON app_users (supabase_user_id)
      WHERE supabase_user_id IS NOT NULL;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_active
      ON password_reset_tokens (user_id, expires_at, used_at);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email_provider_message
      ON password_reset_tokens (email_provider_message_id)
      WHERE email_provider_message_id IS NOT NULL;
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
      WHERE workspace_id = (SELECT active_workspace_id FROM app_users WHERE id = 1);
    `);

    const guestWatchlistCount = Number(guestWatchlistCountResult.rows[0]?.count || 0);
    if (guestWatchlistCount === 0) {
      await client.query(`
        INSERT INTO user_workspace_watchlist (user_id, workspace_id, symbol, name, type, category, theme, market_type, date_added)
        SELECT
          1 AS user_id,
          (SELECT active_workspace_id FROM app_users WHERE id = 1) AS workspace_id,
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

    // ── Brokerage domain tables ─────────────────────────────────────────────
    // Provider-independent persistence for the brokerage abstraction layer.
    // See backend/brokerage/README.md for schema rationale.

    await client.query(`
      CREATE TABLE IF NOT EXISTS brokerage_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_ref TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_synced_at TIMESTAMPTZ,
        last_sync_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        provider_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, workspace_id, provider, provider_user_ref)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_brokerage_connections_workspace_user
        ON brokerage_connections (workspace_id, user_id, provider);
    `);

    // Background sync scans for due connections via status + last_synced_at;
    // a partial index on that exact predicate keeps the scheduler fast as the
    // table grows (only 'connected'/'pending' rows are candidates).
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_brokerage_connections_sync_due
        ON brokerage_connections (last_synced_at NULLS FIRST)
        WHERE status IN ('connected', 'pending');
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS brokerage_accounts (
        id SERIAL PRIMARY KEY,
        connection_id INTEGER NOT NULL REFERENCES brokerage_connections(id) ON DELETE CASCADE,
        provider_account_id TEXT NOT NULL,
        institution_name TEXT NOT NULL DEFAULT '',
        account_type TEXT NOT NULL DEFAULT 'other',
        masked_number TEXT,
        name TEXT NOT NULL DEFAULT '',
        is_meta_only BOOLEAN NOT NULL DEFAULT FALSE,
        last_synced_at TIMESTAMPTZ,
        provider_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(connection_id, provider_account_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_brokerage_accounts_connection
        ON brokerage_accounts (connection_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS brokerage_holdings (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES brokerage_accounts(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        name TEXT,
        asset_type TEXT NOT NULL DEFAULT 'equity',
        quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
        average_entry_price DOUBLE PRECISION,
        current_price DOUBLE PRECISION,
        market_value DOUBLE PRECISION,
        currency TEXT NOT NULL DEFAULT 'USD',
        opened_at TIMESTAMPTZ,
        provider_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        as_of TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, symbol, asset_type, currency)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_brokerage_holdings_account
        ON brokerage_holdings (account_id);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS brokerage_transactions (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES brokerage_accounts(id) ON DELETE CASCADE,
        provider_tx_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        side TEXT,
        symbol TEXT,
        quantity DOUBLE PRECISION,
        unit_price DOUBLE PRECISION,
        notional DOUBLE PRECISION,
        fee DOUBLE PRECISION,
        currency TEXT NOT NULL DEFAULT 'USD',
        description TEXT,
        executed_at TIMESTAMPTZ NOT NULL,
        provider_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(account_id, provider_tx_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_brokerage_transactions_account
        ON brokerage_transactions (account_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_brokerage_transactions_executed
        ON brokerage_transactions (account_id, executed_at DESC);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS brokerage_provider_metadata (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        key TEXT NOT NULL,
        value JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(provider, key)
      );
    `);

    await ensureUnifiedPortfolioSchema(client);

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
  },

  delete: async (id) => {
    const safeId = Number(id);
    if (!Number.isInteger(safeId)) return { deleted: false, reason: "invalid_id" };
    const result = await pool.query(`
      DELETE FROM options_calculations
      WHERE id = $1
      RETURNING id;
    `, [safeId]);
    return { deleted: result.rowCount > 0, id: safeId };
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
  },

  upsertEtfInflows: async (flows = []) => {
    if (!Array.isArray(flows) || flows.length === 0) return;

    for (const flow of flows) {
      await pool.query(`
        INSERT INTO etf_inflows (date, asset, manager, ticker, net_usd, period, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (date, ticker) DO UPDATE
        SET 
          net_usd = EXCLUDED.net_usd,
          manager = EXCLUDED.manager,
          asset = EXCLUDED.asset,
          source = EXCLUDED.source,
          updated_at = NOW()
      `, [
        flow.date,
        flow.asset,
        flow.manager,
        flow.ticker,
        flow.netUsd,
        flow.period || 'daily',
        flow.source
      ]);
    }
  }
};

function seatLimitForPlan(plan) {
  return normalizePlanValue(plan) === "desk" ? 5 : 1;
}

async function backfillWorkspaceScopedRecords(client, userId, workspaceId) {
  await client.query(`
    UPDATE user_exchange_keys
    SET workspace_id = $2
    WHERE user_id = $1 AND workspace_id IS NULL;
  `, [toUserId(userId), Number(workspaceId)]);
}

async function mergeWorkspaceCashDuplicates(client) {
  const duplicateGroups = await client.query(`
    SELECT workspace_id AS "workspaceId", currency
    FROM user_workspace_cash
    WHERE workspace_id IS NOT NULL
    GROUP BY workspace_id, currency
    HAVING COUNT(*) > 1;
  `);

  for (const group of duplicateGroups.rows) {
    const rows = await client.query(`
      SELECT
        c.user_id AS "userId",
        c.balance,
        c.updated_at AS "updatedAt",
        w.owner_user_id AS "ownerUserId"
      FROM user_workspace_cash c
      JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.workspace_id = $1 AND c.currency = $2
      ORDER BY
        CASE WHEN c.user_id = w.owner_user_id THEN 0 ELSE 1 END,
        c.updated_at DESC,
        c.user_id ASC;
    `, [group.workspaceId, group.currency]);

    if (rows.rows.length <= 1) continue;

    const keeper = rows.rows[0];
    const totalBalance = rows.rows.reduce((sum, row) => sum + toNumber(row.balance), 0);
    const updatedAt = rows.rows.reduce((latest, row) => {
      const current = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      return current > latest ? current : latest;
    }, 0);

    await client.query(`
      UPDATE user_workspace_cash
      SET balance = $3, updated_at = $4
      WHERE user_id = $1 AND currency = $2;
    `, [
      Number(keeper.userId),
      group.currency,
      totalBalance,
      updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString()
    ]);

    const duplicateUserIds = rows.rows.slice(1).map((row) => Number(row.userId));
    if (duplicateUserIds.length) {
      await client.query(`
        DELETE FROM user_workspace_cash
        WHERE workspace_id = $1
          AND currency = $2
          AND user_id = ANY($3::int[]);
      `, [group.workspaceId, group.currency, duplicateUserIds]);
    }
  }
}

async function assignWorkspaceCashRows(client) {
  const pendingGroups = await client.query(`
    SELECT u.active_workspace_id AS "workspaceId", c.currency
    FROM user_workspace_cash c
    JOIN app_users u ON u.id = c.user_id
    WHERE c.workspace_id IS NULL
      AND u.active_workspace_id IS NOT NULL
    GROUP BY u.active_workspace_id, c.currency;
  `);

  for (const group of pendingGroups.rows) {
    const existingRows = await client.query(`
      SELECT
        c.user_id AS "userId",
        c.balance,
        c.updated_at AS "updatedAt",
        w.owner_user_id AS "ownerUserId",
        true AS "isAssigned"
      FROM user_workspace_cash c
      JOIN workspaces w ON w.id = c.workspace_id
      WHERE c.workspace_id = $1 AND c.currency = $2
    `, [group.workspaceId, group.currency]);

    const pendingRows = await client.query(`
      SELECT
        c.user_id AS "userId",
        c.balance,
        c.updated_at AS "updatedAt",
        w.owner_user_id AS "ownerUserId",
        false AS "isAssigned"
      FROM user_workspace_cash c
      JOIN app_users u ON u.id = c.user_id
      JOIN workspaces w ON w.id = u.active_workspace_id
      WHERE c.workspace_id IS NULL
        AND u.active_workspace_id = $1
        AND c.currency = $2
    `, [group.workspaceId, group.currency]);

    const combined = [...existingRows.rows, ...pendingRows.rows].sort((a, b) => {
      const aOwner = Number(a.userId) === Number(a.ownerUserId) ? 0 : 1;
      const bOwner = Number(b.userId) === Number(b.ownerUserId) ? 0 : 1;
      if (aOwner !== bOwner) return aOwner - bOwner;
      const aAssigned = a.isAssigned ? 0 : 1;
      const bAssigned = b.isAssigned ? 0 : 1;
      if (aAssigned !== bAssigned) return aAssigned - bAssigned;
      const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bUpdated - aUpdated || Number(a.userId) - Number(b.userId);
    });

    if (!combined.length) continue;

    const keeper = combined[0];
    const totalBalance = combined.reduce((sum, row) => sum + toNumber(row.balance), 0);
    const latestUpdatedAt = combined.reduce((latest, row) => {
      const current = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
      return current > latest ? current : latest;
    }, 0);
    const nextUpdatedAt = latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : new Date().toISOString();

    await client.query(`
      UPDATE user_workspace_cash
      SET workspace_id = $3, balance = $4, updated_at = $5
      WHERE user_id = $1 AND currency = $2;
    `, [
      Number(keeper.userId),
      group.currency,
      Number(group.workspaceId),
      totalBalance,
      nextUpdatedAt
    ]);

    const otherAssignedUserIds = existingRows.rows
      .filter((row) => Number(row.userId) !== Number(keeper.userId))
      .map((row) => Number(row.userId));
    if (otherAssignedUserIds.length) {
      await client.query(`
        DELETE FROM user_workspace_cash
        WHERE workspace_id = $1
          AND currency = $2
          AND user_id = ANY($3::int[]);
      `, [group.workspaceId, group.currency, otherAssignedUserIds]);
    }

    const pendingDeleteUserIds = pendingRows.rows
      .filter((row) => Number(row.userId) !== Number(keeper.userId))
      .map((row) => Number(row.userId));
    if (pendingDeleteUserIds.length) {
      await client.query(`
        DELETE FROM user_workspace_cash
        WHERE workspace_id IS NULL
          AND currency = $1
          AND user_id = ANY($2::int[]);
      `, [group.currency, pendingDeleteUserIds]);
    }
  }
}

async function mergeWorkspacePortfolioDuplicates(client) {
  const duplicateGroups = await client.query(`
    SELECT workspace_id AS "workspaceId", symbol, market_type AS "marketType", strategy_name AS "strategyName"
    FROM user_workspace_portfolio
    WHERE workspace_id IS NOT NULL
    GROUP BY workspace_id, symbol, market_type, strategy_name
    HAVING COUNT(*) > 1;
  `);

  for (const group of duplicateGroups.rows) {
    const rows = await client.query(`
      SELECT
        id,
        user_id AS "userId",
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
        date_added,
        funding_rate AS "fundingRate",
        open_interest AS "openInterest"
      FROM user_workspace_portfolio
      WHERE workspace_id = $1
        AND symbol = $2
        AND market_type = $3
        AND strategy_name IS NOT DISTINCT FROM $4
      ORDER BY date_added DESC, id DESC;
    `, [group.workspaceId, group.symbol, group.marketType, group.strategyName]);

    if (rows.rows.length <= 1) continue;

    const keeper = rows.rows[0];
    const totalQuantity = rows.rows.reduce((sum, row) => sum + toNumber(row.quantity), 0);
    if (Math.abs(totalQuantity) <= QTY_EPSILON) {
      await client.query(`
        DELETE FROM user_workspace_portfolio
        WHERE workspace_id = $1
          AND symbol = $2
          AND market_type = $3
          AND strategy_name IS NOT DISTINCT FROM $4;
      `, [group.workspaceId, group.symbol, group.marketType, group.strategyName]);
      continue;
    }

    const weightedEntryNumerator = rows.rows.reduce((sum, row) => {
      const quantity = Math.abs(toNumber(row.quantity));
      const price = row.entryPrice == null ? toNumber(row.price) : toNumber(row.entryPrice);
      return sum + (price * quantity);
    }, 0);
    const weightedEntry = weightedEntryNumerator / Math.max(rows.rows.reduce((sum, row) => sum + Math.abs(toNumber(row.quantity)), 0), QTY_EPSILON);

    await client.query(`
      UPDATE user_workspace_portfolio
      SET
        user_id = $2,
        name = $3,
        price = $4,
        quantity = $5,
        entry_price = $6,
        opened_at = $7,
        type = $8,
        market_type = $9,
        order_type = $10,
        strategy_name = $11,
        legs_json = $12::jsonb,
        date_added = $13,
        funding_rate = $14,
        open_interest = $15,
        updated_at = NOW()
      WHERE id = $1;
    `, [
      Number(keeper.id),
      Number(keeper.userId),
      String(keeper.name || keeper.symbol || ""),
      toNumber(keeper.price),
      totalQuantity,
      weightedEntry,
      keeper.openedAt || null,
      String(keeper.type || "stock"),
      String(keeper.marketType || "spot"),
      String(keeper.orderType || "buy"),
      keeper.strategyName || null,
      JSON.stringify(parseJsonPayload(keeper.legsJson, {})),
      keeper.date_added || new Date().toISOString(),
      keeper.fundingRate == null ? null : toNumber(keeper.fundingRate),
      keeper.openInterest == null ? null : toNumber(keeper.openInterest)
    ]);

    const duplicateIds = rows.rows.slice(1).map((row) => Number(row.id));
    if (duplicateIds.length) {
      await client.query(`DELETE FROM user_workspace_portfolio WHERE id = ANY($1::int[]);`, [duplicateIds]);
    }
  }
}

async function mergeWorkspaceWatchlistDuplicates(client) {
  const duplicateGroups = await client.query(`
    SELECT workspace_id AS "workspaceId", symbol, market_type AS "marketType", category, theme
    FROM user_workspace_watchlist
    WHERE workspace_id IS NOT NULL
    GROUP BY workspace_id, symbol, market_type, category, theme
    HAVING COUNT(*) > 1;
  `);

  for (const group of duplicateGroups.rows) {
    const rows = await client.query(`
      SELECT id
      FROM user_workspace_watchlist
      WHERE workspace_id = $1
        AND symbol = $2
        AND market_type = $3
        AND category IS NOT DISTINCT FROM $4
        AND theme IS NOT DISTINCT FROM $5
      ORDER BY date_added DESC, id DESC;
    `, [group.workspaceId, group.symbol, group.marketType, group.category, group.theme]);
    const duplicateIds = rows.rows.slice(1).map((row) => Number(row.id));
    if (duplicateIds.length) {
      await client.query(`DELETE FROM user_workspace_watchlist WHERE id = ANY($1::int[]);`, [duplicateIds]);
    }
  }
}

async function mergeWorkspaceTradeDuplicates(client) {
  const duplicateGroups = await client.query(`
    SELECT workspace_id AS "workspaceId", client_id AS "clientId"
    FROM user_workspace_trades
    WHERE workspace_id IS NOT NULL AND client_id IS NOT NULL
    GROUP BY workspace_id, client_id
    HAVING COUNT(*) > 1;
  `);

  for (const group of duplicateGroups.rows) {
    const rows = await client.query(`
      SELECT id
      FROM user_workspace_trades
      WHERE workspace_id = $1 AND client_id = $2
      ORDER BY COALESCE(executed_at, date::timestamptz) DESC, id DESC;
    `, [group.workspaceId, group.clientId]);
    const duplicateIds = rows.rows.slice(1).map((row) => Number(row.id));
    if (duplicateIds.length) {
      await client.query(`DELETE FROM user_workspace_trades WHERE id = ANY($1::int[]);`, [duplicateIds]);
    }
  }
}

async function mergeWorkspaceTradeFillDuplicates(client) {
  const duplicateGroups = await client.query(`
    SELECT workspace_id AS "workspaceId", platform, platform_fill_id AS "platformFillId"
    FROM user_workspace_trade_fills
    WHERE workspace_id IS NOT NULL
    GROUP BY workspace_id, platform, platform_fill_id
    HAVING COUNT(*) > 1;
  `);

  for (const group of duplicateGroups.rows) {
    const rows = await client.query(`
      SELECT id
      FROM user_workspace_trade_fills
      WHERE workspace_id = $1 AND platform = $2 AND platform_fill_id = $3
      ORDER BY COALESCE(executed_at, created_at) DESC, id DESC;
    `, [group.workspaceId, group.platform, group.platformFillId]);
    const duplicateIds = rows.rows.slice(1).map((row) => Number(row.id));
    if (duplicateIds.length) {
      await client.query(`DELETE FROM user_workspace_trade_fills WHERE id = ANY($1::int[]);`, [duplicateIds]);
    }
  }
}

const workspaces = {
  ensurePersonalWorkspace: async (userId) => {
    const resolvedUserId = toUserId(userId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const userResult = await client.query(`
        SELECT
          id,
          email,
          display_name AS "displayName",
          current_plan AS "currentPlan",
          current_billing_cycle AS "currentBillingCycle",
          active_workspace_id AS "activeWorkspaceId"
        FROM app_users
        WHERE id = $1
        LIMIT 1
        FOR UPDATE;
      `, [resolvedUserId]);
      const user = userResult.rows[0];
      if (!user) {
        throw new Error("User not found");
      }

      let workspaceRow = null;
      if (user.activeWorkspaceId) {
        const existing = await client.query(`
          SELECT
            id,
            slug,
            name,
            plan,
            billing_cycle AS "billingCycle",
            seat_limit AS "seatLimit",
            seat_count AS "seatCount",
            status,
            owner_user_id AS "ownerUserId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM workspaces
          WHERE id = $1
          LIMIT 1;
        `, [user.activeWorkspaceId]);
        workspaceRow = existing.rows[0] || null;
        if (workspaceRow && Number(workspaceRow.ownerUserId) !== resolvedUserId) {
          const membershipResult = await client.query(`
            SELECT role, status
            FROM workspace_members
            WHERE workspace_id = $1 AND user_id = $2
            LIMIT 1;
          `, [workspaceRow.id, resolvedUserId]);
          const membership = membershipResult.rows[0] || null;
          const status = String(membership?.status || "").trim().toLowerCase();
          if (!membership || status !== "active") {
            workspaceRow = null;
          }
        }
      }

      if (!workspaceRow) {
        const ownerWorkspace = await client.query(`
          SELECT
            id,
            slug,
            name,
            plan,
            billing_cycle AS "billingCycle",
            seat_limit AS "seatLimit",
            seat_count AS "seatCount",
            status,
            owner_user_id AS "ownerUserId",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
          FROM workspaces
          WHERE owner_user_id = $1
          ORDER BY id ASC
          LIMIT 1;
        `, [resolvedUserId]);
        workspaceRow = ownerWorkspace.rows[0] || null;
      }

      if (!workspaceRow) {
        const fallbackName = String(user.displayName || user.email || `Workspace ${resolvedUserId}`).trim();
        const localPart = String(user.email || "").split("@")[0] || `user-${resolvedUserId}`;
        const slugBase = slugifyWorkspaceName(localPart, `workspace-${resolvedUserId}`);
        const insertWorkspace = await client.query(`
          INSERT INTO workspaces (
            slug,
            name,
            owner_user_id,
            plan,
            billing_cycle,
            seat_limit,
            seat_count,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, 1, 'active')
          RETURNING
            id,
            slug,
            name,
            plan,
            billing_cycle AS "billingCycle",
            seat_limit AS "seatLimit",
            seat_count AS "seatCount",
            status,
            owner_user_id AS "ownerUserId",
            created_at AS "createdAt",
            updated_at AS "updatedAt";
        `, [
          `${slugBase}-${resolvedUserId}`,
          fallbackName,
          resolvedUserId,
          normalizePlanValue(user.currentPlan),
          normalizeBillingCycleValue(user.currentBillingCycle),
          seatLimitForPlan(user.currentPlan)
        ]);
        workspaceRow = insertWorkspace.rows[0];
      }

      if (Number(workspaceRow.ownerUserId) === resolvedUserId) {
        await client.query(`
          INSERT INTO workspace_members (
            workspace_id,
            user_id,
            role,
            status,
            invited_by_user_id,
            invited_at,
            joined_at
          )
          VALUES ($1, $2, 'owner', 'active', $2, NOW(), NOW())
          ON CONFLICT (workspace_id, user_id) DO UPDATE
          SET role = CASE
            WHEN workspace_members.role = 'owner' THEN workspace_members.role
            ELSE 'owner'
          END,
          status = 'active',
          joined_at = COALESCE(workspace_members.joined_at, NOW());
        `, [workspaceRow.id, resolvedUserId]);
      } else {
        await client.query(`
          INSERT INTO workspace_members (
            workspace_id,
            user_id,
            role,
            status,
            invited_by_user_id,
            invited_at,
            joined_at
          )
          VALUES ($1, $2, 'member', 'active', NULL, NOW(), NOW())
          ON CONFLICT (workspace_id, user_id) DO UPDATE
          SET
            status = 'active',
            joined_at = COALESCE(workspace_members.joined_at, NOW()),
            role = workspace_members.role;
        `, [workspaceRow.id, resolvedUserId]);
      }

      await client.query(`
        UPDATE app_users
        SET active_workspace_id = $2, updated_at = NOW()
        WHERE id = $1;
      `, [resolvedUserId, workspaceRow.id]);

      await backfillWorkspaceScopedRecords(client, resolvedUserId, workspaceRow.id);

      if (Number(workspaceRow.ownerUserId) === resolvedUserId) {
        await client.query(`
          UPDATE workspaces
          SET
            seat_count = (
              SELECT COUNT(*)::int
              FROM workspace_members
              WHERE workspace_id = $1 AND status = 'active'
            ),
            plan = $2,
            billing_cycle = $3,
            seat_limit = $4,
            updated_at = NOW()
          WHERE id = $1;
        `, [
          workspaceRow.id,
          normalizePlanValue(user.currentPlan),
          normalizeBillingCycleValue(user.currentBillingCycle),
          seatLimitForPlan(user.currentPlan)
        ]);
      } else {
        await client.query(`
          UPDATE workspaces
          SET
            seat_count = (
              SELECT COUNT(*)::int
              FROM workspace_members
              WHERE workspace_id = $1 AND status = 'active'
            ),
            updated_at = NOW()
          WHERE id = $1;
        `, [workspaceRow.id]);
      }

      const refreshed = await client.query(`
        SELECT
          id,
          slug,
          name,
          plan,
          billing_cycle AS "billingCycle",
          seat_limit AS "seatLimit",
          seat_count AS "seatCount",
          status,
          owner_user_id AS "ownerUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM workspaces
        WHERE id = $1
        LIMIT 1;
      `, [workspaceRow.id]);

      await client.query("COMMIT");
      return mapWorkspaceRow(refreshed.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  getActiveForUser: async (userId) => {
    const workspace = await workspaces.ensurePersonalWorkspace(userId);
    if (!workspace) return null;
    const membership = await pool.query(`
      SELECT
        wm.workspace_id AS "workspaceId",
        wm.user_id AS "userId",
        wm.role,
        wm.status,
        wm.invited_by_user_id AS "invitedByUserId",
        wm.invited_at AS "invitedAt",
        wm.joined_at AS "joinedAt",
        u.email,
        u.display_name AS "displayName"
      FROM workspace_members wm
      JOIN app_users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1 AND wm.user_id = $2
      LIMIT 1;
    `, [workspace.id, toUserId(userId)]);
    return {
      workspace,
      membership: mapWorkspaceMemberRow(membership.rows[0]),
    };
  },

  listMembers: async (workspaceId) => {
    const result = await pool.query(`
      SELECT
        wm.workspace_id AS "workspaceId",
        wm.user_id AS "userId",
        wm.role,
        wm.status,
        wm.invited_by_user_id AS "invitedByUserId",
        wm.invited_at AS "invitedAt",
        wm.joined_at AS "joinedAt",
        u.email,
        u.display_name AS "displayName"
      FROM workspace_members wm
      JOIN app_users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
      ORDER BY
        CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        COALESCE(u.display_name, u.email) ASC;
    `, [Number(workspaceId)]);
    return result.rows.map(mapWorkspaceMemberRow);
  },

  listInvites: async (workspaceId) => {
    const result = await pool.query(`
      SELECT
        id,
        workspace_id AS "workspaceId",
        email,
        role,
        expires_at AS "expiresAt",
        accepted_at AS "acceptedAt",
        revoked_at AS "revokedAt",
        created_by_user_id AS "createdByUserId",
        created_at AS "createdAt"
      FROM workspace_invites
      WHERE workspace_id = $1
      ORDER BY created_at DESC;
    `, [Number(workspaceId)]);
    return result.rows.map(mapWorkspaceInviteRow);
  },

  updateWorkspace: async (workspaceId, payload = {}) => {
    const current = await pool.query(`
      SELECT id, slug, name, plan, billing_cycle AS "billingCycle", seat_limit AS "seatLimit", seat_count AS "seatCount", status, owner_user_id AS "ownerUserId", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM workspaces
      WHERE id = $1
      LIMIT 1;
    `, [Number(workspaceId)]);
    if (!current.rows[0]) return null;
    const existing = current.rows[0];
    const nextName = payload.name ? String(payload.name).trim() : existing.name;
    const nextSlug = payload.slug ? slugifyWorkspaceName(payload.slug, existing.slug) : existing.slug;
    const result = await pool.query(`
      UPDATE workspaces
      SET name = $2, slug = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING id, slug, name, plan, billing_cycle AS "billingCycle", seat_limit AS "seatLimit", seat_count AS "seatCount", status, owner_user_id AS "ownerUserId", created_at AS "createdAt", updated_at AS "updatedAt";
    `, [Number(workspaceId), nextName, nextSlug]);
    return mapWorkspaceRow(result.rows[0]);
  },

  createInvite: async ({ workspaceId, email, role = "member", createdByUserId = null }) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRole = String(role || "member").trim().toLowerCase() === "admin" ? "admin" : "member";
    const token = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await pool.query(`
      INSERT INTO workspace_invites (
        workspace_id,
        email,
        role,
        token_hash,
        expires_at,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days', $5)
      RETURNING
        id,
        workspace_id AS "workspaceId",
        email,
        role,
        expires_at AS "expiresAt",
        accepted_at AS "acceptedAt",
        revoked_at AS "revokedAt",
        created_by_user_id AS "createdByUserId",
        created_at AS "createdAt";
    `, [Number(workspaceId), normalizedEmail, normalizedRole, tokenHash, createdByUserId ? toUserId(createdByUserId) : null]);
    const invite = mapWorkspaceInviteRow(result.rows[0]);
    return { invite, token };
  },

  acceptInvite: async ({ token, userId }) => {
    const tokenHash = crypto.createHash("sha256").update(String(token || "")).digest("hex");
    const resolvedUserId = toUserId(userId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const inviteResult = await client.query(`
        SELECT
          wi.id,
          wi.workspace_id AS "workspaceId",
          wi.email,
          wi.role,
          wi.expires_at AS "expiresAt",
          wi.accepted_at AS "acceptedAt",
          wi.revoked_at AS "revokedAt",
          wi.created_by_user_id AS "createdByUserId",
          wi.created_at AS "createdAt",
          u.email AS "userEmail"
        FROM workspace_invites wi
        JOIN app_users u ON u.id = $2
        WHERE wi.token_hash = $1
        LIMIT 1
        FOR UPDATE;
      `, [tokenHash, resolvedUserId]);
      const invite = inviteResult.rows[0];
      if (!invite) throw new Error("Invite not found");
      if (invite.revokedAt || invite.acceptedAt) throw new Error("Invite is no longer available");
      if (new Date(invite.expiresAt).getTime() < Date.now()) throw new Error("Invite has expired");
      if (String(invite.email || "").trim().toLowerCase() !== String(invite.userEmail || "").trim().toLowerCase()) {
        throw new Error("Invite email does not match the signed-in user.");
      }

      await client.query(`
        INSERT INTO workspace_members (
          workspace_id,
          user_id,
          role,
          status,
          invited_by_user_id,
          invited_at,
          joined_at
        )
        VALUES ($1, $2, $3, 'active', $4, NOW(), NOW())
        ON CONFLICT (workspace_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, status = 'active', joined_at = COALESCE(workspace_members.joined_at, NOW());
      `, [invite.workspaceId, resolvedUserId, invite.role, invite.createdByUserId || null]);

      await client.query(`
        UPDATE workspace_invites
        SET accepted_at = NOW()
        WHERE id = $1;
      `, [invite.id]);

      await client.query(`
        UPDATE app_users
        SET active_workspace_id = $2, updated_at = NOW()
        WHERE id = $1;
      `, [resolvedUserId, invite.workspaceId]);

      await backfillWorkspaceScopedRecords(client, resolvedUserId, invite.workspaceId);

      await client.query(`
        UPDATE workspaces
        SET seat_count = (
          SELECT COUNT(*)::int
          FROM workspace_members
          WHERE workspace_id = $1 AND status = 'active'
        ),
        updated_at = NOW()
        WHERE id = $1;
      `, [invite.workspaceId]);

      await client.query("COMMIT");
      return workspaces.getActiveForUser(resolvedUserId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  updateMemberRole: async ({ workspaceId, targetUserId, role }) => {
    const normalizedRole = String(role || "member").trim().toLowerCase() === "admin" ? "admin" : "member";
    const result = await pool.query(`
      UPDATE workspace_members
      SET role = $3
      WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner'
      RETURNING workspace_id AS "workspaceId", user_id AS "userId", role, status, invited_by_user_id AS "invitedByUserId", invited_at AS "invitedAt", joined_at AS "joinedAt";
    `, [Number(workspaceId), toUserId(targetUserId), normalizedRole]);
    return mapWorkspaceMemberRow(result.rows[0]);
  },

  removeMember: async ({ workspaceId, targetUserId }) => {
    const result = await pool.query(`
      DELETE FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner'
      RETURNING workspace_id AS "workspaceId", user_id AS "userId", role, status, invited_by_user_id AS "invitedByUserId", invited_at AS "invitedAt", joined_at AS "joinedAt";
    `, [Number(workspaceId), toUserId(targetUserId)]);
    await pool.query(`
      UPDATE workspaces
      SET seat_count = (
        SELECT COUNT(*)::int
        FROM workspace_members
        WHERE workspace_id = $1 AND status = 'active'
      ),
      updated_at = NOW()
      WHERE id = $1;
    `, [Number(workspaceId)]);
    return mapWorkspaceMemberRow(result.rows[0]);
  },

  recordActivity: async ({ workspaceId, actorUserId = null, eventType, entityType = null, entityId = null, details = {} }) => {
    const result = await pool.query(`
      INSERT INTO workspace_activity_log (
        workspace_id,
        actor_user_id,
        event_type,
        entity_type,
        entity_id,
        details_json
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      RETURNING id, workspace_id AS "workspaceId", actor_user_id AS "actorUserId", event_type AS "eventType", entity_type AS "entityType", entity_id AS "entityId", details_json AS details, created_at AS "createdAt";
    `, [
      Number(workspaceId),
      actorUserId ? toUserId(actorUserId) : null,
      String(eventType || "").trim(),
      entityType ? String(entityType).trim() : null,
      entityId == null ? null : String(entityId),
      JSON.stringify(details || {})
    ]);
    return mapWorkspaceActivityRow(result.rows[0]);
  },

  listActivity: async (workspaceId, limit = 50) => {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const result = await pool.query(`
      SELECT
        wal.id,
        wal.workspace_id AS "workspaceId",
        wal.actor_user_id AS "actorUserId",
        au.email AS "actorEmail",
        au.display_name AS "actorDisplayName",
        wal.event_type AS "eventType",
        wal.entity_type AS "entityType",
        wal.entity_id AS "entityId",
        wal.details_json AS details,
        wal.created_at AS "createdAt"
      FROM workspace_activity_log wal
      LEFT JOIN app_users au ON au.id = wal.actor_user_id
      WHERE wal.workspace_id = $1
      ORDER BY wal.created_at DESC, wal.id DESC
      LIMIT $2;
    `, [Number(workspaceId), safeLimit]);
    return result.rows.map(mapWorkspaceActivityRow);
  }
};

async function resolveWorkspaceScope(userId, workspaceId = null) {
  if (workspaceId != null) {
    const parsedWorkspaceId = Number(workspaceId);
    if (!Number.isInteger(parsedWorkspaceId) || parsedWorkspaceId <= 0) {
      const error = new Error("Invalid workspace id");
      error.code = "INVALID_WORKSPACE_ID";
      throw error;
    }
    // The snapshot engine and scheduler call with a workspace id and no user id
    // (e.g. EOD jobs). Resolve the workspace owner so downstream queries that
    // need a userId still function.
    const resolvedUserId = userId != null ? toUserId(userId) : null;
    if (resolvedUserId != null) return { resolvedUserId, resolvedWorkspaceId: parsedWorkspaceId };
    const ownerRes = await pool.query(
      `SELECT owner_user_id FROM workspaces WHERE id = $1`,
      [parsedWorkspaceId]
    );
    const ownerId = ownerRes.rows[0]?.owner_user_id;
    if (ownerId == null) {
      const error = new Error("Workspace has no owner");
      error.code = "WORKSPACE_NO_OWNER";
      throw error;
    }
    return { resolvedUserId: Number(ownerId), resolvedWorkspaceId: parsedWorkspaceId };
  }
  const resolvedUserId = toUserId(userId);
  const personalWorkspace = await workspaces.ensurePersonalWorkspace(resolvedUserId);
  return {
    resolvedUserId,
    resolvedWorkspaceId: Number(personalWorkspace?.workspace?.id)
  };
}

// Wire the snapshot engine to the shared pool + scope resolver.
portfolioSnapshots.init(pool, resolveWorkspaceScope, { fetch: (...args) => fetch(...args) });

const userAuth = {
  createUser: async ({ email, passwordHash, displayName = null, authProvider = "email", emailVerified = false, supabaseUserId = null }) => {
    const result = await pool.query(`
      INSERT INTO app_users (email, supabase_user_id, password_hash, display_name, auth_provider, email_verified)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        email,
        supabase_user_id AS "supabaseUserId",
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
        email_verification_code_hash AS "emailVerificationCodeHash",
        email_verification_requested_at AS "emailVerificationRequestedAt",
        current_plan AS "currentPlan",
        current_billing_cycle AS "currentBillingCycle",
        plan_updated_at AS "planUpdatedAt",
        created_at AS "createdAt";
    `, [
      String(email || "").trim().toLowerCase(),
      supabaseUserId ? String(supabaseUserId).trim() : null,
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

    await workspaces.ensurePersonalWorkspace(result.rows[0].id);

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
        supabase_user_id AS "supabaseUserId",
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
        email_verification_code_hash AS "emailVerificationCodeHash",
        email_verification_requested_at AS "emailVerificationRequestedAt",
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
        supabase_user_id AS "supabaseUserId",
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
        email_verification_code_hash AS "emailVerificationCodeHash",
        email_verification_requested_at AS "emailVerificationRequestedAt",
        created_at AS "createdAt"
      FROM app_users
      WHERE id = $1
      LIMIT 1;
    `, [toUserId(userId)]);
    const row = result.rows[0];
    if (!row) return null;
    return mapAuthUserRow(row);
  },

  findUserBySupabaseId: async (supabaseUserId) => {
    const normalizedSupabaseUserId = String(supabaseUserId || "").trim();
    if (!normalizedSupabaseUserId) return null;
    const result = await pool.query(`
      SELECT
        id,
        email,
        supabase_user_id AS "supabaseUserId",
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
        email_verification_code_hash AS "emailVerificationCodeHash",
        email_verification_requested_at AS "emailVerificationRequestedAt",
        created_at AS "createdAt"
      FROM app_users
      WHERE supabase_user_id = $1
      LIMIT 1;
    `, [normalizedSupabaseUserId]);
    return mapAuthUserRow(result.rows[0]);
  },

  upsertSupabaseUser: async ({
    supabaseUserId,
    email,
    displayName = null,
    authProvider = "supabase",
    emailVerified = true
  }) => {
    const normalizedSupabaseUserId = String(supabaseUserId || "").trim();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedSupabaseUserId) {
      throw new Error("Supabase user id is required.");
    }
    if (!normalizedEmail) {
      throw new Error("Supabase email is required.");
    }

    const existingBySupabaseId = await userAuth.findUserBySupabaseId(normalizedSupabaseUserId);
    if (existingBySupabaseId) {
      const result = await pool.query(`
        UPDATE app_users
        SET
          email = $2,
          display_name = COALESCE(NULLIF(display_name, ''), $3),
          auth_provider = $4,
          email_verified = $5,
          updated_at = NOW()
        WHERE supabase_user_id = $1
        RETURNING
          id,
          email,
          supabase_user_id AS "supabaseUserId",
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
          email_verification_code_hash AS "emailVerificationCodeHash",
          email_verification_requested_at AS "emailVerificationRequestedAt",
          created_at AS "createdAt";
      `, [normalizedSupabaseUserId, normalizedEmail, displayName, authProvider, Boolean(emailVerified)]);
      return mapAuthUserRow(result.rows[0]);
    }

    const existingByEmail = await userAuth.findUserByEmail(normalizedEmail);
    if (existingByEmail) {
      const result = await pool.query(`
        UPDATE app_users
        SET
          supabase_user_id = $2,
          display_name = COALESCE(NULLIF(display_name, ''), $3),
          auth_provider = $4,
          email_verified = $5,
          updated_at = NOW()
        WHERE email = $1
        RETURNING
          id,
          email,
          supabase_user_id AS "supabaseUserId",
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
          email_verification_code_hash AS "emailVerificationCodeHash",
          email_verification_requested_at AS "emailVerificationRequestedAt",
          created_at AS "createdAt";
      `, [normalizedEmail, normalizedSupabaseUserId, displayName, authProvider, Boolean(emailVerified)]);
      return mapAuthUserRow(result.rows[0]);
    }

    return userAuth.createUser({
      email: normalizedEmail,
      supabaseUserId: normalizedSupabaseUserId,
      passwordHash: "",
      displayName,
      authProvider,
      emailVerified
    });
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
        s.session_reauthenticated_at AS "sessionReauthenticatedAt",
        s.admin_reauthenticated_at AS "adminReauthenticatedAt",
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

  updateUserVerificationCode: async (userId, codeHash) => {
    await pool.query(`
      UPDATE app_users
      SET 
        email_verification_code_hash = $2,
        email_verification_requested_at = NOW(),
        updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId), codeHash]);
  },

  verifyUserEmail: async (userId) => {
    await pool.query(`
      UPDATE app_users
      SET 
        email_verified = TRUE,
        email_verification_code_hash = NULL,
        email_verification_requested_at = NULL,
        updated_at = NOW()
      WHERE id = $1;
    `, [toUserId(userId)]);
  },

  revokeSessionsByUserId: async (userId) => {
    await pool.query(`
      UPDATE auth_sessions
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL;
    `, [toUserId(userId)]);
  },

  markSessionReauthenticated: async ({ sessionId, admin = false } = {}) => {
    const resolvedSessionId = Number(sessionId);
    if (!Number.isFinite(resolvedSessionId) || resolvedSessionId <= 0) return null;
    const field = admin ? "admin_reauthenticated_at" : "session_reauthenticated_at";
    const result = await pool.query(`
      UPDATE auth_sessions
      SET ${field} = NOW()
      WHERE id = $1 AND revoked_at IS NULL
      RETURNING id,
        session_reauthenticated_at AS "sessionReauthenticatedAt",
        admin_reauthenticated_at AS "adminReauthenticatedAt";
    `, [resolvedSessionId]);
    return result.rows[0] || null;
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

  updatePasswordResetEmailDelivery: async (tokenHash, delivery = {}) => {
    if (!tokenHash) return null;
    const result = await pool.query(`
      UPDATE password_reset_tokens
      SET
        email_provider = $2,
        email_provider_message_id = $3,
        email_sent_at = CASE WHEN $4::boolean THEN NOW() ELSE email_sent_at END,
        email_error = $5
      WHERE token_hash = $1
      RETURNING id, user_id AS "userId", email_provider_message_id AS "providerMessageId";
    `, [
      String(tokenHash || ""),
      delivery.provider || "resend",
      delivery.providerMessageId || null,
      Boolean(delivery.sent),
      delivery.error ? JSON.stringify(delivery.error) : null
    ]);
    return result.rows[0] || null;
  },

  updatePasswordResetEmailEventByProviderId: async (providerMessageId, event = {}) => {
    if (!providerMessageId) return null;
    const result = await pool.query(`
      UPDATE password_reset_tokens
      SET
        email_provider = COALESCE(email_provider, $2),
        email_error = CASE
          WHEN $3::jsonb IS NULL THEN email_error
          ELSE $3::jsonb
        END
      WHERE email_provider_message_id = $1
      RETURNING id, user_id AS "userId", email_provider_message_id AS "providerMessageId";
    `, [
      String(providerMessageId || ""),
      event.provider || "resend",
      event.error ? JSON.stringify(event.error) : null
    ]);
    return result.rows[0] || null;
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
    await workspaces.ensurePersonalWorkspace(userId);
    await pool.query(`
      UPDATE workspaces
      SET plan = $2, billing_cycle = $3, seat_limit = $4, updated_at = NOW()
      WHERE owner_user_id = $1;
    `, [toUserId(userId), normalizedPlan, normalizedBillingCycle, seatLimitForPlan(normalizedPlan)]);
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
  },

};

// ── Trade journaling: detection helper (Phase 1) ───────────────────────────
// Maps a normalized trade/fill record into a journal_event and persists it via
// journalEvents.detectOrRefresh (deduped by event_key). Fire-and-forget: any
// failure is swallowed so trade sync / execution is never blocked (spec §2).
async function recordTradeJournalEvent(userId, rawTrade, workspaceId = null) {
  try {
    if (!rawTrade) return null;
    const derivedType = String(rawTrade.type || rawTrade.assetType || "").toUpperCase();
    const sideLower = String(rawTrade.side || "").toLowerCase();
    const eventType = rawTrade.eventType
      || (derivedType === "TRANSFER" || sideLower === "transfer"
        ? "transfer"
        : derivedType === "ASSIGNMENT"
          ? "assignment"
          : derivedType === "EXPIRY"
            ? "expiry"
            : "execution");
    const raw = {
      source: rawTrade.source || (rawTrade.platform && rawTrade.platform !== "zenin" ? "broker_sync" : "zenin_execution"),
      eventType,
      clientId: rawTrade.clientId || rawTrade.client_id || null,
      platform: rawTrade.platform || "zenin",
      platformTradeId: rawTrade.platformTradeId || rawTrade.platform_trade_id || null,
      platformFillId: rawTrade.platformFillId || rawTrade.platform_fill_id || null,
      symbol: rawTrade.symbol || rawTrade.asset || null,
      assetType: rawTrade.assetType || rawTrade.type || rawTrade.asset_type || null,
      marketType: rawTrade.marketType || rawTrade.market_type || null,
      side: rawTrade.side || null,
      quantity: rawTrade.quantity,
      price: rawTrade.price,
      notional: rawTrade.notional,
      fee: rawTrade.fee,
      currency: rawTrade.currency || rawTrade.feeCurrency,
      executedAt: rawTrade.executedAt || rawTrade.executed_at || rawTrade.occurredAt,
      occurredAt: rawTrade.occurredAt || rawTrade.executedAt || rawTrade.executed_at,
      positionBefore: rawTrade.positionBefore,
      positionAfter: rawTrade.positionAfter,
      positionDelta: rawTrade.positionDelta,
      metadata: rawTrade.metadata || {},
    };
    const event = await userWorkspace.journalEvents.detectOrRefresh(userId, raw, workspaceId);
    // Phase 2: schedule the reminder pair for journalable events. createForEvent
    // itself gates to decision_relevant + open, so operational events are skipped.
    if (event) {
      await userWorkspace.journalReminders.createForEvent(event, workspaceId).catch(() => {});
    }
    return event;
  } catch (err) {
    // Detection must never break the trade pipeline.
    if (typeof console !== "undefined" && console.error) {
      console.error("[journalEvents] detection skipped:", err && err.message);
    }
    return null;
  }
}

const userWorkspace = {
  // Historical Portfolio Snapshot Engine — single source of truth for all
  // time-series features. See backend/portfolioSnapshots.js.
  snapshots: portfolioSnapshots.PortfolioHistoryRepository,
  snapshotService: portfolioSnapshots.DailySnapshotService,
  exchangeKeys: {
    list: async (userId, workspaceId = null) => {
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const result = await pool.query(`
        SELECT
          id,
          exchange,
          api_key AS "apiKey",
          extra_data AS "extraData",
          permission_scope AS "permissionScope",
          can_trade AS "canTrade",
          last_verified_scope AS "lastVerifiedScope",
          risk_level AS "riskLevel",
          scope_verification_status AS "scopeVerificationStatus",
          scope_verified_at AS "scopeVerifiedAt",
          detected_permissions AS "detectedPermissions",
          scope_verification_message AS "scopeVerificationMessage",
          created_at AS "createdAt",
          last_sync_at AS "lastSyncAt",
          last_sync_status AS "lastSyncStatus",
          last_sync_meta AS "lastSyncMeta"
        FROM user_exchange_keys
        WHERE workspace_id = $1
        ORDER BY created_at DESC;
      `, [Number(resolvedWorkspaceId)]);
      return result.rows.map(mapExchangeKeyRow);
    },
    add: async (userId, payload, workspaceId = null) => {
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const {
        exchange,
        apiKey,
        apiSecret,
        extraData,
        permissionScope = "unknown",
        canTrade = false,
        lastVerifiedScope = "unknown",
        riskLevel = "standard",
        scopeVerificationStatus = "provider_unverified",
        scopeVerifiedAt = null,
        detectedPermissions = {},
        scopeVerificationMessage = null
      } = payload;
      const result = await pool.query(`
        INSERT INTO user_exchange_keys (
          user_id,
          workspace_id,
          exchange,
          api_key,
          api_secret,
          extra_data,
          permission_scope,
          can_trade,
          last_verified_scope,
          risk_level,
          scope_verification_status,
          scope_verified_at,
          detected_permissions,
          scope_verification_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING
          id,
          exchange,
          api_key AS "apiKey",
          extra_data AS "extraData",
          permission_scope AS "permissionScope",
          can_trade AS "canTrade",
          last_verified_scope AS "lastVerifiedScope",
          risk_level AS "riskLevel",
          scope_verification_status AS "scopeVerificationStatus",
          scope_verified_at AS "scopeVerifiedAt",
          detected_permissions AS "detectedPermissions",
          scope_verification_message AS "scopeVerificationMessage",
          created_at AS "createdAt",
          last_sync_at AS "lastSyncAt",
          last_sync_status AS "lastSyncStatus",
          last_sync_meta AS "lastSyncMeta";
      `, [
        toUserId(userId),
        Number(resolvedWorkspaceId),
        exchange,
        apiKey,
        apiSecret,
        extraData || {},
        permissionScope,
        Boolean(canTrade),
        lastVerifiedScope,
        riskLevel,
        scopeVerificationStatus,
        scopeVerifiedAt,
        JSON.stringify(detectedPermissions || {}),
        scopeVerificationMessage
      ]);
      return mapExchangeKeyRow(result.rows[0]);
    },
    // Cascade-removal of a connected exchange key.
    //
    // `exchange` is REQUIRED and must be read by the caller via exchangeKeys.getById
    // before invoking this (the route handler does that). It is used to scope every
    // downstream delete to data attributable to that exchange, never to manually
    // entered ("zenin") data.
    remove: async (userId, id, workspaceId = null, exchange = null) => {
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const tags = tagsForExchange(exchange);
      const platform = tags?.platform || String(exchange || "").trim().toLowerCase() || null;
      const strategyNames = tags?.strategyNames || [];

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1. Holdings — scoped by exact display-case strategy_name(s).
        if (strategyNames.length) {
          await client.query(`
            DELETE FROM user_workspace_portfolio
            WHERE workspace_id = $1 AND strategy_name = ANY($2::text[]);
          `, [Number(resolvedWorkspaceId), strategyNames]);
        }

        // 2. Trades + 3. Trade fills — scoped by lowercase platform tag.
        //    Manual trades/fills carry platform='zenin' and are never matched.
        if (platform) {
          await client.query(`
            DELETE FROM user_workspace_trades
            WHERE workspace_id = $1 AND platform = $2;
          `, [Number(resolvedWorkspaceId), platform]);
          await client.query(`
            DELETE FROM user_workspace_trade_fills
            WHERE workspace_id = $1 AND platform = $2;
          `, [Number(resolvedWorkspaceId), platform]);

          // 4. Journal events for this exchange (source='broker_sync') and their
          //    reminder tasks (cascade via FK on journal_events(id)).
          await client.query(`
            DELETE FROM journal_events
            WHERE workspace_id = $1 AND source = 'broker_sync' AND platform = $2;
          `, [Number(resolvedWorkspaceId), platform]);

          // 5. Synced transaction notifications for this exchange.
          await client.query(`
            DELETE FROM user_workspace_notification_events
            WHERE workspace_id = $1
              AND entity_type LIKE 'portfolio_transaction%'
              AND metadata_json->>'provider' = $2;
          `, [Number(resolvedWorkspaceId), platform]);
        }

        // 5b. Unified portfolio canonical layer — source + all child tables
        // (positions, accounts, cash, transactions) cascade via FK ON DELETE CASCADE.
        if (platform) {
          await client.query(`
            DELETE FROM portfolio_sources
            WHERE workspace_id = $1 AND provider = $2;
          `, [Number(resolvedWorkspaceId), platform]);
        }

        // 6. Finally the credential row itself.
        await client.query(`
          DELETE FROM user_exchange_keys
          WHERE id = $1 AND workspace_id = $2;
        `, [id, Number(resolvedWorkspaceId)]);

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    getById: async (userId, id, workspaceId = null) => {
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const result = await pool.query(`
        SELECT
          id,
          exchange,
          api_key AS "apiKey",
          api_secret AS "apiSecret",
          extra_data AS "extraData",
          permission_scope AS "permissionScope",
          can_trade AS "canTrade",
          last_verified_scope AS "lastVerifiedScope",
          risk_level AS "riskLevel",
          scope_verification_status AS "scopeVerificationStatus",
          scope_verified_at AS "scopeVerifiedAt",
          detected_permissions AS "detectedPermissions",
          scope_verification_message AS "scopeVerificationMessage",
          last_sync_at AS "lastSyncAt",
          last_sync_status AS "lastSyncStatus",
          last_sync_meta AS "lastSyncMeta",
          first_synced_at AS "firstSyncedAt",
          created_at AS "createdAt"
        FROM user_exchange_keys
        WHERE id = $1 AND workspace_id = $2;
      `, [id, Number(resolvedWorkspaceId)]);
      return mapExchangeKeyRow(result.rows[0]);
    },
    updateSyncStatus: async (workspaceId, id, { status = "unknown", syncedAt = new Date().toISOString(), meta = {}, reverified = false } = {}) => {
      const result = await pool.query(`
        UPDATE user_exchange_keys
        SET last_sync_at = $3,
            last_sync_status = $4,
            last_sync_meta = $5::jsonb,
            ${reverified ? "scope_verified_at = NOW()," : ""}
            first_synced_at = COALESCE(first_synced_at, $3),
            updated_at = NOW()
        WHERE workspace_id = $1 AND id = $2
        RETURNING
          id,
          exchange,
          api_key AS "apiKey",
          extra_data AS "extraData",
          permission_scope AS "permissionScope",
          can_trade AS "canTrade",
          last_verified_scope AS "lastVerifiedScope",
          risk_level AS "riskLevel",
          scope_verification_status AS "scopeVerificationStatus",
          scope_verified_at AS "scopeVerifiedAt",
          detected_permissions AS "detectedPermissions",
          scope_verification_message AS "scopeVerificationMessage",
          created_at AS "createdAt",
          last_sync_at AS "lastSyncAt",
          last_sync_status AS "lastSyncStatus",
          last_sync_meta AS "lastSyncMeta";
      `, [Number(workspaceId), Number(id), syncedAt, String(status || "unknown").trim().toLowerCase(), JSON.stringify(meta || {})]);
      return mapExchangeKeyRow(result.rows[0]) || null;
    },
    updateScopeVerification: async (workspaceId, id, {
      status, verifiedAt, message, detectedPermissions,
      permissionScope, canTrade, lastVerifiedScope, riskLevel
    } = {}) => {
      const sets = [];
      const values = [];
      let idx = 1;
      values.push(Number(workspaceId), Number(id));
      idx = 3;
      const pushSet = (column, value, transform = (v) => v) => {
        if (value === undefined) return;
        sets.push(`${column} = $${idx}`);
        values.push(transform(value));
        idx += 1;
      };
      pushSet("scope_verification_status", status, (v) => String(v || "provider_unverified").trim().toLowerCase());
      pushSet("scope_verified_at", verifiedAt);
      pushSet("scope_verification_message", message);
      pushSet("detected_permissions", detectedPermissions, (v) => JSON.stringify(v || {}));
      pushSet("permission_scope", permissionScope, (v) => String(v || "unknown").trim().toLowerCase());
      pushSet("can_trade", canTrade, (v) => Boolean(v));
      pushSet("last_verified_scope", lastVerifiedScope, (v) => String(v || "unknown").trim().toLowerCase());
      pushSet("risk_level", riskLevel, (v) => String(v || "standard").trim().toLowerCase());
      if (sets.length === 0) return null;
      sets.push("updated_at = NOW()");
      const result = await pool.query(`
        UPDATE user_exchange_keys
        SET ${sets.join(", ")}
        WHERE workspace_id = $1 AND id = $2
        RETURNING
          id,
          exchange,
          api_key AS "apiKey",
          extra_data AS "extraData",
          permission_scope AS "permissionScope",
          can_trade AS "canTrade",
          last_verified_scope AS "lastVerifiedScope",
          risk_level AS "riskLevel",
          scope_verification_status AS "scopeVerificationStatus",
          scope_verified_at AS "scopeVerifiedAt",
          detected_permissions AS "detectedPermissions",
          scope_verification_message AS "scopeVerificationMessage",
          created_at AS "createdAt",
          last_sync_at AS "lastSyncAt",
          last_sync_status AS "lastSyncStatus",
          last_sync_meta AS "lastSyncMeta";
      `, values);
      return mapExchangeKeyRow(result.rows[0]) || null;
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
    getAll: async (userId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      await pool.query(`
        DELETE FROM user_workspace_portfolio
        WHERE workspace_id = $1 AND ABS(quantity) <= $2;
      `, [resolvedWorkspaceId, QTY_EPSILON]);
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
        WHERE workspace_id = $1 AND ABS(quantity) > $2
        ORDER BY date_added DESC;
      `, [resolvedWorkspaceId, QTY_EPSILON]);
      return result.rows.map(mapPortfolioRow);
    },
    sync: async (userId, exchange, holdings, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Pre-delete existing holdings for this exchange's strategy name(s) using the
        // exact display-case names (e.g. 'Hyperliquid Perp'). A bare `${exchange}%` LIKE
        // previously failed to match because exchange keys are lowercase ('hyperliquid')
        // while strategy names are display-case — so it was a silent no-op.
        const tags = tagsForExchange(exchange);
        const strategyNames = tags?.strategyNames || [];
        if (strategyNames.length) {
          await client.query(`
            DELETE FROM user_workspace_portfolio
            WHERE workspace_id = $1 AND strategy_name = ANY($2::text[]);
          `, [resolvedWorkspaceId, strategyNames]);
        }
        for (const h of holdings) {
          await client.query(`
            INSERT INTO user_workspace_portfolio (
              user_id, workspace_id, symbol, name, price, quantity, entry_price, opened_at, type,
              market_type, order_type, strategy_name, legs_json, date_added, funding_rate, open_interest
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (workspace_id, symbol, market_type, strategy_name) DO UPDATE
            SET quantity = EXCLUDED.quantity, price = EXCLUDED.price, entry_price = EXCLUDED.entry_price,
                funding_rate = EXCLUDED.funding_rate, open_interest = EXCLUDED.open_interest;
          `, [
            resolvedUserId, resolvedWorkspaceId, h.symbol, h.name, h.price || 0, h.quantity, h.entry_price || h.price || 0,
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

    // Remove placeholder / seed holdings that were added manually (strategy_name IS
    // NULL) before a real account was connected. Synced positions always carry a
    // strategy_name (e.g. 'Hyperliquid Perp'), so this never deletes real data.
    // Called once an account (API key / Hyperliquid wallet / brokerage) successfully
    // syncs, so Home/Portfolio stop showing dummy asset rows.
    clearPlaceholders: async (userId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `DELETE FROM user_workspace_portfolio
         WHERE workspace_id = $1 AND strategy_name IS NULL
         RETURNING id, symbol`,
        [resolvedWorkspaceId]
      );
      return { removed: result.rows };
    },

    // Safe demo-seed cleanup used on sign-in / account creation. Only strips
    // NULL-strategy placeholder rows when the workspace has NO connected
    // exchange keys yet -- i.e. it is still pure demo seed copied from the
    // guest workspace. Once a real account is connected, clearPlaceholders
    // (run after sync) handles any stragglers instead.
    clearDemoPlaceholders: async (userId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const keyCheck = await pool.query(
        `SELECT 1 FROM user_exchange_keys WHERE workspace_id = $1 LIMIT 1`,
        [resolvedWorkspaceId]
      );
      if (keyCheck.rows.length) return { removed: [], skipped: true };
      const result = await pool.query(
        `DELETE FROM user_workspace_portfolio
         WHERE workspace_id = $1 AND strategy_name IS NULL
         RETURNING id, symbol`,
        [resolvedWorkspaceId]
      );
      return { removed: result.rows };
    },

    add: async (userId, holding, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
          WHERE workspace_id = $1
            AND symbol = $2
            AND market_type = $3
            AND (strategy_name IS NOT DISTINCT FROM $4)
          FOR UPDATE;
        `, [resolvedWorkspaceId, symbol, marketType, strategyName]);

        const existing = existingResult.rows[0] ? mapPortfolioRow(existingResult.rows[0]) : null;
        if (existing) {
          const nextQuantity = isSell ? existing.quantity - quantity : existing.quantity + quantity;
          if (nextQuantity <= QTY_EPSILON) {
            await client.query(`
              DELETE FROM user_workspace_portfolio
              WHERE id = $1 AND workspace_id = $2;
            `, [existing.id, resolvedWorkspaceId]);
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
            WHERE id = $10 AND workspace_id = $11
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
          `, [nextQuantity, price, nextEntryPrice, nextOpenedAt, orderType, dateAdded, type, name, JSON.stringify(legsJson), existing.id, resolvedWorkspaceId]);
          await client.query("COMMIT");
          return mapPortfolioRow(updatedResult.rows[0]);
        }

        if (isSell) {
          throw new Error(`No existing position for ${symbol} (${marketType}) to sell`);
        }

        const insertedResult = await client.query(`
          INSERT INTO user_workspace_portfolio (user_id, workspace_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        `, [resolvedUserId, resolvedWorkspaceId, symbol, name, price, quantity, price, dateAdded, type, marketType, orderType, strategyName, JSON.stringify(legsJson), dateAdded]);
        await client.query("COMMIT");
        return mapPortfolioRow(insertedResult.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    update: async (userId, id, holding, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const price = toNumber(holding.price);
      const quantity = toNumber(holding.quantity);
      const result = await pool.query(`
        UPDATE user_workspace_portfolio
        SET price = $1, quantity = $2
        WHERE id = $3 AND workspace_id = $4
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
      `, [price, quantity, id, resolvedWorkspaceId]);
      if (result.rows.length === 0) throw new Error("Holding not found");
      return mapPortfolioRow(result.rows[0]);
    },

    delete: async (userId, id, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      await pool.query(`
        DELETE FROM user_workspace_portfolio
        WHERE id = $1 AND workspace_id = $2;
      `, [id, resolvedWorkspaceId]);
      return { success: true, id: Number(id) };
    },

    findBySymbol: async (userId, symbol, marketType, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
        WHERE workspace_id = $1 AND symbol = $2 AND market_type = $3
        ORDER BY date_added DESC;
      `, [resolvedWorkspaceId, cleanSymbol, cleanMarketType]);
      return result.rows.map(mapPortfolioRow);
    }
  },

  cash: {
    getAll: async (userId, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        SELECT currency, balance, updated_at AS "updatedAt"
        FROM user_workspace_cash
        WHERE workspace_id = $1
        ORDER BY currency ASC;
      `, [resolvedWorkspaceId]);
      if (!result.rows.length && resolvedWorkspaceId && resolvedUserId) {
        const legacyBalance = await userWorkspace.balance.get(resolvedUserId);
        return [{ currency: "USD", balance: legacyBalance, updatedAt: new Date().toISOString() }];
      }
      return result.rows.map((row) => ({
        currency: row.currency,
        balance: toNumber(row.balance),
        updatedAt: toIsoString(row.updatedAt)
      }));
    },

    applyChange: async (userId, currency, amount, type = "deposit", workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const cur = String(currency || "USD").toUpperCase();
      const val = Math.abs(toNumber(amount));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = await client.query(`
          SELECT balance FROM user_workspace_cash
          WHERE workspace_id = $1 AND currency = $2
          FOR UPDATE;
        `, [resolvedWorkspaceId, cur]);

        let current = row.rows[0] ? toNumber(row.rows[0].balance) : 0;
        const next = type === "deposit" ? current + val : current - val;
        if (next < 0) {
          const err = new Error(`Insufficient ${cur} balance`);
          err.code = "INSUFFICIENT_BALANCE";
          throw err;
        }

        await client.query(`
          INSERT INTO user_workspace_cash (user_id, workspace_id, currency, balance)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (workspace_id, currency) DO UPDATE
          SET balance = EXCLUDED.balance, updated_at = NOW();
        `, [resolvedUserId, resolvedWorkspaceId, cur, next]);

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

    set: async (userId, currency, balance, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const cur = String(currency || "USD").toUpperCase();
      const val = toNumber(balance);
      await pool.query(`
        INSERT INTO user_workspace_cash (user_id, workspace_id, currency, balance)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (workspace_id, currency) DO UPDATE
        SET balance = EXCLUDED.balance, updated_at = NOW();
      `, [resolvedUserId, resolvedWorkspaceId, cur, val]);
      if (cur === "USD" || cur === "USDT" || cur === "USDC") {
        // Update legacy balance if it's a USD-peg
        await pool.query(`UPDATE user_workspace_balance SET balance = $2 WHERE user_id = $1`, [resolvedUserId, val]);
      }
      return val;
    }
  },

  tradeFills: {
    sync: async (userId, fills = [], workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const rows = Array.isArray(fills) ? fills : [];
      const inserted = [];
      const updated = [];
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

        const result = await pool.query(`
          INSERT INTO user_workspace_trade_fills (
            user_id, workspace_id, trade_client_id, platform, platform_trade_id, platform_fill_id, symbol, side, market_type,
            quantity, price, notional, fee_amount, fee_currency, fee_source, liquidity_role, executed_at,
            reference_price, raw_payload_json, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
          ON CONFLICT (workspace_id, platform, platform_fill_id) DO UPDATE
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
            updated_at = NOW()
          RETURNING
            (xmax = '0'::xid) AS "wasInserted",
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
            raw_payload_json AS "rawPayload";
        `, [
          resolvedUserId,
          resolvedWorkspaceId,
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
        const saved = result.rows[0] ? mapTradeFillRow(result.rows[0]) : null;
        if (!saved) continue;
        if (result.rows[0].wasInserted) inserted.push(saved);
        else updated.push(saved);
      }

      return {
        inserted,
        updated,
        insertedCount: inserted.length,
        updatedCount: updated.length
      };
    },

    getSummary: async (userId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
        WHERE workspace_id = $1 AND ABS(COALESCE(fee_amount, 0)) > 0
        ORDER BY COALESCE(executed_at, created_at) DESC, id DESC;
      `, [resolvedWorkspaceId]);
      return summarizeFeeBreakdown(result.rows);
    },

    getExecutions: async (userId, filters = {}, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const safeLimit = Math.max(1, Math.min(500, Number(filters.limit) || 100));
      const clauses = ["workspace_id = $1", "platform <> 'zenin'"];
      const params = [resolvedWorkspaceId];
      const addParam = (value) => {
        params.push(value);
        return `$${params.length}`;
      };

      const platform = normalizePlatformValue(filters.platform, "");
      if (platform) clauses.push(`platform = ${addParam(platform)}`);

      const symbol = String(filters.symbol || "").trim().toUpperCase();
      if (symbol) clauses.push(`symbol = ${addParam(symbol)}`);

      const side = String(filters.side || "").trim().toLowerCase();
      if (["buy", "sell"].includes(side)) clauses.push(`side = ${addParam(side)}`);

      const marketType = String(filters.marketType || filters.market_type || "").trim().toLowerCase();
      if (marketType) clauses.push(`market_type = ${addParam(marketType)}`);

      const from = filters.from ? new Date(filters.from) : null;
      if (from && !Number.isNaN(from.getTime())) clauses.push(`COALESCE(executed_at, created_at) >= ${addParam(from.toISOString())}`);

      const to = filters.to ? new Date(filters.to) : null;
      if (to && !Number.isNaN(to.getTime())) clauses.push(`COALESCE(executed_at, created_at) <= ${addParam(to.toISOString())}`);

      params.push(safeLimit);
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
        WHERE ${clauses.join(" AND ")}
        ORDER BY COALESCE(executed_at, created_at) DESC, id DESC
        LIMIT $${params.length};
      `, params);

      return result.rows.map(mapTradeFillRow);
    },

    getKnownSymbols: async (userId, platform, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const normalizedPlatform = normalizePlatformValue(platform, "");
      if (!normalizedPlatform) {
        return { all: [], spot: [], perp: [], options: [] };
      }
      const result = await pool.query(`
        SELECT DISTINCT symbol, market_type AS "marketType"
        FROM user_workspace_trade_fills
        WHERE workspace_id = $1 AND platform = $2
        UNION
        SELECT DISTINCT asset AS symbol, market_type AS "marketType"
        FROM user_workspace_trades
        WHERE workspace_id = $1 AND platform = $2;
      `, [resolvedWorkspaceId, normalizedPlatform]);

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

  notifications: {
    create: async (userId, event = {}, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        INSERT INTO user_workspace_notification_events (
          user_id, workspace_id, type, title, body, entity_type, entity_id, metadata_json,
          category, severity, action_json, requested_channels_json, delivery_results_json,
          in_app_delivered_at, email_delivered_at, last_occurred_at, dedupe_key, occurrence_count, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1, NOW())
        RETURNING *;
      `, [
        resolvedUserId,
        resolvedWorkspaceId,
        String(event.type || "workspace.event").trim(),
        String(event.title || "Zenin update").trim(),
        String(event.body || "").trim(),
        event.entityType || event.entity_type || null,
        event.entityId == null ? null : String(event.entityId),
        JSON.stringify(parseJsonPayload(event.metadata || event.metadata_json, {})),
        String(event.category || "workspace").trim() || "workspace",
        String(event.severity || "info").trim() || "info",
        JSON.stringify(parseJsonPayload(event.action || event.action_json, {})),
        JSON.stringify(Array.isArray(event.requestedChannels) ? event.requestedChannels : ["inApp"]),
        JSON.stringify(parseJsonPayload(event.deliveryResults || event.delivery_results_json, {})),
        event.inAppDeliveredAt || null,
        event.emailDeliveredAt || null,
        event.lastOccurredAt || new Date().toISOString(),
        event.dedupeKey || null
      ]);
      return mapNotificationEventRow(result.rows[0]);
    },

    upsert: async (userId, event = {}, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const dedupeKey = event.dedupeKey == null ? null : String(event.dedupeKey).trim() || null;
      if (!dedupeKey) return userWorkspace.notifications.create(resolvedUserId, event, resolvedWorkspaceId);
      const result = await pool.query(`
        INSERT INTO user_workspace_notification_events (
          user_id, workspace_id, type, title, body, entity_type, entity_id, metadata_json,
          category, severity, action_json, requested_channels_json, delivery_results_json,
          in_app_delivered_at, email_delivered_at, last_occurred_at, dedupe_key, occurrence_count, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), $16, 1, NOW())
        ON CONFLICT (workspace_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
        DO UPDATE SET
          type = EXCLUDED.type,
          title = EXCLUDED.title,
          body = EXCLUDED.body,
          entity_type = EXCLUDED.entity_type,
          entity_id = EXCLUDED.entity_id,
          metadata_json = EXCLUDED.metadata_json,
          category = EXCLUDED.category,
          severity = EXCLUDED.severity,
          action_json = EXCLUDED.action_json,
          requested_channels_json = EXCLUDED.requested_channels_json,
          delivery_results_json = EXCLUDED.delivery_results_json,
          in_app_delivered_at = COALESCE(EXCLUDED.in_app_delivered_at, user_workspace_notification_events.in_app_delivered_at),
          email_delivered_at = COALESCE(EXCLUDED.email_delivered_at, user_workspace_notification_events.email_delivered_at),
          last_occurred_at = NOW(),
          occurrence_count = user_workspace_notification_events.occurrence_count + 1,
          updated_at = NOW()
        RETURNING *;
      `, [
        resolvedUserId, resolvedWorkspaceId,
        String(event.type || "workspace.event").trim(),
        String(event.title || "Zenin update").trim(),
        String(event.body || "").trim(),
        event.entityType || event.entity_type || null,
        event.entityId == null ? null : String(event.entityId),
        JSON.stringify(parseJsonPayload(event.metadata || event.metadata_json, {})),
        String(event.category || "workspace").trim() || "workspace",
        String(event.severity || "info").trim() || "info",
        JSON.stringify(parseJsonPayload(event.action || event.action_json, {})),
        JSON.stringify(Array.isArray(event.requestedChannels) ? event.requestedChannels : ["inApp"]),
        JSON.stringify(parseJsonPayload(event.deliveryResults || event.delivery_results_json, {})),
        event.inAppDeliveredAt || new Date().toISOString(),
        event.emailDeliveredAt || null,
        dedupeKey
      ]);
      return mapNotificationEventRow(result.rows[0]);
    },

    updateDelivery: async (userId, notificationId, patch = {}, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        UPDATE user_workspace_notification_events
        SET delivery_results_json = COALESCE(delivery_results_json, '{}'::jsonb) || $1::jsonb,
            in_app_delivered_at = COALESCE($2, in_app_delivered_at),
            email_delivered_at = COALESCE($3, email_delivered_at),
            updated_at = NOW()
        WHERE workspace_id = $4 AND id = $5
        RETURNING *;
      `, [
        JSON.stringify(parseJsonPayload(patch.deliveryResults || patch.delivery_results_json, {})),
        patch.inAppDeliveredAt || null,
        patch.emailDeliveredAt || null,
        resolvedWorkspaceId,
        Number(notificationId)
      ]);
      return result.rows[0] ? mapNotificationEventRow(result.rows[0]) : null;
    },

    getAll: async (userId, options = {}, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const safeLimit = Math.max(1, Math.min(200, Number(options.limit) || 50));
      const unreadOnly = String(options.unreadOnly || options.unread_only || "").toLowerCase() === "true" || options.unreadOnly === true;
      const result = await pool.query(`
        SELECT *
        FROM user_workspace_notification_events
        WHERE workspace_id = $1
          AND ($2::boolean IS FALSE OR read_at IS NULL)
        ORDER BY created_at DESC, id DESC
        LIMIT $3;
      `, [resolvedWorkspaceId, unreadOnly, safeLimit]);
      return result.rows.map(mapNotificationEventRow);
    },
    getUnreadCount: async (userId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `SELECT COUNT(*)::int AS count FROM user_workspace_notification_events WHERE workspace_id = $1 AND read_at IS NULL`,
        [resolvedWorkspaceId]
      );
      return result.rows[0]?.count || 0;
    },

    markRead: async (userId, notificationId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        UPDATE user_workspace_notification_events
        SET read_at = COALESCE(read_at, NOW())
        WHERE workspace_id = $1 AND id = $2
        RETURNING *;
      `, [resolvedWorkspaceId, Number(notificationId)]);
      return result.rows[0] ? mapNotificationEventRow(result.rows[0]) : null;
    },

    markAllRead: async (userId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        UPDATE user_workspace_notification_events
        SET read_at = COALESCE(read_at, NOW())
        WHERE workspace_id = $1 AND read_at IS NULL
        RETURNING id;
      `, [resolvedWorkspaceId]);
      return { updatedCount: result.rowCount || 0 };
    }
  },

  trades: {
    getAll: async (userId, limit = 1000, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
        WHERE workspace_id = $1
        ORDER BY COALESCE(executed_at, date::timestamptz) DESC, id DESC
        LIMIT $2;
      `, [resolvedWorkspaceId, safeLimit]);
      return result.rows.map(mapTradeRow);
    },
    sync: async (userId, trades, workspaceId = null) => {
      return userWorkspace.trades.syncWithOptions(userId, trades, workspaceId, {});
    },
    syncWithOptions: async (userId, trades, workspaceId = null, opts = {}) => {
      const { journalCutoff } = opts; // ISO string: only journal trades executed >= this date
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      for (const t of trades) {
        await pool.query(`
          INSERT INTO user_workspace_trades (
            user_id, workspace_id, client_id, date, executed_at, asset, name, type, side, market_type, status,
            quantity, price, notional, platform, fee, fee_currency, fee_source, slippage, reference_price, execution_meta_json, strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
          ON CONFLICT (workspace_id, client_id) WHERE client_id IS NOT NULL DO UPDATE
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
          resolvedUserId, resolvedWorkspaceId, t.clientId, t.date, t.executedAt, t.asset, t.name, t.type, t.side,
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
        // Only create journal events for trades executed AFTER the cutoff (first sync
        // or after the source was connected). Fail-closed: if no cutoff is known
        // (e.g. a sync path that didn't pass one), do NOT journal — historical trades
        // from before the account was linked to Zenin must never trigger reminders.
        if (journalCutoff && t.executedAt && new Date(t.executedAt) >= new Date(journalCutoff)) {
          await recordTradeJournalEvent(resolvedUserId, {
          source: normalizePlatformValue(t.platform, "zenin") === "zenin" ? "zenin_execution" : "broker_sync",
          clientId: t.clientId,
          platform: normalizePlatformValue(t.platform, "zenin"),
          symbol: t.asset,
          assetType: t.type,
          marketType: t.marketType,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          notional: t.notional,
          fee: t.fee,
          currency: t.feeCurrency,
          executedAt: t.executedAt,
          occurredAt: t.executedAt,
        }, resolvedWorkspaceId);
        } // journalCutoff gate
      }
    },

    add: async (userId, trade, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
            user_id, workspace_id, client_id, date, executed_at, asset, name, type, side, market_type, status,
            quantity, price, notional, platform, fee, fee_currency, fee_source, slippage, reference_price, execution_meta_json,
            balance_after, portfolio_value_after, account_equity_after, position_after,
            strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
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
          resolvedWorkspaceId,
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
        await recordTradeJournalEvent(resolvedUserId, {
          source: "zenin_execution",
          clientId: savedTrade.clientId,
          platform: savedTrade.platform,
          symbol: savedTrade.asset,
          assetType: savedTrade.type,
          marketType: savedTrade.marketType,
          side: savedTrade.side,
          quantity: savedTrade.quantity,
          price: savedTrade.price,
          notional: savedTrade.notional,
          fee: savedTrade.fee,
          currency: savedTrade.feeCurrency,
          executedAt: savedTrade.executedAt,
          occurredAt: savedTrade.executedAt,
          positionAfter: savedTrade.positionAfter,
        }, resolvedWorkspaceId);
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
          }], resolvedWorkspaceId);
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
            WHERE workspace_id = $1 AND client_id = $2
            LIMIT 1;
          `, [resolvedWorkspaceId, normalized.client_id]);
          if (existing.rows[0]) return mapTradeRow(existing.rows[0]);
        }
        throw error;
      }
    }
  },

  watchlist: {
    getAll: async (userId, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
        WHERE workspace_id = $1
        ORDER BY date_added DESC;
      `, [resolvedWorkspaceId]);
      return result.rows.map(mapWatchlistRow);
    },

    add: async (userId, asset, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
        WHERE workspace_id = $1
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
      `, [resolvedWorkspaceId, symbol, String(asset.name || symbol), type, category, theme, marketType, dateAdded]);
      if (updateResult.rows[0]) return mapWatchlistRow(updateResult.rows[0]);

      const insertResult = await pool.query(`
        INSERT INTO user_workspace_watchlist (user_id, workspace_id, symbol, name, type, category, theme, market_type, date_added)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (workspace_id, symbol, market_type, category, theme)
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
      `, [resolvedUserId, resolvedWorkspaceId, symbol, String(asset.name || symbol), type, category, theme, marketType, dateAdded]);
      return mapWatchlistRow(insertResult.rows[0]);
    },

    delete: async (userId, symbol, marketType, category = null, theme = null, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const cleanSymbol = String(symbol || "").trim().toUpperCase();
      const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
      const cleanCategory = String(category || "").trim().toLowerCase() || null;
      const cleanTheme = String(theme || "").trim() || null;
      if (cleanCategory || cleanTheme) {
        await pool.query(`
          DELETE FROM user_workspace_watchlist
          WHERE workspace_id = $1
            AND symbol = $2
            AND market_type = $3
            AND COALESCE(category, '') = COALESCE($4, '')
            AND COALESCE(theme, '') = COALESCE($5, '');
        `, [resolvedWorkspaceId, cleanSymbol, cleanMarketType, cleanCategory, cleanTheme]);
        return { success: true, symbol: cleanSymbol, marketType: cleanMarketType, category: cleanCategory, theme: cleanTheme };
      }
      await pool.query(`
        DELETE FROM user_workspace_watchlist
        WHERE workspace_id = $1 AND symbol = $2 AND market_type = $3;
      `, [resolvedWorkspaceId, cleanSymbol, cleanMarketType]);
      return { success: true, symbol: cleanSymbol, marketType: cleanMarketType, category: null, theme: null };
    },

    exists: async (userId, symbol, marketType, category = null, theme = null, workspaceId = null) => {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const cleanSymbol = String(symbol || "").trim().toUpperCase();
      const cleanMarketType = String(marketType || "spot").trim().toLowerCase();
      const cleanCategory = String(category || "").trim().toLowerCase() || null;
      const cleanTheme = String(theme || "").trim() || null;
      const result = cleanCategory || cleanTheme
        ? await pool.query(`
            SELECT id
            FROM user_workspace_watchlist
            WHERE workspace_id = $1
              AND symbol = $2
              AND market_type = $3
              AND COALESCE(category, '') = COALESCE($4, '')
              AND COALESCE(theme, '') = COALESCE($5, '')
            LIMIT 1
          `, [resolvedWorkspaceId, cleanSymbol, cleanMarketType, cleanCategory, cleanTheme])
        : await pool.query(`
            SELECT id
            FROM user_workspace_watchlist
            WHERE workspace_id = $1 AND symbol = $2 AND market_type = $3
            LIMIT 1;
          `, [resolvedWorkspaceId, cleanSymbol, cleanMarketType]);
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
    },

    delete: async (userId, id) => {
      const safeId = Number(id);
      if (!Number.isInteger(safeId)) return { deleted: false, reason: "invalid_id" };
      const result = await pool.query(`
        DELETE FROM user_workspace_options_calculations
        WHERE user_id = $1 AND id = $2
        RETURNING id;
      `, [toUserId(userId), safeId]);
      return { deleted: result.rowCount > 0, id: safeId };
    }
  },

  perpsCalculations: {
    add: async (userId, payload) => {
      const {
        calcType = "basis",
        label = null,
        inputs = {},
        results = {}
      } = payload;
      const validCalcType = ["basis", "perp_arb", "fees_crypto", "fees_broker"].includes(String(calcType).toLowerCase())
        ? String(calcType).toLowerCase()
        : "basis";
      const result = await pool.query(`
        INSERT INTO user_workspace_perps_calculations (
          user_id, calc_type, label, inputs_json, results_json
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `, [
        toUserId(userId),
        validCalcType,
        label ? String(label).trim().slice(0, 120) : null,
        JSON.stringify(inputs || {}),
        JSON.stringify(results || {})
      ]);
      const row = result.rows[0];
      return {
        ...row,
        inputs: parseJsonPayload(row.inputs_json, {}),
        results: parseJsonPayload(row.results_json, {}),
        created_at: toIsoString(row.created_at),
        updated_at: toIsoString(row.updated_at)
      };
    },

    getRecent: async (userId, limit = 20, calcType = null) => {
      const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
      const resolvedUserId = toUserId(userId);
      if (calcType) {
        const result = await pool.query(`
          SELECT * FROM user_workspace_perps_calculations
          WHERE user_id = $1 AND calc_type = $2
          ORDER BY created_at DESC, id DESC
          LIMIT $3;
        `, [resolvedUserId, String(calcType).toLowerCase(), safeLimit]);
        return result.rows.map((row) => ({
          ...row,
          inputs: parseJsonPayload(row.inputs_json, {}),
          results: parseJsonPayload(row.results_json, {}),
          created_at: toIsoString(row.created_at),
          updated_at: toIsoString(row.updated_at)
        }));
      }
      const result = await pool.query(`
        SELECT * FROM user_workspace_perps_calculations
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2;
      `, [resolvedUserId, safeLimit]);
      return result.rows.map((row) => ({
        ...row,
        inputs: parseJsonPayload(row.inputs_json, {}),
        results: parseJsonPayload(row.results_json, {}),
        created_at: toIsoString(row.created_at),
        updated_at: toIsoString(row.updated_at)
      }));
    },

    delete: async (userId, id) => {
      await pool.query(`
        DELETE FROM user_workspace_perps_calculations
        WHERE user_id = $1 AND id = $2;
      `, [toUserId(userId), Number(id)]);
      return { success: true };
    }
  },

  docs: {
    get: async (userId, namespace, fallback = null, workspaceId = null) => {
      const resolvedNamespace = String(namespace || "").trim();
      if (resolvedNamespace === "settings:preferences") {
        const result = await pool.query(`
          SELECT payload_json AS payload, updated_at AS "updatedAt"
          FROM user_workspace_documents
          WHERE user_id = $1 AND namespace = $2
          LIMIT 1;
        `, [toUserId(userId), resolvedNamespace]);
        if (!result.rows[0]) {
          return { namespace: resolvedNamespace, document: fallback, updatedAt: null };
        }
        return {
          namespace: resolvedNamespace,
          document: parseJsonPayload(result.rows[0].payload, fallback),
          updatedAt: toIsoString(result.rows[0].updatedAt)
        };
      }
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const result = await pool.query(`
        SELECT payload_json AS payload, updated_at AS "updatedAt"
        FROM workspace_documents
        WHERE workspace_id = $1 AND namespace = $2
        LIMIT 1;
      `, [Number(resolvedWorkspaceId), resolvedNamespace]);
      if (!result.rows[0]) {
        return { namespace: resolvedNamespace, document: fallback, updatedAt: null };
      }
      return {
        namespace: resolvedNamespace,
        document: parseJsonPayload(result.rows[0].payload, fallback),
        updatedAt: toIsoString(result.rows[0].updatedAt)
      };
    },

    set: async (userId, namespace, document, workspaceId = null) => {
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const resolvedNamespace = String(namespace || "").trim();
      if (resolvedNamespace === "settings:preferences") {
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
      const result = await pool.query(`
        INSERT INTO workspace_documents (workspace_id, namespace, payload_json, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (workspace_id, namespace) DO UPDATE
        SET payload_json = EXCLUDED.payload_json, updated_at = NOW()
        RETURNING payload_json AS payload, updated_at AS "updatedAt";
      `, [Number(resolvedWorkspaceId), resolvedNamespace, JSON.stringify(document ?? null)]);
      return {
        namespace: resolvedNamespace,
        document: parseJsonPayload(result.rows[0]?.payload, document ?? null),
        updatedAt: toIsoString(result.rows[0]?.updatedAt)
      };
    }
  },

  collections: {
    get: async (userId, namespace, fallback = [], workspaceId = null) => {
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const result = await pool.query(`
        SELECT items_json AS items, updated_at AS "updatedAt"
        FROM workspace_collections
        WHERE workspace_id = $1 AND namespace = $2
        LIMIT 1;
      `, [Number(resolvedWorkspaceId), String(namespace || "").trim()]);
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

    set: async (userId, namespace, items, limit = 500, workspaceId = null) => {
      const resolvedWorkspaceId = workspaceId || (await workspaces.ensurePersonalWorkspace(userId))?.id;
      const resolvedNamespace = String(namespace || "").trim();
      const normalizedItems = Array.isArray(items) ? items.slice(0, Math.max(1, Math.min(2000, Number(limit) || 500))) : [];
      const result = await pool.query(`
        INSERT INTO workspace_collections (workspace_id, namespace, items_json, updated_at)
        VALUES ($1, $2, $3::jsonb, NOW())
        ON CONFLICT (workspace_id, namespace) DO UPDATE
        SET items_json = EXCLUDED.items_json, updated_at = NOW()
        RETURNING items_json AS items, updated_at AS "updatedAt";
      `, [Number(resolvedWorkspaceId), resolvedNamespace, JSON.stringify(normalizedItems)]);
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

    executeTrade: async (userId, payload, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
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
          WHERE workspace_id = $1 AND client_id = $2
          LIMIT 1
          FOR UPDATE;
        `, [resolvedWorkspaceId, clientId]);

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
            WHERE workspace_id = $1 AND quantity > $2
            ORDER BY date_added DESC;
          `, [resolvedWorkspaceId, QTY_EPSILON]);
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
          WHERE workspace_id = $1 AND currency = $2
          FOR UPDATE;
        `, [resolvedWorkspaceId, buyCurrency]);

        let currentCashBalance = cashRow.rows[0]?.balance;
        if (currentCashBalance == null) {
          // If no balance and it's USD, use the legacy balance or default
          if (buyCurrency === "USD") {
             const legacyRow = await client.query(`SELECT balance FROM user_workspace_balance WHERE user_id = $1`, [resolvedUserId]);
             currentCashBalance = legacyRow.rows[0]?.balance ?? DEFAULT_BALANCE;
             await client.query(`
               INSERT INTO user_workspace_cash (user_id, workspace_id, currency, balance)
               VALUES ($1, $2, 'USD', $3)
               ON CONFLICT (workspace_id, currency) DO NOTHING
             `, [resolvedUserId, resolvedWorkspaceId, currentCashBalance]);
          } else {
             currentCashBalance = 0;
             await client.query(`
               INSERT INTO user_workspace_cash (user_id, workspace_id, currency, balance)
               VALUES ($1, $2, $3, 0)
               ON CONFLICT (workspace_id, currency) DO NOTHING
             `, [resolvedUserId, resolvedWorkspaceId, buyCurrency]);
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
          WHERE workspace_id = $1
            AND symbol = $2
            AND market_type = $3
            AND (strategy_name IS NOT DISTINCT FROM $4)
          FOR UPDATE;
        `, [resolvedWorkspaceId, symbol, marketType, strategyName]);

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
              WHERE id = $1 AND workspace_id = $2;
            `, [existing.id, resolvedWorkspaceId]);
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
              WHERE id = $10 AND workspace_id = $11
              RETURNING quantity;
            `, [nextQuantity, executedPrice, nextEntryPrice, nextOpenedAt, orderType, dateAdded, type, name, JSON.stringify(legsJson), existing.id, resolvedWorkspaceId]);
            positionAfter = toNumber(updated.rows[0]?.quantity, 0);
          }
        } else {
          if (orderType === "sell") {
            const err = new Error(`No existing position for ${symbol} (${marketType}) to sell`);
            err.code = "NO_POSITION";
            throw err;
          }
          const inserted = await client.query(`
            INSERT INTO user_workspace_portfolio (user_id, workspace_id, symbol, name, price, quantity, entry_price, opened_at, type, market_type, order_type, strategy_name, legs_json, date_added)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING quantity;
          `, [resolvedUserId, resolvedWorkspaceId, symbol, name, executedPrice, quantity, executedPrice, executionTimestamp, type, marketType, orderType, strategyName, JSON.stringify(legsJson), dateAdded]);
          positionAfter = toNumber(inserted.rows[0]?.quantity, 0);
        }

        await client.query(`
          UPDATE user_workspace_cash
          SET balance = $3, updated_at = NOW()
          WHERE workspace_id = $1 AND currency = $2;
        `, [resolvedWorkspaceId, buyCurrency, nextCashBalance]);

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
          WHERE workspace_id = $1 AND quantity > $2
          ORDER BY date_added DESC;
        `, [resolvedWorkspaceId, QTY_EPSILON]);
        const holdings = holdingsResult.rows.map(mapPortfolioRow);
        const portfolioValueAfter = holdings.reduce((total, h) => total + (toNumber(h.price) * toNumber(h.quantity)), 0);

        const tradeResult = await client.query(`
          INSERT INTO user_workspace_trades (
            user_id, workspace_id, client_id, date, executed_at, asset, name, type, side, market_type, status,
            quantity, price, notional, platform, fee, fee_currency, fee_source, slippage, reference_price, execution_meta_json,
            balance_after, portfolio_value_after, account_equity_after, position_after,
            strategy_name, legs_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
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
          resolvedWorkspaceId,
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
            user_id, workspace_id, trade_client_id, platform, platform_trade_id, platform_fill_id, symbol, side, market_type,
            quantity, price, notional, fee_amount, fee_currency, fee_source, liquidity_role, executed_at,
            reference_price, raw_payload_json, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
          ON CONFLICT (workspace_id, platform, platform_fill_id) DO UPDATE
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
          resolvedWorkspaceId,
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
        const executedTrade = mapTradeRow(tradeResult.rows[0]);
        await recordTradeJournalEvent(resolvedUserId, {
          source: platform === "zenin" ? "zenin_execution" : "broker_sync",
          clientId,
          platform,
          symbol,
          assetType: orderType === "sell" ? "SELL" : "BUY",
          marketType,
          side: orderType,
          quantity,
          price: executedPrice,
          notional: Math.abs(notional),
          fee,
          currency: feeCurrency,
          executedAt: executionTimestamp,
          occurredAt: executionTimestamp,
          positionAfter,
        }, resolvedWorkspaceId);
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
  },

  decisionThreads: {
    list: async (userId, workspaceId = null, { status, priority, sourceType, page = 1, pageSize = 500 } = {}) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const filters = [`workspace_id = $1`, `user_id = $2`];
      const values = [resolvedWorkspaceId, resolvedUserId];
      let idx = 3;
      if (status) { filters.push(`status = $${idx}`); values.push(String(status).trim().toLowerCase()); idx += 1; }
      if (priority) { filters.push(`priority = $${idx}`); values.push(String(priority).trim().toLowerCase()); idx += 1; }
      if (sourceType) { filters.push(`source_type = $${idx}`); values.push(String(sourceType).trim().toLowerCase()); idx += 1; }
      const safePageSize = Math.min(Math.max(Number(pageSize) || 500, 1), 500);
      const safePage = Math.max(Number(page) || 1, 1);
      const offset = (safePage - 1) * safePageSize;
      values.push(safePageSize, offset);
      const result = await pool.query(`
        SELECT
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          title,
          symbol,
          asset_type AS "assetType",
          source_type AS "sourceType",
          source_id AS "sourceId",
          status,
          priority,
          due_at AS "dueAt",
          linked_alert_key AS "linkedAlertKey",
          linked_research_id AS "linkedResearchId",
          linked_journal_id AS "linkedJournalId",
          linked_trade_execution_id AS "linkedTradeExecutionId",
          outcome,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM decision_threads
        WHERE ${filters.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT $${idx} OFFSET $${idx + 1};
      `, values);
      return result.rows.map(mapDecisionThreadRow);
    },
    getById: async (userId, id, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        SELECT
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          title,
          symbol,
          asset_type AS "assetType",
          source_type AS "sourceType",
          source_id AS "sourceId",
          status,
          priority,
          due_at AS "dueAt",
          linked_alert_key AS "linkedAlertKey",
          linked_research_id AS "linkedResearchId",
          linked_journal_id AS "linkedJournalId",
          linked_trade_execution_id AS "linkedTradeExecutionId",
          outcome,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM decision_threads
        WHERE id = $1 AND workspace_id = $2 AND user_id = $3;
      `, [String(id), resolvedWorkspaceId, resolvedUserId]);
      return mapDecisionThreadRow(result.rows[0]);
    },
    create: async (userId, payload, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const title = String(payload.title || "").trim();
      const symbol = payload.symbol ? String(payload.symbol).trim().toUpperCase() : null;
      const assetType = payload.assetType ? String(payload.assetType).trim().toLowerCase() : null;
      const sourceType = String(payload.sourceType || "manual").trim().toLowerCase();
      const sourceId = payload.sourceId ? String(payload.sourceId) : null;
      const status = String(payload.status || "new").trim().toLowerCase();
      const priority = String(payload.priority || "medium").trim().toLowerCase();
      const dueAt = payload.dueAt || null;
      const linkedAlertKey = payload.linkedAlertKey ? String(payload.linkedAlertKey) : null;
      const linkedResearchId = payload.linkedResearchId ? String(payload.linkedResearchId) : null;
      const linkedJournalId = payload.linkedJournalId ? String(payload.linkedJournalId) : null;
      const linkedTradeExecutionId = payload.linkedTradeExecutionId ? String(payload.linkedTradeExecutionId) : null;
      const result = await pool.query(`
        INSERT INTO decision_threads (
          workspace_id, user_id, title, symbol, asset_type, source_type, source_id,
          status, priority, due_at,
          linked_alert_key, linked_research_id, linked_journal_id, linked_trade_execution_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          title, symbol, asset_type AS "assetType",
          source_type AS "sourceType", source_id AS "sourceId",
          status, priority, due_at AS "dueAt",
          linked_alert_key AS "linkedAlertKey",
          linked_research_id AS "linkedResearchId",
          linked_journal_id AS "linkedJournalId",
          linked_trade_execution_id AS "linkedTradeExecutionId",
          outcome,
          created_at AS "createdAt",
          updated_at AS "updatedAt";
      `, [
        resolvedWorkspaceId, resolvedUserId, title, symbol, assetType, sourceType, sourceId,
        status, priority, dueAt,
        linkedAlertKey, linkedResearchId, linkedJournalId, linkedTradeExecutionId
      ]);
      return mapDecisionThreadRow(result.rows[0]);
    },
    update: async (userId, id, patch, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const sets = [];
      const values = [];
      let idx = 1;
      values.push(String(id), resolvedWorkspaceId, resolvedUserId);
      idx = 4;
      const pushSet = (column, value, transform = (v) => v) => {
        if (value === undefined) return;
        sets.push(`${column} = $${idx}`);
        values.push(transform(value));
        idx += 1;
      };
      pushSet("title", patch.title, (v) => String(v).trim());
      pushSet("symbol", patch.symbol, (v) => String(v).trim().toUpperCase());
      pushSet("asset_type", patch.assetType, (v) => String(v).trim().toLowerCase());
      pushSet("source_type", patch.sourceType, (v) => String(v).trim().toLowerCase());
      pushSet("source_id", patch.sourceId, (v) => (v == null ? null : String(v)));
      pushSet("status", patch.status, (v) => String(v).trim().toLowerCase());
      pushSet("priority", patch.priority, (v) => String(v).trim().toLowerCase());
      pushSet("due_at", patch.dueAt);
      pushSet("linked_alert_key", patch.linkedAlertKey, (v) => (v == null ? null : String(v)));
      pushSet("linked_research_id", patch.linkedResearchId, (v) => (v == null ? null : String(v)));
      pushSet("linked_journal_id", patch.linkedJournalId, (v) => (v == null ? null : String(v)));
      pushSet("linked_trade_execution_id", patch.linkedTradeExecutionId, (v) => (v == null ? null : String(v)));
      if (patch.outcome !== undefined) {
        sets.push(`outcome = $${idx}`);
        values.push(JSON.stringify(patch.outcome || {}));
        idx += 1;
      }
      if (sets.length === 0) return null;
      sets.push("updated_at = NOW()");
      const result = await pool.query(`
        UPDATE decision_threads
        SET ${sets.join(", ")}
        WHERE id = $1 AND workspace_id = $2 AND user_id = $3
        RETURNING
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          title, symbol, asset_type AS "assetType",
          source_type AS "sourceType", source_id AS "sourceId",
          status, priority, due_at AS "dueAt",
          linked_alert_key AS "linkedAlertKey",
          linked_research_id AS "linkedResearchId",
          linked_journal_id AS "linkedJournalId",
          linked_trade_execution_id AS "linkedTradeExecutionId",
          outcome,
          created_at AS "createdAt",
          updated_at AS "updatedAt";
      `, values);
      return mapDecisionThreadRow(result.rows[0]);
    },
    listOutcomes: async (userId, workspaceId = null, { limit = 100, sourceType, result } = {}) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const filters = [`workspace_id = $1`, `user_id = $2`, `status = 'reviewed'`];
      const values = [resolvedWorkspaceId, resolvedUserId];
      let idx = 3;
      if (sourceType) { filters.push(`source_type = $${idx}`); values.push(String(sourceType).trim().toLowerCase()); idx += 1; }
      if (result) { filters.push(`outcome->>'result' = $${idx}`); values.push(String(result).trim().toLowerCase()); idx += 1; }
      values.push(Number(limit) > 0 ? Math.min(Number(limit), 500) : 100);
      const resultSet = await pool.query(`
        SELECT
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          title,
          symbol,
          asset_type AS "assetType",
          source_type AS "sourceType",
          source_id AS "sourceId",
          status,
          priority,
          due_at AS "dueAt",
          linked_alert_key AS "linkedAlertKey",
          linked_research_id AS "linkedResearchId",
          linked_journal_id AS "linkedJournalId",
          linked_trade_execution_id AS "linkedTradeExecutionId",
          outcome,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM decision_threads
        WHERE ${filters.join(" AND ")}
        ORDER BY (outcome->>'reviewedAt')::timestamptz DESC NULLS LAST, updated_at DESC
        LIMIT $${idx};
      `, values);
      return resultSet.rows.map(mapDecisionThreadRow);
    },
    markReviewed: async (userId, id, outcome, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const normalizedOutcome = {
        result: String(outcome?.result || "reviewed").trim().toLowerCase(),
        pnl: typeof outcome?.pnl === "number" ? outcome.pnl : null,
        lesson: outcome?.lesson ? String(outcome.lesson) : null,
        mistakeTag: outcome?.mistakeTag ? String(outcome.mistakeTag) : null,
        reviewedAt: new Date().toISOString()
      };
      const result = await pool.query(`
        UPDATE decision_threads
        SET status = 'reviewed',
            outcome = $4::jsonb,
            due_at = NULL,
            updated_at = NOW()
        WHERE id = $1 AND workspace_id = $2 AND user_id = $3
        RETURNING
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          title, symbol, asset_type AS "assetType",
          source_type AS "sourceType", source_id AS "sourceId",
          status, priority, due_at AS "dueAt",
          linked_alert_key AS "linkedAlertKey",
          linked_research_id AS "linkedResearchId",
          linked_journal_id AS "linkedJournalId",
          linked_trade_execution_id AS "linkedTradeExecutionId",
          outcome,
          created_at AS "createdAt",
          updated_at AS "updatedAt";
      `, [String(id), resolvedWorkspaceId, resolvedUserId, JSON.stringify(normalizedOutcome)]);
      return mapDecisionThreadRow(result.rows[0]);
    },
    linkResearch: async (userId, id, researchId, workspaceId = null) => {
      return await userWorkspace.decisionThreads.update(userId, id, {
        linkedResearchId: researchId,
        status: "researching"
      }, workspaceId);
    },
    createJournalEntry: async (userId, id, entryPayload, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const thread = await userWorkspace.decisionThreads.getById(userId, id, workspaceId);
      if (!thread) return null;
      const collection = await userWorkspace.collections.get(userId, "journal:entries", [], workspaceId);
      const items = Array.isArray(collection.items) ? collection.items : [];
      const newEntry = {
        id: entryPayload.id || `journal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceTradeKey: entryPayload.sourceTradeKey || thread.linkedTradeExecutionId || null,
        symbol: entryPayload.symbol || thread.symbol || "",
        tradeDate: entryPayload.tradeDate || new Date().toISOString().slice(0, 10),
        side: entryPayload.side || "",
        quantity: entryPayload.quantity || null,
        price: entryPayload.price || null,
        notional: entryPayload.notional || null,
        marketType: entryPayload.marketType || "",
        status: "open",
        strategy: entryPayload.strategy || "",
        setupTag: entryPayload.setupTag || "",
        marketRegime: entryPayload.marketRegime || "",
        timeframe: entryPayload.timeframe || "",
        emotion: entryPayload.emotion || "",
        confidence: entryPayload.confidence || null,
        preThesis: entryPayload.preThesis || thread.title || "",
        postReview: entryPayload.postReview || "",
        mistakeCategory: entryPayload.mistakeCategory || "",
        learned: entryPayload.learned || "",
        chartLink: entryPayload.chartLink || "",
        decisionThreadId: thread.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const nextItems = [newEntry, ...items].slice(0, 2000);
      await userWorkspace.collections.set(userId, "journal:entries", nextItems, 2000, workspaceId);
      // Link the journal entry and auto-create a review due date (7 days out)
      const reviewDueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const updated = await userWorkspace.decisionThreads.update(userId, id, {
        linkedJournalId: newEntry.id,
        status: "review_due",
        dueAt: reviewDueAt
      }, workspaceId);
      return { thread: updated, journalEntry: newEntry };
    }
  },

  // ── Trade journaling: normalized events ─────────────────────────────────
  journalEvents: {
    // Build a stable, dedupe-safe event key from a source record.
    buildEventKey({ source, clientId, platform, platformTradeId, platformFillId, symbol, occurredAt }) {
      const norm = (v) => String(v == null ? "" : v).trim().toUpperCase();
      const parts = [source, clientId || "", platform || "", platformTradeId || "", platformFillId || "", norm(symbol), occurredAt ? String(occurredAt).replace(/\.\d+Z$/, "Z") : ""];
      return parts.filter((p) => p !== "").join(":");
    },

    // Pure classification rules (spec §1).
    classify(raw) {
      const type = String(raw.eventType || raw.type || "").toLowerCase();
      const platform = String(raw.platform || "").toLowerCase();
      const status = String(raw.status || "").toLowerCase();
      if (type === "assignment" || type === "expiry" || type === "forced_liquidation" || type === "corporate_action") {
        return "decision_relevant";
      }
      if (type === "position_change" && Math.abs(Number(raw.positionDelta || 0)) > 0) {
        return "decision_relevant";
      }
      if (type === "transfer" || platform.includes("recon") || status.includes("reconcil") || type === "sync_correction") {
        return "operational";
      }
      if (type === "execution" || type === "fill" || raw.source === "zenin_execution" || raw.source === "broker_sync") {
        return "decision_relevant";
      }
      return "unknown";
    },

    async detectOrRefresh(userId, raw, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const eventKey = raw.eventKey || this.buildEventKey(raw);
      const classification = raw.classification || this.classify(raw);
      const occurredAt = raw.occurredAt ? new Date(raw.occurredAt) : (raw.executedAt ? new Date(raw.executedAt) : new Date());
      const row = {
        eventKey,
        eventType: raw.eventType || raw.type || "execution",
        source: raw.source || "zenin_execution",
        symbol: raw.symbol || null,
        assetType: raw.assetType || raw.asset_type || raw.type || null,
        marketType: raw.marketType || raw.market_type || "spot",
        platform: raw.platform || "zenin",
        accountId: raw.accountId || raw.account_id || null,
        side: raw.side || null,
        quantity: raw.quantity != null ? Number(raw.quantity) : null,
        price: raw.price != null ? Number(raw.price) : null,
        notional: raw.notional != null ? Number(raw.notional) : null,
        fee: raw.fee != null ? Number(raw.fee) : null,
        currency: raw.currency || raw.feeCurrency || "USD",
        occurredAt: occurredAt.toISOString(),
        positionBefore: raw.positionBefore != null ? Number(raw.positionBefore) : null,
        positionAfter: raw.positionAfter != null ? Number(raw.positionAfter) : null,
        positionDelta: raw.positionDelta != null ? Number(raw.positionDelta) : null,
        classification,
        metadataJson: raw.metadata || raw.metadataJson || {},
      };
      const result = await pool.query(`
        INSERT INTO journal_events (
          workspace_id, user_id, event_key, event_type, source, symbol, asset_type, market_type,
          platform, account_id, side, quantity, price, notional, fee, currency, occurred_at,
          position_before, position_after, position_delta, classification, metadata_json, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, NOW())
        ON CONFLICT (workspace_id, event_key) DO UPDATE SET
          event_type = EXCLUDED.event_type,
          source = EXCLUDED.source,
          symbol = EXCLUDED.symbol,
          side = EXCLUDED.side,
          quantity = EXCLUDED.quantity,
          price = EXCLUDED.price,
          notional = EXCLUDED.notional,
          fee = EXCLUDED.fee,
          position_before = COALESCE(EXCLUDED.position_before, journal_events.position_before),
          position_after = EXCLUDED.position_after,
          position_delta = EXCLUDED.position_delta,
          classification = CASE WHEN journal_events.classification = 'unknown' THEN EXCLUDED.classification ELSE journal_events.classification END,
          metadata_json = EXCLUDED.metadata_json,
          updated_at = NOW()
        RETURNING *;
      `, [
        resolvedWorkspaceId, resolvedUserId, row.eventKey, row.eventType, row.source, row.symbol, row.assetType,
        row.marketType, row.platform, row.accountId, row.side, row.quantity, row.price, row.notional, row.fee,
        row.currency, row.occurredAt, row.positionBefore, row.positionAfter, row.positionDelta, row.classification,
        JSON.stringify(row.metadataJson),
      ]);
      const e = result.rows[0];
      return this._map(e);
    },

    async getById(userId, id, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `SELECT * FROM journal_events WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
        [id, resolvedWorkspaceId, resolvedUserId]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    async list(userId, filters = {}, workspaceId = null) {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const where = ["workspace_id = $1"];
      const params = [resolvedWorkspaceId];
      let i = 2;
      if (filters.status) { where.push(`status = $${i++}`); params.push(filters.status); }
      if (filters.eventType) { where.push(`event_type = $${i++}`); params.push(filters.eventType); }
      if (filters.classification) { where.push(`classification = $${i++}`); params.push(filters.classification); }
      if (filters.symbol) { where.push(`symbol = $${i++}`); params.push(String(filters.symbol).toUpperCase()); }
      if (filters.from) { where.push(`occurred_at >= $${i++}`); params.push(filters.from); }
      if (filters.to) { where.push(`occurred_at <= $${i++}`); params.push(filters.to); }
      const page = Math.max(1, Number(filters.page) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize) || 50));
      const result = await pool.query(
        `SELECT * FROM journal_events WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...params, pageSize, (page - 1) * pageSize]
      );
      return result.rows.map((r) => this._map(r));
    },

    async classifyEvent(userId, id, classification, reason, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `UPDATE journal_events SET classification = $1, metadata_json = jsonb_set(metadata_json, '{classificationReason}', $2::jsonb), updated_at = NOW()
         WHERE id = $3 AND workspace_id = $4 AND user_id = $5 RETURNING *`,
        [classification, JSON.stringify(reason || ""), id, resolvedWorkspaceId, resolvedUserId]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    async snooze(userId, id, until, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `UPDATE journal_events SET status = 'snoozed', metadata_json = jsonb_set(metadata_json, '{snoozedUntil}', $1::jsonb), updated_at = NOW()
         WHERE id = $2 AND workspace_id = $3 AND user_id = $4 RETURNING *`,
        [JSON.stringify(until), id, resolvedWorkspaceId, resolvedUserId]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    async dismiss(userId, id, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `UPDATE journal_events SET status = 'dismissed', updated_at = NOW() WHERE id = $1 AND workspace_id = $2 AND user_id = $3 RETURNING *`,
        [id, resolvedWorkspaceId, resolvedUserId]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    // Bulk-dismiss journal events. Scope:
    //   - ids: array of specific event ids (when provided, only these are dismissed)
    //   - status: restrict to a status (default 'open')
    //   - onlyOpen: when true, only 'open' events are touched (safe default)
    // Used by the "Dismiss all" control to clear a historical reminder flood
    // without looping N single-PATCH calls.
    async bulkDismiss(userId, { ids = null, status = "open", onlyOpen = true } = {}, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const params = [resolvedWorkspaceId, resolvedUserId];
      let sql = `UPDATE journal_events SET status = 'dismissed', updated_at = NOW() WHERE workspace_id = $1 AND user_id = $2`;
      if (Array.isArray(ids) && ids.length) {
        const placeholders = ids.map((_, i) => `$${i + 3}`).join(", ");
        sql += ` AND id IN (${placeholders})`;
        ids.forEach((id) => params.push(id));
      } else if (onlyOpen) {
        sql += ` AND status = $3`;
        params.push(status || "open");
      }
      sql += ` RETURNING id`;
      const result = await pool.query(sql, params);
      return { dismissed: result.rowCount || 0, ids: result.rows.map((r) => r.id) };
    },

    async link(userId, id, { journalEntryId, decisionThreadId } = {}, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `UPDATE journal_events SET journal_entry_id = COALESCE($1, journal_entry_id), decision_thread_id = COALESCE($2, decision_thread_id), status = CASE WHEN $1 IS NOT NULL OR $2 IS NOT NULL THEN 'journaled' ELSE status END, updated_at = NOW()
         WHERE id = $3 AND workspace_id = $4 AND user_id = $5 RETURNING *`,
        [journalEntryId || null, decisionThreadId || null, id, resolvedWorkspaceId, resolvedUserId]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    _map(r) {
      if (!r) return null;
      return {
        id: r.id,
        workspaceId: r.workspace_id,
        userId: r.user_id,
        eventKey: r.event_key,
        eventType: r.event_type,
        source: r.source,
        symbol: r.symbol,
        assetType: r.asset_type,
        marketType: r.market_type,
        platform: r.platform,
        accountId: r.account_id,
        side: r.side,
        quantity: r.quantity,
        price: r.price,
        notional: r.notional,
        fee: r.fee,
        currency: r.currency,
        occurredAt: r.occurred_at,
        positionBefore: r.position_before,
        positionAfter: r.position_after,
        positionDelta: r.position_delta,
        classification: r.classification,
        status: r.status,
        journalEntryId: r.journal_entry_id,
        decisionThreadId: r.decision_thread_id,
        metadata: r.metadata_json,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    },
  },

  // ── Trade journaling: reminder tasks ────────────────────────────────────
  journalReminders: {
    async create(userId, { eventId, reminderType, dueAt, dedupeKey }, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        INSERT INTO journal_reminder_tasks (event_id, workspace_id, user_id, reminder_type, due_at, dedupe_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (workspace_id, dedupe_key) DO NOTHING
        RETURNING *;
      `, [eventId, resolvedWorkspaceId, resolvedUserId, reminderType, new Date(dueAt).toISOString(), dedupeKey]);
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    // Create the reminder pair for a freshly detected event:
    // an immediate prompt + a single 24h follow-up. Idempotent via dedupe_key.
    // Operational events get no reminders (spec §2).
    async createForEvent(event, workspaceId = null) {
      if (!event || !event.id) return [];
      if (event.classification === "operational" || event.classification === "unknown") return [];
      if (event.status && event.status !== "open") return [];
      const now = new Date();
      const followUp = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const created = [];
      const initial = await this.create(event.userId, {
        eventId: event.id,
        reminderType: "initial",
        dueAt: now,
        dedupeKey: `${event.id}:initial`,
      }, workspaceId);
      if (initial) created.push(initial);
      const follow = await this.create(event.userId, {
        eventId: event.id,
        reminderType: "follow_up",
        dueAt: followUp,
        dedupeKey: `${event.id}:follow_up`,
      }, workspaceId);
      if (follow) created.push(follow);
      return created;
    },

    // Resolve the recipient email for a workspace member (best-effort).
    async getUserEmail(userId) {
      const result = await pool.query(`SELECT email FROM app_users WHERE id = $1`, [userId]);
      return result.rows[0] ? result.rows[0].email : null;
    },

    // Journal reminder preferences (collection-backed, consistent with journal:entries).
    async getPrefs(userId, workspaceId = null) {
      const defaults = { email: true, includeOperational: false, cadence: "weekly" };
      try {
        const collection = await userWorkspace.collections.get(userId, "journal:prefs", defaults, workspaceId);
        const items = Array.isArray(collection.items) ? collection.items : [];
        const stored = items[0] && typeof items[0] === "object" ? items[0] : {};
        return { ...defaults, ...stored };
      } catch {
        return defaults;
      }
    },

    // Persist journal reminder/report preferences (Phase 6).
    async setPrefs(userId, patch = {}, workspaceId = null) {
      const current = await this.getPrefs(userId, workspaceId);
      const next = {
        email: typeof patch.email === "boolean" ? patch.email : current.email,
        includeOperational: typeof patch.includeOperational === "boolean" ? patch.includeOperational : current.includeOperational,
        cadence: ["daily", "weekly", "quarterly", "half_year", "yearly"].includes(patch.cadence) ? patch.cadence : current.cadence,
      };
      await userWorkspace.collections.set(userId, "journal:prefs", [next], 1, workspaceId);
      return next;
    },

    async claimDue(before = new Date(), limit = 50) {
      const result = await pool.query(`
        UPDATE journal_reminder_tasks
        SET status = 'sent'
        WHERE id IN (
          SELECT id FROM journal_reminder_tasks
          WHERE status = 'pending' AND due_at <= $1
          ORDER BY due_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *;
      `, [before.toISOString(), limit]);
      return result.rows.map((r) => this._map(r));
    },

    async complete(userId, id, channelResults = null, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `UPDATE journal_reminder_tasks SET status = 'completed', sent_at = COALESCE(sent_at, NOW()), channel_results_json = COALESCE($4::jsonb, channel_results_json) WHERE id = $1 AND workspace_id = $2 AND user_id = $3 RETURNING *`,
        [id, resolvedWorkspaceId, resolvedUserId, channelResults ? JSON.stringify(channelResults) : null]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    async snooze(userId, id, until, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `UPDATE journal_reminder_tasks SET status = 'snoozed', due_at = $1 WHERE id = $2 AND workspace_id = $3 AND user_id = $4 RETURNING *`,
        [new Date(until).toISOString(), id, resolvedWorkspaceId, resolvedUserId]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    async list(userId, workspaceId = null) {
      const { resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `SELECT * FROM journal_reminder_tasks WHERE workspace_id = $1 ORDER BY due_at DESC LIMIT 200`,
        [resolvedWorkspaceId]
      );
      return result.rows.map((r) => this._map(r));
    },

    _map(r) {
      if (!r) return null;
      return {
        id: r.id,
        eventId: r.event_id,
        workspaceId: r.workspace_id,
        userId: r.user_id,
        reminderType: r.reminder_type,
        dueAt: r.due_at,
        status: r.status,
        sentAt: r.sent_at,
        channelResults: r.channel_results_json,
        dedupeKey: r.dedupe_key,
        createdAt: r.created_at,
      };
    },
  },

  dailyBriefings: {
    getByDate: async (userId, date, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const dateStr = toDateString(date);
      const result = await pool.query(`
        SELECT
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          briefing_date AS "briefingDate",
          status,
          summary,
          market_regime AS "marketRegime",
          risk_level AS "riskLevel",
          sections,
          metrics,
          generated_at AS "generatedAt",
          read_at AS "readAt",
          completed_at AS "completedAt"
        FROM daily_briefings
        WHERE workspace_id = $1 AND user_id = $2 AND briefing_date = $3;
      `, [resolvedWorkspaceId, resolvedUserId, dateStr]);
      return mapDailyBriefingRow(result.rows[0]);
    },
    upsert: async (userId, date, payload, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const dateStr = toDateString(date);
      const result = await pool.query(`
        INSERT INTO daily_briefings (
          workspace_id, user_id, briefing_date, status, summary, market_regime, risk_level, sections, metrics, generated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW())
        ON CONFLICT (workspace_id, user_id, briefing_date)
        DO UPDATE SET
          status = EXCLUDED.status,
          summary = EXCLUDED.summary,
          market_regime = EXCLUDED.market_regime,
          risk_level = EXCLUDED.risk_level,
          sections = EXCLUDED.sections,
          metrics = EXCLUDED.metrics,
          generated_at = NOW(),
          completed_at = NULL,
          read_at = NULL
        RETURNING
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          briefing_date AS "briefingDate",
          status,
          summary,
          market_regime AS "marketRegime",
          risk_level AS "riskLevel",
          sections,
          metrics,
          generated_at AS "generatedAt",
          read_at AS "readAt",
          completed_at AS "completedAt";
      `, [
        resolvedWorkspaceId, resolvedUserId, dateStr,
        String(payload.status || "ready").trim().toLowerCase(),
        payload.summary || null,
        payload.marketRegime || null,
        payload.riskLevel || null,
        JSON.stringify(payload.sections || []),
        JSON.stringify(payload.metrics || {})
      ]);
      return mapDailyBriefingRow(result.rows[0]);
    },
    markRead: async (userId, id, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        UPDATE daily_briefings
        SET read_at = NOW()
        WHERE id = $1 AND workspace_id = $2 AND user_id = $3
        RETURNING
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          briefing_date AS "briefingDate",
          status,
          summary,
          market_regime AS "marketRegime",
          risk_level AS "riskLevel",
          sections,
          metrics,
          generated_at AS "generatedAt",
          read_at AS "readAt",
          completed_at AS "completedAt";
      `, [String(id), resolvedWorkspaceId, resolvedUserId]);
      return mapDailyBriefingRow(result.rows[0]);
    },
    markCompleted: async (userId, id, workspaceId = null) => {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(`
        UPDATE daily_briefings
        SET completed_at = NOW(), status = 'completed'
        WHERE id = $1 AND workspace_id = $2 AND user_id = $3
        RETURNING
          id,
          workspace_id AS "workspaceId",
          user_id AS "userId",
          briefing_date AS "briefingDate",
          status,
          summary,
          market_regime AS "marketRegime",
          risk_level AS "riskLevel",
          sections,
          metrics,
          generated_at AS "generatedAt",
          read_at AS "readAt",
          completed_at AS "completedAt";
      `, [String(id), resolvedWorkspaceId, resolvedUserId]);
      return mapDailyBriefingRow(result.rows[0]);
    }
  },

  // ── Trade journaling: periodic reports (Phase 4) ────────────────────────
  // Calendar-based daily/weekly/quarterly/half-year/yearly digests aggregated
  // from journal_events. One row per (workspace, cadence, period_key) => the
  // generate path is idempotent (upsert, never duplicates).
  journalReports: {
    CADENCES: ["daily", "weekly", "quarterly", "half_year", "yearly"],

    async generate(userId, { cadence, periodKey, periodStart, periodEnd, timeZone } = {}, workspaceId = null) {
      if (!this.CADENCES.includes(cadence)) throw new Error(`Unknown cadence: ${cadence}`);
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      let key = periodKey;
      let start = periodStart ? new Date(periodStart) : null;
      let end = periodEnd ? new Date(periodEnd) : null;
      if (!key || !start || !end) {
        const win = getPeriodWindow(cadence, new Date(), timeZone);
        key = key || win.periodKey;
        start = start || win.periodStart;
        end = end || win.periodEnd;
      }
      const events = await userWorkspace.journalEvents.list(
        resolvedUserId,
        { from: start.toISOString(), to: end.toISOString(), pageSize: 1000 },
        resolvedWorkspaceId
      );
      const summary = buildJournalReportSummary(events || []);
      const result = await pool.query(`
        INSERT INTO journal_reports (workspace_id, user_id, cadence, period_key, period_start, period_end, status, summary_json, generated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7::jsonb, NOW())
        ON CONFLICT (workspace_id, cadence, period_key) DO UPDATE SET
          period_start = EXCLUDED.period_start,
          period_end = EXCLUDED.period_end,
          status = EXCLUDED.status,
          summary_json = EXCLUDED.summary_json,
          generated_at = NOW()
        RETURNING *;
      `, [
        resolvedWorkspaceId, resolvedUserId, cadence, key,
        start.toISOString(), end.toISOString(), JSON.stringify(summary),
      ]);
      return this._map(result.rows[0]);
    },

    async getLatest(userId, cadence, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `SELECT * FROM journal_reports WHERE workspace_id = $1 AND user_id = $2 AND cadence = $3 ORDER BY period_start DESC LIMIT 1`,
        [resolvedWorkspaceId, resolvedUserId, cadence]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    async getByPeriod(userId, cadence, periodKey, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const result = await pool.query(
        `SELECT * FROM journal_reports WHERE workspace_id = $1 AND user_id = $2 AND cadence = $3 AND period_key = $4 LIMIT 1`,
        [resolvedWorkspaceId, resolvedUserId, cadence, periodKey]
      );
      return result.rows[0] ? this._map(result.rows[0]) : null;
    },

    async list(userId, { cadence } = {}, workspaceId = null) {
      const { resolvedUserId, resolvedWorkspaceId } = await resolveWorkspaceScope(userId, workspaceId);
      const params = [resolvedWorkspaceId, resolvedUserId];
      let sql = `SELECT * FROM journal_reports WHERE workspace_id = $1 AND user_id = $2`;
      if (cadence) { sql += ` AND cadence = $3`; params.push(cadence); }
      sql += ` ORDER BY period_start DESC LIMIT 100`;
      const result = await pool.query(sql, params);
      return result.rows.map((r) => this._map(r));
    },

    _map(r) {
      if (!r) return null;
      return {
        id: r.id,
        workspaceId: r.workspace_id,
        userId: r.user_id,
        cadence: r.cadence,
        periodKey: r.period_key,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        status: r.status,
        summary: r.summary_json,
        generatedAt: r.generated_at,
      };
    },
  },
};

// Period window helpers for journal reports (workspace timezone aware).
// Boundaries are computed from the local calendar date in `timeZone`; events
// are bucketed by their UTC timestamp against these windows.
function pad2(n) { return String(n).padStart(2, "0"); }

function localDateParts(when, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const parts = dtf.formatToParts(when);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: get("weekday") };
}

function getPeriodWindow(cadence, when, timeZone) {
  const { y, m, d } = localDateParts(when, timeZone);
  const dayStart = new Date(Date.UTC(y, m - 1, d));
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  switch (cadence) {
    case "daily":
      return { periodKey: `${y}-${pad2(m)}-${pad2(d)}`, periodStart: dayStart, periodEnd: nextDay };
    case "weekly": {
      const idx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(localDateParts(when, timeZone).weekday);
      const offset = (idx + 6) % 7; // days since Monday
      const mon = new Date(Date.UTC(y, m - 1, d - offset));
      const monNext = new Date(Date.UTC(y, m - 1, d - offset + 7));
      return { periodKey: `W${mon.toISOString().slice(0, 10)}`, periodStart: mon, periodEnd: monNext };
    }
    case "quarterly": {
      const q = Math.floor((m - 1) / 3) + 1;
      return {
        periodKey: `${y}-Q${q}`,
        periodStart: new Date(Date.UTC(y, (q - 1) * 3, 1)),
        periodEnd: new Date(Date.UTC(y, q * 3, 1)),
      };
    }
    case "half_year": {
      const h = m <= 6 ? 1 : 2;
      return {
        periodKey: `${y}-H${h}`,
        periodStart: new Date(Date.UTC(y, (h - 1) * 6, 1)),
        periodEnd: new Date(Date.UTC(y, h * 6, 1)),
      };
    }
    case "yearly":
      return { periodKey: `${y}`, periodStart: new Date(Date.UTC(y, 0, 1)), periodEnd: new Date(Date.UTC(y + 1, 0, 1)) };
    default:
      throw new Error(`Unknown cadence: ${cadence}`);
  }
}

function buildJournalReportSummary(events) {
  const byClassification = { decision_relevant: 0, operational: 0, unknown: 0 };
  const byStatus = { open: 0, journaled: 0, dismissed: 0, snoozed: 0 };
  const byEventType = {};
  const symbolCounts = {};
  let totalNotional = 0;
  let needsJournaling = 0;
  for (const e of events) {
    if (byClassification[e.classification] != null) byClassification[e.classification] += 1; else byClassification[e.classification] = 1;
    if (byStatus[e.status] != null) byStatus[e.status] += 1; else byStatus[e.status] = 1;
    byEventType[e.eventType] = (byEventType[e.eventType] || 0) + 1;
    if (e.symbol) symbolCounts[e.symbol] = (symbolCounts[e.symbol] || 0) + 1;
    if (e.classification === "decision_relevant" && typeof e.notional === "number") totalNotional += e.notional;
    if (e.status === "open" && e.classification === "decision_relevant") needsJournaling += 1;
  }
  const topSymbols = Object.entries(symbolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([symbol, count]) => ({ symbol, count }));
  return {
    total: events.length,
    byClassification,
    byStatus,
    byEventType,
    totalNotional: Math.round(totalNotional * 100) / 100,
    needsJournaling,
    topSymbols,
    generatedAt: new Date().toISOString(),
  };
}

// Server-side sweep: (re)generate the current period for every cadence across
// all workspaces that have journal events. Idempotent (upsert) + per-workspace
// isolation so one bad workspace can't abort the sweep.
async function generateAllDueReports({ timeZone } = {}) {
  const ws = await pool.query(`SELECT DISTINCT workspace_id FROM journal_events`);
  let generated = 0;
  for (const { workspace_id } of ws.rows) {
    const owner = await pool.query(`SELECT owner_user_id FROM workspaces WHERE id = $1`, [workspace_id]);
    const userId = owner.rows[0]?.owner_user_id;
    if (!userId) continue;
    for (const cadence of ["daily", "weekly", "quarterly", "half_year", "yearly"]) {
      try {
        await userWorkspace.journalReports.generate(userId, { cadence, timeZone }, workspace_id);
        generated += 1;
      } catch (err) {
        console.error("[JournalReports] generate failed", workspace_id, cadence, err && err.message);
      }
    }
  }
  return { generated };
}

function mapDecisionThreadRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: String(row.id),
    outcome: parseJsonPayload(row.outcome, {})
  };
}

function mapDailyBriefingRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: String(row.id),
    sections: parseJsonPayload(row.sections, []),
    metrics: parseJsonPayload(row.metrics, {}),
    briefingDate: toDateString(row.briefingDate),
    generatedAt: toIsoString(row.generatedAt),
    readAt: toIsoString(row.readAt),
    completedAt: toIsoString(row.completedAt)
  };
}

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

  inspectUserDeletion: async (userId) => {
    const resolvedId = toUserId(userId);
    const userResult = await pool.query(`
      SELECT
        id,
        email,
        supabase_user_id AS "supabaseUserId",
        auth_provider AS "authProvider"
      FROM app_users
      WHERE id = $1
      LIMIT 1;
    `, [resolvedId]);
    const user = userResult.rows[0] || null;
    if (!user) return null;

    const ownedWorkspaces = await pool.query(`
      SELECT
        w.id,
        w.name,
        w.slug,
        COUNT(wm.user_id) FILTER (WHERE wm.status = 'active')::int AS "activeMemberCount"
      FROM workspaces w
      LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE w.owner_user_id = $1
      GROUP BY w.id
      ORDER BY w.id ASC;
    `, [resolvedId]);

    return {
      user: {
        id: Number(user.id),
        email: String(user.email || ""),
        supabaseUserId: user.supabaseUserId || null,
        authProvider: user.authProvider || "email"
      },
      ownedWorkspaces: ownedWorkspaces.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name || ""),
        slug: String(row.slug || ""),
        activeMemberCount: Number(row.activeMemberCount || 0)
      }))
    };
  },

  deleteOwnAccount: async (userId) => {
    const resolvedId = toUserId(userId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const userResult = await client.query(`
        SELECT id, email
        FROM app_users
        WHERE id = $1
        LIMIT 1
        FOR UPDATE;
      `, [resolvedId]);
      const user = userResult.rows[0] || null;
      if (!user) {
        await client.query("ROLLBACK");
        return null;
      }

      const ownerBlockers = await client.query(`
        SELECT
          w.id,
          w.name,
          COUNT(wm.user_id) FILTER (WHERE wm.status = 'active')::int AS "activeMemberCount"
        FROM workspaces w
        LEFT JOIN workspace_members wm ON wm.workspace_id = w.id
        WHERE w.owner_user_id = $1
        GROUP BY w.id
        HAVING COUNT(wm.user_id) FILTER (WHERE wm.status = 'active') > 1;
      `, [resolvedId]);

      if (ownerBlockers.rows.length) {
        const error = new Error("Transfer or remove workspace members before deleting your account.");
        error.code = "WORKSPACE_OWNER_HAS_MEMBERS";
        error.workspaces = ownerBlockers.rows.map((row) => ({
          id: Number(row.id),
          name: String(row.name || ""),
          activeMemberCount: Number(row.activeMemberCount || 0)
        }));
        throw error;
      }

      await client.query(`
        UPDATE auth_sessions
        SET revoked_at = NOW()
        WHERE user_id = $1 AND revoked_at IS NULL;
      `, [resolvedId]);

      const deleted = await client.query(`
        DELETE FROM app_users
        WHERE id = $1
        RETURNING id, email;
      `, [resolvedId]);

      await client.query("COMMIT");
      return deleted.rows[0] || user;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
      logs: logs.slice(0, 5),
      tables: tables.rows.map((row) => ({ name: row.name, rows: Number(row.rows || 0) }))
    };
  }
};

const perpsBench = {
  insertSample: async ({ venueId, scenario = "post_only", runId, confirmMs, cancelMs, networkFloorMs, error, mode = "dry_run" }) => {
    const result = await pool.query(`
      INSERT INTO perps_latency_samples (venue_id, scenario, run_id, confirm_ms, cancel_ms, network_floor_ms, error, mode)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `, [
      String(venueId || "").trim().toLowerCase(),
      String(scenario || "post_only").trim().toLowerCase(),
      String(runId || `zenin-probe-${Date.now()}`).trim(),
      Number.isFinite(Number(confirmMs)) ? Number(confirmMs) : null,
      Number.isFinite(Number(cancelMs)) ? Number(cancelMs) : null,
      Number.isFinite(Number(networkFloorMs)) ? Number(networkFloorMs) : null,
      error ? String(error).slice(0, 500) : null,
      String(mode || "dry_run").trim().toLowerCase()
    ]);
    return result.rows[0];
  },

  getRecentSamples: async (venueId = null, scenario = "post_only", windowHours = 24, limit = 2000) => {
    const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 2000));
    const safeWindow = Math.max(1, Math.min(720, Number(windowHours) || 24));
    if (venueId) {
      const result = await pool.query(`
        SELECT * FROM perps_latency_samples
        WHERE venue_id = $1 AND scenario = $2 AND submitted_at >= NOW() - ($3 || ' hours')::INTERVAL
        ORDER BY submitted_at DESC
        LIMIT $4;
      `, [String(venueId).toLowerCase(), scenario, String(safeWindow), safeLimit]);
      return result.rows;
    }
    const result = await pool.query(`
      SELECT * FROM perps_latency_samples
      WHERE scenario = $1 AND submitted_at >= NOW() - ($2 || ' hours')::INTERVAL
      ORDER BY submitted_at DESC
      LIMIT $3;
    `, [scenario, String(safeWindow), safeLimit]);
    return result.rows;
  },

  getVenueStats: async (scenario = "post_only", windowHours = 24) => {
    const safeWindow = Math.max(1, Math.min(720, Number(windowHours) || 24));
    const result = await pool.query(`
      SELECT
        venue_id,
        COUNT(*) AS sample_count,
        COUNT(*) FILTER (WHERE error IS NULL) AS ok_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY confirm_ms) AS p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY confirm_ms) AS p95,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY confirm_ms) AS p99,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cancel_ms) AS cancel_p50,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cancel_ms) AS cancel_p95,
        AVG(network_floor_ms) AS avg_network_floor,
        MAX(submitted_at) AS last_sample_at,
        MAX(error) FILTER (WHERE error IS NOT NULL) AS last_error
      FROM perps_latency_samples
      WHERE scenario = $1 AND submitted_at >= NOW() - ($2 || ' hours')::INTERVAL
      GROUP BY venue_id
      ORDER BY p95 ASC NULLS LAST;
    `, [scenario, String(safeWindow)]);
    return result.rows.map((row) => ({
      ...row,
      sample_count: Number(row.sample_count || 0),
      ok_count: Number(row.ok_count || 0),
      p50: row.p50 != null ? Number(row.p50) : null,
      p95: row.p95 != null ? Number(row.p95) : null,
      p99: row.p99 != null ? Number(row.p99) : null,
      cancel_p50: row.cancel_p50 != null ? Number(row.cancel_p50) : null,
      cancel_p95: row.cancel_p95 != null ? Number(row.cancel_p95) : null,
      avg_network_floor: row.avg_network_floor != null ? Number(row.avg_network_floor) : null,
      last_sample_at: toIsoString(row.last_sample_at)
    }));
  },

  getRunnerState: async (venueId = null) => {
    if (venueId) {
      const result = await pool.query(`SELECT * FROM perps_runner_state WHERE venue_id = $1`, [String(venueId).toLowerCase()]);
      return result.rows[0] || null;
    }
    const result = await pool.query(`SELECT * FROM perps_runner_state ORDER BY venue_id`);
    return result.rows;
  },

  upsertRunnerState: async (venueId, { isEnabled, isRunning, ordersToday, dailyOrderBudget, lastError } = {}) => {
    const result = await pool.query(`
      INSERT INTO perps_runner_state (venue_id, is_enabled, is_running, orders_today, daily_order_budget, last_error, last_reset_date, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, NOW())
      ON CONFLICT (venue_id) DO UPDATE SET
        is_enabled = COALESCE($2, perps_runner_state.is_enabled),
        is_running = COALESCE($3, perps_runner_state.is_running),
        daily_order_budget = COALESCE($5, perps_runner_state.daily_order_budget),
        last_error = COALESCE($6, perps_runner_state.last_error),
        last_reset_date = CASE WHEN perps_runner_state.last_reset_date < CURRENT_DATE THEN CURRENT_DATE ELSE perps_runner_state.last_reset_date END,
        orders_today = CASE
          WHEN perps_runner_state.last_reset_date < CURRENT_DATE THEN COALESCE($4, 0)
          ELSE COALESCE($4, perps_runner_state.orders_today)
        END,
        updated_at = NOW()
      RETURNING *;
    `, [
      String(venueId).toLowerCase(),
      isEnabled != null ? Boolean(isEnabled) : null,
      isRunning != null ? Boolean(isRunning) : null,
      Number.isFinite(ordersToday) ? Number(ordersToday) : null,
      Number.isFinite(dailyOrderBudget) ? Number(dailyOrderBudget) : null,
      lastError != null ? String(lastError).slice(0, 500) : null
    ]);
    return result.rows[0];
  },

  incrementOrderCount: async (venueId) => {
    const result = await pool.query(`
      UPDATE perps_runner_state
      SET orders_today = CASE WHEN last_reset_date < CURRENT_DATE THEN 1 ELSE orders_today + 1 END,
          last_reset_date = CASE WHEN last_reset_date < CURRENT_DATE THEN CURRENT_DATE ELSE last_reset_date END,
          last_sample_at = NOW(),
          updated_at = NOW()
      WHERE venue_id = $1
      RETURNING *;
    `, [String(venueId).toLowerCase()]);
    return result.rows[0];
  }
};

// ── Brokerage domain repository ─────────────────────────────────────────────
// Provider-independent persistence. Methods follow the same namespace-with-methods
// pattern as userWorkspace / portfolio / etc.

const brokerage = {
  // ── Connections ──────────────────────────────────────────────────────────

  connections: {
    /**
     * List brokerage connections for a workspace.
     * @param {number} workspaceId
     * @returns {Promise<Object[]>}
     */
    list: async (workspaceId) => {
      const result = await pool.query(`
        SELECT
          id, user_id AS "userId", workspace_id AS "workspaceId",
          provider, provider_user_ref AS "providerUserRef", status,
          capabilities, last_synced_at AS "lastSyncedAt",
          last_sync_meta AS "lastSyncMeta", provider_meta AS "providerMeta",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM brokerage_connections
        WHERE workspace_id = $1
        ORDER BY created_at DESC;
      `, [Number(workspaceId)]);
      return result.rows;
    },

    /**
     * Find a connection by Zenin id + workspace scope.
     * @param {number} id
     * @param {number} workspaceId
     * @returns {Promise<Object|null>}
     */
    getById: async (id, workspaceId) => {
      const result = await pool.query(`
        SELECT
          id, user_id AS "userId", workspace_id AS "workspaceId",
          provider, provider_user_ref AS "providerUserRef", status,
          capabilities, last_synced_at AS "lastSyncedAt",
          last_sync_meta AS "lastSyncMeta", provider_meta AS "providerMeta",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM brokerage_connections
        WHERE id = $1 AND workspace_id = $2;
      `, [Number(id), Number(workspaceId)]);
      return result.rows[0] || null;
    },

    /**
     * Upsert a connection (idempotent on userId+provider+providerUserRef).
     * @param {Object} payload
     * @param {number} payload.userId
     * @param {number} payload.workspaceId
     * @param {string} payload.provider
     * @param {string} payload.providerUserRef
     * @param {string} [payload.status]
     * @param {Object} [payload.capabilities]
     * @returns {Promise<Object>}
     */
    upsert: async (payload) => {
      const result = await pool.query(`
        INSERT INTO brokerage_connections
          (user_id, workspace_id, provider, provider_user_ref, status, capabilities, provider_meta)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
        ON CONFLICT (user_id, workspace_id, provider, provider_user_ref)
        DO UPDATE SET
          status = EXCLUDED.status,
          capabilities = EXCLUDED.capabilities,
          provider_meta = EXCLUDED.provider_meta,
          updated_at = NOW()
        RETURNING
          id, user_id AS "userId", workspace_id AS "workspaceId",
          provider, provider_user_ref AS "providerUserRef", status,
          capabilities, last_synced_at AS "lastSyncedAt",
          last_sync_meta AS "lastSyncMeta", provider_meta AS "providerMeta",
          created_at AS "createdAt", updated_at AS "updatedAt";
      `, [
        Number(payload.userId), Number(payload.workspaceId),
        String(payload.provider).trim().toLowerCase(),
        String(payload.providerUserRef).trim(),
        String(payload.status || "pending").trim().toLowerCase(),
        JSON.stringify(payload.capabilities || {}),
        JSON.stringify(payload.providerMeta || {})
      ]);
      return result.rows[0];
    },

    /**
     * Update a connection's sync metadata.
     */
    updateSync: async (id, { status, syncedAt, meta = {} } = {}) => {
      const sets = [];
      const values = [Number(id)];
      let idx = 1;
      const push = (col, val) => { if (val !== undefined) { idx++; sets.push(`${col} = $${idx}`); values.push(val); } };
      if (status != null) push("status", String(status).trim().toLowerCase());
      if (syncedAt != null) push("last_synced_at", syncedAt);
      if (meta && Object.keys(meta).length) push("last_sync_meta", JSON.stringify(meta));
      if (!sets.length) return null;
      sets.push("updated_at = NOW()");
      const result = await pool.query(`
        UPDATE brokerage_connections SET ${sets.join(", ")}
        WHERE id = $1
        RETURNING
          id, provider, provider_user_ref AS "providerUserRef", status,
          last_synced_at AS "lastSyncedAt", last_sync_meta AS "lastSyncMeta",
          provider_meta AS "providerMeta";
      `, values);
      return result.rows[0] || null;
    },

    remove: async (id) => {
      await pool.query("DELETE FROM brokerage_connections WHERE id = $1", [Number(id)]);
    },

    /**
     * Lists connections that should be refreshed by the background sync worker.
     * @param {string} staleBeforeIso  ISO timestamp — connections synced before this are due.
     * @param {number} [limit=10]
     */
    listDueForSync: async (staleBeforeIso, limit = 10) => {
      const result = await pool.query(`
        SELECT
          id, user_id AS "userId", workspace_id AS "workspaceId",
          provider, provider_user_ref AS "providerUserRef", status,
          capabilities, last_synced_at AS "lastSyncedAt",
          last_sync_meta AS "lastSyncMeta", provider_meta AS "providerMeta"
        FROM brokerage_connections
        WHERE status IN ('connected', 'pending')
          AND (last_synced_at IS NULL OR last_synced_at < $1::timestamptz)
        ORDER BY last_synced_at NULLS FIRST, updated_at ASC
        LIMIT $2;
      `, [staleBeforeIso, Math.min(Math.max(Number(limit) || 10, 1), 50)]);
      return result.rows;
    }
  },

  // ── Accounts ─────────────────────────────────────────────────────────────

  accounts: {
    list: async (connectionId) => {
      const result = await pool.query(`
        SELECT * FROM brokerage_accounts WHERE connection_id = $1 ORDER BY created_at DESC;
      `, [Number(connectionId)]);
      return result.rows;
    },

    upsert: async (payload) => {
      const result = await pool.query(`
        INSERT INTO brokerage_accounts
          (connection_id, provider_account_id, institution_name, account_type, masked_number, name, is_meta_only, provider_meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (connection_id, provider_account_id)
        DO UPDATE SET
          institution_name = EXCLUDED.institution_name,
          account_type = EXCLUDED.account_type,
          masked_number = EXCLUDED.masked_number,
          name = EXCLUDED.name,
          is_meta_only = EXCLUDED.is_meta_only,
          provider_meta = EXCLUDED.provider_meta,
          last_synced_at = NOW(),
          updated_at = NOW()
        RETURNING *;
      `, [
        Number(payload.connectionId),
        String(payload.providerAccountId),
        String(payload.institutionName || ""),
        String(payload.accountType || "other"),
        payload.maskedNumber || null,
        String(payload.name || ""),
        Boolean(payload.isMetaOnly),
        JSON.stringify(payload.providerMeta || {})
      ]);
      return result.rows[0];
    },

    removeByConnection: async (connectionId) => {
      await pool.query("DELETE FROM brokerage_accounts WHERE connection_id = $1", [Number(connectionId)]);
    }
  },

  // ── Holdings ─────────────────────────────────────────────────────────────

  holdings: {
    list: async (accountId) => {
      const result = await pool.query(`
        SELECT * FROM brokerage_holdings WHERE account_id = $1 ORDER BY symbol;
      `, [Number(accountId)]);
      return result.rows;
    },

    sync: async (accountId, holdings) => {
      if (!Array.isArray(holdings) || !holdings.length) return { upserted: 0 };
      let upserted = 0;
      for (const h of holdings) {
        await pool.query(`
          INSERT INTO brokerage_holdings
            (account_id, symbol, name, asset_type, quantity, average_entry_price,
             current_price, market_value, currency, opened_at, provider_meta, as_of)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
          ON CONFLICT (account_id, symbol, asset_type, currency)
          DO UPDATE SET
            quantity = EXCLUDED.quantity,
            average_entry_price = EXCLUDED.average_entry_price,
            current_price = EXCLUDED.current_price,
            market_value = EXCLUDED.market_value,
            opened_at = COALESCE(EXCLUDED.opened_at, brokerage_holdings.opened_at),
            provider_meta = EXCLUDED.provider_meta,
            as_of = EXCLUDED.as_of,
            updated_at = NOW();
        `, [
          Number(accountId),
          String(h.symbol || ""),
          h.name || null,
          String(h.assetType || "equity"),
          Number(h.quantity || 0),
          h.averageEntryPrice != null ? Number(h.averageEntryPrice) : null,
          h.currentPrice != null ? Number(h.currentPrice) : null,
          h.marketValue != null ? Number(h.marketValue) : null,
          String(h.currency || "USD"),
          h.openedAt || null,
          JSON.stringify(h.providerMeta || {})
        ]);
        upserted++;
      }
      return { upserted };
    },

    removeAll: async (accountId) => {
      await pool.query("DELETE FROM brokerage_holdings WHERE account_id = $1", [Number(accountId)]);
    }
  },

  // ── Transactions (deduped on provider_tx_id) ───────────────────────────

  transactions: {
    list: async (accountId, { limit = 100, offset = 0 } = {}) => {
      const result = await pool.query(`
        SELECT * FROM brokerage_transactions
        WHERE account_id = $1
        ORDER BY executed_at DESC
        LIMIT $2 OFFSET $3;
      `, [Number(accountId), Math.min(Number(limit), 1000), Number(offset)]);
      return result.rows;
    },

    /**
     * Insert transactions, deduplicating on (account_id, provider_tx_id).
     * Returns counts of new vs skipped.
     */
    sync: async (accountId, transactions) => {
      if (!Array.isArray(transactions) || !transactions.length) return { inserted: 0, skipped: 0 };
      let inserted = 0;
      let skipped = 0;
      for (const tx of transactions) {
        const txId = String(tx.id || "");
        if (!txId) { skipped++; continue; }
        try {
          await pool.query(`
            INSERT INTO brokerage_transactions
              (account_id, provider_tx_id, type, side, symbol, quantity,
               unit_price, notional, fee, currency, description, executed_at, provider_meta)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
            ON CONFLICT (account_id, provider_tx_id) DO NOTHING;
          `, [
            Number(accountId), txId,
            String(tx.type || "other"),
            tx.side || null,
            tx.symbol || null,
            tx.quantity != null ? Number(tx.quantity) : null,
            tx.unitPrice != null ? Number(tx.unitPrice) : null,
            tx.notional != null ? Number(tx.notional) : null,
            tx.fee != null ? Number(tx.fee) : null,
            String(tx.currency || "USD"),
            tx.description || null,
            tx.executedAt || new Date().toISOString(),
            JSON.stringify(tx.providerMeta || {})
          ]);
          inserted++;
        } catch {
          skipped++;
        }
      }
      return { inserted, skipped };
    }
  },

  // ── Provider metadata (freeform key-value per provider) ─────────────────

  metadata: {
    get: async (provider, key) => {
      const result = await pool.query(
        "SELECT value FROM brokerage_provider_metadata WHERE provider = $1 AND key = $2;",
        [String(provider).trim().toLowerCase(), String(key).trim()]
      );
      return result.rows[0]?.value || null;
    },

    set: async (provider, key, value) => {
      await pool.query(`
        INSERT INTO brokerage_provider_metadata (provider, key, value)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (provider, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
      `, [String(provider).trim().toLowerCase(), String(key).trim(), JSON.stringify(value)]);
    }
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
  workspaces,
  userWorkspace,
  serviceSnapshots,
  tradeExecutions,
  trading,
  admin,
  analytics,
  perpsBench,
  brokerage,
  portfolioSnapshots,
  clearAllData,
  closeDatabase,
  describeDatabaseConfig,
  generateAllDueReports
};
