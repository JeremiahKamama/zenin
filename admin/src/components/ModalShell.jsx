/**
 * Zenin Admin — shared modal shell.
 *
 * Every dialog in the console previously used `window.prompt` or
 * `window.confirm`. Those are unusable here for four reasons:
 *
 *  1. They are BLOCKING. `window.prompt` freezes the whole JS thread, so any
 *     in-flight request, websocket message or timer is stalled behind it. On a
 *     console that polls for alerts, that is a real hazard.
 *  2. They cannot be styled, so they read as a browser warning rather than a
 *     product surface — and they render the origin URL, which looks untrustworthy.
 *  3. They give no context. "Reason for retrying Snowflake:" is the entire
 *     prompt; the admin cannot see which integration, its last error, or when
 *     it last succeeded. The reason they type is therefore uninformed, which
 *     defeats the point of an audit trail.
 *  4. Safari and Firefox let the user suppress further dialogs, after which
 *     these calls return null silently and the action appears to do nothing.
 *
 * This shell centralises the behaviour that every one of them needs: focus
 * trapping, Escape to dismiss, restore focus on close, scroll lock, and an
 * accessible name. Exit is faster than entry, and the write is never
 * cancellable mid-flight.
 */

import { useCallback, useEffect, useId, useRef } from 'react';

export function ModalShell({
  open,
  onClose,
  busy = false,
  labelledBy,
  describedBy,
  size = 'default',
  children
}) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);

  // Remember what had focus so it can be returned on close. Without this the
  // caret is dumped on <body> and keyboard users lose their place entirely.
  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement;
    return () => {
      const target = restoreFocusRef.current;
      if (target && typeof target.focus === 'function' && document.contains(target)) {
        target.focus();
      }
    };
  }, [open]);

  // Move focus into the dialog on open, preferring the first real control.
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelector(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href]'
      );
      (focusable || root).focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  // Escape dismisses, except while a write is in flight: cancelling mid-write
  // would leave the admin unsure whether the change was applied.
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

  // Trap focus. Without this, Tab walks into the page behind the overlay and
  // the admin can activate a control they cannot see.
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

  // Lock background scroll while open, and compensate for the scrollbar so the
  // layout behind does not shift sideways on desktop.
  useEffect(() => {
    if (!open) return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
  }, [open]);

  // Only a press that STARTED on the overlay may dismiss. A drag that begins
  // inside the dialog and releases outside would otherwise close it and discard
  // whatever the admin had typed.
  const pressedOverlayRef = useRef(false);
  const onOverlayPointerDown = useCallback((event) => {
    pressedOverlayRef.current = event.target === event.currentTarget;
  }, []);
  const onOverlayPointerUp = useCallback(
    (event) => {
      if (pressedOverlayRef.current && event.target === event.currentTarget && !busy) {
        onClose?.();
      }
      pressedOverlayRef.current = false;
    },
    [busy, onClose]
  );

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onPointerDown={onOverlayPointerDown}
      onPointerUp={onOverlayPointerUp}
    >
      <div
        ref={dialogRef}
        className={`modal-container${size === 'wide' ? ' modal-container--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Context for the action being confirmed, shown above the form.
 *
 * Native prompts had nowhere to put this, so the admin acted on a one-line
 * question with no idea what they were acting on. `items` renders as a
 * definition list — real labels and values, not a run-on sentence.
 */
export function ModalContext({ items = [], tone = 'neutral', children }) {
  const visible = items.filter((item) => item && item.value !== undefined && item.value !== null && item.value !== '');
  if (!visible.length && !children) return null;
  return (
    <div className={`modal-context${tone === 'danger' ? ' is-danger' : ''}`}>
      {children}
      {visible.length ? (
        <dl className="modal-context-list">
          {visible.map((item) => (
            <div className="modal-context-row" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function ModalActions({ children }) {
  return <div className="modal-actions">{children}</div>;
}
