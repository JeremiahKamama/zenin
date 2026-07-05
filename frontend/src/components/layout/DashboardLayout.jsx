import { Children, cloneElement, isValidElement } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";

/**
 * DashboardLayout - Expandable grid layout for dashboards
 * 
 * Optimized for:
 * - Home
 * - Portfolio Overview
 * - Market Dashboard
 * 
 * Features adaptive information density and expandable grids.
 * 
 * @param {Object} props
 * @param {string} props.workspace - Workspace mode: 'compact' | 'standard' | 'professional' | 'analyst' | 'ultrawide'
 * @param {string} props.density - Density mode: 'comfortable' | 'compact' | 'terminal'
 * @param {React.ReactNode} props.children
 */
export function DashboardLayout({ 
  workspace = "standard", 
  density = "comfortable",
  children 
}) {
  const isProfessional = useMediaQuery("(min-width: 1600px)");
  const isAnalyst = useMediaQuery("(min-width: 1920px)");
  const isUltrawide = useMediaQuery("(min-width: 2560px)");

  // Auto-detect workspace if not explicitly provided
  const workspaceMode = workspace || (isUltrawide ? "ultrawide" : isAnalyst ? "analyst" : isProfessional ? "professional" : "standard");

  const layoutClasses = [
    "dashboard-layout",
    `workspace-mode-${workspaceMode}`,
    `density-${density}`
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
 * DashboardHero - Top hero section with metrics
 */
export function DashboardHero({ children, workspaceMode, density }) {
  return (
    <section className="dashboard-hero">
      {children}
    </section>
  );
}

/**
 * DashboardGrid - Expandable grid for dashboard cards
 */
export function DashboardGrid({ children, workspaceMode, density }) {
  return (
    <section className="dashboard-grid">
      {children}
    </section>
  );
}

/**
 * DashboardMain - Main content area
 */
export function DashboardMain({ children, workspaceMode, density }) {
  return (
    <main className="dashboard-main">
      {children}
    </main>
  );
}
