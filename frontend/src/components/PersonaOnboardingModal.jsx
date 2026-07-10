import { useEffect, useRef, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";

const PERSONAS = [
  {
    key: "casual_investor",
    label: "Casual investor",
    description: "Portfolio → Watchlist → Daily briefing → Journal",
    detail: "Track holdings, follow a few assets, read the daily briefing, and journal occasional decisions.",
    sectionOrder: ["Home", "Briefing", "Portfolio", "Watchlist", "Research", "Journal"]
  },
  {
    key: "active_trader",
    label: "Active trader",
    description: "Briefing → Alerts → Execution history → Journal → Review",
    detail: "Start every day with the briefing, act on alerts, review executions, journal outcomes, and run reviews.",
    sectionOrder: ["Briefing", "Watchlist", "Portfolio", "Decisions", "Journal", "Analytics"]
  },
  {
    key: "small_team",
    label: "Small team",
    description: "Workspace activity → Research queue → Shared alerts → Decision review",
    detail: "Coordinate around workspace activity, share a research queue, triage alerts, and review decisions together.",
    sectionOrder: ["Briefing", "Research", "Watchlist", "Decisions", "Journal", "Analytics"]
  }
];

export function PersonaOnboardingModal({ open, onClose, onSelect, isGuestUser = false }) {
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  if (!open) return null;

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  const handleConfirm = async () => {
    const persona = PERSONAS.find((p) => p.key === selected) || PERSONAS[0];
    setSaving(true);
    setFeedback(null);
    try {
      if (!isGuestUser) {
        // Persist persona + section order to settings:preferences workspace doc.
        const existingRes = await zeninFetch("/db/workspace/docs/settings:preferences");
        const existing = await existingRes.json().catch(() => ({}));
        const nextPrefs = {
          ...(existing?.doc && typeof existing.doc === "object" ? existing.doc : {}),
          persona: persona.key,
          sectionOrder: persona.sectionOrder
        };
        await zeninFetch("/db/workspace/docs/settings:preferences", {
          method: "PUT",
          body: JSON.stringify({ payload: nextPrefs })
        });
      }
      onSelect?.({ persona: persona.key, sectionOrder: persona.sectionOrder });
      onClose?.();
    } catch (error) {
      setFeedback(error.message || "Failed to save persona. You can continue anyway.");
      // Still allow the user to proceed even if persistence fails.
      onSelect?.({ persona: persona.key, sectionOrder: persona.sectionOrder });
      onClose?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="persona-onboarding-overlay" onMouseDown={onClose}>
      <div
        className="persona-onboarding-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Choose your Zenin workflow"
      >
        <header className="persona-onboarding-head">
          <div>
            <strong>How do you work?</strong>
            <p>Pick a workflow and Zenin will order your sidebar around it. You can change this anytime.</p>
          </div>
          <button type="button" className="persona-onboarding-skip" onClick={onClose} aria-label="Skip persona selection">Skip</button>
        </header>
        <div className="persona-onboarding-options">
          {PERSONAS.map((persona) => {
            const isSelected = selected === persona.key;
            return (
              <button
                type="button"
                key={persona.key}
                className={`persona-onboarding-option ${isSelected ? "persona-onboarding-option-selected" : ""}`}
                onClick={() => setSelected(persona.key)}
              >
                <strong>{persona.label}</strong>
                <span className="persona-onboarding-flow">{persona.description}</span>
                <span className="persona-onboarding-detail">{persona.detail}</span>
              </button>
            );
          })}
        </div>
        {feedback ? (
          <div className="guest-action-feedback" role="status" aria-live="polite">{feedback}</div>
        ) : null}
        <footer className="persona-onboarding-actions">
          <button type="button" className="settings-primary-btn" disabled={saving || !selected} onClick={handleConfirm}>
            {saving ? "Saving…" : "Continue"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default PersonaOnboardingModal;
