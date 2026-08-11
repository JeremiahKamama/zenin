// hooks/useIdleTimer.js
//
// Activity tracking + idle detection. Listens for user interaction events
// (pointer/keyboard/scroll/touch), records the last-activity timestamp, and
// flips `idle` to true after `timeoutMs` of inactivity.
//
// Used to pause live-data pulling after 30 minutes of inactivity and to surface
// the "While You Were Gone" / "Live data paused" UI. Visibility changes (tab
// switch back to foreground) also count as activity so returning to the tab
// immediately resumes.
//
// Returns:
//   - idle: boolean (true once the idle threshold is crossed)
//   - lastActiveAt: number (epoch ms of last activity)
//   - idleSince: number | null (epoch ms when idle began, for "since you left")
//   - bump(): manually mark activity (e.g. on a resume action)

import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "wheel",
  "touchstart",
  "pointerdown",
];

export function useIdleTimer({ timeoutMs = 30 * 60 * 1000, enabled = true } = {}) {
  const [idle, setIdle] = useState(false);
  const lastActiveRef = useRef(Date.now());
  const idleSinceRef = useRef(null);
  const [lastActiveAt, setLastActiveAt] = useState(Date.now());
  const [idleSince, setIdleSince] = useState(null);
  const timerRef = useRef(null);

  const markActive = useCallback(() => {
    const now = Date.now();
    lastActiveRef.current = now;
    setLastActiveAt(now);
    if (idleSinceRef.current != null) {
      idleSinceRef.current = null;
      setIdleSince(null);
    }
    setIdle(false);
  }, []);

  // Arm the idle timer. Re-armed on every activity event.
  const armTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      idleSinceRef.current = Date.now();
      setIdleSince(Date.now());
      setIdle(true);
    }, timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setIdle(false);
      return undefined;
    }

    const onActivity = () => {
      markActive();
      armTimer();
    };

    // Arm once on enable.
    markActive();
    armTimer();

    ACTIVITY_EVENTS.forEach((evt) => {
      window.addEventListener(evt, onActivity, { passive: true });
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Returning to the tab counts as activity (resume immediately).
        onActivity();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, markActive, armTimer]);

  return { idle, lastActiveAt, idleSince, bump: markActive };
}

export default useIdleTimer;
