// FilingProvenance — Phase 2: link a financial/valuation metric back to its
// originating filing ("Derived from latest 10-Q · View Source →"). Reads the
// latest filing from useDocumentIntelligence. Honest: shows "—" when no filing
// is wired. Clicking View opens the Filings tier (no provider-specific logic).

import React from "react";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

export function FilingProvenance({ symbol, onViewFiling }) {
  const di = useDocumentIntelligence(symbol);
  const lf = di.latestFiling;
  return (
    <div className="filing-provenance" aria-label="Source filing">
      <span className="filing-provenance__label">Derived from</span>
      {lf ? (
        <>
          <span className="filing-provenance__form">{lf.formType || "Filing"}</span>
          <span className="filing-provenance__date">{lf.filedAt ? lf.filedAt.slice(0, 10) : ""}</span>
          {onViewFiling ? (
            <button type="button" className="filing-provenance__link" onClick={onViewFiling}>View Source →</button>
          ) : null}
        </>
      ) : (
        <span className="filing-provenance__none">— (no filing wired)</span>
      )}
    </div>
  );
}

export default FilingProvenance;
