import { zeninFetchJson } from "./zeninFetch";

// Backend-managed auth facade. The exported names intentionally preserve the
// older auth helper API used by the app while all operations go through
// Zenin-owned `/api/auth/*` endpoints.

const SESSION_HINT_KEY = "zenin_backend_session_present";

export function isSupabaseConfigured() {
  return true;
}

export function getSupabaseClient() {
  return {
    auth: {
      async signUp({ email, password, options } = {}) {
        const body = { email, password, displayName: options?.data?.display_name };
        const res = await zeninFetchJson("/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
        return { data: { session: null, user: res?.user || null }, error: null };
      },
      async signInWithPassword({ email, password } = {}) {
        const res = await zeninFetchJson("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password, rememberMe: true }) });
        if (res?.requiresMfa) return { data: { session: null, requiresMfa: true }, error: null };
        return { data: { session: null, user: res?.user || null }, error: null };
      },
      async resetPasswordForEmail(email, _opts) {
        await zeninFetchJson("/api/auth/forgot-password/request", { method: "POST", body: JSON.stringify({ email }) });
        return { data: null, error: null };
      },
      async updateUser(attrs = {}) {
        if (attrs.password) {
          await zeninFetchJson("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword: attrs.currentPassword || "", newPassword: attrs.password }) });
          return { data: null, error: null };
        }
        if (attrs.email) {
          await zeninFetchJson("/api/account/email/request", { method: "POST", body: JSON.stringify({ newEmail: attrs.email, currentPassword: attrs.currentPassword || "" }) });
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      onAuthStateChange(cb = () => {}) {
        (async () => {
          try {
            const me = await zeninFetchJson("/api/auth/me");
            if (me?.authenticated) cb("SIGNED_IN", null);
          } catch (_e) {}
        })();
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signOut() {
        try {
          await zeninFetchJson("/api/auth/signout", { method: "POST" });
        } catch (e) {
          console.warn("Signout failed", e);
        }
      },
      async getSession() {
        try {
          const me = await zeninFetchJson("/api/auth/me", { timeoutMs: 3500 });
          return { data: { session: me?.authenticated ? { user: me.user } : null }, error: null };
        } catch (error) {
          return { data: { session: null }, error: error || null };
        }
      }
    }
  };
}

export function setSupabaseSessionHint(hasSession) {
  if (typeof window === "undefined") return;
  try {
    if (hasSession) window.localStorage.setItem(SESSION_HINT_KEY, "1");
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {}
}

export function hasSupabaseSessionHint() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistZeninAuth(result = null) {
  if (typeof window === "undefined") return;
  try {
    if (result?.expiresAt) window.localStorage.setItem("zenin_auth_expires_at", String(result.expiresAt));
    else window.localStorage.removeItem("zenin_auth_expires_at");
    if (result?.user) {
      window.localStorage.setItem("zenin_auth_user", JSON.stringify(result.user));
      if (result.user.email) window.localStorage.setItem("zenin_email", result.user.email);
      return;
    }
    window.localStorage.removeItem("zenin_auth_user");
  } catch {}
}

export async function getSupabaseSession() {
  const { data } = await getSupabaseClient().auth.getSession();
  const session = data?.session || null;
  setSupabaseSessionHint(Boolean(session));
  return session;
}

export async function getSupabaseMfaState() {
  try {
    const me = await zeninFetchJson("/api/auth/me");
    const user = me?.user || null;
    if (!user) return { aal: null, factors: [], verifiedTotpFactor: null };
    const verifiedTotpFactor = user.twoFactorEnabled
      ? { friendly_name: "Authenticator app", factor_type: "totp", created_at: user.twoFactorEnabledAt }
      : null;
    return { aal: null, factors: [], verifiedTotpFactor };
  } catch (_e) {
    return { aal: null, factors: [], verifiedTotpFactor: null };
  }
}

export async function startSupabaseTotpEnrollment(opts = {}) {
  const resp = await zeninFetchJson("/api/auth/2fa/generate");
  return {
    factorId: resp.secret || "",
    secret: resp.secret || "",
    qrCode: resp.qrCodeDataUrl || ""
  };
}

export async function verifySupabaseTotpEnrollment({ factorId, code } = {}) {
  if (!factorId) throw new Error("Missing TOTP enrollment secret (generate QR first).");
  if (!/^\d{6}$/.test(String(code || "").trim())) throw new Error("Enter a valid 6-digit code.");
  return zeninFetchJson("/api/auth/2fa/enable", {
    method: "POST",
    body: JSON.stringify({ method: "authenticator", verificationCode: String(code).trim(), secret: String(factorId) })
  });
}

export async function unenrollSupabaseMfaFactor(_factorId) {
  return zeninFetchJson("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({}) });
}

export async function verifySupabaseMfaCode(code) {
  throw new Error("Use signin flow to verify MFA code.");
}

export async function getSupabaseLinkedIdentities() {
  const me = await zeninFetchJson("/api/auth/me");
  return me?.user?.identities || [];
}

export async function startSupabasePasskeyAuthentication() {
  return zeninFetchJson("/api/auth/passkeys/authenticate/generate-options");
}

export async function verifySupabasePasskeyAuthentication({ response, challengeId, rememberMe = true } = {}) {
  if (!response || !challengeId) throw new Error("Missing passkey authentication response or challengeId.");
  return zeninFetchJson("/api/auth/passkeys/authenticate/verify", {
    method: "POST",
    body: JSON.stringify({ response, challengeId, rememberMe })
  });
}

export async function linkSupabaseOAuthIdentity(provider, { redirectTo } = {}) {
  return zeninFetchJson("/api/auth/oauth/start", { method: "POST", body: JSON.stringify({ provider, returnTo: redirectTo }) });
}

export async function unlinkSupabaseOAuthIdentity(identity) {
  return zeninFetchJson("/api/auth/oauth/unlink", { method: "POST", body: JSON.stringify({ identity }) });
}

export async function exchangeSupabaseSession() {
  return null;
}

export async function ensureZeninSessionFromSupabase() {
  try {
    const me = await zeninFetchJson("/api/auth/me");
    persistZeninAuth(me);
    return me;
  } catch {
    return null;
  }
}

export function subscribeToSupabaseAuth(onEvent = () => {}) {
  (async () => {
    try {
      const me = await zeninFetchJson("/api/auth/me");
      if (me?.authenticated) onEvent("SIGNED_IN", null);
    } catch (_e) {}
  })();
  return () => {};
}

export async function signOutEverywhere() {
  try {
    await zeninFetchJson("/api/auth/signout", { method: "POST" });
  } catch (e) {
    console.warn("Signout failed", e);
  }
  setSupabaseSessionHint(false);
  persistZeninAuth(null);
}
