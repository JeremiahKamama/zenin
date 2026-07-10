import React from "react";
import { RightRailDrawer } from "../CompactWorkspaceUI";
import { TaxField } from "./lib/taxUi";

export default function AdvancedSettingsDrawer({ open, onClose, advanced, additionalIncome, validationState, onChange, onIncomeChange, onDocumentImport, fileName, showImportPreview }) {
  return (
    <RightRailDrawer open={open} onClose={onClose} title="Scenario Settings" subtitle="Filing assumptions and ordinary-income context. Change only when the scenario requires it.">
      <div className="tax-workbench-context-grid">
        <TaxField label="Realization mode">
          <select value={advanced.realizationMode} onChange={(e) => onChange("realizationMode", e.target.value)}>
            <option value="realized">Realized</option>
            <option value="unrealized">Unrealized</option>
          </select>
        </TaxField>
        <TaxField
          label="Acquisition date"
          invalid={Boolean(validationState.fieldErrors.acquisitionDate)}
          message={validationState.fieldErrors.acquisitionDate}
        >
          <input type="date" value={advanced.acquisitionDate} onChange={(e) => onChange("acquisitionDate", e.target.value)} />
        </TaxField>
        <TaxField
          label="Sale date"
          invalid={Boolean(validationState.fieldErrors.saleDate)}
          message={validationState.fieldErrors.saleDate}
        >
          <input type="date" value={advanced.saleDate} onChange={(e) => onChange("saleDate", e.target.value)} />
        </TaxField>
        <TaxField
          label="FX rate"
          invalid={Boolean(validationState.fieldErrors.fxRate)}
          message={validationState.fieldErrors.fxRate}
        >
          <input type="text" inputMode="decimal" value={advanced.fxRate} onChange={(e) => onChange("fxRate", e.target.value)} />
        </TaxField>
        <TaxField
          label="Fees"
          invalid={Boolean(validationState.fieldErrors.fees)}
          message={validationState.fieldErrors.fees}
        >
          <input type="text" inputMode="decimal" value={advanced.fees} onChange={(e) => onChange("fees", e.target.value)} />
        </TaxField>
        <TaxField label="Brokerage">
          <input type="text" inputMode="decimal" value={advanced.brokerage} onChange={(e) => onChange("brokerage", e.target.value)} />
        </TaxField>
        <TaxField label="Loss carryforward">
          <input type="text" inputMode="decimal" value={advanced.lossCarryforward} onChange={(e) => onChange("lossCarryforward", e.target.value)} />
        </TaxField>
        <TaxField label="Exemption threshold">
          <input type="text" inputMode="decimal" value={advanced.exemptionThreshold} onChange={(e) => onChange("exemptionThreshold", e.target.value)} />
        </TaxField>
        <TaxField label="Foreign tax paid">
          <input type="text" inputMode="decimal" value={advanced.foreignTaxPaid} onChange={(e) => onChange("foreignTaxPaid", e.target.value)} />
        </TaxField>
        <TaxField
          label="Withholding tax"
          message={validationState.fieldWarnings.withholdingTax}
          tone={validationState.fieldWarnings.withholdingTax ? "warning" : "default"}
        >
          <input type="text" inputMode="decimal" value={advanced.withholdingTax} onChange={(e) => onChange("withholdingTax", e.target.value)} />
        </TaxField>
        <TaxField label="Residency status">
          <select value={advanced.residencyStatus} onChange={(e) => onChange("residencyStatus", e.target.value)}>
            <option value="resident">Resident</option>
            <option value="non-resident">Non-resident</option>
          </select>
        </TaxField>
        <TaxField label="Tax regime">
          <select value={advanced.taxRegime} onChange={(e) => onChange("taxRegime", e.target.value)}>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
            <option value="trust">Trust</option>
            <option value="fund">Fund</option>
          </select>
        </TaxField>
        <TaxField label="Filing status">
          <select value={advanced.filingStatus} onChange={(e) => onChange("filingStatus", e.target.value)}>
            <option value="single">Single</option>
            <option value="married-joint">Married (Joint)</option>
            <option value="married-separate">Married (Separate)</option>
            <option value="head-of-household">Head of household</option>
          </select>
        </TaxField>
        <TaxField label="Salary income">
          <input type="text" inputMode="decimal" value={additionalIncome.salary} onChange={(e) => onIncomeChange("salary", e.target.value)} />
        </TaxField>
        <TaxField label="Dividends">
          <input type="text" inputMode="decimal" value={additionalIncome.dividends} onChange={(e) => onIncomeChange("dividends", e.target.value)} />
        </TaxField>
        <TaxField label="Interest">
          <input type="text" inputMode="decimal" value={additionalIncome.interest} onChange={(e) => onIncomeChange("interest", e.target.value)} />
        </TaxField>
        <TaxField label="Staking / airdrops">
          <input
            type="text"
            inputMode="decimal"
            value={Number(additionalIncome.stakingRewards || 0) + Number(additionalIncome.airdrops || 0)}
            onChange={(e) => {
              const next = Number(e.target.value) || 0;
              onIncomeChange("stakingRewards", next / 2);
              onIncomeChange("airdrops", next / 2);
            }}
          />
        </TaxField>
      </div>

      <TaxField
        label="Scenario notes"
        className="full-span"
        message={validationState.fieldWarnings.notes}
        tone={validationState.fieldWarnings.notes ? "warning" : "default"}
      >
        <textarea
          value={advanced.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          placeholder="Add filing assumptions, exceptions, treaty treatment, or any manual basis adjustments."
        />
      </TaxField>

      <div className="tax-workbench-import-row">
        <label className="tax-workbench-file-input">
          <span>Import statement preview</span>
          <input type="file" onChange={onDocumentImport} />
        </label>
        {showImportPreview ? (
          <div className="tax-workbench-import-preview">
            <strong>{fileName || "Imported file attached"}</strong>
            <span>Preview only. Reconcile jurisdiction, basis, proceeds, and FX before submitting.</span>
          </div>
        ) : null}
      </div>
    </RightRailDrawer>
  );
}
