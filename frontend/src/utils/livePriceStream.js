import { ZENIN_API_BASE_URL } from "../constants/apiConfig";


export function canUseWebSocket() {
  return typeof window !== "undefined" && "WebSocket" in window;
}

export function resolveZeninWsUrl(path = "/live") {
  const baseWithoutApi = String(ZENIN_API_BASE_URL || "").replace(/\/api\/?$/i, "");
  const fallbackOrigin = typeof window !== "undefined" ? window.location.origin : "https://www.zenin.capital";

  // If baseWithoutApi is empty or a relative path, resolve it against the current origin.
  let baseForUrl = baseWithoutApi;
  if (!baseForUrl) baseForUrl = fallbackOrigin;
  else if (baseForUrl.startsWith("/")) baseForUrl = `${fallbackOrigin}${baseForUrl}`;

  const url = new URL(baseForUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  url.pathname = `/api${normalizedPath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
