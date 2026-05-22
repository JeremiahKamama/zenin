export async function startOAuth(provider, { returnTo, entryPath, authMode } = {}) {
  const body = { provider };
  if (returnTo) body.returnTo = returnTo;
  if (entryPath) body.entryPath = entryPath;
  if (authMode) body.authMode = authMode;

  const res = await fetch(`/api/auth/oauth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Failed to start ${provider} OAuth`);
  }
  const data = await res.json();
  if (!data?.authorizationUrl) throw new Error(data?.message || `OAuth start did not return a URL`);
  // Redirect browser to provider authorization URL
  window.location.assign(data.authorizationUrl);
}
