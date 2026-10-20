// components/AlertRuleModal.jsx
//
// Creating an alert rule used to be a one-field prompt: a title, with the
// backend's `severity` hardcoded to "warning", and `query` silently taken from
// whatever happened to be in the search box. Two consequences:
//
//   * Every rule was severity "warning" with no threshold, so an operator could
//     not express "critical if webhook failures exceed 5%".
//   * A rule created from the Logs tab inherited an unrelated search string the
//     operator had typed minutes earlier and forgotten about, quietly scoping
//     the alert to something they never chose.
//
// The backend already accepted service, severity, threshold, window, and notes.
// This form actually collects them, and shows a plain-language summary of what
// the rule will match before it is saved.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BellRing, Clock, Filter, Gauge, Server } from 'lucide-react';
import { ModalShell, ModalActions } from './ModalShell';

export const TITLE_MIN = 3;
export const TITLE_MAX = 140;
export const QUERY_MAX = 500;
export const NOTES_MAX = 500;

export const SEVERITY_OPTIONS = [
  { id: 'info', label: 'Info', hint: 'Record only' },
  { id: 'warning', label: 'Warning', hint: 'Needs a look' },
  { id: 'error', label: 'Error', hint: 'Act soon' },
  { id: 'critical', label: 'Critical', hint: 'Page someone' }
];

export const SERVICE_OPTIONS = [
  { id: '', label: 'Any service' },
  { id: 'web', label: 'Web' },
  { id: 'api', label: 'API' },
  { id: 'db', label: 'Database' },
  { id: 'auth', label: 'Auth' },
  { id: 'billing', label: 'Billing' },
  { id: 'worker', label: 'Worker' },
  { id: 'cron', label: 'Scheduled jobs' }
];

export const WINDOW_OPTIONS = [
  { id: '5m', label: 'Last 5 minutes' },
  { id: '15m', label: 'Last 15 minutes' },
  { id: '1h', label: 'Last hour' },
  { id: '6h', label: 'Last 6 hours' },
  { id: '24h', label: 'Last 24 hours' }
];

const EMPTY = {
  title: '',
  query: '',
  service: '',
  severity: 'warning',
  threshold: '',
  window: '15m',
  notes: ''
};

export default function AlertRuleModal({
  open,
  onClose,
  onSubmit,
  busy = false,
  error = '',
  seedQuery = '',
  seedService = ''
}) {
  const [draft, setDraft] = useState(EMPTY);
  const [touched, setTouched] = useState(false);

  // Seed from the current log context when the modal opens, but keep it visible
  // and editable — the old prompt absorbed the search box silently, which is
  // exactly how a rule ended up scoped to an unrelated string.
  useEffect(() => {
    if (!open) return;
    setDraft({ ...EMPTY, query: String(seedQuery || ''), service: String(seedService || '') });
    setTouched(false);
  }, [open, seedQuery, seedService]);

  const set = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const title = draft.title.trim();
  const query = draft.query.trim();
  const service = draft.service;

  const errors = useMemo(() => {
    const next = {};
    if (!title) next.title = 'Give the alert a name.';
    else if (title.length < TITLE_MIN) next.title = `Use at least ${TITLE_MIN} characters.`;
    else if (title.length > TITLE_MAX) next.title = `Keep it under ${TITLE_MAX} characters.`;

    // An unscoped rule matches everything, which produces noise rather than
    // signal. The server enforces this too.
    if (!query && !service) {
      next.scope = 'Add a query, choose a service, or both — an unscoped alert matches every event.';
    }

    if (draft.threshold !== '') {
      const n = Number(draft.threshold);
      if (!Number.isFinite(n) || n < 0) next.threshold = 'Threshold must be zero or a positive number.';
      else if (n > 1_000_000) next.threshold = 'That threshold is unrealistically large.';
    }
    return next;
  }, [title, query, service, draft.threshold]);

  const canSubmit = Object.keys(errors).length === 0 && !busy;

  const summary = useMemo(() => {
    const scope = [];
    if (query) scope.push(`messages matching “${query}”`);
    if (service) scope.push(`the ${SERVICE_OPTIONS.find((s) => s.id === service)?.label || service} service`);
    const where = scope.length ? scope.join(' in ') : 'every event';
    const window = WINDOW_OPTIONS.find((w) => w.id === draft.window)?.label || 'the window';
    const threshold = draft.threshold !== '' ? `, at more than ${draft.threshold} occurrences` : '';
    const severity = SEVERITY_OPTIONS.find((s) => s.id === draft.severity)?.label || 'Warning';
    return `Raises a ${severity} alert for ${where}, over ${window.toLowerCase()}${threshold}.`;
  }, [query, service, draft.window, draft.threshold, draft.severity]);

  const handleSubmit = (event) => {
    event.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    onSubmit?.({
      title,
      query,
      service,
      severity: draft.severity,
      threshold: draft.threshold === '' ? null : Number(draft.threshold),
      window: draft.window,
      notes: draft.notes.trim()
    });
  };

  const show = (key) => (touched ? errors[key] : undefined);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      busy={busy}
      labelledBy="alert-rule-title"
      describedBy="alert-rule-desc"
      size="wide"
    >
      <form onSubmit={handleSubmit} noValidate>
        <header className="modal-header">
          <div>
            <h2 className="modal-title" id="alert-rule-title">
              <BellRing size={16} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '7px' }} />
              Create an alert
            </h2>
            <p className="modal-subtitle" id="alert-rule-desc">
              Alerts surface on the Overview and can be emailed to notification recipients.
            </p>
          </div>
        </header>

        <div className="modal-body">
          <div className="modal-field">
            <div className="modal-field-head">
              <label htmlFor="alert-title">Name</label>
              <span className="modal-field-counter">{title.length}/{TITLE_MAX}</span>
            </div>
            <input
              id="alert-title"
              className={`modal-input${show('title') ? ' is-invalid' : ''}`}
              value={draft.title}
              maxLength={TITLE_MAX}
              placeholder="e.g. Webhook failures above 5%"
              disabled={busy}
              onChange={(event) => set('title', event.target.value)}
              aria-invalid={Boolean(show('title'))}
              aria-describedby={show('title') ? 'alert-title-error' : undefined}
            />
            {show('title') && <p className="modal-field-error" id="alert-title-error">{show('title')}</p>}
          </div>

          <fieldset className="alert-fieldset">
            <legend>
              <Filter size={13} aria-hidden="true" /> What it watches
            </legend>
            <div className="alert-scope-grid">
              <div className="modal-field">
                <div className="modal-field-head">
                  <label htmlFor="alert-query">Query</label>
                  <span className="modal-field-counter">{query.length}/{QUERY_MAX}</span>
                </div>
                <input
                  id="alert-query"
                  className="modal-input"
                  value={draft.query}
                  maxLength={QUERY_MAX}
                  placeholder="e.g. webhook, timeout, 502"
                  disabled={busy}
                  onChange={(event) => set('query', event.target.value)}
                />
                <p className="modal-field-help">Matched against log messages. Case-insensitive.</p>
              </div>

              <div className="modal-field">
                <div className="modal-field-head">
                  <label htmlFor="alert-service">
                    <Server size={12} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '5px' }} />
                    Service
                  </label>
                </div>
                <select
                  id="alert-service"
                  className="modal-input"
                  value={draft.service}
                  disabled={busy}
                  onChange={(event) => set('service', event.target.value)}
                >
                  {SERVICE_OPTIONS.map((option) => (
                    <option key={option.id || 'any'} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {show('scope') && <p className="modal-field-error">{show('scope')}</p>}
          </fieldset>

          <fieldset className="alert-fieldset">
            <legend>
              <AlertTriangle size={13} aria-hidden="true" /> When it fires
            </legend>

            <div className="modal-field">
              <span className="modal-field-label">Severity</span>
              <div className="alert-severity-row" role="radiogroup" aria-label="Severity">
                {SEVERITY_OPTIONS.map((option) => {
                  const active = draft.severity === option.id;
                  return (
                    <button
                      type="button"
                      key={option.id}
                      role="radio"
                      aria-checked={active}
                      className={`alert-severity alert-severity--${option.id}${active ? ' is-active' : ''}`}
                      disabled={busy}
                      onClick={() => set('severity', option.id)}
                    >
                      <span className="alert-severity-label">{option.label}</span>
                      <span className="alert-severity-hint">{option.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="alert-scope-grid alert-scope-grid--two">
              <div className="modal-field">
                <div className="modal-field-head">
                  <label htmlFor="alert-threshold">
                    <Gauge size={12} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '5px' }} />
                    Threshold (optional)
                  </label>
                </div>
                <input
                  id="alert-threshold"
                  className={`modal-input${show('threshold') ? ' is-invalid' : ''}`}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={draft.threshold}
                  placeholder="e.g. 10"
                  disabled={busy}
                  onChange={(event) => set('threshold', event.target.value)}
                />
                {show('threshold')
                  ? <p className="modal-field-error">{show('threshold')}</p>
                  : <p className="modal-field-help">Leave blank to alert on any match.</p>}
              </div>

              <div className="modal-field">
                <div className="modal-field-head">
                  <label htmlFor="alert-window">
                    <Clock size={12} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '5px' }} />
                    Evaluation window
                  </label>
                </div>
                <select
                  id="alert-window"
                  className="modal-input"
                  value={draft.window}
                  disabled={busy}
                  onChange={(event) => set('window', event.target.value)}
                >
                  {WINDOW_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <div className="modal-field">
            <div className="modal-field-head">
              <label htmlFor="alert-notes">Notes (optional)</label>
              <span className="modal-field-counter">{draft.notes.length}/{NOTES_MAX}</span>
            </div>
            <textarea
              id="alert-notes"
              className="modal-input"
              rows={2}
              maxLength={NOTES_MAX}
              value={draft.notes}
              placeholder="Context for whoever picks this up"
              disabled={busy}
              onChange={(event) => set('notes', event.target.value)}
            />
          </div>

          {/* Plain-language restatement, so the operator confirms what the rule
              will actually do rather than what they meant it to do. */}
          <p className="alert-summary">
            <BellRing size={13} aria-hidden="true" />
            <span>{summary}</span>
          </p>

          {error && <p className="modal-error" role="alert">{error}</p>}
        </div>

        <ModalActions>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Discard
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? 'Creating…' : 'Create alert'}
          </button>
        </ModalActions>
      </form>
    </ModalShell>
  );
}
