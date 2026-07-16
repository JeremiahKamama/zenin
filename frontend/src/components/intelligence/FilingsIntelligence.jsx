// FilingsIntelligence — Document Intelligence: filing timeline, latest filing,
// recent events, document reader, document search (Phase 3), and filing
// comparison (Phase 3 "What's Changed"). Consumes useDocumentIntelligence.
// Honest Ghost when the provider is not wired. Monochrome.

import React, { useMemo, useState } from "react";
import { Panel, Ghost, Timeline, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { DocumentReader } from "./DocumentReader";
import { FilingComparison } from "./FilingComparison";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

export function FilingsIntelligence({ symbol, kind = "stock" }) {
  const di = useDocumentIntelligence(symbol);
  const [query, setQuery] = useState("");
  const [compare, setCompare] = useState(false);

  const events = di.timeline.length ? di.timeline : di.recentEvents;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) =>
      `${e.formType || ""} ${e.title || ""} ${e.description || ""}`.toLowerCase().includes(q)
    );
  }, [events, query]);

  return (
    <IntelligencePanel
      title="Filings & Document Intelligence"
      question={`What has ${symbol} filed, and what changed?`}
      kind={kind}
      domain="filings"
      available={di.available}
      unavailableNote="Filings unavailable. Document Intelligence provider (SEC EDGAR) not yet wired."
    >
      <div className="filings-grid">
        <Panel title="Latest Filing">
          {di.latestFiling ? (
            <>
              <div className="filings-form">{di.latestFiling.formType || "Filing"}</div>
              <div className="filings-date">{di.latestFiling.filedAt?.slice(0, 10) || "—"}</div>
              <div className="filings-title">{di.latestFiling.title || di.latestFiling.description || ""}</div>
              {di.latestFiling.material ? <Badge tone="watch">Material</Badge> : null}
            </>
          ) : <Ghost label="Latest filing unavailable." />}
        </Panel>
        <Panel title="Filing Timeline">
          {events.length ? <Timeline items={filtered.map((e) => ({
            id: e.id || e.formType,
            kind: e.formType || "filing",
            title: `${e.formType || "Filing"}${e.title ? ` — ${e.title}` : ""}`,
            time: e.filedAt || e.date,
            meta: e.material ? "Material" : undefined,
          }))} /> : <Ghost label="No filings captured." />}
        </Panel>
        <Panel title="Recent Events">
          {di.recentEvents.length ? (
            <ul className="filings-events">
              {di.recentEvents.slice(0, 6).map((e, i) => (
                <li key={i}><span>{e.formType || e.type}</span><span>{e.filedAt?.slice(0, 10) || ""}</span></li>
              ))}
            </ul>
          ) : <Ghost label="No recent events." />}
        </Panel>
      </div>

      <Panel title="Document Search">
        <input
          className="doc-reader__search"
          placeholder="Search filings (form type, title)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search filings"
        />
        <div className="filings-search-count">{filtered.length} of {events.length} filings</div>
      </Panel>

      <Panel title="Document Reader">
        <DocumentReader sections={di.sections} loading={di.loading} />
      </Panel>

      <Panel title="What's Changed">
        <button type="button" className="filing-provenance__link" onClick={() => setCompare((v) => !v)}>
          {compare ? "Hide comparison" : "Compare latest two filings →"}
        </button>
        {compare ? <FilingComparison symbol={symbol} /> : null}
      </Panel>
    </IntelligencePanel>
  );
}

export default FilingsIntelligence;
