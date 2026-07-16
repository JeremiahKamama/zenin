// TransmissionSurfaces — compact contextual transmission cards for each workspace.
// Each surface shows only what that workspace needs. All open the SAME Explorer.
// Brand v2: monochrome, compact, hairline dividers, small badges.

import React from "react";
import { TransmissionEngine } from "./TransmissionEngine.js";
import { useTransmissionExplorer } from "./TransmissionExplorerProvider.jsx";
import { directionGlyph, stars, NO_TRANSMISSION, compactHorizon } from "./TransmissionFormatter.js";
import { HORIZON_ORDER, horizonLabel } from "./TransmissionRegistry.js";

// Compact "Open Explorer →" affordance reused everywhere.
export function OpenExplorerButton({ node, context, label = "Open Explorer" }) {
  const { openExplorer } = useTransmissionExplorer();
  return (
    <button type="button" className="tx-open-explorer" onClick={() => openExplorer(node, context)}>
      {label} →
    </button>
  );
}

// MACRO DESK — replaces static CrossDeskChain.
export function ActiveTransmission({ signals = [], rootConfidence = 70, title = "Active Transmission" }) {
  const tx = TransmissionEngine.publishSignals(signals, { rootConfidence });
  if (!tx.hasTransmission || !tx.active.length) {
    return (
      <div className="deskv2-panel tx-active-card">
        <div className="deskv2-panel-head"><span>{title}</span></div>
        <p className="tx-empty">{NO_TRANSMISSION}</p>
      </div>
    );
  }
  const primary = tx.active[0];
  const nextHorizon = primary.horizons[1]?.horizon || null;
  return (
    <div className="deskv2-panel tx-active-card">
      <div className="deskv2-panel-head">
        <span>{title}</span>
        <strong className="tx-confidence-badge">{tx.confidence}% confidence</strong>
      </div>
      <ol className="tx-mini-chain">
        {primary.chain.slice(0, 5).map((c, i) => (
          <li key={`${c.node}-${i}`} className="tx-mini-node">
            <span className={`tx-glyph ${c.direction}`}>{directionGlyph(c.direction)}</span>
            <span>{c.node}</span>
            {i < primary.chain.slice(0, 5).length - 1 ? <span className="tx-mini-arrow">↓</span> : null}
          </li>
        ))}
      </ol>
      <div className="tx-active-foot">
        <span className="tx-horizon-tag">{compactHorizon(primary.horizons[0]?.horizon, nextHorizon)}</span>
        <OpenExplorerButton node={primary.root} context={{ source: "macro" }} />
      </div>
    </div>
  );
}

// PORTFOLIO — "Portfolio Transmission" card.
export function PortfolioTransmission({ topDriver, currentEffect, affectedHoldings, exposure }) {
  const { openExplorer } = useTransmissionExplorer();
  return (
    <div className="deskv2-panel tx-portfolio-card">
      <div className="deskv2-panel-head"><span>Portfolio Transmission</span></div>
      <div className="tx-kv"><em>Top Driver</em><strong>{topDriver || "—"}</strong></div>
      <div className="tx-kv"><em>Current Effect</em><strong className={currentEffect?.tone === "negative" ? "tx-neg" : "tx-pos"}>{currentEffect?.label || "—"}</strong></div>
      <div className="tx-kv"><em>Affected Holdings</em><strong>{affectedHoldings ?? "—"}</strong></div>
      <div className="tx-kv"><em>Estimated Exposure</em><strong>{exposure || "—"}</strong></div>
      <div className="tx-active-foot"><OpenExplorerButton node={topDriver} context={{ source: "portfolio" }} /></div>
    </div>
  );
}

// COMMODITY WORKSPACE — right rail "Transmission Context".
export function CommodityTransmissionContext({ driver, horizonLabel: hl, nextHorizon, nextWindow }) {
  return (
    <div className="deskv2-panel tx-rail-card">
      <div className="deskv2-panel-head"><span>Transmission Context</span></div>
      <div className="tx-kv"><em>Current Driver</em><strong>{driver || "—"}</strong></div>
      <ol className="tx-mini-chain">
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>{driver || "—"}</span></li>
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>Inflation</span></li>
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>Rates</span></li>
      </ol>
      <div className="tx-kv"><em>Current Horizon</em><strong>{hl || "—"}</strong></div>
      <div className="tx-active-foot"><OpenExplorerButton node={driver} context={{ source: "commodity" }} /></div>
    </div>
  );
}

// COMPANY PROFILE — "Macro Dependencies".
export function CompanyMacroDependencies({ dependencies = [] }) {
  const { openExplorer } = useTransmissionExplorer();
  return (
    <div className="deskv2-panel tx-company-card">
      <div className="deskv2-panel-head"><span>Macro Dependencies</span></div>
      {dependencies.length ? (
        <ul className="tx-dep-list">
          {dependencies.map((d) => (
            <li key={d.factor} className="tx-dep-row">
              <span>{d.factor}</span>
              <span className={d.tone === "negative" ? "tx-neg" : d.tone === "positive" ? "tx-pos" : "tx-neu"}>{d.tone}</span>
            </li>
          ))}
        </ul>
      ) : <p className="tx-empty">{NO_TRANSMISSION}</p>}
      <div className="tx-active-foot">
        <span className="tx-status-pill">Transmission Active</span>
        <OpenExplorerButton node={dependencies[0]?.factor} context={{ source: "company" }} />
      </div>
    </div>
  );
}

// RESEARCH WORKSPACE — sidebar "Transmission Context".
export function ResearchTransmissionContext({ regime, affectedHoldings, portfolioRelevance, decisionRelevance }) {
  return (
    <div className="deskv2-panel tx-research-card">
      <div className="deskv2-panel-head"><span>Transmission Context</span></div>
      <div className="tx-kv"><em>Current Regime</em><strong>{regime || "—"}</strong></div>
      <div className="tx-kv"><em>Transmission</em><strong>{affectedHoldings != null ? `${affectedHoldings} holdings` : "—"}</strong></div>
      <div className="tx-kv"><em>Portfolio Relevance</em><strong>{portfolioRelevance || "—"}</strong></div>
      <div className="tx-kv"><em>Decision Relevance</em><strong>{decisionRelevance || "—"}</strong></div>
      <div className="tx-active-foot"><OpenExplorerButton node={regime} context={{ source: "research" }} /></div>
    </div>
  );
}

// WATCHLIST — per-row "Transmission N Active" + hover.
export function WatchlistTransmission({ count, node }) {
  const { openExplorer } = useTransmissionExplorer();
  if (!count) return <span className="tx-watchlist-count tx-muted">Transmission 0 Active</span>;
  return (
    <button type="button" className="tx-watchlist-count" onClick={() => openExplorer(node, { source: "watchlist" })} title="Open transmission">
      Transmission {count} Active
    </button>
  );
}

// BRIEFINGS — "Top Transmission Today".
export function BriefingTransmission({ driver, affectedHoldings }) {
  const { openExplorer } = useTransmissionExplorer();
  return (
    <div className="tx-briefing-card">
      <span className="tx-briefing-label">Top Transmission Today</span>
      <ol className="tx-mini-chain">
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>{driver || "—"}</span></li>
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>Inflation</span></li>
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>Rates</span></li>
      </ol>
      <div className="tx-kv"><em>Affected Portfolio</em><strong>{affectedHoldings != null ? `${affectedHoldings} holdings` : "—"}</strong></div>
      <OpenExplorerButton node={driver} context={{ source: "briefing" }} />
    </div>
  );
}

// NOTIFICATIONS — transmission affecting N holdings.
export function NotificationTransmission({ driver, affectedHoldings }) {
  const { openExplorer } = useTransmissionExplorer();
  return (
    <button type="button" className="tx-notif" onClick={() => openExplorer(driver, { source: "notification" })}>
      {driver} transmission affecting {affectedHoldings} holdings →
    </button>
  );
}

// DECISION LEDGER — stored transmission snapshot.
export function DecisionLedgerTransmission({ regime, driver, tone, confidence }) {
  return (
    <div className="tx-ledger-snapshot">
      <div className="tx-kv"><em>Macro</em><strong>{regime || "—"}</strong></div>
      <div className="tx-kv"><em>{driver || "—"}</em><strong className={tone === "negative" ? "tx-neg" : "tx-pos"}>{tone || "—"}</strong></div>
      <ol className="tx-mini-chain">
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>Energy</span></li>
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>Inflation</span></li>
        <li className="tx-mini-node"><span className="tx-glyph up">↑</span><span>Portfolio</span></li>
      </ol>
      <div className="tx-kv"><em>Confidence</em><strong>{confidence != null ? `${confidence}%` : "—"}</strong></div>
    </div>
  );
}
