// hooks/useNotificationStream.js
// Realtime workspace notifications over SSE (GET /api/notifications/stream).
// - Opens ONE EventSource after authenticated workspace bootstrap.
// - Recreates it on sign-out / workspace change / session invalidation.
// - Merges incoming events by notification id (caller decides inbox + popup).
// - Dedupes by id for the current browser session.
// - Reconnects with exponential backoff (browser EventSource auto-retries; we
//   add a bounded backoff guard + visibility-based reopen).
//
// Zero-regression: if the endpoint is unavailable, this silently no-ops and the
// existing polling path (refreshWorkspaceNotifications) remains the source of truth.

import { useEffect, useRef } from "react";
import { ZENIN_API_BASE_URL } from "@/constants/apiConfig";

// Resolve the SSE origin from the configured API base (mirrors livePriceStream).
function buildStreamUrl(pathname) {
  const baseWithoutApi = String(ZENIN_API_BASE_URL || "").replace(/\/api\/?$/i, "");
  const fallbackOrigin = typeof window !== "undefined" ? window.location.origin : "";
  let baseForUrl = baseWithoutApi || fallbackOrigin;
  if (baseForUrl.startsWith("/")) baseForUrl = `${fallbackOrigin}${baseForUrl}`;
  const url = new URL(baseForUrl);
  url.protocol = url.protocol === "https:" ? "https:" : "http:";
  url.pathname = `/api${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function useNotificationStream({ activeWorkspaceId, isAuthenticated, onEvent }) {
  const sourceRef = useRef(null);
  const seenIds = useRef(new Set());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!isAuthenticated || !activeWorkspaceId) return undefined;

    let closed = false;
    let reconnectTimer = null;
    let attempt = 0;

    const open = () => {
      if (closed) return;
      let es;
      try {
        // `withCredentials` is REQUIRED here, not optional.
        //
        // The API is cross-origin (www.zenin.capital -> zenin-mx6w.onrender.com)
        // and `EventSource` defaults to `withCredentials: false`, which omits
        // cookies entirely. The session cookie therefore never reached the
        // server, `requireSignedIn` rejected every attempt, and the browser
        // retried forever — filling the console with
        // "GET /api/notifications/stream 401 (Unauthorized)" in an endless loop.
        //
        // The server already sends Access-Control-Allow-Credentials: true and
        // allow-lists this origin, so asking for credentials is all that was
        // missing. Same-origin deployments are unaffected.
        es = new EventSource(buildStreamUrl("/notifications/stream"), { withCredentials: true });
      } catch {
        scheduleReconnect();
        return;
      }
      sourceRef.current = es;

      es.onopen = () => { attempt = 0; };

      es.onmessage = (ev) => {
        if (!ev?.data) return;
        let parsed;
        try { parsed = JSON.parse(ev.data); } catch { return; }
        const notification = parsed?.notification;
        const id = notification?.id != null ? String(notification.id) : null;
        if (!id) return;
        if (seenIds.current.has(id)) return; // dedupe within this session
        seenIds.current.add(id);
        if (seenIds.current.size > 1000) seenIds.current = new Set([...seenIds.current].slice(-500));
        if (onEventRef.current) onEventRef.current(notification, parsed);
      };

      es.onerror = () => {
        try { es.close(); } catch {}
        sourceRef.current = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closed) return;
      attempt = Math.min(attempt + 1, 6);
      const delay = Math.min(1000 * 2 ** attempt, 30000);
      reconnectTimer = setTimeout(open, delay);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible" && !sourceRef.current && !closed) open();
    };

    open();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", onVisible);
      if (sourceRef.current) { try { sourceRef.current.close(); } catch {} sourceRef.current = null; }
    };
  }, [isAuthenticated, activeWorkspaceId]);

  return null;
}

export default useNotificationStream;
