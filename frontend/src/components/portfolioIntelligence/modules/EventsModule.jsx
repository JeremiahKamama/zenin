// =============================================================================
// EventsModule — Recent portfolio events (read-only)
// -----------------------------------------------------------------------------
// Merges trade-execution notifications and recent fills into a single activity
// feed. Read-only; mirrors the existing "Recent Activity" rail but as a full
// Analysis tab.
// =============================================================================

import { useMemo } from "react";
import { DataTable } from "../../data-table/DataTable";
import { normalizeExecutions } from "../services/ExecutionService";
import { formatMoney, formatQuantity, formatRelativeTime, formatTimestamp } from "../formatters";

export function EventsModule({ rawExecutions = [], notifications = [], onManageConnections }) {
  const executions = useMemo(() => normalizeExecutions(rawExecutions), [rawExecutions]);

  const events = useMemo(() => {
    const fromExec = executions.map((e) => ({
      id: `exec-${e.platformFillId || e.id}`,
      kind: "execution",
      symbol: e.symbol,
      side: e.side,
      notional: e.notional,
      qty: e.quantity,
      when: e.executedAt,
      source: String(e.raw?.platformName || e.platform).toUpperCase(),
    }));
    const fromNotifs = (Array.isArray(notifications) ? notifications : [])
      .filter((n) => String(n?.type || "").startsWith("trade_execution."))
      .map((n) => ({
        id: `notif-${n.id}`,
        kind: "notification",
        symbol: n.symbol || (n.title || "").split(" ")[0] || "—",
        side: String(n.side || "").toLowerCase() === "sell" ? "sell" : "buy",
        notional: Number(n.notional || 0),
        qty: Number(n.quantity || 0),
        when: n.createdAt,
        source: "Notification",
      }));
    return [...fromExec, ...fromNotifs]
      .filter((e) => e.when)
      .sort((a, b) => new Date(b.when) - new Date(a.when))
      .slice(0, 200);
  }, [executions, notifications]);

  if (!events.length) {
    return (
      <div className="portfolio-command-tab-panel">
        <div className="portfolio-command-panel-head">
          <div>
            <h3>Events</h3>
            <p>Most recent portfolio activity across connected sources.</p>
          </div>
          {onManageConnections ? (
            <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
              Manage Connections
            </button>
          ) : null}
        </div>
        <div className="portfolio-command-empty">
          <h3>No recent events</h3>
          <p>Portfolio activity will appear here once connected sources start syncing.</p>
        </div>
      </div>
    );
  }

  const columns = [
    { key: "when", header: "When", sortValue: (e) => new Date(e.when).getTime(), cell: (e) => <span title={formatTimestamp(e.when)}>{formatRelativeTime(e.when)}</span> },
    { key: "symbol", header: "Symbol", cell: (e) => <strong>{e.symbol}</strong> },
    {
      key: "side",
      header: "Side",
      cell: (e) => (
        <span className={e.side === "sell" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}>{e.side.toUpperCase()}</span>
      ),
    },
    { key: "qty", header: "Qty", align: "right", sortValue: (e) => e.qty, cell: (e) => formatQuantity(e.qty) },
    { key: "notional", header: "Notional", align: "right", sortValue: (e) => e.notional, cell: (e) => formatMoney(e.notional) },
    { key: "source", header: "Source", cell: (e) => e.source },
  ];

  return (
    <div className="portfolio-command-tab-panel">
      <div className="portfolio-command-panel-head">
        <div>
          <h3>Events</h3>
          <p>Most recent portfolio activity across connected sources.</p>
        </div>
        {onManageConnections ? (
          <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
            Manage Connections
          </button>
        ) : null}
      </div>
      <div className="portfolio-command-table-wrap">
        <DataTable
          columns={columns}
          data={events}
          getRowId={(e) => e.id}
          emptyState={<div className="portfolio-command-empty"><h3>No events</h3></div>}
        />
      </div>
    </div>
  );
}
