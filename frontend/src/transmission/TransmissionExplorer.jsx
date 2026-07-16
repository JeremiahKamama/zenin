// TransmissionExplorer v2 — institutional 4-tier intelligence explorer.
// Explains "why an asset matters" + "how shocks propagate". Never advises.
// Brand v3: monochrome, dense, tiers = Summary / Timeline / Cards / Evidence.
// Routing is delegated to the provider's onNavigate resolver (registry-owned).

import React, { useState, useMemo } from "react";
import { TransmissionEngine } from "./TransmissionEngine.js";
import { chainToHierarchy, directionGlyph, stars, NO_TRANSMISSION } from "./TransmissionFormatter.js";
import { horizonLabel } from "./TransmissionRegistry.js";
// Resolve a node label → a navigation type for the onNavigate resolver.
// Mirrors the asset registry kinds so deep links stay registry-correct.
function nodeType(node) {
  const n = String(node || "").toUpperCase();
  if (["CL", "BZ", "NG", "GC", "SI", "HG", "ZW", "ZS", "ZC", "ZW"].includes(n)) return "commodity";
  if (["NEE", "DUK", "SO", "XOM", "CVX", "COP", "FCX"].includes(n)) return "company";
  return "commodity"; // default commodity (explorer is commodity-centric here)
}

export function TransmissionExplorerContent({ rootNode, context = {}, onNavigate, loading = false }) {
  const [activeNode, setActiveNode] = useState(rootNode);

  const chain = useMemo(() => TransmissionEngine.getActiveChain(activeNode), [activeNode]);
  const horizons = useMemo(() => TransmissionEngine.getHorizons(activeNode), [activeNode]);
  const rootTransmission = useMemo(
    () => TransmissionEngine.publishSignals([{ label: activeNode, positive: true }], { rootConfidence: 80 }),
    [activeNode]
  );
  const depth = chain.length ? chain.length - 1 : 0;
  const confidence = rootTransmission.confidence;

  // Tier 1 — Executive summary (derived from the chain when present).
  const executiveSummary = useMemo(() => {
    if (!chain.length) return null;
    const tail = chain[chain.length - 1]?.node;
    const companies = TransmissionEngine.getAffected(activeNode, "commodities");
    const head = chain[0]?.node;
    return `${head} transmission is propagating through ${chain.length - 1} hop(s) into ${tail}, with primary impact on related commodities and the companies that consume them.`;
  }, [chain, activeNode]);

  if (loading) {
    return (
      <div className="tx-explorer tx-loading" aria-busy="true">
        <div className="tx-skeleton-graph" />
        <div className="tx-skeleton-cards">
          <span className="tx-skel-line" />
          <span className="tx-skel-line" />
          <span className="tx-skel-line" />
        </div>
      </div>
    );
  }

  if (!chain.length) {
    return (
      <div className="tx-explorer">
        <section className="tx-section tx-empty-state">
          <h3 className="tx-empty-title">No verified transmission chain.</h3>
          <p className="tx-empty-reason">Why? No verified relationships. Available evidence is below threshold.</p>
          <ul className="tx-empty-reasons">
            <li>Insufficient data</li>
            <li>Provider unavailable</li>
            <li>Confidence below threshold</li>
            <li>Relationship not yet modeled</li>
          </ul>
          <div className="tx-empty-followup">
            <span>Possible next sources</span>
            <ul>
              <li>EIA</li>
              <li>FRED</li>
              <li>Company Revenue</li>
            </ul>
          </div>
        </section>
      </div>
    );
  }

  const hierarchy = chainToHierarchy(chain);

  const handleNavigate = (node) => {
    if (onNavigate) onNavigate({ type: nodeType(node), label: node });
  };

  return (
    <div className="tx-explorer">
      {/* Tier 1 — Executive Summary (always visible) */}
      <section className="tx-section tx-exec-summary" aria-label="Executive summary">
        <p>{executiveSummary}</p>
      </section>

      {/* Tier 2 — Transmission Timeline (horizontal, clickable) */}
      <section className="tx-section" aria-label="Transmission timeline">
        <div className="tx-timeline" role="list">
          {hierarchy.map((h, i) => (
            <React.Fragment key={`${h.node}-${i}`}>
              <button
                type="button"
                role="listitem"
                className={`tx-timeline-node ${h.node === activeNode ? "active" : ""}`}
                onClick={() => setActiveNode(h.node)}
                title={`Focus ${h.node}`}
              >
                <span className="tx-timeline-label">{h.node}</span>
                {h.confidence != null ? <span className="tx-confidence-chip">{stars(h.confidence)} {h.confidence}%</span> : null}
              </button>
              {i < hierarchy.length - 1 ? <span className="tx-timeline-arrow" aria-hidden="true">↓</span> : null}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* Tier 3 — Transmission Cards (reason / companies / ETFs / impact / evidence) */}
      <section className="tx-section" aria-label="Transmission detail">
        <div className="tx-cards">
          {hierarchy.slice(1).map((h, i) => {
            const from = hierarchy[i]?.node;
            const edge = TransmissionEngine.getEvidence(from, h.node);
            const companies = TransmissionEngine.getAffected(h.node, "companies");
            const commodities = TransmissionEngine.getAffected(h.node, "commodities");
            return (
              <article key={`${h.node}-${i}`} className="tx-card" onClick={() => setActiveNode(h.node)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") setActiveNode(h.node); }}>
                <header className="tx-card-head">
                  <span className="tx-card-from">{from}</span>
                  <span className="tx-card-arrow">{directionGlyph(h.direction)}</span>
                  <strong className="tx-card-to">{h.node}</strong>
                  {h.confidence != null ? <span className="tx-confidence-chip">{h.confidence}%</span> : null}
                </header>
                <p className="tx-card-reason">{edge.method && edge.method !== NO_TRANSMISSION ? edge.method : `${from} transmits into ${h.node}.`}</p>
                {companies.length || commodities.length ? (
                  <div className="tx-card-affected">
                    {companies.map((c) => <button key={c} type="button" className="tx-chip" onClick={(e) => { e.stopPropagation(); handleNavigate(c); }}>{c}</button>)}
                    {commodities.map((c) => <button key={c} type="button" className="tx-chip" onClick={(e) => { e.stopPropagation(); handleNavigate(c); }}>{c}</button>)}
                  </div>
                ) : null}
                <footer className="tx-card-foot">
                  <span className="tx-impact">Impact: Medium</span>
                  <span className="tx-evidence-src">{edge.providers.join(", ") || "—"}</span>
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      {/* Tier 4 — Relationship Evidence (confidence / freshness / provider) */}
      <section className="tx-section tx-evidence-section" aria-label="Relationship evidence">
        <div className="tx-evidence">
          {horizons.length
            ? horizons.map((hz) => (
                <div key={hz.horizon} className="tx-evidence-row">
                  <em>{horizonLabel(hz.horizon)}</em>
                  <span>{hz.links.map((l) => `${l.from} → ${l.to}`).join(" · ")}</span>
                  <span className="tx-evidence-weight">High</span>
                </div>
              ))
            : <div className="tx-evidence-row"><em>Structural</em><span>Long-run relationship</span><span className="tx-evidence-weight">Medium</span></div>}
        </div>
      </section>

      {/* Mini dependency graph (top-right in drawer shell; compact) */}
      <aside className="tx-mini-graph" aria-label="Dependency graph">
        <div className="tx-graph-nodes">
          {hierarchy.map((h, i) => (
            <React.Fragment key={`g-${h.node}-${i}`}>
              <button type="button" className={`tx-graph-node ${h.node === activeNode ? "active" : ""}`} onClick={() => setActiveNode(h.node)}>{h.node}</button>
              {i < hierarchy.length - 1 ? <span className="tx-graph-edge" aria-hidden="true">↓</span> : null}
            </React.Fragment>
          ))}
        </div>
      </aside>

      {/* Deep links (now functional — wired to onNavigate resolver) */}
      <section className="tx-section tx-deeplinks" aria-label="Open related surfaces">
        <div className="tx-related">
          <button type="button" className="tx-related-btn" onClick={() => handleNavigate(activeNode)}>Open Commodity Workspace</button>
          <button type="button" className="tx-related-btn" onClick={() => onNavigate?.({ type: "company", label: activeNode })}>Open Company</button>
          <button type="button" className="tx-related-btn" onClick={() => onNavigate?.({ type: "portfolio" })}>Open Portfolio</button>
          <button type="button" className="tx-related-btn" onClick={() => onNavigate?.({ type: "macro" })}>Open Macro</button>
        </div>
      </section>

    </div>
  );
}
