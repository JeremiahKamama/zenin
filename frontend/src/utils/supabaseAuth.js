import { createClient } from "@supabase/supabase-js";
import { zeninFetchJson } from "./zeninFetch";

const importMetaEnv =
  typeof import.meta !== "undefined" && import.meta?.env
    ? import.meta.env
    : {};

const SUPABASE_URL = String(importMetaEnv.VITE_SUPABASE_URL || "").trim();
const SUPABASE_PUBLISHABLE_KEY = String(importMetaEnv.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
const SUPABASE_SESSION_HINT_KEY = "zenin_supabase_session_present";

let supabaseClient = null;

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }
  return supabaseClient;
}

export function setSupabaseSessionHint(hasSession) {
  if (typeof window === "undefined") return;
  try {
    if (hasSession) {
      window.localStorage.setItem(SUPABASE_SESSION_HINT_KEY, "1");
    } else {
      window.localStorage.removeItem(SUPABASE_SESSION_HINT_KEY);
    }
  } catch {
    // no-op
  }
}

export function hasSupabaseSessionHint() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SUPABASE_SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistZeninAuth(result = null) {
  if (typeof window === "undefined") return;
  try {
    if (result?.expiresAt) {
      window.localStorage.setItem("zenin_auth_expires_at", String(result.expiresAt));
    } else {
      window.localStorage.removeItem("zenin_auth_expires_at");
    }
    if (result?.user) {
      window.localStorage.setItem("zenin_auth_user", JSON.stringify(result.user));
      if (result.user.email) {
        window.localStorage.setItem("zenin_email", result.user.email);
      }
      return;
    }
    window.localStorage.removeItem("zenin_auth_user");
  } catch {
    // no-op
  }
}

export async function getSupabaseSession() {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  setSupabaseSessionHint(Boolean(data?.session));
  return data?.session || null;
}

function getVerifiedTotpFactor(factors = []) {
  return factors.find((factor) => String(factor?.status || "").toLowerCase() === "verified") || null;
}

export async function getSupabaseMfaState() {
  const client = getSupabaseClient();
  if (!client) return { aal: null, factors: [], verifiedTotpFactor: null };
  const [aalResult, factorsResult] = await Promise.all([
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
    client.auth.mfa.listFactors()
  ]);
  if (aalResult.error) throw aalResult.error;
  if (factorsResult.error) throw factorsResult.error;
  const factors = Array.isArray(factorsResult.data?.totp) ? factorsResult.data.totp : [];
  return {
    aal: aalResult.data || null,
    factors,
    verifiedTotpFactor: getVerifiedTotpFactor(factors)
  };
}

export async function startSupabaseTotpEnrollment({ friendlyName } = {}) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Authentication is not configured for this frontend.");
  const params = { factorType: "totp" };
  const normalizedName = String(friendlyName || "").trim();
  if (normalizedName) params.friendlyName = normalizedName;
  const { data, error } = await client.auth.mfa.enroll(params);
  if (error) throw error;
  return {
    factorId: data?.id || "",
    qrCode: data?.totp?.qr_code || "",
    secret: data?.totp?.secret || ""
  };
}

export async function verifySupabaseTotpEnrollment({ factorId, code }) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Authentication is not configured for this frontend.");
  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verify = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code
  });
  if (verify.error) throw verify.error;
  return verify.data;
}

export async function unenrollSupabaseMfaFactor(factorId) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Authentication is not configured for this frontend.");
  const { data, error } = await client.auth.mfa.unenroll({ factorId });
  if (error) throw error;
  return data;
}

export async function verifySupabaseMfaCode(code) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Authentication is not configured for this frontend.");
  const { factors, verifiedTotpFactor } = await getSupabaseMfaState();
  const factor = verifiedTotpFactor || factors[0];
  if (!factor?.id) throw new Error("No authenticator app factor is available for this account.");
  return verifySupabaseTotpEnrollment({ factorId: factor.id, code });
}

export async function getSupabaseLinkedIdentities() {
  const client = getSupabaseClient();
  if (!client) return [];
  const { data, error } = await client.auth.getUserIdentities();
  if (error) throw error;
  return Array.isArray(data?.identities) ? data.identities : [];
}

export async function linkSupabaseOAuthIdentity(provider, { redirectTo } = {}) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Authentication is not configured for this frontend.");
  const { data, error } = await client.auth.linkIdentity({
    provider,
    options: redirectTo ? { redirectTo } : undefined
  });
  if (error) throw error;
  return data;
}

export async function unlinkSupabaseOAuthIdentity(identity) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Authentication is not configured for this frontend.");
  const { data, error } = await client.auth.unlinkIdentity(identity);
  if (error) throw error;
  return data;
}

export async function exchangeSupabaseSession({ rememberMe = true } = {}) {
  const session = await getSupabaseSession();
  const accessToken = session?.access_token;
  if (!accessToken) return null;
  const data = await zeninFetchJson("/auth/supabase/exchange", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ rememberMe })
  });
  persistZeninAuth(data);
  return data;
}

export async function ensureZeninSessionFromSupabase(options = {}) {
  try {
    return await exchangeSupabaseSession(options);
  } catch (error) {
    console.warn("Supabase session exchange failed.", error);
    return null;
  }
}

export function subscribeToSupabaseAuth(onEvent = () => {}) {
  const client = getSupabaseClient();
  if (!client) {
    return () => {};
  }
  const { data } = client.auth.onAuthStateChange((event, session) => {
    setSupabaseSessionHint(Boolean(session));
    if (!session) {
      persistZeninAuth(null);
    }
    onEvent(event, session);
  });
  return () => {
    data?.subscription?.unsubscribe?.();
  };
}

export async function signOutEverywhere() {
  try {
    await zeninFetchJson("/auth/signout", { method: "POST" });
  } catch (error) {
    console.warn("Backend signout failed.", error);
  }
  const client = getSupabaseClient();
  if (client) {
    await client.auth.signOut();
  }
  setSupabaseSessionHint(false);
  persistZeninAuth(null);
}
