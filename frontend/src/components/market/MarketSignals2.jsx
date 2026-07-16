// MarketSignals2 — Cross-Asset Intelligence Feed (spec §1, §2, §3, §4, §5, §6, §13, §15).
//
// Aggregates intelligence from sources the page already holds (no new fetches):
//   • IntelligenceBus event log (macro regime published by the Macro Desk)
//   • Top movers (gainers / losers) already in scope
//   • Global calendar events (economic) + earnings events
//   • Options exposure (theta / risk) when present
//
// Each signal is a complete intelligence object:
//   Category · Headline · Summary · Why It Matters · Transmission Path ·
//   Affected Assets · Confidence · Source · Coverage · Updated · Latency ·
//   Fallback · Freshness lifecycle · Importance · navigation metadata.
//
// Grouped by asset class, collapsible + state remembered (localStorage), newest
// first. Importance drives visual weight via typography/spacing (no bright
// color). Honest fallbacks only — absent data renders "—", never fabricated.
//
// Brand v2: monochrome, hairline dividers, reuse existing .market-signal-* tokens.

import React, { useMemo, useState, useEffect } from "react";
import { useIntelligenceBusEvents } from "../../utils/useIntelligenceBus";

const CATEGORY_META = {
  macro: { label: "MACRO", desk: "macro", workspace: "macro" },
  equities: { label: "EQUITIES", desk: "equities", workspace: "equities" },
  crypto: { label: "CRYPTO", desk: "crypto", workspace: "crypto" },
  commodities: { label: "COMMODITIES", desk: "commodities", workspace: "commodities" },
  fx: { label: "FX", desk: "macro", workspace: "fx" },
  fixedincome: { label: "FIXED INCOME", desk: "macro", workspace: "macro" },
  portfolio: { label: "PORTFOLIO", desk: "portfolio", workspace: "portfolio" },
  watchlist: { label: "WATCHLIST", desk: "watchlist", workspace: "watchlist" },
  decision: { label: "DECISION", desk: "decision", workspace: "decision" },
};

// Display order of groups (spec §2).
const GROUP_ORDER = ["macro", "equities", "crypto", "commodities", "fx", "fixedincome", "portfolio", "watchlist", "decision"];
const GROUP_LABELS = { macro: "Macro", equities: "Equities", crypto: "Crypto", commodities: "Commodities", fx: "FX", fixedincome: "Fixed Income", portfolio: "Portfolio", watchlist: "Watchlist", decision: "Decision" };

const COLLAPSE_KEY = "zenin_signals_collapsed_v1";

function relTime(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// Freshness lifecycle from updated timestamp (spec §6).
function freshness(updated) {
  if (!updated) return { key: "fresh", label: "Fresh" };
  const ageH = (Date.now() - new Date(updated).getTime()) / 3600000;
  if (ageH > 24) return { key: "expired", label: "Expired" };
  if (ageH > 12) return { key: "expiring", label: "Expiring" };
  return { key: "fresh", label: "Fresh" };
}

// Derive importance from impact + category (spec §3). Typography/spacing only.
function importance(s) {
  const imp = String(s.impact || "").toLowerCase();
  if (s.category === "macro" && (imp.includes("risk off") || imp.includes("negative") || imp === "high")) return "critical";
  if (imp.includes("risk off") || imp.includes("negative") || s.category === "macro") return "high";
  if (imp.includes("positive")) return "medium";
  return "low";
}

function buildSignals({ busEvents, gainers, losers, calendarEvents, earningsEvents, optionsExposure, regimeLabel }) {
  const out = [];

  if (regimeLabel) {
    out.push({
      id: "sig-macro-regime",
      category: "macro",
      headline: `Macro regime: ${regimeLabel}`,
      summary: "Cross-asset regime published by the Macro Desk. Drives sector, commodity, and holding exposure mapping.",
      why: "Sets the risk backdrop for every desk; rebalances expected sector and asset-class behavior.",
      impact: regimeLabel.toLowerCase().includes("risk") || /contraction|recession/.test(regimeLabel.toLowerCase()) ? "Risk Off" : "Risk On",
      confidence: null,
      source: "macro-desk",
      coverage: "Live",
      updated: null,
      latency: "—",
      fallback: "Backend cache",
      assets: [],
      transmissionPath: null,
      desk: "macro",
    });
  }
  busEvents
    .filter((e) => e.type === "macro" && e.headline)
    .forEach((e) => out.push({
      id: `sig-bus-${e.id}`,
      category: "macro",
      headline: e.headline,
      summary: e.detail || "Macro intelligence published to the IntelligenceBus.",
      why: e.detail ? "Published macro development with cross-asset implications." : "Macro signal from the IntelligenceBus event log.",
      impact: e.impact || "neutral",
      confidence: typeof e.confidence === "number" ? e.confidence : null,
      source: e.source || "intelligence-bus",
      coverage: "Live",
      updated: e.timestamp,
      latency: "—",
      fallback: "Historical cache",
      assets: Array.isArray(e.assets) ? e.assets : [],
      transmissionPath: e.transmission || null,
      desk: "macro",
    }));

  const movers = [...(gainers || []).slice(0, 3), ...(losers || []).slice(0, 3)];
  movers.forEach((m) => {
    const sym = String(m?.symbol || m?.ticker || "");
    if (!sym) return;
    const pct = Number(m?.changePct ?? m?.dailyChangePct ?? NaN);
    if (!Number.isFinite(pct)) return;
    const type = String(m?.type || m?.marketType || "equity").toLowerCase();
    const cat = type.includes("crypto") ? "crypto" : type.includes("commod") ? "commodities" : "equities";
    out.push({
      id: `sig-mover-${sym}`,
      category: cat,
      headline: `${sym} ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(2)}%`,
      summary: `${m?.name || sym} is a top ${pct >= 0 ? "gainer" : "loser"} in the selected market scope.`,
      why: `Unusual move in ${sym} shifts nearby risk and may ripple to correlated assets.`,
      impact: pct >= 0 ? "Positive" : "Negative",
      confidence: null,
      source: "movers",
      coverage: "Live",
      updated: null,
      latency: "—",
      fallback: "Backend cache",
      assets: [sym],
      transmissionPath: null,
      desk: cat,
    });
  });

  (calendarEvents || []).slice(0, 3).forEach((ev, i) => {
    const title = String(ev?.title || ev?.event || "Economic release");
    out.push({
      id: `sig-cal-${i}-${title}`,
      category: "macro",
      headline: title,
      summary: ev?.time ? `Scheduled ${ev.time}.` : "Scheduled macro release.",
      why: "Scheduled release can reset rate, FX, and equity expectations on surprise.",
      impact: ev?.impact || "Watch",
      confidence: null,
      source: "economic-calendar",
      coverage: "Live",
      updated: null,
      latency: "—",
      fallback: "Backend cache",
      assets: [],
      transmissionPath: null,
      desk: "macro",
    });
  });

  (earningsEvents || []).slice(0, 2).forEach((ev, i) => {
    const sym = String(ev?.symbol || ev?.title || "");
    out.push({
      id: `sig-earn-${i}-${sym}`,
      category: "equities",
      headline: sym ? `${sym} earnings` : "Earnings event",
      summary: String(ev?.title || ev?.event || ev?.period || "Upcoming corporate earnings."),
      why: "Earnings reset single-name and sector expectations; watch guidance and reaction.",
      impact: ev?.impact || "Watch",
      confidence: null,
      source: "earnings-calendar",
      coverage: "Live",
      updated: null,
      latency: "—",
      fallback: "Backend cache",
      assets: sym ? [sym] : [],
      transmissionPath: null,
      desk: "equities",
    });
  });

  if (optionsExposure && Number.isFinite(Number(optionsExposure))) {
    const theta = Number(optionsExposure);
    out.push({
      id: "sig-options-theta",
      category: "portfolio",
      headline: `Options book theta ${theta >= 0 ? "+" : ""}${theta.toFixed(2)}`,
      summary: "Aggregate options theta across open positions. Negative theta bleeds value daily.",
      why: "Theta decay is a direct, time-bound drag on portfolio P&L; flags roll/close candidates.",
      impact: theta < 0 ? "Negative" : "Positive",
      confidence: null,
      source: "options",
      coverage: "Live",
      updated: null,
      latency: "—",
      fallback: "Backend cache",
      assets: [],
      transmissionPath: null,
      desk: "portfolio",
    });
  }

  return out;
}

function groupSignals(signals) {
  const byCat = {};
  for (const s of signals) (byCat[s.category] = byCat[s.category] || []).push(s);
  // newest first within group (updated desc; nulls last)
  for (const k of Object.keys(byCat)) {
    byCat[k].sort((a, b) => {
      const ta = a.updated ? new Date(a.updated).getTime() : 0;
      const tb = b.updated ? new Date(b.updated).getTime() : 0;
      return tb - ta;
    });
  }
  return byCat;
}

function SignalCard({ s, onOpenWorkspace, onSelectAsset }) {
  const meta = CATEGORY_META[s.category] || { label: String(s.category || "SIGNAL").toUpperCase() };
  const imp = importance(s);
  const fresh = freshness(s.updated);
  const nav = s.navigation || { workspace: meta.workspace, panel: null, tab: null, entity: s.assets?.[0] || null, filters: null };

  return (
    <div className={`market-signal-card imp-${imp} fresh-${fresh.key}`}>
      <div className="msc-head">
        <span className={`market-signal-cat cat-${s.category}`}>{meta.label}</span>
        <span className="msc-time">{relTime(s.updated)}</span>
        {typeof s.confidence === "number" ? <span className="msc-conf">Conf {s.confidence}%</span> : null}
      </div>
      <strong className="msc-headline">{s.headline}</strong>
      <p className="msc-summary">{s.summary}</p>
      {s.why ? <p className="msc-why"><span className="msc-label">Why it matters</span>{s.why}</p> : null}
      {s.transmissionPath && s.transmissionPath.length ? (
        <div className="msc-transmission">
          <span className="msc-label">Transmission</span>
          <div className="msc-tx-path">
            {s.transmissionPath.map((t, i) => (
              <span key={i} className="msc-tx-node">{t.to}<span className="msc-tx-dir">{t.dir === "down" ? "↓" : t.dir === "up" ? "↑" : "→"}</span></span>
            ))}
          </div>
        </div>
      ) : null}
      {s.assets && s.assets.length ? (
        <div className="msc-assets">
          <span className="msc-label">Affected</span>
          {s.assets.slice(0, 6).map((a) => (
            <button key={a} type="button" className="market-signal-asset" onClick={() => onSelectAsset?.(a)}>{a}</button>
          ))}
        </div>
      ) : null}
      <div className="msc-meta">
        <span>Source <em>{s.source}</em></span>
        <span>Coverage <em>{s.coverage || "—"}</em></span>
        <span>Updated <em>{relTime(s.updated)}</em></span>
        <span>Latency <em>{s.latency || "—"}</em></span>
        <span>Fallback <em>{s.fallback || "—"}</em></span>
        <span className={`msc-freshness fresh-${fresh.key}`}>{fresh.label}</span>
      </div>
      <div className="msc-actions">
        <button type="button" className="market-signal-btn" onClick={() => onOpenWorkspace?.({ ...nav, action: "research" })}>Open Research</button>
        <button type="button" className="market-signal-btn" onClick={() => onOpenWorkspace?.({ ...nav, action: "workspace" })}>Open Workspace</button>
        {s.assets?.[0] ? <button type="button" className="market-signal-btn" onClick={() => onSelectAsset?.(s.assets[0])}>Open Asset</button> : null}
      </div>
    </div>
  );
}

export default function MarketSignals2({
  gainers = [],
  losers = [],
  calendarEvents = [],
  earningsEvents = [],
  optionsExposure = null,
  regimeLabel = null,
  onOpenWorkspace,
  onOpenResearch,
  onOpenDesk,
  onSelectAsset,
}) {
  const busEvents = useIntelligenceBusEvents({ limit: 40 });
  const signals = useMemo(
    () => buildSignals({ busEvents, gainers, losers, calendarEvents, earningsEvents, optionsExposure, regimeLabel }),
    [busEvents, gainers, losers, calendarEvents, earningsEvents, optionsExposure, regimeLabel]
  );

  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)); } catch { /* ignore */ }
  }, [collapsed]);

  if (!signals.length) {
    return (
      <div className="market-signal-list">
        <div className="market-signals-empty">
          <span className="msc-freshness fresh-fresh">Monitoring</span>
          <div className="market-signals-empty__body">
            <strong>No material market signals detected</strong>
            <p>Zenin is monitoring connected feeds for changes that affect your portfolio.</p>
          </div>
        </div>
      </div>
    );
  }

  const grouped = groupSignals(signals);

  return (
    <div className="market-signal-list market-signals-2">
      {GROUP_ORDER.filter((g) => grouped[g]?.length).map((g) => {
        const items = grouped[g];
        const isCollapsed = collapsed[g];
        return (
          <section key={g} className="msc-group">
            <button type="button" className="msc-group-head" aria-expanded={!isCollapsed} onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}>
              <span className="msc-group-caret">{isCollapsed ? "▸" : "▾"}</span>
              <span className="msc-group-label">{GROUP_LABELS[g]}</span>
              <span className="msc-group-count">{items.length} Signal{items.length === 1 ? "" : "s"}</span>
            </button>
            {!isCollapsed ? (
              <div className="msc-group-body">
                {items.map((s) => (
                  <SignalCard key={s.id} s={s} onOpenWorkspace={onOpenWorkspace || ((n) => { if (n?.action === "research") onOpenResearch?.(n.entity ? { symbol: n.entity } : null); else onOpenDesk?.(s.desk); })} onSelectAsset={onSelectAsset} />
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
