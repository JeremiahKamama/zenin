import React from 'react';
import { captureException, addBreadcrumb } from '../sentry';

function resetLazyImportRecoveryState() {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    Object.keys(window.sessionStorage).forEach((key) => {
      if (key.startsWith("zenin_lazy_retry_")) {
        window.sessionStorage.removeItem(key);
      }
    });
  } catch {}
}

export class GenericErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
    // Report to Sentry with the React component stack and the boundary's
    // `layer` prop (defaults to "app-shell") so the team can tell whether an
    // error crashed the whole app or an isolated widget. Safe no-op when
    // Sentry is unconfigured.
    captureException(error, {
      contexts: {
        react: {
          componentStack: String(errorInfo?.componentStack || "")
        }
      },
      tags: {
        layer: String(this.props.layer || "app-shell"),
        kind: "error-boundary"
      }
    });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null, errorInfo: null });
      // Record that the user recovered (e.g. navigated away) so the crash is
      // distinguishable from a hard reload in Sentry replays.
      addBreadcrumb({
        category: "ui.error-boundary",
        message: "error boundary reset via resetKey change",
        level: "info"
      });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-container" style={{
          padding: '2rem',
          margin: '1rem',
          borderRadius: '12px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          color: 'var(--color-danger)',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <h2 style={{ marginTop: 0, fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ fontSize: '0.875rem', opacity: 0.9 }}>
            The module failed to load or crashed. This can happen due to network issues or unexpected data.
          </p>
          <div style={{ 
            marginTop: '1rem', 
            padding: '1rem', 
            background: 'var(--color-surface-overlay)', 
            borderRadius: '8px',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            overflowX: 'auto',
            color: 'var(--color-data-red-bright)'
          }}>
            {this.state.error?.toString()}
          </div>
          <button 
            onClick={() => {
              resetLazyImportRecoveryState();
              window.location.reload();
            }}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              background: 'var(--color-danger)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500
            }}
          >
            Reload Workspace
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
