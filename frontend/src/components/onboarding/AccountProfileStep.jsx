import { Field, StepPanel } from "./primitives";

const COUNTRIES = [
  "United States", "United Kingdom", "Canada", "Germany", "France", "Japan",
  "Singapore", "Australia", "Switzerland", "Netherlands", "Hong Kong", "India", "Other",
];
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "SGD", "AUD", "CAD", "CHF", "HKD", "INR"];

function timezoneGuess() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function AccountProfileStep({ answers, update }) {
  return (
    <StepPanel
      eyebrow="Identity"
      title="Account profile"
      description="We use this to localize your workspace, briefings, and reports."
    >
      <div className="ob-profile">
        <div className="ob-avatar" aria-hidden="true">
          {(answers.name || "?").trim().charAt(0).toUpperCase()}
        </div>
        <div className="ob-profile-fields">
          <Field
            label="Full name"
            placeholder="e.g. Jeremiah Kamama"
            value={answers.name || ""}
            autoFocus
            onChange={(e) => update({ name: e.target.value })}
          />
          <Field
            label="Country"
            as="select"
            value={answers.country || ""}
            onChange={(e) => update({ country: e.target.value })}
          >
            <option value="">Select…</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Field>
          <Field
            label="Timezone"
            value={answers.timezone || timezoneGuess()}
            helper="Used for market-open states and briefing times."
            onChange={(e) => update({ timezone: e.target.value })}
          />
          <Field
            label="Preferred currency"
            as="select"
            value={answers.currency || ""}
            onChange={(e) => update({ currency: e.target.value })}
          >
            <option value="">Select…</option>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Field>
        </div>
      </div>
    </StepPanel>
  );
}

export default AccountProfileStep;
