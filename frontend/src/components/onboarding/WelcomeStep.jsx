import { StepPanel } from "./primitives";

export function WelcomeStep({ onBegin, plan }) {
  const planName = plan ? `${plan[0].toUpperCase()}${plan.slice(1)}` : "your";
  return (
    <StepPanel
      eyebrow="Workspace Setup"
      title="Provision your research desk"
      description="Zenin is an institutional research platform. We'll configure a personalized workspace, then drop you straight into your first insight."
    >
      <div className="ob-welcome">
        <ul className="ob-welcome-points">
          <li><span className="ob-welcome-key">Platform</span>Zenin unifies watchlists, research, options, and tax across every market.</li>
          <li><span className="ob-welcome-key">Configured for you</span>Your markets, currency, and research style shape the workspace you get.</li>
          <li><span className="ob-welcome-key">This takes</span>About 3 minutes, then you're at your desk.</li>
        </ul>
        <button type="button" className="ob-btn ob-btn-primary ob-welcome-begin" onClick={onBegin}>
          Begin setup
        </button>
      </div>
    </StepPanel>
  );
}

export default WelcomeStep;
