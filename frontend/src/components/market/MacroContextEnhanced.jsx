// MacroContextEnhanced — Enhanced Macro Context panel (spec §9).
//
// Upgrades the existing Macro Context panel. The base indicator table stays
// (country-level macro indicators from the backend feed). This component adds
// the regime intelligence layer sourced from the IntelligenceBus:
//   • Current Regime / Previous Regime (tracked locally as regime changes)
//   • Confidence
//   • Growth / Inflation / Rates / Liquidity / Credit / Dollar / Risk Appetite
//     — derived from the published regime label via the bus's sector/commodity
//     mapping (regime-driven, not fabricated point estimates)
//   • Transmission (regime drivers → affected assets)
//   • Open Macro Desk
//
// Honest fallbacks: when no regime has been published, every field shows "—"
// and the panel explains the desk must publish first.

import React, { useEffect, useRef, useState } from "react";
import { getRegime, subscribeRegime, affectedSectors, affectedCommodities } from "../../utils/intelligenceBus";

// Regime → qualitative macro factor tilt (direction only, not a fabricated number).
const FACTOR_TILT = {
  expansion: { growth: "up", inflation: "up", rates: "up", liquidity: "up", credit: "up", dollar: "flat", risk: "up" },
  recovery: { growth: "up", inflation: "flat", rates: "up", liquidity: "up", credit: "up", dollar: "flat", risk: "up" },
  goldilocks: { growth: "up", inflation: "flat", rates: "flat", liquidity: "up", credit: "up", dollar: "flat", risk: "up" },
  inflationary: { growth: "up", inflation: "up", rates: "up", liquidity: "down", credit: "down", dollar: "up", risk: "down" },
  stagflation: { growth: "down", inflation: "up", rates: "up", liquidity: "down", credit: "down", dollar: "up", risk: "down" },
  slowdown: { growth: "down", inflation: "flat", rates: "flat", liquidity: "down", credit: "flat", dollar: "up", risk: "down" },
  contraction: { growth: "down", inflation: "down", rates: "down", liquidity: "down", credit: "down", dollar: "up", risk: "down" },
  recession: { growth: "down", inflation: "down", rates: "down", liquidity: "down", credit: "down", dollar: "up", risk: "down" },
  "risk-off": { growth: "down", inflation: "flat", rates: "down", liquidity: "down", credit: "down", dollar: "up", risk: "down" },
};

const FACTOR_LABELS = {
  growth: "Growth", inflation: "Inflation", rates: "Rates", liquidity: "Liquidity",
  credit: "Credit", dollar: "Dollar", risk: "Risk Appetite",
};

export default function MacroContextEnhanced({ macroData = [], onOpenMacroDesk }) {
  const [regime, setRegime] = useState(() => getRegime());
  const prevRef = useRef(null);

  useEffect(() => {
    let active = true;
    const unsub = subscribeRegime((state) => {
      if (!active) return;
      setRegime(state.regime);
    });
    return () => { active = false; unsub(); };
  }, []);

  // Track previous regime label as it changes.
  const currentLabel = regime?.label || null;
  const prevLabel = prevRef.current;
  useEffect(() => {
    if (currentLabel && currentLabel !== prevRef.current) {
      prevRef.current = currentLabel;
    }
  }, [currentLabel]);

  const tilt = (regime?.label && FACTOR_TILT[String(regime.label).toLowerCase()]) || null;
  const sectors = regime?.label ? affectedSectors(regime.label) : [];
  const commodities = regime?.label ? affectedCommodities(regime.label) : [];

  return (
    <div className="macro-ctx-enhanced">
      <div className="macro-ctx-regime">
        <div className="macro-ctx-regime-head">
          <span className="macro-ctx-label">Current Regime</span>
          <strong className={`macro-ctx-regime-value ${regime?.tone || "neutral"}`}>{regime?.label || "—"}</strong>
          {typeof regime?.confidence === "number" ? (
            <span className="macro-ctx-confidence">Conf {regime.confidence}%</span>
          ) : null}
        </div>
        <div className="macro-ctx-regime-sub">
          <span>Previous: <em>{prevLabel || "—"}</em></span>
          {regime?.explain ? <span className="macro-ctx-explain">{regime.explain}</span> : null}
        </div>
      </div>

      <div className="macro-ctx-factors">
        {Object.keys(FACTOR_LABELS).map((k) => {
          const dir = tilt?.[k] || "flat";
          return (
            <div key={k} className={`macro-ctx-factor factor-${dir}`}>
              <span>{FACTOR_LABELS[k]}</span>
              <strong>{dir === "up" ? "▲" : dir === "down" ? "▼" : "—"}</strong>
            </div>
          );
        })}
      </div>

      {sectors.length || commodities.length ? (
        <div className="macro-ctx-transmission">
          <span className="macro-ctx-label">Transmission</span>
          <div className="macro-ctx-tags">
            {sectors.map((s) => <span key={`s-${s.label}`} className="gp-tag gp-tag-static">{s.label} {s.direction === "down" ? "↓" : "↑"}</span>)}
            {commodities.map((c) => <span key={`c-${c.group}`} className="gp-tag gp-tag-static">{c.group} {c.direction === "down" ? "↓" : "↑"}</span>)}
          </div>
        </div>
      ) : null}

      <div className="macro-ctx-actions">
        <button type="button" className="market-signal-btn" onClick={() => onOpenMacroDesk?.()}>Open Macro Desk</button>
      </div>
    </div>
  );
}
