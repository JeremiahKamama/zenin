// P5 Alternative Intelligence — evidence-backed alt data only (no social
// sentiment). Each provider exposes Coverage / Confidence / Last Update; all are
// declared unavailable until wired. Thin IntelligencePanel wrapper.

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const PROVIDERS = [
  { name: "Google Trends", metric: "Search interest" },
  { name: "Electricity Demand", metric: "Power consumption" },
  { name: "Container Freight", metric: "Freight index" },
  { name: "Patent Activity", metric: "Filings" },
  { name: "Developer Activity", metric: "Commits" },
  { name: "Hiring / Job Listings", metric: "Postings" },
  { name: "Satellite (future)", metric: "Night lights" },
  { name: "Port Traffic", metric: "Throughput" },
  { name: "Semiconductor Sales", metric: "Units" },
  { name: "Auto Sales", metric: "Units" },
  { name: "Retail Sales", metric: "Revenue" },
  { name: "Power Demand", metric: "GW" },
  { name: "Shipping", metric: "TEU" },
  { name: "Manufacturing", metric: "PMI" },
];

export function AlternativeIntelligence({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Alternative Intelligence"
      question={`What evidence-backed alternative signals exist for ${symbol}?`}
      kind={kind}
      domain="alternative"
      available={false}
      unavailableNote="Alternative data unavailable. No alt-data provider wired (evidence-only; no social sentiment)."
    >
      <div className="intel-block-grid">
        {PROVIDERS.map((p) => (
          <Panel key={p.name} title={p.name}><Ghost label={`${p.metric} unavailable — provider not wired.`} /></Panel>
        ))}
      </div>
      <Panel title="Providers Registered">
        <div className="ownership-block-list">{PROVIDERS.map((p) => <Badge key={p.name} tone="watch">{p.name}</Badge>)}</div>
      </Panel>
    </IntelligencePanel>
  );
}
export default AlternativeIntelligence;
