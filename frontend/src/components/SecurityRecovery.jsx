// SecurityRecovery.jsx — Phase 5 backend-driven security surface.
// Isolated from the Supabase-TOTP 2FA panel so it never disturbs that flow.
// - OAuth providers are rendered from backend configuration (only enabled
//   providers are returned; archived providers like "apple" are excluded
//   server-side and skipped defensively here).
// - 2FA backup-code regeneration calls the Zenin backend. Codes are returned
//   ONCE and are held ONLY in component state; they are cleared on unmount and
//   never written to localStorage or parent state.
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { fetchOAuthProviders, regenerateZeninBackupCodes } from "@/utils/backendAuth";

const ARCHIVED_PROVIDERS = new Set(["apple"]);
const PROVIDER_LABELS = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  apple: "Apple",
};

function providerLabel(provider) {
  const key = String(provider || "").trim().toLowerCase();
  return PROVIDER_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

export default function SecurityRecovery({ twoFactorEnabled = false }) {
  const [providers, setProviders] = useState([]);
  const [providersError, setProvidersError] = useState(null);

  const [isConfirming, setIsConfirming] = useState(false);
  const [isRegen, setIsRegen] = useState(false);
  const [codes, setCodes] = useState([]); // one-time secrets; never persisted
  const [regenError, setRegenError] = useState(null);
  const codesRef = useRef([]);
  codesRef.current = codes;

  // Clear one-time codes on unmount so they are never retained.
  useEffect(() => () => { codesRef.current = []; }, []);

  const loadProviders = useCallback(async () => {
    try {
      const list = await fetchOAuthProviders();
      setProviders(Array.isArray(list) ? list.filter((p) => !ARCHIVED_PROVIDERS.has(String(p).toLowerCase())) : []);
      setProvidersError(null);
    } catch (err) {
      setProvidersError(err?.message || "Could not load sign-in providers.");
      setProviders([]);
    }
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const handleRegenerate = async () => {
    setIsRegen(true);
    setRegenError(null);
    try {
      const result = await regenerateZeninBackupCodes();
      setCodes(Array.isArray(result.backupCodes) ? result.backupCodes : []);
      setIsConfirming(false);
    } catch (err) {
      setRegenError(err?.message || "Could not regenerate backup codes.");
    } finally {
      setIsRegen(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
    } catch {
      /* clipboard unavailable — non-fatal */
    }
  };

  const downloadCodes = () => {
    try {
      const blob = new Blob([codes.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "zenin-backup-codes.txt";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* download unavailable — non-fatal */
    }
  };

  const dismissCodes = () => setCodes([]); // user acknowledged; drop secrets

  return (
    <div className="settings-panel">
      {/* OAuth providers (backend-sourced) */}
      <div className="px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
        <h4 className="text-[var(--color-text-primary)] font-medium m-0" style={{ marginBottom: 8 }}>
          Connected sign-in providers
        </h4>
        {providersError ? (
          <p className="text-[13px] text-[var(--color-text-secondary)] m-0">{providersError}</p>
        ) : providers.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)] m-0">No additional sign-in providers are enabled.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {providers.map((p) => (
              <span
                key={String(p)}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]"
              >
                {providerLabel(p)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Backup-code regeneration (backend) */}
      <div className="px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
        <h4 className="text-[var(--color-text-primary)] font-medium m-0" style={{ marginBottom: 6 }}>
          2FA backup codes
        </h4>
        {!twoFactorEnabled ? (
          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
            Enable two-factor authentication to generate recovery backup codes.
          </p>
        ) : codes.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <p className="text-[13px] text-[var(--color-warning)] font-medium m-0" style={{ marginBottom: 8 }}>
              Save these codes now. Each works once, and your old codes are invalidated.
            </p>
            <div className="grid grid-cols-2 gap-2" style={{ marginBottom: 10 }}>
              {codes.map((code) => (
                <code key={code} className="text-[13px] p-2 rounded-md bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
                  {code}
                </code>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={cn(buttonVariants({ variant: "secondary" }))} onClick={copyCodes}>Copy</button>
              <button className={cn(buttonVariants({ variant: "secondary" }))} onClick={downloadCodes}>Download</button>
              <button className={cn(buttonVariants({ variant: "default" }))} onClick={dismissCodes}>Done</button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginBottom: 10 }}>
              Generate a fresh set of one-time recovery codes. Your previous codes will stop working.
            </p>
            {isConfirming ? (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-[13px] text-[var(--color-warning)]">Regenerate and invalidate old codes?</span>
                <button
                  className={cn(buttonVariants({ variant: "destructive" }))}
                  onClick={handleRegenerate}
                  disabled={isRegen}
                >
                  {isRegen ? "Regenerating…" : "Confirm regenerate"}
                </button>
                <button
                  className={cn(buttonVariants({ variant: "secondary" }))}
                  onClick={() => setIsConfirming(false)}
                  disabled={isRegen}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className={cn(buttonVariants({ variant: "secondary" }))}
                onClick={() => setIsConfirming(true)}
                disabled={isRegen}
              >
                Regenerate backup codes
              </button>
            )}
            {regenError ? (
              <p className="text-[13px] text-[var(--color-danger)] font-medium mt-2 m-0">{regenError}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
