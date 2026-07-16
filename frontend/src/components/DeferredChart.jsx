// DeferredChart — §7 initial-load pressure.
// Mounts the heavy chart only once it scrolls near the viewport, rendering a
// fixed-height skeleton placeholder until then (no layout shift, meaningful
// first paint preserved). Falls back to immediate render if IntersectionObserver
// is unavailable.
import { useEffect, useRef, useState } from "react";

export function DeferredChart({ height = 214, children, className = "" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className={`deferred-chart ${className}`} style={{ minHeight: height }}>
      {visible ? children : (
        <div className="deferred-chart-skeleton" style={{ height }} aria-hidden="true">
          <div className="deferred-chart-skeleton-bar" />
          <span className="sr-only">Chart loading</span>
        </div>
      )}
    </div>
  );
}

export default DeferredChart;
