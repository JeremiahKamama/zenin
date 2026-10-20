/**
 * Zenin Admin — notification recipients manager.
 *
 * Replaces a `showPlaceholder` toast that read "Recipient manager opened." and
 * opened nothing. The seven notification toggles on the Settings page had no
 * recipients to deliver to and no transport, so "Notifications" was a category
 * label rather than a feature.
 *
 * This is the missing half: who receives admin notifications, which categories
 * each person gets, and a real test send so delivery can be proven rather than
 * assumed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModalShell, ModalActions } from './ModalShell.jsx';
import { REASON_MAX_LENGTH } from './ActionPromptModal.jsx';

const CATEGORY_OPTIONS = [
  { id: 'system', label: 'System & incidents' },
  { id: 'security', label: 'Security' },
  { id: 'billing', label: 'Billing' },
  { id: 'summary', label: 'Weekly summary' }
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function RecipientManagerModal({
  open,
  onClose,
  recipients = [],
  deliveries = [],
  loading = false,
  busy = false,
  error = '',
  onAdd,
  onUpdate,
  onRemove,
  onSendTest
}) {
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [categories, setCategories] = useState(['system', 'security', 'billing']);
  const [draftError, setDraftError] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setLabel('');
      setCategories(['system', 'security', 'billing']);
      setDraftError('');
      setTestResult(null);
    }
  }, [open]);

  const toggleCategory = useCallback((id) => {
    setCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }, []);

  const submit = useCallback(
    (event) => {
      event.preventDefault();
      const trimmed = email.trim();
      if (!EMAIL_PATTERN.test(trimmed)) {
        setDraftError('Enter a valid email address.');
        return;
      }
      if (!categories.length) {
        setDraftError('Choose at least one category, or this address will never be mailed.');
        return;
      }
      setDraftError('');
      onAdd?.({ email: trimmed.toLowerCase(), label: label.trim(), categories });
      setEmail('');
      setLabel('');
    },
    [categories, email, label, onAdd]
  );

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await onSendTest?.();
      setTestResult(result || { sent: 0, attempted: 0, results: [] });
    } catch (err) {
      setTestResult({ error: err?.message || 'Test send failed.' });
    } finally {
      setTesting(false);
    }
  }, [onSendTest]);

  const activeCount = useMemo(
    () => recipients.filter((row) => row.isActive).length,
    [recipients]
  );

  if (!open) return null;

  return (
    <ModalShell open={open} onClose={onClose} busy={busy} size="wide" labelledBy="recipients-heading">
      <header className="modal-header">
        <div>
          <h2 id="recipients-heading" className="modal-title">
            Notification recipients
          </h2>
          <p className="modal-subtitle">
            {activeCount
              ? `${activeCount} active ${activeCount === 1 ? 'address' : 'addresses'} receive admin notifications.`
              : 'No active recipients — admin notifications are being recorded but not emailed.'}
          </p>
        </div>
        <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Close">
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="modal-body">
        <form className="recipient-form" onSubmit={submit} noValidate>
          <div className="recipient-form-row">
            <div className="modal-field">
              <div className="modal-field-head">
                <label htmlFor="recipient-email">Email address</label>
              </div>
              <input
                id="recipient-email"
                className={`modal-input${draftError ? ' is-invalid' : ''}`}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="ops@zenin.capital"
                value={email}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="modal-field">
              <div className="modal-field-head">
                <label htmlFor="recipient-label">Label (optional)</label>
              </div>
              <input
                id="recipient-label"
                className="modal-input"
                placeholder="On-call engineer"
                value={label}
                maxLength={120}
                disabled={busy}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </div>

          <fieldset className="recipient-categories">
            <legend>Send them</legend>
            <div className="recipient-category-grid">
              {CATEGORY_OPTIONS.map((option) => (
                <label key={option.id} className="recipient-category">
                  <input
                    type="checkbox"
                    checked={categories.includes(option.id)}
                    disabled={busy}
                    onChange={() => toggleCategory(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {draftError ? (
            <p className="modal-field-error" role="alert">
              {draftError}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add recipient
          </button>
        </form>

        {error ? (
          <p className="modal-error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="recipient-list" aria-live="polite">
          <h3 className="recipient-list-heading">Current recipients</h3>
          {loading ? (
            <p className="recipient-empty">Loading…</p>
          ) : recipients.length === 0 ? (
            <p className="recipient-empty">
              None yet. Add an address above, or admin notifications will only be recorded in the
              delivery log below.
            </p>
          ) : (
            <ul className="recipient-items">
              {recipients.map((recipient) => (
                <li key={recipient.id} className={`recipient-item${recipient.isActive ? '' : ' is-inactive'}`}>
                  <div className="recipient-item-main">
                    <span className="recipient-item-email">{recipient.email}</span>
                    {recipient.label ? (
                      <span className="recipient-item-label">{recipient.label}</span>
                    ) : null}
                  </div>
                  <div className="recipient-item-categories">
                    {CATEGORY_OPTIONS.map((option) => {
                      const on = recipient.categories?.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`recipient-chip${on ? ' is-on' : ''}`}
                          disabled={busy}
                          aria-pressed={Boolean(on)}
                          title={`${on ? 'Stop' : 'Start'} sending ${option.label.toLowerCase()}`}
                          onClick={() =>
                            onUpdate?.(recipient.id, {
                              categories: on
                                ? recipient.categories.filter((c) => c !== option.id)
                                : [...(recipient.categories || []), option.id]
                            })
                          }
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="recipient-item-actions">
                    <button
                      type="button"
                      className="btn btn-secondary recipient-mini"
                      disabled={busy}
                      onClick={() => onUpdate?.(recipient.id, { isActive: !recipient.isActive })}
                    >
                      {recipient.isActive ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger recipient-mini"
                      disabled={busy}
                      onClick={() => onRemove?.(recipient)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="delivery-log">
          <div className="delivery-log-head">
            <h3 className="recipient-list-heading">Recent deliveries</h3>
            <button
              type="button"
              className="btn btn-secondary recipient-mini"
              onClick={runTest}
              disabled={testing || busy || !activeCount}
            >
              {testing ? 'Sending…' : 'Send test email'}
            </button>
          </div>

          {testResult ? (
            <p
              className={`delivery-test-result${testResult.error || !testResult.sent ? ' is-failure' : ''}`}
              role="status"
            >
              {testResult.error
                ? testResult.error
                : testResult.sent
                  ? `Test delivered to ${testResult.sent} of ${testResult.attempted} recipients.`
                  : `Test failed for all ${testResult.attempted} recipients. Check the provider configuration.`}
            </p>
          ) : null}

          {deliveries.length === 0 ? (
            <p className="recipient-empty">
              Nothing sent yet. A delivery appears here only when the provider accepted the message, so
              this list is the record of what actually left the system.
            </p>
          ) : (
            <ul className="delivery-items">
              {deliveries.map((row) => (
                <li key={row.id} className="delivery-item">
                  <span className={`delivery-status delivery-status--${row.status}`}>
                    {row.status}
                  </span>
                  <span className="delivery-subject">{row.subject || row.eventType || row.category}</span>
                  <span className="delivery-recipient">{row.recipient}</span>
                  <span className="delivery-time">{formatTimestamp(row.createdAt)}</span>
                  {row.error ? (
                    <span className="delivery-error" title={row.error}>
                      {row.error}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ModalActions>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Done
        </button>
      </ModalActions>
    </ModalShell>
  );
}

export { CATEGORY_OPTIONS, REASON_MAX_LENGTH };
