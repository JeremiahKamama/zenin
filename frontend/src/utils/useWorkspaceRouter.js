// useWorkspaceRouter — metadata-driven workspace routing (spec §7, §8).
//
// Every intelligence object carries a `navigation` object:
//   { workspace, panel, tab, entity, filters, action }
// and an `action` in { research, workspace, asset, company, transmission,
//   copy, pin, alert, scenario }.
//
// This hook returns openWorkspace(nav) that routes purely from the metadata,
// with NO switch/if-else on workspace kind. The mapping is declarative:
// each action resolves to a handler key, and the handler key looks up the
// callback passed in from the host page (HomeModule). When a specific opener
// (e.g. commodity/crypto workspace) is not wired into the host, it degrades
// gracefully to the closest available handler (onOpenAnalytics / onSelectAsset)
// — never throws, never fabricates a route.
//
// Honest degradation: only the handlers the host provides are used.

import { useCallback } from "react";

// action -> which host handler to invoke, and how to build its argument.
// This table is the single source of routing truth (no per-desk branching).
const ACTION_MAP = {
  research: { handler: "onOpenResearch", arg: (n) => (n.entity ? { symbol: n.entity } : null) },
  workspace: { handler: "onOpenAnalytics", arg: () => null },
  asset: { handler: "onSelectAsset", arg: (n) => n.entity },
  company: { handler: "onSelectAsset", arg: (n) => n.entity },
  transmission: { handler: "onOpenAnalytics", arg: () => null },
  copy: { handler: "onCopyLink", arg: (n) => n },
  pin: { handler: "onPin", arg: (n) => n },
  alert: { handler: "onAlert", arg: (n) => n },
  scenario: { handler: "onScenario", arg: (n) => n },
  // Explicit fallbacks if a handler is missing:
  _fallback: { handler: "onOpenAnalytics", arg: () => null },
};

export function useWorkspaceRouter(handlers = {}) {
  return useCallback(
    (nav) => {
      if (!nav || typeof nav !== "object") return;
      const action = nav.action || "workspace";
      const spec = ACTION_MAP[action] || ACTION_MAP._fallback;
      const fn = handlers[spec.handler];
      if (typeof fn !== "function") {
        // Graceful degrade: try the analytics opener, then select-asset, then nothing.
        if (typeof handlers.onOpenAnalytics === "function") handlers.onOpenAnalytics(nav.workspace);
        else if (nav.entity && typeof handlers.onSelectAsset === "function") handlers.onSelectAsset(nav.entity);
        return;
      }
      fn(spec.arg(nav));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(Object.keys(handlers))]
  );
}
