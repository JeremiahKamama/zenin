// BusinessIntelligence — business description / segments / markets (Document
// Intelligence). Consumes useDocumentIntelligence (sections.business or a
// dedicated business object). Honest Ghost when unwired.

import React from "react";
import { Panel, Tag, Ghost } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

export function BusinessIntelligence({ symbol, kind = "stock" }) {
  const di = useDocumentIntelligence(symbol);
  const biz = di.sections?.business || di.latestFiling?.business || null;
  const text = typeof biz === "string" ? biz : (biz?.text || biz?.summary || null);
  const segments = Array.isArray(biz?.segments) ? biz.segments : [];
  const markets = Array.isArray(biz?.markets) ? biz.markets : [];
  const customers = Array.isArray(biz?.customers) ? biz.customers : [];

  return (
    <IntelligencePanel
      title="Business"
      question={`What does ${symbol} actually do — products, segments, customers?`}
      kind={kind}
      domain="management"
      available={Boolean(text || segments.length)}
      unavailableNote="Business description unavailable. Document Intelligence (SEC 10-K Business) not yet wired."
    >
      <Panel title="Description">
        {text ? <p className="biz-desc">{text}</p> : <Ghost label="No business description." />}
      </Panel>
      <Panel title="Segments">
        {segments.length ? segments.map((s) => <Tag key={s}>{s}</Tag>) : <Ghost label="Segments unavailable." />}
      </Panel>
      <Panel title="Markets">
        {markets.length ? markets.map((m) => <Tag key={m}>{m}</Tag>) : <Ghost label="Markets unavailable." />}
      </Panel>
      <Panel title="Key Customers">
        {customers.length ? customers.map((c) => <Tag key={c}>{c}</Tag>) : <Ghost label="Customers unavailable." />}
      </Panel>
    </IntelligencePanel>
  );
}

export default BusinessIntelligence;
