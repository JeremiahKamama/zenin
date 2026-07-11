import { SelectCard, StepPanel } from "./primitives";

const METHODS = [
  { key: "empty", title: "Import later", description: "Start empty; bring a portfolio whenever you're ready." },
  { key: "manual", title: "Import manually", description: "Add positions one by one." },
  { key: "sample", title: "Use sample portfolio", description: "Explore the workspace with demo data." },
  { key: "broker", title: "Connect brokerage", description: "Secure read-only link.", badge: "Coming soon" },
];

export function PortfolioImportStep({ answers, update }) {
  const selected = answers.portfolio?.method || null;
  return (
    <StepPanel
      eyebrow="Portfolio"
      title="Bring your portfolio"
      description="You can always import later — your workspace is ready either way."
    >
      <div className="ob-sel-grid">
        {METHODS.map((m) => (
          <SelectCard
            key={m.key}
            title={m.title}
            description={m.description}
            badge={m.badge}
            selected={selected === m.key}
            onClick={() => update({ portfolio: { ...answers.portfolio, method: m.key } })}
          />
        ))}
      </div>
      {selected && selected !== "empty" && selected !== "broker" ? (
        <p className="ob-note">Connection completes during provisioning — your workspace will be ready to receive it.</p>
      ) : (
        <p className="ob-note">No portfolio? That's fine. Start empty and import whenever you're ready.</p>
      )}
    </StepPanel>
  );
}

export default PortfolioImportStep;
