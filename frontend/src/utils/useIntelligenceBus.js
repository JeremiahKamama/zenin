// useIntelligenceBus — React hook to subscribe Market Context to the
// IntelligenceBus event log (spec §17). The page becomes a subscriber: it never
// fetches intelligence itself, it consumes what desks already publish
// (macro regime, commodity, portfolio, watchlist, decision, transmission).
// This avoids any duplicate polling — the macro desk's publishRegime() is the
// single source that also appends a translated `macro` event to the log.
//
// No fabrication: the log is empty until a source publishes, and the hook
// replays the current log immediately so first paint is honest.

import { useEffect, useState } from "react";
import { subscribeEvents, getEvents } from "./intelligenceBus";

/**
 * Subscribe to the IntelligenceBus event log.
 * @param {object} [opts]
 * @param {string} [opts.context] optional context filter (e.g. "macro").
 * @param {number} [opts.limit] max events to keep.
 * @returns {Array} normalized intelligence events (newest first).
 */
export function useIntelligenceBusEvents(opts = {}) {
  const { context, limit = 40 } = opts;
  const [events, setEvents] = useState(() => {
    const all = getEvents();
    return filterEvents(all, context).slice(0, limit);
  });

  useEffect(() => {
    let active = true;
    const unsub = subscribeEvents((all) => {
      if (!active) return;
      setEvents(filterEvents(all, context).slice(0, limit));
    });
    return () => { active = false; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, limit]);

  return events;
}

function filterEvents(all, context) {
  if (!context) return all;
  return all.filter((e) => (e.contexts || [e.type]).includes(context));
}

export default useIntelligenceBusEvents;
