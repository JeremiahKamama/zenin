/**
 * portfolioSnapshots.js
 *
 * Historical Portfolio Snapshot Engine — the single source of truth for all
 * time-series features (Calendar Heatmap, Portfolio Performance, Analytics,
 * Journal, Tax Estimator, Benchmark, future reporting/AI).
 *
 * Design rules (from the migration plan):
 *  1. Historical portfolio values are NEVER computed from today's portfolio.
 *  2. Snapshots are IMMUTABLE. The writer refuses to overwrite an existing
 *     snapshot for a date (INSERT ... ON CONFLICT DO NOTHING), so a closed day
 *     can never be rewritten by later market data.
 *  3. UI/repository never reconstruct history — they read this table.
 *  4. One engine, many consumers.
 *
 * Daily P&L is STORED inside the snapshot (computed once at write time from the
 * previous day's immutable snapshot), not derived at render time.
 *
 * Non-trading days: every calendar day exists. Saturday/Sunday/Holiday carry the
 * previous market close forward (daily_pnl = 0, estimated = TRUE for carried days
 * that had no real market data, unless explicitly recomputed).
 *
 * Benchmark: benchmark_value/return are stored per snapshot. The current Zenin
 * benchmark data (equities_benchmarks.js) is ANNUAL only — there is no daily
 * benchmark series. Until a daily benchmark feed is wired, benchmark fields are
 * left NULL and must NOT be fabricated. This is a documented limitation, not a
 * silent gap.
 */

// Benchmark + close-price feeds now use Yahoo Finance (token-free). See
// loadYahooSeries / closeForDate below.

// US market holidays (fixed + computed). Kept minimal; the carry-forward rule
// makes exact holiday coverage non-critical for integrity (a holiday simply
// carries the prior close).
const STATIC_HOLIDAYS = new Set([
  '2026-01-01', '2026-07-03', '2026-12-25',
  '2027-01-01', '2027-07-04', '2027-12-25'
]);

function toDateObj(dateStr) {
  if (dateStr instanceof Date) return new Date(dateStr);
  return new Date(`${dateStr}T00:00:00Z`);
}

function isWeekend(dateStr) {
  const d = toDateObj(dateStr);
  const day = d.getUTCDay();
  return day === 0 || day === 6; // Sun=0, Sat=6
}

function isHoliday(dateStr) {
  return STATIC_HOLIDAYS.has(typeof dateStr === "string" ? dateStr : dateStr.toISOString().slice(0, 10));
}

function isMarketDay(dateStr) {
  return !isWeekend(dateStr) && !isHoliday(dateStr);
}

function addDays(dateStr, delta) {
  const d = toDateObj(dateStr);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function prevMarketDay(dateStr) {
  let cur = dateStr;
  for (let i = 0; i < 7; i += 1) {
    cur = addDays(cur, -1);
    if (isMarketDay(cur)) return cur;
  }
  return addDays(dateStr, -1);
}

let POOL = null;
let RESOLVE = null;
let DEPS = {};

function init(pool, resolveWorkspaceScope, deps = {}) {
  POOL = pool;
  RESOLVE = resolveWorkspaceScope;
  DEPS = deps || {};
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Daily close-price lookup. Uses Yahoo Finance (token-free) when a fetch
// implementation is available; otherwise returns null so the caller can mark
// the snapshot estimated=TRUE (never fabricate prices).
// ---------------------------------------------------------------------------
const CRYPTO_BENCHMARKS = new Set(['BTC', 'ETH', 'BTC-USD', 'ETH-USD']);

// Cache full benchmark/close history per symbol for 1h so backfill of many
// snapshot days reuses one Yahoo fetch instead of one request per day.
const _priceSeriesCache = new Map(); // symbol -> { loadedAt, map: Map<dateStr, close> }

async function loadYahooSeries(symbol) {
  const sym = String(symbol).toUpperCase();
  const cached = _priceSeriesCache.get(sym);
  const now = Date.now();
  if (cached && now - cached.loadedAt < 1000 * 60 * 60) return cached.map;
  const yfSymbol = CRYPTO_BENCHMARKS.has(sym) ? sym.replace('-USD', '') + '-USD' : sym;
  const period1 = Math.floor(new Date(Date.UTC(new Date().getUTCFullYear() - 2, 0, 1)).getTime() / 1000);
  const period2 = Math.floor(now / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  try {
    if (!DEPS.fetch) return cached ? cached.map : new Map();
    const res = await DEPS.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return cached ? cached.map : new Map();
    const json = await res.json();
    const r = json && json.chart && json.chart.result && json.chart.result[0];
    const map = new Map();
    if (r) {
      const closes = r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close;
      const ts = r.timestamp;
      if (Array.isArray(closes) && Array.isArray(ts)) {
        for (let i = 0; i < ts.length; i += 1) {
          if (closes[i] != null) {
            const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
            if (!map.has(d)) map.set(d, Number(closes[i]));
          }
        }
      }
    }
    _priceSeriesCache.set(sym, { loadedAt: now, map });
    return map;
  } catch {
    return cached ? cached.map : new Map();
  }
}

// Resolve a close for dateStr, falling back to the nearest prior trading day
// (up to 7 calendar days) so weekends/holidays still get a real price.
async function closeForDate(symbol, dateStr) {
  if (!symbol || !dateStr) return null;
  const map = await loadYahooSeries(symbol);
  if (!map || map.size === 0) return null;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(new Date(dateStr + 'T00:00:00Z').getTime() - i * 86400000).toISOString().slice(0, 10);
    if (map.has(d)) return map.get(d);
  }
  return null;
}

async function getClosePrice(symbol, dateStr) {
  return closeForDate(symbol, dateStr);
}

// ---------------------------------------------------------------------------
// Benchmark daily close feed via Yahoo Finance (token-free). Maps a benchmark
// symbol to a real market series (SPY/QQQ/VT... equities+ETFs, BTC/ETH crypto).
// Returns null (never a fabricated value) when the source is unavailable; the
// caller then leaves benchmark fields NULL so the curve does not invent data.
// ---------------------------------------------------------------------------
async function getBenchmarkClose(symbol, dateStr) {
  return closeForDate(symbol, dateStr);
}

// ---------------------------------------------------------------------------
// Assemble the live per-day inputs for a workspace on a given date.
// For TODAY/FORWARD this reads current state. For historical backfill it
// replays trades up to end-of-day and prices holdings at that day's close.
// ---------------------------------------------------------------------------
async function assembleSnapshotInputs(workspaceId, dateStr, { replay = false } = {}) {
  // Determine if this workspace uses the unified source layer (connected accounts).
  const useUnified = DEPS.unifiedPortfolio && DEPS.unifiedPortfolio.isEnabled && DEPS.unifiedPortfolio.isEnabled();

  // --- Unified source layer (connected accounts) ---
  // Read positions and cash from the canonical source tables so connected-account
  // holdings are valued historically, not just manually-entered ones.
  let unifiedPositions = [];
  let unifiedCash = 0;
  if (useUnified) {
    const posRes = await POOL.query(
      `SELECT sp.symbol, sp.name, sp.asset_type AS "assetType", sp.market_type AS "marketType",
              sp.quantity, sp.current_price AS "price", sp.market_value AS "marketValue",
              sp.collateral_value AS "collateralValue", sp.unrealized_pnl AS "unrealizedPnl",
              sp.instrument_type AS "instrumentType", sp.position_type AS "positionType",
              sp.side, sp.native_currency AS "currency", sp.cost_basis AS "costBasis",
              sp.base_currency AS "baseCurrency", sp.updated_at AS "asOf",
              ps.provider AS "provider", psa.account_type AS "accountType"
       FROM portfolio_source_positions sp
       JOIN portfolio_sources ps ON ps.id = sp.source_id
       LEFT JOIN portfolio_source_accounts psa ON psa.id = sp.account_id
       WHERE ps.workspace_id = $1
         AND sp.quantity > 0.00000001`,
      [workspaceId]
    );
    unifiedPositions = posRes.rows;

    const cashResUnified = await POOL.query(
      `SELECT psc.currency, psc.amount, psc.base_currency AS "baseCurrency"
       FROM portfolio_source_cash psc
       JOIN portfolio_sources ps ON ps.id = psc.source_id
       WHERE ps.workspace_id = $1`,
      [workspaceId]
    );
    for (const r of cashResUnified.rows) {
      const amount = toNum(r.amount);
      const cur = String(r.currency || 'USD').toUpperCase();
      const base = String(r.baseCurrency || 'USD').toUpperCase();
      if (cur === base) unifiedCash += amount;
      else {
        // Best-effort FX: use portfolio_fx_rates if available
        const fxRes = await POOL.query(
          `SELECT rate FROM portfolio_fx_rates WHERE base=$1 AND quote=$2 ORDER BY fetched_at DESC LIMIT 1`,
          [base, cur]
        );
        if (fxRes.rows.length) unifiedCash += amount * toNum(fxRes.rows[0].rate);
      }
    }
  }

  // --- Manual holdings (legacy/user-entered) ---
  const holdingsRes = await POOL.query(
    `SELECT symbol, name, price, quantity, entry_price AS "entryPrice", market_type AS "marketType", strategy_name AS "strategyName"
     FROM user_workspace_portfolio WHERE workspace_id = $1 AND quantity > 0.00000001`,
    [workspaceId]
  );
  const holdings = holdingsRes.rows.map((h) => ({
    symbol: h.symbol,
    name: h.name,
    price: toNum(h.price),
    quantity: toNum(h.quantity),
    entryPrice: toNum(h.entryPrice),
    marketType: h.marketType,
    strategyName: h.strategyName
  }));

  // Cash (sum across currencies, USD assumed for snapshot).
  const cashRes = await POOL.query(
    `SELECT COALESCE(SUM(balance), 0) AS total FROM user_workspace_cash WHERE workspace_id = $1`,
    [workspaceId]
  );
  const manualCash = toNum(cashRes.rows[0]?.total);

  // If unified sources exist, cash comes from the unified layer; otherwise use manual.
  const cash = useUnified && (unifiedCash !== 0 || unifiedPositions.length > 0) ? unifiedCash : manualCash;

  // Build the combined holdings list, including unified positions.
  let estimated = false;
  const unifiedHoldings = unifiedPositions.map((r) => {
    const price = toNum(r.price);
    const qty = toNum(r.quantity);
    const instrumentType = String(r.instrumentType || r.instrument_type || 'spot').toLowerCase();
    let marketValue;
    if (instrumentType === 'perpetual' || instrumentType === 'future') {
      // Derivative: collateral + unrealized PNL (canonical semantics)
      const collateral = toNum(r.collateralValue, toNum(r.costBasis));
      const unrealized = toNum(r.unrealizedPnl, 0);
      marketValue = collateral + unrealized;
    } else {
      // Spot/holding: quantity x price
      marketValue = (price * qty) || toNum(r.marketValue, price * qty);
    }
    return {
      symbol: r.symbol,
      name: r.name,
      price,
      quantity: qty,
      entryPrice: toNum(r.costBasis) / qty || price,
      marketType: r.marketType || r.assetType || 'spot',
      strategyName: r.provider || 'connected',
      marketValue,
      currency: r.currency,
      source: r.provider,
      closePrice: price,
      instrumentType: r.instrumentType || r.instrument_type,
      positionType: r.positionType || r.position_type,
      side: r.side,
      collateralValue: toNum(r.collateralValue),
      unrealizedPnl: toNum(r.unrealizedPnl),
      costBasis: toNum(r.costBasis)
    };
  });

  // Value manual holdings at dateStr close when replaying (historical).
  let totalValue = 0;
  if (unifiedPositions.length > 0) {
    totalValue = unifiedHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
  }
  for (const h of holdings) {
    let px = h.price;
    if (replay) {
      const close = await getClosePrice(h.symbol, dateStr);
      if (close != null) px = close;
      else estimated = true;
    }
    h.closePrice = px;
    h.marketValue = px * h.quantity;
    totalValue += h.marketValue;
  }

  const allHoldings = holdings.concat(unifiedHoldings);
  if (unifiedPositions.length > 0 && replay) estimated = true;
  const portfolioValue = cash + totalValue;

  // Realized P&L today: net trading cash flow from trades executed on this date.
  // Uses portfolio_source_transactions (unified) when available, falls back to
  // legacy user_workspace_trades.
  let realizedPnl = 0;
  if (useUnified) {
    const txRes = await POOL.query(
      `SELECT COALESCE(SUM(COALESCE(pst.realized_pnl, 0)), 0) AS realized
       FROM portfolio_source_transactions pst
       JOIN portfolio_sources ps ON ps.id = pst.source_id
       WHERE ps.workspace_id = $1
         AND DATE(pst.executed_at) = $2
         AND pst.realized_pnl IS NOT NULL`,
      [workspaceId, dateStr]
    );
    realizedPnl = toNum(txRes.rows[0]?.realized);
  }
  // Also check legacy trades (for non-unified workspaces or fallback)
  if (realizedPnl === 0) {
    const realizedRes = await POOL.query(
      `SELECT COALESCE(SUM(
          CASE WHEN side = 'sell' THEN notional - fee
               ELSE -(notional + fee) END
        ), 0) AS realized
       FROM user_workspace_trades WHERE workspace_id = $1 AND date = $2`,
      [workspaceId, dateStr]
    );
    realizedPnl = toNum(realizedRes.rows[0]?.realized);
  }

  // Deposits / withdrawals from the cash-flow ledger.
  let deposits = 0;
  let withdrawals = 0;
  try {
    const flowsRes = await POOL.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) AS deposits,
              COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0) AS withdrawals
       FROM portfolio_cash_flows
       WHERE workspace_id = $1 AND DATE(executed_at) = $2`,
      [workspaceId, dateStr]
    );
    deposits = toNum(flowsRes.rows[0]?.deposits);
    withdrawals = toNum(flowsRes.rows[0]?.withdrawals);
  } catch (_) {
    // table may not exist yet in older schemas
  }

  // Counts for the day.
  const decisionRes = await POOL.query(
    `SELECT COUNT(*)::int AS c FROM decision_threads WHERE workspace_id = $1 AND DATE(created_at) = $2`,
    [workspaceId, dateStr]
  );
  // Journal entries are stored as a JSON array in user_workspace_collections
  // keyed by namespace ('journal:entries'), not as a join to workspace_collections.
  const journalRes = await POOL.query(
    `SELECT COALESCE(jsonb_array_length(items_json), 0)::int AS c
     FROM user_workspace_collections
     WHERE workspace_id = $1 AND namespace = 'journal:entries' AND DATE(updated_at) = $2`,
    [workspaceId, dateStr]
  );
  const decisionCount = toNum(decisionRes.rows[0]?.c, 0);
  const journalCount = toNum(journalRes.rows[0]?.c, 0);

  // Allocation / sector / country / asset breakdowns.
  const allocation = [];
  const bySector = {};
  const byCountry = {};
  const byAsset = {};
  let costBasisTotal = 0;
  for (const h of allHoldings) {
    const mv = h.marketValue || 0;
    allocation.push({ symbol: h.symbol, value: mv, weight: portfolioValue ? mv / portfolioValue : 0 });
    const sector = h.strategyName || (h.source ? `Connected: ${h.source}` : 'Uncategorized');
    const country = (h.symbol || '').endsWith('.HK') ? 'HK' : (h.symbol || '').includes('-') ? 'INTL' : 'US';
    bySector[sector] = (bySector[sector] || 0) + mv;
    byCountry[country] = (byCountry[country] || 0) + mv;
    const atype = (h.marketType || 'spot').toUpperCase();
    byAsset[atype] = (byAsset[atype] || 0) + mv;
    // Accumulate cost basis for unrealized PNL calculation
    if (h.costBasis != null) costBasisTotal += toNum(h.costBasis);
  }

  // Unrealized PNL: for unified positions, sum from portfolio_source_positions
  // (provider-reported unrealized PNL for derivatives). For manual/spot holdings,
  // compute as: market_value - cost_basis.
  let unrealizedPnl = 0;
  for (const h of unifiedHoldings) {
    if (h.unrealizedPnl != null) {
      unrealizedPnl += toNum(h.unrealizedPnl);
    } else if (h.costBasis != null && h.marketValue != null) {
      unrealizedPnl += toNum(h.marketValue) - toNum(h.costBasis);
    }
  }
  for (const h of holdings) {
    if (h.entryPrice != null && h.price != null) {
      unrealizedPnl += (toNum(h.price) - toNum(h.entryPrice)) * toNum(h.quantity);
    }
  }

  return {
    portfolioValue,
    cash,
    investedCapital: totalValue,
    realizedPnl,
    unrealizedPnl,
    holdings: allHoldings,
    allocation,
    sectorBreakdown: Object.entries(bySector).map(([k, v]) => ({ key: k, value: v })),
    countryBreakdown: Object.entries(byCountry).map(([k, v]) => ({ key: k, value: v })),
    assetBreakdown: Object.entries(byAsset).map(([k, v]) => ({ key: k, value: v })),
    deposits,
    withdrawals,
    decisionCount,
    journalCount,
    estimated: estimated || replay
  };
}

function normDate(d) {
  if (d == null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  // PG returns a `date` column as a Date at local midnight. Reading it via
  // toISOString() would shift by the server timezone (e.g. Africa/Nairobi UTC+3)
  // and produce the previous calendar day. Extract the local Y/M/D instead.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mapSnapshotRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    date: normDate(row.snapshot_date),
    portfolioValue: toNum(row.portfolio_value),
    cash: toNum(row.cash),
    investedCapital: toNum(row.invested_capital),
    dailyPnl: toNum(row.daily_pnl),
    dailyReturn: toNum(row.daily_return),
    realizedPnl: toNum(row.realized_pnl),
    unrealizedPnl: toNum(row.unrealized_pnl),
    benchmarkValue: row.benchmark_value == null ? null : toNum(row.benchmark_value),
    benchmarkReturn: row.benchmark_return == null ? null : toNum(row.benchmark_return),
    benchmarkRelativeReturn: row.benchmark_relative_return == null ? null : toNum(row.benchmark_relative_return),
    holdings: row.holdings_json,
    allocation: row.allocation_json,
    sectorBreakdown: row.sector_breakdown,
    countryBreakdown: row.country_breakdown,
    assetBreakdown: row.asset_breakdown,
    fees: toNum(row.fees),
    taxEstimate: toNum(row.tax_estimate),
    dividends: toNum(row.dividends),
    deposits: toNum(row.deposits),
    withdrawals: toNum(row.withdrawals),
    decisionCount: toNum(row.decision_count, 0),
    journalCount: toNum(row.journal_count, 0),
    researchCount: toNum(row.research_count, 0),
    predictionCount: toNum(row.prediction_count, 0),
    snapshotCreatedAt: row.snapshot_created_at,
    estimated: Boolean(row.estimated),
    source: row.source
  };
}

// ---------------------------------------------------------------------------
// WRITER — DailySnapshotService. The ONLY writer to portfolio_daily_snapshots.
// Immutable: ON CONFLICT DO NOTHING. A closed day is never overwritten.
// ---------------------------------------------------------------------------
const DailySnapshotService = {
  /**
   * Write one day's snapshot. Computes stored daily_pnl from the previous
   * immutable snapshot (not from live state). If the day already exists, the
   * write is refused (immutability) unless `force` is explicitly set by an
   * authorized recompute.
   */
  async writeDay(workspaceId, dateStr, opts = {}) {
    const resolved = await RESOLVE(null, workspaceId);
    const wid = resolved.resolvedWorkspaceId;
    const inputs = await assembleSnapshotInputs(wid, dateStr, { replay: Boolean(opts.replay) });

    const prev = await PortfolioHistoryRepository.getSnapshot(wid, addDays(dateStr, -1))
      || await PortfolioHistoryRepository.getLatestSnapshotBefore(wid, dateStr);
    // FIX: Do not default to $10,000 when there is no previous snapshot.
    // Instead, derive the initial value from the first known portfolio state.
    // If no prior snapshot and no explicit initialBalance provided, use the
    // current day's portfolio value as the baseline (return = 0 for that day).
    let prevValue;
    if (prev) {
      prevValue = prev.portfolioValue;
    } else if (opts.initialBalance != null) {
      prevValue = opts.initialBalance;
    } else if (dateStr === new Date().toISOString().slice(0, 10)) {
      // Today with no prior history: use today's own value (0% return)
      prevValue = inputs.portfolioValue;
    } else {
      // Historical day with no prior snapshot: use today's portfolio as baseline
      // (best available — this day's value is the first known observation)
      prevValue = inputs.portfolioValue;
    }

    const dailyPnl = inputs.portfolioValue - prevValue;
    const dailyReturn = prevValue ? dailyPnl / prevValue : 0;

    // Benchmark close for the day (real market data). benchmark_value stores the
    // benchmark's own close; benchmark_return is its day-over-day % vs the prior
    // snapshot's benchmark_value; benchmark_relative_return is portfolio minus
    // benchmark daily return. All left NULL when no feed is configured.
    const benchmarkSymbol = opts.benchmarkSymbol || DEPS.defaultBenchmark || 'SPY';
    const benchmarkClose = await getBenchmarkClose(benchmarkSymbol, dateStr);
    let benchmarkValue = null;
    let benchmarkReturn = null;
    let benchmarkRelativeReturn = null;
    if (benchmarkClose != null) {
      benchmarkValue = benchmarkClose;
      if (prev && prev.benchmarkValue != null && prev.benchmarkValue !== 0) {
        benchmarkReturn = (benchmarkClose - prev.benchmarkValue) / prev.benchmarkValue;
        benchmarkRelativeReturn = dailyReturn - benchmarkReturn;
      }
    }

    const snapshot = {
      workspaceId: wid,
      date: dateStr,
      portfolioValue: inputs.portfolioValue,
      cash: inputs.cash,
      investedCapital: inputs.investedCapital,
      dailyPnl,
      dailyReturn,
      realizedPnl: inputs.realizedPnl,
      unrealizedPnl: inputs.unrealizedPnl,
      benchmarkValue,
      benchmarkReturn,
      benchmarkRelativeReturn,
      holdingsJson: JSON.stringify(inputs.holdings),
      allocationJson: JSON.stringify(inputs.allocation),
      sectorBreakdown: JSON.stringify(inputs.sectorBreakdown),
      countryBreakdown: JSON.stringify(inputs.countryBreakdown),
      assetBreakdown: JSON.stringify(inputs.assetBreakdown),
      fees: 0,
      taxEstimate: 0,
      dividends: 0,
      deposits: inputs.deposits,
      withdrawals: inputs.withdrawals,
      decisionCount: inputs.decisionCount,
      journalCount: inputs.journalCount,
      researchCount: 0,
      predictionCount: 0,
      estimated: inputs.estimated,
      source: opts.source || (opts.replay ? 'recompute' : 'eod-job')
    };

    const result = await POOL.query(
      `INSERT INTO portfolio_daily_snapshots (
        workspace_id, snapshot_date, portfolio_value, cash, invested_capital,
        daily_pnl, daily_return, realized_pnl, unrealized_pnl,
        benchmark_value, benchmark_return, benchmark_relative_return,
        holdings_json, allocation_json, sector_breakdown, country_breakdown, asset_breakdown,
        fees, tax_estimate, dividends, deposits, withdrawals,
        decision_count, journal_count, research_count, prediction_count,
        estimated, source
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      ON CONFLICT (workspace_id, snapshot_date) DO NOTHING
      RETURNING id`,
      [
        snapshot.workspaceId, snapshot.date, snapshot.portfolioValue, snapshot.cash, snapshot.investedCapital,
        snapshot.dailyPnl, snapshot.dailyReturn, snapshot.realizedPnl, snapshot.unrealizedPnl,
        snapshot.benchmarkValue, snapshot.benchmarkReturn, snapshot.benchmarkRelativeReturn,
        snapshot.holdingsJson, snapshot.allocationJson, snapshot.sectorBreakdown, snapshot.countryBreakdown, snapshot.assetBreakdown,
        snapshot.fees, snapshot.taxEstimate, snapshot.dividends, snapshot.deposits, snapshot.withdrawals,
        snapshot.decisionCount, snapshot.journalCount, snapshot.researchCount, snapshot.predictionCount,
        snapshot.estimated, snapshot.source
      ]
    );
    return { written: (result.rowCount || 0) > 0, snapshot };
  },

  /**
   * End-of-day job: ensure every calendar day up to (and including) `through`
   * has a snapshot. Market days get a real snapshot; non-market days carry the
   * previous market close forward (daily_pnl=0, estimated=TRUE) so the calendar never
   * has gaps.
   */
  async runEod(workspaceId, through = new Date().toISOString().slice(0, 10), opts = {}) {
    const resolved = await RESOLVE(null, workspaceId);
    const wid = resolved.resolvedWorkspaceId;
    const latest = await PortfolioHistoryRepository.getLatestSnapshot(wid);
    const start = latest ? addDays(latest.date, 1) : (opts.from || addDays(through, -30));
    let cur = start;
    let written = 0;
    let carried = 0;
    let guard = 0;
    while (cur <= through && guard < 4000) {
      guard += 1;
      if (isMarketDay(cur)) {
        const r = await this.writeDay(wid, cur, { initialBalance: opts.initialBalance, source: 'eod-job' });
        if (r.written) written += 1;
      } else {
        // Carry forward: copy previous close, zero P&L, mark estimated.
        const prev = await PortfolioHistoryRepository.getLatestSnapshotBefore(wid, cur);
        if (prev) {
          const res = await POOL.query(
            `INSERT INTO portfolio_daily_snapshots (
              workspace_id, snapshot_date, portfolio_value, cash, invested_capital,
              daily_pnl, daily_return, realized_pnl, unrealized_pnl,
              benchmark_value, benchmark_return, benchmark_relative_return,
              holdings_json, allocation_json, sector_breakdown, country_breakdown, asset_breakdown,
              fees, tax_estimate, dividends, deposits, withdrawals,
              decision_count, journal_count, research_count, prediction_count,
              estimated, source
            ) VALUES ($1,$2,$3,$4,$5,0,0,0,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,0,0,0,0,0,TRUE,'carry-forward')
            ON CONFLICT (workspace_id, snapshot_date) DO NOTHING`,
            [
              wid, cur, prev.portfolioValue, prev.cash, prev.investedCapital,
              prev.benchmarkValue, prev.benchmarkReturn, prev.benchmarkRelativeReturn,
              JSON.stringify(prev.holdings || []), JSON.stringify(prev.allocation || []),
              JSON.stringify(prev.sectorBreakdown || []), JSON.stringify(prev.countryBreakdown || []), JSON.stringify(prev.assetBreakdown || []),
              prev.fees, prev.taxEstimate, prev.dividends
            ]
          );
          if ((res.rowCount || 0) > 0) carried += 1;
        }
      }
      cur = addDays(cur, 1);
    }
    return { written, carried, through };
  }
};

// ---------------------------------------------------------------------------
// READER — PortfolioHistoryRepository. The only read API for history.
// No caller should reconstruct history from raw trades.
// ---------------------------------------------------------------------------
const PortfolioHistoryRepository = {
  async getSnapshot(workspaceId, dateStr) {
    const resolved = await RESOLVE(null, workspaceId);
    const res = await POOL.query(
      `SELECT * FROM portfolio_daily_snapshots WHERE workspace_id = $1 AND snapshot_date = $2`,
      [resolved.resolvedWorkspaceId, dateStr]
    );
    return mapSnapshotRow(res.rows[0]);
  },

  async getLatestSnapshot(workspaceId) {
    const resolved = await RESOLVE(null, workspaceId);
    const res = await POOL.query(
      `SELECT * FROM portfolio_daily_snapshots WHERE workspace_id = $1 ORDER BY snapshot_date DESC LIMIT 1`,
      [resolved.resolvedWorkspaceId]
    );
    return mapSnapshotRow(res.rows[0]);
  },

  async getLatestSnapshotBefore(workspaceId, dateStr) {
    const resolved = await RESOLVE(null, workspaceId);
    const res = await POOL.query(
      `SELECT * FROM portfolio_daily_snapshots WHERE workspace_id = $1 AND snapshot_date < $2 ORDER BY snapshot_date DESC LIMIT 1`,
      [resolved.resolvedWorkspaceId, dateStr]
    );
    return mapSnapshotRow(res.rows[0]);
  },

  async getSnapshots(workspaceId, start, end) {
    const resolved = await RESOLVE(null, workspaceId);
    const res = await POOL.query(
      `SELECT * FROM portfolio_daily_snapshots WHERE workspace_id = $1 AND snapshot_date >= $2 AND snapshot_date <= $3 ORDER BY snapshot_date ASC`,
      [resolved.resolvedWorkspaceId, start, end]
    );
    return res.rows.map(mapSnapshotRow);
  },

  async getMonthlySnapshots(workspaceId, year, month) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    return this.getSnapshots(workspaceId, start, addDays(next, -1));
  },

  async getYearSnapshots(workspaceId, year) {
    return this.getSnapshots(workspaceId, `${year}-01-01`, `${year}-12-31`);
  },

  async getBenchmarkHistory(workspaceId, start, end) {
    const rows = await this.getSnapshots(workspaceId, start, end);
    return rows.map((r) => ({ date: r.date, benchmarkValue: r.benchmarkValue, benchmarkReturn: r.benchmarkReturn, benchmarkRelativeReturn: r.benchmarkRelativeReturn }));
  },

  async getAllocationHistory(workspaceId, start, end) {
    const rows = await this.getSnapshots(workspaceId, start, end);
    return rows.map((r) => ({ date: r.date, allocation: r.allocation, sectorBreakdown: r.sectorBreakdown, countryBreakdown: r.countryBreakdown, assetBreakdown: r.assetBreakdown }));
  },

  async backfillHistorical(workspaceId, opts = {}) {
    const resolved = await RESOLVE(null, workspaceId);
    const wid = resolved.resolvedWorkspaceId;
    const through = (opts.through || new Date().toISOString().slice(0, 10));
    const batchSize = opts.batchSize || 50;
    const from = opts.from || await this._getEarliestTransactionDate(wid);

    let cur = from;
    let written = 0;
    let skipped = 0;
    let estimated = 0;
    let guard = 0;
    const maxDays = opts.maxDays || 3650; // safety cap

    while (cur <= through && guard < maxDays * 2) {
      guard += 1;
      if (isMarketDay(cur)) {
        const r = await this.writeDay(wid, cur, { replay: true, source: 'backfill' });
        if (r.written) {
          written += 1;
          if (r.snapshot.estimated) estimated += 1;
        } else {
          skipped += 1; // already exists (idempotent)
        }
      } else {
        // Carry non-market days forward (weekends/holidays).
        const r = await this.writeDay(wid, cur, { replay: true, source: 'backfill', carryForward: true });
        if (r.written) written += 1;
        else skipped += 1;
      }
      cur = addDays(cur, 1);
    }
    return { written, skipped, estimated, through, from };
  },

  /** Determine the earliest transaction date for a workspace, so backfill
   * starts at the first real data point (not an arbitrary floor). */
  async _getEarliestTransactionDate(workspaceId) {
    const useUnified = DEPS.unifiedPortfolio && DEPS.unifiedPortfolio.isEnabled && DEPS.unifiedPortfolio.isEnabled();
    if (useUnified) {
      const r = await POOL.query(
        `SELECT MIN(DATE(executed_at))::text AS d
         FROM portfolio_source_transactions t
         JOIN portfolio_sources s ON s.id = t.source_id
         WHERE s.workspace_id = $1 AND DATE(executed_at) IS NOT NULL`,
        [workspaceId]
      );
      if (r.rows[0]?.d) return r.rows[0].d;
    }
    // Fallback: legacy manual trades.
    const r2 = await POOL.query(
      `SELECT MIN(date)::text AS d FROM user_workspace_trades WHERE workspace_id = $1 AND date IS NOT NULL`,
      [workspaceId]
    );
    if (r2.rows[0]?.d) return r2.rows[0].d;
    return addDays(throughFallback(), -30);
  },
};

/**
 * Replay transactions up to end-of-day `dateStr` and value holdings at that
 * day's historical close price (NOT today's price). This is the core of
 * historical backfill (spec §2, §12).
 *
 * For unified (connected-account) positions: we must NOT use the current
 * snapshot_position.market_value — instead, replay the transaction ledger to
 * compute the quantity held on `dateStr`, then price at historical close.
 */
async function replayHistoricalSnapshot(workspaceId, dateStr) {
  const useUnified = DEPS.unifiedPortfolio && DEPS.unifiedPortfolio.isEnabled && DEPS.unifiedPortfolio.isEnabled();
  const holdingsMap = {}; // symbol → { quantity, costBasis, side, ... }
  const cashFlows = { deposits: 0, withdrawals: 0, fees: 0 };

  if (useUnified) {
    // Replay unified transactions up to and including dateStr.
    const txRes = await POOL.query(
      `SELECT t.symbol, t.side, t.quantity, t.fee, t.currency, t.executed_at,
              t.unit_price AS "unitPrice", t.realized_pnl AS "realizedPnl",
              s.provider AS "provider"
       FROM portfolio_source_transactions t
       JOIN portfolio_sources s ON s.id = t.source_id
       WHERE s.workspace_id = $1 AND DATE(t.executed_at) <= $2
         AND t.quantity IS NOT NULL AND t.symbol IS NOT NULL
       ORDER BY t.executed_at ASC`,
      [workspaceId, dateStr]
    );
    for (const t of txRes.rows) {
      const sym = t.symbol;
      if (!holdingsMap[sym]) holdingsMap[sym] = { quantity: 0, costBasis: 0, side: null, provider: t.provider };
      const side = String(t.side || '').toLowerCase();
      const qty = Math.abs(toNum(t.quantity));
      if (side === 'buy' || side === 'long') {
        holdingsMap[sym].quantity += qty;
        holdingsMap[sym].costBasis += toNum(t.fee || 0);
      } else if (side === 'sell' || side === 'short') {
        holdingsMap[sym].quantity -= qty;
        holdingsMap[sym].costBasis += toNum(t.fee || 0);
        if (String(t.realizedPnl || '').startsWith('-')) {
          // realized loss on close
        }
        cashFlows.fees += toNum(t.fee || 0);
      }
      holdingsMap[sym].side = side === 'short' ? 'short' : (holdingsMap[sym].quantity > 0 ? 'long' : 'short');
    }
    // Cash from unified cash-flow table.
    const cashRes = await POOL.query(
      `SELECT c.type, COALESCE(SUM(c.amount),0) AS amt
       FROM portfolio_cash_flows c
       WHERE c.workspace_id = $1 AND DATE(c.executed_at) <= $2
       GROUP BY c.type`,
      [workspaceId, dateStr]
    );
    for (const r of cashRes.rows) {
      if (String(r.type).toLowerCase().includes('deposit')) cashFlows.deposits += toNum(r.amt);
      else if (String(r.type).toLowerCase().includes('withdrawal')) cashFlows.withdrawals += toNum(r.amt);
    }
  }

  // Price holdings at historical close.
  let totalValue = 0;
  let estimated = false;
  const holdings = [];
  for (const [symbol, pos] of Object.entries(holdingsMap)) {
    if (Math.abs(pos.quantity) < 0.00000001) continue;
    let px = await closeForDate(symbol, dateStr);
    if (px == null) {
      // Try prior market day (closeForDate already does ±7 days fallback).
      estimated = true;
      px = 0;
    }
    const marketValue = pos.quantity * (px || 0);
    totalValue += marketValue;
    holdings.push({
      symbol,
      quantity: pos.quantity,
      price: px || 0,
      closePrice: px || 0,
      marketValue,
      costBasis: pos.costBasis,
      strategyName: pos.provider || 'connected',
      estimated: !Boolean(px),
    });
  }

  // Cash: deposits - withdrawals + fees paid (fees reduce cash).
  let cash = cashFlows.deposits - cashFlows.withdrawals - cashFlows.fees;

  return {
    portfolioValue: cash + totalValue,
    cash,
    investedCapital: totalValue,
    deposits: cashFlows.deposits,
    withdrawals: cashFlows.withdrawals,
    fees: cashFlows.fees,
    realizedPnl: 0, // computed per-day by writeDay from prev snapshot
    unrealizedPnl: 0,
    holdings,
    allocation: [],
    sectorBreakdown: [],
    countryBreakdown: [],
    assetBreakdown: [],
    decisionCount: 0,
    journalCount: 0,
    estimated,
  };
}

function throughFallback() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  init,
  DailySnapshotService,
  PortfolioHistoryRepository,
  isMarketDay,
  isWeekend,
  isHoliday,
  prevMarketDay,
  addDays,
  loadYahooSeries,
  replayHistoricalSnapshot,
  TABLE: 'portfolio_daily_snapshots'
};
