import React from "react";
import { RightRailDrawer, GuidedEmptyState, InlineControlGroup } from "../CompactWorkspaceUI";
import { formatMoney, formatSavedTimestamp } from "./lib/taxConfig";

export default function SavedScenarioDrawer({ open, onClose, savedEstimates, onLoad, onDelete }) {
  return (
    <RightRailDrawer
      open={open}
      onClose={onClose}
      title="Saved Scenarios"
      subtitle="Reusable estimate states with jurisdiction context, notes, and stored outputs."
    >
      {savedEstimates.length ? (
        <div className="tax-workbench-saved-list">
          {savedEstimates.map((entry) => {
            const savedTax =
              Array.isArray(entry.results) && entry.results.length
                ? entry.results.reduce((sum, row) => sum + Number(row.liabilityUSD || 0), 0)
                : 0;
            return (
              <div key={entry.id} className="tax-workbench-saved-row">
                <div className="tax-workbench-saved-main">
                  <strong>{entry.label || "Saved scenario"}</strong>
                  <span>
                    {Array.isArray(entry.jurisdictions) && entry.jurisdictions.length
                      ? entry.jurisdictions.join(", ")
                      : "No jurisdictions recorded"}
                  </span>
                </div>
                <div className="tax-workbench-saved-meta">
                  <span>{formatSavedTimestamp(entry.savedAt)}</span>
                  <strong>{formatMoney(savedTax, "USD")}</strong>
                  <span>
                    {Array.isArray(entry.results) ? `${entry.results.length} result${entry.results.length === 1 ? "" : "s"}` : "0 results"}
                  </span>
                </div>
                <InlineControlGroup className="tax-workbench-saved-actions">
                  <button type="button" className="journal-btn secondary" onClick={() => onLoad(entry)}>
                    Load
                  </button>
                  <button type="button" className="journal-btn danger" onClick={() => onDelete(entry.id)}>
                    Delete
                  </button>
                </InlineControlGroup>
              </div>
            );
          })}
        </div>
      ) : (
        <GuidedEmptyState
          eyebrow="Scenario library"
          title="No saved scenarios yet"
          description="Save the scenarios you want to compare or share with an accountant after you run the first estimate."
          steps={[
            "Run a calculation once the ledger and jurisdictions are ready.",
            "Save the scenario so it can be reloaded, compared, or exported later.",
          ]}
          tone="subtle"
          className="tax-guided-empty"
        />
      )}
    </RightRailDrawer>
  );
}
