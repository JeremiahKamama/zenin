import { useEffect, useState } from "react";
import useReducedMotion from "./useReducedMotion";

// Stage 1 — Personalizing your workspace.
// Rows appear progressively (250–350ms cadence), reflecting onboarding answers.
// Fires onDone when the full list has been revealed.
const ROWS = [
  "Creating navigation",
  "Configuring dashboard",
  "Enabling research modules",
  "Preparing market data",
  "Building watchlists",
  "Creating journal",
  "Applying preferences",
];

export function WorkspacePersonalization({ summary, onDone }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? ROWS.length : 0);

  useEffect(() => {
    if (reduced) {
      setShown(ROWS.length);
      const t = setTimeout(onDone, 120);
      return () => clearTimeout(t);
    }
    if (shown >= ROWS.length) {
      const t = setTimeout(onDone, 650);
      return () => clearTimeout(t);
    }
    const step = setTimeout(() => setShown((n) => n + 1), 300);
    return () => clearTimeout(step);
  }, [shown, reduced, onDone]);

  const { markets, modules, researchStyles, preferences } = summary;

  return (
    <div className="ob-launch-stage" role="status" aria-live="polite">
      <p className="ob-launch-eyebrow">Personalizing your workspace</p>
      <h1 className="ob-launch-title">Configuring your research environment…</h1>
      <ul className="ob-personalize-list">
        {ROWS.map((label, i) => (
          <li key={label} className={`ob-personalize-row${i < shown ? " is-on" : ""}`}>
            <span className="ob-personalize-check" aria-hidden="true">✓</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {(markets?.length || modules?.length) && (
        <div className="ob-personalize-reflect">
          {markets?.length ? (
            <p className="ob-personalize-reflect-line">
              <span className="ob-personalize-reflect-k">Markets</span>
              {markets.map((m) => (
                <span key={m} className="ob-personalize-pill">✓ {m}</span>
              ))}
            </p>
          ) : null}
          {modules?.length ? (
            <p className="ob-personalize-reflect-line">
              <span className="ob-personalize-reflect-k">Modules</span>
              {modules.map((m) => (
                <span key={m} className="ob-personalize-pill">✓ {m}</span>
              ))}
            </p>
          ) : null}
          {researchStyles?.length ? (
            <p className="ob-personalize-reflect-line">
              <span className="ob-personalize-reflect-k">Research</span>
              {researchStyles.map((s) => (
                <span key={s} className="ob-personalize-pill">✓ {s}</span>
              ))}
            </p>
          ) : null}
          {preferences?.length ? (
            <p className="ob-personalize-reflect-line">
              <span className="ob-personalize-reflect-k">Prefs</span>
              {preferences.map(([k, v]) => (
                <span key={k} className="ob-personalize-pill">✓ {v}</span>
              ))}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default WorkspacePersonalization;
