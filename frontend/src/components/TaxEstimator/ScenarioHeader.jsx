import React from "react";
import { CompactPageHeader, InlineControlGroup } from "../CompactWorkspaceUI";

export default function ScenarioHeader({
  accountantCopy,
  savedEstimates,
  onLoadSaved,
  onExport,
  onSave,
}) {
  return (
    <CompactPageHeader
      eyebrow={accountantCopy.eyebrow}
      title={accountantCopy.title}
      description={accountantCopy.subtitle}
      actions={
        <InlineControlGroup>
          <select
            className="tax-workbench-scenario-select"
            value=""
            onChange={(event) => {
              const entry = savedEstimates.find((item) => item.id === event.target.value);
              if (entry) onLoadSaved(entry);
            }}
          >
            <option value="">{accountantCopy.syncLabel}</option>
            {savedEstimates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label || "Saved scenario"}
              </option>
            ))}
          </select>
          <button type="button" className="journal-btn secondary" onClick={onExport}>
            {accountantCopy.exportLabel}
          </button>
          <button type="button" className="journal-btn primary" onClick={onSave}>
            {accountantCopy.saveLabel}
          </button>
        </InlineControlGroup>
      }
    />
  );
}
