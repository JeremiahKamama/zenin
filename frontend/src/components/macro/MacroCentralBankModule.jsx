// MacroCentralBankModule — Phase 2 Central Bank Monitor.
//
// Compact, reference-only panel: current rate, next meeting, last decision, market
// pricing, bias for the major central banks (Fed, ECB, BoE, BoJ, PBOC, SNB, RBA,
// BoC). The backend has no central-bank endpoint yet, so rows render honest
// "Unavailable" — never fabricated policy intelligence (Brand v2 / no fake data).
//
// Structure and labels are real; when a central-bank adapter lands, each row
// populates from CountryRegistry-style metadata without UI changes.

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";

// Reference metadata only (names/schedule cadence) — NOT market intelligence.
const CENTRAL_BANKS = [
  { id: "FED", name: "Fed", scope: "USA", meets: "≈8/yr" },
  { id: "ECB", name: "ECB", scope: "Eurozone", meets: "≈8/yr" },
  { id: "BOE", name: "BoE", scope: "United Kingdom", meets: "≈8/yr" },
  { id: "BOJ", name: "BoJ", scope: "Japan", meets: "≈8/yr" },
  { id: "PBOC", name: "PBOC", scope: "China", meets: "As needed" },
  { id: "SNB", name: "SNB", scope: "Switzerland", meets: "≈4/yr" },
  { id: "RBA", name: "RBA", scope: "Australia", meets: "≈11/yr" },
  { id: "BOC", name: "BoC", scope: "Canada", meets: "≈8/yr" },
];

function BankRow({ bank }) {
  return (
    <div className="macro-cb-row" role="row">
      <span className="macro-cb-name">{bank.name}</span>
      <span className="macro-cb-rate">—</span>
      <span className="macro-cb-next">Next {bank.meets}</span>
      <StatusPill tone="neutral">Unavailable</StatusPill>
    </div>
  );
}

export function MacroCentralBankModule() {
  return (
    <section className="analytics-card macro-cb-module" aria-label="Central Bank Monitor">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">Central Bank Monitor</div>
          <div className="analytics-card-subtitle">Current rate · next meeting · last decision · bias.</div>
        </div>
        <div className="analytics-pill-group">
          <StatusPill tone="neutral">No feed</StatusPill>
        </div>
      </div>
      <div className="macro-cb-grid">
        {CENTRAL_BANKS.map((bank) => (
          <BankRow key={bank.id} bank={bank} />
        ))}
      </div>
    </section>
  );
}

export default MacroCentralBankModule;
