import { useEffect, useState } from "react";
import WorkspacePersonalization from "./WorkspacePersonalization";
import WorkspaceReady from "./WorkspaceReady";
import deriveLaunchSummary from "./deriveLaunchSummary";
import useReducedMotion from "./useReducedMotion";

// Launch state machine (UI-only). Onboarding emits COMPLETE; the launch
// experience subscribes and walks PERSONALIZING -> READY -> LAUNCHING -> DONE.
export const LAUNCH_STATE = {
  PERSONALIZING: "personalizing",
  READY: "ready",
  LAUNCHING: "launching",
  DONE: "done",
};

export function LaunchExperience({ answers, plan, onFinish }) {
  const reduced = useReducedMotion();
  const summary = deriveLaunchSummary(answers, plan);
  const [state, setState] = useState(reduced ? LAUNCH_STATE.READY : LAUNCH_STATE.PERSONALIZING);

  // Reduced-motion: skip straight to the destination state.
  useEffect(() => {
    if (reduced) setState(LAUNCH_STATE.READY);
  }, [reduced]);

  const launch = () => {
    console.log("[lifecycle] Workspace Ready");
    console.log("[lifecycle] Launching Workspace");
    setState(LAUNCH_STATE.LAUNCHING);
    // Mask route latency; the app-shell boot fade covers the rest.
    const delay = reduced ? 60 : 750;
    setTimeout(() => onFinish?.(plan), delay);
  };

  if (state === LAUNCH_STATE.PERSONALIZING) {
    console.log("[lifecycle] Workspace Provisioning Started");
    return <WorkspacePersonalization summary={summary} onDone={() => setState(LAUNCH_STATE.READY)} />;
  }
  if (state === LAUNCH_STATE.READY || state === LAUNCH_STATE.LAUNCHING) {
    return (
      <WorkspaceReady
        summary={summary}
        onLaunch={launch}
      />
    );
  }
  return null;
}

export default LaunchExperience;
