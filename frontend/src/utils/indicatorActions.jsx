// Indicator Actions — context delivery for the Indicator Metric Modal.
//
// The modal is a PURE LAUNCHER (mirrors AssetModal): it emits callbacks and
// owns zero action logic. App builds the real handlers (watchlist, compare,
// transmission, routing, local pin/alert/export, ledger/exposure navigation)
// and supplies them here. The modal reads context as a fallback when a caller
// does not pass the prop directly, so no button is ever dead.
//
// Brand v2: no fabricated state. Handlers that have no backend yet persist
// locally (localStorage) and confirm via toast — never a fake success.

import React, { createContext, useContext } from "react";

const IndicatorActionsContext = createContext(null);

export function IndicatorActionsProvider({ value, children }) {
  return (
    <IndicatorActionsContext.Provider value={value || null}>
      {children}
    </IndicatorActionsContext.Provider>
  );
}

/** Raw context (may be null). */
export function useIndicatorActionsContext() {
  return useContext(IndicatorActionsContext);
}

/**
 * Resolve the action set for the modal: explicit props win, context supplies
 * the rest. Returns a stable object of handlers (all may be undefined → the
 * modal disables the corresponding control rather than faking behavior).
 */
export function useIndicatorActions(props = {}) {
  const ctx = useContext(IndicatorActionsContext);
  // Props win over context, but only when explicitly provided (not undefined).
  // This lets the modal act as a pure launcher that relies on context while
  // still allowing a caller to override a specific handler via prop.
  const src = { ...ctx };
  if (props) {
    for (const k of Object.keys(props)) {
      if (props[k] !== undefined) src[k] = props[k];
    }
  }
  return {
    isInWatchlist: src.isInWatchlist,
    onToggleStar: src.onToggleStar,
    onCompare: src.onCompare,
    onOpenResearch: src.onOpenResearch,
    onOpenProfile: src.onOpenProfile,
    onOpenTransmission: src.onOpenTransmission,
    onPin: src.onPin,
    isPinned: src.isPinned,
    onAlert: src.onAlert,
    onExport: src.onExport,
    onCopyLink: src.onCopyLink,
    onDecisionLedger: src.onDecisionLedger,
    onExposure: src.onExposure,
    onSelectIndicator: src.onSelectIndicator,
    onJournal: src.onJournal,
    onScenario: src.onScenario,
    onMacroWorkspace: src.onMacroWorkspace,
  };
}
