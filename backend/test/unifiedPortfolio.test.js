// backend/test/unifiedPortfolio.test.js
// Verification for the Unified Multi-Source Portfolio read model + dual-write.
// Revision fixes: manual data comes from user_workspace_portfolio / cash (NOT the
// legacy portfolio_holdings scratch table); stable source identity; idempotent
// position/cash upserts; workspace base_currency; manual-exclusion; unvalued gaps.
// Run: node --test test/unifiedPortfolio.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const up = require("../unifiedPortfolio");

// Mock pool reflecting the REAL read queries used by getUnifiedSummary /
// runWorkspaceSync after the revision.
function makeMockPool(rows = {}) {
  return {
    query(text, params) {
      // Brokerage data now flows through the canonical layer (portfolio_source_positions).
      // Merge `rows.brokerage` into the wallet result for backward-compat with tests
      // that still pass brokerage rows separately.
      if (text.includes("FROM portfolio_source_positions sp")) {
        const canon = (rows.wallet || []).slice();
        if (rows.brokerage && rows.brokerage.length) {
          canon.push(...rows.brokerage.map((r) => ({
            symbol: r.symbol, name: r.name, asset_type: r.asset_type,
            quantity: r.quantity, current_price: r.current_price, market_value: r.market_value,
            currency: r.currency || "USD", provider: r.provider || "snaptrade",
            source_type: "brokerage",
            instrument_type: r.instrument_type || (r.asset_type === "option" ? "option" : "spot"),
            position_type: r.position_type || (r.asset_type === "option" ? "derivative" : "holding"),
            side: r.side || null,
            notional_value: r.notional_value || null,
            collateral_value: r.collateral_value || null,
            leverage: r.leverage || null,
            liquidation_price: r.liquidation_price || null,
            as_of: r.as_of || null,
            updated_at: r.updated_at || null,
            account_type: r.account_type || null
          })));
        }
        return Promise.resolve({ rows: canon });
      }
      if (text.includes("FROM user_workspace_portfolio")) {
        return Promise.resolve({ rows: rows.manual || [] });
      }
      if (text.includes("FROM user_workspace_cash")) {
        return Promise.resolve({ rows: rows.manualCash || [] });
      }
      if (text.includes("SELECT base_currency FROM workspaces")) {
        return Promise.resolve({ rows: [{ base_currency: rows.baseCurrency || "USD" }] });
      }
      return Promise.resolve({ rows: [] });
    }
  };
}

test("mapHyperliquidToSource maps perp holdings + USDC cash + instrument key", () => {
  const out = {
    holdings: [{ symbol: "BTC", name: "BTC", price: 60000, quantity: 0.5, type: "crypto", market_type: "perp", entry_price: 55000 }],
    cashBalance: 1200,
    currency: "USDC"
  };
  const src = up.mapHyperliquidToSource(out, { workspaceId: 1, address: "0xABCDEF123456", connectionId: "conn-9" });
  assert.equal(src.sourceType, "wallet");
  assert.equal(src.provider, "hyperliquid");
  assert.equal(src.externalConnectionId, "conn-9");
  assert.equal(src.label, "Hyperliquid 0xABCD");
  assert.equal(src.positions.length, 1);
  assert.equal(src.positions[0].symbol, "BTC");
  assert.equal(src.positions[0].instrumentKey, "BTC");
  assert.equal(src.positions[0].quantity, 0.5);
  assert.equal(src.positions[0].marketValue, 30000);
  assert.equal(src.positions[0].costBasis, 27500); // 0.5 * 55000
  assert.equal(src.cash.length, 1);
  assert.equal(src.cash[0].amount, 1200);
});

test("mapManualToSource reads from user_workspace_portfolio shape", () => {
  const rows = [{ symbol: "AAPL", name: "Apple", market_type: "equity", quantity: 10, current_price: 190, market_value: 1900, currency: "USD" }];
  const src = up.mapManualToSource(rows, { workspaceId: 1 });
  assert.equal(src.sourceType, "manual");
  assert.equal(src.provider, "manual");
  assert.equal(src.positions[0].marketValue, 1900);
  assert.equal(src.positions[0].assetType, "equity");
  assert.equal(src.positions[0].instrumentKey, "AAPL");
});

test("getUnifiedSummary aggregates brokerage + manual + cash (manual from user_workspace_portfolio)", async () => {
  const pool = makeMockPool({
    brokerage: [
      { symbol: "MSFT", name: "Microsoft", asset_type: "equity", quantity: 5, current_price: 400, market_value: 2000, currency: "USD", provider: "snaptrade" }
    ],
    manual: [
      { symbol: "AAPL", name: "Apple", market_type: "equity", quantity: 10, current_price: 190, market_value: 1900, currency: "USD" }
    ],
    manualCash: [{ amount: 500, currency: "USD" }],
    baseCurrency: "USD"
  });
  const summary = await up.getUnifiedSummary(pool, 1);
  assert.equal(summary.baseCurrency, "USD");
  assert.equal(summary.investedValue, 2000); // brokerage only (manual held out)
  assert.equal(summary.cashValue, 0);        // manual cash excluded when connected sources exist
  assert.equal(summary.manualValue, 0);
  assert.equal(summary.excludedManualValue, 1900);
  assert.equal(summary.totalValue, 2000); // 2000 invested only, no stale cash
  assert.equal(summary.sources.length, 2); // brokerage + manual (excluded)
  assert.equal(summary.positions.length, 1); // only MSFT
  assert.equal(summary.positions[0].symbol, "MSFT");
});

test("getUnifiedSummary excludes manual from headline once a connected source has data", async () => {
  const pool = makeMockPool({
    brokerage: [
      { symbol: "MSFT", name: "Microsoft", asset_type: "equity", quantity: 5, current_price: 400, market_value: 2000, currency: "USD", provider: "snaptrade" }
    ],
    manual: [
      { symbol: "AAPL", name: "Apple", market_type: "equity", quantity: 10, current_price: 190, market_value: 1900, currency: "USD" }
    ],
    manualCash: [{ amount: 500, currency: "USD" }],
    baseCurrency: "USD"
  });
  const summary = await up.getUnifiedSummary(pool, 1);
  // Manual value (1900) is held out of the headline because a connected source exists.
  assert.equal(summary.excludedManualValue, 1900);
  assert.equal(summary.manualValue, 0);
  assert.equal(summary.totalValue, 2000); // 2000 invested only, manual cash excluded
  const manualSource = summary.sources.find((s) => s.sourceType === "manual");
  assert.equal(manualSource.excluded, true);
  assert.equal(manualSource.label, "Manual (excluded)");
  assert.ok(summary.warnings.some((w) => w.type === "manual_excluded"));
});

test("getUnifiedSummary keeps manual in headline when no connected source", async () => {
  const pool = makeMockPool({
    manual: [{ symbol: "AAPL", name: "Apple", market_type: "equity", quantity: 10, current_price: 190, market_value: 1900, currency: "USD" }],
    manualCash: [{ amount: 500, currency: "USD" }],
    baseCurrency: "USD"
  });
  const summary = await up.getUnifiedSummary(pool, 1);
  assert.equal(summary.excludedManualValue, 0);
  assert.equal(summary.manualValue, 1900);
  assert.equal(summary.totalValue, 2400); // manual included
});

test("getUnifiedSummary surfaces unvalued positions (missing price / no FX) and excludes from headline", async () => {
  const pool = makeMockPool({
    brokerage: [
      // Missing price + market_value -> unvalued (missing_price)
      { symbol: "XYZ", name: "XYZ", asset_type: "equity", quantity: 5, current_price: null, market_value: null, currency: "USD", provider: "snaptrade" },
      // Non-USD, no FX rate yet -> unvalued (missing_fx)
      { symbol: "SAP", name: "SAP", asset_type: "equity", quantity: 2, current_price: 100, market_value: 200, currency: "EUR", provider: "snaptrade" }
    ],
    baseCurrency: "USD"
  });
  const summary = await up.getUnifiedSummary(pool, 1);
  assert.equal(summary.unvaluedTotal, 200); // only the EUR one has a raw value; XYZ has none
  assert.equal(summary.totalValue, 0); // both excluded from headline
  assert.equal(summary.isPartial, true);
  const reasons = summary.warnings.map((w) => w.reason).sort();
  assert.deepEqual(reasons, ["missing_fx", "missing_price"]);
});

test("getUnifiedSummary returns zeroed summary when no sources", async () => {
  const pool = makeMockPool({ baseCurrency: "USD" });
  const summary = await up.getUnifiedSummary(pool, 99);
  assert.equal(summary.totalValue, 0);
  assert.equal(summary.investedValue, 0);
  assert.equal(summary.cashValue, 0);
  assert.equal(summary.sources.length, 0);
  assert.equal(summary.isPartial, false);
});

test("recordSourceSync upserts on stable identity (workspace+provider+type+connection)", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const calls = [];
    const pool = {
      query(text) {
        calls.push(text);
        if (text.includes("SELECT id FROM portfolio_sources")) {
          return Promise.resolve({ rows: calls.filter((c) => c.includes("SELECT id FROM portfolio_sources")).length > 1 ? [{ id: 7 }] : [] });
        }
        if (text.startsWith("INSERT INTO portfolio_sources")) return Promise.resolve({ rows: [{ id: 7 }] });
        if (text.startsWith("UPDATE portfolio_sources")) return Promise.resolve({ rows: [] });
        if (text.startsWith("INSERT INTO portfolio_source_accounts")) return Promise.resolve({ rows: [{ id: 1 }] });
        if (text.startsWith("INSERT INTO portfolio_source_positions")) return Promise.resolve({ rows: [{ id: 1 }] });
        if (text.startsWith("UPDATE portfolio_source_positions")) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      }
    };
    const src = { sourceType: "wallet", provider: "hyperliquid", externalConnectionId: "conn-9", label: "H", nativeCurrency: "USDC", accounts: [{ externalAccountId: "0x1", label: "W", nativeCurrency: "USDC" }], positions: [{ symbol: "BTC", marketValue: 1 }], cash: [{ currency: "USDC", amount: 2 }], transactions: [] };
    await up.recordSourceSync(pool, 1, src);
    await up.recordSourceSync(pool, 1, src); // repeat -> UPDATE, not 2nd source
    assert.equal(calls.filter((c) => c.startsWith("INSERT INTO portfolio_sources")).length, 1, "one source INSERT across repeat syncs");
    assert.equal(calls.filter((c) => c.startsWith("UPDATE portfolio_sources")).length, 1, "second sync UPDATEs existing source");
    // Position upsert path used (ON CONFLICT on the full semantic identity,
    // including instrument_type/position_type/side) rather than DELETE+INSERT —
    // distinct financial positions (spot vs perp vs long vs short) never merge
    // merely because they share a symbol.
    assert.ok(calls.some((c) => c.includes("ON CONFLICT (source_id, COALESCE(account_id,0), symbol, COALESCE(instrument_type,'spot'), COALESCE(position_type,'balance'), COALESCE(side,'balance'))")), "position upsert is idempotent on full semantic identity");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("recordSourceSync is a no-op when flag disabled", async () => {
  const writes = [];
  const pool = { query: (text) => { writes.push(text); return Promise.resolve({ rows: [{ id: 1 }] }); } };
  const src = { sourceType: "manual", provider: "manual", label: "Manual", nativeCurrency: "USD", accounts: [], positions: [], cash: [], transactions: [] };
  const id = await up.recordSourceSync(pool, 1, src);
  assert.equal(id, null);
  assert.equal(writes.length, 0);
});

test("runWorkspaceSync backfills manual from user_workspace_portfolio when flag on", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const sourceInserts = [];
    const pool = {
      query(text) {
        if (text.includes("FROM user_workspace_portfolio")) return Promise.resolve({ rows: [{ symbol: "AAPL", name: "Apple", market_type: "equity", quantity: 1, current_price: 100, market_value: 100, currency: "USD" }] });
        if (text.includes("brokerage_holdings bh")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM portfolio_source_positions sp")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM user_workspace_cash")) return Promise.resolve({ rows: [] });
        if (text.includes("SELECT base_currency FROM workspaces")) return Promise.resolve({ rows: [{ base_currency: "USD" }] });
        if (text.startsWith("INSERT INTO portfolio_sync_runs")) return Promise.resolve({ rows: [{ id: 9 }] });
        if (text.startsWith("UPDATE portfolio_sync_runs")) return Promise.resolve({ rows: [] });
        if (text.startsWith("INSERT INTO portfolio_sources")) { sourceInserts.push(text); return Promise.resolve({ rows: [{ id: 5 }] }); }
        if (text.startsWith("UPDATE portfolio_sources")) return Promise.resolve({ rows: [] });
        if (text.startsWith("INSERT INTO portfolio_source_")) return Promise.resolve({ rows: [{ id: 1 }] });
        return Promise.resolve({ rows: [] });
      }
    };
    const result = await up.runWorkspaceSync(pool, 1);
    assert.ok(sourceInserts.length >= 1, "manual source backfilled into canonical layer from user_workspace_portfolio");
    assert.ok(result.summary.sources.some((s) => s.sourceType === "manual"), true);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedSyncStatus: disabled when flag off", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  delete process.env.ZENIN_UNIFIED_PORTFOLIO;
  try {
    const pool = { query: () => Promise.resolve({ rows: [] }) };
    const st = await up.getUnifiedSyncStatus(pool, 1);
    assert.equal(st.enabled, false);
    assert.deepEqual(st.sources, []);
  } finally {
    if (prev !== undefined) process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedSyncStatus: surfaces provider/status/stale + anyConnectedHasData", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = {
      query(text) {
        if (text.includes("FROM portfolio_sources WHERE")) return Promise.resolve({
          rows: [
            { provider: "snaptrade", source_type: "brokerage", external_connection_id: "c1", status: "synced", last_sync_at: new Date().toISOString(), last_attempted_sync_at: null, last_error: null },
            { provider: "hyperliquid", source_type: "wallet", external_connection_id: "c2", status: "error", last_sync_at: null, last_attempted_sync_at: new Date().toISOString(), last_error: "auth expired" }
          ]
        });
        if (text.includes("FROM portfolio_sync_runs")) return Promise.resolve({ rows: [{ id: 3, status: "complete", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), per_source: "[]" }] });
        return Promise.resolve({ rows: [] });
      }
    };
    const st = await up.getUnifiedSyncStatus(pool, 1);
    assert.equal(st.enabled, true);
    assert.equal(st.sources.length, 2);
    const hyper = st.sources.find((s) => s.provider === "hyperliquid");
    assert.equal(hyper.status, "error");
    assert.equal(hyper.lastError, "auth expired");
    assert.equal(hyper.stale, false); // no last_sync_at -> not "stale", just failed
    assert.equal(st.anyConnectedHasData, true);
    assert.equal(st.lastSyncRun.id, 3);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedTransactions: maps joined rows", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = {
      query(text) {
        if (text.includes("FROM portfolio_source_transactions t")) return Promise.resolve({
          rows: [{ provider: "snaptrade", source_type: "brokerage", symbol: "AAPL", type: "buy", side: "buy", quantity: 10, unit_price: 100, notional: 1000, fee: 1, currency: "USD", executed_at: new Date().toISOString() }]
        });
        return Promise.resolve({ rows: [] });
      }
    };
    const tx = await up.getUnifiedTransactions(pool, 1);
    assert.equal(tx.length, 1);
    assert.equal(tx[0].symbol, "AAPL");
    assert.equal(tx[0].provider, "snaptrade");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedReconciliation: flags duplicate instruments across sources", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = {
      query(text) {
        if (text.includes("FROM portfolio_source_positions p")) return Promise.resolve({
          rows: [{ instrument_key: "AAPL", source_count: 2, providers: ["snaptrade", "manual"], symbols: ["AAPL", "AAPL"] }]
        });
        return Promise.resolve({ rows: [] });
      }
    };
    const rec = await up.getUnifiedReconciliation(pool, 1);
    assert.equal(rec.enabled, true);
    assert.equal(rec.duplicateInstruments.length, 1);
    assert.equal(rec.duplicateInstruments[0].sourceCount, 2);
    assert.deepEqual(rec.duplicateInstruments[0].providers.sort(), ["manual", "snaptrade"]);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("recordSyncStart: marks attempt start for matching source", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    let updateSql = null;
    const pool = {
      query(text, params) {
        if (text.includes("last_attempted_sync_at=NOW()")) { updateSql = text; return Promise.resolve({ rows: [] }); }
        return Promise.resolve({ rows: [] });
      }
    };
    await up.recordSyncStart(pool, 7, { provider: "hyperliquid", sourceType: "wallet", connectionId: "c2" });
    assert.ok(updateSql && updateSql.includes("last_attempted_sync_at=NOW()"), "attempt-start timestamp written");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("recordSourceSync: records last_error + status=error on failure, keeps prior data", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const calls = [];
    const pool = {
      query(text) {
        calls.push(text);
        if (text.startsWith("SELECT id FROM portfolio_sources")) return Promise.resolve({ rows: [{ id: 5 }] });
        if (text.includes("SET label=$1")) throw new Error("db write failed");
        if (text.includes("status='error'") && text.includes("last_error")) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
    };
    await assert.rejects(
      up.recordSourceSync(pool, 1, { provider: "hyperliquid", sourceType: "wallet", externalConnectionId: "c2", label: "H", nativeCurrency: "USDC", accounts: [], positions: [], cash: [], transactions: [] }),
      /db write failed/
    );
    const errUpdate = calls.find((c) => c.includes("status='error'") && c.includes("last_error"));
    assert.ok(errUpdate, "failure writes last_error + status=error (keep-last-successful)");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("recordFxRate + getUnifiedFxRates: persist + read round-trip", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const calls = [];
    const pool = {
      query(text, params) {
        calls.push({ text, params });
        if (text.includes("FROM portfolio_fx_rates WHERE base")) return Promise.resolve({ rows: [{ base: "USD", quote: "EUR", rate: "1.08", rate_source: "manual", as_of: null, fetched_at: new Date().toISOString() }] });
        if (text.startsWith("SELECT base_currency FROM workspaces")) return Promise.resolve({ rows: [{ base_currency: "USD" }] });
        if (text.startsWith("INSERT INTO portfolio_fx_rates")) return Promise.resolve({ rows: [{ id: 1 }] });
        return Promise.resolve({ rows: [] });
      }
    };
    await up.recordFxRate(pool, "USD", "eur", 1.08, { rateSource: "manual" });
    const fx = await up.getUnifiedFxRates(pool, 1);
    assert.equal(fx.base, "USD");
    assert.equal(fx.rates.length, 1);
    assert.equal(fx.rates[0].quote, "EUR");
    assert.equal(fx.rates[0].rate, 1.08);
    const upsert = calls.find((c) => c.text.startsWith("INSERT INTO portfolio_fx_rates"));
    assert.ok(upsert && upsert.text.includes("ON CONFLICT (base, quote)"), "rate upserted on (base,quote)");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedSummary: non-USD converts with rate, stays unvalued without", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const manualEur = (fxRows) => ({
      query(text) {
        if (text.startsWith("SELECT base_currency FROM workspaces")) return Promise.resolve({ rows: [{ base_currency: "USD" }] });
        if (text.includes("FROM portfolio_fx_rates WHERE base")) return Promise.resolve({ rows: fxRows });
        if (text.includes("brokerage_holdings bh")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM portfolio_source_positions sp")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM user_workspace_portfolio")) return Promise.resolve({ rows: [{ symbol: "SAP", name: "SAP", market_type: "equity", quantity: 10, current_price: 100, price: 100, market_value: 1000, currency: "EUR" }] });
        if (text.includes("FROM user_workspace_cash")) return Promise.resolve({ rows: [] });
        if (text.startsWith("INSERT INTO portfolio_sync_runs")) return Promise.resolve({ rows: [{ id: 9 }] });
        if (text.startsWith("UPDATE portfolio_sync_runs")) return Promise.resolve({ rows: [] });
        if (text.startsWith("INSERT INTO portfolio_sources")) return Promise.resolve({ rows: [{ id: 5 }] });
        if (text.startsWith("UPDATE portfolio_sources")) return Promise.resolve({ rows: [] });
        if (text.startsWith("INSERT INTO portfolio_source_")) return Promise.resolve({ rows: [{ id: 1 }] });
        return Promise.resolve({ rows: [] });
      }
    });
    // EUR rate present -> 1000 EUR * 1.1 = 1100 USD (manual included, no connected source).
    const withRate = await up.getUnifiedSummary(manualEur([{ quote: "EUR", rate: "1.1", rate_source: "manual", as_of: null, fetched_at: new Date().toISOString() }]), 1);
    assert.equal(withRate.manualValue, 1100);
    assert.equal(withRate.totalValue, 1100);
    assert.equal(withRate.unvaluedTotal, 0);
    // No JPY rate -> stays unvalued.
    const noRate = await up.getUnifiedSummary(manualEur([]), 1);
    assert.equal(noRate.totalValue, 0);
    assert.equal(noRate.unvaluedTotal, 1000);
    assert.ok(noRate.warnings.some((w) => w.reason === "missing_fx" && w.currency === "EUR" || w.currency === "JPY"));
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("recordUnifiedSnapshot: inserts once per day (immutable), returns id", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    let insertCount = 0;
    const pool = {
      query(text) {
        if (text.startsWith("SELECT id FROM portfolio_daily_snapshots")) return Promise.resolve({ rows: [] });
        if (text.startsWith("INSERT INTO portfolio_daily_snapshots")) { insertCount++; return Promise.resolve({ rows: [{ id: "uuid-1" }] }); }
        return Promise.resolve({ rows: [] });
      }
    };
    const id1 = await up.recordUnifiedSnapshot(pool, 1, { totalValue: 1000, cashValue: 100, investedValue: 900, baseCurrency: "USD", positions: [{ symbol: "AAPL" }], sources: [{ provider: "manual" }] });
    const pool2 = {
      query(text) {
        if (text.startsWith("SELECT id FROM portfolio_daily_snapshots")) return Promise.resolve({ rows: [{ id: "uuid-1" }] });
        if (text.startsWith("INSERT INTO portfolio_daily_snapshots")) { insertCount++; return Promise.resolve({ rows: [{ id: "uuid-2" }] }); }
        return Promise.resolve({ rows: [] });
      }
    };
    const id2 = await up.recordUnifiedSnapshot(pool2, 1, { totalValue: 2000, cashValue: 200, investedValue: 1800, baseCurrency: "USD", positions: [], sources: [] });
    assert.equal(insertCount, 1, "snapshot written only once per day (immutable)");
    assert.equal(id1, "uuid-1");
    assert.equal(id2, "uuid-1", "second call returns existing day's id, no overwrite");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedSnapshots: maps rows + filters is_unified", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = {
      query(text) {
        if (text.includes("FROM portfolio_daily_snapshots")) return Promise.resolve({ rows: [{
          id: "u1", snapshot_date: "2026-07-19", portfolio_value: 1000, cash: 100, invested_capital: 900,
          base_currency: "USD", source_breakdown: [{ provider: "manual" }], snapshot_created_at: new Date().toISOString()
        }] });
        return Promise.resolve({ rows: [] });
      }
    };
    const snaps = await up.getUnifiedSnapshots(pool, 1);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].portfolioValue, 1000);
    assert.equal(snaps[0].baseCurrency, "USD");
    assert.deepEqual(snaps[0].sourceBreakdown, [{ provider: "manual" }]);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedShadowComparison: flag off returns {enabled:false}", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "false";
  try {
    const pool = makeMockPool();
    const cmp = await up.getUnifiedShadowComparison(pool, 1);
    assert.equal(cmp.enabled, false);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("mapHyperliquidToSource: perp gets derivative semantics; spot USDC stays balance", () => {
  const out = {
    holdings: [
      { symbol: "BTC", name: "BTC", price: 60000, quantity: 0.5, type: "crypto", market_type: "perp", entry_price: 55000 },
      { symbol: "USDC", name: "USDC", price: 1, quantity: 1200, type: "crypto", market_type: "spot" }
    ],
    cashBalance: 1200,
    currency: "USDC"
  };
  const src = up.mapHyperliquidToSource(out, { workspaceId: 1, address: "0xABCDEF123456", connectionId: "conn-9" });
  const perp = src.positions.find((p) => p.symbol === "BTC");
  const spot = src.positions.find((p) => p.symbol === "USDC");
  assert.equal(perp.assetType, "crypto");
  assert.equal(perp.instrumentType, "perpetual");
  assert.equal(perp.positionType, "derivative");
  assert.equal(perp.side, "long");
  assert.equal(perp.notionalValue, 30000);
  assert.equal(perp.marketValue, 30000); // raw notional size preserved
  assert.equal(spot.instrumentType, "spot");
  assert.equal(spot.positionType, "balance");
  assert.equal(spot.side, "balance");
});

test("mapHyperliquidToSource: short perp side is preserved", () => {
  const out = {
    holdings: [{ symbol: "BTC", name: "BTC", price: 60000, quantity: -0.5, type: "crypto", market_type: "perp", entry_price: 55000 }],
    cashBalance: 1000,
    currency: "USDC"
  };
  const src = up.mapHyperliquidToSource(out, { workspaceId: 1, address: "0xA", connectionId: "conn-10" });
  const perp = src.positions[0];
  assert.equal(perp.side, "short");
  assert.equal(perp.quantity, 0.5);
  assert.equal(perp.notionalValue, 30000);
});

test("mapSnapTradeToSource: equity vs option vs crypto semantics", () => {
  const src = up.mapSnapTradeToSource({
    accounts: [{ externalAccountId: "acc1", name: "Brokerage", native_currency: "USD" }],
    holdings: [
      { symbol: "AAPL", name: "Apple", assetType: "equity", quantity: 10, current_price: 190, market_value: 1900, currency: "USD", accountId: "acc1" },
      { symbol: "AAPL220624C00200000", name: "AAPL Call", assetType: "option", quantity: 1, current_price: 5, market_value: 500, currency: "USD", accountId: "acc1" },
      { symbol: "BTC", name: "Bitcoin", assetType: "crypto", quantity: 0.1, current_price: 50000, market_value: 5000, currency: "USD", accountId: "acc1" }
    ]
  });
  const equity = src.positions.find((p) => p.symbol === "AAPL");
  const option = src.positions.find((p) => p.assetType === "option");
  const crypto = src.positions.find((p) => p.assetType === "crypto");
  assert.equal(equity.instrumentType, "spot");
  assert.equal(equity.positionType, "holding");
  assert.equal(equity.side, "balance");
  assert.equal(option.instrumentType, "option");
  assert.equal(option.positionType, "derivative");
  assert.equal(option.side, "long");
  assert.equal(crypto.instrumentType, "spot");
  assert.equal(crypto.positionType, "balance");
});

test("mapPredictionWalletToSource: prediction semantics preserved", () => {
  const src = up.mapPredictionWalletToSource({
    walletAddress: "0xPRED",
    positions: [{ symbol: "BTC-2026", name: "BTC election", quantity: 100, currentPrice: 0.5, side: "short" }]
  });
  const p = src.positions[0];
  assert.equal(p.assetType, "prediction");
  assert.equal(p.instrumentType, "prediction");
  assert.equal(p.positionType, "prediction");
  assert.equal(p.side, "short");
});

test("getUnifiedSummary: perp notional does not inflate investedValue; cash is counted once", async () => {
  const pool = makeMockPool({
    wallet: [
      {
        symbol: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "perpetual", position_type: "derivative",
        side: "long", quantity: 0.5, current_price: 60000, market_value: 30000, notional_value: 30000,
        collateral_value: null, leverage: null, liquidation_price: null, currency: "USDC", provider: "hyperliquid", source_type: "wallet"
      }
    ],
    manualCash: [],
    baseCurrency: "USD"
  });
  // The mock pool does not handle the new portfolio_source_cash query; inject cash
  // through the manualCash path so the test can verify totalValue.
  const poolWithCash = {
    query(text, params) {
      if (text.includes("portfolio_source_cash")) {
        return Promise.resolve({ rows: [{ provider: "hyperliquid", source_type: "wallet", currency: "USDC", amount: 10000 }] });
      }
      return pool.query(text, params);
    }
  };
  const summary = await up.getUnifiedSummary(poolWithCash, 1);
  // Perp size (30000) must NOT be added to investedValue; only cash is counted.
  assert.equal(summary.investedValue, 0);
  assert.equal(summary.cashValue, 10000);
  assert.equal(summary.totalValue, 10000);
  assert.equal(summary.derivativeGrossExposure, 30000);
  assert.equal(summary.derivativeNetExposure, 30000);
  const perp = summary.positions.find((p) => p.symbol === "BTC");
  assert.equal(perp.portfolioValue, 0);
  assert.equal(perp.grossExposure, 30000);
  assert.equal(perp.netExposure, 30000);
});

test("getUnifiedSummary: short perp reduces net exposure", async () => {
  const pool = makeMockPool({
    wallet: [
      {
        symbol: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "perpetual", position_type: "derivative",
        side: "short", quantity: 0.5, current_price: 60000, market_value: 30000, notional_value: 30000,
        currency: "USDC", provider: "hyperliquid", source_type: "wallet"
      }
    ],
    baseCurrency: "USD"
  });
  const summary = await up.getUnifiedSummary(pool, 1);
  assert.equal(summary.derivativeGrossExposure, 30000);
  assert.equal(summary.derivativeNetExposure, -30000);
  const perp = summary.positions.find((p) => p.symbol === "BTC");
  assert.equal(perp.netExposure, -30000);
});

test("getUnifiedSummary: equity and spot use marketValue for portfolioValue and exposure", async () => {
  const pool = makeMockPool({
    brokerage: [
      { symbol: "MSFT", name: "Microsoft", asset_type: "equity", quantity: 5, current_price: 400, market_value: 2000, currency: "USD", provider: "snaptrade" }
    ],
    wallet: [
      {
        symbol: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "spot", position_type: "balance",
        side: "balance", quantity: 0.5, current_price: 60000, market_value: 30000, currency: "USDC", provider: "binance", source_type: "exchange"
      }
    ],
    baseCurrency: "USD"
  });
  const summary = await up.getUnifiedSummary(pool, 1);
  assert.equal(summary.investedValue, 32000);
  assert.equal(summary.derivativeGrossExposure, 0);
  assert.equal(summary.derivativeNetExposure, 0);
  const btc = summary.positions.find((p) => p.symbol === "BTC");
  assert.equal(btc.portfolioValue, 30000);
  assert.equal(btc.grossExposure, 30000);
  assert.equal(btc.netExposure, 30000);
});

test("getUnifiedSummary: positions with same symbol but different instrument types remain distinct", async () => {
  const pool = makeMockPool({
    wallet: [
      {
        symbol: "BTC", name: "BTC Spot", asset_type: "crypto", instrument_type: "spot", position_type: "balance",
        side: "balance", quantity: 0.5, current_price: 60000, market_value: 30000, currency: "USDC", provider: "binance", source_type: "exchange"
      },
      {
        symbol: "BTC", name: "BTC Perp", asset_type: "crypto", instrument_type: "perpetual", position_type: "derivative",
        side: "long", quantity: 0.5, current_price: 60000, market_value: 30000, notional_value: 30000, currency: "USDC", provider: "hyperliquid", source_type: "wallet"
      }
    ],
    baseCurrency: "USD"
  });
  const summary = await up.getUnifiedSummary(pool, 1);
  const btcPositions = summary.positions.filter((p) => p.symbol === "BTC");
  assert.equal(btcPositions.length, 2);
  const spot = btcPositions.find((p) => p.instrumentType === "spot");
  const perp = btcPositions.find((p) => p.instrumentType === "perpetual");
  assert.ok(spot);
  assert.ok(perp);
  assert.equal(spot.portfolioValue, 30000);
  assert.equal(perp.portfolioValue, 0);
  assert.equal(summary.investedValue, 30000); // only spot counts
  assert.equal(summary.derivativeGrossExposure, 30000); // perp exposure separate
});

test("getUnifiedShadowComparison: no connected source compares manual book vs unified", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    // Manual holdings: 2x AAPL @ 100 = 200; cash 50 => legacy.total = 250.
    const pool = makeMockPool({
      manual: [{ symbol: "AAPL", quantity: 2, current_price: 100, price: 100, market_value: 200, currency: "USD" }],
      manualCash: [{ amount: 50, currency: "USD" }],
    });
    const cmp = await up.getUnifiedShadowComparison(pool, 1);
    assert.equal(cmp.enabled, true);
    assert.equal(cmp.connectedHasData, false);
    assert.equal(cmp.legacy.total, 250);
    // Unified manual slice matches legacy's manual book (kty*price + cash), apples-to-apples.
    assert.equal(cmp.manualSlice.legacy, 250);
    assert.equal(cmp.manualSlice.unified, 250);
    assert.equal(cmp.manualSlice.divergencePct, 0);
    assert.equal(cmp.manualSlice.withinTolerance, true);
    assert.equal(cmp.recommendation, "promote");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

// ---------------------------------------------------------------------------
// Position Semantics & Asset Presentation (spec audit implementation)
// ---------------------------------------------------------------------------

test("mapExchangeWalletToSource classifies spot vs perp vs collateral distinctly", () => {
  const out = {
    holdings: [
      { symbol: "BTC", price: 60000, quantity: 0.5, type: "crypto", market_type: "spot" },
      { symbol: "BTC", price: 60000, quantity: 1, type: "crypto", market_type: "perp", entry_price: 58000, unrealizedPnl: 2000 },
      { symbol: "ETH", price: 3000, quantity: 2, type: "crypto", market_type: "perp", leverage: 5, liquidation_price: 2400 }
    ],
    cashBalance: 0,
    currency: "USDC"
  };
  const src = up.mapExchangeWalletToSource(out, { workspaceId: 1, address: "0xHL", provider: "hyperliquid" });
  const spot = src.positions.find((p) => p.symbol === "BTC" && p.instrumentType === "spot");
  const perp = src.positions.find((p) => p.symbol === "BTC" && p.instrumentType === "perpetual");
  const eth = src.positions.find((p) => p.symbol === "ETH");
  assert.equal(spot.positionType, "balance");
  assert.equal(spot.side, "balance");
  assert.equal(perp.positionType, "derivative");
  assert.equal(perp.side, "long");
  assert.equal(perp.unrealizedPnl, 2000);
  assert.equal(eth.leverage, 5);
  assert.equal(eth.liquidationPrice, 2400);
  assert.ok(perp.notionalValue > 0);
});

test("mapExchangeWalletToSource: short perp derives side=short", () => {
  const out = { holdings: [{ symbol: "SOL", price: 100, quantity: -3, type: "crypto", market_type: "perp" }], cashBalance: 0, currency: "USDC" };
  const src = up.mapExchangeWalletToSource(out, { workspaceId: 1, provider: "binance" });
  const perp = src.positions[0];
  assert.equal(perp.instrumentType, "perpetual");
  assert.equal(perp.positionType, "derivative");
  assert.equal(perp.side, "short");
  assert.equal(perp.quantity, 3);
});

test("getUnifiedSummary: spot and perp with same symbol remain distinct positions", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = makeMockPool({
      wallet: [
        { symbol: "BTC", instrument_key: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "spot", position_type: "balance", side: "balance", quantity: 0.5, current_price: 60000, market_value: 30000, notional_value: null, collateral_value: null, leverage: null, liquidation_price: null, unrealized_pnl: null, native_currency: "USD", source_type: "wallet", provider: "hyperliquid", account_type: "wallet" },
        { symbol: "BTC", instrument_key: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "perpetual", position_type: "derivative", side: "long", quantity: 1, current_price: 60000, market_value: 60000, notional_value: 60000, collateral_value: 12000, leverage: 5, liquidation_price: 48000, unrealized_pnl: 2000, native_currency: "USD", source_type: "wallet", provider: "hyperliquid", account_type: "wallet" }
      ]
    });
    const s = await up.getUnifiedSummary(pool, 1);
    const btcs = s.positions.filter((p) => p.symbol === "BTC");
    assert.equal(btcs.length, 2, "spot + perp kept as 2 distinct positions");
    const spot = btcs.find((p) => p.instrumentType === "spot");
    const perp = btcs.find((p) => p.instrumentType === "perpetual");
    assert.equal(spot.positionType, "balance");
    assert.equal(perp.positionType, "derivative");
    assert.equal(perp.portfolioValue, 14000);
    assert.equal(perp.grossExposure, 60000);
    assert.equal(perp.netExposure, 60000);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedSummary: short perp gives negative net exposure", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = makeMockPool({
      wallet: [
        { symbol: "BTC", instrument_key: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "perpetual", position_type: "derivative", side: "short", quantity: 1, current_price: 60000, market_value: 60000, notional_value: 60000, collateral_value: 12000, leverage: 5, liquidation_price: 72000, unrealized_pnl: -1500, native_currency: "USD", source_type: "wallet", provider: "hyperliquid", account_type: "wallet" }
      ]
    });
    const s = await up.getUnifiedSummary(pool, 1);
    const perp = s.positions.find((p) => p.instrumentType === "perpetual");
    assert.equal(perp.netExposure, -60000);
    assert.equal(perp.portfolioValue, 10500);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("getUnifiedSummary: perp collateral NOT double-counted with source cash", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = {
      query(text) {
        if (text.includes("brokerage_holdings bh")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM portfolio_source_positions sp")) return Promise.resolve({ rows: [
          { symbol: "BTC", instrument_key: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "perpetual", position_type: "derivative", side: "long", quantity: 1, current_price: 60000, market_value: 60000, notional_value: 60000, collateral_value: 12000, leverage: 5, liquidation_price: 48000, unrealized_pnl: 0, native_currency: "USD", source_type: "wallet", provider: "hyperliquid", account_type: "wallet" }
        ] });
        if (text.includes("FROM user_workspace_portfolio")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM user_workspace_cash")) return Promise.resolve({ rows: [] });
        if (text.includes("portfolio_source_cash psc")) return Promise.resolve({ rows: [{ provider: "hyperliquid", source_type: "wallet", currency: "USDC", amount: 20000 }] });
        if (text.includes("SELECT base_currency FROM workspaces")) return Promise.resolve({ rows: [{ base_currency: "USD" }] });
        return Promise.resolve({ rows: [] });
      }
    };
    const s = await up.getUnifiedSummary(pool, 1);
    assert.equal(s.cashValue, 8000, "perp margin not double-counted");
    assert.equal(s.investedValue, 12000);
    assert.equal(s.totalValue, 20000);
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("recordSourceSync persists unrealized_pnl + full semantic identity", () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    let positionInsert = "";
    const pool = {
      query(text) {
        if (text.startsWith("INSERT INTO portfolio_sources")) return Promise.resolve({ rows: [{ id: 7 }] });
        if (text.startsWith("INSERT INTO portfolio_source_accounts")) return Promise.resolve({ rows: [{ id: 1 }] });
        if (text.startsWith("INSERT INTO portfolio_source_positions")) { positionInsert = text; return Promise.resolve({ rows: [{ id: 1 }] }); }
        return Promise.resolve({ rows: [] });
      }
    };
    const src = { sourceType: "wallet", provider: "hyperliquid", externalConnectionId: "conn-9", label: "H", nativeCurrency: "USDC", accounts: [{ externalAccountId: "0x1", label: "W", nativeCurrency: "USDC" }], positions: [{ symbol: "BTC", marketValue: 1, instrumentType: "perpetual", positionType: "derivative", side: "long", unrealizedPnl: 1234 }], cash: [], transactions: [] };
    return up.recordSourceSync(pool, 1, src).then(() => {
      assert.ok(positionInsert.includes("unrealized_pnl"), "unrealized_pnl column written (spec §1.4 no silent drop)");
    });
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("exchangeSync raw shapes thread P&L+collateral into canonical perp (HL + Binance)", () => {
  // Hyperliquid clearinghouseState-derived holding (post exchangeSync edit)
  const hl = up.mapHyperliquidToSource(
    { holdings: [{ symbol: "BTC", name: "BTC", price: 60000, quantity: 0.5, entry_price: 55000, market_type: "perp", unrealizedPnl: 2125.5, collateral: 13750.25, leverage: 5, liquidation_price: 48000, type: "crypto" }], cashBalance: 0, currency: "USDC" },
    { workspaceId: 1, address: "0xHL", connectionId: "c1" }
  );
  const hlp = hl.positions[0];
  assert.equal(hlp.instrumentType, "perpetual");
  assert.equal(hlp.unrealizedPnl, 2125.5);
  assert.equal(hlp.collateralValue, 13750.25);
  assert.equal(hlp.leverage, 5);
  assert.equal(hlp.liquidationPrice, 48000);
  // Binance fapi/v2/account-derived holding
  const bn = up.mapExchangeWalletToSource(
    { holdings: [{ symbol: "ETH", name: "ETH", price: 3000, quantity: 2, entry_price: 2900, market_type: "perp", unrealizedPnl: 200, collateral: 600, leverage: 5, liquidation_price: 2400, type: "crypto" }], cashBalance: 0, currency: "USDT" },
    { workspaceId: 1, provider: "binance" }
  );
  const bnp = bn.positions[0];
  assert.equal(bnp.unrealizedPnl, 200);
  assert.equal(bnp.collateralValue, 600);
  assert.equal(bnp.leverage, 5);
  assert.equal(bnp.liquidationPrice, 2400);
});

test("getUnifiedSummary: accountValue-inclusive PnL NOT double-counted (real HL shape)", async () => {
  // Hyperliquid accountValue already includes unrealized PnL, so the canonical
  // cash row carries it. Perp equity = collateral + pnl. Net must equal accountValue.
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const pool = {
      query(text) {
        if (text.includes("brokerage_holdings bh")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM portfolio_source_positions sp")) return Promise.resolve({ rows: [
          { symbol: "BTC", instrument_key: "BTC", name: "BTC", asset_type: "crypto", instrument_type: "perpetual", position_type: "derivative", side: "long", quantity: 1, current_price: 60000, market_value: 60000, notional_value: 60000, collateral_value: 12000, leverage: 5, liquidation_price: 48000, unrealized_pnl: 2000, native_currency: "USD", source_type: "wallet", provider: "hyperliquid", account_type: "wallet" }
        ] });
        if (text.includes("FROM user_workspace_portfolio")) return Promise.resolve({ rows: [] });
        if (text.includes("FROM user_workspace_cash")) return Promise.resolve({ rows: [] });
        if (text.includes("portfolio_source_cash psc")) return Promise.resolve({ rows: [{ provider: "hyperliquid", source_type: "wallet", currency: "USDC", amount: 20000 }] }); // accountValue = free 6000 + margin 12000 + pnl 2000
        if (text.includes("SELECT base_currency FROM workspaces")) return Promise.resolve({ rows: [{ base_currency: "USD" }] });
        return Promise.resolve({ rows: [] });
      }
    };
    const s = await up.getUnifiedSummary(pool, 1);
    // cash = 20000 - 12000(collateral) - 2000(pnl) = 6000 free
    assert.equal(s.cashValue, 6000, "free cash after both offsets");
    // invested = perp equity = 12000 + 2000 = 14000
    assert.equal(s.investedValue, 14000);
    // total = 6000 + 14000 = 20000 = accountValue (no pnl double-count)
    assert.equal(s.totalValue, 20000, "headline equals accountValue");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

// ============================================================================
// Regression tests for Execution Log Empty-Row / Phantom Execution Fix
// Covers: (Fix B) transaction type vs side, (Fix C) cash-flow classification,
// (Fix D) global SQL limit across UNION ALL.
// ============================================================================

test("normalizeTxType: buy/sell/fill/trade all normalize to 'trade' (execution)", async () => {
  assert.equal(up.normalizeTxType("buy"), "trade");
  assert.equal(up.normalizeTxType("sell"), "trade");
  assert.equal(up.normalizeTxType("fill"), "trade");
  assert.equal(up.normalizeTxType("trade"), "trade");
  assert.equal(up.normalizeTxType("crypto"), "trade");
});

test("normalizeTxType: genuine cash-flow types are preserved", async () => {
  assert.equal(up.normalizeTxType("deposit"), "deposit");
  assert.equal(up.normalizeTxType("withdrawal"), "withdrawal");
  assert.equal(up.normalizeTxType("dividend"), "dividend");
  assert.equal(up.normalizeTxType("interest"), "interest");
  assert.equal(up.normalizeTxType("funding"), "funding");
});

test("classifyCashFlow: execution types are NOT cash flows (returns null)", async () => {
  // This is the core financial-integrity fix: buy/sell fills must NOT be
  // classified as cash flows. Previously type=buy/sell was treated as a
  // cash-flow event, polluting portfolio_cash_flows and corrupting TWR/MWR.
  assert.equal(up.classifyCashFlow("trade"), null);
  assert.equal(up.classifyCashFlow("fill"), null);
  assert.equal(up.classifyCashFlow("buy"), null);
  assert.equal(up.classifyCashFlow("sell"), null);
  assert.equal(up.classifyCashFlow("crypto"), null);
});

test("classifyCashFlow: genuine cash events ARE cash flows", async () => {
  assert.equal(up.classifyCashFlow("deposit"), "deposit");
  assert.equal(up.classifyCashFlow("deposit_cash"), "deposit");
  assert.equal(up.classifyCashFlow("transfer_in"), "deposit");
  assert.equal(up.classifyCashFlow("withdrawal"), "withdrawal");
  assert.equal(up.classifyCashFlow("transfer_out"), "withdrawal");
  assert.equal(up.classifyCashFlow("transfer"), "withdrawal");
  assert.equal(up.classifyCashFlow("dividend"), "dividend");
  assert.equal(up.classifyCashFlow("interest"), "interest");
  assert.equal(up.classifyCashFlow("fee"), "fee");
});

test("isExecutableTx: distinguishes executions from cash events", async () => {
  assert.equal(up.isExecutableTx({ type: "trade" }), true);
  assert.equal(up.isExecutableTx({ type: "fill" }), true);
  assert.equal(up.isExecutableTx({ type: "buy" }), true);
  assert.equal(up.isExecutableTx({ type: "sell" }), true);
  assert.equal(up.isExecutableTx({ type: "crypto" }), true);
  assert.equal(up.isExecutableTx({ type: "deposit" }), false);
  assert.equal(up.isExecutableTx({ type: "withdrawal" }), false);
  assert.equal(up.isExecutableTx({ type: "transfer" }), false);
  assert.equal(up.isExecutableTx({ type: "dividend" }), false);
  assert.equal(up.isExecutableTx(null), false);
  assert.equal(up.isExecutableTx({}), true); // defaults to "trade"
});

test("normalizeTransaction: valid unified fill normalizes correctly", async () => {
  const tx = up.normalizeTransaction({
    provider: "hyperliquid",
    type: "trade",
    side: "buy",
    symbol: "ASTER",
    quantity: 100,
    unitPrice: 1.28,
    notional: 127.87,
    executedAt: "2026-08-05T09:53:00Z",
    providerTxId: "fill-123",
    sourceAccountId: 5
  });
  assert.equal(tx.valid, true);
  assert.equal(tx.symbol, "ASTER");
  assert.equal(tx.type, "trade");
  assert.equal(tx.side, "buy");
  assert.equal(tx.notional, 127.87);
  assert.equal(tx.unitPrice, 1.28);
  assert.equal(tx.id, "fill-123");
  assert.equal(tx.status, "Filled");
});

test("normalizeTransaction: null notional with valid qty*price derives notional", async () => {
  const tx = up.normalizeTransaction({
    type: "trade",
    side: "buy",
    symbol: "BTC",
    quantity: 0.5,
    unitPrice: 60000,
    notional: null,
    executedAt: "2026-08-05T09:53:00Z",
    providerTxId: "tx-1"
  });
  assert.equal(tx.valid, true);
  assert.equal(tx.notional, 30000);
});

test("normalizeTransaction: null/zero/negative notional + no price => rejected", async () => {
  assert.equal(up.normalizeTransaction({ type: "trade", symbol: "X", notional: null, executedAt: "2026-01-01" }).valid, false);
  assert.equal(up.normalizeTransaction({ type: "trade", symbol: "X", notional: 0, executedAt: "2026-01-01" }).valid, false);
  assert.equal(up.normalizeTransaction({ type: "trade", symbol: "X", notional: -50, executedAt: "2026-01-01" }).valid, false);
  assert.equal(up.normalizeTransaction({ type: "trade", symbol: "X", notional: NaN, executedAt: "2026-01-01" }).valid, false);
});

test("normalizeTransaction: cash-flow event (deposit) is NOT a valid execution", async () => {
  const tx = up.normalizeTransaction({
    type: "deposit",
    side: null,
    symbol: null,
    notional: 5000,
    executedAt: "2026-08-05T09:53:00Z"
  });
  // Deposits are cash flows, not executions — should be rejected by the
  // Execution Log renderer.
  assert.equal(tx.valid, false);
});

test("normalizeTransaction: invalid timestamp => rejected", async () => {
  assert.equal(up.normalizeTransaction({ type: "trade", symbol: "X", notional: 100, executedAt: null }).valid, false);
  assert.equal(up.normalizeTransaction({ type: "trade", symbol: "X", notional: 100, executedAt: "not-a-date" }).valid, false);
});

test("normalizeTransaction: multiple fills at same timestamp are distinct (preserved)", async () => {
  const fill1 = up.normalizeTransaction({
    type: "trade", side: "buy", symbol: "ASTER", quantity: 100, unitPrice: 1.28,
    notional: 127.87, providerTxId: "fill-1", executedAt: "2026-08-05T09:53:00Z"
  });
  const fill2 = up.normalizeTransaction({
    type: "trade", side: "buy", symbol: "ASTER", quantity: 100, unitPrice: 1.25,
    notional: 125.44, providerTxId: "fill-2", executedAt: "2026-08-05T09:53:00Z"
  });
  assert.equal(fill1.valid, true);
  assert.equal(fill2.valid, true);
  // Each fill must have its own stable identity (not collapsed by dedup).
  assert.notEqual(fill1.id, fill2.id);
});

test("normalizeTransaction: legacy schema asset/price maps correctly", async () => {
  const tx = up.normalizeTransaction({
    id: 99,
    asset: "AAPL",
    type: "trade",
    side: "sell",
    price: 150,
    quantity: 10,
    notional: 1500,
    executed_at: "2026-08-05T10:00:00Z"
  });
  assert.equal(tx.valid, true);
  assert.equal(tx.symbol, "AAPL");
  assert.equal(tx.side, "sell");
  assert.equal(tx.unitPrice, 150);
  assert.equal(tx.id, 99);
});

test("getUnifiedTransactions: SQL wraps UNION ALL in subquery with global LIMIT", async () => {
  let capturedSql = null;
  const pool = {
    query(text, params) {
      capturedSql = text;
      // Return 50 non-Polymarket + 100 Polymarket rows (150 total) to verify
      // global limit: the mock applies the outer LIMIT so we can confirm the
      // query passes `limit` as $2 and the result respects it globally.
      const nonPm = Array.from({ length: 50 }, (_, i) => ({
        provider: "hyperliquid", source_type: "wallet", symbol: "X", type: "trade", side: "buy",
        quantity: 1, unit_price: 1, notional: 1, fee: 0, currency: "USD",
        executed_at: new Date(Date.now() - i * 1000).toISOString(), realized_pnl: 0, account_id: 1, id: i, provider_tx_id: `n${i}`
      }));
      const pm = Array.from({ length: 100 }, (_, i) => ({
        provider: "polymarket", source_type: "prediction", symbol: "Y", type: "trade", side: "buy",
        quantity: 1, unit_price: 1, notional: 1, fee: 0, currency: "USD",
        executed_at: new Date(Date.now() - i * 1000).toISOString(), realized_pnl: 0, account_id: 1, id: 1000 + i, provider_tx_id: `p${i}`
      }));
      let all = [...nonPm, ...pm];
      // Simulate the outer LIMIT $2 applied to the combined UNION result.
      const limitParam = params && params[1] != null ? Number(params[1]) : null;
      if (Number.isFinite(limitParam) && limitParam > 0) {
        all = all.slice(0, limitParam);
      }
      return Promise.resolve({ rows: all });
    }
  };
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    // limit=100: should return exactly 100 (global), not 150.
    const tx = await up.getUnifiedTransactions(pool, 1, 100);
    assert.equal(tx.length, 100, "global limit honored across UNION ALL");
    // Verify the SQL structure: UNION ALL inside a subquery, outer LIMIT.
    assert.ok(capturedSql.includes("UNION ALL"), "query uses UNION ALL");
    assert.ok(capturedSql.includes("LIMIT $2"), "query has outer LIMIT $2 on complete result");
    // The outer LIMIT must NOT appear inside the first subquery branch only.
    const outerLimitIdx = capturedSql.indexOf("LIMIT $2");
    const unionIdx = capturedSql.indexOf("UNION ALL");
    assert.ok(outerLimitIdx > unionIdx, "LIMIT $2 comes after UNION ALL (global, not per-branch)");
    // Verify txnId is included.
    assert.ok(tx[0].txnId !== undefined, "txnId field is returned");
  } finally {
    const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO;
    else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});

test("reconcileCashFlows: repairs legacy buy/sell tx types + removes false cash flows", async () => {
  const prev = process.env.ZENIN_UNIFIED_PORTFOLIO;
  process.env.ZENIN_UNIFIED_PORTFOLIO = "true";
  try {
    const calls = [];
    const pool = {
      query(text, params) {
        calls.push({ text, params });
        if (text.startsWith("UPDATE portfolio_source_transactions t")) {
          return Promise.resolve({ rowCount: 5 });
        }
        if (text.startsWith("DELETE FROM portfolio_cash_flows cf")) {
          return Promise.resolve({ rowCount: 3 });
        }
        return Promise.resolve({ rows: [] });
      }
    };
    const result = await up.reconcileCashFlows(pool, 1);
    assert.equal(result.repairedTxTypes, 5, "repaired 5 legacy tx types");
    assert.equal(result.removedFalseFlows, 3, "removed 3 false cash-flow rows");
    // Verify the UPDATE targets buy/sell with side populated.
    const updateSql = calls.find((c) => c.text.startsWith("UPDATE portfolio_source_transactions t"));
    assert.ok(updateSql, "UPDATE query issued");
    assert.ok(updateSql.text.includes("type IN ('buy', 'sell')"), "UPDATE targets buy/sell types");
    assert.ok(updateSql.text.includes("type = 'trade'"), "UPDATE sets type to trade");
    // Verify the DELETE targets false cash-flow artifacts.
    const deleteSql = calls.find((c) => c.text.startsWith("DELETE FROM portfolio_cash_flows cf"));
    assert.ok(deleteSql, "DELETE query issued");
    assert.ok(deleteSql.text.includes("type IN ('buy', 'sell', 'crypto', 'other')"), "DELETE targets execution-side artifacts");
  } finally {
    if (prev === undefined) delete process.env.ZENIN_UNIFIED_PORTFOLIO; else process.env.ZENIN_UNIFIED_PORTFOLIO = prev;
  }
});
