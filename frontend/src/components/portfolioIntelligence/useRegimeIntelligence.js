// useRegimeIntelligence (Phase 3 / Phase 4 consumer)
//
// Subscribes a component to the IntelligenceBus regime state. Re-renders only
// when the regime signal changes (event-driven fan-out from the Macro desk).
// Returns { regime, macroSignal, updatedAt, freshness } — nulls until the bus
// has published (honest empty state, no fabrication).

import { useEffect, useState } from "react";
import { subscribeRegime, getRegime, getMacroSignal } from "../../utils/intelligenceBus";
import { freshnessFrom } from "../../utils/deskIntelligence";

export function useRegimeIntelligence() {
  const [state, setState] = useState(() => ({
    regime: getRegime(),
    macroSignal: getMacroSignal(),
    updatedAt: null,
  }));

  useEffect(() => {
    const unsub = subscribeRegime((s) => {
      setState({ regime: s.regime, macroSignal: s.macroSignal, updatedAt: s.updatedAt });
    });
    return unsub;
  }, []);

  const freshness = state.updatedAt ? freshnessFrom(state.updatedAt) : null;
  return { ...state, freshness };
}

export default useRegimeIntelligence;
