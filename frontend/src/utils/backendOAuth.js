import { zeninFetchJson } from "./zeninFetch";

export async function startOAuth(provider, { returnTo, entryPath, authMode } = {}) {
  const body = { provider };
  if (returnTo) body.returnTo = returnTo;
  if (entryPath) body.entryPath = entryPath;
  if (authMode) body.authMode = authMode;
  if (typeof window !== "undefined" && window.location?.origin) {
    body.frontendOrigin = window.location.origin;
  }

  const data = await zeninFetchJson("/api/auth/oauth/start", {
    method: "POST",
    body: JSON.stringify(body)
  });
  if (!data?.authorizationUrl) throw new Error(data?.message || `OAuth start did not return a URL`);
  // Redirect browser to provider authorization URL
  window.location.assign(data.authorizationUrl);
}
