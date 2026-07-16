// RiskFactorsIntelligence — Risk Factors (Document Intelligence), linked to the
// Risk engine tier. Consumes useDocumentIntelligence.sections.riskFactors.
// Honest Ghost when unwired.

import React from "react";
import { Panel, Tag, Ghost } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

const RISK_BUCKETS = [
  "Operational", "Financial", "Technology", "Legal", "Regulatory",
  "Supply Chain", "Competition", "Cybersecurity", "Geographic",
];

export function RiskFactorsIntelligence({ symbol, kind = "stock" }) {
  const di = useDocumentIntelligence(symbol);
  const rf = di.sections?.riskFactors || null;
  const items = Array.isArray(rf) ? rf : (rf?.items || []);
  const cats = Array.isArray(rf?.categories) ? rf.categories : RISK_BUCKETS;

  return (
    <IntelligencePanel
      title="Risk Factors"
      question={`What could go wrong for ${symbol}, per its own filings?`}
      kind={kind}
      domain="documents"
      available={Boolean(items.length)}
      unavailableNote="Risk factors unavailable. Document Intelligence (SEC Risk Factors) not yet wired."
    >
      <Panel title="Disclosed Risk Factors">
        {items.length ? (
          <ul className="risk-list">
            {items.slice(0, 12).map((r, i) => (
              <li key={i} className="risk-item">{typeof r === "string" ? r : (r.text || r.title || r)}</li>
            ))}
          </ul>
        ) : <Ghost label="No risk factors extracted." />}
      </Panel>
      <Panel title="Categories">
        {cats.map((c) => <Tag key={c}>{c}</Tag>)}
      </Panel>
    </IntelligencePanel>
  );
}

export default RiskFactorsIntelligence;
