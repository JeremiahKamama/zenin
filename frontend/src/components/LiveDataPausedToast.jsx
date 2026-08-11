// components/LiveDataPausedToast.jsx
//
// Small persistent card (bottom-right) shown when live data pulling is paused
// after user inactivity. Contains a "Reconnect" action that resumes live data.
// Positioned above other toasts/modals (z-toast). Renders nothing when not paused.

export function LiveDataPausedToast({ paused, onReconnect }) {
  if (!paused) return null;
  return (
    <div
      className="live-data-paused-toast"
      role="status"
      aria-live="polite"
    >
      <div className="live-data-paused-dot" aria-hidden="true" />
      <div className="live-data-paused-body">
        <strong className="live-data-paused-title">Live data paused</strong>
        <span className="live-data-paused-desc">The market feed was paused after inactivity.</span>
      </div>
      <button
        type="button"
        className="live-data-paused-reconnect"
        onClick={onReconnect}
      >
        Reconnect
      </button>
    </div>
  );
}

export default LiveDataPausedToast;
