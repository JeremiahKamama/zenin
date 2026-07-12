// =============================================================================
// PortfolioIntelligenceRail — feature shell wrapping IntelligenceRail
// -----------------------------------------------------------------------------
// Thin wrapper that owns the "independently refreshable" contract for the right
// rail: it tracks its own refresh token/state and calls back into the parent
// (App-level refresh) without forcing the main workspace to re-render.
//
// `alertContext` is memoized by the parent; `refreshToken` changes trigger a
// fresh AlertEngine pass (AlertEngine is pure, so this is cheap).
// =============================================================================

import { memo, useCallback, useState } from "react";
import { IntelligenceRail } from "./modules/IntelligenceRail";

function PortfolioIntelligenceRailImpl({ alertContext = {}, onRefreshAlerts, refreshing = false }) {
  const [lastUpdated, setLastUpdated] = useState(() => "just now");

  const handleRefresh = useCallback(() => {
    if (!onRefreshAlerts) return;
    onRefreshAlerts();
    setLastUpdated("just now");
  }, [onRefreshAlerts]);

  return (
    <IntelligenceRail
      context={alertContext}
      refreshing={refreshing}
      onRefresh={onRefreshAlerts ? handleRefresh : null}
      lastUpdated={lastUpdated}
    />
  );
}

export const PortfolioIntelligenceRail = memo(PortfolioIntelligenceRailImpl);
export default PortfolioIntelligenceRail;
