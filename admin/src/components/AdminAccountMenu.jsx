// components/AdminAccountMenu.jsx
//
// The identity control in the top navigation.
//
// Previously this was a static chip: an avatar, a name, and a ChevronDown that
// implied a menu and opened nothing. The console never showed which admin was
// acting, and an operator holding both a day-to-day account and a break-glass
// account had to sign out and complete the emailed-code flow again to swap.
//
// This makes the chip a real menu:
//   * shows the active identity and its role
//   * lists the other admin accounts and switches to one on click
//   * states plainly that switching ends the current session
//
// Switching is a privilege change, so the server additionally requires a recent
// re-authentication. When it answers 428 we surface that as a password prompt
// rather than a dead error — the operator should not have to guess why the
// switch was refused.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ShieldCheck, Check, LogOut, UserCog, RefreshCw } from 'lucide-react';
import { avatarInitials } from '../utils/initials';

function roleLabel(role) {
  switch (String(role || '').toLowerCase()) {
    case 'super_admin': return 'Super admin';
    case 'admin': return 'Admin';
    case 'support': return 'Support';
    case 'analyst': return 'Analyst';
    case 'user': return 'User';
    default: return 'Admin';
  }
}

export function AdminAccountMenu({
  user,
  accounts = [],
  loading = false,
  switchingTo = null,
  error = '',
  onSwitch,
  onRefresh,
  onSignOut,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  // Close on outside click and on Escape, restoring focus to the trigger.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Fetch the roster the first time the menu is opened rather than on mount:
  // most sessions never open it, and it is an admin-only request.
  useEffect(() => {
    if (open && accounts.length === 0 && !loading) onRefresh?.();
  }, [open, accounts.length, loading, onRefresh]);

  const currentUserId = user?.id != null ? Number(user.id) : null;

  const others = useMemo(
    () => accounts.filter((entry) => Number(entry.id) !== currentUserId),
    [accounts, currentUserId]
  );

  const displayName = user?.displayName || user?.email || 'Administrator';
  const initials = avatarInitials({ name: user?.displayName, email: user?.email }, 'AD');

  const handleSwitch = useCallback(async (account) => {
    setOpen(false);
    await onSwitch?.(account);
  }, [onSwitch]);

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Signed in as ${displayName}. Open account menu.`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar" aria-hidden="true">{initials}</span>
        <span className="account-identity">
          <span className="account-name">{displayName}</span>
          <span className="account-email">{user?.email || 'unknown account'}</span>
        </span>
        <ChevronDown size={14} className={`account-chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="account-popover" role="menu" aria-label="Account">
          <div className="account-popover-head">
            <span className="account-avatar account-avatar--lg" aria-hidden="true">{initials}</span>
            <div className="account-popover-identity">
              <p className="account-popover-name">{displayName}</p>
              <p className="account-popover-email">{user?.email || 'unknown account'}</p>
              <span className="account-role-badge">
                <ShieldCheck size={11} aria-hidden="true" />
                {roleLabel(user?.adminRole)}
              </span>
            </div>
          </div>

          <div className="account-section">
            <div className="account-section-head">
              <span id="account-switch-label">Switch account</span>
              <button
                type="button"
                className="account-refresh"
                onClick={() => onRefresh?.()}
                disabled={loading}
                title="Reload the list of admin accounts"
                aria-label="Reload the list of admin accounts"
              >
                <RefreshCw size={12} className={loading ? 'is-spinning' : undefined} aria-hidden="true" />
              </button>
            </div>

            {error && <p className="account-error" role="alert">{error}</p>}

            {loading && others.length === 0 && (
              <p className="account-hint">Loading admin accounts…</p>
            )}

            {!loading && others.length === 0 && !error && (
              <p className="account-hint">
                No other admin accounts. Add an administrator from Users to switch between identities.
              </p>
            )}

            <ul className="account-list" aria-labelledby="account-switch-label">
              {others.map((account) => {
                const busy = Number(switchingTo) === Number(account.id);
                return (
                  <li key={account.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className="account-option"
                      onClick={() => handleSwitch(account)}
                      disabled={Boolean(switchingTo)}
                      aria-busy={busy}
                    >
                      <span className="account-avatar account-avatar--sm" aria-hidden="true">
                        {avatarInitials({ name: account.displayName, email: account.email }, 'AD')}
                      </span>
                      <span className="account-option-text">
                        <span className="account-option-name">{account.displayName || account.email}</span>
                        <span className="account-option-meta">
                          {account.email} · {roleLabel(account.adminRole)}
                        </span>
                      </span>
                      {busy ? <RefreshCw size={13} className="is-spinning" aria-hidden="true" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="account-note">
              Switching signs this session out and requires your password again. Actions are
              recorded against the account that performs them.
            </p>
          </div>

          <button type="button" role="menuitem" className="account-action" onClick={onSignOut}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default AdminAccountMenu;
