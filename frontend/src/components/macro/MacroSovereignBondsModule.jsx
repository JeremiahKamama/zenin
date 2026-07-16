// Phase 3 — Sovereign Bonds.
// 10Y sovereign yield, spread vs US. No backend bond-yield feed yet → honest
// Unavailable (never fabricated yields). Structure ready for a FRED/ECB adapter.
import React from "react";
import { MacroThemeModule } from "./MacroThemeModule.jsx";

export function MacroSovereignBondsModule({ countryCode = "USA", baseUrl = "", regimeLabel = null, regimeTone = "neutral" }) {
  return (
    <MacroThemeModule
      title="Sovereign Bonds"
      subtitle="10Y sovereign yield, spread vs US."
      taxonomy="bonds"
      provider="FRED"
      countryCode={countryCode}
      baseUrl={baseUrl}
      regimeLabel={regimeLabel}
      regimeTone={regimeTone}
      higherIsBullish={false}
    />
  );
}
export default MacroSovereignBondsModule;
