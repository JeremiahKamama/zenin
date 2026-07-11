import { useEffect, useState } from "react";
import { ProvisioningList, StepPanel } from "./primitives";

const MODULES = [
  { key: "preferences", label: "Preferences", sub: "Saved" },
  { key: "watchlists", label: "Watchlists", sub: "Seeded" },
  { key: "modules", label: "Modules", sub: "Enabled" },
  { key: "dashboard", label: "Dashboard", sub: "Assembled" },
  { key: "market", label: "Market data", sub: "Loading…" },
];

export function WorkspaceProvisioningStep({ onDone }) {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    const timers = MODULES.map((_, i) => setTimeout(() => setRevealed(i + 1), 300 + i * 260));
    const done = setTimeout(() => onDone?.(), 300 + MODULES.length * 260 + 450);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [onDone]);

  return (
    <StepPanel
      eyebrow="Provisioning"
      title="Creating your workspace"
      description="Assembling the modules and data your setup selected."
    >
      <ProvisioningList items={MODULES} revealed={revealed} />
      <p className="ob-prov-status" aria-live="polite">
        {revealed >= MODULES.length ? "Almost ready…" : "Assembling your modules…"}
      </p>
    </StepPanel>
  );
}

export default WorkspaceProvisioningStep;
