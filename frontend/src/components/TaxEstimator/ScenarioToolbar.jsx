import React from "react";
import { JurisdictionCombobox } from "./lib/taxUi";
import { getTaxRules } from "./lib/taxConfig";

export default function ScenarioToolbar({
  jurisdictions,
  primaryJurisdiction,
  advanced,
  taxYear,
  scenario,
  hasBlockingIssues,
  onPrimaryJurisdictionChange,
  onAdvancedChange,
  onTaxYearChange,
  onScenarioChange,
}) {
  const taxRules = getTaxRules();

  return (
    <section className="tax-workbench-panel tax-workbench-toolbar-panel">
      <div className="tax-workbench-toolbar-grid">
        <JurisdictionCombobox
          rules={taxRules}
          value={primaryJurisdiction}
          onChange={onPrimaryJurisdictionChange}
          label="Filing jurisdiction"
        />

        <label className="tax-workbench-inline-select">
          <span>Basis method</span>
          <select value={advanced.costBasisMethod} onChange={(e) => onAdvancedChange("costBasisMethod", e.target.value)}>
            <option value="fifo">FIFO</option>
            <option value="lifo">LIFO</option>
            <option value="hifo">HIFO</option>
            <option value="average">Average</option>
          </select>
        </label>

        <label className="tax-workbench-inline-select">
          <span>Sale timing shift</span>
          <select
            value={scenario.shiftDays}
            onChange={(e) => onScenarioChange("shiftDays", Number(e.target.value))}
          >
            <option value={0}>As recorded</option>
            <option value={30}>+30 days</option>
            <option value={90}>+90 days</option>
            <option value={180}>+180 days</option>
            <option value={365}>+1 year</option>
          </select>
        </label>

        <label className="tax-workbench-inline-select">
          <span>Filing year</span>
          <select value={taxYear} onChange={(e) => onTaxYearChange(e.target.value)}>
            {["2026", "2025", "2024", "2023"].map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          form="tax-workbench-form"
          className={`tax-workbench-run-btn ${hasBlockingIssues ? "is-disabled" : ""}`.trim()}
          aria-describedby="tax-workbench-form-status"
        >
          {hasBlockingIssues ? "Resolve issues to run" : "Run scenario"}
        </button>
      </div>
      <p className="tax-workbench-toolbar-hint">
        Selected jurisdictions: {jurisdictions.map((key) => key).join(", ") || "none"}
      </p>
    </section>
  );
}
