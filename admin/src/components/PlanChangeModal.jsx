// admin/src/components/PlanChangeModal.jsx
//
// Replaces `window.prompt("Reason for changing <email> plan:")` on the plan
// control in the user detail panel.
//
// WHY A REAL MODAL
// ----------------
// The native prompt had four problems that each caused a real failure:
//
//   1. It showed only a bare text box. The admin could not see which plan they
//      were moving the user FROM or TO, so a mis-click on the <select> was
//      invisible until after the write. Plan changes affect what a paying
//      customer can access and what they are billed.
//   2. It could not show pricing, so an admin could not tell an upgrade from a
//      downgrade — and a downgrade is destructive and should read as such.
//   3. It gave no validation. An empty or one-character reason was accepted,
//      which defeats the purpose of an audit trail: the whole point of the
//      field is that a human can later understand why access changed.
//   4. It was unstyleable and inconsistent with the console, and `window.prompt`
//      is blocked in some embedded/browser contexts entirely.
//
// This modal shows the from -> to transition, the price movement, an explicit
// upgrade/downgrade signal, a character-budgeted reason field with inline
// validation, and the audit consequence spelled out.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.mjs';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.mjs';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.mjs';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.mjs';
import X from 'lucide-react/dist/esm/icons/x.mjs';

import { PLANS, describePlanChange, getPlan, planOptionLabel } from '../utils/plans';
import { pluralize } from '../utils/pluralize';

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

/** Common justifications, so the field is one click for the usual cases. */
const PRESET_REASONS = [
  { id: 'upgrade-request', label: 'Customer requested upgrade', text: 'Customer requested a plan upgrade via support.' },
  { id: 'payment', label: 'Payment received', text: 'Payment received and confirmed; applying the corresponding plan.' },
  { id: 'downgrade-request', label: 'Customer requested downgrade', text: 'Customer requested a downgrade to reduce their monthly cost.' },
  { id: 'billing-issue', label: 'Billing issue', text: 'Applying a plan correction following a billing issue.' },
  { id: 'trial', label: 'Trial / comp access', text: 'Granting temporary access for a trial or comp arrangement.' }
];

export default function PlanChangeModal({
  open,
  user,
  currentPlan,
  targetPlan,
  onTargetChange,
  onConfirm,
  onClose,
  busy = false,
  error = ''
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const reasonRef = useRef(null);
  const dialogRef = useRef(null);
  const titleId = useId();
  const descId = useId();
  const reasonErrorId = useId();

  const email = user?.email || 'this user';
  const change = useMemo(
    () => describePlanChange(currentPlan, targetPlan),
    [currentPlan, targetPlan]
  );

  const trimmedReason = reason.trim();
  const reasonTooShort = trimmedReason.length > 0 && trimmedReason.length < MIN_REASON_LENGTH;
  const reasonMissing = trimmedReason.length === 0;
  const reasonValid = trimmedReason.length >= MIN_REASON_LENGTH && trimmedReason.length <= MAX_REASON_LENGTH;

  // A downgrade removes access, so require the admin to name the destination.
  // This is a deliberate speed bump, not a security control.
  const needsTypeToConfirm = Boolean(change?.isDestructive);
  const confirmMatches = !needsTypeToConfirm
    || confirmText.trim().toLowerCase() === (change?.to?.label || '').toLowerCase();
  const canSubmit = Boolean(change) && reasonValid && confirmMatches && !busy;

  const reset = useCallback(() => {
    setReason('');
    setTouched(false);
    setConfirmText('');
  }, []);

  // Reset whenever the modal opens for a new target, so a previous reason can
  // never be silently reused for a different user or plan.
  useEffect(() => {
    if (open) reset();
  }, [open, user?.id, targetPlan, reset]);

  // Focus the reason field on open: it is the only thing the admin must type.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => reasonRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // Escape closes, but never while a write is in flight — cancelling mid-write
  // would leave the admin unsure whether the plan changed.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  // Trap focus inside the dialog. Without this, Tab walks into the page behind
  // the overlay and the admin can act on a user row they cannot see.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    onConfirm?.({ reason: trimmedReason, plan: change.to.id });
  };

  const directionIcon = change?.isUpgrade
    ? <TrendingUp size={14} aria-hidden="true" />
    : change?.isDowngrade
      ? <TrendingDown size={14} aria-hidden="true" />
      : null;

  const directionLabel = change?.isUpgrade ? 'Upgrade' : change?.isDowngrade ? 'Downgrade' : 'Change';
  const deltaLabel = change && change.priceDelta !== 0
    ? `${change.priceDelta > 0 ? '+' : '−'}$${Math.abs(change.priceDelta)}/mo`
    : 'No price change';

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        // Only close on a press that STARTED on the overlay. A drag that ends
        // outside the dialog (selecting text in the reason field) must not
        // discard a half-written justification.
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <div
        className="modal-container plan-change-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        ref={dialogRef}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', minWidth: 0 }}>
            <div className={`plan-change-glyph${change?.isDestructive ? ' is-warning' : ''}`} aria-hidden="true">
              {directionIcon || <ArrowRight size={15} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 id={titleId} className="plan-change-title">Change plan</h2>
              <p id={descId} className="plan-change-subtitle">
                Reason for changing <strong>{email}</strong> plan
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close without changing the plan"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit}>
          {/* ── the transition, stated plainly ─────────────────────────── */}
          <div className="plan-change-transition" data-direction={directionLabel.toLowerCase()}>
            <div className="plan-change-node">
              <span className="plan-change-node-label">Currently</span>
              <span className="plan-change-node-value">{getPlan(currentPlan)?.label || 'Unknown'}</span>
            </div>
            <ArrowRight size={18} className="plan-change-arrow" aria-hidden="true" />
            <div className="plan-change-node is-target">
              <span className="plan-change-node-label">Changing to</span>
              <select
                className="filter-select plan-change-select"
                value={change?.to?.id || ''}
                onChange={(event) => onTargetChange?.(event.target.value)}
                disabled={busy}
                aria-label="New plan"
              >
                {PLANS.map((plan) => (
                  <option key={plan.id} value={plan.id}>{planOptionLabel(plan.id)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="plan-change-summary">
            <span className={`plan-change-chip${change?.isUpgrade ? ' is-upgrade' : change?.isDowngrade ? ' is-downgrade' : ''}`}>
              {directionLabel}
            </span>
            <span className="plan-change-delta">{deltaLabel}</span>
            {change?.to?.blurb && <span className="plan-change-blurb">{change.to.blurb}</span>}
          </div>

          {change?.isDestructive && (
            <div className="plan-change-warning" role="note">
              <AlertTriangle size={16} aria-hidden="true" />
              <div>
                <strong>This removes access immediately.</strong>
                <span>
                  {email} will lose {change.isDowngrade ? 'the features included in ' : ''}
                  {change.from?.label}. This takes effect as soon as you confirm.
                </span>
              </div>
            </div>
          )}

          {/* ── the reason, with validation ────────────────────────────── */}
          <div className="plan-change-field">
            <label htmlFor={`${titleId}-reason`} className="plan-change-label">
              Reason <span aria-hidden="true">*</span>
            </label>
            <p className="plan-change-hint">
              Recorded in the audit trail. {MIN_REASON_LENGTH} characters minimum.
            </p>

            <div className="plan-change-presets">
              {PRESET_REASONS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="plan-change-preset"
                  onClick={() => { setReason(preset.text); setTouched(true); }}
                  disabled={busy}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <textarea
              id={`${titleId}-reason`}
              ref={reasonRef}
              className={`plan-change-textarea${touched && !reasonValid ? ' has-error' : ''}`}
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, MAX_REASON_LENGTH))}
              onBlur={() => setTouched(true)}
              placeholder="Why is this plan changing?"
              rows={3}
              disabled={busy}
              aria-invalid={touched && !reasonValid}
              aria-describedby={touched && !reasonValid ? reasonErrorId : undefined}
            />

            <div className="plan-change-meter">
              {touched && reasonMissing && (
                <span id={reasonErrorId} className="plan-change-error" role="alert">
                  A reason is required — it is what makes this change auditable.
                </span>
              )}
              {touched && reasonTooShort && (
                <span id={reasonErrorId} className="plan-change-error" role="alert">
                  Add {pluralize(MIN_REASON_LENGTH - trimmedReason.length, 'more character')} so the entry is meaningful later.
                </span>
              )}
              {(!touched || reasonValid) && <span />}
              <span className={`plan-change-count${trimmedReason.length > MAX_REASON_LENGTH * 0.9 ? ' is-near-limit' : ''}`}>
                {trimmedReason.length}/{MAX_REASON_LENGTH}
              </span>
            </div>
          </div>

          {needsTypeToConfirm && (
            <div className="plan-change-field">
              <label htmlFor={`${titleId}-confirm`} className="plan-change-label">
                Type <strong>{change?.to?.label}</strong> to confirm
              </label>
              <input
                id={`${titleId}-confirm`}
                type="text"
                className={`plan-change-input${confirmText && !confirmMatches ? ' has-error' : ''}`}
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                placeholder={change?.to?.label}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          {error && (
            <div className="plan-change-submit-error" role="alert">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="plan-change-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className={`btn ${change?.isDestructive ? 'btn-danger' : 'btn-primary'}`}
              disabled={!canSubmit}
            >
              {busy
                ? 'Applying…'
                : change
                  ? `${change.isUpgrade ? 'Upgrade' : change.isDowngrade ? 'Downgrade' : 'Change'} to ${change.to.label}`
                  : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
