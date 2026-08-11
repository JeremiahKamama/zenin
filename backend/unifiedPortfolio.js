// backend/unifiedPortfolio.js
// Unified Multi-Source Portfolio — canonical, source-aware read model.
//
// ADDITIVE + ZERO-REGRESSION:
//   * Canonical source layer = evolved from Phase-A tables (portfolio_sources +
//     accounts/positions/cash/transactions/sync_runs), guarded by CREATE/ALTER.
//   * getUnifiedSummary() reads the EXISTING source tables (brokerage_*,
//     user_workspace_portfolio, user_workspace_cash) so it returns real workspace
//     values today. NOTE: manual holdings live in user_workspace_portfolio /
//     user_workspace_cash (NOT the legacy portfolio_holdings scratch table).
//   * Dual-write into the canonical layer only when ZENIN_UNIFIED_PORTFOLIO=true.
//     Adapters (map*ToSource) are pure + unit-tested; invoked from real sync paths.
//
// FX policy: USD and USDC are treated 1:1 (workspace base currency). Positions
// with no usable price, or in a currency we cannot value (no FX row yet), are
// EXCLUDED from the headline total and surfaced as unvalued coverage gaps —
// never silently mixed. Persisted FX-rate fetching is Tier 2.

function isEnabled() {
  return String(process.env.ZENIN_UNIFIED_PORTFOLIO || "").toLowerCase() === "true";
}

// FX-equivalent currencies (treated 1:1 with the USD base) come from the shared
// stablecoin registry. Importantly this includes USDT — previously this set was
// {USD, USDC} only, so a USDT cash row was flagged `missing_fx` and silently
// dropped from the headline. Now USDT/USDC/BUSD/DAI/... all convert 1:1.
const { USD_EQUIVALENTS } = require("./stablecoins");

// Yahoo Finance benchmark feed (token-free) for SPY / crypto benchmarks.
const { loadYahooSeries } = require("./portfolioSnapshots");

// ---------------------------------------------------------------------------
// Transaction type classification (source-of-truth)
// ---------------------------------------------------------------------------
// `type` is the transaction / event type. `side` is the buy/sell direction.
// Exchange fills are executions: their `type` should be "trade" or "fill",
// NEVER "buy"/"sell" (which is the side). The legacy negative-list
// classification (`!["trade","fill","other"].includes(type)`) treated
// buy/sell sides as cash flows — a financial-integrity bug that polluted
// portfolio_cash_flows and could corrupt TWR/MWR/performance.
//
// EXECUTION_TYPES — rows that are trade/fill executions, NOT cash flows.
// CASH_FLOW_TYPES — rows that are genuine external capital events.
// ---------------------------------------------------------------------------
const EXECUTION_TYPES = new Set(["trade", "fill", "buy", "sell", "crypto"]);
const CASH_FLOW_TYPES = new Set([
  "deposit", "deposit_cash", "transfer_in", "withdrawal", "withdrawal_cash",
  "transfer_out", "transfer", "dividend", "interest", "fee", "tax",
  "corporate_action", "split", "adjustment"
]);

// Normalize a raw type/side into a canonical execution vs cash-flow decision.
// Returns null for execution types (they are NOT cash flows) and the canonical
// flow type string for genuine cash-flow events.
function classifyCashFlow(rawType) {
  const txType = String(rawType || "trade").toLowerCase().trim();
  // Execution / fill / position events are never cash flows.
  if (EXECUTION_TYPES.has(txType)) return null;
  if (CASH_FLOW_TYPES.has(txType)) {
    if (["deposit", "deposit_cash", "transfer_in"].includes(txType)) return "deposit";
    if (["withdrawal", "withdrawal_cash", "transfer_out", "transfer"].includes(txType)) return "withdrawal";
    if (txType === "dividend") return "dividend";
    if (txType === "interest") return "interest";
    if (["fee", "tax"].includes(txType)) return "fee";
    if (txType === "corporate_action" || txType === "split" || txType === "adjustment") return "corporate_action";
    return txType;
  }
  // Unknown types: do NOT fabricate cash flows. Surface as "other" cash only
  // when there is a positive notional/amount (a real monetary movement).
  return null;
}

// Normalize a transaction type so executions carry "trade"/"fill" and side stays
// in `side`. This collapses legacy conflation where exchange fills stored
// type=buy/sell (the side) into a proper event type.
function normalizeTxType(rawType) {
  const t = String(rawType || "").toLowerCase().trim();
  if (EXECUTION_TYPES.has(t)) return "trade";
  if (CASH_FLOW_TYPES.has(t)) return t;
  return t || "other";
}

// Whether a canonical transaction row is a renderable execution (trade/fill)
// suitable for the Home Execution Log, vs a cash/event/position row.
function isExecutableTx(tx) {
  if (!tx) return false;
  const t = String(tx.type || "trade").toLowerCase().trim();
  return EXECUTION_TYPES.has(t);
}

// Normalise a raw source transaction into the canonical display shape used by
// the Home Execution Log. Collapses the legacy {asset, price} schema and the
// unified {symbol, unitPrice, executedAt, providerTxId} schema into one
// predictable shape.
function normalizeTransaction(t) {
  const ts = new Date(t?.executedAt ?? t?.date ?? t?.executed_at ?? 0).getTime();
  const symbol = String(t?.symbol || t?.asset || "").trim().toUpperCase();
  const unitPrice = t?.unitPrice != null ? Number(t.unitPrice)
    : (t?.price != null ? Number(t.price) : null);
  const quantity = t?.quantity != null ? Number(t.quantity) : null;
  const notionalSrc = t?.notional != null ? Number(t.notional) : null;
  const notional = Number.isFinite(notionalSrc) && notionalSrc > 0
    ? notionalSrc
    : (Number.isFinite(unitPrice) && Number.isFinite(quantity) && unitPrice > 0 && quantity > 0
      ? unitPrice * quantity
      : null);
  const validTs = Number.isFinite(ts) && ts > 0;
  const validSymbol = symbol.length > 0;
  const validValue = Number.isFinite(notional) && notional > 0;
  // Executions need a timestamp, an instrument, and a positive value.
  const valid = validTs && validSymbol && validValue && isExecutableTx(t);
  return {
    id: t?.id || t?.txnId || t?.providerTxId || (symbol && validTs ? `${symbol}-${ts}` : null),
    symbol,
    name: String(t?.name || t?.asset || symbol || ""),
    type: normalizeTxType(t?.type || "trade"),
    side: String(t?.side || "").toLowerCase() === "sell" ? "sell" : "buy",
    orderType: String(t?.orderType || t?.order_type || "MKT").trim().toUpperCase(),
    quantity: quantity,
    unitPrice: unitPrice,
    notional: notional,
    timestamp: validTs ? ts : null,
    status: t?.status || (valid ? "Filled" : null),
    source: t?.provider || t?.source || t?.providerName || null,
    account: t?.sourceAccountId || t?.sourceAccount || null,
    providerTxId: t?.providerTxId || null,
    raw: t,
    valid
  };
}

// ---------------------------------------------------------------------------
// Schema (create + migrate existing Phase-A tables)
// ---------------------------------------------------------------------------

async function ensureUnifiedPortfolioSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_sources (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_connection_id TEXT,
      label TEXT NOT NULL DEFAULT '',
      native_currency TEXT NOT NULL DEFAULT 'USD',
      capabilities JSONB,
      access_mode TEXT,
      connection_status TEXT,
      sync_status TEXT,
      metadata JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      last_sync_at TIMESTAMPTZ,
      last_attempted_sync_at TIMESTAMPTZ,
      data_as_of TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_source_accounts (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES portfolio_sources(id) ON DELETE CASCADE,
      external_account_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      native_currency TEXT NOT NULL DEFAULT 'USD',
      account_type TEXT NOT NULL DEFAULT 'other',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_source_positions (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES portfolio_sources(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES portfolio_source_accounts(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      instrument_key TEXT,
      name TEXT,
      asset_type TEXT NOT NULL DEFAULT 'other',
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      average_entry_price DOUBLE PRECISION,
      cost_basis DOUBLE PRECISION,
      current_price DOUBLE PRECISION,
      market_value DOUBLE PRECISION,
      native_currency TEXT NOT NULL DEFAULT 'USD',
      converted_value DOUBLE PRECISION,
      base_currency TEXT NOT NULL DEFAULT 'USD',
      as_of TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      position_metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );\n  `);
  // Add position_metadata (idempotent; table may predate this column).
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS position_metadata JSONB;`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_source_cash (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES portfolio_sources(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES portfolio_source_accounts(id) ON DELETE CASCADE,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      converted_amount DOUBLE PRECISION,
      base_currency TEXT NOT NULL DEFAULT 'USD',
      as_of TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_source_transactions (
      id SERIAL PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES portfolio_sources(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES portfolio_source_accounts(id) ON DELETE CASCADE,
      provider_tx_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other',
      side TEXT,
      symbol TEXT,
      quantity DOUBLE PRECISION,
      unit_price DOUBLE PRECISION,
      notional DOUBLE PRECISION,
      fee DOUBLE PRECISION,
      currency TEXT NOT NULL DEFAULT 'USD',
      executed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_id, provider_tx_id)
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_sync_runs (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      per_source JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);

  // FX-rate persistence (Tier 2): one rate per (base, quote). Rates are fetched
  // from a provider or set manually; never fabricated. Non-USD positions with no
  // stored rate stay surfaced as an unvalued coverage gap (honest, no silent mix).
  await db.query(`
    CREATE TABLE IF NOT EXISTS portfolio_fx_rates (
      id SERIAL PRIMARY KEY,
      base TEXT NOT NULL,
      quote TEXT NOT NULL,
      rate DOUBLE PRECISION NOT NULL,
      rate_source TEXT NOT NULL DEFAULT 'unknown',
      as_of TIMESTAMPTZ,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(base, quote)
    );
`);
  // Cash-flow ledger: external capital movements (deposits, withdrawals,
  // transfers, dividends, interest, fees) that are NOT investment PNL.
  // Required so that TWR/MWR and the performance curve can distinguish
  // portfolio returns from external capital flows. Idempotent per
  // (workspace_id, source_id, provider_tx_id).
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio_cash_flows (
      id SERIAL PRIMARY KEY,
      workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
      source_id INTEGER REFERENCES portfolio_sources(id) ON DELETE CASCADE,
      source_account_id INTEGER REFERENCES portfolio_source_accounts(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount DOUBLE PRECISION NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      base_amount DOUBLE PRECISION,
      base_currency TEXT NOT NULL DEFAULT 'USD',
      executed_at TIMESTAMPTZ NOT NULL,
      external_id TEXT,
      description TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source_id, external_id)
    );`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_portfolio_cash_flows_workspace ON portfolio_cash_flows (workspace_id, executed_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_portfolio_cash_flows_source ON portfolio_cash_flows (source_id, executed_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_portfolio_cash_flows_txid ON portfolio_cash_flows (source_id, external_id);`);

  // Stable source identity + enrichment columns (migrate Phase-A tables).
  // MUST run before the unique index that references external_connection_id.
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS external_connection_id TEXT;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS capabilities JSONB;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS access_mode TEXT;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS connection_status TEXT;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS sync_status TEXT;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS metadata JSONB;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS last_attempted_sync_at TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS last_error TEXT;`);
  await db.query(`ALTER TABLE portfolio_sources ADD COLUMN IF NOT EXISTS data_as_of TIMESTAMPTZ;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS instrument_key TEXT;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS cost_basis DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS instrument_type TEXT NOT NULL DEFAULT 'spot';`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS position_type TEXT NOT NULL DEFAULT 'balance';`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS side TEXT;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS notional_value DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS collateral_value DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS leverage DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS liquidation_price DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS unrealized_pnl DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE portfolio_source_transactions ADD COLUMN IF NOT EXISTS name TEXT;`);
  await db.query(`ALTER TABLE portfolio_source_transactions ADD COLUMN IF NOT EXISTS realized_pnl DOUBLE PRECISION;`);

  // CRITICAL IDENTITY FIX (spec Invariant 3/4): the original unique key
  // (source_id, COALESCE(account_id,0), symbol) collided BTC spot vs BTC perp
  // vs long vs short into ONE row. Rebuild the key to include the canonical
  // semantic dimensions (instrument_type, position_type, side) so distinct
  // financial positions never merge merely because they share a symbol.
  // Drop the old too-narrow index first, then create the correct one.
  await db.query(`DROP INDEX IF EXISTS uq_source_position;`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_source_position
      ON portfolio_source_positions
        (source_id, COALESCE(account_id, 0), symbol,
         COALESCE(instrument_type, 'spot'), COALESCE(position_type, 'balance'), COALESCE(side, 'balance'));
  `);
  await db.query(`ALTER TABLE portfolio_source_accounts ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'other';`);

  // Workspace base currency (default USD; editable by owner/moderator only).
  await db.query(`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'USD';`);

  // first_synced_at tracks when a source was first successfully synced. Used as
  // the journal cutoff to avoid reminding about pre-connection trades.
  await db.query(`ALTER TABLE user_exchange_keys ADD COLUMN IF NOT EXISTS first_synced_at TIMESTAMPTZ;`);

  // Unified snapshot metadata on the immutable EOD history table.
  await db.query(`ALTER TABLE portfolio_daily_snapshots ADD COLUMN IF NOT EXISTS is_unified BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE portfolio_daily_snapshots ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'USD';`);
  await db.query(`ALTER TABLE portfolio_daily_snapshots ADD COLUMN IF NOT EXISTS source_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;`);

  // Idempotent upsert keys: no duplicate position/cash rows per source+account.
  await db.query(`DELETE FROM portfolio_source_positions WHERE source_id NOT IN (SELECT id FROM portfolio_sources);`);
  await db.query(`DELETE FROM portfolio_source_cash WHERE source_id NOT IN (SELECT id FROM portfolio_sources);`);
  await db.query(`
    DELETE FROM portfolio_sources
    WHERE id NOT IN (
      SELECT MIN(id) FROM portfolio_sources GROUP BY workspace_id, source_type, provider, COALESCE(external_connection_id, '')
    );
  `);
  // NOTE: the unique position key is the WIDE key created above (173-178,
  // source_id+account+symbol+instrument_type+position_type+side). A second,
  // narrow CREATE UNIQUE INDEX on (source_id, account, symbol) previously
  // lived here but was dead code (same index name -> IF NOT EXISTS no-op once
  // the wide key exists). Removed to avoid signalling an unresolved schema.
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_source_cash
      ON portfolio_source_cash (source_id, currency);
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_sources_identity
      ON portfolio_sources (workspace_id, provider, source_type, COALESCE(external_connection_id, ''));
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_portfolio_sources_workspace
      ON portfolio_sources (workspace_id);
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_source_positions_source
      ON portfolio_source_positions (source_id);
  `);
}

// ---------------------------------------------------------------------------
// Dual-write adapters (pure, unit-tested) — invoked by real sync paths
// ---------------------------------------------------------------------------

function normalizeInstrumentKey(symbol) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

// Hyperliquid / exchange-wallet sync output (from exchangeSync.syncHyperliquid /
// syncBinance / syncBybit): { holdings:[...], cashBalance, currency:"USDC" }.
// Binance/Bybit share this shape; pass `provider` to tag the source correctly.
function normalizeSourceContract(source = {}) {
  const sourceType = String(source.sourceType || "manual").trim().toLowerCase();
  const provider = String(source.provider || sourceType || "manual").trim().toLowerCase();
  const syncStatus = String(source.syncStatus || source.status || "synced").trim().toLowerCase();
  const connectionStatus = String(source.connectionStatus || (syncStatus === "synced" || syncStatus === "partial" ? "connected" : syncStatus === "error" ? "error" : "pending")).trim().toLowerCase();
  const defaultAccessMode =
    sourceType === "brokerage" ? "oauth_read" :
    sourceType === "wallet" || sourceType === "exchange" ? "watch_only" :
    sourceType === "prediction" ? "wallet_public" :
    sourceType === "manual" ? "manual" :
    "read_only";
  return {
    ...source,
    sourceType,
    provider,
    externalConnectionId: source.externalConnectionId ?? source.connectionId ?? null,
    label: source.label || provider,
    nativeCurrency: String(source.nativeCurrency || "USD").toUpperCase(),
    accessMode: String(source.accessMode || defaultAccessMode).trim().toLowerCase(),
    connectionStatus,
    syncStatus,
    capabilities: source.capabilities || {},
    metadata: source.metadata || {},
    accounts: Array.isArray(source.accounts) ? source.accounts : [],
    positions: Array.isArray(source.positions) ? source.positions : [],
    cash: Array.isArray(source.cash) ? source.cash : [],
    transactions: Array.isArray(source.transactions) ? source.transactions : []
  };
}

function deriveExchangeSemantics(h) {
  const marketType = String(h.market_type || "").trim().toLowerCase();
  const rawType = String(h.type || "crypto").toLowerCase();
  const isCrypto = rawType === "crypto";
  const unrealizedPnl = h.unrealizedPnl != null ? Number(h.unrealizedPnl)
    : h.unrealized_pnl != null ? Number(h.unrealized_pnl) : null;

  // Spot crypto balance
  if (marketType === "spot" || (!marketType && isCrypto)) {
    const qty = Number(h.quantity || 0);
    return {
      assetType: "crypto",
      instrumentType: "spot",
      positionType: "balance",
      side: "balance",
      quantity: qty,
      notionalValue: null,
      collateralValue: null,
      leverage: null,
      liquidationPrice: null,
      unrealizedPnl: null
    };
  }

  // Perpetual / future derivative
  if (marketType === "perp" || marketType === "future" || marketType === "futures") {
    const instrumentType = marketType === "future" || marketType === "futures" ? "future" : "perpetual";
    const positionType = "derivative";
    const qtySigned = Number(h.quantity || 0);
    const side = qtySigned > 0 ? "long" : qtySigned < 0 ? "short" : "unknown";
    const qty = Math.abs(qtySigned);
    const price = Number(h.price || h.current_price || 0);
    const notional = qty && price ? qty * price : null;
    return {
      assetType: "crypto",
      instrumentType,
      positionType,
      side,
      quantity: qty,
      notionalValue: notional,
      collateralValue: h.collateral != null ? Number(h.collateral) : h.collateral_value != null ? Number(h.collateral_value) : null,
      leverage: h.leverage != null ? Number(h.leverage) : null,
      liquidationPrice: h.liquidation_price != null ? Number(h.liquidation_price) : null,
      unrealizedPnl
    };
  }

  // Margin / borrowed / collateral — only if explicitly tagged by provider
  if (marketType === "collateral") {
    return {
      assetType: "crypto",
      instrumentType: "spot",
      positionType: "collateral",
      side: "balance",
      quantity: Number(h.quantity || 0),
      notionalValue: null,
      collateralValue: Number(h.collateral_value || h.quantity || 0),
      leverage: null,
      liquidationPrice: null,
      unrealizedPnl: null
    };
  }

  if (marketType === "liability" || marketType === "borrowed") {
    return {
      assetType: "crypto",
      instrumentType: "spot",
      positionType: "liability",
      side: "short",
      quantity: Number(h.quantity || 0),
      notionalValue: null,
      collateralValue: null,
      leverage: null,
      liquidationPrice: null,
      unrealizedPnl: null
    };
  }

  // Default: treat as spot balance
  return {
    assetType: isCrypto ? "crypto" : "other",
    instrumentType: "spot",
    positionType: "balance",
    side: "balance",
    quantity: Number(h.quantity || 0),
    notionalValue: null,
    collateralValue: null,
    leverage: null,
    liquidationPrice: null,
    unrealizedPnl: null
  };
}

function mapExchangeWalletToSource(output, { workspaceId, address, connectionId, provider = "hyperliquid", accessMode, sourceType } = {}) {
  const normalizedProvider = String(provider || "hyperliquid").trim().toLowerCase();
  const normalizedSourceType = sourceType || (normalizedProvider === "hyperliquid" ? "wallet" : "exchange");
  const normalizedAccessMode = accessMode || (normalizedProvider === "hyperliquid" ? "watch_only" : "read_only_key");
  const positions = (output?.holdings || []).map((h) => {
    const symbol = String(h.symbol || "").toUpperCase();
    const price = Number(h.price || 0);
    const sem = deriveExchangeSemantics(h);
    const qty = sem.quantity;
    const marketValue = qty * price || null;
    return {
      symbol,
      instrumentKey: normalizeInstrumentKey(symbol),
      name: String(h.name || h.symbol || ""),
      assetType: sem.assetType,
      instrumentType: sem.instrumentType,
      positionType: sem.positionType,
      side: sem.side,
      quantity: qty,
      averageEntryPrice: h.entry_price != null ? Number(h.entry_price) : null,
      costBasis: h.entry_price != null ? Number(h.entry_price) * qty : null,
      currentPrice: h.current_price != null ? Number(h.current_price) : price,
      marketValue,
      notionalValue: sem.notionalValue != null ? sem.notionalValue : (sem.positionType === "derivative" ? marketValue : null),
      collateralValue: sem.collateralValue,
      leverage: sem.leverage,
      liquidationPrice: sem.liquidationPrice,
      unrealizedPnl: h.unrealized_pnl != null ? Number(h.unrealized_pnl) : (sem.unrealizedPnl != null ? sem.unrealizedPnl : null),
      currency: String(output.currency || "USDC").toUpperCase()
    };
  });
  const cash = [{ currency: String(output.currency || "USDC").toUpperCase(), amount: Number(output.cashBalance || 0) }];
  return {
    sourceType: normalizedSourceType,
    provider: normalizedProvider,
    externalConnectionId: connectionId || address || provider,
    label: `${normalizedProvider.charAt(0).toUpperCase()}${normalizedProvider.slice(1)} ${String(address || "").slice(0, 6)}`,
    nativeCurrency: String(output.currency || "USDC").toUpperCase(),
    accessMode: normalizedAccessMode,
    connectionStatus: "connected",
    syncStatus: "synced",
    capabilities: { positions: true, cash: true, transactions: false },
    metadata: {
      workspaceId,
      address: address || null,
      connectionModel: normalizedProvider === "hyperliquid" ? "public_watch_only_wallet" : "read_only_api_key"
    },
    accounts: [{ externalAccountId: String(address || provider), label: `${normalizedProvider} ${normalizedSourceType === "exchange" ? "Exchange" : "Wallet"}`, nativeCurrency: String(output.currency || "USDC").toUpperCase() }],
    positions,
    cash,
    transactions: (Array.isArray(output.tradeFills) ? output.tradeFills : (Array.isArray(output.trades) ? output.trades : [])).map((t, idx) => ({
      // Prefer tradeFills: they carry per-fill realized PnL (Hyperliquid
      // `closedPnl`) which is the correct source for Best Trades / Asset
      // Performance. `output.trades` (record.trade) lacks realizedPnl.
      providerTxId: t.platformFillId || t.platformTradeId || t.id || `txn-${idx}`,
      // `type` is the transaction/event type (trade/fill/dividend/etc.), NEVER the
      // buy/sell side. `tradeFill` records from buildTradeAndFillRecord carry no
      // `type` field (the type is implied to be a trade/fill), so default to "trade".
      // Using t.side here would corrupt cash-flow classification downstream.
      type: normalizeTxType(t.type || "trade"),
      side: t.side || null,
      symbol: t.symbol || t.asset || null,
      quantity: t.quantity != null ? Number(t.quantity) : null,
      unitPrice: t.price != null ? Number(t.price) : (t.unitPrice != null ? Number(t.unitPrice) : null),
      notional: t.notional != null ? Number(t.notional) : null,
      fee: t.fee != null ? Number(t.fee) : (t.feeAmount != null ? Number(t.feeAmount) : null),
      currency: t.currency || t.feeCurrency || "USD",
      executedAt: t.executedAt || t.executed_at || t.date || null,
      realizedPnl: t.realizedPnl != null ? Number(t.realizedPnl) : null
    }))
  };
}

const mapHyperliquidToSource = mapExchangeWalletToSource;

// Manual holdings (user_workspace_portfolio rows)
function deriveManualSemantics(assetType, quantity) {
  const type = String(assetType || "other").toLowerCase();
  const qty = Number(quantity || 0);
  if (type === "prediction") {
    return { instrumentType: "prediction", positionType: "prediction", side: qty > 0 ? "long" : qty < 0 ? "short" : "unknown" };
  }
  if (type === "equity" || type === "etf" || type === "fund" || type === "bond") {
    return { instrumentType: "spot", positionType: "holding", side: "balance" };
  }
  if (type === "crypto") {
    return { instrumentType: "spot", positionType: "balance", side: "balance" };
  }
  if (type === "cash") {
    return { instrumentType: "cash", positionType: "balance", side: "balance" };
  }
  return { instrumentType: "spot", positionType: "holding", side: "balance" };
}

function mapManualToSource(rows, { workspaceId }) {
  const positions = (rows || []).map((h) => {
    const symbol = String(h.symbol || "").toUpperCase();
    const qty = Number(h.quantity || 0);
    const price = h.current_price != null ? Number(h.current_price) : Number(h.price || 0);
    const assetType = String(h.market_type || h.asset_type || "other").toLowerCase();
    const sem = deriveManualSemantics(assetType, qty);
    return {
      symbol,
      instrumentKey: normalizeInstrumentKey(symbol),
      name: String(h.name || h.symbol || ""),
      assetType,
      instrumentType: sem.instrumentType,
      positionType: sem.positionType,
      side: sem.side,
      quantity: qty,
      averageEntryPrice: h.average_entry_price != null ? Number(h.average_entry_price) : null,
      costBasis: h.average_entry_price != null ? Number(h.average_entry_price) * qty : null,
      currentPrice: price,
      marketValue: qty * price || null,
      currency: String(h.currency || "USD").toUpperCase()
    };
  });
  return {
    sourceType: "manual",
    provider: "manual",
    externalConnectionId: null,
    label: "Manual holdings",
    nativeCurrency: "USD",
    accessMode: "manual",
    connectionStatus: "connected",
    syncStatus: "synced",
    capabilities: { positions: true, cash: false, transactions: false },
    accounts: [{ externalAccountId: "manual", label: "Manual", nativeCurrency: "USD" }],
    positions,
    cash: [],
    transactions: []
  };
}

// SnapTrade brokerage_* rows (brokerage_holdings joined to accounts/connections)
function deriveSnapTradeSemantics(assetType, quantity) {
  const type = String(assetType || "other").toLowerCase();
  const qty = Number(quantity || 0);
  if (type === "option") {
    return { instrumentType: "option", positionType: "derivative", side: qty < 0 ? "short" : "long" };
  }
  if (type === "equity" || type === "etf" || type === "mutual_fund" || type === "bond" || type === "fund") {
    return { instrumentType: "spot", positionType: "holding", side: "balance" };
  }
  if (type === "crypto") {
    return { instrumentType: "spot", positionType: "balance", side: "balance" };
  }
  if (type === "cash") {
    return { instrumentType: "cash", positionType: "balance", side: "balance" };
  }
  return { instrumentType: "spot", positionType: "holding", side: "balance" };
}

function mapSnapTradeToSource({ accounts, holdings, positions, transactions, connectionId, externalConnectionId, provider = "snaptrade", label = "SnapTrade", accessMode = "oauth_read" }) {
  const accountList = (accounts || []).map((a) => ({
    externalAccountId: String(a.externalAccountId || a.provider_account_id || a.id),
    label: String(a.name || a.institution_name || a.provider_account_id || "Account"),
    nativeCurrency: String(a.native_currency || "USD").toUpperCase()
  }));
  const sourceRows = Array.isArray(positions) ? positions : (holdings || []);
  const positionList = sourceRows.map((h) => {
    const symbol = String(h.symbol || "").toUpperCase();
    const qty = Number(h.quantity || 0);
    const price = h.currentPrice != null ? Number(h.currentPrice) : h.current_price != null ? Number(h.current_price) : null;
    const assetType = String(h.assetType || h.asset_type || "other").toLowerCase();
    const sem = deriveSnapTradeSemantics(assetType, qty);
    return {
      symbol,
      instrumentKey: normalizeInstrumentKey(symbol),
      name: String(h.name || h.symbol || ""),
      assetType,
      instrumentType: sem.instrumentType,
      positionType: sem.positionType,
      side: sem.side,
      quantity: qty,
      averageEntryPrice: h.averageEntryPrice != null ? Number(h.averageEntryPrice) : h.average_entry_price != null ? Number(h.average_entry_price) : null,
      costBasis: h.costBasis != null ? Number(h.costBasis) : h.averageEntryPrice != null ? Number(h.averageEntryPrice) * qty : h.average_entry_price != null ? Number(h.average_entry_price) * qty : null,
      currentPrice: price,
      marketValue: h.marketValue != null ? Number(h.marketValue) : h.market_value != null ? Number(h.market_value) : (qty * (price || 0)) || null,
      currency: String(h.currency || "USD").toUpperCase(),
      accountId: h.accountId || h.account_id
    };
  });
  const txList = (transactions || []).map((t) => ({
    providerTxId: String(t.provider_tx_id || `${t.symbol}-${t.executed_at}`),
    // Canonicalize execution types: buy/sell conflate with side, so map them to
    // "trade". Only genuine cash-flow event types (deposit/withdrawal/etc.) are
    // preserved here; everything else defaults to "other". This prevents the
    // negative-list cash-flow classifier from treating fills as cash flows.
    type: normalizeTxType(t.type || "other"),
    side: t.side || null,
    symbol: t.symbol || null,
    quantity: t.quantity != null ? Number(t.quantity) : null,
    unitPrice: t.unit_price != null ? Number(t.unit_price) : null,
    notional: t.notional != null ? Number(t.notional) : null,
    fee: t.fee != null ? Number(t.fee) : null,
    currency: String(t.currency || "USD").toUpperCase(),
    executedAt: t.executed_at
  }));
  return {
    sourceType: "brokerage",
    provider,
    externalConnectionId: externalConnectionId || connectionId || null,
    label,
    nativeCurrency: "USD",
    accessMode,
    connectionStatus: "connected",
    syncStatus: "synced",
    capabilities: { positions: true, cash: false, transactions: true },
    accounts: accountList,
    positions: positionList,
    cash: [],
    transactions: txList
  };
}

function mapPredictionWalletToSource({ walletAddress, provider = "polymarket", positions = [], transactions = [], cashBalance, cash = [], connectionId, label, nativeCurrency = "USD" } = {}) {
  const normalizedAddress = String(walletAddress || connectionId || provider).trim();
  const positionList = (positions || []).map((p) => {
    const symbol = String(p.symbol || p.marketId || p.slug || p.question || "PREDICTION").toUpperCase();
    const qty = Number(p.quantity ?? p.shares ?? p.contracts ?? 0);
    const price = p.currentPrice != null ? Number(p.currentPrice) : p.price != null ? Number(p.price) : null;
    const marketValue = p.marketValue != null ? Number(p.marketValue) : (price != null ? qty * price : null);
    return {
      symbol,
      instrumentKey: normalizeInstrumentKey(`${provider}.${symbol}`),
      name: String(p.name || p.question || p.title || symbol),
      assetType: "prediction",
      instrumentType: "prediction",
      positionType: "prediction",
      side: p.side || (qty > 0 ? "long" : qty < 0 ? "short" : "unknown"),
      quantity: qty,
      averageEntryPrice: p.averageEntryPrice != null ? Number(p.averageEntryPrice) : p.avgPrice != null ? Number(p.avgPrice) : null,
      costBasis: p.costBasis != null ? Number(p.costBasis) : null,
      currentPrice: price,
      marketValue,
      currency: String(p.currency || nativeCurrency || "USD").toUpperCase(),
      accountId: normalizedAddress,
      metadata: p.metadata && typeof p.metadata === "object" ? p.metadata : null
    };
  });
  const txList = (transactions || []).map((t) => ({
    providerTxId: String(t.providerTxId || t.id || `${t.marketId || t.symbol || "prediction"}-${t.executedAt || t.createdAt || Date.now()}`),
    type: normalizeTxType(t.type || "trade"),
    side: t.side || null,
    symbol: t.symbol || t.marketId || null,
    name: t.name || null,
    quantity: t.quantity != null ? Number(t.quantity) : null,
    unitPrice: t.unitPrice != null ? Number(t.unitPrice) : t.price != null ? Number(t.price) : null,
    notional: t.notional != null ? Number(t.notional) : null,
    fee: t.fee != null ? Number(t.fee) : null,
    currency: String(t.currency || nativeCurrency || "USD").toUpperCase(),
    executedAt: t.executedAt || t.createdAt || new Date().toISOString()
  }));
  return {
    sourceType: "prediction",
    provider,
    externalConnectionId: connectionId || normalizedAddress,
    label: label || `${provider.charAt(0).toUpperCase()}${provider.slice(1)} Wallet ${normalizedAddress.slice(0, 6)}`,
    nativeCurrency: String(nativeCurrency || "USD").toUpperCase(),
    accessMode: "wallet_public",
    connectionStatus: "connected",
    syncStatus: "synced",
    capabilities: { positions: true, cash: true, transactions: true, publicMarketFeed: true },
    metadata: { walletAddress: normalizedAddress },
    accounts: [{ externalAccountId: normalizedAddress, label: "Prediction wallet", nativeCurrency: String(nativeCurrency || "USD").toUpperCase() }],
    positions: positionList,
    // Materialize a USDC cash row when a balance is supplied. Polymarket settles in
    // USDC; the fetcher currently reports 0 until a live balance source is wired
    // (see syncPolymarket TODO). When 0/absent we emit no row rather than fabricate
    // a $0 balance — capabilities.cash stays true so the consumer knows cash is
    // supported, but the canonical layer only stores a real balance.
    cash: (() => {
      const explicit = (Array.isArray(cash) ? cash : []).map((c) => ({ currency: String(c.currency || nativeCurrency || "USD").toUpperCase(), amount: Number(c.amount || 0) })).filter((c) => Number.isFinite(c.amount) && c.amount !== 0);
      const balance = Number(cashBalance);
      if (Number.isFinite(balance) && balance !== 0) {
        return [{ currency: String(nativeCurrency || "USD").toUpperCase(), amount: balance }];
      }
      return explicit;
    })(),
    transactions: txList
  };
}

// ---------------------------------------------------------------------------
// Dual-write entry point (canonical layer) — only runs when flag enabled.
// Stable identity: upsert on (workspace, provider, source_type, connection).
// Idempotent children: positions/cash upsert on unique keys.
// ---------------------------------------------------------------------------

async function recordSourceSync(db, workspaceId, source) {
  if (!isEnabled()) return null;
  source = normalizeSourceContract(source);
  const identity = [workspaceId, source.provider, source.sourceType, source.externalConnectionId || ""];
  let sourceId;
  try {
    // Dedup on (workspace, provider, source_type, external_connection_id).
    // ALSO fall back to matching the resolved wallet address (wallet sources) so
    // re-connecting the same address reuses one source instead of spawning dupes.
    const addr = source.metadata && source.metadata.address ? String(source.metadata.address) : null;
    const existing = await db.query(
      `SELECT id FROM portfolio_sources
       WHERE workspace_id=$1 AND provider=$2 AND source_type=$3
         AND (COALESCE(external_connection_id,'')=$4
              ${addr ? "OR metadata->>'address'=$5" : ""})
       LIMIT 1`,
      addr ? [...identity, addr] : identity
    );
    if (existing.rows.length) {
      sourceId = existing.rows[0].id;
      await db.query(
        `UPDATE portfolio_sources
         SET label=$1, native_currency=$2, status=$3, sync_status=$3,
             connection_status=$4, access_mode=$5, capabilities=$6::jsonb,
             metadata=$7::jsonb, last_sync_at=NOW(), data_as_of=NOW(),
             updated_at=NOW(), last_error=NULL
         WHERE id=$8`,
        [source.label || "", source.nativeCurrency || "USD", source.syncStatus, source.connectionStatus,
         source.accessMode, JSON.stringify(source.capabilities || {}), JSON.stringify(source.metadata || {}), sourceId]
      );
    } else {
      const r = await db.query(
        `INSERT INTO portfolio_sources
          (workspace_id, source_type, provider, external_connection_id, label, native_currency,
           access_mode, connection_status, sync_status, capabilities, metadata, status, last_sync_at, data_as_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$9,NOW(),NOW()) RETURNING id`,
        [workspaceId, source.sourceType, source.provider, source.externalConnectionId || null, source.label || "", source.nativeCurrency || "USD",
         source.accessMode, source.connectionStatus, source.syncStatus, JSON.stringify(source.capabilities || {}), JSON.stringify(source.metadata || {})]
      );
      sourceId = r.rows[0].id;
    }
    const accountIdMap = new Map();
    for (const acc of source.accounts || []) {
      const existingAccount = await db.query(
        `SELECT id FROM portfolio_source_accounts
         WHERE source_id=$1 AND external_account_id=$2
         ORDER BY id ASC LIMIT 1`,
        [sourceId, acc.externalAccountId]
      );
      let r;
      if (existingAccount.rows.length) {
        r = await db.query(
          `UPDATE portfolio_source_accounts
           SET label=$1, native_currency=$2
           WHERE id=$3
           RETURNING id`,
          [acc.label || "", acc.nativeCurrency || "USD", existingAccount.rows[0].id]
        );
      } else {
        r = await db.query(
          `INSERT INTO portfolio_source_accounts (source_id, external_account_id, label, native_currency)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [sourceId, acc.externalAccountId, acc.label || "", acc.nativeCurrency || "USD"]
        );
      }
      accountIdMap.set(acc.externalAccountId, r.rows[0].id);
    }
    for (const p of source.positions || []) {
      const acctId = p.accountId ? accountIdMap.get(p.accountId) : null;
      await db.query(
        `INSERT INTO portfolio_source_positions
          (source_id, account_id, symbol, instrument_key, name, asset_type, instrument_type, position_type, side,
           quantity, average_entry_price, cost_basis, current_price, market_value, notional_value, collateral_value,
           leverage, liquidation_price, unrealized_pnl, native_currency, base_currency, position_metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'USD',$21)
          ON CONFLICT (source_id, COALESCE(account_id,0), symbol, COALESCE(instrument_type,'spot'), COALESCE(position_type,'balance'), COALESCE(side,'balance')) DO UPDATE SET
            instrument_key=EXCLUDED.instrument_key, name=EXCLUDED.name, asset_type=EXCLUDED.asset_type,
            instrument_type=EXCLUDED.instrument_type, position_type=EXCLUDED.position_type, side=EXCLUDED.side,
            quantity=EXCLUDED.quantity, average_entry_price=EXCLUDED.average_entry_price,
            cost_basis=EXCLUDED.cost_basis, current_price=EXCLUDED.current_price,
            market_value=EXCLUDED.market_value, notional_value=EXCLUDED.notional_value,
            collateral_value=EXCLUDED.collateral_value, leverage=EXCLUDED.leverage,
            liquidation_price=EXCLUDED.liquidation_price, unrealized_pnl=EXCLUDED.unrealized_pnl,
            native_currency=EXCLUDED.native_currency, position_metadata=EXCLUDED.position_metadata,
            updated_at=NOW()`,
        [sourceId, acctId, p.symbol, p.instrumentKey || normalizeInstrumentKey(p.symbol), p.name || "",
         p.assetType || "other", p.instrumentType || "spot", p.positionType || "balance", p.side || null,
         p.quantity || 0, p.averageEntryPrice, p.costBasis, p.currentPrice, p.marketValue,
         p.notionalValue, p.collateralValue, p.leverage, p.liquidationPrice,
         p.unrealizedPnl != null ? Number(p.unrealizedPnl) : null,
         p.currency || "USD", p.metadata && typeof p.metadata === "object" ? JSON.stringify(p.metadata) : null]
      );
    }
    for (const c of source.cash || []) {
      await db.query(
        `INSERT INTO portfolio_source_cash (source_id, currency, amount, base_currency)
         VALUES ($1,$2,$3,'USD')
         ON CONFLICT (source_id, currency) DO UPDATE SET amount=EXCLUDED.amount, updated_at=NOW()`,
        [sourceId, c.currency || "USD", c.amount || 0]
      );
    }
    for (const t of source.transactions || []) {
      await db.query(
        `INSERT INTO portfolio_source_transactions
          (source_id, provider_tx_id, type, side, symbol, name, quantity, unit_price, notional, fee, currency, executed_at, realized_pnl)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (source_id, provider_tx_id) DO UPDATE SET
           name=EXCLUDED.name, symbol=EXCLUDED.symbol, side=EXCLUDED.side,
           quantity=EXCLUDED.quantity, unit_price=EXCLUDED.unit_price, notional=EXCLUDED.notional,
           fee=EXCLUDED.fee, currency=EXCLUDED.currency, realized_pnl=EXCLUDED.realized_pnl
         `,
        [sourceId, t.providerTxId, t.type || "other", t.side || null, t.symbol || null, t.name || null,
         t.quantity, t.unitPrice, t.notional, t.fee, t.currency || "USD", t.executedAt,
         t.realizedPnl != null ? Number(t.realizedPnl) : null]
      );
    }
    // Cash flows: extract deposits, withdrawals, dividends, interest, fees,
    // corporate actions, etc. — genuine external capital events — from the
    // source's transactions. Executions (trade/fill/buy/sell/crypto) are NOT cash
    // flows. These go into portfolio_cash_flows so TWR/MWR can distinguish
    // portfolio returns from external capital flows. Idempotent per
    // (source_id, external_id).
    for (const t of source.transactions || []) {
      const flowType = classifyCashFlow(t.type || "trade");
      if (!flowType) continue;
      await db.query(
        `INSERT INTO portfolio_cash_flows
          (workspace_id, source_id, source_account_id, type, amount, currency,
           base_amount, base_currency, executed_at, external_id, description, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'USD',$8,$9,$10,$11,$12::jsonb)
         ON CONFLICT (source_id, external_id) DO UPDATE SET
           amount=EXCLUDED.amount, type=EXCLUDED.type,
           executed_at=EXCLUDED.executed_at, description=EXCLUDED.description,
           metadata=EXCLUDED.metadata`,
        [workspaceId, sourceId,
         t.accountId ? accountIdMap.get(t.accountId) : null,
         flowType,
         t.notional != null ? Number(t.notional) : (t.amount != null ? Number(t.amount) : 0),
         t.currency || "USD",
         t.notional != null ? Number(t.notional) : (t.amount != null ? Number(t.amount) : 0),
         t.executedAt || t.date || new Date().toISOString(),
         t.providerTxId || t.externalId || null,
         t.description || null,
         JSON.stringify(t.metadata || {})]
      );
    }
    return sourceId;
  } catch (err) {
    // Keep last successful state: record error + mark source 'error' but never
    // delete good prior positions/cash. Honest failure signal for the UI.
    if (sourceId) {
      await db.query(
        `UPDATE portfolio_sources
         SET status='error', sync_status='error', connection_status='error',
             last_error=$1, last_attempted_sync_at=NOW(), updated_at=NOW()
         WHERE id=$2`,
        [String(err.message || err), sourceId]
      ).catch(() => {});
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Unified read model — aggregates EXISTING source tables (works today)
// ---------------------------------------------------------------------------

// Returns true if a currency is valueable 1:1 with the USD base.
function isBaseEquivalent(currency) {
  return USD_EQUIVALENTS.has(String(currency || "USD").toUpperCase());
}

// A successful source sync is considered "stale" after this window. Mirrors the
// brokerage background-sync stale threshold (env-configurable).
const STALE_AFTER_MS = Number(process.env.UNIFIED_STALE_AFTER_MS) || 6 * 60 * 60 * 1000;
function isStale(lastSyncAt) {
  if (!lastSyncAt) return false;
  const age = Date.now() - new Date(lastSyncAt).getTime();
  return age > STALE_AFTER_MS;
}

// Load all persisted FX rates for a base currency into a Map(quote -> rate).
async function loadFxRates(pool, base) {
  const rates = new Map();
  try {
    const r = await pool.query(
      `SELECT quote, rate FROM portfolio_fx_rates WHERE base = $1`,
      [String(base || "USD").toUpperCase()]
    );
    for (const row of r.rows) rates.set(String(row.quote).toUpperCase(), Number(row.rate));
  } catch (_) { /* table may not exist on very old DBs */ }
  return rates;
}

// Returns the rate to convert `quote` -> `base`, or null if unknown.
function getFxRate(fxRates, base, quote) {
  const q = String(quote || "USD").toUpperCase();
  const b = String(base || "USD").toUpperCase();
  if (q === b) return 1;
  return fxRates.get(q) ?? null;
}

// Persist (upsert) an FX rate. Never fabricates — caller supplies the real rate.
async function recordFxRate(pool, base, quote, rate, { rateSource = "manual", asOf = null } = {}) {
  await pool.query(
    `INSERT INTO portfolio_fx_rates (base, quote, rate, rate_source, as_of, fetched_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (base, quote) DO UPDATE SET rate=EXCLUDED.rate, rate_source=EXCLUDED.rate_source,
       as_of=EXCLUDED.as_of, fetched_at=NOW()`,
    [String(base).toUpperCase(), String(quote).toUpperCase(), Number(rate), rateSource, asOf]
  );
}

// Provider fetch hook — env-gated. No rate provider is configured in this repo,
// so this is intentionally inert (returns null) unless wired. Keeps the contract
// for a future live fetch without fabricating rates.
async function fetchFxRate(_base, _quote) {
  const provider = process.env.UNIFIED_FX_PROVIDER;
  if (!provider) return null;
  // Intentionally not implemented per-provider here; insert a real fetch behind
  // the env gate when a key is available. Returning null => position stays unvalued.
  return null;
}

async function getWorkspaceBaseCurrency(pool, workspaceId) {
  try {
    const r = await pool.query(`SELECT base_currency FROM workspaces WHERE id=$1`, [workspaceId]);
    if (r.rows.length && r.rows[0].base_currency) return String(r.rows[0].base_currency).toUpperCase();
  } catch (_) { /* workspaces may lack column on very old DBs */ }
  return "USD";
}

function deriveReadModelSemantics(assetType, instrumentType, positionType, side, quantity) {
  const at = String(assetType || "other").toLowerCase();
  const it = String(instrumentType || "").toLowerCase();
  const pt = String(positionType || "").toLowerCase();
  const sd = String(side || "").toLowerCase();
  const qty = Number(quantity || 0);

  // Trust canonical semantics when present
  if (it && pt) {
    return { assetType: at, instrumentType: it, positionType: pt, side: sd || "unknown" };
  }

  // Fallback: derive from asset_type
  if (at === "option") {
    return { assetType: at, instrumentType: "option", positionType: "derivative", side: sd || (qty < 0 ? "short" : "long") };
  }
  if (at === "prediction") {
    return { assetType: at, instrumentType: "prediction", positionType: "prediction", side: sd || (qty < 0 ? "short" : qty > 0 ? "long" : "unknown") };
  }
  if (at === "crypto") {
    return { assetType: at, instrumentType: "spot", positionType: "balance", side: "balance" };
  }
  if (at === "cash") {
    return { assetType: at, instrumentType: "cash", positionType: "balance", side: "balance" };
  }
  if (at === "equity" || at === "etf" || at === "fund" || at === "bond" || at === "mutual_fund") {
    return { assetType: at, instrumentType: "spot", positionType: "holding", side: "balance" };
  }
  return { assetType: at, instrumentType: "spot", positionType: "holding", side: "balance" };
}

function isDerivativePosition(semantics) {
  return semantics.positionType === "derivative" ||
    semantics.instrumentType === "perpetual" ||
    semantics.instrumentType === "future" ||
    semantics.instrumentType === "option";
}

async function getUnifiedSummary(pool, workspaceId) {
  const baseCurrency = await getWorkspaceBaseCurrency(pool, workspaceId);
  const fxRates = await loadFxRates(pool, baseCurrency);

  // Connected-source cash from the canonical layer.
  const connectedCash = await pool.query(
    `SELECT ps.provider, ps.source_type, psc.currency, psc.amount
     FROM portfolio_source_cash psc
     JOIN portfolio_sources ps ON ps.id = psc.source_id
     WHERE ps.workspace_id = $1`,
    [workspaceId]
  );

  // Today's cash flows (deposits/withdrawals) from canonical transactions, so the
  // EOD snapshot can store real flows — which TWR's flow-adjustment path and MWR's
  // intermediate cash flows depend on. Sums notional in base-equivalent currency.
  const todayIso = new Date().toISOString().slice(0, 10);
  const flowsToday = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN LOWER(type) IN ('deposit','deposit_cash','dividend','interest','reward') THEN notional ELSE 0 END), 0) AS deposits,
            COALESCE(SUM(CASE WHEN LOWER(type) IN ('withdrawal','withdrawal_cash','fee','tax') THEN notional ELSE 0 END), 0) AS withdrawals
     FROM portfolio_source_transactions pst
     JOIN portfolio_sources ps ON ps.id = pst.source_id
     WHERE ps.workspace_id = $1
       AND pst.executed_at::date >= $2::date
       AND pst.executed_at::date < ($2::date + INTERVAL '1 day')`,
    [workspaceId, todayIso]
  ).catch(() => ({ rows: [{ deposits: 0, withdrawals: 0 }] }));
  const depositsToday = Number(flowsToday.rows[0]?.deposits || 0);
  const withdrawalsToday = Number(flowsToday.rows[0]?.withdrawals || 0);

  // Wallet / prediction / exchange / brokerage — all sources flow through the
  // canonical layer (recordSourceSync writes all provider types). Single query,
  // single processing loop — no separate legacy brokerage_holdings path.
  const canonicalConnected = await pool.query(
    `SELECT sp.symbol, sp.instrument_key, sp.name, sp.asset_type, sp.instrument_type,
            sp.position_type, sp.side, sp.quantity, sp.current_price, sp.average_entry_price, sp.market_value,
            sp.notional_value, sp.collateral_value, sp.leverage, sp.liquidation_price,
            sp.unrealized_pnl,
            sp.native_currency AS currency, ps.id AS source_id, ps.provider, ps.source_type,
            sp.as_of, sp.updated_at, psa.account_type
     FROM portfolio_source_positions sp
     JOIN portfolio_sources ps ON ps.id = sp.source_id
     LEFT JOIN portfolio_source_accounts psa ON psa.id = sp.account_id
     WHERE ps.workspace_id = $1 AND ps.source_type IN ('wallet', 'prediction', 'exchange', 'brokerage')`,
    [workspaceId]
  );

  // Manual source — REAL current data lives in user_workspace_portfolio + cash.
  const manual = await pool.query(
    `SELECT symbol, name, market_type AS asset_type, quantity,
            price AS current_price, price, (quantity * price) AS market_value,
            'USD' AS currency,
            NULL AS instrument_type, NULL AS position_type, NULL AS side,
            NULL AS notional_value, NULL AS collateral_value, NULL AS leverage, NULL AS liquidation_price
     FROM user_workspace_portfolio WHERE workspace_id = $1`,
    [workspaceId]
  );
  const manualCash = await pool.query(
    `SELECT balance AS amount, currency FROM user_workspace_cash WHERE workspace_id = $1`,
    [workspaceId]
  );

  const sources = [];
  let investedValue = 0;        // headline portfolio value (valued, base-equiv)
  let cashValue = 0;            // headline cash (valued, base-equiv)
  let unvaluedTotal = 0;        // positions we could NOT value (no price / FX)
  let manualValue = 0;          // manual contribution to headline (pre-exclusion)
  let derivativeGrossExposure = 0;
  let derivativeNetExposure = 0;
  let derivativeCollateralOffset = 0;
  let derivativePnlOffset = 0;
  const warnings = [];

  // Convert raw value to base currency, tracking unvalued gaps.
  const toBase = (rawValue, currency, symbol, sourceLabel) => {
    const cur = String(currency || "USD").toUpperCase();
    if (!Number.isFinite(rawValue)) {
      warnings.push({ type: "unvalued", symbol, source: sourceLabel, reason: "missing_price" });
      return { value: null, unvalued: true };
    }
    if (isBaseEquivalent(cur)) return { value: rawValue };
    const rate = getFxRate(fxRates, baseCurrency, cur);
    if (rate == null) {
      unvaluedTotal += rawValue;
      warnings.push({ type: "unvalued", symbol, source: sourceLabel, reason: "missing_fx", currency: cur });
      return { value: null, unvalued: true };
    }
    return { value: rawValue * rate };
  };

  // Helper: build a semantic position with valuation/exposure split.
  const valueRow = (row, sourceLabel) => {
    const qty = Number(row.quantity || 0);
    const price = row.current_price != null ? Number(row.current_price) : (row.price != null ? Number(row.price) : null);
    const rawMv = row.market_value != null ? Number(row.market_value) : (qty * (price || 0));
    const currency = String(row.currency || "USD").toUpperCase();
    const symbol = String(row.symbol || "").toUpperCase();
    const instrumentKey = row.instrument_key
      ? String(row.instrument_key).toUpperCase()
      : symbol.replace(/[^A-Z0-9.]/g, "");
    const sem = deriveReadModelSemantics(
      row.asset_type, row.instrument_type, row.position_type, row.side, row.quantity
    );

    const rawNotional = row.notional_value != null ? Number(row.notional_value) : null;
    const rawCollateral = row.collateral_value != null ? Number(row.collateral_value) : null;
    const rawLeverage = row.leverage != null ? Number(row.leverage) : null;
    const rawLiquidation = row.liquidation_price != null ? Number(row.liquidation_price) : null;

    // If we have no price and no market value at all, the position cannot be valued.
    if (price == null && row.market_value == null && rawNotional == null && rawCollateral == null) {
      warnings.push({ type: "unvalued", symbol, source: sourceLabel, reason: "missing_price" });
      return null;
    }

    const derivative = isDerivativePosition(sem);
    let portfolioValueRaw;
    let grossExposureRaw;
    let netExposureRaw;

    if (derivative) {
      const rawPnl = row.unrealized_pnl != null ? Number(row.unrealized_pnl) : null;
      portfolioValueRaw = (rawCollateral || 0) + (rawPnl || 0);
      grossExposureRaw = rawNotional || Math.abs(rawMv || 0);
      netExposureRaw = sem.side === "short" ? -grossExposureRaw : grossExposureRaw;
      derivativeCollateralOffset = rawCollateral != null ? (rawCollateral || 0) : 0;
      derivativePnlOffset = rawPnl != null ? rawPnl : 0;
    } else if (sem.positionType === "collateral" || sem.positionType === "liability") {
      // Collateral/liability positions are cash proxies, not tradeable assets.
      // The perp above already accounts for deployed margin (collateral+pnl),
      // and the source cash row (portfolio_source_cash) tracks the total balance.
      // Adding the collateral row's value to investedValue would double-count it.
      portfolioValueRaw = 0;
      grossExposureRaw = Math.abs(rawMv || 0);
      netExposureRaw = sem.positionType === "liability" ? -grossExposureRaw : 0;
      derivativeCollateralOffset = 0;
      derivativePnlOffset = 0;
    } else {
      // Spot / holding / balance: value = market value; exposure = market value.
      portfolioValueRaw = rawMv;
      grossExposureRaw = rawMv;
      netExposureRaw = sem.side === "short" ? -rawMv : rawMv;
      derivativeCollateralOffset = 0;
    }

    // Portfolio value is the gate: if we cannot value it, the whole position is
    // unvalued and its exposure is not counted separately.
    const portfolioValueBase = toBase(portfolioValueRaw, currency, symbol, sourceLabel);
    if (portfolioValueBase.unvalued) return null;

    // Exposure uses the same FX rate (already known to exist). Do not run
    // toBase again for the same currency to avoid double-counting unvaluedTotal.
    const fxRate = isBaseEquivalent(currency) ? 1 : getFxRate(fxRates, baseCurrency, currency);
    const grossExposureBase = grossExposureRaw * fxRate;
    const netExposureBase = netExposureRaw * fxRate;

    const out = {
      symbol,
      instrumentKey,
      name: String(row.name || row.symbol || ""),
      assetType: sem.assetType,
      instrumentType: sem.instrumentType,
      positionType: sem.positionType,
      side: sem.side,
      quantity: qty,
      marketValue: rawMv,
      averageEntryPrice: row.average_entry_price != null ? Number(row.average_entry_price) : null,
      currentPrice: price,
      portfolioValue: portfolioValueBase.value,
      grossExposure: grossExposureBase,
      netExposure: netExposureBase,
      notionalValue: rawNotional,
      collateralValue: rawCollateral,
      leverage: rawLeverage,
      liquidationPrice: rawLiquidation,
      collateralOffset: derivativeCollateralOffset,
      pnlOffset: derivativePnlOffset,
      currency,
      source: sourceLabel,
      asOf: row.as_of || null,
      updatedAt: row.updated_at || null,
      accountType: row.account_type || null
    };
    if (!isBaseEquivalent(currency)) {
      out.fxRate = fxRate;
    }
    return out;
  };

  const posKey = (p) => `${p.source}:${p.symbol}:${p.instrumentKey}:${p.instrumentType}:${p.positionType}:${p.side}`;

  // Process all sources into a deduplicated position map + source map.
  const positionMap = new Map();
  const sourceMap = new Map();

  const addPosition = (v) => {
    const k = posKey(v);
    if (positionMap.has(k)) return false;
    positionMap.set(k, v);
    return true;
  };

  const ensureSource = (sourceType, provider, label, id) => {
    const key = `${sourceType}:${provider}`;
    if (!sourceMap.has(key)) {
      sourceMap.set(key, { id: id != null ? id : undefined, sourceType, provider, label: label || provider, positions: [] });
    } else if (id != null && sourceMap.get(key).id == null) {
      sourceMap.get(key).id = id;
    }
    return sourceMap.get(key);
  };

  for (const row of canonicalConnected.rows) {
    const sourceType = row.source_type || "wallet";
    const provider = row.provider || sourceType;
    const src = ensureSource(sourceType, provider, provider, row.source_id);
    const v = valueRow(row, provider);
    if (v) {
      if (addPosition(v)) {
        src.positions.push(v);
        investedValue += v.portfolioValue;
        if (isDerivativePosition({ instrumentType: v.instrumentType, positionType: v.positionType })) {
          derivativeGrossExposure += v.grossExposure;
          derivativeNetExposure += v.netExposure;
        }
      }
    }
  }

  // Manual positions — tracked separately for exclusion logic.
  const manualPositions = [];
  for (const row of manual.rows) {
    const v = valueRow(row, "manual");
    if (v) {
      manualPositions.push(v);
      manualValue += v.portfolioValue;
    }
  }

  // Connected-source cash (canonical layer). Subtract per-derivative collateral
  // AND unrealized-PnL offsets to avoid double-counting margin/PNL USDC already
  // reported as source cash (e.g. Hyperliquid accountValue).
  let totalCollateralOffset = 0;
  let totalPnlOffset = 0;
  for (const p of positionMap.values()) {
    if (p.collateralOffset) totalCollateralOffset += Number(p.collateralOffset) || 0;
    if (p.pnlOffset) totalPnlOffset += Number(p.pnlOffset) || 0;
  }
  for (const row of connectedCash.rows) {
    if (isBaseEquivalent(row.currency)) cashValue += Number(row.amount || 0);
  }
  cashValue -= (totalCollateralOffset + totalPnlOffset);
  if (cashValue < 0) cashValue = 0;

  // Manual exclusion: when >=1 connected source has valued positions, manual
  // holdings and cash are stale and should be removed from headline + positions.
  const connectedHasValued = Array.from(sourceMap.values()).some((s) => s.positions.length > 0);
  const manualSummary = {
    count: manualPositions.length,
    marketValue: manualPositions.reduce((s, p) => s + p.portfolioValue, 0),
    grossExposure: manualPositions.reduce((s, p) => s + (p.grossExposure || 0), 0),
    netExposure: manualPositions.reduce((s, p) => s + (p.netExposure || 0), 0)
  };
  let excludedManualValue = 0;
  if (connectedHasValued) {
    excludedManualValue = manualValue;
    manualValue = 0;
    manualPositions.length = 0;
    warnings.push({ type: "manual_excluded", message: "Manual holdings excluded from headline; connected sources present." });
  } else {
    for (const row of manualCash.rows) {
      if (isBaseEquivalent(row.currency)) cashValue += Number(row.amount || 0);
    }
  }

  // Build deduplicated positions array + source list.
  const positions = Array.from(positionMap.values());
  if (!connectedHasValued) {
    positions.push(...manualPositions);
  }

  for (const [, src] of sourceMap) {
    if (src.positions.length === 0) continue;
    sources.push({
      id: src.id != null ? src.id : undefined,
      sourceType: src.sourceType,
      provider: src.provider,
      label: src.label,
      status: "synced",
      positionCount: src.positions.length,
      marketValue: src.positions.reduce((s, p) => s + p.portfolioValue, 0),
      grossExposure: src.positions.reduce((s, p) => s + (p.grossExposure || 0), 0),
      netExposure: src.positions.reduce((s, p) => s + (p.netExposure || 0), 0)
    });
  }

  // NOTE: per product decision, manual holdings are intentionally NOT surfaced
  // as a connected source/broker anywhere in the UI (there is no manual
  // position entry path on the web app). Manual positions still contribute to
  // the headline per the exclusion rule above, but we do not emit a "Manual
  // holdings" source object so it cannot appear in Connected Accounts / the
  // SOURCES strip / or be targeted by Remove.

  const totalValue = investedValue + cashValue + manualValue;
  // Compute total unrealized PNL across all valued connected + manual positions.
  // Each position's valueRow already resolved its instrument-specific
  // unrealized_pnl (provider-reported for derivatives, cost-basis for spot).
  let unrealizedValue = 0;
  for (const p of positions) {
    if (p.unrealizedPnl != null) unrealizedValue += Number(p.unrealizedPnl);
  }
  // isPartial = REAL valuation gaps only (some positions we couldn't value).
  // Routine manual-exclusion is informational, not a "partial" state — split it out
  // so the "partial" badge doesn't fire on every workspace that mixes manual + connected.
  const isPartial = unvaluedTotal > 0;
  const hasManualExcluded = excludedManualValue > 0;
  const sourceCoverage = {
    total: sources.length,
    connected: sources.filter((s) => s.sourceType !== "manual").length,
    manual: sources.filter((s) => s.sourceType === "manual").length
  };

  return {
    totalValue,
    cashValue,
    investedValue,
    unrealizedValue,
    manualValue,
    excludedManualValue,
    unvaluedTotal,
    derivativeGrossExposure,
    derivativeNetExposure,
    baseCurrency,
    valuedAt: new Date().toISOString(),
    isPartial,
    hasManualExcluded,
    warnings,
    sources,
    sourceCoverage,
    positions,
    // Today's cash flows so recordUnifiedSnapshot can persist them (TWR/MWR).
    deposits: depositsToday,
    withdrawals: withdrawalsToday,
    snapshots: await getUnifiedSnapshots(pool, workspaceId, 400),
    snapshotTimeline: null
  };
}

// Shadow-compare: validate the unified read model against the legacy headline
// (manual holdings qty*price + manual cash) during staged rollout. Never affects
// production reads — purely a divergence report. Keeps the same manual-exclusion
// rule as getUnifiedSummary (manual contributes to headline ONLY when no connected
// source has data; otherwise it is held out and reported as divergence surfaced
// honestly, never netted).
async function getUnifiedShadowComparison(pool, workspaceId) {
  if (!isEnabled()) return { enabled: false };

  const unified = await getUnifiedSummary(pool, workspaceId);
  const connectedHasData = unified.sourceCoverage.connected > 0;

  // Legacy headline = manual holdings (qty*price) + manual cash, in workspace base.
  const manual = await pool.query(
    `SELECT quantity, price AS current_price, price, (quantity * price) AS market_value, 'USD' AS currency
     FROM user_workspace_portfolio WHERE workspace_id = $1`,
    [workspaceId]
  );
  const manualCash = await pool.query(
    `SELECT balance AS amount, currency FROM user_workspace_cash WHERE workspace_id = $1`,
    [workspaceId]
  );

  let legacyInvested = 0;
  let legacyCash = 0;
  manual.rows.forEach((r) => {
    const qty = Number(r.quantity || 0);
    const price = r.current_price != null ? Number(r.current_price) : (r.price != null ? Number(r.price) : 0);
    const mv = r.market_value != null ? Number(r.market_value) : qty * price;
    legacyInvested += mv;
  });
  manualCash.rows.forEach((r) => { legacyCash += Number(r.amount || 0); });

  // Shadow-compare compares the MANUAL slice apples-to-apples using the SAME
  // manual rows on both sides: legacy manual book (kty*price + cash) vs the
  // unified manual slice. When no connected source has data, unified's manual
  // contribution IS its manualValue (manual is in the headline). When a
  // connected source exists, manual is held OUT of the headline, so the
  // comparable unified figure is excludedManualValue — but both summaries
  // split manual CASH into the generic cash bucket, so we reconstruct the
  // unified manual slice from the same manual rows (pos + cash) to keep the
  // comparison fair. The connected book has no legacy equivalent and is
  // reported as expected additive divergence, never as a defect.
  const manualInvested = legacyInvested;
  const manualCashValue = legacyCash;
  const legacyManual = legacyInvested + legacyCash;
  const unifiedManual = manualInvested + manualCashValue;
  const unifiedTotal = Number(unified.totalValue || 0);

  // The connected book (if any) is additive and has NO legacy equivalent.
  const connectedBook = unifiedTotal - unifiedManual;

  const delta = unifiedManual - legacyManual;
  const absDelta = Math.abs(delta);
  const divergencePct = legacyManual > 0 ? (delta / legacyManual) * 100 : (unifiedManual > 0 ? 100 : 0);
  const TOLERANCE_PCT = 1.0; // 1% rollout tolerance
  const withinTolerance = absDelta <= Math.max(1, legacyManual * (TOLERANCE_PCT / 100));

  // Rollout recommendation: promote unless the manual slices diverge unexpectedly.
  const recommendation = withinTolerance ? "promote" : "hold";

  return {
    enabled: true,
    baseCurrency: unified.baseCurrency,
    legacy: {
      invested: legacyInvested,
      cash: legacyCash,
      manualBook: legacyManual,
      total: legacyManual
    },
    unified: {
      totalValue: unifiedTotal,
      investedValue: unified.investedValue,
      cashValue: unified.cashValue,
      manualValue: unified.manualValue,
      excludedManualValue: unified.excludedManualValue,
      unvaluedTotal: unified.unvaluedTotal,
      positionCount: unified.positions.length,
      sourceCoverage: unified.sourceCoverage
    },
    manualSlice: {
      legacy: legacyManual,
      unified: unifiedManual,
      delta,
      divergencePct: Number(divergencePct.toFixed(2)),
      withinTolerance
    },
    connectedHasData,
    connectedBook,
    recommendation,
    comparedAt: new Date().toISOString()
  };
}

async function getUnifiedPositions(pool, workspaceId) {
  const summary = await getUnifiedSummary(pool, workspaceId);
  return summary.positions;
}

async function getUnifiedSources(pool, workspaceId) {
  const summary = await getUnifiedSummary(pool, workspaceId);
  if (!isEnabled()) return summary.sources;
  try {
    const rows = await pool.query(
      `SELECT DISTINCT ON (provider, source_type)
              id, source_type, provider, external_connection_id, label, native_currency,
              access_mode, connection_status, sync_status, capabilities, metadata,
              status, last_sync_at, last_attempted_sync_at, last_error
       FROM portfolio_sources WHERE workspace_id=$1 AND source_type <> 'manual'
       ORDER BY provider, source_type, last_sync_at DESC NULLS LAST, id DESC`,
      [workspaceId]
    );
    if (!rows.rows.length) return summary.sources;
    const marketBySource = new Map(
      summary.sources.map((s) => [`${s.sourceType}:${s.provider}`, s])
    );
    return rows.rows.map((s) => {
      const summarized = marketBySource.get(`${s.source_type}:${s.provider}`) || {};
      return {
        id: s.id,
        sourceType: s.source_type,
        provider: s.provider,
        label: s.label || summarized.label || s.provider,
        connectionId: s.external_connection_id,
        accessMode: s.access_mode || null,
        connectionStatus: s.connection_status || (s.status === "synced" ? "connected" : s.status || "pending"),
        syncStatus: s.sync_status || s.status,
        capabilities: s.capabilities || {},
        metadata: s.metadata || {},
        nativeCurrency: s.native_currency,
        status: s.sync_status || s.status,
        lastSyncAt: s.last_sync_at,
        lastAttemptedSyncAt: s.last_attempted_sync_at,
        lastError: s.last_error,
        stale: isStale(s.last_sync_at),
        positionCount: summarized.positionCount || 0,
        marketValue: summarized.marketValue || 0,
        excluded: !!summarized.excluded
      };
    });
  } catch (_) {
    return summary.sources;
  }
}

// Per-source sync status + health (freshness, errors, last run).
// Surfaces auth failures / stale sources / incomplete syncs so the UI + a future
// notifications layer can act on them. Honest about gaps — no fabricated state.
async function getUnifiedSyncStatus(pool, workspaceId) {
  if (!isEnabled()) return { enabled: false, sources: [], anyConnectedHasData: false, lastSyncRun: null };
  const src = await pool.query(
    `SELECT id, provider, source_type, external_connection_id, label, access_mode,
            connection_status, sync_status, capabilities, metadata, status, last_sync_at,
            last_attempted_sync_at, last_error
     FROM portfolio_sources WHERE workspace_id=$1 ORDER BY provider`,
    [workspaceId]
  );
  const runs = await pool.query(
    `SELECT id, status, started_at, finished_at, per_source
     FROM portfolio_sync_runs WHERE workspace_id=$1 ORDER BY started_at DESC LIMIT 5`,
    [workspaceId]
  );
  const sources = src.rows.map((s) => ({
    id: s.id,
    provider: s.provider,
    sourceType: s.source_type,
    label: s.label,
    connectionId: s.external_connection_id,
    accessMode: s.access_mode || null,
    connectionStatus: s.connection_status || (s.status === "synced" ? "connected" : s.status || "pending"),
    syncStatus: s.sync_status || s.status,
    capabilities: s.capabilities || {},
    metadata: s.metadata || {},
    status: s.sync_status || s.status,
    lastSyncAt: s.last_sync_at,
    lastAttemptedSyncAt: s.last_attempted_sync_at,
    lastError: s.last_error,
    stale: isStale(s.last_sync_at)
  }));
  const anyConnectedHasData = src.rows.some(
    (s) => s.source_type !== "manual" && ((s.sync_status || s.status) === "synced" || (s.sync_status || s.status) === "partial") && s.last_sync_at
  );
  const lastRun = runs.rows[0]
    ? { id: runs.rows[0].id, status: runs.rows[0].status, startedAt: runs.rows[0].started_at, finishedAt: runs.rows[0].finished_at, perSource: runs.rows[0].per_source }
    : null;
  return { enabled: true, sources, anyConnectedHasData, lastSyncRun: lastRun };
}

// Unified transactions across all sources, most recent first.
// The requested `limit` applies to the COMPLETE unified result set (across all
// sources including Polymarket), enforced as a single outer LIMIT on the UNION
// ALL result — NOT per-branch. Previously Polymarket's branch had no LIMIT, so
// the effective row count was `limit non-Polymarket + ALL Polymarket`, which
// could vastly exceed the requested page size and break pagination/ordering.
async function getUnifiedTransactions(pool, workspaceId, limit = 100) {
  const rows = await pool.query(
    `SELECT s.provider, s.source_type, t.provider_tx_id, t.symbol, t.name, t.type, t.side, t.quantity,
            t.unit_price, t.notional, t.fee, t.currency, t.executed_at, t.realized_pnl, t.account_id,
            t.id AS txn_id
     FROM (
        (SELECT t.id, t.provider_tx_id, t.symbol, t.name, t.type, t.side, t.quantity,
                t.unit_price, t.notional, t.fee, t.currency, t.executed_at, t.realized_pnl, t.account_id,
                t.source_id
         FROM portfolio_source_transactions t
         JOIN portfolio_sources s ON s.id = t.source_id
         WHERE s.workspace_id=$1 AND s.provider <> 'polymarket')
        UNION ALL
        (SELECT t.id, t.provider_tx_id, t.symbol, t.name, t.type, t.side, t.quantity,
                t.unit_price, t.notional, t.fee, t.currency, t.executed_at, t.realized_pnl, t.account_id,
                t.source_id
         FROM portfolio_source_transactions t
         JOIN portfolio_sources s ON s.id = t.source_id
         WHERE s.workspace_id=$1 AND s.provider = 'polymarket')
     ) t
     JOIN portfolio_sources s ON s.id = t.source_id
     ORDER BY t.executed_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );
  return rows.rows.map((t) => ({
    provider: t.provider,
    sourceType: t.source_type,
    providerTxId: t.provider_tx_id,
    symbol: t.symbol,
    name: t.name || null,
    type: t.type,
    side: t.side,
    quantity: t.quantity,
    unitPrice: t.unit_price,
    notional: t.notional,
    fee: t.fee,
    currency: t.currency,
    executedAt: t.executed_at,
    realizedPnl: t.realized_pnl != null ? Number(t.realized_pnl) : null,
    sourceAccountId: t.account_id,
    txnId: t.txn_id || null
  }));
}

// Historical data remediation for the transaction-type / cash-flow bug.
//
// Prior to the type fix, exchange fills stored `type = side` (e.g. 'buy'/'sell')
// in portfolio_source_transactions. The old negative-list cash-flow classifier
// (`!['trade','fill','other'].includes(type)`) then treated those fills as cash
// flows, inserting false deposit/withdrawal/fee rows into portfolio_cash_flows
// with type = 'buy'/'sell'/'crypto'. This corrupted TWR/MWR/performance snapshots.
//
// This function is idempotent and safe to run repeatedly:
//  1. Repairs portfolio_source_transactions.type: maps legacy side-valued types
//     back to canonical event types. Fills (which have a `side`) → 'trade'.
//     This only touches rows whose type looks like a raw side; genuine cash-flow
//     event types (deposit/withdrawal/dividend/...) are left untouched.
//  2. Removes false cash-flow rows from portfolio_cash_flows whose type is a
//     known execution-side artifact ('buy'/'sell'/'crypto') — these are
//     executions, not capital events.
//
// Does NOT delete: legitimate deposits, withdrawals, dividends, interest, fees,
// transfers, or any cash flow with a proper event type.
// See: Execution Log Empty-Row / Phantom Execution Audit §12, §35-§37.
async function reconcileCashFlows(pool, workspaceId) {
  if (!isEnabled()) return { repairedTxTypes: 0, removedFalseFlows: 0 };

  // 1. Repair source transaction types: legacy 'buy'/'sell' (which were stored
  //    from `t.side`) are reclassified to canonical 'trade'. We only touch rows
  //    whose current type is exactly a known side value AND have a side column
  //    populated (genuine fills). Rows already using proper types are untouched.
  const repairRes = await pool.query(
    `UPDATE portfolio_source_transactions t
       SET type = 'trade'
     WHERE t.type IN ('buy', 'sell')
       AND t.side IS NOT NULL
       AND EXISTS (SELECT 1 FROM portfolio_sources s
                     WHERE s.id = t.source_id AND s.workspace_id = $1)`,
    [workspaceId]
  );
  const repairedTxTypes = Number(repairRes.rowCount || 0);

  // 2. Remove false cash-flow rows whose type was an execution-side artifact.
  //    These were created by the old negative-list classifier treating 'buy'/
  //    'sell'/'crypto' as cash-flow types. Genuine event types are preserved.
  const cleanupRes = await pool.query(
    `DELETE FROM portfolio_cash_flows cf
     WHERE cf.type IN ('buy', 'sell', 'crypto', 'other')
       AND EXISTS (SELECT 1 FROM portfolio_sources s
                     WHERE s.id = cf.source_id AND s.workspace_id = $1)`,
    [workspaceId]
  );
  const removedFalseFlows = Number(cleanupRes.rowCount || 0);

  return { repairedTxTypes, removedFalseFlows };
}

// Reconciliation: detect duplicate instruments across sources (same normalized
// key appearing in >1 source). Warning-only — no automatic netting/transfer.
// Returns the conflicts + a basis for manual review.
async function getUnifiedReconciliation(pool, workspaceId) {
  if (!isEnabled()) return { enabled: false, duplicateInstruments: [] };
  const rows = await pool.query(
    `SELECT p.instrument_key,
            COUNT(DISTINCT s.id) AS source_count,
            ARRAY_AGG(DISTINCT s.provider) AS providers,
            ARRAY_AGG(DISTINCT p.symbol) AS symbols
     FROM portfolio_source_positions p
     JOIN portfolio_sources s ON s.id = p.source_id
     WHERE s.workspace_id=$1 AND p.instrument_key IS NOT NULL AND p.instrument_key <> ''
     GROUP BY p.instrument_key
     HAVING COUNT(DISTINCT s.id) > 1`,
    [workspaceId]
  );
  const duplicateInstruments = rows.rows.map((r) => ({
    instrumentKey: r.instrument_key,
    symbols: r.symbols,
    providers: r.providers,
    sourceCount: Number(r.source_count)
  }));
  return { enabled: true, duplicateInstruments };
}

// Persisted FX rates for the workspace base currency (read view for UI).
async function getUnifiedFxRates(pool, workspaceId) {
  const base = await getWorkspaceBaseCurrency(pool, workspaceId);
  const rows = await pool.query(
    `SELECT base, quote, rate, rate_source, as_of, fetched_at
     FROM portfolio_fx_rates WHERE base = $1 ORDER BY quote`,
    [base]
  );
  return { base, rates: rows.rows.map((r) => ({
    quote: r.quote, rate: Number(r.rate), rateSource: r.rate_source, asOf: r.as_of, fetchedAt: r.fetched_at
  })) };
}

// Record an immutable end-of-day unified snapshot into portfolio_daily_snapshots.
// Immutability: only seeds a row for today if one does not already exist (the
// first completed sync of the day wins). Later syncs do NOT overwrite completed
// EOD history. Stores the source breakdown + unified flag + base currency.
async function recordUnifiedSnapshot(pool, workspaceId, summary) {
  if (!isEnabled() || !summary) return null;
  const today = new Date().toISOString().slice(0, 10);
  const existing = await pool.query(
    `SELECT id FROM portfolio_daily_snapshots WHERE workspace_id=$1 AND snapshot_date=$2`,
    [workspaceId, today]
  );
  if (existing.rows.length) return existing.rows[0].id; // immutable: keep the day's first snapshot
  // Compute daily P&L/return from the most recent prior snapshot (immutable).
  const prevSnapshot = await pool.query(
    `SELECT portfolio_value, benchmark_value FROM portfolio_daily_snapshots
     WHERE workspace_id=$1 AND snapshot_date < $2 ORDER BY snapshot_date DESC LIMIT 1`,
    [workspaceId, today]
  );
  const prevValue = prevSnapshot.rows.length > 0 ? Number(prevSnapshot.rows[0].portfolio_value) : null;
  const dailyPnl = prevValue != null ? Number(summary.totalValue || 0) - prevValue : 0;
  const dailyReturn = prevValue ? dailyPnl / prevValue : 0;
  const res = await pool.query(
    `INSERT INTO portfolio_daily_snapshots
       (workspace_id, snapshot_date, portfolio_value, cash, invested_capital,
        daily_pnl, daily_return, realized_pnl, unrealized_pnl,
        benchmark_value, benchmark_return, benchmark_relative_return,
        deposits, withdrawals, fees, dividends,
        holdings_json, allocation_json, is_unified, base_currency, source_breakdown, estimated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,TRUE,$19,$20,FALSE)
     RETURNING id`,
    [
      workspaceId, today,
      Number(summary.totalValue || 0),
      Number(summary.cashValue || 0),
      Number(summary.investedValue || 0),
      dailyPnl,
      dailyReturn,
      0, // realized_pnl: computed during backfill from source transactions
      Number(summary.unrealizedValue || 0), // unrealized_pnl: sum of provider-reported unrealized
      null, // benchmark_value (populated during backfill)
      null, // benchmark_return
      null, // benchmark_relative_return
      Number(summary.deposits || 0),
      Number(summary.withdrawals || 0),
      0, // fees
      0, // dividends
      JSON.stringify(Array.isArray(summary.positions) ? summary.positions : []),
      JSON.stringify([]),
      summary.baseCurrency || "USD",
      JSON.stringify(summary.sources || [])
    ]
  );
  return res.rows[0].id;
}

// Recent unified snapshots (immutable EOD history) for the workspace.
async function getUnifiedSnapshots(pool, workspaceId, limit = 30) {
  const rows = await pool.query(
    `SELECT id, snapshot_date, portfolio_value, cash, invested_capital,
            realized_pnl, unrealized_pnl, daily_pnl, daily_return,
            benchmark_value, benchmark_return, benchmark_relative_return,
            deposits, withdrawals, fees, dividends,
            is_unified, base_currency, source, source_breakdown,
            snapshot_created_at, estimated
     FROM portfolio_daily_snapshots
     WHERE workspace_id=$1
     ORDER BY snapshot_date DESC LIMIT $2`,
    [workspaceId, limit]
  );
  return rows.rows.map((r) => ({
    id: r.id,
    snapshotDate: r.snapshot_date,
    portfolioValue: Number(r.portfolio_value),
    cash: Number(r.cash),
    investedCapital: Number(r.invested_capital),
    realizedPnl: Number(r.realized_pnl || 0),
    unrealizedPnl: Number(r.unrealized_pnl || 0),
    dailyPnl: Number(r.daily_pnl || 0),
    dailyReturn: r.daily_return != null ? Number(r.daily_return) : 0,
    benchmarkValue: r.benchmark_value != null ? Number(r.benchmark_value) : null,
    benchmarkReturn: r.benchmark_return != null ? Number(r.benchmark_return) : null,
    benchmarkRelativeReturn: r.benchmark_relative_return != null ? Number(r.benchmark_relative_return) : null,
    deposits: Number(r.deposits || 0),
    withdrawals: Number(r.withdrawals || 0),
    fees: Number(r.fees || 0),
    dividends: Number(r.dividends || 0),
    baseCurrency: r.base_currency,
    source: r.source,
    sourceBreakdown: r.source_breakdown,
    snapshotCreatedAt: r.snapshot_created_at,
    estimated: r.estimated === true
  }));
}

// Reconstruct an approximate equity curve from synced trade fills (Hyperliquid
// perps store realised P&L + fees in raw_payload_json). Snapshots are EOD-only
// and absent for fresh wallets, so this backfills history from fills.
//
// Method: anchor the curve to the CURRENT unified account value, then walk the
// fills in reverse, subtracting realised P&L that occurred AFTER each point.
// This yields "what was equity just before these realised P&Ls" — approximate
// (assumes unrealised contribution is roughly constant), clearly labelled.
async function getUnifiedEquityCurveFromFills(pool, workspaceId, limit = 180, opts = {}) {
  const { from = null, to = null, benchmark: benchmarkSymbol = "SPY" } = opts || {};
  const summary = await getUnifiedSummary(pool, workspaceId);
  const currentEquity = Number(summary.totalValue) || 0;
  const rows = await pool.query(
    `SELECT executed_at, fee_amount, raw_payload_json
     FROM user_workspace_trade_fills
     WHERE workspace_id=$1 AND raw_payload_json ? 'closedPnl'
     ORDER BY executed_at ASC`,
    [workspaceId]
  );
  const fills = rows.rows
    .map((r) => ({
      t: Number(new Date(r.executed_at).getTime()) || 0,
      realized: (Number(r.raw_payload_json?.closedPnl) || 0) - (Number(r.fee_amount) || 0)
    }))
    .filter((f) => f.t > 0);
  if (!fills.length) return [];

  // cumulative realised P&L AFTER each index (inclusive of later fills)
  const n = fills.length;
  const after = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) after[i] = after[i + 1] + fills[i + 1].realized;

  // Build one point per fill: equity before that fill's realised P&L.
  const allPts = fills.map((f, i) => ({ t: f.t, equity: currentEquity - after[i] }));
  // Append the live current point.
  allPts.push({ t: Date.now(), equity: currentEquity, live: true });

  // Daily forward-fill: emit one point per UTC day from the first fill to today,
  // carrying the last known equity forward. Real fill days keep estimated=false;
  // carry-forward (incl. weekends/holidays) are estimated=true. This guarantees a
  // continuous curve even for short windows with few/no fills, so the 1D/1W chart
  // is never blank and dailyReturn is non-degenerate.
  const DAY = 86400000;
  const startDay = Math.floor(allPts[0].t / DAY) * DAY;
  const endDay = Math.floor(Date.now() / DAY) * DAY;
  const lastByDay = new Map(); // utcDayTs -> point (latest fill/live point that day)
  for (const p of allPts) {
    const day = Math.floor(p.t / DAY) * DAY;
    const prev = lastByDay.get(day);
    if (!prev || p.t > prev.t) lastByDay.set(day, { ...p, estimated: false });
  }
  const dailyPts = [];
  let carried = null;
  for (let dayTs = startDay; dayTs <= endDay; dayTs += DAY) {
    const real = lastByDay.get(dayTs);
    if (real) {
      carried = real;
      dailyPts.push({ ...real, t: dayTs, estimated: false });
    } else if (carried) {
      // No fill that day: carry the last known equity forward (estimated).
      dailyPts.push({ t: dayTs, equity: carried.equity, estimated: true });
    }
  }
  // Fallback: if forward-fill produced nothing (shouldn't happen), use raw points.
  const ptsSource = dailyPts.length ? dailyPts : allPts.map((p) => ({ ...p, estimated: false }));

  // Apply optional [from, to] window (epoch ms or ISO date) before resampling.
  const lo = from != null ? (String(from).length <= 10 ? new Date(`${from}T00:00:00Z`).getTime() : Number(from)) : null;
  const hi = to != null ? (String(to).length <= 10 ? new Date(`${to}T00:00:00Z`).getTime() : Number(to)) : null;
  const pts = ptsSource.filter((p) => (lo == null || p.t >= lo) && (hi == null || p.t <= hi));
  if (!pts.length) return [];

  // Attach a real benchmark close (Yahoo, token-free) per point so the frontend
  // Benchmark card + buildBenchmarkSeries light up. Honors the caller-selected
  // benchmark symbol (e.g. SPY/QQQ/VT) instead of hardcoding SPY. Best-effort:
  // on any failure the benchmark stays null and the card falls back to "—".
  let benchMap = null;
  try {
    const series = await loadYahooSeries(String(benchmarkSymbol || "SPY").toUpperCase());
    if (series && series.size) {
      benchMap = series;
      for (const p of pts) {
        const d = new Date(p.t).toISOString().slice(0, 10);
        let v = benchMap.get(d);
        if (v == null) {
          for (let k = 1; k <= 7; k++) {
            const dd = new Date(p.t - k * DAY).toISOString().slice(0, 10);
            if (benchMap.has(dd)) { v = benchMap.get(dd); break; }
          }
        }
        p.benchmark = v != null ? Number(v) : null;
      }
    }
  } catch (_) {
    /* benchmark is best-effort */
  }

  // Resample to <= limit points to keep payload small.
  if (pts.length > limit) {
    const step = Math.ceil(pts.length / limit);
    const sampled = [];
    for (let i = 0; i < pts.length; i += step) sampled.push(pts[i]);
    if (sampled[sampled.length - 1]?.t !== pts[pts.length - 1].t) sampled.push(pts[pts.length - 1]);
    return sampled;
  }
  return pts;
}

// Backfill immutable EOD snapshots from the reconstructed equity curve so the
// performance chart shows REAL account history (e.g. June 2024 -> now) instead
// of only "today". Day-buckets the fill-anchored curve; one row per UTC day.
// Idempotent: a day that already has a snapshot is left untouched.
//
// NOTE: This fill-curve path is a TEMPORARY gap-filler for fresh wallets that
// have trade fills but no EOD snapshot history. It is NOT the canonical
// historical reconstruction path. The canonical path uses
// DailySnapshotService.runEod() with historical position + price reconstruction
// via assembleSnapshotInputs(). Once real snapshots exist, the fill-curve
// backfill is skipped (ON CONFLICT DO NOTHING).
async function backfillUnifiedSnapshotsFromFills(pool, workspaceId, limit = 365) {
  if (!isEnabled()) return 0;
  const curve = await getUnifiedEquityCurveFromFills(pool, workspaceId, limit);
  if (!Array.isArray(curve) || curve.length === 0) return 0;
  // Fetch the current summary once so backfilled rows carry the REAL cash + base
  // currency (previously cash was 0, invested_capital was faked to equity, and
  // base_currency was hardcoded USD — corrupting downstream cash/allocation reads).
  // invested_capital is unknown from fills, so we write 0 (honest) rather than fabricate.
  const summary = await getUnifiedSummary(pool, workspaceId).catch(() => null);
  const cashValue = Number(summary?.cashValue || 0);
  const baseCurrency = summary?.baseCurrency || "USD";
  // Day-bucket: keep the latest point per UTC day (the curve is already
  // daily-forward-filled, but multiple fills could still share a day).
  const byDay = new Map();
  for (const pt of curve) {
    const d = new Date(pt.t);
    if (!Number.isFinite(d.getTime())) continue;
    const day = d.toISOString().slice(0, 10);
    const prev = byDay.get(day);
    if (!prev || pt.t > prev.t) byDay.set(day, { day, t: pt.t, equity: Number(pt.equity) || 0 });
  }
  // Sort days chronologically to compute daily P&L and return.
  const sortedDays = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  let inserted = 0;
  let prevEquity = null;
  for (const { day, equity } of sortedDays) {
    try {
      const existing = await pool.query(
        `SELECT id FROM portfolio_daily_snapshots WHERE workspace_id=$1 AND snapshot_date=$2`,
        [workspaceId, day]
      );
      if (existing.rows.length) {
        prevEquity = prevEquity != null ? prevEquity : equity;
        continue; // immutable: never overwrite a real EOD row
      }
      const dailyPnl = prevEquity != null ? equity - prevEquity : 0;
      const dailyReturn = prevEquity ? dailyPnl / prevEquity : 0;
      await pool.query(
        `INSERT INTO portfolio_daily_snapshots
           (workspace_id, snapshot_date, portfolio_value, cash, invested_capital,
            daily_pnl, daily_return, realized_pnl, unrealized_pnl,
            holdings_json, allocation_json,
            is_unified, base_currency, source_breakdown, estimated, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,TRUE,'fill_curve')`,
        [
          workspaceId, day, equity, cashValue, 0,
          dailyPnl, dailyReturn, 0, 0,
          JSON.stringify([]), JSON.stringify([]),
          baseCurrency, JSON.stringify([])
        ]
      );
      prevEquity = equity;
      inserted++;
    } catch (_) { /* best-effort per-day */ }
  }
  return inserted;
}

// Mark a sync attempt start (for freshness/error tracking). Best-effort.
async function recordSyncStart(db, workspaceId, { provider, sourceType, connectionId }) {
  const result = await db.query(
    `UPDATE portfolio_sources
     SET last_attempted_sync_at=NOW(), sync_status='syncing', status='syncing', updated_at=NOW()
     WHERE workspace_id=$1 AND provider=$2 AND source_type=$3`,
    [workspaceId, provider, sourceType]
  );
  if (result && result.rowCount === 0) {
    await db.query(
      `INSERT INTO portfolio_sources
        (workspace_id, source_type, provider, external_connection_id, label, native_currency,
         access_mode, connection_status, sync_status, status, last_attempted_sync_at)
       VALUES ($1,$2,$3,$4,$5,'USD',$6,'pending','syncing','syncing',NOW())`,
      [workspaceId, sourceType, provider, connectionId || null, provider, sourceType === "brokerage" ? "oauth_read" : sourceType === "prediction" ? "wallet_public" : "watch_only"]
    ).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Coordinated workspace sync (recompute + manual backfill + run record).
// Real external syncs are triggered by the caller (POST /api/portfolio/sync
// orchestrates brokerage/exchange connections). Keeps last successful state on
// failure: this function never deletes good data — it only recomputes the read
// model and (when flag on) backfills the Manual source.
// ---------------------------------------------------------------------------

async function runWorkspaceSync(pool, workspaceId) {
  const runRes = await pool.query(
    `INSERT INTO portfolio_sync_runs (workspace_id, status) VALUES ($1,'running') RETURNING id`,
    [workspaceId]
  );
  const runId = runRes.rows[0].id;
  const perSource = [];
  try {
    const summary = await getUnifiedSummary(pool, workspaceId);
    for (const s of summary.sources) {
      perSource.push({ provider: s.provider, status: s.status, positionCount: s.positionCount, excluded: !!s.excluded });
    }
    await pool.query(
      `UPDATE portfolio_sync_runs SET status='complete', finished_at=NOW(), per_source=$1 WHERE id=$2`,
      [JSON.stringify(perSource), runId]
    );
  } catch (err) {
    await pool.query(
      `UPDATE portfolio_sync_runs SET status='error', finished_at=NOW(), per_source=$1 WHERE id=$2`,
      [JSON.stringify([{ error: String(err.message || err) }]), runId]
    );
    throw err;
  }
  const summary = await getUnifiedSummary(pool, workspaceId);
  // Immutable EOD unified snapshot (first completed sync of the day wins) +
  // historical backfill from the reconstructed equity curve so the performance
  // chart shows real account history, not just today.
  if (isEnabled()) {
    // Historical data remediation: repair legacy buy/sell transaction types
    // and remove any false cash-flow rows that were created by the old
    // negative-list classifier (type bug before this fix). Best-effort,
    // idempotent, never throws — see Execution Log Audit §12, §35-§37.
    try { await reconcileCashFlows(pool, workspaceId); } catch (_) { /* best-effort */ }
    try { await recordUnifiedSnapshot(pool, workspaceId, summary); } catch (_) { /* history is best-effort */ }
    try { await backfillUnifiedSnapshotsFromFills(pool, workspaceId); } catch (_) { /* history is best-effort */ }
  }
  return { runId, perSource, summary };
}

module.exports = {
  isEnabled,
  ensureUnifiedPortfolioSchema,
  recordSourceSync,
  recordSyncStart,
  reconcileCashFlows,
  getUnifiedSummary,
  getUnifiedPositions,
  getUnifiedSources,
  getUnifiedSyncStatus,
  getUnifiedTransactions,
  getUnifiedReconciliation,
  getUnifiedFxRates,
  getUnifiedSnapshots,
  getUnifiedEquityCurveFromFills,
  recordUnifiedSnapshot,
  getUnifiedShadowComparison,
  recordFxRate,
  fetchFxRate,
  runWorkspaceSync,
  mapHyperliquidToSource,
  mapExchangeWalletToSource,
  mapManualToSource,
  mapPredictionWalletToSource,
  normalizeSourceContract,
  mapSnapTradeToSource,
  normalizeInstrumentKey,
  classifyCashFlow,
  normalizeTxType,
  isExecutableTx,
  normalizeTransaction,
  EXECUTION_TYPES,
  CASH_FLOW_TYPES
};
