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
