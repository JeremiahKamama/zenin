import { useEffect, useState } from "react";

/**
 * useMediaQuery — boolean state that mirrors a CSS media query.
 *
 * @param {string} query   e.g. "(max-width: 1100px)"
 * @param {object} [opts]
 * @param {boolean} [opts.defaultValue=false]  pre-hydration fallback
 * @returns {boolean}
 *
 * Usage:
 *   const isMobile = useMediaQuery("(max-width: 768px)");
 */
export function useMediaQuery(query, opts = {}) {
  const defaultValue = opts.defaultValue ?? false;

  const getSnapshot = () => {
    if (typeof window === "undefined" || !window.matchMedia) return defaultValue;
    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getSnapshot);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const handler = (event) => setMatches(event.matches);
    setMatches(mql.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);

  return matches;
}

/**
 * useViewportWidth — returns the live window inner width, debounced.
 * Useful when JS needs the raw number (not just a boolean).
 *
 * @param {number} [debounceMs=120]
 * @returns {number}
 */
export function useViewportWidth(debounceMs = 120) {
  const getInitial = () => (typeof window === "undefined" ? 1280 : window.innerWidth);
  const [width, setWidth] = useState(getInitial);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let timer = null;
    const handler = () => {
      if (timer) return;
      timer = setTimeout(() => {
        setWidth(window.innerWidth);
        timer = null;
      }, debounceMs);
    };
    window.addEventListener("resize", handler, { passive: true });
    return () => {
      window.removeEventListener("resize", handler);
      if (timer) clearTimeout(timer);
    };
  }, [debounceMs]);

  return width;
}