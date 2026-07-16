// TransmissionExplorerProvider — mounts ONE reusable Explorer drawer for the whole app.
// Every workspace calls useTransmissionExplorer().open(node); never duplicated, never navigates.
// Brand v2: monochrome, right-side drawer (reuses RightRailDrawer).

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { RightRailDrawer } from "../components/CompactWorkspaceUI";
import { TransmissionExplorerContent } from "./TransmissionExplorer.jsx";
import { TX_EVENTS, subscribe } from "./TransmissionEvents";

const Ctx = createContext(null);

export function TransmissionExplorerProvider({ children, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState(null);
  const [context, setContext] = useState({});

  const openExplorer = useCallback((n, ctx = {}) => {
    setNode(n);
    setContext(ctx || {});
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Real navigation resolver (passed by App): maps {type,label} → SPA route.
  // Falls back to just closing when no resolver is supplied (graceful degrade).
  const resolveNavigate = useCallback((target) => {
    if (onNavigate) onNavigate(target);
    else setOpen(false);
  }, [onNavigate]);

  // Allow any module to open the Explorer via the shared event bus.
  useEffect(() => subscribe(TX_EVENTS.OPEN_EXPLORER, ({ node: n, context: c }) => openExplorer(n, c)), [openExplorer]);

  return (
    <Ctx.Provider value={{ openExplorer, close, isOpen: open }}>
      {children}
      <RightRailDrawer
        open={open}
        onClose={close}
        title="Transmission Explorer"
        subtitle={node ? `Active chain from ${node}` : "Shared intelligence"}
        className="transmission-explorer-drawer"
      >
        {open && node ? <TransmissionExplorerContent rootNode={node} context={context} onNavigate={resolveNavigate} /> : null}
      </RightRailDrawer>
    </Ctx.Provider>
  );
}

export function useTransmissionExplorer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTransmissionExplorer must be used within TransmissionExplorerProvider");
  return ctx;
}
