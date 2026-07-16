// MacroResearchWorkspaceModule — Phase 5 Macro Research Workspace entry.
//
// Consolidates the macro read (regime + selected country) into one operator card
// with a CTA into the full Research Workspace. The Research Workspace itself is
// the existing app surface (AnalyticsLayout toolbar); this module is the in-desk
// bridge so every theme / country can reach it. No fabricated research content.

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";
import { getCountryCoverage } from "./MacroCoverageRegistry.js";

export function MacroResearchWorkspaceModule({ countryCode = "USA", regimeLabel = null, regimeTone = "neutral", onOpenResearch = null }) {
  const cov = getCountryCoverage(countryCode);
  return (
    <section className="analytics-card macro-rw-module" aria-label="Macro Research Workspace">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">Macro Research Workspace</div>
          <div className="analytics-card-subtitle">{cov.name} · regime-led research surface.</div>
        </div>
        <div className="analytics-pill-group">
          {regimeLabel ? <StatusPill tone={regimeTone}>{`Regime: ${regimeLabel}`}</StatusPill> : <StatusPill tone="neutral">Unavailable</StatusPill>}
        </div>
      </div>
      <div className="macro-rw-body">
        <p className="macro-rw-note">
          Open the full research workspace to draft the macro thesis, attach catalysts,
          and push to the decision ledger. Every theme and country routes here.
        </p>
        <button type="button" className="macro-rw-cta" onClick={() => { try { onOpenResearch && onOpenResearch({ country: cov.cca3 || countryCode }); } catch { /* no-op */ } }}>
          Open Research Workspace
        </button>
      </div>
    </section>
  );
}

export default MacroResearchWorkspaceModule;
