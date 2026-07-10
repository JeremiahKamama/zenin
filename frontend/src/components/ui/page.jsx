import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Layout primitives — Phase 4 Standardization.
 *
 * Every data module renders inside <Page>. The header is the canonical
 * PageHeader (title / subtitle / breadcrumb / actions / filters / search).
 * The optional right rail is ContextRail (Portfolio, Exposure, Research,
 * Decision Queue, Alerts, Activity per the plan). These replace bespoke
 * page shells so layout never drifts module-to-module.
 *
 * Density is inherited app-wide via the html[data-density] tokens; these
 * primitives read --section-gap / --card-padding-* so they adapt.
 */
const Page = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex min-h-full w-full flex-col gap-[var(--section-gap)]",
        className
      )}
      {...props}
    />
  )
);
Page.displayName = "Page";

const PageMain = React.forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex min-w-0 flex-1 flex-col gap-[var(--section-gap)]", className)} {...props}>
    {children}
  </div>
));
PageMain.displayName = "PageMain";

/**
 * PageHeader — title block + optional breadcrumb, actions, filters, search.
 * title/subtitle use the token type scale; actions align right.
 */
const PageHeader = React.forwardRef(
  ({ className, title, subtitle, breadcrumb, actions, filters, search, children, ...props }, ref) => (
    <header
      ref={ref}
      className={cn(
        "flex flex-col gap-[var(--space-3)] border-b border-[var(--color-border-subtle)] pb-[var(--space-4)]",
        className
      )}
      {...props}
    >
      {breadcrumb ? (
        <nav aria-label="Breadcrumb" className="text-[var(--fs-xs)] uppercase tracking-wide text-[color:var(--color-text-muted)]">
          {breadcrumb}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
        <div className="min-w-0">
          {title ? (
            <h1 className="text-[var(--fs-2xl)] font-[var(--fw-semibold)] leading-tight text-[color:inherit]">
              {title}
            </h1>
          ) : null}
          {subtitle ? (
            <p className="mt-[var(--space-1)] text-[var(--fs-base)] text-[color:var(--color-text-muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">{actions}</div>
        ) : null}
      </div>
      {(filters || search || children) && (
        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          {filters}
          {search}
          {children}
        </div>
      )}
    </header>
  )
);
PageHeader.displayName = "PageHeader";

/** ContextRail — persistent right panel (Phase 4). Scrolls independently. */
const ContextRail = React.forwardRef(({ className, title, children, ...props }, ref) => (
  <aside
    ref={ref}
    aria-label={typeof title === "string" ? title : "Context"}
    className={cn(
      "flex w-[300px] shrink-0 flex-col gap-[var(--space-4)] overflow-auto border-l border-[var(--color-border-subtle)] pl-[var(--space-4)]",
      className
    )}
    {...props}
  >
    {title ? (
      <h2 className="text-[var(--fs-xs)] font-[var(--fw-semibold)] uppercase tracking-[0.08em] text-[color:var(--color-text-muted)]">
        {title}
      </h2>
    ) : null}
    {children}
  </aside>
));
ContextRail.displayName = "ContextRail";

export { Page, PageMain, PageHeader, ContextRail };
