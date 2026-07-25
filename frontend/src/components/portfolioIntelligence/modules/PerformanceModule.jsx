// components/portfolioIntelligence/modules/PerformanceModule.jsx
// Replaces the old "attribution" (sector/region/factor) Portfolio sub-tab with a
// closed-trade analytics view: Best Trades (per-trade realized P&L) and
// Asset Performance (per-symbol / per-symbol×connection win-rate / volume / P&L),
// covering every connected broker, exchange, wallet, and stock brokerage.
// Filtering is applied upstream of DataTable (DataTable has no built-in filter).

import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DataTable } from "../../data-table/DataTable";
import { Popover, PopoverTrigger, PopoverContent } from "../../ui/popover";
import { Checkbox } from "../../ui/checkbox";
import { formatCurrency, formatPercent } from "../../../utils/format";
import { analyzeTradePerformance, buildConnectionRegistry, detectAssetClass } from "../../../utils/tradePerformance";

const TIME_RANGES = [
  { key: "24H", label: "24H", ms: 24 * 60 * 60 * 1000 },
  { key: "7D", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30D", label: "30D", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "ALL", label: "ALL", ms: null },
];

const ASSET_CLASSES = ["SPOT", "PERP", "OPTIONS", "STOCKS", "FX"];
const sideTone = (value) => (value >= 0 ? "positive" : "negative");

// ----- per-column bucket helpers -----
const priceBuckets = (v) => {
  const n = Math.abs(Number(v) || 0);
  if (n < 1000) return "< $1K";
  if (n < 10000) return "$1K–$10K";
  if (n < 100000) return "$10K–$100K";
  if (n < 1000000) return "$100K–$1M";
  return "> $1M";
};
const durationBuckets = (days) => {
  const d = Number(days) || 0;
  if (d < 1) return "< 1d";
  if (d < 7) return "1–7d";
  if (d < 30) return "7–30d";
  if (d < 90) return "30–90d";
  return "> 90d";
};
const winRateBuckets = (pct) => {
  const p = Number(pct) || 0;
  if (p < 40) return "< 40%";
  if (p < 60) return "40–60%";
  return "> 60%";
};
const pnlSignBucket = (v) => (v > 1e-8 ? "Win" : v < -1e-8 ? "Loss" : "Flat");
const yearBucket = (ts) => {
  if (!ts) return "Unknown";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "Unknown" : String(d.getFullYear());
};

const fmtMoney = (v, currency) => formatCurrency(v, { currency, symbol: "$" });
const fmtSigned = (v, currency) => formatCurrency(v, { currency, sign: true, symbol: "$" });
const fmtDuration = (ms) => {
  if (!ms || ms < 0) return "—";
  const totalH = ms / (60 * 60 * 1000);
  const d = Math.floor(totalH / 24);
  const h = Math.floor(totalH % 24);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor(totalH % 1 * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtDate = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

function PerformanceColumnHeader({ label, columnKey, filterDef, rows, selected, onToggle, onClear }) {
  const options = useMemo(() => {
    if (!filterDef) return [];
    const set = new Set();
    for (const row of rows) {
      const v = filterDef(row);
      if (v != null && v !== "") set.add(String(v));
    }
    return [...set].sort((a, b) => {
      const an = Number(a.replace(/[^0-9.]/g, ""));
      const bn = Number(b.replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
      return a.localeCompare(b);
    });
  }, [filterDef, rows]);

  const [search, setSearch] = useState("");
  const filteredOptions = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  const activeCount = selected?.size || 0;
  if (!filterDef) return <span>{label}</span>;

  const isChecked = (opt) => selected?.has(opt);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`portfolio-performance-col-header ${activeCount ? "is-active" : ""}`}>
          <span>{label}</span>
          <ChevronDown className="portfolio-performance-col-caret" aria-hidden />
          {activeCount > 0 && <span className="portfolio-performance-col-count">{activeCount}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="portfolio-performance-filter-pop">
        <div className="portfolio-performance-filter-head">
          <input
            className="portfolio-performance-filter-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {activeCount > 0 && (
            <button type="button" className="portfolio-performance-filter-clear" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
        <div className="portfolio-performance-filter-list">
          {filteredOptions.length === 0 && <div className="portfolio-performance-filter-empty">No options</div>}
          {filteredOptions.map((opt) => (
            <label key={opt} className="portfolio-performance-filter-item">
              <Checkbox checked={isChecked(opt)} onCheckedChange={() => onToggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConnectionMultiSelect({ options, selected, onToggle, onClearAll }) {
  const [open, setOpen] = React.useState(false);
  const label = selected.size === 0
    ? "All Connections"
    : selected.size === 1
      ? options.find((o) => o.value === [...selected][0])?.label || "1 connection"
      : `${selected.size} connections`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="portfolio-performance-conn-trigger">
          <span>{label}</span>
          <ChevronDown className="portfolio-performance-col-caret" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="portfolio-performance-filter-pop">
        <div className="portfolio-performance-filter-head">
          <span className="portfolio-performance-filter-title">Connections</span>
          {selected.size > 0 && (
            <button type="button" className="portfolio-performance-filter-clear" onClick={onClearAll}>
              Clear
            </button>
          )}
        </div>
        <div className="portfolio-performance-filter-list">
          {options.map((opt) => (
            <label key={opt.value} className="portfolio-performance-filter-item">
              <Checkbox
                checked={selected.has(opt.value)}
                onCheckedChange={() => onToggle(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function PerformanceModule({
  displayTransactions = [],
  displayPositions = [],
  connectedAccounts = [],
  brokerageAccounts = [],
  livePriceBySymbol = {},
  baseCurrency = "USD",
  onManageConnections,
}) {
  const [subTab, setSubTab] = useState("bestTrades");
  const [byConnection, setByConnection] = useState(false);
  const [selectedConns, setSelectedConns] = useState(() => new Set());
  const [timeRange, setTimeRange] = useState("30D");
  const [assetClass, setAssetClass] = useState("all");
  const [bestFilters, setBestFilters] = useState({});
  const [assetFilters, setAssetFilters] = useState({});

  const registry = useMemo(
    () => buildConnectionRegistry({ connectedAccounts, brokerageAccounts }),
    [connectedAccounts, brokerageAccounts]
  );

  const analysis = useMemo(
    () => analyzeTradePerformance({ transactions: displayTransactions, livePriceBySymbol, connections: registry }),
    [displayTransactions, livePriceBySymbol, registry]
  );

  const allTrades = analysis.realizedTrades;

  // Global Connection + Time-range + Asset-class filters.
  const filteredTrades = useMemo(() => {
    const now = Date.now();
    const range = TIME_RANGES.find((r) => r.key === timeRange);
    return allTrades.filter((t) => {
      if (selectedConns.size > 0 && !selectedConns.has(t.connectionId)) return false;
      if (range && range.ms != null && (!t.exitAt || now - t.exitAt > range.ms)) return false;
      if (assetClass !== "all" && t.assetClass !== assetClass) return false;
      return true;
    });
  }, [allTrades, selectedConns, timeRange, assetClass]);

  const toggleSet = (store, setStore, key) => (opt) =>
    setStore((prev) => {
      const next = { ...prev };
      const cur = new Set(next[key] || []);
      if (cur.has(opt)) cur.delete(opt);
      else cur.add(opt);
      if (cur.size === 0) delete next[key];
      else next[key] = cur;
      return next;
    });
  const clearSet = (setStore, key) => () =>
    setStore((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const applyColumnFilters = (rows, defs, store) => {
    const activeKeys = Object.keys(store || {});
    if (activeKeys.length === 0) return rows;
    return rows.filter((row) =>
      activeKeys.every((key) => {
        const set = store[key];
        if (!set || set.size === 0) return true;
        const bucket = defs[key] ? String(defs[key](row)) : "";
        return set.has(bucket);
      })
    );
  };

  const bestDefs = {
    asset: (t) => t.symbol,
    class: (t) => t.assetClass,
    connection: (t) => t.connectionLabel,
    side: (t) => t.side,
    entry: (t) => priceBuckets(t.entryPrice),
    exit: (t) => priceBuckets(t.exitPrice),
    duration: (t) => durationBuckets(t.holdDays),
    date: (t) => yearBucket(t.exitAt),
    pnl: (t) => pnlSignBucket(t.pnl),
  };
  const assetDefs = {
    asset: (r) => r.symbol,
    class: (r) => r.assetClass,
    winRate: (r) => winRateBuckets(r.winRate),
    volume: (r) => priceBuckets(r.volume),
    pnl: (r) => pnlSignBucket(r.pnl),
  };

  const bestRows = useMemo(() => {
    const filtered = applyColumnFilters(filteredTrades, bestDefs, bestFilters);
    return [...filtered].sort((a, b) => b.pnl - a.pnl);
  }, [filteredTrades, bestFilters]);

  const assetRows = useMemo(() => {
    const source = byConnection
      ? analysis.assetReport.flatMap((a) => a.byConnection.map((sc) => ({ ...sc, assetClass: a.assetClass })))
      : analysis.assetReport.map((a) => ({
          symbol: a.symbol,
          assetClass: a.assetClass,
          trades: a.trades,
          wins: a.wins,
          losses: a.losses,
          breakevens: a.breakevens,
          volume: a.volume,
          pnl: a.pnl,
          winRate: a.winRate,
        }));
    const filtered = applyColumnFilters(source, assetDefs, assetFilters);
    return [...filtered].sort((a, b) => b.pnl - a.pnl);
  }, [analysis.assetReport, byConnection, assetFilters]);

  const header = (label, key, defs, store, setStore, rowset) => ({
    key,
    header: (
      <PerformanceColumnHeader
        label={label}
        columnKey={key}
        filterDef={defs[key]}
        rows={rowset}
        selected={store[key]}
        onToggle={toggleSet(store, setStore, key)}
        onClear={clearSet(setStore, key)}
      />
    ),
    sortable: false,
  });

  const bestColumns = [
    header("Asset", "asset", bestDefs, bestFilters, setBestFilters, bestRows),
    header("Class", "class", bestDefs, bestFilters, setBestFilters, bestRows),
    header("Connection", "connection", bestDefs, bestFilters, setBestFilters, bestRows),
    header("Side", "side", bestDefs, bestFilters, setBestFilters, bestRows),
    header("Entry", "entry", bestDefs, bestFilters, setBestFilters, bestRows),
    header("Exit", "exit", bestDefs, bestFilters, setBestFilters, bestRows),
    header("Duration", "duration", bestDefs, bestFilters, setBestFilters, bestRows),
    header("Date", "date", bestDefs, bestFilters, setBestFilters, bestRows),
    header("PnL", "pnl", bestDefs, bestFilters, setBestFilters, bestRows),
  ].map((c, i) => {
    const aligns = ["left", "left", "left", "left", "right", "right", "right", "left", "right"];
    return {
      ...c,
      align: aligns[i],
      cell: (row) => {
        switch (c.key) {
          case "asset":
            return <strong className="portfolio-performance-asset">{row.symbol}</strong>;
          case "class":
            return <span className="portfolio-performance-badge">{row.assetClass}</span>;
          case "connection":
            return <span className="portfolio-performance-conn-label">{row.connectionLabel}</span>;
          case "side":
            return <span className={row.side === "Long" ? "positive" : "negative"}>{row.side}</span>;
          case "entry":
            return fmtMoney(row.entryPrice, baseCurrency);
          case "exit":
            return fmtMoney(row.exitPrice, baseCurrency);
          case "duration":
            return fmtDuration(row.holdMs);
          case "date":
            return fmtDate(row.exitAt);
          case "pnl":
            return <span className={sideTone(row.pnl)}>{fmtSigned(row.pnl, baseCurrency)}</span>;
          default:
            return null;
        }
      },
    };
  });

  const assetColumns = [
    header("Asset", "asset", assetDefs, assetFilters, setAssetFilters, assetRows),
    header("Class", "class", assetDefs, assetFilters, setAssetFilters, assetRows),
    { key: "trades", header: "Trades", sortable: false, align: "left", cell: (row) => <WinLossBar row={row} /> },
    header("Win Rate", "winRate", assetDefs, assetFilters, setAssetFilters, assetRows),
    header("Volume", "volume", assetDefs, assetFilters, setAssetFilters, assetRows),
    header("PnL", "pnl", assetDefs, assetFilters, setAssetFilters, assetRows),
  ].map((c, i) => {
    const aligns = ["left", "left", "left", "right", "right", "right"];
    return {
      ...c,
      align: aligns[i],
      cell: c.cell || ((row) => {
        switch (c.key) {
          case "asset":
            return <strong className="portfolio-performance-asset">{row.symbol}</strong>;
          case "class":
            return <span className="portfolio-performance-badge">{row.assetClass}</span>;
          case "winRate":
            return <span className={row.winRate >= 50 ? "positive" : "negative"}>{formatPercent(row.winRate, { sign: false })}</span>;
          case "volume":
            return fmtMoney(row.volume, baseCurrency);
          case "pnl":
            return <span className={sideTone(row.pnl)}>{fmtSigned(row.pnl, baseCurrency)}</span>;
          default:
            return null;
        }
      }),
    };
  });

  const activeStore = subTab === "bestTrades" ? bestFilters : assetFilters;
  const hasActiveFilters = Object.keys(activeStore).length > 0 || selectedConns.size > 0 || assetClass !== "all";
  const resetAll = () => {
    setBestFilters({});
    setAssetFilters({});
    setSelectedConns(new Set());
    setAssetClass("all");
  };

  const connOptions = registry.list.map((c) => ({ value: c.id, label: c.label }));

  return (
    <div className="portfolio-command-tab-panel">
      <div className="portfolio-command-panel-head">
        <div>
          <h3>Performance</h3>
          <p>Closed-trade analytics across every connected broker, exchange, and wallet.</p>
        </div>
        {registry.list.length === 0 && onManageConnections && (
          <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
            Manage Connections
          </button>
        )}
      </div>

      <div className="portfolio-performance-controls">
        <div className="portfolio-performance-conn">
          <ConnectionMultiSelect
            options={connOptions}
            selected={selectedConns}
            onToggle={(v) =>
              setSelectedConns((prev) => {
                const next = new Set(prev);
                if (next.has(v)) next.delete(v);
                else next.add(v);
                return next;
              })
            }
            onClearAll={() => setSelectedConns(new Set())}
          />
        </div>
        <div className="research-view-subtabs portfolio-performance-timerange" role="tablist" aria-label="Time range">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={timeRange === r.key}
              className={timeRange === r.key ? "active" : ""}
              onClick={() => setTimeRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="portfolio-performance-assetclass">
          <ConnectionMultiSelect
            options={ASSET_CLASSES.map((c) => ({ value: c, label: c }))}
            selected={assetClass === "all" ? new Set() : new Set([assetClass])}
            onToggle={(v) => setAssetClass((prev) => (prev === v ? "all" : v))}
            onClearAll={() => setAssetClass("all")}
          />
        </div>
      </div>

      <div className="research-view-subtabs" role="tablist" aria-label="Performance views">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "bestTrades"}
          className={subTab === "bestTrades" ? "active" : ""}
          onClick={() => setSubTab("bestTrades")}
        >
          Best Trades
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "assetPerformance"}
          className={subTab === "assetPerformance" ? "active" : ""}
          onClick={() => setSubTab("assetPerformance")}
        >
          Asset Performance
        </button>
        {subTab === "assetPerformance" && (
          <button
            type="button"
            className={`portfolio-performance-conn-toggle ${byConnection ? "active" : ""}`}
            aria-pressed={byConnection}
            onClick={() => setByConnection((v) => !v)}
          >
            By connection
          </button>
        )}
        {hasActiveFilters && (
          <button type="button" className="portfolio-performance-reset" onClick={resetAll}>
            Reset filters
          </button>
        )}
      </div>

      <div className="portfolio-command-table-wrap">
        <div className="portfolio-performance-scroll">
          {subTab === "bestTrades" ? (
            <DataTable
              columns={bestColumns}
              data={bestRows}
              getRowId={(row, i) => `${row.symbol}-${row.connectionId}-${row.exitAt}-${i}`}
              className="portfolio-command-table compact"
              emptyState="No closed trades match the current filters."
            />
          ) : (
            <DataTable
              columns={assetColumns}
              data={assetRows}
              getRowId={(row) => (byConnection ? `${row.symbol}-${row.connectionId}` : row.symbol)}
              className="portfolio-command-table compact"
              emptyState="No assets match the current filters."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function WinLossBar({ row }) {
  const total = Math.max(1, row.wins + row.losses);
  const winPct = (row.wins / total) * 100;
  const lossPct = 100 - winPct;
  return (
    <div className="portfolio-performance-winloss">
      <div className="portfolio-performance-winloss-bar">
        <div className="win" style={{ width: `${winPct}%` }} />
        <div className="loss" style={{ width: `${lossPct}%` }} />
      </div>
      <span className="portfolio-performance-winloss-text">
        Win {row.wins} / Loss {row.losses}
      </span>
    </div>
  );
}
