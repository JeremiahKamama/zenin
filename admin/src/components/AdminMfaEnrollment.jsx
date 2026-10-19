/**
 * AdminMfaEnrollment — in-console second-factor enrollment.
 *
 * WHY THIS EXISTS
 * ---------------
 * `requireAdmin` refuses admin data with ADMIN_MFA_REQUIRED until the account has
 * a second factor. The only enrollment UI lived in the CLIENT app's personal
 * profile page, so the console told operators to go enable 2FA "in Settings" and
 * linked them to their user profile — a different product surface, for a
 * different account concept. The console now enrolls the factor itself.
 *
 * Enrollment uses the backend's own TOTP endpoints (`/api/auth/2fa/generate` ->
 * `/api/auth/2fa/enable`) rather than Supabase, because those are what actually
 * set `twoFactorEnabled` on the account the admin gate reads.
 *
 * SECURITY NOTES
 * --------------
 * - The TOTP secret is held in component state only. It is never persisted to
 *   localStorage or sessionStorage, and is dropped on unmount.
 * - Backup codes are shown ONCE (the API returns them a single time) and are also
 *   state-only. `hasAcknowledgedCodes` gates dismissal so they cannot be lost by
 *   an accidental click.
 * - `/api/auth/2fa/enable` rotates the session and re-issues the cookie. The
 *   caller must reload admin data afterwards, since the old session is revoked.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Shield, KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';
import { authApiFetch } from '../utils/adminFetch';

function CopyableSecret({ value }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context / permissions). The secret is
      // visible and selectable, so this is a convenience failure, not a blocker.
      setCopied(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
      <code
        style={{
          flex: 1,
          padding: '10px 12px',
          background: 'var(--bg-app)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          fontSize: '13px',
          letterSpacing: '0.08em',
          wordBreak: 'break-all',
          userSelect: 'all'
        }}
      >
        {value}
      </code>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={copy}
        style={{ height: '38px', flexShrink: 0 }}
        aria-label="Copy setup key"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        <span style={{ marginLeft: '6px' }}>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

export default function AdminMfaEnrollment({ onEnrolled }) {
  const [step, setStep] = useState('intro'); // intro | scan | codes
  const [setup, setSetup] = useState(null);  // { secret, qrCodeDataUrl }
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [backupCodes, setBackupCodes] = useState([]);
  const [hasAcknowledgedCodes, setHasAcknowledgedCodes] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Drop the secret when the panel goes away.
  useEffect(() => () => { setSetup(null); setBackupCodes([]); }, []);

  const beginEnrollment = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await authApiFetch('/auth/2fa/generate');
      if (!data?.secret || !data?.qrCodeDataUrl) {
        throw new Error('The server did not return a setup key. Please try again.');
      }
      setSetup({ secret: data.secret, qrCodeDataUrl: data.qrCodeDataUrl });
      setCode('');
      setStep('scan');
    } catch (err) {
      setError(err?.message || 'Could not start authenticator setup.');
    } finally {
      setBusy(false);
    }
  }, []);

  const submitCode = useCallback(async (event) => {
    event.preventDefault();
    const clean = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (clean.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await authApiFetch('/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ method: 'authenticator', verificationCode: clean, secret: setup?.secret })
      });
      setBackupCodes(Array.isArray(data?.backupCodes) ? data.backupCodes : []);
      setStep('codes');
    } catch (err) {
      // The endpoint returns 400 for a wrong/expired code; surface that plainly.
      setError(err?.message || 'That code was not accepted. Check your device clock and try again.');
    } finally {
      setBusy(false);
    }
  }, [code, setup]);

  const copyAllCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    } catch {
      setCopiedCodes(false);
    }
  }, [backupCodes]);

  const downloadCodes = useCallback(() => {
    const body = [
      'Zenin Capital — admin backup codes',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Each code works once. Store these somewhere safe and offline.',
      '',
      ...backupCodes
    ].join('\n');
    const blob = new Blob([body], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'zenin-admin-backup-codes.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [backupCodes]);

  const frame = {
    padding: '40px',
    margin: '40px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    maxWidth: '640px'
  };

  // --- Step 3: backup codes shown once -------------------------------------
  if (step === 'codes') {
    return (
      <div style={frame}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <KeyRound size={26} color="var(--accent)" />
          <h3 style={{ margin: 0 }}>Save your backup codes</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Two-factor authentication is now on. These codes are shown <strong>once</strong> — each
          one signs you in a single time if you lose your authenticator.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '8px',
            margin: '20px 0',
            padding: '16px',
            background: 'var(--bg-app)',
            border: '1px solid var(--border)',
            borderRadius: '8px'
          }}
        >
          {backupCodes.length ? backupCodes.map((entry) => (
            <code key={entry} style={{ fontSize: '13px', letterSpacing: '0.06em', userSelect: 'all' }}>{entry}</code>
          )) : (
            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              No backup codes were returned. You can regenerate them later.
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {backupCodes.length ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={copyAllCodes}>
                {copiedCodes ? <Check size={14} /> : <Copy size={14} />}
                <span style={{ marginLeft: '6px' }}>{copiedCodes ? 'Copied' : 'Copy all'}</span>
              </button>
              <button type="button" className="btn btn-secondary" onClick={downloadCodes}>
                Download as .txt
              </button>
            </>
          ) : null}
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '24px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={hasAcknowledgedCodes}
            onChange={(event) => setHasAcknowledgedCodes(event.target.checked)}
            style={{ marginTop: '3px' }}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            I have saved these backup codes somewhere safe.
          </span>
        </label>

        <button
          type="button"
          className="btn btn-primary"
          disabled={!hasAcknowledgedCodes}
          style={{ marginTop: '16px', opacity: hasAcknowledgedCodes ? 1 : 0.6 }}
          onClick={() => onEnrolled?.()}
        >
          Reload admin data
        </button>
      </div>
    );
  }

  // --- Step 2: scan + verify ------------------------------------------------
  if (step === 'scan' && setup) {
    return (
      <div style={frame}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <Shield size={26} color="var(--accent)" />
          <h3 style={{ margin: 0 }}>Set up your authenticator</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Scan this QR code with an authenticator app (1Password, Google Authenticator, Authy),
          then enter the 6-digit code it shows.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0' }}>
          <img
            src={setup.qrCodeDataUrl}
            alt="QR code for authenticator setup"
            width={200}
            height={200}
            style={{ background: '#fff', padding: '12px', borderRadius: '8px' }}
          />
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
          Can&apos;t scan? Enter this key manually:
        </p>
        <CopyableSecret value={setup.secret} />

        <form onSubmit={submitCode} style={{ marginTop: '24px' }}>
          <label htmlFor="admin-totp-code" style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            6-digit code
          </label>
          <input
            id="admin-totp-code"
            className="search-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            value={code}
            onChange={(event) => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }}
            style={{ height: '44px', fontSize: '18px', letterSpacing: '0.3em', maxWidth: '200px' }}
          />

          {error ? (
            <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '10px' }}>{error}</p>
          ) : null}

          <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6} style={{ opacity: busy || code.length !== 6 ? 0.6 : 1 }}>
              {busy ? 'Verifying…' : 'Verify and enable'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => { setSetup(null); setCode(''); setError(null); setStep('intro'); }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  // --- Step 1: explain -----------------------------------------------------
  return (
    <div style={frame}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <Shield size={28} color="var(--accent)" />
        <h3 style={{ margin: 0 }}>Two-factor authentication required</h3>
      </div>

      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '12px' }}>
        Your admin account is signed in, but admin data stays locked until a second factor is
        enrolled. This is a security requirement, not an outage — retrying without enrolling will
        keep failing.
      </p>

      <div
        style={{
          display: 'flex',
          gap: '10px',
          padding: '12px 14px',
          background: 'var(--accent-soft)',
          borderRadius: '8px',
          marginBottom: '20px'
        }}
      >
        <AlertTriangle size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: '2px' }} />
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Enrolling here signs out your other sessions. This is expected after a security change.
        </p>
      </div>

      {error ? (
        <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>
      ) : null}

      <button type="button" className="btn btn-primary" onClick={beginEnrollment} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Preparing…' : 'Set up authenticator app'}
      </button>
    </div>
  );
}
