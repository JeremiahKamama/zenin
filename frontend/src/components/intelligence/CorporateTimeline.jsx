// CorporateTimeline — one scrollable/filterable/clickable timeline of corporate
// events. Now consumes Document Intelligence (10-K/Q, 8-K, proxy, dividends,
// CEO change, buyback, M&A, litigation, etc.) via useDocumentIntelligence. When
// the provider is unwired it degrades to the honest empty state — never fabricates.
//
// Every node can open the Document Reader (Phase 2) — for now it renders the
// event list from the filings timeline.

import React from "react";
import { Panel, Ghost, Timeline, Tag } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

const EVENT_TYPES = [
  "10-K", "10-Q", "8-K", "Proxy", "Dividend", "CEO Change", "Board Appointment",
  "Share Buyback", "Debt Issuance", "Acquisition", "Merger", "Litigation",
  "Bankruptcy", "Split", "Institutional Filing", "Insider Filing",
];

export function CorporateTimeline({ symbol, kind = "stock" }) {
  const di = useDocumentIntelligence(symbol);
  const events = di.timeline.length
    ? di.timeline
    : (di.recentEvents || []).map((e) => ({ ...e, kind: e.formType || e.type }));
  const available = di.available && events.length > 0;

  return (
    <IntelligencePanel
      title="Corporate Timeline"
      question={`What are the key corporate events for ${symbol}?`}
      kind={kind}
      domain="corporateActions"
      available={available}
      unavailableNote="Corporate timeline unavailable. Document Intelligence events service not yet wired."
    >
      <Panel title="Timeline">
        {events.length ? (
          <Timeline items={events.slice(0, 20).map((e) => ({
            id: e.id || e.formType || e.title,
            kind: e.formType || e.type || "event",
            title: e.title || `${e.formType || e.type} filed`,
            time: e.filedAt || e.date,
            meta: e.material ? "Material" : undefined,
          }))} />
        ) : <Ghost label="No corporate events captured for this asset." />}
      </Panel>
      <Panel title="Event Types Registered">
        <div className="ownership-block-list">{EVENT_TYPES.map((e) => <Tag key={e}>{e}</Tag>)}</div>
      </Panel>
    </IntelligencePanel>
  );
}

export default CorporateTimeline;
