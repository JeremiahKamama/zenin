import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Slider — shared range control (Phase 3 forms). Single-thumb.
 *
 * Dependency-free. Keyboard: Arrow/PageUp/PageDown/Home/End. ARIA slider role
 * with aria-valuemin/max/now/text. Touch targets ≥ 44px (token --z handled by
 * layer). Tokens only — the active fill is --color-interactive (neutral).
 */
const Slider = React.forwardRef(
  (
    {
      className,
      value,
      defaultValue = 0,
      min = 0,
      max = 100,
      step = 1,
      disabled = false,
      onValueChange,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const [internal, setInternal] = React.useState(defaultValue);
    const current = value != null ? value : internal;
    const trackRef = React.useRef(null);

    const clamp = (n) => Math.min(max, Math.max(min, n));
    const quantize = (n) => {
      const snapped = Math.round((n - min) / step) * step + min;
      return clamp(snapped);
    };

    const set = (next, commit = true) => {
      if (disabled) return;
      const v = quantize(next);
      if (value == null) setInternal(v);
      if (commit) onValueChange?.(v);
    };

    const pct = max === min ? 0 : ((current - min) / (max - min)) * 100;

    const onPointerDown = (e) => {
      if (disabled) return;
      e.preventDefault();
      const move = (clientX) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const ratio = (clientX - rect.left) / rect.width;
        set(min + ratio * (max - min));
      };
      move(e.clientX);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

    const onKeyDown = (e) => {
      const big = (max - min) / 10;
      const map = {
        ArrowRight: step, ArrowUp: step,
        ArrowLeft: -step, ArrowDown: -step,
        PageUp: big, PageDown: -big,
        Home: min - current, End: max - current,
      };
      if (!(e.key in map)) return;
      e.preventDefault();
      set(current + map[e.key]);
    };

    return (
      <div
        ref={ref}
        className={cn("flex w-full items-center py-[var(--space-3)]", className)}
        {...props}
      >
        <div
          ref={trackRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={ariaLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current}
          aria-valuetext={String(current)}
          aria-disabled={disabled || undefined}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          className={cn(
            "relative h-1.5 w-full rounded-full bg-[var(--color-surface-hover)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            disabled && "opacity-50"
          )}
        >
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-[var(--color-interactive)]"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-card)] shadow-[var(--shadow-1)]"
            style={{ left: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
