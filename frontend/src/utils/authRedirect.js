export function sanitizeInternalPath(path, fallback = "/app") {
  const value = String(path || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function getPostAuthRedirectPath({ search = null, fallback = "/app" } = {}) {
  if (typeof window === "undefined") return fallback;
  const params = new URLSearchParams(search ?? window.location.search);
  const queryNext = sanitizeInternalPath(params.get("next"), "");
  const storedNext = sanitizeInternalPath(localStorage.getItem("zenin_post_auth_next"), "");
  return queryNext || storedNext || fallback;
}

export function getGuestWorkspacePath({ search = null, fallback = "/app" } = {}) {
  const candidate = sanitizeInternalPath(getPostAuthRedirectPath({ search, fallback }), fallback);
  return candidate.startsWith("/app") ? candidate : fallback;
}

export function storePostAuthRedirect(path, fallback = "/app") {
  if (typeof window === "undefined") return fallback;
  const target = sanitizeInternalPath(path, fallback);
  localStorage.setItem("zenin_post_auth_next", target);
  return target;
}

export function clearPostAuthRedirect() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("zenin_post_auth_next");
}
