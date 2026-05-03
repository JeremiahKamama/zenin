import { zeninFetch } from "./zeninFetch";

export function hasWorkspaceSession() {
  try {
    return Boolean(localStorage.getItem("zenin_auth_user"));
  } catch {
    return false;
  }
}

export function readLocalJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

export async function loadWorkspaceDoc(namespace, fallback = null) {
  if (!hasWorkspaceSession()) {
    return { namespace, document: fallback, updatedAt: null };
  }
  const res = await zeninFetch(`/db/workspace/docs/${encodeURIComponent(namespace)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Workspace document request failed (${res.status})`);
  }
  return {
    namespace,
    document: data?.document ?? fallback,
    updatedAt: data?.updatedAt || null
  };
}

export async function saveWorkspaceDoc(namespace, document) {
  if (!hasWorkspaceSession()) {
    return { namespace, document, updatedAt: null };
  }
  const res = await zeninFetch(`/db/workspace/docs/${encodeURIComponent(namespace)}`, {
    method: "PUT",
    body: JSON.stringify({ document })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Workspace document save failed (${res.status})`);
  }
  return data;
}

export async function loadWorkspaceCollection(namespace, fallback = []) {
  if (!hasWorkspaceSession()) {
    return { namespace, items: Array.isArray(fallback) ? fallback : [], updatedAt: null };
  }
  const res = await zeninFetch(`/db/workspace/collections/${encodeURIComponent(namespace)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Workspace collection request failed (${res.status})`);
  }
  return {
    namespace,
    items: Array.isArray(data?.items) ? data.items : (Array.isArray(fallback) ? fallback : []),
    updatedAt: data?.updatedAt || null
  };
}

export async function saveWorkspaceCollection(namespace, items, limit = 500) {
  const normalized = Array.isArray(items) ? items.slice(0, limit) : [];
  if (!hasWorkspaceSession()) {
    return { namespace, items: normalized, updatedAt: null };
  }
  const res = await zeninFetch(`/db/workspace/collections/${encodeURIComponent(namespace)}`, {
    method: "PUT",
    body: JSON.stringify({ items: normalized, limit })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Workspace collection save failed (${res.status})`);
  }
  return data;
}
