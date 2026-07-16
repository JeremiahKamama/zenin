// FilingComparison — Phase 3: "What's Changed" between two filings.
// Consumes extracted sections (Business / MD&A / Risk Factors) from
// useDocumentIntelligence and renders a side-by-side / diff scaffold.
//
// Extraction backend is Phase 2 (getSections). Until wired, the component
// degrades honestly: it shows the two filing forms/dates and a "no extracted
// sections yet" state. No fabricated diffs.

import React from "react";
import { Panel, Ghost } from "../CompactWorkspaceUI";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

const SECTIONS = ["business", "mda", "riskFactors"];
const LABEL = { business: "Business", mda: "MD&A", riskFactors: "Risk Factors" };

function diffWords(a = "", b = "") {
  // Lightweight word-level change count (presence, not semantics).
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  let added = 0, removed = 0;
  wb.forEach((w) => { if (!wa.has(w)) added += 1; });
  wa.forEach((w) => { if (!wb.has(w)) removed += 1; });
  return { added, removed };
}

export function FilingComparison({ symbol }) {
  const di = useDocumentIntelligence(symbol);
  const filings = di.filings || [];
  const a = filings[0], b = filings[1];

  if (!a || !b) {
    return (
      <Panel title="Filing Comparison">
        <Ghost label="Comparison unavailable — need at least two filings (Document Intelligence not yet wired)." />
      </Panel>
    );
  }

  const secA = a.sections || di.sections || null;
  const secB = b.sections || null;
  const hasSections = secA && secB;

  return (
    <Panel title={`Comparison · ${a.formType} vs ${b.formType}`}>
      <div className="filing-cmp-meta">
        <span>{a.formType} · {a.filedAt?.slice(0, 10)}</span>
        <span>vs</span>
        <span>{b.formType} · {b.filedAt?.slice(0, 10)}</span>
      </div>
      {hasSections ? (
        SECTIONS.map((s) => {
          const ta = typeof secA[s] === "string" ? secA[s] : (secA[s]?.text || "");
          const tb = typeof secB[s] === "string" ? secB[s] : (secB[s]?.text || "");
          const d = diffWords(ta, tb);
          return (
            <div key={s} className="filing-cmp-row">
              <div className="filing-cmp-head">{LABEL[s]} <span className="filing-cmp-delta">+{d.added} / -{d.removed} words</span></div>
              <div className="filing-cmp-body">{ta ? ta.slice(0, 240) : "—"}</div>
            </div>
          );
        })
      ) : (
        <Ghost label="Extracted sections unavailable — filing extraction (Phase 2) not yet wired." />
      )}
    </Panel>
  );
}

export default FilingComparison;
