// =============================================================================
// CostsModule — Fee / cost intelligence (read-only)
// -----------------------------------------------------------------------------
// Surfaces cost context from the trade-fee summary plus a cheapest-avenue
// comparison derived from executions. Reuses the existing feeDashboard shape
// when provided, otherwise derives from executions.
// =============================================================================

import { useMemo } from "react";
import { DataTable } from "../../data-table/DataTable";
import { normalizeExecutions, deriveExecutionIntelligence } from "../services/ExecutionService";
import { formatMoney, formatBps } from "../formatters";

export function CostsModule({ feeDashboard = null, rawExecutions = [] }) {
  const executions = useMemo(() => normalizeExecutions(rawExecutions), [rawExecutions]);
  const intel = useMemo(() => deriveExecutionIntelligence(executions), [executions]);

  const byVenue = intel.venueComparison;
  const totalFees = byVenue.reduce((sum, v) => sum + v.fees, 0);
  const totalNotional = byVenue.reduce((sum, v) => sum + v.notional, 0);
  const blendedFeeBps = totalNotional ? (totalFees / totalNotional) * 10000 : 0;

  const columns = [
    { key: "venueName", header: "Venue", sortable: true },
    { key: "fills", header: "Fills", align: "right", sortValue: (v) => v.fills, cell: (v) => v.fills },
    { key: "notional", header: "Notional", align: "right", sortValue: (v) => v.notional, cell: (v) => formatMoney(v.notional) },
    { key: "fees", header: "Fees", align: "right", sortValue: (v) => v.fees, cell: (v) => formatMoney(v.fees) },
    { key: "avgFeeBps", header: "Avg Fee", align: "right", sortValue: (v) => v.avgFeeBps, cell: (v) => formatBps(v.avgFeeBps) },
  ];

  return (
    <div className="portfolio-command-tab-panel">
      <div className="portfolio-command-panel-head">
        <div>
          <h3>Costs</h3>
          <p>Where your turnover cost goes — by venue and blended — with cheapest-avenue benchmarking.</p>
        </div>
      </div>

      <div className="portfolio-command-card-grid three">
        <div className="portfolio-command-mini-card static">
          <span>{feeDashboard ? "Gross Fees Paid" : "Fees from Executions"}</span>
          <strong>{feeDashboard ? formatMoney(feeDashboard.estimatedUsd) : formatMoney(totalFees)}</strong>
          <em>{feeDashboard ? `${feeDashboard.tradeCount} charged activities` : `${executions.length} fills`}</em>
        </div>
        <div className="portfolio-command-mini-card static">
          <span>Blended Fee Rate</span>
          <strong>{formatBps(blendedFeeBps)}</strong>
          <em>across {byVenue.length} venues</em>
        </div>
        <div className="portfolio-command-mini-card static">
          <span>vs Cheapest Avenue</span>
          <strong className={(feeDashboard?.comparisonDeltaUsd ?? 0) <= 0 ? "positive" : "negative"}>
            {feeDashboard?.comparison ? formatMoney(-feeDashboard.comparisonDeltaUsd) : "Benchmark n/a"}
          </strong>
          <em>{feeDashboard?.comparison ? "savings vs policy" : "Connect venues for benchmark"}</em>
        </div>
      </div>

      <div className="portfolio-command-table-wrap" style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          data={byVenue}
          getRowId={(v) => v.venue}
          emptyState={<div className="portfolio-command-empty"><h3>No cost data yet</h3><p>Connect read-only venues to populate fee history.</p></div>}
        />
      </div>
    </div>
  );
}
