// Stage 2 — Workspace Ready. Concise summary of what was configured.
// No onboarding questions repeated; only meaningful outcomes.
export function WorkspaceReady({ summary, onLaunch }) {
  const { markets, modules, portfolio, watchlistCount, preferences } = summary;

  return (
    <div className="ob-launch-stage ob-ready">
      <p className="ob-launch-eyebrow">Workspace Ready</p>
      <h1 className="ob-launch-title">Everything has been configured.</h1>

      <div className="ob-ready-grid">
        <section className="ob-ready-section">
          <p className="ob-ready-subtitle">Modules</p>
          <ul className="ob-ready-list">
            {modules.map((m) => (
              <li key={m}><span className="ob-ready-check" aria-hidden="true">✓</span>{m}</li>
            ))}
          </ul>
        </section>

        <section className="ob-ready-section">
          <p className="ob-ready-subtitle">Markets</p>
          <ul className="ob-ready-list">
            {markets.map((m) => (
              <li key={m}><span className="ob-ready-check" aria-hidden="true">✓</span>{m}</li>
            ))}
          </ul>
        </section>

        <section className="ob-ready-section">
          <p className="ob-ready-subtitle">Preferences</p>
          <ul className="ob-ready-list">
            {preferences.map(([k, v]) => (
              <li key={k}><span className="ob-ready-check" aria-hidden="true">✓</span>{v}</li>
            ))}
            {portfolio ? (
              <li><span className="ob-ready-check" aria-hidden="true">✓</span>{portfolio}</li>
            ) : null}
            {watchlistCount ? (
              <li><span className="ob-ready-check" aria-hidden="true">✓</span>{watchlistCount} watchlist{watchlistCount > 1 ? "s" : ""}</li>
            ) : null}
          </ul>
        </section>
      </div>

      <p className="ob-ready-foot">Ready to begin research.</p>

      <WorkspaceLaunchButton onLaunch={onLaunch} />
    </div>
  );
}

// Imported here to keep this module self-contained.
import WorkspaceLaunchButton from "./WorkspaceLaunchButton";

export default WorkspaceReady;
