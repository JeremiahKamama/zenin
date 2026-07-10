import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * RadioGroup — shared single-select control (Phase 3 forms).
 *
 * Dependency-free (no Radix radio dep). Fully keyboard accessible:
 * arrow keys move between options, role=radiogroup/radio, roving tabindex.
 * Tokens only; respects --color-focus for the selected ring.
 */
const RadioGroupContext = React.createContext(null);

function useRadioGroupContext() {
  const ctx = React.useContext(RadioGroupContext);
  if (!ctx) throw new Error("RadioGroup.* must be used within <RadioGroup>");
  return ctx;
}

const RadioGroup = React.forwardRef(
  ({ className, value, defaultValue, onValueChange, name, disabled = false, "aria-label": ariaLabel, children, ...props }, ref) => {
    const [internal, setInternal] = React.useState(defaultValue ?? "");
    const current = value != null ? value : internal;
    const set = React.useCallback(
      (next) => {
        if (disabled) return;
        if (value == null) setInternal(next);
        onValueChange?.(next);
      },
      [disabled, value, onValueChange]
    );

    const itemRefs = React.useRef({});
    const ordered = React.useRef([]);

    const onKeyDown = (e) => {
      if (disabled) return;
      if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key)) return;
      e.preventDefault();
      const items = ordered.current.filter(Boolean);
      const idx = items.findIndex((el) => el === document.activeElement);
      const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      const nextIdx = (idx + dir + items.length) % items.length;
      const nextEl = items[nextIdx];
      nextEl?.focus();
      set(nextEl?.dataset?.value);
    };

    return (
      <RadioGroupContext.Provider value={{ current, set, disabled, name, itemRefs, ordered }}>
        <div
          ref={ref}
          role="radiogroup"
          aria-label={ariaLabel}
          aria-disabled={disabled || undefined}
          className={cn("flex flex-col gap-[var(--space-2)]", className)}
          onKeyDown={onKeyDown}
          {...props}
        >
          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }
);
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = React.forwardRef(
  ({ className, value, id, disabled: itemDisabled, children, ...props }, ref) => {
    const { current, set, disabled: groupDisabled, name, itemRefs, ordered } = useRadioGroupContext();
    const disabled = groupDisabled || itemDisabled;
    const checked = current === value;

    React.useEffect(() => {
      itemRefs.current[value] = ref.current;
      ordered.current.push(ref.current);
      return () => {
        delete itemRefs.current[value];
        ordered.current = ordered.current.filter((el) => el !== ref.current);
      };
    }, [value, ref, itemRefs, ordered]);

    return (
      <label
        className={cn(
          "flex cursor-pointer items-center gap-[var(--space-2)] text-[var(--fs-base)] text-[color:inherit]",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        <span
          ref={ref}
          role="radio"
          aria-checked={checked}
          aria-disabled={disabled || undefined}
          tabIndex={checked || (!current && ordered.current[0] === ref.current) ? 0 : -1}
          data-value={value}
          onClick={() => set(value)}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
            checked
              ? "border-[var(--color-interactive)]"
              : "border-[var(--color-border-strong)]"
          )}
          {...props}
        >
          {checked && (
            <span className="h-2 w-2 rounded-full bg-[var(--color-interactive)]" aria-hidden="true" />
          )}
        </span>
        <input type="radio" name={name} value={value} checked={checked} disabled={disabled} readOnly className="sr-only" />
        {children}
      </label>
    );
  }
);
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
