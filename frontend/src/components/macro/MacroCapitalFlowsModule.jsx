// Phase 3 — Capital Flows.
// Current account, FDI inflow, portfolio inflow. Resolves via World Bank where
// available; honest Unavailable otherwise.
import React from "react";
import { MacroThemeModule } from "./MacroThemeModule.jsx";

export function MacroCapitalFlowsModule({ countryCode = "USA", baseUrl = "", regimeLabel = null, regimeTone = "neutral" }) {
  return (
    <MacroThemeModule
      title="Capital Flows"
      subtitle="Current account, FDI, portfolio flows."
      taxonomy="capitalFlows"
      provider="WORLDBANK"
      countryCode={countryCode}
      baseUrl={baseUrl}
      regimeLabel={regimeLabel}
      regimeTone={regimeTone}
      higherIsBullish={true}
    />
  );
}
export default MacroCapitalFlowsModule;
