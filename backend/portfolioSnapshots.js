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

const EODHD_API_TOKEN = process.env.EODHD_API_TOKEN || process.env.EODHD_API_KEY || process.env.EODHD_TOKEN || null;

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
// Daily close-price lookup. Uses EODHD when configured; otherwise returns null
// so the caller can mark the snapshot estimated=TRUE (never fabricate prices).
// ---------------------------------------------------------------------------
async function getClosePrice(symbol, dateStr) {
  if (!EODHD_API_TOKEN || !DEPS.fetch) return null;
  try {
    const url = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}.US?api_token=${EODHD_API_TOKEN}&fmt=json&date=${dateStr}`;
    const res = await DEPS.fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const close = json && (json.close ?? json.adjusted_close);
    return close != null ? Number(close) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Benchmark daily close feed. Maps a benchmark symbol to a real market series:
//   - Equity/ETF benchmarks (SPY, QQQ, VT, ACWI, VOO, VTI...) -> EODHD .US EOD.
//   - Crypto benchmarks (BTC, ETH) -> EODHD crypto EOD when available.
// Returns null (never a fabricated value) when no source is configured; the
// caller then leaves benchmark fields NULL so the curve does not invent data.
// ---------------------------------------------------------------------------
const CRYPTO_BENCHMARKS = new Set(['BTC', 'ETH', 'BTC-USD', 'ETH-USD']);

async function getBenchmarkClose(symbol, dateStr) {
  if (!symbol) return null;
  const sym = String(symbol).toUpperCase();
  if (!EODHD_API_TOKEN || !DEPS.fetch) return null;
  try {
    let url;
    if (CRYPTO_BENCHMARKS.has(sym)) {
      const base = sym.replace('-USD', '');
      url = `https://eodhd.com/api/eod/${encodeURIComponent(base)}-USD.CC?api_token=${EODHD_API_TOKEN}&fmt=json&from=${dateStr}&to=${dateStr}`;
    } else {
      url = `https://eodhd.com/api/eod/${encodeURIComponent(sym)}.US?api_token=${EODHD_API_TOKEN}&fmt=json&from=${dateStr}&to=${dateStr}`;
    }
    const res = await DEPS.fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const row = Array.isArray(json) ? json[json.length - 1] : json;
    const close = row && (row.adjusted_close ?? row.close);
    return close != null ? Number(close) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Assemble the live per-day inputs for a workspace on a given date.
// For TODAY/FORWARD this reads current state. For historical backfill it
// replays trades up to end-of-day and prices holdings at that day's close.
// ---------------------------------------------------------------------------
async function assembleSnapshotInputs(workspaceId, dateStr, { replay = false } = {}) {
  // Holdings (current live prices). For replay we would price at dateStr close,
  // but without a guaranteed price source we use current as a floor and flag
  // estimated when replaying.
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

  // Cash (sum across currencies, USD assumed for snapshot; FX left to caller).
  const cashRes = await POOL.query(
    `SELECT COALESCE(SUM(balance), 0) AS total FROM user_workspace_cash WHERE workspace_id = $1`,
    [workspaceId]
  );
  const cash = toNum(cashRes.rows[0]?.total);

  // Connected-account holdings (brokerage/exchange). Aggregated into the same
  // snapshot lineage so the Performance Curve reflects real broker balances, not
  // just the manual portfolio. Joined through accounts -> connections (which
  // carry workspace_id). market_value is the provider-reported current value.
  // NOTE: this is live-marked at write time; historical replay cannot re-price
  // broker positions (no per-day broker price history), so replayed days that
  // include broker holdings are flagged estimated=TRUE by the caller.
  let brokerageValue = 0;
  const brokerageHoldings = [];
  try {
    const brokRes = await POOL.query(
      `SELECT h.symbol, h.name, h.asset_type AS "assetType", h.quantity,
              h.current_price AS "price", h.market_value AS "marketValue", h.currency,
              c.provider AS "provider"
       FROM brokerage_holdings h
       JOIN brokerage_accounts a ON a.id = h.account_id
       JOIN brokerage_connections c ON c.id = a.connection_id
       WHERE c.workspace_id = $1 AND h.quantity > 0.00000001`,
      [workspaceId]
    );
    for (const r of brokRes.rows) {
      const mv = toNum(r.marketValue, toNum(r.price) * toNum(r.quantity));
      brokerageValue += mv;
      brokerageHoldings.push({
        symbol: r.symbol,
        name: r.name,
        price: toNum(r.price),
        quantity: toNum(r.quantity),
        marketValue: mv,
        marketType: r.assetType,
        currency: r.currency,
        source: r.provider || 'brokerage',
        closePrice: toNum(r.price)
      });
    }
  } catch {
    // brokerage tables may not exist in every deployment; treat as no connected
    // accounts rather than failing the whole snapshot.
    brokerageValue = 0;
  }

  // Value holdings at the requested day's close when possible (forward = live).
  let estimated = false;
  let totalValue = 0;
  for (const h of holdings) {
    let px = h.price;
    if (replay) {
      const close = await getClosePrice(h.symbol, dateStr);
      if (close != null) px = close;
      else estimated = true; // no price source for this historical day
    }
    h.closePrice = px;
    h.marketValue = px * h.quantity;
    totalValue += h.marketValue;
  }
  // Merge connected-account holdings into invested value + holdings list.
  const allHoldings = holdings.concat(brokerageHoldings);
  totalValue += brokerageValue;
  if (brokerageHoldings.length > 0 && replay) estimated = true;
  const portfolioValue = cash + totalValue;

  // Realized P&L today: net trading cash flow from trades executed on this date.
  // NOTE: user_workspace_trades stores no per-execution cost basis (no entry_price
  // column), so realized P&L is derived as net cash movement from trades:
  //   sells add (notional - fee); buys subtract (notional + fee).
  // This is a documented approximation of realized P&L, not a cost-basis calc.
  const realizedRes = await POOL.query(
    `SELECT COALESCE(SUM(
        CASE WHEN side = 'sell' THEN notional - fee
             ELSE -(notional + fee) END
      ), 0) AS realized
     FROM user_workspace_trades WHERE workspace_id = $1 AND date = $2`,
    [workspaceId, dateStr]
  );
  const realizedPnl = toNum(realizedRes.rows[0]?.realized);

  // Deposits / withdrawals: there is no user_workspace_cashflows ledger in the
  // current schema, so net external flow cannot be reconstructed per day.
  // Default to 0 and document as a known limitation (flows affect only future
  // snapshots via the live cash balance at write time).
  const deposits = 0;
  const withdrawals = 0;

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
  for (const h of allHoldings) {
    allocation.push({ symbol: h.symbol, value: h.marketValue, weight: portfolioValue ? h.marketValue / portfolioValue : 0 });
    const sector = h.strategyName || (h.source ? `Connected: ${h.source}` : 'Uncategorized');
    const country = (h.symbol || '').endsWith('.HK') ? 'HK' : (h.symbol || '').includes('-') ? 'INTL' : 'US';
    bySector[sector] = (bySector[sector] || 0) + h.marketValue;
    byCountry[country] = (byCountry[country] || 0) + h.marketValue;
    const atype = (h.marketType || 'spot').toUpperCase();
    byAsset[atype] = (byAsset[atype] || 0) + h.marketValue;
  }

  return {
    portfolioValue,
    cash,
    investedCapital: totalValue,
    realizedPnl,
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
    const prevValue = prev ? prev.portfolioValue : (opts.initialBalance != null ? opts.initialBalance : 10000);

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
      unrealizedPnl: inputs.portfolioValue - inputs.investedCapital - inputs.cash,
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
   * previous close forward (daily_pnl=0, estimated=TRUE) so the calendar never
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

  async getCashHistory(workspaceId, start, end) {
    const rows = await this.getSnapshots(workspaceId, start, end);
    return rows.map((r) => ({ date: r.date, cash: r.cash, portfolioValue: r.portfolioValue }));
  }
};

module.exports = {
  init,
  DailySnapshotService,
  PortfolioHistoryRepository,
  isMarketDay,
  isWeekend,
  isHoliday,
  prevMarketDay,
  addDays,
  TABLE: 'portfolio_daily_snapshots'
};
