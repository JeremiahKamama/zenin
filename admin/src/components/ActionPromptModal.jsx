/**
 * Zenin Admin — ActionPromptModal.
 *
 * Drop-in replacement for every `window.prompt` in the console. The native
 * prompt takes a single string; this takes a spec, because each of the 20 call
 * sites needs more than a string to be genuinely usable:
 *
 *   - a TITLE so the admin knows what is happening
 *   - CONTEXT rows (which integration, which user, the last error) so the
 *     reason they type is informed rather than guessed
 *   - a field KIND (reason vs. name vs. free text) that drives validation and
 *     the confirm label
 *   - an optional SECOND field for flows like "create a user" that need an
 *     email and a reason together
 *
 * Reasons are audit data. A one-word reason typed into an unexplained box is
 * worthless six months later, so the minimum length is enforced and the
 * character count is shown before the limit rather than after a rejection.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ModalShell, ModalContext, ModalActions } from './ModalShell.jsx';

export const REASON_MIN_LENGTH = 10;
export const REASON_MAX_LENGTH = 500;
export const NAME_MAX_LENGTH = 60;

function validate(field, value, values) {
  const trimmed = String(value ?? '').trim();
  if (field.required && !trimmed) {
    return field.requiredMessage || `${field.label} is required.`;
  }
  if (!trimmed) return '';
  if (field.minLength && trimmed.length < field.minLength) {
    return `Give at least ${field.minLength} characters so the reason is useful later.`;
  }
  if (field.maxLength && trimmed.length > field.maxLength) {
    return `Keep this under ${field.maxLength} characters.`;
  }
  if (field.pattern && !field.pattern.test(trimmed)) {
    return field.patternMessage || `${field.label} is not in the expected format.`;
  }
  if (field.matches && trimmed !== String(values[field.matches] ?? '').trim()) {
    return field.matchesMessage || `${field.label} does not match.`;
  }
  // Typed confirmation: the value must equal a literal the admin can read.
  // Case-insensitive so the friction is in the deliberation, not the typing.
  if (field.validateLiteral && trimmed.toLowerCase() !== String(field.validateLiteral).toLowerCase()) {
    return field.validateLiteralMessage || `Type ${field.validateLiteral} exactly to confirm.`;
  }
  return '';
}

export default function ActionPromptModal({
  open,
  spec,
  onClose,
  onConfirm,
  busy = false,
  error = ''
}) {
  const headingId = useId();
  const descriptionId = useId();
  const fields = useMemo(() => (Array.isArray(spec?.fields) ? spec.fields : []), [spec]);

  const emptyValues = useMemo(() => {
    const initial = {};
    fields.forEach((field) => {
      initial[field.name] = field.defaultValue ?? '';
    });
    return initial;
  }, [fields]);

  const [values, setValues] = useState(emptyValues);
  const [touched, setTouched] = useState(false);
  const firstFieldRef = useRef(null);

  // Reset for each new action. Carrying a reason across actions would risk
  // recording the previous user's justification against this one.
  useEffect(() => {
    if (open) {
      setValues(emptyValues);
      setTouched(false);
    }
  }, [open, emptyValues, spec?.key]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => firstFieldRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  const errors = useMemo(() => {
    const next = {};
    fields.forEach((field) => {
      next[field.name] = validate(field, values[field.name], values);
    });
    return next;
  }, [fields, values]);

  const hasErrors = Object.values(errors).some(Boolean);
  const canSubmit = !hasErrors && !busy;

  const submit = useCallback(
    (event) => {
      event?.preventDefault?.();
      setTouched(true);
      if (!canSubmit) return;
      const payload = {};
      fields.forEach((field) => {
        // A checkbox holds a boolean. String()-ing it would send the literal
        // "true"/"false", which the server would then read as truthy strings.
        if (field.type === 'checkbox') {
          payload[field.name] = Boolean(values[field.name]);
          return;
        }
        const raw = String(values[field.name] ?? '').trim();
        payload[field.name] = field.transform ? field.transform(raw) : raw;
      });
      onConfirm?.(payload);
    },
    [canSubmit, fields, onConfirm, values]
  );

  if (!spec) return null;

  const tone = spec.tone || 'neutral';

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      busy={busy}
      labelledBy={headingId}
      describedBy={spec.description ? descriptionId : undefined}
    >
      <form onSubmit={submit} noValidate>
        <header className="modal-header">
          <div>
            <h2 id={headingId} className="modal-title">
              {spec.title}
            </h2>
            {spec.description ? (
              <p id={descriptionId} className="modal-subtitle">
                {spec.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <ModalContext items={spec.context} tone={tone}>
          {spec.message ? <p className="modal-context-message">{spec.message}</p> : null}
        </ModalContext>

        <div className="modal-body">
          {fields.map((field, index) => {
            const fieldId = `${headingId}-${field.name}`;
            const errorId = `${fieldId}-error`;
            const showError = touched && errors[field.name];
            const value = values[field.name] ?? '';
            const counter =
              field.maxLength && value.length > field.maxLength * 0.6
                ? `${value.length}/${field.maxLength}`
                : '';

            return (
              <div className="modal-field" key={field.name}>
                {field.type === 'checkbox' ? null : (
                  <div className="modal-field-head">
                    <label htmlFor={fieldId}>{field.label}</label>
                    {counter ? <span className="modal-field-counter">{counter}</span> : null}
                  </div>
                )}
                {field.type === 'checkbox' ? (
                  <label className="modal-checkbox">
                    <input
                      id={fieldId}
                      ref={index === 0 ? firstFieldRef : undefined}
                      type="checkbox"
                      checked={Boolean(value)}
                      disabled={busy}
                      onChange={(event) =>
                        setValues((prev) => ({ ...prev, [field.name]: event.target.checked }))
                      }
                    />
                    <span>{field.label}</span>
                  </label>
                ) : field.kind === 'textarea' ? (
                  <textarea
                    id={fieldId}
                    ref={index === 0 ? firstFieldRef : undefined}
                    className={`modal-input${showError ? ' is-invalid' : ''}`}
                    rows={3}
                    value={value}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    disabled={busy}
                    aria-invalid={showError ? 'true' : undefined}
                    aria-describedby={showError ? errorId : undefined}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                    }
                  />
                ) : (
                  <input
                    id={fieldId}
                    ref={index === 0 ? firstFieldRef : undefined}
                    className={`modal-input${showError ? ' is-invalid' : ''}`}
                    type={field.type || 'text'}
                    inputMode={field.inputMode}
                    autoComplete={field.autoComplete || 'off'}
                    value={value}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    disabled={busy}
                    aria-invalid={showError ? 'true' : undefined}
                    aria-describedby={showError ? errorId : undefined}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                    }
                  />
                )}
                {field.help && !showError ? (
                  <p className="modal-field-help">{field.help}</p>
                ) : null}
                {showError ? (
                  <p className="modal-field-error" id={errorId} role="alert">
                    {errors[field.name]}
                  </p>
                ) : null}
              </div>
            );
          })}

          {error ? (
            <p className="modal-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <ModalActions>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {spec.cancelLabel || 'Cancel'}
          </button>
          <button
            type="submit"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            disabled={busy || (touched && hasErrors)}
          >
            {busy ? spec.busyLabel || 'Working…' : spec.confirmLabel || 'Confirm'}
          </button>
        </ModalActions>
      </form>
    </ModalShell>
  );
}

/**
 * Destructive actions get a typed confirmation instead of `window.confirm`.
 *
 * A confirm dialog is dismissed reflexively — it is one click and most people
 * do not read it. Making the admin type the target's name (or a word) forces a
 * moment of attention, and it is the pattern already used for plan downgrades.
 */
export function buildDangerSpec({
  title,
  message,
  confirmWord,
  confirmLabel = 'Delete',
  context,
  reasonLabel = 'Reason',
  reasonPlaceholder = 'Why is this being removed?'
}) {
  return {
    title,
    tone: 'danger',
    message,
    context,
    confirmLabel,
    busyLabel: 'Working…',
    fields: [
      {
        name: 'reason',
        label: reasonLabel,
        kind: 'textarea',
        placeholder: reasonPlaceholder,
        maxLength: REASON_MAX_LENGTH,
        minLength: REASON_MIN_LENGTH,
        required: true
      },
      {
        name: 'confirmation',
        label: `Type ${confirmWord} to confirm`,
        placeholder: confirmWord,
        maxLength: NAME_MAX_LENGTH,
        required: true,
        validateLiteral: confirmWord,
        validateLiteralMessage: `Type ${confirmWord} exactly — this action cannot be undone.`
      }
    ]
  };
}

export { validate as validatePromptField };
