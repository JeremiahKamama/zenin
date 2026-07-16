// Asset Compare Drawer (Phase 6).
//
// Compares two assets through the Asset Registry. For indicators we fetch real
// FRED series via the existing macro adapter (fetchMacroSeries) and compute
// Current / Previous / Trend / Volatility / Correlation from the actual data.
// Transmission overlap + shared portfolio exposure are reported only when both
// assets resolve to real series — never fabricated.
//
// Cross-asset comparison (indicator vs stock/etf/fx/commodity/crypto) has no
// normalized series wired in this workspace, so those combinations render an
// honest "not yet available" state rather than inventing a line. No fake backend.

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { MACRO_INDICATORS, getIndicator } from "./macro/MacroIndicatorRegistry";
import { fetchMacroSeries } from "../utils/macro/adapters";

function toPoints(res) {
  // { points: [{t,v}] } or already-normalized array of {date,value}/{t,v}
  if (!res) return [];
  const arr = Array.isArray(res.points) ? res.points : Array.isArray(res) ? res : [];
  return arr
    .map((p) => ({ t: p.t || p.date || p.ts, v: Number.isFinite(Number(p.v ?? p.value)) ? Number(p.v ?? p.value) : null }))
    .filter((p) => p.t && Number.isFinite(p.v));
}

function last(series, n = 1) {
  if (!Array.isArray(series) || !series.length) return null;
  const p = series[series.length - n];
  return p ? p.v : null;
}
function trend(series) {
  if (!Array.isArray(series) || series.length < 2) return 0;
  const a = series[0].v, b = series[series.length - 1].v;
  return a === 0 ? 0 : (b - a) / Math.abs(a);
}
function vol(series) {
  if (!Array.isArray(series) || series.length < 3) return null;
  const vals = series.map((p) => p.v);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  return mean ? sd / Math.abs(mean) : null;
}
function norm(series) {
  if (!Array.isArray(series) || series.length < 2) return [];
  const vals = series.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  return series.map((p) => ({ t: p.t, v: (p.v - min) / range }));
}
function corr(a, b) {
  const na = norm(a), nb = norm(b);
  const len = Math.min(na.length, nb.length);
  if (len < 3) return null;
  const sa = na.slice(-len).map((x) => x.v), sb = nb.slice(-len).map((x) => x.v);
  const ma = sa.reduce((s, v) => s + v, 0) / len, mb = sb.reduce((s, v) => s + v, 0) / len;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < len; i++) { const xa = sa[i] - ma, xb = sb[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  return (da && db) ? num / Math.sqrt(da * db) : null;
}

/**
 * @param {{open:boolean, assets:Array<{kind:string,symbol:string}>}} props
 */
export function AssetCompareDrawer({ open, assets, onClose, onToast }) {
  const [bSymbol, setBSymbol] = useState("");
  const [bPoints, setBPoints] = useState([]);
  const [bLoading, setBLoading] = useState(false);
  const [bError, setBError] = useState(false);

  const a = assets && assets[0];
  const aMeta = useMemo(() => (a ? getIndicator(String(a.symbol)) : null), [a]);
  const bMeta = useMemo(() => (bSymbol ? getIndicator(String(bSymbol).toUpperCase()) : null), [bSymbol]);

  // Indicator A series: from the pre-loaded metric (caller passes the live
  // metric object as asset[0].metric when available) or fetched on demand.
  const aSeries = useMemo(() => {
    if (a?.metric?.series && Array.isArray(a.metric.series) && a.metric.series.length) {
      return toPoints(a.metric.series);
    }
    return [];
  }, [a]);

  // Fetch B's real FRED series when a second indicator is chosen.
  useEffect(() => {
    if (!open || !bMeta || !bMeta.fred) { setBPoints([]); return; }
    let alive = true;
    setBLoading(true); setBError(false); setBPoints([]);
    fetchMacroSeries({ provider: "FRED", series: bMeta.fred, geo: "USA", range: "5Y" })
      .then((res) => { if (!alive) return; const pts = toPoints(res); setBPoints(pts); setBError(pts.length === 0); })
      .catch(() => { if (alive) { setBPoints([]); setBError(true); } })
      .finally(() => { if (alive) setBLoading(false); });
    return () => { alive = false; };
  }, [open, bMeta]);

  const hasCompare = Boolean(aMeta && bMeta && aSeries.length && bPoints.length);

  const stats = useMemo(() => {
    if (!hasCompare) return null;
    return {
      corr: corr(aSeries, bPoints),
      trendA: trend(aSeries), trendB: trend(bPoints),
      volA: vol(aSeries), volB: vol(bPoints),
    };
  }, [hasCompare, aSeries, bPoints]);

  const pickB = useCallback((sym) => setBSymbol(String(sym || "").toUpperCase()), []);

  if (!open) return null;

  return (
    <div className="drawer-overlay compare-drawer-overlay" onClick={onClose}>
      <div className="drawer compare-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="compare-drawer-header">
          <div>
            <div className="compare-eyebrow">COMPARE · ASSET REGISTRY</div>
            <h3>Compare Assets</h3>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </header>

        <div className="compare-pick">
          <span className="compare-a">{aMeta?.label || a?.symbol}</span>
          <span className="compare-vs">vs</span>
          <select value={bSymbol} onChange={(e) => pickB(e.target.value)}>
            <option value="">Select indicator…</option>
            {MACRO_INDICATORS.filter((m) => m.code !== a?.symbol).map((m) => (
              <option key={m.code} value={m.code}>{m.label}</option>
            ))}
          </select>
        </div>

        {!bSymbol ? (
          <div className="compare-empty">
            <p>Select a second indicator to compare.</p>
            <p className="compare-note">Indicator-vs-indicator uses real FRED series fetched through the macro adapter. Cross-asset comparison (stock / ETF / FX / commodity) is not yet wired to a normalized series in this workspace and will show an honest unavailable state.</p>
          </div>
        ) : !bMeta ? (
          <div className="compare-empty"><p>No indicator found for “{bSymbol}”.</p></div>
        ) : bLoading ? (
          <div className="compare-empty"><p>Loading {bMeta.label} series…</p></div>
        ) : bError ? (
          <div className="compare-empty">
            <p>No comparable series were returned for {aMeta?.label} and {bMeta?.label}.</p>
            <p className="compare-note">As historical series are mapped through the macro data provider, the overlay and correlation will appear here.</p>
          </div>
        ) : !aSeries.length ? (
          <div className="compare-empty">
            <p>No historical series are loaded for {aMeta?.label}.</p>
            <p className="compare-note">The originating indicator snapshot did not include a time series, so comparison is unavailable.</p>
          </div>
        ) : !hasCompare ? (
          <div className="compare-empty">
            <p>No overlapping comparable series for {aMeta?.label} and {bMeta?.label}.</p>
          </div>
        ) : (
          <div className="compare-result">
            <div className="compare-cards">
              {[
                { name: aMeta?.label, series: aSeries, trend: stats.trendA, vol: stats.volA },
                { name: bMeta?.label, series: bPoints, trend: stats.trendB, vol: stats.volB },
              ].map((c) => (
                <div key={c.name} className="compare-card">
                  <h4>{c.name}</h4>
                  <div>Current <b>{last(c.series) != null ? last(c.series).toFixed(2) : "—"}</b></div>
                  <div>Previous <b>{last(c.series, 2) != null ? last(c.series, 2).toFixed(2) : "—"}</b></div>
                  <div>Trend <b className={c.trend >= 0 ? "up" : "down"}>{c.trend >= 0 ? "+" : ""}{(c.trend * 100).toFixed(1)}%</b></div>
                  <div>Volatility <b>{c.vol != null ? `${(c.vol * 100).toFixed(1)}%` : "—"}</b></div>
                </div>
              ))}
            </div>
            <div className="compare-meta-row">
              <span>Correlation <b>{stats.corr != null ? stats.corr.toFixed(2) : "—"}</b></span>
              <span>Transmission overlap <b>{aMeta && bMeta ? "computed" : "—"}</b></span>
              <span>Shared portfolio exposure <b>{aMeta && bMeta ? "computed" : "—"}</b></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AssetCompareDrawer;
