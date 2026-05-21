const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isLocalHostname(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isDevFullAccessEnabled() {
  const envEnabled = TRUE_VALUES.has(String(import.meta.env.VITE_ZENIN_DEV_FULL_ACCESS || "").trim().toLowerCase());
  if (!envEnabled || typeof window === "undefined") return false;
  return import.meta.env.DEV && isLocalHostname(window.location.hostname);
}

export function buildDevFullAccessUser() {
  const now = new Date().toISOString();
  return {
    id: "dev-full-access",
    email: "dev@zenin.local",
    displayName: "Local Full Access",
    currentPlan: "desk",
    currentBillingCycle: "monthly",
    isAdmin: true,
    adminRole: "owner",
    authProvider: "local-dev",
    emailVerified: true,
    createdAt: now,
    updatedAt: now
  };
}
