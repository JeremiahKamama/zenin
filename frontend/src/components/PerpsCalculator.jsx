import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DensePanelHeader, GuidedEmptyState, InlineControlGroup, RightRailDrawer, WorkspacePageHeader } from "./CompactWorkspaceUI";
import { zeninFetchJson } from "../utils/zeninFetch";

const CRYPTO_ASSETS = ["BTC", "ETH", "SOL", "HYPE", "BNB"];
const STOCK_ASSETS = ["AAPL", "NVDA", "TSLA", "SPY", "MSFT", "AMZN", "GOOGL"];

const formatUsd = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPct = (value, digits = 4) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
};

const formatMs = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n}ms`;
};

function FieldLabel({ children }) {
  return <label className="perps-field-label">{children}</label>;
}

function FieldInput({ value, onChange, type = "text", ...rest }) {
  return (
    <input
      className="perps-field-input"
      type={type}
      value={value}
      onChange={(e) => onChange(type === "number" ? e.target.value : e.target.value)}
      {...rest}
    />
  );
}

function FieldSelect({ value, onChange, options }) {
  return (
    <select className="perps-field-input perps-field-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((opt) => {
        const isObj = typeof opt === "object" && opt !== null;
        const label = isObj ? opt.label : opt;
        const val = isObj ? opt.value : opt;
        return <option key={val} value={val}>{label}</option>;
      })}
    </select>
  );
}

function ResultTile({ label, value, tone = "neutral", helper }) {
  return (
    <div className={`perps-result-tile tone-${tone}`} aria-label={`${label}: ${value}${helper ? `, ${helper}` : ""}`}>
      <span className="perps-tile-label">{label}</span>
      <strong className="perps-tile-value">{value}</strong>
      {helper ? <em className="perps-tile-helper">{helper}</em> : null}
    </div>
  );
}

function VerdictBanner({ profitable, children }) {
  const tone = profitable === null ? "neutral" : profitable ? "profit" : "loss";
  return <div className={`perps-verdict-banner ${tone}`} role="status" aria-live="polite">{children}</div>;
}

// ── Latency Monitor tab ──────────────────────────────────────────────────────
function LatencyMonitorTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState(null);

  const loadData = useCallback(() => {
    setLoading(true);
    zeninFetchJson("/api/perps/latency?window=24h&scenario=post_only")
      .then((payload) => { setData(payload); setError(null); })
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggle = useCallback(async (venueId, currentEnabled) => {
    setToggling(venueId);
    try {
      await zeninFetchJson("/api/perps/runner/toggle", {
        method: "POST",
        body: JSON.stringify({ venueId, enabled: !currentEnabled })
      });
      loadData();
    } catch (err) {
      // Admin-only — silent fail for non-admin users
    } finally {
      setToggling(null);
    }
  }, [loadData]);

  if (loading) {
    return <div className="perps-loading-state">Loading latency data...</div>;
  }
  if (error) {
    return <GuidedEmptyState title="Latency data unavailable" description={error.message} />;
  }
  if (!data?.runnerDeployed && (!data?.venues || data.venues.length === 0)) {
    return (
      <GuidedEmptyState
        eyebrow="Bench runner"
        title="Zenin Probe runner not enabled"
        description="Latency monitoring requires the benchmark runner. Enable the perps-bench-runner (Render Background Worker) with PERPS_BENCH_ENABLED=true, then enable at least one venue below."
        steps={[
          "Deploy perps-bench-runner (Render Background Worker, node perps-bench-runner.js)",
          "Set PERPS_BENCH_ENABLED=true and PERPS_BENCH_MODE=dry_run",
          "Enable venues using the toggles below (admin only)"
        ]}
        cta="Open Fee Comparator"
        onAction={() => { window.dispatchEvent(new CustomEvent("perps-calculator-switch-tab", { detail: "fees" })); }}
      />
    );
  }

  const venues = data.venues || [];
  const bestP95 = venues.filter(v => v.p95 != null).sort((a, b) => a.p95 - b.p95)[0];
  const bestP50 = venues.filter(v => v.p50 != null).sort((a, b) => a.p50 - b.p50)[0];
  const activeCount = venues.filter(v => v.enabled).length;
  const errorCount = venues.filter(v => v.lastError).length;
  const hasSamples = venues.some((venue) => Number(venue.samples) > 0);

  return (
    <div className="perps-latency-monitor">
      <div className="perps-result-tiles four">
        <ResultTile label="Best p95" value={bestP95 ? formatMs(bestP95.p95) : "—"} tone="profit" helper={bestP95 ? `${bestP95.name} · post-only` : "no data"} />
        <ResultTile label="Best p50" value={bestP50 ? formatMs(bestP50.p50) : "—"} tone="profit" helper={bestP50 ? bestP50.name : "no data"} />
        <ResultTile label="Active venues" value={`${activeCount} / ${venues.length}`} helper={`${venues.length} configured`} />
        <ResultTile label="Errors (24h)" value={String(errorCount)} tone={errorCount === 0 ? "profit" : "loss"} helper={errorCount === 0 ? "cleanup success: 100%" : `${errorCount} venue(s) with errors`} />
      </div>

      {!hasSamples ? (
        <GuidedEmptyState
          className="perps-latency-empty"
          eyebrow="Latency monitor"
          title={data.runnerDeployed ? "Waiting for the first benchmark samples" : "Benchmark runner is not deployed"}
          description={data.runnerDeployed
            ? "Venues are configured, but no confirmed latency samples exist yet. This table will populate as the next scheduled run completes."
            : "Deploy the benchmark runner to collect venue latency before using this monitor to make routing decisions."}
          steps={data.runnerDeployed
            ? ["Keep this monitor open or return after the next run.", "Use Fee Comparator for a decision that does not depend on latency samples."]
            : ["Deploy the perps benchmark worker.", "Enable at least one venue, then return here for measured data."]}
          cta="Open Fee Comparator"
          onAction={() => { window.dispatchEvent(new CustomEvent("perps-calculator-switch-tab", { detail: "fees" })); }}
        />
      ) : (
      <div className="perps-venue-matrix">
        <DensePanelHeader
          title="Venue Performance"
          subtitle={`${data.window} window · ${data.scenario}`}
          meta={data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString() : ""}
        />
        <div className="table-scroll">
          <table className="perps-data-table">
          <thead>
            <tr>
              <th>Venue</th><th>Kind</th><th>Samples</th><th>OK</th><th>p50</th><th>p95</th><th>p99</th><th>Cancel p95</th><th>Net floor</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {venues.map((venue) => (
              <tr key={venue.id}>
                <td>{venue.name}</td>
                <td>{String(venue.kind || "").toUpperCase()}</td>
                <td>{venue.samples || 0}</td>
                <td className={venue.okPct >= 99 ? "profit" : ""}>{venue.samples > 0 ? `${venue.okPct}%` : "—"}</td>
                <td>{formatMs(venue.p50)}</td>
                <td className={venue.p95 != null && bestP95?.id === venue.id ? "profit" : ""}>{formatMs(venue.p95)}</td>
                <td>{formatMs(venue.p99)}</td>
                <td>{formatMs(venue.cancelP95)}</td>
                <td>{formatMs(venue.avgNetworkFloor)}</td>
                <td>
                  <button
                    className={`perps-status-toggle ${venue.enabled ? "live" : "disabled"}`}
                    onClick={() => handleToggle(venue.id, venue.enabled)}
                    disabled={toggling === venue.id}
                    title={venue.enabled ? "Click to disable" : "Click to enable (admin only)"}
                  >
                    {venue.enabled ? "● live" : "○ disabled"}
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
        </div>
        <div className="perps-fee-footer">
          <span>Daily budget: {venues.map(v => `${v.name}: ${v.ordersToday}/${v.dailyBudget}`).join(" · ")}</span>
          <span>Runner: {data.runnerDeployed ? "● deployed" : "○ not deployed"}</span>
        </div>
      </div>
      )}

      {venues.some(v => v.lastError) && (
        <div className="perps-error-log">
          <DensePanelHeader title="Recent Errors" />
          {venues.filter(v => v.lastError).map(v => (
            <div key={v.id} className="perps-error-row">
              <strong>{v.name}</strong>
              <span>{v.lastError}</span>
              {v.lastSampleAt && <em>{new Date(v.lastSampleAt).toLocaleString()}</em>}
            </div>
          ))}
        </div>
      )}

      <div className="perps-methodology-note">
        <strong>Methodology:</strong> Dry-run only. Probes each venue's public API endpoint and records the HTTP round-trip as a network-floor baseline — no order placement, no funded accounts. Use these numbers as a relative venue-to-venue comparison, not an absolute order-confirmation latency.
      </div>
    </div>
  );
}

// ── Basis Carry tab ──────────────────────────────────────────────────────────
function BasisCarryTab({ onSaveScenario }) {
  const [inputs, setInputs] = useState({
    symbol: "BTC",
    spotVenue: "hyperliquid",
    perpVenue: "binance",
    sizeUsd: 10000,
    leverage: 3,
    horizonDays: 30,
    fundingMode: "current",
    fundingRatePct: 0.0125,
    fundingIntervalHours: 8,
    borrowAprPct: 2.5,
    entryFeesPct: 0.02,
    slippagePct: 0.05
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fundingContext, setFundingContext] = useState(null);

  const updateInput = useCallback((key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Fetch live funding context for display
  useEffect(() => {
    let cancelled = false;
    zeninFetchJson(`/api/perps/funding?symbol=${inputs.symbol}`)
      .then((payload) => { if (!cancelled) setFundingContext(payload.fundingByVenue); })
      .catch(() => { if (!cancelled) setFundingContext(null); });
    return () => { cancelled = true; };
  }, [inputs.symbol]);

  const recalc = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await zeninFetchJson("/api/calculator/basis", {
        method: "POST",
        body: JSON.stringify(inputs)
      });
      setResult(payload);
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [inputs]);

  const livePerpFunding = fundingContext?.[inputs.perpVenue];
  const liveSpotVenue = fundingContext?.[inputs.spotVenue];

  return (
    <div className="perps-basis-carry">
      <div className="perps-calc-grid">
        <div className="perps-input-panel">
          <DensePanelHeader title="Trade Setup" />
          <InlineControlGroup>
            <div className="perps-field-row">
              <div>
                <FieldLabel>Symbol</FieldLabel>
                <FieldSelect value={inputs.symbol} onChange={(v) => updateInput("symbol", v)} options={CRYPTO_ASSETS} />
              </div>
              <div>
                <FieldLabel>Size (USD)</FieldLabel>
                <FieldInput type="number" value={inputs.sizeUsd} onChange={(v) => updateInput("sizeUsd", Number(v))} />
              </div>
            </div>
            <div className="perps-field-row">
              <div>
                <FieldLabel>Spot venue</FieldLabel>
                <FieldSelect value={inputs.spotVenue} onChange={(v) => updateInput("spotVenue", v)} options={CRYPTO_VENUE_OPTIONS} />
              </div>
              <div>
                <FieldLabel>Perp venue</FieldLabel>
                <FieldSelect value={inputs.perpVenue} onChange={(v) => updateInput("perpVenue", v)} options={CRYPTO_VENUE_OPTIONS} />
              </div>
            </div>
            <div className="perps-field-row">
              <div>
                <FieldLabel>Leverage</FieldLabel>
                <FieldSelect value={String(inputs.leverage)} onChange={(v) => updateInput("leverage", Number(v))} options={["1", "2", "3", "5", "10"]} />
              </div>
              <div>
                <FieldLabel>Horizon (days)</FieldLabel>
                <FieldInput type="number" value={inputs.horizonDays} onChange={(v) => updateInput("horizonDays", Number(v))} />
              </div>
            </div>
          </InlineControlGroup>

          <div className="perps-field-group">
            <FieldLabel>Funding mode</FieldLabel>
            <label className="perps-radio-row"><input type="radio" name="fmode" checked={inputs.fundingMode === "current"} onChange={() => updateInput("fundingMode", "current")} />Current (auto-fetched)</label>
            <label className="perps-radio-row"><input type="radio" name="fmode" checked={inputs.fundingMode === "custom"} onChange={() => updateInput("fundingMode", "custom")} />Custom per-interval %:</label>
            {inputs.fundingMode === "custom" && (
              <FieldInput type="number" value={inputs.fundingRatePct} onChange={(v) => updateInput("fundingRatePct", Number(v))} />
            )}
          </div>

          <InlineControlGroup>
            <div className="perps-field-row">
              <div>
                <FieldLabel>Borrow rate (APR %)</FieldLabel>
                <FieldInput type="number" value={inputs.borrowAprPct} onChange={(v) => updateInput("borrowAprPct", Number(v))} />
              </div>
              <div>
                <FieldLabel>Entry fees (round-trip %)</FieldLabel>
                <FieldInput type="number" value={inputs.entryFeesPct} onChange={(v) => updateInput("entryFeesPct", Number(v))} />
              </div>
            </div>
            <div className="perps-field-row">
              <div>
                <FieldLabel>Slippage (%)</FieldLabel>
                <FieldInput type="number" value={inputs.slippagePct} onChange={(v) => updateInput("slippagePct", Number(v))} />
              </div>
              <div>
                <FieldLabel>Funding interval (h)</FieldLabel>
                <FieldSelect value={String(inputs.fundingIntervalHours)} onChange={(v) => updateInput("fundingIntervalHours", Number(v))} options={["1", "8", "24"]} />
              </div>
            </div>
          </InlineControlGroup>

          <button className="perps-recalc-btn" onClick={recalc} disabled={loading}>
            {loading ? "Calculating..." : "Recalc"}
          </button>

          {fundingContext && (
            <div className="perps-live-funding">
              <span className="perps-field-label">Live funding context</span>
              {livePerpFunding && (
                <div className="perps-funding-row">
                  <span>{inputs.perpVenue} {inputs.symbol}-PERP</span>
                  <strong>{formatPct(livePerpFunding.fundingRate * 100)}</strong>
                </div>
              )}
              {liveSpotVenue && (
                <div className="perps-funding-row">
                  <span>{inputs.spotVenue} mark</span>
                  <strong>{formatUsd(liveSpotVenue.markPrice)}</strong>
                </div>
              )}
              {livePerpFunding && liveSpotVenue && (
                <div className="perps-funding-row">
                  <span>Basis (perp − spot)</span>
                  <strong>{formatUsd(livePerpFunding.markPrice - liveSpotVenue.markPrice)}</strong>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="perps-result-panel">
          {error && <GuidedEmptyState title="Calculation failed" description={error.message} />}
          {!result && !error && (
            <GuidedEmptyState
              title="Basis Carry calculator"
              description="Enter your trade setup and click Recalc to see carry APR, break-even funding, and payoff projections."
              cta="Recalc"
              onAction={recalc}
            />
          )}
          {result && (
            <>
              <div className="perps-result-tiles">
                <ResultTile label="Carry APR" value={`${result.carryAprPct > 0 ? "+" : ""}${result.carryAprPct}%`} tone={result.carryAprPct > 0 ? "profit" : "loss"} helper="after fees + borrow" />
                <ResultTile label="Expected P&L" value={formatUsd(result.netPnlUsd)} tone={result.netPnlUsd > 0 ? "profit" : "loss"} helper={`${inputs.horizonDays}d horizon`} />
                <ResultTile label="Break-even funding" value={formatPct(result.breakEvenFundingPct)} helper="per interval" />
                <ResultTile label="Liquidation distance" value={`${result.liquidationDistancePct}%`} tone="warning" helper="spot drop before liq" />
              </div>

              <div className="perps-cost-breakdown">
                <DensePanelHeader title="Cost Breakdown" />
                <div className="perps-breakdown-row"><span>Gross funding captured</span><strong className="profit">{formatUsd(result.grossFundingUsd)}</strong></div>
                <div className="perps-breakdown-row"><span>Entry fees (round-trip)</span><strong className="loss">{formatUsd(result.entryFeesUsd)}</strong></div>
                <div className="perps-breakdown-row"><span>Slippage (entry + exit)</span><strong className="loss">{formatUsd(result.slippageUsd)}</strong></div>
                <div className="perps-breakdown-row"><span>Borrow cost</span><strong className="loss">{formatUsd(result.borrowUsd)}</strong></div>
                <div className="perps-breakdown-row total"><span>Net carry P&L</span><strong className={result.netPnlUsd > 0 ? "profit" : "loss"}>{formatUsd(result.netPnlUsd)}</strong></div>
                <div className="perps-breakdown-row muted"><span>Net carry per day</span><span>{formatUsd(result.netPerDayUsd)}</span></div>
              </div>

              <VerdictBanner profitable={result.profitable}>
                <strong>{result.profitable ? "Profitable" : "Not profitable"}</strong>
                <p>Funding must stay above {formatPct(result.breakEvenFundingPct)} to cover fees + borrow. Current: {formatPct(result.inputs.fundingRatePct)} · {result.marginOfSafety}× margin of safety.</p>
              </VerdictBanner>

              {result.payoffSeries && result.payoffSeries.length > 1 && (
                <div className="perps-payoff-chart">
                  <DensePanelHeader title="Cumulative P&L over Horizon" meta="assumes funding held constant" />
                  <PayoffChart series={result.payoffSeries} />
                </div>
              )}

              <div className="perps-action-row">
                <button className="perps-secondary-btn" onClick={() => onSaveScenario("basis", inputs, result)}>Save Scenario</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Perp Arbitrage tab ───────────────────────────────────────────────────────
function PerpArbitrageTab({ onSaveScenario }) {
  const [inputs, setInputs] = useState({
    symbol: "BTC",
    venueA: "hyperliquid",
    venueB: "binance",
    sizeUsd: 10000,
    sideA: "short",
    sideB: "long",
    feeRoleA: "taker",
    feeRoleB: "maker",
    fundingWindowHours: 8
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fundingContext, setFundingContext] = useState(null);

  const updateInput = useCallback((key, value) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    zeninFetchJson(`/api/perps/funding?symbol=${inputs.symbol}`)
      .then((payload) => { if (!cancelled) setFundingContext(payload.fundingByVenue); })
      .catch(() => { if (!cancelled) setFundingContext(null); });
    return () => { cancelled = true; };
  }, [inputs.symbol]);

  const recalc = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await zeninFetchJson("/api/calculator/perp-arb", {
        method: "POST",
        body: JSON.stringify(inputs)
      });
      setResult(payload);
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [inputs]);

  const liveA = fundingContext?.[inputs.venueA];
  const liveB = fundingContext?.[inputs.venueB];

  return (
    <div className="perps-perp-arb">
      <div className="perps-arb-header">
        <InlineControlGroup>
          <div className="perps-field-row">
            <div>
              <FieldLabel>Symbol</FieldLabel>
              <FieldSelect value={inputs.symbol} onChange={(v) => updateInput("symbol", v)} options={CRYPTO_ASSETS} />
            </div>
            <div>
              <FieldLabel>Size (USD)</FieldLabel>
              <FieldInput type="number" value={inputs.sizeUsd} onChange={(v) => updateInput("sizeUsd", Number(v))} />
            </div>
            <div>
              <FieldLabel>Funding window</FieldLabel>
              <FieldSelect value={String(inputs.fundingWindowHours)} onChange={(v) => updateInput("fundingWindowHours", Number(v))} options={[{ label: "1h", value: "1" }, { label: "8h", value: "8" }, { label: "24h", value: "24" }]} />
            </div>
          </div>
        </InlineControlGroup>
      </div>

      <div className="perps-arb-venues">
        <div className="perps-arb-venue">
          <DensePanelHeader title="Venue A" meta={inputs.sideA.toUpperCase()} />
          <FieldSelect value={inputs.venueA} onChange={(v) => updateInput("venueA", v)} options={CRYPTO_VENUE_OPTIONS} />
          <div className="perps-venue-meta">
            {liveA && (
              <>
                <div className="perps-meta-row"><span>Mark</span><strong>{formatUsd(liveA.markPrice)}</strong></div>
                <div className="perps-meta-row"><span>Funding</span><strong>{formatPct(liveA.fundingRate * 100)}</strong></div>
              </>
            )}
          </div>
          <FieldLabel>Side</FieldLabel>
          <FieldSelect value={inputs.sideA} onChange={(v) => updateInput("sideA", v)} options={[{ label: "Short perp", value: "short" }, { label: "Long perp", value: "long" }]} />
          <FieldLabel>Fee role</FieldLabel>
          <FieldSelect value={inputs.feeRoleA} onChange={(v) => updateInput("feeRoleA", v)} options={[{ label: "Taker", value: "taker" }, { label: "Maker", value: "maker" }]} />
        </div>

        <div className="perps-arb-venue">
          <DensePanelHeader title="Venue B" meta={inputs.sideB.toUpperCase()} />
          <FieldSelect value={inputs.venueB} onChange={(v) => updateInput("venueB", v)} options={CRYPTO_VENUE_OPTIONS} />
          <div className="perps-venue-meta">
            {liveB && (
              <>
                <div className="perps-meta-row"><span>Mark</span><strong>{formatUsd(liveB.markPrice)}</strong></div>
                <div className="perps-meta-row"><span>Funding</span><strong>{formatPct(liveB.fundingRate * 100)}</strong></div>
              </>
            )}
          </div>
          <FieldLabel>Side</FieldLabel>
          <FieldSelect value={inputs.sideB} onChange={(v) => updateInput("sideB", v)} options={[{ label: "Short perp", value: "short" }, { label: "Long perp", value: "long" }]} />
          <FieldLabel>Fee role</FieldLabel>
          <FieldSelect value={inputs.feeRoleB} onChange={(v) => updateInput("feeRoleB", v)} options={[{ label: "Taker", value: "taker" }, { label: "Maker", value: "maker" }]} />
        </div>
      </div>

      <button className="perps-recalc-btn" onClick={recalc} disabled={loading}>
        {loading ? "Calculating..." : "Recalc Arbitrage"}
      </button>

      {error && <GuidedEmptyState title="Arbitrage calc failed" description={error.message} />}
      {result && (
        <div className="perps-arb-result">
          <DensePanelHeader title="Arbitrage Result" />
          <div className="perps-result-tiles three">
            <ResultTile label="Price basis (A−B)" value={formatUsd(result.priceBasisUsd)} />
            <ResultTile label="Funding basis (A−B)" value={formatPct(result.fundingBasisPct)} tone={result.fundingBasisPct < 0 ? "loss" : "profit"} />
            <ResultTile label="Gross arb / window" value={formatUsd(result.grossArbUsd)} tone={result.grossArbUsd > 0 ? "profit" : "loss"} />
          </div>
          <div className="perps-cost-breakdown">
            <div className="perps-breakdown-row"><span>Fees (round-trip, both venues)</span><strong className="loss">{formatUsd(result.feesUsd)}</strong></div>
            <div className="perps-breakdown-row"><span>Slippage (latency-implied)</span><strong className="loss">{formatUsd(result.slippageUsd)}</strong></div>
            <div className="perps-breakdown-row total"><span>Net per window</span><strong className={result.netPerWindowUsd > 0 ? "profit" : "loss"}>{formatUsd(result.netPerWindowUsd)}</strong></div>
            <div className="perps-breakdown-row muted"><span>Net APR (90d, compounding)</span><span>{result.netAprPct}%</span></div>
            <div className="perps-breakdown-row muted"><span>Capital required</span><span>{formatUsd(result.capitalRequiredUsd)}</span></div>
          </div>
          <VerdictBanner profitable={result.profitable}>
            <strong>{result.profitable ? "Profitable" : "Unprofitable"}</strong>
            <p>Break-even: price basis must exceed {formatUsd(result.breakEvenPriceBasisUsd)}.</p>
          </VerdictBanner>
          <div className="perps-action-row">
            <button className="perps-secondary-btn" onClick={() => onSaveScenario("perp_arb", inputs, result)}>Save Scenario</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Fee Comparator tab ───────────────────────────────────────────────────────
function FeeComparatorTab({ onSaveScenario }) {
  const [mode, setMode] = useState("crypto");
  const [cryptoInputs, setCryptoInputs] = useState({ asset: "BTC", sizeUsd: 50000, role: "taker", mode: "crypto" });
  const [brokerInputs, setBrokerInputs] = useState({ asset: "AAPL", shares: 200, pricePerShare: 200, margin: "no", mode: "broker" });
  const [cryptoResult, setCryptoResult] = useState(null);
  const [brokerResult, setBrokerResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const recalc = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = mode === "crypto"
        ? await zeninFetchJson("/api/calculator/fees", { method: "POST", body: JSON.stringify(cryptoInputs) })
        : await zeninFetchJson("/api/calculator/fees", { method: "POST", body: JSON.stringify(brokerInputs) });
      if (mode === "crypto") setCryptoResult(payload);
      else setBrokerResult(payload);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [mode, cryptoInputs, brokerInputs]);

  return (
    <div className="perps-fee-comparator">
      <div className="perps-mode-toggle">
        <button className={mode === "crypto" ? "active" : ""} onClick={() => setMode("crypto")}>Crypto exchanges</button>
        <button className={mode === "broker" ? "active" : ""} onClick={() => setMode("broker")}>Stock brokers</button>
      </div>

      {mode === "crypto" ? (
        <>
          <InlineControlGroup>
            <div className="perps-field-row">
              <div>
                <FieldLabel>Asset</FieldLabel>
                <FieldSelect value={cryptoInputs.asset} onChange={(v) => setCryptoInputs((p) => ({ ...p, asset: v }))} options={CRYPTO_ASSETS} />
              </div>
              <div>
                <FieldLabel>Trade size (USD)</FieldLabel>
                <FieldInput type="number" value={cryptoInputs.sizeUsd} onChange={(v) => setCryptoInputs((p) => ({ ...p, sizeUsd: Number(v) }))} />
              </div>
              <div>
                <FieldLabel>Role</FieldLabel>
                <FieldSelect value={cryptoInputs.role} onChange={(v) => setCryptoInputs((p) => ({ ...p, role: v }))} options={[{ label: "Taker", value: "taker" }, { label: "Maker", value: "maker" }, { label: "Mixed", value: "mixed" }]} />
              </div>
            </div>
          </InlineControlGroup>
          <button className="perps-recalc-btn" onClick={recalc} disabled={loading}>{loading ? "Calculating..." : "Compare Fees"}</button>
          {error && <GuidedEmptyState title="Fee comparison failed" description={error.message} />}
          {cryptoResult && (
            <FeeTable
              title={`Total Cost to Trade ${formatUsd(cryptoInputs.sizeUsd)} of ${cryptoInputs.asset}`}
              rows={cryptoResult.rows}
              columns={["rank", "venue", "kind", "feeUsd", "fundingPct", "withdrawalUsd", "slippageUsd", "totalUsd"]}
              columnLabels={["#", "Venue", "Kind", "Fee", "Funding", "Withdraw", "Slippage", "Total"]}
              cheapestLabel={`Cheapest: ${cryptoResult.cheapestVenue} (${formatUsd(cryptoResult.cheapestTotalUsd)})`}
              savingsLabel={`Save ${formatUsd(cryptoResult.savingsVsWorstUsd)} vs ${cryptoResult.expensiveVenue}`}
              onSave={() => onSaveScenario("fees_crypto", cryptoInputs, cryptoResult)}
            />
          )}
        </>
      ) : (
        <>
          <InlineControlGroup>
            <div className="perps-field-row">
              <div>
                <FieldLabel>Asset</FieldLabel>
                <FieldSelect value={brokerInputs.asset} onChange={(v) => setBrokerInputs((p) => ({ ...p, asset: v }))} options={STOCK_ASSETS} />
              </div>
              <div>
                <FieldLabel>Shares</FieldLabel>
                <FieldInput type="number" value={brokerInputs.shares} onChange={(v) => setBrokerInputs((p) => ({ ...p, shares: Number(v) }))} />
              </div>
              <div>
                <FieldLabel>Price/share</FieldLabel>
                <FieldInput type="number" value={brokerInputs.pricePerShare} onChange={(v) => setBrokerInputs((p) => ({ ...p, pricePerShare: Number(v) }))} />
              </div>
              <div>
                <FieldLabel>Margin</FieldLabel>
                <FieldSelect value={brokerInputs.margin} onChange={(v) => setBrokerInputs((p) => ({ ...p, margin: v }))} options={[{ label: "No", value: "no" }, { label: "25%", value: "25%" }, { label: "50%", value: "50%" }]} />
              </div>
            </div>
          </InlineControlGroup>
          <button className="perps-recalc-btn" onClick={recalc} disabled={loading}>{loading ? "Calculating..." : "Compare Brokers"}</button>
          {error && <GuidedEmptyState title="Broker comparison failed" description={error.message} />}
          {brokerResult && (
            <FeeTable
              title={`Total Cost to Trade ${brokerInputs.shares} ${brokerInputs.asset} (${formatUsd(brokerResult.notionalUsd)})`}
              rows={brokerResult.rows}
              columns={["rank", "broker", "region", "commissionUsd", "perShareUsd", "fxSpreadPct", "marginApr", "totalUsd"]}
              columnLabels={["#", "Broker", "Region", "Comm.", "Per-share", "FX %", "Margin APR", "Total"]}
              cheapestLabel={`Cheapest: ${brokerResult.cheapestVenue} (${formatUsd(brokerResult.cheapestTotalUsd)})`}
              savingsLabel={`Best margin rate: ${brokerResult.cheapestMarginBroker} (${brokerResult.cheapestMarginApr}% APR)`}
              onSave={() => onSaveScenario("fees_broker", brokerInputs, brokerResult)}
            />
          )}
        </>
      )}
    </div>
  );
}

function FeeTable({ title, rows, columns, columnLabels, cheapestLabel, savingsLabel, onSave }) {
  return (
    <div className="perps-fee-table-wrap">
      <DensePanelHeader title={title} />
      <div className="table-scroll">
        <table className="perps-data-table">
        <thead>
          <tr>{columnLabels.map((label) => <th key={label}>{label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.venueId || row.brokerId || row.rank}`}>
              {columns.map((col) => {
                const value = row[col];
                const isTotal = col === "totalUsd";
                const isRank = col === "rank";
                const display = isTotal ? formatUsd(value) : isRank ? value : (typeof value === "number" ? (col.includes("Pct") || col.includes("Apr") ? value : formatUsd(value)) : value);
                return (
                  <td key={col} className={isTotal ? (row.rank === 1 ? "profit" : "") : ""}>
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
        </div>
      <div className="perps-fee-footer">
        <span>{cheapestLabel}</span>
        <span>{savingsLabel}</span>
        {onSave && <button className="perps-secondary-btn" onClick={onSave}>Save</button>}
      </div>
    </div>
  );
}

// ── Payoff chart (inline SVG) ────────────────────────────────────────────────
function PayoffChart({ series }) {
  const maxPnl = Math.max(...series.map((p) => p.pnlUsd), 0);
  const minPnl = Math.min(...series.map((p) => p.pnlUsd), 0);
  const range = maxPnl - minPnl || 1;
  const width = 600;
  const height = 180;
  const padding = 20;
  const chartH = height - padding * 2;
  const chartW = width - padding * 2;
  const points = series.map((p, i) => {
    const x = padding + (i / (series.length - 1 || 1)) * chartW;
    const y = padding + chartH - ((p.pnlUsd - minPnl) / range) * chartH;
    return `${x},${y}`;
  });
  const areaPath = `M${padding},${padding + chartH} L${points.join(" L")} L${padding + chartW},${padding + chartH} Z`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="perps-payoff-svg">
      <defs>
        <linearGradient id="perps-payoff-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(16,185,129,0.3)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0)" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#perps-payoff-grad)" />
      <polyline points={points.join(" ")} fill="none" stroke="var(--color-success)" strokeWidth="2" />
      <text x={padding} y={height - 5} fontSize="9" fill="var(--color-icon-muted)" fontFamily="monospace">0d</text>
      <text x={width - padding - 20} y={height - 5} fontSize="9" fill="var(--color-icon-muted)" fontFamily="monospace">{series[series.length - 1]?.day}d</text>
    </svg>
  );
}

// ── Saved scenarios drawer ───────────────────────────────────────────────────
function SavedScenariosDrawer({ open, onClose, scenarios, onDelete }) {
  return (
    <RightRailDrawer open={open} onClose={onClose} title="Saved Scenarios" subtitle={`${scenarios.length} saved calculations`}>
      <div className="perps-saved-list">
        {scenarios.length === 0 && <div className="perps-saved-empty">No saved scenarios yet. Run a calculation and click Save.</div>}
        {scenarios.map((scenario) => (
          <div key={scenario.id} className="perps-saved-item">
            <div className="perps-saved-item-head">
              <strong>{scenario.label || scenario.calc_type}</strong>
              <button onClick={() => onDelete(scenario.id)} className="perps-saved-delete">×</button>
            </div>
            <span className="perps-saved-date">{new Date(scenario.created_at).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </RightRailDrawer>
  );
}

// ── Venue options (static, matches backend) ──────────────────────────────────
const CRYPTO_VENUE_OPTIONS = [
  { label: "Hyperliquid", value: "hyperliquid" },
  { label: "Lighter", value: "lighter" },
  { label: "Variational", value: "variational" },
  { label: "Binance", value: "binance" },
  { label: "Bybit", value: "bybit" },
  { label: "dYdX v4", value: "dydx_v4" },
  { label: "Aster", value: "aster" }
];

// ── Main component ───────────────────────────────────────────────────────────
export function PerpsCalculator() {
  const [activeTab, setActiveTab] = useState("latency");
  const [savedScenarios, setSavedScenarios] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState(null);

  // Listen for tab switch events (from LatencyMonitor empty state CTA)
  useEffect(() => {
    const handler = (e) => { if (e.detail) setActiveTab(e.detail); };
    window.addEventListener("perps-calculator-switch-tab", handler);
    return () => window.removeEventListener("perps-calculator-switch-tab", handler);
  }, []);

  const loadScenarios = useCallback(async () => {
    try {
      const payload = await zeninFetchJson("/api/db/perps-calculations?limit=50");
      setSavedScenarios(payload.calculations || []);
    } catch { /* silent — guest mode */ }
  }, []);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);

  const handleSaveScenario = useCallback(async (calcType, inputs, results, label) => {
    try {
      await zeninFetchJson("/api/db/perps-calculations", {
        method: "POST",
        body: JSON.stringify({
          calcType,
          label: label || `${calcType} — ${new Date().toLocaleDateString()}`,
          inputs,
          results
        })
      });
      setSaveFeedback("Scenario saved");
      setTimeout(() => setSaveFeedback(null), 2000);
      loadScenarios();
    } catch (err) {
      setSaveFeedback(`Save failed: ${err.message}`);
      setTimeout(() => setSaveFeedback(null), 3000);
    }
  }, [loadScenarios]);

  const handleDeleteScenario = useCallback(async (id) => {
    try {
      await zeninFetchJson(`/api/db/perps-calculations/${id}`, { method: "DELETE" });
      loadScenarios();
    } catch { /* silent */ }
  }, [loadScenarios]);

  const tabs = [
    { id: "latency", label: "Latency Monitor" },
    { id: "basis", label: "Basis Carry" },
    { id: "arb", label: "Perp Arbitrage" },
    { id: "fees", label: "Fee Comparator" }
  ];

  return (
    <div className="perps-calculator-module">
      <WorkspacePageHeader
        eyebrow="Execution planning"
        title="Calculator"
        description="Carry, arbitrage, fee, and venue-latency modeling across crypto perps and stock brokers."
        status={<span className="perps-header-status">All plans · live data</span>}
        primaryAction={
          <button className="perps-secondary-btn" onClick={() => setDrawerOpen(true)}>
            Saved Scenarios ({savedScenarios.length})
          </button>
        }
      />

      <div className="perps-tab-strip">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`perps-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {saveFeedback && <div className="perps-save-feedback">{saveFeedback}</div>}

      <div className="perps-tab-content">
        {activeTab === "latency" && <LatencyMonitorTab />}
        {activeTab === "basis" && <BasisCarryTab onSaveScenario={handleSaveScenario} />}
        {activeTab === "arb" && <PerpArbitrageTab onSaveScenario={handleSaveScenario} />}
        {activeTab === "fees" && <FeeComparatorTab onSaveScenario={handleSaveScenario} />}
      </div>

      <SavedScenariosDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        scenarios={savedScenarios}
        onDelete={handleDeleteScenario}
      />
    </div>
  );
}
