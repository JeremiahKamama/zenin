// components/PortfolioDrillDown.jsx
// Unified Portfolio drill-down: per-source / account breakdown, semantic position
// filters, duplicate-instrument exposure (warning-only), unvalued coverage gaps,
// sync health, and recent immutable EOD snapshots. Monochrome — reuses design-
// system tokens only (no page color).

import React, { useMemo, useState } from "react";
import { AssetLogo } from "./AssetLogo";

function fmtMoney(v, currency = "USD") {
  const n = Number(v || 0);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

function fmtCompact(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtRelativeTime(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (!then) return null;
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SOURCE_LABELS = {
  manual: "Manual",
  brokerage: "SnapTrade",
  wallet: "Wallet"
};

const STATUS_LABEL = {
  synced: "Synced",
  partial: "Partial",
  error: "Error",
  stale: "Stale"
};

const SEMANTIC_FILTERS = [
  { key: "assetType", label: "Asset type" },
  { key: "instrumentType", label: "Instrument" },
  { key: "positionType", label: "Position type" },
  { key: "accountType", label: "Account" },
  { key: "side", label: "Side" }
];

export function PortfolioDrillDown({
  sources = [],
  positions = [],
  summary = null,
  snapshots = [],
  shadow = null,
  baseCurrency = "USD",
  onSync,
  syncing = false
}) {
  const [filters, setFilters] = useState({});
  if (!Array.isArray(sources) || sources.length === 0) return null;

  const filterValues = useMemo(() => {
    const out = {};
    SEMANTIC_FILTERS.forEach(({ key }) => {
      const vals = new Set();
      positions.forEach((p) => {
        const v = p?.[key];
        if (v != null && v !== "") vals.add(String(v));
      });
      out[key] = Array.from(vals).sort();
    });
    return out;
  }, [positions]);

  const filteredPositions = useMemo(() => {
    return positions.filter((p) => SEMANTIC_FILTERS.every(({ key }) => {
      const f = filters[key];
      if (!f) return true;
      return String(p?.[key] || "") === f;
    }));
  }, [positions, filters]);

  const positionMetrics = useMemo(() => {
    return filteredPositions.reduce((acc, p) => {
      acc.portfolioValue += Number(p?.portfolioValue || 0);
      acc.grossExposure += Math.abs(Number(p?.grossExposure || p?.notionalValue || p?.marketValue || 0));
      acc.netExposure += Number(p?.netExposure || p?.notionalValue || p?.marketValue || 0);
      acc.count += 1;
      return acc;
    }, { portfolioValue: 0, grossExposure: 0, netExposure: 0, count: 0 });
  }, [filteredPositions]);

  const s = summary || {};

  function toggleFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? "" : value }));
  }

  function renderLeverageBadge(leverage) {
    if (leverage == null) return null;
    return <span className="pd-lev-badge">{Number(leverage).toFixed(1)}×</span>;
  }

  function renderLiquidationSub(price) {
    if (price == null) return null;
    return <span className="pd-liq-sub">Liq {fmtCompact(price)}</span>;
  }

  function renderFreshness(asOf) {
    if (!asOf) return null;
    const relative = fmtRelativeTime(asOf);
    const absolute = new Date(asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return <span className="pd-freshness" title={absolute}>{relative}</span>;
  }

  return (
    <div className="portfolio-drilldown" aria-label="Unified portfolio breakdown">
      {Array.isArray(positions) && positions.length > 0 && (
        <section className="pd-card pd-positions">
          <header className="pd-card-head">
            <h4>Positions</h4>
            <span className="pd-immutable">{positionMetrics.count} shown</span>
          </header>

          <div className="pd-metrics">
            <div>
              <span className="pd-shadow-k">Portfolio value</span>
              <span className="pd-shadow-v">{fmtCompact(positionMetrics.portfolioValue)}</span>
            </div>
            <div>
              <span className="pd-shadow-k">Gross exposure</span>
              <span className="pd-shadow-v">{fmtCompact(positionMetrics.grossExposure)}</span>
            </div>
            <div>
              <span className="pd-shadow-k">Net exposure</span>
              <span className="pd-shadow-v">{fmtCompact(positionMetrics.netExposure)}</span>
            </div>
            {(Number(s.derivativeGrossExposure) || 0) !== 0 && (
              <div>
                <span className="pd-shadow-k">Derivatives gross</span>
                <span className="pd-shadow-v">{fmtCompact(s.derivativeGrossExposure)}</span>
              </div>
            )}
            {(Number(s.derivativeNetExposure) || 0) !== 0 && (
              <div>
                <span className="pd-shadow-k">Derivatives net</span>
                <span className="pd-shadow-v">{fmtCompact(s.derivativeNetExposure)}</span>
              </div>
            )}
          </div>

          <div className="pd-filters">
            {SEMANTIC_FILTERS.map(({ key, label }) => {
              const values = filterValues[key] || [];
              if (values.length <= 1) return null;
              return (
                <div key={key} className="pd-filter-group">
                  <span className="pd-filter-label">{label}</span>
                  <div className="pd-filter-chips">
                    {values.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`pd-filter-chip ${filters[key] === v ? "active" : ""}`}
                        onClick={() => toggleFilter(key, v)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pd-pos-table-wrap">
            <table className="pd-pos-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th className="numeric">Qty</th>
                  <th className="numeric">Notional</th>
                  <th className="numeric">Portfolio</th>
                  <th className="numeric">Net exp.</th>
                  <th className="numeric">P&L</th>
                  <th>Fresh</th>
                </tr>
              </thead>
              <tbody>
                {filteredPositions.map((p) => (
                  <tr key={p.id || `${p.sourceType}-${p.provider}-${p.symbol}-${p.positionType}`}>
                    <td>
                      <AssetLogo asset={p} size="xs" />
                      <strong>{p.symbol}</strong>
                      <span className="pd-pos-sub">{p.name}{p.accountType ? ` · ${p.accountType}` : ""}</span>
                    </td>
                    <td>{p.side || "—"}</td>
                    <td>
                      {p.instrumentType}{p.positionType ? ` · ${p.positionType}` : ""}
                      {renderLeverageBadge(p.leverage)}
                      {renderLiquidationSub(p.liquidationPrice)}
                    </td>
                    <td className="numeric">{Number(p.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="numeric">{fmtCompact(p.notionalValue)}</td>
                    <td className="numeric">{fmtCompact(p.portfolioValue)}</td>
                    <td className="numeric">{fmtCompact(p.netExposure || p.notionalValue)}</td>
                    <td className={"numeric " + (p.unrealizedPnl != null ? (p.unrealizedPnl >= 0 ? "pd-pnl-pos" : "pd-pnl-neg") : "pd-pnl-na")}>
                      {p.unrealizedPnl != null ? fmtCompact(p.unrealizedPnl) : "—"}
                    </td>
                    <td>{renderFreshness(p.asOf) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {shadow && shadow.enabled && (
        <section className="pd-card">
          <header className="pd-card-head">
            <h4>Rollout check</h4>
            <span className={`pd-rollout pd-rollout-${shadow.recommendation}`}>
              {shadow.recommendation === "promote" ? "Match" : "Hold"}
            </span>
          </header>
          <div className="pd-shadow-grid">
            <div>
              <span className="pd-shadow-k">Legacy manual</span>
              <span className="pd-shadow-v">{fmtMoney(shadow.legacy.manualBook, baseCurrency)}</span>
            </div>
            <div>
              <span className="pd-shadow-k">Unified manual</span>
              <span className="pd-shadow-v">{fmtMoney(shadow.manualSlice.unified, baseCurrency)}</span>
            </div>
            {shadow.connectedHasData && shadow.connectedBook > 0 ? (
              <div>
                <span className="pd-shadow-k">Connected book</span>
                <span className="pd-shadow-v">{fmtMoney(shadow.connectedBook, baseCurrency)}</span>
              </div>
            ) : null}
          </div>
          <p className="pd-note">
            {shadow.manualSlice.withinTolerance
              ? "Manual slices match within tolerance. Connected book is additive (no legacy equivalent)."
              : `Manual slices diverge ${shadow.manualSlice.divergencePct}% — review before promoting.`}
          </p>
        </section>
      )}

      {Array.isArray(snapshots) && snapshots.length > 0 && (
        <section className="pd-card pd-snapshots">
          <header className="pd-card-head"><h4>Daily snapshots</h4><span className="pd-immutable">immutable</span></header>
          <ul className="pd-snap-list">
            {snapshots.slice(0, 7).map((sn) => (
              <li key={sn.id} className="pd-snap-row">
                <span className="pd-snap-date">{sn.snapshotDate}</span>
                <span className="pd-snap-val">{fmtMoney(sn.portfolioValue, sn.baseCurrency || baseCurrency)}</span>
                <span className="pd-snap-meta">{(Array.isArray(sn.sourceBreakdown) ? sn.sourceBreakdown.length : 0)} sources</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default PortfolioDrillDown;
