// Phase 3 — Global Trade Intelligence.
// Trade balance, exports, imports, current account. Resolves via World Bank
// (CURRENT_ACCOUNT) when the backend serves it; honest Unavailable otherwise.
import React from "react";
import { MacroThemeModule } from "./MacroThemeModule.jsx";

export function MacroGlobalTradeModule({ countryCode = "USA", baseUrl = "", regimeLabel = null, regimeTone = "neutral" }) {
  return (
    <MacroThemeModule
      title="Global Trade"
      subtitle="Trade balance, exports, imports, current account."
      taxonomy="trade"
      provider="WORLDBANK"
      countryCode={countryCode}
      baseUrl={baseUrl}
      regimeLabel={regimeLabel}
      regimeTone={regimeTone}
      higherIsBullish={true}
    />
  );
}
export default MacroGlobalTradeModule;
