import React from "react";
import { RightRailDrawer, GuidedEmptyState } from "../CompactWorkspaceUI";
import { formatSavedTimestamp } from "./lib/taxConfig";

export default function AuditTrailDrawer({ open, onClose, auditTrail }) {
  return (
    <RightRailDrawer
      open={open}
      onClose={onClose}
      title="Audit Trail"
      subtitle="Append-only history of every calculation run. Read-only."
    >
      {auditTrail.length ? (
        <div className="tax-workbench-audit-list">
          {auditTrail.map((entry) => (
            <article key={entry.id} className="tax-workbench-audit-row">
              <div className="tax-workbench-audit-main">
                <strong>{entry.eventType || "event"}</strong>
                <span>{entry.jurisdictions?.join(", ") || "—"}</span>
              </div>
              <div className="tax-workbench-audit-meta">
                <span>{formatSavedTimestamp(entry.createdAt)}</span>
                <strong>{(Number(entry.estimatedTax) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <GuidedEmptyState
          eyebrow="Audit"
          title="No audit events yet"
          description="Run a calculation to record the first entry in the immutable trail."
          tone="subtle"
          className="tax-guided-empty"
        />
      )}
    </RightRailDrawer>
  );
}
