// MacroCountryContext — single source of truth for the selected macro country.
// One state, one source. Every macro panel reads from here. No duplicated country state.
// Selection + per-country watchlist pins persist via workspacePersistence.

import React, { createContext, useContext, useMemo, useState, useEffect, useCallback } from "react";
import { getCountryCoverage, isCountryAvailable } from "./MacroCoverageRegistry";
import { DEFAULT_WATCH_PINS } from "./MacroIndicatorRegistry";
import { loadWorkspaceCollection, saveWorkspaceCollection } from "../../utils/workspacePersistence";

const MacroCountryContext = createContext(null);

const SELECTED_KEY = "macro:selectedCountry";
const PINS_KEY = "macro:watchPinsByCountry";

function readSelected() {
  try {
    const v = loadWorkspaceCollection(SELECTED_KEY);
    return v && typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

function readPins() {
  try {
    const v = loadWorkspaceCollection(PINS_KEY);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function MacroCountryProvider({ children, defaultCountry = "USA" }) {
  const [selectedCountry, setSelectedCountryState] = useState(() => {
    const saved = readSelected();
    return saved && isCountryAvailable(saved) ? saved : defaultCountry;
  });
  const [pinsByCountry, setPinsByCountry] = useState(() => readPins());

  const coverage = useMemo(() => getCountryCoverage(selectedCountry), [selectedCountry]);
  const countryName = coverage.name;
  const available = coverage.available;

  const setSelectedCountry = useCallback(
    (code) => {
      if (!code || !isCountryAvailable(code)) return; // never fake / never select unavailable
      setSelectedCountryState(code);
      try {
        saveWorkspaceCollection(SELECTED_KEY, code);
      } catch {
        /* ignore persistence failure */
      }
    },
    []
  );

  const watchPins = useMemo(() => pinsByCountry[selectedCountry] || DEFAULT_WATCH_PINS, [pinsByCountry, selectedCountry]);

  const setWatchPins = useCallback(
    (codes) => {
      setPinsByCountry((prev) => {
        const next = { ...prev, [selectedCountry]: codes };
        try {
          saveWorkspaceCollection(PINS_KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [selectedCountry]
  );

  const toggleWatchPin = useCallback(
    (code) => {
      setPinsByCountry((prev) => {
        const current = prev[selectedCountry] || DEFAULT_WATCH_PINS;
        const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code];
        const updated = { ...prev, [selectedCountry]: next };
        try {
          saveWorkspaceCollection(PINS_KEY, updated);
        } catch {
          /* ignore */
        }
        return updated;
      });
    },
    [selectedCountry]
  );

  const value = useMemo(
    () => ({
      selectedCountry,
      setSelectedCountry,
      countryName,
      coverage,
      available,
      watchPins,
      setWatchPins,
      toggleWatchPin,
    }),
    [selectedCountry, countryName, coverage, available, watchPins, setSelectedCountry, setWatchPins, toggleWatchPin]
  );

  return <MacroCountryContext.Provider value={value}>{children}</MacroCountryContext.Provider>;
}

export function useMacroCountry() {
  const ctx = useContext(MacroCountryContext);
  if (!ctx) throw new Error("useMacroCountry must be used within MacroCountryProvider");
  return ctx;
}

export default MacroCountryProvider;
