// =============================================================================
// ExecutionModule — Execution Analysis (read-only intelligence)
// -----------------------------------------------------------------------------
// Replaces passive execution history with execution intelligence: execution
// score, avg slippage, fill efficiency, latency, venue comparison, maker/taker
// ratio, largest slippage events, and an execution timeline.
// =============================================================================

import { useMemo } from "react";
import { DataTable } from "../../data-table/DataTable";
import { normalizeExecutions, deriveExecutionIntelligence } from "../services/ExecutionService";
import { formatMoney, formatBps, formatQuantity, formatTimestamp, formatRelativeTime } from "../formatters";

export function ExecutionModule({ rawExecutions = [], onManageConnections }) {
  const executions = useMemo(() => normalizeExecutions(rawExecutions), [rawExecutions]);
  const intel = useMemo(() => deriveExecutionIntelligence(executions), [executions]);

  if (!executions.length) {
    return (
      <div className="portfolio-command-tab-panel">
        <div className="portfolio-command-panel-head">
          <div>
            <h3>Execution Analysis</h3>
            <p>Quality, cost, and venue intelligence for every fill across connected venues.</p>
          </div>
          {onManageConnections ? (
            <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
              Manage Connections
            </button>
          ) : null}
        </div>
        <div className="portfolio-command-empty">
          <h3>No executions yet</h3>
          <p>Connect a read-only venue to import fills and unlock execution intelligence.</p>
          {onManageConnections ? (
            <button type="button" className="portfolio-command-primary-cta subtle" onClick={onManageConnections}>
              Connect Account
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const scoreTone = intel.executionScore >= 85 ? "positive" : intel.executionScore >= 65 ? "neutral" : "negative";

  const venueColumns = [
    { key: "venueName", header: "Venue" },
    { key: "fills", header: "Fills", align: "right", sortValue: (v) => v.fills, cell: (v) => v.fills },
    { key: "notional", header: "Notional", align: "right", sortValue: (v) => v.notional, cell: (v) => formatMoney(v.notional) },
    { key: "avgFeeBps", header: "Avg Fee", align: "right", sortValue: (v) => v.avgFeeBps, cell: (v) => formatBps(v.avgFeeBps) },
    {
      key: "avgSlippageBps",
      header: "Avg Slippage",
      align: "right",
      sortValue: (v) => v.avgSlippageBps,
      cell: (v) => formatBps(v.avgSlippageBps),
    },
  ];

  const slipColumns = [
    { key: "symbol", header: "Symbol", cell: (x) => x.execution.symbol },
    {
      key: "side",
      header: "Side",
      cell: (x) => (
        <span className={x.execution.side === "buy" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
          {x.execution.side.toUpperCase()}
        </span>
      ),
    },
    { key: "venue", header: "Venue", cell: (x) => String(x.execution.raw?.platformName || x.execution.platform).toUpperCase() },
    { key: "price", header: "Fill", align: "right", sortValue: (x) => x.execution.price, cell: (x) => formatMoney(x.execution.price) },
    { key: "reference", header: "Reference", align: "right", sortValue: (x) => x.execution.referencePrice ?? 0, cell: (x) => (x.execution.referencePrice ? formatMoney(x.execution.referencePrice) : "—") },
    { key: "slippageBps", header: "Slippage", align: "right", sortValue: (x) => Math.abs(x.slippageBps), cell: (x) => <span className={x.slippageBps > 0 ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}>{formatBps(x.slippageBps)}</span> },
  ];

  const timelineColumns = [
    { key: "executedAt", header: "Time", sortValue: (e) => new Date(e.executedAt).getTime(), cell: (e) => formatTimestamp(e.executedAt) },
    { key: "symbol", header: "Symbol", cell: (e) => e.symbol },
    {
      key: "side",
      header: "Side",
      cell: (e) => (
        <span className={e.side === "buy" ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>{e.side.toUpperCase()}</span>
      ),
    },
    { key: "venue", header: "Venue", cell: (e) => String(e.raw?.platformName || e.platform).toUpperCase() },
    { key: "quantity", header: "Qty", align: "right", sortValue: (e) => e.quantity, cell: (e) => formatQuantity(e.quantity) },
    { key: "price", header: "Price", align: "right", sortValue: (e) => e.price, cell: (e) => formatMoney(e.price) },
    { key: "role", header: "Role", cell: (e) => (e.liquidityRole ? <span className="capitalize">{e.liquidityRole}</span> : "—") },
  ];

  return (
    <div className="portfolio-command-tab-panel">
      <div className="portfolio-command-panel-head">
        <div>
          <h3>Execution Analysis</h3>
          <p>Quality, cost, and venue intelligence for every fill across connected venues.</p>
        </div>
        {onManageConnections ? (
          <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
            Manage Connections
          </button>
        ) : null}
      </div>

      <div className="portfolio-command-card-grid four">
        <div className={`portfolio-command-mini-card static ${scoreTone}`}>
          <span>Execution Score</span>
          <strong>{intel.executionScore}</strong>
          <em>0–100 quality index</em>
        </div>
        <div className="portfolio-command-mini-card static">
          <span>Avg Slippage</span>
          <strong>{formatBps(intel.avgSlippageBps)}</strong>
          <em>vs reference price</em>
        </div>
        <div className="portfolio-command-mini-card static">
          <span>Fill Efficiency</span>
          <strong>{intel.fillEfficiency.toFixed(0)}</strong>
          <em>passive-fill quality</em>
        </div>
        <div className="portfolio-command-mini-card static">
          <span>Avg Latency</span>
          <strong>{intel.avgLatencyMs != null ? `${intel.avgLatencyMs}ms` : "—"}</strong>
          <em>when reported</em>
        </div>
      </div>

      <div className="portfolio-command-card-grid three" style={{ marginTop: 12 }}>
        <div className="portfolio-command-mini-card static">
          <span>Maker / Taker</span>
          <strong>
            {intel.makerTakerRatio.makerPct != null ? `${intel.makerTakerRatio.makerPct.toFixed(0)}% maker` : "n/a"}
          </strong>
          <em>
            {intel.makerTakerRatio.maker} maker · {intel.makerTakerRatio.taker} taker
          </em>
        </div>
        <div className="portfolio-command-mini-card static">
          <span>Venues</span>
          <strong>{intel.venueComparison.length}</strong>
          <em>tracked routing destinations</em>
        </div>
        <div className="portfolio-command-mini-card static">
          <span>Largest Slip</span>
          <strong>
            {intel.largestSlippageEvents.length
              ? formatBps(intel.largestSlippageEvents[0].slippageBps)
              : "—"}
          </strong>
          <em>worst single fill</em>
        </div>
      </div>

      <div className="portfolio-command-table-wrap" style={{ marginTop: 12 }}>
        <div className="portfolio-command-panel-head">
          <div>
            <h3>Venue Comparison</h3>
            <p>Cost and slippage by routing destination.</p>
          </div>
        </div>
        <DataTable
          columns={venueColumns}
          data={intel.venueComparison}
          getRowId={(v) => v.venue}
          emptyState={<div className="portfolio-command-empty"><h3>No venue data</h3></div>}
        />
      </div>

      <div className="portfolio-command-table-wrap" style={{ marginTop: 12 }}>
        <div className="portfolio-command-panel-head">
          <div>
            <h3>Largest Slippage Events</h3>
            <p>Worst fills vs reference price (bps).</p>
          </div>
        </div>
        <DataTable
          columns={slipColumns}
          data={intel.largestSlippageEvents}
          getRowId={(x) => x.execution.platformFillId || x.execution.id}
          emptyState={<div className="portfolio-command-empty"><h3>No slippage events</h3></div>}
        />
      </div>

      <div className="portfolio-command-table-wrap" style={{ marginTop: 12 }}>
        <div className="portfolio-command-panel-head">
          <div>
            <h3>Execution Timeline</h3>
            <p>Most recent fills, newest first.</p>
          </div>
        </div>
        <DataTable
          columns={timelineColumns}
          data={intel.timeline}
          getRowId={(e) => e.platformFillId || e.id}
          emptyState={<div className="portfolio-command-empty"><h3>No executions</h3></div>}
        />
      </div>
    </div>
  );
}
