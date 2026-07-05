import { Children, cloneElement, isValidElement } from "react";

/**
 * ReadingLayout - Constrained width layout for readable content
 * 
 * Optimized for:
 * - Research articles
 * - Documentation
 * - Investment notes
 * 
 * Maintains readable width (900-1100px max) regardless of viewport.
 * Never stretches articles across ultrawide displays.
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function ReadingLayout({ children }) {
  return (
    <div className="reading-layout">
      {Children.map(children, (child) => {
        if (isValidElement(child)) {
          return cloneElement(child);
        }
        return child;
      })}
    </div>
  );
}

/**
 * ReadingContent - Main readable content area
 */
export function ReadingContent({ children }) {
  return (
    <main className="reading-content">
      {children}
    </main>
  );
}

/**
 * ReadingSidebar - Optional sidebar for reading layouts
 */
export function ReadingSidebar({ children }) {
  if (!children) return null;
  
  return (
    <aside className="reading-sidebar">
      {children}
    </aside>
  );
}
