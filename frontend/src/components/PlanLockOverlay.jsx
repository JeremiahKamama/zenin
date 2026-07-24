// components/PlanLockOverlay.jsx
// Reusable, monochrome "upgrade to access" overlay for tier-gated features
// (Brandv2: no color, no fabricated capability). Renders the gated children
// underneath and a scrim + CTA when `locked`. The CTA opens the billing/plan
// surface via `onUpgrade` (caller owns the destination).
import React from "react";

export function PlanLockOverlay({
  locked = false,
  requiredPlan = "desk",
  title,
  description,
  children,
  onUpgrade,
  upgradeLabel = "Upgrade"
}) {
  if (!locked) return <>{children}</>;
  return (
    <div className="plan-lock" aria-label={`${requiredPlan} plan required`}>
      <div className="plan-lock__content" aria-hidden="true">{children}</div>
      <div className="plan-lock__scrim" role="alertdialog" aria-label={`${requiredPlan} plan required`}>
        <div className="plan-lock__card">
          <span className="plan-lock__badge">{requiredPlan}</span>
          <h3 className="plan-lock__title">{title || `Available on ${requiredPlan}`}</h3>
          <p className="plan-lock__desc">
            {description || `This feature requires the ${requiredPlan} plan. Upgrade to unlock shared desk capabilities.`}
          </p>
          {onUpgrade && (
            <button type="button" className="plan-lock__cta" onClick={onUpgrade}>
              {upgradeLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PlanLockOverlay;
