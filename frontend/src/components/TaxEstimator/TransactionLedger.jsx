import React from "react";
import { DensePanelHeader, GuidedEmptyState } from "../CompactWorkspaceUI";
import { LedgerInput } from "./lib/taxUi";

export default function TransactionLedger({
  accountantCopy,
  ledgerSections,
  advanced,
  validationState,
  hasManualGainEdit,
  onLedgerOverride,
  onResetLedger,
}) {
  const hasRows = ledgerSections.some((section) => section.rows.length > 0);

  return (
    <section className="tax-workbench-panel tax-workbench-ledger-panel">
      <DensePanelHeader
        title={accountantCopy.ledgerTitle}
        subtitle={accountantCopy.ledgerSubtitle}
        actions={
          hasManualGainEdit ? (
            <button type="button" className="tax-workbench-link-btn" onClick={onResetLedger}>
              Re-sync from trades
            </button>
          ) : null
        }
      />

      {!hasRows ? (
        <GuidedEmptyState
          eyebrow="Ledger workflow"
          title="No ledger rows yet"
          description="The estimator needs instrument-level gains before it can model liabilities across jurisdictions."
          steps={[
            "Import a trade file or add holdings in Portfolio to seed the ledger.",
            "Review cost basis, proceeds, dates, fees, and FX before calculating.",
          ]}
          className="tax-guided-empty"
        />
      ) : (
        <div className="tax-workbench-ledger-stack">
          {ledgerSections.map((section) => (
            <article key={section.bucket} className="tax-workbench-ledger-section">
              <div className="tax-workbench-ledger-section-head">
                <strong>{section.label}</strong>
                <p>
                  Cost basis {section.totals.costBasis.toLocaleString(undefined, { maximumFractionDigits: 0 })} · Gain{" "}
                  {section.totals.shortTermGain + section.totals.longTermGain + section.totals.standardGain >= 0
                    ? "+"
                    : ""}
                  {(section.totals.shortTermGain + section.totals.longTermGain + section.totals.standardGain).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 0 }
                  )}
                </p>
              </div>

              <div className="tax-workbench-ledger-table" role="table" aria-label={`${section.label} ledger`}>
                {section.rows.map((row) => (
                  <div className="tax-workbench-ledger-row" role="row" key={row.id}>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Asset class / instrument" role="cell">
                      <div className="tax-workbench-ledger-instrument">
                        <strong>{row.instrument}</strong>
                        <span>{row.subtitle}</span>
                      </div>
                    </div>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Term" role="cell">
                      <span className="tax-workbench-ledger-text">{String(row.classification || "Standard").toUpperCase()}</span>
                    </div>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Qty / Units" role="cell">
                      <LedgerInput
                        label={`${row.instrument} quantity`}
                        value={row.quantity}
                        onChange={(value) => onLedgerOverride(row.id, "quantity", value)}
                      />
                    </div>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Cost basis (USD)" role="cell">
                      <LedgerInput
                        label={`${row.instrument} cost basis`}
                        value={row.costBasis}
                        onChange={(value) => onLedgerOverride(row.id, "costBasis", value)}
                      />
                    </div>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Proceeds (USD)" role="cell">
                      <LedgerInput
                        label={`${row.instrument} proceeds`}
                        value={row.marketValue}
                        onChange={(value) => onLedgerOverride(row.id, "marketValue", value)}
                      />
                    </div>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Gain / loss (USD)" role="cell">
                      {(() => {
                        const editableField =
                          row.bucket === "Equities" || row.bucket === "Crypto"
                            ? Math.abs(Number(row.longTermGain || 0)) > Math.abs(Number(row.shortTermGain || 0))
                              ? "longTermGain"
                              : "shortTermGain"
                            : "standardGain";
                        const gainValue =
                          Number(row.shortTermGain || 0) + Number(row.longTermGain || 0) + Number(row.standardGain || 0);
                        return (
                          <LedgerInput
                            label={`${row.instrument} gain or loss`}
                            value={gainValue}
                            tone={gainValue ? (gainValue >= 0 ? "positive" : "negative") : ""}
                            onChange={(value) => onLedgerOverride(row.id, editableField, value)}
                          />
                        );
                      })()}
                    </div>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Acq. date" role="cell">
                      <span className="tax-workbench-ledger-text">
                        {advanced.acquisitionDate || (row.updatedAt ? new Date(row.updatedAt).toISOString().slice(0, 10) : "—")}
                      </span>
                    </div>
                    <div className="tax-workbench-cell tax-workbench-ledger-cell" data-label="Sale date" role="cell">
                      <span className="tax-workbench-ledger-text">
                        {advanced.saleDate || (row.updatedAt ? new Date(row.updatedAt).toISOString().slice(0, 10) : "—")}
                      </span>
                    </div>
                    <div
                      className="tax-workbench-cell tax-workbench-ledger-cell tax-workbench-fee-fx-cell"
                      data-label="Fees / FX"
                      role="cell"
                    >
                      <LedgerInput
                        label={`${row.instrument} fees`}
                        value={row.fees}
                        invalid={Boolean(validationState.ledgerFieldErrors[row.id]?.fees)}
                        message={validationState.ledgerFieldErrors[row.id]?.fees}
                        onChange={(value) => onLedgerOverride(row.id, "fees", value)}
                      />
                      <LedgerInput
                        label={`${row.instrument} fx rate`}
                        value={row.fxRate}
                        invalid={Boolean(validationState.ledgerFieldErrors[row.id]?.fxRate)}
                        message={validationState.ledgerFieldErrors[row.id]?.fxRate}
                        onChange={(value) => onLedgerOverride(row.id, "fxRate", value)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="tax-workbench-ledger-foot" role="row">
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Asset class / instrument" role="cell">
                  <span>Portfolio total</span>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Term" role="cell">
                  <strong>—</strong>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Qty / Units" role="cell">
                  <strong>{section.rows.reduce((sum, r) => sum + Number(r.quantity || 0), 0).toLocaleString()}</strong>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Cost basis (USD)" role="cell">
                  <strong>{section.totals.costBasis.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Proceeds (USD)" role="cell">
                  <strong>
                    {section.rows.reduce((sum, r) => sum + Number(r.marketValue || 0), 0).toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Gain / loss (USD)" role="cell">
                  <strong>
                    {(section.totals.shortTermGain + section.totals.longTermGain + section.totals.standardGain).toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                  </strong>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Acq. date" role="cell">
                  <strong>—</strong>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Sale date" role="cell">
                  <strong>—</strong>
                </div>
                <div className="tax-workbench-cell tax-workbench-ledger-foot-item" data-label="Fees / FX" role="cell">
                  <strong>{section.totals.fees.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                  <strong>{Number(section.rows[0]?.fxRate || advanced.fxRate || 1).toFixed(2)}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
