import { Children, cloneElement, isValidElement } from "react";

/**
 * FormLayout - Centered constrained layout for forms
 * 
 * Optimized for:
 * - Settings
 * - Billing
 * - Account
 * - Tax
 * 
 * Centered with maximum width of 700-900px.
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children
 */
export function FormLayout({ children }) {
  return (
    <div className="form-layout">
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
 * FormContent - Main form content area
 */
export function FormContent({ children }) {
  return (
    <main className="form-content">
      {children}
    </main>
  );
}

/**
 * FormSidebar - Optional sidebar for form layouts
 */
export function FormSidebar({ children }) {
  if (!children) return null;
  
  return (
    <aside className="form-sidebar">
      {children}
    </aside>
  );
}
