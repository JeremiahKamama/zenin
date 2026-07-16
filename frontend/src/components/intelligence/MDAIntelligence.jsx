// MDAIntelligence — Management Discussion & Analysis reader (Document
// Intelligence). Consumes useDocumentIntelligence.sections.mda. Honest Ghost.

import React from "react";
import { Panel, MetricStrip, Ghost } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

export function MDAIntelligence({ symbol, kind = "stock" }) {
  const di = useDocumentIntelligence(symbol);
  const mda = di.sections?.mda || null;
  const text = typeof mda === "string" ? mda : (mda?.text || mda?.summary || null);

  return (
    <IntelligencePanel
      title="MD&A"
      question={`What did management say about results, liquidity, and outlook?`}
      kind={kind}
      domain="documents"
      available={Boolean(text)}
      unavailableNote="MD&A unavailable. Document Intelligence (SEC 10-K/Q MD&A) not yet wired."
    >
      <Panel title="Management Discussion">
        {text ? <p className="mda-text">{text}</p> : <Ghost label="No MD&A extracted." />}
      </Panel>
      <Panel title="Extracted Themes">
        <MetricStrip items={[
          { label: "Revenue", value: mda?.revenue || "—" },
          { label: "Margin", value: mda?.margin || "—" },
          { label: "Liquidity", value: mda?.liquidity || "—" },
          { label: "Forward Guidance", value: mda?.guidance || "—" },
        ]} />
      </Panel>
    </IntelligencePanel>
  );
}

export default MDAIntelligence;
