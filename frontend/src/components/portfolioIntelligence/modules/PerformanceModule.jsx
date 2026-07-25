// components/portfolioIntelligence/modules/PerformanceModule.jsx
// Replaces the old "attribution" (sector/region/factor) Portfolio sub-tab with a
// closed-trade analytics view: Best Trades (per-trade realized P&L) and
// Asset Performance (per-symbol win-rate / volume / P&L rollup), covering every
// connected broker, exchange, and wallet. Filtering is applied upstream of
// DataTable (DataTable has no built-in filter), per codebase convention.

import React, { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DataTable } from "../../data-table/DataTable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "../../ui/popover";
import { Checkbox } from "../../ui/checkbox";
import { formatCurrency, formatPercent } from "../../../utils/format";
import { analyzeTradePerformance } from "../../../utils/tradePerformance";

const TIME_RANGES = [
  { key: "24H", label: "24H", ms: 24 * 60 * 60 * 1000 },
  { key: "7D", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30D", label: "30D", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "ALL", label: "ALL", ms: null },
];

const sideTone = (value) => (value >= 0 ? "positive" : "negative");

// ----- per-column bucket definitions (drives per-header dropdown options) -----
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

// Each filterable column: key + bucket(row) -> label used for options/filtering.
const BEST_TRADES_FILTERS = {
  asset: (t) => t.symbol,
  side: (t) => t.side,
  entry: (t) => priceBuckets(t.entryPrice),
  exit: (t) => priceBuckets(t.exitPrice),
  duration: (t) => durationBuckets(t.holdDays),
  date: (t) => yearBucket(t.exitAt),
  pnl: (t) => pnlSignBucket(t.pnl),
};
const ASSET_FILTERS = {
  asset: (r) => r.symbol,
  winRate: (r) => winRateBuckets(r.winRate),
  volume: (r) => priceBuckets(r.volume),
  pnl: (r) => pnlSignBucket(r.pnl),
};

function fmtMoney(v, currency) {
  return formatCurrency(v, { currency, symbol: "$" });
}
function fmtSigned(v, currency) {
  return formatCurrency(v, { currency, sign: true, symbol: "$" });
}
function fmtDuration(ms) {
  if (!ms || ms < 0) return "—";
  const totalH = ms / (60 * 60 * 1000);
  const d = Math.floor(totalH / 24);
  const h = Math.floor(totalH % 24);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor(totalH % 1 * 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Header cell with caret + Popover checkbox filter.
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

  if (!filterDef) {
    return <span>{label}</span>;
  }

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

function ConnectionFilter({ value, onChange, accountOptions }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="portfolio-performance-conn-trigger">
        <SelectValue placeholder="All Connections" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Connections</SelectItem>
        {accountOptions.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  const [connection, setConnection] = useState("all");
  const [timeRange, setTimeRange] = useState("30D");
  const [bestFilters, setBestFilters] = useState({});
  const [assetFilters, setAssetFilters] = useState({});

  const analysis = useMemo(
    () => analyzeTradePerformance({ transactions: displayTransactions, livePriceBySymbol }),
    [displayTransactions, livePriceBySymbol]
  );

  const accountOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    const push = (label, value) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      opts.push({ label, value });
    };
    for (const a of connectedAccounts || []) {
      const v = a.platform || a.provider || a.exchange || a.venueType;
      push(a.label || a.provider || a.exchange || v || "Connection", String(v));
    }
    for (const b of brokerageAccounts || []) {
      const v = b.platform || b.provider || b.brokerage || b.name;
      push(b.name || b.label || v || "Brokerage", String(v));
    }
    return opts;
  }, [connectedAccounts, brokerageAccounts]);

  // Apply global Connection + Time-range filters to realizedTrades.
  const filteredRealized = useMemo(() => {
    const now = Date.now();
    const range = TIME_RANGES.find((r) => r.key === timeRange);
    return analysis.realizedTrades.filter((t) => {
      if (connection !== "all") {
        const conn = String(t.platform || t.provider || "");
        if (conn !== connection) return false;
      }
      if (range && range.ms != null) {
        if (!t.exitAt || now - t.exitAt > range.ms) return false;
      }
      return true;
    });
  }, [analysis.realizedTrades, connection, timeRange]);

  const toggleFilter = (store, setStore, key) => (opt) =>
    setStore((prev) => {
      const next = { ...prev };
      const cur = new Set(next[key] || []);
      if (cur.has(opt)) cur.delete(opt);
      else cur.add(opt);
      if (cur.size === 0) delete next[key];
      else next[key] = cur;
      return next;
    });

  const clearFilter = (setStore, key) => () =>
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

  const bestRows = useMemo(() => {
    const filtered = applyColumnFilters(filteredRealized, BEST_TRADES_FILTERS, bestFilters);
    return [...filtered].sort((a, b) => b.pnl - a.pnl);
  }, [filteredRealized, bestFilters]);

  const assetRows = useMemo(() => {
    const bySymbol = new Map();
    for (const t of filteredRealized) {
      const r = bySymbol.get(t.symbol) || { symbol: t.symbol, asset: t.symbol, trades: 0, wins: 0, losses: 0, breakevens: 0, volume: 0, pnl: 0 };
      r.trades += 1;
      r.volume += t.volume;
      r.pnl += t.pnl;
      if (t.pnl > 1e-8) r.wins += 1;
      else if (t.pnl < -1e-8) r.losses += 1;
      else r.breakevens += 1;
      bySymbol.set(t.symbol, r);
    }
    const rows = [...bySymbol.values()].map((r) => {
      const decisive = r.wins + r.losses;
      return { ...r, winRate: decisive ? (r.wins / decisive) * 100 : 0, total: r.wins + r.losses };
    });
    const filtered = applyColumnFilters(rows, ASSET_FILTERS, assetFilters);
    return [...filtered].sort((a, b) => b.pnl - a.pnl);
  }, [filteredRealized, assetFilters]);

  const header = (label, key, defs, store, setStore) => ({
    key,
    header: (
      <PerformanceColumnHeader
        label={label}
        columnKey={key}
        filterDef={defs[key]}
        rows={key === "asset" || key === "side" || key === "entry" || key === "exit" || key === "duration" || key === "date" || key === "pnl"
          ? bestRows
          : assetRows}
        selected={store[key]}
        onToggle={toggleFilter(store, setStore, key)}
        onClear={clearFilter(setStore, key)}
      />
    ),
    sortable: false,
  });

  const bestColumns = [
    header("Asset", "asset", BEST_TRADES_FILTERS, bestFilters, setBestFilters),
    header("Side", "side", BEST_TRADES_FILTERS, bestFilters, setBestFilters),
    header("Entry", "entry", BEST_TRADES_FILTERS, bestFilters, setBestFilters),
    header("Exit", "exit", BEST_TRADES_FILTERS, bestFilters, setBestFilters),
    header("Duration", "duration", BEST_TRADES_FILTERS, bestFilters, setBestFilters),
    header("Date", "date", BEST_TRADES_FILTERS, bestFilters, setBestFilters),
    header("PnL", "pnl", BEST_TRADES_FILTERS, bestFilters, setBestFilters),
  ].map((c, i) => {
    const aligns = ["left", "left", "right", "right", "right", "left", "right"];
    return {
      ...c,
      align: aligns[i],
      cell: (row) => {
        switch (c.key) {
          case "asset":
            return <strong className="portfolio-performance-asset">{row.symbol}</strong>;
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
    header("Asset", "asset", ASSET_FILTERS, assetFilters, setAssetFilters),
    { key: "trades", header: "Trades", sortable: false, align: "left", cell: (row) => <WinLossBar row={row} /> },
    header("Win Rate", "winRate", ASSET_FILTERS, assetFilters, setAssetFilters),
    header("Volume", "volume", ASSET_FILTERS, assetFilters, setAssetFilters),
    header("PnL", "pnl", ASSET_FILTERS, assetFilters, setAssetFilters),
  ].map((c, i) => {
    const aligns = ["left", "left", "right", "right", "right"];
    return {
      ...c,
      align: aligns[i],
      cell: c.cell || ((row) => {
        switch (c.key) {
          case "asset":
            return <strong className="portfolio-performance-asset">{row.symbol}</strong>;
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

  const activeCount = (subTab === "bestTrades" ? bestFilters : assetFilters);
  const hasActiveFilters = Object.keys(activeCount).length > 0;

  return (
    <div className="portfolio-command-tab-panel">
      <div className="portfolio-command-panel-head">
        <div>
          <h3>Performance</h3>
          <p>Closed-trade analytics across every connected broker, exchange, and wallet.</p>
        </div>
        {accountOptions.length === 0 && onManageConnections && (
          <button type="button" className="portfolio-v2-link" onClick={onManageConnections}>
            Manage Connections
          </button>
        )}
      </div>

      <div className="portfolio-performance-controls">
        <div className="portfolio-performance-conn">
          <ConnectionFilter value={connection} onChange={setConnection} accountOptions={accountOptions} />
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
        {hasActiveFilters && (
          <button
            type="button"
            className="portfolio-performance-reset"
            onClick={() => (subTab === "bestTrades" ? setBestFilters({}) : setAssetFilters({}))}
          >
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
              getRowId={(row, i) => `${row.symbol}-${row.exitAt}-${i}`}
              className="portfolio-command-table compact"
              emptyState="No closed trades match the current filters."
            />
          ) : (
            <DataTable
              columns={assetColumns}
              data={assetRows}
              getRowId={(row) => row.symbol}
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
