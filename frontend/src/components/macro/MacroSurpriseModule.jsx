// Phase 3 — Economic Surprise.
// Economic surprise index. No backend feed yet → honest Unavailable.
import React from "react";
import { MacroThemeModule } from "./MacroThemeModule.jsx";

export function MacroSurpriseModule({ countryCode = "USA", baseUrl = "", regimeLabel = null, regimeTone = "neutral" }) {
  return (
    <MacroThemeModule
      title="Economic Surprise"
      subtitle="Citigroup-style surprise index vs consensus."
      taxonomy="surprise"
      provider="WORLDBANK"
      countryCode={countryCode}
      baseUrl={baseUrl}
      regimeLabel={regimeLabel}
      regimeTone={regimeTone}
      higherIsBullish={true}
    />
  );
}
export default MacroSurpriseModule;
