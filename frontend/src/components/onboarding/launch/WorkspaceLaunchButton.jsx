import { useEffect, useState } from "react";
import useReducedMotion from "./useReducedMotion";

const PHASES = ["Launching…", "Preparing interface…", "Opening Research Workspace…"];

// Primary CTA that morphs into a calm, restrained loading state.
// Masks route latency; never a bounce/spin — only opacity + a brief label cycle.
export function WorkspaceLaunchButton({ onLaunch }) {
  const reduced = useReducedMotion();
  const [launching, setLaunching] = useState(false);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!launching) return;
    if (reduced) return; // destination renders immediately; no label cycle
    const t = setInterval(() => setPhase((p) => Math.min(p + 1, PHASES.length - 1)), 350);
    return () => clearInterval(t);
  }, [launching, reduced]);

  const click = () => {
    if (launching) return;
    setLaunching(true);
    onLaunch?.();
  };

  if (launching) {
    return (
      <button type="button" className="ob-launch-btn is-launching" disabled aria-live="polite">
        {PHASES[phase]}
      </button>
    );
  }
  return (
    <button type="button" className="ob-launch-btn" onClick={click} autoFocus>
      Launch Workspace →
    </button>
  );
}

export default WorkspaceLaunchButton;
