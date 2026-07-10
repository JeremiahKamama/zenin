// Shared presentational primitives for the Tax Estimator workspace.
import React, { useEffect, useRef, useState } from "react";
import { countryFlag, jurisdictionDisplayName } from "./taxConfig";

export function JurisdictionCombobox({ rules, value, onChange, label = "Jurisdiction" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const selected = rules[value] || {};

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(rules)
      .filter(([key, info]) => !q || (info.name || key).toLowerCase().includes(q) || key.toLowerCase().includes(q))
      .slice(0, 12);
  }, [rules, query]);

  const choose = (key) => {
    onChange(key);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="tax-jurisdiction-combobox" ref={wrapRef}>
      <span>{label}</span>
      <button
        type="button"
        className="tax-jurisdiction-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span aria-hidden="true">{countryFlag(value)}</span>
        <strong>{jurisdictionDisplayName(value, selected)}</strong>
        <span className="tax-jurisdiction-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div className="tax-jurisdiction-popover" role="listbox">
          <input
            type="search"
            autoFocus
            autoComplete="off"
            className="tax-jurisdiction-search"
            placeholder="Search country or code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="tax-jurisdiction-options">
            {matches.length === 0 ? (
              <li className="tax-jurisdiction-empty">No jurisdictions match “{query}”</li>
            ) : (
              matches.map(([key, info]) => (
                <li key={key} role="option" aria-selected={key === value}>
                  <button type="button" onClick={() => choose(key)}>
                    <span aria-hidden="true">{countryFlag(key)}</span>
                    <span>{info.name || key}</span>
                    <em>{info.region || ""}</em>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function TaxField({ label, children, className = "", invalid = false, message = "", tone = "default" }) {
  const describedById = `taxfield-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const child = React.isValidElement(children)
    ? React.cloneElement(children, {
        "aria-invalid": invalid || undefined,
        "aria-describedby": message ? describedById : undefined,
      })
    : children;
  return (
    <label
      className={`tax-workbench-field ${className} ${invalid ? "has-error" : ""} ${tone === "warning" ? "has-warning" : ""}`.trim()}
    >
      <span>{label}</span>
      {child}
      {message ? (
        <span id={describedById} className={`tax-workbench-inline-message ${tone}`.trim()}>
          {message}
        </span>
      ) : null}
    </label>
  );
}

export function LedgerInput({ label, value, onChange, disabled = false, tone = "", invalid = false, message = "" }) {
  const describedById = `ledger-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <label className={`tax-workbench-ledger-input ${tone} ${invalid ? "is-invalid" : ""}`.trim()}>
      <span className="sr-only">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={Number.isFinite(Number(value)) ? String(value) : ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={message ? describedById : undefined}
        spellCheck={false}
      />
      {message ? (
        <span id={describedById} className="tax-workbench-inline-message">
          {message}
        </span>
      ) : null}
    </label>
  );
}
