// LaunchTransition — full-screen monochrome veil that masks the route change.
// Fades in over the launch sequence, then the destination app fades in beneath.
// No white flash, no spinner (per spec). Sits above the onboarding + app shell.
export function LaunchTransition({ visible }) {
  return (
    <div className={`ob-launch-veil${visible ? " is-visible" : ""}`} aria-hidden={!visible}>
      <div className="ob-launch-veil-mark">ZENIN</div>
    </div>
  );
}

export default LaunchTransition;
