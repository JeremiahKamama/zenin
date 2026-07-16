// IntelligencePanel — reusable primitive enforcing the Phase Next universal
// reliability layer. EVERY intelligence panel (Ownership, Supply Chain, Factor,
// Scenario, etc.) wraps its content in this so provenance + graceful fallback
// are identical everywhere (spec: "no duplicated implementations", "every
// insight exposes provenance and confidence"). Uses CompactWorkspaceUI tokens.
//
// Brand v2: monochrome only. No fabricated values — if `available` is false the
// panel renders the honest Unavailable state and NEVER substitutes unrelated
// metrics.

import React from "react";
import { Section, Panel, ConfidenceBadge, Ghost } from "../CompactWorkspaceUI";
import { buildProvenance, tierMeta } from "../../utils/DataCoverageRegistry";
import { LineageSource } from "./DataLineage";

function ProvenanceBar({ prov }) {
  if (!prov) return null;
  const tier = tierMeta(prov.coverageTier);
  // Each provenance value is a clickable LineageSource (P6/P14): opens the
  // Source / Timestamp / Methodology / Calculation / Confidence / Coverage /
  // Fallback / Historical Accuracy popover. No hidden calculations.
  const lineageOf = (extra) => ({ source: prov.liveProviderLabel || "None", timestamp: prov.freshness || "unknown", coverage: prov.coveragePct, confidence: prov.confidencePct, fallback: (prov.fallbackChain || []).join(" → ") || "None", ...extra });
  return (
    <div className="intel-provenance" role="contentinfo">
      <span className="intel-prov-item">
        <em>Source</em>
        <LineageSource label="Source" value={prov.liveProviderLabel || "None"} lineage={lineageOf()} />
      </span>
      <span className="intel-prov-item">
        <em>Coverage</em>
        <LineageSource label="Coverage" value={`${prov.coveragePct}%`} lineage={lineageOf({ methodology: `Tier ${prov.coverageTier}` })} />
      </span>
      <span className="intel-prov-item">
        <em>Confidence</em>
        <LineageSource label="Confidence" value={<ConfidenceBadge value={prov.confidencePct} />} lineage={lineageOf()} />
      </span>
      <span className="intel-prov-item">
        <em>Updated</em>
        <LineageSource label="Updated" value={prov.freshness || "—"} lineage={lineageOf()} />
      </span>
      <span className="intel-prov-item">
        <em>Cadence</em>
        <LineageSource label="Cadence" value={prov.cadence || "—"} lineage={lineageOf()} />
      </span>
      {prov.missingProviders?.length ? (
        <span className="intel-prov-item">
          <em>Missing</em>
          <strong>{prov.missingProviders.map((p) => p.replace("_", " ")).join(", ")}</strong>
        </span>
      ) : null}
      {prov.fallbackChain?.length ? (
        <span className="intel-prov-item">
          <em>Fallback</em>
          <strong>{prov.fallbackChain.map((p) => p.replace("_", " ")).join(" → ")}</strong>
        </span>
      ) : null}
    </div>
  );
}

/**
 * @param {string} title        panel title
 * @param {string} question     the question this panel answers (Tier 1 verdict)
 * @param {string} kind         asset kind (stock/etf/commodity/macro)
 * @param {string} domain       intelligence domain (ownership/macro/market...)
 * @param {boolean} available   is live data present? if false → honest unavailable
 * @param {string} unavailableNote  why unavailable (filing not processed etc.)
 * @param {React.ReactNode} children  the actual intelligence content (Tier 2-5)
 * @param {object} [provOverride]  optional explicit provenance (else derived)
 */
export function IntelligencePanel({
  title,
  question,
  kind,
  domain,
  available = true,
  unavailableNote,
  children,
  provOverride,
}) {
  const prov = provOverride || (kind && domain ? buildProvenance(kind, domain) : null);

  return (
    <Section title={title} description={question}>
      <ProvenanceBar prov={prov} />
      {available ? (
        children
      ) : (
        <Panel title="Data Unavailable">
          <Ghost label={unavailableNote || "Primary provider failed; secondary providers not yet wired. No value shown."} />
          {prov ? (
            <p className="intel-unavailable-note">
              Source: {prov.liveProviderLabel || "None"} · Coverage {prov.coveragePct}% · Last update: {prov.freshness || "unknown"}.
              Fallback chain: {prov.fallbackChain.map((p) => p.replace("_", " ")).join(" → ")}.
            </p>
          ) : null}
        </Panel>
      )}
    </Section>
  );
}

export default IntelligencePanel;
