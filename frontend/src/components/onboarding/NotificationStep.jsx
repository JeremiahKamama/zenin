import { StepPanel, ToggleCard } from "./primitives";

const OPTIONS = [
  { key: "daily_briefing", label: "Daily Briefing", description: "Markets + watchlist each morning." },
  { key: "weekly_digest", label: "Weekly Digest", description: "Week-in-review for your book." },
  { key: "price_alerts", label: "Price Alerts", description: "Thresholds on your watchlist." },
  { key: "macro_alerts", label: "Macro Alerts", description: "Rates, FX, index moves." },
  { key: "earnings_alerts", label: "Earnings Alerts", description: "Upcoming prints for holdings." },
  { key: "research_reminders", label: "Research Reminders", description: "Nudge on catalysts you track." },
];

export function NotificationStep({ answers, update }) {
  const selected = Array.isArray(answers.notifications) ? answers.notifications : [];
  const toggle = (key) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    update({ notifications: next });
  };
  return (
    <StepPanel
      eyebrow="Signals"
      title="Stay in the loop"
      description="Choose what Zenin surfaces. Toggle any or none."
    >
      <div className="ob-toggle-grid">
        {OPTIONS.map((o) => (
          <ToggleCard
            key={o.key}
            title={o.label}
            description={o.description}
            on={selected.includes(o.key)}
            onClick={() => toggle(o.key)}
          />
        ))}
      </div>
    </StepPanel>
  );
}

export default NotificationStep;
