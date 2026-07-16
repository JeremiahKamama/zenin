// Phase 3 — Credit Conditions.
// IG / HY spreads, credit/GDP. No backend credit-spread feed yet → honest
// Unavailable (never fabricated spreads).
import React from "react";
import { MacroThemeModule } from "./MacroThemeModule.jsx";

export function MacroCreditModule({ countryCode = "USA", baseUrl = "", regimeLabel = null, regimeTone = "neutral" }) {
  return (
    <MacroThemeModule
      title="Credit Conditions"
      subtitle="IG / HY spreads, credit-to-GDP."
      taxonomy="credit"
      provider="FRED"
      countryCode={countryCode}
      baseUrl={baseUrl}
      regimeLabel={regimeLabel}
      regimeTone={regimeTone}
      higherIsBullish={false}
    />
  );
}
export default MacroCreditModule;
