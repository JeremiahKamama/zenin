import { useEffect, useState } from "react";

const TIPS = [
  "Press \"/\" to search",
  "Add your first asset",
  "Build your watchlist",
  "Open Company Research",
];

// First-session floating welcome card. Shown exactly once (persisted flag),
// then never again. Compact, dismissible, institutional tone.
export function FirstSessionWelcome({ onDismiss }) {
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    let stored = null;
    try {
      stored = localStorage.getItem("zenin_first_session_seen");
    } catch {
      stored = null;
    }
    setSeen(!!stored);
    if (!stored) {
      try {
        localStorage.setItem("zenin_first_session_seen", "1");
      } catch {
        /* ignore storage failures */
      }
    }
  }, []);

  if (seen) return null;

  return (
    <div className="ob-firstsession" role="status" aria-label="Welcome to Zenin">
      <div className="ob-firstsession-head">
        <p className="ob-firstsession-title">Welcome to Zenin</p>
        <button
          type="button"
          className="ob-firstsession-close"
          aria-label="Dismiss"
          onClick={() => {
            setSeen(true);
            onDismiss?.();
          }}
        >
          ×
        </button>
      </div>
      <p className="ob-firstsession-body">Your research workspace is ready.</p>
      <p className="ob-firstsession-sub">Quick Tips</p>
      <ul className="ob-firstsession-tips">
        {TIPS.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <button
        type="button"
        className="ob-btn ob-btn-primary ob-firstsession-cta"
        onClick={() => {
          setSeen(true);
          onDismiss?.();
        }}
      >
        Begin Research
      </button>
    </div>
  );
}

export default FirstSessionWelcome;
