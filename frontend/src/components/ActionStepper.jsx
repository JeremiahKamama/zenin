import React from "react";

/**
 * ActionStepper — shared horizontal progress stepper for the Action Workspace.
 *
 * Monochrome only: completed = checkmark in a filled token circle,
 * active = ringed token, future = muted token. A connected line links steps.
 *
 * Props:
 *  - steps: string[]            (e.g. ["Overview", "Plan", "Confirm", "Success"])
 *  - current: number           (1-based active step)
 *  - onStepClick?: (n) => void (optional — allow jumping to completed steps)
 *  - idPrefix?: string         (namespace for aria/labelledby ids)
 */
export default function ActionStepper({ steps, current, onStepClick, idPrefix = "aw" }) {
  return (
    <ol className="aw-stepper" aria-label="Progress">
      {steps.map((label, idx) => {
        const stepIndex = idx + 1;
        const done = stepIndex < current;
        const active = stepIndex === current;
        const state = done ? "done" : active ? "active" : "todo";
        const clickable = done && typeof onStepClick === "function";
        const itemId = `${idPrefix}-step-${stepIndex}`;
        return (
          <li
            key={itemId}
            id={itemId}
            className={`aw-stepper-item ${state}${clickable ? " is-clickable" : ""}`}
            aria-current={active ? "step" : undefined}
          >
            <button
              type="button"
              className="aw-stepper-btn"
              onClick={clickable ? () => onStepClick(stepIndex) : undefined}
              disabled={!clickable}
              tabIndex={clickable ? 0 : -1}
            >
              <span className="aw-stepper-marker" aria-hidden="true">
                {done ? "✓" : stepIndex}
              </span>
              <span className="aw-stepper-label">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
