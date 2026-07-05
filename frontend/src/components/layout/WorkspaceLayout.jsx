import { Children, cloneElement, isValidElement } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery.js";

/**
 * WorkspaceLayout - Full workspace layout for data-intensive modules
 * 
 * Expands to use available workspace width. Optimized for:
 * - Portfolio
 * - Watchlist
 * - Decisions
 * - Journal
 * - Research Dashboard
 * - Analytics
 * 
 * @param {Object} props
 * @param {string} props.mode - Workspace mode: 'compact' | 'standard' | 'professional' | 'analyst' | 'ultrawide'
 * @param {string} props.density - Density mode: 'comfortable' | 'compact' | 'terminal'
 * @param {boolean} props.contextPanel - Show context panel on right
 * @param {React.ReactNode} props.children
 */
export function WorkspaceLayout({ 
  mode = "standard", 
  density = "comfortable",
  contextPanel = false,
  children 
}) {
  const isProfessional = useMediaQuery("(min-width: 1600px)");
  const isAnalyst = useMediaQuery("(min-width: 1920px)");
  const isUltrawide = useMediaQuery("(min-width: 2560px)");

  // Auto-detect mode if not explicitly provided
  const workspaceMode = mode || (isUltrawide ? "ultrawide" : isAnalyst ? "analyst" : isProfessional ? "professional" : "standard");

  const layoutClasses = [
    "workspace-layout",
    `workspace-mode-${workspaceMode}`,
    `density-${density}`,
    contextPanel ? "with-context-panel" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={layoutClasses}>
      {Children.map(children, (child) => {
        if (isValidElement(child)) {
          return cloneElement(child, { workspaceMode, density });
        }
        return child;
      })}
    </div>
  );
}

/**
 * WorkspaceMain - Main content area in WorkspaceLayout
 */
export function WorkspaceMain({ children, workspaceMode, density }) {
  return (
    <main className="workspace-main">
      {children}
    </main>
  );
}

/**
 * WorkspaceContext - Context panel for workspace layouts
 * 
 * Displays module-specific context information:
 * - Portfolio: Holdings, exposure, risk, earnings
 * - Research: Portfolio exposure, analyst revisions, related holdings
 * - Journal: Historical decisions, rule adherence, coaching
 * - Analytics: Performance attribution, factor exposure
 */
export function WorkspaceContext({ children, workspaceMode }) {
  if (!children) return null;
  
  return (
    <aside className="workspace-context">
      {children}
    </aside>
  );
}
