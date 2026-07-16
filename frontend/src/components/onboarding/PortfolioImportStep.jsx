import { SelectCard, StepPanel } from "./primitives";

const METHODS = [
  { key: "empty", title: "Import later", description: "Start empty; bring a portfolio whenever you're ready." },
  { key: "manual", title: "Import manually", description: "Add positions one by one." },
  { key: "sample", title: "Use sample portfolio", description: "Explore the workspace with demo data." },
  { key: "broker", title: "Connect brokerage", description: "Secure read-only SnapTrade link." },
];

export function PortfolioImportStep({ answers, update, onChooseBroker }) {
  const selected = answers.portfolio?.method || null;
  const handleSelect = (m) => {
    update({ portfolio: { ...answers.portfolio, method: m.key } });
    if (m.key === "broker" && typeof onChooseBroker === "function") onChooseBroker();
  };
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
            selected={selected === m.key}
            onClick={() => handleSelect(m)}
          />
        ))}
      </div>
      {selected && selected !== "empty" && selected !== "broker" ? (
        <p className="ob-note">Connection completes during provisioning — your workspace will be ready to receive it.</p>
      ) : selected === "broker" ? (
        <p className="ob-note">We'll open the secure SnapTrade portal after setup. Zenin links read-only — it cannot trade or move funds.</p>
      ) : (
        <p className="ob-note">No portfolio? That's fine. Start empty and import whenever you're ready.</p>
      )}
    </StepPanel>
  );
}

export default PortfolioImportStep;
