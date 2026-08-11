// =============================================================================
// OrdersModule — User Order Desk (read-only)
// -----------------------------------------------------------------------------
// Displays normalized orders across all connected brokers/venues. Supports
// working / pending / partial / filled / cancelled / expired / rejected states,
// with row expansion for execution detail. No order entry, no trading controls.
// =============================================================================

import { useMemo, useState } from "react";
import { DataTable } from "../../data-table/DataTable";
import { Badge } from "../../ui/badge";
import { ORDER_STATUS, ORDER_STATUS_LABEL, ORDER_SIDE } from "../models/domainModels";
import { formatMoney, formatQuantity, formatTimestamp, formatProgress, formatBps } from "../formatters";
import { AssetLogo } from "../../../components/AssetLogo";

const STATUS_TONE = {
  [ORDER_STATUS.WORKING]: "outline",
  [ORDER_STATUS.PENDING]: "outline",
  [ORDER_STATUS.PARTIALLY_FILLED]: "warning",
  [ORDER_STATUS.FILLED]: "success",
  [ORDER_STATUS.CANCELLED]: "default",
  [ORDER_STATUS.EXPIRED]: "default",
  [ORDER_STATUS.REJECTED]: "destructive",
};

const STATUS_ORDER = [
  ORDER_STATUS.WORKING,
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PARTIALLY_FILLED,
  ORDER_STATUS.FILLED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.EXPIRED,
  ORDER_STATUS.REJECTED,
];

export function OrdersModule({ orders = [], onManageConnections, assetClassFilter = "all" }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const counts = useMemo(() => {
    const c = { all: orders.length };
    STATUS_ORDER.forEach((s) => (c[s] = 0));
    orders.forEach((o) => {
      if (c[o.status] != null) c[o.status] += 1;
    });
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (assetClassFilter !== "all") {
      rows = rows.filter((o) => {
        const t = String(o.raw?.marketType || o.raw?.assetClass || "").toLowerCase();
        if (assetClassFilter === "crypto") return t.includes("crypto") || t.includes("spot");
        if (assetClassFilter === "equities") return ["stock", "equity", "etf"].includes(t);
        if (assetClassFilter === "options") return t.includes("option");
        if (assetClassFilter === "commodities") return ["commodity", "future"].includes(t);
        return true;
      });
    }
    return [...rows].sort((a, b) => new Date(b.orderedAt || 0) - new Date(a.orderedAt || 0));
  }, [orders, statusFilter, assetClassFilter]);

  const columns = [
    {
      key: "symbol",
      header: "Symbol",
      sortable: true,
      cell: (o) => (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <AssetLogo asset={o} size="xs" />
            <strong className="font-semibold">{o.symbol}</strong>
          </div>
          <span className="text-[var(--color-text-muted)] text-xs">{o.brokerName}</span>
        </div>
      ),
    },
    {
      key: "side",
      header: "Side",
      sortable: true,
      cell: (o) => (
        <span className={o.side === ORDER_SIDE.BUY ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}>
          {o.side.toUpperCase()}
        </span>
      ),
    },
    { key: "orderType", header: "Type", cell: (o) => <span className="capitalize">{o.orderType.replace(/_/g, " ")}</span> },
    { key: "venue", header: "Venue", cell: (o) => o.venueName },
    {
      key: "fillProgress",
      header: "Fill",
      sortValue: (o) => o.fillProgress,
      cell: (o) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 rounded-full bg-[var(--color-border-default)] overflow-hidden">
            <div className="h-full bg-[var(--color-data-primary)]" style={{ width: `${Math.round(o.fillProgress * 100)}%` }} />
          </div>
          <span className="text-xs text-[var(--color-text-secondary)]">{formatProgress(o.fillProgress)}</span>
        </div>
      ),
    },
    { key: "orderedQuantity", header: "Qty", align: "right", sortValue: (o) => o.orderedQuantity, cell: (o) => formatQuantity(o.orderedQuantity) },
    {
      key: "remainingQuantity",
      header: "Remaining",
      align: "right",
      sortValue: (o) => o.remainingQuantity,
      cell: (o) => formatQuantity(o.remainingQuantity),
    },
    {
      key: "timeInMarket",
      header: "Time in Mkt",
      sortValue: (o) => (o.orderedAt ? Date.now() - new Date(o.orderedAt).getTime() : 0),
      cell: (o) => (o.orderedAt ? formatTimeInMarket(o.orderedAt) : "—"),
    },
    {
      key: "estimatedFees",
      header: "Est. Fees",
      align: "right",
      sortValue: (o) => o.estimatedFees ?? -1,
      cell: (o) => (o.estimatedFees != null ? formatMoney(o.estimatedFees, o.raw?.feeCurrency || "USD") : <span className="text-[var(--color-text-muted)]">Est.</span>),
    },
    {
      key: "slippageBps",
      header: "Slippage",
      align: "right",
      sortValue: (o) => o.slippageBps ?? -1,
      cell: (o) => (o.slippageBps != null ? formatBps(o.slippageBps) : <span className="text-[var(--color-text-muted)]">Est.</span>),
    },
    {
      key: "executionScore",
      header: "Exec Score",
      align: "right",
      sortValue: (o) => o.executionScore ?? -1,
      cell: (o) =>
        o.executionScore != null ? (
          <span className={scoreTone(o.executionScore)}>{o.executionScore}</span>
        ) : (
          <span className="text-[var(--color-text-muted)]">—</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      cell: (o) => <Badge variant={STATUS_TONE[o.status] || "default"}>{ORDER_STATUS_LABEL[o.status]}</Badge>,
    },
  ];

  if (!orders.length) {
    return (
      <div className="portfolio-command-tab-panel">
        <div className="portfolio-command-panel-head">
          <div>
            <h3>User Order Desk</h3>
            <p>Normalized orders from every connected broker and venue, in one read-only view.</p>
          </div>
          {onManageConnections ? (
            <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
              Manage Connections
            </button>
          ) : null}
        </div>
        <div className="portfolio-command-empty">
          <h3>No orders from connected venues</h3>
          <p>
            Zenin shows orders your connected, read-only brokers report. Connect a venue (Binance, Bybit, Hyperliquid,
            or a stock broker) to populate the desk. No orders are entered or modified here.
          </p>
          {onManageConnections ? (
            <button type="button" className="portfolio-command-primary-cta subtle" onClick={onManageConnections}>
              Connect Account
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="portfolio-command-tab-panel">
      <div className="portfolio-command-panel-head">
        <div>
          <h3>User Order Desk</h3>
          <p>Normalized orders from every connected broker and venue. Read-only — no order entry or modification.</p>
        </div>
        {onManageConnections ? (
          <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
            Manage Connections
          </button>
        ) : null}
      </div>

      <div className="portfolio-history-toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter orders by status">
          <option value="all">All statuses ({counts.all})</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s]} ({counts[s]})
            </option>
          ))}
        </select>
        <span className="portfolio-command-beta-pill">{orders.length} normalized orders</span>
      </div>

      <div className="portfolio-command-table-wrap">
        <DataTable
          columns={columns}
          data={filtered}
          getRowId={(o) => o.id}
          onRowClick={(o) => setExpandedId((prev) => (prev === o.id ? null : o.id))}
          getRowClassName={(o) => (expandedId === o.id ? "bg-[var(--color-surface-hover)]" : undefined)}
          emptyState={
            <div className="portfolio-command-empty">
              <h3>No orders match this filter</h3>
            </div>
          }
        />
      </div>

      {expandedId ? <OrderDetail order={filtered.find((o) => o.id === expandedId)} onClose={() => setExpandedId(null)} /> : null}
    </div>
  );
}

function OrderDetail({ order, onClose }) {
  if (!order) return null;
  const rows = [
    ["Broker", order.brokerName],
    ["Venue", order.venueName],
    ["Symbol", order.symbol],
    ["Side", order.side.toUpperCase()],
    ["Order Type", order.orderType.replace(/_/g, " ")],
    ["Time in Force", order.timeInForce.toUpperCase()],
    ["Ordered Qty", formatQuantity(order.orderedQuantity)],
    ["Filled Qty", formatQuantity(order.filledQuantity)],
    ["Remaining Qty", formatQuantity(order.remainingQuantity)],
    ["Fill Progress", formatProgress(order.fillProgress)],
    ["Limit Price", order.limitPrice != null ? formatMoney(order.limitPrice) : "—"],
    ["Stop Price", order.stopPrice != null ? formatMoney(order.stopPrice) : "—"],
    ["Avg Fill Price", order.avgFillPrice != null ? formatMoney(order.avgFillPrice) : "—"],
    ["Est. Fees", order.estimatedFees != null ? formatMoney(order.estimatedFees, order.raw?.feeCurrency || "USD") : "Estimate (not reported)"],
    ["Slippage (bps)", order.slippageBps != null ? formatBps(order.slippageBps) : "Estimate (not reported)"],
    ["Execution Score", order.executionScore != null ? String(order.executionScore) : "—"],
    ["Ordered At", formatTimestamp(order.orderedAt)],
    ["Last Update", formatTimestamp(order.updatedAt)],
  ];
  return (
    <div className="portfolio-command-activity-list" style={{ marginTop: 12 }}>
      <div className="portfolio-command-panel-head">
        <div>
          <h3>{order.symbol} — Execution Detail</h3>
          <p>Read-only breakdown from the normalized order record.</p>
        </div>
        <button type="button" className="portfolio-v2-link" onClick={onClose}>
          Collapse
        </button>
      </div>
      <div className="portfolio-command-side-list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTimeInMarket(orderedAt) {
  const ts = new Date(orderedAt).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function scoreTone(score) {
  if (score >= 85) return "text-[var(--color-success)]";
  if (score >= 65) return "text-[var(--color-text-primary)]";
  if (score >= 45) return "text-[var(--color-warning)]";
  return "text-[var(--color-danger)]";
}
