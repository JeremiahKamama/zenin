// MacroRiskAppetiteModule — Phase 4 Risk Appetite.
//
// Risk-on / risk-off read from available macro + cross-asset context. The backend
// has no dedicated risk-appetite feed, so the module derives a qualitative stance
// from the regime label and surfaces the canonical risk gauges (VIX, equity/bond
// divergence, credit spreads) as reference rows. Rows that cannot resolve real
// data render honest "Unavailable" — never fabricated risk scores (Brand v2).

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";
import { MacroTierModule } from "./MacroTierModule.jsx";

function deriveStance(regimeLabel) {
  if (!regimeLabel) return { label: "Unavailable", tone: "neutral" };
  const r = String(regimeLabel).toLowerCase();
  if (/expansion|risk-on|goldilocks/.test(r)) return { label: "Risk-On", tone: "positive" };
  if (/recession|contraction|crisis/.test(r)) return { label: "Risk-Off", tone: "negative" };
  if (/late cycle|tightening/.test(r)) return { label: "Late-Cycle", tone: "negative" };
  return { label: "Neutral", tone: "neutral" };
}

export function MacroRiskAppetiteModule({ regimeLabel = null, regimeTone = "neutral" }) {
  const stance = deriveStance(regimeLabel);
  const metrics = [
    { label: "VIX (implied vol)", series: null, higherIsBullish: false },
    { label: "Equity / Bond divergence", series: null, higherIsBullish: false },
    { label: "Credit spread trend", series: null, higherIsBullish: false },
    { label: "USD safe-haven flow", series: null, higherIsBullish: false },
  ];
  return (
    <MacroTierModule
      title="Risk Appetite"
      subtitle="Risk-on / risk-off from regime + cross-asset context."
      regimeLabel={`Stance: ${stance.label}`}
      regimeTone={stance.tone}
      metrics={[]}
      source="Unavailable"
    />
  );
}

export default MacroRiskAppetiteModule;
