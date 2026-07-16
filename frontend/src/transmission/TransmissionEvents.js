// TransmissionEvents — tiny decoupled pub/sub.
// Workspaces publish signals; subscribers react without prop-drilling.
// No React dependency (usable from anywhere).

const listeners = new Map(); // event -> Set<fn>

export function subscribe(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => unsubscribe(event, fn);
}

export function unsubscribe(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch (e) { /* isolate listener failures */ }
  }
}

// Semantic events used across the platform.
export const TX_EVENTS = {
  PUBLISH_SIGNALS: "transmission:publish-signals",
  OPEN_EXPLORER: "transmission:open-explorer",
  CHAIN_UPDATED: "transmission:chain-updated",
};
