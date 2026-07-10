import React from "react";
import { DensePanelHeader, GuidedEmptyState } from "../CompactWorkspaceUI";
import { countryFlag, formatMoney } from "./lib/taxConfig";

export default function ResultsWorkspace({ results, accountantCopy, currency }) {
  return (
    <section className="tax-workbench-panel tax-workbench-results-workspace">
      <DensePanelHeader
        title={accountantCopy.resultsTitle}
        subtitle={
          results.length
            ? `${results.length} jurisdiction output${results.length === 1 ? "" : "s"} · after every run`
            : "Run the scenario to calculate estimated liabilities across each selected jurisdiction."
        }
      />

      {results.length ? (
        <>
          <div className="tax-workbench-result-list">
            {results.map((row) => (
              <article key={row.jurisdictionKey} className="tax-workbench-result-card">
                <div className="tax-workbench-result-head">
                  <div>
                    <strong>
                      {countryFlag(row.jurisdictionKey)} {row.jurisdiction}
                    </strong>
                    <span>{row.currency} filing basis</span>
                  </div>
                  <div>
                    <strong>
                      {row.currency} {row.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </strong>
                    <span>≈ {formatMoney(row.liabilityUSD, "USD")}</span>
                  </div>
                </div>
                <div className="tax-workbench-result-lines">
                  {Object.entries(row.details).map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>
                        {row.currency} {Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          {results.length > 1 ? (
            <div
              className="tax-workbench-liability-bar"
              role="img"
              aria-label={`Liability by jurisdiction chart. ${results.length} jurisdictions. Lowest is ${Math.min(
                ...results.map((r) => r.liabilityUSD)
              ).toLocaleString(undefined, { style: "currency", currency: "USD" })}; highest is ${Math.max(
                ...results.map((r) => r.liabilityUSD)
              ).toLocaleString(undefined, { style: "currency", currency: "USD" })}.`}
            >
              <div className="zenin-eyebrow">Liability by jurisdiction (USD)</div>
              {(() => {
                const maxLiability = Math.max(...results.map((r) => r.liabilityUSD), 1);
                return results.map((row) => {
                  const pct = (row.liabilityUSD / maxLiability) * 100;
                  return (
                    <div key={row.jurisdictionKey} className="tax-workbench-liability-row">
                      <span className="tax-workbench-liability-label">
                        {countryFlag(row.jurisdictionKey)} {row.jurisdiction}
                      </span>
                      <span className="tax-workbench-liability-track" aria-hidden="true">
                        <i style={{ width: `${Math.max(2, pct).toFixed(2)}%` }} />
                      </span>
                      <strong className="tax-workbench-liability-value">{formatMoney(row.liabilityUSD, "USD")}</strong>
                    </div>
                  );
                });
              })()}
            </div>
          ) : null}
        </>
      ) : (
        <GuidedEmptyState
          eyebrow="Decision workflow"
          title="No liabilities calculated yet"
          description="Review the ledger and jurisdiction inputs, then run the primary calculation to generate jurisdiction outputs."
          steps={[
            "Confirm the jurisdictions and gains ledger reflect the scenario you want to test.",
            "Use the Decision Inspector action once the validation state is ready.",
          ]}
          tone="subtle"
          className="tax-guided-empty"
        />
      )}
    </section>
  );
}
