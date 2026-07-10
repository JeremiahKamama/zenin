import React from "react";
import { DensePanelHeader } from "../CompactWorkspaceUI";
import { TaxCompliancePanel } from "../InstitutionalPanels";

export default function ComplianceWorkspace({
  jurisdictions,
  ledgerRows,
  scenarioRows,
  currency,
  summary,
  hasBlockingIssues,
  expanded,
  onToggle,
}) {
  const isOpen = expanded || hasBlockingIssues;

  return (
    <section className={`tax-workbench-panel tax-workbench-compliance ${isOpen ? "is-open" : "is-collapsed"}`.trim()}>
      <DensePanelHeader
        title="Compliance"
        subtitle={hasBlockingIssues ? "Validation failed — review the flagged items below." : "Checks, wash-sale detection, and audit trail."}
        actions={
          <button type="button" className="tax-workbench-link-btn" onClick={onToggle} aria-expanded={isOpen}>
            {isOpen ? "Collapse" : "Expand"}
          </button>
        }
      />
      {isOpen ? (
        <TaxCompliancePanel
          jurisdictions={jurisdictions}
          ledgerRows={ledgerRows}
          scenarioRows={scenarioRows}
          currency={currency}
          summary={summary}
        />
      ) : (
        <p className="tax-workbench-compliance-collapsed-hint">
          Compliance checks run automatically. This panel expands when validation fails or you open it.
        </p>
      )}
    </section>
  );
}
