// MacroCountrySelector — 🌍 country picker for the macro desk toolbar.
// Lists supported countries from Coverage Registry; unavailable = disabled + "Coming Soon".
// Reads/writes the single source of truth via useMacroCountry().

import React from "react";
import { useMacroCountry } from "./MacroCountryContext";
import { SUPPORTED_COUNTRIES, getCountryCoverage, tierMeta } from "./MacroCoverageRegistry";

export function MacroCountrySelector() {
  const { selectedCountry, setSelectedCountry, coverage } = useMacroCountry();
  const [open, setOpen] = React.useState(false);

  const list = SUPPORTED_COUNTRIES.map((code) => getCountryCoverage(code));

  return (
    <div className="macro-country-selector" style={{ position: "relative" }}>
      <button
        type="button"
        className="analytics-chip-button macro-country-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Select country"
      >
        <span aria-hidden>🌍</span>
        <span>Country</span>
        <strong>{coverage.flag} {coverage.name}</strong>
        <span className={`macro-coverage-dot ${tierMeta(coverage.tier).token}`} aria-hidden />
      </button>

      {open ? (
        <div className="macro-country-menu" role="listbox">
          {list.map((c) => {
            const tier = tierMeta(c.tier);
            const disabled = !c.available;
            return (
              <button
                key={c.code}
                type="button"
                role="option"
                aria-selected={c.code === selectedCountry}
                disabled={disabled}
                className={`macro-country-option ${c.code === selectedCountry ? "active" : ""} ${disabled ? "coming-soon" : ""}`}
                onClick={() => {
                  if (disabled) return;
                  setSelectedCountry(c.code);
                  setOpen(false);
                }}
              >
                <span className="macro-country-flag">{c.flag}</span>
                <span className="macro-country-name">{c.name}</span>
                <span className={`macro-coverage-badge ${tier.token}`}>{disabled ? "Coming Soon" : tier.label}</span>
                {!disabled ? <span className="macro-coverage-count">{c.indicators} indicators</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default MacroCountrySelector;
