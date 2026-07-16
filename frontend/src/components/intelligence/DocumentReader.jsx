// DocumentReader — filing section reader (Principle: never embed SEC HTML).
//
// Renders extracted, normalized filing sections as a navigable accordion with
// search + reading position. Each section is plain text/structured data from
// the Document Intelligence provider (SEC), parsed server-side — no raw HTML,
// no PDF embed. Monochrome (Brand v2).
//
// Sections per spec: Overview, Business, Risk Factors, MD&A, Financial
// Statements, Legal, Governance, Controls, Notes, Original Filing.

import React, { useMemo, useState } from "react";
import { Panel, Ghost } from "../CompactWorkspaceUI";

const SECTION_ORDER = [
  "overview", "business", "riskFactors", "mda", "financials",
  "legal", "governance", "controls", "notes", "original",
];
const SECTION_LABEL = {
  overview: "Overview",
  business: "Business",
  riskFactors: "Risk Factors",
  mda: "MD&A",
  financials: "Financial Statements",
  legal: "Legal Proceedings",
  governance: "Governance",
  controls: "Controls",
  notes: "Notes",
  original: "Original Filing",
};

export function DocumentReader({ sections, loading }) {
  const [open, setOpen] = useState("business");
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(0);
  const ordered = useMemo(
    () => SECTION_ORDER.filter((k) => sections && sections[k]),
    [sections]
  );
  if (loading) return <Ghost label="Loading filing…" />;
  if (!ordered.length) return <Ghost label="Filing sections unavailable — Document Intelligence not yet wired." />;

  const q = query.trim().toLowerCase();
  return (
    <div className="doc-reader">
      <div className="doc-reader__bar">
        <input
          className="doc-reader__search"
          placeholder="Search filing…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search filing"
        />
        {typeof position === "number" ? (
          <span className="doc-reader__progress" aria-hidden>{(position * 100).toFixed(0)}%</span>
        ) : null}
      </div>
      <nav className="doc-reader__nav" aria-label="Filing sections">
        {ordered.map((k) => (
          <button
            key={k}
            type="button"
            className={`doc-reader__navitem ${open === k ? "is-active" : ""}`}
            onClick={() => setOpen(k)}
          >
            {SECTION_LABEL[k] || k}
          </button>
        ))}
      </nav>
      <div className="doc-reader__body" onScroll={(e) => {
        const el = e.currentTarget;
        setPosition(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
      }}>
        {ordered.map((k) => {
          if (open !== k) return null;
          const body = sections[k];
          const text = typeof body === "string" ? body : (body?.text || body?.summary || JSON.stringify(body, null, 2));
          const hit = q && text.toLowerCase().includes(q);
          return (
            <Panel key={k} title={SECTION_LABEL[k] || k}>
              <div className={`doc-reader__section ${hit ? "has-hit" : ""}`}>{text}</div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

export default DocumentReader;
