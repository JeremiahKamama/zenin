/**
 * Zenin V2 — Phase 2/3/4 desk modules (Macro & Commodities).
 *
 * Pure presentational + derivation only. Monochrome, dense, decision-first.
 * BLOCKED DATA SOURCES (no backend feed) render as honest "Unavailable"
 * panels — never fabricated (CFTC, Inventory 5Y, Physical/Freight/Baltic).
 */
import React from "react";
import { getCrossAssets } from "./macro/MacroCoverageRegistry";
import { formatMacroNumber, formatMacroPercent } from "./macro/MacroFormatter";
import { MACRO_INDICATORS, getIndicator } from "./macro/MacroIndicatorRegistry";
import { getCountryCoverage, tierMeta } from "./macro/MacroCoverageRegistry";
import { providerLabel } from "./macro/MacroProviderRegistry";

/* ---------- Progressive disclosure (Phase 4) ---------- */
export function Disclosure({ label = "Show detail", children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="deskv2-disclosure">
      <button type="button" className="deskv2-disclosure-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} {open ? "Hide" : label}
      </button>
      {open ? <div className="deskv2-disclosure-body">{children}</div> : null}
    </div>
  );
}

/* ---------- Honest unavailable panel (Phase 3 blocked) ---------- */
export function HonestUnavailable({ title, reason, source }) {
  return (
    <div className="deskv2-panel deskv2-unavailable">
      <div className="deskv2-panel-head">
        <span>{title}</span>
      </div>
      <div className="deskv2-unavailable-body">
        <strong>Unavailable</strong>
        <p>{reason}</p>
        {source ? <small>Source status: {source}</small> : null}
      </div>
    </div>
  );
}

/* ---------- Growth / Inflation Quadrant (Phase 2 Macro) ---------- */
function findMetric(rows, ...keys) {
  const norm = (s) => String(s || "").toLowerCase();
  return (rows || []).find((r) => {
    const hay = `${norm(r?.indicator)} ${norm(r?.indicatorCode)} ${norm(r?.name)}`;
    return keys.some((k) => hay.includes(k));
  });
}
export const GrowthInflationQuadrant = React.memo(function GrowthInflationQuadrant({ macroRows = [], exec = null }) {
  const growth = findMetric(macroRows, "gdp", "growth");
  const infl = findMetric(macroRows, "inflation", "cpi", "pce", "price");
  const g = growth ? Number(growth.value) : null;
  const i = infl ? Number(infl.value) : null;
  if (g == null && i == null) {
    return <HonestUnavailable title="Growth / Inflation Matrix" reason="No growth or inflation series returned. Awaiting source." source="World Bank / FRED" />;
  }
  const strong = g != null && g >= 2;
  const weak = g != null && g < 1;
  const hot = i != null && i >= 4;
  const cell = strong && !hot ? "Expansion" : hot && strong ? "Stagflation" : weak ? "Slowdown" : hot ? "Inflationary" : "Mixed";
  const quads = [
    { id: "Expansion", x: 1, y: 1 },
    { id: "Stagflation", x: 1, y: 0 },
    { id: "Mixed", x: 0, y: 1 },
    { id: "Slowdown", x: 0, y: 0 },
  ];
  return (
    <div className="deskv2-panel">
      <div className="deskv2-panel-head"><span>Growth / Inflation Matrix</span><em>{exec ? `Conf ${exec.confidence}%` : ""}</em></div>
      <div className="deskv2-quadrant">
        {quads.map((q) => (
          <div key={q.id} className={`deskv2-quad ${q.id === cell ? "active" : ""}`}>
            <span>{q.id}</span>
          </div>
        ))}
      </div>
      <div className="deskv2-quadrant-legend">
        <span>Growth {g != null ? `${g.toFixed(1)}%` : "—"}</span>
        <span>Inflation {i != null ? `${i.toFixed(1)}%` : "—"}</span>
      </div>
    </div>
  );
});

/* ---------- Cross-Asset Dashboard (Phase 2 Macro, country-aware) ---------- */
export const CrossAssetDashboard = React.memo(function CrossAssetDashboard({ riskRows = [], countryCode = "USA" }) {
  const assets = getCrossAssets(countryCode);
  if (!assets.length) {
    return <HonestUnavailable title="Cross-Asset Dashboard" reason="No cross-asset map for the selected country." source="Market data" />;
  }
  const byName = Object.fromEntries((riskRows || []).map((r) => [String(r?.indicator || "").toUpperCase(), r]));
  const rows = assets.map((a) => byName[String(a).toUpperCase()] || { indicator: a, value: null, daily: null, status: null });
  if (!rows.some((r) => r.value != null)) {
    return <HonestUnavailable title="Cross-Asset Dashboard" reason="No cross-asset risk indicators returned for this country. Awaiting source." source="Market data" />;
  }
  return (
    <div className="deskv2-panel">
      <div className="deskv2-panel-head"><span>Cross-Asset Dashboard</span><em>{countryCode}</em></div>
      <div className="deskv2-crossasset">
        {rows.map((r) => {
          const v = Number(r.value);
          const up = Number(r.daily ?? r.change ?? 0) > 0;
          const tone = /elevated|watch/i.test(String(r.status)) ? "negative" : up ? "positive" : "neutral";
          return (
            <div key={r.indicator} className={`deskv2-ca-row ${tone}`}>
              <span className="deskv2-ca-name">{r.indicator}</span>
              <span className="deskv2-ca-val">{v != null && !Number.isNaN(v) ? formatMacroNumber(v, { digits: 2 }) : "—"}</span>
              <span className="deskv2-ca-sig">{r.status || (up ? "Rising" : "Falling")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ---------- Macro Watchlist (Phase 2, client pins) ---------- */
const WL_KEY = "zenin.macro.watchlist";
export function useMacroWatchlist() {
  const [pins, setPins] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(WL_KEY) || "[]"); } catch { return []; }
  });
  const toggle = React.useCallback((key) => {
    setPins((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem(WL_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  return [pins, toggle];
}
export const MacroWatchlist = React.memo(function MacroWatchlist({ macroRows = [], pins = [], onToggle }) {
  if (!macroRows.length) return null;
  const pinned = macroRows.filter((r) => pins.includes(r.indicatorCode || r.indicator));
  const rest = macroRows.filter((r) => !pins.includes(r.indicatorCode || r.indicator));
  const formatWatchChange = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const sign = n > 0 ? "+" : "";
    if (Math.abs(n) >= 1000) return `${sign}${formatMacroNumber(n, { digits: 1 })}%`;
    return formatMacroPercent(n, 2);
  };
  const renderRow = (r) => {
    const key = r.indicatorCode || r.indicator;
    const meta = getIndicator(r.indicatorCode || r.indicator);
    const v = Number(r.value);
    return (
      <div key={key} className="deskv2-wl-row">
        <button type="button" className="deskv2-wl-pin" onClick={() => onToggle?.(key)} title="Pin/Unpin">{pins.includes(key) ? "★" : "☆"}</button>
        <span className="deskv2-wl-name">{meta?.label || r.indicator}</span>
        <span className="deskv2-wl-val">{v != null && !Number.isNaN(v) ? formatMacroNumber(v, { kind: meta?.kind || "decimal", digits: 2 }) : "—"}</span>
        <span className="deskv2-wl-chg">{formatWatchChange(r.change)}</span>
      </div>
    );
  };
  return (
    <div className="deskv2-panel">
      <div className="deskv2-panel-head"><span>Macro Watchlist</span><em>Pinned first · saved per country</em></div>
      <div className="deskv2-wl">{pinned.map(renderRow)}{rest.map(renderRow)}</div>
    </div>
  );
});

/* ---------- Cross-Desk Transmission Chain (Phase 4) ---------- */
export const CrossDeskChain = React.memo(function CrossDeskChain({ energyStrong, inflationHot, ratesUp, growthWeak }) {
  const nodes = [
    { label: "Energy", tone: energyStrong ? "positive" : "neutral" },
    { label: "Inflation", tone: inflationHot ? "negative" : "neutral" },
    { label: "Rates", tone: ratesUp ? "negative" : "neutral" },
    { label: "Growth", tone: growthWeak ? "negative" : "neutral" },
    { label: "Equities", tone: growthWeak ? "negative" : "neutral" },
  ];
  return (
    <div className="deskv2-panel">
      <div className="deskv2-panel-head"><span>Cross-Desk Transmission</span><em>Conceptual map</em></div>
      <div className="deskv2-chain">
        {nodes.map((n, idx) => (
          <React.Fragment key={n.label}>
            <span className={`deskv2-chain-node ${n.tone}`}>{n.label}</span>
            {idx < nodes.length - 1 ? <span className="deskv2-chain-arrow">→</span> : null}
          </React.Fragment>
        ))}
      </div>
      <p className="deskv2-chain-note">Shaded nodes reflect live signal state where available; arrows show typical transmission, not a forecast.</p>
    </div>
  );
});

/* ---------- Commodity Rotation Heatmap (Phase 3, real terminalRows) ---------- */
export const CommodityRotationHeatmap = React.memo(function CommodityRotationHeatmap({ rows = [] }) {
  const groups = {};
  for (const r of rows || []) {
    const g = String(r?.group || "other").toLowerCase();
    const v = Number(r?.dailyChangePct);
    if (!groups[g]) groups[g] = { sum: 0, n: 0, ytd: 0 };
    if (Number.isFinite(v)) { groups[g].sum += v; groups[g].n += 1; }
    const y = Number(r?.ytdChangePct);
    if (Number.isFinite(y)) groups[g].ytd += y;
  }
  const cells = Object.entries(groups).map(([g, a]) => ({
    group: g.charAt(0).toUpperCase() + g.slice(1),
    daily: a.n ? a.sum / a.n : 0,
    ytd: a.ytd,
  }));
  if (!cells.length) return <HonestUnavailable title="Commodity Rotation" reason="No commodity rows returned. Awaiting source." source="Commodities feed" />;
  const maxAbs = Math.max(0.1, ...cells.map((c) => Math.abs(c.daily)));
  return (
    <div className="deskv2-panel">
      <div className="deskv2-panel-head"><span>Commodity Rotation</span><em>Daily vs YTD</em></div>
      <div className="deskv2-heatmap">
        {cells.map((c) => {
          const intensity = Math.min(1, Math.abs(c.daily) / maxAbs);
          const bg = c.daily >= 0
            ? `rgba(34, 160, 90, ${0.15 + intensity * 0.5})`
            : `rgba(200, 60, 60, ${0.15 + intensity * 0.5})`;
          return (
            <div key={c.group} className="deskv2-heat-cell" style={{ background: bg }}>
              <span className="deskv2-heat-name">{c.group}</span>
              <span className="deskv2-heat-daily">{c.daily >= 0 ? "+" : ""}{c.daily.toFixed(2)}%</span>
              <span className="deskv2-heat-ytd">{c.ytd >= 0 ? "+" : ""}{c.ytd.toFixed(1)}% YTD</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ============================================================
 * Commodity Allocation Guidance (replaces static "Portfolio Tilt").
 * Dynamic, explainable, clickable cards + right-side slide-over drawer.
 * Derivation lives in deskIntelligence.buildCommodityAllocation (pure).
 * ============================================================ */

const DIR_GLYPH = { increase: "↑", reduce: "↓", monitor: "→", watch: "◷", review: "⟳" };
const STATUS_LABEL = { active: "Active", dismissed: "Dismissed", pinned: "Pinned", archived: "Archived", completed: "Completed" };

function openDeskIntent(kind, payload = {}) {
  // Non-navigating in-app intent (SPA). An app-level listener can consume it.
  try { window.dispatchEvent(new CustomEvent("zenin:navigate", { detail: { kind, ...payload } })); } catch {}
}

export const CommodityAllocationGuidance = React.memo(function CommodityAllocationGuidance({ recommendations = [], onFilterGroup, regime = null, updatedAt = null }) {
  const [openId, setOpenId] = React.useState(null);
  const [status, setStatus] = React.useState({}); // id -> status override
  const [history, setHistory] = React.useState([]); // [{month, title, status}]

  const visible = recommendations.filter((r) => status[r.id] !== "dismissed");
  const open = visible.find((r) => r.id === openId) || null;

  const setRecStatus = (r, s) => {
    setStatus((prev) => ({ ...prev, [r.id]: s }));
    setHistory((h) => {
      const month = new Date().toLocaleString("en-US", { month: "short" });
      const next = h.filter((x) => !(x.title === r.title && x.month === month));
      return [{ month, title: r.title, status: s }, ...next].slice(0, 12);
    });
  };

  if (!recommendations.length) {
    return (
      <section className="deskv2-alloc" aria-label="Commodity Allocation Guidance">
        <div className="deskv2-alloc-head">
          <div>
            <h3>Commodity Allocation Guidance</h3>
            <p>Current commodity leadership and recommended portfolio positioning.</p>
          </div>
        </div>
        <div className="deskv2-alloc-empty">
          <strong>No high-conviction commodity allocation changes detected.</strong>
          <span>Continue monitoring current positioning.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="deskv2-alloc" aria-label="Commodity Allocation Guidance">
      <div className="deskv2-alloc-head">
        <div>
          <h3>Commodity Allocation Guidance <span className="deskv2-alloc-star">★</span></h3>
          <p>Current commodity leadership and recommended portfolio positioning.</p>
        </div>
        <em>{updatedAt ? `Updated ${updatedAt}` : ""}</em>
      </div>

      <div className="deskv2-alloc-cards">
        {visible.map((r) => (
          <button
            type="button"
            key={r.id}
            className={`deskv2-alloc-card tone-${r.dir}`}
            onClick={() => setOpenId(r.id)}
            aria-haspopup="dialog"
          >
            <div className="deskv2-alloc-card-top">
              <span className="deskv2-alloc-glyph">{DIR_GLYPH[r.dir] || "→"}</span>
              <span className="deskv2-alloc-title">{r.title}</span>
              {status[r.id] === "pinned" ? <span className="deskv2-alloc-pin">★</span> : null}
            </div>
            <div className="deskv2-alloc-meta">
              <span className="deskv2-alloc-conf">
                <b>{r.confidenceBand}</b> {r.confidence}%
              </span>
              <span className="deskv2-alloc-horizon">{r.horizon}</span>
            </div>
            <div className="deskv2-alloc-reason">
              {(r.drivers || []).slice(0, 3).map((d, i) => (
                <span key={i} className="deskv2-alloc-bullet">• {d}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {history.length ? (
        <details className="deskv2-alloc-history">
          <summary>Guidance history</summary>
          <ul>
            {history.map((h, i) => (
              <li key={i}><b>{h.month}</b> — {h.title} <em>({STATUS_LABEL[h.status] || h.status})</em></li>
            ))}
          </ul>
        </details>
      ) : null}

      {open ? (
        <AllocationDrawer
          rec={open}
          history={history}
          onClose={() => setOpenId(null)}
          onStatus={(s) => setRecStatus(open, s)}
          onFilterGroup={onFilterGroup}
        />
      ) : null}
    </section>
  );
});

function AllocationDrawer({ rec, history, onClose, onStatus, onFilterGroup }) {
  const ref = React.useRef(null);
  const recOf = STATUS_LABEL;

  // Focus trap + Esc
  React.useEffect(() => {
    const node = ref.current;
    if (node) node.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key === "Tab") {
        const f = node.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    node?.addEventListener("keydown", onKey);
    return () => node?.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirGlyph = DIR_GLYPH[rec.dir] || "→";
  return (
    <div className="deskv2-drawer-scrim" onClick={onClose}>
      <aside
        className="deskv2-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={rec.title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="deskv2-drawer-head">
          <div>
            <span className="deskv2-alloc-glyph">{dirGlyph}</span>
            <h4>{rec.title}</h4>
          </div>
          <button type="button" className="deskv2-drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="deskv2-drawer-body">
          <div className="deskv2-drawer-stats">
            <div><label>Confidence</label><span>{rec.confidenceBand} {rec.confidence}%</span></div>
            <div><label>Signal</label><span>{rec.signal}</span></div>
            <div><label>Horizon</label><span>{rec.horizon}</span></div>
            <div><label>Source count</label><span>{rec.sourceCount}</span></div>
          </div>

          <section className="deskv2-drawer-sec">
            <h5>Portfolio Impact</h5>
            <div className="deskv2-impact">
              <div><label>Current exposure</label><span>{rec.currentExposurePct != null ? `${rec.currentExposurePct}%` : "—"}</span></div>
              <div><label>Suggested</label><span>{rec.currentExposurePct != null ? `${rec.currentExposurePct + (rec.suggestedExposureDelta || 0)}%` : "—"}</span></div>
              <div><label>Difference</label><span className={rec.suggestedExposureDelta >= 0 ? "pos" : "neg"}>{rec.suggestedExposureDelta >= 0 ? "+" : ""}{rec.suggestedExposureDelta}%</span></div>
            </div>
          </section>

          <section className="deskv2-drawer-sec">
            <h5>Drivers</h5>
            <ul className="deskv2-driver-list">
              {(rec.drivers || []).map((d, i) => <li key={i}>✓ {d}</li>)}
            </ul>
          </section>

          <section className="deskv2-drawer-sec">
            <h5>Underlying Commodities</h5>
            <div className="deskv2-chips">{(rec.commodities || []).map((c) => <span key={c} className="deskv2-chip">{c}</span>)}</div>
          </section>

          {rec.supportingAssets?.length ? (
            <section className="deskv2-drawer-sec">
              <h5>Supporting Assets</h5>
              <div className="deskv2-chips">{(rec.supportingAssets || []).map((c) => <span key={c} className="deskv2-chip">{c}</span>)}</div>
            </section>
          ) : null}

          <section className="deskv2-drawer-sec">
            <h5>Cross-Desk Links</h5>
            <div className="deskv2-crosslinks">
              <button type="button" onClick={() => { onFilterGroup?.(rec.groups); openDeskIntent("equities", { group: rec.group }); }}>→ Equities Desk · {rec.group}</button>
              <button type="button" onClick={() => openDeskIntent("portfolio")}>→ Portfolio · Holdings</button>
              <button type="button" onClick={() => openDeskIntent("watchlist", { symbols: rec.commodities })}>→ Watchlist · {rec.commodities?.slice(0, 2).join(", ") || ""}</button>
              <button type="button" onClick={() => openDeskIntent("decisions", { title: rec.title })}>→ Decisions · Suggested allocation</button>
            </div>
          </section>

          <section className="deskv2-drawer-sec deskv2-drawer-history">
            <h5>Status</h5>
            <div className="deskv2-status-row">
              <button type="button" onClick={() => onStatus("pinned")}>Pin</button>
              <button type="button" onClick={() => onStatus("dismissed")}>Dismiss</button>
              <button type="button" onClick={() => onStatus("completed")}>Complete</button>
            </div>
            {history.length ? (
              <ul className="deskv2-history-list">
                {history.slice(0, 6).map((h, i) => <li key={i}><b>{h.month}</b> {h.title} <em>({recOf[h.status] || h.status})</em></li>)}
              </ul>
            ) : null}
          </section>
        </div>
      </aside>
    </div>
  );
}
