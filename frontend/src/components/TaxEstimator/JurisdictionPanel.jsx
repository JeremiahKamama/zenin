import React from "react";
import { DensePanelHeader } from "../CompactWorkspaceUI";
import { countryFlag } from "./lib/taxConfig";

export default function JurisdictionPanel({
  taxRules,
  filteredJurisdictions,
  jurisdictions,
  activeRegion,
  taxRegions,
  jurisdictionSearch,
  detectedCountry,
  accountantCopy,
  onToggleJurisdiction,
  onRegionChange,
  onSearchChange,
}) {
  return (
    <section className="tax-workbench-panel tax-workbench-jurisdiction-panel">
      <DensePanelHeader title={accountantCopy.jurisdictionTitle} subtitle="Select every jurisdiction to model." />

      <div className="tax-workbench-jurisdiction-status">
        <input
          type="search"
          className="tax-workbench-jurisdiction-search-input"
          placeholder="Search jurisdictions"
          value={jurisdictionSearch}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search jurisdictions"
        />
        <div className="tax-workbench-region-filter" role="group" aria-label="Filter by region">
          <button
            type="button"
            className={`tax-workbench-pill ${activeRegion === "All" ? "is-active" : ""}`.trim()}
            onClick={() => onRegionChange("All")}
          >
            All
          </button>
          {taxRegions.map((region) => (
            <button
              type="button"
              key={region}
              className={`tax-workbench-pill ${activeRegion === region ? "is-active" : ""}`.trim()}
              onClick={() => onRegionChange(region)}
            >
              {region}
            </button>
          ))}
        </div>
      </div>

      <div className="tax-workbench-jurisdiction-list" role="group" aria-label="Available jurisdictions">
        {filteredJurisdictions.length === 0 ? (
          <p className="tax-workbench-empty">No jurisdictions match your filter.</p>
        ) : (
          filteredJurisdictions.map(([key, info]) => {
            const isSelected = jurisdictions.includes(key);
            return (
              <label key={key} className="tax-workbench-jurisdiction-card">
                <div className="tax-workbench-jurisdiction-main">
                  <span aria-hidden="true">{countryFlag(key)}</span>
                  <div className="tax-workbench-jurisdiction-copy">
                    <strong>{info.name || key}</strong>
                    <span>
                      {info.region || "—"} · {info.currency || "USD"}
                      {key === detectedCountry ? " · Detected" : ""}
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleJurisdiction(key)}
                  aria-label={`Include ${info.name || key}`}
                />
              </label>
            );
          })
        )}
      </div>

      {jurisdictions.length > 0 ? (
        <div className="tax-workbench-selected-inline" aria-label="Selected jurisdictions">
          {jurisdictions.map((key) => (
            <button
              key={key}
              type="button"
              className="tax-workbench-selected-chip"
              onClick={() => onToggleJurisdiction(key)}
              aria-label={`Remove ${taxRules[key]?.name || key}`}
            >
              <span aria-hidden="true">{countryFlag(key)}</span>
              <strong>{taxRules[key]?.name || key}</strong>
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
