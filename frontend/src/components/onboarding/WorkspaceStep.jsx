import { Field, StepPanel } from "./primitives";

export function WorkspaceStep({ answers, update }) {
  return (
    <StepPanel
      eyebrow="Organization"
      title="Name your desk"
      description="This identity shows across your shared workspace."
    >
      <div className="ob-profile-fields">
        <Field
          label="Workspace name"
          placeholder="e.g. Kamama Capital Desk"
          value={answers.workspaceName || ""}
          autoFocus
          onChange={(e) => update({ workspaceName: e.target.value })}
        />
        <Field
          label="Organization"
          placeholder="e.g. Kamama Family Office"
          value={answers.organization || ""}
          onChange={(e) => update({ organization: e.target.value })}
        />
        <Field
          label="Logo URL (optional)"
          placeholder="https://…"
          value={answers.logo || ""}
          onChange={(e) => update({ logo: e.target.value })}
        />
        <Field
          label="Industry"
          placeholder="e.g. Asset Management"
          value={answers.industry || ""}
          onChange={(e) => update({ industry: e.target.value })}
        />
      </div>
    </StepPanel>
  );
}

export default WorkspaceStep;
