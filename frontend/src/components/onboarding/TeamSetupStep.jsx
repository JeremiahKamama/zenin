import { useState } from "react";
import { Field, StepPanel } from "./primitives";

const ROLES = ["Research", "Portfolio", "Admin", "Viewer"];

export function TeamSetupStep({ answers, update }) {
  const team = Array.isArray(answers.team) ? answers.team : [];
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Research");

  const addMember = () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    if (team.some((m) => m.email === trimmed)) {
      setEmail("");
      return;
    }
    update({ team: [...team, { email: trimmed, role }] });
    setEmail("");
  };

  const remove = (e) => update({ team: team.filter((m) => m.email !== e) });

  return (
    <StepPanel
      eyebrow="Collaboration"
      title="Invite your team"
      description="Add seats and set permissions. You can invite more later."
    >
      <div className="ob-invite">
        <input
          className="ob-input"
          type="email"
          value={email}
          placeholder="teammate@firm.com"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addMember()}
        />
        <select className="ob-input ob-invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button type="button" className="ob-btn ob-btn-secondary" onClick={addMember}>Add</button>
      </div>
      {team.length ? (
        <ul className="ob-team-list">
          {team.map((m) => (
            <li key={m.email} className="ob-team-row">
              <span className="ob-team-email">{m.email}</span>
              <span className="ob-team-role">{m.role}</span>
              <button type="button" className="ob-team-remove" aria-label={`Remove ${m.email}`} onClick={() => remove(m.email)}>×</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ob-note">Launch solo for now — invite teammates anytime from workspace settings.</p>
      )}
    </StepPanel>
  );
}

export default TeamSetupStep;
