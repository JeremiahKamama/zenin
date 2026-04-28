import { ZENIN_API_BASE_URL } from "../constants/apiConfig";


export function canUseWebSocket() {
  return typeof window !== "undefined" && "WebSocket" in window;
}

export function resolveZeninWsUrl(path = "/live") {
  const baseWithoutApi = ZENIN_API_BASE_URL.replace(/\/api\/?$/i, "");
  const url = new URL(baseWithoutApi);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  url.pathname = `/api${normalizedPath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
