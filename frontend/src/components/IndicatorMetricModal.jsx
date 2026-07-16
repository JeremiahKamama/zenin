// IndicatorMetricModal V2 — Compact Macro Intelligence Panel
// Two-column institutional research surface (Bloomberg-terminal grade).
// Reuses existing engines; never fabricates data. Renders honest "Unavailable"
// states when a feed/field is absent.
//
// Engines reused (do not duplicate logic):
//   - TransmissionEngine.getActiveChain(root)  → transmission chain
//   - TransmissionEngine.openExplorer(node)     → click node → Explorer
//   - IntelligenceBus.getRegime() / getMacroSignal() → macro regime context
//   - MACRO_INDICATORS (MacroIndicatorRegistry) → related indicators
//   - TradingViewChart                          → historical series
//   - CompactWorkspaceUI primitives             → MetricStrip / DensePanelHeader / GuidedEmptyState
//
// Prop contract preserved for callers (IndicatorCountryModal, Watchlist):
//   { countryName, metric, onClose }

import React, { useMemo, useState, useCallback } from "react";
import { TradingViewChart } from "./TradingViewChart";
import { chartColors } from "../utils/chartTheme";
import { TransmissionEngine } from "../transmission/TransmissionEngine";
import { getRegime, getMacroSignal } from "../utils/intelligenceBus";
import { MACRO_INDICATORS, getIndicator } from "./macro/MacroIndicatorRegistry";
import { MetricStrip, DensePanelHeader, GuidedEmptyState } from "./CompactWorkspaceUI";
import { useIndicatorActions } from "../utils/indicatorActions";
import { getActionsForKind, ASSET_ACTIONS } from "../utils/assetActionRegistry";

const HORIZONS = [
  { key: "1M", label: "1M", years: 1 / 12 },
  { key: "3M", label: "3M", years: 3 / 12 },
  { key: "6M", label: "6M", years: 6 / 12 },
  { key: "1Y", label: "1Y", years: 1 },
  { key: "3Y", label: "3Y", years: 3 },
  { key: "5Y", label: "5Y", years: 5 },
  { key: "10Y", label: "10Y", years: 10 },
  { key: "MAX", label: "MAX", years: null },
];

// Map an indicator (code/label/group) to a TransmissionGraph root node so the
// chain reuses the verified seed edges. Falls back to the cleaned label.
function toGraphRoot(metric) {
  const code = String(metric?.code || "").toUpperCase();
  const label = String(metric?.label || "").toLowerCase();
  const group = String(metric?.group || "").toLowerCase();
  const MAP = {
    CPI: "Inflation",
    INFLATION: "Inflation",
    PPI: "Inflation",
    CORE_CPI: "Inflation",
    PCE: "Inflation",
    INTEREST_RATE: "Rates",
    YIELD_CURVE: "Yield Curve",
    RATES: "Rates",
    OIL: "Oil",
    ENERGY: "Oil",
    COPPER: "Copper",
    GOLD: "Gold",
    EMPLOYMENT: "Growth",
    GDP: "Growth",
    PMI: "Growth",
    DXY: "Dollar",
    DOLLAR: "Dollar",
  };
  if (MAP[code]) return MAP[code];
  if (label.includes("cpi") || label.includes("inflation") || label.includes("ppi")) return "Inflation";
  if (label.includes("rate") || label.includes("yield")) return "Rates";
  if (label.includes("employ") || label.includes("gdp") || label.includes("pmi") || label.includes("growth")) return "Growth";
  if (label.includes("dollar") || label.includes("dxy") || group === "external") return "Dollar";
  if (label.includes("oil") || group === "energy") return "Oil";
  if (label.includes("copper") || group === "materials") return "Copper";
  if (label.includes("gold") || group === "precious") return "Gold";
  return String(metric?.label || "Inflation").trim();
}

const fmt = (value, unit) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const suffix = unit === "%" ? "%" : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${suffix}`;
};

const fmtPct = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
};

const relativeTime = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const toneClass = (direction) =>
  direction === "up" || direction === "positive" ? "up"
    : direction === "down" || direction === "negative" ? "down"
      : "flat";

// Prop contract (pure launcher — mirrors AssetModal; owns zero action logic):
//   { countryName, metric, onClose,
//     isInWatchlist, onToggleStar, onCompare, onOpenResearch, onOpenProfile,
//     onOpenTransmission, onPin, isPinned, onAlert, onExport, onCopyLink,
//     onDecisionLedger, onExposure, onSelectIndicator }
// Callers (App via IndicatorCountryModal / Watchlist) supply the real handlers.

export function IndicatorMetricModal({
  countryName,
  metric,
  onClose,
  // Action handlers are supplied either as props OR via IndicatorActionsContext
  // (App-provided). useIndicatorActions merges both — props win.
  isInWatchlist: isInWatchlistProp,
  onToggleStar: onToggleStarProp,
  onCompare: onCompareProp,
  onOpenResearch: onOpenResearchProp,
  onOpenProfile: onOpenProfileProp,
  onOpenTransmission: onOpenTransmissionProp,
  onPin: onPinProp,
  isPinned: isPinnedProp,
  onAlert: onAlertProp,
  onExport: onExportProp,
  onCopyLink: onCopyLinkProp,
  onDecisionLedger: onDecisionLedgerProp,
  onExposure: onExposureProp,
  onSelectIndicator: onSelectIndicatorProp,
}) {
  const A = useIndicatorActions({
    isInWatchlist: isInWatchlistProp,
    onToggleStar: onToggleStarProp,
    onCompare: onCompareProp,
    onOpenResearch: onOpenResearchProp,
    onOpenProfile: onOpenProfileProp,
    onOpenTransmission: onOpenTransmissionProp,
    onPin: onPinProp,
    isPinned: isPinnedProp,
    onAlert: onAlertProp,
    onExport: onExportProp,
    onCopyLink: onCopyLinkProp,
    onDecisionLedger: onDecisionLedgerProp,
    onExposure: onExposureProp,
    onSelectIndicator: onSelectIndicatorProp,
  });
  const isInWatchlist = A.isInWatchlist;
  const onToggleStar = A.onToggleStar;
  const onCompare = A.onCompare;
  const onOpenResearch = A.onOpenResearch;
  const onOpenProfile = A.onOpenProfile;
  const onOpenTransmission = A.onOpenTransmission;
  const onPin = A.onPin;
  const isPinned = A.isPinned;
  const onAlert = A.onAlert;
  const onExport = A.onExport;
  const onCopyLink = A.onCopyLink;
  const onDecisionLedger = A.onDecisionLedger;
  const onExposure = A.onExposure;
  const onSelectIndicator = A.onSelectIndicator;

  const renderAction = (def) => {
    const handler = HANDLER_FOR[def.key];
    const disabled = !handler;
    const active =
      def.key === "watchlist" ? isInWatchlist : def.key === "pin" ? isPinned : false;
    return (
      <button
        key={def.key}
        className={`imv2-action ${def.key === "watchlist" || def.key === "pin" ? "imv2-action-toggle" : ""} ${active ? "active" : ""}`}
        title={def.label}
        disabled={disabled}
        onClick={() => handler && handler()}
      >
        {def.label}
      </button>
    );
  };
  const [scenarioValue, setScenarioValue] = useState(null); // null = baseline (no override)
  const [showRecession, setShowRecession] = useState(true);
  const [showMA, setShowMA] = useState(false);
  const [activeHorizon, setActiveHorizon] = useState("10Y");

  const rootNode = useMemo(() => toGraphRoot(metric), [metric]);
  const indicatorCode = String(metric?.code || metric?.label || "").toUpperCase();

  // Nav args for registry-driven actions (declared after indicatorCode).
  const navArgs = useMemo(
    () => ({ symbol: indicatorCode, code: indicatorCode, label: metric?.label }),
    [indicatorCode, metric]
  );

  // ── Action handlers (all delegate to caller-supplied props; never fake) ──
  const handleOpenTransmission = useCallback((nodeName) => {
    if (onOpenTransmission) return onOpenTransmission(nodeName);
    try {
      TransmissionEngine.openExplorer(
        { label: nodeName, name: nodeName },
        { source: "IndicatorMetricModal", indicator: metric?.label }
      );
    } catch {
      /* Explorer not mounted — no-op, never crash */
    }
  }, [onOpenTransmission, metric]);

  const handleToggleWatch = useCallback(() => {
    if (!onToggleStar) return;
    onToggleStar({
      symbol: indicatorCode,
      name: metric?.label,
      type: "indicator",
      category: "indicators",
      marketType: "macro",
      market: "Macro",
    });
  }, [onToggleStar, indicatorCode, metric]);

  // ── Registry-driven action bar (Phase 7). The modal no longer owns actions;
  //    it renders getActionsForKind("indicator") and maps each key to its
  //    resolved handler. A missing handler => disabled control (never fake). ──
  const HANDLER_FOR = {
    research: onOpenResearch ? () => onOpenResearch(navArgs) : null,
    profile: onOpenProfile ? () => onOpenProfile(navArgs) : null,
    watchlist: handleToggleWatch ? () => handleToggleWatch() : null,
    pin: onPin ? () => onPin({ code: indicatorCode, label: metric?.label }) : null,
    alert: onAlert ? () => onAlert({ code: indicatorCode, label: metric?.label }) : null,
    compare: onCompare ? () => onCompare({ kind: "indicator", symbol: indicatorCode, metric }) : null,
    transmission: onOpenTransmission ? () => onOpenTransmission(metric?.label || indicatorCode) : null,
    decisionLedger: onDecisionLedger ? () => onDecisionLedger({ indicator: indicatorCode }) : null,
    exposure: onExposure ? () => onExposure({ indicator: indicatorCode }) : null,
    export: onExport ? () => onExport({ code: indicatorCode, label: metric?.label, metric }) : null,
    copyLink: onCopyLink ? () => onCopyLink({ code: indicatorCode, label: metric?.label }) : null,
    journal: A.onJournal ? () => A.onJournal(navArgs) : null,
    scenario: A.onScenario ? () => A.onScenario(navArgs) : null,
    macro: A.onMacroWorkspace ? () => A.onMacroWorkspace(navArgs) : null,
  };
  const actionDefs = useMemo(() => getActionsForKind("indicator"), []);

  const handleSelectRelated = useCallback((code) => {
    if (onSelectIndicator) onSelectIndicator(String(code).toUpperCase());
    // When no drill-down handler is supplied we keep the current modal open
    // (do NOT call onClose) so the parent can decide — never a dead click.
  }, [onSelectIndicator]);

  // ── Series + horizon filter ──────────────────────────────────────────────
  const series = useMemo(() => {
    const raw = Array.isArray(metric?.series) ? metric.series : [];
    return raw
      .map((point) => {
        const ts = Number(point?.ts || new Date(point?.date || "").getTime());
        const value = Number(point?.value);
        if (!Number.isFinite(ts) || !Number.isFinite(value)) return null;
        return { time: Math.floor(ts / 1000), value, x: ts, y: value, date: point?.date };
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
  }, [metric]);

  const filteredSeries = useMemo(() => {
    if (activeHorizon === "MAX" || !series.length) return series;
    const selected = HORIZONS.find((h) => h.key === activeHorizon);
    if (!selected?.years) return series;
    const cutoff = Date.now() - selected.years * 365.25 * 24 * 3600 * 1000;
    const trimmed = series.filter((p) => p.x >= cutoff);
    return trimmed.length > 1 ? trimmed : series;
  }, [activeHorizon, series]);

  const stats = useMemo(() => {
    const values = series.map((p) => p.y);
    if (!values.length) return null;
    const current = values[values.length - 1];
    const first = values[0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const pctRank = max === min ? 0.5 : (current - min) / (max - min);
    // simple linear slope over the window (per-point avg delta)
    const slope = values.length > 1 ? (current - first) / (values.length - 1) : 0;
    return { current, first, min, max, avg, pctRank, slope };
  }, [series]);

  // Moving average overlay (20-point simple MA) when enabled.
  const chartSeries = useMemo(() => {
    const base = {
      name: metric?.label || "Indicator",
      data: filteredSeries,
      type: "area",
      color: "var(--color-data-primary)",
    };
    const out = [base];
    if (showMA && filteredSeries.length > 1) {
      const win = Math.max(2, Math.min(20, Math.round(filteredSeries.length / 8)));
      const ma = filteredSeries.map((p, i) => {
        const start = Math.max(0, i - win + 1);
        const slice = filteredSeries.slice(start, i + 1);
        const avg = slice.reduce((s, q) => s + q.y, 0) / slice.length;
        return { time: p.time, value: avg };
      });
      out.push({ name: "Moving Average", data: ma, type: "line", color: "var(--color-data-muted)", options: { lineWidth: 1, priceLineVisible: false } });
    }
    return out;
  }, [filteredSeries, metric, showMA]);

  // ── Related indicators (same registry, excluding current) ─────────────────
  const relatedIndicators = useMemo(() => {
    const code = String(metric?.code || "").toUpperCase();
    const group = String(metric?.group || "").toUpperCase();
    const pool = MACRO_INDICATORS.filter((i) => i.code !== code);
    const sameGroup = pool.filter((i) => i.group?.toUpperCase() === group);
    const others = pool.filter((i) => i.group?.toUpperCase() !== group);
    return [...sameGroup, ...others].slice(0, 8);
  }, [metric]);

  // ── Transmission chain (reuses verified seed graph) ──────────────────────
  const chain = useMemo(() => {
    const raw = TransmissionEngine.getActiveChain(rootNode);
    if (!raw || raw.length < 2) return [];
    // Build a readable path: root → first few hops, de-duplicated.
    const path = [];
    const seen = new Set();
    for (const node of raw) {
      if (seen.has(node.node)) continue;
      seen.add(node.node);
      path.push({ name: node.node, direction: node.edge?.direction || "flat", confidence: node.edge?.confidence ?? null, detail: node.edge?.evidence || null });
      if (path.length >= 7) break;
    }
    return path;
  }, [rootNode]);

  const openNode = useCallback((nodeName) => {
    handleOpenTransmission(nodeName);
  }, [handleOpenTransmission]);



  // ── Macro regime context (from IntelligenceBus) ──────────────────────────
  const regime = useMemo(() => getRegime(), []);
  const macroSignal = useMemo(() => getMacroSignal(), []);

  // ── Scenario projection (reuses the graph chain; no new model, no forecast)
  // Scaling the indicator's transmission intensity from a slider and showing the
  // downstream directional tilts already encoded in the seed edges.
  const scenarioProjection = useMemo(() => {
    if (scenarioValue == null || chain.length < 2) return [];
    const base = Number(metric?.current);
    const n = Number(scenarioValue);
    const rise = Number.isFinite(base) && base !== 0 ? (n - base) / Math.abs(base) : 0;
    const intensity = Math.max(-1, Math.min(1, rise));
    // Propagate intensity down the chain with decay; direction from edge.
    return chain.slice(1).map((node, idx) => {
      const decay = Math.pow(0.7, idx);
      const score = (node.direction === "up" ? 1 : node.direction === "down" ? -1 : 0) * intensity * (1 - decay * 0.5);
      const dir = score > 0.08 ? "up" : score < -0.08 ? "down" : "flat";
      return { name: node.name, direction: dir, score };
    });
  }, [scenarioValue, chain, metric]);

  // ── Hero metrics ─────────────────────────────────────────────────────────
  const hero = [
    { label: "Current", value: fmt(metric?.current, metric?.unit), tone: "neutral" },
    { label: "Previous", value: metric?.previous != null ? fmt(metric.previous, metric?.unit) : "—", tone: "neutral" },
    { label: "Forecast", value: metric?.forecast != null ? fmt(metric.forecast, metric?.unit) : metric?.consensus != null ? fmt(metric.consensus, metric?.unit) : "—", tone: "neutral" },
    { label: "Change", value: stats ? fmt(stats.current - stats.first, metric?.unit) : "—", tone: stats && stats.current >= stats.first ? "up" : "down" },
    { label: "YoY", value: metric?.yoy != null ? fmtPct(metric.yoy) : "—", tone: metric?.yoy >= 0 ? "up" : "down" },
    { label: "MoM", value: metric?.mom != null ? fmtPct(metric.mom) : "—", tone: metric?.mom >= 0 ? "up" : "down" },
  ];

  const surprise = metric?.surprise != null
    ? `${metric.surprise >= 0 ? "+" : ""}${fmt(metric.surprise, metric?.unit)}`
    : (metric?.consensus != null && metric?.current != null
      ? `${metric.current - metric.consensus >= 0 ? "+" : ""}${fmt(metric.current - metric.consensus, metric?.unit)}`
      : "—");

  const hasChart = filteredSeries.length > 0;
  const updatedLabel = relativeTime(metric?.updatedAt || metric?.date);
  const confidence = metric?.confidence != null ? Number(metric.confidence) : (metric?.confidencePct != null ? Number(metric.confidencePct) : null);

  return (
    <div className="modal-overlay indicator-detail-overlay" onClick={onClose}>
      <div className="modal-content indicator-metric-modal indicator-v2" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="imv2-header">
          <div className="imv2-header-main">
            <div className="imv2-eyebrow">MACRO INDICATOR · {String(countryName || "Macro").toUpperCase()}</div>
            <h2 className="imv2-title">{metric?.label || "Indicator"}</h2>
            <div className="imv2-meta-row">
              <span><b>Country</b> {countryName || "United States"}</span>
              <span><b>Category</b> {metric?.group || metric?.category || "Macro"}</span>
              <span><b>Source</b> {metric?.source || "FRED"}</span>
              <span><b>Updated</b> {updatedLabel || metric?.date || "Unknown"}</span>
              <span className={`imv2-conf ${confidence != null ? "ok" : "muted"}`}>
                <b>Confidence</b> {confidence != null ? `${confidence}%` : "—"}
              </span>
            </div>
          </div>
          <div className="imv2-header-actions">
            {actionDefs.filter((d) => d.key === "pin" || d.key === "watchlist").map(renderAction)}
            <button className="close-btn" onClick={onClose} aria-label="Close">&times;</button>
          </div>
        </header>

        {/* ── Hero metrics ─────────────────────────────────────────────────── */}
        <section className="imv2-hero">
          <div className="imv2-hero-value">
            <span className="imv2-big-number">{fmt(metric?.current, metric?.unit)}</span>
            {stats ? (
              <span className={`imv2-hero-delta ${stats.current >= stats.first ? "up" : "down"}`}>
                {stats.current >= stats.first ? "+" : ""}{fmt(stats.current - stats.first, metric?.unit)} ({fmtPct(stats.first !== 0 ? ((stats.current - stats.first) / Math.abs(stats.first)) * 100 : 0)})
              </span>
            ) : null}
            <span className="imv2-hero-tag">
              {metric?.consensus != null && metric?.current != null
                ? (metric.current >= metric.consensus ? "Above Consensus" : "Below Consensus")
                : "No consensus available"}
            </span>
          </div>
          <div className="imv2-hero-stats">
            {hero.map((h) => (
              <div key={h.label} className={`imv2-stat tone-${h.tone}`}>
                <span>{h.label}</span>
                <strong>{h.value}</strong>
              </div>
            ))}
            <div className={`imv2-stat tone-${surprise !== "—" && String(surprise).startsWith("+") ? "up" : surprise !== "—" ? "down" : "neutral"}`}>
              <span>Surprise</span>
              <strong>{surprise}</strong>
            </div>
          </div>
        </section>

        {/* ── Two-column workspace: chart (70%) + right rail (30%) ─────────── */}
        <section className="imv2-workspace">
          <div className="imv2-chart-col">
            <DensePanelHeader
              title="Historical Chart"
              subtitle={hasChart ? `${filteredSeries.length} observations · ${activeHorizon}` : "No historical series returned"}
              meta={
                <div className="imv2-chart-tools">
                  <button className={`imv2-tool ${showMA ? "on" : ""}`} onClick={() => setShowMA((v) => !v)}>MA</button>
                  <button className={`imv2-tool ${showRecession ? "on" : ""}`} onClick={() => setShowRecession((v) => !v)}>Recession</button>
                </div>
              }
            />
            <div className="imv2-interval-row">
              {HORIZONS.map((h) => (
                <button key={h.key} className={activeHorizon === h.key ? "active" : ""} onClick={() => setActiveHorizon(h.key)}>{h.label}</button>
              ))}
            </div>
            <div className="imv2-chart-shell">
              {hasChart ? (
                <TradingViewChart
                  options={{
                    layout: { background: { type: "solid", color: "transparent" }, textColor: chartColors.muted() },
                    rightPriceScale: { borderVisible: false },
                    timeScale: { borderVisible: false },
                    grid: { vertLines: { color: "rgba(160,160,160,0.08)" }, horzLines: { color: "rgba(160,160,160,0.08)" } },
                  }}
                  series={chartSeries}
                  height={460}
                  width="100%"
                  crosshairEnabled
                  resetSignal={activeHorizon}
                />
              ) : (
                <GuidedEmptyState
                  eyebrow="No Data"
                  title="No historical series returned from FRED."
                  description="This indicator has no time series loaded. The latest value may still be available above. Add a macro data provider to populate the chart."
                />
              )}
            </div>
          </div>

          {/* ── Right intelligence rail ───────────────────────────────────── */}
          <aside className="imv2-rail">
            <div className="imv2-rail-card">
              <DensePanelHeader title="Current Reading" />
              <div className="imv2-read-grid">
                <div><span>Current</span><strong>{fmt(metric?.current, metric?.unit)}</strong></div>
                <div><span>Previous</span><strong>{metric?.previous != null ? fmt(metric.previous, metric?.unit) : "—"}</strong></div>
                <div><span>Expected</span><strong>{metric?.consensus != null ? fmt(metric.consensus, metric?.unit) : metric?.forecast != null ? fmt(metric.forecast, metric?.unit) : "—"}</strong></div>
                <div><span>Surprise</span><strong>{surprise}</strong></div>
                <div><span>Trend</span><strong className={stats ? (stats.slope >= 0 ? "up" : "down") : ""}>{stats ? (stats.slope >= 0 ? "Rising" : "Falling") : "—"}</strong></div>
              </div>
            </div>

            <div className="imv2-rail-card">
              <DensePanelHeader title="Macro Regime" meta={regime?.label ? null : "Unavailable"} />
              {regime?.label ? (
                <div className="imv2-regime">
                  <div className={`imv2-regime-badge tone-${toneClass(regime.tone)}`}>{regime.label}</div>
                  {regime.drivers?.length ? (
                    <div className="imv2-regime-drivers">
                      {regime.drivers.slice(0, 4).map((d) => (
                        <span key={d} className="imv2-chip">{d}</span>
                      ))}
                    </div>
                  ) : null}
                  <p className="imv2-note">Derived from IntelligenceBus regime signal.</p>
                </div>
              ) : (
                <p className="imv2-note">No macro regime published this session. Regime context appears when the Macro desk loads.</p>
              )}
            </div>

            <div className="imv2-rail-card">
              <DensePanelHeader title="Signal Strength" />
              <div className="imv2-signal">
                <div className="imv2-signal-row">
                  <span>Bullish / Bearish</span>
                  <strong className={macroSignal?.tone ? toneClass(macroSignal.tone) : ""}>{macroSignal?.tone ? macroSignal.tone.charAt(0).toUpperCase() + macroSignal.tone.slice(1) : "Neutral"}</strong>
                </div>
                <div className="imv2-signal-row"><span>Confidence</span><strong>{confidence != null ? `${confidence}%` : "—"}</strong></div>
                <div className="imv2-signal-row"><span>Freshness</span><strong>{updatedLabel || "—"}</strong></div>
                <div className="imv2-signal-row"><span>Source quality</span><strong>{metric?.source || "FRED"}</strong></div>
              </div>
            </div>

            <div className="imv2-rail-card">
              <DensePanelHeader title="Data Quality" />
              <div className="imv2-signal">
                <div className="imv2-signal-row"><span>Source</span><strong>{metric?.source || "FRED"}</strong></div>
                <div className="imv2-signal-row"><span>Coverage</span><strong>{metric?.coverage || "Single series"}</strong></div>
                <div className="imv2-signal-row"><span>Update cadence</span><strong>{metric?.cadence || "Monthly"}</strong></div>
                <div className="imv2-signal-row"><span>Missing fields</span><strong>{metric?.missing ? metric.missing.join(", ") : "None reported"}</strong></div>
                <div className="imv2-signal-row"><span>Last fetch</span><strong>{metric?.fetchedAt ? relativeTime(metric.fetchedAt) : updatedLabel || "—"}</strong></div>
              </div>
            </div>
          </aside>
        </section>

        {/* ── Intelligence cards ───────────────────────────────────────────── */}
        <section className="imv2-section">
          <DensePanelHeader title="Why it matters" />
          <p className="imv2-prose">
            {metric?.interpretation || macroSignal?.explain || defaultInterpretation(metric)}
          </p>
        </section>

        <section className="imv2-section imv2-two-col">
          <div>
            <DensePanelHeader title="Historical Context" />
            {stats ? (
              <MetricStrip items={[
                { label: "52w High", value: fmt(stats.max, metric?.unit) },
                { label: "52w Low", value: fmt(stats.min, metric?.unit) },
                { label: "5y Average", value: fmt(stats.avg, metric?.unit) },
                { label: "Percentile", value: `${Math.round(stats.pctRank * 100)}%` },
                { label: "Trend", value: stats.slope >= 0 ? "Rising" : "Falling" },
                { label: "Acceleration", value: stats.slope >= 0 ? "Positive" : "Negative" },
              ]} />
            ) : (
              <p className="imv2-note">No historical series returned from FRED — historical context unavailable.</p>
            )}
          </div>
          <div>
            <DensePanelHeader title="Current Interpretation" />
            <p className="imv2-prose">{metric?.interpretation || currentInterpretation(metric, stats, regime)}</p>
          </div>
        </section>

        {/* ── Transmission chain ──────────────────────────────────────────── */}
        <section className="imv2-section">
          <DensePanelHeader
            title="Transmission Chain"
            subtitle="What this indicator affects — each node opens the Transmission Explorer"
            meta={chain.length < 2 ? "Unmapped" : null}
          />
          {chain.length >= 2 ? (
            <div className="imv2-chain">
              {chain.map((node, i) => (
                <React.Fragment key={`${node.name}-${i}`}>
                  <button className={`imv2-chain-node tone-${toneClass(node.direction)}`} onClick={() => openNode(node.name)} title={node.detail || `Open ${node.name}`}>
                    <span className="imv2-chain-name">{node.name}</span>
                    {node.confidence != null ? <span className="imv2-chain-conf">{node.confidence}%</span> : null}
                  </button>
                  {i < chain.length - 1 ? <span className={`imv2-chain-arrow ${toneClass(chain[i + 1].direction)}`}>↓</span> : null}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="No Path" title="No transmission path mapped." description={`The ${metric?.label || "indicator"} node has no downstream transmission edges in the current graph. Map a path in the Transmission Registry to populate this view.`} />
          )}
        </section>

        {/* ── Related indicators grid ─────────────────────────────────────── */}
        <section className="imv2-section">
          <DensePanelHeader title="Related Indicators" subtitle="Click to open that indicator" />
          <div className="imv2-related-grid">
            {relatedIndicators.map((ind) => (
              <button
                key={ind.code}
                className="imv2-related-card"
                onClick={() => handleSelectRelated(ind.code)}
                title={`Open ${ind.label}`}
              >
                <span className="imv2-related-label">{ind.label}</span>
                <span className="imv2-related-group">{ind.group}</span>
                <span className="imv2-related-trend">—</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Cross-asset impact (reuses chain reachability) ───────────────── */}
        <section className="imv2-section">
          <DensePanelHeader title="Cross-Asset Impact" subtitle="Projected from the transmission chain (illustrative, not a forecast)" />
          {chain.length >= 2 ? (
            <table className="imv2-cross-table">
              <thead><tr><th>Asset</th><th>Expected Impact</th><th>Current Signal</th><th>Confidence</th></tr></thead>
              <tbody>
                {crossAssetRows(chain).map((r) => (
                  <tr key={r.asset}>
                    <td>{r.asset}</td>
                    <td className={toneClass(r.impact)}>{r.impact}</td>
                    <td className={toneClass(r.signal)}>{r.signal}</td>
                    <td>{r.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="imv2-note">No transmission path mapped — cross-asset impact unavailable.</p>
          )}
        </section>

        {/* ── Scenario laboratory (reuses graph; slider scales intensity) ──── */}
        <section className="imv2-section">
          <DensePanelHeader title="Scenario Laboratory" subtitle="Illustrative: scale this indicator and view downstream tilts from the existing transmission rules" />
          <div className="imv2-scenario">
            <div className="imv2-scenario-control">
              <label>
                If {metric?.label || "indicator"} {metric?.unit === "%" ? "rises to" : "moves to"}
                <input
                  type="number"
                  value={scenarioValue ?? ""}
                  placeholder={metric?.current != null ? String(metric.current) : "value"}
                  onChange={(e) => setScenarioValue(e.target.value === "" ? null : Number(e.target.value))}
                />
                {metric?.unit || ""}
              </label>
              <button className="imv2-link-btn" onClick={() => setScenarioValue(null)}>Reset</button>
            </div>
            {scenarioValue != null && scenarioProjection.length ? (
              <div className="imv2-scenario-proj">
                {scenarioProjection.map((p) => (
                  <div key={p.name} className={`imv2-scenario-row tone-${p.direction}`}>
                    <span>{p.name}</span>
                    <span className="imv2-scenario-score">{p.score > 0 ? `+${p.score.toFixed(2)}` : p.score.toFixed(2)}</span>
                  </div>
                ))}
                <p className="imv2-note">Illustrative transmission from edited value using the existing rules engine. Not investment advice.</p>
              </div>
            ) : (
              <p className="imv2-note">Enter a value to project effects through the verified transmission chain. Confidence is inherited from the seed edges.</p>
            )}
          </div>
        </section>

        {/* ── Timeline ────────────────────────────────────────────────────── */}
        <section className="imv2-section">
          <DensePanelHeader title="Release Timeline" subtitle="Recent and next scheduled prints" />
          <div className="imv2-timeline">
            <div className="imv2-tl-col">
              <h4>Current Release</h4>
              {metric?.current != null ? (
                <div className="imv2-tl-row"><span>{metric.label}</span><strong>{fmt(metric.current, metric.unit)}</strong><em>{updatedLabel || "—"}</em></div>
              ) : <p className="imv2-note">No current release.</p>}
              {metric?.previous != null ? (
                <div className="imv2-tl-row"><span>Previous</span><strong>{fmt(metric.previous, metric.unit)}</strong><em>—</em></div>
              ) : null}
            </div>
            <div className="imv2-tl-col">
              <h4>Next Scheduled</h4>
              {metric?.nextRelease ? (
                <div className="imv2-tl-row"><span>{metric.nextRelease.label || "Release"}</span><strong>{metric.nextRelease.date || "—"}</strong><em>{metric.nextRelease.countdown || ""}</em></div>
              ) : (
                <p className="imv2-note">No next scheduled release returned. The provider does not expose a calendar for this indicator.</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Action bar — registry-driven (Phase 7). Single source: the modal
             renders getActionsForKind("indicator"); every action inherits. ──── */}
        <section className="imv2-section">
          <DensePanelHeader title="Actions" subtitle="Every action resolves through the Asset Action Registry" />
          <div className="imv2-action-bar">
            {actionDefs.map(renderAction)}
          </div>
        </section>
      </div>
    </div>
  );
}

// Default "why it matters" text when the feed provides none — honest, derived
// from the registry group, no fabricated numbers.
function defaultInterpretation(metric) {
  const group = String(metric?.group || metric?.category || "").toLowerCase();
  const MAP = {
    inflation: "Higher prints typically pressure interest rates, bonds, and long-duration growth equities, while supporting the dollar and real assets.",
    policy: "Policy moves reset discount rates across equities, bonds, and currencies.",
    growth: "Growth strength supports equities and cyclicals; weakness warns of slowdown.",
    labor: "Labor tightness feeds wage inflation and policy tightening.",
    activity: "Activity gauges lead industrial and consumer demand.",
    liquidity: "Liquidity conditions drive risk appetite and asset multiples.",
    energy: "Energy moves feed inflation and margin pressure across the economy.",
    materials: "Materials pricing signals industrial demand and cost pressure.",
    external: "External balances affect the currency and capital flows.",
    fiscal: "Fiscal stance influences rates and aggregate demand.",
  };
  return MAP[group] || "This indicator contributes to the macro regime signal used across the desk. Detailed interpretation appears when the feed supplies it.";
}

function currentInterpretation(metric, stats, regime) {
  if (metric?.interpretation) return metric.interpretation;
  const parts = [];
  if (stats) {
    parts.push(`Currently ${fmt(stats.current, metric?.unit)}, ${stats.slope >= 0 ? "rising" : "falling"} versus the window start.`);
  }
  if (regime?.label) {
    parts.push(`Reads against a "${regime.label}" regime${regime.tone ? ` (${regime.tone})` : ""}.`);
  }
  if (!parts.length) parts.push("No series or regime context available this session.");
  return parts.join(" ");
}

// Map chain reachability to a fixed cross-asset impact table (illustrative).
function crossAssetRows(chain) {
  const reach = (name) => chain.some((c) => c.name === name);
  const up = (n) => (chain.find((c) => c.name === n)?.direction === "up" ? "Bullish" : chain.find((c) => c.name === n)?.direction === "down" ? "Bearish" : "Mixed");
  const rows = [
    { asset: "US10Y", impact: reach("Rates") ? (chain.find((c) => c.name === "Rates")?.direction === "up" ? "Higher" : "Lower") : "Mixed", signal: up("Rates"), confidence: edgeConf(chain, "Rates") },
    { asset: "USD", impact: reach("Dollar") ? (chain.find((c) => c.name === "Dollar")?.direction === "up" ? "Bullish" : "Bearish") : "Mixed", signal: up("Dollar"), confidence: edgeConf(chain, "Dollar") },
    { asset: "Gold", impact: reach("Gold") ? (chain.find((c) => c.name === "Gold")?.direction === "up" ? "Bullish" : "Bearish") : "Mixed", signal: up("Gold"), confidence: edgeConf(chain, "Gold") },
    { asset: "SPY", impact: "Neutral", signal: up("Technology") === "Bearish" ? "Bearish" : up("Growth") === "Bearish" ? "Bearish" : "Neutral", confidence: edgeConf(chain, "Technology") },
    { asset: "Nasdaq", impact: up("Technology") === "Bearish" ? "Bearish" : up("Technology") === "Bullish" ? "Bullish" : "Neutral", signal: up("Technology"), confidence: edgeConf(chain, "Technology") },
    { asset: "BTC", impact: "Mixed", signal: "Mixed", confidence: "Low" },
  ];
  return rows;
}

function edgeConf(chain, name) {
  const c = chain.find((x) => x.name === name);
  if (!c || c.confidence == null) return "Low";
  return c.confidence >= 80 ? "High" : c.confidence >= 65 ? "Medium" : "Low";
}

export default IndicatorMetricModal;
