// GovernanceIntelligence — proxy-derived governance (Document Intelligence).
// Consumes useDocumentIntelligence.governance. Honest Ghost when unwired.

import React from "react";
import { Panel, MetricStrip, Badge, Ghost } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

export function GovernanceIntelligence({ symbol, kind = "stock" }) {
  const di = useDocumentIntelligence(symbol);
  const g = di.governance;

  return (
    <IntelligencePanel
      title="Governance"
      question={`How is ${symbol} governed — board, comp, shareholder rights?`}
      kind={kind}
      domain="governance"
      available={Boolean(g)}
      unavailableNote="Governance unavailable. Proxy statements (Document Intelligence) not yet wired."
    >
      <div className="gov-grid">
        <Panel title="Board">
          {g?.board?.length ? (
            <ul className="gov-board">
              {g.board.slice(0, 8).map((m, i) => (
                <li key={i}><span>{m.name || m}</span><span>{m.role || m.title || ""}</span><span>{m.independent ? "Independent" : ""}</span></li>
              ))}
            </ul>
          ) : <Ghost label="Board composition unavailable." />}
        </Panel>
        <Panel title="Executive Compensation">
          {g?.comp ? (
            <MetricStrip items={[
              { label: "CEO Pay Ratio", value: g.comp.payRatio != null ? `${g.comp.payRatio}x` : "—" },
              { label: "Median Emp", value: g.comp.medianEmployee != null ? `$${g.comp.medianEmployee.toLocaleString()}` : "—" },
              { label: "Equity-Heavy", value: g.comp.equityHeavy ? "Yes" : "—" },
            ]} />
          ) : <Ghost label="Compensation unavailable." />}
        </Panel>
        <Panel title="Shareholder Proposals">
          {Array.isArray(g?.proposals) && g.proposals.length ? (
            g.proposals.slice(0, 5).map((p, i) => <div key={i} className="gov-prop">{p.text || p}</div>)
          ) : <Ghost label="No proposals captured." />}
        </Panel>
        <Panel title="Committees">
          {(g?.committees || []).map((c) => <Badge key={c} tone="watch">{c}</Badge>) || <Ghost label="Committee data unavailable." />}
        </Panel>
      </div>
    </IntelligencePanel>
  );
}

export default GovernanceIntelligence;
